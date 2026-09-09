import { activeQueueTags, type WatchlistItem } from './types';
import { remainingRuntime } from './progress';
import type { SortKey, ServiceFilterKey } from './queue-controls.svelte';
import {
	getAll,
	removeItem,
	setWatched,
	updateShowProgress,
	setQueueTag,
	addQueueTag,
	removeQueueTag,
	setNote,
	setSortOrder,
	setTagRank,
	gcTombstones
} from './db';

/**
 * Callbacks the caller supplies so this module stays free of any Svelte/UI
 * state — plain functions, easy to unit test, no runes and no component
 * mounting required. `onError` messages are user-facing strings.
 */
export interface QueueActionDeps {
	setItems: (items: WatchlistItem[]) => void;
	setBusy: (id: number, busy: boolean) => void;
	setError: (message: string) => void;
}

/** One name+color pair for a list-membership chip. */
export interface Chip {
	name: string;
	color: string;
}

/** Per-item chip data for the Queue view's card/row list chips (#274 PR2) —
 *  `personal` (this device's own queue_tags, writable via DetailPanel's
 *  toggle chips) and `shared` (derived from loaded shared-collection
 *  contents, read-only display here) are kept as separate clusters rather
 *  than one flat list: a promoted personal list and its same-named shared
 *  counterpart can both be active on one item at once (promotion is
 *  additive, see collection-actions.ts's promoteCollection), and a flat
 *  mixed row would render that as two identical-looking chips. */
export interface ItemChips {
	personal: Chip[];
	shared: Chip[];
}

export async function reloadQueue(
	deps: Pick<QueueActionDeps, 'setItems' | 'setError'>
): Promise<void> {
	try {
		deps.setItems(await getAll());
	} catch (e) {
		deps.setError(e instanceof Error ? e.message : 'Could not read your queue from local storage.');
	}
	// Best-effort tombstone GC; never blocks or fails the queue load itself.
	gcTombstones().catch(() => {});
}

export async function toggleWatched(
	item: WatchlistItem,
	deps: QueueActionDeps,
	onSuccess?: () => void
): Promise<void> {
	deps.setBusy(item.id, true);
	try {
		await setWatched(item.id, !item.watched_at);
		onSuccess?.();
		await reloadQueue(deps);
	} catch (e) {
		deps.setError(e instanceof Error ? e.message : 'Could not update this title.');
	} finally {
		deps.setBusy(item.id, false);
	}
}

export async function removeQueueItem(
	item: WatchlistItem,
	deps: QueueActionDeps,
	onSuccess?: () => void
): Promise<void> {
	deps.setBusy(item.id, true);
	try {
		await removeItem(item.id);
		onSuccess?.();
		await reloadQueue(deps);
	} catch (e) {
		deps.setError(e instanceof Error ? e.message : 'Could not remove this title.');
	} finally {
		deps.setBusy(item.id, false);
	}
}

export async function toggleSeasonProgress(
	item: WatchlistItem,
	seasonNum: number,
	deps: Pick<QueueActionDeps, 'setItems' | 'setError'>
): Promise<void> {
	const current = item.watched_seasons ?? [];
	const next = current.includes(seasonNum)
		? current.filter((s) => s !== seasonNum)
		: [...current, seasonNum];
	try {
		await updateShowProgress(item.id, next);
		await reloadQueue(deps);
	} catch (e) {
		deps.setError(e instanceof Error ? e.message : 'Could not update season progress.');
	}
}

/**
 * Returns sorted, deduped list of collection names found in items, plus any
 * `extraNames` (e.g. collections created empty in Settings via the color
 * palette — see queue-colors.ts — that have no items tagged yet).
 */
export function listCollections(items: WatchlistItem[], extraNames: string[] = []): string[] {
	const names = new Set<string>();
	for (const item of items) {
		for (const tag of activeQueueTags(item)) names.add(tag);
	}
	for (const name of extraNames) names.add(name);
	return Array.from(names).sort();
}

/**
 * Sorts a list's items by that list's own per-tag rank (PR2's Lists-page
 * ordering) — ranked items first by `rank`, then any unranked items
 * (queue_tags[tag].rank is only ever assigned once something reorders that
 * list — see setTagRank in db.ts) appended at the end ordered by `added_at`,
 * matching "new items join at the end" everywhere else in this app rather
 * than falling back to `rank ?? 0`, which would collide every untouched
 * item at the front instead. The first reorder of a partially-ranked list
 * stamps contiguous ranks on every item in it (reorderCollectionItems always
 * passes the full array), self-healing from then on.
 *
 * `dir` (#273) only flips the comparison between two *ranked* items —
 * unranked items stay appended at the end in `added_at` order regardless of
 * direction, since that fallback placement isn't part of "rank" and
 * shouldn't flip just because the user toggled the dock's sort arrow.
 */
