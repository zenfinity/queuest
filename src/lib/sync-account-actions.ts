// Account actions for the Sync settings UI (#103), wrapping #102's server
// endpoints. Follows the established `*ActionDeps` pattern (see
// queue-actions.ts) — plain async functions, injected setBusy/setError
// callbacks, errors caught with a user-facing fallback string. No runes in
// this module; the component owns all reactive state.
import { normalizeEmail, deriveAuthKey, generateRecoveryCode } from './auth-crypto';
import { encrypt, decrypt, generateShareKey } from './crypto';
import { b64urlEncode, b64urlDecode } from './base64url';
import { throwIfNotOk } from './http';
import { enableSyncWithDek, disableSync, syncNow } from './sync';

export interface SyncAccountActionDeps {
	setBusy: (busy: boolean) => void;
	setError: (error: string) => void;
}

async function postJson(url: string, body: unknown): Promise<Response> {
	return fetch(url, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body)
	});
}

/**
 * Signs up, then immediately generates and stores the recovery code, all
 * before the DEK is ever imported as a non-extractable CryptoKey — this is
 * the only point at which the raw DEK is available in memory to wrap under
 * a second secret, so recovery-code setup can't be deferred to later as a
 * standalone "regenerate" action without re-deriving the DEK some other way.
 * Returns the recovery code so the caller can show/print it — it is never
 * sent anywhere in plaintext form and isn't retrievable again after this call.
 */
export async function signUp(
	email: string,
	passphrase: string,
	deps: SyncAccountActionDeps
): Promise<{ email: string; recoveryCode: string } | null> {
	deps.setBusy(true);
	deps.setError('');
	try {
		const normalizedEmail = normalizeEmail(email);
		const authKey = await deriveAuthKey(normalizedEmail, passphrase);
		const dek = await generateShareKey();
		const wrappedDek = b64urlEncode(new Uint8Array(await encrypt(dek, passphrase)));

		const res = await postJson('/api/auth/signup', {
			email: normalizedEmail,
			authKey,
			wrappedDek
		});
		await throwIfNotOk(res);
		const { email: confirmedEmail } = (await res.json()) as { email: string };

		const recoveryCode = generateRecoveryCode();
		const recoveryAuthKey = await deriveAuthKey(normalizedEmail, recoveryCode);
		const recoveryWrappedDek = b64urlEncode(new Uint8Array(await encrypt(dek, recoveryCode)));
		const recRes = await postJson('/api/auth/recovery-code', {
			recoveryAuthKey,
			wrappedDek: recoveryWrappedDek
		});
		await throwIfNotOk(recRes);

		await enableSyncWithDek(dek, confirmedEmail);
		void syncNow();

		return { email: confirmedEmail, recoveryCode };
	} catch (e) {
		deps.setError(e instanceof Error ? e.message : 'Could not create your account.');
		return null;
	} finally {
		deps.setBusy(false);
	}
}

export async function signIn(
	email: string,
	passphrase: string,
	deps: SyncAccountActionDeps
): Promise<boolean> {
	deps.setBusy(true);
	deps.setError('');
	try {
		const normalizedEmail = normalizeEmail(email);
		const authKey = await deriveAuthKey(normalizedEmail, passphrase);
		const res = await postJson('/api/auth/signin', { email: normalizedEmail, authKey });
		await throwIfNotOk(res);
		const json = (await res.json()) as { email: string; wrappedDek: string | null };
		if (!json.wrappedDek) {
			throw new Error('This account has no passphrase set up — use recovery instead.');
		}

		const dek = await decrypt(b64urlDecode(json.wrappedDek).buffer, passphrase);
		await enableSyncWithDek(dek, json.email);
		void syncNow();
		return true;
	} catch {
		// Same generic message as the server's own signin response — a specific
		// client-side error here (e.g. "decrypt failed") would leak which half
		// of email+passphrase was wrong, the same user-enumeration concern the
		// server already guards against with its constant-time hash comparison.
		deps.setError('Invalid email or passphrase');
		return false;
	} finally {
		deps.setBusy(false);
	}
}

/**
 * Step 1 of recovery: proves the recovery code, gets back the DEK. Doesn't
 * call enableSyncWithDek — recovery isn't finished until a new passphrase is
 * set (finishRecovery below), since the old one is by definition the thing
 * the user just proved they've forgotten. The raw dek is handed back to the
 * caller to carry into that step; it never touches IndexedDB in between.
 */
export async function recoverAccount(
	email: string,
	recoveryCode: string,
	deps: SyncAccountActionDeps
): Promise<{ email: string; dek: string } | null> {
	deps.setBusy(true);
	deps.setError('');
	try {
		const normalizedEmail = normalizeEmail(email);
		const recoveryAuthKey = await deriveAuthKey(normalizedEmail, recoveryCode);
		const res = await postJson('/api/auth/recover', { email: normalizedEmail, recoveryAuthKey });
		await throwIfNotOk(res);
		const json = (await res.json()) as { email: string; wrappedDek: string | null };
		if (!json.wrappedDek) {
			throw new Error('No recovery code is set up for this account.');
		}
		const dek = await decrypt(b64urlDecode(json.wrappedDek).buffer, recoveryCode);
		return { email: json.email, dek };
	} catch {
		deps.setError('Invalid email or recovery code');
		return null;
	} finally {
		deps.setBusy(false);
	}
}

/** Step 2 of recovery: sets a brand new passphrase for the DEK obtained in
 * recoverAccount(), then enables sync exactly like a normal signin would. */
export async function finishRecovery(
	email: string,
	newPassphrase: string,
	dek: string,
	deps: SyncAccountActionDeps
): Promise<boolean> {
	deps.setBusy(true);
	deps.setError('');
	try {
		const normalizedEmail = normalizeEmail(email);
		const authKey = await deriveAuthKey(normalizedEmail, newPassphrase);
		const wrappedDek = b64urlEncode(new Uint8Array(await encrypt(dek, newPassphrase)));
		const res = await fetch('/api/auth/passphrase', {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ authKey, wrappedDek })
		});
		await throwIfNotOk(res);
		await enableSyncWithDek(dek, normalizedEmail);
		void syncNow();
		return true;
	} catch (e) {
		deps.setError(e instanceof Error ? e.message : 'Could not set a new passphrase.');
		return false;
	} finally {
		deps.setBusy(false);
	}
}

/** Ends the server session and stops syncing on this device. Local
 * IndexedDB data is untouched — this only affects the cloud connection. */
export async function signOut(deps: SyncAccountActionDeps): Promise<void> {
	deps.setBusy(true);
	deps.setError('');
	try {
		await fetch('/api/auth/signout', { method: 'POST' });
	} catch {
		// Best-effort — even if the network call fails, still stop syncing
		// locally; a stale server-side session outlives the client's belief
		// in it by at most the session TTL, same tradeoff share-link and
		// backup-restore failures already accept elsewhere in this app.
	} finally {
		await disableSync();
		deps.setBusy(false);
	}
}

/**
 * Deletes the account server-side (sync blob, both wrapped-DEK rows, the
 * recovery credential, the user row) and stops syncing on this device.
 * Local IndexedDB data is untouched — see api/account/+server.ts.
 */
export async function deleteAccount(deps: SyncAccountActionDeps): Promise<boolean> {
	deps.setBusy(true);
	deps.setError('');
	try {
		const res = await fetch('/api/account', { method: 'DELETE' });
		await throwIfNotOk(res);
		await disableSync();
		return true;
	} catch (e) {
		deps.setError(e instanceof Error ? e.message : 'Could not delete your account.');
		return false;
	} finally {
		deps.setBusy(false);
	}
}
