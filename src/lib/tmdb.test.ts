import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
	formatRuntime,
	augmentProviders,
	getRuntime,
	searchMulti,
	SEARCH_RESULTS_CAP,
	DISNEY_PLUS_PROVIDER
} from './tmdb';
import type { Provider } from './types';

function provider(id: number, name: string): Provider {
	return { provider_id: id, provider_name: name, logo_path: '/x.jpg' };
}

const NETFLIX = provider(8, 'Netflix');
const HULU = provider(15, 'Hulu');
const DISNEY = provider(337, 'Disney Plus');
const PARAMOUNT_BASE = provider(531, 'Paramount+');
const PARAMOUNT_TIER = provider(9531, 'Paramount+ with Showtime');
const AMAZON_CHANNEL = provider(1000, 'Apple TV Amazon Channel');
const APPLE_TV = provider(350, 'Apple TV');
const AMAZON_PRIME = provider(9, 'Amazon Prime Video');
const AMAZON_PRIME_WITH_ADS = provider(2100, 'Amazon Prime Video with Ads');

describe('searchMulti — page 2 fallback (#200)', () => {
	const OK = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
	const movie = (title: string, popularity: number) => ({
		media_type: 'movie',
		title,
		popularity
	});
	const person = (name: string) => ({ media_type: 'person', name, popularity: 1 });

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('does not fetch page 2 when page 1 already fills the results cap', async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			OK({
				results: Array.from({ length: SEARCH_RESULTS_CAP }, (_, i) => movie(`Movie ${i}`, 10)),
				total_pages: 2
			})
		);
		vi.stubGlobal('fetch', fetchMock);

		const results = await searchMulti('batman', 'key');

		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(results).toHaveLength(SEARCH_RESULTS_CAP);
	});

	it('does not fetch page 2 when TMDB reports there is only one page', async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValue(OK({ results: [movie('Obscure Movie', 1)], total_pages: 1 }));
		vi.stubGlobal('fetch', fetchMock);

		await searchMulti('some obscure query', 'key');

		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it('falls back to page 2 when page 1 comes up short, ranking the extras by popularity', async () => {
		// Mirrors the real bug: "Nausicaä of the Valley of the Wind" is filed
		// under its disowned dub title "Warriors of the Wind", so it only
		// surfaces via an alternate-title match on page 2 — far more popular
		// than everything already on page 1, but TMDB's own relevance order
		// buries it behind low-popularity page-2 noise too.
		const fetchMock = vi.fn().mockImplementation(async (url: string) => {
			if (url.includes('page=2')) {
				return OK({
					results: [
						person('Nausica Someone'),
						movie('Nausicaa', 0.9),
						movie('Warriors of the Wind', 15.3), // the actual match
						movie('Nausicaa - Ocean Doc', 0.7)
					],
					total_pages: 2
				});
			}
			return OK({ results: [movie('Nausicaa: The Other Odyssey', 1.2)], total_pages: 2 });
		});
		vi.stubGlobal('fetch', fetchMock);

		const results = await searchMulti('nausica', 'key');

		expect(fetchMock).toHaveBeenCalledTimes(2);
		// Page 1's single result stays first; page 2's extras are appended
		// sorted by popularity, with the real match landing right after it —
		// not buried behind lower-popularity noise the way TMDB's raw order had it.
		expect(results.map((r) => r.title)).toEqual([
			'Nausicaa: The Other Odyssey',
			'Warriors of the Wind',
			'Nausicaa',
			'Nausicaa - Ocean Doc'
		]);
	});

	it('filters person results out of both pages', async () => {
		const fetchMock = vi.fn().mockImplementation(async (url: string) => {
			if (url.includes('page=2')) {
				return OK({ results: [person('Some Person'), movie('Real Match', 5)], total_pages: 2 });
			}
			return OK({ results: [person('Another Person')], total_pages: 2 });
		});
		vi.stubGlobal('fetch', fetchMock);

		const results = await searchMulti('query', 'key');

		expect(results).toEqual([movie('Real Match', 5)]);
	});
});

describe('formatRuntime', () => {
	it('formats movie runtime as Xh Ym', () => {
		expect(formatRuntime(148, 'movie')).toBe('2h 28m');
	});
	it('formats movie runtime under an hour as just minutes', () => {
		expect(formatRuntime(45, 'movie')).toBe('45m');
	});
	it('formats tv runtime as an approximate hour count', () => {
		expect(formatRuntime(90, 'tv')).toBe('~2h');
	});
	it('formats tv runtime under an hour as approximate minutes', () => {
		expect(formatRuntime(20, 'tv')).toBe('~20m');
	});
});

