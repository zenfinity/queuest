import { describe, it, expect } from 'vitest';
import { vi } from 'vitest';

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
	const real = await vi.importActual<typeof import('../../../../../lib/server/rate-limit')>(
		'../../../../../lib/server/rate-limit'
	);
	return real;
});
vi.mock('$lib/server/collections', async () => {
	const real = await vi.importActual<typeof import('../../../../../lib/server/collections')>(
		'../../../../../lib/server/collections'
	);
	return real;
});

import { PATCH } from '../+server';

type PatchEvent = Parameters<typeof PATCH>[0];

const COLL = '11111111-1111-4111-8111-111111111111';
const ALICE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const BOB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const MALLORY = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

function makeFakeDb(opts: { members: { userId: string; role: 'owner' | 'member' }[] }) {
	const updates: { sql: string; args: unknown[] }[] = [];
	const db = {
		prepare(sql: string) {
			return {
				bind(...args: unknown[]) {
					return {
						sql,
						args,
						async first<T>() {
							if (sql.includes('JOIN collections c ON c.id = m.collection_id')) {
								const [cid, uid] = args as [string, string];
								if (cid !== COLL) return null;
								const m = opts.members.find((x) => x.userId === uid);
								if (!m) return null;
								return {
									name: 'Date night',
									owner_user_id: opts.members.find((x) => x.role === 'owner')!.userId,
									role: m.role,
									member_dek_version: 1,
									collection_dek_version: 1
								} as T;
							}
							return null;
						},
						async run() {
							updates.push({ sql, args });
							return {};
						}
					};
				}
			};
		}
	};
	return { db, updates };
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

function event(db: unknown, userId: string | null, body: unknown, id = COLL): PatchEvent {
	return {
		params: { id },
		request: new Request('https://x', {
			method: 'PATCH',
			body: JSON.stringify(body),
			headers: { 'content-type': 'application/json' }
		}),
		locals: { user: userId ? { id: userId, email: 'a@b.c' } : null },
		platform: { env: kvEnv(db) }
	} as unknown as PatchEvent;
}

const MEMBERS = [
	{ userId: ALICE, role: 'owner' as const },
	{ userId: BOB, role: 'member' as const }
];

describe('PATCH collection (rename)', () => {
	it('401s signed out', async () => {
		const { db } = makeFakeDb({ members: MEMBERS });
		const res = await PATCH(event(db, null, { name: 'New name' }));
		expect(res.status).toBe(401);
	});

	it('404s a non-member', async () => {
		const { db } = makeFakeDb({ members: MEMBERS });
		const res = await PATCH(event(db, MALLORY, { name: 'New name' }));
		expect(res.status).toBe(404);
	});

	it('403s a member who is not the owner', async () => {
		const { db } = makeFakeDb({ members: MEMBERS });
		const res = await PATCH(event(db, BOB, { name: 'New name' }));
		expect(res.status).toBe(403);
	});

	it('renames as the owner and returns the new name', async () => {
		const { db, updates } = makeFakeDb({ members: MEMBERS });
		const res = await PATCH(event(db, ALICE, { name: '  Movie Night  ' }));
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ id: COLL, name: 'Movie Night' });
		expect(updates).toHaveLength(1);
		expect(updates[0].sql).toContain('UPDATE collections SET name');
		expect(updates[0].args).toEqual(['Movie Night', COLL]);
	});

	it('rejects an empty or whitespace-only name', async () => {
		const { db, updates } = makeFakeDb({ members: MEMBERS });
		for (const name of ['', '   ']) {
			const res = await PATCH(event(db, ALICE, { name }));
			expect(res.status).toBe(400);
		}
		expect(updates).toHaveLength(0);
	});

	it('rejects a name over the length limit', async () => {
		const { db, updates } = makeFakeDb({ members: MEMBERS });
		const res = await PATCH(event(db, ALICE, { name: 'x'.repeat(101) }));
		expect(res.status).toBe(400);
		expect(updates).toHaveLength(0);
	});

	it('rejects malformed JSON', async () => {
		const req = new Request('https://x', {
			method: 'PATCH',
			body: 'not json',
			headers: { 'content-type': 'application/json' }
		});
		const res = await PATCH({
			params: { id: COLL },
			request: req,
			locals: { user: { id: ALICE, email: 'a@b.c' } },
			platform: { env: kvEnv(makeFakeDb({ members: MEMBERS }).db) }
		} as unknown as PatchEvent);
		expect(res.status).toBe(400);
	});
});

describe('PATCH collection (color, #237)', () => {
	it('recolors as the owner and returns the new color', async () => {
		const { db, updates } = makeFakeDb({ members: MEMBERS });
		const res = await PATCH(event(db, ALICE, { color: '#3b82f6' }));
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ id: COLL, color: '#3b82f6' });
		expect(updates).toHaveLength(1);
		expect(updates[0].sql).toContain('UPDATE collections SET color');
		expect(updates[0].args).toEqual(['#3b82f6', COLL]);
	});

	it('403s a member who is not the owner', async () => {
		const { db } = makeFakeDb({ members: MEMBERS });
		const res = await PATCH(event(db, BOB, { color: '#3b82f6' }));
		expect(res.status).toBe(403);
	});

	it('rejects a non-hex color', async () => {
		const { db, updates } = makeFakeDb({ members: MEMBERS });
		for (const color of ['blue', '#zzzzzz', '#fff', 'rgb(0,0,0)', '']) {
			const res = await PATCH(event(db, ALICE, { color }));
			expect(res.status).toBe(400);
		}
		expect(updates).toHaveLength(0);
	});

	it('rejects a request with neither name nor color', async () => {
		const { db, updates } = makeFakeDb({ members: MEMBERS });
		const res = await PATCH(event(db, ALICE, {}));
		expect(res.status).toBe(400);
		expect(updates).toHaveLength(0);
	});

	it('sets both name and color in one statement when both are given', async () => {
		const { db, updates } = makeFakeDb({ members: MEMBERS });
		const res = await PATCH(event(db, ALICE, { name: 'Movie Night', color: '#22c55e' }));
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ id: COLL, name: 'Movie Night', color: '#22c55e' });
		expect(updates).toHaveLength(1);
		expect(updates[0].sql).toContain('UPDATE collections SET name = ?, color = ?');
		expect(updates[0].args).toEqual(['Movie Night', '#22c55e', COLL]);
	});
});
