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

import { PUT } from '../+server';

type PutEvent = Parameters<typeof PUT>[0];

function mockRequest(body?: unknown, headers: Record<string, string> = {}): Request {
	const req = new Request('https://example.com', {
		method: 'PUT',
		headers: { 'sec-fetch-site': 'same-origin', ...headers }
	});
	req.json = async () => body;
	return req;
}

function makeFakeDb() {
	const runs: { sql: string; args: unknown[] }[] = [];
	const db = {
		prepare(sql: string) {
			return {
				bind(...args: unknown[]) {
					return {
						sql,
						args,
						async run() {
							runs.push({ sql, args });
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
	return { db: db as any, runs };
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe('PUT /api/auth/passphrase', () => {
	it('requires auth', async () => {
		const { db } = makeFakeDb();
		const req = mockRequest({ authKey: 'a'.repeat(43), wrappedDek: 'b'.repeat(80) });
		const res = await PUT({
			request: req,
			platform: { env: { DB: db } },
			locals: { user: null }
		} as unknown as PutEvent);
		expect(res.status).toBe(401);
	});

	it('updates the users row and the passphrase-wrapped DEK, never storing the raw authKey', async () => {
		const { db, runs } = makeFakeDb();
		const authKey = 'a'.repeat(43);
		const req = mockRequest({ authKey, wrappedDek: 'new-wrapped-dek' });

		const res = await PUT({
			request: req,
			platform: { env: { DB: db } },
			locals: { user: { id: 'u1', email: 'a@b.com' } }
		} as unknown as PutEvent);

		expect(res.status).toBe(204);
		const userUpdate = runs.find((r) => r.sql.startsWith('UPDATE users'));
		const dekUpsert = runs.find((r) => r.sql.includes("'passphrase'"));
		expect(userUpdate?.args).not.toContain(authKey);
		expect(dekUpsert?.args).toEqual(['u1', 'new-wrapped-dek']);
	});

	it('rejects a missing authKey', async () => {
		const { db } = makeFakeDb();
		const req = mockRequest({ wrappedDek: 'x' });
		const res = await PUT({
			request: req,
			platform: { env: { DB: db } },
			locals: { user: { id: 'u1', email: 'a@b.com' } }
		} as unknown as PutEvent);
		expect(res.status).toBe(400);
	});

	it('rejects cross-origin requests', async () => {
		const { db } = makeFakeDb();
		const req = mockRequest(
			{ authKey: 'a'.repeat(43), wrappedDek: 'x' },
			{ 'sec-fetch-site': 'cross-site' }
		);
		const res = await PUT({
			request: req,
			platform: { env: { DB: db } },
			locals: { user: { id: 'u1', email: 'a@b.com' } }
		} as unknown as PutEvent);
		expect(res.status).toBe(403);
	});
});
