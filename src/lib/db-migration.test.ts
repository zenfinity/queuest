import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import { _openForTest } from './db';

// Exercises the v2 -> v3 upgrade path directly against a throwaway database
// name, since db.ts memoizes a single never-closed connection to its default
// database name and a delete/recreate would hang behind it.
function openV2(name: string): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const req = indexedDB.open(name, 2);
		req.onupgradeneeded = (e) => {
			const db = (e.target as IDBOpenDBRequest).result;
			const store = db.createObjectStore('watchlist', { keyPath: 'id', autoIncrement: true });
			store.createIndex('tmdb_media', ['tmdb_id', 'media_type'], { unique: true });
			db.createObjectStore('services', { keyPath: 'provider_id' });
		};
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error);
	});
}

function makeV2Row(tmdb_id: number, added_at: string) {
	return {
		tmdb_id,
		media_type: 'movie',
		title: `Row ${tmdb_id}`,
		poster_path: null,
		overview: null,
		providers: [],
		runtime_minutes: 90,
		seasons: [],
		watched_seasons: [],
		added_at,
		watched_at: null
	};
}

async function getAllRows(
	db: IDBDatabase
): Promise<{ tmdb_id: number; updated_at?: string; sort_order?: number; queue_tag?: string }[]> {
	return new Promise((resolve, reject) => {
		const req = db.transaction('watchlist').objectStore('watchlist').getAll();
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error);
	});
}

describe('db migration v2 -> v3', () => {
	it('adds the meta store and backfills updated_at on pre-existing rows', async () => {
		const name = `streamq-migration-test-${Math.random()}`;

		const v2db = await openV2(name);
		await new Promise<void>((resolve, reject) => {
			const tx = v2db.transaction('watchlist', 'readwrite');
			tx.objectStore('watchlist').add(makeV2Row(1, '2020-01-01T00:00:00.000Z'));
			tx.oncomplete = () => resolve();
			tx.onerror = () => reject(tx.error);
		});
		v2db.close();

		const v3db = await _openForTest(name);
		expect(v3db.objectStoreNames.contains('meta')).toBe(true);

		const rows = await getAllRows(v3db);
		expect(rows).toHaveLength(1);
		expect(rows[0].updated_at).toBe('2020-01-01T00:00:00.000Z');
	});
});

describe('db migration v2 -> v4 (#216)', () => {
	// Regression test: an earlier version of the v4 upgrade ran its
	// sort_order backfill cursor concurrently with v3's updated_at backfill
	// cursor. Two cursors doing read-modify-write over the same store within
	// one versionchange transaction each hold their own snapshot of a row, so
	// whichever commits second silently clobbers the other's field — this
	// only reproduced with the v3 backfill actually having work to do, which
	// is exactly the v2 -> v4 jump.
	it('backfills both updated_at and sort_order without either clobbering the other', async () => {
		const name = `streamq-migration-test-${Math.random()}`;

		const v2db = await openV2(name);
		await new Promise<void>((resolve, reject) => {
			const tx = v2db.transaction('watchlist', 'readwrite');
			const store = tx.objectStore('watchlist');
			store.add(makeV2Row(1, '2020-01-01T00:00:00.000Z'));
			store.add(makeV2Row(2, '2020-01-02T00:00:00.000Z'));
			store.add(makeV2Row(3, '2020-01-03T00:00:00.000Z'));
			tx.oncomplete = () => resolve();
			tx.onerror = () => reject(tx.error);
		});
		v2db.close();

		const v4db = await _openForTest(name);
		const rows = await getAllRows(v4db);
		expect(rows).toHaveLength(3);

		const byId = new Map(rows.map((r) => [r.tmdb_id, r]));
		expect(byId.get(1)!.updated_at).toBe('2020-01-01T00:00:00.000Z');
		expect(byId.get(2)!.updated_at).toBe('2020-01-02T00:00:00.000Z');
		expect(byId.get(3)!.updated_at).toBe('2020-01-03T00:00:00.000Z');

		const orders = rows.map((r) => r.sort_order).sort((a, b) => (a ?? 0) - (b ?? 0));
		expect(orders).toEqual([0, 1, 2]);
	});
});

function openV3(name: string): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const req = indexedDB.open(name, 3);
		req.onupgradeneeded = (e) => {
			const db = (e.target as IDBOpenDBRequest).result;
			const store = db.createObjectStore('watchlist', { keyPath: 'id', autoIncrement: true });
			store.createIndex('tmdb_media', ['tmdb_id', 'media_type'], { unique: true });
			db.createObjectStore('services', { keyPath: 'provider_id' });
			db.createObjectStore('meta', { keyPath: 'key' });
		};
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error);
	});
}

