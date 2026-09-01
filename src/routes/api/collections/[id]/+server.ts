import type { RequestHandler } from './$types';
import { apiError, checkSameOrigin } from '$lib/server/api';
import { checkRateLimit } from '$lib/server/rate-limit';
import { requireMembership } from '$lib/server/collections';

const MAX_NAME_LEN = 100;
const RENAME_LIMIT = { max: 20, windowSeconds: 300 };
const HEX_COLOR_RE = /^#[0-9a-f]{6}$/i;

/**
 * Renames and/or recolors a collection. Owner-only for both — the name and
 * color are shown to every member (the name to an invite's unauthenticated
 * preview too), so letting any member change what everyone else sees would
 * be an odd asymmetry with every other collection-level action (invite,
 * remove member, promote) already being owner-gated. Color synced here
 * (#237) rather than living in per-device localStorage the way it used to,
 * which is why a manual pick never used to reach a member's other devices.
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

	const { name, color } = (body ?? {}) as Record<string, unknown>;
	const hasName = name !== undefined;
	const hasColor = color !== undefined;
	if (!hasName && !hasColor) {
		return apiError(400, 'Nothing to update');
	}

	const sets: string[] = [];
	const args: string[] = [];
	const responseBody: Record<string, string> = { id: params.id };

	if (hasName) {
		const trimmedName = typeof name === 'string' ? name.trim() : '';
		if (!trimmedName || trimmedName.length > MAX_NAME_LEN) {
			return apiError(400, 'A list name is required');
		}
		sets.push('name = ?');
		args.push(trimmedName);
		responseBody.name = trimmedName;
	}

	if (hasColor) {
		if (typeof color !== 'string' || !HEX_COLOR_RE.test(color)) {
			return apiError(400, 'Invalid color');
		}
		sets.push('color = ?');
		args.push(color);
		responseBody.color = color;
	}

	await db
		.prepare(`UPDATE collections SET ${sets.join(', ')} WHERE id = ?`)
		.bind(...args, params.id)
		.run();

	return Response.json(responseBody);
};
