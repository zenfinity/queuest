// Nav tab-switching hint (#242, formerly part of the floating Hint.svelte
// system, #191/#169). The trigger (a successful add) happens on /add, but
// the dot it lights up lives on the Queue tab in the shared nav — outside
// /add's own component tree — so the two sides need a small shared signal
// rather than a prop. `triggered` is intentionally session-only (resets on
// reload, same as the old `added.size > 0` trigger it replaces); dismissal
// is the one piece worth remembering across visits, so that's the only half
// backed by localStorage.
const DISMISS_KEY = 'sq:nav-hint-dismissed';

function readDismissed(): boolean {
	try {
		return localStorage.getItem(DISMISS_KEY) === 'true';
	} catch {
		return false;
	}
}

export const navHint = $state({ triggered: false, dismissed: readDismissed() });

export function triggerNavHint(): void {
	navHint.triggered = true;
}

export function dismissNavHint(): void {
	navHint.dismissed = true;
	try {
		localStorage.setItem(DISMISS_KEY, 'true');
	} catch {
		// Best-effort localStorage write; worst case the dot reappears next visit
	}
}
