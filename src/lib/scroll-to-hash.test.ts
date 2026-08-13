import { describe, it, expect, vi, afterEach } from 'vitest';
import { scrollToHashTarget } from './scroll-to-hash';

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('scrollToHashTarget', () => {
	it('does nothing when there is no hash', () => {
		const getElementById = vi.fn();
		vi.stubGlobal('window', { location: { hash: '' } });
		vi.stubGlobal('document', { getElementById });
		scrollToHashTarget();
		expect(getElementById).not.toHaveBeenCalled();
	});

	it('does nothing when the hash has no matching element', () => {
		const getElementById = vi.fn(() => null);
		vi.stubGlobal('window', { location: { hash: '#suggest' } });
		vi.stubGlobal('document', { getElementById });
		expect(() => scrollToHashTarget()).not.toThrow();
		expect(getElementById).toHaveBeenCalledWith('suggest');
	});

	it('scrolls the matching element into view', () => {
		const scrollIntoView = vi.fn();
		const getElementById = vi.fn(() => ({ scrollIntoView }));
		vi.stubGlobal('window', { location: { hash: '#suggest' } });
		vi.stubGlobal('document', { getElementById });
		scrollToHashTarget();
		expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' });
	});
});
