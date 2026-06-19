<script lang="ts">
	import { onMount } from 'svelte';
	import { getAll, getServices, toggleService } from '$lib/db';
	import { TMDB_IMG } from '$lib/tmdb';
	import type { Provider } from '$lib/types';

	let subscribedIds  = $state(new Set<number>());
	let queueProviders = $state<Provider[]>([]);
	let loaded         = $state(false);

	function handleToggle(provider: Provider) {
		const next = new Set(subscribedIds);
		if (next.has(provider.provider_id)) next.delete(provider.provider_id);
		else next.add(provider.provider_id);
		subscribedIds = next;
		toggleService(provider); // optimistic — IDB write in background
	}

	onMount(async () => {
		const [items, services] = await Promise.all([getAll(), getServices()]);
		subscribedIds = new Set(services.map((s) => s.provider_id));

		const providerMap = new Map<number, Provider>();
		for (const item of items) {
			for (const p of item.providers) {
				if (!providerMap.has(p.provider_id)) providerMap.set(p.provider_id, p);
			}
		}
		queueProviders = [...providerMap.values()].sort((a, b) =>
			a.provider_name.localeCompare(b.provider_name)
		);
		loaded = true;
	});
</script>

<svelte:head><title>Queuest — Services</title></svelte:head>

<div class="mx-auto max-w-md space-y-6">
	<h1 class="text-xl font-bold xs:text-2xl">Services</h1>
	<p class="text-sm text-gray-600 dark:text-gray-400">
		Mark which streaming services you subscribe to. Queuest uses this to surface relevant suggestions.
	</p>

	{#if !loaded}
		<p class="text-sm text-gray-400 dark:text-gray-600">Loading…</p>
	{:else if queueProviders.length === 0}
		<p class="text-sm text-gray-400 dark:text-gray-600">
			Add titles to your queue and their streaming services will appear here.
		</p>
	{:else}
		<div class="flex flex-wrap gap-3">
			{#each queueProviders as provider (provider.provider_id)}
				{@const subscribed = subscribedIds.has(provider.provider_id)}
				<button
					onclick={() => handleToggle(provider)}
					class="flex items-center gap-2 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors
						{subscribed
							? 'bg-white ring-2 ring-green-500 dark:bg-gray-900'
							: 'bg-gray-100 text-gray-500 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700'}"
				>
					<img
						src="{TMDB_IMG}/original{provider.logo_path}"
						alt=""
						class="h-6 w-6 rounded-md object-cover"
					/>
					<span class="{subscribed ? 'text-gray-900 dark:text-white' : ''}">{provider.provider_name}</span>
				</button>
			{/each}
		</div>
		<p class="text-xs text-gray-400 dark:text-gray-500">
			{subscribedIds.size} service{subscribedIds.size === 1 ? '' : 's'} selected
		</p>
	{/if}
</div>
