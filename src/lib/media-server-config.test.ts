import { describe, it, expect } from 'vitest';
import { parseStoredMediaServer, mergeMediaServer } from './media-server-config';

const URL_OK = 'https://media.tail1234.ts.net';

describe('parseStoredMediaServer', () => {
	it('accepts a connection and a disconnect tombstone', () => {
		expect(
			parseStoredMediaServer({ url: URL_OK, token: 'abc', updatedAt: '2026-11-21T00:00:00.000Z' })
		).toEqual({ url: URL_OK, token: 'abc', updatedAt: '2026-11-21T00:00:00.000Z' });
		expect(
			parseStoredMediaServer({ cleared: true, updatedAt: '2026-11-21T00:00:00.000Z' })
		).toEqual({
			cleared: true,
			updatedAt: '2026-11-21T00:00:00.000Z'
		});
	});

	it('gives a pre-sync record (no updatedAt) the oldest possible timestamp', () => {
		expect(parseStoredMediaServer({ url: URL_OK, token: 'abc' })?.updatedAt).toBe(
			'1970-01-01T00:00:00.000Z'
		);
	});

	it('rejects anything that could send the token somewhere else, or junk', () => {
		const at = '2026-11-21T00:00:00.000Z';
		expect(
			parseStoredMediaServer({ url: 'https://evil.example.com', token: 'a', updatedAt: at })
		).toBeNull();
		expect(
			parseStoredMediaServer({ url: 'http://media.tail1234.ts.net', token: 'a', updatedAt: at })
		).toBeNull();
		expect(parseStoredMediaServer({ url: `${URL_OK}/`, token: 'a', updatedAt: at })).toBeNull();
		expect(parseStoredMediaServer({ url: URL_OK, token: '', updatedAt: at })).toBeNull();
		expect(
			parseStoredMediaServer({ url: URL_OK, token: 'x'.repeat(600), updatedAt: at })
		).toBeNull();
		expect(parseStoredMediaServer({ url: URL_OK, token: 'a', updatedAt: 'nope' })).toBeNull();
		expect(parseStoredMediaServer('nope')).toBeNull();
		expect(parseStoredMediaServer(null)).toBeNull();
	});
});

describe('mergeMediaServer', () => {
	const older = { url: URL_OK, token: 'old', updatedAt: '2026-11-20T00:00:00.000Z' };
	const newer = { url: URL_OK, token: 'new', updatedAt: '2026-11-21T00:00:00.000Z' };
	const cleared = { cleared: true as const, updatedAt: '2026-11-22T00:00:00.000Z' };

	it('takes the newer side, and the present side over a missing one', () => {
		expect(mergeMediaServer(older, newer)).toBe(newer);
		expect(mergeMediaServer(newer, older)).toBe(newer);
		expect(mergeMediaServer(null, newer)).toBe(newer);
		expect(mergeMediaServer(newer, null)).toBe(newer);
		expect(mergeMediaServer(null, null)).toBeNull();
	});

	it('lets a newer disconnect win over an older connection, and vice versa', () => {
		expect(mergeMediaServer(newer, cleared)).toBe(cleared);
		const reconnected = { ...newer, updatedAt: '2026-11-23T00:00:00.000Z' };
		expect(mergeMediaServer(cleared, reconnected)).toBe(reconnected);
	});
});
