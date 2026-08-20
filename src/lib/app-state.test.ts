import { describe, it, expect, vi, beforeEach } from 'vitest';

const getAll = vi.fn();
const getServices = vi.fn();
const getQueueName = vi.fn();
const getQueueColors = vi.fn();

vi.mock('./db', () => ({
	getAll: (...args: unknown[]) => getAll(...args),
	getServices: (...args: unknown[]) => getServices(...args)
}));

vi.mock('./queue-colors', () => ({
	getQueueName: (...args: unknown[]) => getQueueName(...args),
	getQueueColors: (...args: unknown[]) => getQueueColors(...args)
}));

const { SYNCED_KEYS, LOCAL_KEYS, APP_STATE_VERSION, serializeAppState, deserializeAppState } =
	await import('./app-state');

beforeEach(() => {
	getAll.mockReset();
	getServices.mockReset();
	getQueueName.mockReset();
	getQueueColors.mockReset();
	vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} });
});

describe('the synced/local key partition', () => {
	it('SYNCED_KEYS and LOCAL_KEYS do not overlap', () => {
		const overlap = SYNCED_KEYS.filter((k) => (LOCAL_KEYS as readonly string[]).includes(k));
		expect(overlap).toEqual([]);
	});

	it('covers exactly the 15 real sq: keys', () => {
		expect(SYNCED_KEYS.length + LOCAL_KEYS.length).toBe(15);
	});

	it('every sq: string literal in the source tree belongs to exactly one set', () => {
		const allKeys = new Set([...SYNCED_KEYS, ...LOCAL_KEYS]);
		const found = new Set<string>();

		// Vite-native source scan (no @types/node dependency for a single test).
		// This module is the one place allowed to declare the keys themselves,
		// so it's excluded, along with test files.
		const modules = import.meta.glob('/src/**/*.{ts,svelte}', {
			query: '?raw',
			import: 'default',
			eager: true
		}) as Record<string, string>;

		for (const [path, content] of Object.entries(modules)) {
			if (path.endsWith('.test.ts')) continue;
			if (path.endsWith('/lib/app-state.ts')) continue;
			const matches = content.matchAll(/'(sq:[a-zA-Z0-9:_-]*)'/g);
			for (const m of matches) found.add(m[1]);
		}

		expect(found.size).toBeGreaterThan(0); // sanity: the scan actually found something
		for (const key of found) {
			expect(allKeys.has(key as (typeof SYNCED_KEYS)[number] | (typeof LOCAL_KEYS)[number])).toBe(
				true
			);
		}
	});
});

describe('serializeAppState', () => {
	it('builds a version-2 snapshot from items, services, and localStorage prefs', async () => {
		getAll.mockResolvedValue([{ id: 1, title: 'Arrival' }]);
		getServices.mockResolvedValue([{ provider_id: 8 }]);
		getQueueName.mockReturnValue('My Queue');
		getQueueColors.mockReturnValue({ Horror: '#ef4444' });

		const snapshot = await serializeAppState();

		expect(snapshot.version).toBe(APP_STATE_VERSION);
		expect(snapshot.items).toEqual([{ id: 1, title: 'Arrival' }]);
		expect(snapshot.services).toEqual([{ provider_id: 8 }]);
		expect(snapshot.prefs.queueName).toBe('My Queue');
		expect(snapshot.prefs.queueColors).toEqual({ Horror: '#ef4444' });
		// No sq: keys in the stub localStorage -> defaults
		expect(snapshot.prefs.weeklyHours).toBe(10);
		expect(snapshot.prefs.weeksPerMonth).toBe(4);
		expect(snapshot.prefs.budget).toBe(40);
		expect(snapshot.prefs.sort).toBe('added');
		expect(snapshot.prefs.sortDir).toBe('desc');
		expect(snapshot.prefs.view).toBe('grid');
		expect(snapshot.prefs.cancelAlerts).toBe(false);
		expect(snapshot.prefs.theme).toBe('dark');
	});

	it('reads real localStorage values when present', async () => {
		getAll.mockResolvedValue([]);
		getServices.mockResolvedValue([]);
		getQueueName.mockReturnValue('My Queue');
		getQueueColors.mockReturnValue({});
		const store: Record<string, string> = {
			'sq:theme': 'light',
			'sq:sort': 'title',
			'sq:sortDir': 'asc',
			'sq:view': 'list',
			'sq:budget:weekly': '15',
			'sq:budget:weeks': '3',
			'sq:cancel-alerts': 'true'
		};
		vi.stubGlobal('localStorage', {
			getItem: (k: string) => store[k] ?? null,
			setItem: () => {},
			removeItem: () => {}
		});

		const snapshot = await serializeAppState();

		expect(snapshot.prefs.theme).toBe('light');
		expect(snapshot.prefs.sort).toBe('title');
		expect(snapshot.prefs.sortDir).toBe('asc');
		expect(snapshot.prefs.view).toBe('list');
		expect(snapshot.prefs.weeklyHours).toBe(15);
		expect(snapshot.prefs.weeksPerMonth).toBe(3);
		expect(snapshot.prefs.budget).toBe(45);
		expect(snapshot.prefs.cancelAlerts).toBe(true);
	});
});

