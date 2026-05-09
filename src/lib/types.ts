export interface Provider {
	provider_id: number;
	provider_name: string;
	logo_path: string;
}

export interface WatchlistItem {
	id: number;
	tmdb_id: number;
	media_type: 'movie' | 'tv';
	title: string;
	poster_path: string | null;
	overview: string | null;
	providers: Provider[];
	runtime_minutes: number | null;
	added_at: string;
	watched_at: string | null;
}

export interface SearchResult {
	id: number;
	media_type: 'movie' | 'tv';
	title: string;
	poster_path: string | null;
	overview: string;
	year: string | null;
	providers: Provider[];
	runtime_minutes: number | null;
}

export interface Suggestion {
	provider_id: number;
	name: string;
	logo_path: string;
	count: number;
}
