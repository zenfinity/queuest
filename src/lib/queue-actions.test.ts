import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { WatchlistItem } from './types';
import { makeItem } from './test-fixtures';

const getAll = vi.fn();
const setWatched = vi.fn();
const removeItem = vi.fn();
const updateShowProgress = vi.fn();
const setQueueTag = vi.fn();
const addQueueTag = vi.fn();
const removeQueueTag = vi.fn();
const setSortOrder = vi.fn();
const setTagRank = vi.fn();
const gcTombstones = vi.fn();

vi.mock('./db', () => ({
	getAll: (...args: unknown[]) => getAll(...args),
	setWatched: (...args: unknown[]) => setWatched(...args),
	removeItem: (...args: unknown[]) => removeItem(...args),
	updateShowProgress: (...args: unknown[]) => updateShowProgress(...args),
	setQueueTag: (...args: unknown[]) => setQueueTag(...args),
	addQueueTag: (...args: unknown[]) => addQueueTag(...args),
	removeQueueTag: (...args: unknown[]) => removeQueueTag(...args),
	setSortOrder: (...args: unknown[]) => setSortOrder(...args),
	setTagRank: (...args: unknown[]) => setTagRank(...args),
	gcTombstones: (...args: unknown[]) => gcTombstones(...args)
}));

const {
	reloadQueue,
	toggleWatched,
	removeQueueItem,
	toggleSeasonProgress,
	listCollections,
	sortByRank,
	sortByField,
	filterByService,
	addItemToCollection,
	removeItemFromCollection,
	clearItemCollections,
	reorderItems,
	bulkAddToCollection,
	bulkRemoveFromCollection,
	bulkClearCollections,
	bulkSetWatched,
	bulkRemove
} = await import('./queue-actions');

// A tiny fake of the component-side state these functions write into via callbacks,
// so assertions read naturally without a real Svelte component in the loop.
function makeDeps() {
	const state = { items: [] as WatchlistItem[], busy: new Set<number>(), error: '' };
	const deps = {
		setItems: (items: WatchlistItem[]) => {
			state.items = items;
		},
		setBusy: (id: number, isBusy: boolean) => {
			const next = new Set(state.busy);
			if (isBusy) next.add(id);
			else next.delete(id);
			state.busy = next;
		},
		setError: (message: string) => {
			state.error = message;
		}
	};
	return { state, deps };
}

beforeEach(() => {
	getAll.mockReset();
	setWatched.mockReset();
	removeItem.mockReset();
	updateShowProgress.mockReset();
	setQueueTag.mockReset();
	addQueueTag.mockReset();
	removeQueueTag.mockReset();
	setSortOrder.mockReset();
	setTagRank.mockReset();
	gcTombstones.mockReset().mockResolvedValue(0);
});

describe('reloadQueue', () => {
	it('loads items into state on success', async () => {
		const { state, deps } = makeDeps();
		const items = [makeItem()];
		getAll.mockResolvedValue(items);

		await reloadQueue(deps);

		expect(state.items).toEqual(items);
		expect(state.error).toBe('');
	});

	it('surfaces a getAll failure as an error message instead of throwing', async () => {
		const { state, deps } = makeDeps();
		getAll.mockRejectedValue(new Error('IDB is closing'));

		await reloadQueue(deps);

		expect(state.error).toBe('IDB is closing');
		expect(state.items).toEqual([]);
	});
});

describe('toggleWatched', () => {
	it('marks watched, reloads, and clears busy state on success', async () => {
		const { state, deps } = makeDeps();
		const item = makeItem({ id: 5, watched_at: null });
		setWatched.mockResolvedValue(undefined);
		getAll.mockResolvedValue([{ ...item, watched_at: '2026-01-02T00:00:00.000Z' }]);
		const onSuccess = vi.fn();

		await toggleWatched(item, deps, onSuccess);

		expect(setWatched).toHaveBeenCalledWith(5, true);
		expect(onSuccess).toHaveBeenCalledOnce();
		expect(state.items[0].watched_at).not.toBeNull();
		expect(state.busy.has(5)).toBe(false); // cleared even though busy was set mid-flight
	});

	it('sets an error and still clears busy state when setWatched throws', async () => {
		const { state, deps } = makeDeps();
		const item = makeItem({ id: 7 });
		setWatched.mockRejectedValue(new Error('storage full'));
		const onSuccess = vi.fn();

		await toggleWatched(item, deps, onSuccess);

		expect(state.error).toBe('storage full');
		expect(onSuccess).not.toHaveBeenCalled();
		// This is the bug #48 fixed: busy must clear via `finally` even on failure,
		// otherwise the Watch/Remove button stays disabled forever.
		expect(state.busy.has(7)).toBe(false);
	});

	it('is busy for the duration of the call', async () => {
		const { state, deps } = makeDeps();
		const item = makeItem({ id: 9 });
		let busyDuringCall: boolean | undefined;
		setWatched.mockImplementation(async () => {
			busyDuringCall = state.busy.has(9);
		});
		getAll.mockResolvedValue([]);

		await toggleWatched(item, deps);

		expect(busyDuringCall).toBe(true);
		expect(state.busy.has(9)).toBe(false);
	});
});

