<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { CastMember, Provider, ReleaseInfo, SeasonSummary } from '$lib/types';
	import { TMDB_IMG, formatRuntime } from '$lib/tmdb';
	import { releaseChip, remainingRuntime } from '$lib/progress';
	import { providerHue } from '$lib/colors';
	import { trapFocus } from '$lib/focus-trap';

	// Structural subset shared by WatchlistItem (queue) and SearchResult (add) —
	// both satisfy this without adapting, since Svelte/TS typing is structural.
	// `added_at`/`year` are mutually exclusive in practice (only one type has
	// each); whichever is present decides what displays as the item's year.
	export interface DetailPanelItem {
		id: number;
		title: string;
		poster_path: string | null;
		overview: string | null;
		media_type: 'movie' | 'tv';
		runtime_minutes: number | null;
		director?: string | null;
		creator?: string | null;
		genres?: string[];
		cast?: CastMember[];
		providers: Provider[];
		rentable?: boolean;
		release?: ReleaseInfo | null;
		seasons?: SeasonSummary[];
		watched_seasons?: number[];
		added_at?: string;
		year?: string | null;
		watched_at?: string | null;
		queue_tag?: string | null;
	}

	let {
		item,
		budgetHours,
		showSeasons,
		onToggleSeason,
		onClose,
		footer,
		queueColors = {},
		existingCollections = [],
		onSetCollection
	}: {
		item: DetailPanelItem;
		budgetHours: number;
		showSeasons: boolean;
		onToggleSeason?: (seasonNumber: number) => void;
		onClose: () => void;
		footer: Snippet<[DetailPanelItem]>;
		queueColors?: Record<string, string>;
		existingCollections?: string[];
		onSetCollection?: (tag: string | null) => Promise<void>;
	} = $props();

	let overviewExpanded = $state(false);
	let posterExpanded = $state(false);
	let releasePopupOpen = $state(false);
	let collectionOpen = $state(false);
	let newCollectionInput = $state('');
	let collectionBusy = $state(false);

	// A caller can switch `item` directly (e.g. clicking a different poster
	// while the panel is already open) without the panel ever closing, so this
	// component — not just `close()` — has to clear per-item UI state itself.
	//
	// #171: reset only when `item.id`'s *value* actually changes, not merely
	// when `item` is a new object with the same id — a caller can (and does,
	// e.g. app/+page.svelte's onSetCollection callback) reassign `item` to a
	// fresh object reference for the same title after a reload. Reading
	// `item.id` alone doesn't protect against that: Svelte reruns this effect
	// whenever the `item` prop itself is reassigned, regardless of whether
	// the id it reads back out is unchanged, so a naive version could still
	// stomp `collectionOpen` back to false immediately after Change… sets it.
	let lastItemId: number | undefined;
	$effect(() => {
		if (item.id === lastItemId) return;
		lastItemId = item.id;
		overviewExpanded = false;
		posterExpanded = false;
		releasePopupOpen = false;
		collectionOpen = false;
		newCollectionInput = '';
	});

	function close() {
		onClose();
		overviewExpanded = false;
		posterExpanded = false;
	}

	let displayYear = $derived(item.year ?? item.added_at?.slice(0, 4) ?? null);
	let hue = $derived(item.providers[0] ? providerHue(item.providers[0].provider_id) : null);
	// remainingRuntime is typed for the full WatchlistItem, but only reads
	// media_type/seasons/runtime_minutes/watched_seasons — all present here
	// (watched_seasons defaults to [] internally when absent, as it is for a
	// SearchResult that hasn't been added to the queue yet).
	let runtimeMins = $derived(
		remainingRuntime(item as unknown as Parameters<typeof remainingRuntime>[0])
	);
	let runtimePct = $derived(Math.min(100, (runtimeMins / (budgetHours * 60)) * 100));
	let lineColor = $derived(hue !== null ? `hsl(${hue} 60% 52%)` : '#374151');
	let dotColor = $derived(hue !== null ? `hsl(${hue} 70% 62%)` : '#4b5563');
	let chip = $derived(releaseChip(item.release ?? null));
</script>

<svelte:document
	onclick={(e) => {
		const t = e.target as Element;
		if (!t.closest('[data-detail-panel]') && !t.closest('[data-detail-trigger]')) close();
	}}
/>

<!-- Scrim -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm" onclick={close}></div>

