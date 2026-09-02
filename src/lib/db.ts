import type { WatchlistItem, Provider } from './types';

const DB_NAME = 'streamq';
const STORE = 'watchlist';
const SERVICES_STORE = 'services';
const META_STORE = 'meta';
const VERSION = 4;

let _dbPromise: Promise<IDBDatabase> | null = null;

// ── Clock-skew correction (#101) ────────────────────────────────────────────
// A device with a wrong wall clock either pins a stale row forever (clock
// ahead of the pack) or loses every LWW conflict (clock behind) once sync is
// on. The sync engine learns the real offset from the server's `Date`
// response header on every PUT and calls setClockOffsetMs(); every write in
// this file stamps updated_at through nowIso() so the correction actually
// reaches the timestamps LWW compares. In-memory only (reset on reload) is
// the "minimum viable" version — good enough since the offset is relearned
// on the very next sync.
let clockOffsetMs = 0;

export function setClockOffsetMs(ms: number): void {
	clockOffsetMs = ms;
}

export function nowIso(): string {
	return new Date(Date.now() + clockOffsetMs).toISOString();
}

// ── Mutation notifications (#101) ───────────────────────────────────────────
// The sync engine needs a "debounced after mutation" trigger, but wiring
// every action module (queue-actions, import-actions, settings-actions, ...)
// to know about sync would spread that concern everywhere. Instead every
// write in this file calls notifyMutation() once it commits, and sync.ts
// subscribes a single debounced listener at startup via onMutation().
const mutationListeners: (() => void)[] = [];

export function onMutation(cb: () => void): void {
	mutationListeners.push(cb);
}

function notifyMutation(): void {
	for (const cb of mutationListeners) cb();
}

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
			// Backfill an initial custom order (#216) so "Rank" sort has a
			// deterministic starting point instead of every existing row sharing
			// undefined — natural key order (== insertion order, since ids
			// autoIncrement) is as good a starting point as any. Must not run
			// concurrently with the v3 cursor below: two cursors doing
			// read-modify-write over the same store in one versionchange
			// transaction each hold their own snapshot of a row, so whichever
			// commits second clobbers the other's field — hence this only ever
			// starts once that cursor (if it ran at all) has finished.
			function backfillSortOrder() {
				const store = tx.objectStore(STORE);
				const cursorReq = store.openCursor();
				let i = 0;
				cursorReq.onsuccess = () => {
					const cursor = cursorReq.result;
					if (!cursor) return;
					const item = cursor.value as WatchlistItem;
					if (item.sort_order === undefined) {
						item.sort_order = i;
						cursor.update(item);
					}
					i++;
					cursor.continue();
				};
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
					if (!cursor) {
						if (oldVersion < 4) backfillSortOrder();
						return;
					}
					const item = cursor.value as WatchlistItem;
					if (!item.updated_at) {
						item.updated_at = item.added_at ?? new Date().toISOString();
						cursor.update(item);
					}
					cursor.continue();
				};
			} else if (oldVersion < 4) {
				backfillSortOrder();
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
): Promise<WatchlistItem> {
	const db = await open();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(STORE, 'readwrite');
		const store = tx.objectStore(STORE);
		// JSON round-trip strips Svelte 5 reactive Proxies — structuredClone cannot clone them
		const plain = JSON.parse(JSON.stringify(item)) as typeof item;
		const now = nowIso();
		// New items land at the end of custom "Rank" order (#216). count()
		// includes tombstones, so this can overshoot the true number of visible
		// items — harmless, since sort_order only needs to exceed every existing
		// value, not be contiguous.
		const countReq = store.count();
		countReq.onsuccess = () => {
			const full: Omit<WatchlistItem, 'id'> = {
				...plain,
				added_at: now,
				watched_at: null,
				updated_at: now,
				sort_order: countReq.result
			};
			const addReq = store.add(full);
			addReq.onsuccess = () => {
				notifyMutation();
				resolve({ ...full, id: addReq.result as number });
			};
			addReq.onerror = () => reject(addReq.error);
		};
		countReq.onerror = () => reject(countReq.error);
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
			const now = nowIso();
			item.deleted_at = now;
			item.updated_at = now;
			const put = store.put(item);
			put.onsuccess = () => {
				notifyMutation();
				resolve();
			};
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

/**
 * Shared get→mutate→put transaction for the single-item write paths below —
 * they differ only in which 1-3 fields they touch. `now` is threaded into
 * `mutate` so a field that should carry the exact same instant as
 * `updated_at` (e.g. setWatched's watched_at) doesn't need a second
 * `nowIso()` call. Pass `stampUpdatedAt: false` for a write that must not
 * win a sync LWW merge against a real edit — see patchProviders.
 */
async function mutateItem(
	id: number,
	mutate: (item: WatchlistItem, now: string) => void,
	opts: { stampUpdatedAt?: boolean } = {}
): Promise<void> {
	const { stampUpdatedAt = true } = opts;
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
			const now = nowIso();
			mutate(item, now);
			if (stampUpdatedAt) item.updated_at = now;
			const put = store.put(item);
			put.onsuccess = () => {
				notifyMutation();
				resolve();
			};
			put.onerror = () => reject(put.error);
		};
		get.onerror = () => reject(get.error);
	});
}

