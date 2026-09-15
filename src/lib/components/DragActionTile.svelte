<script lang="ts">
	import { dndzone, TRIGGERS } from 'svelte-dnd-action';
	import type { DragAction } from '$lib/drag-session.svelte';

	let { action, zoneType }: { action: DragAction; zoneType: string | null } = $props();

	// A drop tile has no items of its own to render or drag out — it only
	// ever receives the one item currently being dragged, tracked here purely
	// so svelte-dnd-action has a reactive array to mirror into via onconsider
	// (same requirement as every other zone), not because this tile displays
	// a list. `id` here is svelte-dnd-action's own shadow-item bookkeeping,
	// unrelated to WatchlistItem's numeric id.
	let tileItems: { id: string }[] = $state([]);
	let busy = $state(false);

	// The library's own dropTargetStyle/dropTargetClasses mark every eligible
	// zone as "you may drop here" for the whole drag — not "the pointer is
	// over THIS one right now," which is what people actually need to see
	// before releasing. tileItems is non-empty exactly while the shadow item
	// is inside this zone (onconsider inserts it on entry, removes it on
	// exit — see handleDraggedEntered/handleDraggedLeft in the library's own
	// source), so it doubles as a reliable, per-tile "currently targeted"
	// signal without needing anything from the library's styling hooks.
	let isTargeted = $derived(tileItems.length > 0);

	function handleFinalize(
		e: CustomEvent<{ items: { id: string }[]; info: { trigger: TRIGGERS } }>
	) {
		const dropped = e.detail.info.trigger === TRIGGERS.DROPPED_INTO_ZONE;
		tileItems = [];
		if (!dropped || busy) return;
		busy = true;
		action.run().finally(() => {
			busy = false;
		});
	}
</script>

<div
	class="flex h-20 max-w-32 flex-1 flex-col items-center justify-center gap-1 rounded-2xl text-xs font-semibold transition-all duration-100 {isTargeted
		? 'scale-110 bg-orange-500 text-white ring-4 ring-orange-300 dark:ring-orange-900/60'
		: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300'}"
	use:dndzone={{
		items: tileItems,
		type: zoneType ?? undefined,
		flipDurationMs: 0
	}}
	onconsider={(e) => (tileItems = e.detail.items)}
	onfinalize={handleFinalize}
>
	<span class="text-2xl leading-none" aria-hidden="true">{action.icon}</span>
	<span class="text-center leading-tight">{action.label}</span>
</div>
