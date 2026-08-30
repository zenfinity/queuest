<script lang="ts">
	// A shared list's presence in the Queue view (#189 follow-up) — collapsed
	// by default and only fetched/decrypted on first expand, so having several
	// shared lists doesn't cost a blob pull on every Queue load.
	//
	// Grid/list card markup below deliberately mirrors QueueGridView/ListView's
	// classes rather than importing those components: this list should look
	// the same as the personal queue's current view, but those components key
	// everything (busy-sets, selection, flip animation) off WatchlistItem's
	// numeric local `id`, and a CollectionItem's identity is `tmdb_id`+
	// `media_type` — retrofitting a second identity scheme into them is a
	// bigger, riskier change than duplicating the card shell here. Season-level
	// toggling and select-mode aren't offered — neither is wired up for shared
	// items yet.
	import { TMDB_IMG, formatRuntime } from '$lib/tmdb';
	import { remainingRuntime, releaseChip, DEFAULT_RUNTIME } from '$lib/progress';
	import { queueControls } from '$lib/queue-controls.svelte';
	import { services } from '$lib/services.svelte';
	import {
		listMembers,
		loadCollectionItems,
		toggleCollectionWatched,
		removeItemFromSharedCollection,
		setMyBallot,
		type SharedCollection,
		type CollectionMember
	} from '$lib/collection-actions';
	import { MAX_BALLOT_SIZE, type CollectionItem, type BallotEntry } from '$lib/collection-sync';
	import { bordaTally } from '$lib/ranking';
	import { getSyncStatus } from '$lib/sync';
	import { getLastViewed, markViewed, hasNewActivity } from '$lib/collection-activity';
	import DetailPanel from '$lib/components/DetailPanel.svelte';

	let {
		collection,
		color,
		budgetHours,
		inline = false,
		onStats
	}: {
		collection: SharedCollection;
		color: string;
		budgetHours: number;
		// Renders without the collapsible header/border — used when a Queue
		// filter picks this one list to fill the main view (#205), as opposed
		// to its usual collapsed-by-default spot below the personal queue.
		inline?: boolean;
		// Called for `inline` whenever the visible count/remaining time
		// changes, so the caller's own summary line can report this list's
		// stats instead of duplicating one.
		onStats?: (stats: { count: number; remainingMins: number }) => void;
	} = $props();

	let expanded = $state(false);
	let loading = $state(false);
	let loaded = $state(false);
	let error = $state('');
	let items: CollectionItem[] = $state([]);
	let ballots: Record<string, BallotEntry> = $state({});
	let members: CollectionMember[] = $state([]);
	let myUserId = $state('');
	let togglingKey = $state('');
	let removingKey = $state('');
	let rankingBusy = $state(false);
	let showRankings = $state(false);
	// Two-tap confirm, same "arm, then a second click removes" pattern as the
	// bulk-remove/delete-list controls elsewhere in the app — this is
	// destructive for everyone in the list, not just the person clicking.
	let removeArmedKey: string | null = $state(null);
	let lastViewed: string | undefined = $state(undefined);
	let detailItem: CollectionItem | null = $state(null);

	// DetailPanel keys its internal UI state (busy, season-toggle chips, the
	// release popup) off `item.id`, which a CollectionItem doesn't have — its
	// identity is tmdb_id+media_type. This id only needs to be stable and
	// collision-free against real personal-queue ids (all positive), never
	// persisted, so a negative encoding of tmdb_id+media_type is enough.
	function syntheticId(item: CollectionItem): number {
		return -(item.tmdb_id * 2 + (item.media_type === 'tv' ? 1 : 0)) - 1;
	}

	const noop = { setBusy: () => {}, setError: (e: string) => (error = e) };

	function itemKey(i: CollectionItem): string {
		return `${i.media_type}:${i.tmdb_id}`;
	}

	function memberLabel(userId: string | null): string {
		if (!userId) return 'Someone';
		if (userId === myUserId) return 'You';
		return members.find((m) => m.userId === userId)?.email ?? 'A member';
	}

	function watchedByMe(item: CollectionItem): boolean {
		return Boolean(myUserId && item.watch?.[myUserId]);
	}

	// remainingRuntime is typed for the full WatchlistItem but only reads
	// media_type/seasons/runtime_minutes/watched_seasons — all present on a
	// CollectionItem too (see the type comment on collection-sync.ts).
	function rt(item: CollectionItem): number {
		return remainingRuntime(item as unknown as Parameters<typeof remainingRuntime>[0]);
	}

	async function load() {
		if (loaded || loading) return;
		loading = true;
		const status = getSyncStatus();
		members = await listMembers(collection.id, noop);
		myUserId =
			members.find((m) => m.email === status.email)?.userId ??
			(collection.role === 'owner' ? collection.ownerUserId : '');
		lastViewed = await getLastViewed(collection.id);
		const state = await loadCollectionItems(collection, noop);
		items = state.items;
		ballots = state.ballots;
		loading = false;
		loaded = true;
		await markViewed(collection.id);
	}

	async function toggleOpen() {
		expanded = !expanded;
		if (expanded) await load();
	}

	async function toggleWatched(item: CollectionItem) {
		if (!myUserId) return;
		const key = itemKey(item);
		const currentlyWatched = watchedByMe(item);
		togglingKey = key;
		const result = await toggleCollectionWatched(
			collection,
			items,
			item,
			myUserId,
			!currentlyWatched,
			noop
		);
		if (result) items = result;
		togglingKey = '';
	}

	async function removeItemAction(item: CollectionItem) {
		const key = itemKey(item);
		if (removeArmedKey !== key) {
			removeArmedKey = key;
			return;
		}
		removingKey = key;
		const result = await removeItemFromSharedCollection(collection, items, item, noop);
		if (result) items = result;
		removingKey = '';
		removeArmedKey = null;
	}

	// ── Ranked voting (#210) ──────────────────────────────────────────────
	// My ballot filtered down to keys that still match a current item — a
	// title an owner removed (#214) just stops rendering here rather than
	// leaving a ghost entry; the stored ballot itself is untouched, so it
	// comes back if the title is ever re-added.
	let myBallot = $derived(
		(ballots[myUserId]?.items ?? []).filter((key) => items.some((i) => itemKey(i) === key))
	);

	function rankOf(item: CollectionItem): number | null {
		const i = myBallot.indexOf(itemKey(item));
		return i === -1 ? null : i + 1;
	}

	async function pushBallot(next: string[]) {
		if (!myUserId) return;
		rankingBusy = true;
		const result = await setMyBallot(collection, ballots, myUserId, next, noop);
		if (result) ballots = result;
		rankingBusy = false;
	}

	async function toggleRank(item: CollectionItem) {
		const key = itemKey(item);
		const current = myBallot;
		const next = current.includes(key)
			? current.filter((k) => k !== key)
			: current.length >= MAX_BALLOT_SIZE
				? current
				: [...current, key];
		if (next === current) return;
		await pushBallot(next);
	}

	async function moveBallotEntry(index: number, direction: 'up' | 'down') {
		const swapIndex = direction === 'up' ? index - 1 : index + 1;
		if (swapIndex < 0 || swapIndex >= myBallot.length) return;
		const next = [...myBallot];
		[next[index], next[swapIndex]] = [next[swapIndex], next[index]];
		await pushBallot(next);
	}

	let tally = $derived(bordaTally(items, ballots));

	let visibleItems = $derived.by(() => {
		let list = items;
		if (queueControls.serviceFilter === 'subscribed') {
			list = list.filter((i) => i.providers.some((p) => services.ids.has(p.provider_id)));
		} else if (queueControls.serviceFilter === 'not-subscribed') {
			list = list.filter(
				(i) => i.providers.length > 0 && !i.providers.some((p) => services.ids.has(p.provider_id))
			);
		}
		if (!queueControls.watchedOn) {
			list = list.filter((i) => !watchedByMe(i));
		}
		const mul = queueControls.sortDir === 'asc' ? 1 : -1;
		if (queueControls.sortBy === 'rank') {
			// Group Ranking order (#229) — bordaTally is already sorted
			// highest-score-first, so its array index *is* the rank. Titles
			// nobody has ranked aren't in the tally at all; they sort after
			// every ranked title, in their own added_at order.
			const rankIndex = new Map(tally.map((row, i) => [itemKey(row.item), i]));
			return [...list].sort((a, b) => {
				const ra = rankIndex.get(itemKey(a)) ?? tally.length;
				const rb = rankIndex.get(itemKey(b)) ?? tally.length;
				if (ra !== rb) return (ra - rb) * mul;
				return a.added_at.localeCompare(b.added_at) * mul;
			});
		}
		return [...list].sort((a, b) => {
			if (queueControls.sortBy === 'title') return a.title.localeCompare(b.title) * mul;
			if (queueControls.sortBy === 'runtime') return (rt(a) - rt(b)) * mul;
			return a.added_at.localeCompare(b.added_at) * mul;
		});
	});

	$effect(() => {
		if (inline) load();
	});

	$effect(() => {
		if (inline) {
			onStats?.({
				count: visibleItems.length,
				remainingMins: visibleItems.reduce((s, i) => s + rt(i), 0)
			});
		}
	});
