import { text } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

// Cloudflare Workers' URL parser can decode '+' in query strings as spaces,
// which invalidates AWS presigned URL signatures. Re-encode '+' as '%2B' so
// they survive URL parsing intact.
function encodeQueryPlus(urlStr: string): string {
	const q = urlStr.indexOf('?');
	if (q === -1) return urlStr;
	return urlStr.slice(0, q + 1) + urlStr.slice(q + 1).replace(/\+/g, '%2B');
}

export const POST: RequestHandler = async ({ request }) => {
	const { url } = await request.json() as { url: string };
	if (!url || !url.startsWith('https://')) {
		return new Response('Invalid URL', { status: 400 });
	}
	let res: Response;
	try {
		res = await fetch(encodeQueryPlus(url), {
			headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Queuest/1.0)' }
		});
	} catch (e) {
		return new Response(`Could not reach URL: ${e instanceof Error ? e.message : String(e)}`, { status: 502 });
	}
	if (!res.ok) {
		const body = await res.text().catch(() => '');
		return new Response(`HTTP ${res.status}: ${body.slice(0, 300) || res.statusText}`, { status: 502 });
	}
	return text(await res.text());
};
