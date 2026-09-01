<script lang="ts">
	import { onMount } from 'svelte';
	import type { PageData } from './$types';
	import type { SearchResult } from '$lib/types';
	import type { SearchSuggestion } from '../api/search-suggestions/+server';
	import { SvelteSet, SvelteMap } from 'svelte/reactivity';
	import { TMDB_IMG, formatRuntime } from '$lib/tmdb';
	import { releaseChip, DEFAULT_BUDGET_HOURS } from '$lib/progress';
	import { page, navigating } from '$app/state';
	import { invalidateAll } from '$app/navigation';
	import { getAll } from '$lib/db';
	import { listCollections } from '$lib/queue-actions';
	import { getQueueColors, getOrAssignSharedListColor } from '$lib/queue-colors';
	import {
		listCollections as listSharedCollections,
		type SharedCollection
	} from '$lib/collection-actions';
	import { isSyncEnabled } from '$lib/sync';
	import ImportPanel from '$lib/components/ImportPanel.svelte';
	import DetailPanel from '$lib/components/DetailPanel.svelte';
	import NavHint from '$lib/components/NavHint.svelte';
	import AddToListButton from '$lib/components/AddToListButton.svelte';
	import Button from '$lib/components/Button.svelte';
	import { addSearchResultToQueue, addSearchResultToList } from '$lib/add-actions';

	let isOnboarding = $derived(page.url.searchParams.has('onboarding'));

	let { data }: { data: PageData } = $props();

	// The search form submits as a GET navigation (new ?q= triggers the server load) — the
	// only navigation that normally fires while sitting on this page is that search itself.
	let searching = $derived(!!navigating.to);

	let query = $state(page.url.searchParams.get('q') ?? '');

	// ── Live suggestions dropdown (#63) ──────────────────────────────────────
	let formEl: HTMLFormElement | undefined = $state();
	let suggestions: SearchSuggestion[] = $state([]);
	let showSuggestions = $state(false);
	let suggestAbort: AbortController | null = null;
	let suggestTimer: ReturnType<typeof setTimeout> | undefined;
	const SUGGEST_DEBOUNCE_MS = 300;

	function handleQueryInput() {
		clearTimeout(suggestTimer);
		const q = query.trim();
		if (!q) {
			showSuggestions = false;
			suggestions = [];
			return;
		}
		suggestTimer = setTimeout(() => fetchSuggestions(q), SUGGEST_DEBOUNCE_MS);
	}

	async function fetchSuggestions(q: string) {
		// Cancel any still-in-flight request so a slow earlier response can't
		// land after a newer one and clobber it with stale results.
		suggestAbort?.abort();
		const controller = new AbortController();
		suggestAbort = controller;
		try {
			const res = await fetch(`/api/search-suggestions?q=${encodeURIComponent(q)}`, {
				signal: controller.signal
			});
			if (!res.ok || controller.signal.aborted) return;
			const results = (await res.json()) as SearchSuggestion[];
			if (controller.signal.aborted) return;
			suggestions = results;
			showSuggestions = results.length > 0;
		} catch {
			// Aborted, or a network hiccup on a suggestions call — not worth surfacing as an error.
		}
	}

	function selectSuggestion(s: SearchSuggestion) {
		query = s.title;
		showSuggestions = false;
		formEl?.requestSubmit();
	}

	let adding = new SvelteSet<number>();
	let added = new SvelteSet<number>();
	let errors = new SvelteMap<number, string>();
	let detailItem: SearchResult | null = $state(null);

	// DetailPanel's runtime lollipop is relative to the monthly budget, same as
	// the queue page — read once rather than making this page track budget state.
	let budgetHours = $state(DEFAULT_BUDGET_HOURS);
	try {
		budgetHours = JSON.parse(localStorage.getItem('sq:budget') ?? String(DEFAULT_BUDGET_HOURS));
	} catch {
		// Best-effort localStorage read; app uses default budget if read fails
	}

	// Populates the "Add To" popover's Lists/Shared sections — loaded once on
	// mount rather than per-card, since every card offers the same targets.
	let existingCollections: string[] = $state([]);
	let queueColors: Record<string, string> = $state({});
	let sharedCollections: SharedCollection[] = $state([]);
	let sharedListColors: Record<string, string> = $state({});

	onMount(() => {
		queueColors = getQueueColors();
		getAll().then((items) => {
			existingCollections = listCollections(items, Object.keys(queueColors));
		});
		isSyncEnabled().then((enabled) => {
			if (!enabled) return;
			listSharedCollections({ setBusy: () => {}, setError: () => {} }).then((colls) => {
				sharedCollections = colls;
				const colors: Record<string, string> = {};
				for (const c of colls) colors[c.id] = getOrAssignSharedListColor(c.id);
				sharedListColors = colors;
			});
		});
	});

	function addDeps(): Parameters<typeof addSearchResultToQueue>[1] {
		return {
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
		};
	}

	async function addToQueue(result: SearchResult) {
		await addSearchResultToQueue(result, addDeps());
	}

	async function addToList(
		result: SearchResult,
		target: Parameters<typeof addSearchResultToList>[1]
	) {
		await addSearchResultToList(result, target, addDeps());
	}
