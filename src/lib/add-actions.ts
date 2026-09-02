import type { SearchResult, WatchlistItem } from './types';
import { addItem } from './db';
import { isConstraintError } from './http';
import { addItemsToSharedCollection, type SharedCollection } from './collection-actions';

export interface AddActionDeps {
	setAdding: (id: number, adding: boolean) => void;
	setAdded: (id: number, added: boolean) => void;
	setError: (id: number, error: string) => void;
}

async function addAndPlace(
	result: SearchResult,
	queueTag: string | undefined,
	sharedCollection: SharedCollection | undefined,
	deps: AddActionDeps
): Promise<void> {
	deps.setAdding(result.id, true);
	deps.setError(result.id, '');

	try {
		const item: Omit<WatchlistItem, 'id' | 'added_at' | 'watched_at' | 'updated_at'> = {
			tmdb_id: result.id,
			media_type: result.media_type,
			title: result.title,
			poster_path: result.poster_path,
			overview: result.overview,
			year: result.year,
			providers: result.providers,
			rentable: result.rentable,
			runtime_minutes: result.runtime_minutes,
			seasons: result.seasons,
			watched_seasons: [],
			release: result.release,
			genres: result.genres,
			cast: result.cast,
			director: result.director,
			director_id: result.director_id,
			creator: result.creator,
			imdb_id: result.imdb_id,
			queue_tag: queueTag
		};
		const created = await addItem(item);

		if (sharedCollection) {
			// Same "blob write, then remove locally" ordering promoteCollection
			// relies on — a failure here leaves the title in the personal queue
			// (untagged) rather than losing it, at the cost of a retry not
			// re-attempting the shared push specifically.
			const ok = await addItemsToSharedCollection(sharedCollection, [created], {
				setBusy: () => {},
				setError: (msg) => deps.setError(result.id, msg)
			});
			if (!ok) return;
		}

		deps.setAdded(result.id, true);
	} catch (e) {
		if (isConstraintError(e)) {
			// #221 — the store's uniqueness is per list now, so this can only
			// mean "already have this exact title in this exact target"
			// (untagged, or the specific list passed in queueTag) — unlike
			// before #221, it can no longer mean "already have it under some
			// other list," since that case now succeeds as a second row
			// instead of colliding. Nothing left to disambiguate: treating an
			// exact-target repeat as an already-satisfied "add" is correct
			// as-is, no lookup needed.
			deps.setAdded(result.id, true);
		} else {
			const msg = e instanceof Error ? e.message : 'Failed to add';
			deps.setError(result.id, msg);
		}
	} finally {
		deps.setAdding(result.id, false);
	}
}

export async function addSearchResultToQueue(
	result: SearchResult,
	deps: AddActionDeps
): Promise<void> {
	return addAndPlace(result, undefined, undefined, deps);
}

export type AddListTarget = { tag: string } | { collection: SharedCollection };

// The one-tap-away targeted version of addSearchResultToQueue — lands the
// title straight in a personal or shared list instead of the untagged queue,
// skipping the "add, then open the detail panel to assign a list" round trip.
export async function addSearchResultToList(
	result: SearchResult,
	target: AddListTarget,
	deps: AddActionDeps
): Promise<void> {
	if ('tag' in target) {
		return addAndPlace(result, target.tag, undefined, deps);
	}
	return addAndPlace(result, undefined, target.collection, deps);
}
