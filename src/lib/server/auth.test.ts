import { describe, it, expect } from 'vitest';
import {
	hashAuthKey,
	constantTimeEqual,
	createSession,
	getSession,
	deleteSession,
	sessionCookieOptions,
	isValidEmail,
	SESSION_COOKIE
} from './auth';

// Minimal in-memory KVNamespace fake — just enough of the surface
// createSession/getSession/deleteSession actually use.
function makeFakeKv() {
	const store = new Map<string, string>();
	return {
		store,
		kv: {
			put: async (key: string, value: string) => {
				store.set(key, value);
			},
			get: async (key: string, type?: string) => {
				const v = store.get(key);
				if (v === undefined) return null;
				return type === 'json' ? JSON.parse(v) : v;
			},
			delete: async (key: string) => {
				store.delete(key);
			}
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
		} as any
	};
}

describe('hashAuthKey', () => {
	it('is deterministic', async () => {
		const a = await hashAuthKey('some-auth-key');
		const b = await hashAuthKey('some-auth-key');
		expect(a).toBe(b);
	});

	it('differs for different input', async () => {
		const a = await hashAuthKey('some-auth-key');
		const b = await hashAuthKey('some-other-key');
		expect(a).not.toBe(b);
	});

	it('never returns the input unchanged', async () => {
		const hash = await hashAuthKey('some-auth-key');
		expect(hash).not.toBe('some-auth-key');
	});
});

describe('constantTimeEqual', () => {
	it('returns true for identical strings', () => {
		expect(constantTimeEqual('abc123', 'abc123')).toBe(true);
	});

	it('returns false for different strings of the same length', () => {
		expect(constantTimeEqual('abc123', 'abc124')).toBe(false);
	});

	it('returns false for different lengths', () => {
		expect(constantTimeEqual('abc', 'abcd')).toBe(false);
	});
});

describe('session lifecycle', () => {
	it('createSession then getSession round-trips the record', async () => {
		const { kv } = makeFakeKv();
		const token = await createSession(kv, { userId: 'u1', email: 'user@example.com' });
		expect(typeof token).toBe('string');
		expect(token.length).toBeGreaterThan(20);

		const session = await getSession(kv, token);
		expect(session).toEqual({ userId: 'u1', email: 'user@example.com' });
	});

	it('getSession returns null for an unknown token', async () => {
		const { kv } = makeFakeKv();
		expect(await getSession(kv, 'nonexistent')).toBeNull();
	});

	it('getSession returns null for a malformed stored record', async () => {
		const { kv, store } = makeFakeKv();
		store.set('sess:bad', JSON.stringify({ userId: 123 })); // wrong type, no email
		expect(await getSession(kv, 'bad')).toBeNull();
	});

	it('deleteSession removes the record', async () => {
		const { kv } = makeFakeKv();
		const token = await createSession(kv, { userId: 'u1', email: 'user@example.com' });
		await deleteSession(kv, token);
		expect(await getSession(kv, token)).toBeNull();
	});

	it('stores session keys under a sess: prefix distinct from share blobs (s:)', async () => {
		const { kv, store } = makeFakeKv();
		const token = await createSession(kv, { userId: 'u1', email: 'user@example.com' });
		expect(store.has(`sess:${token}`)).toBe(true);
	});
});

describe('sessionCookieOptions', () => {
	it('is HttpOnly, Secure, SameSite=Lax, path=/', () => {
		const opts = sessionCookieOptions();
		expect(opts.httpOnly).toBe(true);
		expect(opts.secure).toBe(true);
		expect(opts.sameSite).toBe('lax');
		expect(opts.path).toBe('/');
	});
});

describe('isValidEmail', () => {
	it('accepts a normal address', () => {
		expect(isValidEmail('user@example.com')).toBe(true);
	});

	it.each([
		['no @', 'userexample.com'],
		['no domain', 'user@'],
		['no local part', '@example.com'],
		['spaces', 'user @example.com'],
		['not a string', 42],
		['empty', '']
	])('rejects %s', (_label, value) => {
		expect(isValidEmail(value)).toBe(false);
	});

	it('rejects an absurdly long address', () => {
		expect(isValidEmail('a'.repeat(300) + '@example.com')).toBe(false);
	});
});

describe('SESSION_COOKIE', () => {
	it('is a stable name', () => {
		expect(SESSION_COOKIE).toBe('sq_session');
	});
});
