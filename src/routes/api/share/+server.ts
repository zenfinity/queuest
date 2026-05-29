import type { RequestHandler } from './$types';

const TOKEN_BYTES = 9; // → 12 base64url chars
const MAX_BYTES = 512_000;
const TTL = 30 * 24 * 60 * 60; // 30 days

function makeToken(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(TOKEN_BYTES));
	return btoa(String.fromCharCode(...bytes))
		.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

export const POST: RequestHandler = async ({ request, platform }) => {
	const kv = platform?.env?.SHARE_KV;
	if (!kv) return new Response('Sharing unavailable', { status: 503 });

	const body = await request.arrayBuffer();
	if (!body.byteLength) return new Response('Empty payload', { status: 400 });
	if (body.byteLength > MAX_BYTES) return new Response('Payload too large', { status: 413 });

	const token = makeToken();
	await kv.put(`s:${token}`, body, { expirationTtl: TTL });
	return Response.json({ token });
};

export const GET: RequestHandler = async ({ url, platform }) => {
	const kv = platform?.env?.SHARE_KV;
	if (!kv) return new Response('Sharing unavailable', { status: 503 });

	const token = url.searchParams.get('t') ?? '';
	if (!token || token.length > 20) return new Response('Bad token', { status: 400 });

	const blob = await kv.get(`s:${token}`, 'arrayBuffer');
	if (!blob) return new Response('Not found or expired', { status: 404 });

	return new Response(blob, { headers: { 'Content-Type': 'application/octet-stream' } });
};
