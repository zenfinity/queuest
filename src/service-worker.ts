/// <reference types="@sveltejs/kit" />
/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />

// Offline support (#257). The queue lives in IndexedDB and every main view
// reads only local state, so all the app needs offline is its own code:
// this worker makes the app shell and its assets available without a network
// and says nothing else about data. What gets intercepted is decided by
// classify() in $lib/sw-routing.ts — an allowlist, so API and data requests
// are never touched, let alone cached.
//
// TMDB posters are deliberately not handled here: TMDB serves them with a
// year-long max-age, so the browser's own HTTP cache already shows any poster
// you've seen offline. Caching them in the worker as well would need a
// connect-src CSP exception just for this file (its own fetches are checked
// against the CSP it's served with), and a mistake there would break posters
// for everyone, online included.

import { build, files, version } from '$service-worker';
import { SHELL_PATHS, classify, normalizeShellPath } from '$lib/sw-routing';
import { OFFLINE_HTML } from '$lib/sw-offline-page';

const sw = self as unknown as ServiceWorkerGlobalScope;

// Versioned: a new build gets a fresh cache and the old one is deleted on
// activate.
const CACHE = `queuest-${version}`;
// How long to wait on the network for a page before falling back to the
// precached shell. Airplane mode fails instantly; this bounds the "connected
// but not really" case (a tunnel, a bad hotel wifi).
const NAV_TIMEOUT_MS = 3000;

// `_app/version.json` is what SvelteKit polls to notice a new deploy — it has
// to reach the network every time, never a cache.
const ASSETS = [...build, ...files].filter((path) => path !== '/_app/version.json');
const PRECACHE = new Set(ASSETS);

async function precache(): Promise<void> {
	const cache = await caches.open(CACHE);

	// Shell HTML first, then the assets it references. If a deploy lands
	// mid-install, an asset from the old build 404s and addAll rejects, which
	// aborts the install — safe — rather than leaving HTML from one build in
	// the cache next to chunks from another.
	for (const path of SHELL_PATHS) {
		const res = await fetch(path, { cache: 'reload' });
		if (!res.ok || res.redirected || !res.headers.get('content-type')?.includes('text/html')) {
			throw new Error(`Could not precache ${path} (${res.status})`);
		}
		await cache.put(path, res);
	}

	// `files` (static/) aren't content-hashed, so bypass the HTTP cache for
	// them; `build` chunks are, and are safe to take from it.
	const staticFiles = new Set<string>(files);
	await Promise.all(
		ASSETS.map(async (path) => {
			const res = await fetch(path, { cache: staticFiles.has(path) ? 'reload' : 'default' });
			if (!res.ok) throw new Error(`Could not precache ${path} (${res.status})`);
			await cache.put(path, res);
		})
	);
}

sw.addEventListener('install', (event) => {
	// skipWaiting is safe here because pages are network-first (below): there's
	// no cache-first shell for a new worker to strand. It also means a broken
	// worker can always be replaced by a fixed one.
	event.waitUntil(precache().then(() => sw.skipWaiting()));
});

sw.addEventListener('activate', (event) => {
	event.waitUntil(
		(async () => {
			for (const key of await caches.keys()) {
				if (key.startsWith('queuest-') && key !== CACHE) {
					await caches.delete(key);
				}
			}
			// Take control of the page that registered us, so the very first
			// visit is already offline-capable instead of needing a reload.
			await sw.clients.claim();
		})()
	);
});

async function cachedAsset(request: Request, pathname: string): Promise<Response> {
	const cache = await caches.open(CACHE);
	return (await cache.match(pathname)) ?? fetch(request);
}

// Built in the worker rather than fetched: see sw-offline-page.ts.
function offlinePage(): Response {
	return new Response(OFFLINE_HTML, {
		headers: { 'content-type': 'text/html; charset=utf-8' }
	});
}

async function fetchWithTimeout(request: Request, ms: number): Promise<Response> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), ms);
	try {
		return await fetch(request, { signal: controller.signal });
	} finally {
		clearTimeout(timer);
	}
}

// Network-first, so an online visit always gets the current HTML (a stale
// shell can never pin someone to an old build). The cache is a fallback only,
// and is only ever written at install — never from here — so the cached HTML
// always matches the cached chunks.
async function shell(request: Request, pathname: string): Promise<Response> {
	try {
		const res = await fetchWithTimeout(request, NAV_TIMEOUT_MS);
		// A 5xx (an outage, a failing worker) is better answered by the app
		// running on its local data than by an error page.
		if (res.status < 500) return res;
		return (await cachedShell(pathname)) ?? res;
	} catch {
		return (await cachedShell(pathname)) ?? offlinePage();
	}
}

async function cachedShell(pathname: string): Promise<Response | undefined> {
	const cache = await caches.open(CACHE);
	return cache.match(normalizeShellPath(pathname));
}

async function navigation(request: Request): Promise<Response> {
	try {
		return await fetch(request);
	} catch {
		return offlinePage();
	}
}

sw.addEventListener('fetch', (event) => {
	const { request } = event;
	const url = new URL(request.url);
	const kind = classify({
		method: request.method,
		mode: request.mode,
		url,
		origin: sw.location.origin,
		precache: PRECACHE
	});

	switch (kind) {
		case 'precache':
			event.respondWith(cachedAsset(request, url.pathname));
			break;
		case 'shell':
			event.respondWith(shell(request, url.pathname));
			break;
		case 'navigation':
			event.respondWith(navigation(request));
			break;
		default:
			// Not intercepted: the browser handles it as if no worker existed.
			break;
	}
});
