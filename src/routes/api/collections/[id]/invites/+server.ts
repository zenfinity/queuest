import type { RequestHandler } from './$types';
import { apiError, checkSameOrigin } from '$lib/server/api';
import { checkRateLimit } from '$lib/server/rate-limit';
import {
	requireMembership,
	isEntitled,
	makeInviteToken,
	hashInviteToken,
	MAX_INVITE_TOKEN_LEN
} from '$lib/server/collections';

const INVITE_TTL_DAYS = 7;

// Throttled per account rather than per target: unlike a password reset there
// is no recipient address to rate-limit against, so the only meaningful
// subject is the inviter.
const CREATE_LIMIT = { max: 10, windowSeconds: 300 };
const LIST_LIMIT = { max: 60, windowSeconds: 300 };
const REVOKE_LIMIT = { max: 30, windowSeconds: 300 };

interface OutstandingInviteRow {
	token_hash: string;
	created_at: string;
	expires_at: string;
}

/** Outstanding (unclaimed, unrevoked, unexpired) invites, for the revoke UI. */
export const GET: RequestHandler = async ({ params, platform, locals }) => {
	const user = locals.user;
	if (!user) return apiError(401, 'Sign in required');

	const db = platform?.env?.DB;
	const kv = platform?.env?.SHARE_KV;
	if (!db || !kv) return apiError(503, 'Collections unavailable');

	const allowed = await checkRateLimit(
		kv,
		`coll-inv-list:${user.id}`,
		LIST_LIMIT.max,
		LIST_LIMIT.windowSeconds
	);
	if (!allowed) return apiError(429, 'Too many requests');

	const membership = await requireMembership(db, params.id, user.id);
	if (!membership) return apiError(404, 'Not found');
	if (membership.role !== 'owner') return apiError(403, 'Only the owner can manage invites');

	const { results } = await db
		.prepare(
			`SELECT token_hash, created_at, expires_at
			   FROM collection_invites
			  WHERE collection_id = ?
			    AND claimed_at IS NULL
			    AND revoked_at IS NULL
			    AND expires_at > datetime('now')
			  ORDER BY created_at DESC`
		)
		.bind(params.id)
		.all<OutstandingInviteRow>();

	const rows: OutstandingInviteRow[] = results ?? [];

	return Response.json({
		// The raw token is unrecoverable by design — only its hash was stored,
		// so a link can be shown exactly once, at creation. The hash doubles as
		// the handle for revocation; it is not a credential, since redeeming
		// requires the preimage.
		invites: rows.map((r) => ({
			id: r.token_hash,
			createdAt: r.created_at,
			expiresAt: r.expires_at
		}))
	});
};

/** Mints an invite. The returned token is shown once and never stored raw. */
export const POST: RequestHandler = async ({ request, params, platform, locals }) => {
	const originError = checkSameOrigin(request);
	if (originError) return originError;

	const user = locals.user;
	if (!user) return apiError(401, 'Sign in required');

	const db = platform?.env?.DB;
	const kv = platform?.env?.SHARE_KV;
	if (!db || !kv) return apiError(503, 'Collections unavailable');

	const allowed = await checkRateLimit(
		kv,
		`coll-inv-create:${user.id}`,
		CREATE_LIMIT.max,
		CREATE_LIMIT.windowSeconds
	);
	if (!allowed) return apiError(429, 'Too many requests');

	// Membership before entitlement, so a non-member never receives a 402 that
	// would confirm the collection exists.
	const membership = await requireMembership(db, params.id, user.id);
	if (!membership) return apiError(404, 'Not found');
	// Conservative default: only the owner can widen the group. Relaxing this
	// to any member later is a one-line change; tightening it after people
	// rely on it is not.
	if (membership.role !== 'owner') return apiError(403, 'Only the owner can invite');

	if (!(await isEntitled(db, user.id))) {
		return apiError(402, 'Inviting requires an active subscription');
	}

	const token = makeInviteToken();
	const tokenHash = await hashInviteToken(token);
	const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 86400_000).toISOString();

	await db
		.prepare(
			`INSERT INTO collection_invites (token_hash, collection_id, created_by, expires_at)
			 VALUES (?, ?, ?, ?)`
		)
		.bind(tokenHash, params.id, user.id, expiresAt)
		.run();

	return Response.json({ token, id: tokenHash, expiresAt }, { status: 201 });
};

/** Revokes an outstanding invite. */
export const DELETE: RequestHandler = async ({ request, params, url, platform, locals }) => {
	const originError = checkSameOrigin(request);
	if (originError) return originError;

	const user = locals.user;
	if (!user) return apiError(401, 'Sign in required');

	const db = platform?.env?.DB;
	const kv = platform?.env?.SHARE_KV;
	if (!db || !kv) return apiError(503, 'Collections unavailable');

	const allowed = await checkRateLimit(
		kv,
		`coll-inv-revoke:${user.id}`,
		REVOKE_LIMIT.max,
		REVOKE_LIMIT.windowSeconds
	);
	if (!allowed) return apiError(429, 'Too many requests');

	const membership = await requireMembership(db, params.id, user.id);
	if (!membership) return apiError(404, 'Not found');
	if (membership.role !== 'owner') return apiError(403, 'Only the owner can manage invites');

	const inviteId = url.searchParams.get('id') ?? '';
	if (!inviteId || inviteId.length > MAX_INVITE_TOKEN_LEN) {
		return apiError(400, 'Missing or invalid invite id');
	}

	// Scoped to this collection as well as the id, so an owner of collection A
	// cannot revoke an invite belonging to collection B by guessing its handle.
	const result = await db
		.prepare(
			`UPDATE collection_invites
			    SET revoked_at = datetime('now')
			  WHERE token_hash = ?
			    AND collection_id = ?
			    AND claimed_at IS NULL
			    AND revoked_at IS NULL
			 RETURNING token_hash`
		)
		.bind(inviteId, params.id)
		.first<{ token_hash: string }>();

	if (!result) return apiError(404, 'Not found');

	return Response.json({ revoked: true });
};
