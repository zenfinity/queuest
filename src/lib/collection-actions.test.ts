import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { generateKeypair, importPrivateKey, generateShareKey } from './crypto';
import { setUserPrivateKey, setSyncDek, clearUserPrivateKey } from './db';
import { importDek } from './crypto';

vi.mock('./keypair', () => ({ ensureKeypair: vi.fn() }));
import { ensureKeypair } from './keypair';
import { createInvite, removeMemberAndRotate, joinCollection } from './collection-actions';

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
		const fetchMock = vi.fn(async () =>
			Response.json({ token: 'tok123', id: 'h', expiresAt: 'x' })
		);
		vi.stubGlobal('fetch', fetchMock);

		const link = await createInvite(collection(), 'https://queuest.app', noop);

		expect(link).toBe(`https://queuest.app/collections/join/tok123#${collectionDek}`);

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
		const fetchMock = vi.fn(async () => Response.json({ collectionId: COLL }));
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
