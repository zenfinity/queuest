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
	providers: Provider[];
	rentable?: boolean; // true if available to rent/buy but not on subscription
	runtime_minutes: number | null; // total runtime (all seasons)
	seasons: SeasonSummary[]; // TV only; empty array for movies / pre-feature items
	watched_seasons: number[]; // season numbers fully completed
	added_at: string;
	watched_at: string | null;
	release?: ReleaseInfo | null;
	queue_tag?: string | null; // set on items imported from someone else's shared list
	genres?: string[];
	cast?: CastMember[];
	director?: string | null; // movie director
	creator?: string | null; // TV show creator(s)
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
