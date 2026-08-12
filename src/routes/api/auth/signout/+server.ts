import type { RequestHandler } from './$types';
import { checkSameOrigin } from '$lib/server/api';
import { deleteSession, SESSION_COOKIE } from '$lib/server/auth';

export const POST: RequestHandler = async ({ request, platform, cookies }) => {
	const originError = checkSameOrigin(request);
	if (originError) return originError;

	const kv = platform?.env?.SHARE_KV;
	const token = cookies.get(SESSION_COOKIE);
	if (kv && token) await deleteSession(kv, token);

	cookies.delete(SESSION_COOKIE, { path: '/' });

	return new Response(null, { status: 204 });
};
