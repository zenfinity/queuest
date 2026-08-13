// Keyboard support for scrim-dismissed overlays (#130 item 2). The app
// deliberately doesn't use <dialog> (see .design-sync/design-reference.md),
// so Escape-to-close, a focus trap, and focus return on close all have to be
// wired up by hand — this is that wiring, as one reusable Svelte action
// rather than four near-identical copies.
const FOCUSABLE_SELECTOR =
	'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function trapFocus(node: HTMLElement, params: { onEscape: () => void }) {
	let onEscape = params.onEscape;
	const previouslyFocused = document.activeElement as HTMLElement | null;

	function focusables(): HTMLElement[] {
		return Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			e.stopPropagation();
			onEscape();
			return;
		}
		if (e.key !== 'Tab') return;
		const items = focusables();
		if (items.length === 0) {
			// Nothing focusable inside (e.g. the poster lightbox) — keep focus
			// pinned on the overlay itself rather than letting Tab escape to
			// the page underneath.
			e.preventDefault();
			return;
		}
		const first = items[0];
		const last = items[items.length - 1];
		if (e.shiftKey && document.activeElement === first) {
			e.preventDefault();
			last.focus();
		} else if (!e.shiftKey && document.activeElement === last) {
			e.preventDefault();
			first.focus();
		}
	}

	// Move focus into the overlay immediately — otherwise a screen reader
	// stays anchored on whatever was focused on the page behind it, and Tab
	// has no defined starting point inside the trap.
	(focusables()[0] ?? node).focus({ preventScroll: true });
	node.addEventListener('keydown', handleKeydown);

	return {
		update(newParams: { onEscape: () => void }) {
			onEscape = newParams.onEscape;
		},
		destroy() {
			node.removeEventListener('keydown', handleKeydown);
			previouslyFocused?.focus({ preventScroll: true });
		}
	};
}
