import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { WatchlistItem } from './types';
import { makeItem } from './test-fixtures';

const getAll = vi.fn();
const setWatched = vi.fn();
const removeItem = vi.fn();
const updateShowProgress = vi.fn();
const setQueueTag = vi.fn();
const gcTombstones = vi.fn();

vi.mock('./db', () => ({
	getAll: (...args: unknown[]) => getAll(...args),
	setWatched: (...args: unknown[]) => setWatched(...args),
	removeItem: (...args: unknown[]) => removeItem(...args),
	updateShowProgress: (...args: unknown[]) => updateShowProgress(...args),
	setQueueTag: (...args: unknown[]) => setQueueTag(...args),
	gcTombstones: (...args: unknown[]) => gcTombstones(...args)
}));

const {
	reloadQueue,
	toggleWatched,
	removeQueueItem,
	toggleSeasonProgress,
	listCollections,
	groupIntoCollections,
	setItemCollection,
	bulkSetCollection,
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

describe('listCollections', () => {
	it('returns sorted, deduped collection names', () => {
		const items = [
			makeItem({ queue_tag: 'Favorites' }),
			makeItem({ queue_tag: 'Action' }),
			makeItem({ queue_tag: 'Favorites' }),
			makeItem({ queue_tag: undefined })
		];

		const result = listCollections(items);

		expect(result).toEqual(['Action', 'Favorites']);
	});

	it('returns empty array when no items have queue_tag', () => {
		const items = [makeItem(), makeItem({ queue_tag: null })];

		const result = listCollections(items);

		expect(result).toEqual([]);
	});

	it('merges in extraNames, deduped and sorted, for collections with no items yet', () => {
		const items = [makeItem({ queue_tag: 'Favorites' })];

		const result = listCollections(items, ['Weekend Watch', 'Favorites']);

		expect(result).toEqual(['Favorites', 'Weekend Watch']);
	});
});

describe('groupIntoCollections', () => {
	it('groups items alphabetically by tag with Uncategorized pinned last', () => {
		const drama = makeItem({ id: 1, title: 'Drama Item', queue_tag: 'Drama' });
		const action1 = makeItem({ id: 2, title: 'Action Item 1', queue_tag: 'Action' });
		const noTag = makeItem({ id: 3, title: 'No Tag Item', queue_tag: undefined });
		const action2 = makeItem({ id: 4, title: 'Action Item 2', queue_tag: 'Action' });

		const sections = groupIntoCollections([drama, action1, noTag, action2], {
			Action: '#ef4444',
			Drama: '#3b82f6'
		});

		expect(sections.map((s) => s.name)).toEqual(['Action', 'Drama', 'Uncategorized']);
		expect(sections[0].items).toEqual([action1, action2]);
		expect(sections[0].color).toBe('#ef4444');
		expect(sections[0].tag).toBe('Action');
		expect(sections[2].tag).toBeNull();
		expect(sections[2].color).toBeNull();
		expect(sections[2].items).toEqual([noTag]);
	});

	it('omits the Uncategorized section when every item has a tag', () => {
		const sections = groupIntoCollections([makeItem({ queue_tag: 'Drama' })], {});
		expect(sections.map((s) => s.name)).toEqual(['Drama']);
	});

	it('returns a single Uncategorized section when no items have a tag', () => {
		const sections = groupIntoCollections([makeItem(), makeItem({ id: 2 })], {});
		expect(sections.map((s) => s.name)).toEqual(['Uncategorized']);
	});

	it('returns an empty array for an empty item list', () => {
		expect(groupIntoCollections([], {})).toEqual([]);
	});

	it('preserves item order within each section', () => {
		const b = makeItem({ id: 1, title: 'B', queue_tag: 'X' });
		const a = makeItem({ id: 2, title: 'A', queue_tag: 'X' });
		const sections = groupIntoCollections([b, a], {});
		expect(sections[0].items).toEqual([b, a]);
	});
});

describe('setItemCollection', () => {
	it('sets a collection, reloads, and clears busy state on success', async () => {
		const { state, deps } = makeDeps();
		const item = makeItem({ id: 6 });
		setQueueTag.mockResolvedValue(undefined);
		getAll.mockResolvedValue([{ ...item, queue_tag: 'Drama' }]);

		await setItemCollection(item, 'Drama', deps);

		expect(setQueueTag).toHaveBeenCalledWith(6, 'Drama');
		expect(state.items[0].queue_tag).toBe('Drama');
		expect(state.busy.has(6)).toBe(false);
	});

	it('clears a collection (null) on success', async () => {
		const { state, deps } = makeDeps();
		const item = makeItem({ id: 8, queue_tag: 'Action' });
		setQueueTag.mockResolvedValue(undefined);
		getAll.mockResolvedValue([{ ...item, queue_tag: undefined }]);

		await setItemCollection(item, null, deps);

		expect(setQueueTag).toHaveBeenCalledWith(8, null);
		expect(state.busy.has(8)).toBe(false);
	});

	it('sets an error and clears busy state when setQueueTag throws', async () => {
		const { state, deps } = makeDeps();
		const item = makeItem({ id: 10 });
		setQueueTag.mockRejectedValue(new Error('storage full'));

		await setItemCollection(item, 'Drama', deps);

		expect(state.error).toBe('storage full');
		expect(state.busy.has(10)).toBe(false);
	});
});

describe('bulkSetCollection', () => {
	it('tags every selected item and reloads once', async () => {
		const { state, deps } = makeDeps();
		const items = [makeItem({ id: 1 }), makeItem({ id: 2 }), makeItem({ id: 3 })];
		setQueueTag.mockResolvedValue(undefined);
		getAll.mockResolvedValue(items.map((i) => ({ ...i, queue_tag: 'Movie Night' })));

		await bulkSetCollection(items, 'Movie Night', deps);

		expect(setQueueTag).toHaveBeenCalledTimes(3);
		expect(setQueueTag).toHaveBeenCalledWith(1, 'Movie Night');
		expect(setQueueTag).toHaveBeenCalledWith(2, 'Movie Night');
		expect(setQueueTag).toHaveBeenCalledWith(3, 'Movie Night');
		expect(getAll).toHaveBeenCalledTimes(1);
		expect(state.items).toHaveLength(3);
	});

	it('clears busy for every item, even the ones that ran before a failure', async () => {
		const { state, deps } = makeDeps();
		const items = [makeItem({ id: 1 }), makeItem({ id: 2 })];
		setQueueTag.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('write failed'));

		await bulkSetCollection(items, 'Drama', deps);

		expect(state.error).toBe('write failed');
		expect(state.busy.has(1)).toBe(false);
		expect(state.busy.has(2)).toBe(false);
	});

	it('clears a collection from every selected item with null', async () => {
		const { deps } = makeDeps();
		const items = [
			makeItem({ id: 1, queue_tag: 'Drama' }),
			makeItem({ id: 2, queue_tag: 'Drama' })
		];
		setQueueTag.mockResolvedValue(undefined);
		getAll.mockResolvedValue([]);

		await bulkSetCollection(items, null, deps);

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
