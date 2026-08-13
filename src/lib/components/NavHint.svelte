<script lang="ts">
	// One-time onboarding nudge (#169) toward the swipe (#162) / Alt+←→ (#168)
	// tab-switching gestures — neither is discoverable without being told.
	// Shown the first time the caller decides "the queue actually has
	// something in it now" (see app/+page.svelte); persists its own
	// dismissed state in `sq:nav-hint-dismissed` so it never reappears once
	// shown, whether dismissed manually or by the auto-hide timer.
	const DISMISS_KEY = 'sq:nav-hint-dismissed';
	const AUTO_HIDE_MS = 5000;

	let { show = false }: { show?: boolean } = $props();

	let visible = $state(false);
	let isTouch = $state(false);
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
		isTouch = window.matchMedia('(pointer: coarse)').matches;
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
				{#if isTouch}
					Swipe <span aria-hidden="true">← →</span> to switch tabs
				{:else}
					<kbd class="rounded bg-white/20 px-1 py-0.5 font-mono text-xs">Alt</kbd> +
					<span aria-hidden="true">← →</span> to switch tabs
				{/if}
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
