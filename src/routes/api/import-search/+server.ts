import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { searchMulti, getWatchProviders, getRuntime, augmentProviders } from '$lib/tmdb';
import { env } from '$env/dynamic/private';
import type { WatchlistItem } from '$lib/types';

const BATCH_LIMIT = 30;

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

	const results = await Promise.all(
		body.map(async ({ title, year, mediaTypeHint }) => {
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
		})
	);

	return json(results);
};

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

	const q = title.toLowerCase();

	if (year) {
		const exact = pool.find((r) => {
			const t = ((r.title ?? r.name) as string ?? '').toLowerCase();
			const y = ((r.release_date ?? r.first_air_date) as string ?? '').slice(0, 4);
			return t === q && y === year;
		});
		if (exact) return exact;
	}

	const titleMatch = pool.find((r) => ((r.title ?? r.name) as string ?? '').toLowerCase() === q);
	return titleMatch ?? pool[0] ?? null;
}
