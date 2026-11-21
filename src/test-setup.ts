import { beforeEach } from 'vitest';
import { resetRateLimitsForTests } from '$lib/server/rate-limit';

// The rate limiter keeps its counts in module memory (see rate-limit.ts), so
// without this, requests made by one test would count against the next.
beforeEach(() => {
	resetRateLimitsForTests();
});
