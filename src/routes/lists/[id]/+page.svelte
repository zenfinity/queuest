<script lang="ts">
	// Queue view for a shared collection (#145) — thin host around
	// SharedListSection's `inline` mode (#243). This page used to duplicate
	// SharedListSection's card markup and drifted out of sync with it as
	// features landed there (notes, DetailPanel, drag reorder, filters, view
	// modes...). Now it supplies only what `inline` mode doesn't: page chrome,
	// and the member count (loaded separately since `onStats` only reports
	// the visible item count/runtime, matching the Queue page's own summary
	// line convention — see SharedListSection.svelte).
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { readNumber } from '$lib/storage';
	import { DEFAULT_BUDGET_HOURS } from '$lib/progress';
	import { sharedListColor } from '$lib/queue-colors';
	import {
		listCollections,
		listMembers,
		type SharedCollection,
		type CollectionMember
	} from '$lib/collection-actions';
	import SharedListSection from '$lib/components/SharedListSection.svelte';

	const id = page.params.id ?? '';

	let loading = $state(true);
	let loadError = $state('');
	let collection: SharedCollection | null = $state(null);
	let members: CollectionMember[] = $state([]);
	let budgetHours = $state(DEFAULT_BUDGET_HOURS);
	let stats = $state({ count: 0, remainingMins: 0 });

	const noop = { setBusy: () => {}, setError: (e: string) => (loadError = e) };

	onMount(async () => {
		budgetHours = readNumber('sq:budget', DEFAULT_BUDGET_HOURS);
		const all = await listCollections(noop);
		collection = all.find((c) => c.id === id) ?? null;
		if (!collection) {
			loadError = "You don't have access to this list, or it doesn't exist.";
			loading = false;
			return;
		}
		members = await listMembers(id, noop);
		loading = false;
	});
</script>

<svelte:head><title>Queuest — {collection?.name ?? 'Shared list'}</title></svelte:head>

<main class="mx-auto max-w-2xl space-y-6 px-4 py-8">
	<div class="flex items-center justify-between">
		<a
			href={resolve('/lists')}
			class="text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
		>
			← Lists
		</a>
	</div>

	{#if loading}
		<p class="text-sm text-gray-500 dark:text-gray-400">Loading…</p>
	{:else if loadError && !collection}
		<p class="text-sm text-red-600 dark:text-red-400">{loadError}</p>
	{:else if collection}
		<div>
			<h1 class="text-xl font-semibold text-gray-900 dark:text-white">{collection.name}</h1>
			<p class="text-sm text-gray-500 dark:text-gray-400">
				{members.length} member{members.length === 1 ? '' : 's'} · {stats.count} title{stats.count ===
				1
					? ''
					: 's'}
			</p>
		</div>

		{#if loadError}
			<p class="text-sm text-red-600 dark:text-red-400">{loadError}</p>
		{/if}

		<SharedListSection
			inline
			{collection}
			color={sharedListColor(collection)}
			{budgetHours}
			onStats={(s) => (stats = s)}
		/>
	{/if}
</main>
