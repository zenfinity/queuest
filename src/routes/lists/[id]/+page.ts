import type { PageLoad } from './$types';

/**
 * Static override, not per-collection (#219): this route requires an
 * existing membership loaded from local, end-to-end-encrypted state, so
 * there's no server-side way to know which list a given id belongs to
 * without either decrypting it (defeats the point) or exposing collection
 * names by id to unauthenticated requests (new attack surface for no real
 * benefit — nobody shares this URL as an invite; that's what /lists/join
 * is for). This just replaces the generic app-wide branding with copy
 * that's at least specific to "a shared list", instead of nothing.
 */
export const load: PageLoad = () => ({
	ogTitle: 'Shared list on Queuest',
	ogDescription: 'See what everyone in the group has queued up, and vote on what to watch next.'
});
