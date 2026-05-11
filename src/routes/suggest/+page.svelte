<script lang="ts">
	import { onMount } from 'svelte';
	import { getAll } from '$lib/db';
	import { TMDB_IMG } from '$lib/tmdb';
	import type { Suggestion } from '$lib/types';

	let suggestions = $state<Suggestion[]>([]);
	let totalUnwatched = $state(0);
	let loaded = $state(false);

	onMount(async () => {
		const items = await getAll();
		const unwatched = items.filter((i) => !i.watched_at);
		totalUnwatched = unwatched.length;

		const counts = new Map<string, Suggestion>();
		for (const item of unwatched) {
			for (const p of item.providers) {
				const existing = counts.get(p.provider_name);
				if (existing) {
					existing.count++;
				} else {
					counts.set(p.provider_name, {
						provider_id: p.provider_id,
						name: p.provider_name,
						logo_path: p.logo_path,
						count: 1
					});
				}
			}
		}

		suggestions = Array.from(counts.values()).sort((a, b) => b.count - a.count);
		loaded = true;
	});

	const topCount = $derived(suggestions[0]?.count ?? 1);
</script>

<svelte:head>
	<title>StreamQ — What to Subscribe</title>
</svelte:head>

<div class="space-y-8">
	<div>
		<h1 class="text-2xl font-bold">What to Subscribe to Next</h1>
		<p class="mt-1 text-sm text-gray-500">
			Based on your {totalUnwatched} unwatched title{totalUnwatched === 1 ? '' : 's'}
		</p>
	</div>

	{#if !loaded}
		<div class="space-y-3">
			{#each { length: 4 } as _, i (i)}
				<div class="h-[72px] animate-pulse rounded-xl bg-gray-200 dark:bg-gray-800"></div>
			{/each}
		</div>
	{:else if suggestions.length === 0}
		<div class="flex flex-col items-center justify-center py-24 text-center">
			<p class="mb-4 text-5xl">📺</p>
			<p class="text-lg font-medium text-gray-700 dark:text-gray-300">No suggestions yet</p>
			<p class="mt-1 text-sm text-gray-500">
				<a class="text-orange-500 hover:underline" href="/search">Add titles to your queue</a>
				to get streaming recommendations
			</p>
		</div>
	{:else}
		<div class="space-y-3">
			{#each suggestions as suggestion, i (suggestion.provider_id)}
				<div class="flex items-center gap-4 rounded-xl bg-white p-4 ring-1 ring-gray-200 dark:bg-gray-900 dark:ring-0">
					<!-- Rank -->
					<div
						class="w-6 text-center text-lg font-bold {i === 0
							? 'text-orange-400'
							: i === 1
								? 'text-gray-400 dark:text-gray-300'
								: i === 2
									? 'text-amber-700'
									: 'text-gray-400 dark:text-gray-600'}"
					>
						{i + 1}
					</div>

					<!-- Logo -->
					<img
						src="{TMDB_IMG}/w92{suggestion.logo_path}"
						alt={suggestion.name}
						class="h-10 w-10 rounded-lg object-cover"
					/>

					<!-- Name + count -->
					<div class="flex-1">
						<p class="font-medium">{suggestion.name}</p>
						<p class="text-sm text-gray-500">
							{suggestion.count}
							{suggestion.count === 1 ? 'title' : 'titles'} in your queue
						</p>
					</div>

					<!-- Bar -->
					<div class="hidden w-36 sm:block">
						<div class="h-2 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-800">
							<div
								class="h-full rounded-full bg-orange-500 transition-all"
								style="width: {Math.round((suggestion.count / topCount) * 100)}%"
							></div>
						</div>
					</div>
				</div>
			{/each}
		</div>

		<p class="text-center text-xs text-gray-400">Streaming data via TMDB / JustWatch · US only</p>
	{/if}
</div>
