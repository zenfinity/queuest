// "What's new since you last looked" for a shared collection (#148). No
// server involvement — everything here reads timestamps #145's sync engine
// already carries (`added_at`, `watch`) and compares them to a per-account,
// per-device watermark stored locally via db.ts's generic meta store.
import { getMeta, setMeta } from './db';
import type { CollectionItem } from './collection-sync';

function watermarkKey(collectionId: string): string {
	return `collection-viewed:${collectionId}`;
}

export async function getLastViewed(collectionId: string): Promise<string | undefined> {
	return getMeta(watermarkKey(collectionId));
}

/** Call once a visit to a collection has rendered — not on every background
 * poll, or nothing would ever stay "new" long enough to notice. */
export async function markViewed(collectionId: string): Promise<void> {
	await setMeta(watermarkKey(collectionId), new Date().toISOString());
}

/**
 * True if `item` has activity — added, or someone's watch mark set — after
 * `watermark`. No watermark (never viewed) means nothing is flagged: everything
 * in a collection you haven't opened yet is "unseen" in a trivial sense, not
 * "new since you looked," and flooding a first visit with badges on every
 * item would just be noise.
 */
export function hasNewActivity(item: CollectionItem, watermark: string | undefined): boolean {
	if (!watermark) return false;
	if (item.added_at > watermark) return true;
	return Object.values(item.watch ?? {}).some((ts) => ts > watermark);
}

/** Count of items with new activity — the badge shown on the collection's
 * entry point before anyone has opened it this visit. */
export function countNewActivity(items: CollectionItem[], watermark: string | undefined): number {
	if (!watermark) return 0;
	return items.filter((i) => hasNewActivity(i, watermark)).length;
}
