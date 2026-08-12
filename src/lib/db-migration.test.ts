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

describe('db migration v2 -> v3', () => {
	it('adds the meta store and backfills updated_at on pre-existing rows', async () => {
		const name = `streamq-migration-test-${Math.random()}`;

		const v2db = await openV2(name);
		await new Promise<void>((resolve, reject) => {
			const tx = v2db.transaction('watchlist', 'readwrite');
			tx.objectStore('watchlist').add({
				tmdb_id: 1,
				media_type: 'movie',
				title: 'Old Row',
				poster_path: null,
				overview: null,
				providers: [],
				runtime_minutes: 90,
				seasons: [],
				watched_seasons: [],
				added_at: '2020-01-01T00:00:00.000Z',
				watched_at: null
			});
			tx.oncomplete = () => resolve();
			tx.onerror = () => reject(tx.error);
		});
		v2db.close();

		const v3db = await _openForTest(name);
		expect(v3db.objectStoreNames.contains('meta')).toBe(true);

		const rows = await new Promise<{ added_at: string; updated_at?: string }[]>(
			(resolve, reject) => {
				const req = v3db.transaction('watchlist').objectStore('watchlist').getAll();
				req.onsuccess = () => resolve(req.result);
				req.onerror = () => reject(req.error);
			}
		);
		expect(rows).toHaveLength(1);
		expect(rows[0].updated_at).toBe('2020-01-01T00:00:00.000Z');
	});
});
