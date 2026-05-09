<script lang="ts">
	import { onMount } from 'svelte';
	import type { WatchlistItem } from '$lib/types';
	import { getAll, removeItem, setWatched, replaceAll } from '$lib/db';
	import { encrypt, decrypt } from '$lib/crypto';
	import { TMDB_IMG, formatRuntime } from '$lib/tmdb';

	let items = $state<WatchlistItem[]>([]);
	let loaded = $state(false);
	let tab = $state<'queue' | 'watched'>('queue');
	let busy = $state(new Set<number>());

	// Export state
	let exporting = $state(false);
	let exportPassphrase = $state('');
	let showExportModal = $state(false);

	// Import state
	let importing = $state(false);
	let importFile = $state<File | null>(null);
	let importPassphrase = $state('');
	let importError = $state('');
	let showImportModal = $state(false);

	let queued = $derived(items.filter((i) => !i.watched_at));
	let watched = $derived(items.filter((i) => i.watched_at));
	let visible = $derived(tab === 'queue' ? queued : watched);

	async function reload() {
		items = await getAll();
	}

	onMount(async () => {
		await reload();
		loaded = true;
	});

	async function toggle(item: WatchlistItem) {
		busy = new Set(busy).add(item.id);
		await setWatched(item.id, !item.watched_at);
		await reload();
		const next = new Set(busy);
		next.delete(item.id);
		busy = next;
	}

	async function remove(item: WatchlistItem) {
		busy = new Set(busy).add(item.id);
		await removeItem(item.id);
		await reload();
		const next = new Set(busy);
		next.delete(item.id);
		busy = next;
	}

	// ── Export ────────────────────────────────────────────────────────────────

	async function doExport() {
		if (!exportPassphrase) return;
		exporting = true;
		try {
			const json = JSON.stringify(items);
			const buf = await encrypt(json, exportPassphrase);
			const blob = new Blob([buf], { type: 'application/octet-stream' });
			const url = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = `streamq-${new Date().toISOString().slice(0, 10)}.streamq`;
			a.click();
			URL.revokeObjectURL(url);
			showExportModal = false;
			exportPassphrase = '';
		} finally {
			exporting = false;
		}
	}

	// ── Import ────────────────────────────────────────────────────────────────

	function onFileChange(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		importFile = input.files?.[0] ?? null;
		importError = '';
	}

	async function doImport() {
		if (!importFile || !importPassphrase) return;
		importing = true;
		importError = '';
		try {
			const buf = await importFile.arrayBuffer();
			const json = await decrypt(buf, importPassphrase);
			const parsed: WatchlistItem[] = JSON.parse(json);
			await replaceAll(parsed);
			await reload();
			showImportModal = false;
			importFile = null;
			importPassphrase = '';
		} catch (e) {
			importError = e instanceof Error ? e.message : 'Import failed.';
		} finally {
			importing = false;
		}
	}
</script>

<svelte:head>
	<title>StreamQ — My Queue</title>
</svelte:head>

