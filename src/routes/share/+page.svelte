<script lang="ts">
	import { onMount } from 'svelte';
	import type { WatchlistItem } from '$lib/types';
	import { getAll } from '$lib/db';
	import { TMDB_IMG } from '$lib/tmdb';
	import { remainingRuntime, aggregateByProvider, hms } from '$lib/progress';
	import { getQueueColors } from '$lib/queue-colors';
	import { services, ensureSubscribedLoaded, getLoadError } from '$lib/services.svelte';
	import { createShareLink as createShareLinkAction } from '$lib/share-create-actions';

	let items = $state<WatchlistItem[]>([]);
	let loaded = $state(false);
	let queueColors = $state<Record<string, string>>({});

	let shareStatus = $state<'queue' | 'watched' | 'both'>('queue');
	let shareType = $state<'all' | 'movie' | 'tv'>('all');
	let shareProviderIds = $state(new Set<number>());
	let shareQueueNames = $state(new Set<string>());
	let shareCreating = $state(false);
	let shareUrl = $state('');
	let shareCopied = $state(false);
	let shareError = $state('');
	let servicesLoadError = $state('');

	let allShareQueues = $derived.by(() => {
		const names = new Set<string>();
		for (const item of items) {
			if (item.queue_tag) names.add(item.queue_tag);
		}
		return [...names].sort();
	});

	let shareAllProviders = $derived.by(() =>
		aggregateByProvider(items)
			.sort((a, b) => b.count - a.count)
			.map((p) => ({
				name: p.provider_name,
				provider_id: p.provider_id,
				logo_path: p.logo_path,
				count: p.count
			}))
	);

	let shareFiltered = $derived.by(() => {
		let base = items;
		if (shareStatus === 'queue') base = base.filter((i) => !i.watched_at);
		else if (shareStatus === 'watched') base = base.filter((i) => i.watched_at);
		if (shareType !== 'all') base = base.filter((i) => i.media_type === shareType);
		if (allShareQueues.length > 0 && shareQueueNames.size < allShareQueues.length) {
			base = base.filter((i) => !i.queue_tag || shareQueueNames.has(i.queue_tag));
		}
		const allChecked = shareProviderIds.size === shareAllProviders.length;
		return base.filter((i) => {
			if (!i.providers.length) return allChecked;
			return i.providers.some((p) => shareProviderIds.has(p.provider_id));
		});
	});

	let shareTotal = $derived(shareFiltered.reduce((s, i) => s + remainingRuntime(i), 0));

	function toggleInSet<T>(set: Set<T>, value: T): Set<T> {
		const next = new Set(set);
		if (next.has(value)) next.delete(value);
		else next.add(value);
		return next;
	}

	function toggleShareProvider(id: number) {
		shareProviderIds = toggleInSet(shareProviderIds, id);
		shareUrl = '';
	}

	function toggleShareQueue(name: string) {
		shareQueueNames = toggleInSet(shareQueueNames, name);
		shareUrl = '';
	}

	async function createShareLink() {
		if (!shareFiltered.length || shareCreating) return;
		await createShareLinkAction(shareFiltered, shareQueueNames, allShareQueues, {
			setShareCreating: (v) => (shareCreating = v),
			setShareUrl: (v) => (shareUrl = v),
			setShareError: (v) => (shareError = v)
		});
	}

	async function copyShareUrl() {
		try {
			await navigator.clipboard.writeText(shareUrl);
			shareCopied = true;
			setTimeout(() => {
				shareCopied = false;
			}, 2000);
		} catch {
			// Best-effort clipboard write; share link remains in textarea regardless
		}
	}

	onMount(() => {
		queueColors = getQueueColors();
		Promise.all([getAll(), ensureSubscribedLoaded()]).then(([all]) => {
			items = all;
			shareQueueNames = new Set(allShareQueues);
			const error = getLoadError();
			if (error) servicesLoadError = error;
			const subscribedProviderIds =
				services.ids.size > 0
					? new Set(
							shareAllProviders
								.filter((p) => services.ids.has(p.provider_id))
								.map((p) => p.provider_id)
						)
					: new Set<number>();
			shareProviderIds =
				subscribedProviderIds.size > 0
					? subscribedProviderIds
					: new Set(shareAllProviders.map((p) => p.provider_id));
			loaded = true;
		});
	});
</script>

export const ssr = false;

<svelte:head><title>Queuest — Share</title></svelte:head>

