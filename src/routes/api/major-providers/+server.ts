import { json } from '@sveltejs/kit';
import { getMajorProviders } from '$lib/tmdb';
import { env } from '$env/dynamic/private';
import { apiError, checkSameOrigin } from '$lib/server/api';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ request }) => {
	const originError = checkSameOrigin(request);
	if (originError) return originError;

	const apiKey = env.TMDB_API_KEY ?? '';
	if (!apiKey) return apiError(503, 'TMDB API key not configured');

	try {
		const providers = await getMajorProviders(apiKey);
		return json(providers);
	} catch {
		return apiError(502, 'Could not reach TMDB. Please try again.');
	}
};
