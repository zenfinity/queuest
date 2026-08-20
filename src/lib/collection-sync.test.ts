import { describe, it, expect, vi } from 'vitest';
import { generateShareKey, importDek } from './crypto';
import { gzip } from './gzip';
import {
	mergeCollectionWatch,
	mergeCollectionItem,
	mergeCollectionItems,
	syncCollectionItems,
	fetchCollectionItems,
	CollectionKeyRotatedError,
	type CollectionItem
} from './collection-sync';

const ALICE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const BOB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const COLL = '11111111-1111-4111-8111-111111111111';

function item(over: Partial<CollectionItem> = {}): CollectionItem {
	return {
		tmdb_id: 42,
		media_type: 'movie',
		title: 'The Princess Bride',
		poster_path: null,
		overview: null,
		providers: [],
		runtime_minutes: 98,
		seasons: [],
		watched_seasons: [],
		added_at: '2026-08-01T00:00:00.000Z',
		watched_at: null,
		updated_at: '2026-08-01T00:00:00.000Z',
		...over
	};
}

describe('mergeCollectionWatch', () => {
	it('unions marks from both sides', () => {
		const merged = mergeCollectionWatch(
			{ [ALICE]: '2026-08-01T00:00:00Z' },
			{ [BOB]: '2026-08-02T00:00:00Z' }
		);
		expect(merged).toEqual({ [ALICE]: '2026-08-01T00:00:00Z', [BOB]: '2026-08-02T00:00:00Z' });
	});

	// The bug #188 exists to fix: whole-item LWW would drop one of these.
	it('does not let one member’s mark clobber another’s', () => {
		const local = { [ALICE]: '2026-08-01T00:00:00Z' };
		const remote = { [BOB]: '2026-08-01T00:00:01Z' };
		const merged = mergeCollectionWatch(local, remote)!;
		expect(merged[ALICE]).toBeTruthy();
		expect(merged[BOB]).toBeTruthy();
	});

	it('takes the newer mark within the same account’s own entry', () => {
		const merged = mergeCollectionWatch(
			{ [ALICE]: '2026-08-01T00:00:00Z' },
			{ [ALICE]: '2026-08-02T00:00:00Z' }
		)!;
		expect(merged[ALICE]).toBe('2026-08-02T00:00:00Z');
	});

	it('handles either side being absent', () => {
		expect(mergeCollectionWatch(undefined, { [ALICE]: 'x' })).toEqual({ [ALICE]: 'x' });
		expect(mergeCollectionWatch({ [ALICE]: 'x' }, undefined)).toEqual({ [ALICE]: 'x' });
		expect(mergeCollectionWatch(undefined, undefined)).toBeUndefined();
	});
});

describe('mergeCollectionItem', () => {
	it('keeps added_by_account_id stable across an LWW-losing edit', () => {
		const local = item({ added_by_account_id: ALICE, updated_at: '2026-08-01T00:00:00Z' });
		const remote = item({
			added_by_account_id: null,
			updated_at: '2026-08-02T00:00:00Z',
			title: 'Retitled'
		});
		const merged = mergeCollectionItem(local, remote);
		// Remote wins the LWW bundle (newer updated_at)...
		expect(merged.title).toBe('Retitled');
		// ...but attribution isn't part of that bundle.
		expect(merged.added_by_account_id).toBe(ALICE);
	});

	it('unions watched_seasons the same way personal sync does', () => {
		const local = item({ watched_seasons: [1, 2] });
		const remote = item({ watched_seasons: [2, 3] });
		expect(mergeCollectionItem(local, remote).watched_seasons).toEqual([1, 2, 3]);
	});

	it('keeps the earliest added_at regardless of which side wins LWW', () => {
		const local = item({ added_at: '2026-08-05T00:00:00Z', updated_at: '2026-08-05T00:00:00Z' });
		const remote = item({ added_at: '2026-08-01T00:00:00Z', updated_at: '2026-08-06T00:00:00Z' });
		expect(mergeCollectionItem(local, remote).added_at).toBe('2026-08-01T00:00:00Z');
	});
});

describe('mergeCollectionItems — concurrent add/remove', () => {
	it('a title added on only one side survives the merge', () => {
		const local = [item({ tmdb_id: 1 }), item({ tmdb_id: 2 })];
		const remote = [item({ tmdb_id: 1 })];
		const merged = mergeCollectionItems(local, remote);
		expect(merged.map((i) => i.tmdb_id).sort()).toEqual([1, 2]);
	});

	it('a soft-delete (tombstone) on one side is not resurrected by the other, once it is the newer edit', () => {
		const local = [
			item({ tmdb_id: 1, deleted_at: '2026-08-10T00:00:00Z', updated_at: '2026-08-10T00:00:00Z' })
		];
		const remote = [item({ tmdb_id: 1, deleted_at: null, updated_at: '2026-08-01T00:00:00Z' })];
		const merged = mergeCollectionItems(local, remote);
		expect(merged[0].deleted_at).toBe('2026-08-10T00:00:00Z');
	});

	it('two members adding different titles at once both survive', () => {
		const local = [item({ tmdb_id: 100, title: 'Alice’s pick' })];
		const remote = [item({ tmdb_id: 200, title: 'Bob’s pick' })];
		const merged = mergeCollectionItems(local, remote);
		expect(merged).toHaveLength(2);
	});
});

// ── Pull/push cycle, including the 409 retry loop ──────────────────────────

