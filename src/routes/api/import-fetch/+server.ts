import { text } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
	const { url } = await request.json() as { url: string };
	if (!url || !url.startsWith('https://')) {
		return new Response('Invalid URL', { status: 400 });
	}
	let res: Response;
	try {
		res = await fetch(url, {
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
