<script lang="ts">
	import type { PageData } from './$types';
	import type { SearchResult } from '$lib/types';
	import { TMDB_IMG, formatRuntime } from '$lib/tmdb';
	import { page } from '$app/state';

	let { data }: { data: PageData } = $props();

	let query = $state(page.url.searchParams.get('q') ?? '');
	let adding = $state(new Set<number>());
	let added = $state(new Set<number>());

	async function addToQueue(result: SearchResult) {
		adding = new Set(adding).add(result.id);

		await fetch('/api/watchlist', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				tmdb_id: result.id,
				media_type: result.media_type,
				title: result.title,
				poster_path: result.poster_path,
				overview: result.overview
			})
		});

		const nextAdding = new Set(adding);
		nextAdding.delete(result.id);
		adding = nextAdding;
		added = new Set(added).add(result.id);
	}
</script>

<svelte:head>
	<title>StreamQ — Search</title>
</svelte:head>

<div class="space-y-8">
	<h1 class="text-2xl font-bold">Search</h1>

	<form action="/search" method="GET" class="flex gap-2">
		<!-- svelte-ignore a11y_autofocus -->
		<input
			name="q"
			type="search"
			bind:value={query}
			placeholder="Search movies and TV shows…"
			class="flex-1 rounded-lg bg-gray-900 px-4 py-2.5 text-sm placeholder-gray-500 outline-none ring-1 ring-gray-800 transition-shadow focus:ring-orange-500"
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
		<div class="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
			{#each data.results as result (result.id)}
				<div class="flex flex-col overflow-hidden rounded-xl bg-gray-900">
					<!-- Poster -->
					<div class="relative aspect-[2/3] bg-gray-800">
						{#if result.poster_path}
							<img
								src="{TMDB_IMG}/w300{result.poster_path}"
								alt={result.title}
								class="h-full w-full object-cover"
							/>
						{:else}
							<div
								class="flex h-full w-full items-center justify-center text-5xl text-gray-700"
							>
								🎬
							</div>
						{/if}
						<span
							class="absolute left-2 top-2 rounded bg-black/60 px-1.5 py-0.5 text-xs font-medium uppercase tracking-wide text-gray-300"
						>
							{result.media_type === 'movie' ? 'Film' : 'TV'}
						</span>
						{#if result.year}
							<span
								class="absolute right-2 top-2 rounded bg-black/60 px-1.5 py-0.5 text-xs text-gray-300"
							>
								{result.year}
							</span>
						{/if}
					</div>

					<!-- Info -->
					<div class="flex flex-1 flex-col gap-2 p-3">
						<p class="line-clamp-2 text-sm font-medium leading-tight">{result.title}</p>

						<!-- Runtime -->
						{#if result.runtime_minutes}
							<p class="text-xs text-gray-500">
								🕐 {formatRuntime(result.runtime_minutes, result.media_type)}
							</p>
						{/if}

						<!-- Providers -->
						{#if result.providers.length > 0}
							<div class="flex flex-wrap items-center gap-1">
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
							</div>
						{:else}
							<p class="text-xs text-gray-600">Not on streaming</p>
						{/if}

						<button
							class="mt-auto w-full rounded-md py-1.5 text-xs font-medium transition-colors disabled:opacity-50
								{added.has(result.id)
								? 'bg-teal-900/50 text-teal-400'
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
		<div class="py-20 text-center text-gray-500">
			<p class="text-lg">No results for "{data.query}"</p>
			<p class="mt-1 text-sm">Try a different search term</p>
		</div>
	{:else}
		<div class="py-20 text-center text-gray-600">
			<p class="mb-4 text-5xl">🔍</p>
			<p>Search for movies and TV shows to add to your queue</p>
		</div>
	{/if}
</div>