<div class="space-y-6">
	<div class="flex items-center justify-between">
		<h1 class="text-2xl font-bold">My Queue</h1>
		<div class="flex items-center gap-2">
			<!-- Backup controls -->
			<button
				class="rounded-lg bg-gray-800 px-3 py-2 text-xs font-medium text-gray-300 transition-colors hover:bg-gray-700"
				onclick={() => (showImportModal = true)}
			>
				Import
			</button>
			{#if items.length > 0}
				<button
					class="rounded-lg bg-gray-800 px-3 py-2 text-xs font-medium text-gray-300 transition-colors hover:bg-gray-700"
					onclick={() => (showExportModal = true)}
				>
					Export
				</button>
			{/if}
			<a
				class="rounded-lg bg-orange-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-orange-400"
				href="/search"
			>
				+ Add Titles
			</a>
		</div>
	</div>

	<!-- Tabs -->
	{#if loaded && items.length > 0}
		<div class="flex w-fit gap-1 rounded-lg bg-gray-900 p-1">
			<button
				class="rounded-md px-4 py-1.5 text-sm font-medium transition-colors {tab === 'queue'
					? 'bg-gray-700 text-white'
					: 'text-gray-400 hover:text-white'}"
				onclick={() => (tab = 'queue')}
			>
				To Watch ({queued.length})
			</button>
			<button
				class="rounded-md px-4 py-1.5 text-sm font-medium transition-colors {tab === 'watched'
					? 'bg-gray-700 text-white'
					: 'text-gray-400 hover:text-white'}"
				onclick={() => (tab = 'watched')}
			>
				Watched ({watched.length})
			</button>
		</div>
	{/if}

	<!-- Loading skeleton -->
	{#if !loaded}
		<div class="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
			{#each { length: 5 } as _, i (i)}
				<div class="aspect-[2/3] animate-pulse rounded-xl bg-gray-800"></div>
			{/each}
		</div>

	<!-- Empty state -->
	{:else if visible.length === 0}
		<div class="flex flex-col items-center justify-center py-24 text-center">
			{#if tab === 'queue'}
				<p class="mb-4 text-5xl">🎬</p>
				<p class="text-lg font-medium text-gray-300">Your queue is empty</p>
				<p class="mt-1 text-sm text-gray-500">
					<a class="text-orange-400 hover:underline" href="/search">Search for movies and shows</a>
					to get started
				</p>
			{:else}
				<p class="mb-4 text-5xl">✅</p>
				<p class="text-lg font-medium text-gray-300">Nothing watched yet</p>
				<p class="mt-1 text-sm text-gray-500">Mark titles as watched and they'll appear here</p>
			{/if}
		</div>

	<!-- Grid -->
	{:else}
		<div class="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
			{#each visible as item (item.id)}
				<div class="flex flex-col overflow-hidden rounded-xl bg-gray-900">
					<!-- Poster -->
					<div class="relative aspect-[2/3] bg-gray-800">
						{#if item.poster_path}
							<img
								src="{TMDB_IMG}/w300{item.poster_path}"
								alt={item.title}
								class="h-full w-full object-cover"
							/>
						{:else}
							<div class="flex h-full w-full items-center justify-center text-4xl text-gray-600">
								🎬
							</div>
						{/if}
						<span
							class="absolute left-2 top-2 rounded bg-black/60 px-1.5 py-0.5 text-xs font-medium uppercase tracking-wide text-gray-300"
						>
							{item.media_type === 'movie' ? 'Film' : 'TV'}
						</span>
					</div>

					<!-- Info -->
					<div class="flex flex-1 flex-col gap-2 p-3">
						<p class="line-clamp-2 text-sm font-medium leading-tight">{item.title}</p>

						{#if item.runtime_minutes}
							<p class="text-xs text-gray-500">
								🕐 {formatRuntime(item.runtime_minutes, item.media_type)}
							</p>
						{/if}

						{#if item.providers.length > 0}
							<div class="flex flex-wrap gap-1">
								{#each item.providers.slice(0, 4) as p (p.provider_id)}
									<img
										src="{TMDB_IMG}/w92{p.logo_path}"
										alt={p.provider_name}
										title={p.provider_name}
										class="h-5 w-5 rounded"
									/>
								{/each}
								{#if item.providers.length > 4}
									<span class="text-xs text-gray-500">+{item.providers.length - 4}</span>
								{/if}
							</div>
						{:else}
							<p class="text-xs text-gray-600">Not streaming</p>
						{/if}

						<!-- Actions -->
						<div class="mt-auto flex gap-1.5 pt-1">
							<button
								class="flex-1 rounded-md bg-gray-800 py-1 text-xs font-medium transition-colors hover:bg-gray-700 disabled:opacity-40"
								disabled={busy.has(item.id)}
								onclick={() => toggle(item)}
							>
								{item.watched_at ? 'Unwatch' : '✓ Watched'}
							</button>
							<button
								class="rounded-md bg-gray-800 px-2 py-1 text-xs text-gray-400 transition-colors hover:bg-red-900/50 hover:text-red-400 disabled:opacity-40"
								disabled={busy.has(item.id)}
								onclick={() => remove(item)}
								aria-label="Remove"
							>
								✕
							</button>
						</div>
					</div>
				</div>
			{/each}
		</div>
	{/if}
</div>

<!-- ── Export Modal ──────────────────────────────────────────────────────── -->
{#if showExportModal}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
		role="dialog"
		aria-modal="true"
		aria-label="Export watchlist"
	>
		<div class="w-full max-w-sm space-y-4 rounded-2xl bg-gray-900 p-6">
			<h2 class="text-lg font-semibold">Export Watchlist</h2>
			<p class="text-sm text-gray-400">
				Your watchlist will be encrypted with a passphrase and saved as a <code
					class="text-orange-400">.streamq</code
				> file. You'll need this passphrase to import it later.
			</p>
			<input
				type="password"
				placeholder="Passphrase"
				bind:value={exportPassphrase}
				class="w-full rounded-lg bg-gray-800 px-4 py-2.5 text-sm placeholder-gray-500 outline-none ring-1 ring-gray-700 focus:ring-orange-500"
				onkeydown={(e) => e.key === 'Enter' && doExport()}
			/>
			<div class="flex gap-2">
				<button
					class="flex-1 rounded-lg bg-orange-500 py-2 text-sm font-medium text-white transition-colors hover:bg-orange-400 disabled:opacity-50"
					disabled={!exportPassphrase || exporting}
					onclick={doExport}
				>
					{exporting ? 'Encrypting…' : 'Download'}
				</button>
				<button
					class="rounded-lg bg-gray-800 px-4 py-2 text-sm font-medium text-gray-300 transition-colors hover:bg-gray-700"
					onclick={() => { showExportModal = false; exportPassphrase = ''; }}
				>
					Cancel
				</button>
			</div>
		</div>
	</div>
{/if}

<!-- ── Import Modal ──────────────────────────────────────────────────────── -->
{#if showImportModal}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
		role="dialog"
		aria-modal="true"
		aria-label="Import watchlist"
	>
		<div class="w-full max-w-sm space-y-4 rounded-2xl bg-gray-900 p-6">
			<h2 class="text-lg font-semibold">Import Watchlist</h2>
			<p class="text-sm text-gray-400">
				Select a <code class="text-orange-400">.streamq</code> backup file and enter your passphrase.
				<span class="font-medium text-red-400">This will replace your current queue.</span>
			</p>
			<input
				type="file"
				accept=".streamq"
				class="w-full cursor-pointer rounded-lg bg-gray-800 px-3 py-2 text-sm text-gray-300 file:mr-3 file:rounded file:border-0 file:bg-gray-700 file:px-3 file:py-1 file:text-xs file:font-medium file:text-gray-200"
				onchange={onFileChange}
			/>
			<input
				type="password"
				placeholder="Passphrase"
				bind:value={importPassphrase}
				class="w-full rounded-lg bg-gray-800 px-4 py-2.5 text-sm placeholder-gray-500 outline-none ring-1 ring-gray-700 focus:ring-orange-500"
				onkeydown={(e) => e.key === 'Enter' && doImport()}
			/>
			{#if importError}
				<p class="text-xs text-red-400">{importError}</p>
			{/if}
			<div class="flex gap-2">
				<button
					class="flex-1 rounded-lg bg-orange-500 py-2 text-sm font-medium text-white transition-colors hover:bg-orange-400 disabled:opacity-50"
					disabled={!importFile || !importPassphrase || importing}
					onclick={doImport}
				>
					{importing ? 'Decrypting…' : 'Import'}
				</button>
				<button
					class="rounded-lg bg-gray-800 px-4 py-2 text-sm font-medium text-gray-300 transition-colors hover:bg-gray-700"
					onclick={() => { showImportModal = false; importFile = null; importPassphrase = ''; importError = ''; }}
				>
					Cancel
				</button>
			</div>
		</div>
	</div>
{/if}
