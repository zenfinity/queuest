<script lang="ts">
	import { dragHandle } from 'svelte-dnd-action';

	// Shared handle for every drag-to-reorder surface (Grid, List, and —
	// from #phase-3 — shared lists) so they read as one interaction language
	// instead of three independently-styled ones. `card` is a full-width bar
	// at the very bottom of the card, below the Watched/Remove row (Grid);
	// `row` is the leading element of a list row (List). Both keep the same
	// ⠿ glyph every surface already used.
	let { variant, label }: { variant: 'card' | 'row'; label: string } = $props();
</script>

<!-- svelte-dnd-action's dragHandle action makes this a real role="button"
     tabindex="0" element unconditionally (its own keyboard mode — pick up
     with space/enter, move with arrow keys, drop with space/enter), so it's
     given a proper label rather than hidden. The role/tabindex/keydown
     handling the linter wants are all supplied at runtime by the action,
     invisible to static analysis. -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	use:dragHandle
	aria-label="Drag to reorder {label}"
	onclick={(e) => e.stopPropagation()}
	class={variant === 'card'
		? 'flex h-6 w-full touch-none cursor-grab items-center justify-center rounded-b-xl bg-gray-100 text-xs tracking-[0.4em] text-gray-400 select-none active:cursor-grabbing dark:bg-gray-800 dark:text-gray-500 dark:hover:text-gray-300'
		: 'flex h-8 w-5 shrink-0 touch-none cursor-grab items-center justify-center rounded text-gray-400 select-none active:cursor-grabbing dark:text-gray-500 dark:hover:text-gray-300'}
>
	⠿
</div>
