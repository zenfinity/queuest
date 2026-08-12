import { describe, it, expect, vi, beforeEach } from 'vitest';

const getSession = vi.fn();

vi.mock('$lib/server/auth', () => ({
	SESSION_COOKIE: 'sq_session',
	getSession: (...args: unknown[]) => getSession(...args)
}));

// $app/environment's `building` is only ever true during SvelteKit's own
// prerender pass, never in these tests.
vi.mock('$app/environment', () => ({ building: false }));

import { handle } from './hooks.server';

type HandleEvent = Parameters<typeof handle>[0]['event'];

function makeEvent(opts: { token?: string; kv?: unknown } = {}): HandleEvent {
	const locals: Record<string, unknown> = {};
	return {
		locals,
		cookies: { get: () => opts.token },
		platform: { env: { SHARE_KV: opts.kv } }
	} as unknown as HandleEvent;
}

async function run(event: HandleEvent) {
	const resolve = vi.fn(async () => new Response('ok'));
	const response = await handle({ event, resolve } as Parameters<typeof handle>[0]);
	return { response, resolve };
}

beforeEach(() => {
	getSession.mockReset();
});

describe('hooks.server handle: session resolution', () => {
	it('sets locals.user to null when there is no session cookie', async () => {
		const event = makeEvent({ kv: {} });
		await run(event);
		expect(event.locals.user).toBeNull();
		expect(getSession).not.toHaveBeenCalled();
	});

	it('sets locals.user to null when the KV binding is missing', async () => {
		const event = makeEvent({ token: 'tok123' });
		await run(event);
		expect(event.locals.user).toBeNull();
		expect(getSession).not.toHaveBeenCalled();
	});

	it('resolves locals.user from a valid session', async () => {
		getSession.mockResolvedValue({ userId: 'u1', email: 'user@example.com' });
		const event = makeEvent({ token: 'tok123', kv: {} });

		await run(event);

		expect(event.locals.user).toEqual({ id: 'u1', email: 'user@example.com' });
	});

	it('sets locals.user to null when the session token is invalid/expired', async () => {
		getSession.mockResolvedValue(null);
		const event = makeEvent({ token: 'stale-token', kv: {} });

		await run(event);

		expect(event.locals.user).toBeNull();
	});

	it('still sets a content-security-policy header when the response is missing one', async () => {
		const event = makeEvent({ kv: {} });
		const { response } = await run(event);
		expect(response.headers.has('content-security-policy')).toBe(true);
	});

	it('does not override a content-security-policy header resolve() already set', async () => {
		const event = makeEvent({ kv: {} });
		const resolve = vi.fn(
			async () =>
				new Response('ok', { headers: { 'content-security-policy': "default-src 'none'" } })
		);
		const response = await handle({ event, resolve } as Parameters<typeof handle>[0]);
		expect(response.headers.get('content-security-policy')).toBe("default-src 'none'");
	});
});
