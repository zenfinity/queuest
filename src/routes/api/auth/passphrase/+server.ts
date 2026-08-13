import type { RequestHandler } from './$types';
import { apiError, checkSameOrigin } from '$lib/server/api';
import { hashAuthKey } from '$lib/server/auth';

const MAX_AUTH_KEY_LEN = 100;
const MAX_WRAPPED_DEK_LEN = 4096;

/**
 * Sets (or replaces) the passphrase credential for the signed-in user (#102).
 * Used both for an ordinary "change my passphrase" and — the reason this
 * exists at all — as the required last step of the recovery flow: after
 * signing in with a recovery code, the old passphrase is by definition the
 * one the user just proved they've forgotten, so they need a new one before
 * recovery is actually finished.
 *
 * The client does all the crypto: derive the new authKey, re-wrap the same
 * DEK under the new passphrase. This endpoint only ever sees ciphertext and
 * a hash, same as every other auth route.
 */
export const PUT: RequestHandler = async ({ request, platform, locals }) => {
	const originError = checkSameOrigin(request);
	if (originError) return originError;

	const user = locals.user;
	if (!user) return apiError(401, 'Sign in required');

	const db = platform?.env?.DB;
	if (!db) return apiError(503, 'Sync unavailable');

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return apiError(400, 'Invalid JSON');
	}

	const { authKey, wrappedDek } = (body ?? {}) as Record<string, unknown>;
	if (typeof authKey !== 'string' || !authKey || authKey.length > MAX_AUTH_KEY_LEN) {
		return apiError(400, 'Invalid auth key');
	}
	if (typeof wrappedDek !== 'string' || !wrappedDek || wrappedDek.length > MAX_WRAPPED_DEK_LEN) {
		return apiError(400, 'Invalid wrapped key');
	}

	const authKeyHash = await hashAuthKey(authKey);

	try {
		await db.batch([
			db.prepare('UPDATE users SET auth_key_hash = ? WHERE id = ?').bind(authKeyHash, user.id),
			db
				.prepare(
					`INSERT INTO wrapped_dek (user_id, method, wrapped_key) VALUES (?, 'passphrase', ?)
					 ON CONFLICT(user_id, method) DO UPDATE SET wrapped_key = excluded.wrapped_key`
				)
				.bind(user.id, wrappedDek)
		]);
	} catch {
		return apiError(500, 'Could not update passphrase');
	}

	return new Response(null, { status: 204 });
};