describe('db migration v3 -> v4 (#216)', () => {
	it('backfills sort_order in insertion order, leaving updated_at untouched', async () => {
		const name = `streamq-migration-test-${Math.random()}`;

		const v3db = await openV3(name);
		await new Promise<void>((resolve, reject) => {
			const tx = v3db.transaction('watchlist', 'readwrite');
			const store = tx.objectStore('watchlist');
			store.add({
				...makeV2Row(1, '2020-01-01T00:00:00.000Z'),
				updated_at: '2020-01-01T00:00:00.000Z'
			});
			store.add({
				...makeV2Row(2, '2020-01-02T00:00:00.000Z'),
				updated_at: '2020-01-02T00:00:00.000Z'
			});
			tx.oncomplete = () => resolve();
			tx.onerror = () => reject(tx.error);
		});
		v3db.close();

		const v4db = await _openForTest(name);
		const rows = await getAllRows(v4db);
		const byId = new Map(rows.map((r) => [r.tmdb_id, r]));

		expect(byId.get(1)!.updated_at).toBe('2020-01-01T00:00:00.000Z');
		expect(byId.get(2)!.updated_at).toBe('2020-01-02T00:00:00.000Z');
		expect(byId.get(1)!.sort_order).toBe(0);
		expect(byId.get(2)!.sort_order).toBe(1);
	});
});

function openV4(name: string): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const req = indexedDB.open(name, 4);
		req.onupgradeneeded = (e) => {
			const db = (e.target as IDBOpenDBRequest).result;
			const store = db.createObjectStore('watchlist', { keyPath: 'id', autoIncrement: true });
			// The pre-#221 schema: global uniqueness, no queue_tag component.
			store.createIndex('tmdb_media', ['tmdb_id', 'media_type'], { unique: true });
			db.createObjectStore('services', { keyPath: 'provider_id' });
			db.createObjectStore('meta', { keyPath: 'key' });
		};
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error);
	});
}

describe('db migration v4 -> v5 (#221)', () => {
	// A real pre-#221 user: a v4 database with a row that has queue_tag left
	// undefined, exactly like every item added before this migration existed.
	// None of the migration tests above exercise this specific branch — they
	// all land on v3 or v4 with the *store* freshly created in this same test
	// run, so there's nothing with an undefined queue_tag to backfill. Only a
	// genuine v4 -> v5 upgrade, on data that predates queue_tag's per-list
	// index, does.
	it('backfills the pre-existing row to the "no list" sentinel and denormalizes it back to undefined on read', async () => {
		const name = `streamq-migration-test-${Math.random()}`;

		const v4db = await openV4(name);
		await new Promise<void>((resolve, reject) => {
			const tx = v4db.transaction('watchlist', 'readwrite');
			tx.objectStore('watchlist').add({
				...makeV2Row(1, '2020-01-01T00:00:00.000Z'),
				updated_at: '2020-01-01T00:00:00.000Z',
				sort_order: 0
				// queue_tag intentionally absent.
			});
			tx.oncomplete = () => resolve();
			tx.onerror = () => reject(tx.error);
		});
		v4db.close();

		const v5db = await _openForTest(name);
		expect(v5db.objectStoreNames.contains('watchlist')).toBe(true);

		const rows = await getAllRows(v5db);
		expect(rows).toHaveLength(1);
		// The raw stored value is the sentinel, not undefined — db.ts's public
		// functions (getAll, etc.) are what denormalize it back on the way
		// out; reading the raw store directly here is deliberately bypassing
		// that to confirm the backfill itself, not the read-side translation
		// (which db.test.ts's own per-list-uniqueness tests already cover).
		expect(rows[0].queue_tag).toBe('');
	});

	it('the new per-list index enforces uniqueness over backfilled data', async () => {
		const name = `streamq-migration-test-${Math.random()}`;

		const v4db = await openV4(name);
		await new Promise<void>((resolve, reject) => {
			const tx = v4db.transaction('watchlist', 'readwrite');
			tx.objectStore('watchlist').add({
				...makeV2Row(1, '2020-01-01T00:00:00.000Z'),
				updated_at: '2020-01-01T00:00:00.000Z',
				sort_order: 0
			});
			tx.oncomplete = () => resolve();
			tx.onerror = () => reject(tx.error);
		});
		v4db.close();

		const v5db = await _openForTest(name);

		// A second untagged copy of the same title still collides...
		await expect(
			new Promise<void>((resolve, reject) => {
				const tx = v5db.transaction('watchlist', 'readwrite');
				const req = tx.objectStore('watchlist').add({
					...makeV2Row(1, '2020-02-01T00:00:00.000Z'),
					updated_at: '2020-02-01T00:00:00.000Z',
					sort_order: 1,
					queue_tag: ''
				});
				req.onsuccess = () => resolve();
				req.onerror = () => reject(req.error);
			})
		).rejects.toThrow();

		// ...but a copy under a real list name doesn't — this is the actual
		// point of #221, working correctly over data the migration backfilled
		// rather than data that started life already tagged.
		await new Promise<void>((resolve, reject) => {
			const tx = v5db.transaction('watchlist', 'readwrite');
			const req = tx.objectStore('watchlist').add({
				...makeV2Row(1, '2020-02-01T00:00:00.000Z'),
				updated_at: '2020-02-01T00:00:00.000Z',
				sort_order: 1,
				queue_tag: 'Horror'
			});
			req.onsuccess = () => resolve();
			req.onerror = () => reject(req.error);
		});

		const rows = await getAllRows(v5db);
		expect(rows).toHaveLength(2);
	});
});
