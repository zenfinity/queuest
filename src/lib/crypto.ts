const SALT_LEN = 16;
const IV_LEN = 12;
const PBKDF2_ITERATIONS = 200_000;

async function deriveKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
	const enc = new TextEncoder();
	const keyMaterial = await crypto.subtle.importKey(
		'raw',
		enc.encode(passphrase),
		'PBKDF2',
		false,
		['deriveKey']
	);
	return crypto.subtle.deriveKey(
		{ name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
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
	const salt = crypto.getRandomValues(new Uint8Array(SALT_LEN));
	const iv = crypto.getRandomValues(new Uint8Array(IV_LEN));
	const key = await deriveKey(passphrase, salt);

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

/**
 * Decrypt a buffer produced by `encrypt`.
 * Returns the original UTF-8 string, or throws if the passphrase is wrong.
 */
export async function decrypt(buffer: ArrayBuffer, passphrase: string): Promise<string> {
	const bytes = new Uint8Array(buffer);
	const salt = bytes.slice(0, SALT_LEN);
	const iv = bytes.slice(SALT_LEN, SALT_LEN + IV_LEN);
	const ciphertext = bytes.slice(SALT_LEN + IV_LEN);

	const key = await deriveKey(passphrase, salt);

	let plain: ArrayBuffer;
	try {
		plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
	} catch {
		throw new Error('Decryption failed — wrong passphrase or corrupted file.');
	}

	return new TextDecoder().decode(plain);
}
