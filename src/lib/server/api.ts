import { json } from '@sveltejs/kit';

/**
 * Every API route's error responses share one JSON contract: `{ error: string }`.
 * Callers do `await res.json()` and read `.error` (see lib/http.ts's throwIfNotOk) —
 * a route that instead threw SvelteKit's error() would hand the caller an HTML
 * error page as the "message" once it called res.text()/res.json().
 */
export function apiError(status: number, message: string): Response {
	return json({ error: message }, { status });
}

/**
 * Rejects cross-site POSTs. Sec-Fetch-Site is set by all modern browsers; when
 * a client doesn't send it (older browsers, some HTTP clients) we allow the
 * request through rather than block legitimate same-origin traffic.
 */
export function checkSameOrigin(request: Request): Response | null {
	const fetchSite = request.headers.get('Sec-Fetch-Site');
	if (fetchSite && fetchSite !== 'same-origin') {
		return apiError(403, 'Forbidden');
	}
	return null;
}
