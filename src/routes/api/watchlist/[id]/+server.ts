import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const DELETE: RequestHandler = async ({ params, platform }) => {
	const db = platform?.env?.DB;
	if (!db) throw error(503, 'Database not available');

	await db.prepare('DELETE FROM watchlist WHERE id = ?').bind(params.id).run();
	return json({ success: true });
};

export const PATCH: RequestHandler = async ({ params, request, platform }) => {
	const db = platform?.env?.DB;
	if (!db) throw error(503, 'Database not available');

	const { watched } = (await request.json()) as { watched: boolean };
	const watchedAt = watched ? new Date().toISOString() : null;

	await db
		.prepare('UPDATE watchlist SET watched_at = ? WHERE id = ?')
		.bind(watchedAt, params.id)
		.run();

	return json({ success: true });
};
