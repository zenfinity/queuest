import type { WatchlistItem } from './types';

/**
 * Shared `WatchlistItem` builder for tests. Was previously copy-pasted
 * (byte-identical apart from `runtime_minutes`) across db.test.ts,
 * progress.test.ts, and queue-actions.test.ts — a required field added to
 * `WatchlistItem` had to be threaded through all three independently. (#129)
 */
export function makeItem(overrides: Partial<WatchlistItem> = {}): WatchlistItem {
	return {
		id: 1,
		tmdb_id: 100,
		media_type: 'movie',
		title: 'Test Title',
		poster_path: null,
		overview: null,
		providers: [],
		runtime_minutes: 100,
		seasons: [],
		watched_seasons: [],
		added_at: '2026-01-01T00:00:00.000Z',
		watched_at: null,
		...overrides
	};
}

/**
 * db.addItem() generates `id`/`added_at`/`watched_at` itself, so tests that
 * insert a fresh item via the real db module pass a payload without them.
 */
export function makeNewItem(
	overrides: Partial<Omit<WatchlistItem, 'id' | 'added_at' | 'watched_at'>> = {}
): Omit<WatchlistItem, 'id' | 'added_at' | 'watched_at'> {
	const { id: _id, added_at: _added_at, watched_at: _watched_at, ...rest } = makeItem(overrides);
	return rest;
}
