import type { ReleaseInfo, WatchlistItem } from './types';

// ── Release chip ──────────────────────────────────────────────────────────────

function fmtDate(iso: string): string {
	const d = new Date(iso + 'T00:00:00Z');
	const opts: Intl.DateTimeFormatOptions = {
		month: 'short',
		day: 'numeric',
		year: 'numeric',
		timeZone: 'UTC'
	};
	return d.toLocaleDateString('en-US', opts);
}

function isFuture(iso: string): boolean {
	return iso > new Date().toISOString().slice(0, 10);
}

/**
 * Returns a short human-readable release status chip, or null if nothing
 * noteworthy to surface (i.e. already released and on streaming).
 *
 * Examples:
 *   "Theaters May 22, 2026 · Est. streaming ~Jul 2026"
 *   "Streaming Jun 15, 2026"
 *   "S4 premieres Aug 4, 2026"
 *   "S2 returning — no date yet"
 */
export function releaseChip(r: ReleaseInfo | null | undefined): string | null {
	if (!r) return null;

	// ── TV ──────────────────────────────────────────────────────────────────
	if (r.next_season_date) {
		const label = r.next_season != null ? `S${r.next_season}` : 'Next season';
		const dateStr = fmtDate(r.next_season_date);
		if (r.currently_airing) {
			return isFuture(r.next_season_date)
				? `${label} new episode ${dateStr}`
				: `${label} airing now`;
		}
		const prefix = isFuture(r.next_season_date) ? 'premieres' : 'premiered';
		return `${label} ${prefix} ${dateStr}`;
	}
	if (r.status === 'Returning Series') {
		const season = r.next_season != null ? `S${r.next_season}` : 'Next season';
		return `${season} returning — no date yet`;
	}

	// ── Movie ────────────────────────────────────────────────────────────────
	if (r.digital_date && isFuture(r.digital_date)) {
		return `Streaming ${fmtDate(r.digital_date)}`;
	}
	if (r.theatrical_date || r.streaming_estimate) {
		const parts: string[] = [];
		if (r.theatrical_date && isFuture(r.theatrical_date)) {
			parts.push(`Theaters ${fmtDate(r.theatrical_date)}`);
		}
		if (r.streaming_estimate) {
			// Show month + year only for estimates
			const d = new Date(r.streaming_estimate + 'T00:00:00Z');
			const est = d.toLocaleDateString('en-US', {
				month: 'short',
				year: 'numeric',
				timeZone: 'UTC'
			});
			parts.push(`Est. streaming ~${est}`);
		}
		return parts.join(' · ') || null;
	}

	return null;
}

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
		remaining += season.runtime_minutes;
	}

	// If everything is marked watched, remaining is 0 — that's correct.
	return Math.round(remaining);
}

export interface CancelCandidate {
	providerId: number;
	name: string;
	logo: string;
	totalMins: number;
}

/**
 * Returns providers whose unwatched queue fits within the monthly budget,
 * sorted by ascending remaining time. Used to surface "consider pausing"
 * alerts. A candidate dismissed within the last 30 days is excluded.
 */
export function cancelCandidates(
	unwatched: WatchlistItem[],
	budgetHours: number,
	dismissed: Record<string, string>
): CancelCandidate[] {
	const budgetMins = budgetHours * 60;
	if (budgetMins <= 0) return [];

	const map = new Map<number, CancelCandidate>();
	for (const item of unwatched) {
		if (!item.providers.length) continue;
		const p = item.providers[0];
		if (!map.has(p.provider_id)) {
			map.set(p.provider_id, {
				providerId: p.provider_id,
				name: p.provider_name,
				logo: p.logo_path,
				totalMins: 0
			});
		}
		map.get(p.provider_id)!.totalMins += remainingRuntime(item);
	}

	const now = Date.now();
	return [...map.values()]
		.filter(({ providerId, totalMins }) => {
			if (totalMins <= 0 || totalMins > budgetMins) return false;
			const d = dismissed[String(providerId)];
			return !d || (now - new Date(d).getTime()) / 86400000 > 30;
		})
		.sort((a, b) => a.totalMins - b.totalMins);
}
