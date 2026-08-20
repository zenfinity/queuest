// Per-account keypair lifecycle (#189). Collaborative Collections need one
// member to encrypt a Collection DEK *for* another — which symmetric keys
// cannot express, since a personal sync DEK never leaves its own browser.
//
// The private key is wrapped under the personal sync DEK before it is stored
// server-side, so it rides that key's lifecycle: passphrase changes and
// account recovery re-wrap only the personal DEK, and the keypair (and so
// every collection the account belongs to) follows without extra bookkeeping.
import {
	generateKeypair,
	importPrivateKey,
	encryptBytesWithDek,
	decryptBytesWithDek,
	KEYPAIR_ALGORITHM
} from './crypto';
import { b64urlEncode, b64urlDecode } from './base64url';
import { setUserPrivateKey } from './db';
import { throwIfNotOk } from './http';

interface StoredKeypair {
	publicKey: string;
	wrappedPrivateKey: string;
	algorithm: string;
}

/**
 * Ensures the account has a keypair, and leaves the unwrapped private key in
 * IndexedDB for this device.
 *
 * Idempotent and safe to call on every sign-in: an account that already has a
 * keypair just has it fetched and unwrapped. An account predating keypairs —
 * or one signing in on a fresh device — generates or retrieves as needed.
 *
 * Returns the public key so callers can wrap for themselves without a second
 * round trip.
 */
export async function ensureKeypair(personalDek: CryptoKey): Promise<string> {
	const res = await fetch('/api/auth/keys');
	await throwIfNotOk(res);
	const { keypair } = (await res.json()) as { keypair: StoredKeypair | null };

	if (keypair) {
		const pkcs8 = await decryptBytesWithDek(
			b64urlDecode(keypair.wrappedPrivateKey).buffer as ArrayBuffer,
			personalDek
		);
		await setUserPrivateKey(await importPrivateKey(pkcs8));
		return keypair.publicKey;
	}

	// No keypair yet — mint one and publish it.
	const { publicKey, privateKeyPkcs8 } = await generateKeypair();
	const wrappedPrivateKey = b64urlEncode(
		new Uint8Array(
			await encryptBytesWithDek(privateKeyPkcs8, personalDek)
		) as Uint8Array<ArrayBuffer>
	);

	const put = await fetch('/api/auth/keys', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ publicKey, wrappedPrivateKey, algorithm: KEYPAIR_ALGORITHM })
	});
	await throwIfNotOk(put);

	// The endpoint is create-only and returns whatever is actually stored, so
	// two devices racing to backfill the same account converge on one keypair
	// rather than one silently overwriting the other. Trust the response, not
	// what we just generated.
	const stored = (await put.json()) as { keypair: StoredKeypair; created: boolean };
	if (!stored.created) {
		const pkcs8 = await decryptBytesWithDek(
			b64urlDecode(stored.keypair.wrappedPrivateKey).buffer as ArrayBuffer,
			personalDek
		);
		await setUserPrivateKey(await importPrivateKey(pkcs8));
		return stored.keypair.publicKey;
	}

	await setUserPrivateKey(await importPrivateKey(privateKeyPkcs8));
	return publicKey;
}
