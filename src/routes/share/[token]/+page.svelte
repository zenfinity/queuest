<script lang="ts">
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import type { ShareItem } from '$lib/types';
	import { decryptWithKey } from '$lib/crypto';
	import { parseSharePayload } from '$lib/share-schema';
	import { TMDB_IMG, formatRuntime } from '$lib/tmdb';
	import { hms, DEFAULT_RUNTIME } from '$lib/progress';
	import {
		addAllToQueue as addAllToQueueAction,
		type DuplicateSkip
	} from '$lib/share-token-actions';
	import Button from '$lib/components/Button.svelte';

	let { data }: { data: { token: string } } = $props();

	type PageState = 'loading' | 'ready' | 'expired' | 'invalid' | 'error';
	let pageState: PageState = $state('loading');
	let items: ShareItem[] = $state([]);
	let queueName = $state('');

	let addingAll = $state(false);
	let addedCount = $state(0);
	let skips: DuplicateSkip[] = $state([]);
	let addDone = $state(false);
	let addError = $state('');

	// Groups skipped duplicates by the list they're already in, so "already in
	// queue" can say where instead of just how many — e.g. "2 in Horror
	// October, 1 in your Queue" rather than a bare count.
	let skipSummary = $derived.by(() => {
		if (skips.length === 0) return '';
		const counts: Record<string, number> = {};
		for (const s of skips) {
			const label = s.existingTag ?? 'your Queue';
			counts[label] = (counts[label] ?? 0) + 1;
		}
		return Object.entries(counts)
			.map(([label, n]) => `${n} in ${label}`)
			.join(', ');
	});

	async function addAllToQueue() {
		if (addingAll) return;
		await addAllToQueueAction(items, queueName, {
			setAddingAll: (v) => (addingAll = v),
			setAddedCount: (v) => (addedCount = v),
			setSkips: (v) => (skips = v),
			setAddDone: (v) => (addDone = v),
			setAddError: (v) => (addError = v)
		});
	}

	// Unlike remainingRuntime() (lib/progress.ts), ShareItem carries no
	// watched_seasons for the recipient — every season counts toward the total.
	function itemRuntime(item: ShareItem): number {
		if (item.media_type === 'movie' || !item.seasons.length) {
			return item.runtime_minutes ?? DEFAULT_RUNTIME[item.media_type];
		}
		return item.seasons.reduce((s: number, season) => s + season.runtime_minutes, 0);
	}

	let totalMins = $derived(items.reduce((s, i) => s + itemRuntime(i), 0));

	onMount(async () => {
		const key = window.location.hash.slice(1);
		if (!key) {
			pageState = 'invalid';
			return;
		}

		try {
			const res = await fetch(`/api/share?t=${encodeURIComponent(data.token)}`);
			if (res.status === 404) {
				pageState = 'expired';
				return;
			}
			if (!res.ok) {
				pageState = 'error';
				return;
			}

			const buf = await res.arrayBuffer();
			const json = await decryptWithKey(buf, key);
			const payload = parseSharePayload(JSON.parse(json));
			items = payload.items ?? [];
			queueName = payload.queue_name ?? '';
			pageState = 'ready';
		} catch {
			pageState = 'invalid';
		}
	});
</script>

<svelte:head><title>Shared Watchlist — Queuest</title></svelte:head>

