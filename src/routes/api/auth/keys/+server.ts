import type { RequestHandler } from './$types';
import { apiError, checkSameOrigin } from '$lib/server/api';
import { checkRateLimit } from '$lib/server/rate-limit';

const MAX_PUBLIC_KEY_LEN = 1024; // SPKI for RSA-2048 is ~400 b64url chars
const MAX_WRAPPED_PRIVATE_KEY_LEN = 4096; // PKCS8 ~1.2 KB raw, plus AES-GCM framing

const GET_LIMIT = { max: 60, windowSeconds: 300 };
const PUT_LIMIT = { max: 10, windowSeconds: 300 };

interface KeyRow {
	public_key: string;
	wrapped_private_key: string;
	algorithm: string;
}

/**
 * The caller's own keypair. The private key comes back still wrapped under
 * their personal sync DEK — the server has never seen it unwrapped and cannot
 * unwrap it. Fetched on sign-in so the keypair follows the account to a new
 * device without the user copying anything by hand.
 */
export const GET: RequestHandler = async ({ platform, locals }) => {
	const user = locals.user;
	if (!user) return apiError(401, 'Sign in required');

	const db = platform?.env?.DB;
	const kv = platform?.env?.SHARE_KV;
	if (!db || !kv) return apiError(503, 'Sync unavailable');

	const allowed = await checkRateLimit(
		kv,
		`keys-get:${user.id}`,
		GET_LIMIT.max,
		GET_LIMIT.windowSeconds
	);
	if (!allowed) return apiError(429, 'Too many requests');

	const row = await db
		.prepare('SELECT public_key, wrapped_private_key, algorithm FROM user_keys WHERE user_id = ?')
		.bind(user.id)
		.first<KeyRow>();

	// 200 with a null keypair rather than 404: "this account predates keypairs"
	// is a normal state the client backfills, not an error.
	if (!row) return Response.json({ keypair: null });

	return Response.json({
		keypair: {
			publicKey: row.public_key,
			wrappedPrivateKey: row.wrapped_private_key,
			algorithm: row.algorithm
		}
	});
};

/**
 * Stores a keypair for an account that has none. Deliberately create-only:
 * replacing a keypair would silently orphan every collection key already
 * wrapped under the old public key, turning a stray call into unrecoverable
 * loss of access. Re-keying, if it is ever needed, has to re-wrap those first
 * and so belongs in its own deliberate flow.
 */
export const POST: RequestHandler = async ({ request, platform, locals }) => {
	const originError = checkSameOrigin(request);
	if (originError) return originError;

	const user = locals.user;
	if (!user) return apiError(401, 'Sign in required');

	const db = platform?.env?.DB;
	const kv = platform?.env?.SHARE_KV;
	if (!db || !kv) return apiError(503, 'Sync unavailable');

	const allowed = await checkRateLimit(
		kv,
		`keys-put:${user.id}`,
		PUT_LIMIT.max,
		PUT_LIMIT.windowSeconds
	);
	if (!allowed) return apiError(429, 'Too many requests');

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return apiError(400, 'Invalid JSON');
	}
	const { publicKey, wrappedPrivateKey, algorithm } = (body ?? {}) as Record<string, unknown>;

	if (typeof publicKey !== 'string' || !publicKey || publicKey.length > MAX_PUBLIC_KEY_LEN) {
		return apiError(400, 'Invalid public key');
	}
	if (
		typeof wrappedPrivateKey !== 'string' ||
		!wrappedPrivateKey ||
		wrappedPrivateKey.length > MAX_WRAPPED_PRIVATE_KEY_LEN
	) {
		return apiError(400, 'Invalid wrapped private key');
	}
	const alg = typeof algorithm === 'string' && algorithm ? algorithm : 'RSA-OAEP-2048-SHA256';
	if (alg.length > 64) return apiError(400, 'Invalid algorithm');

	// DO NOTHING on conflict, then read back: two devices racing to backfill
	// the same account both succeed, and both end up using whichever keypair
	// won rather than one of them silently overwriting the other.
	await db
		.prepare(
			`INSERT INTO user_keys (user_id, public_key, wrapped_private_key, algorithm)
			 VALUES (?, ?, ?, ?)
			 ON CONFLICT(user_id) DO NOTHING`
		)
		.bind(user.id, publicKey, wrappedPrivateKey, alg)
		.run();

	const stored = await db
		.prepare('SELECT public_key, wrapped_private_key, algorithm FROM user_keys WHERE user_id = ?')
		.bind(user.id)
		.first<KeyRow>();

	if (!stored) return apiError(500, 'Could not store keypair');

	return Response.json({
		keypair: {
			publicKey: stored.public_key,
			wrappedPrivateKey: stored.wrapped_private_key,
			algorithm: stored.algorithm
		},
		created: stored.public_key === publicKey
	});
};