</script>

{#snippet gridCard(item: CollectionItem)}
	{@const key = itemKey(item)}
	{@const myWatch = watchedByMe(item)}
	{@const isNew = hasNewActivity(item, lastViewed)}
	{@const pct = Math.min(100, (rt(item) / (budgetHours * 60)) * 100)}
	<div
		class="flex flex-col rounded-xl bg-white ring-1 ring-gray-200 dark:bg-gray-900 dark:ring-0 {isNew
			? '!ring-2 !ring-orange-400/70'
			: ''}"
		style="border-left: 3px solid {color}"
	>
		<button
			class="relative aspect-[2/3] w-full cursor-pointer overflow-hidden rounded-t-xl bg-gray-200 dark:bg-gray-800"
			onclick={(e) => {
				e.stopPropagation();
				detailItem = item;
			}}
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
			{#if queueControls.watchedOn && myWatch}
				<span
					class="absolute top-2 left-2 rounded bg-teal-900/85 px-1.5 py-0.5 text-[10px] font-semibold text-teal-400"
					>✓ Watched</span
				>
			{/if}
			{#if isNew}
				<span
					class="absolute top-2 right-2 rounded-full bg-orange-500 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white"
					>New</span
				>
			{/if}
		</button>
		<div class="flex flex-1 flex-col gap-2 p-2.5 sm:p-3">
			<p class="line-clamp-2 text-sm font-medium leading-tight">{item.title}</p>
			<div class="flex items-center gap-2">
				<div class="relative flex-1">
					<div class="h-px w-full bg-gray-200 dark:bg-gray-800"></div>
					<div
						class="absolute top-0 left-0 h-px transition-all duration-300"
						style="width:{pct}%; background:{color}; opacity:0.75;"
					></div>
				</div>
				<span class="shrink-0 text-[10px] tabular-nums text-gray-500">
					{item.runtime_minutes
						? formatRuntime(rt(item), item.media_type)
						: `~${formatRuntime(DEFAULT_RUNTIME[item.media_type], item.media_type)}`}
				</span>
			</div>
			<div class="flex flex-wrap items-center gap-1">
				<span class="rounded bg-gray-100 px-1 py-0.5 text-[11px] dark:bg-gray-800">
					{item.media_type === 'movie' ? '🎬' : '📺'}
				</span>
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
						<span class="text-sm leading-none" title="Not on streaming services">🚫</span>
					{/if}
				{/if}
			</div>
			{#if item.media_type === 'movie' && releaseChip(item.release)}
				<p class="text-xs leading-snug text-amber-600 dark:text-amber-400">
					{releaseChip(item.release)}
				</p>
			{/if}
			<p class="text-[10px] text-gray-400 dark:text-gray-500">
				Added by {memberLabel(item.added_by_account_id ?? null)}
			</p>
			<div class="mt-auto flex gap-1.5 pt-1">
				<button
					class="shrink-0 rounded-md px-2 py-1 text-xs font-medium transition-colors disabled:opacity-40 {rankOf(
						item
					)
						? 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-400'
						: 'bg-gray-100 text-gray-500 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700'}"
					disabled={rankingBusy || (!rankOf(item) && myBallot.length >= MAX_BALLOT_SIZE)}
					onclick={() => toggleRank(item)}
					aria-label={rankOf(item)
						? `Remove ${item.title} from your ranking`
						: `Rank ${item.title}`}
					title={rankOf(item)
						? `Ranked #${rankOf(item)} — tap to remove`
						: 'Add to your ranked picks'}
				>
					{rankOf(item) ? `★${rankOf(item)}` : '☆'}
				</button>
				<button
					class="flex-1 rounded-md bg-gray-100 py-1 text-xs font-medium transition-colors hover:bg-gray-200 disabled:opacity-40 dark:bg-gray-800 dark:hover:bg-gray-700"
					disabled={togglingKey === key}
					onclick={() => toggleWatched(item)}
				>
					{myWatch ? 'Unwatch' : '✓ Watched'}
				</button>
				{#if collection.role === 'owner'}
					<button
						class="shrink-0 rounded-md px-2 py-1 text-xs font-medium transition-colors disabled:opacity-40 {removeArmedKey ===
						key
							? 'bg-red-600 text-white hover:bg-red-700'
							: 'bg-gray-100 text-red-500 hover:bg-red-100 dark:bg-gray-800 dark:hover:bg-red-900/30'}"
						disabled={removingKey === key}
						onclick={() => removeItemAction(item)}
						aria-label="Remove {item.title} from this list"
					>
						{removeArmedKey === key ? 'Confirm' : '✕'}
					</button>
				{/if}
			</div>
		</div>
	</div>
{/snippet}

{#snippet listRow(item: CollectionItem)}
	{@const key = itemKey(item)}
	{@const myWatch = watchedByMe(item)}
	{@const isNew = hasNewActivity(item, lastViewed)}
	{@const pct = Math.min(100, (rt(item) / (budgetHours * 60)) * 100)}
	<div
		class="flex flex-col bg-white px-3 py-2.5 dark:bg-gray-900/40"
		style="border-left: 3px solid {color}"
	>
		<div class="flex items-center gap-3">
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
				class="min-w-0 flex-1 truncate text-left text-sm font-medium leading-tight transition-colors hover:text-orange-500"
				onclick={() => (detailItem = item)}
				data-detail-trigger>{item.title}</button
			>
			{#if isNew}
				<span
					class="shrink-0 rounded-full bg-orange-500 px-1.5 py-0.5 text-[9px] font-semibold leading-none text-white"
					>New</span
				>
			{/if}
			{#if queueControls.watchedOn && myWatch}
				<span
					class="shrink-0 rounded bg-teal-100 px-1.5 py-0.5 text-[10px] font-semibold text-teal-700 dark:bg-teal-900/60 dark:text-teal-400"
					>✓</span
				>
			{/if}
			<button
				class="shrink-0 rounded px-1.5 py-1 text-[10px] font-medium transition-colors disabled:opacity-40 {rankOf(
					item
				)
					? 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-400'
					: 'bg-gray-100 text-gray-500 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700'}"
				disabled={rankingBusy || (!rankOf(item) && myBallot.length >= MAX_BALLOT_SIZE)}
				onclick={() => toggleRank(item)}
				aria-label={rankOf(item) ? `Remove ${item.title} from your ranking` : `Rank ${item.title}`}
				title={rankOf(item)
					? `Ranked #${rankOf(item)} — tap to remove`
					: 'Add to your ranked picks'}
			>
				{rankOf(item) ? `★${rankOf(item)}` : '☆'}
			</button>
			<button
				class="shrink-0 rounded bg-gray-100 px-2 py-1 text-[10px] font-medium text-gray-700 transition-colors hover:bg-gray-200 disabled:opacity-40 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
				disabled={togglingKey === key}
				onclick={() => toggleWatched(item)}
			>
				{myWatch ? 'Unwatch' : '✓'}
			</button>
			{#if collection.role === 'owner'}
				<button
					class="shrink-0 rounded px-1.5 py-1 text-[10px] font-medium transition-colors disabled:opacity-40 {removeArmedKey ===
					key
						? 'bg-red-600 text-white hover:bg-red-700'
						: 'bg-gray-100 text-red-500 hover:bg-red-100 dark:bg-gray-800 dark:hover:bg-red-900/30'}"
					disabled={removingKey === key}
					onclick={() => removeItemAction(item)}
					aria-label="Remove {item.title} from this list"
				>
					{removeArmedKey === key ? 'Confirm' : '✕'}
				</button>
			{/if}
		</div>

		<div class="ml-11 mt-1.5 flex items-center gap-2">
			<span
				class="shrink-0 rounded bg-gray-100 px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-gray-500 dark:bg-gray-800 dark:text-gray-400"
			>
				{item.media_type === 'movie' ? '🎬' : '📺'}
			</span>
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
				<span class="shrink-0 text-xs leading-none" title="Not on streaming services">🚫</span>
			{/if}
			<div class="relative min-w-0 flex-1">
				<div class="h-px w-full bg-gray-200 dark:bg-gray-800"></div>
				<div
					class="absolute top-0 left-0 h-px transition-all duration-300"
					style="width:{pct}%; background:{color}; opacity:0.7;"
				></div>
			</div>
			<span class="w-12 shrink-0 text-right text-[10px] tabular-nums text-gray-500">
				{#if item.runtime_minutes}
					{formatRuntime(rt(item), item.media_type)}
				{:else}
					<span class="italic"
						>~{formatRuntime(DEFAULT_RUNTIME[item.media_type], item.media_type)}</span
					>
				{/if}
			</span>
		</div>

		{#if item.media_type === 'movie' && releaseChip(item.release)}
			<p class="ml-11 mt-0.5 text-[10px] leading-snug text-amber-500 dark:text-amber-400">
				{releaseChip(item.release)}
			</p>
		{/if}

		<p class="ml-11 mt-0.5 text-[10px] text-gray-400 dark:text-gray-500">
			Added by {memberLabel(item.added_by_account_id ?? null)}
		</p>
	</div>
{/snippet}

{#snippet compactCard(item: CollectionItem)}
	{@const key = itemKey(item)}
	{@const myWatch = watchedByMe(item)}
	{@const isNew = hasNewActivity(item, lastViewed)}
	<div
		class="flex gap-3 rounded-lg bg-gray-50 p-2.5 dark:bg-gray-800/60 {isNew
			? 'ring-1 ring-orange-400/60'
			: ''}"
	>
		{#if item.poster_path}
			<img
				src="{TMDB_IMG}/w92{item.poster_path}"
				alt=""
				class="h-16 w-11 shrink-0 rounded object-cover bg-gray-200 dark:bg-gray-700"
			/>
		{:else}
			<div class="h-16 w-11 shrink-0 rounded bg-gray-200 dark:bg-gray-700"></div>
		{/if}
		<div class="min-w-0 flex-1">
			<button
				class="flex items-center gap-1.5 truncate text-left text-sm font-medium text-gray-900 transition-colors hover:text-orange-500 dark:text-gray-100"
				onclick={() => (detailItem = item)}
				data-detail-trigger
			>
				{item.title}
				{#if isNew}
					<span
						class="shrink-0 rounded-full bg-orange-500 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white"
					>
						New
					</span>
				{/if}
			</button>
			<p class="text-xs text-gray-500 dark:text-gray-400">
				{item.runtime_minutes ? formatRuntime(item.runtime_minutes, item.media_type) : '—'} · Added by
				{memberLabel(item.added_by_account_id ?? null)}
			</p>
			<div class="mt-1.5 flex gap-1.5">
				<button
					disabled={rankingBusy || (!rankOf(item) && myBallot.length >= MAX_BALLOT_SIZE)}
					onclick={() => toggleRank(item)}
					aria-label={rankOf(item)
						? `Remove ${item.title} from your ranking`
						: `Rank ${item.title}`}
					title={rankOf(item)
						? `Ranked #${rankOf(item)} — tap to remove`
						: 'Add to your ranked picks'}
					class="rounded px-2 py-1 text-xs font-medium disabled:opacity-50 {rankOf(item)
						? 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400'
						: 'bg-gray-200 text-gray-700 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600'}"
				>
					{rankOf(item) ? `★ #${rankOf(item)}` : '☆ Rank'}
				</button>
				<button
					disabled={togglingKey === key}
					onclick={() => toggleWatched(item)}
					class="rounded px-2 py-1 text-xs font-medium disabled:opacity-50 {myWatch
						? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
						: 'bg-gray-200 text-gray-700 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600'}"
				>
					{myWatch ? '✓ Watched' : 'Mark watched'}
				</button>
				{#if collection.role === 'owner'}
					<button
						disabled={removingKey === key}
						onclick={() => removeItemAction(item)}
						aria-label="Remove {item.title} from this list"
						class="rounded px-2 py-1 text-xs font-medium disabled:opacity-50 {removeArmedKey === key
							? 'bg-red-600 text-white hover:bg-red-700'
							: 'bg-gray-200 text-red-500 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-red-900/30'}"
					>
						{removeArmedKey === key ? 'Confirm' : '✕'}
					</button>
				{/if}
			</div>
		</div>
	</div>
{/snippet}

{#snippet rankingsPanel()}
	<div class="mt-2 space-y-3 rounded-lg bg-gray-50 p-3 dark:bg-gray-800/40">
		<div>
			<p
				class="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500"
			>
				Your ballot
			</p>
			{#if myBallot.length === 0}
				<p class="text-xs text-gray-400 dark:text-gray-600">
					Tap ☆ on a title below to rank up to {MAX_BALLOT_SIZE}.
				</p>
			{:else}
				<ol class="space-y-1">
					{#each myBallot as key, i (key)}
						{@const bItem = items.find((it) => itemKey(it) === key)}
						{#if bItem}
							<li class="flex items-center gap-2 text-xs">
								<span class="w-4 shrink-0 text-right font-semibold text-orange-500">{i + 1}</span>
								<span class="min-w-0 flex-1 truncate">{bItem.title}</span>
								<button
									class="rounded bg-gray-200 px-1.5 py-0.5 text-gray-500 disabled:opacity-30 dark:bg-gray-700 dark:text-gray-400"
									disabled={rankingBusy || i === 0}
									onclick={() => moveBallotEntry(i, 'up')}
									aria-label="Move {bItem.title} up">↑</button
								>
								<button
									class="rounded bg-gray-200 px-1.5 py-0.5 text-gray-500 disabled:opacity-30 dark:bg-gray-700 dark:text-gray-400"
									disabled={rankingBusy || i === myBallot.length - 1}
									onclick={() => moveBallotEntry(i, 'down')}
									aria-label="Move {bItem.title} down">↓</button
								>
								<button
									class="rounded bg-gray-200 px-1.5 py-0.5 text-red-500 disabled:opacity-30 dark:bg-gray-700"
									disabled={rankingBusy}
									onclick={() => toggleRank(bItem)}
									aria-label="Remove {bItem.title} from your ranking">✕</button
								>
							</li>
						{/if}
					{/each}
				</ol>
			{/if}
		</div>
		<div>
			<p
				class="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500"
			>
				Group ranking
			</p>
			{#if tally.length === 0}
				<p class="text-xs text-gray-400 dark:text-gray-600">No one has ranked anything yet.</p>
			{:else}
				<ol class="space-y-1">
					{#each tally as row, i (itemKey(row.item))}
						<li class="flex items-center gap-2 text-xs">
							<span class="w-4 shrink-0 text-right font-semibold text-gray-400">{i + 1}</span>
							<span class="min-w-0 flex-1 truncate">{row.item.title}</span>
							<span class="shrink-0 text-gray-400 dark:text-gray-500"
								>{row.score} pt{row.score === 1 ? '' : 's'} · {row.voters} voter{row.voters === 1
									? ''
									: 's'}</span
							>
						</li>
					{/each}
				</ol>
			{/if}
		</div>
	</div>
{/snippet}

{#snippet content()}
	{#if loaded && items.length > 0}
		<div class="mb-3">
			<button
				onclick={() => (showRankings = !showRankings)}
				class="flex items-center gap-1.5 text-xs font-medium text-gray-500 transition-colors hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300"
				aria-expanded={showRankings}
			>
				<span class="transition-transform {showRankings ? 'rotate-90' : ''}">▸</span>
				🏆 Rankings
				{#if tally.length > 0}
					<span class="text-gray-400 dark:text-gray-600">· {tally.length} ranked</span>
				{/if}
			</button>
			{#if showRankings}
				{@render rankingsPanel()}
			{/if}
		</div>
	{/if}
	{#if loading}
		<p class="text-sm text-gray-500 dark:text-gray-400">Loading…</p>
	{:else if error}
		<p class="text-sm text-red-600 dark:text-red-400">{error}</p>
	{:else if visibleItems.length === 0}
		<p class="text-sm text-gray-400 dark:text-gray-600">
			{items.length === 0 ? 'Nothing here yet.' : 'Nothing matches these filters.'}
		</p>
	{:else if queueControls.viewMode === 'grid'}
		<div class="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 md:grid-cols-4 lg:grid-cols-5">
			{#each visibleItems as item (itemKey(item))}
				{@render gridCard(item)}
			{/each}
		</div>
	{:else if queueControls.viewMode === 'list'}
		<div class="divide-y divide-gray-200 overflow-hidden rounded-xl dark:divide-gray-800/60">
			{#each visibleItems as item (itemKey(item))}
				{@render listRow(item)}
			{/each}
		</div>
	{:else}
		<div class="space-y-2">
			{#each visibleItems as item (itemKey(item))}
				{@render compactCard(item)}
			{/each}
		</div>
	{/if}
{/snippet}

{#if inline}
	{@render content()}
{:else}
	<div class="rounded-xl border border-gray-200 dark:border-gray-800">
		<button
			onclick={toggleOpen}
			class="flex w-full items-center gap-2 px-3 py-2.5 text-left"
			aria-expanded={expanded}
		>
			<span
				class="text-gray-400 transition-transform dark:text-gray-500 {expanded ? 'rotate-90' : ''}"
				>▸</span
			>
			<span class="h-2.5 w-2.5 shrink-0 rounded-full" style="background:{color}"></span>
			<span class="min-w-0 flex-1 truncate text-sm font-medium text-gray-800 dark:text-gray-200">
				{collection.name}
			</span>
			{#if loaded}
				<span class="shrink-0 text-xs text-gray-400 dark:text-gray-500">
					{visibleItems.length} title{visibleItems.length === 1 ? '' : 's'}
				</span>
			{/if}
		</button>

		{#if expanded}
			<div class="border-t border-gray-100 p-3 dark:border-gray-800/60">
				{@render content()}
			</div>
		{/if}
	</div>
{/if}

{#if detailItem}
	{@const di = detailItem}
	<DetailPanel
		item={{ ...di, id: syntheticId(di) }}
		{budgetHours}
		showSeasons={true}
		onClose={() => (detailItem = null)}
	>
		{#snippet footer()}
			<button
				class="rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:opacity-40 {rankOf(
					di
				)
					? 'bg-orange-100 text-orange-700 hover:bg-orange-200 dark:bg-orange-900/40 dark:text-orange-400'
					: 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'}"
				disabled={rankingBusy || (!rankOf(di) && myBallot.length >= MAX_BALLOT_SIZE)}
				onclick={() => toggleRank(di)}
				title={rankOf(di) ? `Ranked #${rankOf(di)} — tap to remove` : 'Add to your ranked picks'}
			>
				{rankOf(di) ? `★ #${rankOf(di)}` : '☆ Rank'}
			</button>
			<button
				class="flex-1 rounded-lg py-2 text-sm font-medium transition-colors
					{watchedByMe(di)
					? 'bg-teal-100 text-teal-700 hover:bg-teal-200 dark:bg-teal-900/40 dark:text-teal-400 dark:hover:bg-teal-900/60'
					: 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'}"
				disabled={togglingKey === itemKey(di)}
				onclick={async () => {
					await toggleWatched(di);
					detailItem = items.find((i) => itemKey(i) === itemKey(di)) ?? null;
				}}
			>
				{watchedByMe(di) ? '↩ Unwatch' : '✓ Watched'}
			</button>
			{#if collection.role === 'owner'}
				{@const key = itemKey(di)}
				<button
					class="rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:opacity-40 {removeArmedKey ===
					key
						? 'bg-red-600 text-white hover:bg-red-700'
						: 'bg-gray-100 text-red-500 hover:bg-red-100 dark:bg-gray-800 dark:hover:bg-red-900/50'}"
					disabled={removingKey === key}
					onclick={async () => {
						const wasArmed = removeArmedKey === key;
						await removeItemAction(di);
						if (wasArmed) detailItem = null;
					}}
				>
					{removeArmedKey === key ? 'Confirm remove' : '✕ Remove'}
				</button>
			{/if}
		{/snippet}
	</DetailPanel>
{/if}
