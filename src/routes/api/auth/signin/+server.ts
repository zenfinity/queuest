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
const GENERIC_ERROR = 'Invalid email or passphrase';

interface UserRow {
	id: string;
	email: string;
	auth_key_hash: string;
}

interface WrappedDekRow {
	wrapped_key: string;
}

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

	const { email, authKey } = (body ?? {}) as Record<string, unknown>;
	if (typeof email !== 'string') return apiError(401, GENERIC_ERROR);
	const normalizedEmail = normalizeEmail(email);
	if (!isValidEmail(normalizedEmail)) return apiError(401, GENERIC_ERROR);
	if (typeof authKey !== 'string' || !authKey || authKey.length > MAX_AUTH_KEY_LEN) {
		return apiError(401, GENERIC_ERROR);
	}

	const user = await db
		.prepare('SELECT id, email, auth_key_hash FROM users WHERE email = ?')
		.bind(normalizedEmail)
		.first<UserRow>();

	const providedHash = await hashAuthKey(authKey);
	// Always hash and compare, even for a nonexistent user — comparing against
	// a fixed dummy hash keeps this branch's timing close to the real one,
	// rather than returning immediately and giving an attacker a timing
	// signal for which emails have accounts.
	const storedHash = user?.auth_key_hash ?? (await hashAuthKey('dummy'));
	const matches = constantTimeEqual(providedHash, storedHash);

	if (!user || !matches) return apiError(401, GENERIC_ERROR);

	const wrappedDekRow = await db
		.prepare("SELECT wrapped_key FROM wrapped_dek WHERE user_id = ? AND method = 'passphrase'")
		.bind(user.id)
		.first<WrappedDekRow>();

	const token = await createSession(kv, { userId: user.id, email: user.email });
	cookies.set(SESSION_COOKIE, token, sessionCookieOptions());

	return Response.json({
		email: user.email,
		wrappedDek: wrappedDekRow?.wrapped_key ?? null
	});
};
