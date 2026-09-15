// Drop-zone action bar (#294-drag Phase 2) — a single global singleton, same
// shape/precedent as queue-controls.svelte.ts, so DragActionBar.svelte (mounted
// once in +layout.svelte, with no direct access to whichever page/list is
// currently dragging) can render whatever the active origin zone populated.
//
// `zoneType` matches svelte-dnd-action's own `type` option: an origin zone and
// the action-bar tiles must share it for a drop to register at all. Grid/List
// origins (queue and personal lists alike — same mechanics, different bound
// closures) use QUEUE_ITEM_ZONE_TYPE; a future shared-list ballot origin
// (Phase 3) would use a distinct type so its own, differently-shaped action
// set can't accidentally accept a queue-item drop or vice versa.
export const QUEUE_ITEM_ZONE_TYPE = 'queue-item';

export interface DragAction {
	label: string;
	icon: string;
	run: () => Promise<void>;
}

export const dragSession = $state({
	active: false,
	zoneType: null as string | null,
	actions: [] as DragAction[],
	// Set only when the "copy to list" targets were capped (#294-drag Phase 2's
	// 6-tile limit) — a non-interactive note pointing at the card's own detail
	// panel for the rest, rather than growing the bar into a scrollable list
	// picker of its own.
	overflowNote: null as string | null
});

/** Called once, right as a drag gesture picks up — see each origin's own
 *  onDragStart for how `actions` gets built. */
export function startDragSession(
	zoneType: string,
	actions: DragAction[],
	overflowNote: string | null = null
) {
	dragSession.active = true;
	dragSession.zoneType = zoneType;
	dragSession.actions = actions;
	dragSession.overflowNote = overflowNote;
}

/** Called unconditionally from every origin zone's onfinalize (fires exactly
 *  once per gesture, regardless of outcome) — see QueueGridView/QueueListView. */
export function endDragSession() {
	dragSession.active = false;
	dragSession.zoneType = null;
	dragSession.actions = [];
	dragSession.overflowNote = null;
}
