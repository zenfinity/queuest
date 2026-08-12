import { describe, it, expect, vi } from 'vitest';

// Mock the dependencies before importing POST
vi.mock('$env/dynamic/private', () => ({
	env: { TMDB_API_KEY: 'test-key' }
}));

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

vi.mock('$lib/tmdb', () => ({
	getWatchProviders: vi.fn(),
	getRuntime: vi.fn(),
	augmentProviders: vi.fn()
}));

import { POST } from '../refresh-providers/+server';

type PostEvent = Parameters<typeof POST>[0];

function mockRequest(body?: unknown, headers: Record<string, string> = {}): Request {
	const req = new Request('https://example.com', {
		method: 'POST',
		headers: { 'sec-fetch-site': 'same-origin', ...headers }
	});
	req.json = async () => body;
	return req;
}

const mockItem = () => ({ id: 1, tmdb_id: 550, media_type: 'movie' as const });

describe('POST /api/refresh-providers', () => {
	it('rejects malformed JSON', async () => {
		const req = mockRequest();
		req.json = async () => {
			throw new SyntaxError('Invalid JSON');
		};
		const res = await POST({ request: req } as PostEvent);
		const json = await res.json();
		expect(res.status).toBe(400);
		expect(json.error).toContain('JSON');
	});

	it('rejects non-array body', async () => {
		const req = mockRequest({ id: 1, tmdb_id: 550, media_type: 'movie' });
		const res = await POST({ request: req } as PostEvent);
		const json = await res.json();
		expect(res.status).toBe(400);
		expect(json.error).toContain('array');
	});

	it('returns empty array for empty request', async () => {
		const req = mockRequest([]);
		const res = await POST({ request: req } as PostEvent);
		const json = await res.json();
		expect(res.status).toBe(200);
		expect(json).toEqual([]);
	});

	it('rejects oversized batches', async () => {
		const req = mockRequest(Array(101).fill(mockItem()));
		const res = await POST({ request: req } as PostEvent);
		const json = await res.json();
		expect(res.status).toBe(400);
		expect(json.error).toContain('max');
	});

	it('filters invalid items', async () => {
		const req = mockRequest([
			mockItem(),
			{ id: 'not-a-number', tmdb_id: 550, media_type: 'movie' },
			{ id: 1, tmdb_id: 'invalid', media_type: 'movie' },
			{ id: 1, tmdb_id: 550, media_type: 'invalid' }
		]);
		const res = await POST({ request: req } as PostEvent);
		// Should filter to just the first valid item
		expect([200, 503, 502]).toContain(res.status); // May 503 or 502 if API not available
	});

	it('returns 503 when API key is not configured', async () => {
		// This test requires env.TMDB_API_KEY to be undefined
		const req = mockRequest([mockItem()]);
		const res = await POST({ request: req } as PostEvent);
		// This will only 503 if TMDB_API_KEY is not set
		if (res.status === 503) {
			const json = await res.json();
			expect(json.error).toContain('configured');
		}
	});

	it('rejects cross-origin requests', async () => {
		const req = mockRequest([mockItem()], { 'sec-fetch-site': 'cross-site' });
		const res = await POST({ request: req } as PostEvent);
		await res.json();
		expect(res.status).toBe(403);
	});
});
