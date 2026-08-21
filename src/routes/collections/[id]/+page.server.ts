import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

// Route moved to /lists/[id] (#208) — see the sibling redirect at
// collections/join/[token] for why this is a redirect rather than a delete.
export const load: PageServerLoad = ({ params }) => {
	throw redirect(301, `/lists/${params.id}`);
};
