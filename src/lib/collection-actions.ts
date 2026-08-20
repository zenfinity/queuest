// Client actions for collaborative Collections (#189), following the
// established `*ActionDeps` pattern (see queue-actions.ts / sync-account-
// actions.ts): plain async functions, injected setBusy/setError callbacks,
// no runes — the calling component owns all reactive state.
import {
	generateShareKey,
	wrapKeyForMember,
	unwrapKeyForMember,
	encryptBytesWithDek,
	decryptBytesWithDek,
	importDek
} from './crypto';
import { b64urlEncode } from './base64url';
import { getSyncDek, getUserPrivateKey, removeItem } from './db';
import { ensureKeypair } from './keypair';
import { throwIfNotOk } from './http';
import { syncCollectionItems, fetchCollectionItems, type CollectionItem } from './collection-sync';
import type { WatchlistItem } from './types';

export interface CollectionActionDeps {
	setBusy: (busy: boolean) => void;
	setError: (error: string) => void;
}

export interface SharedCollection {
	id: string;
	name: string;
	ownerUserId: string;
	role: 'owner' | 'member';
	wrappedKey: string;
	dekVersion: number;
	memberDekVersion: number;
}

export interface CollectionMember {
	userId: string;
	email: string;
	role: 'owner' | 'member';
	dekVersion: number;
	publicKey: string | null;
	joinedAt: string;
}

async function requirePersonalDek(): Promise<CryptoKey> {
	const dek = await getSyncDek();
	if (!dek) throw new Error('Turn on sync before using shared collections.');
	return dek;
}

/**
 * Unwraps a collection's DEK using this account's private key. Every wrapped
 * key — whether minted at creation, at invite redemption, or by a rotation —
 * is RSA-wrapped under the holder's public key, so one path covers all three.
 */
export async function openCollectionKey(wrappedKey: string): Promise<string> {
	const priv = await getUserPrivateKey();
	if (!priv) throw new Error('This device is missing your account key. Sign in again.');
	return unwrapKeyForMember(wrappedKey, priv);
}

export async function listCollections(deps: CollectionActionDeps): Promise<SharedCollection[]> {
	deps.setBusy(true);
	deps.setError('');
	try {
		const res = await fetch('/api/collections');
		await throwIfNotOk(res);
		return ((await res.json()) as { collections: SharedCollection[] }).collections;
	} catch (e) {
		deps.setError(e instanceof Error ? e.message : 'Could not load shared collections.');
		return [];
	} finally {
		deps.setBusy(false);
	}
}

/**
 * Creates a shared collection. The DEK is generated here and wrapped under
 * this account's own public key — the same format every other member's copy
 * uses, so nothing about the creator's copy is special.
 */
export async function createCollection(
	name: string,
	deps: CollectionActionDeps
): Promise<SharedCollection | null> {
	deps.setBusy(true);
	deps.setError('');
	try {
		const personalDek = await requirePersonalDek();
		const publicKey = await ensureKeypair(personalDek);

		const dek = await generateShareKey();
		const wrappedKey = await wrapKeyForMember(dek, publicKey);

		const res = await fetch('/api/collections', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ name, wrappedKey })
		});
		await throwIfNotOk(res);
		return (await res.json()) as SharedCollection;
	} catch (e) {
		deps.setError(e instanceof Error ? e.message : 'Could not create the collection.');
		return null;
	} finally {
		deps.setBusy(false);
	}
}

/**
 * Mints an invite link. The Collection DEK travels in the URL *fragment*, so
 * it never reaches the server — same construction as share links (#96). The
 * token identifies the invite; the fragment carries the key that makes it
 * useful, and the two are only ever combined in a recipient's browser.
 */
export async function createInvite(
	collection: SharedCollection,
	origin: string,
	deps: CollectionActionDeps
): Promise<string | null> {
	deps.setBusy(true);
	deps.setError('');
	try {
		const dek = await openCollectionKey(collection.wrappedKey);

		const res = await fetch(`/api/collections/${collection.id}/invites`, { method: 'POST' });
		await throwIfNotOk(res);
		const { token } = (await res.json()) as { token: string };

		return `${origin}/collections/join/${token}#${dek}`;
	} catch (e) {
		deps.setError(e instanceof Error ? e.message : 'Could not create an invite link.');
		return null;
	} finally {
		deps.setBusy(false);
	}
}

export async function revokeInvite(
	collectionId: string,
	inviteId: string,
	deps: CollectionActionDeps
): Promise<boolean> {
	deps.setBusy(true);
	deps.setError('');
	try {
		const res = await fetch(
			`/api/collections/${collectionId}/invites?id=${encodeURIComponent(inviteId)}`,
			{ method: 'DELETE' }
		);
		await throwIfNotOk(res);
		return true;
	} catch (e) {
		deps.setError(e instanceof Error ? e.message : 'Could not revoke the invite.');
		return false;
	} finally {
		deps.setBusy(false);
	}
}

/**
 * Redeems an invite. `dek` comes from the link's fragment — the caller reads
 * it from `location.hash`, so it is never sent anywhere; only this account's
 * own wrapped copy is.
 */
