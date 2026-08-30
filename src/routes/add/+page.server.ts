import type { PageServerLoad } from './$types';
import type { SearchResult } from '$lib/types';
import {
	searchMulti,
	searchPerson,
	getPersonCombinedCredits,
	getWatchProviders,
	getRuntime,
	augmentProviders,
	SEARCH_RESULTS_CAP
} from '$lib/tmdb';
import { env } from '$env/dynamic/private';

// How many of a matched person's credits to hydrate — each one costs the same
// two TMDB calls a title search result does, so this is capped well below
// what combined_credits can return for a prolific actor/director (#62).
const PERSON_CREDITS_CAP = 6;
// TMDB's person search returns loose name matches, not just close ones — a
// low-popularity hit is more likely noise than something worth surfacing as
// "titles with this person" above the actual search results. Heuristic, not
// exact science; tune against real queries if it proves wrong in practice.
const MIN_PERSON_POPULARITY = 5;

export interface PersonResults {
	name: string;
	results: SearchResult[];
}

async function hydrate(item: Record<string, unknown>, apiKey: string): Promise<SearchResult> {
	const id = item.id as number;
	const mediaType = item.media_type as 'movie' | 'tv';
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
			director_id,
			creator,
			imdb_id
		}
	] = await Promise.all([
		getWatchProviders(id, mediaType, apiKey),
		getRuntime(id, mediaType, apiKey)
	]);
	const providers = augmentProviders(rawProviders, networkIds, companyIds);
	const dateStr = (item.release_date ?? item.first_air_date ?? '') as string;
	return {
		id,
		media_type: mediaType,
		title: (item.title ?? item.name) as string,
		poster_path: (item.poster_path as string) ?? null,
		overview: (item.overview as string) ?? '',
		year: dateStr.slice(0, 4) || null,
		providers,
		rentable: providers.length > 0 ? false : rentable,
		runtime_minutes,
		seasons,
		release,
		genres,
		cast,
		director,
		director_id,
		creator,
		imdb_id
	};
}

export const load: PageServerLoad = async ({ url }) => {
	const query = url.searchParams.get('q')?.trim() ?? '';
	if (!query) return { results: [] as SearchResult[], query: '', error: null, person: null };

	const apiKey = env.TMDB_API_KEY;
	if (!apiKey) {
		return {
			results: [] as SearchResult[],
			query,
			error: 'Search not configured',
			person: null as PersonResults | null
		};
	}

	try {
		const [raw, personMatch] = await Promise.all([
			searchMulti(query, apiKey),
			searchPerson(query, apiKey)
		]);

		const results = await Promise.all(
			raw.slice(0, SEARCH_RESULTS_CAP).map((item) => hydrate(item, apiKey))
		);

		let person: PersonResults | null = null;
		if (personMatch && personMatch.popularity >= MIN_PERSON_POPULARITY) {
			const credits = await getPersonCombinedCredits(personMatch.id, apiKey, PERSON_CREDITS_CAP);
			if (credits.length > 0) {
				const personResults = await Promise.all(credits.map((item) => hydrate(item, apiKey)));
				person = { name: personMatch.name, results: personResults };
			}
		}

		return { results, query, error: null, person };
	} catch {
		// Never let a TMDB hiccup take down the whole page — surface it inline with a retry instead.
		return {
			results: [] as SearchResult[],
			query,
			error: 'Could not reach TMDB. Please try again.',
			person: null as PersonResults | null
		};
	}
};
