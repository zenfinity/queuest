import type { Provider } from './types';

export const TMDB_IMG = 'https://image.tmdb.org/t/p';
const BASE = 'https://api.themoviedb.org/3';

export function formatRuntime(minutes: number, mediaType: 'movie' | 'tv'): string {
	if (mediaType === 'movie') {
		const h = Math.floor(minutes / 60);
		const m = minutes % 60;
		return h > 0 ? `${h}h ${m}m` : `${m}m`;
	} else {
		const h = Math.round(minutes / 60);
		return h >= 1 ? `~${h}h total` : `~${minutes}m total`;
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

export async function getRuntime(
	id: number,
	mediaType: 'movie' | 'tv',
	apiKey: string
): Promise<number | null> {
	const res = await fetch(`${BASE}/${mediaType}/${id}?api_key=${apiKey}&language=en-US`);
	if (!res.ok) return null;

	if (mediaType === 'movie') {
		const data = (await res.json()) as { runtime?: number };
		return data.runtime ?? null;
	} else {
		const data = (await res.json()) as {
			number_of_episodes?: number;
			episode_run_time?: number[];
			last_episode_to_air?: { runtime?: number };
		};
		const eps = data.number_of_episodes ?? 0;
		const avgRuntime = data.episode_run_time?.length
			? data.episode_run_time.reduce((a, b) => a + b, 0) / data.episode_run_time.length
			: (data.last_episode_to_air?.runtime ?? 0);
		return eps && avgRuntime ? Math.round(eps * avgRuntime) : null;
	}
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
	return data.results?.US?.flatrate ?? [];
}
