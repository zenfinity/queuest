import type { RequestHandler } from './$types';
import { apiError, checkSameOrigin } from '$lib/server/api';
import { checkRateLimit } from '$lib/server/rate-limit';
import { resolveInvite, isEntitled, type InviteRejection } from '$lib/server/collections';

const MAX_WRAPPED_KEY_LEN = 1024;

const PREVIEW_LIMIT = { max: 30, windowSeconds: 300 };
const CLAIM_LIMIT = { max: 10, windowSeconds: 300 };

/**
 * Distinct, actionable messages rather than a flat 404 — see resolveInvite's
 * note on why differentiating is safe here but not for collection ids.
 */
const REJECTION: Record<InviteRejection, { status: number; message: string }> = {
	not_found: { status: 404, message: 'This invite link is not valid.' },
	expired: { status: 410, message: 'This invite has expired — ask for a new link.' },
	claimed: { status: 409, message: 'This invite has already been used — ask for a new link.' },
	revoked: { status: 410, message: 'This invite was revoked.' }
};

function reject(reason: InviteRejection): Response {
	const { status, message } = REJECTION[reason];
	return new Response(JSON.stringify({ error: message, reason }), {
		status,
		headers: { 'Content-Type': 'application/json' }
	});
}

/**
 * Preview for the confirm screen. Redemption is never automatic on link-open —
 * the user is always shown who invited them to what and asked to accept. That
 * confirm step is simultaneously the security control (no drive-by joins from
 * a link in a group chat) and the UX.
 *
 * Deliberately does not require a session: the invitee may not have an account
 * yet, and the confirm screen has to render before the signup flow starts.
 */
export const GET: RequestHandler = async ({ params, platform, getClientAddress }) => {
	const db = platform?.env?.DB;
	const kv = platform?.env?.SHARE_KV;
	if (!db || !kv) return apiError(503, 'Collections unavailable');

	// No session to key on for an unauthenticated preview, so throttle by IP —
	// this endpoint is otherwise an unauthenticated token-guessing oracle,
	// infeasible at 192 bits but not worth leaving uncapped.
	const allowed = await checkRateLimit(
		kv,
		`coll-inv-preview:${getClientAddress()}`,
		PREVIEW_LIMIT.max,
		PREVIEW_LIMIT.windowSeconds
	);
	if (!allowed) return apiError(429, 'Too many requests');

	const result = await resolveInvite(db, params.token);
	if ('rejected' in result) return reject(result.rejected);

	return Response.json({
		collectionName: result.invite.collection_name,
		// The inviter deliberately sent this link to this person, so surfacing
		// who it came from is expected rather than a leak. Holding the token is
		// the evidence of that.
		invitedBy: result.invite.inviter_email,
		expiresAt: result.invite.expires_at
	});
};

/**
 * Redeems an invite. The Collection DEK never passes through here: the client
 * reads it from the URL fragment, wraps it under its own personal sync DEK,
 * and posts only the wrapped copy — the same shape as signup's wrappedDek.
 */
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
		`coll-inv-claim:${user.id}`,
		CLAIM_LIMIT.max,
		CLAIM_LIMIT.windowSeconds
	);
	if (!allowed) return apiError(429, 'Too many requests');

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return apiError(400, 'Invalid JSON');
	}
	const { wrappedKey } = (body ?? {}) as Record<string, unknown>;
	if (typeof wrappedKey !== 'string' || !wrappedKey || wrappedKey.length > MAX_WRAPPED_KEY_LEN) {
		return apiError(400, 'Invalid wrapped key');
	}

	const result = await resolveInvite(db, params.token);
	if ('rejected' in result) return reject(result.rejected);
	const invite = result.invite;

	if (!(await isEntitled(db, user.id))) {
		return apiError(402, 'Joining a collection requires an active subscription');
	}

	// Already a member: succeed without consuming the invite. Re-opening a
	// link you already accepted should be a no-op, not an error, and must not
	// burn a single-use token that someone else may still need.
	const existing = await db
		.prepare('SELECT user_id FROM collection_members WHERE collection_id = ? AND user_id = ?')
		.bind(invite.collection_id, user.id)
		.first<{ user_id: string }>();
	if (existing) {
		return Response.json({ collectionId: invite.collection_id, alreadyMember: true });
	}

	// Both statements batched: a membership row without the invite being marked
	// claimed would leave a single-use link reusable, and marking it claimed
	// without the membership row would burn the invite for nothing.
	//
	// The claim is conditional on the invite still being unclaimed, so two
	// concurrent redemptions of the same link cannot both succeed — the loser's
	// UPDATE matches no row.
	const claimed = await db
		.prepare(
			`UPDATE collection_invites
			    SET claimed_at = datetime('now'), claimed_by = ?
			  WHERE token_hash = ?
			    AND claimed_at IS NULL
			    AND revoked_at IS NULL
			 RETURNING token_hash`
		)
		.bind(user.id, invite.token_hash)
		.first<{ token_hash: string }>();

	if (!claimed) return reject('claimed');

	await db
		.prepare(
			`INSERT INTO collection_members (collection_id, user_id, wrapped_key, dek_version, role)
			 VALUES (?, ?, ?, ?, 'member')`
		)
		.bind(invite.collection_id, user.id, wrappedKey, invite.dek_version)
		.run();

	return Response.json(
		{
			collectionId: invite.collection_id,
			collectionName: invite.collection_name,
			dekVersion: invite.dek_version
		},
		{ status: 201 }
	);
};
