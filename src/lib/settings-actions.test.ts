import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Provider } from './types';

const getAll = vi.fn();
const replaceAll = vi.fn();
const patchProviders = vi.fn();
const getServices = vi.fn();
const setServices = vi.fn();
const encrypt = vi.fn();
const getQueueName = vi.fn();
const getQueueColors = vi.fn();

vi.mock('./db', () => ({
	getAll: (...args: unknown[]) => getAll(...args),
	replaceAll: (...args: unknown[]) => replaceAll(...args),
	patchProviders: (...args: unknown[]) => patchProviders(...args),
	getServices: (...args: unknown[]) => getServices(...args),
	setServices: (...args: unknown[]) => setServices(...args)
}));

vi.mock('./crypto', () => ({
	encrypt: (...args: unknown[]) => encrypt(...args)
}));

vi.mock('./queue-colors', () => ({
	getQueueName: (...args: unknown[]) => getQueueName(...args),
	getQueueColors: (...args: unknown[]) => getQueueColors(...args)
}));

const { buildExportBlob, refreshProviders, submitFeedback, resetEverything } =
	await import('./settings-actions');

function makeProvider(overrides: Partial<Provider> = {}): Provider {
	return { provider_id: 8, provider_name: 'Netflix', logo_path: '/n.png', ...overrides };
}

// Mirrors the full SettingsActionDeps shape so both refreshProviders and
// submitFeedback can share one fake — same pattern as queue-actions.test.ts's
// makeDeps, extended to cover both halves of the interface.
function makeDeps() {
	const state = {
		refreshing: false,
		refreshError: '',
		refreshSuccess: false,
		refreshTotal: 0,
		refreshDone: 0,
		feedbackError: '',
		feedbackIssueUrl: ''
	};
	const deps = {
		setRefreshing: (v: boolean) => {
			state.refreshing = v;
		},
		setRefreshError: (v: string) => {
			state.refreshError = v;
		},
		setRefreshSuccess: (v: boolean) => {
			state.refreshSuccess = v;
		},
		setRefreshTotal: (v: number) => {
			state.refreshTotal = v;
		},
		setRefreshDone: (v: number) => {
			state.refreshDone = v;
		},
		setFeedbackError: (v: string) => {
			state.feedbackError = v;
		},
		setFeedbackIssueUrl: (v: string) => {
			state.feedbackIssueUrl = v;
		}
	};
	return { state, deps };
}

const fetchMock = vi.fn();

beforeEach(() => {
	getAll.mockReset();
	replaceAll.mockReset();
	patchProviders.mockReset();
	getServices.mockReset();
	setServices.mockReset();
	encrypt.mockReset();
	getQueueName.mockReset();
	getQueueColors.mockReset();
	fetchMock.mockReset();
	vi.stubGlobal('fetch', fetchMock);
	// Node 22+ defines a partial, non-Storage-shaped global `localStorage`
	// that breaks the `typeof localStorage !== 'undefined'` guards in
	// settings-actions.ts. Stub a real (empty) Storage-like object so tests
	// don't depend on the host Node version's behavior.
	vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} });
});

describe('buildExportBlob', () => {
	it('encrypts a payload containing items, services, and prefs, and returns an octet-stream blob', async () => {
		getAll.mockResolvedValue([{ id: 1, title: 'Arrival' }]);
		getServices.mockResolvedValue([{ provider_id: 8 }]);
		getQueueName.mockReturnValue('My Queue');
		getQueueColors.mockReturnValue({ Horror: '#ef4444' });
		encrypt.mockResolvedValue(new ArrayBuffer(8));

		const blob = await buildExportBlob('hunter2');

		expect(encrypt).toHaveBeenCalledTimes(1);
		const [json, passphrase] = encrypt.mock.calls[0];
		expect(passphrase).toBe('hunter2');
		const payload = JSON.parse(json);
		expect(payload.version).toBe(2);
		expect(payload.items).toEqual([{ id: 1, title: 'Arrival' }]);
		expect(payload.services).toEqual([{ provider_id: 8 }]);
		// No sq:budget:weekly/weeks in localStorage (stub returns null) -> defaults
		expect(payload.prefs.weeklyHours).toBe(10);
		expect(payload.prefs.weeksPerMonth).toBe(4);
		expect(payload.prefs.budget).toBe(40);
		expect(payload.prefs.queueName).toBe('My Queue');
		expect(payload.prefs.queueColors).toEqual({ Horror: '#ef4444' });
		expect(blob.type).toBe('application/octet-stream');
	});
});

