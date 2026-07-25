import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { WatchlistItem } from './types';

const getAll = vi.fn();
const setWatched = vi.fn();
const removeItem = vi.fn();
const updateShowProgress = vi.fn();

vi.mock('./db', () => ({
	getAll: (...args: unknown[]) => getAll(...args),
	setWatched: (...args: unknown[]) => setWatched(...args),
	removeItem: (...args: unknown[]) => removeItem(...args),
	updateShowProgress: (...args: unknown[]) => updateShowProgress(...args)
}));

const { reloadQueue, toggleWatched, removeQueueItem, toggleSeasonProgress } =
	await import('./queue-actions');

function makeItem(overrides: Partial<WatchlistItem> = {}): WatchlistItem {
	return {
		id: 1,
		tmdb_id: 100,
		media_type: 'movie',
		title: 'Test Title',
		poster_path: null,
		overview: null,
		providers: [],
		runtime_minutes: 100,
		seasons: [],
		watched_seasons: [],
		current_season: null,
		current_episode: null,
		added_at: '2026-01-01T00:00:00.000Z',
		watched_at: null,
		...overrides
	};
}

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
});

describe('reloadQueue', () => {
	it('loads items into state on success', async () => {
		const { state, deps } = makeDeps();
		const items = [makeItem()];
		getAll.mockResolvedValue(items);

		await reloadQueue(deps);

		expect(state.items).toBe(items);
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
			watched_seasons: [1],
			current_season: 2,
			current_episode: 3
		});
		updateShowProgress.mockResolvedValue(undefined);
		getAll.mockResolvedValue([]);

		await toggleSeasonProgress(item, 2, deps);

		expect(updateShowProgress).toHaveBeenCalledWith(2, [1, 2], 2, 3);
	});

	it('removes an already-watched season (toggles off)', async () => {
		const { deps } = makeDeps();
		const item = makeItem({
			id: 2,
			media_type: 'tv',
			watched_seasons: [1, 2],
			current_season: null,
			current_episode: null
		});
		updateShowProgress.mockResolvedValue(undefined);
		getAll.mockResolvedValue([]);

		await toggleSeasonProgress(item, 2, deps);

		expect(updateShowProgress).toHaveBeenCalledWith(2, [1], null, null);
	});

	it('surfaces a failure as an error message', async () => {
		const { state, deps } = makeDeps();
		const item = makeItem({ id: 2, media_type: 'tv' });
		updateShowProgress.mockRejectedValue(new Error('write failed'));

		await toggleSeasonProgress(item, 1, deps);

		expect(state.error).toBe('write failed');
	});
});