describe('augmentProviders — Disney+/Hulu disambiguation', () => {
	it('strips Hulu when Disney+ native content also lists Hulu (bundle contamination)', () => {
		const result = augmentProviders([NETFLIX, HULU, DISNEY], [2739], []);
		expect(result.map((p) => p.provider_id)).toEqual([8, 337]);
	});

	it('strips Disney+ when Hulu-native content (e.g. FX originals) also lists Disney+', () => {
		const result = augmentProviders([NETFLIX, HULU, DISNEY], [], []);
		expect(result.map((p) => p.provider_id)).toEqual([8, 15]);
	});

	it('injects Disney+ for Disney-owned content missing from JustWatch entirely', () => {
		const result = augmentProviders([NETFLIX], [2739], []);
		expect(result).toContainEqual(DISNEY_PLUS_PROVIDER);
		expect(result.map((p) => p.provider_id)).toEqual([337, 8]);
	});

	it('recognizes Disney ownership via production company id, not just network id', () => {
		const result = augmentProviders([NETFLIX], [], [420]); // Marvel Studios
		expect(result.map((p) => p.provider_id)).toContain(337);
	});

	it('passes through unrelated providers with generic bundle-name and tier filtering', () => {
		const result = augmentProviders(
			[NETFLIX, AMAZON_CHANNEL, PARAMOUNT_BASE, PARAMOUNT_TIER],
			[],
			[]
		);
		expect(result.map((p) => p.provider_id).sort((a, b) => a - b)).toEqual([8, 531]);
	});
});

describe('augmentProviders — Apple TV+/Amazon Prime Video disambiguation (#179)', () => {
	it('strips a plain "Amazon Prime Video" entry for Apple TV+ native content (e.g. Ted Lasso)', () => {
		// Real TMDB /tv/97546 (Ted Lasso) response shape: a bare "Amazon Prime
		// Video" entry, not named as a channel/bundle, so BUNDLE_NAME_RE alone
		// can't catch it — network id 2552 is what disambiguates it.
		const result = augmentProviders([AMAZON_PRIME, APPLE_TV], [2552], []);
		expect(result.map((p) => p.provider_id)).toEqual([350]);
	});

	it('also strips Amazon tier variants (e.g. "with Ads"), not just the base id', () => {
		const result = augmentProviders([AMAZON_PRIME, APPLE_TV, AMAZON_PRIME_WITH_ADS], [2552], []);
		expect(result.map((p) => p.provider_id)).toEqual([350]);
	});

	it('leaves Amazon Prime Video alone when there is no Apple TV+ network signal', () => {
		const result = augmentProviders([AMAZON_PRIME, APPLE_TV], [], []);
		expect(result.map((p) => p.provider_id).sort((a, b) => a - b)).toEqual([9, 350]);
	});

	it('leaves Apple TV+ content alone when Amazon Prime Video is not listed at all', () => {
		const result = augmentProviders([APPLE_TV], [2552], []);
		expect(result.map((p) => p.provider_id)).toEqual([350]);
	});
});

describe('getRuntime — movie release info', () => {
	const OK = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

	beforeEach(() => {
		vi.setSystemTime(new Date('2026-06-01T00:00:00Z'));
	});
	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
	});

	it('returns no release chip once a movie is released and already streaming', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue(
				OK({
					runtime: 120,
					status: 'Released',
					release_date: '2026-01-01',
					release_dates: {
						results: [
							{
								iso_3166_1: 'US',
								release_dates: [{ type: 4, release_date: '2026-01-15T00:00:00Z' }]
							}
						]
					},
					credits: { cast: [], crew: [] }
				})
			)
		);
		const result = await getRuntime(1, 'movie', 'key');
		expect(result.release).toBeNull();
	});

	it('surfaces a future digital date once known', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue(
				OK({
					runtime: 120,
					status: 'Released',
					release_date: '2026-05-01',
					release_dates: {
						results: [
							{
								iso_3166_1: 'US',
								release_dates: [{ type: 4, release_date: '2026-07-01T00:00:00Z' }]
							}
						]
					},
					credits: { cast: [], crew: [] }
				})
			)
		);
		const result = await getRuntime(1, 'movie', 'key');
		expect(result.release).toEqual({ status: 'Released', digital_date: '2026-07-01' });
	});

	it('estimates a streaming date for unreleased films using the Disney fast-lag window', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue(
				OK({
					runtime: 120,
					status: 'In Production',
					release_date: '2026-06-10',
					release_dates: { results: [] },
					production_companies: [{ id: 420 }], // Marvel Studios
					credits: { cast: [], crew: [] }
				})
			)
		);
		const result = await getRuntime(1, 'movie', 'key');
		expect(result.release).toEqual({
			status: 'In Production',
			theatrical_date: '2026-06-10',
			streaming_estimate: '2026-07-25' // 45-day Disney lag
		});
	});

	it('returns null once the estimated streaming date has already passed (stale chip suppression)', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue(
				OK({
					runtime: 120,
					status: 'Released',
					release_date: '2026-01-01',
					release_dates: { results: [] },
					credits: { cast: [], crew: [] }
				})
			)
		);
		const result = await getRuntime(1, 'movie', 'key');
		expect(result.release).toBeNull();
	});

	it('surfaces imdb_id from the appended external_ids response (#142)', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue(
				OK({
					runtime: 120,
					status: 'Released',
					release_date: '2026-01-01',
					credits: { cast: [], crew: [] },
					external_ids: { imdb_id: 'tt0111161' }
				})
			)
		);
		const result = await getRuntime(1, 'movie', 'key');
		expect(result.imdb_id).toBe('tt0111161');
	});

	it('returns null imdb_id when external_ids is absent from the response', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue(
				OK({
					runtime: 120,
					status: 'Released',
					release_date: '2026-01-01',
					credits: { cast: [], crew: [] }
				})
			)
		);
		const result = await getRuntime(1, 'movie', 'key');
		expect(result.imdb_id).toBeNull();
	});
});

