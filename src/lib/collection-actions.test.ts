import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { generateKeypair, importPrivateKey, generateShareKey } from './crypto';
import { setUserPrivateKey, setSyncDek, clearUserPrivateKey } from './db';
import { importDek } from './crypto';

vi.mock('./keypair', () => ({ ensureKeypair: vi.fn() }));
import { ensureKeypair } from './keypair';
import {
	createInvite,
	removeMemberAndRotate,
	joinCollection,
	promoteCollection,
	loadCollectionItems,
	toggleCollectionWatched,
	renameSharedCollection,
	addItemsToSharedCollection,
	removeItemFromSharedCollection
} from './collection-actions';

const noop = { setBusy: () => {}, setError: () => {} };
function capture() {
	let error = '';
	return { deps: { setBusy: () => {}, setError: (e: string) => (error = e) }, err: () => error };
}

const ALICE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const BOB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const CAROL = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const COLL = '11111111-1111-4111-8111-111111111111';

let alice: Awaited<ReturnType<typeof generateKeypair>>;
let collectionDek: string;
let aliceWrapped: string;

beforeEach(async () => {
	vi.restoreAllMocks();
	alice = await generateKeypair();
	collectionDek = await generateShareKey();
	const { wrapKeyForMember } = await import('./crypto');
	aliceWrapped = await wrapKeyForMember(collectionDek, alice.publicKey);

	await setUserPrivateKey(await importPrivateKey(alice.privateKeyPkcs8));
	await setSyncDek(await importDek(await generateShareKey(), false));
	vi.mocked(ensureKeypair).mockResolvedValue(alice.publicKey);

	// promoteCollection writes real tombstones, so each test needs a clean store.
	const { replaceAll } = await import('./db');
	await replaceAll([], { silent: true });
});

function collection(over = {}) {
	return {
		id: COLL,
		name: 'Date night',
		ownerUserId: ALICE,
		role: 'owner' as const,
		wrappedKey: aliceWrapped,
		dekVersion: 1,
		memberDekVersion: 1,
		...over
	};
}

describe('createInvite', () => {
	it('puts the collection key in the fragment, never in the request', async () => {
		const fetchMock = vi.fn(async (..._args: unknown[]) =>
			Response.json({ token: 'tok123', id: 'h', expiresAt: 'x' })
		);
		vi.stubGlobal('fetch', fetchMock);

		const link = await createInvite(collection(), 'https://queuest.app', noop);

		expect(link).toBe(`https://queuest.app/lists/join/tok123#${collectionDek}`);

		// The key must appear only after the '#'. Anything before it would be
		// sent to the server on the next navigation.
		const [, hash] = (link as string).split('#');
		expect(hash).toBe(collectionDek);
		expect((link as string).split('#')[0]).not.toContain(collectionDek);

		// And it must not have been in the POST body either.
		const body = fetchMock.mock.calls[0]?.[1];
		expect(JSON.stringify(body ?? {})).not.toContain(collectionDek);
	});
});

describe('joinCollection', () => {
	it('sends only a wrapped copy of the key, never the key itself', async () => {
		const fetchMock = vi.fn(async (..._args: unknown[]) => Response.json({ collectionId: COLL }));
		vi.stubGlobal('fetch', fetchMock);

		await joinCollection('tok', collectionDek, noop);

		const init = fetchMock.mock.calls[0][1] as RequestInit;
		const sent = String(init.body);
		expect(sent).not.toContain(collectionDek);
		expect(JSON.parse(sent).wrappedKey).toBeTruthy();
	});
});

