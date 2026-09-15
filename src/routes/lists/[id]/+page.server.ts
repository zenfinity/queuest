import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

// Standalone per-list page removed (#284) — SharedListSection's own
// accordion entry on /lists already covers everything this page did.
// Kept as a redirect, not deleted, matching every other retired route
// in this app (search, suggest, collections/join/[token]).
export const load: PageServerLoad = () => {
	throw redirect(301, '/lists');
};
