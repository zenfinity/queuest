import { describe, it, expect } from 'vitest';
import { bordaTally } from './ranking';
import type { CollectionItem, BallotEntry } from './collection-sync';

const ALICE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const BOB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const CAROL = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

function item(
	tmdb_id: number,
	title: string,
	media_type: 'movie' | 'tv' = 'movie'
): CollectionItem {
	return {
		tmdb_id,
		media_type,
		title,
		poster_path: null,
		overview: null,
		providers: [],
		runtime_minutes: 100,
		seasons: [],
		watched_seasons: [],
		added_at: '2026-08-01T00:00:00.000Z',
		watched_at: null,
		updated_at: '2026-08-01T00:00:00.000Z'
	};
}

function ballot(items: string[]): BallotEntry {
	return { items, updatedAt: '2026-08-01T00:00:00.000Z' };
}

describe('bordaTally', () => {
	it('awards points by rank position, 5 for 1st down to 1 for 5th', () => {
		const a = item(1, 'A');
		const rows = bordaTally([a], { [ALICE]: ballot(['movie:1']) });
		expect(rows).toEqual([{ item: a, score: 5, voters: 1 }]);
	});

	it('sums points across multiple members', () => {
		const a = item(1, 'A');
		const rows = bordaTally([a], {
			[ALICE]: ballot(['movie:1']), // 1st: 5 pts
			[BOB]: ballot(['movie:9', 'movie:1']) // 2nd: 4 pts
		});
		expect(rows[0]).toEqual({ item: a, score: 9, voters: 2 });
	});

	it('sorts highest score first', () => {
		const a = item(1, 'A');
		const b = item(2, 'B');
		const rows = bordaTally([a, b], {
			[ALICE]: ballot(['movie:2', 'movie:1']) // B: 5, A: 4
		});
		expect(rows.map((r) => r.item.tmdb_id)).toEqual([2, 1]);
	});

	it('breaks a score tie by voter count', () => {
		const a = item(1, 'A');
		const b = item(2, 'B');
		const rows = bordaTally([a, b], {
			[ALICE]: ballot(['movie:999', 'movie:1']), // A at 2nd → 4 pts, 1 voter
			[BOB]: ballot(['movie:8', 'movie:7', 'movie:6', 'movie:5', 'movie:2']), // B at 5th → 1 pt
			[CAROL]: ballot(['movie:998', 'movie:997', 'movie:2']) // B at 3rd → 3 pts
		});
		// Both score 4, but B has 2 voters vs A's 1 — voters break the tie.
		expect(rows.map((r) => ({ id: r.item.tmdb_id, score: r.score, voters: r.voters }))).toEqual([
			{ id: 2, score: 4, voters: 2 },
			{ id: 1, score: 4, voters: 1 }
		]);
	});

	it('breaks a score-and-voter tie alphabetically by title', () => {
		const zebra = item(1, 'Zebra');
		const apple = item(2, 'Apple');
		const rows = bordaTally([zebra, apple], {
			[ALICE]: ballot(['movie:1']), // Zebra: 5 pts, 1 voter
			[BOB]: ballot(['movie:2']) // Apple: 5 pts, 1 voter
		});
		expect(rows.map((r) => r.item.title)).toEqual(['Apple', 'Zebra']);
	});

	it('drops a ballot entry that has no matching current item, without throwing', () => {
		const a = item(1, 'A');
		const rows = bordaTally([a], {
			[ALICE]: ballot(['movie:999', 'movie:1']) // movie:999 no longer exists
		});
		expect(rows).toEqual([{ item: a, score: 4, voters: 1 }]);
	});

	it('excludes titles nobody ranked', () => {
		const a = item(1, 'A');
		const b = item(2, 'B');
		const rows = bordaTally([a, b], { [ALICE]: ballot(['movie:1']) });
		expect(rows.map((r) => r.item.tmdb_id)).toEqual([1]);
	});

	it('returns an empty list when there are no ballots', () => {
		expect(bordaTally([item(1, 'A')], {})).toEqual([]);
	});

	it('caps points at the ballot length, never awarding more than MAX_BALLOT_SIZE points', () => {
		const items = [1, 2, 3, 4, 5].map((n) => item(n, `T${n}`));
		const rows = bordaTally(items, {
			[ALICE]: ballot(['movie:1', 'movie:2', 'movie:3', 'movie:4', 'movie:5'])
		});
		expect(rows.map((r) => r.score)).toEqual([5, 4, 3, 2, 1]);
	});
});
