import type { RequestHandler } from './$types';
import { apiError, checkSameOrigin } from '$lib/server/api';
import { checkRateLimit } from '$lib/server/rate-limit';
import { requireMembership, isEntitled } from '$lib/server/collections';
import { b64urlEncode, b64urlDecode } from '$lib/base64url';

// Same AES-GCM wire format as api/sync/blob: [iv 12B][ciphertext], with the
// 16B GCM tag present even for empty plaintext.
const MIN_BYTES = 12 + 16;
const MAX_BYTES = 2 * 1024 * 1024;

const GET_LIMIT = { max: 60, windowSeconds: 300 };
// Deliberately higher than sync/blob's 30: that limit assumes one person's
// devices, which rarely write at once. A shared collection has several people
// writing concurrently, and 409-retries draw on the same budget — hitting 429
// during a shared watch night would be an unforced error. Revisit alongside
// the merge work in #188, which may reduce write frequency instead.
const PUT_LIMIT = { max: 60, windowSeconds: 300 };

interface CollectionBlobRow {
	blob: string;
	version: number;
	dek_version: number;
	updated_at: string;
}

export const GET: RequestHandler = async ({ params, platform, locals }) => {
	const user = locals.user;
	if (!user) return apiError(401, 'Sign in required');

	const db = platform?.env?.DB;
	const kv = platform?.env?.SHARE_KV;
	if (!db || !kv) return apiError(503, 'Collections unavailable');

	const allowed = await checkRateLimit(
		kv,
		`coll-blob-get:${user.id}`,
		GET_LIMIT.max,
		GET_LIMIT.windowSeconds
	);
	if (!allowed) return apiError(429, 'Too many requests');

	// Authentication is the easy half; this is the half that matters. A valid
	// session does not authorise an arbitrary collection id. Null covers
	// "no such collection", "never a member", and "removed" alike, and all
	// three must render identically — see requireMembership's contract.
	const membership = await requireMembership(db, params.id, user.id);
	if (!membership) return apiError(404, 'Not found');

	// Reads are not entitlement-gated (see api/sync/blob GET).
	const row = await db
		.prepare(
			'SELECT blob, version, dek_version, updated_at FROM collection_blobs WHERE collection_id = ?'
		)
		.bind(params.id)
		.first<CollectionBlobRow>();

	if (!row) {
		return new Response(null, {
			status: 200,
			headers: {
				'X-Sync-Version': '0',
				'X-Collection-Dek-Version': String(membership.collectionDekVersion)
			}
		});
	}

	return new Response(b64urlDecode(row.blob), {
		headers: {
			'Content-Type': 'application/octet-stream',
			'X-Content-Type-Options': 'nosniff',
			'Content-Disposition': 'attachment',
			'X-Sync-Version': String(row.version),
			// Lets the client tell "encrypted under a generation I don't hold"
			// (re-fetch my wrapped key) from "corrupt" — without it, a partial
			// key rotation surfaces to the user as data loss.
			'X-Collection-Dek-Version': String(row.dek_version),
			'X-Sync-Updated-At': row.updated_at
		}
	});
};

export const PUT: RequestHandler = async ({ request, params, url, platform, locals }) => {
	const originError = checkSameOrigin(request);
	if (originError) return originError;

	const user = locals.user;
	if (!user) return apiError(401, 'Sign in required');

	const db = platform?.env?.DB;
	const kv = platform?.env?.SHARE_KV;
	if (!db || !kv) return apiError(503, 'Collections unavailable');

	const allowed = await checkRateLimit(
		kv,
		`coll-blob-put:${user.id}`,
		PUT_LIMIT.max,
		PUT_LIMIT.windowSeconds
	);
	if (!allowed) return apiError(429, 'Too many requests');

	const membership = await requireMembership(db, params.id, user.id);
	if (!membership) return apiError(404, 'Not found');

	// Read-only fallback for an unentitled member (decided on #187): they keep
	// seeing the collection — the GET above is ungated — but cannot write to
	// it. Entitlement is per-account, so an entitled member keeps writing even
	// if the collection's owner has lapsed.
	if (!(await isEntitled(db, user.id))) {
		return apiError(402, 'Writing to collections requires an active subscription');
	}

	// A client holding a stale wrapped key would otherwise encrypt under the
	// old generation and overwrite the blob with something the other members
	// can't read. Refuse, and tell it to re-fetch.
	if (membership.memberDekVersion !== membership.collectionDekVersion) {
		return apiError(409, 'Key rotated — re-fetch your collection key and retry');
	}

	const expectedVersionParam = url.searchParams.get('version');
	const expectedVersion = Number(expectedVersionParam);
	if (!expectedVersionParam || !Number.isInteger(expectedVersion) || expectedVersion < 0) {
		return apiError(400, 'Missing or invalid version');
	}

	const body = await request.arrayBuffer();
	if (body.byteLength < MIN_BYTES) return apiError(400, 'Payload too small to be valid');
	if (body.byteLength > MAX_BYTES) return apiError(413, 'Payload too large');

	const blob = b64urlEncode(new Uint8Array(body) as Uint8Array<ArrayBuffer>);

	// Version precondition baked into ON CONFLICT, same as api/sync/blob: a
	// concurrent write bumps the version, the WHERE fails, RETURNING yields no
	// row, and that is the 409 signal. `version` starts at 1, so a first-ever
	// push must pass ?version=0.
	const result = await db
		.prepare(
			`INSERT INTO collection_blobs (collection_id, blob, version, dek_version)
			 VALUES (?, ?, 1, ?)
			 ON CONFLICT(collection_id) DO UPDATE SET
			   blob = excluded.blob,
			   version = collection_blobs.version + 1,
			   dek_version = excluded.dek_version,
			   updated_at = datetime('now')
			 WHERE collection_blobs.version = ?
			 RETURNING version`
		)
		.bind(params.id, blob, membership.collectionDekVersion, expectedVersion)
		.first<{ version: number }>();

	if (!result) return apiError(409, 'Version conflict — re-fetch and retry');

	return Response.json({
		version: result.version,
		dekVersion: membership.collectionDekVersion
	});
};
