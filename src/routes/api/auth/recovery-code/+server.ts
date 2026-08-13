import type { RequestHandler } from './$types';
import { apiError, checkSameOrigin } from '$lib/server/api';
import { hashAuthKey } from '$lib/server/auth';

const MAX_AUTH_KEY_LEN = 100;
const MAX_WRAPPED_DEK_LEN = 4096; // same headroom as signup — see that route's comment

/**
 * Stores the recovery-code credential generated at sync-enable (#102):
 * a hash of the recovery-code-derived auth key (same derivation and shape
 * as the passphrase's, in its own table so passphrase signin is untouched),
 * plus the DEK re-wrapped under the recovery code. Requires an active
 * session — this always runs as a follow-up step right after signup/signin,
 * never as a standalone credential-setting endpoint.
 */
export const POST: RequestHandler = async ({ request, platform, locals }) => {
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

	const { recoveryAuthKey, wrappedDek } = (body ?? {}) as Record<string, unknown>;
	if (
		typeof recoveryAuthKey !== 'string' ||
		!recoveryAuthKey ||
		recoveryAuthKey.length > MAX_AUTH_KEY_LEN
	) {
		return apiError(400, 'Invalid recovery auth key');
	}
	if (typeof wrappedDek !== 'string' || !wrappedDek || wrappedDek.length > MAX_WRAPPED_DEK_LEN) {
		return apiError(400, 'Invalid wrapped key');
	}

	const authKeyHash = await hashAuthKey(recoveryAuthKey);

	try {
		await db.batch([
			db
				.prepare(
					`INSERT INTO recovery_auth (user_id, auth_key_hash) VALUES (?, ?)
					 ON CONFLICT(user_id) DO UPDATE SET auth_key_hash = excluded.auth_key_hash`
				)
				.bind(user.id, authKeyHash),
			db
				.prepare(
					`INSERT INTO wrapped_dek (user_id, method, wrapped_key) VALUES (?, 'recovery', ?)
					 ON CONFLICT(user_id, method) DO UPDATE SET wrapped_key = excluded.wrapped_key`
				)
				.bind(user.id, wrappedDek)
		]);
	} catch {
		return apiError(500, 'Could not save recovery code');
	}

	return new Response(null, { status: 204 });
};
