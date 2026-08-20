import { describe, it, expect, vi } from 'vitest';

vi.mock('$lib/server/api', () => ({
	apiError: (status: number, message: string) =>
		new Response(JSON.stringify({ error: message }), { status }),
	checkSameOrigin: (request: Request) => {
		const fetchSite = request.headers.get('sec-fetch-site');
		if (fetchSite && fetchSite !== 'same-origin') {
			return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 });
		}
		return null;
	}
}));

// $lib/* aliases aren't resolvable outside SvelteKit's own Vite plugin — same
// note as api/sync/blob/__tests__/blob.test.ts.
vi.mock('$lib/server/rate-limit', async () => {
	const real = await vi.importActual<typeof import('../../../../../../lib/server/rate-limit')>(
		'../../../../../../lib/server/rate-limit'
	);
	return real;
});
vi.mock('$lib/server/collections', async () => {
	const real = await vi.importActual<typeof import('../../../../../../lib/server/collections')>(
		'../../../../../../lib/server/collections'
	);
	return real;
});
vi.mock('$lib/base64url', async () => {
	const real = await vi.importActual<typeof import('../../../../../../lib/base64url')>(
		'../../../../../../lib/base64url'
	);
	return real;
});

import { GET, PUT } from '../+server';

type GetEvent = Parameters<typeof GET>[0];
type PutEvent = Parameters<typeof PUT>[0];

const COLL = '11111111-1111-4111-8111-111111111111';
const OTHER_COLL = '22222222-2222-4222-9222-222222222222';
const ALICE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const MALLORY = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

interface BlobRow {
	blob: string;
	version: number;
	dek_version: number;
	updated_at: string;
}

function makeFakeDb(opts: {
	collections: { id: string; dekVersion: number }[];
	members: { collectionId: string; userId: string; dekVersion: number }[];
	entitled: Set<string>;
	blobs: Record<string, BlobRow>;
}) {
	const blobs = opts.blobs;
	return {
		prepare(sql: string) {
			return {
				bind(...args: unknown[]) {
					return {
						async first<T>() {
							if (sql.includes('FROM collection_members m')) {
								const [cid, uid] = args as [string, string];
								const m = opts.members.find((x) => x.collectionId === cid && x.userId === uid);
								const c = opts.collections.find((x) => x.id === cid);
								if (!m || !c) return null;
								return {
									name: 'Test',
									owner_user_id: ALICE,
									role: 'member',
									member_dek_version: m.dekVersion,
									collection_dek_version: c.dekVersion
								} as T;
							}
							if (sql.includes('FROM users WHERE id')) {
								const [uid] = args as [string];
								return opts.entitled.has(uid) ? ({ id: uid } as T) : null;
							}
							if (sql.startsWith('SELECT blob, version, dek_version')) {
								const [cid] = args as [string];
								return (blobs[cid] as T) ?? null;
							}
							if (sql.includes('INSERT INTO collection_blobs')) {
								const [cid, blob, dekVersion, expected] = args as [string, string, number, number];
								const existing = blobs[cid];
								if (!existing) {
									blobs[cid] = { blob, version: 1, dek_version: dekVersion, updated_at: 'now' };
									return { version: 1 } as T;
								}
								if (existing.version !== expected) return null;
								existing.blob = blob;
								existing.version += 1;
								existing.dek_version = dekVersion;
								return { version: existing.version } as T;
							}
							return null;
						}
					};
				}
			};
		}
	};
}

function baseDb(overrides: Partial<Parameters<typeof makeFakeDb>[0]> = {}) {
	return makeFakeDb({
		collections: [
			{ id: COLL, dekVersion: 1 },
			{ id: OTHER_COLL, dekVersion: 1 }
		],
		members: [{ collectionId: COLL, userId: ALICE, dekVersion: 1 }],
		entitled: new Set([ALICE, MALLORY]),
		blobs: {},
		...overrides
	});
}

function getEvent(opts: {
	db: unknown;
	userId?: string;
	id?: string;
	kv?: Map<string, string>;
}): GetEvent {
	const store = opts.kv ?? new Map<string, string>();
	return {
		params: { id: opts.id ?? COLL },
		locals: { user: opts.userId ? { id: opts.userId, email: 'a@b.c' } : null },
		platform: {
			env: {
				DB: opts.db,
				SHARE_KV: {
					get: async (k: string) => store.get(k) ?? null,
					put: async (k: string, v: string) => void store.set(k, v)
				}
			}
		}
	} as unknown as GetEvent;
}

function putEvent(opts: {
	db: unknown;
	userId?: string;
	id?: string;
	version?: string;
	bytes?: number;
}): PutEvent {
	const store = new Map<string, string>();
	const body = new Uint8Array(opts.bytes ?? 64);
	return {
		params: { id: opts.id ?? COLL },
		url: new URL(
			`https://x/api/collections/${opts.id ?? COLL}/blob?version=${opts.version ?? '0'}`
		),
		request: new Request('https://x', { method: 'PUT', body }),
		locals: { user: opts.userId ? { id: opts.userId, email: 'a@b.c' } : null },
		platform: {
			env: {
				DB: opts.db,
				SHARE_KV: {
					get: async (k: string) => store.get(k) ?? null,
					put: async (k: string, v: string) => void store.set(k, v)
				}
			}
		}
	} as unknown as PutEvent;
}