<div class="space-y-5 xs:space-y-8">
	<h2 class="text-sm font-semibold uppercase tracking-widest text-gray-500">Share Your Queue</h2>

	{#if !loaded}
		<p class="text-sm text-gray-500">Loading…</p>
	{:else if items.length === 0}
		<p class="text-sm text-gray-500">Your queue is empty — add some titles first.</p>
	{:else}
		<div class="max-w-md space-y-4">
			<!-- Status filter -->
			<div>
				<p class="mb-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500">Include</p>
				<div class="flex gap-0.5 rounded-lg bg-gray-100 p-1 dark:bg-gray-800">
					{#each [['queue', 'To Watch'], ['watched', 'Watched'], ['both', 'Both']] as const as [key, label] (key)}
						<button
							class="flex-1 rounded-md px-2 py-1 text-xs font-medium transition-colors
							{shareStatus === key
								? 'bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-white dark:shadow-none'
								: 'text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white'}"
							onclick={() => {
								shareStatus = key;
								shareUrl = '';
							}}>{label}</button
						>
					{/each}
				</div>
			</div>

			<!-- Type filter -->
			<div>
				<p class="mb-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500">Type</p>
				<div class="flex gap-0.5 rounded-lg bg-gray-100 p-1 dark:bg-gray-800">
					{#each [['all', 'All'], ['movie', 'Movies'], ['tv', 'TV']] as const as [key, label] (key)}
						<button
							class="flex-1 rounded-md px-2 py-1 text-xs font-medium transition-colors
							{shareType === key
								? 'bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-white dark:shadow-none'
								: 'text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white'}"
							onclick={() => {
								shareType = key;
								shareUrl = '';
							}}>{label}</button
						>
					{/each}
				</div>
			</div>

			<!-- Queue filter -->
			{#if allShareQueues.length > 1}
				<div>
					<p class="mb-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500">Queues</p>
					<div class="flex flex-wrap gap-1.5">
						{#each allShareQueues as q (q)}
							{@const on = shareQueueNames.has(q)}
							{@const color = queueColors[q] ?? null}
							<button
								onclick={() => toggleShareQueue(q)}
								class="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 transition-colors
									{on
									? 'bg-orange-50 text-orange-700 ring-orange-300 dark:bg-orange-950/40 dark:text-orange-400 dark:ring-orange-800'
									: 'bg-gray-100 text-gray-500 ring-gray-200 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:ring-gray-700'}"
							>
								{#if color}<span class="h-2 w-2 rounded-full shrink-0" style="background:{color}"
									></span>{/if}
								{q}
							</button>
						{/each}
					</div>
				</div>
			{/if}

			<!-- Provider filter -->
			<div>
				<p class="mb-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500">Providers</p>
				{#if servicesLoadError}
					<p class="text-xs text-red-600 dark:text-red-400">{servicesLoadError}</p>
				{:else if shareAllProviders.length > 0}
					<div class="flex flex-wrap gap-1.5">
						{#each shareAllProviders as p (p.provider_id)}
							{@const on = shareProviderIds.has(p.provider_id)}
							<button
								onclick={() => toggleShareProvider(p.provider_id)}
								class="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 transition-colors
									{on
									? 'bg-orange-50 text-orange-700 ring-orange-300 dark:bg-orange-950/40 dark:text-orange-400 dark:ring-orange-800'
									: 'bg-gray-100 text-gray-500 ring-gray-200 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:ring-gray-700'}"
							>
								<img src="{TMDB_IMG}/w92{p.logo_path}" alt="" class="h-4 w-4 rounded" />
								{p.name}
							</button>
						{/each}
					</div>
				{/if}
			</div>

			<!-- Summary -->
			<div
				class="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2 dark:bg-gray-800"
			>
				<span class="text-xs text-gray-500">
					{shareFiltered.length} title{shareFiltered.length === 1 ? '' : 's'}
					{#if shareFiltered.length > 0}· {hms(shareTotal)}{/if}
				</span>
				{#if shareFiltered.length === 0}
					<span class="text-xs text-amber-500">Nothing to share</span>
				{/if}
			</div>

			<!-- URL / create button -->
			{#if shareUrl}
				<div class="space-y-2">
					<div class="flex gap-2">
						<input
							type="text"
							readonly
							value={shareUrl}
							class="min-w-0 flex-1 rounded-lg bg-gray-100 px-3 py-2 text-base sm:text-xs text-gray-700 outline-none dark:bg-gray-800 dark:text-gray-300"
						/>
						<button
							onclick={copyShareUrl}
							class="shrink-0 rounded-lg px-3 py-2 text-xs font-medium transition-colors
								{shareCopied
								? 'bg-teal-500 text-white'
								: 'bg-gray-200 text-gray-700 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600'}"
						>
							{shareCopied ? '✓ Copied' : 'Copy'}
						</button>
					</div>
					<p class="text-[10px] text-gray-400 dark:text-gray-600">
						Link expires in 30 days · server stores only the encrypted blob
					</p>
				</div>
			{:else}
				<button
					onclick={createShareLink}
					disabled={shareFiltered.length === 0 || shareCreating}
					class="w-full rounded-lg bg-orange-500 py-2.5 text-sm font-medium text-white transition-colors hover:bg-orange-400 disabled:opacity-50"
				>
					{shareCreating ? 'Creating link…' : 'Create share link'}
				</button>
			{/if}

			{#if shareError}
				<p class="text-xs text-red-500">{shareError}</p>
			{/if}
		</div>
	{/if}
</div>
