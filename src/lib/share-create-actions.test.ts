import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { WatchlistItem } from './types';

const generateShareKey = vi.fn();
const encryptWithKey = vi.fn();
const getQueueName = vi.fn();

vi.mock('./crypto', () => ({
	generateShareKey: (...args: unknown[]) => generateShareKey(...args),
	encryptWithKey: (...args: unknown[]) => encryptWithKey(...args)
}));

vi.mock('./queue-colors', () => ({
	getQueueName: (...args: unknown[]) => getQueueName(...args)
}));

const { createShareLink } = await import('./share-create-actions');

function makeItem(overrides: Partial<WatchlistItem> = {}): WatchlistItem {
	return {
		id: 1,
		tmdb_id: 100,
		media_type: 'movie',
		title: 'Arrival',
		poster_path: null,
		overview: null,
		providers: [],
		runtime_minutes: 116,
		seasons: [],
		watched_seasons: [],
		added_at: '2026-01-01T00:00:00.000Z',
		watched_at: null,
		...overrides
	};
}

function makeDeps() {
	const state = { creating: false, url: '', error: '' };
	const deps = {
		setShareCreating: (v: boolean) => {
			state.creating = v;
		},
		setShareUrl: (v: string) => {
			state.url = v;
		},
		setShareError: (v: string) => {
			state.error = v;
		}
	};
	return { state, deps };
}

const fetchMock = vi.fn();

beforeEach(() => {
	generateShareKey.mockReset();
	encryptWithKey.mockReset();
	getQueueName.mockReset();
	fetchMock.mockReset();
	vi.stubGlobal('fetch', fetchMock);
	// createShareLink builds the URL via window.location.origin and only runs
	// that branch behind a `typeof window !== 'undefined'` guard; stub the one
	// property it reads so the Node test environment can exercise it.
	vi.stubGlobal('window', { location: { origin: 'https://queuest.app' } });
});

describe('createShareLink', () => {
	it('does nothing when there are no filtered items', async () => {
		const { deps } = makeDeps();
		await createShareLink([], new Set(), [], deps);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('builds the share URL with the key in the fragment, never sent to the server', async () => {
		const { state, deps } = makeDeps();
		generateShareKey.mockResolvedValue('the-key');
		encryptWithKey.mockResolvedValue(new ArrayBuffer(8));
		fetchMock.mockResolvedValue({ ok: true, json: async () => ({ token: 'abc123' }) });

		await createShareLink([makeItem()], new Set(['My Queue']), ['My Queue'], deps);

		const [url, options] = fetchMock.mock.calls[0];
		expect(url).toBe('/api/share');
		expect(options.method).toBe('POST');
		expect(JSON.stringify(options.body)).not.toContain('the-key');
		expect(state.url).toBe('https://queuest.app/share/abc123#the-key');
		expect(state.creating).toBe(false);
		expect(state.error).toBe('');
	});

	it('uses the single active queue name over getQueueName when exactly one queue is selected', async () => {
		generateShareKey.mockResolvedValue('k');
		encryptWithKey.mockImplementation(
			async (json: string) => new TextEncoder().encode(json).buffer
		);
		fetchMock.mockResolvedValue({ ok: true, json: async () => ({ token: 't' }) });
		getQueueName.mockReturnValue('Should not be used');

		const { deps } = makeDeps();
		await createShareLink(
			[makeItem({ queue_tag: 'Horror' })],
			new Set(['Horror']),
			['Horror', 'Comedy'],
			deps
		);

		const [json, key] = encryptWithKey.mock.calls[0];
		expect(key).toBe('k');
		expect(JSON.parse(json).queue_name).toBe('Horror');
		expect(getQueueName).not.toHaveBeenCalled();
	});

	it('surfaces a non-ok response as an error', async () => {
		const { state, deps } = makeDeps();
		generateShareKey.mockResolvedValue('k');
		encryptWithKey.mockResolvedValue(new ArrayBuffer(8));
		fetchMock.mockResolvedValue({
			ok: false,
			statusText: 'Payload too large',
			text: async () => 'boom'
		});

		await createShareLink([makeItem()], new Set(), [], deps);

		expect(state.error).toBe('boom');
		expect(state.creating).toBe(false);
	});

	it('surfaces a network failure as an error', async () => {
		const { state, deps } = makeDeps();
		generateShareKey.mockResolvedValue('k');
		encryptWithKey.mockResolvedValue(new ArrayBuffer(8));
		fetchMock.mockRejectedValue(new Error('offline'));

		await createShareLink([makeItem()], new Set(), [], deps);

		expect(state.error).toBe('offline');
		expect(state.creating).toBe(false);
	});
});
