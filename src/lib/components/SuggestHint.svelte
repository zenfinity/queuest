<script lang="ts">
	// In-flow nudge toward Suggest (#289) — shown once a provider you're not
	// subscribed to is already holding a full month's worth of unwatched
	// queue weight, the same aggregateByProvider math budget/+page.svelte's
	// own "What to Subscribe to Next" section already runs (see
	// app/+page.svelte's topSuggestCandidate). Dismiss-only, no "used it"
	// retirement — Suggest is a section on /budget, not a destination, so
	// there's no clean signal to mark it as visited. See app/+page.svelte's
	// hintAvailable() for the dismiss/re-arm rules.
	import { resolve } from '$app/paths';

	let { show = false, onDismiss }: { show?: boolean; onDismiss?: () => void } = $props();
</script>

{#if show}
	<div class="flex items-start justify-between gap-2 border-l-2 border-orange-400 pl-3">
		<p class="text-xs leading-relaxed text-gray-500 dark:text-gray-400">
			A good chunk of what's queued sits on a service you're not paying for —
			<a href={resolve('/budget#suggest')} class="font-medium text-orange-500 hover:underline"
				>Suggest</a
			>
			ranks providers by how much of your queue they'd unlock.
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
