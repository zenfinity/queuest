import type { RequestHandler } from './$types';
import { apiError, checkSameOrigin } from '$lib/server/api';
import {
	hashAuthKey,
	constantTimeEqual,
	createSession,
	sessionCookieOptions,
	isValidEmail,
	SESSION_COOKIE
} from '$lib/server/auth';
import { normalizeEmail } from '$lib/auth-crypto';

const MAX_AUTH_KEY_LEN = 100;
const GENERIC_ERROR = 'Invalid email or recovery code';

interface UserRow {
	id: string;
	email: string;
}

interface RecoveryAuthRow {
	auth_key_hash: string;
}

interface WrappedDekRow {
	wrapped_key: string;
}

/**
 * Signin via recovery code instead of passphrase (#102) — the whole reason
 * this is a real fallback and not just a decorative "wrap the DEK a second
 * time": someone who's forgotten their passphrase can't derive the normal
 * authKey at all, so recovery has to be a fully independent credential that
 * proves knowledge of the code and, on success, issues a session exactly
 * like passphrase signin does.
 */
export const POST: RequestHandler = async ({ request, platform, cookies }) => {
	const originError = checkSameOrigin(request);
	if (originError) return originError;

	const db = platform?.env?.DB;
	const kv = platform?.env?.SHARE_KV;
	if (!db || !kv) return apiError(503, 'Sync unavailable');

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return apiError(400, 'Invalid JSON');
	}

	const { email, recoveryAuthKey } = (body ?? {}) as Record<string, unknown>;
	if (typeof email !== 'string') return apiError(401, GENERIC_ERROR);
	const normalizedEmail = normalizeEmail(email);
	if (!isValidEmail(normalizedEmail)) return apiError(401, GENERIC_ERROR);
	if (
		typeof recoveryAuthKey !== 'string' ||
		!recoveryAuthKey ||
		recoveryAuthKey.length > MAX_AUTH_KEY_LEN
	) {
		return apiError(401, GENERIC_ERROR);
	}

	const user = await db
		.prepare('SELECT id, email FROM users WHERE email = ?')
		.bind(normalizedEmail)
		.first<UserRow>();

	const recoveryRow = user
		? await db
				.prepare('SELECT auth_key_hash FROM recovery_auth WHERE user_id = ?')
				.bind(user.id)
				.first<RecoveryAuthRow>()
		: null;

	const providedHash = await hashAuthKey(recoveryAuthKey);
	// Same timing-uniformity reasoning as signin: always hash and compare
	// against something, even when the user or the recovery row don't exist.
	const storedHash = recoveryRow?.auth_key_hash ?? (await hashAuthKey('dummy'));
	const matches = constantTimeEqual(providedHash, storedHash);

	if (!user || !recoveryRow || !matches) return apiError(401, GENERIC_ERROR);

	const wrappedDekRow = await db
		.prepare("SELECT wrapped_key FROM wrapped_dek WHERE user_id = ? AND method = 'recovery'")
		.bind(user.id)
		.first<WrappedDekRow>();

	const token = await createSession(kv, { userId: user.id, email: user.email });
	cookies.set(SESSION_COOKIE, token, sessionCookieOptions());

	return Response.json({
		email: user.email,
		wrappedDek: wrappedDekRow?.wrapped_key ?? null
	});
};
