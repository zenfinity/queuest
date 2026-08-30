import { resolveInvite } from '$lib/server/collections';
import type { PageServerLoad } from './$types';

/**
 * Best-effort only (#219): this seeds og:title/og:description so a link
 * preview shows the actual list and inviter instead of generic branding.
 * The confirm screen re-fetches the same preview client-side in onMount —
 * that copy is the one that's allowed to fail loudly and is rate-limited;
 * this one just silently falls back to the layout's defaults so a bad or
 * expired token never breaks the page itself from rendering.
 */
export const load: PageServerLoad = async ({ params, platform }) => {
	const db = platform?.env?.DB;
	if (!db) return {};

	const result = await resolveInvite(db, params.token ?? '');
	if ('rejected' in result) return {};

	const { collection_name, inviter_email } = result.invite;
	return {
		ogTitle: `Join "${collection_name}" on Queuest`,
		ogDescription: `${inviter_email} invited you to a shared watchlist.`
	};
};
