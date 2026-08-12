import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { WatchlistItem } from './types';

const addItem = vi.fn();
const replaceAll = vi.fn();
const setServices = vi.fn();
const decrypt = vi.fn();
const deserializeAppState = vi.fn();
const setQueueName = vi.fn();
const setQueueColor = vi.fn();
const parseImportCSV = vi.fn();

vi.mock('./db', () => ({
	addItem: (...args: unknown[]) => addItem(...args),
	replaceAll: (...args: unknown[]) => replaceAll(...args),
	setServices: (...args: unknown[]) => setServices(...args)
}));

vi.mock('./crypto', () => ({
	decrypt: (...args: unknown[]) => decrypt(...args)
}));

vi.mock('./app-state', () => ({
	deserializeAppState: (...args: unknown[]) => deserializeAppState(...args)
}));

vi.mock('./queue-colors', () => ({
	setQueueName: (...args: unknown[]) => setQueueName(...args),
	setQueueColor: (...args: unknown[]) => setQueueColor(...args)
}));

vi.mock('./import', () => ({
	parseImportCSV: (...args: unknown[]) => parseImportCSV(...args)
}));

const { importRows, replaceAllItems, restoreBackup, fetchCsvFromUrl } =
	await import('./import-actions');

function makeItem(
	overrides: Partial<WatchlistItem> = {}
): Omit<WatchlistItem, 'id' | 'added_at' | 'watched_at'> {
	return {
		tmdb_id: 100,
		media_type: 'movie',
		title: 'Test Title',
		poster_path: null,
		overview: null,
		providers: [],
		runtime_minutes: 100,
		seasons: [],
		watched_seasons: [],
		...overrides
	};
}

function makeImportDeps() {
	const state = {
		importing: false,
		importTotal: 0,
		importDone: 0,
		importAdded: 0,
		importError: '',
		missedTitles: [] as string[],
		importDoneOnce: false
	};
	const deps = {
		setImporting: (v: boolean) => {
			state.importing = v;
		},
		setImportTotal: (v: number) => {
			state.importTotal = v;
		},
		setImportDone: (v: number) => {
			state.importDone = v;
		},
		setImportAdded: (v: number) => {
			state.importAdded = v;
		},
		setImportError: (v: string) => {
			state.importError = v;
		},
		setMissedTitles: (v: string[]) => {
			state.missedTitles = v;
		},
		setImportDoneOnce: (v: boolean) => {
			state.importDoneOnce = v;
		}
	};
	return { state, deps };
}

const fetchMock = vi.fn();

beforeEach(() => {
	addItem.mockReset();
	replaceAll.mockReset();
	setServices.mockReset();
	decrypt.mockReset();
	deserializeAppState.mockReset();
	setQueueName.mockReset();
	setQueueColor.mockReset();
	parseImportCSV.mockReset();
	fetchMock.mockReset();
	vi.stubGlobal('fetch', fetchMock);
	vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} });
	// restoreBackup toggles document.documentElement's dark class directly;
	// stub a minimal DOM shape so the theme-restore branch is exercisable
	// under the Node test environment.
	vi.stubGlobal('document', {
		documentElement: { classList: { toggle: vi.fn() } }
	});
});

