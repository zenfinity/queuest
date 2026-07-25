import type { WatchlistItem, SharePayload } from './types';
import { generateShareKey, encryptWithKey } from './crypto';
import { getQueueName } from './queue-colors';

export interface ShareCreateActionDeps {
	setShareCreating: (creating: boolean) => void;
	setShareUrl: (url: string) => void;
	setShareError: (error: string) => void;
}

export async function createShareLink(
	filteredItems: WatchlistItem[],
	selectedQueueNames: Set<string>,
	allQueueNames: string[],
	deps: ShareCreateActionDeps
): Promise<void> {
	if (!filteredItems.length) return;
	deps.setShareCreating(true);
	deps.setShareUrl('');
	deps.setShareError('');
	try {
		const activeQueues = allQueueNames.filter((q) => selectedQueueNames.has(q));
		const payload: SharePayload = {
			v: 1,
			queue_name: activeQueues.length === 1 ? activeQueues[0] : getQueueName(),
			items: filteredItems.map((item) => ({
				tmdb_id: item.tmdb_id,
				media_type: item.media_type,
				title: item.title,
				poster_path: item.poster_path,
				providers: item.providers,
				runtime_minutes: item.runtime_minutes,
				seasons: (item.seasons ?? []).map((s) => ({
					season_number: s.season_number,
					runtime_minutes: s.runtime_minutes
				})),
				queue_tag: item.queue_tag ?? null
			}))
		};
		const key = await generateShareKey();
		const blob = await encryptWithKey(JSON.stringify(payload), key);
		const res = await fetch('/api/share', {
			method: 'POST',
			headers: { 'Content-Type': 'application/octet-stream' },
			body: blob
		});
		if (!res.ok) throw new Error(await res.text().catch(() => res.statusText));
		const { token } = (await res.json()) as { token: string };
		if (typeof window !== 'undefined') {
			deps.setShareUrl(`${window.location.origin}/share/${token}#${key}`);
		}
	} catch (e) {
		deps.setShareError(e instanceof Error ? e.message : 'Failed to create share link.');
	} finally {
		deps.setShareCreating(false);
	}
}
