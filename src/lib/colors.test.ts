import { describe, it, expect } from 'vitest';
import { hexToHue, resolvedHue } from './colors';

describe('hexToHue', () => {
	it('extracts the hue from pure red, green, and blue', () => {
		expect(hexToHue('#ff0000')).toBe(0);
		expect(hexToHue('#00ff00')).toBe(120);
		expect(hexToHue('#0000ff')).toBe(240);
	});

	it('handles a hex string without the leading #', () => {
		expect(hexToHue('ff0000')).toBe(0);
	});

	it('returns 0 for an achromatic (gray) color rather than NaN', () => {
		expect(hexToHue('#888888')).toBe(0);
	});

	it('returns null for an invalid hex string', () => {
		expect(hexToHue('not-a-color')).toBeNull();
		expect(hexToHue('#fff')).toBeNull(); // 3-digit shorthand not supported
	});

	it('matches one of the app palette colors to a stable hue', () => {
		// #ef4444 — the first PALETTE entry in queue-colors.ts
		expect(hexToHue('#ef4444')).toBeCloseTo(0, 0);
	});
});

describe('resolvedHue', () => {
	it('returns null for a null provider id', () => {
		expect(resolvedHue(null)).toBeNull();
	});

	it('returns a known brand hue for a recognized provider', () => {
		expect(resolvedHue(8)).toBe(4); // Netflix
	});
});
