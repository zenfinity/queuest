import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { searchMulti } from '$lib/tmdb';
import { env } from '$env/dynamic/private';
import { apiError, checkSameOrigin } from '$lib/server/api';
import { checkRateLimit } from '$lib/server/rate-limit';

export interface SearchSuggestion {
	id: number;
	media_type: 'movie' | 'tv';
	title: string;
	poster_path: string | null;
	year: string | null;
}

const SUGGESTION_LIMIT = 5;
// Debounced typing is materially more request volume than one search per
// submit (#63) — same reasoning as the collection-invite preview endpoint.
const RATE_LIMIT = { max: 60, windowSeconds: 60 };

/**
 * Cheap sibling to the full Add-page search (#63): raw title/poster/year
 * only, no providers/runtime hydration — one TMDB call per request instead
 * of the up-to-16 the full search does, since this fires on every debounced
 * keystroke rather than once per submit.
 */
export const GET: RequestHandler = async ({ url, request, platform, getClientAddress }) => {
	const originError = checkSameOrigin(request);
	if (originError) return originError;

	const query = url.searchParams.get('q')?.trim() ?? '';
	if (!query) return json([] as SearchSuggestion[]);

	const apiKey = env.TMDB_API_KEY;
	if (!apiKey) return apiError(503, 'Search not configured');

	const kv = platform?.env?.SHARE_KV;
	if (!kv) return apiError(503, 'Search not configured');

	const allowed = await checkRateLimit(
		kv,
		`search-suggest:${getClientAddress()}`,
		RATE_LIMIT.max,
		RATE_LIMIT.windowSeconds
	);
	if (!allowed) return apiError(429, 'Too many requests');

	const raw = await searchMulti(query, apiKey);
	const suggestions: SearchSuggestion[] = raw.slice(0, SUGGESTION_LIMIT).map((item) => {
		const dateStr = (item.release_date ?? item.first_air_date ?? '') as string;
		return {
			id: item.id as number,
			media_type: item.media_type as 'movie' | 'tv',
			title: (item.title ?? item.name) as string,
			poster_path: (item.poster_path as string) ?? null,
			year: dateStr.slice(0, 4) || null
		};
	});

	return json(suggestions);
};
