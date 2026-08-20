// Pulled out of +page.svelte's afterNavigate callback (#196) so this specific
// decision has a unit test — the bug this fixes was exactly the kind that's
// easy to reintroduce silently (a `.svelte` lifecycle hook's condition
// getting fiddled with during an unrelated change), and there's no
// component-testing harness in this repo to catch it at the markup layer.
export type LandingNavigationType = 'enter' | 'form' | 'leave' | 'link' | 'goto' | 'popstate';

/**
 * A returning user typing the bare domain should land in their queue, not on
 * marketing copy — but the logo shares that same `/` URL, and clicking it is
 * a different intent (show me the landing page). `type` is how those two are
 * told apart: 'enter' is a genuine cold load (typed URL, bookmark, external
 * link, refresh); an in-app click is 'link'. Only a cold load redirects.
 */
export function shouldRedirectToApp(
	type: LandingNavigationType,
	welcomed: boolean,
	isPreview: boolean
): boolean {
	return type === 'enter' && welcomed && !isPreview;
}
