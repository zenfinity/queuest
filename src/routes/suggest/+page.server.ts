import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

// Suggest moved into a section on /budget (#159) — same pattern as the
// earlier /search → /add redirect (#57). The #suggest anchor isn't
// guaranteed to actually scroll to the section (the page is ssr=false and
// the section's content only exists after an async fetch) — see #161.
export const load: PageServerLoad = () => {
	throw redirect(301, '/budget#suggest');
};
