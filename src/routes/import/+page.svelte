<script lang="ts">
	import { onMount } from 'svelte';
	import { addItem } from '$lib/db';
	import { parseImportCSV, parseTextList } from '$lib/import';
	import type { ImportRow } from '$lib/import';
	import type { WatchlistItem } from '$lib/types';

	let csvRows         = $state<ImportRow[]>([]);
	let csvFormat       = $state('');
	let csvUrl          = $state('');
	let csvUrlLoading   = $state(false);

	let textInput       = $state('');
	let textRows        = $derived(parseTextList(textInput));

	let importing       = $state(false);
	let importSource    = $state<'csv' | 'text' | null>(null);
	let importTotal     = $state(0);
	let importDone      = $state(0);
	let importAdded     = $state(0);
	let missedTitles    = $state<string[]>([]);
	let importError     = $state('');
	let importDoneOnce  = $state(false);

	function saveMissed() {
		try { localStorage.setItem('sq:import-missed', JSON.stringify(missedTitles)); } catch {}
	}

	function clearMissedTitles() {
		missedTitles = [];
		try { localStorage.removeItem('sq:import-missed'); } catch {}
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
		csvRows = []; csvFormat = ''; importError = '';
		textInput = '';
		const file = (e.currentTarget as HTMLInputElement).files?.[0];
		if (!file) return;
		const reader = new FileReader();
		reader.onload = () => applyCsvText(reader.result as string);
		reader.readAsText(file);
	}

	async function fetchCsvUrl() {
		if (!csvUrl.trim() || csvUrlLoading) return;
		csvRows = []; csvFormat = ''; importError = '';
		textInput = '';
		csvUrlLoading = true;
		try {
			try {
				const direct = await fetch(csvUrl.trim());
				if (direct.ok) { applyCsvText(await direct.text()); return; }
			} catch {
				// CORS blocked — fall through to server proxy
			}
			const res = await fetch('/api/import-fetch', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ url: csvUrl.trim() })
			});
			if (!res.ok) throw new Error(await res.text().catch(() => res.statusText));
			applyCsvText(await res.text());
		} catch (e) {
			importError = e instanceof Error ? e.message : 'Failed to fetch URL.';
		} finally {
			csvUrlLoading = false;
		}
	}

	const BATCH = 10;

	async function doImport(rows: ImportRow[], source: 'csv' | 'text') {
		if (!rows.length || importing) return;
		importing = true; importSource = source; importTotal = rows.length; importDone = 0;
		importAdded = 0; missedTitles = []; importError = ''; importDoneOnce = false;
		try {
			for (let i = 0; i < rows.length; i += BATCH) {
				const batch = rows.slice(i, i + BATCH);
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
				for (const { title, result } of matched) {
					if (result) {
						try {
							await addItem(result);
							importAdded++;
						} catch (e) {
							if (!(e instanceof DOMException && e.name === 'ConstraintError')) throw e;
						}
					} else {
						missedTitles = [...missedTitles, title];
					}
					importDone++;
				}
			}
			importDoneOnce = true;
			saveMissed();
		} catch (e) {
			importError = e instanceof Error ? e.message : 'Import failed.';
		} finally {
			importing = false;
		}
	}

	onMount(() => {
		try { missedTitles = JSON.parse(localStorage.getItem('sq:import-missed') ?? '[]'); } catch {}
	});
</script>

<svelte:head><title>Queuest — Import</title></svelte:head>

<div class="mx-auto max-w-md space-y-8">
	<h1 class="text-xl font-bold xs:text-2xl">Import</h1>

	<div class="space-y-6">

		<!-- Letterboxd / IMDb instructions -->
		<section class="space-y-3">
			<h2 class="text-sm font-semibold uppercase tracking-widest text-gray-500">Letterboxd</h2>
			<p class="text-sm text-gray-600 dark:text-gray-400">
				Go to
				<a href="https://letterboxd.com/settings/data/" target="_blank" rel="noopener noreferrer" class="text-orange-500 hover:underline">Settings → Export your data</a>
				and upload <code class="text-orange-500">watchlist.csv</code>.
			</p>
		</section>

		<section class="space-y-3">
			<h2 class="text-sm font-semibold uppercase tracking-widest text-gray-500">IMDb</h2>
			<p class="text-sm text-gray-600 dark:text-gray-400">
				Go to your
				<a href="https://www.imdb.com/list/watchlist" target="_blank" rel="noopener noreferrer" class="text-orange-500 hover:underline">Watchlist</a>,
				tap ··· → Export, then paste the link below or upload the file.
			</p>
		</section>

		<div class="border-t border-gray-200 dark:border-gray-800"></div>

		<!-- CSV / URL input -->
		<section class="space-y-3">
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
				One title per line — from Notes, Keep, or anywhere. Bullets, numbers, and years are stripped automatically.
			</p>
			<textarea
				bind:value={textInput}
				placeholder={"The Bear\n- Severance (2022)\n1. Andor\n• Slow Horses"}
				rows="6"
				class="w-full rounded-lg bg-gray-100 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 outline-none ring-1 ring-gray-300 focus:ring-orange-500 dark:bg-gray-900 dark:text-white dark:placeholder-gray-500 dark:ring-gray-700"
			></textarea>

			{#if textRows.length > 0}
				<p class="text-sm text-gray-600 dark:text-gray-400">
					<span class="font-medium text-gray-900 dark:text-white">{textRows.length}</span> title{textRows.length === 1 ? '' : 's'} detected.
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
				✓ Added {importAdded} title{importAdded === 1 ? '' : 's'}.{missedTitles.length > 0 ? ` ${missedTitles.length} not found on TMDB.` : ''}
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
						class="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
					>Clear</button>
				</div>
				<p class="text-xs text-gray-500 dark:text-gray-400">Search for these manually and add them to your queue.</p>
				<ul class="space-y-1">
					{#each missedTitles as title (title)}
						<li class="flex items-center justify-between gap-2 rounded-lg bg-gray-50 px-3 py-2 dark:bg-gray-800/60">
							<span class="truncate text-sm text-gray-700 dark:text-gray-300">{title}</span>
							<a
								href="/search?q={encodeURIComponent(title)}"
								class="shrink-0 text-xs font-medium text-orange-500 hover:text-orange-400"
							>Search →</a>
						</li>
					{/each}
				</ul>
			</section>
		{/if}

	</div>
</div>
