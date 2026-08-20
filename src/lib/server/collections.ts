import type { D1Database } from '@cloudflare/workers-types';

/**
 * Server-side authorisation and shared types for collaborative Collections
 * (#187). Every collection endpoint routes its access check through
 * `requireMembership` below — see the note there on why membership, not
 * merely authentication, is the check that matters.
 */

export type CollectionRole = 'owner' | 'member';

export interface CollectionMembership {
	collectionId: string;
	name: string;
	ownerUserId: string;
	role: CollectionRole;
	/** Which DEK generation this member's own wrapped_key unwraps. */
	memberDekVersion: number;
	/** The collection's current generation. A mismatch means the member must
	 *  re-fetch their wrapped key before it can decrypt the current blob. */
	collectionDekVersion: number;
}

interface MembershipRow {
	name: string;
	owner_user_id: string;
	role: CollectionRole;
	member_dek_version: number;
	collection_dek_version: number;
}

/** uuid v4 as produced by crypto.randomUUID(), which is what mints these ids. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isValidCollectionId(id: unknown): id is string {
	return typeof id === 'string' && UUID_RE.test(id);
}

/**
 * Resolves the caller's membership of one collection, or null if they have
 * none — where "none" deliberately covers three different situations:
 * the collection does not exist, it exists but the caller was never a member,
 * or it exists and the caller was removed.
 *
 * Callers MUST render all three identically (404, same body). Distinguishing
 * them turns this endpoint into an oracle for "does collection X exist", which
 * is exactly the leak a shared-object API invites: authenticating the caller
 * is the easy half, and checking that *this* caller belongs to *this*
 * collection is the half that gets skipped. A signed-in user is not
 * authorised for a collection id merely because they hold a valid session.
 *
 * Single query rather than "load collection, then check member" so there is no
 * intermediate state in which a handler has the collection in hand and could
 * accidentally act on it before the membership check runs.
 */
export async function requireMembership(
	db: D1Database,
	collectionId: string,
	userId: string
): Promise<CollectionMembership | null> {
	if (!isValidCollectionId(collectionId)) return null;

	const row = await db
		.prepare(
			`SELECT c.name              AS name,
			        c.owner_user_id     AS owner_user_id,
			        m.role              AS role,
			        m.dek_version       AS member_dek_version,
			        c.dek_version       AS collection_dek_version
			   FROM collection_members m
			   JOIN collections c ON c.id = m.collection_id
			  WHERE m.collection_id = ? AND m.user_id = ?`
		)
		.bind(collectionId, userId)
		.first<MembershipRow>();

	if (!row) return null;

	return {
		collectionId,
		name: row.name,
		ownerUserId: row.owner_user_id,
		role: row.role,
		memberDekVersion: row.member_dek_version,
		collectionDekVersion: row.collection_dek_version
	};
}

/**
 * Entitlement for collection *writes*. Mirrors the rule in api/sync/blob's
 * PUT: reads are never gated, because a lapsed subscription must not be
 * indistinguishable from data loss. Applied to a shared object this means an
 * unentitled member drops to read-only inside someone else's collection
 * rather than losing sight of it — decided on #187.
 *
 * Entitlement is per-account and per-action, so an entitled member keeps
 * writing even if the collection's owner has lapsed. Whether that is the
 * right product answer is revisited when billing (#104) is real.
 */
export async function isEntitled(db: D1Database, userId: string): Promise<boolean> {
	const row = await db
		.prepare(
			"SELECT id FROM users WHERE id = ? AND (entitled_until IS NULL OR entitled_until > datetime('now'))"
		)
		.bind(userId)
		.first<{ id: string }>();
	return !!row;
}