describe('refreshProviders', () => {
	it('reports success with zero items when the queue is empty, without hitting the network', async () => {
		const { state, deps } = makeDeps();
		getAll.mockResolvedValue([]);

		await refreshProviders(deps);

		expect(fetchMock).not.toHaveBeenCalled();
		expect(state.refreshTotal).toBe(0);
		expect(state.refreshSuccess).toBe(true);
		expect(state.refreshing).toBe(false);
	});

	it('patches providers for each returned result and reports progress', async () => {
		const { state, deps } = makeDeps();
		getAll.mockResolvedValue([
			{ id: 1, tmdb_id: 100, media_type: 'movie' },
			{ id: 2, tmdb_id: 200, media_type: 'tv' }
		]);
		fetchMock.mockResolvedValue({
			ok: true,
			json: async () => [
				{ id: 1, providers: [makeProvider()], rentable: false, release: null },
				{ id: 2, providers: [], rentable: true, release: null }
			]
		});

		await refreshProviders(deps);

		expect(state.refreshTotal).toBe(2);
		expect(patchProviders).toHaveBeenCalledTimes(2);
		expect(patchProviders).toHaveBeenNthCalledWith(
			1,
			1,
			[makeProvider()],
			false,
			null,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined
		);
		expect(state.refreshDone).toBe(2);
		expect(state.refreshSuccess).toBe(true);
		expect(state.refreshing).toBe(false);
	});

	it('surfaces a non-ok response as an error and still clears the refreshing flag', async () => {
		const { state, deps } = makeDeps();
		getAll.mockResolvedValue([{ id: 1, tmdb_id: 100, media_type: 'movie' }]);
		fetchMock.mockResolvedValue({
			ok: false,
			status: 500,
			statusText: 'Internal Server Error',
			json: async () => ({ error: 'boom' })
		});

		await refreshProviders(deps);

		expect(state.refreshError).toBe('boom');
		expect(state.refreshSuccess).toBe(false);
		expect(state.refreshing).toBe(false);
	});

	it('surfaces a network failure as an error', async () => {
		const { state, deps } = makeDeps();
		getAll.mockResolvedValue([{ id: 1, tmdb_id: 100, media_type: 'movie' }]);
		fetchMock.mockRejectedValue(new Error('offline'));

		await refreshProviders(deps);

		expect(state.refreshError).toBe('offline');
		expect(state.refreshing).toBe(false);
	});
});

describe('submitFeedback', () => {
	it('does nothing for a blank title', async () => {
		const { deps } = makeDeps();
		await submitFeedback('   ', 'body', deps);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('sets the issue URL on success', async () => {
		const { state, deps } = makeDeps();
		fetchMock.mockResolvedValue({
			ok: true,
			json: async () => ({ url: 'https://github.com/x/y/issues/1' })
		});

		await submitFeedback('Bug report', 'details', deps);

		expect(state.feedbackIssueUrl).toBe('https://github.com/x/y/issues/1');
		expect(state.feedbackError).toBe('');
	});

	it('surfaces a non-ok response as an error', async () => {
		const { state, deps } = makeDeps();
		fetchMock.mockResolvedValue({
			ok: false,
			statusText: 'Bad Request',
			json: async () => ({ error: 'Title too long' })
		});

		await submitFeedback('Bug report', 'details', deps);

		expect(state.feedbackError).toBe('Title too long');
	});

	it('surfaces a network failure as an error', async () => {
		const { state, deps } = makeDeps();
		fetchMock.mockRejectedValue(new Error('offline'));

		await submitFeedback('Bug report', 'details', deps);

		expect(state.feedbackError).toBe('offline');
	});
});

describe('resetEverything', () => {
	it('clears the watchlist and services stores', async () => {
		replaceAll.mockResolvedValue(undefined);
		setServices.mockResolvedValue(undefined);

		await resetEverything();

		expect(replaceAll).toHaveBeenCalledWith([]);
		expect(setServices).toHaveBeenCalledWith([]);
	});

	it('removes the actual localStorage keys the app writes, not stale hyphenated names', async () => {
		replaceAll.mockResolvedValue(undefined);
		setServices.mockResolvedValue(undefined);
		const removeItem = vi.fn();
		vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem });

		await resetEverything();

		const removed = removeItem.mock.calls.map((c) => c[0]);
		// queue-colors.ts writes these with colons, not hyphens — asserting the
		// real names guards against the sq:queue-name / sq:queue-colors typo
		// that let "Reset everything" leave the queue name and colors behind.
		expect(removed).toContain('sq:queue:name');
		expect(removed).toContain('sq:queue:colors');
		expect(removed).not.toContain('sq:queue-name');
		expect(removed).not.toContain('sq:queue-colors');
		// Previously missing from the reset list entirely.
		expect(removed).toContain('sq:sortDir');
		expect(removed).toContain('sq:cancel-alerts');
		expect(removed).toContain('sq:dismiss-cancel');
		expect(removed).toContain('sq:budget-callout-dismissed');
	});
});
