import type { Provider, SeasonSummary } from './types';

export const TMDB_IMG = 'https://image.tmdb.org/t/p';
const BASE = 'https://api.themoviedb.org/3';

// ── Disney+ inference ─────────────────────────────────────────────────────────
// Disney+ pulled their catalogue from JustWatch (and therefore TMDB's
// watch/providers endpoint) so provider_id 337 never appears in US flatrate
// data.  We reconstruct it from first-party metadata that IS still present:
//   • TV  → networks[].id === 2739  ("Disney+" network on TMDB)
//   • Film → production_companies[].id in the set below
//
// NOTE: Only core Disney+ studios are listed.  FX Productions (84) and
// 20th Century Studios (127) are also Disney-owned but their content
// streams on Hulu, so they are deliberately excluded.
const DISNEY_PLUS_NETWORK_ID = 2739;
const DISNEY_PLUS_COMPANY_IDS = new Set([
	1,    // Lucasfilm Ltd.        → Star Wars, Indiana Jones
	2,    // Walt Disney Pictures  → live-action Disney films
	3,    // Pixar                 → Toy Story, Coco, etc.
	420,  // Marvel Studios        → MCU
	6125  // Walt Disney Animation → Frozen, Moana, Encanto, etc.
]);

export const DISNEY_PLUS_PROVIDER: Provider = {
	provider_id: 337,
	provider_name: 'Disney Plus',
	logo_path: '/97yvRBw1GzX7fXprcF80er19ot.jpg'
};

export function formatRuntime(minutes: number, mediaType: 'movie' | 'tv'): string {
	if (mediaType === 'movie') {
		const h = Math.floor(minutes / 60);
		const m = minutes % 60;
		return h > 0 ? `${h}h ${m}m` : `${m}m`;
	} else {
		const h = Math.round(minutes / 60);
		return h >= 1 ? `~${h}h` : `~${minutes}m`;
	}
}

// Retries once on 429 (TMDB rate limit) before giving up
async function tmdbFetch(url: string): Promise<Response> {
	for (let attempt = 0; attempt < 3; attempt++) {
		const res = await fetch(url);
		if (res.status !== 429) return res;
		const wait = (parseInt(res.headers.get('Retry-After') ?? '2') + 0.5) * 1000;
		await new Promise<void>((r) => setTimeout(r, wait));
	}
	return new Response('Rate limited', { status: 429 });
}

export async function searchMulti(query: string, apiKey: string) {
	const res = await tmdbFetch(
		`${BASE}/search/multi?query=${encodeURIComponent(query)}&api_key=${apiKey}&include_adult=false&language=en-US`
	);
	if (!res.ok) return [];
	const data = (await res.json()) as { results: Record<string, unknown>[] };
	return (data.results ?? []).filter(
		(r) => r.media_type === 'movie' || r.media_type === 'tv'
	);
}

interface RuntimeResult {
	runtime_minutes: number | null;
	seasons: SeasonSummary[];
	/** Network IDs from the TMDB response (TV only; empty for movies) */
	networkIds: number[];
	/** Production company IDs from the TMDB response (movies; empty for TV) */
	companyIds: number[];
	release: import('./types').ReleaseInfo | null;
	backdrop_path: string | null;
	genres: string[];
	cast: import('./types').CastMember[];
	director: string | null;
	creator: string | null;
}