describe('removeMemberAndRotate', () => {
	function stubFetch(members: { userId: string; email: string; publicKey: string | null }[]) {
		return vi.fn(async (url: string, init?: RequestInit) => {
			if (String(url).endsWith('/members') && (!init || init.method !== 'DELETE')) {
				return Response.json({
					members: members.map((m) => ({ ...m, role: 'member', dekVersion: 1, joinedAt: '' }))
				});
			}
			if (String(url).endsWith('/blob')) return new Response(null, { status: 200 });
			return Response.json({ removed: BOB, dekVersion: 2 });
		});
	}

	it('re-keys every remaining member, including the owner doing the removal', async () => {
		const carol = await generateKeypair();
		const fetchMock = stubFetch([
			{ userId: ALICE, email: 'a@x.com', publicKey: alice.publicKey },
			{ userId: BOB, email: 'b@x.com', publicKey: (await generateKeypair()).publicKey },
			{ userId: CAROL, email: 'c@x.com', publicKey: carol.publicKey }
		]);
		vi.stubGlobal('fetch', fetchMock);

		expect(await removeMemberAndRotate(collection(), BOB, noop)).toBe(true);

		const del = fetchMock.mock.calls.find((c) => (c[1] as RequestInit)?.method === 'DELETE');
		const body = JSON.parse(String((del![1] as RequestInit).body));

		expect(Object.keys(body.wrappedKeys).sort()).toEqual([ALICE, CAROL].sort());
		expect(body.wrappedKeys[BOB]).toBeUndefined();
		expect(body.userId).toBe(BOB);
		// The new key is genuinely new, and is never sent unwrapped.
		expect(JSON.stringify(body)).not.toContain(collectionDek);
	});

	// A member with no published public key cannot be re-keyed. Rotating anyway
	// would lock them out permanently with no way back, so refuse up front.
	it('refuses to rotate when a remaining member has no public key', async () => {
		const fetchMock = stubFetch([
			{ userId: ALICE, email: 'a@x.com', publicKey: alice.publicKey },
			{ userId: BOB, email: 'b@x.com', publicKey: 'pk' },
			{ userId: CAROL, email: 'carol@x.com', publicKey: null }
		]);
		vi.stubGlobal('fetch', fetchMock);

		const c = capture();
		expect(await removeMemberAndRotate(collection(), BOB, c.deps)).toBe(false);
		expect(c.err()).toContain('carol@x.com');
		expect(fetchMock.mock.calls.some((x) => (x[1] as RequestInit)?.method === 'DELETE')).toBe(
			false
		);
	});

	it('surfaces a clear error when the device has no private key', async () => {
		await clearUserPrivateKey();
		vi.stubGlobal(
			'fetch',
			stubFetch([{ userId: ALICE, email: 'a@x.com', publicKey: alice.publicKey }])
		);

		const c = capture();
		expect(await removeMemberAndRotate(collection(), BOB, c.deps)).toBe(false);
		expect(c.err()).toMatch(/account key|sign in/i);
	});
});

