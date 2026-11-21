/**
 * Fixed-window request counter, kept in memory in each running Worker
 * isolate. No KV reads or writes, no network calls.
 *
 * This replaced a KV-backed counter that did a KV read and a KV write on
 * every API request it let through. On the Workers free tier that's 1,000
 * writes a day for the whole app, which normal use was already halfway
 * through. Cloudflare's Rate Limiting binding would be the natural
 * replacement, but it isn't available to Pages projects.
 *
 * Tradeoff: counts are per isolate, and Cloudflare runs many isolates
 * across many locations, so a determined client spread across them gets
 * more than `max`. That's acceptable for what this guards: almost every
 * limited endpoint needs a signed-in account, and the point is stopping a
 * runaway client or a casual flood from running up costs, not strict
 * accounting. The hard backstop against one IP flooding `/api/*` is a
 * Cloudflare WAF rate-limiting rule configured in the dashboard, which
 * stops requests before they reach this code at all.
 */

interface Bucket {
	window: number;
	count: number;
}

const buckets = new Map<string, Bucket>();
/** Above this many tracked keys, expired buckets are swept so a stream of
 * one-off keys (for example many IPs) can't grow the map without bound. */
const SWEEP_THRESHOLD = 5_000;

function sweep(nowSeconds: number): void {
	for (const [key, bucket] of buckets) {
		const windowSeconds = Number(key.slice(key.lastIndexOf('|') + 1));
		if (bucket.window !== Math.floor(nowSeconds / windowSeconds)) buckets.delete(key);
	}
}

/**
 * Returns true and counts the request if `key` is under `max` requests in
 * the current `windowSeconds` window, otherwise false. Async only so the
 * signature matches the KV version it replaced; it never awaits anything.
 */
export async function checkRateLimit(
	key: string,
	max: number,
	windowSeconds: number,
	now: number = Date.now()
): Promise<boolean> {
	const nowSeconds = now / 1000;
	const window = Math.floor(nowSeconds / windowSeconds);
	// The window size is part of the key, so two limits that happen to share a
	// name but differ in window never share a bucket (and sweep can read it).
	const bucketKey = `${key}|${windowSeconds}`;
	const bucket = buckets.get(bucketKey);
	if (bucket && bucket.window === window) {
		if (bucket.count >= max) return false;
		bucket.count++;
		return true;
	}
	if (buckets.size >= SWEEP_THRESHOLD) sweep(nowSeconds);
	buckets.set(bucketKey, { window, count: 1 });
	return true;
}

/** Test-only: forget every count, so tests don't leak limits into each other. */
export function resetRateLimitsForTests(): void {
	buckets.clear();
}
