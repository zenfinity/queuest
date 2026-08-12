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
	"style-src 'self' 'unsafe-inline'; " +
	"img-src 'self' https://image.tmdb.org https://www.themoviedb.org data:; " +
	"connect-src 'self' https://api.themoviedb.org; " +
	"form-action 'self'; " +
	"object-src 'none'; " +
	"base-uri 'self'; " +
	"frame-ancestors 'none'";

export const handle: Handle = async ({ event, resolve }) => {
	event.locals.user = null;
	// adapter-cloudflare throws on any platform.env access for a prerenderable
	// route during the build's static-generation pass (there's no real Worker
	// request to bind env to yet) — `building` is true for that pass, so skip
	// session resolution entirely rather than touch platform.env at all.
	if (!building) {
		const kv = event.platform?.env?.SHARE_KV;
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
