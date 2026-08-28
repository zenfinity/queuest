// Shared queue filter/view state — read by both the layout (nav-inline dock at lg+)
// and the queue page (fixed floating dock below lg, and applying filters/sort).
// 'rank' (#216) is custom manual order, backed by WatchlistItem.sort_order —
// distinct from the others, which all derive from an existing field. Grouping
// by collection (see groupByCollection below) disables it: reordering across
// alphabetical sections has no clear meaning, so the queue page suppresses
// the move controls whenever both are on at once rather than defining one.
export type SortKey = 'added' | 'title' | 'runtime' | 'rank';
export type ViewKey = 'grid' | 'list' | 'lanes';
export type ServiceFilterKey = 'all' | 'subscribed' | 'not-subscribed';
export type GanttGroupKey = 'provider' | 'collection';

export const SORT_DEFAULT_DIR: Record<SortKey, 'asc' | 'desc'> = {
	added: 'desc',
	title: 'asc',
	runtime: 'asc',
	rank: 'asc'
};

// Sentinel for "items with no collection assigned" — distinct from `null`,
// which means "no collection filter applied" (i.e. show everything).
export const UNCATEGORIZED = '__uncategorized__';

export const queueControls = $state({
	sortBy: 'added' as SortKey,
	sortDir: 'desc' as 'asc' | 'desc',
	viewMode: 'grid' as ViewKey,
	serviceFilter: 'all' as ServiceFilterKey,
	collectionFilter: null as string | null,
	// Grid/List section grouping — off by default, the flat list stays the
	// default presentation. Session-only, like the filters above.
	groupByCollection: false,
	// Gantt lane grouping axis — provider lanes are the default (what the budget
	// feature is built around); collection is an alternative axis, not a
	// replacement. Distinct from groupByCollection above: Gantt is always grouped
	// into lanes, this only picks which key groups it.
	ganttGroupBy: 'provider' as GanttGroupKey,
	// Mirrors the queue's current collection names so QueueDock — rendered from
	// the layout, without direct access to queue items — can list them. Kept in
	// sync by the queue page via an $effect.
	collectionNames: [] as string[],
	// Same mirroring, for shared lists — kept separate from collectionNames
	// rather than merged in since a shared-list filter needs its own `shared:`
	// id form (see sharedFilterId below), not a plain name.
	sharedListOptions: [] as { id: string; name: string; color: string }[],
	watchedOn: false,
	filterOpen: false,
	ready: false, // true once the queue page has hydrated sort/view prefs from localStorage
	hasItems: false // true once the queue page has loaded and has at least one item — gates dock visibility
});

export function setSortBy(key: SortKey) {
	queueControls.sortBy = key;
	queueControls.sortDir = SORT_DEFAULT_DIR[key];
}
export function toggleSortDir() {
	queueControls.sortDir = queueControls.sortDir === 'asc' ? 'desc' : 'asc';
}
export function clearSort() {
	queueControls.sortBy = 'added';
	queueControls.sortDir = SORT_DEFAULT_DIR.added;
}

// `collectionFilter` doubles as the shared-list filter, prefixed `shared:` —
// same convention the DetailPanel and bulk-assign pickers already use, so a
// filter value means the same thing everywhere it's read. Returns the
// collection id, or null if `filter` isn't a shared-list filter.
export function sharedFilterId(filter: string | null): string | null {
	return filter?.startsWith('shared:') ? filter.slice(7) : null;
}

export function hasActiveFilters(): boolean {
	return (
		queueControls.sortBy !== 'added' ||
		queueControls.sortDir !== SORT_DEFAULT_DIR[queueControls.sortBy] ||
		queueControls.serviceFilter !== 'all' ||
		queueControls.collectionFilter !== null
	);
}
