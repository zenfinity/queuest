import type { RequestHandler } from './$types';
import { apiError, checkSameOrigin } from '$lib/server/api';
import { checkRateLimit } from '$lib/server/rate-limit';
import { b64urlEncode, b64urlDecode } from '$lib/base64url';

// Same AES-GCM wire format as api/share: [iv 12B][ciphertext], and the GCM
// auth tag (16B) is appended even for empty plaintext.
const MIN_BYTES = 12 + 16;
// ~500 items with full metadata is ~1.5 MB before gzip; this is the cap on
// the gzipped+encrypted bytes actually sent, so 2 MB is generous headroom.
const MAX_BYTES = 2 * 1024 * 1024;

const GET_LIMIT = { max: 60, windowSeconds: 300 };
const PUT_LIMIT = { max: 30, windowSeconds: 300 };

interface SyncBlobRow {
	blob: string;
	version: number;
	updated_at: string;
}

interface EntitlementRow {
	id: string;
}

export const GET: RequestHandler = async ({ platform, locals }) => {
	const user = locals.user;
	if (!user) return apiError(401, 'Sign in required');

	const db = platform?.env?.DB;
	const kv = platform?.env?.SHARE_KV;
	if (!db || !kv) return apiError(503, 'Sync unavailable');

	const allowed = await checkRateLimit(
		kv,
		`sync-get:${user.id}`,
		GET_LIMIT.max,
		GET_LIMIT.windowSeconds
	);
	if (!allowed) return apiError(429, 'Too many requests');

	// Reads are never gated on entitlement — a lapsed subscription must never
	// look indistinguishable from data loss.
	const row = await db
		.prepare('SELECT blob, version, updated_at FROM sync_blobs WHERE user_id = ?')
		.bind(user.id)
		.first<SyncBlobRow>();

	if (!row) {
		return new Response(null, {
			status: 200,
			headers: { 'X-Sync-Version': '0' }
		});
	}

	return new Response(b64urlDecode(row.blob), {
		headers: {
			'Content-Type': 'application/octet-stream',
			'X-Content-Type-Options': 'nosniff',
			'Content-Disposition': 'attachment',
			'X-Sync-Version': String(row.version),
			'X-Sync-Updated-At': row.updated_at
		}
	});
};

export const PUT: RequestHandler = async ({ request, url, platform, locals }) => {
	const originError = checkSameOrigin(request);
	if (originError) return originError;

	const user = locals.user;
	if (!user) return apiError(401, 'Sign in required');

	const db = platform?.env?.DB;
	const kv = platform?.env?.SHARE_KV;
	if (!db || !kv) return apiError(503, 'Sync unavailable');

	const allowed = await checkRateLimit(
		kv,
		`sync-put:${user.id}`,
		PUT_LIMIT.max,
		PUT_LIMIT.windowSeconds
	);
	if (!allowed) return apiError(429, 'Too many requests');

	// Entitlement seam: today everyone qualifies (entitled_until defaults to
	// NULL at signup — see migrations/0001_sync_schema.sql). Billing lands
	// later by having something else *write* entitled_until; this check
	// doesn't change.
	const entitled = await db
		.prepare(
			"SELECT id FROM users WHERE id = ? AND (entitled_until IS NULL OR entitled_until > datetime('now'))"
		)
		.bind(user.id)
		.first<EntitlementRow>();
	if (!entitled) return apiError(402, 'Sync requires an active subscription');

	const expectedVersionParam = url.searchParams.get('version');
	const expectedVersion = Number(expectedVersionParam);
	if (!expectedVersionParam || !Number.isInteger(expectedVersion) || expectedVersion < 0) {
		return apiError(400, 'Missing or invalid version');
	}

	const body = await request.arrayBuffer();
	if (body.byteLength < MIN_BYTES) return apiError(400, 'Payload too small to be valid');
	if (body.byteLength > MAX_BYTES) return apiError(413, 'Payload too large');

	const blob = b64urlEncode(new Uint8Array(body) as Uint8Array<ArrayBuffer>);

	// Single upsert with the version precondition baked into the ON CONFLICT
	// clause: if another write already bumped the version, the WHERE fails,
	// SQLite silently skips the UPDATE, and RETURNING yields no row — that's
	// our 409 signal. `version` starts at 1 on first insert, so first-ever
	// push must be called with ?version=0.
	const result = await db
		.prepare(
			`INSERT INTO sync_blobs (user_id, blob, version)
			 VALUES (?, ?, 1)
			 ON CONFLICT(user_id) DO UPDATE SET
			   blob = excluded.blob,
			   version = sync_blobs.version + 1,
			   updated_at = datetime('now')
			 WHERE sync_blobs.version = ?
			 RETURNING version`
		)
		.bind(user.id, blob, expectedVersion)
		.first<{ version: number }>();

	if (!result) return apiError(409, 'Version conflict — re-fetch and retry');

	return Response.json({ version: result.version });
};