export function sortByRank(
	items: WatchlistItem[],
	tag: string,
	dir: 'asc' | 'desc' = 'asc'
): WatchlistItem[] {
	const mul = dir === 'asc' ? 1 : -1;
	return [...items].sort((a, b) => {
		const ra = a.queue_tags?.[tag]?.rank;
		const rb = b.queue_tags?.[tag]?.rank;
		if (ra !== undefined && rb !== undefined) return (ra - rb) * mul;
		if (ra !== undefined) return -1;
		if (rb !== undefined) return 1;
		return a.added_at.localeCompare(b.added_at);
	});
}

/**
 * Sorts by a non-rank field — the queue and per-list browse views (#273)
 * both need identical title/runtime/added-at ordering, so this is shared
 * rather than duplicated; 'rank' is deliberately excluded since it means
 * different things on each surface (queue-wide sort_order vs a list's own
 * per-tag rank via sortByRank above) and stays a caller-specific branch.
 */
export function sortByField(
	list: WatchlistItem[],
	sortBy: Exclude<SortKey, 'rank'>,
	sortDir: 'asc' | 'desc'
): WatchlistItem[] {
	const mul = sortDir === 'asc' ? 1 : -1;
	// remainingRuntime() walks the item's seasons, so compute it once per
	// item (#246) rather than ~2·N·log N times inside the comparator.
	const runtimeOf =
		sortBy === 'runtime' ? new Map(list.map((item) => [item, remainingRuntime(item)])) : null;
	return [...list].sort((a, b) => {
		if (sortBy === 'title') return a.title.localeCompare(b.title) * mul;
		if (runtimeOf) return ((runtimeOf.get(a) ?? 0) - (runtimeOf.get(b) ?? 0)) * mul;
		return a.added_at.localeCompare(b.added_at) * mul;
	});
}

/**
 * Subscribed/not-subscribed service filtering — shared by the queue and
 * per-list browse views (#273), which both filter the same way. `all` and
 * "nothing subscribed yet" both pass everything through unfiltered, the
 * same "meaningless filter falls back to showing everything" convention
 * queue-controls.svelte.ts's serviceFilter auto-reset already relies on.
 */
export function filterByService(
	items: WatchlistItem[],
	serviceFilter: ServiceFilterKey,
	subscribedIds: ReadonlySet<number>
): WatchlistItem[] {
	if (serviceFilter === 'all' || subscribedIds.size === 0) return items;
	if (serviceFilter === 'subscribed') {
		return items.filter((item) => item.providers.some((p) => subscribedIds.has(p.provider_id)));
	}
	// not-subscribed: has providers, none of which are subscribed
	return items.filter(
		(item) =>
			item.providers.length > 0 && !item.providers.some((p) => subscribedIds.has(p.provider_id))
	);
}

/**
 * Persists the full settled order from a drag gesture (#231) via
 * setSortOrder — the sorted/filtered list being dragged, not necessarily the
 * whole queue (see setSortOrder in db.ts for why only that list gets
 * renumbered). No per-item busy state: a drag has one "settled" moment
 * (drop), not a discrete request per item.
 */
export async function reorderItems(
	newOrder: WatchlistItem[],
	deps: QueueActionDeps
): Promise<void> {
	try {
		await setSortOrder(newOrder.map((i) => i.id));
		await reloadQueue(deps);
	} catch (e) {
		deps.setError(e instanceof Error ? e.message : 'Could not reorder your queue.');
	}
}

/**
 * Persists the full settled order from a drag gesture, scoped to one list,
 * via setTagRank(tag, …) instead of setSortOrder. `newOrder` must be the
 * full current order for `tag` — see setTagRank's own doc comment (db.ts)
 * for why a partial array would break the per-key merge's "one device's
 * whole reorder wins atomically" property — the caller's dragHandleZone must
 * have dropFromOthersDisabled set so a foreign-zone drop can't violate that.
 */
export async function reorderCollectionItems(
	newOrder: WatchlistItem[],
	tag: string,
	deps: QueueActionDeps
): Promise<void> {
	try {
		await setTagRank(
			tag,
			newOrder.map((i) => i.id)
		);
		await reloadQueue(deps);
	} catch (e) {
		deps.setError(e instanceof Error ? e.message : 'Could not reorder this list.');
	}
}

/**
 * Personal-list assignment, genuinely multi-select (PR2) — an item can be
 * added to or removed from any number of lists independently, rather than
 * the old single-select "replace membership with exactly this one tag"
 * (setItemCollection, pre-PR2). `clearItemCollections` is the one remaining
 * case that still wants "replace with nothing" semantics — it's the direct
 * successor of picking "None" in the old dropdown, and setQueueTag(id, null)
 * is still exactly the right primitive for it.
 */
