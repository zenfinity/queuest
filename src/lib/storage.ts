// Typed-read helpers for localStorage with validation
// Ensures parsed JSON matches the expected type/shape, not just that parsing didn't throw

export function readString(key: string, fallback: string): string {
	try {
		const v = localStorage.getItem(key);
		if (!v) return fallback;
		const parsed = JSON.parse(v);
		return typeof parsed === 'string' ? parsed : fallback;
	} catch {
		return fallback;
	}
}

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
		for (const [k, val] of Object.entries(parsed)) {
			if (typeof val !== 'string') return fallback;
		}
		return parsed as Record<string, string>;
	} catch {
		return fallback;
	}
}

export function readArray<T>(
	key: string,
	fallback: T[],
	validate: (item: unknown) => item is T
): T[] {
	try {
		const v = localStorage.getItem(key);
		if (!v) return fallback;
		const parsed = JSON.parse(v);
		if (!Array.isArray(parsed)) return fallback;
		// Validate all items match the validator
		if (!parsed.every(validate)) return fallback;
		return parsed as T[];
	} catch {
		return fallback;
	}
}

export function readDate(key: string, fallback: Date | null): Date | null {
	try {
		const v = localStorage.getItem(key);
		if (!v) return fallback;
		const parsed = JSON.parse(v);
		if (typeof parsed !== 'string') return fallback;
		const date = new Date(parsed);
		// Ensure the date is valid (not NaN)
		return isNaN(date.getTime()) ? fallback : date;
	} catch {
		return fallback;
	}
}
