import type { ShareItem } from './types';
import { addItem, getItemByTmdbId } from './db';
import { getOrAssignColor } from './queue-colors';
import { isConstraintError } from './http';

/** One title skipped because it's already in the queue — `existingTag` is
 * the list it's already under, or null for the untagged personal queue. */
export interface DuplicateSkip {
	title: string;
	existingTag: string | null;
}

export interface ShareTokenActionDeps {
	setAddingAll: (adding: boolean) => void;
	setAddedCount: (count: number) => void;
	setSkips: (skips: DuplicateSkip[]) => void;
	setAddDone: (done: boolean) => void;
	setAddError: (error: string) => void;
}

export async function addAllToQueue(
	items: ShareItem[],
	queueName: string,
	deps: ShareTokenActionDeps
): Promise<void> {
	deps.setAddingAll(true);
	deps.setAddError('');
	const fallbackTag = queueName || 'Shared List';
	getOrAssignColor(fallbackTag);
	let added = 0;
	const skips: DuplicateSkip[] = [];
	const failures: string[] = [];
	try {
		for (const item of items) {
			const tag = item.queue_tag || fallbackTag;
			if (tag !== fallbackTag) getOrAssignColor(tag);
			try {
				await addItem({
					tmdb_id: item.tmdb_id,
					media_type: item.media_type,
					title: item.title,
					poster_path: item.poster_path,
					overview: null,
					providers: item.providers.map((p) => ({
						provider_id: p.provider_id,
						provider_name: p.provider_name,
						logo_path: p.logo_path
					})),
					rentable: false,
					runtime_minutes: item.runtime_minutes,
					seasons: (item.seasons ?? []).map((s) => ({
						season_number: s.season_number,
						episode_count: 0,
						name: '',
						runtime_minutes: s.runtime_minutes
					})),
					watched_seasons: [],
					release: null,
					queue_tag: tag
				});
				added++;
			} catch (err) {
				if (isConstraintError(err)) {
					// A tombstoned row (previously removed) matches the same unique
					// index but isn't "in" any list — fall back to no tag rather
					// than misreporting where it lives.
					const existing = await getItemByTmdbId(item.tmdb_id, item.media_type);
					const existingTag =
						existing && !existing.deleted_at ? (existing.queue_tag ?? null) : null;
					skips.push({ title: item.title, existingTag });
				} else {
					const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
					console.error('addItem failed for', item.title, err);
					failures.push(`${item.title}: ${msg}`);
				}
			}
		}
		deps.setAddedCount(added);
		deps.setSkips(skips);
		deps.setAddDone(true);
		if (failures.length > 0) {
			deps.setAddError(failures.join('\n'));
		}
	} catch (e) {
		const msg = e instanceof Error ? e.message : 'Failed to add items';
		deps.setAddError(msg);
	} finally {
		deps.setAddingAll(false);
	}
}