describe('getRuntime — tv release info and season summaries', () => {
	const OK = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('marks a show as currently airing when the next episode is in the same season as the last', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue(
				OK({
					number_of_episodes: 10,
					episode_run_time: [50],
					last_episode_to_air: { runtime: 50, season_number: 2 },
					next_episode_to_air: { air_date: '2026-07-01', season_number: 2 },
					seasons: [
						{ season_number: 0, episode_count: 1, name: 'Specials' },
						{ season_number: 1, episode_count: 8, name: 'Season 1' }
					],
					networks: [],
					status: 'Returning Series',
					genres: [],
					created_by: [{ name: 'The Duffer Brothers' }],
					credits: { cast: [] }
				})
			)
		);
		const result = await getRuntime(1, 'tv', 'key');
		expect(result.release).toEqual({
			status: 'Returning Series',
			next_season: 2,
			next_season_date: '2026-07-01',
			currently_airing: true
		});
		expect(result.creator).toBe('The Duffer Brothers');
	});

	it('does not mark as currently airing when the next episode starts a new season', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue(
				OK({
					number_of_episodes: 8,
					episode_run_time: [50],
					last_episode_to_air: { runtime: 50, season_number: 1 },
					next_episode_to_air: { air_date: '2026-07-01', season_number: 2 },
					seasons: [{ season_number: 1, episode_count: 8, name: 'Season 1' }],
					networks: [],
					status: 'Returning Series',
					genres: [],
					credits: { cast: [] }
				})
			)
		);
		const result = await getRuntime(1, 'tv', 'key');
		expect(result.release?.currently_airing).toBeUndefined();
	});

	it('reports "Returning Series" status with no date when nothing is scheduled yet', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue(
				OK({
					number_of_episodes: 8,
					episode_run_time: [50],
					seasons: [{ season_number: 1, episode_count: 8, name: 'Season 1' }],
					networks: [],
					status: 'Returning Series',
					next_episode_to_air: null,
					genres: [],
					credits: { cast: [] }
				})
			)
		);
		const result = await getRuntime(1, 'tv', 'key');
		expect(result.release).toEqual({ status: 'Returning Series' });
	});

	it('excludes season 0 (specials) from per-season summaries', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue(
				OK({
					number_of_episodes: 8,
					episode_run_time: [60],
					seasons: [
						{ season_number: 0, episode_count: 3, name: 'Specials' },
						{ season_number: 1, episode_count: 8, name: 'Season 1' }
					],
					networks: [],
					status: 'Ended',
					genres: [],
					credits: { cast: [] }
				})
			)
		);
		const result = await getRuntime(1, 'tv', 'key');
		expect(result.seasons).toEqual([
			{ season_number: 1, episode_count: 8, name: 'Season 1', runtime_minutes: 480 }
		]);
	});

	it('surfaces imdb_id from the appended external_ids response (#142)', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue(
				OK({
					number_of_episodes: 10,
					episode_run_time: [50],
					seasons: [],
					networks: [],
					status: 'Ended',
					genres: [],
					credits: { cast: [] },
					external_ids: { imdb_id: 'tt7818638' }
				})
			)
		);
		const result = await getRuntime(1, 'tv', 'key');
		expect(result.imdb_id).toBe('tt7818638');
	});
});
