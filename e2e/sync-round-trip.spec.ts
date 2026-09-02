import { test, expect, type Page } from '@playwright/test';

// Sync round-trip (#253) — the one flow a unit test structurally can't
// catch: two independent browser contexts (two "devices"), same account,
// converging on the same server state through the real push/pull/merge
// path. This is the tripwire #221 (per-list title uniqueness) needs before
// touching sync.ts's merge key — that change risks two different-list
// copies of the same title silently collapsing into one during a merge,
// which no unit test would notice (nothing throws; it just merges wrong).
//
// Seeds via the __e2e test hook (+layout.svelte) rather than driving a real
// TMDB search — this test is about the sync round-trip, not title lookup,
// and staying off TMDB keeps it deterministic and key-independent.

const PASSPHRASE = 'e2e-test-passphrase-not-secret';

function uniqueEmail(): string {
	return `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
}

async function signUp(page: Page, email: string): Promise<void> {
	await page.goto('/settings?__e2e=1');
	await page.getByRole('button', { name: 'Enable sync' }).click();
	await page.getByLabel('Email').fill(email);
	await page.getByLabel('Passphrase', { exact: true }).fill(PASSPHRASE);
	await page.getByLabel('Confirm passphrase').fill(PASSPHRASE);
	await page.getByRole('button', { name: 'Create account' }).click();
	await page.getByLabel("I've saved this recovery code somewhere safe.").check();
	await page.getByRole('button', { name: 'Continue' }).click();
	await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
}

async function signIn(page: Page, email: string): Promise<void> {
	await page.goto('/settings?__e2e=1');
	await page.getByRole('button', { name: 'Sign in' }).click();
	await page.getByLabel('Email').fill(email);
	await page.getByLabel('Passphrase', { exact: true }).fill(PASSPHRASE);
	await page.getByRole('button', { name: 'Sign in' }).click();
	await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
}

type E2EGlobal = {
	__e2e: {
		addItem: (item: Record<string, unknown>) => Promise<unknown>;
		syncNow: () => Promise<void>;
	};
};

async function seedItem(page: Page, title: string): Promise<void> {
	// Waits for the hook itself, not just page load — it's attached via a
	// dynamic import in onMount, which can resolve a tick after navigation.
	await page.waitForFunction(() => Boolean((window as unknown as Partial<E2EGlobal>).__e2e));
	await page.evaluate(async (t: string) => {
		const { __e2e } = window as unknown as E2EGlobal;
		await __e2e.addItem({
			tmdb_id: Math.floor(Math.random() * 1_000_000),
			media_type: 'movie',
			title: t,
			poster_path: null,
			overview: null,
			providers: [],
			runtime_minutes: 100,
			seasons: [],
			watched_seasons: []
		});
		await __e2e.syncNow();
	}, title);
}

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
