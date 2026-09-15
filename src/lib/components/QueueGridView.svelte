<script lang="ts">
	import type { Snippet } from 'svelte';
	import { flip } from 'svelte/animate';
	import { dragHandleZone, TRIGGERS } from 'svelte-dnd-action';
	import type { WatchlistItem } from '$lib/types';
	import { TMDB_IMG, formatRuntime } from '$lib/tmdb';
	import { resolvedHue } from '$lib/colors';
	import { remainingRuntime, releaseChip } from '$lib/progress';
	import { motion } from '$lib/motion.svelte';
	import { queueControls } from '$lib/queue-controls.svelte';
	import type { ItemChips } from '$lib/queue-actions';
	import { endDragSession, QUEUE_ITEM_ZONE_TYPE } from '$lib/drag-session.svelte';
	import DragHandle from './DragHandle.svelte';

	let {
		items,
		budgetHours,
		busy,
		chipsByItemId = new Map<number, ItemChips>(),
		selectMode = false,
		selected = new Set<number>(),
		dragBusy = false,
		onToggle,
		onRemove,
		onOpenDetail,
		onToggleSelect,
		onReorder,
		onDragStart,
		seasonPicker
	}: {
		items: WatchlistItem[];
		budgetHours: number;
		busy: Set<number>;
		/** Per-item list chips (personal stored + shared derived), keyed by
		 * item.id — precomputed by the caller once per visible-items recompute
		 * rather than re-derived per card (#274 PR2). */
		chipsByItemId?: Map<number, ItemChips>;
		selectMode?: boolean;
		selected?: Set<number>;
		/** True while the caller is persisting a reorder — pauses the drag
		 * zone so a second gesture can't start mid-write. Drag itself is
		 * otherwise always available (handles are persistent, not gated to
		 * any particular sort mode — picking one up switches to Rank). */
		dragBusy?: boolean;
		onToggle: (item: WatchlistItem) => Promise<void>;
		onRemove: (item: WatchlistItem) => Promise<void>;
		onOpenDetail: (item: WatchlistItem) => void;
		onToggleSelect?: (item: WatchlistItem) => void;
		/** Fires once a drag gesture settles, with the full new order. */
		onReorder?: (newOrder: WatchlistItem[]) => void;
		/** Fires once, at the very start of a drag gesture, before any
		 * reorder tracking, with the id of the item that was picked up — the
		 * caller's chance to snapshot the current visual order into place and
		 * switch sort to Rank without a jump (see queue-actions.ts's
		 * snapshotSortOrderLocally), and to populate the drop-zone action bar
		 * (drag-session.svelte.ts) with actions bound to this item. */
		onDragStart?: (id: number) => void;
		seasonPicker: Snippet<[WatchlistItem]>;
	} = $props();

	let libraryPopupId: number | null = $state(null);

	// Local mirror for the drag zone (#231) — svelte-dnd-action needs a plain
	// array it can reorder live during a drag via onconsider, before anything
	// is actually persisted. A writable $derived: reassigning it during a
	// drag holds until `items` itself changes again (filtering, a completed
	// reorder reloading the queue, ...), which only happens between drags,
	// so it never fights the live reorder mid-gesture.
	let dndItems = $derived(items);
	const flipDurationMs = $derived(motion.reduced ? 0 : 250);
	function handleDndConsider(
		e: CustomEvent<{ items: WatchlistItem[]; info: { trigger: TRIGGERS; id: string } }>
	) {
		if (e.detail.info.trigger === TRIGGERS.DRAG_STARTED) onDragStart?.(Number(e.detail.info.id));
		dndItems = e.detail.items;
	}
	function handleDndFinalize(
		e: CustomEvent<{ items: WatchlistItem[]; info: { trigger: TRIGGERS } }>
	) {
		endDragSession();
		// The item was claimed by a drop-zone action-bar tile instead of a
		// normal in-zone reorder — that tile's own action already did the
		// real work (see DragActionTile.svelte), and svelte-dnd-action has
		// already removed the item from this zone's tracked items by this
		// point (it dispatched a "dragged left" consider event the moment the
		// pointer crossed into the tile's zone). Resetting to the original
		// `items` prop, rather than adopting e.detail.items, is what keeps
		// the card from visually vanishing from this view.
		if (e.detail.info.trigger === TRIGGERS.DROPPED_INTO_ANOTHER) {
			dndItems = items;
			return;
		}
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

{#snippet cardContent(item: WatchlistItem)}
	{@const chips = chipsByItemId.get(item.id)}
	{@const cardHue = resolvedHue(item.providers[0]?.provider_id ?? null)}
	{@const cardPct = Math.min(100, (remainingRuntime(item) / (budgetHours * 60)) * 100)}
	{@const cardLine = cardHue !== null ? `hsl(${cardHue} 60% 52%)` : '#374151'}
	{@const cardDot = cardHue !== null ? `hsl(${cardHue} 70% 62%)` : '#4b5563'}
	{@const isSelected = selected.has(item.id)}
	<button
		class="relative aspect-[2/3] overflow-hidden rounded-t-xl bg-gray-200 dark:bg-gray-800 w-full cursor-pointer"
		onclick={(e) => {
			e.stopPropagation();
			if (selectMode) onToggleSelect?.(item);
			else onOpenDetail(item);
		}}
		data-detail-trigger
		aria-label={selectMode
			? `${isSelected ? 'Deselect' : 'Select'} ${item.title}`
			: `View details for ${item.title}`}
	>
		{#if item.poster_path}
			<img
				src="{TMDB_IMG}/w300{item.poster_path}"
				alt={item.title}
				loading="lazy"
				decoding="async"
				class="h-full w-full object-cover"
			/>
		{:else}
			<div
				class="flex h-full w-full items-center justify-center text-4xl text-gray-400 dark:text-gray-600"
			>
				🎬
			</div>
		{/if}
		{#if selectMode}
			<span
				class="absolute top-2 right-2 flex h-5 w-5 items-center justify-center rounded-full border-2 text-xs font-bold {isSelected
					? 'border-orange-500 bg-orange-500 text-white'
					: 'border-white bg-black/40 text-transparent'}"
			>
				✓
			</span>
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
		<!-- Type chip + providers -->
		<div class="flex flex-wrap items-center gap-1">
			<span class="rounded bg-gray-100 px-1 py-0.5 text-[11px] dark:bg-gray-800">
				{item.media_type === 'movie' ? '🎬' : '📺'}
			</span>
			{#if item.notes}<span class="text-sm leading-none" title="Has a note">📝</span>{/if}
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
								<p class="mb-1.5 text-[10px] font-semibold text-gray-500 dark:text-gray-400">
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
			{/if}
		</div>
		<!-- List chips (#274 PR2) — personal (filled) and shared-derived
		     (outlined) rendered as visually distinct clusters, since a
		     promoted personal list and its same-named shared counterpart can
		     both be active on one item at once and would otherwise look like
		     an accidental duplicate chip. -->
		{#if chips && (chips.personal.length || chips.shared.length)}
			<div class="flex flex-col gap-1">
				{#if chips.personal.length}
					<div class="flex flex-wrap gap-1">
						{#each chips.personal as chip (chip.name)}
							<span
								class="rounded-full px-2 py-0.5 text-[10px] font-medium text-white"
								style="background:{chip.color}"
							>
								{chip.name}
							</span>
						{/each}
					</div>
				{/if}
				{#if chips.shared.length}
					<div class="flex flex-wrap gap-1">
						{#each chips.shared as chip (chip.name)}
							<span
								class="rounded-full border px-2 py-0.5 text-[10px] font-medium"
								style="border-color:{chip.color}; color:{chip.color}"
							>
								{chip.name}
							</span>
						{/each}
					</div>
				{/if}
			</div>
		{/if}
		{#if item.media_type === 'movie' && releaseChip(item.release)}
			<p class="text-xs leading-snug text-amber-600 dark:text-amber-400">
				{releaseChip(item.release)}
			</p>
		{/if}
		{#if !selectMode}
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
		{/if}
	</div>
	{#if !selectMode}
		<DragHandle variant="card" label={item.title} />
	{/if}
{/snippet}

<!-- The drag zone is the grid container itself, not a wrapping div — an
     earlier `class="contents"` wrapper (#231) kept an extra element out of
     CSS grid layout so cards stayed direct grid children, but
     svelte-dnd-action's pointer tracking calls getBoundingClientRect() on
     the zone element to decide whether the pointer is over it at all, and
     `display: contents` elements always report a zero-size rect — so that
     check silently failed for the entire gesture and cards never reordered
     on drop. Applying the action straight to the real grid box fixes both
     at once: it's the layout container needed anyway, and now it has an
     actual rect to hit-test against. -->
<div
	class="grid grid-cols-2 gap-3 sm:gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5"
	use:dragHandleZone={{
		items: dndItems,
		type: QUEUE_ITEM_ZONE_TYPE,
		// Deliberately NOT the same flipDurationMs passed to animate:flip
		// below. svelte-dnd-action reuses this same number to pace its own
		// cross-zone polling loop (setInterval ≈ max(this, 100ms) — see its
		// source), so the 250ms that looks right for the reorder-flip
		// animation also means the library only re-checks "which zone is the
		// pointer over" every ~267ms. A normal decisive swipe down to the
		// drop-zone action bar (#294-drag Phase 2) can finish well inside
		// that window, landing back in this zone instead of the target tile.
		// 0 here drops the library into its fast ~21ms polling path; the
		// visual reorder animation is unaffected since it's driven by
		// animate:flip's own separate duration, not this option.
		flipDurationMs: 0,
		dragDisabled: dragBusy,
		dropTargetStyle: {},
		dropFromOthersDisabled: true,
		delayTouchStart: true,
		// The handle sits at the card's bottom edge, not its center, so the
		// library's default zone/index hit-testing (the dragged element's own
		// center) would trail well behind the actual touch point — most
		// visibly reaching for the drop-zone action bar, which needs the
		// cursor's real position to be reachable at all.
		useCursorForDetection: true
	}}
	onconsider={handleDndConsider}
	onfinalize={handleDndFinalize}
>
	{#each dndItems as item (item.id)}
		<!-- Card click is a convenience only — the poster button inside cardContent
		     (data-detail-trigger) is the real, keyboard-reachable trigger for the same
		     action, so this div is deliberately not a second, nested interactive element. -->
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			animate:flip={{ duration: flipDurationMs }}
			class="flex flex-col rounded-xl bg-white ring-1 ring-gray-200 dark:bg-gray-900 dark:ring-0 cursor-pointer {selectMode &&
			selected.has(item.id)
				? '!ring-2 !ring-orange-500'
				: ''}"
			onclick={(e) => {
				e.stopPropagation();
				if (selectMode) onToggleSelect?.(item);
				else onOpenDetail(item);
			}}
		>
			{@render cardContent(item)}
		</div>
	{/each}
</div>
