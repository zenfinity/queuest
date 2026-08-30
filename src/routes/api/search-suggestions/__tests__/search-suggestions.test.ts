import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$env/dynamic/private', () => ({ env: { TMDB_API_KEY: 'test-key' } }));

vi.mock('$lib/server/api', () => ({
	apiError: (status: number, message: string) =>
		new Response(JSON.stringify({ error: message }), { status }),
	checkSameOrigin: (request: Request) => {
		const fetchSite = request.headers.get('sec-fetch-site');
		if (fetchSite && fetchSite !== 'same-origin') {
			return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 });
		}
		return null;
	}
}));

const checkRateLimit = vi.fn();
vi.mock('$lib/server/rate-limit', () => ({
	checkRateLimit: (...args: unknown[]) => checkRateLimit(...args)
}));

const searchMulti = vi.fn();
vi.mock('$lib/tmdb', () => ({
	searchMulti: (...args: unknown[]) => searchMulti(...args)
}));

const { GET } = await import('../+server');

type GetEvent = Parameters<typeof GET>[0];

function mockEvent(q: string, opts: { kv?: unknown } = {}): GetEvent {
	const request = new Request('https://example.com', {
		headers: { 'sec-fetch-site': 'same-origin' }
	});
	return {
		url: new URL(`https://example.com/api/search-suggestions?q=${encodeURIComponent(q)}`),
		request,
		platform: { env: { SHARE_KV: 'kv' in opts ? opts.kv : {} } },
		getClientAddress: () => '127.0.0.1'
	} as unknown as GetEvent;
}

describe('GET /api/search-suggestions', () => {
	beforeEach(() => {
		searchMulti.mockReset();
		checkRateLimit.mockReset().mockResolvedValue(true);
	});

	it('rejects cross-site requests', async () => {
		const req = new Request('https://example.com', { headers: { 'sec-fetch-site': 'cross-site' } });
		const res = await GET({
			url: new URL('https://example.com/api/search-suggestions?q=a'),
			request: req,
			platform: { env: { SHARE_KV: {} } },
			getClientAddress: () => '127.0.0.1'
		} as unknown as GetEvent);
		expect(res.status).toBe(403);
		expect(searchMulti).not.toHaveBeenCalled();
	});

	it('returns an empty array for a blank query without calling TMDB', async () => {
		const res = await GET(mockEvent(''));
		expect(await res.json()).toEqual([]);
		expect(searchMulti).not.toHaveBeenCalled();
	});

	it('returns 503 when the KV binding is unavailable', async () => {
		const res = await GET(mockEvent('batman', { kv: undefined }));
		expect(res.status).toBe(503);
	});

	it('returns 429 once the rate limit is exceeded', async () => {
		checkRateLimit.mockResolvedValue(false);
		const res = await GET(mockEvent('batman'));
		expect(res.status).toBe(429);
		expect(searchMulti).not.toHaveBeenCalled();
	});

	it('maps raw results to the lightweight suggestion shape, capped at 5', async () => {
		searchMulti.mockResolvedValue(
			Array.from({ length: 8 }, (_, i) => ({
				id: i,
				media_type: i % 2 === 0 ? 'movie' : 'tv',
				title: `Movie ${i}`,
				name: `Show ${i}`,
				poster_path: `/p${i}.jpg`,
				release_date: '2010-07-16',
				overview: 'unused',
				runtime_minutes: 999 // hydration fields must not leak through
			}))
		);

		const res = await GET(mockEvent('batman'));
		const json = await res.json();
		expect(json).toHaveLength(5);
		expect(json[0]).toEqual({
			id: 0,
			media_type: 'movie',
			title: 'Movie 0',
			poster_path: '/p0.jpg',
			year: '2010'
		});
	});
});
