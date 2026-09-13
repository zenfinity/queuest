<script lang="ts">
	// In-flow nudge toward the Timeline/Gantt view (#289) — shown once the
	// queue's total remaining runtime has outgrown the monthly budget, the
	// exact moment Gantt's bars (width = remaining time vs. budget) start
	// saying something a flat grid/list can't. Unlike ListHint/SyncHint,
	// this condition can stay true forever (a chronic over-queuer never
	// un-exceeds their own budget), so it needs a real dismiss affordance
	// with re-arm/retire state — see app/+page.svelte's hintAvailable() for
	// the rules (dismiss re-arms in 30 days, up to a few times; switching to
	// Timeline retires it for good).
	let { show = false, onDismiss }: { show?: boolean; onDismiss?: () => void } = $props();
</script>

{#if show}
	<div class="flex items-start justify-between gap-2 border-l-2 border-orange-400 pl-3">
		<p class="text-xs leading-relaxed text-gray-500 dark:text-gray-400">
			You've queued more than fits your monthly budget — the Timeline view lays it out by provider
			so you can see what's realistic.
		</p>
		<button
			type="button"
			onclick={onDismiss}
			class="shrink-0 text-gray-400 hover:text-gray-600 dark:text-gray-600 dark:hover:text-gray-400"
			aria-label="Dismiss"
		>
			✕
		</button>
	</div>
{/if}
