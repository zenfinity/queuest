<script lang="ts">
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import { parseImportCSV, parseTextList } from '$lib/import';
	import { theme } from '$lib/theme.svelte';
	import {
		importRows,
		restoreBackup,
		fetchCsvFromUrl,
		type RestoreDeps,
		type ImportActionDeps
	} from '$lib/import-actions';
	import type { ImportRow } from '$lib/import';

	// ── CSV import (Letterboxd / IMDb) ────────────────────────────────────────
	let csvRows = $state<ImportRow[]>([]);
	let csvFormat = $state('');
	let csvUrl = $state('');
	let csvUrlLoading = $state(false);

	const MAX_PASTE_SIZE = 100 * 1024; // 100 KB

	let textInput = $state('');
	let textRows = $state<ImportRow[]>([]);
	let textParseError = $state('');

	let debounceTimer: ReturnType<typeof setTimeout> | null = null;

	function parseTextDebounced() {
		if (debounceTimer) clearTimeout(debounceTimer);
		if (!textInput.trim()) {
			textRows = [];
			textParseError = '';
			return;
		}
		debounceTimer = setTimeout(() => {
			try {
				textRows = parseTextList(textInput);
				textParseError = '';
			} catch (e) {
				textParseError = e instanceof Error ? e.message : 'Parse error';
				textRows = [];
			}
		}, 300);
	}

	$effect(() => {
		parseTextDebounced();
	});

	let importing = $state(false);
	let importSource = $state<'csv' | 'text' | null>(null);
	let importTotal = $state(0);
	let importDone = $state(0);
	let importAdded = $state(0);
	let missedTitles = $state<string[]>([]);
	let importError = $state('');
	let importDoneOnce = $state(false);

	function clearMissedTitles() {
		missedTitles = [];
		try {
			localStorage.removeItem('sq:import-missed');
		} catch {
			// Best-effort localStorage write; app works fine without it
		}
	}

	function applyCsvText(text: string) {
		const { rows, format } = parseImportCSV(text);
		if (format === 'unknown') {
			importError = 'Unrecognised format. Expected a Letterboxd or IMDb watchlist CSV.';
			return;
		}
		csvRows = rows;
		csvFormat = format === 'letterboxd' ? 'Letterboxd' : 'IMDb';
	}

	function onCsvFileChange(e: Event) {
		csvRows = [];
		csvFormat = '';
		importError = '';
		textInput = '';
		const file = (e.currentTarget as HTMLInputElement).files?.[0];
		if (!file) return;
		if (file.size > MAX_PASTE_SIZE) {
			importError = `File too large (max ${Math.round(MAX_PASTE_SIZE / 1024)} KB)`;
			return;
		}
		const reader = new FileReader();
		reader.onload = () => applyCsvText(reader.result as string);
		reader.readAsText(file);
	}

	async function fetchCsvUrl() {
		if (!csvUrl.trim() || csvUrlLoading) return;
		csvRows = [];
		csvFormat = '';
		importError = '';
		textInput = '';
		csvUrlLoading = true;
		try {
			const { rows, format } = await fetchCsvFromUrl(csvUrl);
			if (format === 'unknown') {
				importError = 'Unrecognised format. Expected a Letterboxd or IMDb watchlist CSV.';
				return;
			}
			csvRows = rows;
			csvFormat = format === 'letterboxd' ? 'Letterboxd' : 'IMDb';
		} catch (e) {
			importError = e instanceof Error ? e.message : 'Failed to fetch URL.';
		} finally {
			csvUrlLoading = false;
		}
	}

	async function doImport(rows: ImportRow[], source: 'csv' | 'text') {
		if (!rows.length || importing) return;
		importSource = source;
		const deps: ImportActionDeps = {
			setImporting: (v) => (importing = v),
			setImportTotal: (v) => (importTotal = v),
			setImportDone: (v) => (importDone = v),
			setImportAdded: (v) => (importAdded = v),
			setImportError: (v) => (importError = v),
			setMissedTitles: (v) => (missedTitles = v),
			setImportDoneOnce: (v) => (importDoneOnce = v)
		};
		importDoneOnce = false;
		await importRows(rows, deps);
	}

	// ── Backup restore (.queuest) ─────────────────────────────────────────────
	let restoreFile = $state<File | null>(null);
	let restorePassphrase = $state('');
	let restoring = $state(false);
	let restoreError = $state('');
	let restoreDone = $state(false);

	function onRestoreFileChange(e: Event) {
		restoreFile = (e.currentTarget as HTMLInputElement).files?.[0] ?? null;
		restoreError = '';
		restoreDone = false;
	}

	async function doRestore() {
		if (!restoreFile || !restorePassphrase) return;
		const file = restoreFile;
		const passphrase = restorePassphrase;
		restoreDone = false;
		const deps: RestoreDeps = {
			setImporting: (v) => (restoring = v),
			setImportTotal: () => {},
			setImportDone: () => {},
			setImportAdded: () => {},
			setImportError: (v) => (restoreError = v),
			setMissedTitles: () => {},
			setImportDoneOnce: (v) => (restoreDone = v),
			setThemeDark: (dark) => (theme.dark = dark)
		};
		await restoreBackup(file, passphrase, deps);
		if (restoreDone) {
			restoreFile = null;
			restorePassphrase = '';
		}
	}

	onMount(() => {
		try {
			missedTitles = JSON.parse(localStorage.getItem('sq:import-missed') ?? '[]');
		} catch {
			// Best-effort localStorage read; app works fine without missed titles list
		}
	});
