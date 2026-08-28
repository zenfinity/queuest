<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
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
	import { getQueueName, setQueueName } from '$lib/queue-colors';
	import { takePendingInvite } from '$lib/pending-invite';
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

	function saveQueueName() {
		setQueueName(myQueueName);
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

		syncEnabled = await isSyncEnabled();
		if (syncEnabled) syncView = 'status';
	});

	// Resumes a shared-list invite that sent a logged-out visitor here to set
	// up sync first (#215) — fires however sync ends up enabled (signup,
	// sign-in, or recovery all set syncEnabled below), and no-ops if nothing
	// is pending. Lands back on the same confirm-before-joining screen, not
	// an automatic join — see that page's own note on why joining is never
	// automatic on link-open.
	$effect(() => {
		if (!syncEnabled) return;
		const pending = takePendingInvite();
		if (pending) {
			// resolve() IS used below — the rule can't see through the template literal
			// appending #dek, which resolve() itself can't produce (not a route segment).
			// eslint-disable-next-line svelte/no-navigation-without-resolve
			goto(`${resolve('/lists/join/[token]', { token: pending.token })}#${pending.dek}`);
		}
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
			Downloads your personal queue and preferences as an encrypted <code class="text-orange-500"
				>.queuest</code
			> file. The passphrase is required to import — keep it somewhere safe. Shared lists aren't included
			— they live only in the cloud, via sync.
		</p>
		<div>
			<label
				for="export-queue-name"
				class="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500"
			>
				Queue name
			</label>
			<input
				id="export-queue-name"
				type="text"
				placeholder="My Queue"
				bind:value={myQueueName}
				oninput={saveQueueName}
				maxlength="40"
				class="w-full rounded-lg bg-gray-100 px-4 py-2 text-base sm:text-sm text-gray-900 placeholder-gray-400 outline-none ring-1 ring-gray-300 focus:ring-orange-500 dark:bg-gray-900 dark:text-white dark:placeholder-gray-500 dark:ring-gray-700"
			/>
		</div>
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
