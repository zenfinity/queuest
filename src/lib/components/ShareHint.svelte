<script lang="ts">
	// Last of the onboarding nudges, same shape as NavHint/ListHint — this one
	// explains the two sharing options once someone actually has a list to
	// share, which is also the first moment both buttons are visible at once.
	// The distinction (snapshot vs. ongoing collaboration) isn't obvious from
	// two adjacently-labeled buttons alone, and the fuller explanation only
	// otherwise exists in each button's hover tooltip — invisible on touch.
	// Only shown with sync on, since Share doesn't exist as an option without
	// it; mentioning it before then would point at a button that isn't there.
	const DISMISS_KEY = 'sq:share-hint-dismissed';
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
				<span class="font-medium text-orange-400">Read-only</span> sends the list as-is —
				<span class="font-medium text-orange-400">Share</span> lets others collaborate on it with you
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
