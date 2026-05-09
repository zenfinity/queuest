import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getWatchProviders, getRuntime } from '$lib/tmdb';
import { env } from '$env/dynamic/private';

export const POST: RequestHandler = async ({ request, platform }) => {
	const db = platform?.env?.DB;
	const apiKey = env.TMDB_API_KEY ?? '';
	if (!db) throw error(503, 'Database not available');

	const body = (await request.json()) as {
		tmdb_id: number;
		media_type: 'movie' | 'tv';
		title: string;
		poster_path: string | null;
		overview: string;
	};

	const [providers, runtime_minutes] = await Promise.all([
		getWatchProviders(body.tmdb_id, body.media_type, apiKey),
		getRuntime(body.tmdb_id, body.media_type, apiKey)
	]);

	await db
		.prepare(
			`INSERT OR IGNORE INTO watchlist (tmdb_id, media_type, title, poster_path, overview, providers, runtime_minutes)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
		)
		.bind(
			body.tmdb_id,
			body.media_type,
			body.title,
			body.poster_path,
			body.overview,
			JSON.stringify(providers),
			runtime_minutes
		)
		.run();

	return json({ success: true });
};
