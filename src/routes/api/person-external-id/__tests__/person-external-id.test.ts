import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$env/dynamic/private', () => ({ env: { TMDB_API_KEY: 'test-key' } }));

vi.mock('$lib/server/api', () => ({
	apiError: (status: number, message: string) =>
		new Response(JSON.stringify({ error: message }), { status }),
	checkSameOrigin: (request: Request) => {
		const fetchSite = request.headers.get('sec-fetch-site');
		if (fetchSite && fetchSite !== 'same-origin') {
			return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 });
		}
		return null;
	}
}));

const checkRateLimit = vi.fn();
vi.mock('$lib/server/rate-limit', () => ({
	checkRateLimit: (...args: unknown[]) => checkRateLimit(...args)
}));

const getPersonExternalId = vi.fn();
vi.mock('$lib/tmdb', () => ({
	getPersonExternalId: (...args: unknown[]) => getPersonExternalId(...args)
}));

const { GET } = await import('../+server');

type GetEvent = Parameters<typeof GET>[0];

function mockEvent(id: string, opts: { kv?: unknown } = {}): GetEvent {
	const request = new Request('https://example.com', {
		headers: { 'sec-fetch-site': 'same-origin' }
	});
	return {
		url: new URL(`https://example.com/api/person-external-id?id=${encodeURIComponent(id)}`),
		request,
		platform: { env: { SHARE_KV: 'kv' in opts ? opts.kv : {} } },
		getClientAddress: () => '127.0.0.1'
	} as unknown as GetEvent;
}

describe('GET /api/person-external-id', () => {
	beforeEach(() => {
		getPersonExternalId.mockReset();
		checkRateLimit.mockReset().mockResolvedValue(true);
	});

	it('rejects cross-site requests', async () => {
		const req = new Request('https://example.com', { headers: { 'sec-fetch-site': 'cross-site' } });
		const res = await GET({
			url: new URL('https://example.com/api/person-external-id?id=1'),
			request: req,
			platform: { env: { SHARE_KV: {} } },
			getClientAddress: () => '127.0.0.1'
		} as unknown as GetEvent);
		expect(res.status).toBe(403);
		expect(getPersonExternalId).not.toHaveBeenCalled();
	});

	it('rejects a missing or non-numeric id without calling TMDB', async () => {
		const res = await GET(mockEvent(''));
		expect(res.status).toBe(400);
		expect(getPersonExternalId).not.toHaveBeenCalled();
	});

	it('rejects a non-positive id', async () => {
		const res = await GET(mockEvent('-5'));
		expect(res.status).toBe(400);
		expect(getPersonExternalId).not.toHaveBeenCalled();
	});

	it('rejects a non-integer id', async () => {
		const res = await GET(mockEvent('1.5'));
		expect(res.status).toBe(400);
		expect(getPersonExternalId).not.toHaveBeenCalled();
	});

	it('returns 503 when the KV binding is unavailable', async () => {
		const res = await GET(mockEvent('123', { kv: undefined }));
		expect(res.status).toBe(503);
	});

	it('returns 429 once the rate limit is exceeded', async () => {
		checkRateLimit.mockResolvedValue(false);
		const res = await GET(mockEvent('123'));
		expect(res.status).toBe(429);
		expect(getPersonExternalId).not.toHaveBeenCalled();
	});

	it('returns the resolved imdb_id with a long cache header', async () => {
		getPersonExternalId.mockResolvedValue('nm0000138');
		const res = await GET(mockEvent('123'));
		expect(await res.json()).toEqual({ imdb_id: 'nm0000138' });
		expect(res.headers.get('Cache-Control')).toContain('max-age=2592000');
	});

	it('returns 502 when the TMDB call throws', async () => {
		getPersonExternalId.mockRejectedValue(new Error('network down'));
		const res = await GET(mockEvent('123'));
		expect(res.status).toBe(502);
	});
});
