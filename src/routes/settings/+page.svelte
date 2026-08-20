<script lang="ts">
	import type { WatchlistItem } from '$lib/types';
	import { resolve } from '$app/paths';
	import { onMount } from 'svelte';
	import { getAll, renameCollectionTag, clearCollectionTag } from '$lib/db';
	import { theme, toggleTheme } from '$lib/theme.svelte';
	import { trapFocus } from '$lib/focus-trap';
	import {
		buildExportBlob,
		refreshProviders,
		submitFeedback as submitFeedbackAction,
		resetEverything
	} from '$lib/settings-actions';
	import {
		isSyncEnabled,
		syncNow,
		onSyncStatusChange,
		getSyncStatus,
		type SyncStatus
	} from '$lib/sync';
	import {
		signUp,
		signIn,
		recoverAccount,
		finishRecovery,
		signOut,
		deleteAccount
	} from '$lib/sync-account-actions';
	import {
		listCollections as listSharedCollections,
		promoteCollection,
		createInvite,
		removeMemberAndRotate,
		listMembers,
		loadCollectionItems,
		type SharedCollection,
		type CollectionMember
	} from '$lib/collection-actions';
	import { getLastViewed, countNewActivity } from '$lib/collection-activity';
	import { createShareLink } from '$lib/share-create-actions';

	import {
		getQueueName,
		setQueueName,
		getQueueColors,
		setQueueColor,
		renameCollectionColor,
		deleteCollectionColor
	} from '$lib/queue-colors';
	import { listCollections } from '$lib/queue-actions';
	import pkg from '../../../package.json';

	const VERSION = pkg.version;
	const GITHUB_REPO = 'https://github.com/zenfinity/queuest';

	// ── Export ────────────────────────────────────────────────────────────────
	let exportPassphrase = $state('');
	let exporting = $state(false);
	let exportDone = $state(false);
	let exportError = $state('');

	async function doExport() {
		if (!exportPassphrase) return;
		exporting = true;
		exportDone = false;
		exportError = '';
		try {
			const blob = await buildExportBlob(exportPassphrase);
			const url = URL.createObjectURL(blob);
			Object.assign(document.createElement('a'), {
				href: url,
				download: `queuest-${new Date().toISOString().slice(0, 10)}.queuest`
			}).click();
			URL.revokeObjectURL(url);
			exportPassphrase = '';
			exportDone = true;
		} catch (e) {
			exportError = e instanceof Error ? e.message : 'Could not export your queue.';
		} finally {
			exporting = false;
		}
	}

	// ── Refresh providers ─────────────────────────────────────────────────────
	let refreshing = $state(false);
	let refreshTotal = $state(0);
	let refreshDone = $state(0);
	let refreshError = $state('');
	let refreshSuccess = $state(false);

	async function doRefresh() {
		await refreshProviders({
			setRefreshing: (v) => (refreshing = v),
			setRefreshError: (v) => (refreshError = v),
			setRefreshSuccess: (v) => (refreshSuccess = v),
			setRefreshTotal: (v) => (refreshTotal = v),
			setRefreshDone: (v) => (refreshDone = v),
			setFeedbackError: () => {},
			setFeedbackIssueUrl: () => {}
		});
	}

	// ── Feedback ──────────────────────────────────────────────────────────────
	let feedbackOpen = $state(false);
	let feedbackTitle = $state('');
	let feedbackBody = $state('');
	let feedbackSending = $state(false);
	let feedbackError = $state('');
	let feedbackIssueUrl = $state('');

	function openFeedback() {
		feedbackOpen = true;
		feedbackTitle = '';
		feedbackBody = '';
		feedbackError = '';
		feedbackIssueUrl = '';
	}
	function closeFeedback() {
		feedbackOpen = false;
	}

	async function submitFeedback() {
		if (!feedbackTitle.trim()) return;
		feedbackSending = true;
		try {
			await submitFeedbackAction(feedbackTitle, feedbackBody, {
				setRefreshing: () => {},
				setRefreshError: () => {},
				setRefreshSuccess: () => {},
				setRefreshTotal: () => {},
				setRefreshDone: () => {},
				setFeedbackError: (v) => (feedbackError = v),
				setFeedbackIssueUrl: (v) => {
					feedbackIssueUrl = v;
					if (v) {
						feedbackTitle = '';
						feedbackBody = '';
					}
				}
			});
		} finally {
			feedbackSending = false;
		}
	}

	// ── Reset ─────────────────────────────────────────────────────────────────
	let resetArmed = $state(false);
	let resetting = $state(false);
	let resetError = $state('');

	async function doReset() {
		if (!resetArmed) {
			resetArmed = true;
			return;
		}
		resetting = true;
		resetError = '';
		try {
			await resetEverything();
		} catch (e) {
			resetError = e instanceof Error ? e.message : 'Could not reset your queue.';
		} finally {
			resetting = false;
		}
	}

	// ── Shared Collections ────────────────────────────────────────────────────
	let sharedCollections: SharedCollection[] = $state([]);
	let promoteArmed: string | null = $state(null);
	let promoting = $state(false);
	let promoteError = $state('');
	let openCollection: SharedCollection | null = $state(null);
	let inviteLink = $state('');
	let inviteCopied = $state(false);
	let inviteQr = $state('');
	let showInviteQr = $state(false);
	let inviteError = $state('');
	let removingMember: { collectionId: string; userId: string } | null = $state(null);
	let removalError = $state('');
	let openMembers: CollectionMember[] = $state([]);
	let loadingMembers = $state(false);
	let newActivityCounts: Record<string, number> = $state({});

	async function loadSharedCollections() {
		sharedCollections = await listSharedCollections({
			setBusy: () => {},
			setError: () => {}
		});
		// Fire off per-collection "what's new" checks in the background — each is
		// a decrypt, so this shouldn't block the list itself from rendering.
		for (const coll of sharedCollections) {
			loadActivityCount(coll);
		}
	}

	async function loadActivityCount(coll: SharedCollection) {
		const watermark = await getLastViewed(coll.id);
		if (!watermark) return;
		const items = await loadCollectionItems(coll, { setBusy: () => {}, setError: () => {} });
		newActivityCounts = { ...newActivityCounts, [coll.id]: countNewActivity(items, watermark) };
	}

	// Promotion is the only way a shared collection is born (#145) — there is no
	// create-from-scratch form, so the two Settings sections can't drift into two
	// unrelated things both called "Collections".
	async function doPromoteCollection(name: string) {
		promoting = true;
		promoteError = '';
		try {
			const created = await promoteCollection(name, items, {
				setBusy: () => {},
				setError: (e) => (promoteError = e)
			});
			if (created) {
				sharedCollections = [...sharedCollections, created];
				promoteArmed = null;
				// Drop the personal collection's color entry too. A name with no
				// items still "exists" as a palette key (see listCollections's
				// extraNames), so without this the promoted name keeps showing up
				// in both sections — the exact duplication promotion exists to end.
				deleteCollectionColor(name);
				queueColors = getQueueColors();
				items = await getAll();
				collections = listCollections(items, Object.keys(queueColors));
				updateCounts();
			}
		} finally {
			promoting = false;
		}
	}

	async function generateInviteLink() {
		if (!openCollection) return;
		inviteLink = '';
		inviteCopied = false;
		inviteQr = '';
		showInviteQr = false;
		inviteError = '';
		const link = await createInvite(openCollection, window.location.origin, {
			setBusy: () => {},
			setError: (e) => (inviteError = e)
		});
		if (link) {
			inviteLink = link;
		}
	}

	// The QR code is only rendered on demand — most people just copy the link,
	// and generating it up front would mean pulling in the encoder for every
	// visitor to this panel rather than the ones who ask for it.
	async function toggleInviteQr() {
		showInviteQr = !showInviteQr;
		if (showInviteQr && !inviteQr && inviteLink) {
			const { toQrSvg } = await import('$lib/qrcode');
			inviteQr = await toQrSvg(inviteLink);
		}
	}

	async function loadOpenMembers() {
		if (!openCollection) return;
		loadingMembers = true;
		openMembers = await listMembers(openCollection.id, { setBusy: () => {}, setError: () => {} });
		loadingMembers = false;
	}

	async function copyInviteLink() {
		if (!inviteLink) return;
		await navigator.clipboard.writeText(inviteLink);
		inviteCopied = true;
		setTimeout(() => (inviteCopied = false), 2000);
	}

	async function doRemoveMember() {
		if (!removingMember || !openCollection) return;
		const result = await removeMemberAndRotate(openCollection, removingMember.userId, {
			setBusy: () => {},
			setError: (e) => (removalError = e)
		});
		if (result) {
			// Reload the collection
			await loadSharedCollections();
			openCollection = sharedCollections.find((c) => c.id === openCollection!.id) || null;
			removingMember = null;
			await loadOpenMembers();
		}
	}

	onMount(async () => {
		await loadSharedCollections();
	});

	// ── Cancel alerts opt-in ─────────────────────────────────────────────────
	let cancelAlertsEnabled = $state(false);

	function toggleCancelAlerts() {
		cancelAlertsEnabled = !cancelAlertsEnabled;
		try {
			localStorage.setItem('sq:cancel-alerts', cancelAlertsEnabled ? 'true' : 'false');
		} catch {
			// Best-effort localStorage write; alert toggle always updates state regardless
		}
	}

	// ── Queue identity ────────────────────────────────────────────────────────
	let myQueueName = $state('My Queue');
	let queueColors = $state<Record<string, string>>({});
	let collections = $state<string[]>([]);
	let collectionCounts = $state<Record<string, number>>({});
	let items = $state<WatchlistItem[]>([]);
	let renamingCollection = $state<string | null>(null);
	let renameInput = $state('');
	let deleteArmed = $state<string | null>(null);
	let manageBusy = $state(false);
	let newCollectionInput = $state('');

	// ── Read-only link ───────────────────────────────────────────────────────
	// The account-free counterpart to Share/promote: a disposable, one-way
	// snapshot link — no sign-in for the creator or the recipient, nothing to
	// keep in sync. Folded in here as a per-collection action rather than the
	// standalone filterable page it used to be, so there's exactly one place
	// per collection that reads "make this available to someone else."
	let readOnlyLinkFor = $state<string | null>(null);
	let readOnlyLinkCreating = $state(false);
	let readOnlyLinkUrl = $state('');
	let readOnlyLinkCopied = $state(false);
	let readOnlyLinkError = $state('');

	async function createReadOnlyLink(name: string) {
		readOnlyLinkFor = name;
		readOnlyLinkUrl = '';
		readOnlyLinkCopied = false;
		readOnlyLinkError = '';
		const tagged = items.filter((i) => i.queue_tag === name);
		await createShareLink(tagged, new Set([name]), [name], {
			setShareCreating: (v) => (readOnlyLinkCreating = v),
			setShareUrl: (v) => (readOnlyLinkUrl = v),
			setShareError: (v) => (readOnlyLinkError = v)
		});
	}

	async function copyReadOnlyLink() {
		if (!readOnlyLinkUrl) return;
		await navigator.clipboard.writeText(readOnlyLinkUrl);
		readOnlyLinkCopied = true;
		setTimeout(() => (readOnlyLinkCopied = false), 2000);
	}

	function saveQueueName() {
		setQueueName(myQueueName);
	}

	function updateCollectionColor(tag: string, color: string) {
		setQueueColor(tag, color);
		queueColors = { ...queueColors, [tag]: color };
	}

	// Collections aren't a stored entity of their own — a name only "exists"
	// via items tagged with it, or (for one created here with nothing tagged
	// yet) via a color-palette entry. Assigning a palette color is therefore
	// enough to create an empty collection; see listCollections's extraNames.
	function createCollection() {
		const name = newCollectionInput.trim();
		if (!name || collections.includes(name)) {
			newCollectionInput = '';
			return;
		}
		updateCollectionColor(name, queueColors[name] ?? '#888888');
		collections = listCollections(items, Object.keys(queueColors));
		updateCounts();
		newCollectionInput = '';
	}

	async function renameCollection(oldName: string, newName: string) {
		if (!newName.trim() || newName === oldName) {
			renamingCollection = null;
			renameInput = '';
			return;
		}

		manageBusy = true;
		try {
			// NOTE: Rename is a bulk write, and with last-write-wins sync (#101), this can race with
			// per-item edits on another device. If a rename on device A races with an edit on device B
			// for the same item, the result is unpredictable — the rename may land on some items but not
			// others. This is acceptable for v1 given how rare it is; long-term fix is to version the
			// collection itself rather than denormalizing the name.
			//
			// Persist via a targeted cursor update, not getAll()+replaceAll() — replaceAll clears the
			// whole store, and getAll() (rightly) excludes soft-deleted tombstones, so replaceAll(items)
			// would silently drop them from the store instead of leaving them for GC.
			await renameCollectionTag(oldName, newName);
			for (const item of items) {
				if (item.queue_tag === oldName) {
					item.queue_tag = newName;
				}
			}
			// Move the color entry
			renameCollectionColor(oldName, newName);
			// Update local state
			queueColors = { ...queueColors };
			collections = listCollections(items, Object.keys(queueColors));
			updateCounts();
			renamingCollection = null;
			renameInput = '';
		} finally {
			manageBusy = false;
		}
	}

	async function deleteCollection(name: string) {
		if (!deleteArmed) {
			deleteArmed = name;
			return;
		}

		manageBusy = true;
		try {
			// Items are never deleted, only uncategorized. Targeted cursor update — see the
			// comment in renameCollection for why this isn't getAll()+replaceAll().
			await clearCollectionTag(name);
			for (const item of items) {
				if (item.queue_tag === name) {
					item.queue_tag = undefined;
				}
			}
			// Remove the color entry to avoid orphaned palette entries
			deleteCollectionColor(name);
			// Update local state
			queueColors = { ...queueColors };
			collections = listCollections(items, Object.keys(queueColors));
			updateCounts();
			deleteArmed = null;
		} finally {
			manageBusy = false;
		}
	}

	function updateCounts() {
		const counts: Record<string, number> = {};
		for (const collection of collections) {
			counts[collection] = items.filter((i) => i.queue_tag === collection).length;
		}
		collectionCounts = counts;
	}

	// ── Sync (#102, #103) ────────────────────────────────────────────────────
	type SyncView =
		| 'choose'
		| 'signup'
		| 'signin'
		| 'recover'
		| 'recover-new-passphrase'
		| 'recovery-code'
		| 'status';

	let syncEnabled = $state(false);
	let syncView = $state<SyncView>('choose');
	let syncBusy = $state(false);
	let syncError = $state('');
	let syncStatus = $state<SyncStatus>(getSyncStatus());

	let syncEmail = $state('');
	let syncPassphrase = $state('');
	let syncPassphraseConfirm = $state('');
	let syncRecoveryCodeInput = $state('');
	let syncNewPassphrase = $state('');
	let recoveryCodeToShow = $state('');
	let recoveryCodeSaved = $state(false);
	let recoveredDek = ''; // held in memory only between recoverAccount() and finishRecovery() — never a $state, never rendered
	let deleteAccountArmed = $state(false);
	let deletingAccount = $state(false);
	let deleteAccountError = $state('');

	const syncActionDeps = {
		setBusy: (b: boolean) => (syncBusy = b),
		setError: (e: string) => (syncError = e)
	};

	function backToSyncChoose() {
		syncError = '';
		syncEmail = '';
		syncPassphrase = '';
		syncPassphraseConfirm = '';
		syncRecoveryCodeInput = '';
		syncView = 'choose';
	}

	async function submitSyncSignup() {
		syncError = '';
		if (syncPassphrase.length < 8) {
			syncError = 'Use at least 8 characters';
			return;
		}
		if (syncPassphrase !== syncPassphraseConfirm) {
			syncError = 'Passphrases do not match';
			return;
		}
		const result = await signUp(syncEmail, syncPassphrase, syncActionDeps);
		if (result) {
			recoveryCodeToShow = result.recoveryCode;
			recoveryCodeSaved = false;
			syncEmail = result.email;
			syncPassphrase = '';
			syncPassphraseConfirm = '';
			syncView = 'recovery-code';
		}
	}

	async function submitSyncSignin() {
		const ok = await signIn(syncEmail, syncPassphrase, syncActionDeps);
		if (ok) {
			syncPassphrase = '';
			syncEnabled = true;
			syncView = 'status';
		}
	}

	async function submitSyncRecover() {
		const result = await recoverAccount(syncEmail, syncRecoveryCodeInput, syncActionDeps);
		if (result) {
			recoveredDek = result.dek;
			syncEmail = result.email;
			syncRecoveryCodeInput = '';
			syncView = 'recover-new-passphrase';
		}
	}

	async function submitSyncNewPassphrase() {
		syncError = '';
		if (syncNewPassphrase.length < 8) {
			syncError = 'Use at least 8 characters';
			return;
		}
		if (syncNewPassphrase !== syncPassphraseConfirm) {
			syncError = 'Passphrases do not match';
			return;
		}
		const ok = await finishRecovery(syncEmail, syncNewPassphrase, recoveredDek, syncActionDeps);
		if (ok) {
			recoveredDek = '';
			syncNewPassphrase = '';
			syncPassphraseConfirm = '';
			syncEnabled = true;
			syncView = 'status';
		}
	}

	function confirmRecoveryCodeSaved() {
		recoveryCodeToShow = '';
		syncEnabled = true;
		syncView = 'status';
	}

	async function doSyncSignOut() {
		await signOut(syncActionDeps);
		syncEnabled = false;
		backToSyncChoose();
	}

	async function doDeleteAccount() {
		if (!deleteAccountArmed) {
			deleteAccountArmed = true;
			return;
		}
		deletingAccount = true;
		deleteAccountError = '';
		const ok = await deleteAccount({
			setBusy: () => {},
			setError: (e) => (deleteAccountError = e)
		});
		deletingAccount = false;
		if (ok) {
			deleteAccountArmed = false;
			syncEnabled = false;
			backToSyncChoose();
		}
	}

	function formatSyncTime(iso: string | null): string {
		if (!iso) return 'never';
		const ms = Date.now() - new Date(iso).getTime();
		if (ms < 60_000) return 'just now';
		if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
		if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
		return new Date(iso).toLocaleDateString();
	}

	// Separate from the async onMount below — an async callback's return value
	// is a Promise, not a function, so Svelte can't use it for cleanup. This
	// one stays sync so the onSyncStatusChange() unsubscribe actually runs.
	onMount(() => {
		return onSyncStatusChange((s) => (syncStatus = s));
	});

	// ── Persistence ───────────────────────────────────────────────────────────
	onMount(async () => {
		cancelAlertsEnabled = localStorage.getItem('sq:cancel-alerts') === 'true';
		myQueueName = getQueueName();
		queueColors = getQueueColors();

		syncEnabled = await isSyncEnabled();
		if (syncEnabled) {
			syncView = 'status';
			await loadSharedCollections();
		}

		items = await getAll();
		collections = listCollections(items, Object.keys(queueColors));
		updateCounts();
	});
