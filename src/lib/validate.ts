// Shared coercion/validation primitives for untrusted JSON input (share links,
// backup files, sync snapshots from other devices). Every payload gets rebuilt
// field-by-field through these rather than spread/cast, so prototype pollution
// and unbounded strings/arrays can't ride in on a malformed or hostile payload.

export function coerceString(val: unknown, maxLen: number): string {
	const s = typeof val === 'string' ? val : '';
	return s.slice(0, maxLen);
}

export function coerceNumber(val: unknown, max?: number): number | null {
	const n = typeof val === 'number' ? val : null;
	if (n === null) return null;
	if (max !== undefined && n > max) return max;
	if (n < 0) return 0;
	return Math.round(n);
}

export function coerceBoolean(val: unknown): boolean {
	return val === true;
}

/** Validates a TMDB-style relative asset path, e.g. "/abc123.jpg". */
export function validatePath(val: unknown): string | null {
	if (typeof val !== 'string') return null;
	if (!/^\/[\w.-]+$/.test(val)) return null;
	return val;
}

/** Validates an ISO date string; returns it unchanged if parseable, else null. */
export function validateIsoDate(val: unknown): string | null {
	if (typeof val !== 'string') return null;
	const t = new Date(val).getTime();
	return isNaN(t) ? null : val;
}
