import { describe, it, expect } from 'vitest';
import {
	releaseChip,
	remainingRuntime,
	cancelCandidates,
	formatMonthsEquivalent
} from './progress';
import type { WatchlistItem, ReleaseInfo } from './types';

describe('formatMonthsEquivalent', () => {
	it('returns empty string when there is no budget to divide by', () => {
		expect(formatMonthsEquivalent(600, 0)).toBe('');
		expect(formatMonthsEquivalent(600, -5)).toBe('');
	});

	it('formats a whole number of months without a decimal', () => {
		// 40 budget hours/month, 4800 minutes = 80 hours = 2 months
		expect(formatMonthsEquivalent(4800, 40)).toBe('2 months');
	});

	it('formats a fractional month to one decimal place', () => {
		// 40 budget hours/month, 3600 minutes = 60 hours = 1.5 months
		expect(formatMonthsEquivalent(3600, 40)).toBe('1.5 months');
	});

	it('uses singular "month" for exactly 1', () => {
		expect(formatMonthsEquivalent(2400, 40)).toBe('1 month');
	});

	it('floors very small amounts to "<0.1 months" instead of "0 months"', () => {
		expect(formatMonthsEquivalent(30, 40)).toBe('<0.1 months');
	});
});

function makeItem(overrides: Partial<WatchlistItem> = {}): WatchlistItem {
	return {
		id: 1,
		tmdb_id: 100,
		media_type: 'movie',
		title: 'Test Title',
		poster_path: null,
		overview: null,
		providers: [],
		runtime_minutes: 120,
		seasons: [],
		watched_seasons: [],
		added_at: '2026-01-01T00:00:00.000Z',
		watched_at: null,
		...overrides
	};
}

describe('remainingRuntime', () => {
	it('returns full runtime for a movie', () => {
		expect(remainingRuntime(makeItem({ media_type: 'movie', runtime_minutes: 100 }))).toBe(100);
	});

	it('falls back to the default runtime when a movie has no runtime_minutes', () => {
		expect(remainingRuntime(makeItem({ media_type: 'movie', runtime_minutes: null }))).toBe(90);
	});

	it('falls back to the TV default when a show has no season data and no runtime_minutes', () => {
		expect(
			remainingRuntime(makeItem({ media_type: 'tv', runtime_minutes: null, seasons: [] }))
		).toBe(45);
	});

	it('subtracts fully-watched seasons for a TV show', () => {
		const item = makeItem({
			media_type: 'tv',
			runtime_minutes: null,
			seasons: [
				{ season_number: 1, episode_count: 10, name: 'S1', runtime_minutes: 300 },
				{ season_number: 2, episode_count: 10, name: 'S2', runtime_minutes: 300 }
			],
			watched_seasons: [1]
		});
		expect(remainingRuntime(item)).toBe(300);
	});

	it('returns 0 when every season is watched', () => {
		const item = makeItem({
			media_type: 'tv',
			runtime_minutes: null,
			seasons: [{ season_number: 1, episode_count: 10, name: 'S1', runtime_minutes: 300 }],
			watched_seasons: [1]
		});
		expect(remainingRuntime(item)).toBe(0);
	});
});

describe('cancelCandidates', () => {
	const provider = { provider_id: 8, provider_name: 'Netflix', logo_path: '/n.png' };

	it('returns nothing when the budget is zero or negative', () => {
		const item = makeItem({ providers: [provider], runtime_minutes: 60 });
		expect(cancelCandidates([item], 0, {})).toEqual([]);
		expect(cancelCandidates([item], -5, {})).toEqual([]);
	});

	it('excludes items with no providers', () => {
		const item = makeItem({ providers: [], runtime_minutes: 60 });
		expect(cancelCandidates([item], 40, {})).toEqual([]);
	});

	it('excludes a provider whose total exceeds the budget', () => {
		const item = makeItem({ providers: [provider], runtime_minutes: 60 * 50 }); // 50h
		expect(cancelCandidates([item], 10, {})).toEqual([]); // 10h budget
	});

	it('includes a provider whose total fits comfortably within budget', () => {
		const item = makeItem({ providers: [provider], runtime_minutes: 60 }); // 1h
		const result = cancelCandidates([item], 40, {});
		expect(result).toHaveLength(1);
		expect(result[0].providerId).toBe(8);
		expect(result[0].totalMins).toBe(60);
	});

	it('excludes a provider dismissed within the last 30 days', () => {
		const item = makeItem({ providers: [provider], runtime_minutes: 60 });
		const yesterday = new Date(Date.now() - 1 * 86400000).toISOString().slice(0, 10);
		expect(cancelCandidates([item], 40, { '8': yesterday })).toEqual([]);
	});

	it('re-includes a provider dismissed more than 30 days ago', () => {
		const item = makeItem({ providers: [provider], runtime_minutes: 60 });
		const longAgo = new Date(Date.now() - 40 * 86400000).toISOString().slice(0, 10);
		expect(cancelCandidates([item], 40, { '8': longAgo })).toHaveLength(1);
	});

	it('sorts multiple candidates by ascending total time', () => {
		const p2 = { provider_id: 9, provider_name: 'Hulu', logo_path: '/h.png' };
		const items = [
			makeItem({ id: 1, providers: [provider], runtime_minutes: 120 }),
			makeItem({ id: 2, providers: [p2], runtime_minutes: 30 })
		];
		const result = cancelCandidates(items, 40, {});
		expect(result.map((c) => c.providerId)).toEqual([9, 8]);
	});
});

describe('releaseChip', () => {
	it('returns null for no release info', () => {
		expect(releaseChip(null)).toBeNull();
		expect(releaseChip(undefined)).toBeNull();
	});

	it('returns null when nothing noteworthy is set', () => {
		expect(releaseChip({} as ReleaseInfo)).toBeNull();
	});

	it('flags a returning series with no confirmed date', () => {
		const r: ReleaseInfo = { status: 'Returning Series', next_season: 4 };
		expect(releaseChip(r)).toBe('S4 returning — no date yet');
	});

	it('shows a future premiere date for an upcoming season', () => {
		const future = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
		const r: ReleaseInfo = { next_season: 2, next_season_date: future, currently_airing: false };
		expect(releaseChip(r)).toContain('S2 premieres');
	});

	it('shows "airing now" for a currently-airing season already released', () => {
		const past = new Date(Date.now() - 5 * 86400000).toISOString().slice(0, 10);
		const r: ReleaseInfo = { next_season: 1, next_season_date: past, currently_airing: true };
		expect(releaseChip(r)).toBe('S1 airing now');
	});

	it('shows a future streaming date for a movie', () => {
		const future = new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10);
		const r: ReleaseInfo = { digital_date: future };
		expect(releaseChip(r)).toContain('Streaming');
	});
});
