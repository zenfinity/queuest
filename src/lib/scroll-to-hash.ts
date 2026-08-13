// Scrolls to whatever element matches the current URL's #hash, if any —
// meant to be called once a page's async-loaded content (and therefore the
// hash target itself) actually exists in the DOM (#161).
//
// The browser's own native anchor-scroll only fires once, at initial load,
// based on whatever's in the DOM at that moment. On an `ssr = false` page
// the initial HTML is an empty shell — a hash target that only appears
// after an onMount data fetch is never there yet when the browser looks,
// so the native jump silently no-ops and the user lands at the top of the
// page instead. Call this after the target's content has actually rendered.
export function scrollToHashTarget(): void {
	if (typeof window === 'undefined' || typeof document === 'undefined') return;
	const hash = window.location.hash;
	if (!hash || hash.length < 2) return;
	const el = document.getElementById(hash.slice(1));
	el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
