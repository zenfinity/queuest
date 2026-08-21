<script lang="ts">
	// A shared list's presence in the Queue view (#189 follow-up) — collapsed
	// by default and only fetched/decrypted on first expand, so having several
	// shared lists doesn't cost a blob pull on every Queue load. Deliberately
	// its own simple card, not QueueGridView/ListView: those key everything off
	// WatchlistItem's numeric local `id`, and a CollectionItem's identity is
	// `tmdb_id`+`media_type` — same reasoning as /collections/[id], which this
	// mirrors the item-card markup from.
	import { TMDB_IMG, formatRuntime } from '$lib/tmdb';
	import { remainingRuntime } from '$lib/progress';
	import { queueControls } from '$lib/queue-controls.svelte';
	import { services } from '$lib/services.svelte';
	import {
		listMembers,
		loadCollectionItems,
		toggleCollectionWatched,
		type SharedCollection,
		type CollectionMember
	} from '$lib/collection-actions';
	import type { CollectionItem } from '$lib/collection-sync';
	import { getSyncStatus } from '$lib/sync';
	import { getLastViewed, markViewed, hasNewActivity } from '$lib/collection-activity';

	let { collection, color }: { collection: SharedCollection; color: string } = $props();

	let expanded = $state(false);
	let loading = $state(false);
	let loaded = $state(false);
	let error = $state('');
	let items: CollectionItem[] = $state([]);
	let members: CollectionMember[] = $state([]);
	let myUserId = $state('');
	let togglingKey = $state('');
	let lastViewed: string | undefined = $state(undefined);

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

	async function load() {
		if (loaded || loading) return;
		loading = true;
		const status = getSyncStatus();
		members = await listMembers(collection.id, noop);
		myUserId =
			members.find((m) => m.email === status.email)?.userId ??
			(collection.role === 'owner' ? collection.ownerUserId : '');
		lastViewed = await getLastViewed(collection.id);
		items = await loadCollectionItems(collection, noop);
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
		return [...list].sort((a, b) => {
			if (queueControls.sortBy === 'title') return a.title.localeCompare(b.title) * mul;
			if (queueControls.sortBy === 'runtime') {
				return (
					(remainingRuntime(a as unknown as Parameters<typeof remainingRuntime>[0]) -
						remainingRuntime(b as unknown as Parameters<typeof remainingRuntime>[0])) *
					mul
				);
			}
			return a.added_at.localeCompare(b.added_at) * mul;
		});
	});
</script>

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
		<div class="space-y-2 border-t border-gray-100 px-3 py-3 dark:border-gray-800/60">
			{#if loading}
				<p class="text-sm text-gray-500 dark:text-gray-400">Loading…</p>
			{:else if error}
				<p class="text-sm text-red-600 dark:text-red-400">{error}</p>
			{:else if visibleItems.length === 0}
				<p class="text-sm text-gray-400 dark:text-gray-600">
					{items.length === 0 ? 'Nothing here yet.' : 'Nothing matches these filters.'}
				</p>
			{:else}
				{#each visibleItems as item (itemKey(item))}
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
								src={`${TMDB_IMG}${item.poster_path}`}
								alt=""
								class="h-16 w-11 shrink-0 rounded object-cover bg-gray-200 dark:bg-gray-700"
							/>
						{:else}
							<div class="h-16 w-11 shrink-0 rounded bg-gray-200 dark:bg-gray-700"></div>
						{/if}
						<div class="min-w-0 flex-1">
							<p
								class="flex items-center gap-1.5 truncate text-sm font-medium text-gray-900 dark:text-gray-100"
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
							<button
								disabled={togglingKey === key}
								onclick={() => toggleWatched(item)}
								class="mt-1.5 rounded px-2 py-1 text-xs font-medium disabled:opacity-50 {myWatch
									? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
									: 'bg-gray-200 text-gray-700 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600'}"
							>
								{myWatch ? '✓ Watched' : 'Mark watched'}
							</button>
						</div>
					</div>
				{/each}
			{/if}
		</div>
	{/if}
</div>