export async function setWatched(id: number, watched: boolean): Promise<void> {
	return mutateItem(id, (item, now) => {
		item.watched_at = watched ? now : null;
	});
}

/**
 * Looks up an item by the same [tmdb_id, media_type] key the store's unique
 * index enforces — used when an `add()` hits that constraint, to tell the
 * caller which existing row it collided with (and its list) instead of just
 * "duplicate". Returns tombstoned rows too, same as the index itself does;
 * callers that only care about active items should check `deleted_at`.
 */
export async function getItemByTmdbId(
	tmdb_id: number,
	media_type: WatchlistItem['media_type']
): Promise<WatchlistItem | undefined> {
	const db = await open();
	return new Promise((resolve, reject) => {
		const req = db
			.transaction(STORE)
			.objectStore(STORE)
			.index('tmdb_media')
			.get([tmdb_id, media_type]);
		req.onsuccess = () => resolve(req.result as WatchlistItem | undefined);
		req.onerror = () => reject(req.error);
	});
}

/** Character cap for a personal note (#155) — generous but bounded, same
 * enforcement point as the other free-text-ish fields (see parseBackupItem). */
export const NOTE_MAX_LENGTH = 2000;

export async function setNote(id: number, notes: string | null): Promise<void> {
	return mutateItem(id, (item) => {
		item.notes = notes ? notes.slice(0, NOTE_MAX_LENGTH) : undefined;
	});
}

export async function setQueueTag(id: number, tag: string | null): Promise<void> {
	return mutateItem(id, (item) => {
		item.queue_tag = tag ?? undefined;
	});
}

/**
 * Bulk-reassigns sort_order to match `orderedIds` — the custom "Rank" sort
 * mode's move-up/move-down (#216). Renumbers only the given ids (typically
 * the currently visible/filtered list); ids left out keep their existing
 * value, same "not atomic across a batch write" tradeoff already accepted
 * for renameCollectionTag. Rides the existing whole-item LWW sync merge for
 * free — no separate merge rule needed, same as every other field here.
 */
export async function setSortOrder(orderedIds: number[]): Promise<void> {
	const db = await open();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(STORE, 'readwrite');
		const store = tx.objectStore(STORE);
		const now = nowIso();
		orderedIds.forEach((id, index) => {
			const get = store.get(id);
			get.onsuccess = () => {
				const item = get.result as WatchlistItem | undefined;
				if (!item) return;
				item.sort_order = index;
				item.updated_at = now;
				store.put(item);
			};
		});
		tx.oncomplete = () => {
			notifyMutation();
			resolve();
		};
		tx.onerror = () => reject(tx.error);
	});
}

export async function updateShowProgress(id: number, watchedSeasons: number[]): Promise<void> {
	return mutateItem(id, (item) => {
		item.watched_seasons = watchedSeasons;
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
	director_id?: number | null,
	creator?: string | null,
	imdb_id?: string | null
): Promise<void> {
	return mutateItem(
		id,
		(item) => {
			item.providers = providers;
			item.rentable = rentable;
			item.release = release;
			if (seasons && seasons.length > 0) item.seasons = seasons;
			if (runtime_minutes != null) item.runtime_minutes = runtime_minutes;
			if (genres !== undefined) item.genres = genres;
			if (cast !== undefined) item.cast = cast;
			if (director !== undefined) item.director = director;
			if (director_id !== undefined) item.director_id = director_id;
			if (creator !== undefined) item.creator = creator;
			if (imdb_id !== undefined) item.imdb_id = imdb_id;
		},
		// Refreshed TMDB metadata is regenerable, not a user edit, so it must
		// not stamp updated_at — doing so would let it win a sync LWW merge
		// against a real edit made on another device in the meantime.
		{ stampUpdatedAt: false }
	);
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
		const now = nowIso();
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
		tx.oncomplete = () => {
			notifyMutation();
			resolve();
		};
		tx.onerror = () => reject(tx.error);
	});
}

/** Clears a collection tag across all matching, non-deleted items. See renameCollectionTag for why this is a cursor, not replaceAll(). */
export async function clearCollectionTag(name: string): Promise<void> {
	const db = await open();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(STORE, 'readwrite');
		const store = tx.objectStore(STORE);
		const now = nowIso();
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
		tx.oncomplete = () => {
			notifyMutation();
			resolve();
		};
		tx.onerror = () => reject(tx.error);
	});
}