export async function addItemToCollection(
	item: WatchlistItem,
	tag: string,
	deps: QueueActionDeps
): Promise<void> {
	deps.setBusy(item.id, true);
	try {
		await addQueueTag(item.id, tag);
		await reloadQueue(deps);
	} catch (e) {
		deps.setError(e instanceof Error ? e.message : 'Could not add to that list.');
	} finally {
		deps.setBusy(item.id, false);
	}
}

export async function removeItemFromCollection(
	item: WatchlistItem,
	tag: string,
	deps: QueueActionDeps
): Promise<void> {
	deps.setBusy(item.id, true);
	try {
		await removeQueueTag(item.id, tag);
		await reloadQueue(deps);
	} catch (e) {
		deps.setError(e instanceof Error ? e.message : 'Could not remove from that list.');
	} finally {
		deps.setBusy(item.id, false);
	}
}

export async function clearItemCollections(
	item: WatchlistItem,
	deps: QueueActionDeps
): Promise<void> {
	deps.setBusy(item.id, true);
	try {
		await setQueueTag(item.id, null);
		await reloadQueue(deps);
	} catch (e) {
		deps.setError(e instanceof Error ? e.message : 'Could not clear lists.');
	} finally {
		deps.setBusy(item.id, false);
	}
}

export async function setItemNote(
	item: WatchlistItem,
	notes: string | null,
	deps: QueueActionDeps
): Promise<void> {
	deps.setBusy(item.id, true);
	try {
		await setNote(item.id, notes);
		await reloadQueue(deps);
	} catch (e) {
		deps.setError(e instanceof Error ? e.message : 'Could not save that note.');
	} finally {
		deps.setBusy(item.id, false);
	}
}

/**
 * Bulk versions of addItemToCollection/removeItemFromCollection/
 * toggleWatched/removeItem (#113) — same shape, applied to many items at
 * once from the queue's selection mode. Each writes sequentially (no
 * cross-item atomicity requirement: a failure partway through still leaves
 * every item that succeeded in its new state, which is what "3 of 5
 * assigned, one had an error" should look like), then reloads once at the
 * end rather than once per item.
 */
export async function bulkAddToCollection(
	items: WatchlistItem[],
	tag: string,
	deps: QueueActionDeps
): Promise<void> {
	try {
		for (const item of items) {
			deps.setBusy(item.id, true);
			await addQueueTag(item.id, tag);
		}
		await reloadQueue(deps);
	} catch (e) {
		deps.setError(e instanceof Error ? e.message : 'Could not add to that list.');
	} finally {
		for (const item of items) deps.setBusy(item.id, false);
	}
}

export async function bulkRemoveFromCollection(
	items: WatchlistItem[],
	tag: string,
	deps: QueueActionDeps
): Promise<void> {
	try {
		for (const item of items) {
			deps.setBusy(item.id, true);
			await removeQueueTag(item.id, tag);
		}
		await reloadQueue(deps);
	} catch (e) {
		deps.setError(e instanceof Error ? e.message : 'Could not remove from that list.');
	} finally {
		for (const item of items) deps.setBusy(item.id, false);
	}
}

/** Removes every active list from every given item — the bulk successor of
 *  the old "Clear list" action, now that assignment is additive rather than
 *  "each item has at most one list" (so there's no longer a single list to
 *  target for a bulk clear; this clears all of them, per item). */
export async function bulkClearCollections(
	items: WatchlistItem[],
	deps: QueueActionDeps
): Promise<void> {
	try {
		for (const item of items) {
			deps.setBusy(item.id, true);
			await setQueueTag(item.id, null);
		}
		await reloadQueue(deps);
	} catch (e) {
		deps.setError(e instanceof Error ? e.message : 'Could not clear lists.');
	} finally {
		for (const item of items) deps.setBusy(item.id, false);
	}
}

export async function bulkSetWatched(
	items: WatchlistItem[],
	watched: boolean,
	deps: QueueActionDeps
): Promise<void> {
	try {
		for (const item of items) {
			deps.setBusy(item.id, true);
			await setWatched(item.id, watched);
		}
		await reloadQueue(deps);
	} catch (e) {
		deps.setError(e instanceof Error ? e.message : 'Could not update watched status.');
	} finally {
		for (const item of items) deps.setBusy(item.id, false);
	}
}

export async function bulkRemove(items: WatchlistItem[], deps: QueueActionDeps): Promise<void> {
	try {
		for (const item of items) {
			deps.setBusy(item.id, true);
			await removeItem(item.id);
		}
		await reloadQueue(deps);
	} catch (e) {
		deps.setError(e instanceof Error ? e.message : 'Could not remove items.');
	} finally {
		for (const item of items) deps.setBusy(item.id, false);
	}
}
