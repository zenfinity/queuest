import type { Provider } from './types';

export const TMDB_IMG = 'https://image.tmdb.org/t/p';
const BASE = 'https://api.themoviedb.org/3';

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
