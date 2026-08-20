import { describe, it, expect } from 'vitest';
import { toQrSvg } from './qrcode';

describe('toQrSvg', () => {
	it('renders valid SVG markup', async () => {
		const svg = await toQrSvg('https://queuest.app/collections/join/abc#dek');
		expect(svg).toContain('<svg');
		expect(svg).toContain('</svg>');
	});

	it('produces different output for different input', async () => {
		const a = await toQrSvg('https://queuest.app/collections/join/aaa#dek1');
		const b = await toQrSvg('https://queuest.app/collections/join/bbb#dek2');
		expect(a).not.toBe(b);
	});
});
