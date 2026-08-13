<script lang="ts">
	import type { Snippet } from 'svelte';
	import { flip } from 'svelte/animate';
	import { SvelteMap } from 'svelte/reactivity';
	import type { WatchlistItem } from '$lib/types';
	import { TMDB_IMG, formatRuntime } from '$lib/tmdb';
	import { laneColors, resolvedHue } from '$lib/colors';
	import { theme } from '$lib/theme.svelte';
	import { remainingRuntime, hms } from '$lib/progress';
	import { motion } from '$lib/motion.svelte';
	import { queueControls } from '$lib/queue-controls.svelte';

	const BAR_H = 32; // px — compact chip height

	type Lane = {
		key: string;
		label: string;
		logo: string | null;
		providerId: number | null;
		items: WatchlistItem[];
		totalMins: number;
		overMins: number;
	};

	let {
		items,
		budgetHours,
		busy,
		onToggle,
		onRemove,
		seasonPicker
	}: {
		// Pre-filtered and pre-sorted (by the shared sort control) — grouping
		// into lanes preserves that order rather than re-sorting the items.
		items: WatchlistItem[];
		budgetHours: number;
		busy: Set<number>;
		onToggle: (item: WatchlistItem, onSuccess?: () => void) => Promise<void>;
		onRemove: (item: WatchlistItem, onSuccess?: () => void) => Promise<void>;
		seasonPicker: Snippet<[WatchlistItem]>;
	} = $props();

	function overLabel(mins: number): string {
		const h = mins / 60;
		return `+${h % 1 === 0 ? h : h.toFixed(1)}h over`;
	}
	let lanes = $derived.by((): Lane[] => {
		const budgetMins = budgetHours * 60;
		const map = new SvelteMap<
			string,
			Omit<Lane, 'overMins' | 'totalMins'> & { totalMins: number }
		>();
		const noProvider: WatchlistItem[] = [];

		for (const item of items) {
			if (!item.providers.length) {
				noProvider.push(item);
			} else {
				const p = item.providers[0];
				if (!map.has(p.provider_name)) {
					map.set(p.provider_name, {
						key: p.provider_name,
						label: p.provider_name,
						logo: p.logo_path,
						providerId: p.provider_id,
						items: [],
						totalMins: 0
					});
				}
				const lane = map.get(p.provider_name)!;
				lane.items.push(item);
				lane.totalMins += remainingRuntime(item);
			}
		}

		const laneMul = queueControls.sortDir === 'asc' ? 1 : -1;
		const out: Lane[] = [...map.values()]
			.sort((a, b) => {
				if (queueControls.sortBy === 'title') return a.label.localeCompare(b.label) * laneMul;
				if (queueControls.sortBy === 'added') {
					const aMax = a.items.reduce((m, i) => (i.added_at > m ? i.added_at : m), '');
					const bMax = b.items.reduce((m, i) => (i.added_at > m ? i.added_at : m), '');
					return aMax.localeCompare(bMax) * laneMul;
				}
				return (a.totalMins - b.totalMins) * laneMul;
			})
			.map((l) => ({ ...l, overMins: Math.max(0, l.totalMins - budgetMins) }));

		if (noProvider.length) {
			const totalMins = noProvider.reduce((s, i) => s + remainingRuntime(i), 0);
			out.push({
				key: '__none__',
				label: 'Not Streaming',
				logo: null,
				providerId: null,
				items: noProvider,
				totalMins,
				overMins: Math.max(0, totalMins - budgetMins)
			});
		}
		return out;
	});

	// Gantt detail popup — fixed-position to escape the overflow:hidden budget zone
	let activeItem = $state<WatchlistItem | null>(null);
	let ganttPopupAnchor = $state<{ x: number; y: number } | null>(null);

	function openGanttPopup(e: MouseEvent, item: WatchlistItem) {
		e.stopPropagation();
		if (activeItem?.id === item.id) {
			closePopup();
			return;
		}
		const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
		ganttPopupAnchor = {
			x: Math.min(rect.left, window.innerWidth - 248),
			y: rect.bottom + 8
		};
		activeItem = item;
	}

	function closePopup() {
		activeItem = null;
		ganttPopupAnchor = null;
	}
</script>

<svelte:document
	onclick={(e) => {
		const t = e.target as Element;
		if (activeItem && !t.closest('[data-item]')) closePopup();
	}}
/>

<!-- X-axis header -->
<div class="flex items-center gap-0 pl-40">
	<div class="flex-1 border-t border-dashed border-gray-300 pt-1 dark:border-gray-700">
		<div class="flex justify-between text-[10px] text-gray-400 dark:text-gray-600">
			<span>0</span>
			<span class="font-medium text-gray-500">{budgetHours}h / mo</span>
		</div>
	</div>
</div>

