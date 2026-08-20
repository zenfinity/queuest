import type { RequestHandler } from './$types';
import { apiError, checkSameOrigin } from '$lib/server/api';
import { checkRateLimit } from '$lib/server/rate-limit';
import { requireMembership, isEntitled } from '$lib/server/collections';

const LIST_LIMIT = { max: 60, windowSeconds: 300 };
const ROTATE_LIMIT = { max: 10, windowSeconds: 300 };

interface MemberRow {
	user_id: string;
	email: string;
	role: 'owner' | 'member';
	dek_version: number;
	public_key: string | null;
	created_at: string;
}

/**
 * The collection's members, each with their public key — which is what makes
 * a rotation possible: the rotating client wraps the new DEK under each
 * remaining member's public key without holding any of their secrets.
 *
 * Members-only. Emails of fellow members are visible to each other, which is
 * inherent to a feature whose whole point is knowing who you are sharing with.
 */
export const GET: RequestHandler = async ({ params, platform, locals }) => {
	const user = locals.user;
	if (!user) return apiError(401, 'Sign in required');

	const db = platform?.env?.DB;
	const kv = platform?.env?.SHARE_KV;
	if (!db || !kv) return apiError(503, 'Collections unavailable');

	const allowed = await checkRateLimit(
		kv,
		`coll-members:${user.id}`,
		LIST_LIMIT.max,
		LIST_LIMIT.windowSeconds
	);
	if (!allowed) return apiError(429, 'Too many requests');

	const membership = await requireMembership(db, params.id, user.id);
	if (!membership) return apiError(404, 'Not found');

	const { results } = await db
		.prepare(
			`SELECT m.user_id     AS user_id,
			        u.email       AS email,
			        m.role        AS role,
			        m.dek_version AS dek_version,
			        k.public_key  AS public_key,
			        m.created_at  AS created_at
			   FROM collection_members m
			   JOIN users u      ON u.id = m.user_id
			   LEFT JOIN user_keys k ON k.user_id = m.user_id
			  WHERE m.collection_id = ?
			  ORDER BY m.created_at ASC`
		)
		.bind(params.id)
		.all<MemberRow>();

	const rows: MemberRow[] = results ?? [];

	return Response.json({
		members: rows.map((r) => ({
			userId: r.user_id,
			email: r.email,
			role: r.role,
			dekVersion: r.dek_version,
			// Null for an account that predates keypairs and has not signed in
			// to backfill one. Such a member cannot be re-keyed, so a rotation
			// must refuse rather than silently drop them — see DELETE below.
			publicKey: r.public_key,
			joinedAt: r.created_at
		}))
	});
};

interface RemovalBody {
	userId?: unknown;
	blob?: unknown;
	wrappedKeys?: unknown;
}

/**
 * Removes a member and rotates the Collection DEK in one server-side step.
 *
 * Deleting the member's row alone revokes nothing: symmetric group keys have
 * no partial revocation, and a removed member may have kept the raw DEK. So
 * removal means rotation — a new DEK, the blob re-encrypted under it, and a
 * fresh wrapped key for everyone who remains.
 *
 * The client does the cryptography (fetch members, generate a DEK, re-encrypt
 * the blob, wrap the new DEK under each remaining member's public key) and
 * posts the finished result here. This endpoint's job is to apply all of it
 * atomically, which is what closes the lockout hole: previously the re-encrypt
 * happened on one device while the wrapped rows lived in D1, so a closed tab
 * mid-rotation could leave the blob under a DEK that some remaining members
 * had no wrapped key for — locked out, unrecoverably, because no client could
 * still produce that DEK. A single batch cannot half-apply.
 */