export async function getRuntime(
	id: number,
	mediaType: 'movie' | 'tv',
	apiKey: string
): Promise<RuntimeResult> {
	// Movies: append release_dates + credits in one call; TV: just credits
	const qs = mediaType === 'movie' ? '&append_to_response=release_dates,credits' : '&append_to_response=credits';
	const res = await tmdbFetch(`${BASE}/${mediaType}/${id}?api_key=${apiKey}&language=en-US${qs}`);
	if (!res.ok) return { runtime_minutes: null, seasons: [], networkIds: [], companyIds: [], release: null, backdrop_path: null, genres: [], cast: [], director: null, creator: null };

	if (mediaType === 'movie') {
		const data = (await res.json()) as {
			runtime?: number;
			status?: string;
			release_date?: string;
			backdrop_path?: string | null;
			genres?: Array<{ id: number; name: string }>;
			production_companies?: Array<{ id: number }>;
			release_dates?: {
				results?: Array<{
					iso_3166_1: string;
					release_dates: Array<{ type: number; release_date: string }>;
				}>;
			};
			credits?: {
				cast?: Array<{ name: string; character: string; profile_path?: string | null; order: number }>;
				crew?: Array<{ name: string; job: string }>;
			};
		};

		const companyIds = (data.production_companies ?? []).map((c) => c.id);
		const release = movieReleaseInfo(data.status, data.release_date, data.release_dates?.results, companyIds);
		const cast = (data.credits?.cast ?? []).slice(0, 8).map((c) => ({ name: c.name, character: c.character, profile_path: c.profile_path ?? null }));
		const director = data.credits?.crew?.find((c) => c.job === 'Director')?.name ?? null;

		return {
			runtime_minutes: data.runtime ?? null,
			seasons: [],
			networkIds: [],
			companyIds,
			release,
			backdrop_path: data.backdrop_path ?? null,
			genres: (data.genres ?? []).map((g) => g.name),
			cast,
			director,
			creator: null
		};
	}

	const data = (await res.json()) as {
		number_of_episodes?: number;
		episode_run_time?: number[];
		last_episode_to_air?: { runtime?: number; season_number?: number };
		seasons?: Array<{ season_number: number; episode_count: number; name: string }>;
		networks?: Array<{ id: number }>;
		status?: string;
		next_episode_to_air?: { air_date?: string; season_number?: number } | null;
		backdrop_path?: string | null;
		genres?: Array<{ id: number; name: string }>;
		created_by?: Array<{ name: string }>;
		credits?: {
			cast?: Array<{ name: string; character: string; profile_path?: string | null; order: number }>;
		};
	};

	const avgRuntime = data.episode_run_time?.length
		? data.episode_run_time.reduce((a, b) => a + b, 0) / data.episode_run_time.length
		: (data.last_episode_to_air?.runtime ?? 0);

	// Build per-season summaries, excluding season 0 (specials)
	const seasons: SeasonSummary[] = (data.seasons ?? [])
		.filter((s) => s.season_number > 0)
		.map((s) => ({
			season_number: s.season_number,
			episode_count: s.episode_count,
			name: s.name,
			runtime_minutes: Math.round(s.episode_count * avgRuntime)
		}));

	const totalEps = data.number_of_episodes ?? 0;
	const runtime_minutes = totalEps && avgRuntime ? Math.round(totalEps * avgRuntime) : null;
	const networkIds = (data.networks ?? []).map((n) => n.id);
	const release = tvReleaseInfo(data.status, data.next_episode_to_air, data.last_episode_to_air?.season_number);
	const cast = (data.credits?.cast ?? []).slice(0, 8).map((c) => ({ name: c.name, character: c.character, profile_path: c.profile_path ?? null }));
	const creator = (data.created_by ?? []).map((c) => c.name).join(', ') || null;

	return {
		runtime_minutes, seasons, networkIds, companyIds: [], release,
		backdrop_path: data.backdrop_path ?? null,
		genres: (data.genres ?? []).map((g) => g.name),
		cast,
		director: null,
		creator
	};
}

// ── Release info helpers ──────────────────────────────────────────────────────

// TMDB release_dates type codes
const RELEASE_TYPE_DIGITAL = 4;
const RELEASE_TYPE_THEATRICAL = 3;

// Movies not yet at these statuses are still unreleased
const UNRELEASED_STATUSES = new Set(['Rumored', 'Planned', 'In Production', 'Post Production']);

/** Days after theatrical release before a film typically hits streaming */
function streamingLagDays(companyIds: number[]): number {
	// Disney/Marvel/Pixar/Lucasfilm content goes to Disney+ faster (~45 days)
	const isDisney = companyIds.some((id) => DISNEY_PLUS_COMPANY_IDS.has(id));
	return isDisney ? 45 : 90;
}

function isoDate(d: Date): string {
	return d.toISOString().slice(0, 10);
}

function addDays(isoStr: string, days: number): string {
	const d = new Date(isoStr);
	d.setUTCDate(d.getUTCDate() + days);
	return isoDate(d);
}

