// Shared plumbing for onboarding hints (#191): a one-at-a-time gate so two
// hints whose trigger conditions both become true on the same page don't
// stack (the original three hints each lived on a different route, so this
// never actually collided — Collections/Sync/Ranking landing together on the
// Queue page is what makes the gate load-bearing rather than defensive).
let activeHintKey: string | null = $state(null);

/** Claims the one-hint-at-a-time slot for `key`. Returns false if another
 * hint already holds it — the caller should stay hidden rather than show. */
export function claimHint(key: string): boolean {
	if (activeHintKey !== null && activeHintKey !== key) return false;
	activeHintKey = key;
	return true;
}

/** Releases the slot, but only if `key` is the one holding it — a hint that
 * never got the slot (claimHint returned false) must not evict whichever
 * hint actually did. */
export function releaseHint(key: string): void {
	if (activeHintKey === key) activeHintKey = null;
}

/** The global "don't show tips" preference (#191) — a real cross-device
 * preference, unlike each hint's own dismissal key, so it lives in
 * SYNCED_KEYS (see app-state.ts) rather than being read fresh from
 * localStorage here on every check like the per-hint dismissal keys are. */
export function hintsDisabled(): boolean {
	try {
		return localStorage.getItem('sq:hints-disabled') === 'true';
	} catch {
		return false;
	}
}
