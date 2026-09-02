<script lang="ts">
	// Tab-switching hint (#242, formerly a floating pill — #169/#191). Renders
	// as a dot on the Queue tab (see +layout.svelte) once triggered from
	// /add's first successful add; hover or keyboard focus on the tab reveals
	// a popover with the actual tip. Placed inside the Queue <a> itself, which
	// supplies the `group` hover/focus context and the dismiss trigger — see
	// +layout.svelte's dismissNavHint wiring on that tag and on stepTab
	// (swipe/Alt+arrow both count as "used it", not just "saw it").
	import { navHint } from '$lib/nav-hint.svelte';

	// Snapshotted once rather than read reactively: +layout.svelte dismisses
	// on the same hover/focus that reveals the popover below, and if this
	// block's own visibility tracked that live, the popover would vanish the
	// instant it appeared instead of staying up for the hover that's reading it.
	const wasDismissed = navHint.dismissed;
</script>

{#if navHint.triggered && !wasDismissed}
	<span
		aria-hidden="true"
		class="pointer-events-none absolute -right-1 -top-0.5 h-[5px] w-[5px] rounded-full bg-orange-500"
	></span>
	<span
		role="tooltip"
		class="pointer-events-none absolute left-1/2 top-full z-30 mt-2 w-48 -translate-x-1/2 rounded-lg bg-white p-2.5 text-left text-xs leading-snug text-gray-700 opacity-0 shadow-lg ring-1 ring-gray-200 transition-opacity duration-150 group-hover:opacity-100 group-focus:opacity-100 dark:bg-gray-900 dark:text-gray-300 dark:ring-gray-700"
	>
		<kbd class="rounded bg-gray-100 px-1 py-0.5 font-mono dark:bg-gray-800">Alt</kbd>
		+ <span aria-hidden="true">← →</span> moves between tabs. Swipe on touch.
	</span>
{/if}
