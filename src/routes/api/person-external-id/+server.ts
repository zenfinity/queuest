import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getPersonExternalId } from '$lib/tmdb';
import { env } from '$env/dynamic/private';
import { apiError, checkSameOrigin } from '$lib/server/api';
import { checkRateLimit } from '$lib/server/rate-limit';

// A person's imdb_id is effectively permanent — cache aggressively so
// re-opening the same cast member's link doesn't cost another TMDB call.
const CACHE_CONTROL = 'public, max-age=2592000, immutable'; // 30 days

// Click-triggered (#180), not debounced typing — a much lower ceiling than
// the per-keystroke search-suggestions endpoint is enough to stop scripted
// abuse without getting in the way of anyone actually browsing cast lists.
const RATE_LIMIT = { max: 30, windowSeconds: 60 };

/**
 * Resolves a TMDB person id to their IMDb id, so the detail panel can link a
 * cast or director name to their IMDb page (#180). Deliberately lazy and
 * per-person rather than batch-resolved alongside a title's own credits —
 * see getPersonExternalId in tmdb.ts for why.
 */
export const GET: RequestHandler = async ({ url, request, platform, getClientAddress }) => {
	const originError = checkSameOrigin(request);
	if (originError) return originError;

	const idParam = url.searchParams.get('id');
	const personId = idParam ? Number(idParam) : NaN;
	if (!Number.isInteger(personId) || personId <= 0) {
		return apiError(400, 'A valid person id is required');
	}

	const apiKey = env.TMDB_API_KEY;
	if (!apiKey) return apiError(503, 'Search not configured');

	const kv = platform?.env?.SHARE_KV;
	if (!kv) return apiError(503, 'Search not configured');

	const allowed = await checkRateLimit(
		kv,
		`person-external-id:${getClientAddress()}`,
		RATE_LIMIT.max,
		RATE_LIMIT.windowSeconds
	);
	if (!allowed) return apiError(429, 'Too many requests');

	try {
		const imdb_id = await getPersonExternalId(personId, apiKey);
		return json({ imdb_id }, { headers: { 'Cache-Control': CACHE_CONTROL } });
	} catch {
		return apiError(502, 'Could not reach TMDB. Please try again.');
	}
};
