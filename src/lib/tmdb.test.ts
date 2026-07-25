import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { formatRuntime, augmentProviders, getRuntime, DISNEY_PLUS_PROVIDER } from './tmdb';
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
});
