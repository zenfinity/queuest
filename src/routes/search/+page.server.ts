import type { PageServerLoad } from './$types';
import type { SearchResult } from '$lib/types';
import { searchMulti, getWatchProviders, getRuntime, augmentProviders } from '$lib/tmdb';
import { env } from '$env/dynamic/private';

export const load: PageServerLoad = async ({ url }) => {
	const query = url.searchParams.get('q')?.trim() ?? '';
	if (!query) return { results: [] as SearchResult[], query: '' };

	const apiKey = env.TMDB_API_KEY ?? '';

	const raw = await searchMulti(query, apiKey);

	const results: SearchResult[] = await Promise.all(
		raw.slice(0, 8).map(async (item) => {
			const id = item.id as number;
			const mediaType = item.media_type as 'movie' | 'tv';
			const [rawProviders, { runtime_minutes, seasons, networkIds, companyIds, release }] = await Promise.all([
				getWatchProviders(id, mediaType, apiKey),
				getRuntime(id, mediaType, apiKey)
			]);
			const providers = augmentProviders(rawProviders, networkIds, companyIds);
			const dateStr = (item.release_date ?? item.first_air_date ?? '') as string;
			return {
				id,
				media_type: mediaType,
				title: (item.title ?? item.name) as string,
				poster_path: (item.poster_path as string) ?? null,
				overview: (item.overview as string) ?? '',
				year: dateStr.slice(0, 4) || null,
				providers,
				runtime_minutes,
				seasons,
				release
			};
		})
	);

	return { results, query };
};
