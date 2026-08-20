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
import { getSyncDek, getUserPrivateKey } from './db';
import { ensureKeypair } from './keypair';
import { throwIfNotOk } from './http';

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
async function openCollectionKey(wrappedKey: string): Promise<string> {
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
