import { describe, it, expect, vi } from 'vitest';

// Mock the dependencies before importing POST
vi.mock('$lib/server/api', () => ({
	apiError: (status: number, message: string) =>
		new Response(JSON.stringify({ error: message }), { status }),
	checkSameOrigin: (request: any) => {
		const fetchSite = request.headers.get?.('sec-fetch-site');
		if (fetchSite && fetchSite !== 'same-origin') {
			return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 });
		}
		return null;
	}
}));

import { POST } from '../import-fetch/+server';

const mockRequest = (body?: unknown, headers: Record<string, string> = {}) => ({
	method: 'POST',
	headers: new Map(Object.entries({ 'sec-fetch-site': 'same-origin', ...headers })),
	json: async () => body
});

describe('POST /api/import-fetch', () => {
	it('rejects malformed JSON', async () => {
		const req = {
			...mockRequest(),
			json: async () => {
				throw new SyntaxError('Invalid JSON');
			}
		} as any;
		const res = await POST({ request: req } as any);
		const json = await res.json();
		expect(res.status).toBe(400);
		expect(json.error).toContain('JSON');
	});

	it('rejects non-string URL', async () => {
		const req = mockRequest({ url: 123 }) as any;
		const res = await POST({ request: req } as any);
		const json = await res.json();
		expect(res.status).toBe(400);
		expect(json.error).toContain('string');
	});

	it('rejects missing URL', async () => {
		const req = mockRequest({}) as any;
		const res = await POST({ request: req } as any);
		const json = await res.json();
		expect(res.status).toBe(400);
	});

	it('rejects invalid URL', async () => {
		const req = mockRequest({ url: 'not a url' }) as any;
		const res = await POST({ request: req } as any);
		const json = await res.json();
		expect(res.status).toBe(400);
		expect(json.error).toContain('URL');
	});

	it('rejects http URLs', async () => {
		const req = mockRequest({ url: 'http://criterion.com/page' }) as any;
		const res = await POST({ request: req } as any);
		const json = await res.json();
		expect(res.status).toBe(400);
		expect(json.error).toContain('permitted');
	});

	it('rejects disallowed hosts', async () => {
		const req = mockRequest({ url: 'https://example.com/page' }) as any;
		const res = await POST({ request: req } as any);
		const json = await res.json();
		expect(res.status).toBe(400);
		expect(json.error).toContain('permitted');
	});

	it('rejects cross-origin requests', async () => {
		const req = mockRequest(
			{ url: 'https://criterion.com/page' },
			{ 'sec-fetch-site': 'cross-site' }
		) as any;
		const res = await POST({ request: req } as any);
		const json = await res.json();
		expect(res.status).toBe(403);
	});
});
