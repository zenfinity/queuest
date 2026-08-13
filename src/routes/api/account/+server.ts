import type { RequestHandler } from './$types';
import { apiError, checkSameOrigin } from '$lib/server/api';
import { deleteSession, SESSION_COOKIE } from '$lib/server/auth';

/**
 * Account deletion (#102). Removes every server-side row tied to the
 * account — the sync blob, both wrapped-DEK rows, the recovery credential,
 * and the user row itself — plus the current session. Deliberately does
 * *not* touch this device's IndexedDB: deleting the account stops syncing,
 * it doesn't wipe local data. (The client is responsible for calling
 * disableSync()/clearSyncDek() alongside this; see sync-account-actions.ts.)
 */
export const DELETE: RequestHandler = async ({ request, platform, locals, cookies }) => {
	const originError = checkSameOrigin(request);
	if (originError) return originError;

	const user = locals.user;
	if (!user) return apiError(401, 'Sign in required');

	const db = platform?.env?.DB;
	const kv = platform?.env?.SHARE_KV;
	if (!db || !kv) return apiError(503, 'Sync unavailable');

	try {
		await db.batch([
			db.prepare('DELETE FROM sync_blobs WHERE user_id = ?').bind(user.id),
			db.prepare('DELETE FROM wrapped_dek WHERE user_id = ?').bind(user.id),
			db.prepare('DELETE FROM recovery_auth WHERE user_id = ?').bind(user.id),
			db.prepare('DELETE FROM users WHERE id = ?').bind(user.id)
		]);
	} catch {
		return apiError(500, 'Could not delete account');
	}

	const token = cookies.get(SESSION_COOKIE);
	if (token) await deleteSession(kv, token);
	cookies.delete(SESSION_COOKIE, { path: '/' });

	return new Response(null, { status: 204 });
};
