import type { WatchlistItem, Provider } from './types';

const DB_NAME = 'streamq';
const STORE = 'watchlist';
const SERVICES_STORE = 'services';
const META_STORE = 'meta';
const VERSION = 3;

let _dbPromise: Promise<IDBDatabase> | null = null;

function open(name = DB_NAME): Promise<IDBDatabase> {
	if (name === DB_NAME && _dbPromise) return _dbPromise;
	const promise = new Promise<IDBDatabase>((resolve, reject) => {
		const req = indexedDB.open(name, VERSION);
		req.onupgradeneeded = (e) => {
			const db = (e.target as IDBOpenDBRequest).result;
			const tx = (e.target as IDBOpenDBRequest).transaction!;
			const oldVersion = e.oldVersion;

			if (oldVersion < 1) {
				const store = db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
				store.createIndex('tmdb_media', ['tmdb_id', 'media_type'], { unique: true });
			}
			if (oldVersion < 2) {
				if (!db.objectStoreNames.contains(SERVICES_STORE)) {
					db.createObjectStore(SERVICES_STORE, { keyPath: 'provider_id' });
				}
			}
			if (oldVersion < 3) {
				if (!db.objectStoreNames.contains(META_STORE)) {
					db.createObjectStore(META_STORE, { keyPath: 'key' });
				}
				// Backfill updated_at for pre-existing rows so LWW sync has a
				// timestamp to compare from day one.
				const store = tx.objectStore(STORE);
				const cursorReq = store.openCursor();
				cursorReq.onsuccess = () => {
					const cursor = cursorReq.result;
					if (!cursor) return;
					const item = cursor.value as WatchlistItem;
					if (!item.updated_at) {
						item.updated_at = item.added_at ?? new Date().toISOString();
						cursor.update(item);
					}
					cursor.continue();
				};
			}
		};
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => {
			if (name === DB_NAME) _dbPromise = null;
			reject(req.error);
		};
	});
	if (name === DB_NAME) _dbPromise = promise;
	return promise;
}

export async function getAll(): Promise<WatchlistItem[]> {
	const db = await open();
	return new Promise((resolve, reject) => {
		const req = db.transaction(STORE).objectStore(STORE).getAll();
		req.onsuccess = () => {
			const all = req.result as WatchlistItem[];
			resolve(all.filter((item) => !item.deleted_at));
		};
		req.onerror = () => reject(req.error);
	});
}

/** Includes soft-deleted rows (tombstones) — for the sync engine, which needs to see and propagate deletions. UI code should use getAll(). */
export async function getAllIncludingDeleted(): Promise<WatchlistItem[]> {
	const db = await open();
	return new Promise((resolve, reject) => {
		const req = db.transaction(STORE).objectStore(STORE).getAll();
		req.onsuccess = () => resolve(req.result as WatchlistItem[]);
		req.onerror = () => reject(req.error);
	});
}

export async function addItem(
	item: Omit<WatchlistItem, 'id' | 'added_at' | 'watched_at' | 'updated_at'>
): Promise<void> {
	const db = await open();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(STORE, 'readwrite');
		// JSON round-trip strips Svelte 5 reactive Proxies — structuredClone cannot clone them
		const plain = JSON.parse(JSON.stringify(item)) as typeof item;
		const now = new Date().toISOString();
		const full: Omit<WatchlistItem, 'id'> = {
			...plain,
			added_at: now,
			watched_at: null,
			updated_at: now
		};
		const req = tx.objectStore(STORE).add(full);
		req.onsuccess = () => resolve();
		req.onerror = () => reject(req.error);
	});
}

/**
 * Soft-deletes: writes a deleted_at tombstone instead of removing the row.
 * A hard delete would let deletions get silently undone by sync — device A
 * removes a title, device B still has it, and without a trace of the
 * deletion, B's copy looks like a legitimate record A just doesn't have yet.
 * No-ops if the id doesn't exist (matching the old hard-delete's behavior).
 *
 * Tradeoff: a device offline longer than the GC horizon (see gcTombstones)
 * can resurrect a deletion — its copy outlives the tombstone that would
 * have suppressed it. 90 days makes this vanishingly rare for a personal
 * queue app, but it's a real, deliberate property of this design.
 */
export async function removeItem(id: number): Promise<void> {
	const db = await open();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(STORE, 'readwrite');
		const store = tx.objectStore(STORE);
		const get = store.get(id);
		get.onsuccess = () => {
			const item = get.result as WatchlistItem | undefined;
			if (!item) {
				resolve();
				return;
			}
			const now = new Date().toISOString();
			item.deleted_at = now;
			item.updated_at = now;
			const put = store.put(item);
			put.onsuccess = () => resolve();
			put.onerror = () => reject(put.error);
		};
		get.onerror = () => reject(get.error);
	});
}