describe('GET /api/collections/[id]/blob — authorisation', () => {
	it('401s when signed out', async () => {
		const res = await GET(getEvent({ db: baseDb() }));
		expect(res.status).toBe(401);
	});

	it('200s for a member', async () => {
		const res = await GET(getEvent({ db: baseDb(), userId: ALICE }));
		expect(res.status).toBe(200);
	});

	// The central property: a valid session is not authorisation for any id.
	it('404s for a signed-in non-member of a real collection', async () => {
		const res = await GET(getEvent({ db: baseDb(), userId: MALLORY }));
		expect(res.status).toBe(404);
	});

	it('404s for a collection that does not exist', async () => {
		const res = await GET(
			getEvent({ db: baseDb(), userId: ALICE, id: '99999999-9999-4999-8999-999999999999' })
		);
		expect(res.status).toBe(404);
	});

	// Non-member and nonexistent must be byte-identical, or the endpoint is an
	// existence oracle for other people's collection ids.
	it('is indistinguishable between non-member and nonexistent', async () => {
		const nonMember = await GET(getEvent({ db: baseDb(), userId: MALLORY, id: COLL }));
		const absent = await GET(
			getEvent({ db: baseDb(), userId: MALLORY, id: '99999999-9999-4999-8999-999999999999' })
		);
		expect(nonMember.status).toBe(absent.status);
		expect(await nonMember.text()).toBe(await absent.text());
	});

	it('404s on a malformed collection id', async () => {
		const res = await GET(getEvent({ db: baseDb(), userId: ALICE, id: "' OR 1=1 --" }));
		expect(res.status).toBe(404);
	});

	it('reports the collection dek version on an empty collection', async () => {
		const res = await GET(getEvent({ db: baseDb(), userId: ALICE }));
		expect(res.headers.get('X-Sync-Version')).toBe('0');
		expect(res.headers.get('X-Collection-Dek-Version')).toBe('1');
	});
});

describe('PUT /api/collections/[id]/blob', () => {
	it('401s when signed out', async () => {
		const res = await PUT(putEvent({ db: baseDb() }));
		expect(res.status).toBe(401);
	});

	it('404s for a non-member', async () => {
		const res = await PUT(putEvent({ db: baseDb(), userId: MALLORY }));
		expect(res.status).toBe(404);
	});

	it('writes for an entitled member and bumps the version', async () => {
		const db = baseDb();
		const first = await PUT(putEvent({ db, userId: ALICE, version: '0' }));
		expect(first.status).toBe(200);
		expect(await first.json()).toMatchObject({ version: 1, dekVersion: 1 });

		const second = await PUT(putEvent({ db, userId: ALICE, version: '1' }));
		expect(await second.json()).toMatchObject({ version: 2 });
	});

	it('409s on a stale version', async () => {
		const db = baseDb();
		await PUT(putEvent({ db, userId: ALICE, version: '0' }));
		const stale = await PUT(putEvent({ db, userId: ALICE, version: '0' }));
		expect(stale.status).toBe(409);
	});

	// Read-only fallback: an unentitled member still sees the collection, but
	// cannot write to it.
	it('402s an unentitled member while GET still succeeds', async () => {
		const db = baseDb({ entitled: new Set<string>() });
		const write = await PUT(putEvent({ db, userId: ALICE }));
		expect(write.status).toBe(402);

		const read = await GET(getEvent({ db, userId: ALICE }));
		expect(read.status).toBe(200);
	});

	// Entitlement must not be checked before membership, or a non-member could
	// distinguish "not entitled" (402) from "not yours" (404) and learn the
	// collection exists.
	it('404s a non-member who is also unentitled, rather than 402', async () => {
		const db = baseDb({ entitled: new Set<string>() });
		const res = await PUT(putEvent({ db, userId: MALLORY }));
		expect(res.status).toBe(404);
	});

	it('409s when the member holds a stale key generation', async () => {
		const db = baseDb({
			collections: [{ id: COLL, dekVersion: 2 }],
			members: [{ collectionId: COLL, userId: ALICE, dekVersion: 1 }]
		});
		const res = await PUT(putEvent({ db, userId: ALICE }));
		expect(res.status).toBe(409);
		expect((await res.json()).error).toMatch(/rotated/i);
	});

	it('400s on a missing or invalid version', async () => {
		const db = baseDb();
		expect((await PUT(putEvent({ db, userId: ALICE, version: '' }))).status).toBe(400);
		expect((await PUT(putEvent({ db, userId: ALICE, version: 'abc' }))).status).toBe(400);
		expect((await PUT(putEvent({ db, userId: ALICE, version: '-1' }))).status).toBe(400);
	});

	it('400s on a payload too small to be a valid AES-GCM frame', async () => {
		const res = await PUT(putEvent({ db: baseDb(), userId: ALICE, bytes: 8 }));
		expect(res.status).toBe(400);
	});
});
