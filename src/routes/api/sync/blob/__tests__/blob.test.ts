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

// $lib/* aliases aren't resolvable outside SvelteKit's own Vite plugin — see
// the same note in api/auth/__tests__/signin.test.ts.
vi.mock('$lib/server/rate-limit', async () => {
	const real = await vi.importActual<typeof import('../../../../../lib/server/rate-limit')>(
		'../../../../../lib/server/rate-limit'
	);
	return real;
});
vi.mock('$lib/base64url', async () => {
	const real = await vi.importActual<typeof import('../../../../../lib/base64url')>(
		'../../../../../lib/base64url'
	);
	return real;
});

import { b64urlEncode } from '../../../../../lib/base64url';
import { GET, PUT } from '../+server';

type GetEvent = Parameters<typeof GET>[0];
type PutEvent = Parameters<typeof PUT>[0];

interface FakeBlobRow {
	blob: string;
	version: number;
	updated_at: string;
}

// Fake D1 modeling just enough of `sync_blobs` + `users.entitled_until` to
// exercise the route's SELECT and INSERT..ON CONFLICT..RETURNING statements,
// including the version-precondition upsert semantics.
function makeFakeDb(opts: { entitledUserIds: Set<string>; blobs: Record<string, FakeBlobRow> }) {
	const blobs = opts.blobs;
	const db = {
		prepare(sql: string) {
			return {
				bind(...args: unknown[]) {
					return {
						async first<T>() {
							if (sql.startsWith('SELECT blob, version, updated_at FROM sync_blobs')) {
								const userId = args[0] as string;
								return (blobs[userId] as T) ?? null;
							}
							if (sql.includes('SELECT id FROM users WHERE id')) {
								const userId = args[0] as string;
								return opts.entitledUserIds.has(userId) ? ({ id: userId } as T) : null;
							}
							if (sql.includes('INSERT INTO sync_blobs')) {
								const [userId, blob, expectedVersion] = args as [string, string, number];
								const existing = blobs[userId];
								if (!existing) {
									blobs[userId] = { blob, version: 1, updated_at: 'now' };
									return { version: 1 } as T;
								}
								if (existing.version !== expectedVersion) return null;
								existing.blob = blob;
								existing.version += 1;
								existing.updated_at = 'now';
								return { version: existing.version } as T;
							}
							return null;
						}
					};
				}
			};
		}
	};
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	return db as any;
}

function makeFakeKv() {
	const store = new Map<string, string>();
	return {
		store,
		kv: {
			put: async (key: string, value: string) => {
				store.set(key, value);
			},
			get: async (key: string) => store.get(key) ?? null
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
		} as any
	};
}

function putRequest(body: ArrayBuffer, versionQuery: string | null, sameOrigin = true): PutEvent {
	const req = new Request(
		`https://example.com/api/sync/blob${versionQuery !== null ? `?version=${versionQuery}` : ''}`,
		{
			method: 'PUT',
			headers: { 'sec-fetch-site': sameOrigin ? 'same-origin' : 'cross-site' }
		}
	);
	req.arrayBuffer = async () => body;
	const url = new URL(req.url);
	return { request: req, url } as unknown as PutEvent;
}

function validPayload(size = 40): ArrayBuffer {
	return new Uint8Array(size).buffer;
}

describe('GET /api/sync/blob', () => {
	it('requires auth', async () => {
		const { kv } = makeFakeKv();
		const res = await GET({
			locals: { user: null },
			platform: { env: { DB: makeFakeDb({ entitledUserIds: new Set(), blobs: {} }), SHARE_KV: kv } }
		} as unknown as GetEvent);
		expect(res.status).toBe(401);
	});

	it('returns version 0 and an empty body when the user has never synced', async () => {
		const { kv } = makeFakeKv();
		const res = await GET({
			locals: { user: { id: 'u1', email: 'a@b.com' } },
			platform: { env: { DB: makeFakeDb({ entitledUserIds: new Set(), blobs: {} }), SHARE_KV: kv } }
		} as unknown as GetEvent);
		expect(res.status).toBe(200);
		expect(res.headers.get('X-Sync-Version')).toBe('0');
	});

	it('returns the stored blob bytes and version header', async () => {
		const { kv } = makeFakeKv();
		const bytes = new Uint8Array([1, 2, 3, 4]);
		const b64 = b64urlEncode(bytes as Uint8Array<ArrayBuffer>);
		const db = makeFakeDb({
			entitledUserIds: new Set(),
			blobs: { u1: { blob: b64, version: 3, updated_at: '2026-01-01' } }
		});
		const res = await GET({
			locals: { user: { id: 'u1', email: 'a@b.com' } },
			platform: { env: { DB: db, SHARE_KV: kv } }
		} as unknown as GetEvent);
		expect(res.status).toBe(200);
		expect(res.headers.get('X-Sync-Version')).toBe('3');
		const buf = new Uint8Array(await res.arrayBuffer());
		expect([...buf]).toEqual([1, 2, 3, 4]);
	});

	it('stays open regardless of entitlement (no entitlement check on GET)', async () => {
		const { kv } = makeFakeKv();
		const db = makeFakeDb({
			entitledUserIds: new Set(), // nobody entitled
			blobs: { u1: { blob: 'AAAA', version: 1, updated_at: 'now' } }
		});
		const res = await GET({
			locals: { user: { id: 'u1', email: 'a@b.com' } },
			platform: { env: { DB: db, SHARE_KV: kv } }
		} as unknown as GetEvent);
		expect(res.status).toBe(200);
	});

	it('rate-limits after too many requests', async () => {
		const { kv } = makeFakeKv();
		const db = makeFakeDb({ entitledUserIds: new Set(), blobs: {} });
		let last;
		for (let i = 0; i < 61; i++) {
			last = await GET({
				locals: { user: { id: 'u1', email: 'a@b.com' } },
				platform: { env: { DB: db, SHARE_KV: kv } }
			} as unknown as GetEvent);
		}
		expect(last!.status).toBe(429);
	});
});

