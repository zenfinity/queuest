import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

// Route moved to /lists/[id] (#208), which was itself retired straight
// to /lists (#284) — redirect here directly rather than double-hopping
// through a route that no longer exists as a real page.
export const load: PageServerLoad = () => {
	throw redirect(301, '/lists');
};
