import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
	releaseChip,
	remainingRuntime,
	cancelCandidates,
	formatMonthsEquivalent
} from './progress';
import type { ReleaseInfo } from './types';
import { makeItem } from './test-fixtures';

// releaseChip/cancelCandidates read `Date.now()`/`new Date()` internally to decide
// past-vs-future, so pin the clock rather than deriving fixtures from real wall-clock
// time — makes every date-dependent assertion below exact instead of toContain/relative.
const NOW = new Date('2026-06-15T00:00:00.000Z');
beforeEach(() => vi.setSystemTime(NOW));
afterEach(() => vi.useRealTimers());

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

	it('treats a malformed dismissed-date as "not dismissed" (fails open, not closed)', () => {
		// new Date('garbage').getTime() is NaN — without the isNaN guard in
		// progress.ts, `(now - NaN) / 86400000 > 30` is false forever, which
		// would exclude the provider permanently instead of just not-yet.
		const item = makeItem({ providers: [provider], runtime_minutes: 60 });
		expect(cancelCandidates([item], 40, { '8': 'not-a-date' })).toHaveLength(1);
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

	// #242 — subscribedIds narrows candidates to providers actually marked
	// subscribed, rather than just "has a thin queue under budget."
	describe('subscribedIds', () => {
		it('falls back to queue-only inference when subscribedIds is omitted or empty', () => {
			const item = makeItem({ providers: [provider], runtime_minutes: 60 });
			expect(cancelCandidates([item], 40, {})).toHaveLength(1);
			expect(cancelCandidates([item], 40, {}, new Set())).toHaveLength(1);
		});

		it('excludes a provider with a thin queue that the user never marked subscribed', () => {
			const item = makeItem({ providers: [provider], runtime_minutes: 60 });
			expect(cancelCandidates([item], 40, {}, new Set([999]))).toEqual([]);
		});

		it('includes a provider that is both thin-queued and marked subscribed', () => {
			const item = makeItem({ providers: [provider], runtime_minutes: 60 });
			const result = cancelCandidates([item], 40, {}, new Set([8]));
			expect(result).toHaveLength(1);
			expect(result[0].providerId).toBe(8);
		});
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
		const r: ReleaseInfo = {
			next_season: 2,
			next_season_date: '2026-07-15',
			currently_airing: false
		};
		expect(releaseChip(r)).toBe('S2 premieres Jul 15, 2026');
	});

	it('shows "airing now" for a currently-airing season already released', () => {
		const r: ReleaseInfo = {
			next_season: 1,
			next_season_date: '2026-06-10',
			currently_airing: true
		};
		expect(releaseChip(r)).toBe('S1 airing now');
	});

	it('shows a future streaming date for a movie', () => {
		const r: ReleaseInfo = { digital_date: '2026-06-25' };
		expect(releaseChip(r)).toBe('Streaming Jun 25, 2026');
	});

	it('shows the theatrical date alone when there is no streaming estimate', () => {
		const r: ReleaseInfo = { theatrical_date: '2026-07-01' };
		expect(releaseChip(r)).toBe('Theaters Jul 1, 2026');
	});

	it('combines a future theatrical date with a streaming estimate', () => {
		const r: ReleaseInfo = { theatrical_date: '2026-07-01', streaming_estimate: '2026-09-01' };
		expect(releaseChip(r)).toBe('Theaters Jul 1, 2026 · Est. streaming ~Sep 2026');
	});

	it('shows only the streaming estimate once the theatrical date has passed', () => {
		const r: ReleaseInfo = { theatrical_date: '2026-01-01', streaming_estimate: '2026-09-01' };
		expect(releaseChip(r)).toBe('Est. streaming ~Sep 2026');
	});

	it('returns null when the theatrical date and estimate are both in the past', () => {
		// theatrical_date isFuture()-gated out, streaming_estimate has no future
		// check of its own — parts.join(' · ') || null is the guard that catches
		// the resulting empty-parts case instead of returning ''.
		const r: ReleaseInfo = { theatrical_date: '2026-01-01' };
		expect(releaseChip(r)).toBeNull();
	});
});