<div class="space-y-6">
	<!-- Header -->
	<div class="rounded-xl bg-orange-50 p-4 dark:bg-orange-950/30">
		<div class="flex flex-wrap items-center justify-between gap-3">
			<div>
				<p class="text-sm font-semibold text-orange-700 dark:text-orange-400">
					{queueName || 'Shared watchlist'}
				</p>
				{#if pageState === 'ready'}
					<p class="text-xs text-orange-600/70 dark:text-orange-500/60">
						{items.length} title{items.length === 1 ? '' : 's'} · {hms(totalMins)} total
					</p>
				{/if}
			</div>
			<div class="flex flex-wrap items-center gap-2">
				{#if pageState === 'ready' && items.length > 0}
					{#if addDone}
						{#if addError && !addedCount && !skips.length}
							<span
								class="rounded-lg bg-red-100 px-4 py-2 text-sm font-medium text-red-700 dark:bg-red-900/40 dark:text-red-400"
								title={addError}
							>
								Failed to add — {addError}
							</span>
						{:else}
							<span
								class="rounded-lg bg-teal-100 px-4 py-2 text-sm font-medium text-teal-700 dark:bg-teal-900/40 dark:text-teal-400"
							>
								{#if addedCount > 0}
									✓ {addedCount} added{skips.length > 0
										? ` · ${skips.length} already in queue (${skipSummary})`
										: ''}
								{:else}
									✓ Already in queue ({skipSummary})
								{/if}
							</span>
						{/if}
					{:else}
						<button
							onclick={addAllToQueue}
							disabled={addingAll}
							class="rounded-lg bg-white px-4 py-2 text-sm font-medium text-orange-600 ring-1 ring-orange-300 transition-colors hover:bg-orange-50 disabled:opacity-50 dark:bg-orange-950/20 dark:text-orange-400 dark:ring-orange-800 dark:hover:bg-orange-950/40"
						>
							{addingAll ? 'Adding…' : '+ Add to my queue'}
						</button>
					{/if}
				{/if}
				<!-- Routes through the same setup screen the landing page's CTA
				     does (#242) rather than straight to an empty /app — this
				     visitor hasn't been through it either. -->
				<Button href={resolve('/add?onboarding=1')} class="px-4 py-2 text-sm"
					>Build your own queue →</Button
				>
			</div>
		</div>
	</div>

	<!-- Loading -->
	{#if pageState === 'loading'}
		<div class="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
			{#each { length: 6 } as _, i (i)}
				<div class="aspect-[2/3] animate-pulse rounded-xl bg-gray-200 dark:bg-gray-800"></div>
			{/each}
		</div>

		<!-- Expired -->
	{:else if pageState === 'expired'}
		<div class="py-24 text-center">
			<p class="mb-2 text-5xl">🔗</p>
			<p class="text-lg font-medium text-gray-700 dark:text-gray-300">Share link expired</p>
			<p class="mt-1 text-sm text-gray-500">
				Shared links are valid for 30 days. Ask for a new one!
			</p>
		</div>

		<!-- Invalid / error -->
	{:else if pageState === 'invalid' || pageState === 'error'}
		<div class="py-24 text-center">
			<p class="mb-2 text-5xl">🔒</p>
			<p class="text-lg font-medium text-gray-700 dark:text-gray-300">Couldn't open this link</p>
			<p class="mt-1 text-sm text-gray-500">The link may be incomplete or corrupted.</p>
		</div>

		<!-- Grid of shared items -->
	{:else}
		<div class="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
			{#each items as item (`${item.tmdb_id}:${item.media_type}`)}
				<div
					class="flex flex-col overflow-hidden rounded-xl bg-white ring-1 ring-gray-200 dark:bg-gray-900 dark:ring-0"
				>
					<div class="relative aspect-[2/3] bg-gray-200 dark:bg-gray-800">
						{#if item.poster_path}
							<img
								src="{TMDB_IMG}/w300{item.poster_path}"
								alt={item.title}
								class="h-full w-full object-cover"
							/>
						{:else}
							<div
								class="flex h-full w-full items-center justify-center text-4xl text-gray-400 dark:text-gray-600"
							>
								🎬
							</div>
						{/if}
					</div>
					<div class="flex flex-1 flex-col gap-2 p-3">
						<p class="line-clamp-2 text-sm font-medium leading-tight">{item.title}</p>
						<div class="flex flex-wrap items-center gap-1">
							<span class="rounded bg-gray-100 px-1 py-0.5 text-[11px] dark:bg-gray-800">
								{item.media_type === 'movie' ? '🎬' : '📺'}
							</span>
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
							{#if !item.providers.length}
								<span class="text-sm leading-none" title="Not on streaming services">🚫</span>
							{/if}
						</div>
						<p class="text-[10px] tabular-nums text-gray-500">
							{formatRuntime(itemRuntime(item), item.media_type)}
						</p>
					</div>
				</div>
			{/each}
		</div>
	{/if}
</div>