describe('deserializeAppState', () => {
	it('accepts the legacy pre-versioning bare-array format', () => {
		const backup = [
			{
				id: 1,
				tmdb_id: 100,
				media_type: 'movie' as const,
				title: 'Movie 1',
				poster_path: null,
				overview: null,
				providers: [],
				runtime_minutes: 100,
				seasons: [],
				watched_seasons: [],
				added_at: '2026-01-01T00:00:00Z',
				watched_at: null
			}
		];
		const result = deserializeAppState(backup);
		expect(result.items).toHaveLength(1);
		expect(result.items[0].tmdb_id).toBe(100);
	});

	it('accepts version 2 with the full prefs shape', () => {
		const backup = {
			version: 2,
			items: [
				{
					tmdb_id: 200,
					media_type: 'tv' as const,
					title: 'Show',
					poster_path: null,
					overview: null,
					providers: [],
					runtime_minutes: 2000,
					seasons: [],
					watched_seasons: [],
					added_at: '2026-01-01T00:00:00Z',
					watched_at: null
				}
			],
			prefs: {
				theme: 'dark',
				weeklyHours: 15,
				weeksPerMonth: 4,
				queueName: 'My Queue',
				sort: 'added',
				sortDir: 'desc',
				view: 'grid',
				cancelAlerts: true
			},
			services: [{ provider_id: 8, provider_name: 'Netflix', logo_path: '/netflix.png' }]
		};
		const result = deserializeAppState(backup);
		expect(result.items).toHaveLength(1);
		expect(result.prefs?.theme).toBe('dark');
		expect(result.prefs?.weeklyHours).toBe(15);
		expect(result.prefs?.sortDir).toBe('desc');
		expect(result.prefs?.cancelAlerts).toBe(true);
		expect(result.services).toHaveLength(1);
	});

	it('accepts version 1 (missing sortDir/cancelAlerts is fine)', () => {
		const result = deserializeAppState({ version: 1, items: [], prefs: { sort: 'title' } });
		expect(result.prefs?.sort).toBe('title');
		expect(result.prefs?.sortDir).toBeUndefined();
	});

	it('rejects an unsupported future version', () => {
		expect(() => deserializeAppState({ version: 3, items: [] })).toThrow('Unsupported');
	});

	it('preserves real added_at/watched_at from the payload', () => {
		const result = deserializeAppState({
			items: [
				{
					tmdb_id: 1,
					media_type: 'movie',
					title: 'Arrival',
					added_at: '2024-03-01T00:00:00.000Z',
					watched_at: '2024-04-01T00:00:00.000Z'
				}
			]
		});
		expect(result.items[0].added_at).toBe('2024-03-01T00:00:00.000Z');
		expect(result.items[0].watched_at).toBe('2024-04-01T00:00:00.000Z');
	});

	it('falls back to a fresh added_at and unwatched state when the payload has neither', () => {
		const result = deserializeAppState({
			items: [{ tmdb_id: 1, media_type: 'movie', title: 'Arrival' }]
		});
		expect(typeof result.items[0].added_at).toBe('string');
		expect(result.items[0].watched_at).toBeNull();
	});

	it('preserves a deleted_at tombstone from the payload', () => {
		const result = deserializeAppState({
			items: [
				{
					tmdb_id: 1,
					media_type: 'movie',
					title: 'Arrival',
					deleted_at: '2024-05-01T00:00:00.000Z'
				}
			]
		});
		expect(result.items[0].deleted_at).toBe('2024-05-01T00:00:00.000Z');
	});

	it('accepts "lanes" as a valid view (ViewKey, not the pre-rename "gantt")', () => {
		const result = deserializeAppState({ items: [], prefs: { view: 'lanes' } });
		expect(result.prefs?.view).toBe('lanes');
	});

	it('rejects the stale pre-rename "gantt" view value', () => {
		const result = deserializeAppState({ items: [], prefs: { view: 'gantt' } });
		expect(result.prefs?.view).toBeUndefined();
	});

	it('filters out invalid items', () => {
		const backup = {
			items: [
				{ tmdb_id: 1, media_type: 'movie', title: 'Valid', poster_path: null },
				{ tmdb_id: 2, media_type: 'invalid', title: 'Invalid' },
				{ title: 'No tmdb_id', poster_path: null }
			]
		};
		const result = deserializeAppState(backup);
		expect(result.items).toHaveLength(1);
	});

	it('ignores invalid prefs', () => {
		const backup = {
			items: [],
			prefs: {
				theme: 'invalid_theme',
				weeklyHours: -5,
				unknownKey: 'should be dropped'
			}
		};
		const result = deserializeAppState(backup);
		expect(result.prefs?.theme).toBeUndefined();
		expect(result.prefs?.weeklyHours).toBeUndefined();
		expect((result.prefs as Record<string, unknown> | undefined)?.unknownKey).toBeUndefined();
	});

	it('clamps queueColors', () => {
		const longKey = 'a'.repeat(200);
		const longVal = '#'.repeat(100);
		const backup = {
			items: [],
			prefs: {
				queueColors: {
					[longKey]: '#ff0000',
					tag: longVal
				}
			}
		};
		const result = deserializeAppState(backup);
		const colors = result.prefs?.queueColors ?? {};
		const keys = Object.keys(colors);
		expect(keys.some((k) => k.length === 100)).toBe(true);
		const values = Object.values(colors);
		expect(values.some((v) => v.length === 50)).toBe(true);
	});

	it('validates poster_path with the same regex as share payloads', () => {
		const result = deserializeAppState({
			items: [
				{
					tmdb_id: 1,
					media_type: 'movie',
					title: 'Arrival',
					poster_path: 'javascript:alert(1)'
				}
			]
		});
		expect(result.items[0].poster_path).toBeNull();
	});

	it('drops provider entries missing required fields instead of trusting them', () => {
		const result = deserializeAppState({
			items: [
				{
					tmdb_id: 1,
					media_type: 'movie',
					title: 'Arrival',
					providers: [
						{ provider_id: 8, provider_name: 'Netflix', logo_path: '/n.png' },
						{ provider_id: null, provider_name: 'Bad', logo_path: '/b.png' }
					]
				}
			]
		});
		expect(result.items[0].providers).toHaveLength(1);
		expect(result.items[0].providers[0].provider_name).toBe('Netflix');
	});

	it('throws on non-object input', () => {
		expect(() => deserializeAppState(null)).toThrow('Invalid');
		expect(() => deserializeAppState('string')).toThrow('Invalid');
	});

	it('preserves a well-formed imdb_id and rejects a malformed one', () => {
		const good = deserializeAppState({
			items: [{ tmdb_id: 1, media_type: 'movie', title: 'Arrival', imdb_id: 'tt2543164' }]
		});
		expect(good.items[0].imdb_id).toBe('tt2543164');

		const bad = deserializeAppState({
			items: [{ tmdb_id: 1, media_type: 'movie', title: 'Arrival', imdb_id: 'javascript:alert(1)' }]
		});
		expect(bad.items[0].imdb_id).toBeNull();
	});

	it('is safe from prototype pollution — a backup item is rebuilt from an allowlist, not spread', () => {
		const maliciousItem = JSON.parse(
			'{"tmdb_id":1,"media_type":"movie","title":"Arrival","__proto__":{"polluted":true},"constructor":{"polluted":true},"unknownField":"dropped"}'
		);
		const result = deserializeAppState({ items: [maliciousItem] });
		expect(({} as Record<string, unknown>).polluted).toBeUndefined();
		expect((result.items[0] as unknown as Record<string, unknown>).polluted).toBeUndefined();
		expect((result.items[0] as unknown as Record<string, unknown>).unknownField).toBeUndefined();
	});
});

