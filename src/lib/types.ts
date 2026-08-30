export interface CastMember {
	name: string;
	character: string;
	profile_path: string | null;
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
	queue_tag?: string | null; // set on items imported from someone else's shared list
	genres?: string[];
	cast?: CastMember[];
	director?: string | null; // movie director
	creator?: string | null; // TV show creator(s)
	imdb_id?: string | null; // e.g. "tt0111161" — from TMDB external_ids, for a "View on IMDb" link

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
	creator: string | null;
	imdb_id: string | null;
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
