<script lang="ts">
	import type { PageData } from './$types';
	import type { SearchResult } from '$lib/types';
	import { TMDB_IMG, formatRuntime } from '$lib/tmdb';
	import { addItem } from '$lib/db';
	import { releaseChip } from '$lib/progress';
	import { page } from '$app/state';
	import ImportPanel from '$lib/components/ImportPanel.svelte';

	let { data }: { data: PageData } = $props();

	let query = $state(page.url.searchParams.get('q') ?? '');
	let adding = $state(new Set<number>());
	let added = $state(new Set<number>());
	let errors = $state(new Map<number, string>());
	let detailItem: SearchResult | null = $state(null);
	let overviewExpanded = $state(false);
	let posterExpanded = $state(false);

	async function addToQueue(result: SearchResult) {
		adding = new Set(adding).add(result.id);
		const nextErrors = new Map(errors);
		nextErrors.delete(result.id);
		errors = nextErrors;

		try {
			await addItem({
				tmdb_id: result.id,
				media_type: result.media_type,
				title: result.title,
				poster_path: result.poster_path,
				overview: result.overview,
				providers: result.providers,
				rentable: result.rentable,
				runtime_minutes: result.runtime_minutes,
				seasons: result.seasons,
				watched_seasons: [],
				current_season: null,
				current_episode: null,
				release: result.release,
				backdrop_path: result.backdrop_path,
				genres: result.genres,
				cast: result.cast,
				director: result.director,
				creator: result.creator
			});
			added = new Set(added).add(result.id);
		} catch (e) {
			if (e instanceof DOMException && e.name === 'ConstraintError') {
				added = new Set(added).add(result.id);
			} else {
				const msg = e instanceof Error ? e.message : 'Failed to add';
				errors = new Map(errors).set(result.id, msg);
			}
		} finally {
			const nextAdding = new Set(adding);
			nextAdding.delete(result.id);
			adding = nextAdding;
		}
	}
</script>

<svelte:document onclick={(e) => {
	const t = e.target as HTMLElement;
	if (!t.closest('[data-detail-panel]') && !t.closest('[data-detail-trigger]')) {
		detailItem = null; overviewExpanded = false; posterExpanded = false;
	}
}} />

<svelte:head>
	<title>Queuest — Add</title>
</svelte:head>

