<script lang="ts">
	import { onMount } from 'svelte';
	import { flip } from 'svelte/animate';
	import type { WatchlistItem } from '$lib/types';
	import { getAll, removeItem, setWatched, updateShowProgress } from '$lib/db';
	import { TMDB_IMG, formatRuntime } from '$lib/tmdb';
	import { laneColors, providerHue, extractLogoHue } from '$lib/colors';
	import { theme } from '$lib/theme.svelte';
	import { remainingRuntime, releaseChip, cancelCandidates } from '$lib/progress';
	import { getQueueColors } from '$lib/queue-colors';
	import { services, ensureSubscribedLoaded } from '$lib/services.svelte';
	import { motion } from '$lib/motion.svelte';
	import { queueControls, SORT_DEFAULT_DIR } from '$lib/queue-controls.svelte';
	import type { SortKey, ViewKey } from '$lib/queue-controls.svelte';

	// ── Constants ─────────────────────────────────────────────────────────────
	const BAR_H = 32; // px — compact chip height
	const DEFAULT_RUNTIME: Record<'movie' | 'tv', number> = { movie: 90, tv: 45 };

	function effectiveRuntime(item: WatchlistItem): number {
		return remainingRuntime(item);
	}

	// ── Persisted prefs ───────────────────────────────────────────────────────
	function loadPref<T extends string>(key: string, fallback: T): T {
		try { return (localStorage.getItem(key) as T) ?? fallback; } catch { return fallback; }
	}
	function loadJSON<T>(key: string, fallback: T): T {
		try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
	}

	// ── Core state ────────────────────────────────────────────────────────────
	let items        = $state<WatchlistItem[]>([]);
	let loaded       = $state(false);
	let queueColors  = $state<Record<string, string>>({});
	let busy        = $state(new Set<number>());
	// Gantt detail popup — fixed-position to escape the overflow:hidden budget zone
	let activeItem       = $state<WatchlistItem | null>(null);
	let ganttPopupAnchor = $state<{ x: number; y: number } | null>(null);

	let releasePopupId: number | null = $state(null);
	let libraryPopupId: number | null = $state(null);
	let detailItem: WatchlistItem | null = $state(null);
	let overviewExpanded = $state(false);
	let posterExpanded = $state(false);

	function openGanttPopup(e: MouseEvent, item: WatchlistItem) {
		e.stopPropagation();
		if (activeItem?.id === item.id) { activeItem = null; ganttPopupAnchor = null; return; }
		const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
		ganttPopupAnchor = {
			x: Math.min(rect.left, window.innerWidth - 248),
			y: rect.bottom + 8
		};
		activeItem = item;
	}

	let budgetHours = $state(40); // user-adjustable month budget


	// logo-derived hues: logo_path → extracted hue (populated async)
	let logoHues = $state(new Map<string, number>());

	// helper: best available hue for a provider
	function resolvedHue(providerId: number | null, logoPath: string | null): number | null {
		if (logoPath && logoHues.has(logoPath)) {
			const h = logoHues.get(logoPath)!;
			return h >= 0 ? h : (providerId !== null ? providerHue(providerId) : null);
		}
		return providerId !== null ? providerHue(providerId) : null;
	}

	// ── Budget callout (first visit) ─────────────────────────────────────────
	let showBudgetCallout      = $state(false);
	let calloutHoursPerWeek    = $state(10);
	let calloutWeeksPerMonth   = $state(4);

	function saveBudgetCallout() {
		try {
			localStorage.setItem('sq:budget:weekly', JSON.stringify(calloutHoursPerWeek));
			localStorage.setItem('sq:budget:weeks',  JSON.stringify(calloutWeeksPerMonth));
			localStorage.setItem('sq:budget', JSON.stringify(calloutHoursPerWeek * calloutWeeksPerMonth));
			budgetHours = calloutHoursPerWeek * calloutWeeksPerMonth;
		} catch {}
		showBudgetCallout = false;
	}

	function dismissBudgetCallout() {
		try { localStorage.setItem('sq:budget-callout-dismissed', 'true'); } catch {}
		showBudgetCallout = false;
	}

	// ── Cancellation alerts ───────────────────────────────────────────────────
	let cancelAlertsEnabled = $state(false);
	let dismissedAlerts     = $state<Record<string, string>>({});

	function dismissAlert(providerId: number) {
		const updated = { ...dismissedAlerts, [String(providerId)]: new Date().toISOString().slice(0, 10) };
		dismissedAlerts = updated;
		try { localStorage.setItem('sq:dismiss-cancel', JSON.stringify(updated)); } catch {}
	}

	let cancelAlert = $derived.by(() => {
		if (!loaded || !cancelAlertsEnabled) return null;
		const candidates = cancelCandidates(queued, budgetHours, dismissedAlerts);
		return candidates[0] ?? null;
	});

	// ── Derived lists ─────────────────────────────────────────────────────────
	// "queued" always means unwatched, independent of the Watched toggle — used for cancel alerts.
	let queued = $derived(items.filter((i) => !i.watched_at));

	// Watched toggle is inclusive: off shows only unwatched titles, on mixes in watched titles too.
	let baseItems = $derived(queueControls.watchedOn ? items : queued);

	let visibleItems = $derived.by(() => {
		if (queueControls.serviceFilter === 'all' || services.ids.size === 0) return baseItems;
		if (queueControls.serviceFilter === 'subscribed') {
			return baseItems.filter(item =>
				item.providers.some(p => services.ids.has(p.provider_id))
			);
		}
		// not-subscribed: has providers, none of which are subscribed
		return baseItems.filter(item =>
			item.providers.length > 0 &&
			!item.providers.some(p => services.ids.has(p.provider_id))
		);
	});

	function sorted(list: WatchlistItem[]): WatchlistItem[] {
		const mul = queueControls.sortDir === 'asc' ? 1 : -1;
		return [...list].sort((a, b) => {
			if (queueControls.sortBy === 'title') return a.title.localeCompare(b.title) * mul;
			if (queueControls.sortBy === 'runtime') {
				return (effectiveRuntime(a) - effectiveRuntime(b)) * mul;
			}
			return a.added_at.localeCompare(b.added_at) * mul;
		});
	}

	let flatItems = $derived(sorted(visibleItems));

	type Lane = {
		key: string;
		label: string;
		logo: string | null;
		providerId: number | null;
		items: WatchlistItem[];
		totalMins: number;
		overMins: number;
	};

	let rawLanes = $derived.by((): Lane[] => {
		const budgetMins = budgetHours * 60;
		const list = sorted(visibleItems);
		const map  = new Map<string, Omit<Lane, 'overMins' | 'totalMins'> & { totalMins: number }>();
		const noProvider: WatchlistItem[] = [];

		for (const item of list) {
			if (!item.providers.length) {
				noProvider.push(item);
			} else {
				const p = item.providers[0];
				if (!map.has(p.provider_name)) {
					map.set(p.provider_name, { key: p.provider_name, label: p.provider_name,
						logo: p.logo_path, providerId: p.provider_id, items: [], totalMins: 0 });
				}
				const lane = map.get(p.provider_name)!;
				lane.items.push(item);
				lane.totalMins += effectiveRuntime(item);
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
			const totalMins = noProvider.reduce((s, i) => s + effectiveRuntime(i), 0);
			out.push({ key: '__none__', label: 'Not Streaming', logo: null, providerId: null,
				items: noProvider, totalMins, overMins: Math.max(0, totalMins - budgetMins) });
		}
		return out;
	});

	let lanes = $derived(rawLanes);

	// ── Lifecycle ─────────────────────────────────────────────────────────────
	async function reload() {
		items = await getAll();
	}

	onMount(() => {
		queueControls.sortBy      = loadPref<SortKey>('sq:sort', 'added');
		queueControls.sortDir     = loadPref<'asc' | 'desc'>('sq:sortDir', SORT_DEFAULT_DIR[queueControls.sortBy]);
		queueControls.viewMode    = loadPref<ViewKey>('sq:view', 'grid');
		queueControls.ready       = true;
		budgetHours = loadJSON<number>('sq:budget', 40);
		queueColors = getQueueColors();
		cancelAlertsEnabled = localStorage.getItem('sq:cancel-alerts') === 'true';
		try { dismissedAlerts = JSON.parse(localStorage.getItem('sq:dismiss-cancel') ?? '{}'); } catch {}

		const hasBudget    = localStorage.getItem('sq:budget:weekly') !== null;
		const wasDismissed = localStorage.getItem('sq:budget-callout-dismissed') === 'true';
		if (!hasBudget && !wasDismissed) showBudgetCallout = true;

		// "Save before leaving" — browser native dialog when navigating away from the site
		function onBeforeUnload(e: BeforeUnloadEvent) {
			if (items.length > 0) e.preventDefault();
		}
		window.addEventListener('beforeunload', onBeforeUnload);

		Promise.all([reload(), ensureSubscribedLoaded()]).then(() => { loaded = true; });

		return () => window.removeEventListener('beforeunload', onBeforeUnload);
	});

	$effect(() => {
		try {
			localStorage.setItem('sq:sort', queueControls.sortBy);
			localStorage.setItem('sq:sortDir', queueControls.sortDir);
			localStorage.setItem('sq:view', queueControls.viewMode);
			localStorage.setItem('sq:budget', JSON.stringify(budgetHours));
		} catch {}
	});

	// "Subscribed" filter is meaningless with zero subscribed services — fall back to "All".
	$effect(() => {
		if (queueControls.serviceFilter === 'subscribed' && services.ids.size === 0) queueControls.serviceFilter = 'all';
	});

	// Lets the nav know whether the dock has anything to show, for the lg+ inline placement.
	$effect(() => {
		queueControls.hasItems = loaded && items.length > 0;
	});

	// Extract logo hues for all providers in view (runs whenever baseItems changes)
	$effect(() => {
		const logos = new Set<string>();
		for (const item of baseItems) {
			for (const p of item.providers) {
				if (p.logo_path && !logoHues.has(p.logo_path)) logos.add(p.logo_path);
			}
		}
		for (const logoPath of logos) {
			extractLogoHue(logoPath, TMDB_IMG).then((hue) => {
				logoHues = new Map(logoHues).set(logoPath, hue);
			});
		}
	});

	// ── Actions ───────────────────────────────────────────────────────────────
	async function toggle(item: WatchlistItem) {
		busy = new Set(busy).add(item.id);
		await setWatched(item.id, !item.watched_at);
		if (activeItem?.id === item.id) { activeItem = null; ganttPopupAnchor = null; }
		await reload();
		const next = new Set(busy); next.delete(item.id); busy = next;
	}
	async function remove(item: WatchlistItem) {
		busy = new Set(busy).add(item.id);
		await removeItem(item.id);
		if (activeItem?.id === item.id) { activeItem = null; ganttPopupAnchor = null; }
		await reload();
		const next = new Set(busy); next.delete(item.id); busy = next;
	}

	// ── Season progress ───────────────────────────────────────────────────────
	async function toggleSeason(item: WatchlistItem, seasonNum: number) {
		const current = item.watched_seasons ?? [];
		const next = current.includes(seasonNum)
			? current.filter((s) => s !== seasonNum)
			: [...current, seasonNum];
		await updateShowProgress(item.id, next, item.current_season, item.current_episode);
		await reload();
	}

	// ── Helpers ───────────────────────────────────────────────────────────────
	function hms(mins: number): string {
		const h = Math.floor(mins / 60), m = mins % 60;
		return h ? `${h}h${m ? ' ' + m + 'm' : ''}` : `${m}m`;
	}
	function overLabel(mins: number): string {
		const h = (mins / 60);
		return `+${h % 1 === 0 ? h : h.toFixed(1)}h over`;
	}
</script>

<svelte:head><title>Queuest — My Queue</title></svelte:head>

<svelte:document onclick={(e) => {
	const t = e.target as Element;
	if (activeItem && !t.closest('[data-item]')) { activeItem = null; ganttPopupAnchor = null; }
	if (!t.closest('[data-release-popup]')) { releasePopupId = null; }
	if (!t.closest('[data-library-popup]')) { libraryPopupId = null; }
	if (!t.closest('[data-detail-panel]') && !t.closest('[data-detail-trigger]')) { detailItem = null; overviewExpanded = false; posterExpanded = false; }
}} />

{#snippet seasonPicker(item: WatchlistItem)}
	{@const chip = releaseChip(item.release)}
	{#if item.media_type === 'tv' && (item.seasons?.length || chip)}
		<div class="flex flex-wrap gap-0.5 pt-0.5">
			{#each (item.seasons ?? []).filter(s =>
				s.episode_count > 0 &&
				(!chip || item.release?.next_season == null || s.season_number < item.release.next_season)
			) as season (season.season_number)}
				{@const watched = (item.watched_seasons ?? []).includes(season.season_number)}
				<button
					class="inline-flex items-center rounded px-1.5 py-0.5 text-[9px] font-semibold leading-none transition-colors
						{watched
							? 'bg-teal-100 text-teal-700 dark:bg-teal-900/60 dark:text-teal-400'
							: 'bg-gray-100 text-gray-500 hover:text-gray-700 dark:bg-gray-800 dark:text-gray-500 dark:hover:text-gray-300'}"
					onclick={(e) => { e.stopPropagation(); toggleSeason(item, season.season_number); }}
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
					onclick={(e) => { e.stopPropagation(); releasePopupId = isOpen ? null : item.id; }}
					data-release-popup
				>
					{item.release?.next_season != null ? `S${item.release.next_season}` : 'Next'}
					{#if isOpen}
						<div class="absolute top-full left-0 z-20 mt-1 w-max max-w-[14rem] rounded-lg bg-white px-2.5 py-1.5 text-[10px] leading-snug text-gray-700 shadow-lg ring-1 ring-gray-200 dark:bg-gray-900 dark:text-gray-300 dark:ring-gray-700">
							{chip}
						</div>
					{/if}
				</button>
			{/if}
		</div>
	{/if}
{/snippet}

<div class="space-y-4 xs:space-y-6 {loaded && items.length > 0 ? 'pb-24 lg:pb-0' : ''}">
	<!-- Cancellation alert -->
	{#if cancelAlert}
		{@const a = cancelAlert}
		<div class="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-700/40 dark:bg-amber-950/20">
			<img
				src="{TMDB_IMG}/w45{a.logo}"
				alt={a.name}
				class="mt-0.5 h-6 w-6 shrink-0 rounded object-contain"
			/>
			<p class="min-w-0 flex-1 text-sm text-amber-800 dark:text-amber-300">
				<span class="font-semibold">{a.name}</span> — {formatRuntime(a.totalMins, 'tv')} left in your queue. You could finish it this month and pause your subscription.
			</p>
			<button
				onclick={() => dismissAlert(a.providerId)}
				aria-label="Dismiss"
				class="shrink-0 text-amber-400 transition-colors hover:text-amber-600 dark:hover:text-amber-200"
			>
				<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
				</svg>
			</button>
		</div>
	{/if}

	<!-- Budget callout (first visit, no budget set) -->
	{#if showBudgetCallout}
		<div class="flex flex-wrap items-center gap-3 rounded-xl border border-orange-200 bg-orange-50 px-4 py-3 dark:border-orange-700/40 dark:bg-orange-950/20">
			<p class="text-sm font-medium text-orange-800 dark:text-orange-300">Set your monthly viewing budget to calibrate bar widths.</p>
			<div class="flex flex-wrap items-center gap-2 text-sm">
				<input type="number" min="1" max="24" step="0.5"
					bind:value={calloutHoursPerWeek}
					class="w-14 rounded-lg bg-white px-2 py-1.5 text-center font-medium text-gray-900 outline-none ring-1 ring-orange-300 focus:ring-orange-500 dark:bg-gray-900 dark:text-white dark:ring-orange-700 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
				/>
				<span class="text-orange-700 dark:text-orange-400">hrs ×</span>
				<input type="number" min="1" max="6" step="0.5"
					bind:value={calloutWeeksPerMonth}
					class="w-14 rounded-lg bg-white px-2 py-1.5 text-center font-medium text-gray-900 outline-none ring-1 ring-orange-300 focus:ring-orange-500 dark:bg-gray-900 dark:text-white dark:ring-orange-700 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
				/>
				<span class="text-orange-700 dark:text-orange-400">weeks/mo</span>
			</div>
			<div class="ml-auto flex gap-2">
				<button onclick={dismissBudgetCallout} class="text-xs text-orange-400 hover:text-orange-600 dark:hover:text-orange-200">Skip</button>
				<button onclick={saveBudgetCallout} class="rounded-lg bg-orange-500 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-orange-400">Save</button>
			</div>
		</div>
	{/if}

	<!-- Summary line -->
	{#if loaded && items.length > 0}
		<p class="text-xs text-gray-500 dark:text-gray-500">
			{visibleItems.length} title{visibleItems.length === 1 ? '' : 's'} · ~{hms(visibleItems.reduce((s, i) => s + effectiveRuntime(i), 0))} remaining{queueControls.watchedOn ? ' · showing watched' : ''}
		</p>
	{/if}

	<!-- Loading -->
	{#if !loaded}
		<div class="grid grid-cols-2 gap-3 sm:gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
			{#each { length: 5 } as _, i (i)}<div class="aspect-[2/3] animate-pulse rounded-xl bg-gray-200 dark:bg-gray-800"></div>{/each}
		</div>

	<!-- Empty: no items in queue at all -->
	{:else if items.length === 0}
		<div class="flex flex-col items-center justify-center py-12 text-center xs:py-24">
			<p class="mb-3 text-4xl xs:mb-4 xs:text-5xl">🎬</p>
			<p class="text-base font-medium text-gray-700 xs:text-lg dark:text-gray-300">Your queue is empty</p>
			<p class="mt-1 text-sm text-gray-500">
				<a class="text-orange-500 hover:underline" href="/add">Search for movies and shows</a> to get started
			</p>
		</div>

	<!-- Empty: items exist but none match the current filters -->
	{:else if visibleItems.length === 0}
		<div class="flex flex-col items-center justify-center py-12 text-center xs:py-24">
			<p class="text-sm text-gray-500">Nothing matches these filters.</p>
		</div>

	<!-- ── GRID ──────────────────────────────────────────────────────────────── -->
	{:else if queueControls.viewMode === 'grid'}
		<div class="grid grid-cols-2 gap-3 sm:gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
			{#each flatItems as item (item.id)}
				{@const cardHue = resolvedHue(item.providers[0]?.provider_id ?? null, item.providers[0]?.logo_path ?? null)}
				{@const cardPct = Math.min(100, (effectiveRuntime(item) / (budgetHours * 60)) * 100)}
				{@const cardLine = cardHue !== null ? `hsl(${cardHue} 60% 52%)` : '#374151'}
				{@const cardDot  = cardHue !== null ? `hsl(${cardHue} 70% 62%)` : '#4b5563'}
				{@const tagColor = item.queue_tag ? (queueColors[item.queue_tag] ?? null) : null}
				<div animate:flip={{ duration: motion.reduced ? 0 : 250 }}
					class="flex flex-col rounded-xl bg-white ring-1 ring-gray-200 dark:bg-gray-900 dark:ring-0 cursor-pointer"
					style={tagColor ? `border-left: 3px solid ${tagColor}` : ''}
					onclick={(e) => { e.stopPropagation(); detailItem = item; overviewExpanded = false; }}
					role="button"
					tabindex="0"
					aria-label="View details for {item.title}"
					onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { detailItem = item; overviewExpanded = false; } }}>
					<button
						class="relative aspect-[2/3] overflow-hidden rounded-t-xl bg-gray-200 dark:bg-gray-800 w-full cursor-pointer"
						onclick={() => { detailItem = item; overviewExpanded = false; }}
						data-detail-trigger
						aria-label="View details for {item.title}"
					>
						{#if item.poster_path}
							<img src="{TMDB_IMG}/w300{item.poster_path}" alt={item.title} class="h-full w-full object-cover" />
						{:else}
							<div class="flex h-full w-full items-center justify-center text-4xl text-gray-400 dark:text-gray-600">🎬</div>
						{/if}
						{#if queueControls.watchedOn && item.watched_at}
							<span class="absolute top-2 left-2 rounded bg-teal-900/85 px-1.5 py-0.5 text-[10px] font-semibold text-teal-400">✓ Watched</span>
						{/if}
					</button>
					<div class="flex flex-1 flex-col gap-2 p-2.5 sm:p-3">
						<p class="line-clamp-2 text-sm font-medium leading-tight">{item.title}</p>
						<!-- Runtime sparkline -->
						<div class="flex items-center gap-2">
							<div class="relative flex-1">
								<div class="h-px w-full bg-gray-200 dark:bg-gray-800"></div>
								<div class="absolute top-0 left-0 h-px transition-all duration-300"
									style="width:{cardPct}%; background:{cardLine}; opacity:0.75;"></div>
								<div class="absolute top-1/2 -translate-y-1/2 h-1.5 w-1.5 rounded-full transition-all duration-300"
									style="left:{cardPct}%; margin-left:-3px; background:{cardDot};"></div>
							</div>
							<span class="shrink-0 text-[10px] tabular-nums text-gray-500">
								{formatRuntime(effectiveRuntime(item), item.media_type)}
							</span>
						</div>
						{@render seasonPicker(item)}
						<!-- Type chip + providers -->
						<div class="flex flex-wrap items-center gap-1">
							<span class="rounded bg-gray-100 px-1 py-0.5 text-[11px] dark:bg-gray-800">
								{item.media_type === 'movie' ? '🎬' : '📺'}
							</span>
							{#each item.providers.slice(0, 4) as p (p.provider_id)}
								<img src="{TMDB_IMG}/w92{p.logo_path}" alt={p.provider_name} title={p.provider_name} class="h-5 w-5 rounded" />
							{/each}
							{#if item.providers.length > 4}<span class="text-xs text-gray-500">+{item.providers.length - 4}</span>{/if}
							{#if !item.providers.length}
								{#if item.rentable}
									<span class="text-sm leading-none" title="Rent/Buy only">💲</span>
								{:else}
									{@const isOpen = libraryPopupId === item.id}
									<div class="relative" data-library-popup>
										<button
											class="text-sm leading-none transition-opacity hover:opacity-60"
											onclick={(e) => { e.stopPropagation(); libraryPopupId = isOpen ? null : item.id; }}
											title="Not on streaming services"
										>🚫</button>
										{#if isOpen}
											<div class="absolute top-full left-0 z-20 mt-1 w-max rounded-lg bg-white px-3 py-2 shadow-lg ring-1 ring-gray-200 dark:bg-gray-900 dark:ring-gray-700">
												<p class="mb-1.5 text-[10px] font-semibold text-gray-400 dark:text-gray-500">Check your library</p>
												<div class="flex flex-col gap-1">
													<a href="https://www.kanopy.com/en/search?query={encodeURIComponent(item.title)}" target="_blank" rel="noopener noreferrer" class="text-[11px] text-gray-600 hover:text-orange-500 dark:text-gray-400 dark:hover:text-orange-400">Kanopy →</a>
													<a href="https://www.hoopladigital.com/search?q={encodeURIComponent(item.title)}" target="_blank" rel="noopener noreferrer" class="text-[11px] text-gray-600 hover:text-orange-500 dark:text-gray-400 dark:hover:text-orange-400">Hoopla →</a>
												</div>
											</div>
										{/if}
									</div>
								{/if}
							{/if}
						</div>
						{#if item.media_type === 'movie' && releaseChip(item.release)}
							<p class="text-xs leading-snug text-amber-600 dark:text-amber-400">{releaseChip(item.release)}</p>
						{/if}
						<div class="mt-auto flex gap-1.5 pt-1">
							<button class="flex-1 rounded-md bg-gray-100 py-1 text-xs font-medium transition-colors hover:bg-gray-200 disabled:opacity-40 dark:bg-gray-800 dark:hover:bg-gray-700"
								disabled={busy.has(item.id)} onclick={(e) => { e.stopPropagation(); toggle(item); }}>
								{item.watched_at ? 'Unwatch' : '✓ Watched'}
							</button>
							<button class="rounded-md bg-gray-100 px-2 py-1 text-xs text-gray-500 transition-colors hover:bg-red-100 hover:text-red-600 disabled:opacity-40 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-red-900/50 dark:hover:text-red-400"
								disabled={busy.has(item.id)} onclick={(e) => { e.stopPropagation(); remove(item); }} aria-label="Remove">✕</button>
						</div>
					</div>
				</div>
			{/each}
		</div>

	<!-- ── LIST ─────────────────────────────────────────────────────────────── -->
	{:else if queueControls.viewMode === 'list'}
		<div class="divide-y divide-gray-200 overflow-hidden rounded-xl dark:divide-gray-800/60">
			{#each flatItems as item (item.id)}
				{@const rt = effectiveRuntime(item)}
				{@const pct = Math.min(100, (rt / (budgetHours * 60)) * 100)}
				{@const hue = resolvedHue(item.providers[0]?.provider_id ?? null, item.providers[0]?.logo_path ?? null)}
				{@const lineColor = hue !== null ? `hsl(${hue} 60% 52%)` : '#9ca3af'}
				{@const dotColor  = hue !== null ? `hsl(${hue} 70% 62%)` : '#6b7280'}
				{@const tagColor  = item.queue_tag ? (queueColors[item.queue_tag] ?? null) : null}
				<div animate:flip={{ duration: motion.reduced ? 0 : 250 }}
					class="flex flex-col bg-white px-3 py-2.5 transition-colors hover:bg-gray-50 dark:bg-gray-900/40 dark:hover:bg-gray-900/80 cursor-pointer"
					style={tagColor ? `border-left: 3px solid ${tagColor}` : ''}
					onclick={(e) => { e.stopPropagation(); detailItem = item; overviewExpanded = false; }}
					role="button"
					tabindex="0"
					aria-label="View details for {item.title}"
					onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { detailItem = item; overviewExpanded = false; } }}>
					<!-- Row 1: poster · title · actions -->
					<div class="flex items-center gap-3">
						<div class="relative h-12 w-8 shrink-0 overflow-hidden rounded bg-gray-200 dark:bg-gray-800">
							{#if item.poster_path}
								<img src="{TMDB_IMG}/w92{item.poster_path}" alt={item.title} class="h-full w-full object-cover" />
							{:else}
								<div class="flex h-full w-full items-center justify-center text-sm text-gray-400 dark:text-gray-600">🎬</div>
							{/if}
						</div>
						<button
							class="min-w-0 flex-1 text-left text-sm font-medium leading-tight hover:text-orange-500 transition-colors"
							onclick={(e) => { e.stopPropagation(); detailItem = item; overviewExpanded = false; }}
							data-detail-trigger
						>{item.title}</button>
						{#if queueControls.watchedOn && item.watched_at}
							<span class="shrink-0 rounded bg-teal-100 px-1.5 py-0.5 text-[10px] font-semibold text-teal-700 dark:bg-teal-900/60 dark:text-teal-400">✓</span>
						{/if}
						<div class="flex shrink-0 gap-1">
							<button class="rounded bg-gray-100 px-2 py-1 text-[10px] font-medium text-gray-700 transition-colors hover:bg-gray-200 disabled:opacity-40 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
								disabled={busy.has(item.id)} onclick={(e) => { e.stopPropagation(); toggle(item); }}>
								{item.watched_at ? 'Unwatch' : '✓'}
							</button>
							<button class="rounded bg-gray-100 px-1.5 py-1 text-[10px] text-gray-400 transition-colors hover:bg-red-100 hover:text-red-600 disabled:opacity-40 dark:bg-gray-800 dark:text-gray-500 dark:hover:bg-red-900/50 dark:hover:text-red-400"
								disabled={busy.has(item.id)} onclick={(e) => { e.stopPropagation(); remove(item); }} aria-label="Remove">✕</button>
						</div>
					</div>

					<!-- Row 2: type chip · provider icons · sparkline · runtime -->
					<div class="ml-11 mt-1.5 flex items-center gap-2">
						<span class="shrink-0 rounded bg-gray-100 px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-gray-500 dark:bg-gray-800 dark:text-gray-400">
							{item.media_type === 'movie' ? '🎬' : '📺'}
						</span>
						{#if item.providers.length > 0}
							<div class="flex shrink-0 gap-0.5">
								{#each item.providers.slice(0, 3) as p (p.provider_id)}
									<img src="{TMDB_IMG}/w92{p.logo_path}" alt={p.provider_name} title={p.provider_name} class="h-3.5 w-3.5 rounded" />
								{/each}
								{#if item.providers.length > 3}
									<span class="text-[9px] text-gray-400 dark:text-gray-600">+{item.providers.length - 3}</span>
								{/if}
							</div>
						{:else if item.rentable}
							<span class="shrink-0 text-xs leading-none" title="Rent/Buy only">💲</span>
						{:else}
							{@const isOpen = libraryPopupId === item.id}
							<div class="relative shrink-0" data-library-popup>
								<button
									class="text-xs leading-none transition-opacity hover:opacity-60"
									onclick={(e) => { e.stopPropagation(); libraryPopupId = isOpen ? null : item.id; }}
									title="Not on streaming services"
								>🚫</button>
								{#if isOpen}
									<div class="absolute top-full left-0 z-20 mt-1 w-max rounded-lg bg-white px-3 py-2 shadow-lg ring-1 ring-gray-200 dark:bg-gray-900 dark:ring-gray-700">
										<p class="mb-1.5 text-[10px] font-semibold text-gray-400 dark:text-gray-500">Check your library</p>
										<div class="flex flex-col gap-1">
											<a href="https://www.kanopy.com/en/search?query={encodeURIComponent(item.title)}" target="_blank" rel="noopener noreferrer" class="text-[11px] text-gray-600 hover:text-orange-500 dark:text-gray-400 dark:hover:text-orange-400">Kanopy →</a>
											<a href="https://www.hoopladigital.com/search?q={encodeURIComponent(item.title)}" target="_blank" rel="noopener noreferrer" class="text-[11px] text-gray-600 hover:text-orange-500 dark:text-gray-400 dark:hover:text-orange-400">Hoopla →</a>
										</div>
									</div>
								{/if}
							</div>
						{/if}
						<div class="relative min-w-0 flex-1">
							<div class="h-px w-full bg-gray-200 dark:bg-gray-800"></div>
							<div class="absolute top-0 left-0 h-px transition-all duration-300"
								style="width:{pct}%; background:{lineColor}; opacity:0.7;"></div>
							<div class="absolute top-1/2 -translate-y-1/2 h-1.5 w-1.5 rounded-full transition-all duration-300"
								style="left:{pct}%; margin-left:-3px; background:{dotColor};"></div>
						</div>
						<span class="shrink-0 w-12 text-right text-[10px] tabular-nums text-gray-500">
							{#if item.runtime_minutes}
								{formatRuntime(effectiveRuntime(item), item.media_type)}
							{:else}
								<span class="italic">~{hms(DEFAULT_RUNTIME[item.media_type])}</span>
							{/if}
						</span>
					</div>

					<!-- Row 3: release chip (movies only; TV shows it in the season chip row) -->
					{#if item.media_type === 'movie' && releaseChip(item.release)}
						<p class="ml-11 mt-0.5 text-[10px] leading-snug text-amber-500 dark:text-amber-400">{releaseChip(item.release)}</p>
					{/if}

					<!-- Row 4: season picker -->
					{#if item.media_type === 'tv' && (item.seasons?.length || releaseChip(item.release))}
						<div class="ml-11 mt-1">
							{@render seasonPicker(item)}
						</div>
					{/if}
				</div>
			{/each}
		</div>

	<!-- ── GANTT LANES ────────────────────────────────────────────────────────── -->
	{:else}
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
				{@const colors = laneColors(resolvedHue(lane.providerId, lane.logo), theme.dark)}
				{@const budgetMins = budgetHours * 60}

				<div
					class="flex items-stretch overflow-visible rounded-xl"
					style="background:{colors.row}; border-left:{colors.border};"
				>
					<!-- Lane header -->
					<div class="flex w-40 shrink-0 flex-col items-center justify-center gap-1.5 px-3 py-2.5 text-center"
						style="background:{colors.header};">
						{#if lane.logo}
							<img src="{TMDB_IMG}/w92{lane.logo}" alt={lane.label} class="h-8 w-8 rounded-lg object-cover shadow" />
						{:else}
							<div class="flex h-8 w-8 items-center justify-center rounded-lg bg-gray-200 text-base dark:bg-gray-800">📺</div>
						{/if}
						<p class="text-[11px] font-semibold leading-tight" style="color:{colors.labelText}">{lane.label}</p>
						<p class="text-[10px] text-gray-400 dark:text-gray-600">{lane.items.length} title{lane.items.length === 1 ? '' : 's'} · {hms(lane.totalMins)}</p>
					</div>

					<!-- Budget zone: clips at month boundary -->
					<div class="relative min-w-0 flex-1 overflow-hidden py-3 pr-0">
						<!-- Month-end marker line -->
						<div class="pointer-events-none absolute inset-y-0 right-0 w-px border-r border-dashed border-white/15"></div>

						<!-- Bar ribbon -->
						<div class="flex h-8 items-stretch gap-0 pl-2">
							{#each lane.items as item (item.id)}
								{@const pct = (effectiveRuntime(item) / budgetMins) * 100}
								{@const isActive = activeItem?.id === item.id}
								{@const posterW = Math.round(BAR_H * 2 / 3)}

								<!-- svelte-ignore a11y_no_static_element_interactions -->
								<div animate:flip={{ duration: motion.reduced ? 0 : 250 }} class="relative shrink-0" style="flex: 0 0 {pct}%; min-width: 18px;" data-item>
									<button
										class="group relative flex h-full w-full items-stretch overflow-hidden transition-all duration-100 focus:outline-none {isActive ? 'ring-2 ring-white/50 brightness-125' : 'hover:brightness-110'}"
										style="background:{colors.barGradient}; box-shadow: inset 0 0 0 1px {colors.barStroke.replace('1px solid ', '')};"
										onclick={(e) => openGanttPopup(e, item)}
										title="{item.title} · {formatRuntime(effectiveRuntime(item), item.media_type)} remaining"
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
											<p class="truncate text-[10px] font-semibold leading-tight text-white/90">{item.title}</p>
											<p class="truncate text-[9px] leading-tight text-white/50">
												{formatRuntime(effectiveRuntime(item), item.media_type)}
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
							<span class="whitespace-nowrap rounded-full bg-orange-500/15 px-2 py-0.5 text-[10px] font-semibold text-orange-400">
								{overLabel(lane.overMins)}
							</span>
						</div>
					{/if}
				</div>
			{/each}
		</div>

		{#if lanes.length > 1}
			<p class="pt-1 text-center text-[11px] text-gray-400 dark:text-gray-700">Timeline sorted by filter selection · bar width = runtime · budget = {budgetHours}h/mo</p>
		{/if}
	{/if}
</div>

<!-- ── Detail panel ───────────────────────────────────────────────────────── -->
{#if detailItem}
	{@const di = detailItem}
	{@const diHue = resolvedHue(di.providers[0]?.provider_id ?? null, di.providers[0]?.logo_path ?? null)}
	{@const diPct = Math.min(100, (effectiveRuntime(di) / (budgetHours * 60)) * 100)}
	{@const diLine = diHue !== null ? `hsl(${diHue} 60% 52%)` : '#374151'}
	{@const diDot  = diHue !== null ? `hsl(${diHue} 70% 62%)` : '#4b5563'}
	<!-- Scrim -->
	<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
	<div
		class="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
		onclick={() => { detailItem = null; overviewExpanded = false; posterExpanded = false; }}
	></div>

	<!-- Panel: bottom sheet on mobile, right drawer on sm+ -->
	<div
		class="fixed bottom-0 inset-x-0 z-50 flex max-h-[90vh] flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl dark:bg-gray-900 sm:inset-y-0 sm:right-0 sm:left-auto sm:w-[22rem] sm:max-h-none sm:rounded-t-none sm:rounded-l-2xl"
		data-detail-panel
	>
		<!-- Title bar -->
		<div class="shrink-0 flex items-center justify-between border-b border-gray-100 px-4 py-3 dark:border-gray-800">
			<h2 class="truncate pr-2 text-sm font-semibold text-gray-900 dark:text-white">{di.title}</h2>
			<button
				onclick={() => { detailItem = null; overviewExpanded = false; posterExpanded = false; }}
				class="shrink-0 rounded-full p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
				aria-label="Close"
			>
				<svg class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor"><path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z"/></svg>
			</button>
		</div>

		<!-- Scrollable content -->
		<div class="flex-1 overflow-y-auto">
			<!-- Hero: poster + title/meta -->
			<div class="flex gap-3 px-4 pt-4 pb-3">
				{#if di.poster_path}
					<button
						class="w-20 shrink-0 self-start rounded-lg shadow-md overflow-hidden cursor-zoom-in"
						onclick={() => posterExpanded = true}
						aria-label="Expand poster"
					>
						<img src="{TMDB_IMG}/w185{di.poster_path}" alt={di.title} class="w-full h-full object-cover" />
					</button>
				{/if}
				<div class="min-w-0">
					<div class="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-gray-500 dark:text-gray-400">
						{#if di.added_at}<span>{di.added_at.slice(0,4)}</span>{/if}
						<span class="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium dark:bg-gray-800">{di.media_type === 'movie' ? '🎬 Movie' : '📺 TV'}</span>
						{#if di.director}<span>Dir. {di.director}</span>{/if}
						{#if di.creator}<span>Created by {di.creator}</span>{/if}
					</div>
					{#if di.genres?.length}
						<div class="mt-1.5 flex flex-wrap gap-1">
							{#each di.genres as g (g)}
								<span class="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] text-gray-500 dark:bg-gray-800 dark:text-gray-400">{g}</span>
							{/each}
						</div>
					{/if}
				</div>
			</div>

			<div class="space-y-4 px-4 pb-4">
				<!-- Overview -->
				{#if di.overview}
					<div>
						<p class="text-xs leading-relaxed text-gray-600 dark:text-gray-400
							{overviewExpanded ? '' : 'line-clamp-4'}">{di.overview}</p>
						{#if di.overview.length > 200}
							<button
								onclick={() => { overviewExpanded = !overviewExpanded; }}
								class="mt-1 text-[10px] font-medium text-orange-500 hover:text-orange-400"
							>{overviewExpanded ? 'Less' : 'More'}</button>
						{/if}
					</div>
				{/if}

				<!-- Runtime lollipop -->
				<div class="flex items-center gap-2">
					<div class="relative flex-1">
						<div class="h-px w-full bg-gray-200 dark:bg-gray-800"></div>
						<div class="absolute top-0 left-0 h-px transition-all duration-300"
							style="width:{diPct}%; background:{diLine}; opacity:0.75;"></div>
						<div class="absolute top-1/2 -translate-y-1/2 h-1.5 w-1.5 rounded-full transition-all duration-300"
							style="left:{diPct}%; margin-left:-3px; background:{diDot};"></div>
					</div>
					<span class="shrink-0 text-[10px] tabular-nums text-gray-500">
						{formatRuntime(effectiveRuntime(di), di.media_type)}
						{#if di.runtime_minutes && di.media_type === 'tv'}<span class="text-gray-400 dark:text-gray-600"> / {formatRuntime(di.runtime_minutes, di.media_type)}</span>{/if}
					</span>
				</div>

				<!-- Cast -->
				{#if di.cast?.length}
					<div>
						<p class="mb-2 text-[10px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">Cast</p>
						<div class="flex gap-2 overflow-x-auto pb-1">
							{#each di.cast as c (c.name)}
								<div class="flex shrink-0 flex-col items-center gap-1 w-14">
									<div class="h-12 w-12 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-800">
										{#if c.profile_path}
											<img src="{TMDB_IMG}/w185{c.profile_path}" alt={c.name} class="h-full w-full object-cover" />
										{:else}
											<div class="flex h-full w-full items-center justify-center text-lg text-gray-400">👤</div>
										{/if}
									</div>
									<p class="text-center text-[9px] font-medium leading-tight text-gray-700 dark:text-gray-300 line-clamp-2">{c.name}</p>
									<p class="text-center text-[9px] leading-tight text-gray-400 dark:text-gray-600 line-clamp-1">{c.character}</p>
								</div>
							{/each}
						</div>
					</div>
				{:else if !di.cast}
					<p class="text-[10px] text-gray-400 dark:text-gray-600">Run <strong>Settings → Refresh Data</strong> to load cast info.</p>
				{/if}

				<!-- Where to watch -->
				<div>
					<p class="mb-2 text-[10px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">Where to watch</p>
					{#if di.providers.length}
						<div class="flex flex-wrap gap-2">
							{#each di.providers as p (p.provider_id)}
								<div class="flex items-center gap-1.5">
									<img src="{TMDB_IMG}/w92{p.logo_path}" alt={p.provider_name} class="h-6 w-6 rounded-lg" />
									<span class="text-xs text-gray-600 dark:text-gray-400">{p.provider_name}</span>
								</div>
							{/each}
						</div>
					{:else if di.rentable}
						<p class="text-xs text-gray-500">💲 Available to rent or buy</p>
					{:else}
						<div class="space-y-1">
							<p class="text-xs text-gray-500">🚫 Not on streaming services</p>
							<div class="flex gap-3">
								<a href="https://www.kanopy.com/en/search?query={encodeURIComponent(di.title)}" target="_blank" rel="noopener noreferrer" class="text-xs text-orange-500 hover:text-orange-400">Kanopy →</a>
								<a href="https://www.hoopladigital.com/search?q={encodeURIComponent(di.title)}" target="_blank" rel="noopener noreferrer" class="text-xs text-orange-500 hover:text-orange-400">Hoopla →</a>
							</div>
						</div>
					{/if}
				</div>

				<!-- Seasons with episode counts -->
				{#if di.media_type === 'tv' && (di.seasons?.length || releaseChip(di.release))}
					{@const chip = releaseChip(di.release)}
					<div>
						<p class="mb-2 text-[10px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">Seasons</p>
						<div class="space-y-1">
							{#each (di.seasons ?? []).filter(s =>
								s.episode_count > 0 &&
								(!chip || di.release?.next_season == null || s.season_number < di.release.next_season)
							) as season (season.season_number)}
								{@const watched = (di.watched_seasons ?? []).includes(season.season_number)}
								<div class="flex items-center gap-2">
									<button
										class="inline-flex items-center rounded px-1.5 py-0.5 text-[9px] font-semibold leading-none transition-colors
											{watched
												? 'bg-teal-100 text-teal-700 dark:bg-teal-900/60 dark:text-teal-400'
												: 'bg-gray-100 text-gray-500 hover:text-gray-700 dark:bg-gray-800 dark:text-gray-500 dark:hover:text-gray-300'}"
										onclick={() => toggleSeason(di, season.season_number)}
									>
										{watched ? '✓' : 'S'}{season.season_number}
									</button>
									<span class="text-xs text-gray-500 dark:text-gray-400">{season.episode_count} eps</span>
								</div>
							{/each}
							{#if chip}
								{@const isOpen = releasePopupId === di.id}
								{@const nextSeasonData = (di.seasons ?? []).find(s => s.season_number === di.release?.next_season)}
								<div class="flex items-center gap-2">
									<button
										class="relative inline-flex items-center rounded px-1.5 py-0.5 text-[9px] font-semibold leading-none ring-1 transition-colors
											{isOpen
												? 'bg-orange-100 text-orange-700 ring-orange-400 dark:bg-orange-950/40 dark:text-orange-300 dark:ring-orange-500'
												: 'text-orange-600 ring-orange-300 hover:bg-orange-50 dark:text-orange-500 dark:ring-orange-700 dark:hover:bg-orange-950/30'}"
										onclick={() => { releasePopupId = isOpen ? null : di.id; }}
										data-release-popup
									>
										{di.release?.next_season != null ? `S${di.release.next_season}` : 'Next'}
										{#if isOpen}
											<div class="absolute top-full left-0 z-20 mt-1 w-max max-w-[14rem] rounded-lg bg-white px-2.5 py-1.5 text-[10px] leading-snug text-gray-700 shadow-lg ring-1 ring-gray-200 dark:bg-gray-900 dark:text-gray-300 dark:ring-gray-700">
												{chip}
											</div>
										{/if}
									</button>
									{#if nextSeasonData?.episode_count}
										<span class="text-xs text-gray-500 dark:text-gray-400">{nextSeasonData.episode_count} eps</span>
									{/if}
									<span class="text-xs text-orange-500 dark:text-orange-400">{chip}</span>
								</div>
							{/if}
						</div>
					</div>
				{/if}
			</div>
		</div>

		<!-- Sticky footer actions -->
		<div class="shrink-0 border-t border-gray-100 px-4 py-3 dark:border-gray-800 flex gap-2">
			<button
				class="flex-1 rounded-lg py-2 text-sm font-medium transition-colors
					{di.watched_at
						? 'bg-teal-100 text-teal-700 hover:bg-teal-200 dark:bg-teal-900/40 dark:text-teal-400 dark:hover:bg-teal-900/60'
						: 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'}"
				disabled={busy.has(di.id)}
				onclick={async () => { await toggle(di); detailItem = items.find(i => i.id === di.id) ?? null; }}
			>{di.watched_at ? '↩ Unwatch' : '✓ Watched'}</button>
			<button
				class="rounded-lg bg-gray-100 px-4 py-2 text-sm text-gray-500 transition-colors hover:bg-red-100 hover:text-red-600 disabled:opacity-40 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-red-900/50 dark:hover:text-red-400"
				disabled={busy.has(di.id)}
				onclick={async () => { await remove(di); detailItem = null; }}
			>✕ Remove</button>
		</div>
	</div>

	<!-- Poster lightbox -->
	{#if posterExpanded && di.poster_path}
		<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
		<div
			class="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-6 backdrop-blur-sm cursor-zoom-out"
			onclick={() => posterExpanded = false}
		>
			<img
				src="{TMDB_IMG}/w500{di.poster_path}"
				alt={di.title}
				class="max-h-full max-w-full rounded-xl shadow-2xl"
			/>
		</div>
	{/if}
{/if}

<!-- Filter dock now lives in src/routes/+layout.svelte (shared between the
     nav-inline lg+ placement and the fixed floating placement below lg). -->

<!-- ── Gantt detail popup (fixed-position, escapes overflow:hidden) ──────── -->
{#if activeItem && ganttPopupAnchor}
	<div
		class="fixed z-50 w-56 rounded-xl bg-white p-3 shadow-2xl ring-1 ring-gray-200 dark:bg-gray-800 dark:ring-white/10"
		style="left:{ganttPopupAnchor.x}px; top:{ganttPopupAnchor.y}px;"
		data-item
	>
		<p class="mb-1 text-sm font-semibold leading-snug">{activeItem.title}</p>
		<p class="mb-1 text-xs text-gray-500 dark:text-gray-400">
				🕐 {formatRuntime(effectiveRuntime(activeItem), activeItem.media_type)} remaining
		</p>
		{@render seasonPicker(activeItem)}
		<div class="mt-2 mb-2 flex flex-wrap items-center gap-1">
			<span class="rounded bg-gray-100 px-1 py-0.5 text-[11px] dark:bg-gray-700">
				{activeItem.media_type === 'movie' ? '🎬' : '📺'}
			</span>
			{#each activeItem.providers as p (p.provider_id)}
				<img src="{TMDB_IMG}/w92{p.logo_path}" alt={p.provider_name} title={p.provider_name} class="h-5 w-5 rounded" />
			{/each}
		</div>
		<div class="flex gap-1.5">
			<button class="flex-1 rounded-md bg-gray-100 py-1.5 text-xs font-medium transition-colors hover:bg-gray-200 disabled:opacity-40 dark:bg-gray-700 dark:hover:bg-gray-600"
				disabled={busy.has(activeItem.id)} onclick={() => toggle(activeItem!)}>
				{activeItem.watched_at ? 'Unwatch' : '✓ Watched'}
			</button>
			<button class="rounded-md bg-gray-100 px-2.5 py-1.5 text-xs text-gray-400 transition-colors hover:bg-red-100 hover:text-red-600 disabled:opacity-40 dark:bg-gray-700 dark:hover:bg-red-900/50 dark:hover:text-red-400"
				disabled={busy.has(activeItem.id)} onclick={() => remove(activeItem!)} aria-label="Remove">✕</button>
		</div>
	</div>
{/if}

