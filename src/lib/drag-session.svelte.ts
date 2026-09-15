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
	actions: [] as DragAction[]
});

/** Called once, right as a drag gesture picks up — see each origin's own
 *  onDragStart for how `actions` gets built. */
export function startDragSession(zoneType: string, actions: DragAction[]) {
	dragSession.active = true;
	dragSession.zoneType = zoneType;
	dragSession.actions = actions;
}

/** Called unconditionally from every origin zone's onfinalize (fires exactly
 *  once per gesture, regardless of outcome) — see QueueGridView/QueueListView. */
export function endDragSession() {
	dragSession.active = false;
	dragSession.zoneType = null;
	dragSession.actions = [];
}
