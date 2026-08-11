<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { getAll, getServices, toggleService } from '$lib/db';
	import { services, setSubscribedIds } from '$lib/services.svelte';
	import { TMDB_IMG } from '$lib/tmdb';
	import { aggregateByProvider, saveBudgetPrefs } from '$lib/progress';
	import { readNumber } from '$lib/storage';
	import type { Provider } from '$lib/types';

	// ── Onboarding ────────────────────────────────────────────────────────────
	let isOnboarding = $state(false);

	// ── Budget ────────────────────────────────────────────────────────────────
	// Read synchronously at init (this route is ssr=false, so localStorage is
	// always available here) rather than in onMount — the persistence $effect
	// below runs in declaration order on mount, so if this lived in onMount
	// instead, the effect would fire first with the default 10/4 and stomp
	// whatever was actually saved before onMount ever got a chance to read it.
	function loadBudgetPrefs(): { hoursPerWeek: number; weeksPerMonth: number } {
		// Try new format first: both values must exist and be valid numbers
		const hoursPerWeek = readNumber('sq:budget:weekly', -1);
		const weeksPerMonth = readNumber('sq:budget:weeks', -1);
		if (hoursPerWeek > 0 && weeksPerMonth > 0) {
			return { hoursPerWeek, weeksPerMonth };
		}

		// Fall back to legacy format if new format isn't completely valid
		const legacy = readNumber('sq:budget', -1);
		if (legacy > 0) {
			return { hoursPerWeek: Math.round(legacy / 4), weeksPerMonth: 4 };
		}

		// All storage corrupted or missing
		return { hoursPerWeek: 10, weeksPerMonth: 4 };
	}
	const initialBudgetPrefs = loadBudgetPrefs();

	let hoursPerWeek = $state(initialBudgetPrefs.hoursPerWeek);
	let weeksPerMonth = $state(initialBudgetPrefs.weeksPerMonth);
	let budgetHours = $derived(hoursPerWeek * weeksPerMonth);

	$effect(() => {
		saveBudgetPrefs(hoursPerWeek, weeksPerMonth);
	});

	// ── Services ──────────────────────────────────────────────────────────────
	let queueProviders = $state<Provider[]>([]);
	let majorProviders = $state<Provider[]>([]);
	let loaded = $state(false);
	let toggleError = $state('');

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
			toggleError =
				e instanceof Error ? e.message : 'Could not save. Check browser storage settings.';
		}
	}

	onMount(async () => {
		isOnboarding = page.url.searchParams.has('onboarding');

		const [items, svcs] = await Promise.all([getAll(), getServices()]);
		setSubscribedIds(new Set(svcs.map((s) => s.provider_id)));

		queueProviders = aggregateByProvider(items)
			.map((p): Provider => ({
				provider_id: p.provider_id,
				provider_name: p.provider_name,
				logo_path: p.logo_path
			}))
			.sort((a, b) => a.provider_name.localeCompare(b.provider_name));

		// Fetch majors for empty-queue onboarding state
		if (queueProviders.length === 0) {
			try {
				const res = await fetch('/api/major-providers');
				if (res.ok) majorProviders = await res.json();
			} catch {
				// Best-effort fetch for onboarding suggestions; page works without them
			}
		}

		loaded = true;
	});
</script>

<svelte:head><title>Queuest — Budget</title></svelte:head>

<div class="mx-auto max-w-md space-y-8">
	<!-- Viewing Budget -->
	<section class="space-y-3">
		<h2 class="text-sm font-semibold uppercase tracking-widest text-gray-500">Viewing Budget</h2>
		{#if isOnboarding}
			<p class="text-sm text-gray-600 dark:text-gray-400">
				This calibrates how full your queue bars look. Set it now or adjust later on this page.
			</p>
		{:else}
			<p class="text-sm text-gray-600 dark:text-gray-400">
				Your estimated monthly watch time. Used to normalise bar widths across all views.
			</p>
		{/if}
		<div class="flex flex-wrap items-center gap-2 text-sm">
			<input
				type="number"
				min="1"
				max="24"
				step="0.5"
				bind:value={hoursPerWeek}
				class="w-16 rounded-lg bg-gray-100 px-3 py-2 text-center text-base sm:text-sm font-medium text-gray-900 outline-none ring-1 ring-gray-300 focus:ring-orange-500 dark:bg-gray-900 dark:text-white dark:ring-gray-700 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
			/>
			<span class="text-gray-600 dark:text-gray-400">hrs ×</span>
			<input
				type="number"
				min="1"
				max="6"
				step="0.5"
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
		<h2 class="text-sm font-semibold uppercase tracking-widest text-gray-500">
			Subscribed Services
		</h2>
		<p class="text-sm text-gray-600 dark:text-gray-400">
			Mark which streaming services you subscribe to. Queuest uses this to surface relevant
			suggestions.
		</p>

		{#if !loaded}
			<p class="text-sm text-gray-400 dark:text-gray-600">Loading…</p>
		{:else}
			{@const providers = queueProviders.length > 0 ? queueProviders : majorProviders}
			{#if providers.length === 0}
				<p class="text-sm text-gray-400 dark:text-gray-600">
					{#if queueProviders.length === 0 && !majorProviders.length}
						Add titles to your queue and their streaming services will appear here.
					{/if}
				</p>
			{:else}
				<div class="flex flex-wrap gap-3">
					{#each providers as provider (provider.provider_id)}
						<button
							onclick={() => handleToggle(provider)}
							style:border-color={subscribedIds.has(provider.provider_id)
								? '#22c55e'
								: 'transparent'}
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
							<span
								class={subscribedIds.has(provider.provider_id)
									? 'text-gray-900 dark:text-white'
									: ''}>{provider.provider_name}</span
							>
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
		{/if}
	</section>

	{#if isOnboarding}
		<div class="border-t border-gray-200 dark:border-gray-800"></div>
		<button
			onclick={() => goto('/add?onboarding=1')}
			class="w-full rounded-lg bg-orange-500 px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-orange-400"
		>
			Next: Add titles →
		</button>
	{/if}
</div>
