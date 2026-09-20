import { test, expect, type Page } from '@playwright/test';
import { seedItem } from './helpers';

// Offline support (#257) — what a unit test structurally can't see: a real
// browser, a real installed service worker, and a network that then goes away.
// playwright.config.ts blocks service workers for every other spec so they stay
// deterministic; this file opts back in.
test.use({ serviceWorkers: 'allow' });

/** Waits until the worker is installed AND controlling this page — only then
 *  does the next navigation go through it. */
async function waitForWorker(page: Page): Promise<void> {
	await page.evaluate(() => navigator.serviceWorker.ready);
	await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
}

async function cachedPaths(page: Page): Promise<string[]> {
	return page.evaluate(async () => {
		const paths: string[] = [];
		for (const name of await caches.keys()) {
			const cache = await caches.open(name);
			for (const req of await cache.keys()) paths.push(new URL(req.url).pathname);
		}
		return paths;
	});
}

test('the queue boots and navigates with no network', async ({ page, context }) => {
	const title = `Offline Test ${Date.now()}`;
	await page.goto('/app?__e2e=1');
	await seedItem(page, title);
	await waitForWorker(page);
	// The queue doesn't live-refresh after a seed; reload (through the worker,
	// online) to show it.
	await page.reload();
	await expect(page.getByText(title)).toBeVisible();

	await context.setOffline(true);

	// A cold load with no network: the shell and its chunks come from the cache,
	// the queue from IndexedDB.
	await page.reload();
	await expect(page.getByText(title)).toBeVisible();

	// Client-side navigation between the main tabs needs no network either.
	await page.getByRole('link', { name: 'Lists', exact: true }).first().click();
	await expect(page).toHaveURL(/\/lists$/);
	await expect(page.getByRole('heading', { name: 'Lists' }).first()).toBeVisible();

	await page.getByRole('link', { name: 'Budget', exact: true }).first().click();
	await expect(page).toHaveURL(/\/budget$/);

	await page.getByRole('link', { name: 'Settings', exact: true }).first().click();
	await expect(page).toHaveURL(/\/settings$/);
	await expect(page.getByRole('heading', { name: 'Sync' })).toBeVisible();

	// A hard load of a tab other than the one we started on works too.
	await page.reload();
	await expect(page.getByRole('heading', { name: 'Sync' })).toBeVisible();
});

test('search says it needs a connection instead of failing silently', async ({ page, context }) => {
	await page.goto('/app');
	await waitForWorker(page);
	await context.setOffline(true);

	// Client-side navigation to /add fails its server load offline; that lands
	// on the error page, which must explain itself rather than say "500".
	await page.getByRole('link', { name: 'Add', exact: true }).first().click();
	await expect(page.getByRole('heading', { name: "You're offline" })).toBeVisible();
	await expect(page.getByText('Failed to fetch')).toHaveCount(0);

	// A hard load of /add (reopening the app there) renders the page itself,
	// with search switched off and the reason given. Chromium's offline
	// emulation reports navigator.onLine = true again on a fresh navigation
	// (real airplane mode doesn't), so send the same `offline` event a real
	// browser would.
	await page.goto('/add');
	await page.evaluate(() => window.dispatchEvent(new Event('offline')));
	await expect(page.getByRole('combobox', { name: /search movies/i })).toBeDisabled();
	await expect(page.getByText(/search needs a connection/i)).toBeVisible();

	// And it comes back when the connection does (same emulation quirk, in
	// reverse: this document thinks it was online all along, so no `online`
	// event fires by itself).
	await context.setOffline(false);
	await page.evaluate(() => window.dispatchEvent(new Event('online')));
	await expect(page.getByRole('combobox', { name: /search movies/i })).toBeEnabled();
	await expect(page.getByText(/search needs a connection/i)).toHaveCount(0);
});

test('a page that needs the network shows the offline page, not a browser error', async ({
	page,
	context
}) => {
	await page.goto('/app');
	await waitForWorker(page);
	await context.setOffline(true);

	await page.goto('/share/some-token');
	await expect(page.getByRole('heading', { name: "You're offline" })).toBeVisible();
	await expect(page.getByRole('link', { name: 'Open my queue' })).toBeVisible();
});

test('nothing from the API or a data request is ever cached', async ({ page, context }) => {
	await page.goto('/settings');
	await waitForWorker(page);

	// Touch surfaces that call the API and the server-load data endpoint, then
	// make sure none of it landed in any cache.
	await page.getByRole('link', { name: 'Add', exact: true }).first().click();
	await expect(page).toHaveURL(/\/add$/);
	await page.evaluate(async () => {
		await fetch('/api/account').catch(() => {});
		await fetch('/api/major-providers').catch(() => {});
	});

	const paths = await cachedPaths(page);
	expect(paths.length).toBeGreaterThan(0);
	expect(paths).toContain('/app');
	expect(paths.filter((p) => p.startsWith('/api/'))).toEqual([]);
	expect(paths.filter((p) => p.endsWith('__data.json'))).toEqual([]);
	expect(paths.filter((p) => p.includes('version.json'))).toEqual([]);

	// ...and offline, an API request genuinely fails rather than returning
	// something stale.
	await context.setOffline(true);
	const result = await page.evaluate(() =>
		fetch('/api/account').then(
			() => 'served',
			() => 'failed'
		)
	);
	expect(result).toBe('failed');
});

test('registering the worker raises no CSP violations, on a prerendered or a dynamic page', async ({
	page
}) => {
	const violations: string[] = [];
	page.on('console', (msg) => {
		if (/content security policy/i.test(msg.text())) violations.push(msg.text());
	});

	await page.goto('/');
	await waitForWorker(page);
	await page.goto('/app');
	await page.waitForLoadState('networkidle');

	expect(violations).toEqual([]);
});
