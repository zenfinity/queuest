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

import { POST } from '../signup/+server';

type PostEvent = Parameters<typeof POST>[0];

function mockRequest(body?: unknown, headers: Record<string, string> = {}): Request {
	const req = new Request('https://example.com', {
		method: 'POST',
		headers: { 'sec-fetch-site': 'same-origin', ...headers }
	});
	req.json = async () => body;
	return req;
}

// Fake D1 that just records what was inserted; UNIQUE constraint is
// simulated by tracking emails already "in the table".
function makeFakeDb() {
	const usersByEmail = new Set<string>();
	const inserts: { sql: string; args: unknown[] }[] = [];

	const db = {
		prepare(sql: string) {
			return {
				bind(...args: unknown[]) {
					return {
						sql,
						args,
						async run() {
							if (sql.startsWith('INSERT INTO users')) {
								const email = args[1] as string;
								if (usersByEmail.has(email)) {
									throw new Error('UNIQUE constraint failed: users.email');
								}
								usersByEmail.add(email);
							}
							inserts.push({ sql, args });
							return { success: true };
						}
					};
				}
			};
		},
		async batch(statements: { sql: string; args: unknown[]; run: () => Promise<unknown> }[]) {
			// Real D1 runs a batch atomically; this fake just runs them in order,
			// which is enough to exercise the UNIQUE-violation path this route relies on.
			const results = [];
			for (const stmt of statements) results.push(await stmt.run());
			return results;
		}
	};

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	return { db: db as any, usersByEmail, inserts };
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

describe('POST /api/auth/signup', () => {
	it('creates a user and wrapped_dek row, sets a session cookie, and returns the normalized email', async () => {
		const { db, usersByEmail, inserts } = makeFakeDb();
		const { kv, store } = makeFakeKv();
		const { set, cookies } = makeCookies();
		const req = mockRequest({
			email: '  User@Example.com  ',
			authKey: 'a'.repeat(43),
			wrappedDek: 'b'.repeat(80)
		});

		const res = await POST({
			request: req,
			platform: { env: { DB: db, SHARE_KV: kv } },
			cookies
		} as unknown as PostEvent);

		expect(res.status).toBe(200);
		const json = await res.json();
		expect(json.email).toBe('user@example.com');
		expect(usersByEmail.has('user@example.com')).toBe(true);
		expect(inserts.some((i) => i.sql.startsWith('INSERT INTO wrapped_dek'))).toBe(true);
		expect(set).toHaveBeenCalledWith('sq_session', expect.any(String), expect.any(Object));
		expect(store.size).toBe(1); // session written to KV
	});

	it('never stores the raw authKey — only a hash of it', async () => {
		const { db, inserts } = makeFakeDb();
		const { kv } = makeFakeKv();
		const { cookies } = makeCookies();
		const authKey = 'a'.repeat(43);
		const req = mockRequest({ email: 'user@example.com', authKey, wrappedDek: 'b'.repeat(80) });

		await POST({
			request: req,
			platform: { env: { DB: db, SHARE_KV: kv } },
			cookies
		} as unknown as PostEvent);

		const userInsert = inserts.find((i) => i.sql.startsWith('INSERT INTO users'));
		expect(userInsert?.args).not.toContain(authKey);
	});

	it('rejects a duplicate email with 409', async () => {
		const { db } = makeFakeDb();
		const { kv } = makeFakeKv();
		const { cookies } = makeCookies();
		const payload = {
			email: 'user@example.com',
			authKey: 'a'.repeat(43),
			wrappedDek: 'b'.repeat(80)
		};

		const platform = { env: { DB: db, SHARE_KV: kv } };
		await POST({ request: mockRequest(payload), platform, cookies } as unknown as PostEvent);
		const res2 = await POST({
			request: mockRequest(payload),
			platform,
			cookies
		} as unknown as PostEvent);

		expect(res2.status).toBe(409);
	});

	it('rejects an invalid email', async () => {
		const { db } = makeFakeDb();
		const { kv } = makeFakeKv();
		const { cookies } = makeCookies();
		const req = mockRequest({ email: 'not-an-email', authKey: 'a'.repeat(43), wrappedDek: 'x' });

		const res = await POST({
			request: req,
			platform: { env: { DB: db, SHARE_KV: kv } },
			cookies
		} as unknown as PostEvent);

		expect(res.status).toBe(400);
	});

	it('rejects a missing authKey', async () => {
		const { db } = makeFakeDb();
		const { kv } = makeFakeKv();
		const { cookies } = makeCookies();
		const req = mockRequest({ email: 'user@example.com', wrappedDek: 'x' });

		const res = await POST({
			request: req,
			platform: { env: { DB: db, SHARE_KV: kv } },
			cookies
		} as unknown as PostEvent);

		expect(res.status).toBe(400);
	});

	it('rejects a missing wrappedDek', async () => {
		const { db } = makeFakeDb();
		const { kv } = makeFakeKv();
		const { cookies } = makeCookies();
		const req = mockRequest({ email: 'user@example.com', authKey: 'a'.repeat(43) });

		const res = await POST({
			request: req,
			platform: { env: { DB: db, SHARE_KV: kv } },
			cookies
		} as unknown as PostEvent);

		expect(res.status).toBe(400);
	});

	it('rejects malformed JSON', async () => {
		const { db } = makeFakeDb();
		const { kv } = makeFakeKv();
		const { cookies } = makeCookies();
		const req = mockRequest();
		req.json = async () => {
			throw new SyntaxError('bad json');
		};

		const res = await POST({
			request: req,
			platform: { env: { DB: db, SHARE_KV: kv } },
			cookies
		} as unknown as PostEvent);

		expect(res.status).toBe(400);
	});

	it('rejects cross-origin requests', async () => {
		const { db } = makeFakeDb();
		const { kv } = makeFakeKv();
		const { cookies } = makeCookies();
		const req = mockRequest(
			{ email: 'user@example.com', authKey: 'a'.repeat(43), wrappedDek: 'x' },
			{ 'sec-fetch-site': 'cross-site' }
		);

		const res = await POST({
			request: req,
			platform: { env: { DB: db, SHARE_KV: kv } },
			cookies
		} as unknown as PostEvent);

		expect(res.status).toBe(403);
	});

	it('returns 503 when DB or KV bindings are missing', async () => {
		const { cookies } = makeCookies();
		const req = mockRequest({
			email: 'user@example.com',
			authKey: 'a'.repeat(43),
			wrappedDek: 'x'
		});

		const res = await POST({
			request: req,
			platform: { env: {} },
			cookies
		} as unknown as PostEvent);

		expect(res.status).toBe(503);
	});
});
