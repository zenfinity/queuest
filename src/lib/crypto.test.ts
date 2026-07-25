import { describe, it, expect } from 'vitest';
import { encrypt, decrypt, generateShareKey, encryptWithKey, decryptWithKey } from './crypto';

const SALT_LEN = 16;
const IV_LEN = 12;
const LEGACY_ITERATIONS = 200_000;

// Mirrors crypto.ts's private deriveKey(), used here only to construct a
// buffer encrypted at the legacy iteration count for the fallback test.
async function deriveLegacyKey(
	passphrase: string,
	salt: Uint8Array<ArrayBuffer>
): Promise<CryptoKey> {
	const keyMaterial = await crypto.subtle.importKey(
		'raw',
		new TextEncoder().encode(passphrase),
		'PBKDF2',
		false,
		['deriveKey']
	);
	return crypto.subtle.deriveKey(
		{ name: 'PBKDF2', salt, iterations: LEGACY_ITERATIONS, hash: 'SHA-256' },
		keyMaterial,
		{ name: 'AES-GCM', length: 256 },
		false,
		['encrypt', 'decrypt']
	);
}

async function encryptLegacy(data: string, passphrase: string): Promise<ArrayBuffer> {
	const salt = crypto.getRandomValues(new Uint8Array(SALT_LEN));
	const iv = crypto.getRandomValues(new Uint8Array(IV_LEN));
	const key = await deriveLegacyKey(passphrase, salt);
	const ciphertext = await crypto.subtle.encrypt(
		{ name: 'AES-GCM', iv },
		key,
		new TextEncoder().encode(data)
	);
	const out = new Uint8Array(SALT_LEN + IV_LEN + ciphertext.byteLength);
	out.set(salt, 0);
	out.set(iv, SALT_LEN);
	out.set(new Uint8Array(ciphertext), SALT_LEN + IV_LEN);
	return out.buffer;
}

describe('encrypt / decrypt (passphrase-based)', () => {
	it('round-trips a UTF-8 string', async () => {
		const plaintext = JSON.stringify({ hello: 'world', n: 42 });
		const buf = await encrypt(plaintext, 'correct horse battery staple');
		const out = await decrypt(buf, 'correct horse battery staple');
		expect(out).toBe(plaintext);
	});

	it('rejects the wrong passphrase', async () => {
		const buf = await encrypt('secret data', 'right passphrase');
		await expect(decrypt(buf, 'wrong passphrase')).rejects.toThrow(/Decryption failed/);
	});

	it('falls back to the legacy PBKDF2 iteration count for older files', async () => {
		// Files encrypted before the #74 iteration bump used 200k iterations;
		// decrypt() must still be able to open them.
		const plaintext = 'pre-bump export';
		const buf = await encryptLegacy(plaintext, 'my passphrase');
		const out = await decrypt(buf, 'my passphrase');
		expect(out).toBe(plaintext);
	});
});

describe('generateShareKey / encryptWithKey / decryptWithKey', () => {
	it('round-trips a UTF-8 string with a generated key', async () => {
		const key = await generateShareKey();
		const plaintext = JSON.stringify({ v: 1, items: [] });
		const buf = await encryptWithKey(plaintext, key);
		const out = await decryptWithKey(buf, key);
		expect(out).toBe(plaintext);
	});

	it('rejects a share blob decrypted with the wrong key', async () => {
		const key = await generateShareKey();
		const wrongKey = await generateShareKey();
		const buf = await encryptWithKey('secret', key);
		await expect(decryptWithKey(buf, wrongKey)).rejects.toThrow(/Could not decrypt/);
	});

	it('produces a URL-safe key with no padding characters', async () => {
		const key = await generateShareKey();
		expect(key).not.toMatch(/[+/=]/);
	});
});