</script>

<svelte:head><title>Queuest — Settings</title></svelte:head>

<h1 class="sr-only">Settings</h1>

<div class="mx-auto max-w-md space-y-6 xs:space-y-10">
	<!-- Appearance -->
	<section class="space-y-3">
		<h2 class="text-sm font-semibold uppercase tracking-widest text-gray-500">Appearance</h2>
		<div class="flex items-center justify-between">
			<span class="text-sm text-gray-600 dark:text-gray-400">Theme</span>
			<button
				onclick={toggleTheme}
				class="flex items-center gap-2 rounded-lg bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
			>
				{#if theme.dark}☀ Light mode{:else}☾ Dark mode{/if}
			</button>
		</div>
	</section>

	<div class="border-t border-gray-200 dark:border-gray-800"></div>

	<!-- My Queue -->
	<section class="space-y-3">
		<h2 class="text-sm font-semibold uppercase tracking-widest text-gray-500">My Queue</h2>
		<p class="text-sm text-gray-600 dark:text-gray-400">
			This name appears when you share your list with others.
		</p>
		<input
			type="text"
			aria-label="Queue name"
			placeholder="My Queue"
			bind:value={myQueueName}
			oninput={saveQueueName}
			maxlength="40"
			class="w-full rounded-lg bg-gray-100 px-4 py-2 text-base sm:text-sm text-gray-900 placeholder-gray-400 outline-none ring-1 ring-gray-300 focus:ring-orange-500 dark:bg-gray-900 dark:text-white dark:placeholder-gray-500 dark:ring-gray-700"
		/>
	</section>

	<div class="border-t border-gray-200 dark:border-gray-800"></div>

	<!-- Collections -->
	<section id="collections" class="space-y-3 scroll-mt-4">
		<h2 class="text-sm font-semibold uppercase tracking-widest text-gray-500">Collections</h2>
		<p class="text-sm text-gray-600 dark:text-gray-400">
			Organize your queue into collections, then assign items to them from the detail panel.
			Importing a shared list automatically creates a collection.
		</p>
		<form
			class="flex gap-2"
			onsubmit={(e) => {
				e.preventDefault();
				createCollection();
			}}
		>
			<input
				type="text"
				maxlength="40"
				placeholder="New collection…"
				bind:value={newCollectionInput}
				class="flex-1 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-orange-500 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
			/>
			<button
				type="submit"
				disabled={!newCollectionInput.trim()}
				class="rounded-lg bg-orange-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-orange-400 disabled:opacity-50"
			>
				Create
			</button>
		</form>
		{#if collections.length === 0}
			<p class="text-sm text-gray-400 dark:text-gray-600">No collections yet.</p>
		{:else}
			<div class="space-y-2">
				{#each collections as collection (collection)}
					{@const color = queueColors[collection] ?? '#888888'}
					{@const count = collectionCounts[collection] ?? 0}
					{@const isRenaming = renamingCollection === collection}
					{@const isDeleting = deleteArmed === collection}
					{@const isPromoting = promoteArmed === collection}
					{@const isReadOnlyLink = readOnlyLinkFor === collection}
					<div>
						<div
							class="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2.5 dark:bg-gray-800/60"
						>
							<div class="flex items-center gap-2.5 min-w-0 flex-1">
								<span class="h-3 w-3 shrink-0 rounded-full" style="background:{color};"></span>
								{#if isRenaming}
									<!-- svelte-ignore a11y_autofocus -->
									<input
										type="text"
										aria-label="New collection name"
										maxlength="40"
										value={renameInput}
										oninput={(e) => (renameInput = e.currentTarget.value)}
										onkeydown={(e) => {
											if (e.key === 'Enter') renameCollection(collection, renameInput);
											if (e.key === 'Escape') renamingCollection = null;
										}}
										autofocus
										class="flex-1 rounded px-1 py-0.5 text-sm bg-white border border-gray-300 dark:bg-gray-900 dark:border-gray-600 dark:text-white focus:outline-none focus:ring-1 focus:ring-orange-500"
									/>
								{:else}
									<span class="truncate text-sm font-medium text-gray-800 dark:text-gray-200"
										>{collection}</span
									>
									<span class="shrink-0 text-xs text-gray-500 dark:text-gray-400">({count})</span>
								{/if}
							</div>
							<div class="flex items-center gap-1 ml-2 shrink-0">
								{#if isRenaming}
									<button
										disabled={manageBusy}
										onclick={() => renameCollection(collection, renameInput)}
										class="text-xs px-2 py-1 rounded text-orange-500 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50"
									>
										Save
									</button>
									<button
										disabled={manageBusy}
										onclick={() => {
											renamingCollection = null;
											renameInput = '';
										}}
										class="text-xs px-2 py-1 rounded text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50"
									>
										Cancel
									</button>
								{:else if isDeleting}
									<div class="text-xs text-gray-600 dark:text-gray-400 mr-2">
										Delete collection? Items stay.
									</div>
									<button
										disabled={manageBusy}
										onclick={() => deleteCollection(collection)}
										class="text-xs px-2 py-1 rounded text-red-500 hover:bg-red-100 dark:hover:bg-red-900/20 disabled:opacity-50"
									>
										Confirm
									</button>
									<button
										disabled={manageBusy}
										onclick={() => (deleteArmed = null)}
										class="text-xs px-2 py-1 rounded text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50"
									>
										Cancel
									</button>
								{:else}
									<label class="relative cursor-pointer" title="Change color">
										<span
											class="block h-6 w-6 rounded border border-gray-300 shadow-sm dark:border-gray-600"
											style="background:{color};"
										></span>
										<input
											type="color"
											aria-label="Collection color"
											value={color}
											oninput={(e) =>
												updateCollectionColor(
													collection,
													(e.currentTarget as HTMLInputElement).value
												)}
											class="absolute inset-0 h-full w-full cursor-pointer opacity-0"
										/>
									</label>
									{#if syncEnabled}
										<button
											disabled={manageBusy || promoting}
											onclick={() => {
												promoteArmed = collection;
												promoteError = '';
											}}
											class="text-xs px-2 py-1 rounded text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50"
											title="Share this collection with other people — everyone gets an account and stays in sync"
										>
											Share
										</button>
									{/if}
									<button
										disabled={manageBusy || readOnlyLinkCreating || count === 0}
										onclick={() => createReadOnlyLink(collection)}
										class="text-xs px-2 py-1 rounded text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50"
										title={count === 0
											? 'Add a title to this collection first'
											: "Get a link anyone can open to view this collection — no account needed, and it won't update after they open it"}
									>
										Read-only link
									</button>
									<button
										disabled={manageBusy}
										onclick={() => {
											renamingCollection = collection;
											renameInput = collection;
										}}
										class="text-xs px-2 py-1 rounded text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50"
										title="Rename collection"
									>
										Rename
									</button>
									<button
										disabled={manageBusy}
										onclick={() => deleteCollection(collection)}
										class="text-xs px-2 py-1 rounded text-gray-500 hover:bg-red-100 dark:hover:bg-red-900/20 disabled:opacity-50"
										title="Delete collection"
									>
										Delete
									</button>
								{/if}
							</div>
						</div>
						{#if isPromoting}
							<div
								class="mt-1 rounded-lg border border-orange-300 bg-orange-50 px-3 py-2.5 text-xs dark:border-orange-900/60 dark:bg-orange-950/30"
							>
								<p class="font-medium text-gray-900 dark:text-gray-100">
									Share “{collection}” with other people?
								</p>
								<p class="mt-1 text-gray-700 dark:text-gray-300">
									Its {collectionCounts[collection] ?? 0} title{(collectionCounts[collection] ??
										0) === 1
										? ''
										: 's'} move into a shared collection and leave this queue. From then on they live
									online, reachable only through this account —
									<span class="font-medium"
										>if you lose both your passphrase and your recovery code, they're gone for good.</span
									>
								</p>
								{#if promoteError}
									<p class="mt-1.5 text-red-600 dark:text-red-400">{promoteError}</p>
								{/if}
								<div class="mt-2 flex items-center gap-1">
									<button
										disabled={promoting}
										onclick={() => doPromoteCollection(collection)}
										class="rounded px-2 py-1 text-xs font-medium text-orange-600 hover:bg-orange-100 disabled:opacity-50 dark:text-orange-400 dark:hover:bg-orange-900/30"
									>
										{promoting ? 'Sharing…' : 'Share it'}
									</button>
									<button
										disabled={promoting}
										onclick={() => (promoteArmed = null)}
										class="rounded px-2 py-1 text-xs text-gray-500 hover:bg-gray-100 disabled:opacity-50 dark:hover:bg-gray-700"
									>
										Cancel
									</button>
								</div>
							</div>
						{/if}
						{#if isReadOnlyLink}
							<div
								class="mt-1 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 text-xs dark:border-gray-700 dark:bg-gray-800/60"
							>
								<p class="text-gray-700 dark:text-gray-300">
									Anyone with this link can view “{collection}” — no account needed. It's a
									snapshot: their view won't update when you change the collection, and the link
									stops working after 30 days. For an ongoing, two-way collection instead, use
									<span class="font-medium">Share</span> above.
								</p>
								{#if readOnlyLinkCreating}
									<p class="mt-1.5 text-gray-500 dark:text-gray-400">Creating link…</p>
								{:else if readOnlyLinkUrl}
									<div class="mt-2 flex gap-1">
										<input
											type="text"
											readonly
											value={readOnlyLinkUrl}
											class="flex-1 rounded px-2 py-1 bg-white border border-gray-300 text-gray-900 dark:bg-gray-900 dark:border-gray-600 dark:text-white"
										/>
										<button
											onclick={copyReadOnlyLink}
											class="px-2 py-1 rounded text-orange-600 hover:bg-orange-50 dark:text-orange-400 dark:hover:bg-orange-900/20"
										>
											{readOnlyLinkCopied ? '✓' : 'Copy'}
										</button>
									</div>
								{/if}
								{#if readOnlyLinkError}
									<p class="mt-1.5 text-red-600 dark:text-red-400">{readOnlyLinkError}</p>
								{/if}
								<button
									onclick={() => (readOnlyLinkFor = null)}
									class="mt-2 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
								>
									Close
								</button>
							</div>
						{/if}
					</div>
				{/each}
			</div>
		{/if}
	</section>

	<div class="border-t border-gray-200 dark:border-gray-800"></div>

	<!-- Shared Collections -->
	{#if syncEnabled}
		<section id="shared-collections" class="space-y-3 scroll-mt-4">
			<h2 class="text-sm font-semibold uppercase tracking-widest text-gray-500">
				Shared Collections
			</h2>
			<p class="text-sm text-gray-600 dark:text-gray-400">
				Collections you're watching through with other people. To start one, use
				<span class="font-medium">Share</span> on a collection above.
			</p>

			{#if sharedCollections.length === 0}
				<p class="text-sm text-gray-400 dark:text-gray-600">No shared collections yet.</p>
			{:else}
				<div class="space-y-2">
					{#each sharedCollections as coll (coll.id)}
						<div
							class="rounded-lg bg-gray-50 px-3 py-2.5 dark:bg-gray-800/60 flex items-center justify-between"
						>
							<div class="min-w-0 flex-1">
								<p
									class="text-sm font-medium text-gray-800 dark:text-gray-200 flex items-center gap-1.5"
								>
									{coll.name}
									{#if newActivityCounts[coll.id]}
										<span
											class="rounded-full bg-orange-500 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white"
										>
											{newActivityCounts[coll.id]} new
										</span>
									{/if}
								</p>
								<p class="text-xs text-gray-500 dark:text-gray-400">
									{coll.role === 'owner' ? 'You own this' : 'Member'}
								</p>
							</div>
							<div class="flex gap-1 ml-2">
								<a
									href={resolve('/collections/[id]', { id: coll.id })}
									class="text-xs px-2 py-1 rounded text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700"
								>
									Open
								</a>
								{#if coll.role === 'owner'}
									<button
										onclick={async () => {
											openCollection = coll;
											await generateInviteLink();
										}}
										class="text-xs px-2 py-1 rounded text-orange-600 hover:bg-orange-50 dark:text-orange-400 dark:hover:bg-orange-900/20"
									>
										Invite
									</button>
								{/if}
								<button
									onclick={() => {
										if (openCollection?.id === coll.id) {
											openCollection = null;
										} else {
											openCollection = coll;
											openMembers = [];
											loadOpenMembers();
										}
									}}
									class="text-xs px-2 py-1 rounded text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700"
								>
									{openCollection?.id === coll.id ? 'Hide' : 'Info'}
								</button>
							</div>
						</div>
						{#if openCollection?.id === coll.id}
							<div
								class="ml-3 pl-3 border-l border-gray-200 dark:border-gray-700 space-y-2 text-xs text-gray-600 dark:text-gray-400"
							>
								{#if inviteLink && openCollection.id === coll.id}
									<div class="flex gap-1">
										<input
											type="text"
											readonly
											value={inviteLink}
											class="flex-1 rounded px-2 py-1 bg-white border border-gray-300 text-gray-900 dark:bg-gray-900 dark:border-gray-600 dark:text-white"
										/>
										<button
											onclick={copyInviteLink}
											class="px-2 py-1 rounded text-orange-600 hover:bg-orange-50 dark:text-orange-400 dark:hover:bg-orange-900/20"
										>
											{inviteCopied ? '✓' : 'Copy'}
										</button>
										<button
											onclick={toggleInviteQr}
											class="px-2 py-1 rounded text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700"
										>
											{showInviteQr ? 'Hide QR' : 'QR code'}
										</button>
									</div>
									{#if showInviteQr}
										<div class="flex justify-center rounded bg-white p-2">
											{#if inviteQr}
												<!-- eslint-disable-next-line svelte/no-at-html-tags -->
												{@html inviteQr}
											{:else}
												<p class="py-8 text-gray-500">Generating…</p>
											{/if}
										</div>
									{/if}
								{/if}
								{#if inviteError}
									<p class="text-red-600 dark:text-red-400">{inviteError}</p>
								{/if}
								{#if loadingMembers}
									<p>Loading members…</p>
								{:else if removingMember?.collectionId !== coll.id}
									<ul class="space-y-1">
										{#each openMembers as member (member.userId)}
											<li class="flex items-center justify-between gap-2">
												<span class="truncate"
													>{member.email}{member.role === 'owner' ? ' (owner)' : ''}</span
												>
												{#if coll.role === 'owner' && member.role !== 'owner'}
													<button
														onclick={() => {
															removingMember = { collectionId: coll.id, userId: member.userId };
															removalError = '';
														}}
														class="shrink-0 text-red-500 hover:underline"
													>
														Remove
													</button>
												{/if}
											</li>
										{/each}
									</ul>
								{/if}
								{#if removingMember?.collectionId === coll.id}
									<div class="bg-red-50 dark:bg-red-900/20 rounded p-2 space-y-1">
										<p>Remove member and rotate key?</p>
										<div class="flex gap-1">
											<button
												onclick={doRemoveMember}
												class="px-2 py-1 rounded text-white text-xs bg-red-600 hover:bg-red-700"
											>
												Confirm
											</button>
											<button
												onclick={() => (removingMember = null)}
												class="px-2 py-1 rounded text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700"
											>
												Cancel
											</button>
										</div>
										{#if removalError}
											<p class="text-red-600 dark:text-red-400">{removalError}</p>
										{/if}
									</div>
								{/if}
							</div>
						{/if}
					{/each}
				</div>
			{/if}
		</section>
	{/if}

	<div class="border-t border-gray-200 dark:border-gray-800"></div>

	<!-- Cancel alerts -->
	<section class="space-y-3">
		<h2 class="text-sm font-semibold uppercase tracking-widest text-gray-500">
			Cancellation Alerts
		</h2>
		<p class="text-sm text-gray-600 dark:text-gray-400">
			When enabled, a banner appears on your queue when you've nearly cleared a streaming service —
			a nudge to consider pausing your subscription.
		</p>
		<div class="flex items-center justify-between">
			<span class="text-sm text-gray-600 dark:text-gray-400">Show cancellation alerts</span>
			<button
				role="switch"
				aria-checked={cancelAlertsEnabled}
				aria-label="Show cancellation alerts"
				onclick={toggleCancelAlerts}
				class="relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors
					{cancelAlertsEnabled ? 'bg-orange-500' : 'bg-gray-200 dark:bg-gray-700'}"
			>
				<span
					class="inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform
					{cancelAlertsEnabled ? 'translate-x-6' : 'translate-x-1'}"
				>
				</span>
			</button>
		</div>
	</section>

	<div class="border-t border-gray-200 dark:border-gray-800"></div>

	<!-- Sync -->
	<section class="space-y-3">
		<h2 class="text-sm font-semibold uppercase tracking-widest text-gray-500">Sync</h2>
		<p class="text-sm text-gray-600 dark:text-gray-400">
			Keep your queue in sync across devices. End-to-end encrypted — Queuest never sees your data,
			only ciphertext. <span class="font-medium text-teal-600 dark:text-teal-400"
				>Free during beta.</span
			>
		</p>

		{#if syncView === 'choose'}
			<div class="flex flex-wrap gap-2">
				<button
					onclick={() => {
						syncError = '';
						syncView = 'signup';
					}}
					class="rounded-lg bg-orange-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-orange-400"
				>
					Enable sync
				</button>
				<button
					onclick={() => {
						syncError = '';
						syncView = 'signin';
					}}
					class="rounded-lg bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
				>
					Sign in
				</button>
			</div>
		{:else if syncView === 'signup'}
			<div class="space-y-3">
				<div
					class="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-xs text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300"
				>
					Your passphrase encrypts your data — Queuest never sees it and cannot reset it.
					<strong>If you lose it, your synced data is gone for good</strong> unless you've saved the recovery
					code you'll get on the next screen.
				</div>
				<input
					type="email"
					aria-label="Email"
					placeholder="Email"
					bind:value={syncEmail}
					class="w-full rounded-lg bg-gray-100 px-4 py-2 text-base sm:text-sm text-gray-900 placeholder-gray-400 outline-none ring-1 ring-gray-300 focus:ring-orange-500 dark:bg-gray-900 dark:text-white dark:placeholder-gray-500 dark:ring-gray-700"
				/>
				<input
					type="password"
					aria-label="Passphrase"
					placeholder="Passphrase (min. 8 characters)"
					bind:value={syncPassphrase}
					class="w-full rounded-lg bg-gray-100 px-4 py-2 text-base sm:text-sm text-gray-900 placeholder-gray-400 outline-none ring-1 ring-gray-300 focus:ring-orange-500 dark:bg-gray-900 dark:text-white dark:placeholder-gray-500 dark:ring-gray-700"
				/>
				<input
					type="password"
					aria-label="Confirm passphrase"
					placeholder="Confirm passphrase"
					bind:value={syncPassphraseConfirm}
					onkeydown={(e) => e.key === 'Enter' && submitSyncSignup()}
					class="w-full rounded-lg bg-gray-100 px-4 py-2 text-base sm:text-sm text-gray-900 placeholder-gray-400 outline-none ring-1 ring-gray-300 focus:ring-orange-500 dark:bg-gray-900 dark:text-white dark:placeholder-gray-500 dark:ring-gray-700"
				/>
				{#if syncError}<p class="text-xs text-red-500">{syncError}</p>{/if}
				<div class="flex gap-2">
					<button
						onclick={submitSyncSignup}
						disabled={!syncEmail || !syncPassphrase || syncBusy}
						class="rounded-lg bg-orange-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-orange-400 disabled:opacity-50"
					>
						{syncBusy ? 'Creating…' : 'Create account'}
					</button>
					<button
						onclick={backToSyncChoose}
						class="rounded-lg px-4 py-2 text-sm font-medium text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
					>
						Back
					</button>
				</div>
			</div>
		{:else if syncView === 'signin'}
			<div class="space-y-3">
				<input
					type="email"
					aria-label="Email"
					placeholder="Email"
					bind:value={syncEmail}
					class="w-full rounded-lg bg-gray-100 px-4 py-2 text-base sm:text-sm text-gray-900 placeholder-gray-400 outline-none ring-1 ring-gray-300 focus:ring-orange-500 dark:bg-gray-900 dark:text-white dark:placeholder-gray-500 dark:ring-gray-700"
				/>
				<input
					type="password"
					aria-label="Passphrase"
					placeholder="Passphrase"
					bind:value={syncPassphrase}
					onkeydown={(e) => e.key === 'Enter' && submitSyncSignin()}
					class="w-full rounded-lg bg-gray-100 px-4 py-2 text-base sm:text-sm text-gray-900 placeholder-gray-400 outline-none ring-1 ring-gray-300 focus:ring-orange-500 dark:bg-gray-900 dark:text-white dark:placeholder-gray-500 dark:ring-gray-700"
				/>
				{#if syncError}<p class="text-xs text-red-500">{syncError}</p>{/if}
				<div class="flex flex-wrap items-center gap-2">
					<button
						onclick={submitSyncSignin}
						disabled={!syncEmail || !syncPassphrase || syncBusy}
						class="rounded-lg bg-orange-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-orange-400 disabled:opacity-50"
					>
						{syncBusy ? 'Signing in…' : 'Sign in'}
					</button>
					<button
						onclick={backToSyncChoose}
						class="rounded-lg px-4 py-2 text-sm font-medium text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
					>
						Back
					</button>
					<button
						onclick={() => {
							syncError = '';
							syncView = 'recover';
						}}
						class="ml-auto text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
					>
						Forgot your passphrase?
					</button>
				</div>
			</div>
		{:else if syncView === 'recover'}
			<div class="space-y-3">
				<p class="text-xs text-gray-500">
					Enter the recovery code you saved when you enabled sync. You'll be asked to set a new
					passphrase afterward.
				</p>
				<input
					type="email"
					aria-label="Email"
					placeholder="Email"
					bind:value={syncEmail}
					class="w-full rounded-lg bg-gray-100 px-4 py-2 text-base sm:text-sm text-gray-900 placeholder-gray-400 outline-none ring-1 ring-gray-300 focus:ring-orange-500 dark:bg-gray-900 dark:text-white dark:placeholder-gray-500 dark:ring-gray-700"
				/>
				<input
					type="text"
					aria-label="Recovery code"
					placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX"
					bind:value={syncRecoveryCodeInput}
					onkeydown={(e) => e.key === 'Enter' && submitSyncRecover()}
					class="w-full rounded-lg bg-gray-100 px-4 py-2 font-mono text-base sm:text-sm text-gray-900 placeholder-gray-400 outline-none ring-1 ring-gray-300 focus:ring-orange-500 dark:bg-gray-900 dark:text-white dark:placeholder-gray-500 dark:ring-gray-700"
				/>
				{#if syncError}<p class="text-xs text-red-500">{syncError}</p>{/if}
				<div class="flex gap-2">
					<button
						onclick={submitSyncRecover}
						disabled={!syncEmail || !syncRecoveryCodeInput || syncBusy}
						class="rounded-lg bg-orange-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-orange-400 disabled:opacity-50"
					>
						{syncBusy ? 'Verifying…' : 'Continue'}
					</button>
					<button
						onclick={backToSyncChoose}
						class="rounded-lg px-4 py-2 text-sm font-medium text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
					>
						Back
					</button>
				</div>
			</div>
		{:else if syncView === 'recover-new-passphrase'}
			<div class="space-y-3">
				<p class="text-xs text-gray-500">
					You're back in. Set a new passphrase to finish — the old one no longer works.
				</p>
				<input
					type="password"
					aria-label="New passphrase"
					placeholder="New passphrase (min. 8 characters)"
					bind:value={syncNewPassphrase}
					class="w-full rounded-lg bg-gray-100 px-4 py-2 text-base sm:text-sm text-gray-900 placeholder-gray-400 outline-none ring-1 ring-gray-300 focus:ring-orange-500 dark:bg-gray-900 dark:text-white dark:placeholder-gray-500 dark:ring-gray-700"
				/>
				<input
					type="password"
					aria-label="Confirm new passphrase"
					placeholder="Confirm new passphrase"
					bind:value={syncPassphraseConfirm}
					onkeydown={(e) => e.key === 'Enter' && submitSyncNewPassphrase()}
					class="w-full rounded-lg bg-gray-100 px-4 py-2 text-base sm:text-sm text-gray-900 placeholder-gray-400 outline-none ring-1 ring-gray-300 focus:ring-orange-500 dark:bg-gray-900 dark:text-white dark:placeholder-gray-500 dark:ring-gray-700"
				/>
				{#if syncError}<p class="text-xs text-red-500">{syncError}</p>{/if}
				<button
					onclick={submitSyncNewPassphrase}
					disabled={!syncNewPassphrase || syncBusy}
					class="rounded-lg bg-orange-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-orange-400 disabled:opacity-50"
				>
					{syncBusy ? 'Saving…' : 'Set new passphrase'}
				</button>
			</div>
		{:else if syncView === 'recovery-code'}
			<div class="space-y-3">
				<div
					class="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-xs text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300"
				>
					<strong>Save this recovery code somewhere safe — print it or write it down.</strong> It's the
					only way back into your account if you forget your passphrase. It won't be shown again.
				</div>
				<div class="rounded-lg bg-gray-100 px-4 py-4 text-center dark:bg-gray-900">
					<p class="text-xs text-gray-500 dark:text-gray-400">Account</p>
					<p class="mb-2 text-sm font-medium">{syncEmail}</p>
					<p class="text-xs text-gray-500 dark:text-gray-400">Recovery code</p>
					<p class="font-mono text-base font-semibold tracking-wide sm:text-lg">
						{recoveryCodeToShow}
					</p>
				</div>
				<button
					onclick={() => navigator.clipboard?.writeText(recoveryCodeToShow)}
					class="text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
				>
					Copy to clipboard
				</button>
				<label class="flex items-start gap-2 text-sm text-gray-600 dark:text-gray-400">
					<input type="checkbox" bind:checked={recoveryCodeSaved} class="mt-0.5" />
					I've saved this recovery code somewhere safe.
				</label>
				<button
					onclick={confirmRecoveryCodeSaved}
					disabled={!recoveryCodeSaved}
					class="rounded-lg bg-orange-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-orange-400 disabled:opacity-50"
				>
					Continue
				</button>
			</div>
		{:else if syncView === 'status'}
			<div class="space-y-3">
				<div class="flex items-center gap-2 text-sm">
					<span
						class="h-2 w-2 shrink-0 rounded-full {syncStatus.status === 'idle'
							? 'bg-teal-500'
							: syncStatus.status === 'syncing'
								? 'animate-pulse bg-orange-400'
								: syncStatus.status === 'offline'
									? 'bg-gray-400'
									: 'bg-red-500'}"
						aria-hidden="true"
					></span>
					<span class="font-medium">
						{#if syncStatus.status === 'idle'}
							Synced
						{:else if syncStatus.status === 'syncing'}
							Syncing…
						{:else if syncStatus.status === 'offline'}
							Offline
						{:else}
							Sync error
						{/if}
					</span>
					<span class="text-gray-400">· {syncEmail || syncStatus.email}</span>
				</div>
				<p class="text-xs text-gray-500 dark:text-gray-400">
					Last synced: {formatSyncTime(syncStatus.lastSyncedAt)}
				</p>
				{#if syncStatus.status === 'error' && syncStatus.error}
					<p class="text-xs text-red-500">{syncStatus.error}</p>
				{/if}
				<div class="flex flex-wrap gap-2">
					<button
						onclick={() => syncNow()}
						disabled={syncStatus.status === 'syncing'}
						class="rounded-lg bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-200 disabled:opacity-50 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
					>
						Sync now
					</button>
					<button
						onclick={doSyncSignOut}
						disabled={syncBusy}
						class="rounded-lg bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-200 disabled:opacity-50 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
					>
						Sign out
					</button>
				</div>
			</div>
		{/if}
	</section>

	<div class="border-t border-gray-200 dark:border-gray-800"></div>

	<!-- Export -->
	<section class="space-y-3">
		<h2 class="text-sm font-semibold uppercase tracking-widest text-gray-500">Export Watchlist</h2>
		<p class="text-sm text-gray-600 dark:text-gray-400">
			Downloads your queue and preferences as an encrypted <code class="text-orange-500"
				>.queuest</code
			> file. The passphrase is required to import — keep it somewhere safe.
		</p>
		<div class="flex gap-2">
			<input
				type="password"
				aria-label="Export passphrase"
				placeholder="Passphrase"
				bind:value={exportPassphrase}
				class="flex-1 rounded-lg bg-gray-100 px-4 py-2 text-base sm:text-sm text-gray-900 placeholder-gray-400 outline-none ring-1 ring-gray-300 focus:ring-orange-500 dark:bg-gray-900 dark:text-white dark:placeholder-gray-500 dark:ring-gray-700"
				onkeydown={(e) => e.key === 'Enter' && doExport()}
			/>
			<button
				class="rounded-lg bg-orange-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-orange-400 disabled:opacity-50"
				disabled={!exportPassphrase || exporting}
				onclick={doExport}
			>
				{exporting ? 'Encrypting…' : 'Download'}
			</button>
		</div>
		{#if exportDone}
			<p class="text-xs text-teal-600 dark:text-teal-400">✓ File downloaded.</p>
		{/if}
		{#if exportError}
			<p class="text-xs text-red-600 dark:text-red-400">{exportError}</p>
		{/if}
	</section>

	<div class="border-t border-gray-200 dark:border-gray-800"></div>

	<!-- Refresh providers -->
	<section class="space-y-3">
		<h2 class="text-sm font-semibold uppercase tracking-widest text-gray-500">Refresh Data</h2>
		<p class="text-sm text-gray-600 dark:text-gray-400">
			Re-fetches streaming providers, cast, release dates, and season info for every title in your
			queue. Useful if providers look wrong, a title has moved services, or detail info is missing.
		</p>
		<button
			onclick={doRefresh}
			disabled={refreshing}
			class="rounded-lg bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-200 disabled:opacity-50 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
		>
			{#if refreshing}
				Refreshing {refreshDone} / {refreshTotal}…
			{:else}
				↻ Refresh data
			{/if}
		</button>
		{#if refreshSuccess && !refreshing}
			<p class="text-xs text-teal-600 dark:text-teal-400">
				✓ Updated {refreshDone} title{refreshDone === 1 ? '' : 's'}.
			</p>
		{/if}
		{#if refreshError}
			<p class="text-xs text-red-500">{refreshError}</p>
		{/if}
	</section>

	<div class="border-t border-gray-200 dark:border-gray-800"></div>

	<!-- Reset -->
	<section class="space-y-3">
		<h2 class="text-sm font-semibold uppercase tracking-widest text-gray-500">Danger Zone</h2>
		<p class="text-sm text-gray-600 dark:text-gray-400">
			Wipes your entire queue and resets all preferences. The app will restart as if you're a new
			user.
			<span class="font-medium text-red-500">This cannot be undone.</span>
		</p>
		{#if resetArmed}
			<div
				class="flex items-center gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 dark:border-red-900/40 dark:bg-red-950/20"
			>
				<span class="text-sm text-red-700 dark:text-red-400"
					>Are you sure? All data will be lost.</span
				>
				<div class="ml-auto flex gap-2">
					<button
						onclick={() => {
							resetArmed = false;
						}}
						class="rounded-lg bg-white px-3 py-1.5 text-xs font-medium text-gray-600 ring-1 ring-gray-300 transition-colors hover:bg-gray-50 dark:bg-gray-800 dark:text-gray-300 dark:ring-gray-700"
					>
						Cancel
					</button>
					<button
						onclick={doReset}
						disabled={resetting}
						class="rounded-lg bg-red-500 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-red-400 disabled:opacity-50"
					>
						{resetting ? 'Resetting…' : 'Yes, reset'}
					</button>
				</div>
			</div>
		{:else}
			<button
				onclick={doReset}
				class="rounded-lg bg-gray-100 px-4 py-2 text-sm font-medium text-red-600 transition-colors hover:bg-red-50 dark:bg-gray-800 dark:text-red-400 dark:hover:bg-red-950/30"
			>
				Reset everything
			</button>
		{/if}
		{#if resetError}
			<p class="text-xs text-red-600 dark:text-red-400">{resetError}</p>
		{/if}

		{#if syncEnabled}
			<div class="border-t border-red-100 pt-3 dark:border-red-900/30">
				<p class="text-sm text-gray-600 dark:text-gray-400">
					Permanently deletes your account and everything synced to it — the encrypted blob, both
					recovery credentials, all of it.
					<span class="font-medium text-red-500">This cannot be undone.</span> Local data on this device
					is untouched; this only stops syncing.
				</p>
				{#if deleteAccountArmed}
					<div
						class="mt-2 flex items-center gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 dark:border-red-900/40 dark:bg-red-950/20"
					>
						<span class="text-sm text-red-700 dark:text-red-400"
							>Are you sure? Your account will be gone.</span
						>
						<div class="ml-auto flex gap-2">
							<button
								onclick={() => (deleteAccountArmed = false)}
								class="rounded-lg bg-white px-3 py-1.5 text-xs font-medium text-gray-600 ring-1 ring-gray-300 transition-colors hover:bg-gray-50 dark:bg-gray-800 dark:text-gray-300 dark:ring-gray-700"
							>
								Cancel
							</button>
							<button
								onclick={doDeleteAccount}
								disabled={deletingAccount}
								class="rounded-lg bg-red-500 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-red-400 disabled:opacity-50"
							>
								{deletingAccount ? 'Deleting…' : 'Yes, delete my account'}
							</button>
						</div>
					</div>
				{:else}
					<button
						onclick={doDeleteAccount}
						class="mt-2 rounded-lg bg-gray-100 px-4 py-2 text-sm font-medium text-red-600 transition-colors hover:bg-red-50 dark:bg-gray-800 dark:text-red-400 dark:hover:bg-red-950/30"
					>
						Delete account
					</button>
				{/if}
				{#if deleteAccountError}
					<p class="mt-2 text-xs text-red-600 dark:text-red-400">{deleteAccountError}</p>
				{/if}
			</div>
		{/if}
	</section>

	<div class="border-t border-gray-200 dark:border-gray-800"></div>

	<!-- About -->
	<section class="space-y-4">
		<h2 class="text-sm font-semibold uppercase tracking-widest text-gray-500">About</h2>

		<div class="flex items-center justify-between">
			<span class="text-sm font-medium text-gray-700 dark:text-gray-300">
				Queu<span class="text-orange-400">est</span>
			</span>
			<span
				class="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-500 dark:bg-gray-800 dark:text-gray-400"
			>
				v{VERSION}
			</span>
		</div>

		<div class="flex flex-wrap gap-2">
			<a
				href={GITHUB_REPO}
				target="_blank"
				rel="noopener noreferrer"
				class="inline-flex items-center gap-1.5 rounded-lg bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
			>
				<svg class="h-4 w-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
					<path
						d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"
					/>
				</svg>
				GitHub
			</a>

			<button
				onclick={openFeedback}
				class="rounded-lg bg-orange-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-orange-400"
			>
				Send feedback
			</button>
		</div>
	</section>
</div>

<!-- ── Feedback modal ─────────────────────────────────────────────────────── -->
{#if feedbackOpen}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
		onclick={closeFeedback}
	>
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<div
			class="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl dark:bg-gray-900"
			onclick={(e) => e.stopPropagation()}
			role="dialog"
			aria-modal="true"
			aria-labelledby="feedback-modal-title"
			tabindex="-1"
			use:trapFocus={{ onEscape: closeFeedback }}
		>
			<h2
				id="feedback-modal-title"
				class="mb-4 text-lg font-semibold text-gray-900 dark:text-white"
			>
				Send Feedback
			</h2>
			<p class="mb-4 text-sm text-gray-500 dark:text-gray-400">
				This opens a public GitHub issue — don't include personal info. Check
				<a
					href="{GITHUB_REPO}/issues"
					target="_blank"
					rel="noopener noreferrer"
					class="text-orange-500 hover:underline">existing issues</a
				>
				first!
			</p>

			<div class="space-y-3">
				<input
					type="text"
					aria-label="Feedback title"
					placeholder="Title (required)"
					bind:value={feedbackTitle}
					class="w-full rounded-lg bg-gray-100 px-4 py-2 text-base sm:text-sm text-gray-900 placeholder-gray-400 outline-none ring-1 ring-gray-300 focus:ring-orange-500 dark:bg-gray-800 dark:text-white dark:placeholder-gray-500 dark:ring-gray-700"
				/>
				<textarea
					aria-label="Feedback details"
					placeholder="Details (optional)"
					bind:value={feedbackBody}
					rows="4"
					class="w-full resize-none rounded-lg bg-gray-100 px-4 py-2 text-base sm:text-sm text-gray-900 placeholder-gray-400 outline-none ring-1 ring-gray-300 focus:ring-orange-500 dark:bg-gray-800 dark:text-white dark:placeholder-gray-500 dark:ring-gray-700"
				></textarea>
			</div>

			{#if feedbackError}
				<p class="mt-2 text-xs text-red-500">{feedbackError}</p>
			{/if}
			{#if feedbackIssueUrl}
				<p class="mt-2 text-xs text-teal-600 dark:text-teal-400">
					✓ Issue filed!
					<!-- External GitHub issue URL — resolve() is for internal routes only -->
					<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
					<a href={feedbackIssueUrl} target="_blank" rel="noopener noreferrer" class="underline"
						>View it on GitHub →</a
					>
				</p>
			{/if}

			<div class="mt-4 flex gap-2">
				<button
					onclick={closeFeedback}
					class="flex-1 rounded-lg bg-gray-100 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
				>
					Cancel
				</button>
				<button
					onclick={submitFeedback}
					disabled={!feedbackTitle.trim() || feedbackSending}
					class="flex-1 rounded-lg bg-orange-500 py-2 text-sm font-medium text-white transition-colors hover:bg-orange-400 disabled:opacity-50"
				>
					{feedbackSending ? 'Submitting…' : feedbackIssueUrl ? 'Send another' : 'Submit'}
				</button>
			</div>
		</div>
	</div>
{/if}
