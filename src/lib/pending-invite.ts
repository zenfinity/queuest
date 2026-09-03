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

function parseStored(raw: string | null): PendingInvite | null {
	if (!raw) return null;
	try {
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

/** Reads and clears in one step — single-use, same as the invite token itself. */
export function takePendingInvite(): PendingInvite | null {
	try {
		const raw = sessionStorage.getItem(KEY);
		if (!raw) return null;
		sessionStorage.removeItem(KEY);
		return parseStored(raw);
	} catch {
		return null;
	}
}

/**
 * Non-consuming read — for deciding *how* to render a screen before the
 * invite is actually claimed (e.g. Settings jumping straight to the signup
 * form instead of its default choose-account-vs-sign-in screen). Settings
 * still calls takePendingInvite() itself, after sync actually turns on, to
 * consume the stash and drive the post-signup redirect back to the invite —
 * peeking here must never be the thing that clears it, or that later read
 * would come back empty.
 */
export function hasPendingInvite(): boolean {
	try {
		return parseStored(sessionStorage.getItem(KEY)) !== null;
	} catch {
		return false;
	}
}
