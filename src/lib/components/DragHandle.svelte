<script lang="ts">
	import { dragHandle } from 'svelte-dnd-action';

	// Shared handle for every drag-to-reorder surface (Grid, List, and —
	// from #phase-3 — shared lists) so they read as one interaction language
	// instead of three independently-styled ones. `card` anchors to the
	// poster's bottom edge (Grid); `row` is the leading element of a list
	// row (List). Both keep the same ⠿ glyph every surface already used.
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
		? 'absolute inset-x-0 bottom-0 flex h-6 touch-none cursor-grab items-center justify-center bg-black/45 text-xs tracking-[0.4em] text-white select-none backdrop-blur-[1px] active:cursor-grabbing'
		: 'flex h-8 w-5 shrink-0 touch-none cursor-grab items-center justify-center rounded text-gray-400 select-none active:cursor-grabbing dark:text-gray-500 dark:hover:text-gray-300'}
>
	⠿
</div>
