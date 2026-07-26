import { b64urlEncode, b64urlDecode } from './base64url';

const SALT_LEN = 16;
const IV_LEN = 12;
const PBKDF2_ITERATIONS = 600_000;
const PBKDF2_LEGACY_ITERATIONS = 200_000;

async function deriveKey(
	passphrase: string,
	salt: Uint8Array<ArrayBuffer>,
	iterations: number
): Promise<CryptoKey> {
	const enc = new TextEncoder();
	const keyMaterial = await crypto.subtle.importKey(
		'raw',
		enc.encode(passphrase),
		'PBKDF2',
		false,
		['deriveKey']
	);
	return crypto.subtle.deriveKey(
		{ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
		keyMaterial,
		{ name: 'AES-GCM', length: 256 },
		false,
		['encrypt', 'decrypt']
	);
}

/**
 * Encrypt a UTF-8 string with a passphrase.
 * Output layout: [salt 16B][iv 12B][ciphertext]
 */
export async function encrypt(data: string, passphrase: string): Promise<ArrayBuffer> {
	const salt = crypto.getRandomValues(new Uint8Array(new ArrayBuffer(SALT_LEN)));
	const iv = crypto.getRandomValues(new Uint8Array(new ArrayBuffer(IV_LEN)));
	const key = await deriveKey(passphrase, salt, PBKDF2_ITERATIONS);

	const ciphertext = await crypto.subtle.encrypt(
		{ name: 'AES-GCM', iv },
		key,
		new TextEncoder().encode(data)
	);

	const out = new Uint8Array(SALT_LEN + IV_LEN + ciphertext.byteLength);
	out.set(salt, 0);
	out.set(iv, SALT_LEN);
	out.set(new Uint8Array(ciphertext), SALT_LEN + IV_LEN);
	return out.buffer as ArrayBuffer;
}

/**
 * Decrypt a buffer produced by `encrypt`.
 * Tries current iteration count first, falls back to legacy count for
 * files encrypted before the iteration bump.
 */
export async function decrypt(buffer: ArrayBuffer, passphrase: string): Promise<string> {
	const salt = new Uint8Array(buffer, 0, SALT_LEN);
	const iv = new Uint8Array(buffer, SALT_LEN, IV_LEN);
	const ciphertext = new Uint8Array(buffer, SALT_LEN + IV_LEN);

	for (const iterations of [PBKDF2_ITERATIONS, PBKDF2_LEGACY_ITERATIONS]) {
		const key = await deriveKey(passphrase, salt, iterations);
		try {
			const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
			return new TextDecoder().decode(plain);
		} catch {
			// try next iteration count
		}
	}
	throw new Error('Decryption failed — wrong passphrase or corrupted file.');
}

// ── Key-based sharing (random key in URL fragment, no PBKDF2) ─────────────────

export async function generateShareKey(): Promise<string> {
	const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, [
		'encrypt',
		'decrypt'
	]);
	const raw = await crypto.subtle.exportKey('raw', key);
	return b64urlEncode(new Uint8Array(raw as ArrayBuffer));
}

export async function encryptWithKey(data: string, keyB64url: string): Promise<ArrayBuffer> {
	const key = await crypto.subtle.importKey('raw', b64urlDecode(keyB64url), 'AES-GCM', false, [
		'encrypt'
	]);
	const iv = crypto.getRandomValues(new Uint8Array(new ArrayBuffer(IV_LEN)));
	const ciphertext = await crypto.subtle.encrypt(
		{ name: 'AES-GCM', iv },
		key,
		new TextEncoder().encode(data)
	);
	const out = new Uint8Array(IV_LEN + ciphertext.byteLength);
	out.set(iv, 0);
	out.set(new Uint8Array(ciphertext), IV_LEN);
	return out.buffer as ArrayBuffer;
}

export async function decryptWithKey(buffer: ArrayBuffer, keyB64url: string): Promise<string> {
	const iv = new Uint8Array(buffer, 0, IV_LEN);
	const ciphertext = new Uint8Array(buffer, IV_LEN);
	const key = await crypto.subtle.importKey('raw', b64urlDecode(keyB64url), 'AES-GCM', false, [
		'decrypt'
	]);
	let plain: ArrayBuffer;
	try {
		plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
	} catch {
		throw new Error('Could not decrypt — the share link may be corrupted.');
	}
	return new TextDecoder().decode(plain);
}
