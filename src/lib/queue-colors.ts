import { readRecord } from './storage';

const NAME_KEY = 'sq:queue:name';
const COLORS_KEY = 'sq:queue:colors';

const PALETTE = [
	'#ef4444',
	'#f97316',
	'#eab308',
	'#22c55e',
	'#06b6d4',
	'#3b82f6',
	'#8b5cf6',
	'#ec4899'
];

function autoColor(name: string): string {
	let h = 5381;
	for (let i = 0; i < name.length; i++) h = ((h << 5) + h + name.charCodeAt(i)) >>> 0;
	return PALETTE[h % PALETTE.length];
}

export function getQueueName(): string {
	try {
		return localStorage.getItem(NAME_KEY) ?? 'My Queue';
	} catch {
		return 'My Queue';
	}
}

export function setQueueName(name: string): void {
	try {
		localStorage.setItem(NAME_KEY, name);
	} catch {
		// Best-effort localStorage write; app uses default queue name if save fails
	}
}

export function getQueueColors(): Record<string, string> {
	return readRecord(COLORS_KEY, {});
}

export function setQueueColor(name: string, color: string): void {
	try {
		const colors = getQueueColors();
		colors[name] = color;
		localStorage.setItem(COLORS_KEY, JSON.stringify(colors));
	} catch {
		// Best-effort localStorage write; app works fine without persisted colors
	}
}

/** Returns existing color for name, or auto-assigns one from the palette and saves it. */
export function getOrAssignColor(name: string): string {
	try {
		const colors = getQueueColors();
		if (!colors[name]) {
			const color = autoColor(name);
			colors[name] = color;
			localStorage.setItem(COLORS_KEY, JSON.stringify(colors));
			return color;
		}
		return colors[name];
	} catch {
		// Persist the auto-generated color even if reading/writing failed
		const color = autoColor(name);
		try {
			const colors = getQueueColors();
			colors[name] = color;
			localStorage.setItem(COLORS_KEY, JSON.stringify(colors));
		} catch {
			// Best-effort localStorage write; color always returned to caller regardless
		}
		return color;
	}
}

/** Moves the color entry from the old name to the new name. */
export function renameCollectionColor(from: string, to: string): void {
	try {
		const colors = getQueueColors();
		if (colors[from]) {
			colors[to] = colors[from];
			delete colors[from];
			localStorage.setItem(COLORS_KEY, JSON.stringify(colors));
		}
	} catch {
		// Best-effort localStorage write; color remains in memory regardless
	}
}

/** Removes the color entry for a collection name. */
export function deleteCollectionColor(name: string): void {
	try {
		const colors = getQueueColors();
		if (colors[name]) {
			delete colors[name];
			localStorage.setItem(COLORS_KEY, JSON.stringify(colors));
		}
	} catch {
		// Best-effort localStorage write; deletion proceeds regardless
	}
}

/**
 * Deterministic per-member color for shared-list attribution (#236) — who
 * added a title, not which list it's in. Same palette/hash as list colors,
 * but not persisted: unlike a list's color, a member's color isn't user-
 * customizable, so there's nothing to save and no cross-device drift risk.
 */
export function memberColor(userId: string): string {
	return autoColor(userId);
}

/**
 * Shared list color (#237) — server-synced on the collection record, not
 * per-device localStorage the way it used to be. That was the actual bug:
 * a manual pick on one device never reached the same member's other
 * devices, let alone other members'. Falls back to a deterministic hash of
 * the id when no override is set (`color` is null) — autoColor is pure, so
 * every device computes the identical default with nothing to cache and
 * nothing that can go stale.
 */
export function sharedListColor(collection: { id: string; color: string | null }): string {
	return collection.color ?? autoColor(collection.id);
}
