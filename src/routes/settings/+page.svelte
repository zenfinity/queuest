<script lang="ts">
	import { onMount } from 'svelte';
	import { getAll, replaceAll, patchProviders, addItem } from '$lib/db';
	import { encrypt, decrypt } from '$lib/crypto';
	import { theme, toggleTheme } from '$lib/theme.svelte';
	import { openWelcome } from '$lib/welcome.svelte';
	import { getQueueName, setQueueName, getQueueColors, setQueueColor } from '$lib/queue-colors';
	import { parseImportCSV } from '$lib/import';
	import type { ImportRow } from '$lib/import';
	import type { WatchlistItem } from '$lib/types';
	import pkg from '../../../package.json';

	const VERSION = pkg.version;
	const GITHUB_REPO = 'https://github.com/zenfinity/streamq';

	// ── Budget ────────────────────────────────────────────────────────────────
	let hoursPerWeek  = $state(10);
	let weeksPerMonth = $state(4);
	let budgetHours   = $derived(hoursPerWeek * weeksPerMonth);

	// ── Export ────────────────────────────────────────────────────────────────
	let exportPassphrase = $state('');
	let exporting        = $state(false);
	let exportDone       = $state(false);

	async function doExport() {
		if (!exportPassphrase) return;
		exporting = true; exportDone = false;
		try {
			const items = await getAll();
			// Wrap items + preferences so a restore is complete
			const payload = {
				version: 1,
				prefs: {
					theme: theme.dark ? 'dark' : 'light',
					weeklyHours: hoursPerWeek,
					weeksPerMonth,
					budget: budgetHours, // kept for backwards compat
					queueName: getQueueName(),
					queueColors: getQueueColors(),
					sort: localStorage.getItem('sq:sort') ?? 'added',
					view: localStorage.getItem('sq:view') ?? 'grid',
				},
				items
			};
			const buf = await encrypt(JSON.stringify(payload), exportPassphrase);
			const url = URL.createObjectURL(new Blob([buf], { type: 'application/octet-stream' }));
			Object.assign(document.createElement('a'), {
				href: url,
				download: `queuest-${new Date().toISOString().slice(0, 10)}.queuest`
			}).click();
			URL.revokeObjectURL(url);
			exportPassphrase = '';
			exportDone = true;
		} finally { exporting = false; }
	}

	// ── Import ────────────────────────────────────────────────────────────────
	let importFile       = $state<File | null>(null);
	let importPassphrase = $state('');
	let importing        = $state(false);
	let importError      = $state('');
	let importDone       = $state(false);

	function onFileChange(e: Event) {
		importFile = (e.currentTarget as HTMLInputElement).files?.[0] ?? null;
		importError = ''; importDone = false;
	}

	async function doImport() {
		if (!importFile || !importPassphrase) return;
		importing = true; importError = ''; importDone = false;
		try {
			const parsed = JSON.parse(await decrypt(await importFile.arrayBuffer(), importPassphrase));

			let items: WatchlistItem[];
			if (Array.isArray(parsed)) {
				// Legacy format — bare array
				items = parsed;
			} else {
				// v1 format — { version, prefs, items }
				items = parsed.items ?? [];
				if (parsed.prefs?.theme) {
					const dark = parsed.prefs.theme === 'dark';
					theme.dark = dark;
					localStorage.setItem('sq:theme', parsed.prefs.theme);
					document.documentElement.classList.toggle('dark', dark);
				}
				// Budget — prefer the explicit breakdown; fall back to dividing the total
				if (typeof parsed.prefs?.weeklyHours === 'number' && typeof parsed.prefs?.weeksPerMonth === 'number') {
					hoursPerWeek  = parsed.prefs.weeklyHours;
					weeksPerMonth = parsed.prefs.weeksPerMonth;
				} else if (typeof parsed.prefs?.budget === 'number') {
					weeksPerMonth = 4;
					hoursPerWeek  = Math.round(parsed.prefs.budget / 4);
				}
				localStorage.setItem('sq:budget:weekly', JSON.stringify(hoursPerWeek));
				localStorage.setItem('sq:budget:weeks',  JSON.stringify(weeksPerMonth));
				localStorage.setItem('sq:budget', JSON.stringify(hoursPerWeek * weeksPerMonth));

				if (typeof parsed.prefs?.queueName === 'string') {
					setQueueName(parsed.prefs.queueName);
					myQueueName = parsed.prefs.queueName;
				}
				if (parsed.prefs?.queueColors && typeof parsed.prefs.queueColors === 'object') {
					for (const [tag, color] of Object.entries(parsed.prefs.queueColors)) {
						if (typeof color === 'string') setQueueColor(tag, color);
					}
				}
				if (typeof parsed.prefs?.sort === 'string') localStorage.setItem('sq:sort', parsed.prefs.sort);
				if (typeof parsed.prefs?.view === 'string') localStorage.setItem('sq:view', parsed.prefs.view);
			}

			await replaceAll(items);
			importFile = null; importPassphrase = ''; importDone = true;
		} catch (e) {
			importError = e instanceof Error ? e.message : 'Import failed.';
		} finally { importing = false; }
	}

	// ── CSV Import (Letterboxd / IMDb) ────────────────────────────────────────
	let csvRows      = $state<ImportRow[]>([]);
	let csvFormat    = $state('');
	let csvImporting = $state(false);
	let csvTotal     = $state(0);
	let csvDone      = $state(0);
	let csvAdded     = $state(0);
	let csvMissed    = $state(0);
	let csvError     = $state('');
	let csvDoneOnce  = $state(false);
	let csvUrl       = $state('');
	let csvUrlLoading = $state(false);

	function applyCsvText(text: string) {
		const { rows, format } = parseImportCSV(text);
		if (format === 'unknown') {
			csvError = 'Unrecognised format. Expected a Letterboxd or IMDb watchlist CSV.';
			return;
		}
		csvRows = rows;
		csvFormat = format === 'letterboxd' ? 'Letterboxd' : 'IMDb';
	}

	function onCsvFileChange(e: Event) {
		csvRows = []; csvFormat = ''; csvAdded = 0; csvMissed = 0; csvDone = 0;
		csvError = ''; csvDoneOnce = false; csvUrl = '';
		const file = (e.currentTarget as HTMLInputElement).files?.[0];
		if (!file) return;
		const reader = new FileReader();
		reader.onload = () => applyCsvText(reader.result as string);
		reader.readAsText(file);
	}

	async function fetchCsvUrl() {
		if (!csvUrl.trim() || csvUrlLoading) return;
		csvRows = []; csvFormat = ''; csvAdded = 0; csvMissed = 0; csvDone = 0;
		csvError = ''; csvDoneOnce = false;
		csvUrlLoading = true;
		try {
			const res = await fetch('/api/import-fetch', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ url: csvUrl.trim() })
			});
			if (!res.ok) throw new Error(await res.text().catch(() => res.statusText));
			applyCsvText(await res.text());
		} catch (e) {
			csvError = e instanceof Error ? e.message : 'Failed to fetch URL.';
		} finally {
			csvUrlLoading = false;
		}
	}

	const CSV_BATCH = 20;

	async function doImportCsv() {
		if (!csvRows.length || csvImporting) return;
		csvImporting = true; csvTotal = csvRows.length; csvDone = 0;
		csvAdded = 0; csvMissed = 0; csvError = ''; csvDoneOnce = false;
		try {
			for (let i = 0; i < csvRows.length; i += CSV_BATCH) {
				const batch = csvRows.slice(i, i + CSV_BATCH);
				const res = await fetch('/api/import-search', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(batch)
				});
				if (!res.ok) throw new Error(await res.text().catch(() => res.statusText));
				const matched = await res.json() as Array<{
					title: string;
					result: Omit<WatchlistItem, 'id' | 'added_at' | 'watched_at'> | null;
				}>;
				for (const { result } of matched) {
					if (result) {
						try {
							await addItem(result);
							csvAdded++;
						} catch (e) {
							if (!(e instanceof DOMException && e.name === 'ConstraintError')) throw e;
						}
					} else {
						csvMissed++;
					}
					csvDone++;
				}
			}
			csvDoneOnce = true;
		} catch (e) {
			csvError = e instanceof Error ? e.message : 'Import failed.';
		} finally {
			csvImporting = false;
		}
	}

	// ── Refresh providers ─────────────────────────────────────────────────────
	let refreshing     = $state(false);
	let refreshTotal   = $state(0);
	let refreshDone    = $state(0);
	let refreshError   = $state('');
	let refreshSuccess = $state(false);

	async function doRefresh() {
		refreshing = true; refreshError = ''; refreshSuccess = false;
		try {
			const items = await getAll();
			const payload = items.map(({ id, tmdb_id, media_type }) => ({ id, tmdb_id, media_type }));
			refreshTotal = payload.length;
			refreshDone = 0;

			if (!payload.length) { refreshSuccess = true; return; }

			const res = await fetch('/api/refresh-providers', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(payload)
			});

			if (!res.ok) throw new Error(await res.text().catch(() => res.statusText));

			const results = await res.json() as Array<{
				id: number;
				providers: import('$lib/types').Provider[];
				rentable?: boolean;
				release: import('$lib/types').ReleaseInfo | null;
				seasons?: import('$lib/types').WatchlistItem['seasons'];
				runtime_minutes?: number | null;
				backdrop_path?: string | null;
				genres?: string[];
				cast?: import('$lib/types').CastMember[];
				director?: string | null;
				creator?: string | null;
			}>;

			// Write back to IndexedDB one by one
			for (const r of results) {
				await patchProviders(r.id, r.providers, r.rentable ?? false, r.release, r.seasons, r.runtime_minutes, r.backdrop_path, r.genres, r.cast, r.director, r.creator);
				refreshDone++;
			}
			refreshSuccess = true;
		} catch (e) {
			refreshError = e instanceof Error ? e.message : 'Refresh failed.';
		} finally { refreshing = false; }
	}

	// ── Feedback ──────────────────────────────────────────────────────────────
	let feedbackOpen      = $state(false);
	let feedbackTitle     = $state('');
	let feedbackBody      = $state('');
	let feedbackSending   = $state(false);
	let feedbackError     = $state('');
	let feedbackIssueUrl  = $state('');

	function openFeedback() {
		feedbackOpen = true; feedbackTitle = ''; feedbackBody = '';
		feedbackError = ''; feedbackIssueUrl = '';
	}
	function closeFeedback() { feedbackOpen = false; }

	async function submitFeedback() {
		if (!feedbackTitle.trim()) return;
		feedbackSending = true; feedbackError = ''; feedbackIssueUrl = '';
		try {
			const res = await fetch('/api/feedback', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ title: feedbackTitle, body: feedbackBody })
			});
			if (!res.ok) {
				const msg = await res.text().catch(() => res.statusText);
				feedbackError = msg || 'Something went wrong.';
			} else {
				const data = await res.json();
				feedbackIssueUrl = data.url;
				feedbackTitle = ''; feedbackBody = '';
			}
		} catch (e) {
			feedbackError = e instanceof Error ? e.message : 'Network error.';
		} finally { feedbackSending = false; }
	}

	// ── Reset ─────────────────────────────────────────────────────────────────
	let resetArmed  = $state(false);
	let resetting   = $state(false);

	async function doReset() {
		if (!resetArmed) { resetArmed = true; return; }
		resetting = true;
		try {
			await replaceAll([]);
			const keys = ['sq:theme','sq:budget','sq:budget:weekly','sq:budget:weeks',
			               'sq:sort','sq:view','sq:queue-name','sq:queue-colors','sq:welcomed'];
			for (const k of keys) { try { localStorage.removeItem(k); } catch {} }
			window.location.href = '/';
		} finally { resetting = false; }
	}

	// ── Cancel alerts opt-in ─────────────────────────────────────────────────
	let cancelAlertsEnabled = $state(false);

	function toggleCancelAlerts() {
		cancelAlertsEnabled = !cancelAlertsEnabled;
		try { localStorage.setItem('sq:cancel-alerts', cancelAlertsEnabled ? 'true' : 'false'); } catch {}
	}

	// ── Queue identity ────────────────────────────────────────────────────────
	let myQueueName  = $state('My Queue');
	let queueColors  = $state<Record<string, string>>({});
	let importedTags = $state<string[]>([]);

	function saveQueueName() { setQueueName(myQueueName); }
	function updateImportedColor(tag: string, color: string) {
		setQueueColor(tag, color);
		queueColors = { ...queueColors, [tag]: color };
	}

	// ── Persistence ───────────────────────────────────────────────────────────
	onMount(async () => {
		try {
			const weekly = localStorage.getItem('sq:budget:weekly');
			const weeks  = localStorage.getItem('sq:budget:weeks');
			if (weekly !== null && weeks !== null) {
				hoursPerWeek  = JSON.parse(weekly);
				weeksPerMonth = JSON.parse(weeks);
			} else {
				// Migrate legacy single-value budget, defaulting to 10 × 4 = 40
				const legacy = JSON.parse(localStorage.getItem('sq:budget') ?? '40');
				weeksPerMonth = 4;
				hoursPerWeek  = Math.round(legacy / weeksPerMonth);
			}
		} catch {}

		cancelAlertsEnabled = localStorage.getItem('sq:cancel-alerts') === 'true';
		myQueueName = getQueueName();
		queueColors = getQueueColors();

		const items = await getAll();
		const tags = new Set<string>();
		for (const item of items) {
			if (item.queue_tag) tags.add(item.queue_tag);
		}
		importedTags = [...tags].sort();
	});

	$effect(() => {
		try {
			localStorage.setItem('sq:budget:weekly', JSON.stringify(hoursPerWeek));
			localStorage.setItem('sq:budget:weeks',  JSON.stringify(weeksPerMonth));
			// Keep sq:budget in sync — used by the rest of the app and export format
			localStorage.setItem('sq:budget', JSON.stringify(budgetHours));
		} catch {}
	});
