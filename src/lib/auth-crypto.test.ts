import { describe, it, expect } from 'vitest';
import { normalizeEmail, emailSalt, deriveAuthKey } from './auth-crypto';

describe('normalizeEmail', () => {
	it('lowercases and trims', () => {
		expect(normalizeEmail('  User@Example.com  ')).toBe('user@example.com');
	});
});

describe('emailSalt', () => {
	it('is deterministic for the same email', async () => {
		const a = await emailSalt('user@example.com');
		const b = await emailSalt('user@example.com');
		expect(Array.from(a)).toEqual(Array.from(b));
	});

	it('is normalization-insensitive (same account, different casing/whitespace)', async () => {
		const a = await emailSalt('User@Example.com');
		const b = await emailSalt('  user@example.com  ');
		expect(Array.from(a)).toEqual(Array.from(b));
	});

	it('differs across accounts', async () => {
		const a = await emailSalt('user1@example.com');
		const b = await emailSalt('user2@example.com');
		expect(Array.from(a)).not.toEqual(Array.from(b));
	});
});

describe('deriveAuthKey', () => {
	it('is deterministic for the same email + passphrase', async () => {
		const a = await deriveAuthKey('user@example.com', 'hunter2');
		const b = await deriveAuthKey('user@example.com', 'hunter2');
		expect(a).toBe(b);
	});

	it('differs for a different passphrase', async () => {
		const a = await deriveAuthKey('user@example.com', 'hunter2');
		const b = await deriveAuthKey('user@example.com', 'hunter3');
		expect(a).not.toBe(b);
	});

	it('differs for a different email, even with the same passphrase', async () => {
		const a = await deriveAuthKey('user1@example.com', 'hunter2');
		const b = await deriveAuthKey('user2@example.com', 'hunter2');
		expect(a).not.toBe(b);
	});

	it('is unaffected by email casing/whitespace (same account)', async () => {
		const a = await deriveAuthKey('User@Example.com', 'hunter2');
		const b = await deriveAuthKey('  user@example.com  ', 'hunter2');
		expect(a).toBe(b);
	});

	it('returns a URL-safe base64 string with no padding', async () => {
		const key = await deriveAuthKey('user@example.com', 'hunter2');
		expect(key).toMatch(/^[A-Za-z0-9_-]+$/);
	});
});
