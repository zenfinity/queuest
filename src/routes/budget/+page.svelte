<script lang="ts">
	import { onMount } from 'svelte';
	import { getAll, getServices, toggleService } from '$lib/db';
	import { services, setSubscribedIds } from '$lib/services.svelte';
	import { TMDB_IMG } from '$lib/tmdb';
	import type { Provider } from '$lib/types';

	// ── Budget ────────────────────────────────────────────────────────────────
	let hoursPerWeek  = $state(10);
	let weeksPerMonth = $state(4);
	let budgetHours   = $derived(hoursPerWeek * weeksPerMonth);

	$effect(() => {
		try {
			localStorage.setItem('sq:budget:weekly', JSON.stringify(hoursPerWeek));
			localStorage.setItem('sq:budget:weeks',  JSON.stringify(weeksPerMonth));
			localStorage.setItem('sq:budget', JSON.stringify(budgetHours));
		} catch {}
	});

	// ── Services ──────────────────────────────────────────────────────────────
	let queueProviders = $state<Provider[]>([]);
	let loaded         = $state(false);
	let toggleError    = $state('');

	let subscribedIds = $derived(services.ids);

	async function handleToggle(provider: Provider) {
		const id = provider.provider_id;
		const wasSubscribed = services.ids.has(id);
		toggleError = '';
		if (wasSubscribed) {
			const next = new Set(services.ids);
			next.delete(id);
			setSubscribedIds(next);
		} else {
			setSubscribedIds(new Set([...services.ids, id]));
		}
		try {
			await toggleService(provider);
		} catch (e) {
			if (wasSubscribed) {
				setSubscribedIds(new Set([...services.ids, id]));
			} else {
				const next = new Set(services.ids);
				next.delete(id);
				setSubscribedIds(next);
			}
			toggleError = e instanceof Error ? e.message : 'Could not save. Check browser storage settings.';
		}
	}

	onMount(async () => {
		try {
			const weekly = localStorage.getItem('sq:budget:weekly');
			const weeks  = localStorage.getItem('sq:budget:weeks');
			if (weekly !== null && weeks !== null) {
				hoursPerWeek  = JSON.parse(weekly);
				weeksPerMonth = JSON.parse(weeks);
			} else {
				const legacy = JSON.parse(localStorage.getItem('sq:budget') ?? '40');
				weeksPerMonth = 4;
				hoursPerWeek  = Math.round(legacy / weeksPerMonth);
			}
		} catch {}

		const [items, svcs] = await Promise.all([getAll(), getServices()]);
		setSubscribedIds(new Set(svcs.map(s => s.provider_id)));

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

<svelte:head><title>Queuest — Budget</title></svelte:head>

<div class="mx-auto max-w-md space-y-8">
	<!-- Viewing Budget -->
	<section class="space-y-3">
		<h2 class="text-sm font-semibold uppercase tracking-widest text-gray-500">Viewing Budget</h2>
		<p class="text-sm text-gray-600 dark:text-gray-400">
			Your estimated monthly watch time. Used to normalise bar widths across all views.
		</p>
		<div class="flex flex-wrap items-center gap-2 text-sm">
			<input
				type="number" min="1" max="24" step="0.5"
				bind:value={hoursPerWeek}
				class="w-16 rounded-lg bg-gray-100 px-3 py-2 text-center text-base sm:text-sm font-medium text-gray-900 outline-none ring-1 ring-gray-300 focus:ring-orange-500 dark:bg-gray-900 dark:text-white dark:ring-gray-700 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
			/>
			<span class="text-gray-600 dark:text-gray-400">hrs ×</span>
			<input
				type="number" min="1" max="6" step="0.5"
				bind:value={weeksPerMonth}
				class="w-16 rounded-lg bg-gray-100 px-3 py-2 text-center text-base sm:text-sm font-medium text-gray-900 outline-none ring-1 ring-gray-300 focus:ring-orange-500 dark:bg-gray-900 dark:text-white dark:ring-gray-700 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
			/>
			<span class="text-gray-600 dark:text-gray-400">weeks =</span>
			<span class="font-semibold text-gray-900 dark:text-white">{budgetHours} hrs/month</span>
		</div>
	</section>

	<div class="border-t border-gray-200 dark:border-gray-800"></div>

	<!-- Subscribed Services -->
	<section class="space-y-3">
		<h2 class="text-sm font-semibold uppercase tracking-widest text-gray-500">Subscribed Services</h2>
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
					<button
						onclick={() => handleToggle(provider)}
						style:border-color={subscribedIds.has(provider.provider_id) ? '#22c55e' : 'transparent'}
						style:border-style="solid"
						class="flex items-center gap-2 rounded-xl border-2 px-3 py-2.5 text-sm font-medium transition-colors
							{subscribedIds.has(provider.provider_id)
								? 'bg-white dark:bg-gray-900'
								: 'bg-gray-100 text-gray-500 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700'}"
					>
						<img
							src="{TMDB_IMG}/original{provider.logo_path}"
							alt=""
							class="h-6 w-6 rounded-md object-cover"
						/>
						<span class="{subscribedIds.has(provider.provider_id) ? 'text-gray-900 dark:text-white' : ''}">{provider.provider_name}</span>
					</button>
				{/each}
			</div>
			<p class="text-xs text-gray-400 dark:text-gray-500">
				{subscribedIds.size} service{subscribedIds.size === 1 ? '' : 's'} selected
			</p>
			{#if toggleError}
				<p class="text-xs text-red-500">{toggleError}</p>
			{/if}
		{/if}
	</section>
</div>