function movieReleaseInfo(
	status: string | undefined,
	release_date: string | undefined,
	releaseDates: Array<{ iso_3166_1: string; release_dates: Array<{ type: number; release_date: string }> }> | undefined,
	companyIds: number[]
): import('./types').ReleaseInfo | null {
	if (!status) return null;

	// Find US digital and theatrical dates from release_dates
	const us = (releaseDates ?? []).find((r) => r.iso_3166_1 === 'US');
	const digital = us?.release_dates.find((r) => r.type === RELEASE_TYPE_DIGITAL);
	const theatrical = us?.release_dates.find((r) => r.type === RELEASE_TYPE_THEATRICAL);

	const theatricalDate = theatrical?.release_date?.slice(0, 10) ?? release_date ?? null;
	const digitalDate = digital?.release_date?.slice(0, 10) ?? null;

	// Already released and on streaming — nothing to surface
	if (status === 'Released' && digitalDate) {
		const now = new Date().toISOString().slice(0, 10);
		if (digitalDate <= now) return null;
		// Digital date is in the future — show it
		return { status, digital_date: digitalDate };
	}

	// Unreleased: in production / post-production / theatrical
	if (UNRELEASED_STATUSES.has(status) || (status === 'Released' && !digitalDate)) {
		if (!theatricalDate) return { status };

		const now = new Date().toISOString().slice(0, 10);
		const lag = streamingLagDays(companyIds);

		if (digitalDate) {
			return { status, theatrical_date: theatricalDate, digital_date: digitalDate };
		}

		// No digital date yet — estimate from theatrical.
		// If the estimate has already passed, we don't know the streaming status —
		// don't surface a stale chip (provider logos will or won't be shown separately).
		const estimatedStreaming = addDays(theatricalDate, lag);
		if (estimatedStreaming <= now) return null;

		return {
			status,
			theatrical_date: theatricalDate > now ? theatricalDate : null,
			streaming_estimate: estimatedStreaming
		};
	}

	return null;
}

function tvReleaseInfo(
	status: string | undefined,
	nextEpisode: { air_date?: string; season_number?: number } | null | undefined,
	lastEpisodeSeason: number | undefined
): import('./types').ReleaseInfo | null {
	if (!status) return null;

	if (nextEpisode?.air_date) {
		// If the last aired episode is in the same season, this show is mid-season
		const currentlyAiring =
			lastEpisodeSeason != null &&
			nextEpisode.season_number != null &&
			lastEpisodeSeason === nextEpisode.season_number;
		return {
			status,
			next_season: nextEpisode.season_number ?? null,
			next_season_date: nextEpisode.air_date,
			currently_airing: currentlyAiring || undefined
		};
	}

	// Returning but no date announced yet
	if (status === 'Returning Series') {
		return { status };
	}

	return null;
}

// Strip providers whose names explicitly mention bundles or add-ons.
// "Amazon Channel" covers add-on tiers sold through Prime Video Channels
// (e.g. "Apple TV Amazon Channel", "Paramount+ Amazon Channel").
const BUNDLE_NAME_RE = /bundle|with hulu|with disney|with max|\bvia\b|amazon channel/i;

// provider_id reference (JustWatch / TMDB):
//   8   Netflix          15  Hulu           337  Disney+
//   350 Apple TV+        386 Peacock Premium 531  Paramount+
//   1899 Max

/**
 * Clean a raw flatrate provider list from TMDB/JustWatch:
 *  1. Drop entries whose name contains bundle/add-on wording.
 *  2. Deduplicate tier variants (e.g. "Peacock Premium" vs "Peacock Premium Plus").
 *
 * Disney+/Hulu pair disambiguation is handled upstream in augmentProviders(),
 * which has network/company context to determine which service is canonical.
 */
export function filterProviders(providers: Provider[]): Provider[] {
	const named = providers.filter((p) => !BUNDLE_NAME_RE.test(p.provider_name));

	// Deduplicate tier variants: if one name is a prefix of another
	// (e.g. "Peacock Premium" vs "Peacock Premium Plus"), keep only the base.
	return named.filter(
		(p) => !named.some((other) => other !== p && p.provider_name.startsWith(other.provider_name + ' '))
	);
}

function dedupTiers(providers: Provider[]): Provider[] {
	return providers.filter(
		(p) => !providers.some((other) => other !== p && p.provider_name.startsWith(other.provider_name + ' '))
	);
}

