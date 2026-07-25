import type { RequestHandler } from './$types';
import { b64urlEncode } from '$lib/base64url';
import { apiError, checkSameOrigin } from '$lib/server/api';

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
	const originError = checkSameOrigin(request);
	if (originError) return originError;

	const kv = platform?.env?.SHARE_KV;
	if (!kv) return apiError(503, 'Sharing unavailable');

	const body = await request.arrayBuffer();
	if (body.byteLength < MIN_BYTES) return apiError(400, 'Payload too small to be valid');
	if (body.byteLength > MAX_BYTES) return apiError(413, 'Payload too large');

	const token = makeToken();
	await kv.put(`s:${token}`, body, { expirationTtl: TTL });
	return Response.json({ token });
};

export const GET: RequestHandler = async ({ url, platform }) => {
	const kv = platform?.env?.SHARE_KV;
	if (!kv) return apiError(503, 'Sharing unavailable');

	const token = url.searchParams.get('t') ?? '';
	if (!token || token.length > 20) return apiError(400, 'Bad token');

	const blob = await kv.get(`s:${token}`, 'arrayBuffer');
	if (!blob) return apiError(404, 'Not found or expired');

	return new Response(blob, {
		headers: {
			'Content-Type': 'application/octet-stream',
			'X-Content-Type-Options': 'nosniff',
			'Content-Disposition': 'attachment'
		}
	});
};
