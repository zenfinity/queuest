<script lang="ts">
	import {
		queueControls,
		SORT_DEFAULT_DIR,
		UNCATEGORIZED,
		setSortBy,
		toggleSortDir,
		clearSort,
		hasActiveFilters
	} from '$lib/queue-controls.svelte';
	import { services } from '$lib/services.svelte';
	import { getQueueColors } from '$lib/queue-colors';

	// `floating` renders as a fixed pill anchored to the bottom of the viewport (small/tablet
	// screens). Non-floating renders as a plain inline flex item — used inside the nav at lg+.
	// Both share this component so behavior/state can't drift between the two placements.
	//
	// Popover dismissal deliberately avoids a `fixed inset-0` backdrop: the nav has
	// `backdrop-blur`, and per spec `backdrop-filter` establishes a containing block for
	// `position: fixed` descendants — a fixed backdrop nested inside the nav would be
	// confined to the nav's own (tiny) box instead of the viewport. A document click
	// listener keyed off `data-queue-dock` sidesteps that entirely.
	let { floating }: { floating: boolean } = $props();
</script>

<div data-queue-dock class={floating ? 'fixed bottom-4 left-1/2 z-50 -translate-x-1/2' : ''}>
	<div
		class="flex items-center gap-2.5 rounded-full border border-gray-200 bg-white/90 px-1.5 py-1 backdrop-blur-md dark:border-white/10 dark:bg-gray-900/90 {floating
			? 'shadow-lg'
			: ''}"
	>
		<!-- View switcher -->
		<div class="flex gap-0.5 rounded-full bg-gray-100 p-[3px] dark:bg-white/5">
			<button
				aria-label="Card view"
				aria-pressed={queueControls.viewMode === 'grid'}
				onclick={() => (queueControls.viewMode = 'grid')}
				class="flex items-center rounded-full px-2.5 py-1.5 transition-colors {queueControls.viewMode ===
				'grid'
					? 'bg-orange-500 text-white'
					: 'text-gray-500 dark:text-gray-400'}"
			>
				<svg width="13" height="13" viewBox="0 0 14 14" fill="currentColor" aria-hidden="true">
					<rect x="1" y="1" width="5" height="5" rx="1" /><rect
						x="8"
						y="1"
						width="5"
						height="5"
						rx="1"
					/>
					<rect x="1" y="8" width="5" height="5" rx="1" /><rect
						x="8"
						y="8"
						width="5"
						height="5"
						rx="1"
					/>
				</svg>
			</button>
			<button
				aria-label="List view"
				aria-pressed={queueControls.viewMode === 'list'}
				onclick={() => (queueControls.viewMode = 'list')}
				class="flex items-center rounded-full px-2.5 py-1.5 transition-colors {queueControls.viewMode ===
				'list'
					? 'bg-orange-500 text-white'
					: 'text-gray-500 dark:text-gray-400'}"
			>
				<svg width="13" height="13" viewBox="0 0 14 14" fill="currentColor" aria-hidden="true">
					<rect x="1" y="2" width="12" height="2" rx="1" /><rect
						x="1"
						y="6"
						width="12"
						height="2"
						rx="1"
					/><rect x="1" y="10" width="12" height="2" rx="1" />
				</svg>
			</button>
			<button
				aria-label="Timeline view"
				aria-pressed={queueControls.viewMode === 'lanes'}
				onclick={() => (queueControls.viewMode = 'lanes')}
				class="flex items-center rounded-full px-2.5 py-1.5 transition-colors {queueControls.viewMode ===
				'lanes'
					? 'bg-orange-500 text-white'
					: 'text-gray-500 dark:text-gray-400'}"
			>
				<svg width="13" height="13" viewBox="0 0 14 14" fill="currentColor" aria-hidden="true">
					<rect x="1" y="2" width="7" height="2.5" rx="1.2" /><rect
						x="4"
						y="6"
						width="9"
						height="2.5"
						rx="1.2"
					/><rect x="2" y="10" width="6" height="2.5" rx="1.2" />
				</svg>
			</button>
		</div>

		<span class="h-4.5 w-px bg-gray-200 dark:bg-white/10"></span>

		<!-- Watched toggle -->
		<button
			role="switch"
			aria-checked={queueControls.watchedOn}
			aria-label="Show watched items"
			onclick={() => (queueControls.watchedOn = !queueControls.watchedOn)}
			class="rounded-full px-3 py-1.5 text-xs font-semibold transition-colors
				{queueControls.watchedOn
				? 'bg-teal-100 text-teal-700 dark:bg-teal-900/70 dark:text-teal-400'
				: 'bg-gray-100 text-gray-500 dark:bg-white/5 dark:text-gray-400'}"
			>{queueControls.watchedOn ? '✓ Watched' : 'Watched'}</button
		>

		<span class="h-4.5 w-px bg-gray-200 dark:bg-white/10"></span>

		<!-- Filter button + popover (relative wrapper anchors the non-floating popover) -->
		<div class="relative">
			<button
				aria-label="Sort and filter"
				aria-expanded={queueControls.filterOpen}
				aria-controls="queue-filter-popover"
				onclick={() => (queueControls.filterOpen = !queueControls.filterOpen)}
				class="relative flex items-center rounded-full px-2.5 py-1.5 text-gray-500 dark:text-gray-400"
			>
				<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
					<rect x="1" y="3" width="12" height="1.6" rx=".8" fill="currentColor" />
					<circle cx="9" cy="3.8" r="2" fill="none" stroke="currentColor" stroke-width="1.4" />
					<rect x="1" y="9" width="12" height="1.6" rx=".8" fill="currentColor" />
					<circle cx="5" cy="9.8" r="2" fill="none" stroke="currentColor" stroke-width="1.4" />
				</svg>
				{#if hasActiveFilters()}
					<span class="absolute top-1 right-1.5 h-1.5 w-1.5 rounded-full bg-orange-500"></span>
				{/if}
			</button>

			{#if queueControls.filterOpen}
				<div
					id="queue-filter-popover"
					class="{floating
						? 'fixed bottom-20 left-1/2 -translate-x-1/2'
						: 'absolute right-0 top-full mt-2'} z-[55] w-52 rounded-2xl border border-gray-200 bg-white p-2 shadow-xl dark:border-white/10 dark:bg-gray-900"
				>
					<div class="flex items-center justify-between px-2 py-1">
						<span
							class="text-[10px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500"
							>Sort by</span
						>
						{#if queueControls.sortBy !== 'added' || queueControls.sortDir !== SORT_DEFAULT_DIR.added}
							<button
								onclick={clearSort}
								class="text-[10px] font-medium text-orange-500 hover:text-orange-400">Clear</button
							>
						{/if}
					</div>
					{#each [['added', 'Recent'], ['title', 'A–Z'], ['runtime', 'Runtime']] as const as [key, label] (key)}
						<div class="flex items-center gap-0.5">
							<button
								onclick={() => setSortBy(key)}
								aria-pressed={queueControls.sortBy === key}
								class="flex flex-1 items-center justify-between rounded-lg px-2 py-1.5 text-xs transition-colors
									{queueControls.sortBy === key
									? 'bg-gray-100 text-gray-900 dark:bg-gray-800 dark:text-white'
									: 'text-gray-500 hover:bg-gray-50 dark:text-gray-400 dark:hover:bg-gray-800/50'}"
							>
								<span>{label}</span>
								{#if queueControls.sortBy === key}<span class="text-orange-500">✓</span>{/if}
							</button>
							{#if queueControls.sortBy === key}
								<button
									onclick={toggleSortDir}
									aria-label={queueControls.sortDir === 'asc'
										? 'Ascending — click for descending'
										: 'Descending — click for ascending'}
									class="shrink-0 rounded-lg p-1.5 text-gray-400 hover:bg-gray-50 hover:text-gray-700 dark:text-gray-500 dark:hover:bg-gray-800/50 dark:hover:text-gray-300"
									>{queueControls.sortDir === 'asc' ? '↑' : '↓'}</button
								>
							{/if}
						</div>
					{/each}

					<div class="my-1.5 h-px bg-gray-100 dark:bg-gray-800"></div>

					<p
						class="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500"
					>
						Services
					</p>
					{#each [['all', 'All'], ['subscribed', 'Subscribed'], ['not-subscribed', 'Not Subscribed']] as const as [key, label] (key)}
						{@const isDisabled = key === 'subscribed' && services.ids.size === 0}
						<button
							onclick={() => {
								if (!isDisabled) queueControls.serviceFilter = key;
							}}
							disabled={isDisabled}
							aria-pressed={queueControls.serviceFilter === key && !isDisabled}
							title={isDisabled ? 'Select services on the Budget page first' : undefined}
							class="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-xs transition-colors
								{isDisabled
								? 'cursor-not-allowed text-gray-300 dark:text-gray-700'
								: queueControls.serviceFilter === key
									? 'bg-gray-100 text-gray-900 dark:bg-gray-800 dark:text-white'
									: 'text-gray-500 hover:bg-gray-50 dark:text-gray-400 dark:hover:bg-gray-800/50'}"
						>
							<span>{label}</span>
							{#if queueControls.serviceFilter === key && !isDisabled}<span class="text-orange-500"
									>✓</span
								>{/if}
						</button>
					{/each}

					{#if queueControls.viewMode === 'lanes' && queueControls.collectionNames.length > 0}
						<div class="my-1.5 h-px bg-gray-100 dark:bg-gray-800"></div>

						<p
							class="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500"
						>
							Group lanes by
						</p>
						{#each [['provider', 'Provider'], ['collection', 'List']] as const as [key, label] (key)}
							<button
								onclick={() => (queueControls.ganttGroupBy = key)}
								aria-pressed={queueControls.ganttGroupBy === key}
								class="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-xs transition-colors
									{queueControls.ganttGroupBy === key
									? 'bg-gray-100 text-gray-900 dark:bg-gray-800 dark:text-white'
									: 'text-gray-500 hover:bg-gray-50 dark:text-gray-400 dark:hover:bg-gray-800/50'}"
							>
								<span>{label}</span>
								{#if queueControls.ganttGroupBy === key}<span class="text-orange-500">✓</span>{/if}
							</button>
						{/each}
					{/if}

					{#if queueControls.collectionNames.length > 0 || queueControls.sharedListOptions.length > 0}
						{@const queueColors = getQueueColors()}
						<div class="my-1.5 h-px bg-gray-100 dark:bg-gray-800"></div>

						<div class="flex items-center justify-between px-2 py-1">
							<span
								class="text-[10px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500"
								>List</span
							>
							{#if queueControls.collectionNames.length > 0}
								<button
									onclick={() =>
										(queueControls.groupByCollection = !queueControls.groupByCollection)}
									aria-pressed={queueControls.groupByCollection}
									class="text-[10px] font-medium transition-colors {queueControls.groupByCollection
										? 'text-orange-500 hover:text-orange-400'
										: 'text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300'}"
								>
									{queueControls.groupByCollection ? '✓ Grouped' : 'Group'}
								</button>
							{/if}
						</div>

						<button
							onclick={() => (queueControls.collectionFilter = null)}
							aria-pressed={queueControls.collectionFilter === null}
							class="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-xs transition-colors
								{queueControls.collectionFilter === null
								? 'bg-gray-100 text-gray-900 dark:bg-gray-800 dark:text-white'
								: 'text-gray-500 hover:bg-gray-50 dark:text-gray-400 dark:hover:bg-gray-800/50'}"
						>
							<span>All</span>
							{#if queueControls.collectionFilter === null}<span class="text-orange-500">✓</span
								>{/if}
						</button>

						{#each [...queueControls.collectionNames.map( (c) => [c, c] ), [UNCATEGORIZED, 'Uncategorized']] as [key, label] (key)}
							<button
								onclick={() => (queueControls.collectionFilter = key)}
								aria-pressed={queueControls.collectionFilter === key}
								class="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-xs transition-colors
									{queueControls.collectionFilter === key
									? 'bg-gray-100 text-gray-900 dark:bg-gray-800 dark:text-white'
									: 'text-gray-500 hover:bg-gray-50 dark:text-gray-400 dark:hover:bg-gray-800/50'}"
							>
								<span class="flex min-w-0 items-center gap-1.5">
									{#if key !== UNCATEGORIZED}
										<span
											class="h-2 w-2 shrink-0 rounded-full"
											style="background:{queueColors[key] ?? '#9ca3af'}"
										></span>
									{/if}
									<span class="truncate">{label}</span>
								</span>
								{#if queueControls.collectionFilter === key}<span class="shrink-0 text-orange-500"
										>✓</span
									>{/if}
							</button>
						{/each}

						{#if queueControls.sharedListOptions.length > 0}
							<p
								class="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500"
							>
								Shared
							</p>
							{#each queueControls.sharedListOptions as opt (opt.id)}
								{@const filterValue = `shared:${opt.id}`}
								<button
									onclick={() => (queueControls.collectionFilter = filterValue)}
									aria-pressed={queueControls.collectionFilter === filterValue}
									class="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-xs transition-colors
										{queueControls.collectionFilter === filterValue
										? 'bg-gray-100 text-gray-900 dark:bg-gray-800 dark:text-white'
										: 'text-gray-500 hover:bg-gray-50 dark:text-gray-400 dark:hover:bg-gray-800/50'}"
								>
									<span class="flex min-w-0 items-center gap-1.5">
										<span class="h-2 w-2 shrink-0 rounded-full" style="background:{opt.color}"
										></span>
										<span class="truncate">{opt.name}</span>
									</span>
									{#if queueControls.collectionFilter === filterValue}<span
											class="shrink-0 text-orange-500">✓</span
										>{/if}
								</button>
							{/each}
						{/if}
					{/if}
				</div>
			{/if}
		</div>
	</div>
</div>
