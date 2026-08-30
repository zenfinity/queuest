<script lang="ts">
	// Shared primitive behind every onboarding hint (#191) — visibility,
	// auto-hide, per-device dismissal, the global "don't show tips" preference,
	// and the one-at-a-time gate all live here so an individual hint
	// (NavHint, ListHint, ShareHint, SyncHint, RankingHint, …) only has to
	// supply its own trigger condition, dismiss key, and message content.
	import type { Snippet } from 'svelte';
	import { onDestroy } from 'svelte';
	import { claimHint, releaseHint, hintsDisabled } from '$lib/hints.svelte';

	const AUTO_HIDE_MS = 5000;

	let {
		show = false,
		dismissKey,
		children
	}: {
		show?: boolean;
		/** This hint's own `sq:*-hint-dismissed` key — both the localStorage key
		 * and its identity in the one-at-a-time gate. */
		dismissKey: string;
		/** Receives `dismiss`, for a hint whose content includes its own link
		 * that should also count as dismissal (e.g. ListHint's "Lists" link) —
		 * ignored by any hint that doesn't need it. */
		children: Snippet<[() => void]>;
	} = $props();

	let visible = $state(false);
	let shown = false; // guards against re-triggering if `show` flips true again

	function dismiss() {
		visible = false;
		releaseHint(dismissKey);
		try {
			localStorage.setItem(dismissKey, 'true');
		} catch {
			// Best-effort localStorage write; worst case the hint reappears next visit
		}
	}

	function alreadyDismissed(): boolean {
		try {
			return localStorage.getItem(dismissKey) === 'true';
		} catch {
			return false;
		}
	}

	// This effect can legitimately re-run more than once even though `show`'s
	// resulting boolean never changes — Svelte's fine-grained reactivity
	// tracks the underlying signals the caller's `show` expression reads
	// (e.g. items/syncEnabled), not just the final value, so an unrelated
	// same-value write upstream can still mark this effect dirty. The
	// `shown` guard makes a re-run harmless *for this instance* (it bails
	// before reclaiming) — but releasing the gate from the effect's own
	// cleanup is not: that cleanup fires on every re-run, including these
	// spurious ones, so it would free the slot mid-display for a different
	// hint to grab while this one is still visibly showing. Release only
	// belongs to two places: dismiss() (explicit or auto-hide), and
	// onDestroy() below (genuine unmount, e.g. navigating away before either
	// fires) — never the effect's transient cleanup.
	$effect(() => {
		if (!show || shown || alreadyDismissed() || hintsDisabled()) return;
		if (!claimHint(dismissKey)) return; // another hint already has the one slot
		shown = true;
		visible = true;
		const timer = setTimeout(dismiss, AUTO_HIDE_MS);
		return () => clearTimeout(timer);
	});

	onDestroy(() => releaseHint(dismissKey));
</script>

{#if visible}
	<div class="pointer-events-none fixed inset-x-0 top-16 z-40 flex justify-center px-4 sm:top-20">
		<div
			class="pointer-events-auto flex items-center gap-2 rounded-full bg-gray-900/90 px-4 py-2 text-sm text-white shadow-lg backdrop-blur dark:bg-gray-800/90"
		>
			<span>{@render children(dismiss)}</span>
			<button
				type="button"
				aria-label="Dismiss"
				onclick={dismiss}
				class="ml-1 text-white/70 hover:text-white"
			>
				<svg class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
					<path
						d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z"
					/>
				</svg>
			</button>
		</div>
	</div>
{/if}