</script>

<svelte:head><title>Queuest — Settings</title></svelte:head>

<div class="mx-auto max-w-md space-y-6 xs:space-y-10">
	<h1 class="text-xl font-bold xs:text-2xl">Settings</h1>

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
			class="w-full rounded-lg bg-gray-100 px-4 py-2 text-sm text-gray-900 placeholder-gray-400 outline-none ring-1 ring-gray-300 focus:ring-orange-500 dark:bg-gray-900 dark:text-white dark:placeholder-gray-500 dark:ring-gray-700"
		/>
	</section>

	<div class="border-t border-gray-200 dark:border-gray-800"></div>

	<!-- Shared Queues -->
	<section class="space-y-3">
		<h2 class="text-sm font-semibold uppercase tracking-widest text-gray-500">Shared Queues</h2>
		<p class="text-sm text-gray-600 dark:text-gray-400">
			Queues shared with you. Edit each color to distinguish them in your main view.
		</p>
		{#if importedTags.length === 0}
			<p class="text-sm text-gray-400 dark:text-gray-600">No shared queues yet.</p>
		{:else}
			<div class="space-y-2">
				{#each importedTags as tag (tag)}
					{@const color = queueColors[tag] ?? '#888888'}
					<div class="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2.5 dark:bg-gray-800/60">
						<div class="flex items-center gap-2.5 min-w-0">
							<span
								class="h-3 w-3 shrink-0 rounded-full"
								style="background:{color};"
							></span>
							<span class="truncate text-sm font-medium text-gray-800 dark:text-gray-200">{tag}</span>
						</div>
						<label class="relative ml-3 shrink-0 cursor-pointer" title="Change color">
							<span
								class="block h-7 w-7 rounded-lg border border-gray-200 shadow-sm dark:border-gray-700"
								style="background:{color};"
							></span>
							<input
								type="color"
								value={color}
								oninput={(e) => updateImportedColor(tag, (e.currentTarget as HTMLInputElement).value)}
								class="absolute inset-0 h-full w-full cursor-pointer opacity-0"
							/>
						</label>
					</div>
				{/each}
			</div>
		{/if}
	</section>

	<div class="border-t border-gray-200 dark:border-gray-800"></div>

	<!-- Budget -->
	<section class="space-y-3">
		<h2 class="text-sm font-semibold uppercase tracking-widest text-gray-500">Viewing Budget</h2>
		<p class="text-sm text-gray-600 dark:text-gray-400">
			Your estimated monthly watch time. Used to normalise bar widths across all views.
		</p>
		<div class="flex flex-wrap items-center gap-2 text-sm">
			<input
				type="number" min="1" max="24" step="0.5"
				bind:value={hoursPerWeek}
				class="w-16 rounded-lg bg-gray-100 px-3 py-2 text-center font-medium text-gray-900 outline-none ring-1 ring-gray-300 focus:ring-orange-500 dark:bg-gray-900 dark:text-white dark:ring-gray-700 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
			/>
			<span class="text-gray-600 dark:text-gray-400">hrs ×</span>
			<input
				type="number" min="1" max="6" step="0.5"
				bind:value={weeksPerMonth}
				class="w-16 rounded-lg bg-gray-100 px-3 py-2 text-center font-medium text-gray-900 outline-none ring-1 ring-gray-300 focus:ring-orange-500 dark:bg-gray-900 dark:text-white dark:ring-gray-700 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
			/>
			<span class="text-gray-600 dark:text-gray-400">weeks =</span>
			<span class="font-semibold text-gray-900 dark:text-white">{budgetHours} hrs/month</span>
		</div>
	</section>

	<div class="border-t border-gray-200 dark:border-gray-800"></div>

	<!-- Cancel alerts -->
	<section class="space-y-3">
		<h2 class="text-sm font-semibold uppercase tracking-widest text-gray-500">Cancellation Alerts</h2>
		<p class="text-sm text-gray-600 dark:text-gray-400">
			When enabled, a banner appears on your queue when you've nearly cleared a streaming service — a nudge to consider pausing your subscription.
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
				<span class="inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform
					{cancelAlertsEnabled ? 'translate-x-6' : 'translate-x-1'}">
				</span>
			</button>
		</div>
	</section>

	<div class="border-t border-gray-200 dark:border-gray-800"></div>

	<!-- Export -->
	<section class="space-y-3">
		<h2 class="text-sm font-semibold uppercase tracking-widest text-gray-500">Export Watchlist</h2>
		<p class="text-sm text-gray-600 dark:text-gray-400">
			Downloads your queue and preferences as an encrypted <code class="text-orange-500">.queuest</code> file. The passphrase is required to import — keep it somewhere safe.
		</p>
		<div class="flex gap-2">
			<input
				type="password"
				placeholder="Passphrase"
				bind:value={exportPassphrase}
				class="flex-1 rounded-lg bg-gray-100 px-4 py-2 text-sm text-gray-900 placeholder-gray-400 outline-none ring-1 ring-gray-300 focus:ring-orange-500 dark:bg-gray-900 dark:text-white dark:placeholder-gray-500 dark:ring-gray-700"
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
	</section>

	<div class="border-t border-gray-200 dark:border-gray-800"></div>

	<!-- Import -->
	<section class="space-y-3">
		<h2 class="text-sm font-semibold uppercase tracking-widest text-gray-500">Import Watchlist</h2>
		<p class="text-sm text-gray-600 dark:text-gray-400">
			Restore from a <code class="text-orange-500">.queuest</code> file. Theme and budget preferences are restored too.
			<span class="font-medium text-red-500">This replaces your current queue.</span>
		</p>
		<input
			type="file" accept=".queuest"
			class="w-full cursor-pointer rounded-lg bg-gray-100 px-3 py-2 text-sm text-gray-700 file:mr-3 file:rounded file:border-0 file:bg-gray-200 file:px-3 file:py-1 file:text-xs file:font-medium file:text-gray-700 hover:file:bg-gray-300 dark:bg-gray-900 dark:text-gray-300 dark:file:bg-gray-800 dark:file:text-gray-200 dark:hover:file:bg-gray-700"
			onchange={onFileChange}
		/>
		<div class="flex gap-2">
			<input
				type="password"
				placeholder="Passphrase"
				bind:value={importPassphrase}
				class="flex-1 rounded-lg bg-gray-100 px-4 py-2 text-sm text-gray-900 placeholder-gray-400 outline-none ring-1 ring-gray-300 focus:ring-orange-500 dark:bg-gray-900 dark:text-white dark:placeholder-gray-500 dark:ring-gray-700"
				onkeydown={(e) => e.key === 'Enter' && doImport()}
			/>
			<button
				class="rounded-lg bg-orange-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-orange-400 disabled:opacity-50"
				disabled={!importFile || !importPassphrase || importing}
				onclick={doImport}
			>
				{importing ? 'Decrypting…' : 'Import'}
			</button>
		</div>
		{#if importError}<p class="text-xs text-red-500">{importError}</p>{/if}
		{#if importDone}<p class="text-xs text-teal-600 dark:text-teal-400">✓ Queue restored successfully.</p>{/if}
	</section>

	<div class="border-t border-gray-200 dark:border-gray-800"></div>

	<!-- Import from CSV -->
	<section class="space-y-3">
		<h2 class="text-sm font-semibold uppercase tracking-widest text-gray-500">Import from Letterboxd or IMDb</h2>
		<p class="text-sm text-gray-600 dark:text-gray-400">
			Upload a <code class="text-orange-500">.csv</code> export from
			<a href="https://letterboxd.com/settings/data/" target="_blank" rel="noopener noreferrer" class="text-orange-500 hover:underline">Letterboxd</a>
			(Settings → Export your data → <em>watchlist.csv</em>) or
			<a href="https://www.imdb.com/list/watchlist" target="_blank" rel="noopener noreferrer" class="text-orange-500 hover:underline">IMDb</a>
			(Watchlist → ··· → Export). Titles are matched to TMDB and added to your queue — your existing items are not removed.
		</p>
		<input
			type="file"
			accept=".csv"
			class="w-full cursor-pointer rounded-lg bg-gray-100 px-3 py-2 text-sm text-gray-700 file:mr-3 file:rounded file:border-0 file:bg-gray-200 file:px-3 file:py-1 file:text-xs file:font-medium file:text-gray-700 hover:file:bg-gray-300 dark:bg-gray-900 dark:text-gray-300 dark:file:bg-gray-800 dark:file:text-gray-200 dark:hover:file:bg-gray-700"
			onchange={onCsvFileChange}
		/>
		<div class="flex items-center gap-2">
			<div class="h-px flex-1 bg-gray-200 dark:bg-gray-700"></div>
			<span class="text-xs text-gray-400">or paste a link</span>
			<div class="h-px flex-1 bg-gray-200 dark:bg-gray-700"></div>
		</div>
		<div class="flex gap-2">
			<input
				type="url"
				placeholder="https://… (IMDb export link)"
				bind:value={csvUrl}
				onkeydown={(e) => e.key === 'Enter' && fetchCsvUrl()}
				class="flex-1 rounded-lg bg-gray-100 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 outline-none ring-1 ring-gray-300 focus:ring-orange-500 dark:bg-gray-900 dark:text-white dark:placeholder-gray-500 dark:ring-gray-700"
			/>
			<button
				onclick={fetchCsvUrl}
				disabled={!csvUrl.trim() || csvUrlLoading}
				class="rounded-lg bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-200 disabled:opacity-50 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
			>
				{csvUrlLoading ? 'Fetching…' : 'Fetch'}
			</button>
		</div>
		{#if csvFormat && csvRows.length}
			<p class="text-sm text-gray-600 dark:text-gray-400">
				Found <span class="font-medium text-gray-900 dark:text-white">{csvRows.length}</span> title{csvRows.length === 1 ? '' : 's'} from {csvFormat}.
			</p>
		{/if}
		{#if csvError}
			<p class="text-xs text-red-500">{csvError}</p>
		{/if}
		<button
			onclick={doImportCsv}
			disabled={!csvRows.length || csvImporting}
			class="rounded-lg bg-orange-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-orange-400 disabled:opacity-50"
		>
			{#if csvImporting}
				Matching {csvDone} / {csvTotal}…
			{:else}
				Add to Queue
			{/if}
		</button>
		{#if csvDoneOnce && !csvImporting}
			<p class="text-xs text-teal-600 dark:text-teal-400">
				✓ Added {csvAdded} title{csvAdded === 1 ? '' : 's'}.{csvMissed > 0 ? ` ${csvMissed} not found on TMDB.` : ''}
			</p>
		{/if}
	</section>

	<div class="border-t border-gray-200 dark:border-gray-800"></div>

	<!-- Refresh providers -->
	<section class="space-y-3">
		<h2 class="text-sm font-semibold uppercase tracking-widest text-gray-500">Refresh Data</h2>
		<p class="text-sm text-gray-600 dark:text-gray-400">
			Re-fetches streaming providers, cast, release dates, and season info for every title in your queue.
			Useful if providers look wrong, a title has moved services, or detail info is missing.
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
			<p class="text-xs text-teal-600 dark:text-teal-400">✓ Updated {refreshDone} title{refreshDone === 1 ? '' : 's'}.</p>
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
			Wipes your entire queue and resets all preferences. The app will restart as if you're a new user.
			<span class="font-medium text-red-500">This cannot be undone.</span>
		</p>
		{#if resetArmed}
			<div class="flex items-center gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 dark:border-red-900/40 dark:bg-red-950/20">
				<span class="text-sm text-red-700 dark:text-red-400">Are you sure? All data will be lost.</span>
				<div class="ml-auto flex gap-2">
					<button
						onclick={() => { resetArmed = false; }}
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
	</section>

	<div class="border-t border-gray-200 dark:border-gray-800"></div>

	<!-- About -->
	<section class="space-y-4">
		<h2 class="text-sm font-semibold uppercase tracking-widest text-gray-500">About</h2>

		<div class="flex items-center justify-between">
			<span class="text-sm font-medium text-gray-700 dark:text-gray-300">
				Queu<span class="text-orange-400">est</span>
			</span>
			<span class="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-500 dark:bg-gray-800 dark:text-gray-400">
				v{VERSION}
			</span>
		</div>

		<div class="flex flex-wrap gap-2">
			<button
				onclick={openWelcome}
				class="rounded-lg bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
			>
				Show welcome guide
			</button>

			<a
				href={GITHUB_REPO}
				target="_blank"
				rel="noopener noreferrer"
				class="inline-flex items-center gap-1.5 rounded-lg bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
			>
				<svg class="h-4 w-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
					<path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"/>
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
	<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
		onclick={closeFeedback}
	>
		<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
		<div
			class="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl dark:bg-gray-900"
			onclick={(e) => e.stopPropagation()}
		>
			<h2 class="mb-4 text-lg font-semibold text-gray-900 dark:text-white">Send Feedback</h2>
			<p class="mb-4 text-sm text-gray-500 dark:text-gray-400">
				This opens a public GitHub issue — don't include personal info. Check
				<a href="{GITHUB_REPO}/issues" target="_blank" rel="noopener noreferrer" class="text-orange-500 hover:underline">existing issues</a>
				first!
			</p>

			<div class="space-y-3">
				<input
					type="text"
					placeholder="Title (required)"
					bind:value={feedbackTitle}
					class="w-full rounded-lg bg-gray-100 px-4 py-2 text-sm text-gray-900 placeholder-gray-400 outline-none ring-1 ring-gray-300 focus:ring-orange-500 dark:bg-gray-800 dark:text-white dark:placeholder-gray-500 dark:ring-gray-700"
				/>
				<textarea
					placeholder="Details (optional)"
					bind:value={feedbackBody}
					rows="4"
					class="w-full resize-none rounded-lg bg-gray-100 px-4 py-2 text-sm text-gray-900 placeholder-gray-400 outline-none ring-1 ring-gray-300 focus:ring-orange-500 dark:bg-gray-800 dark:text-white dark:placeholder-gray-500 dark:ring-gray-700"
				></textarea>
			</div>

			{#if feedbackError}
				<p class="mt-2 text-xs text-red-500">{feedbackError}</p>
			{/if}
			{#if feedbackIssueUrl}
				<p class="mt-2 text-xs text-teal-600 dark:text-teal-400">
					✓ Issue filed!
					<a href={feedbackIssueUrl} target="_blank" rel="noopener noreferrer" class="underline">View it on GitHub →</a>
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
