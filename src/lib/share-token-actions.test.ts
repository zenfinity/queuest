import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ShareItem } from './types';
import type { DuplicateSkip } from './share-token-actions';

const addItem = vi.fn();
const getItemByTmdbId = vi.fn();
const getOrAssignColor = vi.fn();

vi.mock('./db', () => ({
	addItem: (...args: unknown[]) => addItem(...args),
	getItemByTmdbId: (...args: unknown[]) => getItemByTmdbId(...args)
}));

vi.mock('./queue-colors', () => ({
	getOrAssignColor: (...args: unknown[]) => getOrAssignColor(...args)
}));

const { addAllToQueue } = await import('./share-token-actions');

function makeShareItem(overrides: Partial<ShareItem> = {}): ShareItem {
	return {
		tmdb_id: 100,
		media_type: 'movie',
		title: 'Arrival',
		poster_path: null,
		providers: [],
		runtime_minutes: 116,
		seasons: [],
		...overrides
	};
}

function makeDeps() {
	const state = {
		addingAll: false,
		addedCount: 0,
		skips: [] as DuplicateSkip[],
		addDone: false,
		addError: ''
	};
	const deps = {
		setAddingAll: (v: boolean) => {
			state.addingAll = v;
		},
		setAddedCount: (v: number) => {
			state.addedCount = v;
		},
		setSkips: (v: DuplicateSkip[]) => {
			state.skips = v;
		},
		setAddDone: (v: boolean) => {
			state.addDone = v;
		},
		setAddError: (v: string) => {
			state.addError = v;
		}
	};
	return { state, deps };
}

beforeEach(() => {
	addItem.mockReset();
	getItemByTmdbId.mockReset();
	getItemByTmdbId.mockResolvedValue(undefined);
	getOrAssignColor.mockReset();
});

describe('addAllToQueue', () => {
	it('adds every item and reports the added count, with the busy flag cleared', async () => {
		const { state, deps } = makeDeps();
		addItem.mockResolvedValue(undefined);

		await addAllToQueue(
			[makeShareItem({ title: 'A' }), makeShareItem({ title: 'B' })],
			'My Queue',
			deps
		);

		expect(addItem).toHaveBeenCalledTimes(2);
		expect(state.addedCount).toBe(2);
		expect(state.skips).toEqual([]);
		expect(state.addDone).toBe(true);
		expect(state.addingAll).toBe(false);
		expect(state.addError).toBe('');
	});

	it('counts a ConstraintError (already in queue) as a skip, not a failure', async () => {
		const { state, deps } = makeDeps();
		addItem.mockRejectedValue(new DOMException('dup', 'ConstraintError'));
		getItemByTmdbId.mockResolvedValue({ id: 1, queue_tag: 'Horror October', deleted_at: null });

		await addAllToQueue([makeShareItem()], 'My Queue', deps);

		expect(state.skips).toEqual([{ title: 'Arrival', existingTag: 'Horror October' }]);
		expect(state.addedCount).toBe(0);
		expect(state.addDone).toBe(true);
		expect(state.addError).toBe('');
	});

	it('attributes a skip to the untagged queue when the existing row has no tag', async () => {
		const { state, deps } = makeDeps();
		addItem.mockRejectedValue(new DOMException('dup', 'ConstraintError'));
		getItemByTmdbId.mockResolvedValue({ id: 1, queue_tag: null, deleted_at: null });

		await addAllToQueue([makeShareItem()], 'My Queue', deps);

		expect(state.skips).toEqual([{ title: 'Arrival', existingTag: null }]);
	});

	it('does not attribute a skip to a list when the matching row is a tombstone', async () => {
		const { state, deps } = makeDeps();
		addItem.mockRejectedValue(new DOMException('dup', 'ConstraintError'));
		getItemByTmdbId.mockResolvedValue({
			id: 1,
			queue_tag: 'Horror October',
			deleted_at: '2026-01-01T00:00:00.000Z'
		});

		await addAllToQueue([makeShareItem()], 'My Queue', deps);

		expect(state.skips).toEqual([{ title: 'Arrival', existingTag: null }]);
	});

	it('only surfaces an error when nothing was added or skipped', async () => {
		const { state, deps } = makeDeps();
		addItem.mockRejectedValue(new Error('IDB write failed'));

		await addAllToQueue([makeShareItem()], 'My Queue', deps);

		expect(state.addError).toBe('Arrival: Error: IDB write failed');
		expect(state.addingAll).toBe(false);
	});

	it('assigns the fallback color once and a per-item color only for a differing queue_tag', async () => {
		const { deps } = makeDeps();
		addItem.mockResolvedValue(undefined);

		await addAllToQueue(
			[makeShareItem({ queue_tag: 'Horror' }), makeShareItem({ queue_tag: null })],
			'My Queue',
			deps
		);

		// Fallback tag ("My Queue") is assigned up front, then again for the
		// item that has no queue_tag of its own; "Horror" is assigned once for
		// the item that differs from the fallback.
		expect(getOrAssignColor).toHaveBeenCalledWith('My Queue');
		expect(getOrAssignColor).toHaveBeenCalledWith('Horror');
	});

	it('falls back to "Shared List" when no queue name is provided', async () => {
		const { deps } = makeDeps();
		addItem.mockResolvedValue(undefined);

		await addAllToQueue([makeShareItem()], '', deps);

		const [written] = addItem.mock.calls[0];
		expect(written.queue_tag).toBe('Shared List');
	});
});
