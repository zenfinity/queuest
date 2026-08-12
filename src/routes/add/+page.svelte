<script lang="ts">
	import type { PageData } from './$types';
	import type { SearchResult } from '$lib/types';
	import { SvelteSet, SvelteMap } from 'svelte/reactivity';
	import { TMDB_IMG, formatRuntime } from '$lib/tmdb';
	import { releaseChip } from '$lib/progress';
	import { page, navigating } from '$app/state';
	import { invalidateAll } from '$app/navigation';
	import ImportPanel from '$lib/components/ImportPanel.svelte';
	import DetailPanel from '$lib/components/DetailPanel.svelte';
	import { addSearchResultToQueue } from '$lib/add-actions';

	let isOnboarding = $derived(page.url.searchParams.has('onboarding'));

	let { data }: { data: PageData } = $props();

	// The search form submits as a GET navigation (new ?q= triggers the server load) — the
	// only navigation that normally fires while sitting on this page is that search itself.
	let searching = $derived(!!navigating.to);

	let query = $state(page.url.searchParams.get('q') ?? '');
	let adding = new SvelteSet<number>();
	let added = new SvelteSet<number>();
	let errors = new SvelteMap<number, string>();
	let detailItem: SearchResult | null = $state(null);

	// DetailPanel's runtime lollipop is relative to the monthly budget, same as
	// the queue page — read once rather than making this page track budget state.
	let budgetHours = $state(40);
	try {
		budgetHours = JSON.parse(localStorage.getItem('sq:budget') ?? '40');
	} catch {
		// Best-effort localStorage read; app uses default budget if read fails
	}

	async function addToQueue(result: SearchResult) {
		await addSearchResultToQueue(result, {
			setAdding: (id, isAdding) => {
				if (isAdding) adding.add(id);
				else adding.delete(id);
			},
			setAdded: (id, isAdded) => {
				if (isAdded) added.add(id);
				else added.delete(id);
			},
			setError: (id, message) => {
				if (message) errors.set(id, message);
				else errors.delete(id);
			}
		});
	}
</script>

<svelte:head>
	<title>Queuest — Add</title>
</svelte:head>

