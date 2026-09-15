<script lang="ts">
	import { dragSession } from '$lib/drag-session.svelte';
	import DragActionTile from './DragActionTile.svelte';
</script>

<!-- Mounted once in +layout.svelte (#294-drag Phase 2) — a single, always-
     same-place fixed-bottom bar rather than a cursor-following or card-
     anchored one, so it's a reliable touch target regardless of where on
     screen the drag started. Opaque and full-width so it visually covers
     QueueDock's own floating placement while active, rather than the two
     competing for the same strip of screen. -->
{#if dragSession.active}
	<div
		class="fixed inset-x-0 bottom-0 z-[70] border-t border-gray-200 bg-white/95 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2.5 backdrop-blur-md dark:border-gray-800 dark:bg-gray-900/95"
	>
		<div class="mx-auto flex max-w-5xl items-center justify-center gap-3 overflow-x-auto px-3">
			{#each dragSession.actions as action (action.label)}
				<DragActionTile {action} zoneType={dragSession.zoneType} />
			{/each}
		</div>
	</div>
{/if}
