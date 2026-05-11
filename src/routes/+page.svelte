<script lang="ts">
	import { onMount } from 'svelte';
	import type { WatchlistItem } from '$lib/types';
	import { getAll, removeItem, setWatched, updateShowProgress } from '$lib/db';
	import { TMDB_IMG, formatRuntime } from '$lib/tmdb';
	import { laneColors, providerHue, extractLogoHue } from '$lib/colors';
	import { remainingRuntime, progressLabel } from '$lib/progress';

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
	let items       = $state<WatchlistItem[]>([]);
	let loaded      = $state(false);
	let tab         = $state<'queue' | 'watched'>('queue');
	let busy        = $state(new Set<number>());
	// Gantt detail popup — fixed-position to escape the overflow:hidden budget zone
	let activeItem       = $state<WatchlistItem | null>(null);
	let ganttPopupAnchor = $state<{ x: number; y: number } | null>(null);

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

	// lane drag state
	let laneOrder   = $state<string[]>([]);
	let dragKey     = $state<string | null>(null);
	let dragOverKey = $state<string | null>(null);

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
			.sort((a, b) => b.totalMins - a.totalMins)
			.map((l) => ({ ...l, overMins: Math.max(0, l.totalMins - budgetMins) }));

		if (noProvider.length) {
			const totalMins = noProvider.reduce((s, i) => s + effectiveRuntime(i), 0);
			out.push({ key: '__none__', label: 'Not Streaming', logo: null, providerId: null,
				items: noProvider, totalMins, overMins: Math.max(0, totalMins - budgetMins) });
		}
		return out;
	});

	// Apply saved lane order; new providers append at end
	let lanes = $derived.by((): Lane[] => {
		const byKey = new Map(rawLanes.map((l) => [l.key, l]));
		const ordered: Lane[] = [];
		for (const key of laneOrder) { const l = byKey.get(key); if (l) ordered.push(l); }
		for (const lane of rawLanes) { if (!laneOrder.includes(lane.key)) ordered.push(lane); }
		return ordered;
	});

	// ── Lifecycle ─────────────────────────────────────────────────────────────
	async function reload() { items = await getAll(); }

	onMount(async () => {
		sortBy      = loadPref<SortKey>('sq:sort', 'added');
		viewMode    = loadPref<ViewKey>('sq:view', 'grid');
		budgetHours = loadJSON<number>('sq:budget', 40);
		laneOrder   = loadJSON<string[]>('sq:laneOrder', []);
		await reload();
		loaded = true;
	});

	$effect(() => {
		try {
			localStorage.setItem('sq:sort', sortBy);
			localStorage.setItem('sq:view', viewMode);
			localStorage.setItem('sq:budget', JSON.stringify(budgetHours));
			localStorage.setItem('sq:laneOrder', JSON.stringify(laneOrder));
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

	// ── Lane drag-to-reorder ──────────────────────────────────────────────────
	function onDragStart(key: string) { dragKey = key; }
	function onDragOver(e: DragEvent, key: string) { e.preventDefault(); dragOverKey = key; }
	function onDrop(key: string) {
		if (!dragKey || dragKey === key) { dragKey = dragOverKey = null; return; }
		const cur  = lanes.map((l) => l.key);
		const from = cur.indexOf(dragKey);
		const to   = cur.indexOf(key);
		const next = [...cur]; next.splice(from, 1); next.splice(to, 0, dragKey);
		laneOrder = next; dragKey = dragOverKey = null;
	}
	function onDragEnd() { dragKey = dragOverKey = null; }

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

<svelte:head><title>StreamQ — My Queue</title></svelte:head>

<svelte:document onclick={(e) => {
	if (activeItem && !(e.target as Element).closest('[data-item]')) {
		activeItem = null; ganttPopupAnchor = null;
	}
}} />

{#snippet seasonPicker(item: WatchlistItem)}
	{#if item.media_type === 'tv' && item.seasons?.length}
		<div class="flex flex-wrap gap-0.5 pt-0.5">
			{#each item.seasons as season (season.season_number)}
				{@const watched = (item.watched_seasons ?? []).includes(season.season_number)}
				<button
					class="rounded px-1.5 py-0.5 text-[9px] font-semibold leading-none transition-colors
						{watched
							? 'bg-teal-900/60 text-teal-400'
							: 'bg-gray-800 text-gray-500 hover:text-gray-300'}"
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
	<!-- Header -->
	<div class="flex items-center justify-end">
		<a class="rounded-lg bg-orange-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-orange-400" href="/search">
			+ Add Titles
		</a>
	</div>

	<!-- Toolbar -->
	{#if loaded && items.length > 0}
		<div class="flex flex-wrap items-center gap-3">
			<!-- Queue / Watched tabs -->
			<div class="flex gap-1 rounded-lg bg-gray-900 p-1">
				<button class="rounded-md px-4 py-1.5 text-sm font-medium transition-colors {tab === 'queue' ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-white'}"
					onclick={() => (tab = 'queue')}>To Watch ({queued.length})</button>
				<button class="rounded-md px-4 py-1.5 text-sm font-medium transition-colors {tab === 'watched' ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-white'}"
					onclick={() => (tab = 'watched')}>Watched ({watched.length})</button>
			</div>

			<div class="flex-1"></div>

			<!-- Sort -->
			<div class="flex items-center gap-1.5">
				<span class="text-xs text-gray-500">Sort</span>
				<div class="flex gap-0.5 rounded-lg bg-gray-900 p-1">
					{#each ([['added','Recent'],['title','A–Z'],['runtime','Runtime']] as const) as [key, label] (key)}
						<button class="rounded-md px-3 py-1 text-xs font-medium transition-colors {sortBy === key ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-white'}"
							onclick={() => (sortBy = key)}>{label}</button>
					{/each}
				</div>
			</div>

			<!-- View -->
			<div class="flex items-center gap-1.5">
				<span class="text-xs text-gray-500">View</span>
				<div class="flex gap-0.5 rounded-lg bg-gray-900 p-1">
					<button class="rounded-md px-3 py-1 text-xs font-medium transition-colors {viewMode === 'grid' ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-white'}"
						onclick={() => (viewMode = 'grid')}>⊞ Grid</button>
					<button class="rounded-md px-3 py-1 text-xs font-medium transition-colors {viewMode === 'list' ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-white'}"
						onclick={() => (viewMode = 'list')}>☰ List</button>
					<button class="rounded-md px-3 py-1 text-xs font-medium transition-colors {viewMode === 'lanes' ? 'bg-orange-500 text-white' : 'text-gray-400 hover:text-white'}"
						onclick={() => (viewMode = 'lanes')}>≋ Gantt</button>
				</div>
			</div>
		</div>
	{/if}

	<!-- Loading -->
	{#if !loaded}
		<div class="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
			{#each { length: 5 } as _, i (i)}<div class="aspect-[2/3] animate-pulse rounded-xl bg-gray-800"></div>{/each}
		</div>

	<!-- Empty -->
	{:else if activeItems.length === 0}
		<div class="flex flex-col items-center justify-center py-24 text-center">
			{#if tab === 'queue'}
				<p class="mb-4 text-5xl">🎬</p>
				<p class="text-lg font-medium text-gray-300">Your queue is empty</p>
				<p class="mt-1 text-sm text-gray-500">
					<a class="text-orange-400 hover:underline" href="/search">Search for movies and shows</a> to get started
				</p>
			{:else}
				<p class="mb-4 text-5xl">✅</p>
				<p class="text-lg font-medium text-gray-300">Nothing watched yet</p>
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
				<div class="flex flex-col overflow-hidden rounded-xl bg-gray-900">
					<div class="relative aspect-[2/3] bg-gray-800">
						{#if item.poster_path}
							<img src="{TMDB_IMG}/w300{item.poster_path}" alt={item.title} class="h-full w-full object-cover" />
						{:else}
							<div class="flex h-full w-full items-center justify-center text-4xl text-gray-600">🎬</div>
						{/if}
						<span class="absolute left-2 top-2 rounded bg-black/60 px-1.5 py-0.5 text-xs font-medium uppercase tracking-wide text-gray-300">
							{item.media_type === 'movie' ? 'Film' : 'TV'}
						</span>
					</div>
					<div class="flex flex-1 flex-col gap-2 p-3">
						<p class="line-clamp-2 text-sm font-medium leading-tight">{item.title}</p>
						<!-- Runtime sparkline -->
						<div class="flex items-center gap-2">
							<div class="relative flex-1">
								<div class="h-px w-full bg-gray-800"></div>
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
						{#if item.providers.length > 0}
							<div class="flex flex-wrap gap-1">
								{#each item.providers.slice(0, 4) as p (p.provider_id)}
									<img src="{TMDB_IMG}/w92{p.logo_path}" alt={p.provider_name} title={p.provider_name} class="h-5 w-5 rounded" />
								{/each}
								{#if item.providers.length > 4}<span class="text-xs text-gray-500">+{item.providers.length - 4}</span>{/if}
							</div>
						{:else}
							<p class="text-xs text-gray-600">Not streaming</p>
						{/if}
						<div class="mt-auto flex gap-1.5 pt-1">
							<button class="flex-1 rounded-md bg-gray-800 py-1 text-xs font-medium transition-colors hover:bg-gray-700 disabled:opacity-40"
								disabled={busy.has(item.id)} onclick={() => toggle(item)}>
								{item.watched_at ? 'Unwatch' : '✓ Watched'}
							</button>
							<button class="rounded-md bg-gray-800 px-2 py-1 text-xs text-gray-400 transition-colors hover:bg-red-900/50 hover:text-red-400 disabled:opacity-40"
								disabled={busy.has(item.id)} onclick={() => remove(item)} aria-label="Remove">✕</button>
						</div>
					</div>
				</div>
			{/each}
		</div>

	<!-- ── LIST ─────────────────────────────────────────────────────────────── -->
	{:else if viewMode === 'list'}
		<div class="divide-y divide-gray-800/60 rounded-xl overflow-hidden">
			{#each flatItems as item (item.id)}
				{@const rt = effectiveRuntime(item)}
				{@const pct = Math.min(100, (rt / (budgetHours * 60)) * 100)}
				{@const hue = resolvedHue(item.providers[0]?.provider_id ?? null, item.providers[0]?.logo_path ?? null)}
				{@const lineColor = hue !== null ? `hsl(${hue} 60% 52%)` : '#4b5563'}
				{@const dotColor  = hue !== null ? `hsl(${hue} 70% 62%)` : '#6b7280'}
				<div class="flex flex-col bg-gray-900/40 px-3 py-2 hover:bg-gray-900/80 transition-colors">
					<!-- Main row -->
					<div class="flex items-center gap-3">
						<!-- Poster -->
						<div class="relative h-12 w-8 shrink-0 overflow-hidden rounded bg-gray-800">
							{#if item.poster_path}
								<img src="{TMDB_IMG}/w92{item.poster_path}" alt={item.title} class="h-full w-full object-cover" />
							{:else}
								<div class="flex h-full w-full items-center justify-center text-sm text-gray-600">🎬</div>
							{/if}
						</div>

						<!-- Title + meta -->
						<div class="min-w-0 w-44 shrink-0">
							<p class="truncate text-sm font-medium leading-tight">{item.title}</p>
							<div class="mt-0.5 flex items-center gap-1.5">
								<span class="rounded bg-gray-800 px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-gray-400">
									{item.media_type === 'movie' ? 'Film' : 'TV'}
								</span>
								{#if item.providers.length > 0}
									<div class="flex gap-0.5">
										{#each item.providers.slice(0, 3) as p (p.provider_id)}
											<img src="{TMDB_IMG}/w92{p.logo_path}" alt={p.provider_name} title={p.provider_name} class="h-3.5 w-3.5 rounded" />
										{/each}
										{#if item.providers.length > 3}
											<span class="text-[9px] text-gray-600">+{item.providers.length - 3}</span>
										{/if}
									</div>
								{/if}
								{#if progressLabel(item)}
									<span class="text-[9px] text-orange-400/70">{progressLabel(item)}</span>
								{/if}
							</div>
						</div>

						<!-- Sparkline -->
						<div class="flex min-w-0 flex-1 items-center gap-2">
							<div class="relative flex-1">
								<div class="h-px w-full bg-gray-800"></div>
								<div class="absolute top-0 left-0 h-px transition-all duration-300"
									style="width:{pct}%; background:{lineColor}; opacity:0.7;"></div>
								<div class="absolute top-1/2 -translate-y-1/2 h-1.5 w-1.5 rounded-full transition-all duration-300"
									style="left:{pct}%; margin-left:-3px; background:{dotColor};"></div>
							</div>
							<span class="shrink-0 text-[10px] tabular-nums text-gray-500 w-14 text-right">
								{#if item.runtime_minutes}
									{formatRuntime(effectiveRuntime(item), item.media_type)}
								{:else}
									<span class="italic">~{hms(DEFAULT_RUNTIME[item.media_type])}</span>
								{/if}
							</span>
						</div>

						<!-- Actions -->
						<div class="flex shrink-0 gap-1">
							<button class="rounded bg-gray-800 px-2 py-1 text-[10px] font-medium text-gray-300 transition-colors hover:bg-gray-700 disabled:opacity-40"
								disabled={busy.has(item.id)} onclick={() => toggle(item)}>
								{item.watched_at ? 'Unwatch' : '✓'}
							</button>
							<button class="rounded bg-gray-800 px-1.5 py-1 text-[10px] text-gray-500 transition-colors hover:bg-red-900/50 hover:text-red-400 disabled:opacity-40"
								disabled={busy.has(item.id)} onclick={() => remove(item)} aria-label="Remove">✕</button>
						</div>
					</div>
					<!-- Season picker (TV, indented to align with title) -->
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
			<div class="flex-1 border-t border-dashed border-gray-700 pt-1">
				<div class="flex justify-between text-[10px] text-gray-600">
					<span>0</span>
					<span class="font-medium text-gray-500">{budgetHours}h / mo</span>
				</div>
			</div>
		</div>

		<div class="space-y-1.5">
			{#each lanes as lane (lane.key)}
				{@const colors = laneColors(resolvedHue(lane.providerId, lane.logo))}
				{@const isDragOver = dragOverKey === lane.key && dragKey !== lane.key}
				{@const budgetMins = budgetHours * 60}

				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div
					class="flex items-stretch overflow-visible rounded-xl transition-all duration-150 {isDragOver ? 'ring-2 ring-white/20 scale-[1.005]' : ''}"
					style="background:{colors.row}; border-left:{colors.border};"
					draggable="true"
					ondragstart={() => onDragStart(lane.key)}
					ondragover={(e) => onDragOver(e, lane.key)}
					ondrop={() => onDrop(lane.key)}
					ondragend={onDragEnd}
				>
					<!-- Lane header -->
					<div class="flex w-40 shrink-0 flex-col items-center justify-center gap-1.5 px-3 py-2.5 text-center"
						style="background:{colors.header};">
						<div class="cursor-grab text-base opacity-25 active:cursor-grabbing" title="Drag to reorder">⠿</div>
						{#if lane.logo}
							<img src="{TMDB_IMG}/w92{lane.logo}" alt={lane.label} class="h-8 w-8 rounded-lg object-cover shadow" />
						{:else}
							<div class="flex h-8 w-8 items-center justify-center rounded-lg bg-gray-800 text-base">📺</div>
						{/if}
						<p class="text-[11px] font-semibold leading-tight" style="color:{colors.labelText}">{lane.label}</p>
						<p class="text-[10px] text-gray-600">{lane.items.length} title{lane.items.length === 1 ? '' : 's'} · {hms(lane.totalMins)}</p>
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
										title="{item.title} · {item.runtime_minutes ? formatRuntime(item.runtime_minutes, item.media_type) : '~' + hms(DEFAULT_RUNTIME[item.media_type])}"
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
												{#if item.runtime_minutes}
													{formatRuntime(item.runtime_minutes, item.media_type)}
												{:else}
													~{hms(DEFAULT_RUNTIME[item.media_type])}
												{/if}
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
			<p class="pt-1 text-center text-[11px] text-gray-700">Drag lanes to reorder · bar width = runtime · budget = {budgetHours}h/mo</p>
		{/if}
	{/if}
</div>

<!-- ── Gantt detail popup (fixed-position, escapes overflow:hidden) ──────── -->
{#if activeItem && ganttPopupAnchor}
	<div
		class="fixed z-50 w-56 rounded-xl bg-gray-800 p-3 shadow-2xl ring-1 ring-white/10"
		style="left:{ganttPopupAnchor.x}px; top:{ganttPopupAnchor.y}px;"
		data-item
	>
		<p class="mb-1 text-sm font-semibold leading-snug">{activeItem.title}</p>
		<p class="mb-1 text-xs text-gray-400">
			{#if activeItem.runtime_minutes}
				🕐 {formatRuntime(activeItem.runtime_minutes, activeItem.media_type)}
			{:else}
				🕐 ~{hms(DEFAULT_RUNTIME[activeItem.media_type])} <span class="italic text-gray-600">(estimated)</span>
			{/if}
		</p>
		{#if activeItem.overview}
			<p class="mb-2 line-clamp-3 text-xs text-gray-500">{activeItem.overview}</p>
		{/if}
		{@render seasonPicker(activeItem)}
		{#if activeItem.providers.length > 0}
			<div class="mt-2 mb-2 flex flex-wrap gap-1">
				{#each activeItem.providers as p (p.provider_id)}
					<img src="{TMDB_IMG}/w92{p.logo_path}" alt={p.provider_name} title={p.provider_name} class="h-5 w-5 rounded" />
				{/each}
			</div>
		{/if}
		<div class="flex gap-1.5">
			<button class="flex-1 rounded-md bg-gray-700 py-1.5 text-xs font-medium transition-colors hover:bg-gray-600 disabled:opacity-40"
				disabled={busy.has(activeItem.id)} onclick={() => toggle(activeItem!)}>
				{activeItem.watched_at ? 'Unwatch' : '✓ Watched'}
			</button>
			<button class="rounded-md bg-gray-700 px-2.5 py-1.5 text-xs text-gray-400 transition-colors hover:bg-red-900/50 hover:text-red-400 disabled:opacity-40"
				disabled={busy.has(activeItem.id)} onclick={() => remove(activeItem!)} aria-label="Remove">✕</button>
		</div>
	</div>
{/if}