</script>

<svelte:head>
	<title>Queuest — Add</title>
</svelte:head>

<NavHint show={added.size > 0} />

<h1 class="sr-only">Add</h1>

<div class="space-y-5 xs:space-y-8">
	<div class="space-y-2">
		<h2 class="section-heading">Search</h2>
		{#if isOnboarding}
			<p class="text-xs text-gray-500 dark:text-gray-400">
				Already have a watchlist elsewhere? Expand <strong>Import</strong> below to add titles from Letterboxd,
				IMDb, or a backup instead of one by one.
			</p>
		{/if}
	</div>

	<form
		bind:this={formEl}
		action="/search"
		method="GET"
		class="flex gap-2"
		onsubmit={() => {
			clearTimeout(suggestTimer);
			showSuggestions = false;
		}}
	>
		<div class="relative flex-1">
			<input
				name="q"
				type="search"
				bind:value={query}
				oninput={handleQueryInput}
				onfocus={() => (showSuggestions = suggestions.length > 0)}
				onblur={() => {
					// Delay so a click on a suggestion (a blur-triggering mousedown)
					// still registers before the dropdown disappears out from under it.
					setTimeout(() => (showSuggestions = false), 150);
				}}
				placeholder="Search movies and TV shows…"
				autocomplete="off"
				role="combobox"
				aria-expanded={showSuggestions}
				aria-controls="search-suggestions"
				class="w-full rounded-lg bg-gray-100 px-4 py-2.5 pr-9 text-base sm:text-sm text-gray-900 placeholder-gray-400 outline-none ring-1 ring-gray-300 transition-shadow focus:ring-orange-500 [&::-webkit-search-cancel-button]:hidden dark:bg-gray-900 dark:text-gray-100 dark:placeholder-gray-500 dark:ring-gray-800 dark:focus:ring-orange-500"
			/>
			{#if query}
				<button
					type="button"
					aria-label="Clear search"
					onclick={() => {
						query = '';
						suggestions = [];
						showSuggestions = false;
					}}
					class="absolute inset-y-0 right-0 flex w-9 items-center justify-center text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
				>
					<svg class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
						<path
							d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z"
						/>
					</svg>
				</button>
			{/if}
			{#if showSuggestions}
				<div
					id="search-suggestions"
					role="listbox"
					class="absolute top-full left-0 z-20 mt-1 w-full overflow-hidden rounded-lg bg-white shadow-lg ring-1 ring-gray-200 dark:bg-gray-900 dark:ring-gray-700"
				>
					{#each suggestions as s (s.id)}
						<button
							type="button"
							role="option"
							aria-selected="false"
							onclick={() => selectSuggestion(s)}
							class="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-800"
						>
							{#if s.poster_path}
								<img
									src="{TMDB_IMG}/w92{s.poster_path}"
									alt=""
									class="h-9 w-6 shrink-0 rounded object-cover"
								/>
							{:else}
								<div
									class="flex h-9 w-6 shrink-0 items-center justify-center rounded bg-gray-200 text-xs dark:bg-gray-800"
								>
									{s.media_type === 'movie' ? '🎬' : '📺'}
								</div>
							{/if}
							<span class="min-w-0 flex-1 truncate text-gray-900 dark:text-gray-100">{s.title}</span
							>
							{#if s.year}
								<span class="shrink-0 text-xs text-gray-400 dark:text-gray-500">{s.year}</span>
							{/if}
						</button>
					{/each}
				</div>
			{/if}
		</div>
		<Button type="submit" class="px-5 py-2.5 text-sm">Search</Button>
	</form>

	{#snippet resultCard(result: SearchResult)}
		<div
			class="flex flex-col rounded-xl bg-white ring-1 ring-gray-200 dark:bg-gray-900 dark:ring-0"
		>
			<!-- Poster (clickable) -->
			<button
				class="relative aspect-[2/3] w-full cursor-pointer overflow-hidden rounded-t-xl bg-gray-200 dark:bg-gray-800"
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

				<div class="mt-auto">
					<AddToListButton
						busy={adding.has(result.id)}
						done={added.has(result.id)}
						{existingCollections}
						{queueColors}
						{sharedCollections}
						{sharedListColors}
						onAddToQueue={() => addToQueue(result)}
						onAddToList={(target) => addToList(result, target)}
					/>
				</div>
				{#if errors.has(result.id)}
					<p class="text-[10px] text-red-500">{errors.get(result.id)}</p>
				{/if}
			</div>
		</div>
	{/snippet}

	{#if searching}
		<div class="grid grid-cols-2 gap-3 sm:gap-4 sm:grid-cols-3 md:grid-cols-4">
			{#each { length: 8 } as _, i (i)}
				<div class="aspect-[2/3] animate-pulse rounded-xl bg-gray-200 dark:bg-gray-800"></div>
			{/each}
		</div>
	{:else if data.results.length > 0 || data.person}
		<!-- Cast/crew match (#62) — shown first: typing a person's name reads as
		     "find things they're in", so that's the more useful interpretation to
		     lead with. Only labeled when both sections are present, to keep the
		     common title-only-match case looking exactly as it did before. -->
		{#if data.person}
			<div class="space-y-2">
				{#if data.results.length > 0}
					<h2 class="section-heading">
						Titles with {data.person.name}
					</h2>
				{/if}
				<div class="grid grid-cols-2 gap-3 sm:gap-4 sm:grid-cols-3 md:grid-cols-4">
					{#each data.person.results as result (result.id)}
						{@render resultCard(result)}
					{/each}
				</div>
			</div>
		{/if}
		{#if data.results.length > 0}
			{#if data.person}
				<h2 class="section-heading">Search results</h2>
			{/if}
			<div class="grid grid-cols-2 gap-3 sm:gap-4 sm:grid-cols-3 md:grid-cols-4">
				{#each data.results as result (result.id)}
					{@render resultCard(result)}
				{/each}
			</div>
		{/if}
	{:else if data.error}
		<div class="py-12 text-center xs:py-20">
			<p class="mb-3 text-4xl xs:mb-4 xs:text-5xl">⚠️</p>
			<p class="text-base text-gray-700 dark:text-gray-300 xs:text-lg">{data.error}</p>
			<Button onclick={() => invalidateAll()} class="mt-3 px-4 py-2 text-sm">Retry</Button>
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
				Import from list or Queuest Backup
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
			<ImportPanel {existingCollections} {queueColors} {sharedCollections} {sharedListColors} />
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
