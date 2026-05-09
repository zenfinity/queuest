import type { PageServerLoad } from './$types';
import type { WatchlistItem } from '$lib/types';

export const load: PageServerLoad = async ({ platform }) => {
	const db = platform?.env?.DB;
	if (!db) return { items: [] as WatchlistItem[] };

	const result = await db
		.prepare('SELECT * FROM watchlist ORDER BY added_at DESC')
		.all<Record<string, unknown>>();

	const items: WatchlistItem[] = result.results.map((row) => ({
		id: row.id as number,
		tmdb_id: row.tmdb_id as number,
		media_type: row.media_type as 'movie' | 'tv',
		title: row.title as string,
		poster_path: (row.poster_path as string) ?? null,
		overview: (row.overview as string) ?? null,
		providers: JSON.parse((row.providers as string) ?? '[]'),
		added_at: row.added_at as string,
		watched_at: (row.watched_at as string) ?? null
	}));

	return { items };
};
