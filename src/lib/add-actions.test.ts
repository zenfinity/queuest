import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SearchResult } from './types';

const addItem = vi.fn();

vi.mock('./db', () => ({
	addItem: (...args: unknown[]) => addItem(...args)
}));

const { addSearchResultToQueue } = await import('./add-actions');

function makeResult(overrides: Partial<SearchResult> = {}): SearchResult {
	return {
		id: 100,
		media_type: 'movie',
		title: 'Arrival',
		poster_path: null,
		overview: '',
		year: '2016',
		providers: [],
		rentable: false,
		runtime_minutes: 116,
		seasons: [],
		release: null,
		genres: [],
		cast: [],
		director: null,
		creator: null,
		imdb_id: null,
		...overrides
	};
}

function makeDeps() {
	const state = {
		adding: new Set<number>(),
		added: new Set<number>(),
		errors: new Map<number, string>()
	};
	const deps = {
		setAdding: (id: number, isAdding: boolean) => {
			const next = new Set(state.adding);
			if (isAdding) next.add(id);
			else next.delete(id);
			state.adding = next;
		},
		setAdded: (id: number, isAdded: boolean) => {
			const next = new Set(state.added);
			if (isAdded) next.add(id);
			else next.delete(id);
			state.added = next;
		},
		setError: (id: number, message: string) => {
			const next = new Map(state.errors);
			if (message) next.set(id, message);
			else next.delete(id);
			state.errors = next;
		}
	};
	return { state, deps };
}

beforeEach(() => {
	addItem.mockReset();
});

describe('addSearchResultToQueue', () => {
	it('marks the item added on success and clears busy state', async () => {
		const { state, deps } = makeDeps();
		addItem.mockResolvedValue(undefined);

		await addSearchResultToQueue(makeResult({ id: 1 }), deps);

		expect(state.added.has(1)).toBe(true);
		expect(state.adding.has(1)).toBe(false);
		expect(state.errors.has(1)).toBe(false);
	});

	it('treats a duplicate (ConstraintError) as a successful add', async () => {
		const { state, deps } = makeDeps();
		addItem.mockRejectedValue(new DOMException('dup', 'ConstraintError'));

		await addSearchResultToQueue(makeResult({ id: 2 }), deps);

		expect(state.added.has(2)).toBe(true);
		expect(state.errors.has(2)).toBe(false);
	});

	it('surfaces a non-ConstraintError failure and still clears the busy flag', async () => {
		const { state, deps } = makeDeps();
		addItem.mockRejectedValue(new Error('IDB write failed'));

		await addSearchResultToQueue(makeResult({ id: 3 }), deps);

		expect(state.errors.get(3)).toBe('IDB write failed');
		expect(state.added.has(3)).toBe(false);
		// This is the bug #48 fixed: busy must clear via `finally` even on
		// failure, or the button stays disabled forever.
		expect(state.adding.has(3)).toBe(false);
	});
});
