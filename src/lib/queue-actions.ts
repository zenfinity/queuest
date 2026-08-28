import type { WatchlistItem } from './types';
import {
	getAll,
	removeItem,
	setWatched,
	updateShowProgress,
	setQueueTag,
	setSortOrder,
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
		if (item.queue_tag) names.add(item.queue_tag);
	}
	for (const name of extraNames) names.add(name);
	return Array.from(names).sort();
}

export interface CollectionSection {
	/** Display name; 'Uncategorized' for the synthetic no-tag section. */
	name: string;
	/** The underlying queue_tag, or null for the Uncategorized section. */
	tag: string | null;
	color: string | null;
	items: WatchlistItem[];
}

/**
 * Groups items (in their existing order — this doesn't re-sort) into one
 * section per collection, alphabetical by name, with an Uncategorized
 * section (queue_tag == null) pinned last — mirroring how the Gantt view
 * pins its synthetic "Not Streaming" lane.
 */
export function groupIntoCollections(
	items: WatchlistItem[],
	queueColors: Record<string, string>
): CollectionSection[] {
	const byTag = new Map<string, WatchlistItem[]>();
	const uncategorized: WatchlistItem[] = [];
	for (const item of items) {
		if (item.queue_tag) {
			if (!byTag.has(item.queue_tag)) byTag.set(item.queue_tag, []);
			byTag.get(item.queue_tag)!.push(item);
		} else {
			uncategorized.push(item);
		}
	}

	const sections: CollectionSection[] = [...byTag.entries()]
		.sort((a, b) => a[0].localeCompare(b[0]))
		.map(([name, sectionItems]) => ({
			name,
			tag: name,
			color: queueColors[name] ?? null,
			items: sectionItems
		}));

	if (uncategorized.length > 0) {
		sections.push({ name: 'Uncategorized', tag: null, color: null, items: uncategorized });
	}

	return sections;
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

export async function setItemCollection(
	item: WatchlistItem,
	tag: string | null,
	deps: QueueActionDeps
): Promise<void> {
	deps.setBusy(item.id, true);
	try {
		await setQueueTag(item.id, tag);
		await reloadQueue(deps);
	} catch (e) {
		deps.setError(e instanceof Error ? e.message : 'Could not update collection.');
	} finally {
		deps.setBusy(item.id, false);
	}
}

/**
 * Bulk versions of setItemCollection/toggleWatched/removeItem (#113) — same
 * shape, applied to many items at once from the queue's selection mode.
 * Each writes sequentially (no cross-item atomicity requirement: a failure
 * partway through still leaves every item that succeeded in its new state,
 * which is what "3 of 5 assigned, one had an error" should look like), then
 * reloads once at the end rather than once per item.
 */
export async function bulkSetCollection(
	items: WatchlistItem[],
	tag: string | null,
	deps: QueueActionDeps
): Promise<void> {
	try {
		for (const item of items) {
			deps.setBusy(item.id, true);
			await setQueueTag(item.id, tag);
		}
		await reloadQueue(deps);
	} catch (e) {
		deps.setError(e instanceof Error ? e.message : 'Could not update collection.');
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
