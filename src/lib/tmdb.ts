import type { Provider, SeasonSummary } from './types';

export const TMDB_IMG = 'https://image.tmdb.org/t/p';
const BASE = 'https://api.themoviedb.org/3';

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
}

export async function getRuntime(
	id: number,
	mediaType: 'movie' | 'tv',
	apiKey: string
): Promise<RuntimeResult> {
	const res = await fetch(`${BASE}/${mediaType}/${id}?api_key=${apiKey}&language=en-US`);
	if (!res.ok) return { runtime_minutes: null, seasons: [] };

	if (mediaType === 'movie') {
		const data = (await res.json()) as { runtime?: number };
		return { runtime_minutes: data.runtime ?? null, seasons: [] };
	}

	const data = (await res.json()) as {
		number_of_episodes?: number;
		episode_run_time?: number[];
		last_episode_to_air?: { runtime?: number };
		seasons?: Array<{ season_number: number; episode_count: number; name: string }>;
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

	return { runtime_minutes, seasons };
}

// Bundle/add-on provider names from TMDB that require a separate subscription
// to access — e.g. "Hulu (Disney+ Bundle)", "Disney+ (with Hulu)", "Max via Prime".
// Showing their logo is misleading because you can't subscribe directly.
const BUNDLE_PATTERNS = /bundle|with hulu|with disney|with max|\bvia\b/i;

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
	// Strip bundle/channel entries so only standalone subscriptions are shown
	return flatrate.filter((p) => !BUNDLE_PATTERNS.test(p.provider_name));
}
