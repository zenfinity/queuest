import { describe, it, expect, vi } from 'vitest';

// Mock the dependencies before importing POST
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

import { POST } from '../import-fetch/+server';

type PostEvent = Parameters<typeof POST>[0];

function mockRequest(body?: unknown, headers: Record<string, string> = {}): Request {
	const req = new Request('https://example.com', {
		method: 'POST',
		headers: { 'sec-fetch-site': 'same-origin', ...headers }
	});
	req.json = async () => body;
	return req;
}

describe('POST /api/import-fetch', () => {
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

	it('rejects non-string URL', async () => {
		const req = mockRequest({ url: 123 });
		const res = await POST({ request: req } as PostEvent);
		const json = await res.json();
		expect(res.status).toBe(400);
		expect(json.error).toContain('string');
	});

	it('rejects missing URL', async () => {
		const req = mockRequest({});
		const res = await POST({ request: req } as PostEvent);
		await res.json();
		expect(res.status).toBe(400);
	});

	it('rejects invalid URL', async () => {
		const req = mockRequest({ url: 'not a url' });
		const res = await POST({ request: req } as PostEvent);
		const json = await res.json();
		expect(res.status).toBe(400);
		expect(json.error).toContain('URL');
	});

	it('rejects http URLs', async () => {
		const req = mockRequest({ url: 'http://criterion.com/page' });
		const res = await POST({ request: req } as PostEvent);
		const json = await res.json();
		expect(res.status).toBe(400);
		expect(json.error).toContain('permitted');
	});

	it('rejects disallowed hosts', async () => {
		const req = mockRequest({ url: 'https://example.com/page' });
		const res = await POST({ request: req } as PostEvent);
		const json = await res.json();
		expect(res.status).toBe(400);
		expect(json.error).toContain('permitted');
	});

	it('rejects cross-origin requests', async () => {
		const req = mockRequest(
			{ url: 'https://criterion.com/page' },
			{ 'sec-fetch-site': 'cross-site' }
		);
		const res = await POST({ request: req } as PostEvent);
		await res.json();
		expect(res.status).toBe(403);
	});
});
