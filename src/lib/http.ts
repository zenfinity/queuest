/**
 * Throws when the response failed. API routes return `{ error: string }`
 * JSON bodies on failure (see lib/server/api.ts) — read that message, falling
 * back to the status text for any response that isn't JSON.
 */
export async function throwIfNotOk(res: Response): Promise<void> {
	if (res.ok) return;
	let message = res.statusText;
	try {
		const data: unknown = await res.json();
		if (
			data &&
			typeof data === 'object' &&
			typeof (data as { error?: unknown }).error === 'string'
		) {
			message = (data as { error: string }).error;
		}
	} catch {
		// non-JSON body — fall back to statusText
	}
	throw new Error(message);
}

/** True for the DOMException IndexedDB throws when a unique-index write collides with an existing row. */
export function isConstraintError(e: unknown): boolean {
	return e instanceof DOMException && e.name === 'ConstraintError';
}