<div class="space-y-5 xs:space-y-8">
	<div class="space-y-2">
		<h2 class="text-sm font-semibold uppercase tracking-widest text-gray-500">Search</h2>
		{#if isOnboarding}
			<p class="text-xs text-gray-500 dark:text-gray-400">
				Already have a watchlist elsewhere? Expand <strong>Import</strong> below to add titles from Letterboxd,
				IMDb, or a backup instead of one by one.
			</p>
		{/if}
	</div>

	<form action="/search" method="GET" class="flex gap-2">
		<!-- svelte-ignore a11y_autofocus -->
		<input
			name="q"
			type="search"
			bind:value={query}
			placeholder="Search movies and TV shows…"
			class="flex-1 rounded-lg bg-gray-100 px-4 py-2.5 text-base sm:text-sm text-gray-900 placeholder-gray-400 outline-none ring-1 ring-gray-300 transition-shadow focus:ring-orange-500 dark:bg-gray-900 dark:text-gray-100 dark:placeholder-gray-500 dark:ring-gray-800 dark:focus:ring-orange-500"
			autofocus
		/>
		<button
			type="submit"
			class="rounded-lg bg-orange-500 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-orange-400"
		>
			Search
		</button>
	</form>

	{#if searching}
		<div class="grid grid-cols-2 gap-3 sm:gap-4 sm:grid-cols-3 md:grid-cols-4">
			{#each { length: 8 } as _, i (i)}
				<div class="aspect-[2/3] animate-pulse rounded-xl bg-gray-200 dark:bg-gray-800"></div>
			{/each}
		</div>
	{:else if data.results.length > 0}
		<div class="grid grid-cols-2 gap-3 sm:gap-4 sm:grid-cols-3 md:grid-cols-4">
			{#each data.results as result (result.id)}
				<div
					class="flex flex-col overflow-hidden rounded-xl bg-white ring-1 ring-gray-200 dark:bg-gray-900 dark:ring-0"
				>
					<!-- Poster (clickable) -->
					<button
						class="relative aspect-[2/3] overflow-hidden bg-gray-200 dark:bg-gray-800 w-full cursor-pointer"
						onclick={() => (detailItem = result)}
						data-detail-trigger
						aria-label="View details for {result.title}"
					>
						{#if result.poster_path}
							<img
								src="{TMDB_IMG}/w300{result.poster_path}"
								alt={result.title}
								class="h-full w-full object-cover"
							/>
						{:else}
							<div
								class="flex h-full w-full items-center justify-center text-5xl text-gray-400 dark:text-gray-700"
							>
								🎬
							</div>
						{/if}
						{#if result.year}
							<span
								class="absolute right-2 top-2 rounded bg-black/60 px-1.5 py-0.5 text-xs text-gray-200"
							>
								{result.year}
							</span>
						{/if}
					</button>

					<!-- Info -->
					<div class="flex flex-1 flex-col gap-2 p-2.5 sm:p-3">
						<p class="line-clamp-2 text-sm font-medium leading-tight">{result.title}</p>

						<!-- Runtime -->
						{#if result.runtime_minutes}
							<p class="text-xs text-gray-500">
								🕐 {formatRuntime(result.runtime_minutes, result.media_type)}
							</p>
						{/if}

						<!-- Type chip + providers -->
						<div class="flex flex-wrap items-center gap-1">
							<span class="rounded bg-gray-100 px-1 py-0.5 text-[11px] dark:bg-gray-800">
								{result.media_type === 'movie' ? '🎬' : '📺'}
							</span>
							{#each result.providers.slice(0, 4) as p (p.provider_id)}
								<img
									src="{TMDB_IMG}/w92{p.logo_path}"
									alt={p.provider_name}
									title={p.provider_name}
									class="h-5 w-5 rounded"
								/>
							{/each}
							{#if result.providers.length > 4}
								<span class="text-xs text-gray-500">+{result.providers.length - 4}</span>
							{/if}
							{#if !result.providers.length}
								{#if result.rentable}
									<span class="text-xs text-gray-400 dark:text-gray-500">💲 Rent/Buy</span>
								{:else}
									<span class="text-xs text-gray-400 dark:text-gray-600">🚫 Not streaming</span>
								{/if}
							{/if}
						</div>

						<!-- Release chip -->
						{#if releaseChip(result.release)}
							<p class="text-xs leading-snug text-amber-600 dark:text-amber-400">
								{releaseChip(result.release)}
							</p>
						{/if}

						<button
							class="mt-auto w-full rounded-md py-1.5 text-xs font-medium transition-colors disabled:opacity-50
								{added.has(result.id)
								? 'bg-teal-100 text-teal-700 dark:bg-teal-900/50 dark:text-teal-400'
								: 'bg-orange-500 text-white hover:bg-orange-400'}"
							disabled={adding.has(result.id) || added.has(result.id)}
							onclick={() => addToQueue(result)}
						>
							{#if adding.has(result.id)}
								Adding…
							{:else if added.has(result.id)}
								✓ Added
							{:else}
								+ Add to Queue
							{/if}
						</button>
					</div>
				</div>
			{/each}
		</div>
	{:else if data.error}
		<div class="py-12 text-center xs:py-20">
			<p class="mb-3 text-4xl xs:mb-4 xs:text-5xl">⚠️</p>
			<p class="text-base text-gray-700 dark:text-gray-300 xs:text-lg">{data.error}</p>
			<button
				onclick={() => invalidateAll()}
				class="mt-3 rounded-lg bg-orange-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-orange-400"
				>Retry</button
			>
		</div>
	{:else if data.query}
		<div class="py-12 text-center text-gray-500 xs:py-20">
			<p class="text-base xs:text-lg">No results for "{data.query}"</p>
			<p class="mt-1 text-sm">Try a different search term</p>
		</div>
	{:else}
		<div class="py-12 text-center text-gray-400 xs:py-20 dark:text-gray-600">
			<p class="mb-3 text-4xl xs:mb-4 xs:text-5xl">🔍</p>
			<p class="text-sm xs:text-base">Search for movies and TV shows to add to your queue</p>
		</div>
	{/if}

	<!-- Import (collapsible) -->
	<details class="group rounded-lg border border-gray-200 dark:border-gray-800">
		<summary
			class="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-medium text-gray-700 dark:text-gray-300"
		>
			<span class="flex items-center gap-2">
				<svg
					viewBox="0 0 20 20"
					fill="currentColor"
					class="h-3.5 w-3.5 shrink-0 text-gray-400"
					aria-hidden="true"
				>
					<path
						fill-rule="evenodd"
						d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm6.707-10.707a1 1 0 011.414 0l3 3a1 1 0 01-1.414 1.414L11 9.414V16a1 1 0 11-2 0V9.414L7.707 10.707a1 1 0 01-1.414-1.414l3-3z"
						clip-rule="evenodd"
					/>
				</svg>
				Import from Letterboxd, IMDb, or a backup
			</span>
			<svg
				class="h-4 w-4 shrink-0 text-gray-400 transition-transform group-open:rotate-180"
				viewBox="0 0 20 20"
				fill="currentColor"
				aria-hidden="true"
			>
				<path
					fill-rule="evenodd"
					d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
					clip-rule="evenodd"
				/>
			</svg>
		</summary>
		<div class="border-t border-gray-200 px-4 py-4 dark:border-gray-800">
			<ImportPanel />
		</div>
	</details>
</div>

<!-- ── Detail panel ───────────────────────────────────────────────────────── -->
{#if detailItem}
	{@const di = detailItem}
	<DetailPanel item={di} {budgetHours} showSeasons={false} onClose={() => (detailItem = null)}>
		{#snippet footer(item)}
			<div class="w-full">
				<button
					class="w-full rounded-lg py-2.5 text-sm font-medium transition-colors disabled:opacity-50
						{added.has(item.id)
						? 'bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-400'
						: 'bg-orange-500 text-white hover:bg-orange-400'}"
					disabled={adding.has(item.id) || added.has(item.id)}
					onclick={() => addToQueue(di)}
				>
					{#if adding.has(item.id)}
						Adding…
					{:else if added.has(item.id)}
						✓ Added to Queue
					{:else}
						+ Add to Queue
					{/if}
				</button>
				{#if errors.has(item.id)}
					<p class="mt-1.5 text-center text-xs text-red-500">{errors.get(item.id)}</p>
				{/if}
			</div>
		{/snippet}
	</DetailPanel>
{/if}
