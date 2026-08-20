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
	const real = await vi.importActual<typeof import('../../../../../../lib/server/rate-limit')>(
		'../../../../../../lib/server/rate-limit'
	);
	return real;
});
vi.mock('$lib/server/collections', async () => {
	const real = await vi.importActual<typeof import('../../../../../../lib/server/collections')>(
		'../../../../../../lib/server/collections'
	);
	return real;
});

import { GET, DELETE } from '../+server';

type GetEvent = Parameters<typeof GET>[0];
type DeleteEvent = Parameters<typeof DELETE>[0];

const COLL = '11111111-1111-4111-8111-111111111111';
const ALICE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const BOB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const CAROL = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const MALLORY = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

function makeFakeDb(opts: {
	members: { userId: string; role: 'owner' | 'member'; publicKey?: string | null }[];
	dekVersion?: number;
	entitled?: Set<string>;
}) {
	const members = [...opts.members];
	const dekVersion = opts.dekVersion ?? 1;
	const entitled = opts.entitled ?? new Set([ALICE, BOB, CAROL, MALLORY]);
	const batches: { sql: string; args: unknown[] }[][] = [];

	const db = {
		prepare(sql: string) {
			return {
				bind(...args: unknown[]) {
					return {
						sql,
						args,
						async first<T>() {
							if (sql.includes('FROM collection_members m\n\t\t\t   JOIN collections c')) {
								// fallthrough handled below
							}
							if (sql.includes('JOIN collections c ON c.id = m.collection_id')) {
								const [cid, uid] = args as [string, string];
								if (cid !== COLL) return null;
								const m = members.find((x) => x.userId === uid);
								if (!m) return null;
								return {
									name: 'Date night',
									owner_user_id: ALICE,
									role: m.role,
									member_dek_version: dekVersion,
									collection_dek_version: dekVersion
								} as T;
							}
							if (sql.includes('FROM users WHERE id')) {
								const [uid] = args as [string];
								return entitled.has(uid) ? ({ id: uid } as T) : null;
							}
							return null;
						},
						async all<T>() {
							if (sql.includes('LEFT JOIN user_keys')) {
								return {
									results: members.map((m) => ({
										user_id: m.userId,
										email: `${m.userId.slice(0, 5)}@x.com`,
										role: m.role,
										dek_version: dekVersion,
										public_key: m.publicKey === undefined ? `pk-${m.userId}` : m.publicKey,
										created_at: '2026-08-21'
									})) as T[]
								};
							}
							if (sql.includes('SELECT user_id FROM collection_members WHERE collection_id')) {
								return { results: members.map((m) => ({ user_id: m.userId })) as T[] };
							}
							return { results: [] as T[] };
						}
					};
				}
			};
		},
		async batch(stmts: { sql: string; args: unknown[] }[]) {
			batches.push(stmts.map((s) => ({ sql: s.sql, args: s.args })));
			return [];
		}
	};
	return { db, batches, members };
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

function getEvent(db: unknown, userId?: string, id = COLL): GetEvent {
	return {
		params: { id },
		locals: { user: userId ? { id: userId, email: 'a@b.c' } : null },
		platform: { env: kvEnv(db) }
	} as unknown as GetEvent;
}

function deleteEvent(db: unknown, userId: string | null, body: unknown, id = COLL): DeleteEvent {
	return {
		params: { id },
		request: new Request('https://x', {
			method: 'DELETE',
			body: JSON.stringify(body),
			headers: { 'content-type': 'application/json' }
		}),
		locals: { user: userId ? { id: userId, email: 'a@b.c' } : null },
		platform: { env: kvEnv(db) }
	} as unknown as DeleteEvent;
}

const THREE = [
	{ userId: ALICE, role: 'owner' as const },
	{ userId: BOB, role: 'member' as const },
	{ userId: CAROL, role: 'member' as const }
];

describe('GET members', () => {
	it('404s a non-member', async () => {
		const { db } = makeFakeDb({ members: THREE });
		expect((await GET(getEvent(db, MALLORY))).status).toBe(404);
	});

	it('returns members with their public keys', async () => {
		const { db } = makeFakeDb({ members: THREE });
		const body = await (await GET(getEvent(db, BOB))).json();
		expect(body.members).toHaveLength(3);
		expect(body.members[0]).toMatchObject({
			userId: ALICE,
			role: 'owner',
			publicKey: `pk-${ALICE}`
		});
	});

	it('reports a null public key for an account that has not backfilled one', async () => {
		const { db } = makeFakeDb({
			members: [
				{ userId: ALICE, role: 'owner' },
				{ userId: BOB, role: 'member', publicKey: null }
			]
		});
		const body = await (await GET(getEvent(db, ALICE))).json();
		expect(body.members[1].publicKey).toBeNull();
	});
});

describe('DELETE member (removal + rotation)', () => {
	// Everyone who remains — including the owner performing the rotation.
	const validKeys = () => ({ [ALICE]: 'newkey-alice', [CAROL]: 'newkey-carol' });
	const validBody = () => ({ userId: BOB, blob: 'reencrypted', wrappedKeys: validKeys() });

	it('401s signed out, 404s a non-member, 403s a non-owner', async () => {
		const { db } = makeFakeDb({ members: THREE });
		expect((await DELETE(deleteEvent(db, null, validBody()))).status).toBe(401);
		expect((await DELETE(deleteEvent(db, MALLORY, validBody()))).status).toBe(404);
		expect((await DELETE(deleteEvent(db, BOB, validBody()))).status).toBe(403);
	});

	it('402s an unentitled owner', async () => {
		const { db } = makeFakeDb({ members: THREE, entitled: new Set() });
		expect((await DELETE(deleteEvent(db, ALICE, validBody()))).status).toBe(402);
	});

	it('removes, rotates, and re-keys everyone remaining in one batch', async () => {
		const { db, batches } = makeFakeDb({ members: THREE, dekVersion: 3 });
		const res = await DELETE(deleteEvent(db, ALICE, validBody()));
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ removed: BOB, dekVersion: 4 });

		// Everything in a single batch — a half-applied rotation is the lockout bug.
		expect(batches).toHaveLength(1);
		const sqls = batches[0].map((s) => s.sql).join('\n');
		expect(sqls).toContain('UPDATE collections SET dek_version');
		expect(sqls).toContain('UPDATE collection_members SET wrapped_key');
		expect(sqls).toContain('INSERT INTO collection_blobs');
		expect(sqls).toContain('DELETE FROM collection_members');
		expect(sqls).toContain('UPDATE collection_invites SET revoked_at');
	});

	// The core guarantee: nobody who stays can be left without a usable key.
	it('refuses a rotation that omits a remaining member', async () => {
		const { db, batches } = makeFakeDb({ members: THREE });
		// Owner re-keyed, Carol forgotten — the partial case, which is exactly
		// how someone ends up permanently locked out.
		const res = await DELETE(
			deleteEvent(db, ALICE, { userId: BOB, blob: 'x', wrappedKeys: { [ALICE]: 'k' } })
		);
		expect(res.status).toBe(400);
		expect((await res.json()).error).toMatch(/missing wrapped keys/i);
		expect(batches).toHaveLength(0);
	});

	it('refuses wrapped keys for someone who is not a remaining member', async () => {
		const { db, batches } = makeFakeDb({ members: THREE });
		const res = await DELETE(
			deleteEvent(db, ALICE, {
				userId: BOB,
				blob: 'x',
				wrappedKeys: { ...validKeys(), [MALLORY]: 'nope' }
			})
		);
		expect(res.status).toBe(400);
		expect(batches).toHaveLength(0);
	});

	// A key for the person being removed would re-admit them immediately.
	it('refuses a wrapped key for the member being removed', async () => {
		const { db } = makeFakeDb({ members: THREE });
		const res = await DELETE(
			deleteEvent(db, ALICE, {
				userId: BOB,
				blob: 'x',
				wrappedKeys: { ...validKeys(), [BOB]: 'still-here' }
			})
		);
		expect(res.status).toBe(400);
	});

	it('refuses to remove someone who is not a member', async () => {
		const { db } = makeFakeDb({ members: THREE });
		const res = await DELETE(
			deleteEvent(db, ALICE, { userId: MALLORY, blob: 'x', wrappedKeys: validKeys() })
		);
		expect(res.status).toBe(404);
	});

	it('refuses to let the owner remove themselves', async () => {
		const { db } = makeFakeDb({ members: THREE });
		const res = await DELETE(deleteEvent(db, ALICE, { userId: ALICE, blob: 'x', wrappedKeys: {} }));
		expect(res.status).toBe(400);
	});

	it('requires the re-encrypted blob', async () => {
		const { db } = makeFakeDb({ members: THREE });
		for (const blob of ['', null, 42, undefined]) {
			const res = await DELETE(
				deleteEvent(db, ALICE, { userId: BOB, blob, wrappedKeys: validKeys() })
			);
			expect(res.status).toBe(400);
		}
	});

	it('handles removing the last other member, leaving only the owner', async () => {
		const { db, batches } = makeFakeDb({
			members: [
				{ userId: ALICE, role: 'owner' },
				{ userId: BOB, role: 'member' }
			]
		});
		const res = await DELETE(
			deleteEvent(db, ALICE, { userId: BOB, blob: 'x', wrappedKeys: { [ALICE]: 'k' } })
		);
		expect(res.status).toBe(200);
		expect(batches).toHaveLength(1);
	});
});
