import { json } from '@sveltejs/kit';
import { getWatchProviders, getRuntime, augmentProviders } from '$lib/tmdb';
import { env } from '$env/dynamic/private';
import { apiError, checkSameOrigin } from '$lib/server/api';
import type { RequestHandler } from './$types';
import type { Provider, ReleaseInfo, CastMember } from '$lib/types';

const MAX_ITEMS = 100;

interface RefreshRequest {
	id: number;
	tmdb_id: number;
	media_type: 'movie' | 'tv';
}

interface RefreshResult {
	id: number;
	providers: Provider[];
	rentable: boolean;
	release: ReleaseInfo | null;
	seasons: {
		season_number: number;
		episode_count: number;
		name: string;
		runtime_minutes: number;
	}[];
	runtime_minutes: number | null;
	genres: string[];
	cast: CastMember[];
	director: string | null;
	creator: string | null;
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
				const [
					{ providers: rawProviders, rentable },
					{
						runtime_minutes,
						seasons,
						networkIds,
						companyIds,
						release,
						genres,
						cast,
						director,
						creator
					}
				] = await Promise.all([
					getWatchProviders(tmdb_id, media_type, apiKey),
					getRuntime(tmdb_id, media_type, apiKey)
				]);
				const providers = augmentProviders(rawProviders, networkIds, companyIds);
				results.push({
					id,
					providers,
					rentable: providers.length > 0 ? false : rentable,
					release: release ?? null,
					seasons,
					runtime_minutes,
					genres,
					cast,
					director,
					creator
				});
			} catch {
				// Omit failed items; never return empty-but-successful records that would overwrite good data
			}
		})
	);

	return json(results);
};
