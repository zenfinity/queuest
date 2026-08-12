<script lang="ts">
	import type { Snippet } from 'svelte';
	import { flip } from 'svelte/animate';
	import type { WatchlistItem } from '$lib/types';
	import { TMDB_IMG, formatRuntime } from '$lib/tmdb';
	import { resolvedHue } from '$lib/colors';
	import { remainingRuntime, releaseChip } from '$lib/progress';
	import { motion } from '$lib/motion.svelte';
	import { queueControls } from '$lib/queue-controls.svelte';

	let {
		items,
		budgetHours,
		busy,
		queueColors,
		onToggle,
		onRemove,
		onOpenDetail,
		seasonPicker
	}: {
		items: WatchlistItem[];
		budgetHours: number;
		busy: Set<number>;
		queueColors: Record<string, string>;
		onToggle: (item: WatchlistItem) => Promise<void>;
		onRemove: (item: WatchlistItem) => Promise<void>;
		onOpenDetail: (item: WatchlistItem) => void;
		seasonPicker: Snippet<[WatchlistItem]>;
	} = $props();

	let libraryPopupId: number | null = $state(null);
</script>

<svelte:document
	onclick={(e) => {
		const t = e.target as Element;
		if (!t.closest('[data-library-popup]')) libraryPopupId = null;
	}}
/>

