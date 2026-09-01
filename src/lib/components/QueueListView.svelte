<script lang="ts">
	import type { Snippet } from 'svelte';
	import { flip } from 'svelte/animate';
	import { dragHandleZone, dragHandle } from 'svelte-dnd-action';
	import type { WatchlistItem } from '$lib/types';
	import { TMDB_IMG, formatRuntime } from '$lib/tmdb';
	import { resolvedHue } from '$lib/colors';
	import { remainingRuntime, releaseChip, hms, DEFAULT_RUNTIME } from '$lib/progress';
	import { motion } from '$lib/motion.svelte';
	import { queueControls } from '$lib/queue-controls.svelte';
	import { groupIntoCollections, type CollectionSection } from '$lib/queue-actions';

	let {
		items,
		budgetHours,
		busy,
		queueColors,
		groupByCollection = false,
		selectMode = false,
		selected = new Set<number>(),
		rankMode = false,
		onToggle,
		onRemove,
		onOpenDetail,
		onToggleSelect,
		onMoveUp,
		onMoveDown,
		onReorder,
		seasonPicker
	}: {
		items: WatchlistItem[];
		budgetHours: number;
		busy: Set<number>;
		queueColors: Record<string, string>;
		groupByCollection?: boolean;
		selectMode?: boolean;
		selected?: Set<number>;
		/** Custom "Rank" sort is active (#216) — shows move up/down (always) and
		 * a drag handle (#231). Only ever true when ungrouped — see rankMode's
		 * derivation in +page.svelte — so drag is wired only on that branch. */
		rankMode?: boolean;
		onToggle: (item: WatchlistItem) => Promise<void>;
		onRemove: (item: WatchlistItem) => Promise<void>;
		onOpenDetail: (item: WatchlistItem) => void;
		onToggleSelect?: (item: WatchlistItem) => void;
		onMoveUp?: (item: WatchlistItem) => void;
		onMoveDown?: (item: WatchlistItem) => void;
		/** Fires once a drag gesture settles, with the full new order — the
		 * accessible move up/down buttons call onMoveUp/onMoveDown instead and
		 * never touch this. */
		onReorder?: (newOrder: WatchlistItem[]) => void;
		seasonPicker: Snippet<[WatchlistItem]>;
	} = $props();

	let libraryPopupId: number | null = $state(null);

	// See QueueGridView.svelte for why grouping needs its own #each/flip scope
	// per section rather than one flat each with interleaved headers.
	let sections = $derived<CollectionSection[]>(
		groupByCollection ? groupIntoCollections(items, queueColors) : []
	);

	// See QueueGridView.svelte for why this is a writable $derived rather
	// than plain $state.
	let dndItems = $derived(items);
	const flipDurationMs = $derived(motion.reduced ? 0 : 250);
	function handleDndConsider(e: CustomEvent<{ items: WatchlistItem[] }>) {
		dndItems = e.detail.items;
	}
	function handleDndFinalize(e: CustomEvent<{ items: WatchlistItem[] }>) {
		dndItems = e.detail.items;
		onReorder?.(dndItems);
	}
</script>

<svelte:document
	onclick={(e) => {
		const t = e.target as Element;
		if (!t.closest('[data-library-popup]')) libraryPopupId = null;
	}}
/>