describe('promoteCollection', () => {
	const dbMod = () => import('./db');

	/** Fake server: POST /api/collections mints one, then blob GET/PUT round-trip. */
	function stubPromoteFetch(opts: { failBlobPut?: boolean } = {}) {
		let version = 0;
		let stored: ArrayBuffer | null = null;
		const mock = vi.fn(async (url: string, init?: RequestInit) => {
			const u = String(url);
			if (u === '/api/collections' && init?.method === 'POST') {
				return Response.json({
					id: COLL,
					name: JSON.parse(String(init.body)).name,
					ownerUserId: ALICE,
					role: 'owner',
					wrappedKey: JSON.parse(String(init.body)).wrappedKey,
					dekVersion: 1,
					memberDekVersion: 1
				});
			}
			if (u.includes('/blob') && (!init || init.method === undefined)) {
				return new Response(stored ?? new ArrayBuffer(0), {
					status: 200,
					headers: {
						'X-Sync-Version': String(version),
						'X-Collection-Dek-Version': '1'
					}
				});
			}
			if (u.includes('/blob') && init?.method === 'PUT') {
				if (opts.failBlobPut) return new Response('nope', { status: 500 });
				stored = await new Response(init.body as BodyInit).arrayBuffer();
				version++;
				return Response.json({ version });
			}
			throw new Error(`unexpected request: ${u}`);
		});
		return { mock, seeded: () => stored };
	}

	async function seedLocal(entries: { tmdb_id: number; queue_tag: string | null }[]) {
		const { addItem } = await dbMod();
		for (const e of entries) {
			await addItem({
				tmdb_id: e.tmdb_id,
				media_type: 'movie',
				title: `Title ${e.tmdb_id}`,
				poster_path: null,
				overview: null,
				providers: [],
				runtime_minutes: 100,
				seasons: [],
				watched_seasons: [],
				queue_tag: e.queue_tag
			} as never);
		}
		const { getAll } = await dbMod();
		return getAll();
	}

	async function decryptSeeded(bytes: ArrayBuffer, wrappedKey: string) {
		const { unwrapKeyForMember, importDek, decryptBytesWithDek } = await import('./crypto');
		const priv = await importPrivateKey(alice.privateKeyPkcs8);
		const dek = await importDek(await unwrapKeyForMember(wrappedKey, priv), false);
		const { gunzip } = await import('./gzip');
		const plain = await decryptBytesWithDek(bytes, dek);
		return JSON.parse(new TextDecoder().decode(await gunzip(plain))) as {
			items: { tmdb_id: number; watch: Record<string, string>; added_by_account_id: string }[];
		};
	}

	it('seeds only the tagged items, attributed to the promoter', async () => {
		const items = await seedLocal([
			{ tmdb_id: 1, queue_tag: 'Date night' },
			{ tmdb_id: 2, queue_tag: 'Date night' },
			{ tmdb_id: 3, queue_tag: 'Solo' },
			{ tmdb_id: 4, queue_tag: null }
		]);
		const { mock, seeded } = stubPromoteFetch();
		vi.stubGlobal('fetch', mock);

		const created = await promoteCollection('Date night', items, noop);
		expect(created?.name).toBe('Date night');

		const { items: blob } = await decryptSeeded(seeded()!, created!.wrappedKey);
		expect(blob.map((i) => i.tmdb_id).sort()).toEqual([1, 2]);
		expect(blob.every((i) => i.added_by_account_id === ALICE)).toBe(true);
	});

	it('tombstones the promoted items locally, leaving the rest alone', async () => {
		const items = await seedLocal([
			{ tmdb_id: 10, queue_tag: 'Date night' },
			{ tmdb_id: 11, queue_tag: 'Solo' }
		]);
		vi.stubGlobal('fetch', stubPromoteFetch().mock);

		await promoteCollection('Date night', items, noop);

		const { getAll } = await dbMod();
		const left = await getAll();
		expect(left.map((i) => i.tmdb_id)).toEqual([11]);
	});

	// The whole point of writing the blob first: a failure must not eat titles.
	it('leaves the personal collection intact when the blob write fails', async () => {
		const items = await seedLocal([{ tmdb_id: 20, queue_tag: 'Date night' }]);
		vi.stubGlobal('fetch', stubPromoteFetch({ failBlobPut: true }).mock);

		const c = capture();
		expect(await promoteCollection('Date night', items, c.deps)).toBeNull();
		expect(c.err()).toBeTruthy();

		const { getAll } = await dbMod();
		expect((await getAll()).map((i) => i.tmdb_id)).toEqual([20]);
	});

	it('carries a watched title across as this account’s own watch mark', async () => {
		const items = await seedLocal([{ tmdb_id: 30, queue_tag: 'Date night' }]);
		const { setWatched } = await dbMod();
		await setWatched(items[0].id, true);
		const { getAll } = await dbMod();

		const { mock, seeded } = stubPromoteFetch();
		vi.stubGlobal('fetch', mock);
		const created = await promoteCollection('Date night', await getAll(), noop);

		const { items: blob } = await decryptSeeded(seeded()!, created!.wrappedKey);
		expect(blob[0].watch[ALICE]).toBeTruthy();
	});
});

