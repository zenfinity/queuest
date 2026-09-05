// Typed-read helpers for localStorage with validation
// Ensures parsed JSON matches the expected type/shape, not just that parsing didn't throw

export function readNumber(key: string, fallback: number): number {
	try {
		const v = localStorage.getItem(key);
		if (!v) return fallback;
		const parsed = JSON.parse(v);
		return typeof parsed === 'number' ? parsed : fallback;
	} catch {
		return fallback;
	}
}

export function readBoolean(key: string, fallback: boolean): boolean {
	try {
		const v = localStorage.getItem(key);
		if (!v) return fallback;
		const parsed = JSON.parse(v);
		return typeof parsed === 'boolean' ? parsed : fallback;
	} catch {
		return fallback;
	}
}

export function readRecord(key: string, fallback: Record<string, string>): Record<string, string> {
	try {
		const v = localStorage.getItem(key);
		if (!v) return fallback;
		const parsed = JSON.parse(v);
		if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return fallback;
		// Validate all values are strings
		for (const [, val] of Object.entries(parsed)) {
			if (typeof val !== 'string') return fallback;
		}
		return parsed as Record<string, string>;
	} catch {
		return fallback;
	}
}
