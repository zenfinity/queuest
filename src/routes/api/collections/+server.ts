import type { RequestHandler } from './$types';
import { apiError, checkSameOrigin } from '$lib/server/api';
import { checkRateLimit } from '$lib/server/rate-limit';
import { isEntitled } from '$lib/server/collections';

const MAX_NAME_LEN = 100;
// The Collection DEK (32 bytes) wrapped with encryptBytesWithDek's wire format
// ([iv 12B][ciphertext+tag]) is ~60 bytes raw, ~80 b64url. Generous headroom
// without letting a client park arbitrary data here.
const MAX_WRAPPED_KEY_LEN = 1024;

const LIST_LIMIT = { max: 60, windowSeconds: 300 };
const CREATE_LIMIT = { max: 20, windowSeconds: 300 };

interface CollectionListRow {
	id: string;
	name: string;
	color: string | null;
	owner_user_id: string;
	dek_version: number;
	created_at: string;
	role: 'owner' | 'member';
	wrapped_key: string;
	member_dek_version: number;
}

/**
 * Collections the caller is a member of. Never lists collections by any other
 * criterion — membership is the only filter, so there is no way to enumerate
 * collections belonging to anyone else.
 */
export const GET: RequestHandler = async ({ platform, locals }) => {
	const user = locals.user;
	if (!user) return apiError(401, 'Sign in required');

	const db = platform?.env?.DB;
	const kv = platform?.env?.SHARE_KV;
	if (!db || !kv) return apiError(503, 'Collections unavailable');

	const allowed = await checkRateLimit(
		kv,
		`coll-list:${user.id}`,
		LIST_LIMIT.max,
		LIST_LIMIT.windowSeconds
	);
	if (!allowed) return apiError(429, 'Too many requests');

	// Reads are not entitlement-gated, matching api/sync/blob's GET: a lapsed
	// subscription must never look indistinguishable from data loss.
	const { results } = await db
		.prepare(
			`SELECT c.id            AS id,
			        c.name          AS name,
			        c.color         AS color,
			        c.owner_user_id AS owner_user_id,
			        c.dek_version   AS dek_version,
			        c.created_at    AS created_at,
			        m.role          AS role,
			        m.wrapped_key   AS wrapped_key,
			        m.dek_version   AS member_dek_version
			   FROM collection_members m
			   JOIN collections c ON c.id = m.collection_id
			  WHERE m.user_id = ?
			  ORDER BY c.created_at ASC`
		)
		.bind(user.id)
		.all<CollectionListRow>();

	const rows: CollectionListRow[] = results ?? [];

	return Response.json({
		collections: rows.map((r) => ({
			id: r.id,
			name: r.name,
			color: r.color,
			ownerUserId: r.owner_user_id,
			role: r.role,
			wrappedKey: r.wrapped_key,
			dekVersion: r.dek_version,
			memberDekVersion: r.member_dek_version,
			createdAt: r.created_at
		}))
	});
};

/**
 * Creates a collection. The client generates the Collection DEK, wraps it
 * under its own personal sync DEK, and posts only the wrapped copy — the
 * server never sees an unwrapped key, here or anywhere else.
 */
export const POST: RequestHandler = async ({ request, platform, locals }) => {
	const originError = checkSameOrigin(request);
	if (originError) return originError;

	const user = locals.user;
	if (!user) return apiError(401, 'Sign in required');

	const db = platform?.env?.DB;
	const kv = platform?.env?.SHARE_KV;
	if (!db || !kv) return apiError(503, 'Collections unavailable');

	const allowed = await checkRateLimit(
		kv,
		`coll-create:${user.id}`,
		CREATE_LIMIT.max,
		CREATE_LIMIT.windowSeconds
	);
	if (!allowed) return apiError(429, 'Too many requests');

	if (!(await isEntitled(db, user.id))) {
		return apiError(402, 'Collections require an active subscription');
	}

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return apiError(400, 'Invalid JSON');
	}

	const { name, wrappedKey } = (body ?? {}) as Record<string, unknown>;

	const trimmedName = typeof name === 'string' ? name.trim() : '';
	if (!trimmedName || trimmedName.length > MAX_NAME_LEN) {
		return apiError(400, 'A collection name is required');
	}
	if (typeof wrappedKey !== 'string' || !wrappedKey || wrappedKey.length > MAX_WRAPPED_KEY_LEN) {
		return apiError(400, 'Invalid wrapped key');
	}

	// Server-generated so a client can't choose (or collide with) a primary key.
	const id = crypto.randomUUID();

	// Batched so a failure can't leave a collection with no owner row — which
	// would be a collection nobody, including its creator, could ever reach,
	// since every read path goes through membership.
	await db.batch([
		db
			.prepare('INSERT INTO collections (id, owner_user_id, name, dek_version) VALUES (?, ?, ?, 1)')
			.bind(id, user.id, trimmedName),
		db
			.prepare(
				`INSERT INTO collection_members (collection_id, user_id, wrapped_key, dek_version, role)
				 VALUES (?, ?, ?, 1, 'owner')`
			)
			.bind(id, user.id, wrappedKey)
	]);

	return Response.json(
		{
			id,
			name: trimmedName,
			color: null,
			ownerUserId: user.id,
			role: 'owner',
			wrappedKey,
			dekVersion: 1,
			memberDekVersion: 1
		},
		{ status: 201 }
	);
};
