import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getWatchProviders } from '$lib/tmdb';

export const POST: RequestHandler = async ({ request, platform }) => {
	const db = platform?.env?.DB;
	const apiKey = platform?.env?.TMDB_API_KEY ?? '';
	if (!db) throw error(503, 'Database not available');

	const body = (await request.json()) as {
		tmdb_id: number;
		media_type: 'movie' | 'tv';
		title: string;
		poster_path: string | null;
		overview: string;
	};

	const providers = await getWatchProviders(body.tmdb_id, body.media_type, apiKey);

	await db
		.prepare(
			`INSERT OR IGNORE INTO watchlist (tmdb_id, media_type, title, poster_path, overview, providers)
       VALUES (?, ?, ?, ?, ?, ?)`
		)
		.bind(
			body.tmdb_id,
			body.media_type,
			body.title,
			body.poster_path,
			body.overview,
			JSON.stringify(providers)
		)
		.run();

	return json({ success: true });
};
