import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as db from './db';
import { generateRecoveryCode } from './auth-crypto';
import { encrypt, generateShareKey } from './crypto';
import { b64urlEncode } from './base64url';
import { isSyncEnabled, disableSync, getSyncStatus, enableSyncWithDek, syncNow } from './sync';
import {
	signUp,
	signIn,
	recoverAccount,
	finishRecovery,
	signOut,
	deleteAccount
} from './sync-account-actions';

function makeDeps() {
	let busy = false;
	let error = '';
	return {
		deps: {
			setBusy: (b: boolean) => (busy = b),
			setError: (e: string) => (error = e)
		},
		getBusy: () => busy,
		getError: () => error
	};
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
	return new Response(JSON.stringify(body), {
		status: 200,
		headers: { 'Content-Type': 'application/json' },
		...init
	});
}

/** Handles GET/PUT /api/sync/blob the way the real endpoint would for an
 * empty-then-first-push cycle, so syncNow() (fired-and-forgotten by every
 * successful auth action) resolves cleanly instead of leaking an unhandled
 * rejection into a later test. */
function blobResponse(init?: RequestInit): Response {
	if (init?.method === 'PUT') {
		return jsonResponse({ version: 1 }, { headers: { Date: new Date().toUTCString() } });
	}
	return new Response(new ArrayBuffer(0), { headers: { 'X-Sync-Version': '0' } });
}

beforeEach(async () => {
	await db.replaceAll([]);
	await db.setServices([]);
	await disableSync();
	vi.restoreAllMocks();
});

describe('signUp', () => {
	it('signs up, stores a recovery code, and enables sync', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
				const url = String(input);
				if (url.includes('/api/auth/signup')) return jsonResponse({ email: 'user@example.com' });
				if (url.includes('/api/auth/recovery-code')) return new Response(null, { status: 204 });
				if (url.includes('/api/sync/blob')) return blobResponse(init);
				throw new Error(`unexpected fetch: ${url}`);
			})
		);

		const { deps, getBusy, getError } = makeDeps();
		const result = await signUp('User@Example.com', 'correct horse battery staple', deps);

		expect(result?.email).toBe('user@example.com');
		expect(result?.recoveryCode).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){5}$/);
		expect(getError()).toBe('');
		expect(getBusy()).toBe(false);
		expect(await isSyncEnabled()).toBe(true);
		expect(getSyncStatus().email).toBe('user@example.com');
		await syncNow(); // join the fire-and-forget sync this action kicked off, so it can't leak into the next test
	});

	it('reports the server error and does not enable sync when signup fails', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () =>
				jsonResponse({ error: 'An account with this email already exists' }, { status: 409 })
			)
		);

		const { deps, getError } = makeDeps();
		const result = await signUp('user@example.com', 'pw', deps);

		expect(result).toBeNull();
		expect(getError()).toBe('An account with this email already exists');
		expect(await isSyncEnabled()).toBe(false);
	});
});

describe('signIn', () => {
	it('decrypts the returned wrappedDek and enables sync', async () => {
		const passphrase = 'correct horse battery staple';
		const dek = await generateShareKey();
		const wrappedDek = b64urlEncode(new Uint8Array(await encrypt(dek, passphrase)));

		vi.stubGlobal(
			'fetch',
			vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
				const url = String(input);
				if (url.includes('/api/auth/signin')) {
					return jsonResponse({ email: 'user@example.com', wrappedDek });
				}
				if (url.includes('/api/sync/blob')) return blobResponse(init);
				throw new Error(`unexpected fetch: ${url}`);
			})
		);

		const { deps, getError } = makeDeps();
		const ok = await signIn('user@example.com', passphrase, deps);

		expect(ok).toBe(true);
		expect(getError()).toBe('');
		expect(await isSyncEnabled()).toBe(true);
		await syncNow(); // join the fire-and-forget sync this action kicked off
	});

	it('fails generically on the wrong passphrase (decrypt fails) without enabling sync', async () => {
		const dek = await generateShareKey();
		const wrappedDek = b64urlEncode(new Uint8Array(await encrypt(dek, 'right-passphrase')));

		vi.stubGlobal(
			'fetch',
			vi.fn(async () => jsonResponse({ email: 'user@example.com', wrappedDek }))
		);

		const { deps, getError } = makeDeps();
		const ok = await signIn('user@example.com', 'wrong-passphrase', deps);

		expect(ok).toBe(false);
		expect(getError()).toBe('Invalid email or passphrase');
		expect(await isSyncEnabled()).toBe(false);
	});

	it('fails when the account has no passphrase credential', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => jsonResponse({ email: 'user@example.com', wrappedDek: null }))
		);

		const { deps, getError } = makeDeps();
		const ok = await signIn('user@example.com', 'anything', deps);

		expect(ok).toBe(false);
		expect(getError()).toBe('Invalid email or passphrase');
	});
});