describe('loadCollectionItems / toggleCollectionWatched', () => {
	function stubViewFetch(initialItems: unknown[]) {
		let version = 1;
		let stored: unknown[] = initialItems;
		const mock = vi.fn(async (url: string, init?: RequestInit) => {
			const u = String(url);
			if (u.includes('/blob') && (!init || init.method === undefined)) {
				const { gzip } = await import('./gzip');
				const { encryptBytesWithDek } = await import('./crypto');
				const dek = await importDek(collectionDek, false);
				const compressed = await gzip(new TextEncoder().encode(JSON.stringify({ items: stored })));
				const ciphertext = await encryptBytesWithDek(compressed, dek);
				return new Response(ciphertext, {
					status: 200,
					headers: {
						'X-Sync-Version': String(version),
						'X-Collection-Dek-Version': '1'
					}
				});
			}
			if (u.includes('/blob') && init?.method === 'PUT') {
				const { gunzip } = await import('./gzip');
				const { decryptBytesWithDek } = await import('./crypto');
				const dek = await importDek(collectionDek, false);
				const body = await new Response(init.body as BodyInit).arrayBuffer();
				const plain = await decryptBytesWithDek(body, dek);
				stored = (JSON.parse(new TextDecoder().decode(await gunzip(plain))) as { items: unknown[] })
					.items;
				version++;
				return Response.json({ version });
			}
			throw new Error(`unexpected request: ${u}`);
		});
		return { mock, stored: () => stored };
	}

	function seedItem(tmdb_id: number) {
		return {
			tmdb_id,
			media_type: 'movie',
			title: `Title ${tmdb_id}`,
			poster_path: null,
			overview: null,
			providers: [],
			runtime_minutes: 100,
			seasons: [],
			watched_seasons: [],
			added_at: '2026-08-01T00:00:00.000Z',
			watched_at: null,
			updated_at: '2026-08-01T00:00:00.000Z',
			watch: {},
			added_by_account_id: ALICE
		};
	}

	it('loads and decrypts the collection blob', async () => {
		vi.stubGlobal('fetch', stubViewFetch([seedItem(1)]).mock);
		const items = await loadCollectionItems(collection(), noop);
		expect(items).toHaveLength(1);
		expect(items[0].tmdb_id).toBe(1);
	});

	it('sets only the toggling account’s own watch entry', async () => {
		const { mock, stored } = stubViewFetch([seedItem(5)]);
		vi.stubGlobal('fetch', mock);

		const items = await loadCollectionItems(collection(), noop);
		const result = await toggleCollectionWatched(collection(), items, items[0], ALICE, true, noop);

		expect(result).not.toBeNull();
		expect(result![0].watch?.[ALICE]).toBeTruthy();
		expect((stored()[0] as { watch: Record<string, string> }).watch[ALICE]).toBeTruthy();
	});

	it('clears only the toggling account’s own watch entry, leaving others alone', async () => {
		const seeded = seedItem(6);
		seeded.watch = { [ALICE]: '2026-08-01T00:00:00.000Z', [BOB]: '2026-08-02T00:00:00.000Z' };
		const { mock } = stubViewFetch([seeded]);
		vi.stubGlobal('fetch', mock);

		const items = await loadCollectionItems(collection(), noop);
		const result = await toggleCollectionWatched(collection(), items, items[0], ALICE, false, noop);

		expect(result![0].watch?.[ALICE]).toBeUndefined();
		expect(result![0].watch?.[BOB]).toBeTruthy();
	});
});

describe('renameSharedCollection', () => {
	it('PATCHes the collection and returns it with the new name', async () => {
		const fetchMock = vi.fn(async (..._args: unknown[]) =>
			Response.json({ id: COLL, name: 'Movie Night' })
		);
		vi.stubGlobal('fetch', fetchMock);

		const result = await renameSharedCollection(collection(), 'Movie Night', noop);

		expect(result?.name).toBe('Movie Night');
		expect(result?.id).toBe(COLL);
		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toBe(`/api/collections/${COLL}`);
		expect((init as RequestInit).method).toBe('PATCH');
		expect(JSON.parse(String((init as RequestInit).body))).toEqual({ name: 'Movie Night' });
	});

	it('surfaces a server error instead of throwing', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () =>
				Response.json({ error: 'Only the owner can rename this list' }, { status: 403 })
			)
		);

		const c = capture();
		const result = await renameSharedCollection(collection(), 'New name', c.deps);

		expect(result).toBeNull();
		expect(c.err()).toBeTruthy();
	});
});

