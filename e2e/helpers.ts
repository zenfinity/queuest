import { expect, type Page } from '@playwright/test';

// Shared helpers for e2e specs (#253). Deliberately not named *.spec.ts /
// *.test.ts so Playwright's default testMatch doesn't pick this file up as a
// test itself.

export const PASSPHRASE = 'e2e-test-passphrase-not-secret';

export function uniqueEmail(): string {
	return `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
}

export async function signUp(page: Page, email: string): Promise<void> {
	await page.goto('/settings?__e2e=1');
	// Two distinct "Create account" buttons exist in sequence, never both in
	// the DOM at once — this one switches choose -> signup view (#265 renamed
	// it from "Enable sync"); the one below (line 19) submits that form.
	await page.getByRole('button', { name: 'Create account' }).click();
	await page.getByLabel('Email').fill(email);
	await page.getByLabel('Passphrase', { exact: true }).fill(PASSPHRASE);
	await page.getByLabel('Confirm passphrase').fill(PASSPHRASE);
	await page.getByRole('button', { name: 'Create account' }).click();
	await page.getByLabel("I've saved this recovery code somewhere safe.").check();
	await page.getByRole('button', { name: 'Continue' }).click();
	await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
}

export async function signIn(page: Page, email: string): Promise<void> {
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

/** Seeds one item via the __e2e test hook, bypassing the real TMDB search —
 *  keeps these tests deterministic and key-independent. `queueTag` puts the
 *  item on a named personal list (e.g. so it can be promoted to a shared one). */
export async function seedItem(page: Page, title: string, queueTag?: string): Promise<void> {
	// Waits for the hook itself, not just page load — it's attached via a
	// dynamic import in onMount, which can resolve a tick after navigation.
	await page.waitForFunction(() => Boolean((window as unknown as Partial<E2EGlobal>).__e2e));
	await page.evaluate(
		async ({ t, tag }: { t: string; tag: string | undefined }) => {
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
				watched_seasons: [],
				queue_tag: tag ?? null
			});
			await __e2e.syncNow();
		},
		{ t: title, tag: queueTag }
	);
}
