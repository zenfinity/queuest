<script lang="ts">
	import { dragSession } from '$lib/drag-session.svelte';
	import DragActionTile from './DragActionTile.svelte';

	// Tracks which tile (if any) the pointer is currently over, via real
	// elementsFromPoint hit-testing rather than svelte-dnd-action's own
	// cross-zone matching — see drag-session.svelte.ts's doc comment for why
	// that matching doesn't work here. elementsFromPoint returns the full
	// front-to-back stack at a point, which matters because the dragged
	// clone svelte-dnd-action floats under the pointer (z-index 9999) is the
	// actual topmost element there — walking the stack instead of just the
	// single topmost hit is what lets this see the tile underneath it.
	$effect(() => {
		if (!dragSession.active) return;
		function pointFromEvent(e: MouseEvent | TouchEvent): { x: number; y: number } | null {
			if ('touches' in e) {
				const t = e.touches[0];
				return t ? { x: t.clientX, y: t.clientY } : null;
			}
			return { x: e.clientX, y: e.clientY };
		}
		function handleMove(e: MouseEvent | TouchEvent) {
			const point = pointFromEvent(e);
			if (!point) return;
			const stack = document.elementsFromPoint(point.x, point.y);
			const tile = stack
				.map((el) => el.closest<HTMLElement>('[data-drag-action-label]'))
				.find((el) => el !== null);
			dragSession.targetedLabel = tile?.dataset.dragActionLabel ?? null;
		}
		window.addEventListener('mousemove', handleMove, { passive: true });
		window.addEventListener('touchmove', handleMove, { passive: true });
		return () => {
			window.removeEventListener('mousemove', handleMove);
			window.removeEventListener('touchmove', handleMove);
		};
	});
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
				<DragActionTile {action} />
			{/each}
		</div>
	</div>
{/if}
