import { test, expect } from '@playwright/test';
import { uniqueEmail, signUp, seedItem } from './helpers';

// Invite revocation (#248) — was fully built server-side (endpoint, schema,
// resolution guard, rejection message) but unreachable: nothing in the UI
// called revokeInvite(). A unit test on the client action alone can't catch
// that gap — it would happily test a function nothing calls. This exercises
// the real path: mint an invite through the UI, revoke it through the UI,
// then confirm the link is actually dead server-side, the way a leaked or
// misdirected invite link needs to be killable.

test('revoking a pending invite from the UI kills the link', async ({ browser }) => {
	const email = uniqueEmail();
	const listName = `E2E Invite List ${Date.now()}`;

	const ownerContext = await browser.newContext();
	const ownerPage = await ownerContext.newPage();
	await signUp(ownerPage, email);
	await seedItem(ownerPage, `Title for ${listName}`, listName);

	await ownerPage.goto('/lists');

	// Promote the seeded personal list to a shared one — invites only exist
	// on shared lists.
	await ownerPage.getByRole('button', { name: 'Share', exact: true }).click();
	await ownerPage.getByRole('button', { name: 'Share it' }).click();
	await expect(ownerPage.getByText('You own this')).toBeVisible();

	// Mint an invite and read the real link (fragment included) straight from
	// the readonly field the UI shows it in.
	await ownerPage.getByRole('button', { name: 'Invite', exact: true }).click();
	const inviteLinkInput = ownerPage.locator('input[readonly]');
	await expect(inviteLinkInput).not.toHaveValue('');
	const inviteLink = await inviteLinkInput.inputValue();

	// The listing this issue's own fix introduced — without it there was no
	// way to see, let alone revoke, an outstanding invite.
	await expect(ownerPage.getByText('Pending invites')).toBeVisible();

	// Two-tap confirm, same pattern as remove-member/delete-list elsewhere.
	await ownerPage.getByRole('button', { name: 'Revoke' }).click();
	await ownerPage.getByRole('button', { name: 'Confirm' }).click();
	await expect(ownerPage.getByText('Pending invites')).not.toBeVisible();

	// The real assertion: the link is actually dead server-side, not just
	// hidden from the owner's own UI. A fresh, unauthenticated context stands
	// in for the person who received the now-revoked link.
	const visitorContext = await browser.newContext();
	const visitorPage = await visitorContext.newPage();
	await visitorPage.goto(inviteLink);
	await expect(visitorPage.getByText('This invite was revoked.')).toBeVisible();

	await ownerContext.close();
	await visitorContext.close();
});
