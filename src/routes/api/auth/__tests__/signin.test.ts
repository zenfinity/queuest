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
// this repo — every $lib import the real route file pulls in gets mocked
// with a real (not stubbed) implementation, run against fake D1/KV below.
vi.mock('$lib/server/auth', async () => {
	const real = await vi.importActual<typeof import('../../../../lib/server/auth')>(
		'../../../../lib/server/auth'
	);
	return real;
});
vi.mock('$lib/auth-crypto', async () => {
	const real = await vi.importActual<typeof import('../../../../lib/auth-crypto')>(
		'../../../../lib/auth-crypto'
	);
	return real;
});

import { hashAuthKey } from '../../../../lib/server/auth';
import { POST } from '../signin/+server';

type PostEvent = Parameters<typeof POST>[0];

function mockRequest(body?: unknown, headers: Record<string, string> = {}): Request {
	const req = new Request('https://example.com', {
		method: 'POST',
		headers: { 'sec-fetch-site': 'same-origin', ...headers }
	});
	req.json = async () => body;
	return req;
}

interface FakeUser {
	id: string;
	email: string;
	auth_key_hash: string;
}

// Fake D1 backing a fixed set of users + one wrapped_dek row, enough to
// exercise the two SELECT statements this route issues.
function makeFakeDb(users: FakeUser[], wrappedDekByUserId: Record<string, string> = {}) {
	const db = {
		prepare(sql: string) {
			return {
				bind(...args: unknown[]) {
					return {
						async first<T>() {
							if (sql.startsWith('SELECT id, email, auth_key_hash FROM users')) {
								const email = args[0] as string;
								return (users.find((u) => u.email === email) as T | undefined) ?? null;
							}
							if (sql.startsWith('SELECT wrapped_key FROM wrapped_dek')) {
								const userId = args[0] as string;
								const key = wrappedDekByUserId[userId];
								return (key ? ({ wrapped_key: key } as T) : null) ?? null;
							}
							return null;
						}
					};
				}
			};
		}
	};
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	return db as any;
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

function makeCookies() {
	const set = vi.fn();
	return { set, cookies: { set } as unknown as PostEvent['cookies'] };
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe('POST /api/auth/signin', () => {
	it('signs in with the correct authKey, sets a session cookie, and returns the wrapped DEK', async () => {
		const authKeyHash = await hashAuthKey('correct-auth-key');
		const db = makeFakeDb([{ id: 'u1', email: 'user@example.com', auth_key_hash: authKeyHash }], {
			u1: 'wrapped-dek-blob'
		});
		const { kv, store } = makeFakeKv();
		const { set, cookies } = makeCookies();
		const req = mockRequest({ email: 'user@example.com', authKey: 'correct-auth-key' });

		const res = await POST({
			request: req,
			platform: { env: { DB: db, SHARE_KV: kv } },
			cookies
		} as unknown as PostEvent);

		expect(res.status).toBe(200);
		const json = await res.json();
		expect(json.email).toBe('user@example.com');
		expect(json.wrappedDek).toBe('wrapped-dek-blob');
		expect(set).toHaveBeenCalledWith('sq_session', expect.any(String), expect.any(Object));
		expect(store.size).toBe(1);
	});

	it('rejects the wrong authKey with a generic 401', async () => {
		const authKeyHash = await hashAuthKey('correct-auth-key');
		const db = makeFakeDb([{ id: 'u1', email: 'user@example.com', auth_key_hash: authKeyHash }]);
		const { kv } = makeFakeKv();
		const { set, cookies } = makeCookies();
		const req = mockRequest({ email: 'user@example.com', authKey: 'wrong-auth-key' });

		const res = await POST({
			request: req,
			platform: { env: { DB: db, SHARE_KV: kv } },
			cookies
		} as unknown as PostEvent);

		expect(res.status).toBe(401);
		const json = await res.json();
		expect(json.error).toBe('Invalid email or passphrase');
		expect(set).not.toHaveBeenCalled();
	});

	it('rejects a nonexistent email with the same generic 401 (no user-enumeration signal)', async () => {
		const db = makeFakeDb([]);
		const { kv } = makeFakeKv();
		const { cookies } = makeCookies();
		const req = mockRequest({ email: 'nobody@example.com', authKey: 'anything' });

		const res = await POST({
			request: req,
			platform: { env: { DB: db, SHARE_KV: kv } },
			cookies
		} as unknown as PostEvent);

		expect(res.status).toBe(401);
		const json = await res.json();
		expect(json.error).toBe('Invalid email or passphrase');
	});

	it('normalizes email case/whitespace when looking up the account', async () => {
		const authKeyHash = await hashAuthKey('correct-auth-key');
		const db = makeFakeDb([{ id: 'u1', email: 'user@example.com', auth_key_hash: authKeyHash }]);
		const { kv } = makeFakeKv();
		const { cookies } = makeCookies();
		const req = mockRequest({ email: '  User@Example.com  ', authKey: 'correct-auth-key' });

		const res = await POST({
			request: req,
			platform: { env: { DB: db, SHARE_KV: kv } },
			cookies
		} as unknown as PostEvent);

		expect(res.status).toBe(200);
	});

	it('returns wrappedDek: null when no passphrase-method row exists yet', async () => {
		const authKeyHash = await hashAuthKey('correct-auth-key');
		const db = makeFakeDb([{ id: 'u1', email: 'user@example.com', auth_key_hash: authKeyHash }]);
		const { kv } = makeFakeKv();
		const { cookies } = makeCookies();
		const req = mockRequest({ email: 'user@example.com', authKey: 'correct-auth-key' });

		const res = await POST({
			request: req,
			platform: { env: { DB: db, SHARE_KV: kv } },
			cookies
		} as unknown as PostEvent);

		const json = await res.json();
		expect(json.wrappedDek).toBeNull();
	});

	it('rejects an invalid email shape without hitting the database', async () => {
		const { kv } = makeFakeKv();
		const { cookies } = makeCookies();
		const req = mockRequest({ email: 'not-an-email', authKey: 'x' });

		const res = await POST({
			request: req,
			platform: { env: { DB: makeFakeDb([]), SHARE_KV: kv } },
			cookies
		} as unknown as PostEvent);

		expect(res.status).toBe(401);
	});

	it('rejects malformed JSON', async () => {
		const { kv } = makeFakeKv();
		const { cookies } = makeCookies();
		const req = mockRequest();
		req.json = async () => {
			throw new SyntaxError('bad json');
		};

		const res = await POST({
			request: req,
			platform: { env: { DB: makeFakeDb([]), SHARE_KV: kv } },
			cookies
		} as unknown as PostEvent);

		expect(res.status).toBe(400);
	});

	it('rejects cross-origin requests', async () => {
		const { kv } = makeFakeKv();
		const { cookies } = makeCookies();
		const req = mockRequest(
			{ email: 'user@example.com', authKey: 'x' },
			{ 'sec-fetch-site': 'cross-site' }
		);

		const res = await POST({
			request: req,
			platform: { env: { DB: makeFakeDb([]), SHARE_KV: kv } },
			cookies
		} as unknown as PostEvent);

		expect(res.status).toBe(403);
	});

	it('returns 503 when DB or KV bindings are missing', async () => {
		const { cookies } = makeCookies();
		const req = mockRequest({ email: 'user@example.com', authKey: 'x' });

		const res = await POST({
			request: req,
			platform: { env: {} },
			cookies
		} as unknown as PostEvent);

		expect(res.status).toBe(503);
	});
});
