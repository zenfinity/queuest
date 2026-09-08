import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import { _openForTest, NOTE_MAX_LENGTH } from './db';

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

async function getAllRows(db: IDBDatabase): Promise<
	{
		id: number;
		tmdb_id: number;
		title?: string;
		added_at?: string;
		updated_at?: string;
		sort_order?: number;
		queue_tag?: string;
		queue_tags?: Record<string, { rank?: number; at: string; deleted?: true }>;
		notes?: string;
		watched_at?: string | null;
		watched_seasons?: number[];
		deleted_at?: string | null;
	}[]
> {
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
	//
	// _openForTest always upgrades all the way to the *current* VERSION, which
	// is v6 now (#274) — so this test can only observe v5's step as it exists
	// on the way through to v6, not as a database frozen at v5. The one v5-only
	// assertion that's still independently meaningful is the intermediate
	// sentinel value collapseQueueTags (v5 -> v6) reads as its input; the v5
	// step's other externally-visible behavior (one row per title, uniqueness)
	// is exactly what the v5 -> v6 describe block below verifies on the actual
	// v6-shaped output.
	it('backfills the pre-existing row through the "no list" sentinel on the way to v6', async () => {
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

		const v6db = await _openForTest(name);
		expect(v6db.objectStoreNames.contains('watchlist')).toBe(true);

		const rows = await getAllRows(v6db);
		expect(rows).toHaveLength(1);
		// No list membership survives an absent/sentinel queue_tag — the
		// untagged common case round-trips to no active tags at all.
		expect(rows[0].queue_tags).toBeUndefined();
	});
});

function openV5(name: string): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const req = indexedDB.open(name, 5);
		req.onupgradeneeded = (e) => {
			const db = (e.target as IDBOpenDBRequest).result;
			const store = db.createObjectStore('watchlist', { keyPath: 'id', autoIncrement: true });
			// The #221 schema: per-list uniqueness, queue_tag always a real
			// string (the '' sentinel standing in for "no list").
			store.createIndex('tmdb_media_list', ['tmdb_id', 'media_type', 'queue_tag'], {
				unique: true
			});
			db.createObjectStore('services', { keyPath: 'provider_id' });
			db.createObjectStore('meta', { keyPath: 'key' });
		};
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error);
	});
}

function makeV5Row(
	tmdb_id: number,
	overrides: {
		title?: string;
		media_type?: 'movie' | 'tv';
		added_at?: string;
		updated_at?: string;
		sort_order?: number;
		queue_tag?: string;
		watched_at?: string | null;
		deleted_at?: string | null;
		notes?: string;
	} = {}
) {
	const added_at = overrides.added_at ?? '2020-01-01T00:00:00.000Z';
	return {
		tmdb_id,
		media_type: overrides.media_type ?? 'movie',
		title: overrides.title ?? `Row ${tmdb_id}`,
		poster_path: null,
		overview: null,
		providers: [],
		runtime_minutes: 90,
		seasons: [],
		watched_seasons: [] as number[],
		added_at,
		watched_at: overrides.watched_at ?? null,
		updated_at: overrides.updated_at ?? added_at,
		sort_order: overrides.sort_order ?? 0,
		queue_tag: overrides.queue_tag ?? '',
		...(overrides.deleted_at !== undefined ? { deleted_at: overrides.deleted_at } : {}),
		...(overrides.notes !== undefined ? { notes: overrides.notes } : {})
	};
}

function addV5Row(db: IDBDatabase, row: ReturnType<typeof makeV5Row>): Promise<void> {
	return new Promise((resolve, reject) => {
		const tx = db.transaction('watchlist', 'readwrite');
		tx.objectStore('watchlist').add(row);
		tx.oncomplete = () => resolve();
		tx.onerror = () => reject(tx.error);
	});
}

