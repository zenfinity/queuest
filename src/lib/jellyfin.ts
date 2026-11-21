/**
 * Jellyfin library check: asks the user's own Jellyfin server which titles it
 * has, and marks matching queue items as "On my media server"
 * (`in_library_at`).
 *
 * Runs entirely in the browser. The server URL and token live only in this
 * device's IndexedDB meta store, outside the sync blob, so they never reach
 * Queuest's servers or other devices. The browser talks to Jellyfin directly,
 * which is what lets this work with a server that's reachable only over a
 * Tailscale tailnet.
 *
 * Only `https://*.ts.net` addresses are accepted. An https page can't call a
 * plain-http server (mixed content), and the CSP's connect-src only allows
 * `https://*.ts.net:*` for anything outside TMDB. Tailscale's `serve` command
 * gives a tailnet-only https address with a real certificate, which fits both.
 */
import { getMeta, setMeta, deleteMeta, getAll, markInLibrary } from './db';
import { itemKey, type WatchlistItem } from './types';
import { isSyncEnabled, getSyncStatus, restoreSyncState } from './sync';
import { markSharedInLibrary } from './collection-actions';

export interface JellyfinConfig {
	/** Normalized base URL, no trailing slash, e.g. https://media.tail1234.ts.net */
	url: string;
	token: string;
}

const CONFIG_KEY = 'jellyfin_config';
const LAST_CHECK_KEY = 'jellyfin_last_check';
/** How often the automatic check on app open is allowed to run. */
export const AUTO_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const PAGE_SIZE = 1000;
/** Upper bound on pages fetched, so a misbehaving server can't loop us forever. */
const MAX_PAGES = 100;
const REQUEST_TIMEOUT_MS = 15_000;

/**
 * Validates and normalizes a user-entered server address. Returns the
 * normalized URL, or an error message suitable for showing in Settings.
 * Keeps any path prefix (Jellyfin can run under e.g. /jellyfin).
 */
export function normalizeServerUrl(raw: string): { url: string } | { error: string } {
	let parsed: URL;
	try {
		parsed = new URL(raw.trim());
	} catch {
		return { error: 'That doesn’t look like a web address.' };
	}
	if (parsed.protocol !== 'https:') {
		return { error: 'The address must start with https://.' };
	}
	if (!parsed.hostname.endsWith('.ts.net')) {
		return {
			error: 'Only Tailscale addresses (ending in .ts.net) are supported. See the setup note below.'
		};
	}
	if (parsed.username || parsed.password || parsed.search || parsed.hash) {
		return { error: 'Enter just the server address, without a login, query, or #fragment.' };
	}
	const path = parsed.pathname.replace(/\/+$/, '');
	return { url: `${parsed.origin}${path}` };
}

export async function getJellyfinConfig(): Promise<JellyfinConfig | null> {
	const raw = await getMeta(CONFIG_KEY);
	if (!raw) return null;
	try {
		const parsed = JSON.parse(raw) as Partial<JellyfinConfig>;
		if (typeof parsed.url === 'string' && typeof parsed.token === 'string') {
			return { url: parsed.url, token: parsed.token };
		}
	} catch {
		// Corrupt entry: treat as not configured
	}
	return null;
}

export async function setJellyfinConfig(config: JellyfinConfig): Promise<void> {
	await setMeta(CONFIG_KEY, JSON.stringify(config));
}

export async function clearJellyfinConfig(): Promise<void> {
	await Promise.all([deleteMeta(CONFIG_KEY), deleteMeta(LAST_CHECK_KEY)]);
}

export async function getLastCheck(): Promise<string | undefined> {
	return getMeta(LAST_CHECK_KEY);
}

/** Matching keys for everything in the library: `movie:<tmdb>`, `tv:<tmdb>`,
 * and `imdb:<tt…>` as a fallback for items with no TMDB id. */
export interface LibraryKeys {
	keys: Set<string>;
	/** Movies and series the server returned, matched or not. */
	count: number;
}

interface JellyfinItem {
	Type?: string;
	ProviderIds?: Record<string, string | null | undefined>;
}

/** Jellyfin's provider-id keys are case-inconsistent across versions and
 * metadata plugins ("Tmdb", "tmdb"), so look them up case-insensitively. */
function providerId(ids: JellyfinItem['ProviderIds'], name: string): string | null {
	if (!ids) return null;
	for (const [k, v] of Object.entries(ids)) {
		if (k.toLowerCase() === name && typeof v === 'string' && v.trim()) return v.trim();
	}
	return null;
}

export function libraryKeysFrom(items: JellyfinItem[]): string[] {
	const out: string[] = [];
	for (const item of items) {
		const mediaType = item.Type === 'Movie' ? 'movie' : item.Type === 'Series' ? 'tv' : null;
		if (!mediaType) continue;
		const tmdb = providerId(item.ProviderIds, 'tmdb');
		if (tmdb && /^\d+$/.test(tmdb)) out.push(`${mediaType}:${Number(tmdb)}`);
		const imdb = providerId(item.ProviderIds, 'imdb');
		if (imdb && /^tt\d+$/.test(imdb)) out.push(`imdb:${imdb}`);
	}
	return out;
}

export class JellyfinError extends Error {}

