import type { Handle } from '@sveltejs/kit';
import { building } from '$app/environment';
import { SESSION_COOKIE, getSession } from '$lib/server/auth';

// CSP for pages is set by SvelteKit itself — see `kit.csp` in svelte.config.js.
// It computes a fresh nonce (dynamic pages) or hash (prerendered pages) on every
// request/build, so unlike a hardcoded hash here, it can't go stale and silently
// break the app when a build changes.
//
// This fallback only matters if some response reaches the client without going
// through SvelteKit's normal render path and therefore never got a CSP header.
// It deliberately does NOT allow any inline script — if this ever fires, the
// real fix is finding why kit.csp's header is missing, not hand-authorizing a
// hash that may not match the actual inline content.
const FALLBACK_CSP =
	"default-src 'self'; " +
	"script-src 'self' https://static.cloudflareinsights.com; " +
	"style-src 'self' 'unsafe-inline'; " +
	"img-src 'self' https://image.tmdb.org https://www.themoviedb.org data:; " +
	"connect-src 'self' https://api.themoviedb.org https://cloudflareinsights.com; " +
	"form-action 'self'; " +
	"object-src 'none'; " +
	"base-uri 'self'; " +
	"frame-ancestors 'none'";

export const handle: Handle = async ({ event, resolve }) => {
	event.locals.user = null;
	// adapter-cloudflare installs a throwing getter on every platform.env key
	// for prerenderable routes (`/` is one — see routes/+page.ts), so *reading*
	// SHARE_KV throws rather than returning undefined.
	//
	// `building` covers the build's static-generation pass, but not `vite dev`,
	// where `building` is false and the same throwing getters are installed —
	// which made the landing page 500 in local dev while working fine in
	// production. Catching the access covers both: a prerenderable route has no
	// per-request session to resolve anyway, so there is nothing to fall back to.
	if (!building) {
		let kv: NonNullable<App.Platform['env']>['SHARE_KV'];
		try {
			kv = event.platform?.env?.SHARE_KV;
		} catch {
			kv = undefined;
		}
		const token = event.cookies.get(SESSION_COOKIE);
		if (kv && token) {
			const session = await getSession(kv, token);
			if (session) event.locals.user = { id: session.userId, email: session.email };
		}
	}

	const response = await resolve(event);

	if (!response.headers.has('content-security-policy')) {
		response.headers.set('content-security-policy', FALLBACK_CSP);
	}

	return response;
};
