<script lang="ts">
	import { onMount } from 'svelte';
	import type { WatchlistItem } from '$lib/types';
	import { getAll, removeItem, setWatched, replaceAll } from '$lib/db';
	import { encrypt, decrypt } from '$lib/crypto';
	import { TMDB_IMG, formatRuntime } from '$lib/tmdb';

	// ── Persisted prefs ───────────────────────────────────────────────────────
	type SortKey = 'added' | 'title' | 'runtime';
	type ViewKey = 'grid' | 'lanes';

	function loadPref<T extends string>(key: string, fallback: T): T {
		try {
			return (localStorage.getItem(key) as T) ?? fallback;
		} catch {
			return fallback;
		}
	}

	// ── Core state ────────────────────────────────────────────────────────────
	let items = $state<WatchlistItem[]>([]);
	let loaded = $state(false);
	let tab = $state<'queue' | 'watched'>('queue');
	let busy = $state(new Set<number>());

	// active detail pop-up in lanes view
	let activeItem = $state<WatchlistItem | null>(null);

	let sortBy = $state<SortKey>('added');
	let viewMode = $state<ViewKey>('grid');

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

	// ── Derived lists ─────────────────────────────────────────────────────────
	let queued = $derived(items.filter((i) => !i.watched_at));
	let watched = $derived(items.filter((i) => i.watched_at));
	let activeItems = $derived(tab === 'queue' ? queued : watched);

	function sorted(list: WatchlistItem[]): WatchlistItem[] {
		return [...list].sort((a, b) => {
			if (sortBy === 'title') return a.title.localeCompare(b.title);
			if (sortBy === 'runtime') {
				const ra = a.runtime_minutes ?? Infinity;
				const rb = b.runtime_minutes ?? Infinity;
				return ra - rb;
			}
			return b.added_at.localeCompare(a.added_at);
		});
	}

	// Grid: single flat section
	let flatItems = $derived(sorted(activeItems));

	// Lanes: one lane per primary provider, sorted by lane size desc; "Not Streaming" last
	type Lane = {
		key: string;
		label: string;
		logo: string | null;
		items: WatchlistItem[];
	};

	let lanes = $derived.by((): Lane[] => {
		const list = sorted(activeItems);
		const map = new Map<string, Lane>();
		const noProvider: WatchlistItem[] = [];

		for (const item of list) {
			if (!item.providers.length) {
				noProvider.push(item);
			} else {
				const p = item.providers[0];
				if (!map.has(p.provider_name)) {
					map.set(p.provider_name, {
						key: p.provider_name,
						label: p.provider_name,
						logo: p.logo_path,
						items: []
					});
				}
				map.get(p.provider_name)!.items.push(item);
			}
		}

		const out = [...map.values()].sort((a, b) => b.items.length - a.items.length);
		if (noProvider.length) {
			out.push({ key: '__none__', label: 'Not Streaming', logo: null, items: noProvider });
		}
		return out;
	});

	// ── Lifecycle ─────────────────────────────────────────────────────────────
	async function reload() {
		items = await getAll();
	}

	onMount(async () => {
		sortBy = loadPref<SortKey>('sq:sort', 'added');
		viewMode = loadPref<ViewKey>('sq:view', 'grid');
		await reload();
		loaded = true;
	});

	$effect(() => {
		try {
			localStorage.setItem('sq:sort', sortBy);
			localStorage.setItem('sq:view', viewMode);
		} catch {}
	});

	// ── Actions ───────────────────────────────────────────────────────────────
	async function toggle(item: WatchlistItem) {
		busy = new Set(busy).add(item.id);
		await setWatched(item.id, !item.watched_at);
		if (activeItem?.id === item.id) activeItem = null;
		await reload();
		const next = new Set(busy);
		next.delete(item.id);
		busy = next;
	}

	async function remove(item: WatchlistItem) {
		busy = new Set(busy).add(item.id);
		await removeItem(item.id);
		if (activeItem?.id === item.id) activeItem = null;
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

<!-- dismiss active thumb detail on backdrop click -->
<svelte:document onclick={(e) => {
	if (activeItem && !(e.target as Element).closest('[data-thumb]')) activeItem = null;
}} />

<div class="space-y-6">
	<!-- Header -->
	<div class="flex items-center justify-between">
		<h1 class="text-2xl font-bold">My Queue</h1>
		<div class="flex items-center gap-2">
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

	<!-- Toolbar -->
	{#if loaded && items.length > 0}
		<div class="flex flex-wrap items-center gap-3">
			<!-- Queue / Watched tabs -->
			<div class="flex gap-1 rounded-lg bg-gray-900 p-1">
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

			<div class="flex-1"></div>

			<!-- Sort -->
			<div class="flex items-center gap-1.5">
				<span class="text-xs text-gray-500">Sort</span>
				<div class="flex gap-0.5 rounded-lg bg-gray-900 p-1">
					{#each ([['added', 'Recent'], ['title', 'A–Z'], ['runtime', 'Runtime']] as const) as [key, label] (key)}
						<button
							class="rounded-md px-3 py-1 text-xs font-medium transition-colors {sortBy === key
								? 'bg-gray-700 text-white'
								: 'text-gray-400 hover:text-white'}"
							onclick={() => (sortBy = key)}
						>
							{label}
						</button>
					{/each}
				</div>
			</div>

			<!-- View toggle -->
			<div class="flex items-center gap-1.5">
				<span class="text-xs text-gray-500">View</span>
				<div class="flex gap-0.5 rounded-lg bg-gray-900 p-1">
					<button
						class="rounded-md px-3 py-1 text-xs font-medium transition-colors {viewMode === 'grid'
							? 'bg-gray-700 text-white'
							: 'text-gray-400 hover:text-white'}"
						onclick={() => (viewMode = 'grid')}
						title="Grid"
					>
						⊞ Grid
					</button>
					<button
						class="rounded-md px-3 py-1 text-xs font-medium transition-colors {viewMode === 'lanes'
							? 'bg-orange-500 text-white'
							: 'text-gray-400 hover:text-white'}"
						onclick={() => (viewMode = 'lanes')}
						title="Swimlanes by provider"
					>
						≡ Lanes
					</button>
				</div>
			</div>
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
	{:else if activeItems.length === 0}
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

	<!-- ── GRID view ───────────────────────────────────────────────────────── -->
	{:else if viewMode === 'grid'}
		<div class="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
			{#each flatItems as item (item.id)}
				<div class="flex flex-col overflow-hidden rounded-xl bg-gray-900">
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

	<!-- ── LANES view ──────────────────────────────────────────────────────── -->
	{:else}
		<div class="space-y-1">
			{#each lanes as lane (lane.key)}
				<div class="flex items-stretch gap-0 rounded-xl bg-gray-900/60 overflow-hidden">

					<!-- Lane header: fixed left column -->
					<div class="flex w-36 shrink-0 flex-col items-center justify-center gap-1.5 border-r border-gray-800 px-3 py-4 text-center">
						{#if lane.logo}
							<img
								src="{TMDB_IMG}/w92{lane.logo}"
								alt={lane.label}
								class="h-9 w-9 rounded-lg object-cover"
							/>
						{:else}
							<div class="flex h-9 w-9 items-center justify-center rounded-lg bg-gray-800 text-lg">
								📺
							</div>
						{/if}
						<p class="text-xs font-semibold leading-tight text-gray-200">{lane.label}</p>
						<p class="text-xs text-gray-600">{lane.items.length} title{lane.items.length === 1 ? '' : 's'}</p>
					</div>

					<!-- Scrollable ribbon -->
					<div class="flex gap-2 overflow-x-auto p-3 scrollbar-thin" style="scrollbar-color: #374151 transparent;">
						{#each lane.items as item (item.id)}
							<!-- Thumbnail wrapper -->
							<div class="relative shrink-0" data-thumb>
								<!-- Poster thumbnail -->
								<button
									class="group relative block h-24 w-16 overflow-hidden rounded-lg bg-gray-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500"
									onclick={(e) => {
										e.stopPropagation();
										activeItem = activeItem?.id === item.id ? null : item;
									}}
									title={item.title}
								>
									{#if item.poster_path}
										<img
											src="{TMDB_IMG}/w185{item.poster_path}"
											alt={item.title}
											class="h-full w-full object-cover transition-transform duration-200 group-hover:scale-105"
										/>
									{:else}
										<div class="flex h-full w-full items-center justify-center text-2xl text-gray-600">
											🎬
										</div>
									{/if}

									<!-- Runtime badge bottom-left -->
									{#if item.runtime_minutes}
										<span class="absolute bottom-1 left-1 rounded bg-black/70 px-1 py-0.5 text-[9px] leading-none text-gray-300">
											{formatRuntime(item.runtime_minutes, item.media_type)}
										</span>
									{/if}

									<!-- Type badge top-right -->
									<span class="absolute right-1 top-1 rounded bg-black/60 px-1 py-0.5 text-[9px] font-semibold uppercase leading-none text-gray-300">
										{item.media_type === 'movie' ? 'F' : 'TV'}
									</span>

									<!-- Hover dim -->
									<div class="absolute inset-0 bg-black/0 transition-colors group-hover:bg-black/20"></div>
								</button>

								<!-- Title label below poster -->
								<p class="mt-1 w-16 truncate text-center text-[10px] leading-tight text-gray-400">
									{item.title}
								</p>

								<!-- Pop-up detail card (anchored to thumbnail) -->
								{#if activeItem?.id === item.id}
									<div
										class="absolute bottom-full left-1/2 z-30 mb-2 w-52 -translate-x-1/2 rounded-xl bg-gray-800 p-3 shadow-2xl ring-1 ring-gray-700"
										data-thumb
									>
										<!-- Arrow -->
										<div class="absolute -bottom-1.5 left-1/2 h-3 w-3 -translate-x-1/2 rotate-45 bg-gray-800 ring-1 ring-gray-700"></div>

										<p class="mb-1 text-sm font-semibold leading-snug">{item.title}</p>

										{#if item.runtime_minutes}
											<p class="mb-2 text-xs text-gray-400">
												🕐 {formatRuntime(item.runtime_minutes, item.media_type)}
											</p>
										{/if}

										{#if item.overview}
											<p class="mb-2 line-clamp-3 text-xs text-gray-500">{item.overview}</p>
										{/if}

										{#if item.providers.length > 0}
											<div class="mb-2 flex flex-wrap gap-1">
												{#each item.providers as p (p.provider_id)}
													<img
														src="{TMDB_IMG}/w92{p.logo_path}"
														alt={p.provider_name}
														title={p.provider_name}
														class="h-5 w-5 rounded"
													/>
												{/each}
											</div>
										{/if}

										<div class="flex gap-1.5">
											<button
												class="flex-1 rounded-md bg-gray-700 py-1.5 text-xs font-medium transition-colors hover:bg-gray-600 disabled:opacity-40"
												disabled={busy.has(item.id)}
												onclick={() => toggle(item)}
											>
												{item.watched_at ? 'Unwatch' : '✓ Watched'}
											</button>
											<button
												class="rounded-md bg-gray-700 px-2.5 py-1.5 text-xs text-gray-400 transition-colors hover:bg-red-900/50 hover:text-red-400 disabled:opacity-40"
												disabled={busy.has(item.id)}
												onclick={() => remove(item)}
												aria-label="Remove"
											>
												✕
											</button>
										</div>
									</div>
								{/if}
							</div>
						{/each}
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
