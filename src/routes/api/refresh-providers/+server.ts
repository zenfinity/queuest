import { json, error } from '@sveltejs/kit';
import { getWatchProviders, getRuntime, augmentProviders } from '$lib/tmdb';
import { env } from '$env/dynamic/private';
import type { RequestHandler } from './$types';
import type { Provider, ReleaseInfo, CastMember } from '$lib/types';

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
	// Same-origin guard
	const fetchSite = request.headers.get('Sec-Fetch-Site');
	if (fetchSite && fetchSite !== 'same-origin') {
		throw error(403, 'Forbidden');
	}

	const apiKey = env.TMDB_API_KEY ?? '';
	if (!apiKey) throw error(503, 'TMDB API key not configured');

	const items = (await request.json()) as RefreshRequest[];
	if (!Array.isArray(items) || items.length === 0) {
		return json([] as RefreshResult[]);
	}

	// Validate and cap batch
	const valid = items.filter(
		(r) =>
			Number.isInteger(r?.id) &&
			Number.isInteger(r?.tmdb_id) &&
			(r?.media_type === 'movie' || r?.media_type === 'tv')
	);
	const batch = valid.slice(0, 100);

	const results: RefreshResult[] = await Promise.all(
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
				return {
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
				};
			} catch {
				// Return empty rather than failing the whole batch
				return {
					id,
					providers: [],
					rentable: false,
					release: null,
					seasons: [],
					runtime_minutes: null,
					genres: [],
					cast: [],
					director: null,
					creator: null
				};
			}
		})
	);

	return json(results);
};
