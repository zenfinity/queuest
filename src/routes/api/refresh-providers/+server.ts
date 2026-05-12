import { json, error } from '@sveltejs/kit';
import { getWatchProviders, getRuntime, augmentProviders } from '$lib/tmdb';
import { env } from '$env/dynamic/private';
import type { RequestHandler } from './$types';
import type { Provider, ReleaseInfo } from '$lib/types';

interface RefreshRequest {
	id: number;
	tmdb_id: number;
	media_type: 'movie' | 'tv';
}

interface RefreshResult {
	id: number;
	providers: Provider[];
	release: ReleaseInfo | null;
}

export const POST: RequestHandler = async ({ request }) => {
	const apiKey = env.TMDB_API_KEY ?? '';
	if (!apiKey) throw error(503, 'TMDB API key not configured');

	const items = (await request.json()) as RefreshRequest[];
	if (!Array.isArray(items) || items.length === 0) {
		return json([] as RefreshResult[]);
	}

	// Cap to avoid runaway requests
	const batch = items.slice(0, 100);

	const results: RefreshResult[] = await Promise.all(
		batch.map(async ({ id, tmdb_id, media_type }) => {
			try {
				const [rawProviders, { networkIds, companyIds, release }] = await Promise.all([
					getWatchProviders(tmdb_id, media_type, apiKey),
					getRuntime(tmdb_id, media_type, apiKey)
				]);
				const providers = augmentProviders(rawProviders, networkIds, companyIds);
				return { id, providers, release: release ?? null };
			} catch {
				// Return empty rather than failing the whole batch
				return { id, providers: [], release: null };
			}
		})
	);

	return json(results);
};
