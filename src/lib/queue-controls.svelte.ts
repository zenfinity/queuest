// Shared queue filter/view state — read by both layout (nav inline controls)
// and the queue page (applying filters and rendering the correct view).
export const queueControls = $state({
	tab:           'queue'  as 'queue' | 'watched',
	sortBy:        'added'  as 'added' | 'title' | 'runtime',
	viewMode:      'grid'   as 'grid' | 'list' | 'lanes',
	serviceFilter: 'all'    as 'all' | 'subscribed' | 'not-subscribed',
	ready: false, // true once the queue page has hydrated from localStorage
});
