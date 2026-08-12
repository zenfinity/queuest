import type { RequestHandler } from './$types';
import { apiError, checkSameOrigin } from '$lib/server/api';
import {
	hashAuthKey,
	createSession,
	sessionCookieOptions,
	isValidEmail,
	SESSION_COOKIE
} from '$lib/server/auth';
import { normalizeEmail } from '$lib/auth-crypto';

const MAX_AUTH_KEY_LEN = 100;
const MAX_WRAPPED_DEK_LEN = 4096; // encrypt()'s wire format (salt+iv+AES-GCM(32-byte DEK)) is a few hundred bytes; generous headroom

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

	const { email, authKey, wrappedDek } = (body ?? {}) as Record<string, unknown>;

	if (typeof email !== 'string') return apiError(400, 'A valid email is required');
	const normalizedEmail = normalizeEmail(email);
	if (!isValidEmail(normalizedEmail)) return apiError(400, 'A valid email is required');
	if (typeof authKey !== 'string' || !authKey || authKey.length > MAX_AUTH_KEY_LEN) {
		return apiError(400, 'Invalid auth key');
	}
	if (typeof wrappedDek !== 'string' || !wrappedDek || wrappedDek.length > MAX_WRAPPED_DEK_LEN) {
		return apiError(400, 'Invalid wrapped key');
	}

	const userId = crypto.randomUUID();
	const authKeyHash = await hashAuthKey(authKey);
	// Stored for schema completeness / future methods; not needed to verify
	// signin (the server independently recomputes it from the email, same as
	// the client does — see auth-crypto.ts). Not secret, so a placeholder
	// derived value is fine here rather than re-deriving with WebCrypto.
	const salt = normalizedEmail;

	try {
		await db.batch([
			db
				.prepare('INSERT INTO users (id, email, auth_key_hash, salt) VALUES (?, ?, ?, ?)')
				.bind(userId, normalizedEmail, authKeyHash, salt),
			db
				.prepare(
					"INSERT INTO wrapped_dek (user_id, method, wrapped_key) VALUES (?, 'passphrase', ?)"
				)
				.bind(userId, wrappedDek)
		]);
	} catch (e) {
		const message = e instanceof Error ? e.message : '';
		if (message.includes('UNIQUE')) {
			return apiError(409, 'An account with this email already exists');
		}
		return apiError(500, 'Could not create account');
	}

	const token = await createSession(kv, { userId, email: normalizedEmail });
	cookies.set(SESSION_COOKIE, token, sessionCookieOptions());

	return Response.json({ email: normalizedEmail });
};