describe('recoverAccount + finishRecovery', () => {
	it('unwraps the DEK with the recovery code, then re-wraps it under a new passphrase', async () => {
		const recoveryCode = generateRecoveryCode();
		const dek = await generateShareKey();
		const recoveryWrappedDek = b64urlEncode(new Uint8Array(await encrypt(dek, recoveryCode)));

		vi.stubGlobal(
			'fetch',
			vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
				const url = String(input);
				if (url.includes('/api/auth/recover')) {
					return jsonResponse({ email: 'user@example.com', wrappedDek: recoveryWrappedDek });
				}
				if (url.includes('/api/auth/passphrase')) return new Response(null, { status: 204 });
				if (url.includes('/api/sync/blob')) return blobResponse(init);
				throw new Error(`unexpected fetch: ${url}`);
			})
		);

		const { deps: recoverDeps, getError: recoverError } = makeDeps();
		const recovered = await recoverAccount('user@example.com', recoveryCode, recoverDeps);

		expect(recoverError()).toBe('');
		expect(recovered?.dek).toBe(dek);
		expect(await isSyncEnabled()).toBe(false); // not enabled until finishRecovery

		const { deps: finishDeps, getError: finishError } = makeDeps();
		const ok = await finishRecovery(
			'user@example.com',
			'brand-new-passphrase',
			recovered!.dek,
			finishDeps
		);

		expect(ok).toBe(true);
		expect(finishError()).toBe('');
		expect(await isSyncEnabled()).toBe(true);
		await syncNow(); // join the fire-and-forget sync this action kicked off
	});

	it('fails generically on the wrong recovery code', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => jsonResponse({ error: 'Invalid email or recovery code' }, { status: 401 }))
		);

		const { deps, getError } = makeDeps();
		const result = await recoverAccount('user@example.com', 'WRONG-CODE', deps);

		expect(result).toBeNull();
		expect(getError()).toBe('Invalid email or recovery code');
	});
});

describe('signOut', () => {
	it('calls the signout endpoint and disables sync locally', async () => {
		const dek = await generateShareKey();
		await enableSyncWithDek(dek, 'user@example.com');
		expect(await isSyncEnabled()).toBe(true);

		const fetchSpy = vi.fn(async () => new Response(null, { status: 204 }));
		vi.stubGlobal('fetch', fetchSpy);

		const { deps } = makeDeps();
		await signOut(deps);

		expect(fetchSpy).toHaveBeenCalledWith(
			'/api/auth/signout',
			expect.objectContaining({ method: 'POST' })
		);
		expect(await isSyncEnabled()).toBe(false);
	});

	it('still disables sync locally even if the network call fails', async () => {
		const dek = await generateShareKey();
		await enableSyncWithDek(dek, 'user@example.com');

		vi.stubGlobal(
			'fetch',
			vi.fn(async () => {
				throw new Error('network down');
			})
		);

		const { deps } = makeDeps();
		await signOut(deps);

		expect(await isSyncEnabled()).toBe(false);
	});
});

describe('deleteAccount', () => {
	it('deletes the account server-side and disables sync locally', async () => {
		const dek = await generateShareKey();
		await enableSyncWithDek(dek, 'user@example.com');

		const fetchSpy = vi.fn(async () => new Response(null, { status: 204 }));
		vi.stubGlobal('fetch', fetchSpy);

		const { deps, getError } = makeDeps();
		const ok = await deleteAccount(deps);

		expect(ok).toBe(true);
		expect(getError()).toBe('');
		expect(fetchSpy).toHaveBeenCalledWith(
			'/api/account',
			expect.objectContaining({ method: 'DELETE' })
		);
		expect(await isSyncEnabled()).toBe(false);
	});

	it('reports the error and leaves sync enabled when deletion fails', async () => {
		const dek = await generateShareKey();
		await enableSyncWithDek(dek, 'user@example.com');

		vi.stubGlobal(
			'fetch',
			vi.fn(async () => jsonResponse({ error: 'Could not delete your account.' }, { status: 500 }))
		);

		const { deps, getError } = makeDeps();
		const ok = await deleteAccount(deps);

		expect(ok).toBe(false);
		expect(getError()).toBe('Could not delete your account.');
		expect(await isSyncEnabled()).toBe(true);
	});
});