/**
 * Replaces the entire store, id-for-id. Called by imports/restores, and by
 * the sync engine with a merged snapshot: items that matched an existing
 * local row (by [tmdb_id, media_type]) carry that row's id so `put()`
 * overwrites it in place; genuinely new items omit `id` and the store's key
 * generator assigns one. Never renumbers existing ids and never drops a
 * caller-supplied updated_at — both are exactly what sync depends on to stay
 * idempotent.
 *
 * `silent` skips the mutation notification — the sync engine passes this
 * when writing back its own merge result, so applying a pull doesn't
 * immediately schedule another push of the data that was just pulled.
 */
export async function replaceAll(
	items: (Omit<WatchlistItem, 'id'> & { id?: number })[],
	opts: { silent?: boolean } = {}
): Promise<void> {
	const db = await open();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(STORE, 'readwrite');
		const store = tx.objectStore(STORE);
		store.clear();
		const now = nowIso();
		for (const item of items) store.put({ ...item, updated_at: item.updated_at ?? now });
		tx.oncomplete = () => {
			if (!opts.silent) notifyMutation();
			resolve();
		};
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

export async function setServices(
	services: Provider[],
	opts: { silent?: boolean } = {}
): Promise<void> {
	const db = await open();
	await new Promise<void>((resolve, reject) => {
		const tx = db.transaction(SERVICES_STORE, 'readwrite');
		const store = tx.objectStore(SERVICES_STORE);
		store.clear();
		for (const s of services) store.put(s);
		tx.oncomplete = () => resolve();
		tx.onerror = () => reject(tx.error);
	});
	// Services sync as a single LWW register (#101), not per-row tombstones —
	// it's a small set of ids, so one timestamp for "the set changed" is enough.
	if (!opts.silent) {
		await setMeta('services_updated_at', nowIso());
		notifyMutation();
	}
}

const SYNC_DEK_KEY = 'sync_dek';

/**
 * The unwrapped sync DEK, held as a non-extractable CryptoKey (#101) —
 * CryptoKey objects are structured-cloneable, so they survive reload without
 * the raw key bytes ever touching JS. Goes through the meta store directly
 * rather than getMeta/setMeta, whose signature is string-only.
 */
export async function getSyncDek(): Promise<CryptoKey | undefined> {
	const db = await open();
	return new Promise((resolve, reject) => {
		const req = db.transaction(META_STORE).objectStore(META_STORE).get(SYNC_DEK_KEY);
		req.onsuccess = () =>
			resolve((req.result as { key: string; value: CryptoKey } | undefined)?.value);
		req.onerror = () => reject(req.error);
	});
}

export async function setSyncDek(dek: CryptoKey): Promise<void> {
	const db = await open();
	return new Promise((resolve, reject) => {
		const req = db
			.transaction(META_STORE, 'readwrite')
			.objectStore(META_STORE)
			.put({ key: SYNC_DEK_KEY, value: dek });
		req.onsuccess = () => resolve();
		req.onerror = () => reject(req.error);
	});
}

export async function clearSyncDek(): Promise<void> {
	const db = await open();
	return new Promise((resolve, reject) => {
		const req = db
			.transaction(META_STORE, 'readwrite')
			.objectStore(META_STORE)
			.delete(SYNC_DEK_KEY);
		req.onsuccess = () => resolve();
		req.onerror = () => reject(req.error);
	});
}

const USER_PRIVATE_KEY = 'user_private_key';

/**
 * The account's unwrapped RSA private key (#189), held the same way as the
 * sync DEK: a non-extractable CryptoKey, structured-cloned into IndexedDB so
 * it survives reload without the raw PKCS8 bytes ever sitting in JS. Used to
 * unwrap Collection DEKs that other members wrapped under the matching public
 * key.
 */
export async function getUserPrivateKey(): Promise<CryptoKey | undefined> {
	const db = await open();
	return new Promise((resolve, reject) => {
		const req = db.transaction(META_STORE).objectStore(META_STORE).get(USER_PRIVATE_KEY);
		req.onsuccess = () =>
			resolve((req.result as { key: string; value: CryptoKey } | undefined)?.value);
		req.onerror = () => reject(req.error);
	});
}

export async function setUserPrivateKey(key: CryptoKey): Promise<void> {
	const db = await open();
	return new Promise((resolve, reject) => {
		const req = db
			.transaction(META_STORE, 'readwrite')
			.objectStore(META_STORE)
			.put({ key: USER_PRIVATE_KEY, value: key });
		req.onsuccess = () => resolve();
		req.onerror = () => reject(req.error);
	});
}

export async function clearUserPrivateKey(): Promise<void> {
	const db = await open();
	return new Promise((resolve, reject) => {
		const req = db
			.transaction(META_STORE, 'readwrite')
			.objectStore(META_STORE)
			.delete(USER_PRIVATE_KEY);
		req.onsuccess = () => resolve();
		req.onerror = () => reject(req.error);
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
	const wasAdded = await new Promise<boolean>((resolve, reject) => {
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
	await setMeta('services_updated_at', nowIso());
	notifyMutation();
	return wasAdded;
}
