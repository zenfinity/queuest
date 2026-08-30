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
	1, // Lucasfilm Ltd.        → Star Wars, Indiana Jones
	2, // Walt Disney Pictures  → live-action Disney films
	3, // Pixar                 → Toy Story, Coco, etc.
	420, // Marvel Studios        → MCU
	6125 // Walt Disney Animation → Frozen, Moana, Encanto, etc.
]);

export const DISNEY_PLUS_PROVIDER: Provider = {
	provider_id: 337,
	provider_name: 'Disney Plus',
	logo_path: '/97yvRBw1GzX7fXprcF80er19ot.jpg'
};

// ── Apple TV+ / Amazon Prime Video disambiguation (#179) ───────────────────
// JustWatch sometimes lists Apple TV+ native content (e.g. Ted Lasso) under a
// plain, non-"Channel"-suffixed "Amazon Prime Video" entry alongside the real
// Apple TV entry — BUNDLE_NAME_RE can't catch it by name since it isn't named
// as an add-on/channel the way "Apple TV Amazon Channel" is. Apple TV+
// originals are reliably tagged with TMDB network id 2552 for TV; there's no
// equivalent reliable production-company signal for Apple's films (Apple is
// often absent from its own originals' production_companies on TMDB), so
// this only covers TV for now.
const APPLE_TV_NETWORK_ID = 2552;
const APPLE_TV_PROVIDER_ID = 350;
const AMAZON_PRIME_VIDEO_PROVIDER_ID = 9;

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

// How many search results +page.server.ts hydrates and shows — exported so
// searchMulti (below) can use the same number to decide whether page 1 alone
// already has enough to fill the list.
export const SEARCH_RESULTS_CAP = 8;

interface MultiSearchPage {
	results: Record<string, unknown>[];
	totalPages: number;
}

async function fetchMultiSearchPage(
	query: string,
	apiKey: string,
	page: number
): Promise<MultiSearchPage> {
	const res = await tmdbFetch(
		`${BASE}/search/multi?query=${encodeURIComponent(query)}&api_key=${apiKey}&include_adult=false&language=en-US&page=${page}`
	);
	if (!res.ok) return { results: [], totalPages: 1 };
	const data = (await res.json()) as { results?: Record<string, unknown>[]; total_pages?: number };
	return { results: data.results ?? [], totalPages: data.total_pages ?? 1 };
}

function toMovieOrTv(results: Record<string, unknown>[]): Record<string, unknown>[] {
	return results.filter((r) => r.media_type === 'movie' || r.media_type === 'tv');
}

/**
 * TMDB's relevance ranking weighs a literal title-substring match over an
 * alternate-title match, regardless of popularity — a well-known title whose
 * only textual match is an AKA can land on page 2 even at far higher
 * popularity than everything on page 1. "Nausicaä of the Valley of the Wind"
 * is filed under its disowned English dub title, "Warriors of the Wind" —
 * searching "nausica" only matches it through a US alternate title, which
 * pushes it to page 2 behind a dozen barely-popular, coincidentally-named
 * people (#200).
 *
 * Page 2 is only fetched when page 1 didn't already fill the results list —
 * when it did, TMDB's own ordering is left untouched rather than
 * second-guessed. A blanket popularity re-sort was tried and rejected: for an
 * ambiguous single-word query like "batman", it promoted an obscure,
 * freakishly-viral entry (popularity 116 vs. ~35 for the flagship TV show)
 * above everything TMDB itself ranked first. Popularity is only trustworthy
 * here as a tiebreaker among page 2's already-lower-confidence matches, not
 * as an override of page 1's relevance ranking.
 */
export async function searchMulti(query: string, apiKey: string) {
	const first = await fetchMultiSearchPage(query, apiKey, 1);
	const primary = toMovieOrTv(first.results);

	if (primary.length < SEARCH_RESULTS_CAP && first.totalPages > 1) {
		const second = await fetchMultiSearchPage(query, apiKey, 2);
		const extras = toMovieOrTv(second.results).sort(
			(a, b) => (Number(b.popularity) || 0) - (Number(a.popularity) || 0)
		);
		primary.push(...extras);
	}

	return primary;
}

// ── Cast/crew search (#62) ──────────────────────────────────────────────────

export interface PersonMatch {
	id: number;
	name: string;
	popularity: number;
}

/** Top hit from TMDB's person search — the caller decides whether it's a
 * confident-enough match to act on (see MIN_PERSON_POPULARITY in
 * add/+page.server.ts). */