<div class="space-y-5 xs:space-y-8">
	<h2 class="text-sm font-semibold uppercase tracking-widest text-gray-500">Search</h2>

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

	{#if data.results.length > 0}
		<div class="grid grid-cols-2 gap-3 sm:gap-4 sm:grid-cols-3 md:grid-cols-4">
			{#each data.results as result (result.id)}
				<div class="flex flex-col overflow-hidden rounded-xl bg-white ring-1 ring-gray-200 dark:bg-gray-900 dark:ring-0">
					<!-- Poster (clickable) -->
					<!-- svelte-ignore a11y_consider_explicit_label -->
					<button
						class="relative aspect-[2/3] overflow-hidden bg-gray-200 dark:bg-gray-800 w-full cursor-pointer"
						onclick={() => { detailItem = result; overviewExpanded = false; }}
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
							<div class="flex h-full w-full items-center justify-center text-5xl text-gray-400 dark:text-gray-700">
								🎬
							</div>
						{/if}
						{#if result.year}
							<span class="absolute right-2 top-2 rounded bg-black/60 px-1.5 py-0.5 text-xs text-gray-200">
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
							<p class="text-xs leading-snug text-amber-600 dark:text-amber-400">{releaseChip(result.release)}</p>
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
		<summary class="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-medium text-gray-700 dark:text-gray-300">
			<span class="flex items-center gap-2">
				<svg viewBox="0 0 20 20" fill="currentColor" class="h-3.5 w-3.5 shrink-0 text-gray-400" aria-hidden="true">
					<path fill-rule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm6.707-10.707a1 1 0 011.414 0l3 3a1 1 0 01-1.414 1.414L11 9.414V16a1 1 0 11-2 0V9.414L7.707 10.707a1 1 0 01-1.414-1.414l3-3z" clip-rule="evenodd"/>
				</svg>
				Import from Letterboxd, IMDb, or a backup
			</span>
			<svg class="h-4 w-4 shrink-0 text-gray-400 transition-transform group-open:rotate-180" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
				<path fill-rule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clip-rule="evenodd" />
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
	<!-- Scrim -->
	<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
	<div
		class="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
		onclick={() => { detailItem = null; overviewExpanded = false; posterExpanded = false; }}
	></div>

	<!-- Panel: bottom sheet on mobile, right drawer on sm+ -->
	<div
		class="fixed bottom-0 inset-x-0 z-50 flex max-h-[90vh] flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl dark:bg-gray-900 sm:inset-y-0 sm:right-0 sm:left-auto sm:w-[22rem] sm:max-h-none sm:rounded-t-none sm:rounded-l-2xl"
		data-detail-panel
	>
		<!-- Title bar -->
		<div class="shrink-0 flex items-center justify-between border-b border-gray-100 px-4 py-3 dark:border-gray-800">
			<h2 class="truncate pr-2 text-sm font-semibold text-gray-900 dark:text-white">{di.title}</h2>
			<button
				onclick={() => { detailItem = null; overviewExpanded = false; posterExpanded = false; }}
				class="shrink-0 rounded-full p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
				aria-label="Close"
			>
				<svg class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor"><path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z"/></svg>
			</button>
		</div>

		<!-- Scrollable content -->
		<div class="flex-1 overflow-y-auto">
			<!-- Hero: poster + meta -->
			<div class="flex gap-3 px-4 pt-4 pb-3">
				{#if di.poster_path}
					<button
						class="w-20 shrink-0 self-start rounded-lg shadow-md overflow-hidden cursor-zoom-in"
						onclick={() => posterExpanded = true}
						aria-label="Expand poster"
					>
						<img src="{TMDB_IMG}/w185{di.poster_path}" alt={di.title} class="w-full h-full object-cover" />
					</button>
				{/if}
				<div class="min-w-0">
					<div class="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-gray-500 dark:text-gray-400">
						{#if di.year}<span>{di.year}</span>{/if}
						<span class="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium dark:bg-gray-800">{di.media_type === 'movie' ? '🎬 Movie' : '📺 TV'}</span>
						{#if di.director}<span>Dir. {di.director}</span>{/if}
						{#if di.creator}<span>Created by {di.creator}</span>{/if}
					</div>
					{#if di.genres?.length}
						<div class="mt-1.5 flex flex-wrap gap-1">
							{#each di.genres as g (g)}
								<span class="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] text-gray-500 dark:bg-gray-800 dark:text-gray-400">{g}</span>
							{/each}
						</div>
					{/if}
				</div>
			</div>

			<div class="space-y-4 px-4 pb-4">
				<!-- Overview -->
				{#if di.overview}
					<div>
						<p class="text-xs leading-relaxed text-gray-600 dark:text-gray-400
							{overviewExpanded ? '' : 'line-clamp-4'}">{di.overview}</p>
						{#if di.overview.length > 200}
							<button
								onclick={() => { overviewExpanded = !overviewExpanded; }}
								class="mt-1 text-[10px] font-medium text-orange-500 hover:text-orange-400"
							>{overviewExpanded ? 'Less' : 'More'}</button>
						{/if}
					</div>
				{/if}

				<!-- Runtime -->
				{#if di.runtime_minutes}
					<div class="text-xs text-gray-500 dark:text-gray-400">
						🕐 {formatRuntime(di.runtime_minutes, di.media_type)}
					</div>
				{/if}

				<!-- Cast -->
				{#if di.cast?.length}
					<div>
						<p class="mb-2 text-[10px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">Cast</p>
						<div class="flex gap-2 overflow-x-auto pb-1">
							{#each di.cast as c (c.name)}
								<div class="flex shrink-0 flex-col items-center gap-1 w-14">
									<div class="h-12 w-12 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-800">
										{#if c.profile_path}
											<img src="{TMDB_IMG}/w185{c.profile_path}" alt={c.name} class="h-full w-full object-cover" />
										{:else}
											<div class="flex h-full w-full items-center justify-center text-lg text-gray-400">👤</div>
										{/if}
									</div>
									<p class="text-center text-[9px] font-medium leading-tight text-gray-700 dark:text-gray-300 line-clamp-2">{c.name}</p>
									<p class="text-center text-[9px] leading-tight text-gray-400 dark:text-gray-600 line-clamp-1">{c.character}</p>
								</div>
							{/each}
						</div>
					</div>
				{/if}

				<!-- Where to watch -->
				<div>
					<p class="mb-2 text-[10px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">Where to watch</p>
					{#if di.providers.length}
						<div class="flex flex-wrap gap-2">
							{#each di.providers as p (p.provider_id)}
								<div class="flex items-center gap-1.5">
									<img src="{TMDB_IMG}/w92{p.logo_path}" alt={p.provider_name} class="h-6 w-6 rounded-lg" />
									<span class="text-xs text-gray-600 dark:text-gray-400">{p.provider_name}</span>
								</div>
							{/each}
						</div>
					{:else if di.rentable}
						<p class="text-xs text-gray-500">💲 Available to rent or buy</p>
					{:else}
						<div class="space-y-1">
							<p class="text-xs text-gray-500">🚫 Not on streaming services</p>
							<div class="flex gap-3">
								<a href="https://www.kanopy.com/en/search?query={encodeURIComponent(di.title)}" target="_blank" rel="noopener noreferrer" class="text-xs text-orange-500 hover:text-orange-400">Kanopy →</a>
								<a href="https://www.hoopladigital.com/search?q={encodeURIComponent(di.title)}" target="_blank" rel="noopener noreferrer" class="text-xs text-orange-500 hover:text-orange-400">Hoopla →</a>
							</div>
						</div>
					{/if}
				</div>

				<!-- Release info -->
				{#if releaseChip(di.release)}
					<p class="text-xs text-amber-600 dark:text-amber-400">{releaseChip(di.release)}</p>
				{/if}
			</div>
		</div>

		<!-- Sticky footer: add to queue -->
		<div class="shrink-0 border-t border-gray-100 px-4 py-3 dark:border-gray-800">
			<button
				class="w-full rounded-lg py-2.5 text-sm font-medium transition-colors disabled:opacity-50
					{added.has(di.id)
					? 'bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-400'
					: 'bg-orange-500 text-white hover:bg-orange-400'}"
				disabled={adding.has(di.id) || added.has(di.id)}
				onclick={() => addToQueue(di)}
			>
				{#if adding.has(di.id)}
					Adding…
				{:else if added.has(di.id)}
					✓ Added to Queue
				{:else}
					+ Add to Queue
				{/if}
			</button>
			{#if errors.has(di.id)}
				<p class="mt-1.5 text-center text-xs text-red-500">{errors.get(di.id)}</p>
			{/if}
		</div>
	</div>

	<!-- Poster lightbox -->
	{#if posterExpanded && di.poster_path}
		<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
		<div
			class="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-6 backdrop-blur-sm cursor-zoom-out"
			onclick={() => posterExpanded = false}
		>
			<img
				src="{TMDB_IMG}/w500{di.poster_path}"
				alt={di.title}
				class="max-h-full max-w-full rounded-xl shadow-2xl"
			/>
		</div>
	{/if}
{/if}
