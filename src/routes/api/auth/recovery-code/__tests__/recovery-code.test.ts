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

function makeFakeDb() {
	const inserts: { sql: string; args: unknown[] }[] = [];
	const db = {
		prepare(sql: string) {
			return {
				bind(...args: unknown[]) {
					return {
						sql,
						args,
						async run() {
							inserts.push({ sql, args });
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
	return { db: db as any, inserts };
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe('POST /api/auth/recovery-code', () => {
	it('requires auth', async () => {
		const { db } = makeFakeDb();
		const req = mockRequest({ recoveryAuthKey: 'a'.repeat(43), wrappedDek: 'b'.repeat(80) });
		const res = await POST({
			request: req,
			platform: { env: { DB: db } },
			locals: { user: null }
		} as unknown as PostEvent);
		expect(res.status).toBe(401);
	});

	it('stores the recovery auth hash and the recovery-wrapped DEK, never the raw key', async () => {
		const { db, inserts } = makeFakeDb();
		const recoveryAuthKey = 'a'.repeat(43);
		const req = mockRequest({ recoveryAuthKey, wrappedDek: 'b'.repeat(80) });

		const res = await POST({
			request: req,
			platform: { env: { DB: db } },
			locals: { user: { id: 'u1', email: 'a@b.com' } }
		} as unknown as PostEvent);

		expect(res.status).toBe(204);
		const recoveryInsert = inserts.find((i) => i.sql.startsWith('INSERT INTO recovery_auth'));
		const dekInsert = inserts.find((i) => i.sql.includes("'recovery'"));
		expect(recoveryInsert?.args).not.toContain(recoveryAuthKey);
		expect(dekInsert?.args).toEqual(['u1', 'b'.repeat(80)]);
	});

	it('rejects cross-origin requests', async () => {
		const { db } = makeFakeDb();
		const req = mockRequest(
			{ recoveryAuthKey: 'a'.repeat(43), wrappedDek: 'b'.repeat(80) },
			{ 'sec-fetch-site': 'cross-site' }
		);
		const res = await POST({
			request: req,
			platform: { env: { DB: db } },
			locals: { user: { id: 'u1', email: 'a@b.com' } }
		} as unknown as PostEvent);
		expect(res.status).toBe(403);
	});

	it('rejects a missing wrappedDek', async () => {
		const { db } = makeFakeDb();
		const req = mockRequest({ recoveryAuthKey: 'a'.repeat(43) });
		const res = await POST({
			request: req,
			platform: { env: { DB: db } },
			locals: { user: { id: 'u1', email: 'a@b.com' } }
		} as unknown as PostEvent);
		expect(res.status).toBe(400);
	});

	it('returns 503 when the DB binding is missing', async () => {
		const req = mockRequest({ recoveryAuthKey: 'a'.repeat(43), wrappedDek: 'b'.repeat(80) });
		const res = await POST({
			request: req,
			platform: { env: {} },
			locals: { user: { id: 'u1', email: 'a@b.com' } }
		} as unknown as PostEvent);
		expect(res.status).toBe(503);
	});
});