export async function joinCollection(
	token: string,
	dek: string,
	deps: CollectionActionDeps
): Promise<{ collectionId: string; alreadyMember?: boolean } | null> {
	deps.setBusy(true);
	deps.setError('');
	try {
		const personalDek = await requirePersonalDek();
		const publicKey = await ensureKeypair(personalDek);
		const wrappedKey = await wrapKeyForMember(dek, publicKey);

		const res = await fetch(`/api/collections/invites/${encodeURIComponent(token)}`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ wrappedKey })
		});
		await throwIfNotOk(res);
		return (await res.json()) as { collectionId: string; alreadyMember?: boolean };
	} catch (e) {
		deps.setError(e instanceof Error ? e.message : 'Could not join the collection.');
		return null;
	} finally {
		deps.setBusy(false);
	}
}

export async function listMembers(
	collectionId: string,
	deps: CollectionActionDeps
): Promise<CollectionMember[]> {
	deps.setBusy(true);
	deps.setError('');
	try {
		const res = await fetch(`/api/collections/${collectionId}/members`);
		await throwIfNotOk(res);
		return ((await res.json()) as { members: CollectionMember[] }).members;
	} catch (e) {
		deps.setError(e instanceof Error ? e.message : 'Could not load members.');
		return [];
	} finally {
		deps.setBusy(false);
	}
}

/**
 * Removes a member and rotates the Collection DEK.
 *
 * Deleting a member's row revokes nothing on its own — symmetric group keys
 * have no partial revocation, and a removed member may have kept the raw DEK.
 * So removal means a new key, the payload re-encrypted under it, and a fresh
 * wrapped key for everyone who remains.
 *
 * All of that is assembled here and posted as one request, which the server
 * applies in a single batch. That is what makes an interrupted rotation
 * harmless: nothing is written until everything is ready, so a closed tab
 * midway leaves the collection exactly as it was rather than re-encrypted
 * under a key some members have no copy of.
 */
export async function removeMemberAndRotate(
	collection: SharedCollection,
	removeUserId: string,
	deps: CollectionActionDeps
): Promise<boolean> {
	deps.setBusy(true);
	deps.setError('');
	try {
		const members = await listMembers(collection.id, {
			setBusy: () => {},
			setError: () => {}
		});
		const remaining = members.filter((m) => m.userId !== removeUserId);

		// Refuse rather than silently drop anyone: a member with no published
		// public key cannot be re-keyed, and rotating without them would lock
		// them out permanently with no way back.
		const unkeyed = remaining.filter((m) => !m.publicKey);
		if (unkeyed.length) {
			throw new Error(
				`${unkeyed.map((m) => m.email).join(', ')} hasn't signed in since sharing was added, so they can't be re-keyed yet. Ask them to open Queuest, then try again.`
			);
		}

		const oldDek = await openCollectionKey(collection.wrappedKey);
		const newDek = await generateShareKey();

		// Re-encrypt the payload under the new key. An empty collection has no
		// blob yet; a minimal ciphertext still needs writing so the stored
		// generation matches the members' new keys.
		const current = await fetch(`/api/collections/${collection.id}/blob`);
		await throwIfNotOk(current);
		const currentBytes = await current.arrayBuffer();

		const oldKey = await importDek(oldDek, false);
		const newKey = await importDek(newDek, false);
		const plaintext = currentBytes.byteLength
			? await decryptBytesWithDek(currentBytes, oldKey)
			: (new Uint8Array(0) as Uint8Array<ArrayBuffer>);
		const reencrypted = b64urlEncode(
			new Uint8Array(await encryptBytesWithDek(plaintext, newKey)) as Uint8Array<ArrayBuffer>
		);

		const wrappedKeys: Record<string, string> = {};
		for (const m of remaining) {
			wrappedKeys[m.userId] = await wrapKeyForMember(newDek, m.publicKey as string);
		}

		const res = await fetch(`/api/collections/${collection.id}/members`, {
			method: 'DELETE',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ userId: removeUserId, blob: reencrypted, wrappedKeys })
		});
		await throwIfNotOk(res);
		return true;
	} catch (e) {
		deps.setError(e instanceof Error ? e.message : 'Could not remove that member.');
		return false;
	} finally {
		deps.setBusy(false);
	}
}

/**
 * Promotes a personal collection (a `queue_tag` grouping, see queue-actions.ts)
 * into a shared one. This is the *only* way a shared collection comes into
 * existence — there is deliberately no "create a shared collection from
 * scratch" path, because two independently-created things both called
 * "Collections" is exactly the confusion #145 flagged.
 *
 * The move is one-way and the items genuinely relocate: they are seeded into
 * the collection blob and then tombstoned locally, so the shared copy is the
 * single source of truth and a member's watch state lives in the per-account
 * `watch` map rather than a local `watched_at`. Callers must warn the user
 * before invoking this — once promoted, the titles live only on the server,
 * reachable solely through this account's keys.
 *
 * Ordering is deliberate: the blob is written *before* anything is deleted
 * locally, so a failure at any step leaves the personal collection intact.
 */
