<script lang="ts">
	// Queue view for a shared collection (#145) — the piece that was missing
	// from v0.9.0/v0.9.1/v0.9.2: Settings could create, invite, and manage
	// membership, but nothing let anyone actually see what was in the
	// collection. This intentionally doesn't reuse QueueGridView/ListView —
	// those are built around WatchlistItem's numeric local `id` (busy-sets,
	// flip keys, drag), and a CollectionItem has no such id; its identity is
	// `tmdb_id`+`media_type`. A simpler dedicated list is less to retrofit
	// than bolting a second identity scheme onto the personal-queue views.
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { TMDB_IMG, formatRuntime } from '$lib/tmdb';
	import {
		listCollections,
		listMembers,
		loadCollectionItems,
		toggleCollectionWatched,
		setMyBallot,
		type SharedCollection,
		type CollectionMember
	} from '$lib/collection-actions';
	import { MAX_BALLOT_SIZE, type CollectionItem, type BallotEntry } from '$lib/collection-sync';
	import { bordaTally } from '$lib/ranking';
	import { getSyncStatus } from '$lib/sync';
	import { getLastViewed, markViewed, hasNewActivity } from '$lib/collection-activity';

	const id = page.params.id ?? '';

	let loading = $state(true);
	let loadError = $state('');
	let collection: SharedCollection | null = $state(null);
	let members: CollectionMember[] = $state([]);
	let items: CollectionItem[] = $state([]);
	let ballots: Record<string, BallotEntry> = $state({});
	let myUserId = $state('');
	let togglingKey = $state('');
	let rankingBusy = $state(false);
	let showRankings = $state(false);
	// The watermark from *before* this visit — captured once, up front, so an
	// item stays flagged "new" for the whole time you're looking at this page
	// even though markViewed() below immediately moves the stored watermark
	// forward to now.
	let lastViewed: string | undefined = $state(undefined);

	const noop = { setBusy: () => {}, setError: (e: string) => (loadError = e) };

	function itemKey(i: CollectionItem): string {
		return `${i.media_type}:${i.tmdb_id}`;
	}

	function memberLabel(userId: string | null): string {
		if (!userId) return 'Someone';
		if (userId === myUserId) return 'You';
		const m = members.find((x) => x.userId === userId);
		return m?.email ?? 'A member';
	}

	function initial(userId: string): string {
		if (userId === myUserId) return 'Y';
		const m = members.find((x) => x.userId === userId);
		return (m?.email ?? '?').charAt(0).toUpperCase();
	}

	onMount(async () => {
		const status = getSyncStatus();
		const all = await listCollections(noop);
		collection = all.find((c) => c.id === id) ?? null;
		if (!collection) {
			loadError = "You don't have access to this list, or it doesn't exist.";
			loading = false;
			return;
		}

		members = await listMembers(id, noop);
		myUserId =
			members.find((m) => m.email === status.email)?.userId ??
			(collection.role === 'owner' ? collection.ownerUserId : '');

		lastViewed = await getLastViewed(id);
		const state = await loadCollectionItems(collection, noop);
		items = state.items;
		ballots = state.ballots;
		loading = false;
		await markViewed(id);
	});

	async function toggle(item: CollectionItem) {
		if (!collection || !myUserId) return;
		const key = itemKey(item);
		const currentlyWatched = Boolean(item.watch?.[myUserId]);
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

	// ── Ranked voting (#210) ──────────────────────────────────────────────
	let myBallot = $derived(
		(ballots[myUserId]?.items ?? []).filter((key) => items.some((i) => itemKey(i) === key))
	);

	function rankOf(item: CollectionItem): number | null {
		const i = myBallot.indexOf(itemKey(item));
		return i === -1 ? null : i + 1;
	}

	async function toggleRank(item: CollectionItem) {
		if (!collection || !myUserId) return;
		const key = itemKey(item);
		const current = myBallot;
		const next = current.includes(key)
			? current.filter((k) => k !== key)
			: current.length >= MAX_BALLOT_SIZE
				? current
				: [...current, key];
		if (next === current) return;
		rankingBusy = true;
		const result = await setMyBallot(collection, ballots, myUserId, next, noop);
		if (result) ballots = result;
		rankingBusy = false;
	}

	let tally = $derived(bordaTally(items, ballots));
</script>

<svelte:head><title>Queuest — {collection?.name ?? 'Shared list'}</title></svelte:head>

<main class="mx-auto max-w-2xl px-4 py-8 space-y-6">
	<div class="flex items-center justify-between">
		<a
			href={resolve('/lists')}
			class="text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
		>
			← Lists
		</a>
	</div>

	{#if loading}
		<p class="text-sm text-gray-500 dark:text-gray-400">Loading…</p>
	{:else if loadError && !collection}
		<p class="text-sm text-red-600 dark:text-red-400">{loadError}</p>
	{:else if collection}
		<div>
			<h1 class="text-xl font-semibold text-gray-900 dark:text-white">{collection.name}</h1>
			<p class="text-sm text-gray-500 dark:text-gray-400">
				{members.length} member{members.length === 1 ? '' : 's'} · {items.length} title{items.length ===
				1
					? ''
					: 's'}
			</p>
		</div>

		{#if loadError}
			<p class="text-sm text-red-600 dark:text-red-400">{loadError}</p>
		{/if}

		{#if items.length > 0}
			<div>
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
					<div class="mt-2 space-y-3 rounded-lg bg-gray-50 p-3 dark:bg-gray-800/40">
						<div>
							<p
								class="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500"
							>
								Your ballot
							</p>
							{#if myBallot.length === 0}
								<p class="text-xs text-gray-400 dark:text-gray-600">
									Tap ☆ Rank on a title below to rank up to {MAX_BALLOT_SIZE}.
								</p>
							{:else}
								<ol class="space-y-1">
									{#each myBallot as key, i (key)}
										{@const bItem = items.find((it) => itemKey(it) === key)}
										{#if bItem}
											<li class="flex items-center gap-2 text-xs">
												<span class="w-4 shrink-0 text-right font-semibold text-orange-500"
													>{i + 1}</span
												>
												<span class="min-w-0 flex-1 truncate">{bItem.title}</span>
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
								<p class="text-xs text-gray-400 dark:text-gray-600">
									No one has ranked anything yet.
								</p>
							{:else}
								<ol class="space-y-1">
									{#each tally as row, i (itemKey(row.item))}
										<li class="flex items-center gap-2 text-xs">
											<span class="w-4 shrink-0 text-right font-semibold text-gray-400"
												>{i + 1}</span
											>
											<span class="min-w-0 flex-1 truncate">{row.item.title}</span>
											<span class="shrink-0 text-gray-400 dark:text-gray-500"
												>{row.score} pt{row.score === 1 ? '' : 's'} · {row.voters} voter{row.voters ===
												1
													? ''
													: 's'}</span
											>
										</li>
									{/each}
								</ol>
							{/if}
						</div>
					</div>
				{/if}
			</div>
		{/if}

		{#if items.length === 0}
			<p class="text-sm text-gray-400 dark:text-gray-600">
				Nothing here yet. Titles show up here once someone shares a personal list into this one, or
				adds to it directly.
			</p>
		{:else}
			<div class="space-y-2">
				{#each items as item (itemKey(item))}
					{@const key = itemKey(item)}
					{@const myWatch = myUserId ? item.watch?.[myUserId] : undefined}
					{@const watchers = Object.keys(item.watch ?? {})}
					{@const isNew = hasNewActivity(item, lastViewed)}
					<div
						class="flex gap-3 rounded-lg bg-gray-50 p-2.5 dark:bg-gray-800/60 {isNew
							? 'ring-1 ring-orange-400/60'
							: ''}"
					>
						{#if item.poster_path}
							<img
								src={`${TMDB_IMG}/w92${item.poster_path}`}
								alt=""
								class="h-20 w-14 shrink-0 rounded object-cover bg-gray-200 dark:bg-gray-700"
							/>
						{:else}
							<div class="h-20 w-14 shrink-0 rounded bg-gray-200 dark:bg-gray-700"></div>
						{/if}
						<div class="min-w-0 flex-1">
							<p
								class="truncate text-sm font-medium text-gray-900 dark:text-gray-100 flex items-center gap-1.5"
							>
								{item.title}
								{#if isNew}
									<span
										class="shrink-0 rounded-full bg-orange-500 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white"
									>
										New
									</span>
								{/if}
							</p>
							<p class="text-xs text-gray-500 dark:text-gray-400">
								{item.runtime_minutes ? formatRuntime(item.runtime_minutes, item.media_type) : '—'} ·
								Added by {memberLabel(item.added_by_account_id ?? null)}
							</p>
							<div class="mt-1.5 flex items-center gap-2">
								<button
									disabled={rankingBusy ||
										!myUserId ||
										(!rankOf(item) && myBallot.length >= MAX_BALLOT_SIZE)}
									onclick={() => toggleRank(item)}
									title={rankOf(item)
										? `Ranked #${rankOf(item)} — tap to remove`
										: 'Add to your ranked picks'}
									class="text-xs px-2 py-1 rounded font-medium disabled:opacity-50 {rankOf(item)
										? 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400'
										: 'bg-gray-200 text-gray-700 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600'}"
								>
									{rankOf(item) ? `★ #${rankOf(item)}` : '☆ Rank'}
								</button>
								<button
									disabled={togglingKey === key || !myUserId}
									onclick={() => toggle(item)}
									class="text-xs px-2 py-1 rounded font-medium disabled:opacity-50 {myWatch
										? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
										: 'bg-gray-200 text-gray-700 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600'}"
								>
									{myWatch ? '✓ Watched' : 'Mark watched'}
								</button>
								{#if watchers.length > 0}
									<div class="flex -space-x-1.5" title="Watched by">
										{#each watchers as w (w)}
											<span
												class="flex h-5 w-5 items-center justify-center rounded-full bg-orange-200 text-[10px] font-semibold text-orange-800 ring-2 ring-gray-50 dark:bg-orange-900/50 dark:text-orange-300 dark:ring-gray-800"
											>
												{initial(w)}
											</span>
										{/each}
									</div>
								{/if}
							</div>
						</div>
					</div>
				{/each}
			</div>
		{/if}
	{/if}
</main>
