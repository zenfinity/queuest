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
	class="flex h-16 w-16 shrink-0 flex-col items-center justify-center gap-0.5 rounded-xl bg-gray-100 text-[10px] font-medium text-gray-600 transition-colors dark:bg-gray-800 dark:text-gray-300"
	use:dndzone={{
		items: tileItems,
		type: zoneType ?? undefined,
		flipDurationMs: 0,
		dropTargetClasses: ['!bg-orange-100', 'dark:!bg-orange-950/40', '!text-orange-600']
	}}
	onconsider={(e) => (tileItems = e.detail.items)}
	onfinalize={handleFinalize}
>
	<span class="text-xl leading-none" aria-hidden="true">{action.icon}</span>
	<span class="line-clamp-2 text-center leading-tight">{action.label}</span>
</div>
