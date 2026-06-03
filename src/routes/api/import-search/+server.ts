import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { searchMulti, getWatchProviders, getRuntime, augmentProviders } from '$lib/tmdb';
import { env } from '$env/dynamic/private';
import type { WatchlistItem } from '$lib/types';

const BATCH_LIMIT = 30;
const CONCURRENCY = 5; // max simultaneous TMDB searches (each uses ~3 API calls)

// Worker-pool: runs fn over items with at most `limit` in-flight at once
async function pooled<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
	const out: R[] = new Array(items.length);
	let next = 0;
	await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
		while (next < items.length) {
			const i = next++;
			out[i] = await fn(items[i]);
		}
	}));
	return out;
}

export const POST: RequestHandler = async ({ request }) => {
	const apiKey = env.TMDB_API_KEY ?? '';
	const body = await request.json() as Array<{
		title: string;
		year: string | null;
		mediaTypeHint: 'movie' | 'tv' | 'auto';
	}>;

	if (!Array.isArray(body) || body.length > BATCH_LIMIT) {
		return new Response('Bad request', { status: 400 });
	}

	const results = await pooled(body, CONCURRENCY, async ({ title, year, mediaTypeHint }) => {
			try {
				const raw = await searchMulti(title, apiKey);
				if (!raw.length) return { title, result: null };

				const best = pickBestMatch(raw, title, year, mediaTypeHint);
				if (!best) return { title, result: null };

				const id = best.id as number;
				const mediaType = best.media_type as 'movie' | 'tv';

				const [{ providers: rawProviders, rentable }, runtimeData] = await Promise.all([
					getWatchProviders(id, mediaType, apiKey),
					getRuntime(id, mediaType, apiKey)
				]);

				const providers = augmentProviders(rawProviders, runtimeData.networkIds, runtimeData.companyIds);

				const result: Omit<WatchlistItem, 'id' | 'added_at' | 'watched_at'> = {
					tmdb_id: id,
					media_type: mediaType,
					title: (best.title ?? best.name) as string,
					poster_path: (best.poster_path as string | null) ?? null,
					overview: (best.overview as string | null) ?? null,
					providers,
					rentable: providers.length > 0 ? false : rentable,
					runtime_minutes: runtimeData.runtime_minutes,
					seasons: runtimeData.seasons,
					watched_seasons: [],
					current_season: null,
					current_episode: null,
					release: runtimeData.release,
					backdrop_path: runtimeData.backdrop_path,
					genres: runtimeData.genres,
					cast: runtimeData.cast,
					director: runtimeData.director,
					creator: runtimeData.creator,
				};

				return { title, result };
			} catch {
				return { title, result: null };
			}
	});

	return json(results);
};

function stripArticle(s: string): string {
	return s.replace(/^(the|a|an)\s+/i, '').trim();
}

function pickBestMatch(
	results: Record<string, unknown>[],
	title: string,
	year: string | null,
	hint: 'movie' | 'tv' | 'auto'
): Record<string, unknown> | null {
	const candidates = hint === 'auto'
		? results
		: results.filter((r) => r.media_type === hint);
	const pool = candidates.length ? candidates : results;

	const q = title.toLowerCase().trim();
	const qStripped = stripArticle(q);
	const yearN = year ? parseInt(year) : null;

	function rTitle(r: Record<string, unknown>): string {
		return ((r.title ?? r.name) as string ?? '').toLowerCase().trim();
	}
	function rYear(r: Record<string, unknown>): number | null {
		const y = parseInt(((r.release_date ?? r.first_air_date) as string ?? '').slice(0, 4));
		return isNaN(y) ? null : y;
	}

	// Try progressively looser match criteria
	const matchers: Array<(r: Record<string, unknown>) => boolean> = [
		// Exact title + exact year
		(r) => rTitle(r) === q && yearN !== null && rYear(r) === yearN,
		// Exact title + year ±1
		(r) => rTitle(r) === q && yearN !== null && rYear(r) !== null && Math.abs(rYear(r)! - yearN) <= 1,
		// Exact title, any year
		(r) => rTitle(r) === q,
		// Article-stripped title + exact year
		(r) => stripArticle(rTitle(r)) === qStripped && yearN !== null && rYear(r) === yearN,
		// Article-stripped title + year ±1
		(r) => stripArticle(rTitle(r)) === qStripped && yearN !== null && rYear(r) !== null && Math.abs(rYear(r)! - yearN) <= 1,
		// Article-stripped title, any year
		(r) => stripArticle(rTitle(r)) === qStripped,
	];

	for (const match of matchers) {
		const found = pool.find(match);
		if (found) return found;
	}

	return pool[0] ?? null;
}