function makeCrypto() {
	return async () => {
		const dekB64 = await generateShareKey();
		return importDek(dekB64, false);
	};
}

async function pulledResponse(
	items: CollectionItem[],
	dek: CryptoKey,
	version: number,
	dekVersion = 1
) {
	const { encryptBytesWithDek } = await import('./crypto');
	const compressed = await gzip(new TextEncoder().encode(JSON.stringify({ items })));
	const ciphertext = await encryptBytesWithDek(compressed, dek);
	return new Response(ciphertext, {
		status: 200,
		headers: {
			'X-Sync-Version': String(version),
			'X-Collection-Dek-Version': String(dekVersion)
		}
	});
}

describe('fetchCollectionItems', () => {
	it('decrypts and validates items through the untrusted-payload parser', async () => {
		const getDek = makeCrypto();
		const dek = await getDek();
		const remoteItems = [item({ tmdb_id: 7, watch: { [ALICE]: '2026-08-01T00:00:00.000Z' } })];

		vi.stubGlobal(
			'fetch',
			vi.fn(async () => pulledResponse(remoteItems, dek, 3))
		);

		const items = await fetchCollectionItems(COLL, dek);
		expect(items).toHaveLength(1);
		expect(items[0].watch?.[ALICE]).toBe('2026-08-01T00:00:00.000Z');
	});

	it('drops a malformed item rather than trusting it', async () => {
		const getDek = makeCrypto();
		const dek = await getDek();
		const { encryptBytesWithDek } = await import('./crypto');
		const compressed = await gzip(
			new TextEncoder().encode(JSON.stringify({ items: [{ title: 'no tmdb_id' }] }))
		);
		const ciphertext = await encryptBytesWithDek(compressed, dek);
		vi.stubGlobal(
			'fetch',
			vi.fn(
				async () =>
					new Response(ciphertext, {
						status: 200,
						headers: { 'X-Sync-Version': '1', 'X-Collection-Dek-Version': '1' }
					})
			)
		);

		expect(await fetchCollectionItems(COLL, dek)).toEqual([]);
	});
});

describe('syncCollectionItems — the 409 retry loop', () => {
	it('re-fetches, re-merges, and re-applies the mutation until the push lands', async () => {
		const dek = await importDek(await generateShareKey(), false);
		let serverVersion = 1;
		let serverItems: CollectionItem[] = [];
		let putAttempts = 0;

		vi.stubGlobal(
			'fetch',
			vi.fn(async (_url: string, init?: RequestInit) => {
				if (!init || init.method === undefined) {
					return pulledResponse(serverItems, dek, serverVersion);
				}
				if (init.method === 'PUT') {
					putAttempts++;
					// The first PUT loses the race — another writer's version has
					// already moved past what this attempt expected.
					if (putAttempts === 1) {
						serverVersion++;
						serverItems = [item({ tmdb_id: 999, title: 'a concurrent writer’s addition' })];
						return new Response(JSON.stringify({ error: 'Version conflict' }), { status: 409 });
					}
					serverVersion++;
					const body = await new Response(init.body as BodyInit).arrayBuffer();
					const { decryptBytesWithDek } = await import('./crypto');
					const plain = await decryptBytesWithDek(body, dek);
					const { gunzip } = await import('./gzip');
					const json = JSON.parse(new TextDecoder().decode(await gunzip(plain))) as {
						items: CollectionItem[];
					};
					serverItems = json.items;
					return Response.json({ version: serverVersion });
				}
				throw new Error('unexpected method');
			})
		);

		// Upsert-by-key, not blind append: applyMutation can run more than once
		// (once per retry), so it has to be idempotent the same way merge itself
		// is — re-applying "add this title" twice must not duplicate it.
		const result = await syncCollectionItems(COLL, dek, [], (merged) => {
			if (merged.some((i) => i.tmdb_id === 1)) return merged;
			return [...merged, item({ tmdb_id: 1, title: 'my new addition' })];
		});

		// Retried once, succeeded on the second attempt.
		expect(putAttempts).toBe(2);
		// Both this device's mutation AND the concurrent writer's addition
		// survive — the retry re-merged against the newer remote rather than
		// blindly overwriting it.
		const ids = result.map((i) => i.tmdb_id).sort();
		expect(ids).toEqual([1, 999]);
	});

	it('gives up after MAX_RETRIES straight conflicts', async () => {
		const dek = await importDek(await generateShareKey(), false);
		vi.stubGlobal(
			'fetch',
			vi.fn(async (_url: string, init?: RequestInit) => {
				if (!init || init.method === undefined) return pulledResponse([], dek, 1);
				return new Response(JSON.stringify({ error: 'Version conflict' }), { status: 409 });
			})
		);

		await expect(syncCollectionItems(COLL, dek, [], (merged) => merged)).rejects.toThrow(
			/repeated conflicts/i
		);
	});

	it('surfaces a rotated-key conflict distinctly from a version conflict', async () => {
		const dek = await importDek(await generateShareKey(), false);
		vi.stubGlobal(
			'fetch',
			vi.fn(async (_url: string, init?: RequestInit) => {
				if (!init || init.method === undefined) return pulledResponse([], dek, 1);
				return new Response(JSON.stringify({ error: 'Key rotated — re-fetch and retry' }), {
					status: 409
				});
			})
		);

		await expect(syncCollectionItems(COLL, dek, [], (m) => m)).rejects.toBeInstanceOf(
			CollectionKeyRotatedError
		);
	});
});
