import type { WatchlistItem } from './types';
import {
	getAll,
	removeItem,
	setWatched,
	updateShowProgress,
	setQueueTag,
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