describe('addItemsToSharedCollection', () => {
	beforeEach(async () => {
		const { enableSyncWithDek } = await import('./sync');
		await enableSyncWithDek(await generateShareKey(), 'alice@example.com');
	});

	function stubAddFetch(opts: { initialItems?: unknown[]; members?: unknown[] } = {}) {
		let version = 1;
		let stored: unknown[] = opts.initialItems ?? [];
		const members = opts.members ?? [
			{ userId: ALICE, email: 'alice@example.com', role: 'owner', dekVersion: 1 }
		];
		const mock = vi.fn(async (url: string, init?: RequestInit) => {
			const u = String(url);
			if (u.endsWith('/members')) {
				return Response.json({ members });
			}
			if (u.includes('/blob') && (!init || init.method === undefined)) {
				const { gzip } = await import('./gzip');
				const { encryptBytesWithDek } = await import('./crypto');
				const dek = await importDek(collectionDek, false);
				const compressed = await gzip(new TextEncoder().encode(JSON.stringify({ items: stored })));
				const ciphertext = await encryptBytesWithDek(compressed, dek);
				return new Response(ciphertext, {
					status: 200,
					headers: { 'X-Sync-Version': String(version), 'X-Collection-Dek-Version': '1' }
				});
			}
			if (u.includes('/blob') && init?.method === 'PUT') {
				const { gunzip } = await import('./gzip');
				const { decryptBytesWithDek } = await import('./crypto');
				const dek = await importDek(collectionDek, false);
				const body = await new Response(init.body as BodyInit).arrayBuffer();
				const plain = await decryptBytesWithDek(body, dek);
				stored = (JSON.parse(new TextDecoder().decode(await gunzip(plain))) as { items: unknown[] })
					.items;
				version++;
				return Response.json({ version });
			}
			throw new Error(`unexpected request: ${u}`);
		});
		return { mock, stored: () => stored };
	}

	async function seedLocal(entries: { tmdb_id: number }[]) {
		const { addItem, getAll } = await import('./db');
		for (const e of entries) {
			await addItem({
				tmdb_id: e.tmdb_id,
				media_type: 'movie',
				title: `Title ${e.tmdb_id}`,
				poster_path: null,
				overview: null,
				providers: [],
				runtime_minutes: 100,
				seasons: [],
				watched_seasons: [],
				queue_tag: null
			} as never);
		}
		return getAll();
	}

	it('moves the given items into the shared blob and tombstones them locally', async () => {
		const items = await seedLocal([{ tmdb_id: 100 }, { tmdb_id: 101 }]);
		const { mock, stored } = stubAddFetch();
		vi.stubGlobal('fetch', mock);

		const ok = await addItemsToSharedCollection(collection(), items, noop);
		expect(ok).toBe(true);

		const blobItems = stored() as { tmdb_id: number; added_by_account_id: string }[];
		expect(blobItems.map((i) => i.tmdb_id).sort()).toEqual([100, 101]);
		expect(blobItems.every((i) => i.added_by_account_id === ALICE)).toBe(true);

		const { getAll } = await import('./db');
		expect(await getAll()).toEqual([]);
	});

	it('dedupes against items already present in the shared blob', async () => {
		const items = await seedLocal([{ tmdb_id: 200 }]);
		const existing = {
			tmdb_id: 200,
			media_type: 'movie',
			title: 'Already there',
			poster_path: null,
			overview: null,
			providers: [],
			runtime_minutes: 100,
			seasons: [],
			watched_seasons: [],
			added_at: '2026-08-01T00:00:00.000Z',
			watched_at: null,
			updated_at: '2026-08-01T00:00:00.000Z',
			watch: {},
			added_by_account_id: BOB
		};
		const { mock, stored } = stubAddFetch({ initialItems: [existing] });
		vi.stubGlobal('fetch', mock);

		await addItemsToSharedCollection(collection(), items, noop);

		expect(stored()).toHaveLength(1);
		expect((stored()[0] as { added_by_account_id: string }).added_by_account_id).toBe(BOB);
	});

	it('fails without touching local items when the caller is not a recognized member', async () => {
		const items = await seedLocal([{ tmdb_id: 300 }]);
		const { mock } = stubAddFetch({ members: [] });
		vi.stubGlobal('fetch', mock);

		const c = capture();
		const ok = await addItemsToSharedCollection(collection(), items, c.deps);

		expect(ok).toBe(false);
		expect(c.err()).toBeTruthy();

		const { getAll } = await import('./db');
		expect((await getAll()).map((i) => i.tmdb_id)).toEqual([300]);
	});
});