const TOMBSTONE_GC_HORIZON_MS = 90 * 24 * 60 * 60 * 1000; // 90 days

/**
 * Permanently drops tombstones older than the GC horizon, so the store
 * doesn't grow forever. Returns the number of rows removed. Safe to call
 * opportunistically (e.g. on queue load) — cheap no-op when there's nothing
 * to collect.
 */
export async function gcTombstones(now: Date = new Date()): Promise<number> {
	const db = await open();
	const cutoff = now.getTime() - TOMBSTONE_GC_HORIZON_MS;
	return new Promise((resolve, reject) => {
		const tx = db.transaction(STORE, 'readwrite');
		const store = tx.objectStore(STORE);
		let removed = 0;
		const cursorReq = store.openCursor();
		cursorReq.onsuccess = () => {
			const cursor = cursorReq.result;
			if (!cursor) return;
			const item = cursor.value as WatchlistItem;
			if (item.deleted_at && new Date(item.deleted_at).getTime() < cutoff) {
				cursor.delete();
				removed++;
			}
			cursor.continue();
		};
		cursorReq.onerror = () => reject(cursorReq.error);
		tx.oncomplete = () => resolve(removed);
		tx.onerror = () => reject(tx.error);
	});
}

export async function setWatched(id: number, watched: boolean): Promise<void> {
	const db = await open();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(STORE, 'readwrite');
		const store = tx.objectStore(STORE);
		const get = store.get(id);
		get.onsuccess = () => {
			const item = get.result as WatchlistItem | undefined;
			if (!item) {
				reject(new Error(`Item with id ${id} not found`));
				return;
			}
			const now = new Date().toISOString();
			item.watched_at = watched ? now : null;
			item.updated_at = now;
			const put = store.put(item);
			put.onsuccess = () => resolve();
			put.onerror = () => reject(put.error);
		};
		get.onerror = () => reject(get.error);
	});
}

export async function setQueueTag(id: number, tag: string | null): Promise<void> {
	const db = await open();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(STORE, 'readwrite');
		const store = tx.objectStore(STORE);
		const get = store.get(id);
		get.onsuccess = () => {
			const item = get.result as WatchlistItem | undefined;
			if (!item) {
				reject(new Error(`Item with id ${id} not found`));
				return;
			}
			item.queue_tag = tag ?? undefined;
			item.updated_at = new Date().toISOString();
			const put = store.put(item);
			put.onsuccess = () => resolve();
			put.onerror = () => reject(put.error);
		};
		get.onerror = () => reject(get.error);
	});
}

export async function updateShowProgress(id: number, watchedSeasons: number[]): Promise<void> {
	const db = await open();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(STORE, 'readwrite');
		const store = tx.objectStore(STORE);
		const get = store.get(id);
		get.onsuccess = () => {
			const item = get.result as WatchlistItem | undefined;
			if (!item) {
				reject(new Error(`Item with id ${id} not found`));
				return;
			}
			item.watched_seasons = watchedSeasons;
			item.updated_at = new Date().toISOString();
			const put = store.put(item);
			put.onsuccess = () => resolve();
			put.onerror = () => reject(put.error);
		};
		get.onerror = () => reject(get.error);
	});
}

export async function patchProviders(
	id: number,
	providers: WatchlistItem['providers'],
	rentable: boolean,
	release: WatchlistItem['release'],
	seasons?: WatchlistItem['seasons'],
	runtime_minutes?: number | null,
	genres?: string[],
	cast?: WatchlistItem['cast'],
	director?: string | null,
	creator?: string | null
): Promise<void> {
	const db = await open();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(STORE, 'readwrite');
		const store = tx.objectStore(STORE);
		const get = store.get(id);
		get.onsuccess = () => {
			const item = get.result as WatchlistItem | undefined;
			if (!item) {
				reject(new Error(`Item with id ${id} not found`));
				return;
			}
			item.providers = providers;
			item.rentable = rentable;
			item.release = release;
			if (seasons && seasons.length > 0) item.seasons = seasons;
			if (runtime_minutes != null) item.runtime_minutes = runtime_minutes;
			if (genres !== undefined) item.genres = genres;
			if (cast !== undefined) item.cast = cast;
			if (director !== undefined) item.director = director;
			if (creator !== undefined) item.creator = creator;
			const put = store.put(item);
			put.onsuccess = () => resolve();
			put.onerror = () => reject(put.error);
		};
		get.onerror = () => reject(get.error);
	});
}

/**
 * Bulk-renames a collection tag across all matching, non-deleted items via a
 * cursor — not getAll()+replaceAll(), which would clear the whole store and
 * silently drop any tombstones sitting in it (getAll() filters them out, so
 * they'd never make it into the replacement set).
 */
