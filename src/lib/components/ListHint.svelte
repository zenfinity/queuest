<script lang="ts">
	// One-time onboarding nudge toward Lists — same shape as NavHint.svelte,
	// but for organizing rather than navigating: once someone has a handful
	// of titles queued and hasn't made a list yet, there's finally something
	// worth grouping, and this is the first mention that grouping is possible
	// at all. Shown on the Queue page (see app/+page.svelte) once there's
	// enough in the queue to make the suggestion land, deliberately not on
	// the very first add — that moment already carries NavHint's nudge, and
	// stacking two unrelated tips back to back defeats the point of either.
	import { resolve } from '$app/paths';

	const DISMISS_KEY = 'sq:list-hint-dismissed';
	const AUTO_HIDE_MS = 5000;

	let { show = false }: { show?: boolean } = $props();

	let visible = $state(false);
	let shown = false; // guards against re-triggering if `show` flips true again

	function dismiss() {
		visible = false;
		try {
			localStorage.setItem(DISMISS_KEY, 'true');
		} catch {
			// Best-effort localStorage write; worst case the hint reappears next visit
		}
	}

	function alreadyDismissed(): boolean {
		try {
			return localStorage.getItem(DISMISS_KEY) === 'true';
		} catch {
			return false;
		}
	}

	$effect(() => {
		if (!show || shown || alreadyDismissed()) return;
		shown = true;
		visible = true;
		const timer = setTimeout(dismiss, AUTO_HIDE_MS);
		return () => clearTimeout(timer);
	});
</script>

{#if visible}
	<div class="pointer-events-none fixed inset-x-0 top-16 z-40 flex justify-center px-4 sm:top-20">
		<div
			class="pointer-events-auto flex items-center gap-2 rounded-full bg-gray-900/90 px-4 py-2 text-sm text-white shadow-lg backdrop-blur dark:bg-gray-800/90"
		>
			<span>
				Select titles to group them into a list, or start one in
				<a href={resolve('/lists')} onclick={dismiss} class="font-medium text-orange-400 underline"
					>Lists</a
				>
			</span>
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