describe('removeItemFromSharedCollection', () => {
	function stubBlobFetch(initialItems: unknown[]) {
		let version = 1;
		let stored: unknown[] = initialItems;
		const mock = vi.fn(async (url: string, init?: RequestInit) => {
			const u = String(url);
			if (u.includes('/blob') && (!init || init.method === undefined)) {
				const { gzip } = await import('./gzip');
				const { encryptBytesWithDek } = await import('./crypto');
				const dek = await importDek(collectionDek, false);
				const compressed = await gzip(new TextEncoder().encode(JSON.stringify({ items: stored })));
				const ciphertext = await encryptBytesWithDek(compressed, dek);
				return new Response(ciphertext, {
					status: 200,
					headers: { 'X-Sync-Version': String(version), 'X-Collection-Dek-Version': '1' }
				});
			}
			if (u.includes('/blob') && init?.method === 'PUT') {
				const { gunzip } = await import('./gzip');
				const { decryptBytesWithDek } = await import('./crypto');
				const dek = await importDek(collectionDek, false);
				const body = await new Response(init.body as BodyInit).arrayBuffer();
				const plain = await decryptBytesWithDek(body, dek);
				stored = (JSON.parse(new TextDecoder().decode(await gunzip(plain))) as { items: unknown[] })
					.items;
				version++;
				return Response.json({ version });
			}
			throw new Error(`unexpected request: ${u}`);
		});
		return { mock, stored: () => stored };
	}

	function seedItem(tmdb_id: number, overrides: Record<string, unknown> = {}) {
		return {
			tmdb_id,
			media_type: 'movie',
			title: `Title ${tmdb_id}`,
			poster_path: null,
			overview: null,
			providers: [],
			runtime_minutes: 100,
			seasons: [],
			watched_seasons: [],
			added_at: '2026-08-01T00:00:00.000Z',
			watched_at: null,
			updated_at: '2026-08-01T00:00:00.000Z',
			watch: {},
			added_by_account_id: ALICE,
			...overrides
		};
	}

	it('removes only the targeted item, leaving the rest of the blob alone', async () => {
		const { mock, stored } = stubBlobFetch([seedItem(1), seedItem(2)]);
		vi.stubGlobal('fetch', mock);

		const items = await loadCollectionItems(collection(), noop);
		const target = items.find((i) => i.tmdb_id === 1)!;
		const result = await removeItemFromSharedCollection(collection(), items, target, noop);

		expect(result).not.toBeNull();
		expect(result!.map((i) => i.tmdb_id)).toEqual([2]);
		expect((stored() as { tmdb_id: number }[]).map((i) => i.tmdb_id)).toEqual([2]);
	});

	it('matches by tmdb_id + media_type, not just tmdb_id', async () => {
		const movie = seedItem(1, { media_type: 'movie' });
		const show = seedItem(1, { media_type: 'tv', title: 'Show 1' });
		const { mock, stored } = stubBlobFetch([movie, show]);
		vi.stubGlobal('fetch', mock);

		const items = await loadCollectionItems(collection(), noop);
		const target = items.find((i) => i.media_type === 'movie')!;
		await removeItemFromSharedCollection(collection(), items, target, noop);

		const remaining = stored() as { media_type: string }[];
		expect(remaining).toHaveLength(1);
		expect(remaining[0].media_type).toBe('tv');
	});

	it('surfaces an error and returns null on failure, without touching the blob', async () => {
		const c = capture();
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response('nope', { status: 500 }))
		);

		const result = await removeItemFromSharedCollection(
			collection(),
			[],
			{ ...seedItem(1) } as never,
			c.deps
		);

		expect(result).toBeNull();
		expect(c.err()).toBeTruthy();
	});
});