export async function promoteCollection(
	name: string,
	items: WatchlistItem[],
	deps: CollectionActionDeps
): Promise<SharedCollection | null> {
	deps.setBusy(true);
	deps.setError('');
	try {
		const tagged = items.filter((i) => i.queue_tag === name && !i.deleted_at);

		const personalDek = await requirePersonalDek();
		const publicKey = await ensureKeypair(personalDek);

		const dekB64 = await generateShareKey();
		const wrappedKey = await wrapKeyForMember(dekB64, publicKey);

		const res = await fetch('/api/collections', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ name, wrappedKey })
		});
		await throwIfNotOk(res);
		const collection = (await res.json()) as SharedCollection;

		// The creator is the first member, so their account id is the owner id
		// the server just echoed back — no extra round trip to learn who we are.
		const me = collection.ownerUserId;
		const seeded = tagged.map((item) => toCollectionItem(item, me));

		const dek = await importDek(dekB64, false);
		await syncCollectionItems(collection.id, dek, [], () => seeded);

		// Only now that the blob is durably written do the local copies go. Soft
		// deletes, so the removal propagates to this account's other devices
		// through the normal personal-sync tombstone path rather than silently
		// reappearing on the next pull.
		for (const item of tagged) await removeItem(item.id);

		return collection;
	} catch (e) {
		deps.setError(e instanceof Error ? e.message : 'Could not share this collection.');
		return null;
	} finally {
		deps.setBusy(false);
	}
}

/**
 * Reshapes a personal queue item for a collection blob. Two fields change
 * meaning in the move: `watched_at` is a single user's fact, so it becomes
 * this account's entry in the per-member `watch` map, and authorship is
 * recorded explicitly since a shared item can no longer be assumed to be the
 * reader's own. The local `id` and `queue_tag` are dropped — a collection
 * item's identity is `tmdb_id`+`media_type`, and its grouping is the
 * collection itself.
 */
function toCollectionItem(item: WatchlistItem, accountId: string): CollectionItem {
	const { id: _id, queue_tag: _tag, watched_at, ...rest } = item;
	return {
		...rest,
		watched_at,
		watch: watched_at ? { [accountId]: watched_at } : {},
		added_by_account_id: accountId
	} as CollectionItem;
}

/**
 * Loads a shared collection's items for the queue view. Resolves the
 * collection's DEK from its wrapped copy, then pulls and decrypts — a
 * read-only fetch, no push, so opening a collection never risks colliding
 * with a concurrent writer.
 */
export async function loadCollectionItems(
	collection: SharedCollection,
	deps: CollectionActionDeps
): Promise<CollectionItem[]> {
	deps.setBusy(true);
	deps.setError('');
	try {
		const dekB64 = await openCollectionKey(collection.wrappedKey);
		const dek = await importDek(dekB64, false);
		return await fetchCollectionItems(collection.id, dek);
	} catch (e) {
		deps.setError(e instanceof Error ? e.message : 'Could not load this collection.');
		return [];
	} finally {
		deps.setBusy(false);
	}
}

/**
 * Toggles this account's own watch mark on one item and pushes the change.
 * Only this account's entry in the `watch` map is touched — see
 * mergeCollectionWatch for why a whole-item write would risk clobbering
 * someone else's mark on retry.
 */
export async function toggleCollectionWatched(
	collection: SharedCollection,
	current: CollectionItem[],
	item: CollectionItem,
	myAccountId: string,
	watched: boolean,
	deps: CollectionActionDeps
): Promise<CollectionItem[] | null> {
	deps.setBusy(true);
	deps.setError('');
	try {
		const dekB64 = await openCollectionKey(collection.wrappedKey);
		const dek = await importDek(dekB64, false);
		return await syncCollectionItems(collection.id, dek, current, (merged) =>
			merged.map((i) => {
				if (i.tmdb_id !== item.tmdb_id || i.media_type !== item.media_type) return i;
				const watch = { ...(i.watch ?? {}) };
				if (watched) watch[myAccountId] = new Date().toISOString();
				else delete watch[myAccountId];
				return { ...i, watch };
			})
		);
	} catch (e) {
		deps.setError(e instanceof Error ? e.message : 'Could not save that. Try again.');
		return null;
	} finally {
		deps.setBusy(false);
	}
}

/**
 * Renames a shared collection. Owner-only — enforced server-side, since the
 * name is a property every member sees, not a personal preference.
 */
export async function renameSharedCollection(
	collection: SharedCollection,
	name: string,
	deps: CollectionActionDeps
): Promise<SharedCollection | null> {
	deps.setBusy(true);
	deps.setError('');
	try {
		const res = await fetch(`/api/collections/${collection.id}`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ name })
		});
		await throwIfNotOk(res);
		const { name: savedName } = (await res.json()) as { id: string; name: string };
		return { ...collection, name: savedName };
	} catch (e) {
		deps.setError(e instanceof Error ? e.message : 'Could not rename this list.');
		return null;
	} finally {
		deps.setBusy(false);
	}
}
