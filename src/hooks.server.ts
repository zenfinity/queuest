import type { Handle } from '@sveltejs/kit';

// Fallback CSP for routes served by the Cloudflare Worker
// The _headers file applies CSP for static assets; this ensures all routes have it
const CSP_HEADER =
	"default-src 'self'; " +
	"script-src 'self' 'sha256-yI9WzoMpM1Q1H4JaL3EuvifigoDRR7Pfn++cvOhiXWQ='; " +
	"style-src 'self' 'unsafe-inline'; " +
	"img-src 'self' https://image.tmdb.org https://www.themoviedb.org data:; " +
	"connect-src 'self' https://api.themoviedb.org; " +
	"form-action 'self'; " +
	"object-src 'none'; " +
	"base-uri 'self'; " +
	"frame-ancestors 'none'";

export const handle: Handle = async ({ event, resolve }) => {
	const response = await resolve(event);

	// Ensure CSP header is present on all responses
	if (!response.headers.has('content-security-policy')) {
		response.headers.set('content-security-policy', CSP_HEADER);
	}

	return response;
};
