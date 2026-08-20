import { describe, it, expect } from 'vitest';
import { parseSharePayload } from './share-schema';

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

	it('drops unrecognized keys instead of spreading the raw object through', () => {
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
		};
		const result = parseSharePayload(payload);
		expect((result as unknown as Record<string, unknown>).unknownKey).toBeUndefined();
		expect((result.items[0] as unknown as Record<string, unknown>).extraField).toBeUndefined();
	});

	it('is safe from prototype pollution — __proto__/constructor/prototype keys never reach the output', () => {
		// JSON.parse itself already turns a literal "__proto__" key into a plain
		// own-property rather than mutating the prototype, but the field-by-field
		// rebuild in parseShareItem/parseSharePayload is the actual guarantee this
		// test is meant to pin: only the allowlisted fields are ever read from the
		// input object, whatever keys it carries.
		const maliciousItem = JSON.parse(
			'{"tmdb_id":1,"media_type":"movie","title":"Movie","poster_path":"/p.jpg","providers":[],"runtime_minutes":100,"seasons":[],"__proto__":{"polluted":true},"constructor":{"polluted":true},"prototype":{"polluted":true}}'
		);
		const payload = { v: 1, items: [maliciousItem] };

		const result = parseSharePayload(payload);

		expect(({} as Record<string, unknown>).polluted).toBeUndefined();
		expect((result.items[0] as unknown as Record<string, unknown>).polluted).toBeUndefined();
		expect(Object.keys(result.items[0]).sort()).toEqual(
			['tmdb_id', 'media_type', 'title', 'poster_path', 'providers', 'runtime_minutes', 'seasons'].sort()
		);
	});

	it('clamps queue_tag to 40 chars', () => {
		const payload = {
			v: 1,
			items: [
				{
					tmdb_id: 1,
					media_type: 'movie' as const,
					title: 'Movie',
					poster_path: '/p.jpg',
					providers: [],
					runtime_minutes: 100,
					seasons: [],
					queue_tag: 'x'.repeat(60)
				}
			]
		};
		const result = parseSharePayload(payload);
		expect(result.items[0].queue_tag).toHaveLength(40);
	});

	it('drops a provider with an invalid logo_path instead of trusting it', () => {
		const payload = {
			v: 1,
			items: [
				{
					tmdb_id: 1,
					media_type: 'movie' as const,
					title: 'Movie',
					poster_path: '/p.jpg',
					providers: [
						{ provider_id: 8, provider_name: 'Netflix', logo_path: 'javascript:alert(1)' },
						{ provider_id: 9, provider_name: 'Hulu', logo_path: '/hulu.png' }
					],
					runtime_minutes: 100,
					seasons: []
				}
			]
		};
		const result = parseSharePayload(payload);
		expect(result.items[0].providers).toEqual([
			{ provider_id: 9, provider_name: 'Hulu', logo_path: '/hulu.png' }
		]);
	});

	it('rejects a season with season_number: 0', () => {
		const payload = {
			v: 1,
			items: [
				{
					tmdb_id: 1,
					media_type: 'tv' as const,
					title: 'Show',
					poster_path: '/p.jpg',
					providers: [],
					runtime_minutes: 100,
					seasons: [{ season_number: 0, runtime_minutes: 30 }]
				}
			]
		};
		const result = parseSharePayload(payload);
		expect(result.items[0].seasons).toEqual([]);
	});

	it('throws on invalid version', () => {
		expect(() => parseSharePayload({ v: 2, items: [] })).toThrow('Unsupported');
	});

	it('throws on non-object input', () => {
		expect(() => parseSharePayload(null)).toThrow('Invalid');
		expect(() => parseSharePayload('string')).toThrow('Invalid');
	});
});
