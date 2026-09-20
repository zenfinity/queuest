// Routing decision for the service worker (src/service-worker.ts), kept as a
// pure function so the one invariant that must never regress — API/data
// requests are never served from a cache — is unit-testable without a worker.
//
// This is an allowlist: a request only gets intercepted if it matches one of
// the kinds below; everything else returns 'passthrough' and the SW does not
// call respondWith, so the browser handles it exactly as it would with no
// service worker at all. That's what keeps /api/sync/blob and the collection
// blobs (versioned, precondition-based writes — a stale cached GET there could
// produce a spurious 409 loop or a merge against outdated state) out of every
// cache by construction rather than by remembering to exclude them.

export type RouteKind =
	/** A build/static asset in the precache list — cache-first. */
	| 'precache'
	/** One of the main app pages — network-first, precached shell as fallback. */
	| 'shell'
	/** Any other page navigation — network, with the offline page as fallback. */
	| 'navigation'
	/** Not ours to handle — leave it to the network. */
	| 'passthrough';

/** Pages precached at install and served offline. /add is included even though
 *  searching needs the network: its shell is static, and the page itself
 *  explains that. */
export const SHELL_PATHS: readonly string[] = [
	'/',
	'/app',
	'/add',
	'/lists',
	'/budget',
	'/settings'
];

export interface RouteInput {
	method: string;
	mode: string;
	url: URL;
	origin: string;
	precache: ReadonlySet<string>;
}

/** '/app/' and '/app' are the same page; query strings never matter for shells. */
export function normalizeShellPath(pathname: string): string {
	return pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
}

export function classify({ method, mode, url, origin, precache }: RouteInput): RouteKind {
	if (method !== 'GET') return 'passthrough';

	// Anything cross-origin (TMDB images included — see service-worker.ts) is the
	// browser's to fetch and cache.
	if (url.origin !== origin) return 'passthrough';

	const { pathname } = url;
	// Explicit even though the allowlist below would already skip these — they
	// are the requests where a stale cached response does real damage, so the
	// exclusion is worth stating (and testing) on its own.
	if (pathname.startsWith('/api/')) return 'passthrough';
	if (pathname.endsWith('/__data.json')) return 'passthrough';
	if (pathname === '/_app/version.json') return 'passthrough';

	if (mode === 'navigate') {
		return SHELL_PATHS.includes(normalizeShellPath(pathname)) ? 'shell' : 'navigation';
	}

	return precache.has(pathname) ? 'precache' : 'passthrough';
}
