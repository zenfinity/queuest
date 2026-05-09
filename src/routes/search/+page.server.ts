import type { PageServerLoad } from './$types';
import type { SearchResult } from '$lib/types';
import { searchMulti, getWatchProviders } from '$lib/tmdb';
import { env } from '$env/dynamic/private';

export const load: PageServerLoad = async ({ url }) => {
	const query = url.searchParams.get('q')?.trim() ?? '';
	if (!query) return { results: [] as SearchResult[], query: '' };

	const apiKey = env.TMDB_API_KEY ?? '';

	const raw = await searchMulti(query, apiKey);

	const results: SearchResult[] = await Promise.all(
		raw.slice(0, 8).map(async (item) => {
			const providers = await getWatchProviders(
				item.id as number,
				item.media_type as 'movie' | 'tv',
				apiKey
			);
			const dateStr = (item.release_date ?? item.first_air_date ?? '') as string;
			return {
				id: item.id as number,
				media_type: item.media_type as 'movie' | 'tv',
				title: (item.title ?? item.name) as string,
				poster_path: (item.poster_path as string) ?? null,
				overview: (item.overview as string) ?? '',
				year: dateStr.slice(0, 4) || null,
				providers
			};
		})
	);

	return { results, query };
};