export async function renameCollectionTag(oldName: string, newName: string): Promise<void> {
	const db = await open();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(STORE, 'readwrite');
		const store = tx.objectStore(STORE);
		const now = new Date().toISOString();
		const cursorReq = store.openCursor();
		cursorReq.onsuccess = () => {
			const cursor = cursorReq.result;
			if (!cursor) return;
			const item = cursor.value as WatchlistItem;
			if (!item.deleted_at && item.queue_tag === oldName) {
				item.queue_tag = newName;
				item.updated_at = now;
				cursor.update(item);
			}
			cursor.continue();
		};
		cursorReq.onerror = () => reject(cursorReq.error);
		tx.oncomplete = () => resolve();
		tx.onerror = () => reject(tx.error);
	});
}

/** Clears a collection tag across all matching, non-deleted items. See renameCollectionTag for why this is a cursor, not replaceAll(). */
export async function clearCollectionTag(name: string): Promise<void> {
	const db = await open();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(STORE, 'readwrite');
		const store = tx.objectStore(STORE);
		const now = new Date().toISOString();
		const cursorReq = store.openCursor();
		cursorReq.onsuccess = () => {
			const cursor = cursorReq.result;
			if (!cursor) return;
			const item = cursor.value as WatchlistItem;
			if (!item.deleted_at && item.queue_tag === name) {
				item.queue_tag = undefined;
				item.updated_at = now;
				cursor.update(item);
			}
			cursor.continue();
		};
		cursorReq.onerror = () => reject(cursorReq.error);
		tx.oncomplete = () => resolve();
		tx.onerror = () => reject(tx.error);
	});
}

export async function replaceAll(
	items: (Omit<WatchlistItem, 'id'> & { id?: number })[]
): Promise<void> {
	const db = await open();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(STORE, 'readwrite');
		const store = tx.objectStore(STORE);
		store.clear();
		const now = new Date().toISOString();
		for (const item of items) store.put({ ...item, updated_at: item.updated_at ?? now });
		tx.oncomplete = () => resolve();
		tx.onerror = () => reject(tx.error);
	});
}

export async function getServices(): Promise<Provider[]> {
	const db = await open();
	return new Promise((resolve, reject) => {
		const req = db.transaction(SERVICES_STORE).objectStore(SERVICES_STORE).getAll();
		req.onsuccess = () => resolve(req.result as Provider[]);
		req.onerror = () => reject(req.error);
	});
}

export async function setServices(services: Provider[]): Promise<void> {
	const db = await open();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(SERVICES_STORE, 'readwrite');
		const store = tx.objectStore(SERVICES_STORE);
		store.clear();
		for (const s of services) store.put(s);
		tx.oncomplete = () => resolve();
		tx.onerror = () => reject(tx.error);
	});
}

export async function getMeta(key: string): Promise<string | undefined> {
	const db = await open();
	return new Promise((resolve, reject) => {
		const req = db.transaction(META_STORE).objectStore(META_STORE).get(key);
		req.onsuccess = () =>
			resolve((req.result as { key: string; value: string } | undefined)?.value);
		req.onerror = () => reject(req.error);
	});
}

export async function setMeta(key: string, value: string): Promise<void> {
	const db = await open();
	return new Promise((resolve, reject) => {
		const req = db.transaction(META_STORE, 'readwrite').objectStore(META_STORE).put({ key, value });
		req.onsuccess = () => resolve();
		req.onerror = () => reject(req.error);
	});
}

/** Test-only: opens a database by name, bypassing the memoized default-name connection, so migration tests can exercise `onupgradeneeded` against a fresh/versioned database without colliding with the app's own open connection. */
export function _openForTest(name: string): Promise<IDBDatabase> {
	return open(name);
}

/** Stable per-browser-install id, used as the sync client id. Generated once and persisted in the meta store. */
export async function getDeviceId(): Promise<string> {
	const existing = await getMeta('device_id');
	if (existing) return existing;
	const id = crypto.randomUUID();
	await setMeta('device_id', id);
	return id;
}

export async function toggleService(service: Provider): Promise<boolean> {
	const id = service.provider_id;
	const plain: Provider = {
		provider_id: id,
		provider_name: service.provider_name,
		logo_path: service.logo_path
	};
	const db = await open();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(SERVICES_STORE, 'readwrite');
		const store = tx.objectStore(SERVICES_STORE);
		const getReq = store.get(id);
		getReq.onsuccess = () => {
			if (getReq.result) {
				store.delete(id);
				tx.oncomplete = () => resolve(false);
			} else {
				store.put(plain);
				tx.oncomplete = () => resolve(true);
			}
		};
		getReq.onerror = () => reject(getReq.error);
		tx.onerror = () => reject(tx.error);
	});
}
