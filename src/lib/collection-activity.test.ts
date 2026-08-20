import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { getLastViewed, markViewed, hasNewActivity, countNewActivity } from './collection-activity';
import type { CollectionItem } from './collection-sync';

const COLL = '11111111-1111-4111-8111-111111111111';

function item(over: Partial<CollectionItem> = {}): CollectionItem {
	return {
		tmdb_id: 1,
		media_type: 'movie',
		title: 'A Title',
		poster_path: null,
		overview: null,
		providers: [],
		runtime_minutes: 100,
		seasons: [],
		watched_seasons: [],
		added_at: '2026-08-01T00:00:00.000Z',
		watched_at: null,
		updated_at: '2026-08-01T00:00:00.000Z',
		...over
	};
}

beforeEach(async () => {
	const { replaceAll } = await import('./db');
	await replaceAll([], { silent: true });
});

describe('getLastViewed / markViewed', () => {
	it('has no watermark until the collection has been viewed', async () => {
		expect(await getLastViewed(COLL)).toBeUndefined();
	});

	it('records a watermark on markViewed', async () => {
		await markViewed(COLL);
		const wm = await getLastViewed(COLL);
		expect(wm).toBeTruthy();
	});

	it('keeps watermarks for different collections independent', async () => {
		await markViewed(COLL);
		expect(await getLastViewed('other-id')).toBeUndefined();
	});
});

describe('hasNewActivity', () => {
	it('flags nothing when the collection has never been viewed', () => {
		expect(hasNewActivity(item({ added_at: '2026-08-10T00:00:00.000Z' }), undefined)).toBe(false);
	});

	it('flags an item added after the watermark', () => {
		const i = item({ added_at: '2026-08-10T00:00:00.000Z' });
		expect(hasNewActivity(i, '2026-08-05T00:00:00.000Z')).toBe(true);
	});

	it('does not flag an item added before the watermark', () => {
		const i = item({ added_at: '2026-08-01T00:00:00.000Z' });
		expect(hasNewActivity(i, '2026-08-05T00:00:00.000Z')).toBe(false);
	});

	it('flags an item whose watch map gained an entry after the watermark', () => {
		const i = item({
			added_at: '2026-08-01T00:00:00.000Z',
			watch: { alice: '2026-08-10T00:00:00.000Z' }
		});
		expect(hasNewActivity(i, '2026-08-05T00:00:00.000Z')).toBe(true);
	});

	it('does not flag a watch entry set before the watermark', () => {
		const i = item({
			added_at: '2026-08-01T00:00:00.000Z',
			watch: { alice: '2026-08-02T00:00:00.000Z' }
		});
		expect(hasNewActivity(i, '2026-08-05T00:00:00.000Z')).toBe(false);
	});
});

describe('countNewActivity', () => {
	it('is zero with no watermark', () => {
		const items = [item({ added_at: '2026-08-10T00:00:00.000Z' })];
		expect(countNewActivity(items, undefined)).toBe(0);
	});

	it('counts only items with activity after the watermark', () => {
		const items = [
			item({ tmdb_id: 1, added_at: '2026-08-01T00:00:00.000Z' }),
			item({ tmdb_id: 2, added_at: '2026-08-10T00:00:00.000Z' }),
			item({
				tmdb_id: 3,
				added_at: '2026-08-01T00:00:00.000Z',
				watch: { alice: '2026-08-11T00:00:00.000Z' }
			})
		];
		expect(countNewActivity(items, '2026-08-05T00:00:00.000Z')).toBe(2);
	});
});