describe('db migration v5 -> v6 (#274)', () => {
	// #274 collapses row-per-list-membership back to one row per title. These
	// seed genuinely duplicated v5 rows (the real shape #221 could produce)
	// and exercise the actual _openForTest upgrade path, not the collapse
	// function in isolation — the same posture as every other migration test
	// in this file.
	it('a title with no duplicate row passes through untouched, updated_at included', async () => {
		const name = `streamq-migration-test-${Math.random()}`;
		const v5db = await openV5(name);
		await addV5Row(
			v5db,
			makeV5Row(1, { queue_tag: 'Horror', updated_at: '2021-06-01T00:00:00.000Z' })
		);
		v5db.close();

		const v6db = await _openForTest(name);
		const [row] = await getAllRows(v6db);

		// The same code path a re-run over already-collapsed data would take
		// (a group of exactly one row) — must be a literal passthrough, not
		// just "same values": bumping updated_at here would hand every
		// un-duplicated row (the common case) an artificially fresh timestamp
		// on upgrade, which could beat a real pending edit unsynced on
		// another device that hasn't upgraded yet.
		expect(row.updated_at).toBe('2021-06-01T00:00:00.000Z');
		expect(row.queue_tags).toEqual({ Horror: { at: '2021-06-01T00:00:00.000Z' } });
	});

	it("collapses two list-copies into one row, carrying each row's old sort_order forward as that tag's rank", async () => {
		const name = `streamq-migration-test-${Math.random()}`;
		const v5db = await openV5(name);
		await addV5Row(v5db, makeV5Row(1, { queue_tag: 'Horror', sort_order: 2 }));
		await addV5Row(v5db, makeV5Row(1, { queue_tag: 'Comedy', sort_order: 7 }));
		v5db.close();

		const v6db = await _openForTest(name);
		const rows = await getAllRows(v6db);

		expect(rows).toHaveLength(1);
		expect(rows[0].queue_tags?.Horror).toMatchObject({ rank: 2 });
		expect(rows[0].queue_tags?.Comedy).toMatchObject({ rank: 7 });
	});

	it('concatenates distinct notes oldest-first and truncates past NOTE_MAX_LENGTH with a visible marker', async () => {
		const name = `streamq-migration-test-${Math.random()}`;
		const v5db = await openV5(name);
		await addV5Row(
			v5db,
			makeV5Row(1, {
				queue_tag: 'Horror',
				updated_at: '2020-01-01T00:00:00.000Z',
				notes: 'a'.repeat(NOTE_MAX_LENGTH)
			})
		);
		await addV5Row(
			v5db,
			makeV5Row(1, {
				queue_tag: 'Comedy',
				updated_at: '2020-02-01T00:00:00.000Z',
				notes: 'later note'
			})
		);
		v5db.close();

		const v6db = await _openForTest(name);
		const [row] = await getAllRows(v6db);

		expect(row.notes!.length).toBeLessThanOrEqual(NOTE_MAX_LENGTH);
		expect(row.notes!.startsWith('a'.repeat(50))).toBe(true); // oldest first
		expect(row.notes).toContain('truncated');
		expect(row.notes).not.toContain('later note'); // truncated away
	});

	it('dedupes an identical note instead of concatenating it with itself', async () => {
		const name = `streamq-migration-test-${Math.random()}`;
		const v5db = await openV5(name);
		await addV5Row(v5db, makeV5Row(1, { queue_tag: 'Horror', notes: 'same note' }));
		await addV5Row(v5db, makeV5Row(1, { queue_tag: 'Comedy', notes: 'same note' }));
		v5db.close();

		const v6db = await _openForTest(name);
		const [row] = await getAllRows(v6db);

		expect(row.notes).toBe('same note');
	});

	it('watched anywhere in the group wins, using the earliest watched_at', async () => {
		const name = `streamq-migration-test-${Math.random()}`;
		const v5db = await openV5(name);
		await addV5Row(v5db, makeV5Row(1, { queue_tag: 'Horror', watched_at: null }));
		await addV5Row(
			v5db,
			makeV5Row(1, { queue_tag: 'Comedy', watched_at: '2020-03-01T00:00:00.000Z' })
		);
		v5db.close();

		const v6db = await _openForTest(name);
		const [row] = await getAllRows(v6db);

		expect(row.watched_at).toBe('2020-03-01T00:00:00.000Z');
	});

	it('unions watched_seasons and keeps the earliest added_at, same rules ongoing sync already uses', async () => {
		const name = `streamq-migration-test-${Math.random()}`;
		const v5db = await openV5(name);
		await addV5Row(v5db, {
			...makeV5Row(1, { queue_tag: 'Horror', added_at: '2020-02-01T00:00:00.000Z' }),
			watched_seasons: [1, 2]
		});
		await addV5Row(v5db, {
			...makeV5Row(1, { queue_tag: 'Comedy', added_at: '2020-01-01T00:00:00.000Z' }),
			watched_seasons: [2, 3]
		});
		v5db.close();

		const v6db = await _openForTest(name);
		const [row] = await getAllRows(v6db);

		expect(row.watched_seasons).toEqual([1, 2, 3]);
		expect(row.added_at).toBe('2020-01-01T00:00:00.000Z');
	});

	it('breaks an exact added_at tie by the lower (earlier-inserted) id', async () => {
		const name = `streamq-migration-test-${Math.random()}`;
		const tie = '2020-01-01T00:00:00.000Z';
		const v5db = await openV5(name);
		// Inserted first -> lower autoIncrement id -> expected survivor.
		await addV5Row(v5db, makeV5Row(1, { title: 'First in', queue_tag: 'Horror', added_at: tie }));
		await addV5Row(v5db, makeV5Row(1, { title: 'Second in', queue_tag: 'Comedy', added_at: tie }));
		v5db.close();

		const v6db = await _openForTest(name);
		const [row] = await getAllRows(v6db);

		expect(row.title).toBe('First in');
	});

	it("a live row keeps a collapsed group undeleted, and a tombstoned sibling's tag survives only as a tombstone", async () => {
		const name = `streamq-migration-test-${Math.random()}`;
		const v5db = await openV5(name);
		await addV5Row(v5db, makeV5Row(1, { queue_tag: 'Horror', deleted_at: null }));
		await addV5Row(
			v5db,
			makeV5Row(1, { queue_tag: 'Comedy', deleted_at: '2020-05-01T00:00:00.000Z' })
		);
		v5db.close();

		const v6db = await _openForTest(name);
		const [row] = await getAllRows(v6db);

		expect(row.deleted_at).toBeFalsy();
		expect(row.queue_tags?.Horror?.deleted).toBeUndefined();
		// Not resurrected as an active membership — a title removed from a
		// list must not come back just because it shares a collapse group
		// with a live row under a different list.
		expect(row.queue_tags?.Comedy?.deleted).toBe(true);
	});

	it('an all-tombstoned group collapses to one tombstone at the latest deleted_at', async () => {
		const name = `streamq-migration-test-${Math.random()}`;
		const v5db = await openV5(name);
		await addV5Row(
			v5db,
			makeV5Row(1, { queue_tag: 'Horror', deleted_at: '2020-01-01T00:00:00.000Z' })
		);
		await addV5Row(
			v5db,
			makeV5Row(1, { queue_tag: 'Comedy', deleted_at: '2020-06-01T00:00:00.000Z' })
		);
		v5db.close();

		const v6db = await _openForTest(name);
		const all = await getAllRows(v6db);

		expect(all).toHaveLength(1);
		expect(all[0].deleted_at).toBe('2020-06-01T00:00:00.000Z');
	});

	it('recreates a plain global-uniqueness index in place of the per-list one', async () => {
		const name = `streamq-migration-test-${Math.random()}`;
		const v5db = await openV5(name);
		await addV5Row(v5db, makeV5Row(1, { queue_tag: 'Horror' }));
		v5db.close();

		const v6db = await _openForTest(name);
		const store = v6db.transaction('watchlist').objectStore('watchlist');
		expect(store.indexNames.contains('tmdb_media_list')).toBe(false);
		expect(store.indexNames.contains('tmdb_media')).toBe(true);
		// Collision behavior over the new index is covered end-to-end via the
		// real db.addItem() API in db.test.ts's "global uniqueness restored"
		// tests — this just confirms the index itself is the one that shipped.
	});
});
