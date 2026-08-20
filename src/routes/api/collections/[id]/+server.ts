import type { RequestHandler } from './$types';
import { apiError, checkSameOrigin } from '$lib/server/api';
import { checkRateLimit } from '$lib/server/rate-limit';
import { requireMembership } from '$lib/server/collections';

const MAX_NAME_LEN = 100;
const RENAME_LIMIT = { max: 20, windowSeconds: 300 };

/**
 * Renames a collection. Owner-only — the name is plaintext, shown to every
 * member and to an invite's unauthenticated preview, so letting any member
 * change what everyone else sees would be an odd asymmetry with every other
 * collection-level action (invite, remove member, promote) already being
 * owner-gated.
 */
export const PATCH: RequestHandler = async ({ request, params, platform, locals }) => {
	const originError = checkSameOrigin(request);
	if (originError) return originError;

	const user = locals.user;
	if (!user) return apiError(401, 'Sign in required');

	const db = platform?.env?.DB;
	const kv = platform?.env?.SHARE_KV;
	if (!db || !kv) return apiError(503, 'Collections unavailable');

	const allowed = await checkRateLimit(
		kv,
		`coll-rename:${user.id}`,
		RENAME_LIMIT.max,
		RENAME_LIMIT.windowSeconds
	);
	if (!allowed) return apiError(429, 'Too many requests');

	const membership = await requireMembership(db, params.id, user.id);
	if (!membership) return apiError(404, 'Not found');
	if (membership.role !== 'owner') return apiError(403, 'Only the owner can rename this list');

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return apiError(400, 'Invalid JSON');
	}

	const { name } = (body ?? {}) as Record<string, unknown>;
	const trimmedName = typeof name === 'string' ? name.trim() : '';
	if (!trimmedName || trimmedName.length > MAX_NAME_LEN) {
		return apiError(400, 'A list name is required');
	}

	await db
		.prepare('UPDATE collections SET name = ? WHERE id = ?')
		.bind(trimmedName, params.id)
		.run();

	return Response.json({ id: params.id, name: trimmedName });
};
