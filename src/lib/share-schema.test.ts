import { describe, it, expect } from 'vitest';
import { parseSharePayload, parseImportBackup } from './share-schema';

describe('parseSharePayload', () => {
	it('accepts a valid payload', () => {
		const payload = {
			v: 1,
			queue_name: 'My List',
			items: [
				{
					tmdb_id: 123,
					media_type: 'movie' as const,
					title: 'Test Movie',
					poster_path: '/abc123.jpg',
					providers: [{ provider_id: 8, provider_name: 'Netflix', logo_path: '/netflix.png' }],
					runtime_minutes: 120,
					seasons: []
				}
			]
		};
		const result = parseSharePayload(payload);
		expect(result.v).toBe(1);
		expect(result.queue_name).toBe('My List');
		expect(result.items).toHaveLength(1);
		expect(result.items[0].title).toBe('Test Movie');
	});

	it('clamps title to 500 chars', () => {
		const longTitle = 'x'.repeat(600);
		const payload = {
			v: 1,
			items: [
				{
					tmdb_id: 1,
					media_type: 'movie' as const,
					title: longTitle,
					poster_path: '/p.jpg',
					providers: [],
					runtime_minutes: 100,
					seasons: []
				}
			]
		};
		const result = parseSharePayload(payload);
		expect(result.items[0].title).toHaveLength(500);
	});

	it('drops items with invalid media_type', () => {
		const payload = {
			v: 1,
			items: [
				{
					tmdb_id: 1,
					media_type: 'invalid',
					title: 'Movie',
					poster_path: '/p.jpg',
					providers: [],
					runtime_minutes: 100,
					seasons: []
				}
			]
		};
		const result = parseSharePayload(payload);
		expect(result.items).toHaveLength(0);
	});

	it('nulls invalid poster_path', () => {
		const payload = {
			v: 1,
			items: [
				{
					tmdb_id: 1,
					media_type: 'movie' as const,
					title: 'Movie',
					poster_path: 'not-a-path',
					providers: [],
					runtime_minutes: 100,
					seasons: []
				}
			]
		};
		const result = parseSharePayload(payload);
		expect(result.items[0].poster_path).toBeNull();
	});

	it('clamps items to 500', () => {
		const items = Array.from({ length: 600 }, (_, i) => ({
			tmdb_id: i + 1,
			media_type: 'movie' as const,
			title: `Movie ${i}`,
			poster_path: '/p.jpg',
			providers: [],
			runtime_minutes: 100,
			seasons: []
		}));
		const payload = { v: 1, items };
		const result = parseSharePayload(payload);
		expect(result.items).toHaveLength(500);
	});

	it('clamps seasons to 100', () => {
		const seasons = Array.from({ length: 150 }, (_, i) => ({
			season_number: i + 1,
			runtime_minutes: 50
		}));
		const payload = {
			v: 1,
			items: [
				{
					tmdb_id: 1,
					media_type: 'tv' as const,
					title: 'Show',
					poster_path: '/p.jpg',
					providers: [],
					runtime_minutes: 5000,
					seasons
				}
			]
		};
		const result = parseSharePayload(payload);
		expect(result.items[0].seasons).toHaveLength(100);
	});

	it('clamps runtime_minutes', () => {
		const payload = {
			v: 1,
			items: [
				{
					tmdb_id: 1,
					media_type: 'movie' as const,
					title: 'Movie',
					poster_path: '/p.jpg',
					providers: [],
					runtime_minutes: 999_999,
					seasons: []
				}
			]
		};
		const result = parseSharePayload(payload);
		expect(result.items[0].runtime_minutes).toBe(100_000);
	});

	it('rebuilds objects without spreading (safe from prototype pollution)', () => {
		const payload = {
			v: 1,
			unknownKey: 'should be dropped',
			items: [
				{
					tmdb_id: 1,
					media_type: 'movie' as const,
					title: 'Movie',
					poster_path: '/p.jpg',
					providers: [],
					runtime_minutes: 100,
					seasons: [],
					extraField: 'also dropped'
				}
			]
		} as any;
		const result = parseSharePayload(payload);
		expect((result as any).unknownKey).toBeUndefined();
		expect((result.items[0] as any).extraField).toBeUndefined();
	});

	it('throws on invalid version', () => {
		expect(() => parseSharePayload({ v: 2, items: [] })).toThrow('Unsupported');
	});

	it('throws on non-object input', () => {
		expect(() => parseSharePayload(null)).toThrow('Invalid');
		expect(() => parseSharePayload('string')).toThrow('Invalid');
	});
});

describe('parseImportBackup', () => {
	it('accepts legacy array format', () => {
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
				current_season: null,
				current_episode: null,
				added_at: '2026-01-01T00:00:00Z',
				watched_at: null
			}
		];
		const result = parseImportBackup(backup);
		expect(result.items).toHaveLength(1);
		expect(result.items[0].tmdb_id).toBe(100);
	});

	it('accepts new format with prefs', () => {
		const backup = {
			version: 1,
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
					current_season: null,
					current_episode: null,
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
				view: 'grid'
			},
			services: [{ provider_id: 8, provider_name: 'Netflix', logo_path: '/netflix.png' }]
		};
		const result = parseImportBackup(backup);
		expect(result.items).toHaveLength(1);
		expect(result.prefs?.theme).toBe('dark');
		expect(result.prefs?.weeklyHours).toBe(15);
		expect(result.services).toHaveLength(1);
	});

	it('filters out invalid items', () => {
		const backup = {
			items: [
				{ tmdb_id: 1, media_type: 'movie', title: 'Valid', poster_path: null },
				{ tmdb_id: 2, media_type: 'invalid', title: 'Invalid' },
				{ title: 'No tmdb_id', poster_path: null }
			]
		};
		const result = parseImportBackup(backup);
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
		const result = parseImportBackup(backup);
		expect(result.prefs?.theme).toBeUndefined();
		expect(result.prefs?.weeklyHours).toBeUndefined();
		expect((result.prefs as any)?.unknownKey).toBeUndefined();
	});

	it('clamps queueColors', () => {
		const longKey = 'a'.repeat(200);
		const longVal = '#'.repeat(100);
		const backup = {
			items: [],
			prefs: {
				queueColors: {
					[longKey]: '#ff0000',
					'tag': longVal
				}
			}
		};
		const result = parseImportBackup(backup);
		const colors = result.prefs?.queueColors ?? {};
		const keys = Object.keys(colors);
		// Keys should be clamped to 100 chars
		expect(keys.some(k => k.length === 100)).toBe(true);
		const values = Object.values(colors);
		// Values should be clamped to 50 chars (the longVal is 100 # chars)
		expect(values.some(v => v.length === 50)).toBe(true);
	});

	it('throws on non-object input', () => {
		expect(() => parseImportBackup(null)).toThrow('Invalid');
		expect(() => parseImportBackup('string')).toThrow('Invalid');
	});
});
