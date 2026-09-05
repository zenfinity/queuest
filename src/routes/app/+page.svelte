<script lang="ts">
	import { onMount } from 'svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import { resolve } from '$app/paths';
	import type { WatchlistItem } from '$lib/types';
	import {
		reloadQueue,
		toggleWatched,
		removeQueueItem,
		toggleSeasonProgress,
		listCollections,
		setItemCollection,
		setItemNote,
		moveItem,
		reorderItems,
		bulkSetCollection,
		bulkSetWatched,
		bulkRemove,
		type QueueActionDeps
	} from '$lib/queue-actions';
	import { TMDB_IMG, formatRuntime } from '$lib/tmdb';
	import {
		remainingRuntime,
		releaseChip,
		cancelCandidates,
		hms,
		saveBudgetPrefs,
		DEFAULT_BUDGET_HOURS
	} from '$lib/progress';
	import { getQueueColors, sharedListColor } from '$lib/queue-colors';
	import {
		listCollections as listSharedCollections,
		addItemsToSharedCollection,
		type SharedCollection,
		type CollectionActionDeps
	} from '$lib/collection-actions';
	import { isSyncEnabled } from '$lib/sync';
	import { services, ensureSubscribedLoaded } from '$lib/services.svelte';
	import SharedListSection from '$lib/components/SharedListSection.svelte';
	import {
		queueControls,
		SORT_DEFAULT_DIR,
		UNCATEGORIZED,
		sharedFilterId
	} from '$lib/queue-controls.svelte';
	import type { SortKey, ViewKey } from '$lib/queue-controls.svelte';
	import { readNumber, readRecord, readBoolean } from '$lib/storage';
	import DetailPanel from '$lib/components/DetailPanel.svelte';
	import QueueGanttView from '$lib/components/QueueGanttView.svelte';
	import QueueListView from '$lib/components/QueueListView.svelte';
	import QueueGridView from '$lib/components/QueueGridView.svelte';
	import ListHint from '$lib/components/ListHint.svelte';
	import SyncHint from '$lib/components/SyncHint.svelte';
	import Button from '$lib/components/Button.svelte';

	// ── Persisted prefs ───────────────────────────────────────────────────────
	function loadPref<T extends string>(key: string, fallback: T): T {
		try {
			return (localStorage.getItem(key) as T) ?? fallback;
		} catch {
			return fallback;
		}
	}
	// ── Core state ────────────────────────────────────────────────────────────
	let items = $state<WatchlistItem[]>([]);
	let loaded = $state(false);
	let queueColors = $state<Record<string, string>>({});
	let busy = new SvelteSet<number>();
	let sharedCollections = $state<SharedCollection[]>([]);
	let sharedListColors = $state<Record<string, string>>({});
	let sharedFilterStats: { count: number; remainingMins: number } | null = $state(null);
	let syncEnabled = $state(false);

	// ── Bulk selection (#113) ────────────────────────────────────────────────
	let selectMode = $state(false);
	let selectedIds = new SvelteSet<number>();
	let bulkTargetTag = $state('');
	let bulkNewTag = $state('');
	let bulkRemoveArmed = $state(false);
	let bulkBusy = $state(false);

	function exitSelectMode() {
		selectMode = false;
		selectedIds.clear();
		bulkTargetTag = '';
		bulkNewTag = '';
		bulkRemoveArmed = false;
	}

	function toggleSelected(item: WatchlistItem) {
		if (selectedIds.has(item.id)) selectedIds.delete(item.id);
		else selectedIds.add(item.id);
		bulkRemoveArmed = false;
	}

	function selectedItems(): WatchlistItem[] {
		return items.filter((i) => selectedIds.has(i.id));
	}

	async function bulkAssign() {
		bulkBusy = true;
		try {
			if (bulkTargetTag.startsWith('shared:') && !bulkNewTag.trim()) {
				const coll = sharedCollections.find((c) => c.id === bulkTargetTag.slice(7));
				if (coll) {
					const ok = await addItemsToSharedCollection(coll, selectedItems(), collectionActionDeps);
					if (ok) await reload();
				}
			} else {
				const tag = bulkNewTag.trim() || bulkTargetTag || null;
				await bulkSetCollection(selectedItems(), tag, actionDeps);
			}
		} finally {
			bulkBusy = false;
		}
		exitSelectMode();
	}

	async function bulkClearCollection() {
		bulkBusy = true;
		try {
			await bulkSetCollection(selectedItems(), null, actionDeps);
		} finally {
			bulkBusy = false;
		}
		exitSelectMode();
	}

	async function bulkMarkWatched(watched: boolean) {
		bulkBusy = true;
		try {
			await bulkSetWatched(selectedItems(), watched, actionDeps);
		} finally {
			bulkBusy = false;
		}
		exitSelectMode();
	}

	async function bulkRemoveSelected() {
		if (!bulkRemoveArmed) {
			bulkRemoveArmed = true;
			return;
		}
		bulkBusy = true;
		try {
			await bulkRemove(selectedItems(), actionDeps);
		} finally {
			bulkBusy = false;
		}
		exitSelectMode();
	}

	// Leaving Grid/List (the only views selection is wired into) drops selection
	// rather than leaving it silently active somewhere it can't be seen or acted on.
	$effect(() => {
		if (queueControls.viewMode === 'lanes' && selectMode) exitSelectMode();
	});

	let releasePopupId: number | null = $state(null);
	let detailItem: WatchlistItem | null = $state(null);

	let budgetHours = $state(DEFAULT_BUDGET_HOURS); // user-adjustable month budget

	// ── Budget callout (first visit) ─────────────────────────────────────────
	let showBudgetCallout = $state(false);
	let calloutHoursPerWeek = $state(10);
	let calloutWeeksPerMonth = $state(4);

	function saveBudgetCallout() {
		saveBudgetPrefs(calloutHoursPerWeek, calloutWeeksPerMonth);
		budgetHours = calloutHoursPerWeek * calloutWeeksPerMonth;
		showBudgetCallout = false;
	}

	function dismissBudgetCallout() {
		try {
			localStorage.setItem('sq:budget-callout-dismissed', 'true');
		} catch {
			// Best-effort localStorage write; callout dismissal always hides UI regardless
		}
		showBudgetCallout = false;
	}

	// ── Cancellation alerts ───────────────────────────────────────────────────
	let cancelAlertsEnabled = $state(false);
	let dismissedAlerts = $state<Record<string, string>>({});

	function dismissAlert(providerId: number) {
		const updated = {
			...dismissedAlerts,
			[String(providerId)]: new Date().toISOString().slice(0, 10)
		};
		dismissedAlerts = updated;
		try {
			localStorage.setItem('sq:dismiss-cancel', JSON.stringify(updated));
		} catch {
			// Best-effort localStorage write; dismissed alerts persist in memory regardless
		}
	}

	let cancelAlert = $derived.by(() => {
		if (!loaded || !cancelAlertsEnabled) return null;
		const candidates = cancelCandidates(queued, budgetHours, dismissedAlerts, services.ids);
		return candidates[0] ?? null;
	});

	// ── Derived lists ─────────────────────────────────────────────────────────
	// "queued" always means unwatched, independent of the Watched toggle — used for cancel alerts.
	let queued = $derived(items.filter((i) => !i.watched_at));

	// Existing collections in the queue for the detail panel picker — includes
	// collections created empty in Settings (Object.keys(queueColors)), which
	// have no items tagged yet so listCollections(items) alone would miss them.
	let existingCollections = $derived(listCollections(items, Object.keys(queueColors)));

	// A `shared:<id>` collectionFilter fills the main view with that one list
	// instead of a personal-queue tag (#205) — same picker, same convention.
	let activeSharedId = $derived(sharedFilterId(queueControls.collectionFilter));
	let activeSharedCollection = $derived(
		sharedCollections.find((c) => c.id === activeSharedId) ?? null
	);
	// The below-queue "Shared Lists" browse section excludes whichever list is
	// already filling the main view — otherwise it'd appear twice on screen.
	let otherSharedCollections = $derived(sharedCollections.filter((c) => c.id !== activeSharedId));

	// Watched toggle is inclusive: off shows only unwatched titles, on mixes in watched titles too.
	let baseItems = $derived(queueControls.watchedOn ? items : queued);

	let serviceFiltered = $derived.by(() => {
		if (queueControls.serviceFilter === 'all' || services.ids.size === 0) return baseItems;
		if (queueControls.serviceFilter === 'subscribed') {
			return baseItems.filter((item) =>
				item.providers.some((p) => services.ids.has(p.provider_id))
			);
		}
		// not-subscribed: has providers, none of which are subscribed
		return baseItems.filter(
			(item) =>
				item.providers.length > 0 && !item.providers.some((p) => services.ids.has(p.provider_id))
		);
	});

	let visibleItems = $derived.by(() => {
		if (queueControls.collectionFilter === null) return serviceFiltered;
		if (queueControls.collectionFilter === UNCATEGORIZED) {
			return serviceFiltered.filter((item) => !item.queue_tag);
		}
		return serviceFiltered.filter((item) => item.queue_tag === queueControls.collectionFilter);
	});

	function sorted(list: WatchlistItem[]): WatchlistItem[] {
		const mul = queueControls.sortDir === 'asc' ? 1 : -1;
		// remainingRuntime() walks the item's seasons, so compute it once per
		// item (#246) rather than ~2·N·log N times inside the comparator.
		const runtimeOf =
			queueControls.sortBy === 'runtime'
				? new Map(list.map((item) => [item, remainingRuntime(item)]))
				: null;
		return [...list].sort((a, b) => {
			if (queueControls.sortBy === 'title') return a.title.localeCompare(b.title) * mul;
			if (runtimeOf) {
				return ((runtimeOf.get(a) ?? 0) - (runtimeOf.get(b) ?? 0)) * mul;
			}
			if (queueControls.sortBy === 'rank') {
				return ((a.sort_order ?? 0) - (b.sort_order ?? 0)) * mul;
			}
			return a.added_at.localeCompare(b.added_at) * mul;
		});
	}

	let flatItems = $derived(sorted(visibleItems));

	// Move-up/down (#216) only has a clear meaning against a single flat
	// order — grouped-by-collection sections are alphabetical, and
	// reordering "across" them isn't a defined operation, so the controls
	// are suppressed rather than picking an arbitrary one.
	let rankMode = $derived(queueControls.sortBy === 'rank' && !queueControls.groupByCollection);

	// ── Lifecycle ─────────────────────────────────────────────────────────────
	let dbError = $state('');

	const actionDeps: QueueActionDeps = {
		setItems: (next) => {
			items = next;
		},
		setBusy: (id, isBusy) => {
			if (isBusy) busy.add(id);
			else busy.delete(id);
		},
		setError: (message) => {
			dbError = message;
		}
	};

	async function reload() {
		await reloadQueue(actionDeps);
	}

	async function moveUp(item: WatchlistItem) {
		await moveItem(item, 'up', flatItems, actionDeps);
	}
	async function moveDown(item: WatchlistItem) {
		await moveItem(item, 'down', flatItems, actionDeps);
	}
	async function reorderRankedItems(newOrder: WatchlistItem[]) {
		await reorderItems(newOrder, actionDeps);
	}

	const collectionActionDeps: CollectionActionDeps = {
		setBusy: () => {},
		setError: (message) => {
			dbError = message;
		}
	};

	async function loadSharedCollections() {
		sharedCollections = await listSharedCollections({ setBusy: () => {}, setError: () => {} });
		const updated: Record<string, string> = {};
		for (const coll of sharedCollections) updated[coll.id] = sharedListColor(coll);
		sharedListColors = updated;
	}

	onMount(() => {
		queueControls.sortBy = loadPref<SortKey>('sq:sort', 'added');
		queueControls.sortDir = loadPref<'asc' | 'desc'>(
			'sq:sortDir',
			SORT_DEFAULT_DIR[queueControls.sortBy]
		);
		queueControls.viewMode = loadPref<ViewKey>('sq:view', 'grid');
		queueControls.ready = true;
		budgetHours = readNumber('sq:budget', DEFAULT_BUDGET_HOURS);
		queueColors = getQueueColors();
		cancelAlertsEnabled = readBoolean('sq:cancel-alerts', false);
		dismissedAlerts = readRecord('sq:dismiss-cancel', {});

		const hasBudget = localStorage.getItem('sq:budget:weekly') !== null;
		const wasDismissed = localStorage.getItem('sq:budget-callout-dismissed') === 'true';
		if (!hasBudget && !wasDismissed) showBudgetCallout = true;

		// "Save before leaving" — browser native dialog when navigating away from the site
		function onBeforeUnload(e: BeforeUnloadEvent) {
			if (items.length > 0) e.preventDefault();
		}
		window.addEventListener('beforeunload', onBeforeUnload);

		Promise.all([reload(), ensureSubscribedLoaded()]).then(() => {
			loaded = true;
		});

		isSyncEnabled().then((enabled) => {
			syncEnabled = enabled;
			if (enabled) loadSharedCollections();
		});

		return () => window.removeEventListener('beforeunload', onBeforeUnload);
	});

	$effect(() => {
		try {
			localStorage.setItem('sq:sort', queueControls.sortBy);
			localStorage.setItem('sq:sortDir', queueControls.sortDir);
			localStorage.setItem('sq:view', queueControls.viewMode);
			localStorage.setItem('sq:budget', JSON.stringify(budgetHours));
		} catch {
			// Best-effort localStorage write; app works fine without persisted preferences
		}
	});

	// "Subscribed" filter is meaningless with zero subscribed services — fall back to "All".
	$effect(() => {
		if (queueControls.serviceFilter === 'subscribed' && services.ids.size === 0)
			queueControls.serviceFilter = 'all';
	});

	// Mirrors collection names into shared state so QueueDock (rendered from the
	// layout, without direct access to `items`) can list them in its popover.
	$effect(() => {
		queueControls.collectionNames = existingCollections;
	});

	// Same mirroring for shared lists, so QueueDock can offer them as filter
	// options too (#205).
	$effect(() => {
		queueControls.sharedListOptions = sharedCollections.map((c) => ({
			id: c.id,
			name: c.name,
			color: sharedListColors[c.id] ?? '#9ca3af'
		}));
	});

	// Clears a collection filter that no longer matches anything (the collection
	// was renamed/deleted, or its last item was removed/recategorized) — same
	// "never silently filter forever" convention as the subscribed-filter reset above.
	// Shared filters are exempt: `sharedCollections` loads asynchronously after
	// mount, so checking membership here would clear a just-restored `shared:`
	// filter before the list has had a chance to load.
	$effect(() => {
		const f = queueControls.collectionFilter;
		if (
			f !== null &&
			f !== UNCATEGORIZED &&
			sharedFilterId(f) === null &&
			!existingCollections.includes(f)
		) {
			queueControls.collectionFilter = null;
		}
	});

	// A shared filter has no select-mode analog (bulk actions operate on
	// personal WatchlistItems by local id) — leaving it active would show a
	// Select button with nothing for it to do.
	$effect(() => {
		if (activeSharedCollection && selectMode) exitSelectMode();
	});

	// Lets the nav know whether the dock has anything to show, for the lg+ inline placement.
	// Shared lists count too — their sections read the same sort/watched/service
	// filters, so the dock earns its keep even when the personal queue is empty.
	$effect(() => {
		queueControls.hasItems = loaded && (items.length > 0 || sharedCollections.length > 0);
	});

	// ── Actions ───────────────────────────────────────────────────────────────
	async function toggle(item: WatchlistItem, onSuccess?: () => void) {
		await toggleWatched(item, actionDeps, onSuccess);
	}
	async function remove(item: WatchlistItem, onSuccess?: () => void) {
		await removeQueueItem(item, actionDeps, onSuccess);
	}

	// ── Season progress ───────────────────────────────────────────────────────
	async function toggleSeason(item: WatchlistItem, seasonNum: number) {
		await toggleSeasonProgress(item, seasonNum, actionDeps);
	}
