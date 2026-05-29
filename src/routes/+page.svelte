<script lang="ts">
	import { onMount } from 'svelte';
	import type { WatchlistItem } from '$lib/types';
	import { getAll, removeItem, setWatched, updateShowProgress } from '$lib/db';
	import { TMDB_IMG, formatRuntime } from '$lib/tmdb';
	import { laneColors, providerHue, extractLogoHue } from '$lib/colors';
	import { theme } from '$lib/theme.svelte';
	import { remainingRuntime, releaseChip } from '$lib/progress';
	import { generateShareKey, encryptWithKey } from '$lib/crypto';
	import { getQueueName, getQueueColors } from '$lib/queue-colors';
	import type { SharePayload } from '$lib/types';

	// ── Constants ─────────────────────────────────────────────────────────────
	const BAR_H = 32; // px — compact chip height
	const DEFAULT_RUNTIME: Record<'movie' | 'tv', number> = { movie: 90, tv: 45 };

	function effectiveRuntime(item: WatchlistItem): number {
		return remainingRuntime(item);
	}

	// ── Persisted prefs ───────────────────────────────────────────────────────
	type SortKey = 'added' | 'title' | 'runtime';
	type ViewKey = 'grid' | 'list' | 'lanes';

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
	let tab         = $state<'queue' | 'watched'>('queue');
	let busy        = $state(new Set<number>());
	// Gantt detail popup — fixed-position to escape the overflow:hidden budget zone
	let activeItem       = $state<WatchlistItem | null>(null);
	let ganttPopupAnchor = $state<{ x: number; y: number } | null>(null);

	// Toolbar dropdowns
	let filterOpen = $state(false);
	let viewOpen   = $state(false);

	// ── Share ─────────────────────────────────────────────────────────────────
	let shareOpen          = $state(false);
	let shareStatus        = $state<'queue' | 'watched' | 'both'>('queue');
	let shareType          = $state<'all' | 'movie' | 'tv'>('all');
	let shareProviderNames = $state(new Set<string>());
	let shareCreating      = $state(false);
	let shareUrl           = $state('');
	let shareCopied        = $state(false);
	let shareError         = $state('');

	let shareAllProviders = $derived.by(() => {
		const map = new Map<string, { provider_id: number; logo_path: string; count: number }>();
		for (const item of items) {
			for (const p of item.providers) {
				if (!map.has(p.provider_name)) {
					map.set(p.provider_name, { provider_id: p.provider_id, logo_path: p.logo_path, count: 0 });
				}
				map.get(p.provider_name)!.count++;
			}
		}
		return [...map.entries()]
			.sort((a, b) => b[1].count - a[1].count)
			.map(([name, { provider_id, logo_path, count }]) => ({ name, provider_id, logo_path, count }));
	});

	let shareFiltered = $derived.by(() => {
		let base = items;
		if (shareStatus === 'queue') base = base.filter((i) => !i.watched_at);
		else if (shareStatus === 'watched') base = base.filter((i) => i.watched_at);
		if (shareType !== 'all') base = base.filter((i) => i.media_type === shareType);
		const allChecked = shareProviderNames.size === shareAllProviders.length;
		return base.filter((i) => {
			if (!i.providers.length) return allChecked;
			return i.providers.some((p) => shareProviderNames.has(p.provider_name));
		});
	});

	let shareTotal = $derived(shareFiltered.reduce((s, i) => s + effectiveRuntime(i), 0));

	function openShare() {
		shareStatus = 'queue';
		shareType = 'all';
		shareProviderNames = new Set(shareAllProviders.map((p) => p.name));
		shareUrl = '';
		shareCopied = false;
		shareError = '';
		shareOpen = true;
	}

	function toggleShareProvider(name: string) {
		const next = new Set(shareProviderNames);
		if (next.has(name)) next.delete(name); else next.add(name);
		shareProviderNames = next;
		shareUrl = '';
	}

	async function createShareLink() {
		if (!shareFiltered.length || shareCreating) return;
		shareCreating = true;
		shareUrl = '';
		shareError = '';
		try {
			const payload: SharePayload = {
				v: 1,
				queue_name: getQueueName(),
				items: shareFiltered.map((item) => ({
					tmdb_id: item.tmdb_id,
					media_type: item.media_type,
					title: item.title,
					poster_path: item.poster_path,
					providers: item.providers,
					runtime_minutes: item.runtime_minutes,
					seasons: (item.seasons ?? []).map((s) => ({ season_number: s.season_number, runtime_minutes: s.runtime_minutes }))
				}))
			};
			const key = await generateShareKey();
			const blob = await encryptWithKey(JSON.stringify(payload), key);
			const res = await fetch('/api/share', {
				method: 'POST',
				headers: { 'Content-Type': 'application/octet-stream' },
				body: blob
			});
			if (!res.ok) throw new Error(await res.text().catch(() => res.statusText));
			const { token } = (await res.json()) as { token: string };
			shareUrl = `${window.location.origin}/share/${token}#${key}`;
		} catch (e) {
			shareError = e instanceof Error ? e.message : 'Failed to create share link.';
		} finally {
			shareCreating = false;
		}
	}

	async function copyShareUrl() {
		try {
			await navigator.clipboard.writeText(shareUrl);
			shareCopied = true;
			setTimeout(() => { shareCopied = false; }, 2000);
		} catch {}
	}

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

	let sortBy      = $state<SortKey>('added');
	let viewMode    = $state<ViewKey>('grid');
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

	// ── Derived lists ─────────────────────────────────────────────────────────
	let queued      = $derived(items.filter((i) => !i.watched_at));
	let watched     = $derived(items.filter((i) => i.watched_at));
	let activeItems = $derived(tab === 'queue' ? queued : watched);

	function sorted(list: WatchlistItem[]): WatchlistItem[] {
		return [...list].sort((a, b) => {
			if (sortBy === 'title') return a.title.localeCompare(b.title);
			if (sortBy === 'runtime') {
				return (a.runtime_minutes ?? Infinity) - (b.runtime_minutes ?? Infinity);
			}
			return b.added_at.localeCompare(a.added_at);
		});
	}

	let flatItems = $derived(sorted(activeItems));

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
		const list = sorted(activeItems);
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

		const out: Lane[] = [...map.values()]
			.sort((a, b) => {
				if (sortBy === 'title') return a.label.localeCompare(b.label);
				if (sortBy === 'added') {
					const aMax = a.items.reduce((m, i) => (i.added_at > m ? i.added_at : m), '');
					const bMax = b.items.reduce((m, i) => (i.added_at > m ? i.added_at : m), '');
					return bMax.localeCompare(aMax);
				}
				return b.totalMins - a.totalMins;
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

	onMount(async () => {
		sortBy      = loadPref<SortKey>('sq:sort', 'added');
		viewMode    = loadPref<ViewKey>('sq:view', 'grid');
		budgetHours = loadJSON<number>('sq:budget', 40);
		queueColors = getQueueColors();
		await reload();
		loaded = true;
	});

	$effect(() => {
		try {
			localStorage.setItem('sq:sort', sortBy);
			localStorage.setItem('sq:view', viewMode);
			localStorage.setItem('sq:budget', JSON.stringify(budgetHours));
		} catch {}
	});

	// Extract logo hues for all providers in view (runs whenever activeItems changes)
	$effect(() => {
		const logos = new Set<string>();
		for (const item of activeItems) {
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
	if (!t.closest('[data-dropdown]')) { filterOpen = false; viewOpen = false; }
}} />

{#snippet seasonPicker(item: WatchlistItem)}
	{#if item.media_type === 'tv' && item.seasons?.length}
		<div class="flex flex-wrap gap-0.5 pt-0.5">
			{#each item.seasons as season (season.season_number)}
				{@const watched = (item.watched_seasons ?? []).includes(season.season_number)}
				<button
					class="rounded px-1.5 py-0.5 text-[9px] font-semibold leading-none transition-colors
						{watched
							? 'bg-teal-100 text-teal-700 dark:bg-teal-900/60 dark:text-teal-400'
							: 'bg-gray-100 text-gray-500 hover:text-gray-700 dark:bg-gray-800 dark:text-gray-500 dark:hover:text-gray-300'}"
					onclick={() => toggleSeason(item, season.season_number)}
					title="{season.name} · {season.episode_count} eps"
				>
					{watched ? '✓ ' : ''}S{season.season_number}
				</button>
			{/each}
		</div>
	{/if}
{/snippet}

<div class="space-y-6">
	<!-- Toolbar -->
	<div class="flex items-center gap-2">
		<!-- Add Titles -->
		<a class="rounded-lg bg-orange-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-orange-400" href="/search">
			<span class="sm:hidden">+</span>
			<span class="hidden sm:inline">+ Add Titles</span>
		</a>

		{#if loaded && items.length > 0}
			<!-- Filter dropdown -->
			<div class="relative" data-dropdown="filter">
				<button
					onclick={() => { filterOpen = !filterOpen; viewOpen = false; }}
					class="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors
						{filterOpen
							? 'bg-gray-200 text-gray-900 dark:bg-gray-700 dark:text-white'
							: 'bg-gray-100 text-gray-600 hover:bg-gray-200 hover:text-gray-900 dark:bg-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white'}"
				>
					<!-- Funnel icon -->
					<svg viewBox="0 0 20 20" fill="currentColor" class="h-3.5 w-3.5 shrink-0">
						<path fill-rule="evenodd" d="M2.628 1.601C5.028 1.206 7.49 1 10 1s4.973.206 7.372.601a.75.75 0 01.628.74v2.288a2.25 2.25 0 01-.659 1.59l-4.682 4.683a2.25 2.25 0 00-.659 1.59v3.037c0 .684-.31 1.33-.844 1.757l-1.937 1.55A.75.75 0 018 18.25v-5.757a2.25 2.25 0 00-.659-1.591L2.659 6.22A2.25 2.25 0 012 4.629V2.34a.75.75 0 01.628-.74z" clip-rule="evenodd" />
					</svg>
					<span class="hidden sm:inline">Filter</span>
				</button>
				{#if filterOpen}
					<div class="absolute left-0 top-full z-40 mt-1 min-w-max space-y-1.5 rounded-xl bg-white p-2 shadow-lg ring-1 ring-gray-200 dark:bg-gray-900 dark:ring-white/10">
						<!-- Tab filter -->
						<div class="flex gap-0.5 rounded-lg bg-gray-100 p-1 dark:bg-gray-800">
							<button class="rounded-md px-3 py-1 text-xs font-medium transition-colors {tab === 'queue' ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-white dark:shadow-none' : 'text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white'}"
								onclick={() => (tab = 'queue')}>To Watch ({queued.length})</button>
							<button class="rounded-md px-3 py-1 text-xs font-medium transition-colors {tab === 'watched' ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-white dark:shadow-none' : 'text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white'}"
								onclick={() => (tab = 'watched')}>Watched ({watched.length})</button>
						</div>
						<!-- Sort -->
						<div class="flex gap-0.5 rounded-lg bg-gray-100 p-1 dark:bg-gray-800">
							{#each ([['added','Recent'],['title','A–Z'],['runtime','Runtime']] as const) as [key, label] (key)}
								<button class="rounded-md px-3 py-1 text-xs font-medium transition-colors {sortBy === key ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-white dark:shadow-none' : 'text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white'}"
									onclick={() => (sortBy = key)}>{label}</button>
							{/each}
						</div>
					</div>
				{/if}
			</div>

			<!-- View dropdown -->
			<div class="relative" data-dropdown="view">
				<button
					onclick={() => { viewOpen = !viewOpen; filterOpen = false; }}
					class="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors
						{viewOpen
							? 'bg-gray-200 text-gray-900 dark:bg-gray-700 dark:text-white'
							: 'bg-gray-100 text-gray-600 hover:bg-gray-200 hover:text-gray-900 dark:bg-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white'}"
				>
					<!-- Eye icon -->
					<svg viewBox="0 0 20 20" fill="currentColor" class="h-3.5 w-3.5 shrink-0">
						<path d="M10 12.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5z" />
						<path fill-rule="evenodd" d="M.664 10.59a1.651 1.651 0 010-1.186A10.004 10.004 0 0110 3c4.257 0 7.893 2.66 9.336 6.41.147.381.146.804 0 1.186A10.004 10.004 0 0110 17c-4.257 0-7.893-2.66-9.336-6.41z" clip-rule="evenodd" />
					</svg>
					<span class="hidden sm:inline">View</span>
				</button>
				{#if viewOpen}
					<div class="absolute left-0 top-full z-40 mt-1 min-w-max rounded-xl bg-white p-2 shadow-lg ring-1 ring-gray-200 dark:bg-gray-900 dark:ring-white/10">
						<div class="flex gap-0.5 rounded-lg bg-gray-100 p-1 dark:bg-gray-800">
							<button class="rounded-md px-3 py-1 text-xs font-medium transition-colors {viewMode === 'grid' ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-white dark:shadow-none' : 'text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white'}"
								onclick={() => (viewMode = 'grid')}>⊞ Grid</button>
							<button class="rounded-md px-3 py-1 text-xs font-medium transition-colors {viewMode === 'list' ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-white dark:shadow-none' : 'text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white'}"
								onclick={() => (viewMode = 'list')}>☰ List</button>
							<button class="rounded-md px-3 py-1 text-xs font-medium transition-colors {viewMode === 'lanes' ? 'bg-orange-500 text-white' : 'text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white'}"
								onclick={() => (viewMode = 'lanes')}>≋ Gantt</button>
						</div>
					</div>
				{/if}
			</div>

			<!-- Share button -->
			<button
				onclick={openShare}
				class="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors
					bg-gray-100 text-gray-600 hover:bg-gray-200 hover:text-gray-900 dark:bg-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white"
			>
				<svg viewBox="0 0 20 20" fill="currentColor" class="h-3.5 w-3.5 shrink-0" aria-hidden="true">
					<path d="M13 4.5a2.5 2.5 0 11.702 1.737L6.97 9.604a2.518 2.518 0 010 .792l6.733 3.367a2.5 2.5 0 11-.671 1.341l-6.733-3.367a2.5 2.5 0 110-3.474l6.733-3.367A2.5 2.5 0 0113 4.5z"/>
				</svg>
				<span class="hidden sm:inline">Share</span>
			</button>
		{/if}
	</div>

	<!-- Loading -->
	{#if !loaded}
		<div class="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
			{#each { length: 5 } as _, i (i)}<div class="aspect-[2/3] animate-pulse rounded-xl bg-gray-200 dark:bg-gray-800"></div>{/each}
		</div>

	<!-- Empty -->
	{:else if activeItems.length === 0}
		<div class="flex flex-col items-center justify-center py-24 text-center">
			{#if tab === 'queue'}
				<p class="mb-4 text-5xl">🎬</p>
				<p class="text-lg font-medium text-gray-700 dark:text-gray-300">Your queue is empty</p>
				<p class="mt-1 text-sm text-gray-500">
					<a class="text-orange-500 hover:underline" href="/search">Search for movies and shows</a> to get started
				</p>
			{:else}
				<p class="mb-4 text-5xl">✅</p>
				<p class="text-lg font-medium text-gray-700 dark:text-gray-300">Nothing watched yet</p>
				<p class="mt-1 text-sm text-gray-500">Mark titles as watched and they'll appear here</p>
			{/if}
		</div>

	<!-- ── GRID ──────────────────────────────────────────────────────────────── -->
	{:else if viewMode === 'grid'}
		<div class="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
			{#each flatItems as item (item.id)}
				{@const cardHue = resolvedHue(item.providers[0]?.provider_id ?? null, item.providers[0]?.logo_path ?? null)}
				{@const cardPct = Math.min(100, (effectiveRuntime(item) / (budgetHours * 60)) * 100)}
				{@const cardLine = cardHue !== null ? `hsl(${cardHue} 60% 52%)` : '#374151'}
				{@const cardDot  = cardHue !== null ? `hsl(${cardHue} 70% 62%)` : '#4b5563'}
				{@const tagColor = item.queue_tag ? (queueColors[item.queue_tag] ?? null) : null}
				<div class="flex flex-col overflow-hidden rounded-xl bg-white ring-1 ring-gray-200 dark:bg-gray-900 dark:ring-0"
					style={tagColor ? `border-left: 3px solid ${tagColor}` : ''}>
					<div class="relative aspect-[2/3] bg-gray-200 dark:bg-gray-800">
						{#if item.poster_path}
							<img src="{TMDB_IMG}/w300{item.poster_path}" alt={item.title} class="h-full w-full object-cover" />
						{:else}
							<div class="flex h-full w-full items-center justify-center text-4xl text-gray-400 dark:text-gray-600">🎬</div>
						{/if}
					</div>
					<div class="flex flex-1 flex-col gap-2 p-3">
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
								{#if item.runtime_minutes}
									{formatRuntime(item.runtime_minutes, item.media_type)}
								{:else}
									~{hms(DEFAULT_RUNTIME[item.media_type])}
								{/if}
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
									<span class="text-xs text-gray-400 dark:text-gray-500">Rent/Buy only</span>
								{:else if releaseChip(item.release)}
									<span class="text-xs text-gray-400 dark:text-gray-600">Not streaming</span>
								{:else}
									<span class="text-xs text-gray-400 dark:text-gray-600">Not streaming —</span>
									<a href="https://www.kanopy.com/en/search?query={encodeURIComponent(item.title)}" target="_blank" rel="noopener noreferrer" class="text-xs text-gray-400 underline-offset-2 hover:text-gray-600 hover:underline dark:text-gray-600 dark:hover:text-gray-400">Kanopy</a>
									<a href="https://www.hoopladigital.com/search?q={encodeURIComponent(item.title)}" target="_blank" rel="noopener noreferrer" class="text-xs text-gray-400 underline-offset-2 hover:text-gray-600 hover:underline dark:text-gray-600 dark:hover:text-gray-400">Hoopla</a>
								{/if}
							{/if}
						</div>
						{#if releaseChip(item.release)}
							<p class="text-xs leading-snug text-amber-600 dark:text-amber-400">{releaseChip(item.release)}</p>
						{/if}
						<div class="mt-auto flex gap-1.5 pt-1">
							<button class="flex-1 rounded-md bg-gray-100 py-1 text-xs font-medium transition-colors hover:bg-gray-200 disabled:opacity-40 dark:bg-gray-800 dark:hover:bg-gray-700"
								disabled={busy.has(item.id)} onclick={() => toggle(item)}>
								{item.watched_at ? 'Unwatch' : '✓ Watched'}
							</button>
							<button class="rounded-md bg-gray-100 px-2 py-1 text-xs text-gray-500 transition-colors hover:bg-red-100 hover:text-red-600 disabled:opacity-40 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-red-900/50 dark:hover:text-red-400"
								disabled={busy.has(item.id)} onclick={() => remove(item)} aria-label="Remove">✕</button>
						</div>
					</div>
				</div>
			{/each}
		</div>

	<!-- ── LIST ─────────────────────────────────────────────────────────────── -->
	{:else if viewMode === 'list'}
		<div class="divide-y divide-gray-200 overflow-hidden rounded-xl dark:divide-gray-800/60">
			{#each flatItems as item (item.id)}
				{@const rt = effectiveRuntime(item)}
				{@const pct = Math.min(100, (rt / (budgetHours * 60)) * 100)}
				{@const hue = resolvedHue(item.providers[0]?.provider_id ?? null, item.providers[0]?.logo_path ?? null)}
				{@const lineColor = hue !== null ? `hsl(${hue} 60% 52%)` : '#9ca3af'}
				{@const dotColor  = hue !== null ? `hsl(${hue} 70% 62%)` : '#6b7280'}
				{@const tagColor  = item.queue_tag ? (queueColors[item.queue_tag] ?? null) : null}
				<div class="flex flex-col bg-white px-3 py-2.5 transition-colors hover:bg-gray-50 dark:bg-gray-900/40 dark:hover:bg-gray-900/80"
					style={tagColor ? `border-left: 3px solid ${tagColor}` : ''}>
					<!-- Row 1: poster · title · actions -->
					<div class="flex items-center gap-3">
						<div class="relative h-12 w-8 shrink-0 overflow-hidden rounded bg-gray-200 dark:bg-gray-800">
							{#if item.poster_path}
								<img src="{TMDB_IMG}/w92{item.poster_path}" alt={item.title} class="h-full w-full object-cover" />
							{:else}
								<div class="flex h-full w-full items-center justify-center text-sm text-gray-400 dark:text-gray-600">🎬</div>
							{/if}
						</div>
						<p class="min-w-0 flex-1 text-sm font-medium leading-tight">{item.title}</p>
						<div class="flex shrink-0 gap-1">
							<button class="rounded bg-gray-100 px-2 py-1 text-[10px] font-medium text-gray-700 transition-colors hover:bg-gray-200 disabled:opacity-40 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
								disabled={busy.has(item.id)} onclick={() => toggle(item)}>
								{item.watched_at ? 'Unwatch' : '✓'}
							</button>
							<button class="rounded bg-gray-100 px-1.5 py-1 text-[10px] text-gray-400 transition-colors hover:bg-red-100 hover:text-red-600 disabled:opacity-40 dark:bg-gray-800 dark:text-gray-500 dark:hover:bg-red-900/50 dark:hover:text-red-400"
								disabled={busy.has(item.id)} onclick={() => remove(item)} aria-label="Remove">✕</button>
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
							<span class="shrink-0 text-[9px] text-gray-400 dark:text-gray-500">Rent/Buy only</span>
						{:else if !releaseChip(item.release)}
							<a href="https://www.kanopy.com/en/search?query={encodeURIComponent(item.title)}" target="_blank" rel="noopener noreferrer" class="shrink-0 text-[9px] text-gray-400 underline-offset-2 hover:text-gray-600 hover:underline dark:text-gray-600 dark:hover:text-gray-400">Kanopy</a>
							<a href="https://www.hoopladigital.com/search?q={encodeURIComponent(item.title)}" target="_blank" rel="noopener noreferrer" class="shrink-0 text-[9px] text-gray-400 underline-offset-2 hover:text-gray-600 hover:underline dark:text-gray-600 dark:hover:text-gray-400">Hoopla</a>
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

					<!-- Row 3: release chip -->
					{#if releaseChip(item.release)}
						<p class="ml-11 mt-0.5 text-[10px] leading-snug text-amber-500 dark:text-amber-400">{releaseChip(item.release)}</p>
					{/if}

					<!-- Row 4: season picker -->
					{#if item.media_type === 'tv' && item.seasons?.length}
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
								<div class="relative shrink-0" style="flex: 0 0 {pct}%; min-width: 18px;" data-item>
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
			<p class="pt-1 text-center text-[11px] text-gray-400 dark:text-gray-700">Lanes sorted by filter selection · bar width = runtime · budget = {budgetHours}h/mo</p>
		{/if}
	{/if}
</div>

<!-- ── Share modal ────────────────────────────────────────────────────────── -->
{#if shareOpen}
	<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
	<div
		class="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 backdrop-blur-sm sm:items-center"
		onclick={() => { shareOpen = false; }}
	>
		<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
		<div
			class="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl dark:bg-gray-900"
			onclick={(e) => e.stopPropagation()}
		>
			<div class="mb-4 flex items-center justify-between">
				<h2 class="text-base font-semibold text-gray-900 dark:text-white">Share list</h2>
				<button onclick={() => { shareOpen = false; }} class="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200" aria-label="Close">✕</button>
			</div>

			<div class="space-y-4">
				<!-- Status filter -->
				<div>
					<p class="mb-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500">Include</p>
					<div class="flex gap-0.5 rounded-lg bg-gray-100 p-1 dark:bg-gray-800">
						{#each ([['queue','To Watch'],['watched','Watched'],['both','Both']] as const) as [key, label] (key)}
							<button class="flex-1 rounded-md px-2 py-1 text-xs font-medium transition-colors
								{shareStatus === key ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-white dark:shadow-none' : 'text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white'}"
								onclick={() => { shareStatus = key; shareUrl = ''; }}>{label}</button>
						{/each}
					</div>
				</div>

				<!-- Type filter -->
				<div>
					<p class="mb-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500">Type</p>
					<div class="flex gap-0.5 rounded-lg bg-gray-100 p-1 dark:bg-gray-800">
						{#each ([['all','All'],['movie','Movies'],['tv','TV']] as const) as [key, label] (key)}
							<button class="flex-1 rounded-md px-2 py-1 text-xs font-medium transition-colors
								{shareType === key ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-white dark:shadow-none' : 'text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white'}"
								onclick={() => { shareType = key; shareUrl = ''; }}>{label}</button>
						{/each}
					</div>
				</div>

				<!-- Provider filter -->
				{#if shareAllProviders.length > 0}
					<div>
						<p class="mb-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500">Providers</p>
						<div class="flex flex-wrap gap-1.5">
							{#each shareAllProviders as p (p.name)}
								{@const on = shareProviderNames.has(p.name)}
								<button
									onclick={() => toggleShareProvider(p.name)}
									class="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 transition-colors
										{on ? 'bg-orange-50 text-orange-700 ring-orange-300 dark:bg-orange-950/40 dark:text-orange-400 dark:ring-orange-800' : 'bg-gray-100 text-gray-500 ring-gray-200 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:ring-gray-700'}"
								>
									<img src="{TMDB_IMG}/w92{p.logo_path}" alt="" class="h-4 w-4 rounded" />
									{p.name}
								</button>
							{/each}
						</div>
					</div>
				{/if}

				<!-- Summary -->
				<div class="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2 dark:bg-gray-800">
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
								class="min-w-0 flex-1 rounded-lg bg-gray-100 px-3 py-2 text-xs text-gray-700 outline-none dark:bg-gray-800 dark:text-gray-300"
							/>
							<button
								onclick={copyShareUrl}
								class="shrink-0 rounded-lg px-3 py-2 text-xs font-medium transition-colors
									{shareCopied ? 'bg-teal-500 text-white' : 'bg-gray-200 text-gray-700 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600'}"
							>
								{shareCopied ? '✓ Copied' : 'Copy'}
							</button>
						</div>
						<p class="text-[10px] text-gray-400 dark:text-gray-600">Link expires in 30 days · server stores only the encrypted blob</p>
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
		</div>
	</div>
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

