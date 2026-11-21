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

import { DELETE as deleteList, PATCH } from '../+server';
import { DELETE as leaveList } from '../membership/+server';

const COLL = '11111111-1111-4111-8111-111111111111';
const ALICE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'; // owner
const BOB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const CAROL = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const MALLORY = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

/**
 * A tiny in-memory stand-in for the four collection tables, applying the
 * statements these endpoints actually run, so tests assert on resulting
 * state (who's still a member, whether the list was purged) rather than on
 * which SQL strings were sent.
 */
function makeState(memberIds: string[]) {
	const state = {
		collection: { exists: true, deletedAt: null as string | null },
		members: new Map(memberIds.map((id) => [id, id === ALICE ? 'owner' : 'member'])),
		invites: [{ claimed: false, revoked: false }],
		blob: true as boolean
	};
	function exec(sql: string, args: unknown[]) {
		if (sql.startsWith('UPDATE collections SET deleted_at')) {
			if (state.collection.exists && !state.collection.deletedAt)
				state.collection.deletedAt = 'now';
		} else if (sql.startsWith('UPDATE collection_invites SET revoked_at')) {
			for (const i of state.invites) if (!i.claimed) i.revoked = true;
		} else if (sql.startsWith('DELETE FROM collection_members')) {
			state.members.delete(args[1] as string);
		} else if (sql.startsWith('DELETE FROM collection_blobs')) {
			state.blob = false;
		} else if (sql.startsWith('DELETE FROM collection_invites')) {
			state.invites = [];
		} else if (sql.startsWith('DELETE FROM collections')) {
			if (state.collection.deletedAt) state.collection.exists = false;
		} else if (sql.startsWith('UPDATE collections SET')) {
			// PATCH rename/recolor: not under test here beyond being refused
		} else {
			throw new Error(`unexpected statement: ${sql}`);
		}
	}
	const db = {
		prepare(sql: string) {
			const stmt = {
				sql,
				args: [] as unknown[],
				bind(...args: unknown[]) {
					stmt.args = args;
					return stmt;
				},
				async first<T>() {
					if (sql.includes('JOIN collections c ON c.id = m.collection_id')) {
						const [cid, uid] = stmt.args as [string, string];
						const role = state.members.get(uid);
						if (cid !== COLL || !state.collection.exists || !role) return null;
						return {
							name: 'Movie night',
							owner_user_id: ALICE,
							role,
							member_dek_version: 1,
							collection_dek_version: 1,
							deleted_at: state.collection.deletedAt
						} as T;
					}
					if (sql.includes('COUNT(*)')) return { n: state.members.size } as T;
					return null;
				},
				async run() {
					exec(sql, stmt.args);
					return {};
				}
			};
			return stmt;
		},
		async batch(stmts: { sql: string; args: unknown[] }[]) {
			for (const s of stmts) exec(s.sql, s.args);
			return [];
		}
	};
	return { db, state };
}

function env(db: unknown) {
	const store = new Map<string, string>();
	return {
		DB: db,
		SHARE_KV: {
			get: async (k: string) => store.get(k) ?? null,
			put: async (k: string, v: string) => void store.set(k, v)
		}
	};
}

function event(db: unknown, userId: string | null, method = 'DELETE', body?: unknown) {
	return {
		request: new Request(`https://queuest.test/api/collections/${COLL}`, {
			method,
			headers: { 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' },
			...(body ? { body: JSON.stringify(body) } : {})
		}),
		params: { id: COLL },
		platform: { env: env(db) },
		locals: { user: userId ? { id: userId, email: `${userId}@x.test` } : null }
	} as never;
}

describe('DELETE /api/collections/[id] (owner deletes)', () => {
	it('marks it deleted, revokes invites, removes the owner, and keeps it for members', async () => {
		const { db, state } = makeState([ALICE, BOB, CAROL]);
		const res = await deleteList(event(db, ALICE));
		expect(res.status).toBe(200);
		expect(await res.json()).toMatchObject({ deleted: true, purged: false });
		expect(state.collection.deletedAt).not.toBeNull();
		expect(state.invites.every((i) => i.revoked)).toBe(true);
		expect([...state.members.keys()]).toEqual([BOB, CAROL]);
		expect(state.blob).toBe(true);
	});

	it('purges everything straight away when the owner was alone', async () => {
		const { db, state } = makeState([ALICE]);
		const res = await deleteList(event(db, ALICE));
		expect(await res.json()).toMatchObject({ purged: true });
		expect(state.collection.exists).toBe(false);
		expect(state.blob).toBe(false);
		expect(state.invites).toHaveLength(0);
	});

	it('refuses a member (403) and a non-member (404), changing nothing', async () => {
		const { db, state } = makeState([ALICE, BOB]);
		expect((await deleteList(event(db, BOB))).status).toBe(403);
		expect((await deleteList(event(db, MALLORY))).status).toBe(404);
		expect((await deleteList(event(db, null))).status).toBe(401);
		expect(state.collection.deletedAt).toBeNull();
		expect(state.members.size).toBe(2);
	});

	it('refuses changes to a deleted list (410)', async () => {
		// After a real delete the owner's membership is gone (so they'd get a
		// 404), so set up a deleted list that still has its owner row to reach
		// the 410 check itself.
		const { db, state } = makeState([ALICE, BOB]);
		state.collection.deletedAt = 'now';
		const res = await PATCH(event(db, ALICE, 'PATCH', { name: 'New name' }));
		expect(res.status).toBe(410);
	});
});

describe('DELETE /api/collections/[id]/membership (leave)', () => {
	it('lets a member leave a live list without touching anyone else', async () => {
		const { db, state } = makeState([ALICE, BOB, CAROL]);
		const res = await leaveList(event(db, BOB));
		expect(res.status).toBe(200);
		expect(await res.json()).toMatchObject({ left: true, purged: false });
		expect([...state.members.keys()]).toEqual([ALICE, CAROL]);
		expect(state.collection.exists).toBe(true);
		expect(state.collection.deletedAt).toBeNull();
	});

	it('refuses the owner of a live list (they delete it instead)', async () => {
		const { db, state } = makeState([ALICE, BOB]);
		expect((await leaveList(event(db, ALICE))).status).toBe(400);
		expect(state.members.size).toBe(2);
	});

	it('purges a deleted list once the last member leaves, not before', async () => {
		const { db, state } = makeState([ALICE, BOB, CAROL]);
		await deleteList(event(db, ALICE));

		expect(await (await leaveList(event(db, BOB))).json()).toMatchObject({ purged: false });
		expect(state.blob).toBe(true);

		expect(await (await leaveList(event(db, CAROL))).json()).toMatchObject({ purged: true });
		expect(state.collection.exists).toBe(false);
		expect(state.blob).toBe(false);
	});

	it('404s for someone who isn’t a member', async () => {
		const { db } = makeState([ALICE, BOB]);
		expect((await leaveList(event(db, MALLORY))).status).toBe(404);
	});
});