export async function searchPerson(query: string, apiKey: string): Promise<PersonMatch | null> {
	const res = await tmdbFetch(
		`${BASE}/search/person?query=${encodeURIComponent(query)}&api_key=${apiKey}&include_adult=false&language=en-US`
	);
	if (!res.ok) return null;
	const data = (await res.json()) as { results?: PersonMatch[] };
	return data.results?.[0] ?? null;
}

/**
 * A person's movie+TV credits, deduped (someone can appear in both `cast`
 * and `crew` for the same title) and capped by popularity — not batch-fetched
 * in full, since a prolific actor/director's combined credits can run into
 * the hundreds and each one still needs its own providers+runtime call
 * downstream (same amplification concern as #66/#73). Items come back in the
 * same raw shape searchMulti() results do, so callers can hydrate them with
 * the exact same code path.
 */
export async function getPersonCombinedCredits(
	personId: number,
	apiKey: string,
	limit: number
): Promise<Record<string, unknown>[]> {
	const res = await tmdbFetch(
		`${BASE}/person/${personId}/combined_credits?api_key=${apiKey}&language=en-US`
	);
	if (!res.ok) return [];
	const data = (await res.json()) as {
		cast?: Record<string, unknown>[];
		crew?: Record<string, unknown>[];
	};
	const all = [...(data.cast ?? []), ...(data.crew ?? [])].filter(
		(c) => c.media_type === 'movie' || c.media_type === 'tv'
	);

	const byKey = new Map<string, Record<string, unknown>>();
	for (const credit of all) {
		const key = `${credit.media_type}:${credit.id}`;
		const existing = byKey.get(key);
		const popularity = (credit.popularity as number) ?? 0;
		if (!existing || popularity > ((existing.popularity as number) ?? 0)) {
			byKey.set(key, credit);
		}
	}

	return [...byKey.values()]
		.sort((a, b) => ((b.popularity as number) ?? 0) - ((a.popularity as number) ?? 0))
		.slice(0, limit);
}

/**
 * Resolves a TMDB person id to their IMDb id, for linking a cast/director
 * name to their IMDb page (#180). Deliberately its own tiny call rather than
 * something batch-fetched alongside a title's own credits — resolving all
 * ~9 cast+director ids on every search result would multiply this app's
 * TMDB call volume per result (the same amplification concern as #66/#73),
 * for links most of which nobody will ever click. The caller
 * (/api/person-external-id) is responsible for doing this lazily and for
 * caching the result, since a person's imdb_id essentially never changes.
 */
export async function getPersonExternalId(
	personId: number,
	apiKey: string
): Promise<string | null> {
	const res = await tmdbFetch(`${BASE}/person/${personId}/external_ids?api_key=${apiKey}`);
	if (!res.ok) return null;
	const data = (await res.json()) as { imdb_id?: string | null };
	return data.imdb_id ?? null;
}

interface RuntimeResult {
	runtime_minutes: number | null;
	seasons: SeasonSummary[];
	/** Network IDs from the TMDB response (TV only; empty for movies) */
	networkIds: number[];
	/** Production company IDs from the TMDB response (movies; empty for TV) */
	companyIds: number[];
	release: import('./types').ReleaseInfo | null;
	genres: string[];
	cast: import('./types').CastMember[];
	director: string | null;
	director_id: number | null;
	creator: string | null;
	/** From TMDB's external_ids, appended to the same title request — cheap,
	 * no extra call. Powers a "View on IMDb" link on the detail panel. (#142) */
	imdb_id: string | null;
}

