import type { WatchlistItem } from './types';

const DEFAULT_RUNTIME: Record<'movie' | 'tv', number> = { movie: 90, tv: 45 };

/**
 * Returns the remaining watch time for an item in minutes.
 *
 * For movies: always returns total runtime (or default).
 * For TV with season data: subtracts fully-watched seasons and
 * already-watched episodes in the current season.
 * For TV without season data (pre-feature items): returns total runtime.
 */
export function remainingRuntime(item: WatchlistItem): number {
	if (item.media_type === 'movie' || !item.seasons?.length) {
		return item.runtime_minutes ?? DEFAULT_RUNTIME[item.media_type];
	}

	const watched = new Set(item.watched_seasons ?? []);
	let remaining = 0;

	for (const season of item.seasons) {
		if (watched.has(season.season_number)) continue;

		if (
			season.season_number === item.current_season &&
			item.current_episode != null &&
			item.current_episode > 0
		) {
			const perEp =
				season.episode_count > 0 ? season.runtime_minutes / season.episode_count : 0;
			const episodesLeft = Math.max(0, season.episode_count - item.current_episode);
			remaining += episodesLeft * perEp;
		} else {
			remaining += season.runtime_minutes;
		}
	}

	// If everything is marked watched, remaining is 0 — that's correct.
	// But if seasons array is there but all empty for some reason, fall back.
	return Math.round(remaining);
}

/**
 * Returns a compact progress label for TV shows, e.g. "S1–S3 done · S4 E2"
 * Returns null for movies or items with no progress recorded.
 */
export function progressLabel(item: WatchlistItem): string | null {
	if (item.media_type !== 'tv') return null;
	const watched = item.watched_seasons ?? [];
	const hasCurrent = item.current_season != null;
	if (!watched.length && !hasCurrent) return null;

	const parts: string[] = [];
	if (watched.length) {
		const sorted = [...watched].sort((a, b) => a - b);
		parts.push('S' + sorted.join(' S') + ' done');
	}
	if (hasCurrent) {
		const ep = item.current_episode != null ? ` E${item.current_episode}` : '';
		parts.push(`S${item.current_season}${ep}`);
	}
	return parts.join(' · ');
}
