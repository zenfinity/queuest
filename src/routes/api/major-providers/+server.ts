import { json } from '@sveltejs/kit';
import { getMajorProviders } from '$lib/tmdb';
import { env } from '$env/dynamic/private';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => {
	const apiKey = env.TMDB_API_KEY ?? '';
	if (!apiKey) return json([], { status: 503 });

	try {
		const providers = await getMajorProviders(apiKey);
		return json(providers);
	} catch {
		return json([], { status: 500 });
	}
};
