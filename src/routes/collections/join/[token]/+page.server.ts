import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

// Route moved to /lists/join/[token] (#208) — collections/join leaked the
// internal "collection" name into invite links people actually paste and
// send to each other, the one surface where that name was genuinely
// user-facing. Kept as a redirect, not deleted, since invite links already
// sent out before this shipped still need to resolve. The DEK lives in the
// URL fragment, which the browser preserves across a redirect on its own
// (a fragment never reaches the server to begin with) — nothing to forward
// here beyond the token.
export const load: PageServerLoad = ({ params }) => {
	throw redirect(301, `/lists/join/${params.token}`);
};