/** Fetches every movie and series in the library the token can see. */
export async function fetchLibraryKeys(
	config: JellyfinConfig,
	fetchFn: typeof fetch = fetch
): Promise<LibraryKeys> {
	const keys = new Set<string>();
	let count = 0;
	for (let page = 0; page < MAX_PAGES; page++) {
		const params = new URLSearchParams({
			Recursive: 'true',
			IncludeItemTypes: 'Movie,Series',
			Fields: 'ProviderIds',
			EnableImages: 'false',
			EnableUserData: 'false',
			// Jellyfin's "group movies into collections" otherwise returns a
			// BoxSet in place of every movie that belongs to one, so those
			// movies never appear here. On a real library this hid 59 of 175
			// movies (Ghostbusters 2016 among them, inside its collection).
			CollapseBoxSetItems: 'false',
			StartIndex: String(page * PAGE_SIZE),
			Limit: String(PAGE_SIZE)
		});
		let res: Response;
		try {
			res = await fetchFn(`${config.url}/Items?${params}`, {
				headers: { Authorization: `MediaBrowser Token="${config.token}"` },
				signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
			});
		} catch {
			throw new JellyfinError(
				'Couldn’t reach your Jellyfin server. Check that this device is connected to Tailscale and the address is right.'
			);
		}
		if (res.status === 401 || res.status === 403) {
			throw new JellyfinError('Jellyfin rejected the token. Check it and try again.');
		}
		if (!res.ok) {
			throw new JellyfinError(`Jellyfin returned an error (HTTP ${res.status}).`);
		}
		let body: { Items?: unknown; TotalRecordCount?: unknown };
		try {
			body = await res.json();
		} catch {
			throw new JellyfinError('Jellyfin sent a response that couldn’t be read.');
		}
		const items = Array.isArray(body.Items) ? (body.Items as JellyfinItem[]) : [];
		for (const key of libraryKeysFrom(items)) keys.add(key);
		count += items.length;
		const total = typeof body.TotalRecordCount === 'number' ? body.TotalRecordCount : count;
		if (items.length < PAGE_SIZE || count >= total) break;
	}
	return { keys, count };
}

/** Whether a title (queue or shared-list item) is in the library: by
 * type + TMDB id, or by IMDb id as a fallback. */
export function matchesLibrary(
	item: { tmdb_id: number; media_type: 'movie' | 'tv'; imdb_id?: string | null },
	keys: Set<string>
): boolean {
	return keys.has(itemKey(item)) || (item.imdb_id ? keys.has(`imdb:${item.imdb_id}`) : false);
}

/** Queue items that are in the library but not yet marked. Add-only: an
 * existing mark is never removed, since it may have been set by hand for a
 * title on a different server. */
export function itemsToMark(items: WatchlistItem[], keys: Set<string>): WatchlistItem[] {
	return items.filter((item) => !item.in_library_at && matchesLibrary(item, keys));
}

export interface LibraryCheckResult {
	libraryCount: number;
	/** Personal queue titles newly marked (this covers personal lists too:
	 * a title in a personal list is a queue row). */
	newlyMarked: number;
	/** Shared-list titles newly marked with this account's own mark. Zero
	 * when sync is off, since shared lists need an account. */
	sharedMarked: number;
}

/** Runs a full check against the saved config and marks any new matches. */
export async function runLibraryCheck(
	fetchFn: typeof fetch = fetch
): Promise<LibraryCheckResult | null> {
	const config = await getJellyfinConfig();
	if (!config) return null;
	const { keys, count } = await fetchLibraryKeys(config, fetchFn);
	const toMark = itemsToMark(await getAll(), keys);
	if (toMark.length > 0) await markInLibrary(toMark.map((i) => i.id));
	const sharedMarked = await markSharedTitles(keys);
	await setMeta(LAST_CHECK_KEY, new Date().toISOString());
	return { libraryCount: count, newlyMarked: toMark.length, sharedMarked };
}

/** Shared lists only exist with sync on. Best-effort: a failure here (a
 * list that won't load, the API unreachable) never fails the personal pass
 * that already ran. */
async function markSharedTitles(keys: Set<string>): Promise<number> {
	try {
		if (!(await isSyncEnabled())) return 0;
		// The email is how a non-owner finds their own member id; it's loaded
		// into sync status on startup, which may not have finished yet.
		if (!getSyncStatus().email) await restoreSyncState();
		const email = getSyncStatus().email;
		if (!email) return 0;
		return await markSharedInLibrary((item) => matchesLibrary(item, keys), email);
	} catch {
		return 0;
	}
}

/** Fired on `window` when a background check marks new titles, so an
 * already-mounted queue view can reload and show the badges. */
export const LIBRARY_MARKED_EVENT = 'queuest:library-marked';

/** The app-open check: runs only when configured and the last check is older
 * than AUTO_CHECK_INTERVAL_MS. Fails silently, since the usual reason is
 * simply being off the tailnet right now. */
export async function maybeAutoCheck(now: Date = new Date()): Promise<void> {
	try {
		if (!(await getJellyfinConfig())) return;
		const last = await getLastCheck();
		if (last && now.getTime() - new Date(last).getTime() < AUTO_CHECK_INTERVAL_MS) return;
		const result = await runLibraryCheck();
		if (result && result.newlyMarked + result.sharedMarked > 0 && typeof window !== 'undefined') {
			window.dispatchEvent(new Event(LIBRARY_MARKED_EVENT));
		}
	} catch {
		// Off the tailnet, server down, etc.: try again next app open
	}
}
