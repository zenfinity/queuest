// Carries a shared-list invite across the "you need sync first" detour
// (#215). A logged-out visitor who opens an invite link gets sent to
// Settings to set up sync; without this, the token and DEK are gone the
// moment they navigate away — nothing in the URL survives that trip, and the
// invite fragment in particular never even reaches the server to begin with.
//
// sessionStorage, not localStorage: this app's passphrase-based auth (#98)
// completes signup in one continuous session, so nothing here needs to
// survive a closed tab, and it deliberately sits outside the sq: prefix
// app-state.ts's synced/local key partition tracks — this is transient
// per-tab state, not a preference or synced field.
const KEY = 'queuest-pending-invite';

export interface PendingInvite {
	token: string;
	dek: string;
}

export function setPendingInvite(invite: PendingInvite): void {
	try {
		sessionStorage.setItem(KEY, JSON.stringify(invite));
	} catch {
		// Best-effort — worst case the visitor has to reopen the original link
	}
}

/** Reads and clears in one step — single-use, same as the invite token itself. */
export function takePendingInvite(): PendingInvite | null {
	try {
		const raw = sessionStorage.getItem(KEY);
		if (!raw) return null;
		sessionStorage.removeItem(KEY);
		const parsed: unknown = JSON.parse(raw);
		if (
			parsed &&
			typeof parsed === 'object' &&
			typeof (parsed as PendingInvite).token === 'string' &&
			typeof (parsed as PendingInvite).dek === 'string'
		) {
			return parsed as PendingInvite;
		}
		return null;
	} catch {
		return null;
	}
}