</script>

<div class="space-y-6">
	<!-- Restore backup -->
	<section class="space-y-3">
		<h2 class="text-sm font-semibold uppercase tracking-widest text-gray-500">Restore backup</h2>
		<p class="text-sm text-gray-600 dark:text-gray-400">
			Restore from a <code class="text-orange-500">.queuest</code> file. Theme and budget
			preferences are restored too.
			<span class="font-medium text-red-500">This replaces your current queue.</span>
		</p>
		<input
			type="file"
			aria-label="Backup file"
			accept=".queuest"
			class="w-full cursor-pointer rounded-lg bg-gray-100 px-3 py-2 text-sm text-gray-700 file:mr-3 file:rounded file:border-0 file:bg-gray-200 file:px-3 file:py-1 file:text-xs file:font-medium file:text-gray-700 hover:file:bg-gray-300 dark:bg-gray-900 dark:text-gray-300 dark:file:bg-gray-800 dark:file:text-gray-200 dark:hover:file:bg-gray-700"
			onchange={onRestoreFileChange}
		/>
		<div class="flex gap-2">
			<input
				type="password"
				aria-label="Restore passphrase"
				placeholder="Passphrase"
				bind:value={restorePassphrase}
				class="flex-1 rounded-lg bg-gray-100 px-4 py-2 text-base sm:text-sm text-gray-900 placeholder-gray-400 outline-none ring-1 ring-gray-300 focus:ring-orange-500 dark:bg-gray-900 dark:text-white dark:placeholder-gray-500 dark:ring-gray-700"
				onkeydown={(e) => e.key === 'Enter' && doRestore()}
			/>
			<button
				class="rounded-lg bg-orange-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-orange-400 disabled:opacity-50"
				disabled={!restoreFile || !restorePassphrase || restoring}
				onclick={doRestore}
			>
				{restoring ? 'Decrypting…' : 'Import'}
			</button>
		</div>
		{#if restoreError}<p class="text-xs text-red-500">{restoreError}</p>{/if}
		{#if restoreDone}<p class="text-xs text-teal-600 dark:text-teal-400">
				✓ Queue restored successfully.
			</p>{/if}
	</section>

	<div class="border-t border-gray-200 dark:border-gray-800"></div>

	<!-- Letterboxd / IMDb instructions -->
	<section class="space-y-3">
		<h2 class="text-sm font-semibold uppercase tracking-widest text-gray-500">Letterboxd</h2>
		<p class="text-sm text-gray-600 dark:text-gray-400">
			Go to
			<a
				href="https://letterboxd.com/settings/data/"
				target="_blank"
				rel="noopener noreferrer"
				class="text-orange-500 hover:underline">Settings → Export your data</a
			>
			and upload the <code class="text-orange-500">watchlist.csv</code> file below.
		</p>
	</section>

	<section class="space-y-3">
		<h2 class="text-sm font-semibold uppercase tracking-widest text-gray-500">IMDb</h2>
		<p class="text-sm text-gray-600 dark:text-gray-400">
			Go to your
			<a
				href="https://www.imdb.com/list/watchlist"
				target="_blank"
				rel="noopener noreferrer"
				class="text-orange-500 hover:underline">Watchlist</a
			>, tap ··· → Export, then paste the link below or upload the file.
		</p>
	</section>

	<div class="border-t border-gray-200 dark:border-gray-800"></div>

	<!-- CSV / URL input -->
	<section class="space-y-3">
		<h2 class="text-sm font-semibold uppercase tracking-widest text-gray-500">Upload CSV</h2>
		<input
			type="file"
			aria-label="CSV file"
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
			<div class="relative flex-1">
				<input
					type="url"
					aria-label="IMDb export link"
					placeholder="https://… (IMDb export link)"
					bind:value={csvUrl}
					onkeydown={(e) => e.key === 'Enter' && fetchCsvUrl()}
					class="w-full rounded-lg bg-gray-100 px-3 py-2 pr-9 text-base sm:text-sm text-gray-900 placeholder-gray-400 outline-none ring-1 ring-gray-300 focus:ring-orange-500 dark:bg-gray-900 dark:text-white dark:placeholder-gray-500 dark:ring-gray-700"
				/>
				{#if csvUrl}
					<button
						type="button"
						aria-label="Clear link"
						onclick={() => (csvUrl = '')}
						class="absolute inset-y-0 right-0 flex w-8 items-center justify-center text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
					>
						<svg class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
							<path
								d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z"
							/>
						</svg>
					</button>
				{/if}
			</div>
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
				Found <span class="font-medium text-gray-900 dark:text-white">{csvRows.length}</span>
				title{csvRows.length === 1 ? '' : 's'} from {csvFormat}.
			</p>
		{/if}

		<button
			onclick={() => doImport(csvRows, 'csv')}
			disabled={!csvRows.length || importing}
			class="rounded-lg bg-orange-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-orange-400 disabled:opacity-50"
		>
			{#if importing && importSource === 'csv'}
				Matching {importDone} / {importTotal}…
			{:else}
				Add to Queue
			{/if}
		</button>
	</section>

	<div class="border-t border-gray-200 dark:border-gray-800"></div>

	<!-- Freeform text list -->
	<section class="space-y-3">
		<h2 class="text-sm font-semibold uppercase tracking-widest text-gray-500">Paste a list</h2>
		<p class="text-sm text-gray-600 dark:text-gray-400">
			One title per line — from Notes, Keep, or anywhere. Bullets, numbers, and years are stripped
			automatically.
		</p>
		<!-- eslint-disable svelte/no-useless-mustaches -- literal \n only survives inside an expression; Svelte collapses whitespace in static attribute text -->
		<textarea
			aria-label="Titles to import"
			bind:value={textInput}
			onpaste={(e) => {
				const paste = e.clipboardData?.getData('text') ?? '';
				if (paste.length > MAX_PASTE_SIZE) {
					e.preventDefault();
					textParseError = `Paste too large (max ${Math.round(MAX_PASTE_SIZE / 1024)} KB)`;
				}
			}}
			placeholder={'The Bear\n- Severance (2022)\n1. Andor\n• Slow Horses'}
			rows="6"
			class="w-full rounded-lg bg-gray-100 px-3 py-2 text-base sm:text-sm text-gray-900 placeholder-gray-400 outline-none ring-1 ring-gray-300 focus:ring-orange-500 dark:bg-gray-900 dark:text-white dark:placeholder-gray-500 dark:ring-gray-700"
		></textarea>
		<!-- eslint-enable svelte/no-useless-mustaches -->

		{#if textParseError}
			<p class="text-xs text-red-500">{textParseError}</p>
		{/if}

		{#if textRows.length > 0}
			<p class="text-sm text-gray-600 dark:text-gray-400">
				<span class="font-medium text-gray-900 dark:text-white">{textRows.length}</span>
				title{textRows.length === 1 ? '' : 's'} detected.
			</p>
		{/if}

		<button
			onclick={() => doImport(textRows, 'text')}
			disabled={!textRows.length || importing}
			class="rounded-lg bg-orange-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-orange-400 disabled:opacity-50"
		>
			{#if importing && importSource === 'text'}
				Matching {importDone} / {importTotal}…
			{:else}
				Add to Queue
			{/if}
		</button>
	</section>

	{#if importError}
		<p class="text-xs text-red-500">{importError}</p>
	{/if}

	{#if importDoneOnce && !importing}
		<p class="text-xs text-teal-600 dark:text-teal-400">
			✓ Added {importAdded} title{importAdded === 1 ? '' : 's'}.{missedTitles.length > 0
				? ` ${missedTitles.length} not found on TMDB.`
				: ''}
		</p>
	{/if}

	<!-- Missed titles -->
	{#if missedTitles.length > 0 && !importing}
		<div class="border-t border-gray-200 dark:border-gray-800"></div>
		<section class="space-y-2">
			<div class="flex items-center justify-between">
				<h2 class="text-sm font-semibold uppercase tracking-widest text-gray-500">
					Not Found ({missedTitles.length})
				</h2>
				<button
					onclick={clearMissedTitles}
					class="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">Clear</button
				>
			</div>
			<p class="text-xs text-gray-500 dark:text-gray-400">
				Search for these manually and add them to your queue.
			</p>
			<ul class="space-y-1">
				{#each missedTitles as title (title)}
					<li
						class="flex items-center justify-between gap-2 rounded-lg bg-gray-50 px-3 py-2 dark:bg-gray-800/60"
					>
						<span class="truncate text-sm text-gray-700 dark:text-gray-300">{title}</span>
						<a
							href={resolve(`/add?q=${encodeURIComponent(title)}`)}
							class="shrink-0 text-xs font-medium text-orange-500 hover:text-orange-400">Search →</a
						>
					</li>
				{/each}
			</ul>
		</section>
	{/if}
</div>