describe('removeQueueItem', () => {
	it('removes, reloads, and clears busy state on success', async () => {
		const { state, deps } = makeDeps();
		const item = makeItem({ id: 3 });
		removeItem.mockResolvedValue(undefined);
		getAll.mockResolvedValue([]);
		const onSuccess = vi.fn();

		await removeQueueItem(item, deps, onSuccess);

		expect(removeItem).toHaveBeenCalledWith(3);
		expect(onSuccess).toHaveBeenCalledOnce();
		expect(state.busy.has(3)).toBe(false);
	});

	it('sets an error and clears busy state when removeItem throws', async () => {
		const { state, deps } = makeDeps();
		const item = makeItem({ id: 4 });
		removeItem.mockRejectedValue(new Error('IDB transaction aborted'));

		await removeQueueItem(item, deps);

		expect(state.error).toBe('IDB transaction aborted');
		expect(state.busy.has(4)).toBe(false);
	});
});

describe('toggleSeasonProgress', () => {
	it('adds a season to watched_seasons and reloads', async () => {
		const { state, deps } = makeDeps();
		const item = makeItem({
			id: 2,
			media_type: 'tv',
			watched_seasons: [1]
		});
		const reloaded = [makeItem({ id: 2, media_type: 'tv', watched_seasons: [1, 2] })];
		updateShowProgress.mockResolvedValue(undefined);
		getAll.mockResolvedValue(reloaded);

		await toggleSeasonProgress(item, 2, deps);

		expect(updateShowProgress).toHaveBeenCalledWith(2, [1, 2]);
		expect(getAll).toHaveBeenCalledOnce();
		expect(state.items).toEqual(reloaded);
	});

	it('removes an already-watched season (toggles off)', async () => {
		const { state, deps } = makeDeps();
		const item = makeItem({
			id: 2,
			media_type: 'tv',
			watched_seasons: [1, 2]
		});
		const reloaded = [makeItem({ id: 2, media_type: 'tv', watched_seasons: [1] })];
		updateShowProgress.mockResolvedValue(undefined);
		getAll.mockResolvedValue(reloaded);

		await toggleSeasonProgress(item, 2, deps);

		expect(updateShowProgress).toHaveBeenCalledWith(2, [1]);
		expect(getAll).toHaveBeenCalledOnce();
		expect(state.items).toEqual(reloaded);
	});

	it('surfaces a failure as an error message', async () => {
		const { state, deps } = makeDeps();
		const item = makeItem({ id: 2, media_type: 'tv' });
		updateShowProgress.mockRejectedValue(new Error('write failed'));

		await toggleSeasonProgress(item, 1, deps);

		expect(state.error).toBe('write failed');
	});
});

const AT = '2024-01-01T00:00:00.000Z';
/** Builds a queue_tags map from plain tag names, for tests that only care
 *  which lists are active, not the per-key timestamps. */
function tags(...names: string[]): WatchlistItem['queue_tags'] {
	return Object.fromEntries(names.map((n) => [n, { at: AT }]));
}

describe('listCollections', () => {
	it('returns sorted, deduped collection names', () => {
		const items = [
			makeItem({ queue_tags: tags('Favorites') }),
			makeItem({ queue_tags: tags('Action') }),
			makeItem({ queue_tags: tags('Favorites') }),
			makeItem({ queue_tags: undefined })
		];

		const result = listCollections(items);

		expect(result).toEqual(['Action', 'Favorites']);
	});

	it('returns empty array when no items have any active tag', () => {
		const items = [makeItem(), makeItem({ queue_tags: {} })];

		const result = listCollections(items);

		expect(result).toEqual([]);
	});

	it('merges in extraNames, deduped and sorted, for collections with no items yet', () => {
		const items = [makeItem({ queue_tags: tags('Favorites') })];

		const result = listCollections(items, ['Weekend Watch', 'Favorites']);

		expect(result).toEqual(['Favorites', 'Weekend Watch']);
	});

	it('ignores a tombstoned (deleted) tag entry', () => {
		const items = [makeItem({ queue_tags: { Favorites: { at: AT, deleted: true } } })];

		expect(listCollections(items)).toEqual([]);
	});
});

