import { json } from '@sveltejs/kit';
import { hydrateMedia, type HydratedMedia } from '$lib/tmdb';
import { env } from '$env/dynamic/private';
import { apiError, checkSameOrigin } from '$lib/server/api';
import type { RequestHandler } from './$types';

const MAX_ITEMS = 100;

export interface RefreshResult extends HydratedMedia {
	id: number;
}

export const POST: RequestHandler = async ({ request }) => {
	const originError = checkSameOrigin(request);
	if (originError) return originError;

	const apiKey = env.TMDB_API_KEY;
	if (!apiKey) return apiError(503, 'TMDB API key not configured');

	let items: unknown;
	try {
		items = await request.json();
	} catch {
		return apiError(400, 'Invalid JSON');
	}

	if (!Array.isArray(items)) {
		return apiError(400, 'Expected an array of items');
	}
	if (items.length === 0) return json([] as RefreshResult[]);
	if (items.length > MAX_ITEMS) {
		return apiError(400, `Too many items (max ${MAX_ITEMS})`);
	}

	const batch = items.filter(
		(r) =>
			Number.isInteger(r?.id) &&
			Number.isInteger(r?.tmdb_id) &&
			(r?.media_type === 'movie' || r?.media_type === 'tv')
	);

	const results: RefreshResult[] = [];
	await Promise.all(
		batch.map(async ({ id, tmdb_id, media_type }) => {
			try {
				const media = await hydrateMedia(tmdb_id, media_type, apiKey);
				results.push({ id, ...media });
			} catch {
				// Omit failed items; never return empty-but-successful records that would overwrite good data
			}
		})
	);

	return json(results);
};