<div class="grid grid-cols-2 gap-3 sm:gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
	{#each items as item (item.id)}
		{@const cardHue = resolvedHue(item.providers[0]?.provider_id ?? null)}
		{@const cardPct = Math.min(100, (remainingRuntime(item) / (budgetHours * 60)) * 100)}
		{@const cardLine = cardHue !== null ? `hsl(${cardHue} 60% 52%)` : '#374151'}
		{@const cardDot = cardHue !== null ? `hsl(${cardHue} 70% 62%)` : '#4b5563'}
		{@const tagColor = item.queue_tag ? (queueColors[item.queue_tag] ?? null) : null}
		<div
			animate:flip={{ duration: motion.reduced ? 0 : 250 }}
			class="flex flex-col rounded-xl bg-white ring-1 ring-gray-200 dark:bg-gray-900 dark:ring-0 cursor-pointer"
			style={tagColor ? `border-left: 3px solid ${tagColor}` : ''}
			onclick={(e) => {
				e.stopPropagation();
				onOpenDetail(item);
			}}
			role="button"
			tabindex="0"
			aria-label="View details for {item.title}"
			onkeydown={(e) => {
				if (e.key === 'Enter' || e.key === ' ') {
					onOpenDetail(item);
				}
			}}
		>
			<button
				class="relative aspect-[2/3] overflow-hidden rounded-t-xl bg-gray-200 dark:bg-gray-800 w-full cursor-pointer"
				onclick={() => onOpenDetail(item)}
				data-detail-trigger
				aria-label="View details for {item.title}"
			>
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
				{#if queueControls.watchedOn && item.watched_at}
					<span
						class="absolute top-2 left-2 rounded bg-teal-900/85 px-1.5 py-0.5 text-[10px] font-semibold text-teal-400"
						>✓ Watched</span
					>
				{/if}
			</button>
			<div class="flex flex-1 flex-col gap-2 p-2.5 sm:p-3">
				<p class="line-clamp-2 text-sm font-medium leading-tight">{item.title}</p>
				<!-- Runtime sparkline -->
				<div class="flex items-center gap-2">
					<div class="relative flex-1">
						<div class="h-px w-full bg-gray-200 dark:bg-gray-800"></div>
						<div
							class="absolute top-0 left-0 h-px transition-all duration-300"
							style="width:{cardPct}%; background:{cardLine}; opacity:0.75;"
						></div>
						<div
							class="absolute top-1/2 -translate-y-1/2 h-1.5 w-1.5 rounded-full transition-all duration-300"
							style="left:{cardPct}%; margin-left:-3px; background:{cardDot};"
						></div>
					</div>
					<span class="shrink-0 text-[10px] tabular-nums text-gray-500">
						{formatRuntime(remainingRuntime(item), item.media_type)}
					</span>
				</div>
				{@render seasonPicker(item)}
				<!-- Type chip + collection chip + providers -->
				<div class="flex flex-wrap items-center gap-1">
					<span class="rounded bg-gray-100 px-1 py-0.5 text-[11px] dark:bg-gray-800">
						{item.media_type === 'movie' ? '🎬' : '📺'}
					</span>
					{#if tagColor}
						<span
							class="shrink-0 min-w-0 max-w-[60%] truncate rounded px-1 py-0.5 text-[10px] font-semibold text-white"
							style="background-color: {tagColor};"
							title={item.queue_tag}
						>
							{item.queue_tag}
						</span>
					{/if}
					{#each item.providers.slice(0, 4) as p (p.provider_id)}
						<img
							src="{TMDB_IMG}/w92{p.logo_path}"
							alt={p.provider_name}
							title={p.provider_name}
							class="h-5 w-5 rounded"
						/>
					{/each}
					{#if item.providers.length > 4}<span class="text-xs text-gray-500"
							>+{item.providers.length - 4}</span
						>{/if}
					{#if !item.providers.length}
						{#if item.rentable}
							<span class="text-sm leading-none" title="Rent/Buy only">💲</span>
						{:else}
							{@const isOpen = libraryPopupId === item.id}
							<div class="relative" data-library-popup>
								<button
									class="text-sm leading-none transition-opacity hover:opacity-60"
									onclick={(e) => {
										e.stopPropagation();
										libraryPopupId = isOpen ? null : item.id;
									}}
									title="Not on streaming services">🚫</button
								>
								{#if isOpen}
									<div
										class="absolute top-full left-0 z-20 mt-1 w-max rounded-lg bg-white px-3 py-2 shadow-lg ring-1 ring-gray-200 dark:bg-gray-900 dark:ring-gray-700"
									>
										<p class="mb-1.5 text-[10px] font-semibold text-gray-400 dark:text-gray-500">
											Check your library
										</p>
										<div class="flex flex-col gap-1">
											<a
												href="https://www.kanopy.com/en/search?query={encodeURIComponent(
													item.title
												)}"
												target="_blank"
												rel="noopener noreferrer"
												class="text-[11px] text-gray-600 hover:text-orange-500 dark:text-gray-400 dark:hover:text-orange-400"
												>Kanopy →</a
											>
											<a
												href="https://www.hoopladigital.com/search?q={encodeURIComponent(
													item.title
												)}"
												target="_blank"
												rel="noopener noreferrer"
												class="text-[11px] text-gray-600 hover:text-orange-500 dark:text-gray-400 dark:hover:text-orange-400"
												>Hoopla →</a
											>
										</div>
									</div>
								{/if}
							</div>
						{/if}
					{/if}
				</div>
				{#if item.media_type === 'movie' && releaseChip(item.release)}
					<p class="text-xs leading-snug text-amber-600 dark:text-amber-400">
						{releaseChip(item.release)}
					</p>
				{/if}
				<div class="mt-auto flex gap-1.5 pt-1">
					<button
						class="flex-1 rounded-md bg-gray-100 py-1 text-xs font-medium transition-colors hover:bg-gray-200 disabled:opacity-40 dark:bg-gray-800 dark:hover:bg-gray-700"
						disabled={busy.has(item.id)}
						onclick={(e) => {
							e.stopPropagation();
							onToggle(item);
						}}
					>
						{item.watched_at ? 'Unwatch' : '✓ Watched'}
					</button>
					<button
						class="rounded-md bg-gray-100 px-2 py-1 text-xs text-gray-500 transition-colors hover:bg-red-100 hover:text-red-600 disabled:opacity-40 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-red-900/50 dark:hover:text-red-400"
						disabled={busy.has(item.id)}
						onclick={(e) => {
							e.stopPropagation();
							onRemove(item);
						}}
						aria-label="Remove">✕</button
					>
				</div>
			</div>
		</div>
	{/each}
</div>