describe('sortByRank', () => {
	it('sorts ranked items by rank', () => {
		const a = makeItem({ id: 1, queue_tags: { Drama: { at: AT, rank: 2 } } });
		const b = makeItem({ id: 2, queue_tags: { Drama: { at: AT, rank: 0 } } });
		const c = makeItem({ id: 3, queue_tags: { Drama: { at: AT, rank: 1 } } });

		expect(sortByRank([a, b, c], 'Drama').map((i) => i.id)).toEqual([2, 3, 1]);
	});

	it('appends unranked items after ranked ones, ordered by added_at', () => {
		const ranked = makeItem({
			id: 1,
			added_at: '2024-06-01T00:00:00.000Z',
			queue_tags: { Drama: { at: AT, rank: 0 } }
		});
		const unrankedOlder = makeItem({
			id: 2,
			added_at: '2024-01-01T00:00:00.000Z',
			queue_tags: tags('Drama')
		});
		const unrankedNewer = makeItem({
			id: 3,
			added_at: '2024-03-01T00:00:00.000Z',
			queue_tags: tags('Drama')
		});

		const result = sortByRank([unrankedNewer, ranked, unrankedOlder], 'Drama');

		expect(result.map((i) => i.id)).toEqual([1, 2, 3]);
	});

	it('is a stable no-op ordering when nothing is ranked', () => {
		const a = makeItem({ id: 1, added_at: '2024-01-01T00:00:00.000Z', queue_tags: tags('Drama') });
		const b = makeItem({ id: 2, added_at: '2024-02-01T00:00:00.000Z', queue_tags: tags('Drama') });

		expect(sortByRank([b, a], 'Drama').map((i) => i.id)).toEqual([1, 2]);
	});

	it("dir: 'desc' reverses the comparison between ranked items only", () => {
		const a = makeItem({ id: 1, queue_tags: { Drama: { at: AT, rank: 2 } } });
		const b = makeItem({ id: 2, queue_tags: { Drama: { at: AT, rank: 0 } } });
		const c = makeItem({ id: 3, queue_tags: { Drama: { at: AT, rank: 1 } } });
		const unranked = makeItem({
			id: 4,
			added_at: '2024-01-01T00:00:00.000Z',
			queue_tags: tags('Drama')
		});

		const result = sortByRank([a, b, c, unranked], 'Drama', 'desc');

		// Ranked items reverse (1, 3, 2 by descending rank); the unranked item
		// still lands last, not first — direction only flips ranked comparisons.
		expect(result.map((i) => i.id)).toEqual([1, 3, 2, 4]);
	});
});

describe('sortByField', () => {
	it('sorts by title, ascending and descending', () => {
		const a = makeItem({ id: 1, title: 'Beta' });
		const b = makeItem({ id: 2, title: 'Alpha' });

		expect(sortByField([a, b], 'title', 'asc').map((i) => i.id)).toEqual([2, 1]);
		expect(sortByField([a, b], 'title', 'desc').map((i) => i.id)).toEqual([1, 2]);
	});

	it('sorts by remaining runtime, ascending and descending', () => {
		const short = makeItem({ id: 1, runtime_minutes: 30 });
		const long = makeItem({ id: 2, runtime_minutes: 120 });

		expect(sortByField([long, short], 'runtime', 'asc').map((i) => i.id)).toEqual([1, 2]);
		expect(sortByField([long, short], 'runtime', 'desc').map((i) => i.id)).toEqual([2, 1]);
	});

	it('sorts by added_at, ascending and descending', () => {
		const older = makeItem({ id: 1, added_at: '2024-01-01T00:00:00.000Z' });
		const newer = makeItem({ id: 2, added_at: '2024-06-01T00:00:00.000Z' });

		expect(sortByField([newer, older], 'added', 'asc').map((i) => i.id)).toEqual([1, 2]);
		expect(sortByField([newer, older], 'added', 'desc').map((i) => i.id)).toEqual([2, 1]);
	});
});

