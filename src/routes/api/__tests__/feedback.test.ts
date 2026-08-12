import { describe, it, expect, vi } from 'vitest';

// Mock the dependencies before importing POST
vi.mock('$env/dynamic/private', () => ({
	env: { GITHUB_TOKEN: 'test-token' }
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

import { POST } from '../feedback/+server';

type PostEvent = Parameters<typeof POST>[0];

function mockRequest(
	method: string,
	body?: unknown,
	headers: Record<string, string> = {}
): Request {
	const req = new Request('https://example.com', {
		method,
		headers: { 'sec-fetch-site': 'same-origin', ...headers }
	});
	req.json = async () => body;
	return req;
}

describe('POST /api/feedback', () => {
	it('rejects malformed JSON', async () => {
		const req = mockRequest('POST');
		req.json = async () => {
			throw new SyntaxError('Invalid JSON');
		};
		const res = await POST({ request: req } as PostEvent);
		const json = await res.json();
		expect(res.status).toBe(400);
		expect(json.error).toContain('JSON');
	});

	it('rejects non-string title', async () => {
		const req = mockRequest('POST', { title: 123 });
		const res = await POST({ request: req } as PostEvent);
		const json = await res.json();
		expect(res.status).toBe(400);
		expect(json.error).toContain('string');
	});

	it('rejects empty title', async () => {
		const req = mockRequest('POST', { title: '   ' });
		const res = await POST({ request: req } as PostEvent);
		const json = await res.json();
		expect(res.status).toBe(400);
		expect(json.error).toContain('required');
	});

	it('rejects title over max length', async () => {
		const req = mockRequest('POST', { title: 'a'.repeat(201) });
		const res = await POST({ request: req } as PostEvent);
		const json = await res.json();
		expect(res.status).toBe(400);
		expect(json.error).toContain('too long');
	});

	it('rejects non-string body', async () => {
		const req = mockRequest('POST', { title: 'Test', body: {} });
		const res = await POST({ request: req } as PostEvent);
		await res.json();
		expect(res.status).toBe(400);
	});

	it('rejects body over max length', async () => {
		const req = mockRequest('POST', { title: 'Test', body: 'a'.repeat(5001) });
		const res = await POST({ request: req } as PostEvent);
		const json = await res.json();
		expect(res.status).toBe(400);
		expect(json.error).toContain('too long');
	});

	it('rejects cross-origin requests', async () => {
		const req = mockRequest('POST', { title: 'Test' }, { 'sec-fetch-site': 'cross-site' });
		const res = await POST({ request: req } as PostEvent);
		await res.json();
		expect(res.status).toBe(403);
	});
});
