<script lang="ts">
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import { parseImportCSV, parseTextList } from '$lib/import';
	import { theme } from '$lib/theme.svelte';
	import type { SharedCollection } from '$lib/collection-actions';
	import AddToListButton from '$lib/components/AddToListButton.svelte';
	import Button from '$lib/components/Button.svelte';
	import {
		importRows,
		restoreBackup,
		fetchCsvFromUrl,
		type RestoreDeps,
		type ImportActionDeps,
		type ImportTarget
	} from '$lib/import-actions';
	import type { ImportRow } from '$lib/import';

	let {
		existingCollections,
		queueColors,
		sharedCollections,
		sharedListColors
	}: {
		existingCollections: string[];
		queueColors: Record<string, string>;
		sharedCollections: SharedCollection[];
		sharedListColors: Record<string, string>;
	} = $props();

	// ── CSV file upload (paired with the Letterboxd instructions) ─────────────
	let fileRows = $state<ImportRow[]>([]);
	let fileFormat = $state('');

	// ── CSV link fetch (paired with the IMDb instructions) ────────────────────
	let urlRows = $state<ImportRow[]>([]);
	let urlFormat = $state('');
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
	let importSource = $state<'file' | 'url' | 'text' | null>(null);
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

	function onCsvFileChange(e: Event) {
		fileRows = [];
		fileFormat = '';
		importError = '';
		const file = (e.currentTarget as HTMLInputElement).files?.[0];
		if (!file) return;
		if (file.size > MAX_PASTE_SIZE) {
			importError = `File too large (max ${Math.round(MAX_PASTE_SIZE / 1024)} KB)`;
			return;
		}
		const reader = new FileReader();
		reader.onload = () => {
			const { rows, format } = parseImportCSV(reader.result as string);
			if (format === 'unknown') {
				importError = 'Unrecognised format. Expected a Letterboxd or IMDb watchlist CSV.';
				return;
			}
			fileRows = rows;
			fileFormat = format === 'letterboxd' ? 'Letterboxd' : 'IMDb';
		};
		reader.readAsText(file);
	}

	async function fetchCsvUrl() {
		if (!csvUrl.trim() || csvUrlLoading) return;
		urlRows = [];
		urlFormat = '';
		importError = '';
		csvUrlLoading = true;
		try {
			const { rows, format } = await fetchCsvFromUrl(csvUrl);
			if (format === 'unknown') {
				importError = 'Unrecognised format. Expected a Letterboxd or IMDb watchlist CSV.';
				return;
			}
			urlRows = rows;
			urlFormat = format === 'letterboxd' ? 'Letterboxd' : 'IMDb';
		} catch (e) {
			importError = e instanceof Error ? e.message : 'Failed to fetch URL.';
		} finally {
			csvUrlLoading = false;
		}
	}

	async function doImport(
		rows: ImportRow[],
		source: 'file' | 'url' | 'text',
		target?: ImportTarget
	) {
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
		await importRows(rows, deps, target);
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
	// Shared by both file inputs below (backup restore and CSV upload) — the
	// same 274-character class string was previously copied verbatim in two
	// places, so a change to one silently gave the two controls different
	// looks (#131).
	const FILE_INPUT_CLASS =
		'w-full cursor-pointer rounded-lg bg-gray-100 px-3 py-2 text-sm text-gray-700 file:mr-3 file:rounded file:border-0 file:bg-gray-200 file:px-3 file:py-1 file:text-xs file:font-medium file:text-gray-700 hover:file:bg-gray-300 dark:bg-gray-900 dark:text-gray-300 dark:file:bg-gray-800 dark:file:text-gray-200 dark:hover:file:bg-gray-700';
</script>

<div class="space-y-6">
	<!-- Restore backup -->
	<section class="space-y-3">
		<h2 class="section-heading">Restore backup</h2>
		<p class="body-text">
			Restore from a <code class="text-orange-500">.queuest</code> file. Theme and budget
			preferences are restored too.
			<span class="font-medium text-red-500">This replaces your current queue.</span>
		</p>
		<input
			type="file"
			aria-label="Backup file"
			accept=".queuest"
			class={FILE_INPUT_CLASS}
			onchange={onRestoreFileChange}
		/>
		<div class="flex gap-2">
			<input
				type="password"
				aria-label="Restore passphrase"
				placeholder="Passphrase"
				bind:value={restorePassphrase}
				class="input-field flex-1 px-4 py-2"
				onkeydown={(e) => e.key === 'Enter' && doRestore()}
			/>
			<Button
				class="px-4 py-2 text-sm"
				disabled={!restoreFile || !restorePassphrase || restoring}
				onclick={doRestore}
			>
				{restoring ? 'Decrypting…' : 'Import'}
			</Button>
		</div>
		{#if restoreError}<p class="text-xs text-red-500">{restoreError}</p>{/if}
		{#if restoreDone}<p class="text-xs text-teal-600 dark:text-teal-400">
				✓ Queue restored successfully.
			</p>{/if}
	</section>

	<div class="divider"></div>

	<!-- Letterboxd — instructions paired with the file upload that handles them -->
	<section class="space-y-3">
		<h2 class="section-heading">Letterboxd</h2>
		<p class="body-text">
			Go to
			<a
				href="https://letterboxd.com/settings/data/"
				target="_blank"
				rel="noopener noreferrer"
				class="text-orange-500 hover:underline">Settings → Export your data</a
			>
			and upload the <code class="text-orange-500">watchlist.csv</code> file below.
		</p>
		<input
			type="file"
			aria-label="CSV file"
			accept=".csv"
			class={FILE_INPUT_CLASS}
			onchange={onCsvFileChange}
		/>

		{#if fileFormat && fileRows.length}
			<p class="body-text">
				Found <span class="font-medium text-gray-900 dark:text-white">{fileRows.length}</span>
				title{fileRows.length === 1 ? '' : 's'} from {fileFormat}.
			</p>
		{/if}

		<AddToListButton
			label="Add to Queue"
			busy={importing && importSource === 'file'}
			busyLabel="Matching {importDone} / {importTotal}…"
			disabled={!fileRows.length || (importing && importSource !== 'file')}
			{existingCollections}
			{queueColors}
			{sharedCollections}
			{sharedListColors}
			onAddToQueue={() => doImport(fileRows, 'file')}
			onAddToList={(target) => doImport(fileRows, 'file', target)}
		/>
	</section>

	<div class="divider"></div>

	<!-- IMDb — instructions paired with the link-paste that handles them -->
	<section class="space-y-3">
		<h2 class="section-heading">IMDb</h2>
		<p class="body-text">
			Go to your
			<a
				href="https://www.imdb.com/list/watchlist"
				target="_blank"
				rel="noopener noreferrer"
				class="text-orange-500 hover:underline">Watchlist</a
			>, tap ··· → Export, then paste the link below. (Got a file instead? The upload above works
			for an IMDb export too.)
		</p>
		<div class="flex gap-2">
			<div class="relative flex-1">
				<input
					type="url"
					aria-label="IMDb export link"
					placeholder="https://… (IMDb export link)"
					bind:value={csvUrl}
					onkeydown={(e) => e.key === 'Enter' && fetchCsvUrl()}
					class="input-field px-3 py-2 pr-9"
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

		{#if urlFormat && urlRows.length}
			<p class="body-text">
				Found <span class="font-medium text-gray-900 dark:text-white">{urlRows.length}</span>
				title{urlRows.length === 1 ? '' : 's'} from {urlFormat}.
			</p>
		{/if}

		<AddToListButton
			label="Add to Queue"
			busy={importing && importSource === 'url'}
			busyLabel="Matching {importDone} / {importTotal}…"
			disabled={!urlRows.length || (importing && importSource !== 'url')}
			{existingCollections}
			{queueColors}
			{sharedCollections}
			{sharedListColors}
			onAddToQueue={() => doImport(urlRows, 'url')}
			onAddToList={(target) => doImport(urlRows, 'url', target)}
		/>
	</section>

	<div class="divider"></div>

	<!-- Freeform text list -->
	<section class="space-y-3">
		<h2 class="section-heading">Paste a list</h2>
		<p class="body-text">
			One title per line — from Notes, Keep, Obsidian, or anywhere. Markdown bullets, numbers,
			checkboxes, and years are stripped automatically.
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
			class="input-field px-3 py-2"></textarea>
		<!-- eslint-enable svelte/no-useless-mustaches -->

		{#if textParseError}
			<p class="text-xs text-red-500">{textParseError}</p>
		{/if}

		{#if textRows.length > 0}
			<p class="body-text">
				<span class="font-medium text-gray-900 dark:text-white">{textRows.length}</span>
				title{textRows.length === 1 ? '' : 's'} detected.
			</p>
		{/if}

		<AddToListButton
			label="Add to Queue"
			busy={importing && importSource === 'text'}
			busyLabel="Matching {importDone} / {importTotal}…"
			disabled={!textRows.length || (importing && importSource !== 'text')}
			{existingCollections}
			{queueColors}
			{sharedCollections}
			{sharedListColors}
			onAddToQueue={() => doImport(textRows, 'text')}
			onAddToList={(target) => doImport(textRows, 'text', target)}
		/>
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
		<div class="divider"></div>
		<section class="space-y-2">
			<div class="flex items-center justify-between">
				<h2 class="section-heading">
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
