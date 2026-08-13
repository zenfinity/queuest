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
	const real = await vi.importActual<typeof import('../../../../lib/server/auth')>(
		'../../../../lib/server/auth'
	);
	return real;
});

import { DELETE } from '../+server';

type DeleteEvent = Parameters<typeof DELETE>[0];

function mockRequest(headers: Record<string, string> = {}): Request {
	return new Request('https://example.com', {
		method: 'DELETE',
		headers: { 'sec-fetch-site': 'same-origin', ...headers }
	});
}

function makeFakeDb() {
	const deletes: { sql: string; args: unknown[] }[] = [];
	const db = {
		prepare(sql: string) {
			return {
				bind(...args: unknown[]) {
					return {
						sql,
						args,
						async run() {
							deletes.push({ sql, args });
							return { success: true };
						}
					};
				}
			};
		},
		async batch(statements: { sql: string; args: unknown[]; run: () => Promise<unknown> }[]) {
			const results = [];
			for (const stmt of statements) results.push(await stmt.run());
			return results;
		}
	};
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	return { db: db as any, deletes };
}

function makeFakeKv() {
	const store = new Map<string, string>([['sess:tok123', JSON.stringify({ userId: 'u1' })]]);
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

function makeCookies(token = 'tok123') {
	const deleted: unknown[] = [];
	return {
		deleted,
		cookies: {
			get: () => token,
			delete: (...args: unknown[]) => deleted.push(args)
		} as unknown as DeleteEvent['cookies']
	};
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe('DELETE /api/account', () => {
	it('requires auth', async () => {
		const { db } = makeFakeDb();
		const { kv } = makeFakeKv();
		const { cookies } = makeCookies();
		const res = await DELETE({
			request: mockRequest(),
			platform: { env: { DB: db, SHARE_KV: kv } },
			locals: { user: null },
			cookies
		} as unknown as DeleteEvent);
		expect(res.status).toBe(401);
	});

	it('deletes every table row tied to the user, the session, and the cookie', async () => {
		const { db, deletes } = makeFakeDb();
		const { kv, store } = makeFakeKv();
		const { cookies, deleted } = makeCookies();

		const res = await DELETE({
			request: mockRequest(),
			platform: { env: { DB: db, SHARE_KV: kv } },
			locals: { user: { id: 'u1', email: 'a@b.com' } },
			cookies
		} as unknown as DeleteEvent);

		expect(res.status).toBe(204);
		expect(deletes.map((d) => d.sql)).toEqual([
			'DELETE FROM sync_blobs WHERE user_id = ?',
			'DELETE FROM wrapped_dek WHERE user_id = ?',
			'DELETE FROM recovery_auth WHERE user_id = ?',
			'DELETE FROM users WHERE id = ?'
		]);
		for (const d of deletes) expect(d.args).toEqual(['u1']);
		expect(store.has('sess:tok123')).toBe(false);
		expect(deleted).toHaveLength(1);
	});

	it('rejects cross-origin requests', async () => {
		const { db } = makeFakeDb();
		const { kv } = makeFakeKv();
		const { cookies } = makeCookies();
		const res = await DELETE({
			request: mockRequest({ 'sec-fetch-site': 'cross-site' }),
			platform: { env: { DB: db, SHARE_KV: kv } },
			locals: { user: { id: 'u1', email: 'a@b.com' } },
			cookies
		} as unknown as DeleteEvent);
		expect(res.status).toBe(403);
	});

	it('returns 503 when bindings are missing', async () => {
		const { cookies } = makeCookies();
		const res = await DELETE({
			request: mockRequest(),
			platform: { env: {} },
			locals: { user: { id: 'u1', email: 'a@b.com' } },
			cookies
		} as unknown as DeleteEvent);
		expect(res.status).toBe(503);
	});
});
