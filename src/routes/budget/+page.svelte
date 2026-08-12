<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { getAll, getServices, toggleService } from '$lib/db';
	import { services, setSubscribedIds } from '$lib/services.svelte';
	import { TMDB_IMG, formatRuntime } from '$lib/tmdb';
	import { aggregateByProvider, saveBudgetPrefs } from '$lib/progress';
	import { readNumber } from '$lib/storage';
	import type { Provider, Suggestion } from '$lib/types';

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

	// ── Suggest (formerly its own /suggest route — #159) ─────────────────────
	let suggestions = $state<Suggestion[]>([]);
	let totalUnwatched = $state(0);
	let suggestionsLoaded = $state(false);
	let topRuntime = $derived(suggestions[0]?.runtime_minutes ?? 1);

	let subscribedIds = $derived(services.ids);

	async function handleToggle(provider: Provider) {
		const id = provider.provider_id;
		const wasSubscribed = services.ids.has(id);
		toggleError = '';
		if (wasSubscribed) services.ids.delete(id);
		else services.ids.add(id);
		try {
			await toggleService(provider);
		} catch (e) {
			// Roll back the optimistic update
			if (wasSubscribed) services.ids.add(id);
			else services.ids.delete(id);
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

		// Reuses the same `items` fetched above rather than a second getAll() —
		// Suggest only cares about the unwatched subset, ranked by remaining
		// runtime per provider.
		const unwatched = items.filter((i) => !i.watched_at);
		totalUnwatched = unwatched.length;
		suggestions = aggregateByProvider(unwatched)
			.map((agg): Suggestion => ({
				provider_id: agg.provider_id,
				name: agg.provider_name,
				logo_path: agg.logo_path,
				runtime_minutes: agg.totalMins,
				title_count: agg.count
			}))
			.sort((a, b) => b.runtime_minutes - a.runtime_minutes);
		suggestionsLoaded = true;
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

	<!-- Suggest — a brand-new onboarding user has an empty queue by definition
	     (Add is the next step after Budget), so this would only ever show the
	     same empty state the onboarding CTA below already covers. Hidden
	     entirely rather than shown-empty, so the two never render at once. -->
	{#if !isOnboarding}
		<div class="border-t border-gray-200 dark:border-gray-800"></div>

		<section id="suggest" class="space-y-3">
			<div>
				<h2 class="text-sm font-semibold uppercase tracking-widest text-gray-500">
					What to Subscribe to Next
				</h2>
				<p class="mt-1 text-sm text-gray-500">
					Based on your {totalUnwatched} unwatched title{totalUnwatched === 1 ? '' : 's'}
				</p>
			</div>

			{#if !suggestionsLoaded}
				<div class="space-y-3">
					{#each { length: 4 } as _, i (i)}
						<div class="h-[72px] animate-pulse rounded-xl bg-gray-200 dark:bg-gray-800"></div>
					{/each}
				</div>
			{:else if suggestions.length === 0}
				<div class="flex flex-col items-center justify-center py-12 text-center">
					<p class="mb-4 text-5xl">📺</p>
					<p class="text-lg font-medium text-gray-700 dark:text-gray-300">No suggestions yet</p>
					<p class="mt-1 text-sm text-gray-500">
						<a class="text-orange-500 hover:underline" href={resolve('/add')}
							>Add titles to your queue</a
						>
						to get streaming recommendations
					</p>
				</div>
			{:else}
				<div class="space-y-3">
					{#each suggestions as suggestion, i (suggestion.provider_id)}
						<div
							class="flex items-center gap-4 rounded-xl bg-white p-4 ring-1 ring-gray-200 dark:bg-gray-900 dark:ring-0"
						>
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

							<!-- Name + runtime -->
							<div class="flex-1">
								<p class="font-medium">{suggestion.name}</p>
								<p class="text-sm text-gray-500">
									{formatRuntime(suggestion.runtime_minutes, 'tv')} remaining · {suggestion.title_count}
									{suggestion.title_count === 1 ? 'title' : 'titles'}
								</p>
							</div>

							<!-- Bar — only meaningful with 3+ providers -->
							{#if suggestions.length >= 3}
								<div class="hidden w-36 sm:block">
									<div class="h-2 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-800">
										<div
											class="h-full rounded-full bg-orange-500 transition-all"
											style="width: {Math.round((suggestion.runtime_minutes / topRuntime) * 100)}%"
										></div>
									</div>
								</div>
							{/if}
						</div>
					{/each}
				</div>

				<p class="text-center text-xs text-gray-400">
					Streaming data via TMDB / JustWatch · US only
				</p>
			{/if}
		</section>
	{/if}

	{#if isOnboarding}
		<div class="border-t border-gray-200 dark:border-gray-800"></div>
		<button
			onclick={() => goto(resolve('/add?onboarding=1'))}
			class="w-full rounded-lg bg-orange-500 px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-orange-400"
		>
			Next: Add titles →
		</button>
	{/if}
</div>
