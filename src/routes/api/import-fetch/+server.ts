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
	if (!res.ok) return new Response(
		res.status === 403 || res.status === 401
			? 'Link has expired — go back to IMDb and generate a fresh export link.'
			: `URL returned ${res.status} ${res.statusText}`,
		{ status: 502 }
	);
	return text(await res.text());
};
