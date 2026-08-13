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

vi.mock('$lib/server/auth', async () => {
	const real = await vi.importActual<typeof import('../../../../../lib/server/auth')>(
		'../../../../../lib/server/auth'
	);
	return real;
});
vi.mock('$lib/auth-crypto', async () => {
	const real = await vi.importActual<typeof import('../../../../../lib/auth-crypto')>(
		'../../../../../lib/auth-crypto'
	);
	return real;
});

import { hashAuthKey } from '../../../../../lib/server/auth';
import { POST } from '../+server';

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
	recoveryAuthHash?: string;
	recoveryWrappedKey?: string;
}

function makeFakeDb(users: FakeUser[]) {
	const db = {
		prepare(sql: string) {
			return {
				bind(...args: unknown[]) {
					return {
						async first<T>() {
							if (sql.startsWith('SELECT id, email FROM users')) {
								const email = args[0] as string;
								const u = users.find((x) => x.email === email);
								return (u ? { id: u.id, email: u.email } : null) as T | null;
							}
							if (sql.startsWith('SELECT auth_key_hash FROM recovery_auth')) {
								const userId = args[0] as string;
								const u = users.find((x) => x.id === userId);
								return (
									u?.recoveryAuthHash ? { auth_key_hash: u.recoveryAuthHash } : null
								) as T | null;
							}
							if (sql.includes("method = 'recovery'")) {
								const userId = args[0] as string;
								const u = users.find((x) => x.id === userId);
								return (
									u?.recoveryWrappedKey ? { wrapped_key: u.recoveryWrappedKey } : null
								) as T | null;
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

describe('POST /api/auth/recover', () => {
	it('signs in with the correct recovery code, sets a session cookie, and returns the recovery-wrapped DEK', async () => {
		const recoveryAuthHash = await hashAuthKey('correct-recovery-code');
		const db = makeFakeDb([
			{
				id: 'u1',
				email: 'user@example.com',
				recoveryAuthHash,
				recoveryWrappedKey: 'recovery-wrapped-dek'
			}
		]);
		const { kv, store } = makeFakeKv();
		const { set, cookies } = makeCookies();
		const req = mockRequest({
			email: 'user@example.com',
			recoveryAuthKey: 'correct-recovery-code'
		});

		const res = await POST({
			request: req,
			platform: { env: { DB: db, SHARE_KV: kv } },
			cookies
		} as unknown as PostEvent);

		expect(res.status).toBe(200);
		const json = await res.json();
		expect(json.email).toBe('user@example.com');
		expect(json.wrappedDek).toBe('recovery-wrapped-dek');
		expect(set).toHaveBeenCalledWith('sq_session', expect.any(String), expect.any(Object));
		expect(store.size).toBe(1);
	});

	it('rejects the wrong recovery code with a generic 401', async () => {
		const recoveryAuthHash = await hashAuthKey('correct-recovery-code');
		const db = makeFakeDb([{ id: 'u1', email: 'user@example.com', recoveryAuthHash }]);
		const { kv } = makeFakeKv();
		const { set, cookies } = makeCookies();
		const req = mockRequest({ email: 'user@example.com', recoveryAuthKey: 'wrong-code' });

		const res = await POST({
			request: req,
			platform: { env: { DB: db, SHARE_KV: kv } },
			cookies
		} as unknown as PostEvent);

		expect(res.status).toBe(401);
		expect(set).not.toHaveBeenCalled();
	});

	it('rejects a nonexistent email with the same generic 401', async () => {
		const db = makeFakeDb([]);
		const { kv } = makeFakeKv();
		const { cookies } = makeCookies();
		const req = mockRequest({ email: 'nobody@example.com', recoveryAuthKey: 'anything' });

		const res = await POST({
			request: req,
			platform: { env: { DB: db, SHARE_KV: kv } },
			cookies
		} as unknown as PostEvent);

		expect(res.status).toBe(401);
	});

	it('rejects a user who never generated a recovery code', async () => {
		const db = makeFakeDb([{ id: 'u1', email: 'user@example.com' }]);
		const { kv } = makeFakeKv();
		const { cookies } = makeCookies();
		const req = mockRequest({ email: 'user@example.com', recoveryAuthKey: 'anything' });

		const res = await POST({
			request: req,
			platform: { env: { DB: db, SHARE_KV: kv } },
			cookies
		} as unknown as PostEvent);

		expect(res.status).toBe(401);
	});

	it('rejects cross-origin requests', async () => {
		const db = makeFakeDb([]);
		const { kv } = makeFakeKv();
		const { cookies } = makeCookies();
		const req = mockRequest(
			{ email: 'user@example.com', recoveryAuthKey: 'x' },
			{ 'sec-fetch-site': 'cross-site' }
		);

		const res = await POST({
			request: req,
			platform: { env: { DB: db, SHARE_KV: kv } },
			cookies
		} as unknown as PostEvent);

		expect(res.status).toBe(403);
	});
});
