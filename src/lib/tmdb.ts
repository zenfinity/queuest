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

const DISNEY_PLUS_PROVIDER: Provider = {
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

export async function searchMulti(query: string, apiKey: string) {
	const res = await fetch(
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
}

export async function getRuntime(
	id: number,
	mediaType: 'movie' | 'tv',
	apiKey: string
): Promise<RuntimeResult> {
	const res = await fetch(`${BASE}/${mediaType}/${id}?api_key=${apiKey}&language=en-US`);
	if (!res.ok) return { runtime_minutes: null, seasons: [], networkIds: [], companyIds: [] };

	if (mediaType === 'movie') {
		const data = (await res.json()) as {
			runtime?: number;
			production_companies?: Array<{ id: number }>;
		};
		return {
			runtime_minutes: data.runtime ?? null,
			seasons: [],
			networkIds: [],
			companyIds: (data.production_companies ?? []).map((c) => c.id)
		};
	}

	const data = (await res.json()) as {
		number_of_episodes?: number;
		episode_run_time?: number[];
		last_episode_to_air?: { runtime?: number };
		seasons?: Array<{ season_number: number; episode_count: number; name: string }>;
		networks?: Array<{ id: number }>;
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

	return { runtime_minutes, seasons, networkIds, companyIds: [] };
}

// Strip providers whose names explicitly mention bundles or add-ons.
const BUNDLE_NAME_RE = /bundle|with hulu|with disney|with max|\bvia\b/i;

// When BOTH IDs in a pair appear together in the same flatrate list it means
// JustWatch is attributing the title to the whole bundle rather than the platform
// that actually hosts it.  Neither standalone logo is accurate, so we collapse
// the pair into a single honest "X / Y" entry using the first provider's logo.
//
// provider_id reference (JustWatch / TMDB):
//   8   Netflix          15  Hulu           337  Disney+
//   350 Apple TV+        386 Peacock Premium 531  Paramount+
//   1899 Max
const BUNDLE_PAIRS: Array<{ ids: [number, number]; name: string }> = [
	{ ids: [337, 15], name: 'Disney+ / Hulu' } // Disney Bundle (Disney+, Hulu, ESPN+)
];

/**
 * Clean a raw flatrate provider list from TMDB/JustWatch:
 *  1. Drop entries whose name contains bundle/add-on wording.
 *  2. Detect cross-contaminated bundle pairs (e.g. Disney+ AND Hulu both present)
 *     and collapse them into a single labelled entry so the user isn't shown a
 *     standalone logo that implies they only need that one subscription.
 *
 * Exported so it can also be applied to providers already stored in IndexedDB.
 */
export function filterProviders(providers: Provider[]): Provider[] {
	// Pass 1 — name-based filter
	const named = providers.filter((p) => !BUNDLE_NAME_RE.test(p.provider_name));

	// Pass 2 — pair-based bundle detection
	const byId = new Map(named.map((p) => [p.provider_id, p]));
	const drop = new Set<number>();
	const synthetic: Provider[] = [];

	for (const { ids, name } of BUNDLE_PAIRS) {
		const [a, b] = ids;
		if (byId.has(a) && byId.has(b)) {
			drop.add(a);
			drop.add(b);
			// Use the first provider's logo as the visual anchor for the bundle entry
			synthetic.push({ ...byId.get(a)!, provider_name: name });
		}
	}

	const clean = named.filter((p) => !drop.has(p.provider_id));
	return [...clean, ...synthetic];
}

/**
 * Apply Disney+ inference on top of the cleaned provider list.
 * If networks or production companies identify the title as Disney+ content,
 * inject the Disney+ provider and remove any erroneous Hulu entry (which
 * appears because Hulu bundle subscribers can access Disney+ content).
 */
export function augmentProviders(
	providers: Provider[],
	networkIds: number[],
	companyIds: number[]
): Provider[] {
	const filtered = filterProviders(providers);

	const isDisneyPlus =
		networkIds.includes(DISNEY_PLUS_NETWORK_ID) ||
		companyIds.some((id) => DISNEY_PLUS_COMPANY_IDS.has(id));

	if (!isDisneyPlus) return filtered;

	// Strip Hulu — it's bundle contamination for Disney+ content
	const withoutHulu = filtered.filter((p) => p.provider_id !== 15);

	// Inject Disney+ if not already there
	const alreadyHasDisney = withoutHulu.some((p) => p.provider_id === 337);
	return alreadyHasDisney ? withoutHulu : [DISNEY_PLUS_PROVIDER, ...withoutHulu];
}

export async function getWatchProviders(
	id: number,
	mediaType: 'movie' | 'tv',
	apiKey: string
): Promise<Provider[]> {
	const res = await fetch(`${BASE}/${mediaType}/${id}/watch/providers?api_key=${apiKey}`);
	if (!res.ok) return [];
	const data = (await res.json()) as {
		results?: { US?: { flatrate?: Provider[] } };
	};
	const flatrate = data.results?.US?.flatrate ?? [];
	return filterProviders(flatrate);
}