export async function getRuntime(
	id: number,
	mediaType: 'movie' | 'tv',
	apiKey: string
): Promise<RuntimeResult> {
	// Movies: append release_dates + credits + external_ids in one call; TV: credits + external_ids
	const qs =
		mediaType === 'movie'
			? '&append_to_response=release_dates,credits,external_ids'
			: '&append_to_response=credits,external_ids';
	const res = await tmdbFetch(`${BASE}/${mediaType}/${id}?api_key=${apiKey}&language=en-US${qs}`);
	if (!res.ok)
		return {
			runtime_minutes: null,
			seasons: [],
			networkIds: [],
			companyIds: [],
			release: null,
			genres: [],
			cast: [],
			director: null,
			director_id: null,
			creator: null,
			imdb_id: null
		};

	if (mediaType === 'movie') {
		const data = (await res.json()) as {
			runtime?: number;
			status?: string;
			release_date?: string;
			genres?: Array<{ id: number; name: string }>;
			production_companies?: Array<{ id: number }>;
			release_dates?: {
				results?: Array<{
					iso_3166_1: string;
					release_dates: Array<{ type: number; release_date: string }>;
				}>;
			};
			credits?: {
				cast?: Array<{
					id: number;
					name: string;
					character: string;
					profile_path?: string | null;
					order: number;
				}>;
				crew?: Array<{ id: number; name: string; job: string }>;
			};
			external_ids?: { imdb_id?: string | null };
		};

		const companyIds = (data.production_companies ?? []).map((c) => c.id);
		const release = movieReleaseInfo(
			data.status,
			data.release_date,
			data.release_dates?.results,
			companyIds
		);
		const cast = (data.credits?.cast ?? []).slice(0, 8).map((c) => ({
			id: c.id,
			name: c.name,
			character: c.character,
			profile_path: c.profile_path ?? null
		}));
		const directorCredit = data.credits?.crew?.find((c) => c.job === 'Director') ?? null;

		return {
			runtime_minutes: data.runtime ?? null,
			seasons: [],
			networkIds: [],
			companyIds,
			release,
			genres: (data.genres ?? []).map((g) => g.name),
			cast,
			director: directorCredit?.name ?? null,
			director_id: directorCredit?.id ?? null,
			creator: null,
			imdb_id: data.external_ids?.imdb_id ?? null
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
		genres?: Array<{ id: number; name: string }>;
		created_by?: Array<{ name: string }>;
		credits?: {
			cast?: Array<{
				id: number;
				name: string;
				character: string;
				profile_path?: string | null;
				order: number;
			}>;
		};
		external_ids?: { imdb_id?: string | null };
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
	const release = tvReleaseInfo(
		data.status,
		data.next_episode_to_air,
		data.last_episode_to_air?.season_number
	);
	const cast = (data.credits?.cast ?? []).slice(0, 8).map((c) => ({
		id: c.id,
		name: c.name,
		character: c.character,
		profile_path: c.profile_path ?? null
	}));
	// created_by has no per-person id worth capturing here — creator isn't
	// linkable anyway (see the director_id/creator note on WatchlistItem, #180).
	const creator = (data.created_by ?? []).map((c) => c.name).join(', ') || null;

	return {
		runtime_minutes,
		seasons,
		networkIds,
		companyIds: [],
		release,
		genres: (data.genres ?? []).map((g) => g.name),
		cast,
		director: null,
		director_id: null,
		creator,
		imdb_id: data.external_ids?.imdb_id ?? null
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
	releaseDates:
		| Array<{ iso_3166_1: string; release_dates: Array<{ type: number; release_date: string }> }>
		| undefined,
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
 * Deduplicate tier variants: if one name is a prefix of another (e.g.
 * "Peacock Premium" vs "Peacock Premium Plus"), keep only the base.
 */
function dedupTiers(providers: Provider[]): Provider[] {
	return providers.filter(
		(p) =>
			!providers.some(
				(other) => other !== p && p.provider_name.startsWith(other.provider_name + ' ')
			)
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
	const isAppleTvPlus = networkIds.includes(APPLE_TV_NETWORK_ID);

	// Strip add-on / bundle-named entries
	let named = providers.filter((p) => !BUNDLE_NAME_RE.test(p.provider_name));

	// Apple TV+ native content: a plain "Amazon Prime Video" entry alongside
	// the real Apple TV one is bundle contamination that BUNDLE_NAME_RE can't
	// catch by name — see the comment on APPLE_TV_NETWORK_ID above. Strip by
	// name prefix, not just the base provider_id, so tier variants (e.g.
	// "Amazon Prime Video with Ads") don't survive as an orphaned dedupTiers
	// entry once their base tier is gone.
	if (
		isAppleTvPlus &&
		named.some((p) => p.provider_id === APPLE_TV_PROVIDER_ID) &&
		named.some((p) => p.provider_id === AMAZON_PRIME_VIDEO_PROVIDER_ID)
	) {
		named = named.filter((p) => !p.provider_name.startsWith('Amazon Prime Video'));
	}

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
			without15.some((p) => p.provider_id === 337)
				? without15
				: [DISNEY_PLUS_PROVIDER, ...without15]
		);
	}

	// No Disney+/Hulu conflict: tier dedup on top of `named` (already has the
	// bundle-name filter and any Apple TV+/Amazon fix applied above).
	return dedupTiers(named);
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
