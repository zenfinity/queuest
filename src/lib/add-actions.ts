import type { SearchResult, WatchlistItem } from './types';
import { addItem } from './db';
import { isConstraintError } from './http';

export interface AddActionDeps {
	setAdding: (id: number, adding: boolean) => void;
	setAdded: (id: number, added: boolean) => void;
	setError: (id: number, error: string) => void;
}

export async function addSearchResultToQueue(
	result: SearchResult,
	deps: AddActionDeps
): Promise<void> {
	deps.setAdding(result.id, true);
	deps.setError(result.id, '');

	try {
		const item: Omit<WatchlistItem, 'id' | 'added_at' | 'watched_at'> = {
			tmdb_id: result.id,
			media_type: result.media_type,
			title: result.title,
			poster_path: result.poster_path,
			overview: result.overview,
			providers: result.providers,
			rentable: result.rentable,
			runtime_minutes: result.runtime_minutes,
			seasons: result.seasons,
			watched_seasons: [],
			release: result.release,
			genres: result.genres,
			cast: result.cast,
			director: result.director,
			creator: result.creator
		};
		await addItem(item);
		deps.setAdded(result.id, true);
	} catch (e) {
		if (isConstraintError(e)) {
			deps.setAdded(result.id, true);
		} else {
			const msg = e instanceof Error ? e.message : 'Failed to add';
			deps.setError(result.id, msg);
		}
	} finally {
		deps.setAdding(result.id, false);
	}
}
