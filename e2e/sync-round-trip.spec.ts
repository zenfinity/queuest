import { test, expect } from '@playwright/test';
import { uniqueEmail, signUp, signIn, seedItem } from './helpers';

// Sync round-trip (#253) — the one flow a unit test structurally can't
// catch: two independent browser contexts (two "devices"), same account,
// converging on the same server state through the real push/pull/merge
// path. This is the tripwire #221 (per-list title uniqueness) needs before
// touching sync.ts's merge key — that change risks two different-list
// copies of the same title silently collapsing into one during a merge,
// which no unit test would notice (nothing throws; it just merges wrong).

test('an item added on one device syncs to another device on the same account', async ({
	browser
}) => {
	const email = uniqueEmail();
	const title = `E2E Sync Test ${Date.now()}`;

	// Two isolated contexts = two "devices": separate cookies, localStorage,
	// and IndexedDB, same server-side account.
	const contextA = await browser.newContext();
	const pageA = await contextA.newPage();
	await signUp(pageA, email);
	await seedItem(pageA, title);

	const contextB = await browser.newContext();
	const pageB = await contextB.newPage();
	await signIn(pageB, email);

	// initSyncTriggers() pulls on app load (see sync.ts) — landing on the
	// queue is enough to trigger it; the pull itself is what we're waiting on.
	await pageB.goto('/app');
	await expect(pageB.getByText(title)).toBeVisible({ timeout: 15_000 });

	await contextA.close();
	await contextB.close();
});
