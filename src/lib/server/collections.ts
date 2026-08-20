import type { D1Database } from '@cloudflare/workers-types';
import { b64urlEncode } from '$lib/base64url';

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

// ── Invites ────────────────────────────────────────────────────────────────

/**
 * An invite link is a *bearer credential that carries key material* — the
 * Collection DEK travels in the URL fragment, so whoever holds the link holds
 * the key itself, not merely permission to ask for it. That is a higher bar
 * than a plain bearer token, and it is why invites are single-use, revocable,
 * and expiring rather than any one of the three.
 *
 * 24 bytes (192 bits) of CSPRNG output, b64url — same construction as session
 * and share tokens.
 */
const INVITE_TOKEN_BYTES = 24;

/** Rejects obviously malformed tokens before they reach the database. */
export const MAX_INVITE_TOKEN_LEN = 64;

export function makeInviteToken(): string {
	return b64urlEncode(crypto.getRandomValues(new Uint8Array(INVITE_TOKEN_BYTES)));
}

/**
 * Only the hash is stored, so a leaked database snapshot yields no working
 * invite links — the same reasoning as storing auth key hashes rather than
 * auth keys. It also means the raw token can be shown exactly once, at
 * creation, and never recovered afterwards.
 */
export async function hashInviteToken(token: string): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
	return b64urlEncode(new Uint8Array(digest) as Uint8Array<ArrayBuffer>);
}

export type InviteRejection = 'not_found' | 'expired' | 'claimed' | 'revoked';

export interface InviteRow {
	token_hash: string;
	collection_id: string;
	created_by: string;
	expires_at: string;
	claimed_at: string | null;
	revoked_at: string | null;
	collection_name: string;
	inviter_email: string;
	dek_version: number;
}

/**
 * Resolves an invite token to its collection, or a reason it cannot be used.
 *
 * Unlike collection ids, the distinct rejection reasons here are deliberately
 * surfaced to the caller: someone holding an invite token was given it, and
 * "this link already got used — ask for a new one" is a materially better
 * outcome than an undifferentiated 404. The token itself is the credential,
 * and a wrong guess is infeasible at 192 bits, so distinguishing states leaks
 * nothing an attacker could act on.
 */
export async function resolveInvite(
	db: D1Database,
	token: string
): Promise<{ invite: InviteRow } | { rejected: InviteRejection }> {
	if (typeof token !== 'string' || !token || token.length > MAX_INVITE_TOKEN_LEN) {
		return { rejected: 'not_found' };
	}

	const tokenHash = await hashInviteToken(token);
	const row = await db
		.prepare(
			`SELECT i.token_hash    AS token_hash,
			        i.collection_id AS collection_id,
			        i.created_by    AS created_by,
			        i.expires_at    AS expires_at,
			        i.claimed_at    AS claimed_at,
			        i.revoked_at    AS revoked_at,
			        c.name          AS collection_name,
			        c.dek_version   AS dek_version,
			        u.email         AS inviter_email
			   FROM collection_invites i
			   JOIN collections c ON c.id = i.collection_id
			   JOIN users u       ON u.id = i.created_by
			  WHERE i.token_hash = ?`
		)
		.bind(tokenHash)
		.first<InviteRow>();

	if (!row) return { rejected: 'not_found' };
	// Revoked before claimed: an owner who revokes a link the recipient has
	// already used should be told it was used, not that they revoked it.
	if (row.claimed_at) return { rejected: 'claimed' };
	if (row.revoked_at) return { rejected: 'revoked' };
	if (new Date(row.expires_at).getTime() <= Date.now()) return { rejected: 'expired' };

	return { invite: row };
}
