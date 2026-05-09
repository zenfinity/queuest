<script lang="ts">
	import type { PageData } from './$types';
	import { TMDB_IMG } from '$lib/tmdb';

	let { data }: { data: PageData } = $props();

	const topCount = $derived(data.suggestions[0]?.count ?? 1);
</script>

<svelte:head>
	<title>StreamQ — What to Subscribe</title>
</svelte:head>

<div class="space-y-8">
	<div>
		<h1 class="text-2xl font-bold">What to Subscribe to Next</h1>
		<p class="mt-1 text-sm text-gray-400">
			Based on your {data.totalUnwatched} unwatched title{data.totalUnwatched === 1 ? '' : 's'}
		</p>
	</div>

	{#if data.suggestions.length === 0}
		<div class="flex flex-col items-center justify-center py-24 text-center">
			<p class="mb-4 text-5xl">📺</p>
			<p class="text-lg font-medium text-gray-300">No suggestions yet</p>
			<p class="mt-1 text-sm text-gray-500">
				<a class="text-orange-400 hover:underline" href="/search">Add titles to your queue</a>
				to get streaming recommendations
			</p>
		</div>
	{:else}
		<div class="space-y-3">
			{#each data.suggestions as suggestion, i (suggestion.provider_id)}
				<div class="flex items-center gap-4 rounded-xl bg-gray-900 p-4">
					<!-- Rank -->
					<div
						class="w-6 text-center text-lg font-bold {i === 0
							? 'text-orange-400'
							: i === 1
								? 'text-gray-300'
								: i === 2
									? 'text-amber-700'
									: 'text-gray-600'}"
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
						<p class="text-sm text-gray-400">
							{suggestion.count}
							{suggestion.count === 1 ? 'title' : 'titles'} in your queue
						</p>
					</div>

					<!-- Bar -->
					<div class="hidden w-36 sm:block">
						<div class="h-2 overflow-hidden rounded-full bg-gray-800">
							<div
								class="h-full rounded-full bg-orange-500 transition-all"
								style="width: {Math.round((suggestion.count / topCount) * 100)}%"
							></div>
						</div>
					</div>
				</div>
			{/each}
		</div>

		<p class="text-center text-xs text-gray-600">
			Streaming data from <a
				class="hover:text-gray-400"
				href="https://www.themoviedb.org/"
				target="_blank"
				rel="noopener noreferrer">TMDB</a
			> / JustWatch · US only
		</p>
	{/if}
</div>
