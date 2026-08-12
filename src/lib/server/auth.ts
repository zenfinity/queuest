import type { KVNamespace } from '@cloudflare/workers-types';
import { b64urlEncode } from '../base64url';

export const SESSION_COOKIE = 'sq_session';
const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days
const SESSION_TOKEN_BYTES = 32;

export interface SessionRecord {
	userId: string;
	email: string;
}

/** Server stores only this — never the authKey itself. */
export async function hashAuthKey(authKey: string): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(authKey));
	return b64urlEncode(new Uint8Array(digest) as Uint8Array<ArrayBuffer>);
}

/** Timing-safe comparison for the auth_key_hash check — a raw `===` would leak
 * how many leading bytes matched through response timing. */
export function constantTimeEqual(a: string, b: string): boolean {
	if (a.length !== b.length) return false;
	let diff = 0;
	for (let i = 0; i < a.length; i++) {
		diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
	}
	return diff === 0;
}

function makeSessionToken(): string {
	return b64urlEncode(crypto.getRandomValues(new Uint8Array(SESSION_TOKEN_BYTES)));
}

/** Creates a session in KV (prefixed distinctly from share-link blobs, which
 * live in the same namespace) and returns the token to set as a cookie. */
export async function createSession(kv: KVNamespace, record: SessionRecord): Promise<string> {
	const token = makeSessionToken();
	await kv.put(`sess:${token}`, JSON.stringify(record), { expirationTtl: SESSION_TTL_SECONDS });
	return token;
}

export async function getSession(kv: KVNamespace, token: string): Promise<SessionRecord | null> {
	const raw = await kv.get(`sess:${token}`, 'json');
	if (!raw || typeof raw !== 'object') return null;
	const rec = raw as Record<string, unknown>;
	if (typeof rec.userId !== 'string' || typeof rec.email !== 'string') return null;
	return { userId: rec.userId, email: rec.email };
}

export async function deleteSession(kv: KVNamespace, token: string): Promise<void> {
	await kv.delete(`sess:${token}`);
}

export function sessionCookieOptions(maxAge: number = SESSION_TTL_SECONDS) {
	return {
		path: '/',
		httpOnly: true,
		secure: true,
		sameSite: 'lax' as const,
		maxAge
	};
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(email: unknown): email is string {
	return typeof email === 'string' && email.length <= 254 && EMAIL_RE.test(email);
}
