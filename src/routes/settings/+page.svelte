<script lang="ts">
	import type { WatchlistItem } from '$lib/types';
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import { getAll, replaceAll } from '$lib/db';
	import { theme, toggleTheme } from '$lib/theme.svelte';
	import {
		buildExportBlob,
		refreshProviders,
		submitFeedback as submitFeedbackAction,
		resetEverything
	} from '$lib/settings-actions';

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
	const GITHUB_REPO = 'https://github.com/zenfinity/streamq';

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
			const weeklyHours = JSON.parse(localStorage.getItem('sq:budget:weekly') ?? '10');
			const weeksPerMonth = JSON.parse(localStorage.getItem('sq:budget:weeks') ?? '4');
			const blob = await buildExportBlob(exportPassphrase, weeklyHours, weeksPerMonth);
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
	let queueColors = $state<Record<string, string>>({});
	let collections = $state<string[]>([]);
	let collectionCounts = $state<Record<string, number>>({});
	let items = $state<WatchlistItem[]>([]);
	let renamingCollection = $state<string | null>(null);
	let renameInput = $state('');
	let deleteArmed = $state<string | null>(null);
	let manageBusy = $state(false);

	function saveQueueName() {
		setQueueName(myQueueName);
	}

	function updateCollectionColor(tag: string, color: string) {
		setQueueColor(tag, color);
		queueColors = { ...queueColors, [tag]: color };
	}

	async function renameCollection(oldName: string, newName: string) {
		if (!newName.trim() || newName === oldName) {
			renamingCollection = null;
			renameInput = '';
			return;
		}

		manageBusy = true;
		try {
			// Update all items with the old tag to the new tag.
			// NOTE: Rename is a bulk write, and with last-write-wins sync (#101), this can race with
			// per-item edits on another device. If a rename on device A races with an edit on device B
			// for the same item, the result is unpredictable — the rename may land on some items but not
			// others. This is acceptable for v1 given how rare it is; long-term fix is to version the
			// collection itself rather than denormalizing the name.
			for (const item of items) {
				if (item.queue_tag === oldName) {
					item.queue_tag = newName;
				}
			}
			// Move the color entry
			renameCollectionColor(oldName, newName);
			// Persist to database
			await replaceAll(items);
			// Update local state
			queueColors = { ...queueColors };
			collections = listCollections(items);
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
			// Clear queue_tag on all items with this collection (items are never deleted, only uncategorized)
			for (const item of items) {
				if (item.queue_tag === name) {
					item.queue_tag = undefined;
				}
			}
			// Remove the color entry to avoid orphaned palette entries
			deleteCollectionColor(name);
			// Persist to database
			await replaceAll(items);
			// Update local state
			queueColors = { ...queueColors };
			collections = listCollections(items);
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

	// ── Persistence ───────────────────────────────────────────────────────────
	onMount(async () => {
		cancelAlertsEnabled = localStorage.getItem('sq:cancel-alerts') === 'true';
		myQueueName = getQueueName();
		queueColors = getQueueColors();

		items = await getAll();
		collections = listCollections(items);
		updateCounts();
	});
</script>

<svelte:head><title>Queuest — Settings</title></svelte:head>

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
			placeholder="My Queue"
			bind:value={myQueueName}
			oninput={saveQueueName}
			maxlength="40"
			class="w-full rounded-lg bg-gray-100 px-4 py-2 text-base sm:text-sm text-gray-900 placeholder-gray-400 outline-none ring-1 ring-gray-300 focus:ring-orange-500 dark:bg-gray-900 dark:text-white dark:placeholder-gray-500 dark:ring-gray-700"
		/>
	</section>

	<div class="border-t border-gray-200 dark:border-gray-800"></div>

	<!-- Collections -->
	<section class="space-y-3">
		<h2 class="text-sm font-semibold uppercase tracking-widest text-gray-500">Collections</h2>
		<p class="text-sm text-gray-600 dark:text-gray-400">
			Organize your queue into collections. Create new ones from the detail panel or by assigning
			items. Importing a shared list automatically creates a collection.
		</p>
		{#if collections.length === 0}
			<p class="text-sm text-gray-400 dark:text-gray-600">No collections yet.</p>
		{:else}
			<div class="space-y-2">
				{#each collections as collection (collection)}
					{@const color = queueColors[collection] ?? '#888888'}
					{@const count = collectionCounts[collection] ?? 0}
					{@const isRenaming = renamingCollection === collection}
					{@const isDeleting = deleteArmed === collection}
					<div
						class="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2.5 dark:bg-gray-800/60"
					>
						<div class="flex items-center gap-2.5 min-w-0 flex-1">
							<span class="h-3 w-3 shrink-0 rounded-full" style="background:{color};"></span>
							{#if isRenaming}
								<input
									type="text"
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
										value={color}
										oninput={(e) =>
											updateCollectionColor(
												collection,
												(e.currentTarget as HTMLInputElement).value
											)}
										class="absolute inset-0 h-full w-full cursor-pointer opacity-0"
									/>
								</label>
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
				{/each}
			</div>
		{/if}
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
				href={resolve('/?preview')}
				class="rounded-lg bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
			>
				About Queuest
			</a>

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
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			class="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl dark:bg-gray-900"
			onclick={(e) => e.stopPropagation()}
		>
			<h2 class="mb-4 text-lg font-semibold text-gray-900 dark:text-white">Send Feedback</h2>
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
					placeholder="Title (required)"
					bind:value={feedbackTitle}
					class="w-full rounded-lg bg-gray-100 px-4 py-2 text-base sm:text-sm text-gray-900 placeholder-gray-400 outline-none ring-1 ring-gray-300 focus:ring-orange-500 dark:bg-gray-800 dark:text-white dark:placeholder-gray-500 dark:ring-gray-700"
				/>
				<textarea
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
