<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import type { PageData } from './$types';
	import type { WatchlistItem } from '$lib/types';
	import { TMDB_IMG } from '$lib/tmdb';

	let { data }: { data: PageData } = $props();

	let tab = $state<'queue' | 'watched'>('queue');
	let loading = $state(new Set<number>());

	let queued = $derived(data.items.filter((i: WatchlistItem) => !i.watched_at));
	let watched = $derived(data.items.filter((i: WatchlistItem) => i.watched_at));
	let visible = $derived(tab === 'queue' ? queued : watched);

	async function toggleWatched(item: WatchlistItem) {
		loading = new Set(loading).add(item.id);
		await fetch(`/api/watchlist/${item.id}`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ watched: !item.watched_at })
		});
		await invalidateAll();
		const next = new Set(loading);
		next.delete(item.id);
		loading = next;
	}

	async function remove(item: WatchlistItem) {
		loading = new Set(loading).add(item.id);
		await fetch(`/api/watchlist/${item.id}`, { method: 'DELETE' });
		await invalidateAll();
		const next = new Set(loading);
		next.delete(item.id);
		loading = next;
	}
</script>

<svelte:head>
	<title>StreamQ — My Queue</title>
</svelte:head>

<div class="space-y-6">
	<div class="flex items-center justify-between">
		<h1 class="text-2xl font-bold">My Queue</h1>
		<a
			class="rounded-lg bg-orange-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-orange-400"
			href="/search"
		>
			+ Add Titles
		</a>
	</div>

	<!-- Tabs -->
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

	<!-- Empty state -->
	{#if visible.length === 0}
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
							<div
								class="flex h-full w-full items-center justify-center text-4xl text-gray-600"
							>
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

						<!-- Providers -->
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
								disabled={loading.has(item.id)}
								onclick={() => toggleWatched(item)}
							>
								{item.watched_at ? 'Unwatch' : '✓ Watched'}
							</button>
							<button
								class="rounded-md bg-gray-800 px-2 py-1 text-xs text-gray-400 transition-colors hover:bg-red-900/50 hover:text-red-400 disabled:opacity-40"
								disabled={loading.has(item.id)}
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
