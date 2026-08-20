import { describe, it, expect } from 'vitest';
import type { D1Database } from '@cloudflare/workers-types';
import {
	requireMembership,
	isValidCollectionId,
	isEntitled,
	makeInviteToken,
	hashInviteToken,
	resolveInvite
} from './collections';

const COLL_A = '11111111-1111-4111-8111-111111111111';
const COLL_B = '22222222-2222-4222-9222-222222222222';
const ALICE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const BOB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const MALLORY = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

interface CollectionRec {
	id: string;
	name: string;
	owner_user_id: string;
	dek_version: number;
}
interface MemberRec {
	collection_id: string;
	user_id: string;
	role: 'owner' | 'member';
	dek_version: number;
}

/**
 * Fake D1 that actually performs the JOIN requireMembership relies on, rather
 * than pattern-matching the SQL and returning a canned row — the point of
 * these tests is that a non-member gets nothing back, so the fake must be
 * capable of returning a row it shouldn't.
 */
function makeFakeDb(collections: CollectionRec[], members: MemberRec[]) {
	const calls: { sql: string; args: unknown[] }[] = [];
	const db = {
		prepare(sql: string) {
			return {
				bind(...args: unknown[]) {
					calls.push({ sql, args });
					return {
						async first<T>() {
							if (sql.includes('FROM collection_members m')) {
								const [collectionId, userId] = args as [string, string];
								const m = members.find(
									(r) => r.collection_id === collectionId && r.user_id === userId
								);
								if (!m) return null;
								const c = collections.find((r) => r.id === m.collection_id);
								if (!c) return null; // orphaned membership row
								return {
									name: c.name,
									owner_user_id: c.owner_user_id,
									role: m.role,
									member_dek_version: m.dek_version,
									collection_dek_version: c.dek_version
								} as T;
							}
							if (sql.includes('FROM users WHERE id')) {
								const [userId] = args as [string];
								return userId === ALICE ? ({ id: userId } as T) : null;
							}
							return null;
						}
					};
				}
			};
		}
	} as unknown as D1Database;
	return { db, calls };
}

const COLLECTIONS: CollectionRec[] = [
	{ id: COLL_A, name: 'Date night', owner_user_id: ALICE, dek_version: 1 },
	{ id: COLL_B, name: 'Horror October', owner_user_id: BOB, dek_version: 3 }
];
const MEMBERS: MemberRec[] = [
	{ collection_id: COLL_A, user_id: ALICE, role: 'owner', dek_version: 1 },
	{ collection_id: COLL_A, user_id: BOB, role: 'member', dek_version: 1 },
	{ collection_id: COLL_B, user_id: BOB, role: 'owner', dek_version: 3 }
];

describe('isValidCollectionId', () => {
	it('accepts a uuid v4 in either case', () => {
		expect(isValidCollectionId(COLL_A)).toBe(true);
		expect(isValidCollectionId(COLL_A.toUpperCase())).toBe(true);
	});

	it('rejects non-strings and empty input', () => {
		for (const bad of [null, undefined, 42, {}, [], '', ' ']) {
			expect(isValidCollectionId(bad)).toBe(false);
		}
	});

	it('rejects a uuid of the wrong version or variant', () => {
		expect(isValidCollectionId('11111111-1111-1111-8111-111111111111')).toBe(false); // v1
		expect(isValidCollectionId('11111111-1111-4111-7111-111111111111')).toBe(false); // bad variant
	});

	it('rejects SQL-ish and wildcard payloads', () => {
		for (const bad of ["' OR 1=1 --", '%', '_', `${COLL_A}' OR '1'='1`, `${COLL_A} `]) {
			expect(isValidCollectionId(bad)).toBe(false);
		}
	});
});