describe('filterByService', () => {
	const providerA = { provider_id: 1, provider_name: 'A', logo_path: '' };
	const providerB = { provider_id: 2, provider_name: 'B', logo_path: '' };

	it("passes everything through for 'all'", () => {
		const items = [makeItem({ id: 1, providers: [providerA] }), makeItem({ id: 2, providers: [] })];
		expect(filterByService(items, 'all', new Set([1]))).toEqual(items);
	});

	it('passes everything through when nothing is subscribed yet', () => {
		const items = [makeItem({ id: 1, providers: [providerA] })];
		expect(filterByService(items, 'subscribed', new Set())).toEqual(items);
	});

	it("'subscribed' keeps only items with a subscribed provider", () => {
		const withA = makeItem({ id: 1, providers: [providerA] });
		const withB = makeItem({ id: 2, providers: [providerB] });

		expect(filterByService([withA, withB], 'subscribed', new Set([1])).map((i) => i.id)).toEqual([
			1
		]);
	});

	it("'not-subscribed' keeps items with providers, none of which are subscribed", () => {
		const withA = makeItem({ id: 1, providers: [providerA] });
		const withB = makeItem({ id: 2, providers: [providerB] });
		const noProviders = makeItem({ id: 3, providers: [] });

		expect(
			filterByService([withA, withB, noProviders], 'not-subscribed', new Set([1])).map((i) => i.id)
		).toEqual([2]);
	});
});

describe('addItemToCollection / removeItemFromCollection / clearItemCollections', () => {
	it('addItemToCollection adds a tag, reloads, and clears busy state on success', async () => {
		const { state, deps } = makeDeps();
		const item = makeItem({ id: 6 });
		addQueueTag.mockResolvedValue(undefined);
		getAll.mockResolvedValue([{ ...item, queue_tags: tags('Drama') }]);

		await addItemToCollection(item, 'Drama', deps);

		expect(addQueueTag).toHaveBeenCalledWith(6, 'Drama');
		expect(state.items[0].queue_tags).toEqual(tags('Drama'));
		expect(state.busy.has(6)).toBe(false);
	});

	it('addItemToCollection sets an error and clears busy state when addQueueTag throws', async () => {
		const { state, deps } = makeDeps();
		const item = makeItem({ id: 10 });
		addQueueTag.mockRejectedValue(new Error('storage full'));

		await addItemToCollection(item, 'Drama', deps);

		expect(state.error).toBe('storage full');
		expect(state.busy.has(10)).toBe(false);
	});

	it('removeItemFromCollection removes a tag, reloads, and clears busy state on success', async () => {
		const { state, deps } = makeDeps();
		const item = makeItem({ id: 7, queue_tags: tags('Drama') });
		removeQueueTag.mockResolvedValue(undefined);
		getAll.mockResolvedValue([{ ...item, queue_tags: undefined }]);

		await removeItemFromCollection(item, 'Drama', deps);

		expect(removeQueueTag).toHaveBeenCalledWith(7, 'Drama');
		expect(state.busy.has(7)).toBe(false);
	});

	it('removeItemFromCollection sets an error and clears busy state when removeQueueTag throws', async () => {
		const { state, deps } = makeDeps();
		const item = makeItem({ id: 11, queue_tags: tags('Drama') });
		removeQueueTag.mockRejectedValue(new Error('storage full'));

		await removeItemFromCollection(item, 'Drama', deps);

		expect(state.error).toBe('storage full');
		expect(state.busy.has(11)).toBe(false);
	});

	it('clearItemCollections clears every list on success', async () => {
		const { state, deps } = makeDeps();
		const item = makeItem({ id: 8, queue_tags: tags('Action') });
		setQueueTag.mockResolvedValue(undefined);
		getAll.mockResolvedValue([{ ...item, queue_tags: undefined }]);

		await clearItemCollections(item, deps);

		expect(setQueueTag).toHaveBeenCalledWith(8, null);
		expect(state.busy.has(8)).toBe(false);
	});

	it('clearItemCollections sets an error and clears busy state when setQueueTag throws', async () => {
		const { state, deps } = makeDeps();
		const item = makeItem({ id: 12, queue_tags: tags('Action') });
		setQueueTag.mockRejectedValue(new Error('storage full'));

		await clearItemCollections(item, deps);

		expect(state.error).toBe('storage full');
		expect(state.busy.has(12)).toBe(false);
	});
});

describe('reorderItems', () => {
	it('persists the full settled order from a drag and reloads', async () => {
		const { deps } = makeDeps();
		const a = makeItem({ id: 1 });
		const b = makeItem({ id: 2 });
		const c = makeItem({ id: 3 });
		setSortOrder.mockResolvedValue(undefined);
		getAll.mockResolvedValue([c, a, b]);

		await reorderItems([c, a, b], deps);

		expect(setSortOrder).toHaveBeenCalledWith([3, 1, 2]);
		expect(getAll).toHaveBeenCalledOnce();
	});

	it('surfaces an error without touching per-item busy state', async () => {
		const { state, deps } = makeDeps();
		const a = makeItem({ id: 1 });
		const b = makeItem({ id: 2 });
		setSortOrder.mockRejectedValue(new Error('write failed'));

		await reorderItems([b, a], deps);

		expect(state.error).toBe('write failed');
		expect(state.busy.size).toBe(0);
	});
});