describe('importRows', () => {
	it('does nothing for an empty row list', async () => {
		const { deps } = makeImportDeps();
		await importRows([], deps);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('adds matched titles and reports missed ones', async () => {
		const { state, deps } = makeImportDeps();
		fetchMock.mockResolvedValue({
			ok: true,
			json: async () => [
				{ title: 'Arrival', result: makeItem({ title: 'Arrival' }) },
				{ title: 'Nonexistent Movie XYZ', result: null }
			]
		});
		addItem.mockResolvedValue(undefined);

		await importRows([{ title: 'Arrival', year: null, mediaTypeHint: 'auto' }], deps);

		expect(state.importTotal).toBe(1);
		expect(addItem).toHaveBeenCalledTimes(1);
		expect(state.importAdded).toBe(1);
		expect(state.missedTitles).toEqual(['Nonexistent Movie XYZ']);
		expect(state.importDoneOnce).toBe(true);
		expect(state.importing).toBe(false);
	});

	it('treats a duplicate (ConstraintError) as a successful add', async () => {
		const { state, deps } = makeImportDeps();
		fetchMock.mockResolvedValue({
			ok: true,
			json: async () => [{ title: 'Arrival', result: makeItem() }]
		});
		addItem.mockRejectedValue(new DOMException('dup', 'ConstraintError'));

		await importRows([{ title: 'Arrival', year: null, mediaTypeHint: 'auto' }], deps);

		expect(state.importAdded).toBe(1);
		expect(state.importError).toBe('');
	});

	it('surfaces a non-ConstraintError add failure and still clears importing', async () => {
		const { state, deps } = makeImportDeps();
		fetchMock.mockResolvedValue({
			ok: true,
			json: async () => [{ title: 'Arrival', result: makeItem() }]
		});
		addItem.mockRejectedValue(new Error('IDB write failed'));

		await importRows([{ title: 'Arrival', year: null, mediaTypeHint: 'auto' }], deps);

		expect(state.importError).toBe('IDB write failed');
		expect(state.importing).toBe(false);
	});

	it('surfaces a non-ok batch response as an error', async () => {
		const { state, deps } = makeImportDeps();
		fetchMock.mockResolvedValue({
			ok: false,
			statusText: 'Bad Gateway',
			json: async () => ({ error: 'boom' })
		});

		await importRows([{ title: 'Arrival', year: null, mediaTypeHint: 'auto' }], deps);

		expect(state.importError).toBe('boom');
		expect(state.importing).toBe(false);
	});
});

describe('replaceAllItems', () => {
	it('drops ids (device-local, must not round-trip) and delegates to replaceAll', async () => {
		replaceAll.mockResolvedValue(undefined);
		const item = {
			...makeItem({ title: 'A' }),
			added_at: '2024-01-01T00:00:00.000Z',
			watched_at: null
		};
		await replaceAllItems([item, { ...item, title: 'B' }]);

		expect(replaceAll).toHaveBeenCalledTimes(1);
		const [written] = replaceAll.mock.calls[0];
		expect(written.every((i: WatchlistItem) => !('id' in i))).toBe(true);
	});

	it('passes added_at/watched_at through unchanged — deserializeAppState already resolved them', async () => {
		replaceAll.mockResolvedValue(undefined);
		const item = {
			...makeItem({ title: 'Arrival' }),
			id: 7,
			added_at: '2024-03-01T00:00:00.000Z',
			watched_at: '2024-04-01T00:00:00.000Z'
		};

		await replaceAllItems([item as unknown as Omit<WatchlistItem, 'id'>]);

		const [written] = replaceAll.mock.calls[0];
		expect(written[0].added_at).toBe('2024-03-01T00:00:00.000Z');
		expect(written[0].watched_at).toBe('2024-04-01T00:00:00.000Z');
	});
});

describe('restoreBackup', () => {
	it('does nothing without both a file and a passphrase', async () => {
		const { deps } = makeImportDeps();
		await restoreBackup(null as unknown as File, '', { ...deps, setThemeDark: () => {} });
		expect(decrypt).not.toHaveBeenCalled();
	});

	it('restores items, theme, and services on success', async () => {
		const { state, deps } = makeImportDeps();
		let themeSet: boolean | null = null;
		decrypt.mockResolvedValue(
			JSON.stringify({ items: [makeItem()], prefs: { theme: 'dark' }, services: [] })
		);
		deserializeAppState.mockReturnValue({
			items: [makeItem()],
			prefs: { theme: 'dark' },
			services: []
		});
		replaceAll.mockResolvedValue(undefined);
		setServices.mockResolvedValue(undefined);
		const file = { arrayBuffer: async () => new ArrayBuffer(8) } as unknown as File;

		await restoreBackup(file, 'hunter2', {
			...deps,
			setThemeDark: (dark) => {
				themeSet = dark;
			}
		});

		expect(replaceAll).toHaveBeenCalledTimes(1);
		expect(setServices).toHaveBeenCalledWith([]);
		expect(themeSet).toBe(true);
		expect(state.importDoneOnce).toBe(true);
		expect(state.importing).toBe(false);
	});

	it('surfaces a decrypt failure (e.g. wrong passphrase) as an error', async () => {
		const { state, deps } = makeImportDeps();
		decrypt.mockRejectedValue(new Error('Decryption failed — wrong passphrase or corrupted file.'));
		const file = { arrayBuffer: async () => new ArrayBuffer(8) } as unknown as File;

		await restoreBackup(file, 'wrong', { ...deps, setThemeDark: () => {} });

		expect(state.importError).toBe('Decryption failed — wrong passphrase or corrupted file.');
		expect(state.importing).toBe(false);
	});
});

describe('fetchCsvFromUrl', () => {
	it('returns empty for a blank url', async () => {
		const result = await fetchCsvFromUrl('   ');
		expect(result).toEqual({ rows: [], format: 'unknown' });
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('parses the body from a direct fetch when it succeeds', async () => {
		fetchMock.mockResolvedValue({ ok: true, text: async () => 'name,year\nArrival,2016' });
		parseImportCSV.mockReturnValue({
			rows: [{ title: 'Arrival', year: '2016', mediaTypeHint: 'movie' }],
			format: 'letterboxd'
		});

		const result = await fetchCsvFromUrl('https://letterboxd.com/x/watchlist.csv');

		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(result.format).toBe('letterboxd');
		expect(result.rows).toHaveLength(1);
	});

	it('falls back to the server proxy when the direct fetch fails', async () => {
		fetchMock
			.mockRejectedValueOnce(new Error('CORS blocked'))
			.mockResolvedValueOnce({ ok: true, text: async () => 'name,year\nArrival,2016' });
		parseImportCSV.mockReturnValue({
			rows: [{ title: 'Arrival', year: '2016', mediaTypeHint: 'movie' }],
			format: 'letterboxd'
		});

		const result = await fetchCsvFromUrl('https://letterboxd.com/x/watchlist.csv');

		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(result.format).toBe('letterboxd');
	});

	it('throws when both the direct fetch and the proxy fail', async () => {
		fetchMock.mockRejectedValueOnce(new Error('CORS blocked')).mockResolvedValueOnce({
			ok: false,
			statusText: 'Not Found',
			json: async () => ({ error: 'no' })
		});

		await expect(fetchCsvFromUrl('https://example.com/x.csv')).rejects.toThrow('no');
	});
});
