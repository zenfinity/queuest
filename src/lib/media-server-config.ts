/**
 * The saved Jellyfin connection, as stored on this device and as carried in
 * the encrypted sync payload. Kept apart from jellyfin.ts so the sync engine
 * can merge it without importing jellyfin.ts, which itself imports sync.ts.
 *
 * With sync on, the record travels in the sync blob, which is encrypted on
 * the device before upload, so Queuest's server can't read the token. It's
 * never part of a `.queuest` export (serializeAppState doesn't include it).
 *
 * Merging is last-write-wins on `updatedAt`. Disconnecting writes a
 * `cleared` tombstone rather than deleting the record, so a disconnect on
 * one device reaches the others instead of being undone by their copy.
 */
import { getMeta, setMeta, deleteMeta } from './db';

export interface StoredMediaServer {
	url?: string;
	token?: string;
	updatedAt: string;
	/** Set by Disconnect: "no server", as a change that can win a merge. */
	cleared?: true;
}

const CONFIG_KEY = 'jellyfin_config';
/** Records saved before sync carried this had no timestamp; any synced
 * record is newer than them. */
const LEGACY_UPDATED_AT = '1970-01-01T00:00:00.000Z';
const MAX_TOKEN_LENGTH = 512;

/**
 * Validates and normalizes a user-entered server address. Returns the
 * normalized URL, or an error message suitable for showing in Settings.
 * Keeps any path prefix (Jellyfin can run under e.g. /jellyfin).
 *
 * Only `https://*.ts.net` addresses are accepted: an https page can't call a
 * plain-http server (mixed content), and the CSP's connect-src only allows
 * `https://*.ts.net:*` beyond TMDB.
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

function isIsoDate(v: unknown): v is string {
	return typeof v === 'string' && !Number.isNaN(Date.parse(v));
}

/**
 * Validates a record from local storage or, more importantly, from a pulled
 * sync payload. Rejects anything that isn't a well-formed tombstone or a
 * `.ts.net` https address plus a bounded token, so a malformed payload can't
 * point the check somewhere else.
 */
export function parseStoredMediaServer(raw: unknown): StoredMediaServer | null {
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
	const r = raw as Record<string, unknown>;
	const updatedAt = r.updatedAt === undefined ? LEGACY_UPDATED_AT : r.updatedAt;
	if (!isIsoDate(updatedAt)) return null;
	if (r.cleared === true) return { cleared: true, updatedAt };
	if (typeof r.url !== 'string' || typeof r.token !== 'string') return null;
	const token = r.token.trim();
	if (!token || token.length > MAX_TOKEN_LENGTH) return null;
	const normalized = normalizeServerUrl(r.url);
	if ('error' in normalized || normalized.url !== r.url) return null;
	return { url: r.url, token, updatedAt };
}

/** Newer `updatedAt` wins; a missing side loses to a present one. */
export function mergeMediaServer(
	local: StoredMediaServer | null,
	remote: StoredMediaServer | null
): StoredMediaServer | null {
	if (!remote) return local;
	if (!local) return remote;
	return remote.updatedAt > local.updatedAt ? remote : local;
}

export async function readStoredMediaServer(): Promise<StoredMediaServer | null> {
	const raw = await getMeta(CONFIG_KEY);
	if (!raw) return null;
	try {
		return parseStoredMediaServer(JSON.parse(raw));
	} catch {
		return null;
	}
}

export async function writeStoredMediaServer(record: StoredMediaServer): Promise<void> {
	await setMeta(CONFIG_KEY, JSON.stringify(record));
}

/** Removes the record from this device only, with no tombstone, so the next
 * sync pull restores it. Used by Reset everything, which is local. */
export async function deleteStoredMediaServer(): Promise<void> {
	await deleteMeta(CONFIG_KEY);
}
