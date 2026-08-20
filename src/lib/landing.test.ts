import { describe, it, expect } from 'vitest';
import { shouldRedirectToApp } from './landing';

describe('shouldRedirectToApp', () => {
	it('redirects a welcomed user on a cold load', () => {
		expect(shouldRedirectToApp('enter', true, false)).toBe(true);
	});

	// #196: this is the bug — clicking the logo used to redirect right back
	// out, because the check didn't distinguish how the user got to '/'.
	it('does not redirect an in-app link click, even when welcomed', () => {
		expect(shouldRedirectToApp('link', true, false)).toBe(false);
	});

	it('does not redirect a goto() navigation', () => {
		expect(shouldRedirectToApp('goto', true, false)).toBe(false);
	});

	it('does not redirect a popstate (back/forward) navigation', () => {
		expect(shouldRedirectToApp('popstate', true, false)).toBe(false);
	});

	it('does not redirect a first-time visitor, even on a cold load', () => {
		expect(shouldRedirectToApp('enter', false, false)).toBe(false);
	});

	it('does not redirect when ?landing is present, even for a welcomed cold load', () => {
		expect(shouldRedirectToApp('enter', true, true)).toBe(false);
	});
});
