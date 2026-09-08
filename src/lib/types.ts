export interface CastMember {
	name: string;
	character: string;
	profile_path: string | null;
	id?: number; // TMDB person id, for resolving an IMDb link (#180); absent on pre-#180 rows
}

export interface Provider {
	provider_id: number;
	provider_name: string;
	logo_path: string;
}

export interface SeasonSummary {
	season_number: number;
	episode_count: number;
	name: string;
	runtime_minutes: number; // estimated: episode_count × avg_episode_runtime
}

export interface ReleaseInfo {
	/** For movies not yet on streaming: confirmed theatrical date */
	theatrical_date?: string | null;
	/** For movies: confirmed digital/streaming release date from TMDB */
	digital_date?: string | null;
	/** For movies: estimated streaming window (derived when no digital_date) */
	streaming_estimate?: string | null;
	/** For TV: upcoming season number */
	next_season?: number | null;
	/** For TV: upcoming season premiere date OR next episode air date (ISO string) */
	next_season_date?: string | null;
	/** True when next_season_date is a mid-season episode (not the season premiere) */
	currently_airing?: boolean;
	/** TMDB status string, e.g. "Post Production", "Returning Series", "Ended" */
	status?: string | null;
}

export interface WatchlistItem {
	id: number;
	tmdb_id: number;
	media_type: 'movie' | 'tv';
	title: string;
	poster_path: string | null;
	overview: string | null;
	year?: string | null; // release year, from SearchResult.year at add-time; absent on pre-#224 rows
	providers: Provider[];
	rentable?: boolean; // true if available to rent/buy but not on subscription
	runtime_minutes: number | null; // total runtime (all seasons)
	seasons: SeasonSummary[]; // TV only; empty array for movies / pre-feature items
	watched_seasons: number[]; // season numbers fully completed
	added_at: string;
	watched_at: string | null;
	updated_at?: string; // last-write-wins sync timestamp; optional for pre-v3 rows until backfilled
	deleted_at?: string | null; // soft-delete tombstone; set by removeItem, never surfaced in getAll()
	sort_order?: number; // custom "Rank" sort position (#216); lower sorts first, need not be contiguous
	release?: ReleaseInfo | null;
	// Per-list membership (#274) — a title lives in one row now, not one row per
	// list, so membership is a map: list name -> when it was added/removed. `at`
	// backs a per-key LWW-element-set merge across devices (see sync.ts's
	// mergeOne) — a plain union can't express removal, so untagging writes a
	// `deleted: true` tombstone rather than deleting the key outright. `rank` is
	// this list's own ordering for the item (unused by PR1's UI; carried through
	// for PR2's per-list rank). Use activeQueueTags/hasActiveTag below rather
	// than reading this map directly — every "is this item in list X" check has
	// to skip deleted entries the same way, or a missed spot silently
	// resurrects a removed tag.
	queue_tags?: Record<string, { rank?: number; at: string; deleted?: true }>;
	genres?: string[];
	cast?: CastMember[];
	director?: string | null; // movie director
	director_id?: number | null; // TMDB person id for director, for an IMDb link (#180); movies only
	creator?: string | null; // TV show creator(s) — not linkable: a joined string of possibly several names, see #180
	imdb_id?: string | null; // e.g. "tt0111161" — from TMDB external_ids, for a "View on IMDb" link
	notes?: string; // free-text note (#155); on a shared item, one note for the whole list, owner-editable only (UI-enforced, see setCollectionItemNote)
	backdrop_path?: string | null; // wide 16:9 image, distinct from poster_path; powers the detail panel's desktop-only hero (#133)

	// ── Collaborative Collections (#188) ────────────────────────────────────
	// Unused by a personal (non-collection) item — the personal merge engine
	// in sync.ts never reads either field. Present here rather than on a
	// separate CollectionItem type because collection blobs are serialized
	// through the same BackupItem shape as personal sync (see
	// app-state.ts's parseBackupItem), and duplicating the whole interface
	// for two extra optional fields would be the greater evil.

	// Per-account watch marks: account id -> the ISO timestamp they marked
	// this watched. A map, not a boolean, because a shared item can be
	// watched by some members and not others, and each mark needs to survive
	// a concurrent mark by someone else — see mergeCollectionWatch in
	// collection-sync.ts for why this can't be whole-item LWW.
	watch?: Record<string, string>;
	// Which account originally added this title. Attribution, not edit
	// tracking — kept stable across merges rather than following whichever
	// side wins the field-group LWW.
	added_by_account_id?: string | null;
}

/**
 * The identity key the whole collections/sync merge system runs on — a
 * title's (media_type, tmdb_id) pair is unique within one queue or shared
 * list, and every merge/lookup keys off it. One definition so a drifted copy
 * (different separator, reversed field order) can't silently stop items from
 * matching during a merge instead of failing loudly.
 */
export function itemKey(item: { tmdb_id: number; media_type: 'movie' | 'tv' }): string {
	return `${item.media_type}:${item.tmdb_id}`;
}

/** List names this item currently belongs to — every deleted:true entry in
 *  queue_tags is a tombstone, not a membership, and must be excluded here.
 *  This is the one place that rule lives; every "is item in list X" check
 *  elsewhere should go through this or hasActiveTag rather than re-deriving
 *  it, so a missed spot can't silently resurrect a removed tag. */
export function activeQueueTags(item: { queue_tags?: WatchlistItem['queue_tags'] }): string[] {
	const tags = item.queue_tags;
	if (!tags) return [];
	return Object.keys(tags).filter((k) => !tags[k].deleted);
}

export function hasActiveTag(
	item: { queue_tags?: WatchlistItem['queue_tags'] },
	tag: string
): boolean {
	return item.queue_tags?.[tag]?.deleted !== true && item.queue_tags?.[tag] !== undefined;
}

/** First active tag, for the few spots that can only show one value — a color
 *  swatch, a share link's single-list attribution. Not meant for anything
 *  that decides membership; use hasActiveTag for that. */
export function representativeTag(item: {
	queue_tags?: WatchlistItem['queue_tags'];
}): string | null {
	return activeQueueTags(item)[0] ?? null;
}

/** Builds a one-key queue_tags map for an add-time write — the common case of
 *  "this item goes straight into list X" (or no list at all). */
export function soloTagMap(
	tag: string | null | undefined,
	at: string
): Record<string, { at: string }> | undefined {
	return tag ? { [tag]: { at } } : undefined;
}

export interface SearchResult {
	id: number;
	media_type: 'movie' | 'tv';
	title: string;
	poster_path: string | null;
	overview: string;
	year: string | null;
	providers: Provider[];
	rentable: boolean;
	runtime_minutes: number | null;
	seasons: SeasonSummary[];
	release: ReleaseInfo | null;
	genres: string[];
	cast: CastMember[];
	director: string | null;
	director_id: number | null;
	creator: string | null;
	imdb_id: string | null;
	backdrop_path: string | null;
}

export interface Suggestion {
	provider_id: number;
	name: string;
	logo_path: string;
	runtime_minutes: number;
	title_count: number;
}

export interface ShareItem {
	tmdb_id: number;
	media_type: 'movie' | 'tv';
	title: string;
	poster_path: string | null;
	providers: Provider[];
	runtime_minutes: number | null;
	seasons: Array<{ season_number: number; runtime_minutes: number }>;
	queue_tag?: string | null;
}

export interface SharePayload {
	v: 1;
	queue_name?: string;
	items: ShareItem[];
}