<div class="space-y-1.5">
	{#each lanes as lane (lane.key)}
		{@const colors = laneColors(resolvedHue(lane.providerId), theme.dark)}
		{@const budgetMins = budgetHours * 60}

		<div
			class="flex items-stretch overflow-visible rounded-xl"
			style="background:{colors.row}; border-left:{colors.border};"
		>
			<!-- Lane header -->
			<div
				class="flex w-40 shrink-0 flex-col items-center justify-center gap-1.5 px-3 py-2.5 text-center"
				style="background:{colors.header};"
			>
				{#if lane.logo}
					<img
						src="{TMDB_IMG}/w92{lane.logo}"
						alt={lane.label}
						class="h-8 w-8 rounded-lg object-cover shadow"
					/>
				{:else}
					<div
						class="flex h-8 w-8 items-center justify-center rounded-lg bg-gray-200 text-base dark:bg-gray-800"
					>
						📺
					</div>
				{/if}
				<p class="text-[11px] font-semibold leading-tight" style="color:{colors.labelText}">
					{lane.label}
				</p>
				<p class="text-[10px] text-gray-400 dark:text-gray-600">
					{lane.items.length} title{lane.items.length === 1 ? '' : 's'} · {hms(lane.totalMins)}
				</p>
			</div>

			<!-- Budget zone: clips at month boundary -->
			<div class="relative min-w-0 flex-1 overflow-hidden py-3 pr-0">
				<!-- Month-end marker line -->
				<div
					class="pointer-events-none absolute inset-y-0 right-0 w-px border-r border-dashed border-white/15"
				></div>

				<!-- Bar ribbon -->
				<div class="flex h-8 items-stretch gap-0 pl-2">
					{#each lane.items as item (item.id)}
						{@const pct = (remainingRuntime(item) / budgetMins) * 100}
						{@const isActive = activeItem?.id === item.id}
						{@const posterW = Math.round((BAR_H * 2) / 3)}

						<div
							animate:flip={{ duration: motion.reduced ? 0 : 250 }}
							class="relative shrink-0"
							style="flex: 0 0 {pct}%; min-width: 18px;"
							data-item
						>
							<button
								class="group relative flex h-full w-full items-stretch overflow-hidden transition-all duration-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-orange-400 {isActive
									? 'ring-2 ring-white/50 brightness-125'
									: 'hover:brightness-110'}"
								style="background:{colors.barGradient}; box-shadow: inset 0 0 0 1px {colors.barStroke.replace(
									'1px solid ',
									''
								)};"
								onclick={(e) => openGanttPopup(e, item)}
								title="{item.title} · {formatRuntime(
									remainingRuntime(item),
									item.media_type
								)} remaining"
							>
								{#if item.poster_path}
									<img
										src="{TMDB_IMG}/w92{item.poster_path}"
										alt=""
										class="h-full shrink-0 object-cover"
										style="width:{posterW}px;"
									/>
								{/if}
								<div class="flex min-w-0 flex-col justify-center gap-0.5 px-1.5">
									<p class="truncate text-[10px] font-semibold leading-tight text-white/90">
										{item.title}
									</p>
									<p class="truncate text-[9px] leading-tight text-white/50">
										{formatRuntime(remainingRuntime(item), item.media_type)}
									</p>
								</div>
							</button>
						</div>
					{/each}
				</div>
			</div>

			<!-- Overflow badge (outside the clipped zone) -->
			{#if lane.overMins > 0}
				<div class="flex shrink-0 items-center px-2">
					<span
						class="whitespace-nowrap rounded-full bg-orange-500/15 px-2 py-0.5 text-[10px] font-semibold text-orange-400"
					>
						{overLabel(lane.overMins)}
					</span>
				</div>
			{/if}
		</div>
	{/each}
</div>

{#if lanes.length > 1}
	<p class="pt-1 text-center text-[11px] text-gray-400 dark:text-gray-700">
		Timeline sorted by filter selection · bar width = runtime · budget = {budgetHours}h/mo
	</p>
{/if}

<!-- ── Gantt detail popup (fixed-position, escapes overflow:hidden) ──────── -->
{#if activeItem && ganttPopupAnchor}
	<div
		class="fixed z-50 w-56 rounded-xl bg-white p-3 shadow-2xl ring-1 ring-gray-200 dark:bg-gray-800 dark:ring-white/10"
		style="left:{ganttPopupAnchor.x}px; top:{ganttPopupAnchor.y}px;"
		data-item
	>
		<p class="mb-1 text-sm font-semibold leading-snug">{activeItem.title}</p>
		<p class="mb-1 text-xs text-gray-500 dark:text-gray-400">
			🕐 {formatRuntime(remainingRuntime(activeItem), activeItem.media_type)} remaining
		</p>
		{@render seasonPicker(activeItem)}
		<div class="mt-2 mb-2 flex flex-wrap items-center gap-1">
			<span class="rounded bg-gray-100 px-1 py-0.5 text-[11px] dark:bg-gray-700">
				{activeItem.media_type === 'movie' ? '🎬' : '📺'}
			</span>
			{#each activeItem.providers as p (p.provider_id)}
				<img
					src="{TMDB_IMG}/w92{p.logo_path}"
					alt={p.provider_name}
					title={p.provider_name}
					class="h-5 w-5 rounded"
				/>
			{/each}
		</div>
		<div class="flex gap-1.5">
			<button
				class="flex-1 rounded-md bg-gray-100 py-1.5 text-xs font-medium transition-colors hover:bg-gray-200 disabled:opacity-40 dark:bg-gray-700 dark:hover:bg-gray-600"
				disabled={busy.has(activeItem.id)}
				onclick={() => onToggle(activeItem!, closePopup)}
			>
				{activeItem.watched_at ? 'Unwatch' : '✓ Watched'}
			</button>
			<button
				class="rounded-md bg-gray-100 px-2.5 py-1.5 text-xs text-gray-400 transition-colors hover:bg-red-100 hover:text-red-600 disabled:opacity-40 dark:bg-gray-700 dark:hover:bg-red-900/50 dark:hover:text-red-400"
				disabled={busy.has(activeItem.id)}
				onclick={() => onRemove(activeItem!, closePopup)}
				aria-label="Remove">✕</button
			>
		</div>
	</div>
{/if}
