import { describe, it, expect, vi } from 'vitest';

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

vi.mock('$lib/server/rate-limit', async () => {
	const real = await vi.importActual<typeof import('../../../../lib/server/rate-limit')>(
		'../../../../lib/server/rate-limit'
	);
	return real;
});
vi.mock('$lib/server/collections', async () => {
	const real = await vi.importActual<typeof import('../../../../lib/server/collections')>(
		'../../../../lib/server/collections'
	);
	return real;
});

import { GET, POST } from '../+server';

type GetEvent = Parameters<typeof GET>[0];
type PostEvent = Parameters<typeof POST>[0];

const ALICE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const BOB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const COLL_A = '11111111-1111-4111-8111-111111111111';
const COLL_B = '22222222-2222-4222-9222-222222222222';

interface Row {
	id: string;
	name: string;
	owner_user_id: string;
	dek_version: number;
	created_at: string;
	role: string;
	wrapped_key: string;
	member_dek_version: number;
}

function makeFakeDb(opts: { rows: Record<string, Row[]>; entitled: Set<string> }) {
	const inserts: { sql: string; args: unknown[] }[] = [];
	const db = {
		prepare(sql: string) {
			return {
				bind(...args: unknown[]) {
					const stmt = {
						sql,
						args,
						async first<T>() {
							if (sql.includes('FROM users WHERE id')) {
								const [uid] = args as [string];
								return opts.entitled.has(uid) ? ({ id: uid } as T) : null;
							}
							return null;
						},
						async all<T>() {
							const [uid] = args as [string];
							return { results: (opts.rows[uid] ?? []) as T[] };
						}
					};
					return stmt;
				}
			};
		},
		async batch(stmts: { sql: string; args: unknown[] }[]) {
			for (const s of stmts) inserts.push({ sql: s.sql, args: s.args });
			return [];
		}
	};
	return { db, inserts };
}

function row(over: Partial<Row> = {}): Row {
	return {
		id: COLL_A,
		name: 'Date night',
		owner_user_id: ALICE,
		dek_version: 1,
		created_at: '2026-08-21',
		role: 'owner',
		wrapped_key: 'wrapped-a',
		member_dek_version: 1,
		...over
	};
}

function kvEnv(db: unknown) {
	const store = new Map<string, string>();
	return {
		DB: db,
		SHARE_KV: {
			get: async (k: string) => store.get(k) ?? null,
			put: async (k: string, v: string) => void store.set(k, v)
		}
	};
}

function getEvent(db: unknown, userId?: string): GetEvent {
	return {
		locals: { user: userId ? { id: userId, email: 'a@b.c' } : null },
		platform: { env: kvEnv(db) }
	} as unknown as GetEvent;
}

function postEvent(db: unknown, userId: string | null, body: unknown, site?: string): PostEvent {
	const headers: Record<string, string> = { 'content-type': 'application/json' };
	if (site) headers['sec-fetch-site'] = site;
	return {
		request: new Request('https://x', { method: 'POST', body: JSON.stringify(body), headers }),
		locals: { user: userId ? { id: userId, email: 'a@b.c' } : null },
		platform: { env: kvEnv(db) }
	} as unknown as PostEvent;
}

describe('GET /api/collections', () => {
	it('401s when signed out', async () => {
		const { db } = makeFakeDb({ rows: {}, entitled: new Set() });
		expect((await GET(getEvent(db))).status).toBe(401);
	});

	it('returns only the caller’s collections', async () => {
		const { db } = makeFakeDb({
			rows: {
				[ALICE]: [row()],
				[BOB]: [row({ id: COLL_B, name: 'Horror October', owner_user_id: BOB })]
			},
			entitled: new Set([ALICE, BOB])
		});

		const mine = await (await GET(getEvent(db, ALICE))).json();
		expect(mine.collections).toHaveLength(1);
		expect(mine.collections[0]).toMatchObject({
			id: COLL_A,
			name: 'Date night',
			role: 'owner',
			wrappedKey: 'wrapped-a'
		});
		// Nothing belonging to Bob leaks into Alice's listing.
		expect(JSON.stringify(mine)).not.toContain(COLL_B);
	});

	it('returns an empty list rather than erroring for a user with none', async () => {
		const { db } = makeFakeDb({ rows: {}, entitled: new Set([ALICE]) });
		const res = await GET(getEvent(db, ALICE));
		expect(res.status).toBe(200);
		expect((await res.json()).collections).toEqual([]);
	});

	// Reads stay ungated so a lapsed subscription can't look like data loss.
	it('lists collections for an unentitled user', async () => {
		const { db } = makeFakeDb({ rows: { [ALICE]: [row()] }, entitled: new Set() });
		const res = await GET(getEvent(db, ALICE));
		expect(res.status).toBe(200);
		expect((await res.json()).collections).toHaveLength(1);
	});
});

