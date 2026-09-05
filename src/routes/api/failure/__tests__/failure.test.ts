import { describe, it, expect, vi, beforeEach } from 'vitest';

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

const { POST } = await import('../+server');
const { FAILURE_CLASSES } = await import('$lib/report-failure');

type PostEvent = Parameters<typeof POST>[0];

function mockEvent(
	body: unknown,
	opts: { kv?: unknown; writeDataPoint?: (e: unknown) => void } = {}
): PostEvent {
	const request = new Request('https://example.com', {
		method: 'POST',
		headers: { 'sec-fetch-site': 'same-origin' },
		body: JSON.stringify(body)
	});
	return {
		request,
		platform: {
			env: {
				SHARE_KV: 'kv' in opts ? opts.kv : {},
				FAILURES: opts.writeDataPoint ? { writeDataPoint: opts.writeDataPoint } : undefined
			}
		},
		getClientAddress: () => '127.0.0.1'
	} as unknown as PostEvent;
}

describe('POST /api/failure', () => {
	beforeEach(() => {
		checkRateLimit.mockReset().mockResolvedValue(true);
	});

	it('rejects cross-site requests', async () => {
		const req = new Request('https://example.com', {
			method: 'POST',
			headers: { 'sec-fetch-site': 'cross-site' },
			body: JSON.stringify({ class: 'sync_409_exhausted' })
		});
		const res = await POST({
			request: req,
			platform: { env: { SHARE_KV: {} } },
			getClientAddress: () => '127.0.0.1'
		} as unknown as PostEvent);
		expect(res.status).toBe(403);
	});

	it('no-ops when the KV binding is unavailable, rather than erroring', async () => {
		const res = await POST(mockEvent({ class: 'sync_409_exhausted' }, { kv: undefined }));
		expect(res.status).toBe(204);
	});

	it('returns 429 once the rate limit is exceeded', async () => {
		checkRateLimit.mockResolvedValue(false);
		const res = await POST(mockEvent({ class: 'sync_409_exhausted' }));
		expect(res.status).toBe(429);
	});

	it('rejects a class outside the known allowlist', async () => {
		const writeDataPoint = vi.fn();
		const res = await POST(mockEvent({ class: 'literally_anything' }, { writeDataPoint }));
		expect(res.status).toBe(400);
		expect(writeDataPoint).not.toHaveBeenCalled();
	});

	it('rejects a missing or non-string class', async () => {
		const res = await POST(mockEvent({}));
		expect(res.status).toBe(400);
	});

	it('accepts every class $lib/report-failure actually reports, not just the ones this test happens to name', async () => {
		for (const cls of FAILURE_CLASSES) {
			const res = await POST(mockEvent({ class: cls }, { writeDataPoint: vi.fn() }));
			expect(res.status).toBe(204);
		}
	});

	it('writes one content-free data point for a known class', async () => {
		const writeDataPoint = vi.fn();
		const res = await POST(mockEvent({ class: 'collection_key_rotated' }, { writeDataPoint }));

		expect(res.status).toBe(204);
		expect(writeDataPoint).toHaveBeenCalledWith({
			blobs: ['collection_key_rotated'],
			indexes: ['collection_key_rotated']
		});
	});

	it('no-ops when the FAILURES binding is unavailable (local dev), rather than erroring', async () => {
		const res = await POST(mockEvent({ class: 'collection_key_rotated' }));
		expect(res.status).toBe(204);
	});

	it('returns 400 for unparseable JSON rather than throwing', async () => {
		const request = new Request('https://example.com', {
			method: 'POST',
			headers: { 'sec-fetch-site': 'same-origin' },
			body: 'not json'
		});
		const res = await POST({
			request,
			platform: { env: { SHARE_KV: {} } },
			getClientAddress: () => '127.0.0.1'
		} as unknown as PostEvent);
		expect(res.status).toBe(400);
	});
});