describe('bulkAddToCollection / bulkRemoveFromCollection / bulkClearCollections', () => {
	it('bulkAddToCollection tags every selected item and reloads once', async () => {
		const { state, deps } = makeDeps();
		const items = [makeItem({ id: 1 }), makeItem({ id: 2 }), makeItem({ id: 3 })];
		addQueueTag.mockResolvedValue(undefined);
		getAll.mockResolvedValue(items.map((i) => ({ ...i, queue_tags: tags('Movie Night') })));

		await bulkAddToCollection(items, 'Movie Night', deps);

		expect(addQueueTag).toHaveBeenCalledTimes(3);
		expect(addQueueTag).toHaveBeenCalledWith(1, 'Movie Night');
		expect(addQueueTag).toHaveBeenCalledWith(2, 'Movie Night');
		expect(addQueueTag).toHaveBeenCalledWith(3, 'Movie Night');
		expect(getAll).toHaveBeenCalledTimes(1);
		expect(state.items).toHaveLength(3);
	});

	it('bulkAddToCollection clears busy for every item, even the ones that ran before a failure', async () => {
		const { state, deps } = makeDeps();
		const items = [makeItem({ id: 1 }), makeItem({ id: 2 })];
		addQueueTag.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('write failed'));

		await bulkAddToCollection(items, 'Drama', deps);

		expect(state.error).toBe('write failed');
		expect(state.busy.has(1)).toBe(false);
		expect(state.busy.has(2)).toBe(false);
	});

	it('bulkRemoveFromCollection removes the tag from every selected item', async () => {
		const { deps } = makeDeps();
		const items = [
			makeItem({ id: 1, queue_tags: tags('Drama') }),
			makeItem({ id: 2, queue_tags: tags('Drama') })
		];
		removeQueueTag.mockResolvedValue(undefined);
		getAll.mockResolvedValue([]);

		await bulkRemoveFromCollection(items, 'Drama', deps);

		expect(removeQueueTag).toHaveBeenCalledWith(1, 'Drama');
		expect(removeQueueTag).toHaveBeenCalledWith(2, 'Drama');
	});

	it('bulkClearCollections clears every list from every selected item', async () => {
		const { deps } = makeDeps();
		const items = [
			makeItem({ id: 1, queue_tags: tags('Drama') }),
			makeItem({ id: 2, queue_tags: tags('Drama') })
		];
		setQueueTag.mockResolvedValue(undefined);
		getAll.mockResolvedValue([]);

		await bulkClearCollections(items, deps);

		expect(setQueueTag).toHaveBeenCalledWith(1, null);
		expect(setQueueTag).toHaveBeenCalledWith(2, null);
	});
});

describe('bulkSetWatched', () => {
	it('marks every selected item watched and reloads once', async () => {
		const { deps } = makeDeps();
		const items = [makeItem({ id: 1 }), makeItem({ id: 2 })];
		setWatched.mockResolvedValue(undefined);
		getAll.mockResolvedValue([]);

		await bulkSetWatched(items, true, deps);

		expect(setWatched).toHaveBeenCalledWith(1, true);
		expect(setWatched).toHaveBeenCalledWith(2, true);
		expect(getAll).toHaveBeenCalledTimes(1);
	});

	it('surfaces an error and still clears busy state', async () => {
		const { state, deps } = makeDeps();
		const items = [makeItem({ id: 5 })];
		setWatched.mockRejectedValue(new Error('locked'));

		await bulkSetWatched(items, false, deps);

		expect(state.error).toBe('locked');
		expect(state.busy.has(5)).toBe(false);
	});
});

describe('bulkRemove', () => {
	it('removes every selected item and reloads once', async () => {
		const { deps } = makeDeps();
		const items = [makeItem({ id: 1 }), makeItem({ id: 2 }), makeItem({ id: 3 })];
		removeItem.mockResolvedValue(undefined);
		getAll.mockResolvedValue([]);

		await bulkRemove(items, deps);

		expect(removeItem).toHaveBeenCalledTimes(3);
		expect(getAll).toHaveBeenCalledTimes(1);
	});

	it('surfaces an error and still clears busy state for all items', async () => {
		const { state, deps } = makeDeps();
		const items = [makeItem({ id: 1 }), makeItem({ id: 2 })];
		removeItem.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('gone'));

		await bulkRemove(items, deps);

		expect(state.error).toBe('gone');
		expect(state.busy.has(1)).toBe(false);
		expect(state.busy.has(2)).toBe(false);
	});
});
