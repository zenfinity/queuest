import type { RequestHandler } from './$types';
import { apiError, checkSameOrigin } from '$lib/server/api';
import { checkRateLimit } from '$lib/server/rate-limit';
import { requireMembership, purgeIfEmpty } from '$lib/server/collections';

const LEAVE_LIMIT = { max: 20, windowSeconds: 300 };

/**
 * A member leaves a shared list: removes the caller's own membership. Used
 * both when a member chooses Leave and after an owner deletes the list (the
 * member's client keeps the titles as a plain list first, then calls this).
 * The owner can't leave a live list (they delete it instead), because a list
 * with no owner couldn't be managed.
 *
 * No key rotation, unlike an owner removing someone: the leaver chose to go
 * and already holds everything they could see, and the server stops serving
 * them the blob as soon as the membership row is gone.
 */
export const DELETE: RequestHandler = async ({ request, params, platform, locals }) => {
	const originError = checkSameOrigin(request);
	if (originError) return originError;

	const user = locals.user;
	if (!user) return apiError(401, 'Sign in required');

	const db = platform?.env?.DB;
	if (!db) return apiError(503, 'Collections unavailable');

	const allowed = await checkRateLimit(
		`coll-leave:${user.id}`,
		LEAVE_LIMIT.max,
		LEAVE_LIMIT.windowSeconds
	);
	if (!allowed) return apiError(429, 'Too many requests');

	const membership = await requireMembership(db, params.id, user.id);
	if (!membership) return apiError(404, 'Not found');
	if (membership.role === 'owner' && !membership.deletedAt) {
		return apiError(400, 'The owner deletes the list instead of leaving it');
	}

	await db
		.prepare('DELETE FROM collection_members WHERE collection_id = ? AND user_id = ?')
		.bind(params.id, user.id)
		.run();
	const purged = membership.deletedAt ? await purgeIfEmpty(db, params.id) : false;

	return Response.json({ id: params.id, left: true, purged });
};