</script>

<svelte:head><title>Queuest — My Queue</title></svelte:head>

<svelte:document
	onclick={(e) => {
		const t = e.target as Element;
		if (!t.closest('[data-release-popup]')) {
			releasePopupId = null;
		}
	}}
/>

{#snippet seasonPicker(item: WatchlistItem)}
	{@const chip = releaseChip(item.release)}
	{#if item.media_type === 'tv' && (item.seasons?.length || chip)}
		<div class="flex flex-wrap gap-0.5 pt-0.5">
			{#each (item.seasons ?? []).filter((s) => s.episode_count > 0 && (!chip || item.release?.next_season == null || s.season_number < item.release.next_season)) as season (season.season_number)}
				{@const watched = (item.watched_seasons ?? []).includes(season.season_number)}
				<button
					class="inline-flex items-center rounded px-1.5 py-0.5 text-[9px] font-semibold leading-none transition-colors
						{watched
						? 'bg-teal-100 text-teal-700 dark:bg-teal-900/60 dark:text-teal-400'
						: 'bg-gray-100 text-gray-500 hover:text-gray-700 dark:bg-gray-800 dark:text-gray-500 dark:hover:text-gray-300'}"
					onclick={(e) => {
						e.stopPropagation();
						toggleSeason(item, season.season_number);
					}}
					title="{season.name} · {season.episode_count} eps"
				>
					{watched ? '✓' : 'S'}{season.season_number}
				</button>
			{/each}
			{#if chip}
				{@const isOpen = releasePopupId === item.id}
				<button
					class="relative inline-flex items-center rounded px-1.5 py-0.5 text-[9px] font-semibold leading-none ring-1 transition-colors
						{isOpen
						? 'bg-orange-100 text-orange-700 ring-orange-400 dark:bg-orange-950/40 dark:text-orange-300 dark:ring-orange-500'
						: 'text-orange-600 ring-orange-300 hover:bg-orange-50 dark:text-orange-500 dark:ring-orange-700 dark:hover:bg-orange-950/30'}"
					onclick={(e) => {
						e.stopPropagation();
						releasePopupId = isOpen ? null : item.id;
					}}
					data-release-popup
				>
					{item.release?.next_season != null ? `S${item.release.next_season}` : 'Next'}
					{#if isOpen}
						<div
							class="absolute top-full left-0 z-20 mt-1 w-max max-w-[14rem] rounded-lg bg-white px-2.5 py-1.5 text-[10px] leading-snug text-gray-700 shadow-lg ring-1 ring-gray-200 dark:bg-gray-900 dark:text-gray-300 dark:ring-gray-700"
						>
							{chip}
						</div>
					{/if}
				</button>
			{/if}
		</div>
	{/if}
{/snippet}

<h1 class="sr-only">My Queue</h1>

<div
	class="space-y-4 xs:space-y-6 {(loaded && items.length > 0) || activeSharedCollection
		? 'pb-24 lg:pb-0'
		: ''}"
>
	<!-- Storage error -->
	{#if dbError}
		<div
			class="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 dark:border-red-800/40 dark:bg-red-950/20"
		>
			<p class="min-w-0 flex-1 text-sm text-red-700 dark:text-red-400">{dbError}</p>
			<button
				onclick={() => (dbError = '')}
				aria-label="Dismiss"
				class="shrink-0 text-red-400 transition-colors hover:text-red-600 dark:hover:text-red-200"
			>
				<svg
					class="h-4 w-4"
					fill="none"
					stroke="currentColor"
					viewBox="0 0 24 24"
					aria-hidden="true"
				>
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="2"
						d="M6 18L18 6M6 6l12 12"
					/>
				</svg>
			</button>
		</div>
	{/if}

	<!-- Cancellation alert -->
	{#if cancelAlert}
		{@const a = cancelAlert}
		<div
			class="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-700/40 dark:bg-amber-950/20"
		>
			<img
				src="{TMDB_IMG}/w45{a.logo}"
				alt={a.name}
				class="mt-0.5 h-6 w-6 shrink-0 rounded object-contain"
			/>
			<p class="min-w-0 flex-1 text-sm text-amber-800 dark:text-amber-300">
				<span class="font-semibold">{a.name}</span> — {formatRuntime(a.totalMins, 'tv')} left in your
				queue. You could finish it this month and pause your subscription.
			</p>
			<button
				onclick={() => dismissAlert(a.providerId)}
				aria-label="Dismiss"
				class="shrink-0 text-amber-400 transition-colors hover:text-amber-600 dark:hover:text-amber-200"
			>
				<svg
					class="h-4 w-4"
					fill="none"
					stroke="currentColor"
					viewBox="0 0 24 24"
					aria-hidden="true"
				>
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="2"
						d="M6 18L18 6M6 6l12 12"
					/>
				</svg>
			</button>
		</div>
	{/if}

	<!-- Budget callout (first visit, no budget set) -->
	{#if showBudgetCallout}
		<div
			class="flex flex-wrap items-center gap-3 rounded-xl border border-orange-200 bg-orange-50 px-4 py-3 dark:border-orange-700/40 dark:bg-orange-950/20"
		>
			<p class="text-sm font-medium text-orange-800 dark:text-orange-300">
				Set your monthly viewing budget to calibrate bar widths.
			</p>
			<div class="flex flex-wrap items-center gap-2 text-sm">
				<input
					type="number"
					aria-label="Hours per week"
					min="1"
					max="24"
					step="0.5"
					bind:value={calloutHoursPerWeek}
					class="w-14 rounded-lg bg-white px-2 py-1.5 text-center text-base sm:text-sm font-medium text-gray-900 outline-none ring-1 ring-orange-300 focus:ring-orange-500 dark:bg-gray-900 dark:text-white dark:ring-orange-700 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
				/>
				<span class="text-orange-700 dark:text-orange-400">hrs ×</span>
				<input
					type="number"
					aria-label="Weeks per month"
					min="1"
					max="6"
					step="0.5"
					bind:value={calloutWeeksPerMonth}
					class="w-14 rounded-lg bg-white px-2 py-1.5 text-center text-base sm:text-sm font-medium text-gray-900 outline-none ring-1 ring-orange-300 focus:ring-orange-500 dark:bg-gray-900 dark:text-white dark:ring-orange-700 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
				/>
				<span class="text-orange-700 dark:text-orange-400">weeks/mo</span>
			</div>
			<div class="ml-auto flex gap-2">
				<button
					onclick={dismissBudgetCallout}
					class="text-xs text-orange-400 hover:text-orange-600 dark:hover:text-orange-200"
					>Skip</button
				>
				<Button onclick={saveBudgetCallout} class="px-3 py-1.5 text-xs">Save</Button>
			</div>
		</div>
	{/if}

	<!-- Summary line -->
	{#if activeSharedCollection}
		<div class="flex items-center justify-between gap-2">
			<p class="text-xs text-gray-500 dark:text-gray-500">
				{activeSharedCollection.name} · {sharedFilterStats?.count ?? 0} title{(sharedFilterStats?.count ??
					0) === 1
					? ''
					: 's'} · ~{hms(sharedFilterStats?.remainingMins ?? 0)} remaining{queueControls.watchedOn
					? ' · showing watched'
					: ''}
			</p>
		</div>
	{:else if loaded && items.length > 0}
		{@const collectionLabel =
			queueControls.collectionFilter === UNCATEGORIZED
				? 'Uncategorized'
				: queueControls.collectionFilter}
		{@const collectionPrefix = collectionLabel ? `${collectionLabel} · ` : ''}
		<div class="flex items-center justify-between gap-2">
			<p class="text-xs text-gray-500 dark:text-gray-500">
				{collectionPrefix}{visibleItems.length} title{visibleItems.length === 1 ? '' : 's'} · ~{hms(
					visibleItems.reduce((s, i) => s + remainingRuntime(i), 0)
				)} remaining{queueControls.watchedOn ? ' · showing watched' : ''}
			</p>
			{#if queueControls.viewMode !== 'lanes'}
				<button
					onclick={() => (selectMode ? exitSelectMode() : (selectMode = true))}
					class="shrink-0 text-xs font-medium {selectMode
						? 'text-orange-500'
						: 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'}"
				>
					{selectMode ? 'Cancel' : 'Select'}
				</button>
			{/if}
		</div>
	{/if}

	<!-- Bulk action bar (#113) -->
	{#if selectMode && !activeSharedCollection}
		<div
			class="flex flex-wrap items-center gap-2 rounded-xl border border-orange-200 bg-orange-50 px-3 py-2.5 text-sm dark:border-orange-700/40 dark:bg-orange-950/20"
		>
			<span class="font-medium text-orange-800 dark:text-orange-300">
				{selectedIds.size} selected
			</span>
			<div class="ml-auto flex flex-wrap items-center gap-1.5">
				<select
					bind:value={bulkTargetTag}
					disabled={bulkBusy || selectedIds.size === 0}
					aria-label="Assign to list"
					class="min-w-0 rounded border border-gray-200 bg-white px-1.5 py-1 text-xs text-gray-700 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-orange-500"
				>
					<option value="">Assign to…</option>
					{#each existingCollections as collection (collection)}
						<option value={collection}>{collection}</option>
					{/each}
					{#if sharedCollections.length > 0}
						<optgroup label="Shared">
							{#each sharedCollections as coll (coll.id)}
								<option value={`shared:${coll.id}`}>{coll.name}</option>
							{/each}
						</optgroup>
					{/if}
				</select>
				<input
					type="text"
					placeholder="or new name…"
					bind:value={bulkNewTag}
					disabled={bulkBusy || selectedIds.size === 0}
					class="w-24 rounded border border-gray-200 bg-white px-1.5 py-1 text-xs text-gray-700 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-orange-500"
				/>
				<button
					disabled={bulkBusy || selectedIds.size === 0 || (!bulkTargetTag && !bulkNewTag.trim())}
					onclick={bulkAssign}
					class="rounded bg-orange-500 px-2 py-1 text-xs font-medium text-white hover:bg-orange-400 disabled:opacity-40"
				>
					Assign
				</button>
				<button
					disabled={bulkBusy || selectedIds.size === 0}
					onclick={bulkClearCollection}
					class="rounded bg-gray-100 px-2 py-1 text-xs text-gray-600 hover:bg-gray-200 disabled:opacity-40 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
				>
					Clear list
				</button>
				<button
					disabled={bulkBusy || selectedIds.size === 0}
					onclick={() => bulkMarkWatched(true)}
					class="rounded bg-gray-100 px-2 py-1 text-xs text-gray-600 hover:bg-gray-200 disabled:opacity-40 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
				>
					Mark watched
				</button>
				<button
					disabled={bulkBusy || selectedIds.size === 0}
					onclick={() => bulkMarkWatched(false)}
					class="rounded bg-gray-100 px-2 py-1 text-xs text-gray-600 hover:bg-gray-200 disabled:opacity-40 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
				>
					Mark unwatched
				</button>
				<button
					disabled={bulkBusy || selectedIds.size === 0}
					onclick={bulkRemoveSelected}
					class="rounded px-2 py-1 text-xs font-medium disabled:opacity-40 {bulkRemoveArmed
						? 'bg-red-600 text-white hover:bg-red-700'
						: 'bg-gray-100 text-red-500 hover:bg-red-100 dark:bg-gray-800 dark:hover:bg-red-900/30'}"
				>
					{bulkRemoveArmed ? 'Confirm remove' : 'Remove'}
				</button>
			</div>
		</div>
	{/if}

	<!-- A shared-list filter fills this whole area, same slot the personal
	     queue would otherwise occupy — not another section to scroll to. -->
	{#if activeSharedCollection}
		<!-- Keyed so switching between two shared filters remounts the section —
		     otherwise it'd keep its already-`loaded` state from the previous
		     list and never fetch the newly selected one. -->
		{#key activeSharedCollection.id}
			<SharedListSection
				inline
				collection={activeSharedCollection}
				color={sharedListColors[activeSharedCollection.id] ?? '#9ca3af'}
				{budgetHours}
				onStats={(s) => (sharedFilterStats = s)}
			/>
		{/key}

		<!-- Loading -->
	{:else if !loaded}
		<div class="grid grid-cols-2 gap-3 sm:gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
			{#each { length: 5 } as _, i (i)}<div
					class="aspect-[2/3] animate-pulse rounded-xl bg-gray-200 dark:bg-gray-800"
				></div>{/each}
		</div>

		<!-- Empty: no items in queue at all. Routes into the same setup screen
		     Flow A's landing CTA does (#242) — reached this way by anyone who
		     skipped it entirely, most notably an invite-flow signup landing
		     here with nothing queued yet. Deliberately a CTA, not an
		     auto-redirect: someone who emptied an existing queue on purpose
		     should still be able to just look at an empty queue. -->
	{:else if items.length === 0}
		<div class="flex flex-col items-center justify-center py-12 text-center xs:py-24">
			<p class="mb-3 text-4xl xs:mb-4 xs:text-5xl">🎬</p>
			<p class="text-base font-medium text-gray-700 xs:text-lg dark:text-gray-300">
				Your queue is empty
			</p>
			<p class="mt-1 text-sm text-gray-500">Add a few titles and set your budget to get started.</p>
			<Button href={resolve('/add?onboarding=1')} class="mt-4 px-5 py-2.5 text-sm">
				Get started →
			</Button>
		</div>

		<!-- Empty: items exist but none match the current filters -->
	{:else if visibleItems.length === 0}
		<div class="flex flex-col items-center justify-center py-12 text-center xs:py-24">
			<p class="text-sm text-gray-500">Nothing matches these filters.</p>
		</div>

		<!-- ── GRID ──────────────────────────────────────────────────────────────── -->
	{:else if queueControls.viewMode === 'grid'}
		<QueueGridView
			items={flatItems}
			{budgetHours}
			{busy}
			{queueColors}
			groupByCollection={queueControls.groupByCollection}
			{selectMode}
			selected={selectedIds}
			{rankMode}
			onToggle={toggle}
			onRemove={remove}
			onOpenDetail={(item) => (detailItem = item)}
			onToggleSelect={toggleSelected}
			onMoveUp={moveUp}
			onMoveDown={moveDown}
			onReorder={reorderRankedItems}
			{seasonPicker}
		/>

		<!-- ── LIST ─────────────────────────────────────────────────────────────── -->
	{:else if queueControls.viewMode === 'list'}
		<QueueListView
			items={flatItems}
			{budgetHours}
			{busy}
			{queueColors}
			groupByCollection={queueControls.groupByCollection}
			{selectMode}
			selected={selectedIds}
			{rankMode}
			onToggle={toggle}
			onRemove={remove}
			onOpenDetail={(item) => (detailItem = item)}
			onToggleSelect={toggleSelected}
			onMoveUp={moveUp}
			onMoveDown={moveDown}
			onReorder={reorderRankedItems}
			{seasonPicker}
		/>

		<!-- ── GANTT LANES ────────────────────────────────────────────────────────── -->
	{:else}
		<QueueGanttView
			items={flatItems}
			{budgetHours}
			{busy}
			onToggle={toggle}
			onRemove={remove}
			{seasonPicker}
			{queueColors}
		/>
	{/if}
</div>

<ListHint show={loaded && items.length >= 5 && existingCollections.length === 0} />

{#if otherSharedCollections.length > 0}
	<div class="mt-6 space-y-2 xs:mt-8">
		<h2 class="text-xs font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">
			Shared Lists
		</h2>
		{#each otherSharedCollections as coll (coll.id)}
			<SharedListSection
				collection={coll}
				color={sharedListColors[coll.id] ?? '#9ca3af'}
				{budgetHours}
			/>
		{/each}
	</div>
{/if}

<SyncHint show={loaded && !syncEnabled && items.length > 0} count={items.length} />

<!-- ── Detail panel ───────────────────────────────────────────────────────── -->
{#if detailItem}
	{@const di = detailItem}
	<DetailPanel
		item={di}
		{budgetHours}
		showSeasons={true}
		onToggleSeason={(seasonNum) => toggleSeason(di, seasonNum)}
		onClose={() => (detailItem = null)}
		{existingCollections}
		onSetCollection={async (tag) => {
			await setItemCollection(di, tag, actionDeps);
			detailItem = items.find((i) => i.id === di.id) ?? null;
		}}
		onSetNote={async (notes) => {
			await setItemNote(di, notes, actionDeps);
			detailItem = items.find((i) => i.id === di.id) ?? null;
		}}
		{sharedCollections}
		onAssignShared={async (collectionId) => {
			const coll = sharedCollections.find((c) => c.id === collectionId);
			if (!coll) return;
			const ok = await addItemsToSharedCollection(coll, [di], collectionActionDeps);
			if (ok) {
				await reload();
				detailItem = null;
			}
		}}
	>
		{#snippet footer(item)}
			<button
				class="flex-1 rounded-lg py-2 text-sm font-medium transition-colors
					{item.watched_at
					? 'bg-teal-100 text-teal-700 hover:bg-teal-200 dark:bg-teal-900/40 dark:text-teal-400 dark:hover:bg-teal-900/60'
					: 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'}"
				disabled={busy.has(item.id)}
				onclick={async () => {
					await toggle(di);
					detailItem = items.find((i) => i.id === item.id) ?? null;
				}}>{item.watched_at ? '↩ Unwatch' : '✓ Watched'}</button
			>
			<button
				class="rounded-lg bg-gray-100 px-4 py-2 text-sm text-gray-500 transition-colors hover:bg-red-100 hover:text-red-600 disabled:opacity-40 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-red-900/50 dark:hover:text-red-400"
				disabled={busy.has(item.id)}
				onclick={async () => {
					await remove(di);
					detailItem = null;
				}}>✕ Remove</button
			>
		{/snippet}
	</DetailPanel>
{/if}

<!-- Filter dock now lives in src/routes/+layout.svelte (shared between the
     nav-inline lg+ placement and the fixed floating placement below lg). -->