export const DELETE: RequestHandler = async ({ request, params, platform, locals }) => {
	const originError = checkSameOrigin(request);
	if (originError) return originError;

	const user = locals.user;
	if (!user) return apiError(401, 'Sign in required');

	const db = platform?.env?.DB;
	const kv = platform?.env?.SHARE_KV;
	if (!db || !kv) return apiError(503, 'Collections unavailable');

	const allowed = await checkRateLimit(
		kv,
		`coll-rotate:${user.id}`,
		ROTATE_LIMIT.max,
		ROTATE_LIMIT.windowSeconds
	);
	if (!allowed) return apiError(429, 'Too many requests');

	const membership = await requireMembership(db, params.id, user.id);
	if (!membership) return apiError(404, 'Not found');
	if (membership.role !== 'owner') return apiError(403, 'Only the owner can remove members');
	if (!(await isEntitled(db, user.id))) {
		return apiError(402, 'Managing members requires an active subscription');
	}

	let body: RemovalBody;
	try {
		body = (await request.json()) as RemovalBody;
	} catch {
		return apiError(400, 'Invalid JSON');
	}

	const { userId, blob, wrappedKeys } = body;
	if (typeof userId !== 'string' || !userId) return apiError(400, 'Invalid member');
	if (userId === user.id) return apiError(400, 'The owner cannot remove themselves');
	if (typeof blob !== 'string' || !blob) return apiError(400, 'Invalid re-encrypted blob');
	if (!wrappedKeys || typeof wrappedKeys !== 'object' || Array.isArray(wrappedKeys)) {
		return apiError(400, 'Invalid wrapped keys');
	}
	const keys = wrappedKeys as Record<string, unknown>;

	const current = await db
		.prepare('SELECT user_id FROM collection_members WHERE collection_id = ?')
		.bind(params.id)
		.all<{ user_id: string }>();
	const memberRows: { user_id: string }[] = current.results ?? [];
	const memberIds: string[] = memberRows.map((r) => r.user_id);

	if (!memberIds.includes(userId)) return apiError(404, 'Not a member');

	const remaining = memberIds.filter((id) => id !== userId);

	// Every remaining member must be re-keyed in this same operation. Accepting
	// a partial set is the lockout bug in a different costume: whoever was
	// omitted would hold a wrapped key for a generation the blob no longer
	// uses, and nobody could ever mint them a new one.
	const missing = remaining.filter((id) => typeof keys[id] !== 'string' || !keys[id]);
	if (missing.length) {
		return apiError(400, `Missing wrapped keys for ${missing.length} remaining member(s)`);
	}
	const extra = Object.keys(keys).filter((id) => !remaining.includes(id));
	if (extra.length) return apiError(400, 'Wrapped keys supplied for non-members');

	const nextVersion = membership.collectionDekVersion + 1;

	// One batch: the blob, every remaining member's re-wrapped key, the
	// collection's generation counter, and the removal itself either all land
	// or none do.
	await db.batch([
		db.prepare('UPDATE collections SET dek_version = ? WHERE id = ?').bind(nextVersion, params.id),
		...remaining.map((id) =>
			db
				.prepare(
					'UPDATE collection_members SET wrapped_key = ?, dek_version = ? WHERE collection_id = ? AND user_id = ?'
				)
				.bind(keys[id] as string, nextVersion, params.id, id)
		),
		db
			.prepare(
				`INSERT INTO collection_blobs (collection_id, blob, version, dek_version)
				 VALUES (?, ?, 1, ?)
				 ON CONFLICT(collection_id) DO UPDATE SET
				   blob = excluded.blob,
				   version = collection_blobs.version + 1,
				   dek_version = excluded.dek_version,
				   updated_at = datetime('now')`
			)
			.bind(params.id, blob, nextVersion),
		db
			.prepare('DELETE FROM collection_members WHERE collection_id = ? AND user_id = ?')
			.bind(params.id, userId),
		// Outstanding invites were minted against the old key and would hand a
		// new joiner a DEK that no longer opens anything.
		db
			.prepare(
				`UPDATE collection_invites SET revoked_at = datetime('now')
				  WHERE collection_id = ? AND claimed_at IS NULL AND revoked_at IS NULL`
			)
			.bind(params.id)
	]);

	return Response.json({ removed: userId, dekVersion: nextVersion });
};
