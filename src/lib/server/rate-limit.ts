import type { KVNamespace } from '@cloudflare/workers-types';

// Fixed-window counter in KV. Not atomic — a burst of concurrent requests can
// each read the same pre-increment count and all be admitted — but KV has no
// atomic increment, and a soft overshoot by a few requests is an acceptable
// tradeoff for "stop an uncapped, unthrottled endpoint from running up a
// Cloudflare bill," which is the actual threat this defends against.
export async function checkRateLimit(
	kv: KVNamespace,
	key: string,
	max: number,
	windowSeconds: number
): Promise<boolean> {
	const window = Math.floor(Date.now() / 1000 / windowSeconds);
	const kvKey = `rl:${key}:${window}`;
	const current = Number((await kv.get(kvKey)) ?? '0');
	if (current >= max) return false;
	// TTL outlives the window slightly so a key never lingers past its
	// window's expiry due to Worker clock/KV-propagation slop.
	await kv.put(kvKey, String(current + 1), { expirationTtl: windowSeconds + 10 });
	return true;
}