describe('requireMembership', () => {
	it('returns the membership for a member', async () => {
		const { db } = makeFakeDb(COLLECTIONS, MEMBERS);
		const m = await requireMembership(db, COLL_A, BOB);
		expect(m).toEqual({
			collectionId: COLL_A,
			name: 'Date night',
			ownerUserId: ALICE,
			role: 'member',
			memberDekVersion: 1,
			collectionDekVersion: 1
		});
	});

	it('distinguishes owner from member by role', async () => {
		const { db } = makeFakeDb(COLLECTIONS, MEMBERS);
		expect((await requireMembership(db, COLL_A, ALICE))?.role).toBe('owner');
		expect((await requireMembership(db, COLL_A, BOB))?.role).toBe('member');
	});

	// The core security property: a signed-in user holding a valid session is
	// not thereby authorised for an arbitrary collection id.
	it('returns null for a real collection the caller does not belong to', async () => {
		const { db } = makeFakeDb(COLLECTIONS, MEMBERS);
		expect(await requireMembership(db, COLL_B, ALICE)).toBeNull();
		expect(await requireMembership(db, COLL_A, MALLORY)).toBeNull();
	});

	it('returns null for a collection that does not exist', async () => {
		const { db } = makeFakeDb(COLLECTIONS, MEMBERS);
		const absent = '99999999-9999-4999-8999-999999999999';
		expect(await requireMembership(db, absent, ALICE)).toBeNull();
	});

	// Non-member and nonexistent must be indistinguishable to the caller, so
	// the endpoint built on this can't become an existence oracle.
	it('gives an identical result for "not a member" and "no such collection"', async () => {
		const { db } = makeFakeDb(COLLECTIONS, MEMBERS);
		const notAMember = await requireMembership(db, COLL_B, ALICE);
		const noSuchCollection = await requireMembership(
			db,
			'99999999-9999-4999-8999-999999999999',
			ALICE
		);
		expect(notAMember).toBe(noSuchCollection);
		expect(notAMember).toBeNull();
	});

	it('returns null once a member has been removed', async () => {
		const members = [...MEMBERS];
		const { db } = makeFakeDb(COLLECTIONS, members);
		expect(await requireMembership(db, COLL_A, BOB)).not.toBeNull();

		const i = members.findIndex((m) => m.collection_id === COLL_A && m.user_id === BOB);
		members.splice(i, 1);
		expect(await requireMembership(db, COLL_A, BOB)).toBeNull();
	});

	it('surfaces a dek_version mismatch rather than hiding it', async () => {
		// Member still holds a generation-1 wrapped key after a rotation to 2.
		const rotated: CollectionRec[] = [{ ...COLLECTIONS[0], dek_version: 2 }, COLLECTIONS[1]];
		const { db } = makeFakeDb(rotated, MEMBERS);
		const m = await requireMembership(db, COLL_A, BOB);
		expect(m?.memberDekVersion).toBe(1);
		expect(m?.collectionDekVersion).toBe(2);
	});

	it('rejects a malformed id without querying the database', async () => {
		const { db, calls } = makeFakeDb(COLLECTIONS, MEMBERS);
		expect(await requireMembership(db, "' OR 1=1 --", ALICE)).toBeNull();
		expect(await requireMembership(db, '', ALICE)).toBeNull();
		expect(calls).toHaveLength(0);
	});

	it('returns null for a membership row whose collection is gone', async () => {
		const { db } = makeFakeDb([], MEMBERS);
		expect(await requireMembership(db, COLL_A, ALICE)).toBeNull();
	});
});

describe('isEntitled', () => {
	it('is true for an entitled user and false otherwise', async () => {
		const { db } = makeFakeDb(COLLECTIONS, MEMBERS);
		expect(await isEntitled(db, ALICE)).toBe(true);
		expect(await isEntitled(db, BOB)).toBe(false);
	});
});

describe('invite tokens', () => {
	it('mints high-entropy, non-repeating tokens', async () => {
		const seen = new Set<string>();
		for (let i = 0; i < 200; i++) seen.add(makeInviteToken());
		expect(seen.size).toBe(200);
		// 24 bytes b64url, unpadded
		expect([...seen][0]).toMatch(/^[A-Za-z0-9_-]{32}$/);
	});

	it('hashes deterministically and does not return the token', async () => {
		const token = makeInviteToken();
		const a = await hashInviteToken(token);
		const b = await hashInviteToken(token);
		expect(a).toBe(b);
		expect(a).not.toBe(token);
		expect(a).not.toContain(token);
	});
});

describe('resolveInvite', () => {
	const TOKEN = 'test-token-value';
	const future = () => new Date(Date.now() + 86400_000).toISOString();
	const past = () => new Date(Date.now() - 86400_000).toISOString();

	function makeInviteFakeDb(row: Record<string, unknown> | null) {
		return {
			prepare() {
				return {
					bind() {
						return {
							async first<T>() {
								return (row as T) ?? null;
							}
						};
					}
				};
			}
		} as unknown as D1Database;
	}

	const base = {
		token_hash: 'hash',
		collection_id: COLL_A,
		created_by: ALICE,
		expires_at: future(),
		claimed_at: null,
		revoked_at: null,
		collection_name: 'Date night',
		inviter_email: 'alice@example.com',
		dek_version: 1
	};

	it('resolves a live invite', async () => {
		const r = await resolveInvite(makeInviteFakeDb(base), TOKEN);
		expect('invite' in r && r.invite.collection_id).toBe(COLL_A);
	});

	it('rejects an unknown token', async () => {
		const r = await resolveInvite(makeInviteFakeDb(null), TOKEN);
		expect(r).toEqual({ rejected: 'not_found' });
	});

	it('rejects an expired invite', async () => {
		const r = await resolveInvite(makeInviteFakeDb({ ...base, expires_at: past() }), TOKEN);
		expect(r).toEqual({ rejected: 'expired' });
	});

	it('rejects a revoked invite', async () => {
		const r = await resolveInvite(makeInviteFakeDb({ ...base, revoked_at: '2026-01-01' }), TOKEN);
		expect(r).toEqual({ rejected: 'revoked' });
	});

	it('rejects a claimed invite', async () => {
		const r = await resolveInvite(makeInviteFakeDb({ ...base, claimed_at: '2026-01-01' }), TOKEN);
		expect(r).toEqual({ rejected: 'claimed' });
	});

	// An owner revoking a link the recipient already used should be told it was
	// used, not that they revoked it — claimed is the more informative truth.
	it('reports claimed ahead of revoked when both are set', async () => {
		const r = await resolveInvite(
			makeInviteFakeDb({ ...base, claimed_at: '2026-01-01', revoked_at: '2026-01-02' }),
			TOKEN
		);
		expect(r).toEqual({ rejected: 'claimed' });
	});

	it('rejects malformed tokens without querying', async () => {
		for (const bad of ['', 'x'.repeat(65), null, undefined, 42]) {
			const r = await resolveInvite(makeInviteFakeDb(base), bad as string);
			expect(r).toEqual({ rejected: 'not_found' });
		}
	});
});
