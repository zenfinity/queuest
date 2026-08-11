import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock the dependencies before importing POST
vi.mock('$env/dynamic/private', () => ({
	env: { GITHUB_TOKEN: 'test-token' }
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

import { POST } from '../feedback/+server';

const mockRequest = (method: string, body?: unknown, headers: Record<string, string> = {}) => ({
	method,
	headers: new Map(Object.entries({ 'sec-fetch-site': 'same-origin', ...headers })),
	json: async () => body
});

describe('POST /api/feedback', () => {
	it('rejects malformed JSON', async () => {
		const req = { ...mockRequest('POST'), json: async () => { throw new SyntaxError('Invalid JSON'); } } as any;
		const res = await POST({ request: req } as any);
		const json = await res.json();
		expect(res.status).toBe(400);
		expect(json.error).toContain('JSON');
	});

	it('rejects non-string title', async () => {
		const req = mockRequest('POST', { title: 123 }) as any;
		const res = await POST({ request: req } as any);
		const json = await res.json();
		expect(res.status).toBe(400);
		expect(json.error).toContain('string');
	});

	it('rejects empty title', async () => {
		const req = mockRequest('POST', { title: '   ' }) as any;
		const res = await POST({ request: req } as any);
		const json = await res.json();
		expect(res.status).toBe(400);
		expect(json.error).toContain('required');
	});

	it('rejects title over max length', async () => {
		const req = mockRequest('POST', { title: 'a'.repeat(201) }) as any;
		const res = await POST({ request: req } as any);
		const json = await res.json();
		expect(res.status).toBe(400);
		expect(json.error).toContain('too long');
	});

	it('rejects non-string body', async () => {
		const req = mockRequest('POST', { title: 'Test', body: {} }) as any;
		const res = await POST({ request: req } as any);
		const json = await res.json();
		expect(res.status).toBe(400);
	});

	it('rejects body over max length', async () => {
		const req = mockRequest('POST', { title: 'Test', body: 'a'.repeat(5001) }) as any;
		const res = await POST({ request: req } as any);
		const json = await res.json();
		expect(res.status).toBe(400);
		expect(json.error).toContain('too long');
	});

	it('rejects cross-origin requests', async () => {
		const req = mockRequest('POST', { title: 'Test' }, { 'sec-fetch-site': 'cross-site' }) as any;
		const res = await POST({ request: req } as any);
		const json = await res.json();
		expect(res.status).toBe(403);
	});
});