describe('POST /api/collections', () => {
	const valid = { name: 'Date night', wrappedKey: 'wrapped-a' };

	it('401s when signed out', async () => {
		const { db } = makeFakeDb({ rows: {}, entitled: new Set() });
		expect((await POST(postEvent(db, null, valid))).status).toBe(401);
	});

	it('403s a cross-site request', async () => {
		const { db } = makeFakeDb({ rows: {}, entitled: new Set([ALICE]) });
		expect((await POST(postEvent(db, ALICE, valid, 'cross-site'))).status).toBe(403);
	});

	it('402s an unentitled user', async () => {
		const { db } = makeFakeDb({ rows: {}, entitled: new Set() });
		expect((await POST(postEvent(db, ALICE, valid))).status).toBe(402);
	});

	it('creates the collection and its owner membership together', async () => {
		const { db, inserts } = makeFakeDb({ rows: {}, entitled: new Set([ALICE]) });
		const res = await POST(postEvent(db, ALICE, valid));
		expect(res.status).toBe(201);

		const body = await res.json();
		expect(body).toMatchObject({ name: 'Date night', role: 'owner', dekVersion: 1 });
		// Server-generated id, not client-supplied.
		expect(body.id).toMatch(/^[0-9a-f-]{36}$/);

		// Both rows in one batch — a collection with no owner row would be
		// unreachable forever, since every read path goes through membership.
		expect(inserts).toHaveLength(2);
		expect(inserts[0].sql).toContain('INSERT INTO collections');
		expect(inserts[1].sql).toContain('INSERT INTO collection_members');
		expect(inserts[1].args).toContain(body.id);
	});

	it('ignores a client-supplied id', async () => {
		const { db } = makeFakeDb({ rows: {}, entitled: new Set([ALICE]) });
		const res = await POST(postEvent(db, ALICE, { ...valid, id: COLL_B }));
		expect((await res.json()).id).not.toBe(COLL_B);
	});

	it('trims the name and rejects blank or oversized ones', async () => {
		const { db } = makeFakeDb({ rows: {}, entitled: new Set([ALICE]) });
		const ok = await POST(postEvent(db, ALICE, { ...valid, name: '  Padded  ' }));
		expect((await ok.json()).name).toBe('Padded');

		for (const name of ['', '   ', 'x'.repeat(101), 42, null]) {
			expect((await POST(postEvent(db, ALICE, { ...valid, name }))).status).toBe(400);
		}
	});

	it('rejects a missing or oversized wrapped key', async () => {
		const { db } = makeFakeDb({ rows: {}, entitled: new Set([ALICE]) });
		for (const wrappedKey of ['', 'x'.repeat(1025), 42, null, undefined]) {
			expect((await POST(postEvent(db, ALICE, { ...valid, wrappedKey }))).status).toBe(400);
		}
	});

	it('400s on invalid JSON', async () => {
		const { db } = makeFakeDb({ rows: {}, entitled: new Set([ALICE]) });
		const event = {
			request: new Request('https://x', { method: 'POST', body: 'not json' }),
			locals: { user: { id: ALICE, email: 'a@b.c' } },
			platform: { env: kvEnv(db) }
		} as unknown as PostEvent;
		expect((await POST(event)).status).toBe(400);
	});
});