describe('watch / added_by_account_id (#188 — collection blob fields)', () => {
	function backupWith(itemOverrides: Record<string, unknown>) {
		return {
			version: 2,
			items: [
				{
					tmdb_id: 1,
					media_type: 'movie',
					title: 'T',
					poster_path: null,
					overview: null,
					providers: [],
					runtime_minutes: 90,
					seasons: [],
					watched_seasons: [],
					added_at: '2026-01-01T00:00:00Z',
					watched_at: null,
					...itemOverrides
				}
			],
			prefs: {}
		};
	}

	it('round-trips a valid watch map and added_by_account_id', () => {
		const result = deserializeAppState(
			backupWith({
				watch: { 'account-1': '2026-08-01T00:00:00.000Z' },
				added_by_account_id: 'account-1'
			})
		);
		expect(result.items[0].watch).toEqual({ 'account-1': '2026-08-01T00:00:00.000Z' });
		expect(result.items[0].added_by_account_id).toBe('account-1');
	});

	it('accepts a null added_by_account_id', () => {
		const result = deserializeAppState(backupWith({ added_by_account_id: null }));
		expect(result.items[0].added_by_account_id).toBeNull();
	});

	it('drops watch entries with a malformed value', () => {
		const result = deserializeAppState(
			backupWith({ watch: { 'account-1': 'not-a-date', 'account-2': '2026-08-01T00:00:00.000Z' } })
		);
		expect(result.items[0].watch).toEqual({ 'account-2': '2026-08-01T00:00:00.000Z' });
	});

	it('drops watch entries whose key is not account-id shaped', () => {
		const result = deserializeAppState(
			backupWith({
				watch: {
					'valid-id': '2026-08-01T00:00:00.000Z',
					'has spaces': '2026-08-01T00:00:00.000Z',
					'': '2026-08-01T00:00:00.000Z'
				}
			})
		);
		expect(result.items[0].watch).toEqual({ 'valid-id': '2026-08-01T00:00:00.000Z' });
	});

	// The prototype-pollution defense this module is built around — a
	// null-prototype output object plus explicit rejection of the dangerous
	// key names, so an untrusted collection blob cannot touch Object.prototype
	// through a crafted "watch" map.
	it('rejects __proto__/constructor/prototype as watch keys without polluting Object.prototype', () => {
		const before = ({} as Record<string, unknown>).polluted;
		const result = deserializeAppState(
			backupWith({
				watch: {
					__proto__: '2026-08-01T00:00:00.000Z',
					constructor: '2026-08-01T00:00:00.000Z',
					prototype: '2026-08-01T00:00:00.000Z',
					legit: '2026-08-01T00:00:00.000Z'
				}
			})
		);
		expect(result.items[0].watch).toEqual({ legit: '2026-08-01T00:00:00.000Z' });
		expect(({} as Record<string, unknown>).polluted).toBe(before);
	});

	it('caps the watch map at 50 entries', () => {
		const watch: Record<string, string> = {};
		for (let i = 0; i < 80; i++) watch[`account-${i}`] = '2026-08-01T00:00:00.000Z';
		const result = deserializeAppState(backupWith({ watch }));
		expect(Object.keys(result.items[0].watch ?? {})).toHaveLength(50);
	});

	it('omits watch entirely when the map has no valid entries', () => {
		const result = deserializeAppState(backupWith({ watch: { 'bad key!': 'x' } }));
		expect(result.items[0].watch).toBeUndefined();
	});

	it('ignores a non-object watch value rather than throwing', () => {
		const result = deserializeAppState(backupWith({ watch: 'not-an-object' }));
		expect(result.items[0].watch).toBeUndefined();
	});

	it('rejects a malformed added_by_account_id rather than passing it through', () => {
		const result = deserializeAppState(backupWith({ added_by_account_id: 'has spaces!' }));
		expect(result.items[0].added_by_account_id).toBeUndefined();
	});
});
