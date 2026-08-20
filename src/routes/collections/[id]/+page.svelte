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
		type SharedCollection,
		type CollectionMember
	} from '$lib/collection-actions';
	import type { CollectionItem } from '$lib/collection-sync';
	import { getSyncStatus } from '$lib/sync';

	const id = page.params.id ?? '';

	let loading = $state(true);
	let loadError = $state('');
	let collection: SharedCollection | null = $state(null);
	let members: CollectionMember[] = $state([]);
	let items: CollectionItem[] = $state([]);
	let myUserId = $state('');
	let togglingKey = $state('');

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
			loadError = "You don't have access to this collection, or it doesn't exist.";
			loading = false;
			return;
		}

		members = await listMembers(id, noop);
		myUserId =
			members.find((m) => m.email === status.email)?.userId ??
			(collection.role === 'owner' ? collection.ownerUserId : '');

		items = await loadCollectionItems(collection, noop);
		loading = false;
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
</script>

<svelte:head><title>Queuest — {collection?.name ?? 'Shared collection'}</title></svelte:head>

<main class="mx-auto max-w-2xl px-4 py-8 space-y-6">
	<div class="flex items-center justify-between">
		<a
			href={resolve('/settings')}
			class="text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
		>
			← Settings
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

		{#if items.length === 0}
			<p class="text-sm text-gray-400 dark:text-gray-600">
				Nothing here yet. Titles show up here once someone shares a personal collection into this
				one, or adds to it directly.
			</p>
		{:else}
			<div class="space-y-2">
				{#each items as item (itemKey(item))}
					{@const key = itemKey(item)}
					{@const myWatch = myUserId ? item.watch?.[myUserId] : undefined}
					{@const watchers = Object.keys(item.watch ?? {})}
					<div class="flex gap-3 rounded-lg bg-gray-50 p-2.5 dark:bg-gray-800/60">
						{#if item.poster_path}
							<img
								src={`${TMDB_IMG}${item.poster_path}`}
								alt=""
								class="h-20 w-14 shrink-0 rounded object-cover bg-gray-200 dark:bg-gray-700"
							/>
						{:else}
							<div class="h-20 w-14 shrink-0 rounded bg-gray-200 dark:bg-gray-700"></div>
						{/if}
						<div class="min-w-0 flex-1">
							<p class="truncate text-sm font-medium text-gray-900 dark:text-gray-100">
								{item.title}
							</p>
							<p class="text-xs text-gray-500 dark:text-gray-400">
								{item.runtime_minutes ? formatRuntime(item.runtime_minutes, item.media_type) : '—'} ·
								Added by {memberLabel(item.added_by_account_id ?? null)}
							</p>
							<div class="mt-1.5 flex items-center gap-2">
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
