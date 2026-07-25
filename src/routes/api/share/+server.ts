import type { RequestHandler } from './$types';
import { b64urlEncode } from '$lib/base64url';

const TOKEN_BYTES = 9; // → 12 base64url chars
const MAX_BYTES = 512_000;
const TTL = 30 * 24 * 60 * 60; // 30 days

// AES-GCM payloads from encryptWithKey() are laid out as [iv 12B][ciphertext].
// The GCM auth tag (16B) is appended to the ciphertext even for empty plaintext,
// so nothing smaller than this can possibly be a valid share blob.
const MIN_BYTES = 12 + 16;

function makeToken(): string {
	return b64urlEncode(crypto.getRandomValues(new Uint8Array(TOKEN_BYTES)));
}

export const POST: RequestHandler = async ({ request, platform }) => {
	const fetchSite = request.headers.get('Sec-Fetch-Site');
	if (fetchSite && fetchSite !== 'same-origin') {
		return new Response('Forbidden', { status: 403 });
	}

	const kv = platform?.env?.SHARE_KV;
	if (!kv) return new Response('Sharing unavailable', { status: 503 });

	const body = await request.arrayBuffer();
	if (body.byteLength < MIN_BYTES)
		return new Response('Payload too small to be valid', { status: 400 });
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

	return new Response(blob, {
		headers: {
			'Content-Type': 'application/octet-stream',
			'X-Content-Type-Options': 'nosniff',
			'Content-Disposition': 'attachment'
		}
	});
};
