/** Throws the response body (or status text as a fallback) as an Error when the response failed. */
export async function throwIfNotOk(res: Response): Promise<void> {
	if (!res.ok) throw new Error(await res.text().catch(() => res.statusText));
}

/** True for the DOMException IndexedDB throws when a unique-index write collides with an existing row. */
export function isConstraintError(e: unknown): boolean {
	return e instanceof DOMException && e.name === 'ConstraintError';
}