{#snippet rowContent(item: WatchlistItem, isFirst: boolean, isLast: boolean)}
	{@const rt = remainingRuntime(item)}
	{@const pct = Math.min(100, (rt / (budgetHours * 60)) * 100)}
	{@const hue = resolvedHue(item.providers[0]?.provider_id ?? null)}
	{@const lineColor = hue !== null ? `hsl(${hue} 60% 52%)` : '#9ca3af'}
	{@const dotColor = hue !== null ? `hsl(${hue} 70% 62%)` : '#6b7280'}
	<!-- Row 1: poster · title · actions -->
	{@const isSelected = selected.has(item.id)}
	<div class="flex items-center gap-3">
		{#if selectMode}
			<span
				class="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 text-xs font-bold {isSelected
					? 'border-orange-500 bg-orange-500 text-white'
					: 'border-gray-300 text-transparent dark:border-gray-600'}"
			>
				✓
			</span>
		{/if}
		<div class="relative h-12 w-8 shrink-0 overflow-hidden rounded bg-gray-200 dark:bg-gray-800">
			{#if item.poster_path}
				<img
					src="{TMDB_IMG}/w92{item.poster_path}"
					alt={item.title}
					class="h-full w-full object-cover"
				/>
			{:else}
				<div
					class="flex h-full w-full items-center justify-center text-sm text-gray-400 dark:text-gray-600"
				>
					🎬
				</div>
			{/if}
		</div>
		<button
			class="min-w-0 flex-1 text-left text-sm font-medium leading-tight hover:text-orange-500 transition-colors"
			onclick={(e) => {
				e.stopPropagation();
				if (selectMode) onToggleSelect?.(item);
				else onOpenDetail(item);
			}}
			data-detail-trigger>{item.title}</button
		>
		{#if queueControls.watchedOn && item.watched_at}
			<span
				class="shrink-0 rounded bg-teal-100 px-1.5 py-0.5 text-[10px] font-semibold text-teal-700 dark:bg-teal-900/60 dark:text-teal-400"
				>✓</span
			>
		{/if}
		{#if !selectMode}
			<div class="flex shrink-0 gap-1">
				{#if rankMode}
					<!-- svelte-dnd-action's dragHandle action makes this a real
					     role="button" tabindex="0" element unconditionally (it has
					     its own keyboard mode — pick up with space/enter, move with
					     arrow keys, drop with space/enter), so it's given a proper
					     label rather than hidden — the move up/down buttons beside
					     it remain a second, simpler accessible path (#231). The
					     role/tabindex/keydown handling the linter wants are all
					     supplied at runtime by the action, invisible to static
					     analysis. -->
					<!-- svelte-ignore a11y_click_events_have_key_events -->
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<div
						use:dragHandle
						aria-label="Drag to reorder {item.title}"
						class="touch-none cursor-grab rounded bg-gray-100 px-1.5 py-1 text-[10px] text-gray-500 select-none active:cursor-grabbing dark:bg-gray-800 dark:text-gray-400"
						onclick={(e) => e.stopPropagation()}
					>
						⠿
					</div>
					<button
						class="rounded bg-gray-100 px-1.5 py-1 text-[10px] text-gray-500 transition-colors hover:bg-gray-200 disabled:opacity-40 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700"
						disabled={isFirst}
						onclick={(e) => {
							e.stopPropagation();
							onMoveUp?.(item);
						}}
						aria-label="Move up">↑</button
					>
					<button
						class="rounded bg-gray-100 px-1.5 py-1 text-[10px] text-gray-500 transition-colors hover:bg-gray-200 disabled:opacity-40 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700"
						disabled={isLast}
						onclick={(e) => {
							e.stopPropagation();
							onMoveDown?.(item);
						}}
						aria-label="Move down">↓</button
					>
				{/if}
				<button
					class="rounded bg-gray-100 px-2 py-1 text-[10px] font-medium text-gray-700 transition-colors hover:bg-gray-200 disabled:opacity-40 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
					disabled={busy.has(item.id)}
					onclick={(e) => {
						e.stopPropagation();
						onToggle(item);
					}}
				>
					{item.watched_at ? 'Unwatch' : '✓'}
				</button>
				<button
					class="rounded bg-gray-100 px-1.5 py-1 text-[10px] text-gray-400 transition-colors hover:bg-red-100 hover:text-red-600 disabled:opacity-40 dark:bg-gray-800 dark:text-gray-500 dark:hover:bg-red-900/50 dark:hover:text-red-400"
					disabled={busy.has(item.id)}
					onclick={(e) => {
						e.stopPropagation();
						onRemove(item);
					}}
					aria-label="Remove">✕</button
				>
			</div>
		{/if}
	</div>

	<!-- Row 2: type chip · provider icons · sparkline · runtime -->
	<div class="ml-11 mt-1.5 flex items-center gap-2">
		<span
			class="shrink-0 rounded bg-gray-100 px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-gray-500 dark:bg-gray-800 dark:text-gray-400"
		>
			{item.media_type === 'movie' ? '🎬' : '📺'}
		</span>
		{#if item.notes}<span class="shrink-0 text-xs leading-none" title="Has a note">📝</span>{/if}
		{#if item.providers.length > 0}
			<div class="flex shrink-0 gap-0.5">
				{#each item.providers.slice(0, 3) as p (p.provider_id)}
					<img
						src="{TMDB_IMG}/w92{p.logo_path}"
						alt={p.provider_name}
						title={p.provider_name}
						class="h-3.5 w-3.5 rounded"
					/>
				{/each}
				{#if item.providers.length > 3}
					<span class="text-[9px] text-gray-400 dark:text-gray-600"
						>+{item.providers.length - 3}</span
					>
				{/if}
			</div>
		{:else if item.rentable}
			<span class="shrink-0 text-xs leading-none" title="Rent/Buy only">💲</span>
		{:else}
			{@const isOpen = libraryPopupId === item.id}
			<div class="relative shrink-0" data-library-popup>
				<button
					class="text-xs leading-none transition-opacity hover:opacity-60"
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
								href="https://www.kanopy.com/en/search?query={encodeURIComponent(item.title)}"
								target="_blank"
								rel="noopener noreferrer"
								class="text-[11px] text-gray-600 hover:text-orange-500 dark:text-gray-400 dark:hover:text-orange-400"
								>Kanopy →</a
							>
							<a
								href="https://www.hoopladigital.com/search?q={encodeURIComponent(item.title)}"
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
		<div class="relative min-w-0 flex-1">
			<div class="h-px w-full bg-gray-200 dark:bg-gray-800"></div>
			<div
				class="absolute top-0 left-0 h-px transition-all duration-300"
				style="width:{pct}%; background:{lineColor}; opacity:0.7;"
			></div>
			<div
				class="absolute top-1/2 -translate-y-1/2 h-1.5 w-1.5 rounded-full transition-all duration-300"
				style="left:{pct}%; margin-left:-3px; background:{dotColor};"
			></div>
		</div>
		<span class="shrink-0 w-12 text-right text-[10px] tabular-nums text-gray-500">
			{#if item.runtime_minutes}
				{formatRuntime(remainingRuntime(item), item.media_type)}
			{:else}
				<span class="italic">~{hms(DEFAULT_RUNTIME[item.media_type])}</span>
			{/if}
		</span>
	</div>

	<!-- Row 3: release chip (movies only; TV shows it in the season chip row) -->
	{#if item.media_type === 'movie' && releaseChip(item.release)}
		<p class="ml-11 mt-0.5 text-[10px] leading-snug text-amber-500 dark:text-amber-400">
			{releaseChip(item.release)}
		</p>
	{/if}

	<!-- Row 4: season picker -->
	{#if item.media_type === 'tv' && (item.seasons?.length || releaseChip(item.release))}
		<div class="ml-11 mt-1">
			{@render seasonPicker(item)}
		</div>
	{/if}
{/snippet}

{#if groupByCollection}
	<div class="space-y-4">
		{#each sections as section (section.name)}
			{@const sectionRemainingMins = section.items.reduce((sum, i) => sum + remainingRuntime(i), 0)}
			<div>
				<div class="flex items-center gap-2 pb-1.5">
					<span
						class="h-2.5 w-2.5 shrink-0 rounded-full"
						style="background:{section.color ?? '#9ca3af'}"
					></span>
					<h3
						class="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400"
					>
						{section.name}
					</h3>
					<span class="text-[10px] text-gray-400 dark:text-gray-600">{section.items.length}</span>
					<span class="text-[10px] text-gray-400 dark:text-gray-600"
						>· {hms(sectionRemainingMins)}</span
					>
				</div>
				<div class="divide-y divide-gray-200 overflow-hidden rounded-xl dark:divide-gray-800/60">
					{#each section.items as item, i (item.id)}
						{@const tagColor = item.queue_tag ? (queueColors[item.queue_tag] ?? null) : null}
						<!-- Row click is a convenience only — the title button inside rowContent
						     (data-detail-trigger) is the real, keyboard-reachable trigger for the same
						     action, so this div is deliberately not a second, nested interactive element. -->
						<!-- svelte-ignore a11y_click_events_have_key_events -->
						<!-- svelte-ignore a11y_no_static_element_interactions -->
						<div
							animate:flip={{ duration: motion.reduced ? 0 : 250 }}
							class="flex flex-col bg-white px-3 py-2.5 transition-colors hover:bg-gray-50 dark:bg-gray-900/40 dark:hover:bg-gray-900/80 cursor-pointer {selectMode &&
							selected.has(item.id)
								? '!bg-orange-50 dark:!bg-orange-950/30'
								: ''}"
							style={tagColor ? `border-left: 3px solid ${tagColor}` : ''}
							onclick={(e) => {
								e.stopPropagation();
								if (selectMode) onToggleSelect?.(item);
								else onOpenDetail(item);
							}}
						>
							{@render rowContent(item, i === 0, i === section.items.length - 1)}
						</div>
					{/each}
				</div>
			</div>
		{/each}
	</div>
{:else}
	<div
		class="divide-y divide-gray-200 overflow-hidden rounded-xl dark:divide-gray-800/60"
		use:dragHandleZone={{
			items: dndItems,
			flipDurationMs,
			dragDisabled: !rankMode,
			dropTargetStyle: {}
		}}
		onconsider={handleDndConsider}
		onfinalize={handleDndFinalize}
	>
		{#each dndItems as item, i (item.id)}
			{@const tagColor = item.queue_tag ? (queueColors[item.queue_tag] ?? null) : null}
			<!-- Row click is a convenience only — see the grouped branch above. -->
			<!-- svelte-ignore a11y_click_events_have_key_events -->
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div
				animate:flip={{ duration: flipDurationMs }}
				class="flex flex-col bg-white px-3 py-2.5 transition-colors hover:bg-gray-50 dark:bg-gray-900/40 dark:hover:bg-gray-900/80 cursor-pointer {selectMode &&
				selected.has(item.id)
					? '!bg-orange-50 dark:!bg-orange-950/30'
					: ''}"
				style={tagColor ? `border-left: 3px solid ${tagColor}` : ''}
				onclick={(e) => {
					e.stopPropagation();
					if (selectMode) onToggleSelect?.(item);
					else onOpenDetail(item);
				}}
			>
				{@render rowContent(item, i === 0, i === dndItems.length - 1)}
			</div>
		{/each}
	</div>
{/if}
