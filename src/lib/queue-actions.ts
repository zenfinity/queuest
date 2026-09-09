import { activeQueueTags, type WatchlistItem } from './types';
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
 * stamps contiguous ranks on every item in it (moveItemInCollection always
 * passes the full array), self-healing from then on.
 */
export function sortByRank(items: WatchlistItem[], tag: string): WatchlistItem[] {
	return [...items].sort((a, b) => {
		const ra = a.queue_tags?.[tag]?.rank;
		const rb = b.queue_tags?.[tag]?.rank;
		if (ra !== undefined && rb !== undefined) return ra - rb;
		if (ra !== undefined) return -1;
		if (rb !== undefined) return 1;
		return a.added_at.localeCompare(b.added_at);
	});
}

/**
 * Swaps an item with its neighbor in `visibleOrder` (the currently
 * sorted/filtered list, not the whole queue — see setSortOrder in db.ts for
 * why only that list gets renumbered) and persists the result. No-ops at
 * either end of the list rather than wrapping.
 */
export async function moveItem(
	item: WatchlistItem,
	direction: 'up' | 'down',
	visibleOrder: WatchlistItem[],
	deps: QueueActionDeps
): Promise<void> {
	const idx = visibleOrder.findIndex((i) => i.id === item.id);
	const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
	if (idx === -1 || swapIdx < 0 || swapIdx >= visibleOrder.length) return;

	deps.setBusy(item.id, true);
	try {
		const reordered = [...visibleOrder];
		[reordered[idx], reordered[swapIdx]] = [reordered[swapIdx], reordered[idx]];
		await setSortOrder(reordered.map((i) => i.id));
		await reloadQueue(deps);
	} catch (e) {
		deps.setError(e instanceof Error ? e.message : 'Could not reorder this title.');
	} finally {
		deps.setBusy(item.id, false);
	}
}

/**
 * Drag-and-drop's counterpart to moveItem (#231) — takes the whole settled
 * order from the drag gesture instead of a single up/down swap, but persists
 * through the same setSortOrder call so both reorder paths share one merge
 * rule. No per-item busy state: a drag already has its own "settled" moment
 * (drop), unlike the buttons where each click is its own request.
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
 * Per-list counterpart to moveItem, for the Lists page's move-up/move-down
 * (PR2) — same neighbor-swap shape, but persists through setTagRank(tag, …)
 * instead of setSortOrder, scoped to one list's own order rather than the
 * queue's. `visibleOrder` must be the *full* current order for `tag` (see
 * setTagRank's own doc comment for why a partial array would break the
 * per-key merge's "one device's whole reorder wins atomically" property) —
 * always call this with the same full, sorted array the list is rendering,
 * never a subset.
 */
export async function moveItemInCollection(
	item: WatchlistItem,
	tag: string,
	direction: 'up' | 'down',
	visibleOrder: WatchlistItem[],
	deps: QueueActionDeps
): Promise<void> {
	const idx = visibleOrder.findIndex((i) => i.id === item.id);
	const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
	if (idx === -1 || swapIdx < 0 || swapIdx >= visibleOrder.length) return;

	deps.setBusy(item.id, true);
	try {
		const reordered = [...visibleOrder];
		[reordered[idx], reordered[swapIdx]] = [reordered[swapIdx], reordered[idx]];
		await setTagRank(
			tag,
			reordered.map((i) => i.id)
		);
		await reloadQueue(deps);
	} catch (e) {
		deps.setError(e instanceof Error ? e.message : 'Could not reorder this list.');
	} finally {
		deps.setBusy(item.id, false);
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