/**
 * Apply network-aware provider filtering on top of raw TMDB/JustWatch flatrate data.
 *
 * When Hulu (15) and Disney+ (337) both appear it means JustWatch is surfacing
 * bundle access — exactly one service is the canonical home.  We resolve it:
 *   • Disney+ native content (network 2739 or core Disney companies): strip Hulu.
 *   • Everything else (e.g. FX/Hulu originals like The Bear): strip Disney+.
 *
 * Also injects Disney+ for Disney-owned content that is missing from JustWatch
 * entirely (Disney pulled their catalogue from JustWatch).
 */
export function augmentProviders(
	providers: Provider[],
	networkIds: number[],
	companyIds: number[]
): Provider[] {
	const isDisneyPlus =
		networkIds.includes(DISNEY_PLUS_NETWORK_ID) ||
		companyIds.some((id) => DISNEY_PLUS_COMPANY_IDS.has(id));

	// Strip add-on / bundle-named entries
	const named = providers.filter((p) => !BUNDLE_NAME_RE.test(p.provider_name));
	const byId = new Map(named.map((p) => [p.provider_id, p]));

	// When both Hulu and Disney+ appear, exactly one is bundle contamination.
	// Network/company metadata determines which service actually hosts the content.
	if (byId.has(337) && byId.has(15)) {
		if (isDisneyPlus) {
			// Disney+ native: Hulu appears only because bundle subscribers can
			// access Disney+ via the Hulu interface. Strip Hulu.
			const result = named.filter((p) => p.provider_id !== 15);
			return dedupTiers(
				result.some((p) => p.provider_id === 337) ? result : [DISNEY_PLUS_PROVIDER, ...result]
			);
		} else {
			// Hulu-native (FX originals, etc.): Disney+ appears only because
			// Disney bundle subscribers can watch Hulu through the bundle. Strip Disney+.
			return dedupTiers(named.filter((p) => p.provider_id !== 337));
		}
	}

	// Disney+ content absent from JustWatch entirely (Disney removed their catalogue)
	if (isDisneyPlus) {
		const without15 = named.filter((p) => p.provider_id !== 15);
		return dedupTiers(
			without15.some((p) => p.provider_id === 337) ? without15 : [DISNEY_PLUS_PROVIDER, ...without15]
		);
	}

	// No Disney+/Hulu conflict: generic name filter + tier dedup
	return filterProviders(providers);
}

export async function getWatchProviders(
	id: number,
	mediaType: 'movie' | 'tv',
	apiKey: string
): Promise<{ providers: Provider[]; rentable: boolean }> {
	const res = await tmdbFetch(`${BASE}/${mediaType}/${id}/watch/providers?api_key=${apiKey}`);
	if (!res.ok) return { providers: [], rentable: false };
	const data = (await res.json()) as {
		results?: { US?: { flatrate?: Provider[]; rent?: Provider[]; buy?: Provider[] } };
	};
	const us = data.results?.US ?? {};
	const flatrate = us.flatrate ?? [];
	const rentable = (us.rent?.length ?? 0) > 0 || (us.buy?.length ?? 0) > 0;
	// Return raw flatrate — augmentProviders() applies all filtering with network context
	return { providers: flatrate, rentable };
}

export async function getMajorProviders(apiKey: string): Promise<Provider[]> {
	const res = await tmdbFetch(`${BASE}/watch/providers/movie?api_key=${apiKey}&watch_region=US`);
	if (!res.ok) return [];
	const data = (await res.json()) as {
		results?: Array<{ provider_id: number; provider_name: string; logo_path: string }>;
	};
	const all = data.results ?? [];
	const majorIds = [8, 337, 9, 1899, 15, 531, 386, 350]; // Netflix, Disney+, Prime, Max, Hulu, Paramount+, Peacock, Apple TV+
	const byId = new Map(all.map((p) => [p.provider_id, p]));
	const majors: Provider[] = [];
	for (const id of majorIds) {
		const p = byId.get(id);
		if (p) majors.push(p);
	}
	// Ensure Disney+ is in the list (it may be missing from TMDB's directory)
	if (!majors.some((p) => p.provider_id === 337)) majors.push(DISNEY_PLUS_PROVIDER);
	return majors;
}
