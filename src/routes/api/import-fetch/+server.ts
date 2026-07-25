import { text, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

const ALLOWED_HOSTS = new Set([
	'www.criterion.com',
	'criterion.com',
	'letterboxd.com',
	'www.letterboxd.com',
	'www.imdb.com',
	'imdb.com'
]);

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024; // 2 MB
const TIMEOUT_MS = 10_000;

// Cloudflare Workers' URL parser can decode '+' in query strings as spaces,
// which invalidates AWS presigned URL signatures. Re-encode '+' as '%2B' so
// they survive URL parsing intact.
function encodeQueryPlus(urlStr: string): string {
	const q = urlStr.indexOf('?');
	if (q === -1) return urlStr;
	return urlStr.slice(0, q + 1) + urlStr.slice(q + 1).replace(/\+/g, '%2B');
}

export const POST: RequestHandler = async ({ request }) => {
	// Same-origin guard — Sec-Fetch-Site is set by all modern browsers
	const fetchSite = request.headers.get('Sec-Fetch-Site');
	if (fetchSite && fetchSite !== 'same-origin') {
		throw error(403, 'Forbidden');
	}

	const { url } = (await request.json()) as { url: string };
	if (!url || typeof url !== 'string') {
		throw error(400, 'Invalid request');
	}

	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		throw error(400, 'Invalid URL');
	}

	if (parsed.protocol !== 'https:' || !ALLOWED_HOSTS.has(parsed.hostname)) {
		throw error(400, 'URL not permitted');
	}

	let res: Response;
	try {
		res = await fetch(encodeQueryPlus(url), {
			headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Queuest/1.0)' },
			signal: AbortSignal.timeout(TIMEOUT_MS),
			redirect: 'follow'
		});
	} catch (e) {
		throw error(502, `Could not reach URL: ${e instanceof Error ? e.message : String(e)}`);
	}

	if (!res.ok) {
		throw error(502, `HTTP ${res.status}`);
	}

	// Cap response size before reading into memory
	const contentLength = res.headers.get('content-length');
	if (contentLength && parseInt(contentLength, 10) > MAX_RESPONSE_BYTES) {
		throw error(413, 'Response too large');
	}

	const reader = res.body?.getReader();
	if (!reader) return text('');

	const chunks: Uint8Array[] = [];
	let total = 0;
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		total += value.byteLength;
		if (total > MAX_RESPONSE_BYTES) {
			reader.cancel();
			throw error(413, 'Response too large');
		}
		chunks.push(value);
	}

	const merged = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		merged.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return text(new TextDecoder().decode(merged));
};
