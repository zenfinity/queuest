import type { Provider, ReleaseInfo, WatchlistItem } from './types';

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

export const DEFAULT_RUNTIME: Record<'movie' | 'tv', number> = { movie: 90, tv: 45 };

/** Formats a duration in minutes as e.g. "2h 30m" or "45m", exact (no "~"). */
export function hms(mins: number): string {
	const h = Math.floor(mins / 60),
		m = mins % 60;
	return h ? `${h}h${m ? ' ' + m + 'm' : ''}` : `${m}m`;
}

/**
 * Frames a runtime as "how many months of my viewing budget is this worth" —
 * e.g. "1.5 months" — rather than a raw hour/minute count. `budgetHoursPerMonth`
 * is the same `hoursPerWeek * weeksPerMonth` derivation already used on the
 * Budget page. Returns '' when there's no budget to divide by (caller should
 * skip rendering rather than show a nonsense "of your budget" line).
 */
export function formatMonthsEquivalent(
	runtimeMinutes: number,
	budgetHoursPerMonth: number
): string {
	if (budgetHoursPerMonth <= 0) return '';
	const months = runtimeMinutes / 60 / budgetHoursPerMonth;
	if (months < 0.1) return '<0.1 months';
	const rounded = Math.round(months * 10) / 10;
	const label = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
	return `${label} month${rounded === 1 ? '' : 's'}`;
}

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

	const now = Date.now();
	return aggregateByProvider(unwatched, { firstProviderOnly: true })
		.map((agg): CancelCandidate => ({
			providerId: agg.provider_id,
			name: agg.provider_name,
			logo: agg.logo_path,
			totalMins: agg.totalMins
		}))
		.filter(({ providerId, totalMins }) => {
			if (totalMins <= 0 || totalMins > budgetMins) return false;
			const d = dismissed[String(providerId)];
			if (!d) return true; // not dismissed
			const dismissedTime = new Date(d).getTime();
			// Malformed date is treated as "not dismissed" (fail open)
			if (isNaN(dismissedTime)) return true;
			return (now - dismissedTime) / 86400000 > 30;
		})
		.sort((a, b) => a.totalMins - b.totalMins);
}

/**
 * Persists the monthly viewing budget as the weekly-hours/weeks-per-month
 * pair plus their derived product — the three localStorage keys every
 * budget-editing surface (callout, /budget, backup restore) must keep
 * in sync with each other.
 */
export function saveBudgetPrefs(hoursPerWeek: number, weeksPerMonth: number): void {
	try {
		localStorage.setItem('sq:budget:weekly', JSON.stringify(hoursPerWeek));
		localStorage.setItem('sq:budget:weeks', JSON.stringify(weeksPerMonth));
		localStorage.setItem('sq:budget', JSON.stringify(hoursPerWeek * weeksPerMonth));
	} catch {
		// Best-effort localStorage write; app uses default budget if save fails
	}
}

export interface ProviderAggregate {
	provider_id: number;
	provider_name: string;
	logo_path: string;
	count: number;
	totalMins: number;
}

/**
 * Groups items by provider, keyed by provider_id (not name — two providers
 * can share a name prefix, or get renamed upstream, and would otherwise
 * silently merge or split depending on which screen renders them).
 *
 * By default walks every provider on every item. Pass `firstProviderOnly`
 * to instead treat each item as belonging to just its primary provider
 * (used where "which service is this queued against" should be singular).
 */
export function aggregateByProvider(
	items: WatchlistItem[],
	opts: { firstProviderOnly?: boolean } = {}
): ProviderAggregate[] {
	const map = new Map<number, ProviderAggregate>();
	for (const item of items) {
		const providers: Provider[] = opts.firstProviderOnly
			? item.providers.slice(0, 1)
			: item.providers;
		for (const p of providers) {
			if (!map.has(p.provider_id)) {
				map.set(p.provider_id, {
					provider_id: p.provider_id,
					provider_name: p.provider_name,
					logo_path: p.logo_path,
					count: 0,
					totalMins: 0
				});
			}
			const agg = map.get(p.provider_id)!;
			agg.count++;
			agg.totalMins += remainingRuntime(item);
		}
	}
	return [...map.values()];
}