describe('PUT /api/sync/blob', () => {
	it('rejects cross-site requests', async () => {
		const { kv } = makeFakeKv();
		const db = makeFakeDb({ entitledUserIds: new Set(['u1']), blobs: {} });
		const event = putRequest(validPayload(), '0', false);
		const res = await PUT({
			...event,
			locals: { user: { id: 'u1', email: 'a@b.com' } },
			platform: { env: { DB: db, SHARE_KV: kv } }
		} as unknown as PutEvent);
		expect(res.status).toBe(403);
	});

	it('requires auth', async () => {
		const { kv } = makeFakeKv();
		const db = makeFakeDb({ entitledUserIds: new Set(), blobs: {} });
		const event = putRequest(validPayload(), '0');
		const res = await PUT({
			...event,
			locals: { user: null },
			platform: { env: { DB: db, SHARE_KV: kv } }
		} as unknown as PutEvent);
		expect(res.status).toBe(401);
	});

	it('rejects an unentitled user with 402', async () => {
		const { kv } = makeFakeKv();
		const db = makeFakeDb({ entitledUserIds: new Set(), blobs: {} });
		const event = putRequest(validPayload(), '0');
		const res = await PUT({
			...event,
			locals: { user: { id: 'u1', email: 'a@b.com' } },
			platform: { env: { DB: db, SHARE_KV: kv } }
		} as unknown as PutEvent);
		expect(res.status).toBe(402);
	});

	it('rejects a missing version query param', async () => {
		const { kv } = makeFakeKv();
		const db = makeFakeDb({ entitledUserIds: new Set(['u1']), blobs: {} });
		const event = putRequest(validPayload(), null);
		const res = await PUT({
			...event,
			locals: { user: { id: 'u1', email: 'a@b.com' } },
			platform: { env: { DB: db, SHARE_KV: kv } }
		} as unknown as PutEvent);
		expect(res.status).toBe(400);
	});

	it('rejects a payload below the minimum AES-GCM size', async () => {
		const { kv } = makeFakeKv();
		const db = makeFakeDb({ entitledUserIds: new Set(['u1']), blobs: {} });
		const event = putRequest(new Uint8Array(10).buffer, '0');
		const res = await PUT({
			...event,
			locals: { user: { id: 'u1', email: 'a@b.com' } },
			platform: { env: { DB: db, SHARE_KV: kv } }
		} as unknown as PutEvent);
		expect(res.status).toBe(400);
	});

	it('rejects a payload over the 2 MB cap', async () => {
		const { kv } = makeFakeKv();
		const db = makeFakeDb({ entitledUserIds: new Set(['u1']), blobs: {} });
		const event = putRequest(new Uint8Array(2 * 1024 * 1024 + 1).buffer, '0');
		const res = await PUT({
			...event,
			locals: { user: { id: 'u1', email: 'a@b.com' } },
			platform: { env: { DB: db, SHARE_KV: kv } }
		} as unknown as PutEvent);
		expect(res.status).toBe(413);
	});

	it('accepts the first-ever push at version=0 and returns version 1', async () => {
		const { kv } = makeFakeKv();
		const db = makeFakeDb({ entitledUserIds: new Set(['u1']), blobs: {} });
		const event = putRequest(validPayload(), '0');
		const res = await PUT({
			...event,
			locals: { user: { id: 'u1', email: 'a@b.com' } },
			platform: { env: { DB: db, SHARE_KV: kv } }
		} as unknown as PutEvent);
		expect(res.status).toBe(200);
		const json = await res.json();
		expect(json.version).toBe(1);
	});

	it('accepts a matching version and bumps it', async () => {
		const { kv } = makeFakeKv();
		const db = makeFakeDb({
			entitledUserIds: new Set(['u1']),
			blobs: { u1: { blob: 'AAAA', version: 5, updated_at: 'now' } }
		});
		const event = putRequest(validPayload(), '5');
		const res = await PUT({
			...event,
			locals: { user: { id: 'u1', email: 'a@b.com' } },
			platform: { env: { DB: db, SHARE_KV: kv } }
		} as unknown as PutEvent);
		expect(res.status).toBe(200);
		const json = await res.json();
		expect(json.version).toBe(6);
	});

	it('returns 409 on a stale version (concurrent write already landed)', async () => {
		const { kv } = makeFakeKv();
		const db = makeFakeDb({
			entitledUserIds: new Set(['u1']),
			blobs: { u1: { blob: 'AAAA', version: 5, updated_at: 'now' } }
		});
		const event = putRequest(validPayload(), '4');
		const res = await PUT({
			...event,
			locals: { user: { id: 'u1', email: 'a@b.com' } },
			platform: { env: { DB: db, SHARE_KV: kv } }
		} as unknown as PutEvent);
		expect(res.status).toBe(409);
	});

	it('rate-limits after too many requests', async () => {
		const { kv } = makeFakeKv();
		const db = makeFakeDb({ entitledUserIds: new Set(['u1']), blobs: {} });
		let last;
		for (let i = 0; i < 31; i++) {
			const event = putRequest(validPayload(), '0');
			last = await PUT({
				...event,
				locals: { user: { id: 'u1', email: 'a@b.com' } },
				platform: { env: { DB: db, SHARE_KV: kv } }
			} as unknown as PutEvent);
		}
		expect(last!.status).toBe(429);
	});
});
