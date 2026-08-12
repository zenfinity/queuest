// Client-side half of the auth design (#98, part of the #79 sync epic):
// splitting one passphrase into two independent keys so the server never
// holds anything that can decrypt user data.
//
//   MK      = PBKDF2(passphrase, salt, 600k)   — reuses crypto.ts's own KDF
//   authKey = MK, PBKDF2'd under a salt scoped to "this is for login"
//   encKey  = never computed as a standalone key at all — wrapping the DEK
//             reuses crypto.ts's encrypt()/decrypt() directly (passphrase in,
//             its own fresh random salt out, wire-layout self-contained).
//             Those two derivations already use different, uncorrelated
//             salts, which is what actually buys the independence property —
//             an HKDF layering step on top wouldn't add anything a second
//             salt doesn't already provide, and crypto.ts already has every
//             primitive this needs.
//
// The salt for authKey is derived from the email address itself
// (SHA-256 of the normalized address) rather than a server-issued random
// value. Salts don't need to be secret — only unique per account, which a
// stable per-email hash already guarantees — and deriving it from something
// the client already knows means signin needs no "look up my salt" round
// trip, which would otherwise be a user-enumeration oracle (a response that
// answers "does this email have an account" before the real signin check).
import { b64urlEncode } from './base64url';

const PBKDF2_ITERATIONS = 600_000;
const AUTH_KEY_BYTES = 32;

export function normalizeEmail(email: string): string {
	return email.trim().toLowerCase();
}

async function sha256(data: string): Promise<Uint8Array<ArrayBuffer>> {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(data));
	return new Uint8Array(digest) as Uint8Array<ArrayBuffer>;
}

/** Deterministic, non-secret per-account salt — see module comment. */
export async function emailSalt(email: string): Promise<Uint8Array<ArrayBuffer>> {
	return sha256(`queuest-auth-salt:${normalizeEmail(email)}`);
}

/**
 * Derives the value sent to the server to prove passphrase knowledge.
 * Deterministic for a given (email, passphrase) pair — signup and signin
 * both call this and always get the same authKey back, with no server
 * round trip needed to fetch a salt first.
 */
export async function deriveAuthKey(email: string, passphrase: string): Promise<string> {
	const salt = await emailSalt(email);
	const keyMaterial = await crypto.subtle.importKey(
		'raw',
		new TextEncoder().encode(passphrase),
		'PBKDF2',
		false,
		['deriveBits']
	);
	const bits = await crypto.subtle.deriveBits(
		{ name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
		keyMaterial,
		AUTH_KEY_BYTES * 8
	);
	return b64urlEncode(new Uint8Array(bits) as Uint8Array<ArrayBuffer>);
}
