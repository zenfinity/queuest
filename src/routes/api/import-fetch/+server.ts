import { text } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
	const { url } = await request.json() as { url: string };
	if (!url || !url.startsWith('https://')) {
		return new Response('Invalid URL', { status: 400 });
	}
	let res: Response;
	try {
		res = await fetch(url);
	} catch {
		return new Response('Could not reach that URL', { status: 502 });
	}
	if (!res.ok) return new Response('URL returned an error', { status: 502 });
	return text(await res.text());
};