<!-- Panel: bottom sheet on mobile, right drawer on sm+ -->
<div
	class="fixed bottom-0 inset-x-0 z-50 flex max-h-[90vh] flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl dark:bg-gray-900 sm:inset-y-0 sm:right-0 sm:left-auto sm:w-[22rem] sm:max-h-none sm:rounded-t-none sm:rounded-l-2xl"
	data-detail-panel
	role="dialog"
	aria-modal="true"
	aria-labelledby="detail-panel-title"
	tabindex="-1"
	use:trapFocus={{ onEscape: close }}
>
	<!-- Title bar -->
	<div
		class="shrink-0 flex items-center justify-between border-b border-gray-100 px-4 py-3 dark:border-gray-800"
	>
		<h2
			id="detail-panel-title"
			class="truncate pr-2 text-sm font-semibold text-gray-900 dark:text-white"
		>
			{item.title}
		</h2>
		<button
			onclick={close}
			class="shrink-0 rounded-full p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
			aria-label="Close"
		>
			<svg class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor"
				><path
					d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z"
				/></svg
			>
		</button>
	</div>

	<!-- Scrollable content -->
	<div class="flex-1 overflow-y-auto">
		<!-- Hero: poster + meta -->
		<div class="flex gap-3 px-4 pt-4 pb-3">
			{#if item.poster_path}
				<button
					class="w-20 shrink-0 self-start rounded-lg shadow-md overflow-hidden cursor-zoom-in"
					onclick={() => (posterExpanded = true)}
					aria-label="Expand poster"
				>
					<img
						src="{TMDB_IMG}/w185{item.poster_path}"
						alt={item.title}
						class="w-full h-full object-cover"
					/>
				</button>
			{/if}
			<div class="min-w-0">
				<div
					class="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-gray-500 dark:text-gray-400"
				>
					{#if displayYear}<span>{displayYear}</span>{/if}
					<span class="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium dark:bg-gray-800"
						>{item.media_type === 'movie' ? '🎬 Movie' : '📺 TV'}</span
					>
					{#if item.director}<span>Dir. {item.director}</span>{/if}
					{#if item.creator}<span>Created by {item.creator}</span>{/if}
				</div>
				{#if item.genres?.length}
					<div class="mt-1.5 flex flex-wrap gap-1">
						{#each item.genres as g (g)}
							<span
								class="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] text-gray-500 dark:bg-gray-800 dark:text-gray-400"
								>{g}</span
							>
						{/each}
					</div>
				{/if}
			</div>
		</div>

		<div class="space-y-4 px-4 pb-4">
			<!-- Collection -->
			{#if onSetCollection}
				{@const tagColor = item.queue_tag ? (queueColors[item.queue_tag] ?? null) : null}
				<div class="flex items-center justify-between">
					<span
						class="text-xs font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500"
						>Collection</span
					>
					{#if item.queue_tag}
						<div class="flex items-center gap-2">
							<span
								class="inline-flex items-center rounded px-2 py-0.5 text-[10px] font-semibold text-white"
								style="background-color: {tagColor || '#6b7280'};"
							>
								{item.queue_tag}
							</span>
							<button
								onclick={async () => {
									collectionBusy = true;
									try {
										await onSetCollection(null);
										collectionOpen = false;
									} finally {
										collectionBusy = false;
									}
								}}
								disabled={collectionBusy}
								class="text-xs text-gray-400 hover:text-red-500 transition-colors disabled:opacity-50"
								title="Remove collection"
							>
								✕
							</button>
						</div>
					{:else}
						<span class="text-xs text-gray-400">None</span>
					{/if}
				</div>
				{#if collectionOpen}
					<div class="flex flex-col gap-2">
						{#each existingCollections.filter((c) => c !== item.queue_tag) as collection (collection)}
							<button
								onclick={async () => {
									collectionBusy = true;
									try {
										await onSetCollection(collection);
										collectionOpen = false;
									} finally {
										collectionBusy = false;
									}
								}}
								disabled={collectionBusy}
								class="text-left text-xs px-2 py-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50 transition-colors"
							>
								{collection}
							</button>
						{/each}
						<input
							type="text"
							maxlength="40"
							placeholder="New collection…"
							bind:value={newCollectionInput}
							onkeydown={async (e) => {
								if (e.key === 'Enter' && newCollectionInput.trim()) {
									e.preventDefault();
									collectionBusy = true;
									try {
										await onSetCollection(newCollectionInput.trim());
										collectionOpen = false;
										newCollectionInput = '';
									} finally {
										collectionBusy = false;
									}
								}
							}}
							class="text-xs px-2 py-1.5 rounded border border-gray-200 bg-white dark:bg-gray-900 dark:border-gray-700 dark:text-white focus:outline-none focus:ring-1 focus:ring-orange-500"
						/>
						<button
							onclick={() => {
								collectionOpen = false;
								newCollectionInput = '';
							}}
							class="text-xs px-2 py-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
						>
							Close
						</button>
					</div>
				{:else}
					<button
						onclick={() => (collectionOpen = true)}
						disabled={collectionBusy}
						class="text-xs text-orange-500 hover:text-orange-400 disabled:opacity-50"
					>
						Change…
					</button>
				{/if}
			{/if}

			<!-- Overview -->
			{#if item.overview}
				<div>
					<p
						class="text-xs leading-relaxed text-gray-600 dark:text-gray-400
						{overviewExpanded ? '' : 'line-clamp-4'}"
					>
						{item.overview}
					</p>
					{#if item.overview.length > 200}
						<button
							onclick={() => (overviewExpanded = !overviewExpanded)}
							class="mt-1 text-[10px] font-medium text-orange-500 hover:text-orange-400"
							>{overviewExpanded ? 'Less' : 'More'}</button
						>
					{/if}
				</div>
			{/if}

			<!-- Runtime lollipop, relative to the monthly budget -->
			<div class="flex items-center gap-2">
				<div class="relative flex-1">
					<div class="h-px w-full bg-gray-200 dark:bg-gray-800"></div>
					<div
						class="absolute top-0 left-0 h-px transition-all duration-300"
						style="width:{runtimePct}%; background:{lineColor}; opacity:0.75;"
					></div>
					<div
						class="absolute top-1/2 -translate-y-1/2 h-1.5 w-1.5 rounded-full transition-all duration-300"
						style="left:{runtimePct}%; margin-left:-3px; background:{dotColor};"
					></div>
				</div>
				<span class="shrink-0 text-[10px] tabular-nums text-gray-500">
					{formatRuntime(runtimeMins, item.media_type)}
					{#if item.runtime_minutes && item.media_type === 'tv'}<span
							class="text-gray-400 dark:text-gray-600"
						>
							/ {formatRuntime(item.runtime_minutes, item.media_type)}</span
						>{/if}
				</span>
			</div>

			<!-- Cast -->
			{#if item.cast?.length}
				<div>
					<p
						class="mb-2 text-[10px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500"
					>
						Cast
					</p>
					<div class="flex gap-2 overflow-x-auto pb-1">
						{#each item.cast as c (c.name)}
							<div class="flex shrink-0 flex-col items-center gap-1 w-14">
								<div class="h-12 w-12 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-800">
									{#if c.profile_path}
										<img
											src="{TMDB_IMG}/w185{c.profile_path}"
											alt={c.name}
											class="h-full w-full object-cover"
										/>
									{:else}
										<div
											class="flex h-full w-full items-center justify-center text-lg text-gray-400"
										>
											👤
										</div>
									{/if}
								</div>
								<p
									class="text-center text-[9px] font-medium leading-tight text-gray-700 dark:text-gray-300 line-clamp-2"
								>
									{c.name}
								</p>
								<p
									class="text-center text-[9px] leading-tight text-gray-400 dark:text-gray-600 line-clamp-1"
								>
									{c.character}
								</p>
							</div>
						{/each}
					</div>
				</div>
			{:else if !item.cast}
				<p class="text-[10px] text-gray-400 dark:text-gray-600">
					Run <strong>Settings → Refresh Data</strong> to load cast info.
				</p>
			{/if}

			<!-- Where to watch -->
			<div>
				<p
					class="mb-2 text-[10px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500"
				>
					Where to watch
				</p>
				{#if item.providers.length}
					<div class="flex flex-wrap gap-2">
						{#each item.providers as p (p.provider_id)}
							<div class="flex items-center gap-1.5">
								<img
									src="{TMDB_IMG}/w92{p.logo_path}"
									alt={p.provider_name}
									class="h-6 w-6 rounded-lg"
								/>
								<span class="text-xs text-gray-600 dark:text-gray-400">{p.provider_name}</span>
							</div>
						{/each}
					</div>
				{:else if item.rentable}
					<p class="text-xs text-gray-500">💲 Available to rent or buy</p>
				{:else}
					<div class="space-y-1">
						<p class="text-xs text-gray-500">🚫 Not on streaming services</p>
						<div class="flex gap-3">
							<a
								href="https://www.kanopy.com/en/search?query={encodeURIComponent(item.title)}"
								target="_blank"
								rel="noopener noreferrer"
								class="text-xs text-orange-500 hover:text-orange-400">Kanopy →</a
							>
							<a
								href="https://www.hoopladigital.com/search?q={encodeURIComponent(item.title)}"
								target="_blank"
								rel="noopener noreferrer"
								class="text-xs text-orange-500 hover:text-orange-400">Hoopla →</a
							>
						</div>
					</div>
				{/if}
			</div>

			{#if showSeasons}
				<!-- Seasons with episode counts -->
				{#if item.media_type === 'tv' && (item.seasons?.length || chip)}
					<div>
						<p
							class="mb-2 text-[10px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500"
						>
							Seasons
						</p>
						<div class="space-y-1">
							{#each (item.seasons ?? []).filter((s) => s.episode_count > 0 && (!chip || item.release?.next_season == null || s.season_number < item.release.next_season)) as season (season.season_number)}
								{@const watched = (item.watched_seasons ?? []).includes(season.season_number)}
								<div class="flex items-center gap-2">
									<button
										class="inline-flex items-center rounded px-1.5 py-0.5 text-[9px] font-semibold leading-none transition-colors
											{watched
											? 'bg-teal-100 text-teal-700 dark:bg-teal-900/60 dark:text-teal-400'
											: 'bg-gray-100 text-gray-500 hover:text-gray-700 dark:bg-gray-800 dark:text-gray-500 dark:hover:text-gray-300'}"
										onclick={() => onToggleSeason?.(season.season_number)}
									>
										{watched ? '✓' : 'S'}{season.season_number}
									</button>
									<span class="text-xs text-gray-500 dark:text-gray-400"
										>{season.episode_count} eps</span
									>
								</div>
							{/each}
							{#if chip}
								{@const nextSeasonData = (item.seasons ?? []).find(
									(s) => s.season_number === item.release?.next_season
								)}
								<div class="flex items-center gap-2">
									<button
										class="relative inline-flex items-center rounded px-1.5 py-0.5 text-[9px] font-semibold leading-none ring-1 transition-colors
											{releasePopupOpen
											? 'bg-orange-100 text-orange-700 ring-orange-400 dark:bg-orange-950/40 dark:text-orange-300 dark:ring-orange-500'
											: 'text-orange-600 ring-orange-300 hover:bg-orange-50 dark:text-orange-500 dark:ring-orange-700 dark:hover:bg-orange-950/30'}"
										onclick={() => (releasePopupOpen = !releasePopupOpen)}
										data-release-popup
									>
										{item.release?.next_season != null ? `S${item.release.next_season}` : 'Next'}
										{#if releasePopupOpen}
											<div
												class="absolute top-full left-0 z-20 mt-1 w-max max-w-[14rem] rounded-lg bg-white px-2.5 py-1.5 text-[10px] leading-snug text-gray-700 shadow-lg ring-1 ring-gray-200 dark:bg-gray-900 dark:text-gray-300 dark:ring-gray-700"
											>
												{chip}
											</div>
										{/if}
									</button>
									{#if nextSeasonData?.episode_count}
										<span class="text-xs text-gray-500 dark:text-gray-400"
											>{nextSeasonData.episode_count} eps</span
										>
									{/if}
									<span class="text-xs text-orange-500 dark:text-orange-400">{chip}</span>
								</div>
							{/if}
						</div>
					</div>
				{/if}
			{:else if chip}
				<!-- Simpler release-info line for panels with no season-tracking UI -->
				<p class="text-xs text-amber-600 dark:text-amber-400">{chip}</p>
			{/if}
		</div>
	</div>

	<!-- Sticky footer actions (caller-supplied — differs per page) -->
	<div class="shrink-0 border-t border-gray-100 px-4 py-3 dark:border-gray-800 flex gap-2">
		{@render footer(item)}
	</div>
</div>

<!-- Poster lightbox -->
{#if posterExpanded && item.poster_path}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<div
		class="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-6 backdrop-blur-sm cursor-zoom-out"
		onclick={() => (posterExpanded = false)}
		role="dialog"
		aria-modal="true"
		aria-label="{item.title} poster, enlarged"
		tabindex="-1"
		use:trapFocus={{ onEscape: () => (posterExpanded = false) }}
	>
		<img
			src="{TMDB_IMG}/w500{item.poster_path}"
			alt={item.title}
			class="max-h-full max-w-full rounded-xl shadow-2xl"
		/>
	</div>
{/if}
