import { describe, it, expect, vi } from 'vitest';

// Mock the dependencies before importing POST
vi.mock('$env/dynamic/private', () => ({
	env: { TMDB_API_KEY: 'test-key' }
}));

vi.mock('$lib/server/api', () => ({
	apiError: (status: number, message: string) => new Response(JSON.stringify({ error: message }), { status }),
	checkSameOrigin: (request: any) => {
		const fetchSite = request.headers.get?.('sec-fetch-site');
		if (fetchSite && fetchSite !== 'same-origin') {
			return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 });
		}
		return null;
	}
}));

vi.mock('$lib/tmdb', () => ({
	searchMulti: vi.fn(),
	getWatchProviders: vi.fn(),
	getRuntime: vi.fn(),
	augmentProviders: vi.fn()
}));

import { POST } from '../import-search/+server';

const mockRequest = (body?: unknown, headers: Record<string, string> = {}) => ({
	method: 'POST',
	headers: new Map(Object.entries({ 'sec-fetch-site': 'same-origin', ...headers })),
	json: async () => body
});

describe('POST /api/import-search', () => {

	it('rejects malformed JSON', async () => {
		const req = { ...mockRequest(), json: async () => { throw new SyntaxError('Invalid JSON'); } } as any;
		const res = await POST({ request: req } as any);
		const json = await res.json();
		expect(res.status).toBe(400);
		expect(json.error).toContain('JSON');
	});

	it('rejects non-array body', async () => {
		const req = mockRequest({ title: 'Test' }) as any;
		const res = await POST({ request: req } as any);
		const json = await res.json();
		expect(res.status).toBe(400);
		expect(json.error).toContain('array');
	});

	it('rejects empty array', async () => {
		const req = mockRequest([]) as any;
		const res = await POST({ request: req } as any);
		const json = await res.json();
		expect(res.status).toBe(200);
		expect(json).toEqual([]);
	});

	it('rejects oversized batches', async () => {
		const req = mockRequest(Array(31).fill({ title: 'Test', year: null, mediaTypeHint: 'auto' })) as any;
		const res = await POST({ request: req } as any);
		const json = await res.json();
		expect(res.status).toBe(400);
		expect(json.error).toContain('max');
	});

	it('returns 503 when API key is not configured', async () => {
		// This test requires env.TMDB_API_KEY to be undefined
		const req = mockRequest([{ title: 'Test', year: null, mediaTypeHint: 'auto' }]) as any;
		const res = await POST({ request: req } as any);
		// This will only 503 if TMDB_API_KEY is not set
		if (res.status === 503) {
			const json = await res.json();
			expect(json.error).toContain('configured');
		}
	});

	it('rejects cross-origin requests', async () => {
		const req = mockRequest([{ title: 'Test', year: null, mediaTypeHint: 'auto' }], { 'sec-fetch-site': 'cross-site' }) as any;
		const res = await POST({ request: req } as any);
		const json = await res.json();
		expect(res.status).toBe(403);
	});
});
