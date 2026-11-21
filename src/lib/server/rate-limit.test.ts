import { describe, it, expect } from 'vitest';
import { checkRateLimit } from './rate-limit';

describe('checkRateLimit (in memory)', () => {
	const T0 = Date.UTC(2026, 10, 21, 12, 0, 0);

	it('allows up to max requests per window, then refuses', async () => {
		for (let i = 0; i < 3; i++) expect(await checkRateLimit('k', 3, 60, T0)).toBe(true);
		expect(await checkRateLimit('k', 3, 60, T0)).toBe(false);
	});

	it('starts counting again in the next window', async () => {
		for (let i = 0; i < 2; i++) await checkRateLimit('k', 2, 60, T0);
		expect(await checkRateLimit('k', 2, 60, T0)).toBe(false);
		expect(await checkRateLimit('k', 2, 60, T0 + 60_000)).toBe(true);
	});

	it('keeps keys, and the same key with different windows, separate', async () => {
		await checkRateLimit('a', 1, 60, T0);
		expect(await checkRateLimit('a', 1, 60, T0)).toBe(false);
		expect(await checkRateLimit('b', 1, 60, T0)).toBe(true);
		expect(await checkRateLimit('a', 1, 300, T0)).toBe(true);
	});

	it('sweeps expired keys once many are tracked, without forgetting live ones', async () => {
		await checkRateLimit('live', 1, 300, T0);
		for (let i = 0; i < 5_000; i++) await checkRateLimit(`ip-${i}`, 5, 10, T0);
		// 20s later: every 10s window above has expired; 'live' (300s) hasn't.
		await checkRateLimit('trigger', 5, 10, T0 + 20_000);
		expect(await checkRateLimit('live', 1, 300, T0 + 20_000)).toBe(false);
	});
});
