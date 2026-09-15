<script lang="ts">
	import { dragSession } from '$lib/drag-session.svelte';
	import type { DragAction } from '$lib/drag-session.svelte';

	let { action }: { action: DragAction } = $props();

	// Not a svelte-dnd-action drop zone — see drag-session.svelte.ts's doc
	// comment for why. `data-drag-action-label` is what DragActionBar.svelte's
	// own pointer tracker looks for via elementsFromPoint to decide whether
	// the pointer is currently over this tile.
	let isTargeted = $derived(dragSession.targetedLabel === action.label);
</script>

<div
	data-drag-action-label={action.label}
	class="flex h-20 max-w-32 flex-1 flex-col items-center justify-center gap-1 rounded-2xl text-xs font-semibold transition-all duration-100 {isTargeted
		? 'scale-110 bg-orange-500 text-white ring-4 ring-orange-300 dark:ring-orange-900/60'
		: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300'}"
>
	<span class="text-2xl leading-none" aria-hidden="true">{action.icon}</span>
	<span class="text-center leading-tight">{action.label}</span>
</div>
