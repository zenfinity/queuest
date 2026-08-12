import { describe, it, expect, vi, beforeEach } from 'vitest';

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

// $lib/* aliases aren't resolvable outside SvelteKit's own Vite plugin (not
// loaded by plain vitest.config.ts), so — same as every other route test in
// this repo — the real route file's $lib import gets mocked with a real
// (not stubbed) implementation, run against the fake KV below.
vi.mock('$lib/server/auth', async () => {
	const real = await vi.importActual<typeof import('../../../../lib/server/auth')>(
		'../../../../lib/server/auth'
	);
	return real;
});

import { POST } from '../signout/+server';

type PostEvent = Parameters<typeof POST>[0];

function mockRequest(headers: Record<string, string> = {}): Request {
	return new Request('https://example.com', {
		method: 'POST',
		headers: { 'sec-fetch-site': 'same-origin', ...headers }
	});
}

function makeFakeKv() {
	const store = new Map<string, string>();
	return {
		store,
		kv: {
			put: async (key: string, value: string) => {
				store.set(key, value);
			},
			get: async (key: string) => store.get(key) ?? null,
			delete: async (key: string) => {
				store.delete(key);
			}
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
		} as any
	};
}

function makeCookies(token?: string) {
	const del = vi.fn();
	return {
		del,
		cookies: {
			get: () => token,
			delete: del
		} as unknown as PostEvent['cookies']
	};
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe('POST /api/auth/signout', () => {
	it('deletes the session from KV and clears the cookie', async () => {
		const { kv, store } = makeFakeKv();
		store.set('sess:tok123', JSON.stringify({ userId: 'u1', email: 'user@example.com' }));
		const { del, cookies } = makeCookies('tok123');

		const res = await POST({
			request: mockRequest(),
			platform: { env: { SHARE_KV: kv } },
			cookies
		} as unknown as PostEvent);

		expect(res.status).toBe(204);
		expect(store.has('sess:tok123')).toBe(false);
		expect(del).toHaveBeenCalledWith('sq_session', expect.objectContaining({ path: '/' }));
	});

	it('is a no-op (not an error) when there is no session cookie', async () => {
		const { kv } = makeFakeKv();
		const { cookies } = makeCookies(undefined);

		const res = await POST({
			request: mockRequest(),
			platform: { env: { SHARE_KV: kv } },
			cookies
		} as unknown as PostEvent);

		expect(res.status).toBe(204);
	});

	it('rejects cross-origin requests', async () => {
		const { kv } = makeFakeKv();
		const { cookies } = makeCookies('tok123');

		const res = await POST({
			request: mockRequest({ 'sec-fetch-site': 'cross-site' }),
			platform: { env: { SHARE_KV: kv } },
			cookies
		} as unknown as PostEvent);

		expect(res.status).toBe(403);
	});
});
