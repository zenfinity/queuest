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
	} catch {}
}

export function getQueueColors(): Record<string, string> {
	try {
		return JSON.parse(localStorage.getItem(COLORS_KEY) ?? '{}');
	} catch {
		return {};
	}
}

export function setQueueColor(name: string, color: string): void {
	try {
		const colors = getQueueColors();
		colors[name] = color;
		localStorage.setItem(COLORS_KEY, JSON.stringify(colors));
	} catch {}
}

/** Returns existing color for name, or auto-assigns one from the palette and saves it. */
export function getOrAssignColor(name: string): string {
	try {
		const colors = getQueueColors();
		if (!colors[name]) {
			colors[name] = autoColor(name);
			localStorage.setItem(COLORS_KEY, JSON.stringify(colors));
		}
		return colors[name];
	} catch {
		return autoColor(name);
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
	} catch {}
}

/** Removes the color entry for a collection name. */
export function deleteCollectionColor(name: string): void {
	try {
		const colors = getQueueColors();
		if (colors[name]) {
			delete colors[name];
			localStorage.setItem(COLORS_KEY, JSON.stringify(colors));
		}
	} catch {}
}
