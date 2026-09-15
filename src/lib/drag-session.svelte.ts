// Drop-zone action bar (#294-drag Phase 2) — a single global singleton, same
// shape/precedent as queue-controls.svelte.ts, so DragActionBar.svelte (mounted
// once in +layout.svelte, with no direct access to whichever page/list is
// currently dragging) can render whatever the active origin zone populated.
//
// Targeting which tile the pointer is over is handled entirely outside
// svelte-dnd-action's own cross-zone `type` matching — see DragActionBar.svelte's
// own pointer tracking for why: that mechanism picks a zone by comparing raw
// bounding-box containment, and a Grid/List zone's box spans every row it has,
// not just what's currently visible. On any queue taller than one screen, that
// box already contains the action bar's on-screen position before the pointer
// ever gets there, so the origin zone always "wins" and the tile is never
// considered — confirmed directly: a 23-item queue's grid box measured
// 112px→2397px against a 768px viewport. `targetedLabel` is instead driven by
// real elementsFromPoint hit-testing against the pointer's actual screen
// position, which is authoritative regardless of any zone's nominal size.
export interface DragAction {
	label: string;
	icon: string;
	run: () => Promise<void>;
}

export const dragSession = $state({
	active: false,
	actions: [] as DragAction[],
	// The label of whichever tile the pointer is currently over, or null —
	// see DragActionBar.svelte's pointer tracker. Drives both the live
	// highlight (DragActionTile.svelte) and the actual drop decision
	// (QueueGridView/QueueListView's onfinalize).
	targetedLabel: null as string | null
});

/** Called once, right as a drag gesture picks up — see each origin's own
 *  onDragStart for how `actions` gets built. */
export function startDragSession(actions: DragAction[]) {
	dragSession.active = true;
	dragSession.actions = actions;
	dragSession.targetedLabel = null;
}

/** Called unconditionally from every origin zone's onfinalize (fires exactly
 *  once per gesture, regardless of outcome) — see QueueGridView/QueueListView. */
export function endDragSession() {
	dragSession.active = false;
	dragSession.actions = [];
	dragSession.targetedLabel = null;
}
