import type { WatchlistItem, Provider } from './types';

const DB_NAME = 'streamq';
const STORE = 'watchlist';
const SERVICES_STORE = 'services';
const META_STORE = 'meta';
const VERSION = 6;
const TMDB_MEDIA_INDEX = 'tmdb_media'; // v1–v4, v6+: global-uniqueness index
const TMDB_MEDIA_LIST_INDEX = 'tmdb_media_list'; // v5 only: per-list uniqueness index, removed in v6

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
				store.createIndex(TMDB_MEDIA_INDEX, ['tmdb_id', 'media_type'], { unique: true });
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
					if (!cursor) {
						if (oldVersion < 5) normalizeQueueTagsAndReindex();
						return;
					}
					const item = cursor.value as WatchlistItem;
					if (item.sort_order === undefined) {
						item.sort_order = i;
						cursor.update(item);
					}
					i++;
					cursor.continue();
				};
			}

			// Swaps the global-uniqueness index for the per-list one (#221),
			// after normalizing every row's queue_tag to QUEUE_TAG_NONE instead
			// of undefined/null — see the constant's own comment for why that
			// has to happen first. Chained after backfillSortOrder for the same
			// reason backfillSortOrder is chained after the v3 cursor: one
			// read-modify-write cursor over the store at a time within a single
			// versionchange transaction. Creating the new unique index only
			// after every row is normalized is also what makes the index
			// creation itself safe — the old index already guaranteed at most
			// one row per [tmdb_id, media_type], so there's no way for the
			// backfill to produce a duplicate [tmdb_id, media_type, queue_tag]
			// for the new index to reject.
			//
			// Superseded by collapseQueueTags() (#274) one version later, which
			// undoes the per-list index entirely — kept exactly as it shipped
			// rather than folded together, so a v1-or-later device jumping
			// straight to v6 still replays every intermediate version's step in
			// full, same as this file already does for every other multi-version
			// jump. QUEUE_TAG_NONE only ever needs to exist for the one release
			// (v5) that actually shipped with the per-list index live; every
			// row this function normalizes gets that sentinel translated into a
			// real queue_tags entry (or nothing, for "no list") by
			// collapseQueueTags() immediately after.
			const QUEUE_TAG_NONE = '';
			function normalizeQueueTagsAndReindex() {
				const store = tx.objectStore(STORE);
				if (store.indexNames.contains(TMDB_MEDIA_INDEX)) {
					store.deleteIndex(TMDB_MEDIA_INDEX);
				}
				const cursorReq = store.openCursor();
				cursorReq.onsuccess = () => {
					const cursor = cursorReq.result;
					if (!cursor) {
						if (!store.indexNames.contains(TMDB_MEDIA_LIST_INDEX)) {
							store.createIndex(TMDB_MEDIA_LIST_INDEX, ['tmdb_id', 'media_type', 'queue_tag'], {
								unique: true
							});
						}
						if (oldVersion < 6) collapseQueueTags();
						return;
					}
					const item = cursor.value as LegacyV5Row;
					if (item.queue_tag === undefined || item.queue_tag === null) {
						item.queue_tag = QUEUE_TAG_NONE;
						cursor.update(item);
					}
					cursor.continue();
				};
			}

			// A row as it exists once normalizeQueueTagsAndReindex has run:
			// every row's queue_tag is a real string (the sentinel for "no
			// list", or a real list name) — never undefined/null. This is the
			// guaranteed input shape collapseQueueTags below reads, regardless
			// of whether a device is jumping from v1 all the way to v6 or was
			// already sitting at v5.
			type LegacyV5Row = Omit<WatchlistItem, 'queue_tags'> & { queue_tag: string };

			/**
			 * Collapses row-per-list-membership back to one row per title
			 * (#274) — #221 let the same title occupy more than one row (one
			 * per list), and each row's watched_at/notes/watched_seasons/
			 * sort_order diverged independently between them. Every row within
			 * one title's group is guaranteed a *distinct* queue_tag by the
			 * per-list unique index that's still live at this point (an
			 * untagged row's queue_tag is the QUEUE_TAG_NONE sentinel, not
			 * undefined, so it participates in that guarantee too) — so
			 * folding a group's tags into one map can never collide on a key.
			 *
			 * Two-phase, unlike every other migration in this file's single
			 * read-modify-write cursor pass: deciding one row's fate requires
			 * seeing every other row sharing its [tmdb_id, media_type], which
			 * an independent-row cursor can't do. Phase 1 buffers the whole
			 * store (bounded by one person's watchlist — the same order of
			 * magnitude getAll()/replaceAll() already assume); phase 2
			 * computes the collapsed set in memory and rewrites the store via
			 * clear()+put() rather than update()+delete() per row, mirroring
			 * replaceAll()'s existing whole-store-rewrite shape. Reusing a
			 * surviving row's own id via an explicit put() doesn't disturb the
			 * autoIncrement counter — per spec, put()/add() with an in-line key
			 * only ever raises the generator, never lowers it, and every id
			 * reused here was already issued before clear() ran.
			 */
			function collapseQueueTags() {
				const store = tx.objectStore(STORE);
				const rows: LegacyV5Row[] = [];
				const cursorReq = store.openCursor();
				cursorReq.onsuccess = () => {
					const cursor = cursorReq.result;
					if (cursor) {
						rows.push(cursor.value as LegacyV5Row);
						cursor.continue();
						return;
					}

					const groups = new Map<string, LegacyV5Row[]>();
					for (const row of rows) {
						const key = `${row.media_type}:${row.tmdb_id}`;
						const group = groups.get(key);
						if (group) group.push(row);
						else groups.set(key, [row]);
					}

					store.clear();
					for (const group of groups.values()) store.put(collapseGroup(group));

					if (store.indexNames.contains(TMDB_MEDIA_LIST_INDEX)) {
						store.deleteIndex(TMDB_MEDIA_LIST_INDEX);
					}
					if (!store.indexNames.contains(TMDB_MEDIA_INDEX)) {
						store.createIndex(TMDB_MEDIA_INDEX, ['tmdb_id', 'media_type'], { unique: true });
					}
				};
			}

			function collapseGroup(rows: LegacyV5Row[]): WatchlistItem {
				if (rows.length === 1) {
					// Trivial case: nothing to merge. A literal passthrough — not
					// just "produces the same values" but genuinely untouched, so
					// re-running this over already-one-row-per-title data (the
					// common case, and what every upgrade converges to) never
					// bumps updated_at. Bumping it here would hand every
					// un-duplicated row an artificially fresh timestamp on
					// upgrade, which could beat a real pending edit sitting
					// unsynced on another device that hasn't upgraded yet.
					const { queue_tag, ...rest } = rows[0];
					return {
						...rest,
						queue_tags: queue_tag
							? { [queue_tag]: { at: rows[0].updated_at ?? rows[0].added_at } }
							: undefined
					};
				}

				const anyLive = rows.some((r) => !r.deleted_at);
				const survivor = [...rows].sort((a, b) => {
					const byAdded = a.added_at.localeCompare(b.added_at);
					return byAdded !== 0 ? byAdded : a.id - b.id;
				})[0];

				// Each row's tag is unique within the group (see the function's
				// own doc comment), so this can never overwrite a key it just
				// set. A tombstoned row's tag becomes a tombstone entry, not a
				// live one — otherwise a title removed from a list could
				// resurrect that membership purely by sharing a collapse group
				// with a live row under a different list.
				const queue_tags: NonNullable<WatchlistItem['queue_tags']> = {};
				for (const row of rows) {
					if (!row.queue_tag) continue; // the "no list" sentinel
					const at = row.updated_at ?? row.added_at;
					queue_tags[row.queue_tag] = row.deleted_at
						? { at: row.deleted_at, deleted: true }
						: { at, rank: row.sort_order };
				}

				const watchedTimes = rows
					.map((r) => r.watched_at)
					.filter((t): t is string => !!t)
					.sort();
				const watched_seasons = Array.from(
					new Set(rows.flatMap((r) => r.watched_seasons ?? []))
				).sort((a, b) => a - b);
				const added_at = rows.reduce(
					(min, r) => (r.added_at < min ? r.added_at : min),
					rows[0].added_at
				);
				const tombstoneDates = rows
					.map((r) => r.deleted_at)
					.filter((d): d is string => !!d)
					.sort();

				const { queue_tag: _tag, notes: _notes, ...rest } = survivor;
				const notes = collapseNotes(rows);
				return {
					...rest,
					added_at,
					deleted_at: anyLive ? null : (tombstoneDates.at(-1) ?? nowIso()),
					watched_at: watchedTimes[0] ?? null,
					watched_seasons,
					queue_tags: Object.keys(queue_tags).length ? queue_tags : undefined,
					updated_at: nowIso(),
					...(notes ? { notes } : {})
				};
			}

			/** Concatenates every distinct, non-empty note across a collapsed
			 *  group, oldest-edited first, truncated at NOTE_MAX_LENGTH with a
			 *  visible marker — the one field in this migration that can
			 *  otherwise destroy something the user actually typed. */
			function collapseNotes(rows: LegacyV5Row[]): string | undefined {
				const seen = new Set<string>();
				const distinct = rows
					.filter((r) => r.notes && r.notes.trim())
					.sort((a, b) => (a.updated_at ?? a.added_at).localeCompare(b.updated_at ?? b.added_at))
					.map((r) => r.notes!.trim())
					.filter((n) => (seen.has(n) ? false : (seen.add(n), true)));

				if (distinct.length === 0) return undefined;
				const joined = distinct.join('\n\n---\n\n');
				if (joined.length <= NOTE_MAX_LENGTH) return joined;
				const marker = '\n\n[…truncated]';
				return joined.slice(0, NOTE_MAX_LENGTH - marker.length) + marker;
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
						else if (oldVersion < 5) normalizeQueueTagsAndReindex();
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
			} else if (oldVersion < 5) {
				normalizeQueueTagsAndReindex();
			} else if (oldVersion < 6) {
				collapseQueueTags();
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
	// A callback that returns `false` signals "nothing to change" — mutateItem
	// skips the write and the updated_at bump entirely rather than persisting
	// a no-op edit, which would otherwise hand the item a fresh timestamp that
	// could win a future sync LWW race against a real concurrent edit for
	// reasons having nothing to do with an actual change (see removeQueueTag).
	// Every existing caller's callback implicitly returns undefined, which
	// isn't `=== false`, so this is additive and changes no existing behavior.
	mutate: (item: WatchlistItem, now: string) => void | false,
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
			if (mutate(item, now) === false) {
				resolve();
				return;
			}
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
 * Looks up an item by the [tmdb_id, media_type] key the store's unique index
 * enforces (#274 — identity is global again, one row per title regardless of
 * which lists it's in) — used when an `add()` hits that constraint, to
 * confirm whether the row it collided with is a live duplicate or just a
 * tombstone (a previously-removed row still occupies its index slot).
 * Returns tombstoned rows too, same as the index itself does; callers that
 * only care about active items should check `deleted_at`.
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
			.index(TMDB_MEDIA_INDEX)
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

/**
 * Replaces an item's entire list membership with exactly `tag` (or none, for
 * `null`) — the single-select semantics `setItemCollection`/`bulkSetCollection`
 * still use post-#274 (real multi-select add/remove is PR2 scope). Every
 * other currently-active tag gets tombstoned (`deleted: true` with a fresh
 * `at`) rather than dropped from the map outright — a plain delete would give
 * the per-key sync merge (see sync.ts's mergeOne) nothing to compare against
 * a stale remote copy that still has the old tag active, and the removal
 * could silently fail to propagate. `tag`'s own existing rank (if any)
 * carries forward rather than resetting.
 */
export async function setQueueTag(id: number, tag: string | null): Promise<void> {
	return mutateItem(id, (item, now) => {
		const tags = { ...(item.queue_tags ?? {}) };
		for (const key of Object.keys(tags)) {
			if (key !== tag && !tags[key].deleted) tags[key] = { ...tags[key], deleted: true, at: now };
		}
		if (tag) {
			const existingRank = tags[tag]?.rank;
			tags[tag] = { at: now, ...(existingRank !== undefined ? { rank: existingRank } : {}) };
		}
		item.queue_tags = tags;
	});
}

/**
 * Adds one active tag to an existing item without touching its other tags —
 * the "already queued, also file it under X" case an addItem() ConstraintError
 * represents now that identity is global again (#274), and (PR2) the
 * personal-chip-toggle-on primitive `addItemToCollection` calls. Distinct
 * from setQueueTag, which replaces *all* membership — using that here would
 * strip whatever lists the item was already in.
 *
 * Preserves the tag's existing rank (if any) rather than resetting it — same
 * reason setQueueTag already does this: a chip toggled off and back on
 * shouldn't lose its position in that list's order.
 */
export async function addQueueTag(id: number, tag: string): Promise<void> {
	return mutateItem(id, (item, now) => {
		const existingRank = item.queue_tags?.[tag]?.rank;
		item.queue_tags = {
			...(item.queue_tags ?? {}),
			[tag]: { at: now, ...(existingRank !== undefined ? { rank: existingRank } : {}) }
		};
	});
}

/**
 * Tombstones one active tag without touching the item's other tags — the
 * symmetric counterpart to addQueueTag, and the personal-chip-toggle-off
 * primitive `removeItemFromCollection` calls (PR2). No-ops (no write, no
 * updated_at bump) if the tag is already inactive or absent — a toggle
 * double-fired or racing itself shouldn't hand a stale tombstone a fresh
 * `at` for no reason. Preserves the existing entry's rank on the tombstone
 * (spread, not overwrite), same as every other tombstoning path in this
 * file (setQueueTag's loop, renameCollectionTag, clearCollectionTag) — if
 * the tag is re-added later, its position in that list shouldn't be lost.
 */
export async function removeQueueTag(id: number, tag: string): Promise<void> {
	return mutateItem(id, (item, now) => {
		const existing = item.queue_tags?.[tag];
		if (!existing || existing.deleted) return false;
		item.queue_tags = { ...item.queue_tags, [tag]: { ...existing, deleted: true, at: now } };
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

/**
 * Bulk-reassigns queue_tags[tag].rank to match `orderedIds`'s array position
 * — the per-list counterpart to setSortOrder above, backing the Lists page's
 * per-list move-up/move-down (PR2). Same shape: one transaction, get→mutate→
 * put per id, tx.oncomplete resolves. Ids outside the array keep whatever
 * rank they have; an id in the array whose item doesn't currently have `tag`
 * active is left untouched rather than resurrecting or corrupting a
 * membership it doesn't have — callers only ever pass ids just rendered
 * under that list's own expanded section, but a stale id slipping through
 * (e.g. a concurrent removal mid-reorder) must not write anything.
 *
 * Bumps both the item's top-level updated_at and this tag entry's own `at`
 * — same as every other tag-mutation in this file, since `at` (not
 * updated_at) is what the per-key queue_tags merge in sync.ts compares.
 *
 * Correctness note for callers: this MUST always be called with the full,
 * currently-known ordered id list for `tag` — never a partial delta — or
 * the "one device's whole reorder wins atomically on conflict" merge
 * property breaks down into a field-by-field interleave neither device
 * actually produced. moveItemInCollection (queue-actions.ts) enforces this
 * by construction, same as moveItem already does for setSortOrder.
 *
 * Accepted tradeoff: reordering touches every item in the list, not just
 * the ones that moved, which widens (vs. a single-item edit) the odds this
 * races and overwrites a concurrent removal of one of those items from the
 * same list on another device — that removal's older `at` loses to the
 * reorder's newer `at` for that one item's key, resurrecting the
 * membership. Rare (needs a removal and a reorder of overlapping data
 * racing across two offline devices before either syncs) and low-stakes
 * (redo the reorder or the removal, no data destroyed) — not fixed here,
 * see sync.test.ts for a named regression test making this explicit.
 */
export async function setTagRank(tag: string, orderedIds: number[]): Promise<void> {
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
				const existing = item.queue_tags?.[tag];
				if (!existing || existing.deleted) return;
				item.queue_tags = { ...item.queue_tags, [tag]: { ...existing, rank: index, at: now } };
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
	imdb_id?: string | null,
	backdrop_path?: string | null
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
			if (backdrop_path !== undefined) item.backdrop_path = backdrop_path;
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
 *
 * #274: uniqueness is no longer per-tag, so a title independently in both
 * `oldName` and `newName` at once can't collide the way it could under #221 —
 * that title's `newName` entry, if it already exists, is simply left alone
 * rather than clobbered by whatever rank/timestamp `oldName` carried.
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
			const oldTag = item.queue_tags?.[oldName];
			if (!item.deleted_at && oldTag && !oldTag.deleted) {
				const tags = { ...item.queue_tags };
				tags[oldName] = { ...oldTag, deleted: true, at: now };
				if (!tags[newName] || tags[newName].deleted) {
					tags[newName] = { at: now, ...(oldTag.rank !== undefined ? { rank: oldTag.rank } : {}) };
				}
				item.queue_tags = tags;
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
			const tag = item.queue_tags?.[name];
			if (!item.deleted_at && tag && !tag.deleted) {
				item.queue_tags = { ...item.queue_tags, [name]: { ...tag, deleted: true, at: now } };
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
