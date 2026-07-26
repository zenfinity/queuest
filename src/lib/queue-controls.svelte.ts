// Shared queue filter/view state — read by both the layout (nav-inline dock at lg+)
// and the queue page (fixed floating dock below lg, and applying filters/sort).
export type SortKey = 'added' | 'title' | 'runtime';
export type ViewKey = 'grid' | 'list' | 'lanes';
export type ServiceFilterKey = 'all' | 'subscribed' | 'not-subscribed';

export const SORT_DEFAULT_DIR: Record<SortKey, 'asc' | 'desc'> = {
	added: 'desc',
	title: 'asc',
	runtime: 'asc'
};

export const queueControls = $state({
	sortBy: 'added' as SortKey,
	sortDir: 'desc' as 'asc' | 'desc',
	viewMode: 'grid' as ViewKey,
	serviceFilter: 'all' as ServiceFilterKey,
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

export function hasActiveFilters(): boolean {
	return (
		queueControls.sortBy !== 'added' ||
		queueControls.sortDir !== SORT_DEFAULT_DIR[queueControls.sortBy] ||
		queueControls.serviceFilter !== 'all'
	);
}
