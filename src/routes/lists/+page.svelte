<script lang="ts">
	// Lists — personal collections and their collaborative counterpart, pulled
	// out of Settings into their own route. They'd grown into the app's most
	// interactive surface (create/rename/color/share/invite/QR/remove-member,
	// two live decrypt-and-diff badges) and were easy to miss buried under
	// Appearance/My Queue/Sync — this gives them equal footing in the nav
	// instead. "Lists" in the UI; the underlying data/API/type names are still
	// `collection` throughout the codebase — renaming those touches the crypto
	// schema and API surface for zero user-facing benefit, so this is a
	// presentation-layer rename only.
	import type { WatchlistItem } from '$lib/types';
	import { resolve } from '$app/paths';
	import { onMount } from 'svelte';
	import { getAll, renameCollectionTag, clearCollectionTag } from '$lib/db';
	import { isSyncEnabled } from '$lib/sync';
	import {
		listCollections as listSharedCollections,
		promoteCollection,
		createInvite,
		removeMemberAndRotate,
		listMembers,
		loadCollectionItems,
		type SharedCollection,
		type CollectionMember
	} from '$lib/collection-actions';
	import { getLastViewed, countNewActivity } from '$lib/collection-activity';
	import { createShareLink } from '$lib/share-create-actions';
	import {
		getQueueColors,
		setQueueColor,
		renameCollectionColor,
		deleteCollectionColor
	} from '$lib/queue-colors';
	import { listCollections } from '$lib/queue-actions';

	let syncEnabled = $state(false);

	// ── Shared Lists ──────────────────────────────────────────────────────────
	let sharedCollections: SharedCollection[] = $state([]);
	let promoteArmed: string | null = $state(null);
	let promoting = $state(false);
	let promoteError = $state('');
	let openCollection: SharedCollection | null = $state(null);
	let inviteLink = $state('');
	let inviteCopied = $state(false);
	let inviteQr = $state('');
	let showInviteQr = $state(false);
	let inviteError = $state('');
	let removingMember: { collectionId: string; userId: string } | null = $state(null);
	let removalError = $state('');
	let openMembers: CollectionMember[] = $state([]);
	let loadingMembers = $state(false);
	let newActivityCounts: Record<string, number> = $state({});

	async function loadSharedCollections() {
		sharedCollections = await listSharedCollections({
			setBusy: () => {},
			setError: () => {}
		});
		// Fire off per-list "what's new" checks in the background — each is
		// a decrypt, so this shouldn't block the list itself from rendering.
		for (const coll of sharedCollections) {
			loadActivityCount(coll);
		}
	}

	async function loadActivityCount(coll: SharedCollection) {
		const watermark = await getLastViewed(coll.id);
		if (!watermark) return;
		const items = await loadCollectionItems(coll, { setBusy: () => {}, setError: () => {} });
		newActivityCounts = { ...newActivityCounts, [coll.id]: countNewActivity(items, watermark) };
	}

	// Promotion is the only way a shared list is born (#145) — there is no
	// create-from-scratch form, so there's exactly one on-ramp rather than two
	// unrelated things both called "Lists".
	async function doPromoteCollection(name: string) {
		promoting = true;
		promoteError = '';
		try {
			const created = await promoteCollection(name, items, {
				setBusy: () => {},
				setError: (e) => (promoteError = e)
			});
			if (created) {
				sharedCollections = [...sharedCollections, created];
				promoteArmed = null;
				// Drop the personal list's color entry too. A name with no items
				// still "exists" as a palette key (see listCollections's
				// extraNames), so without this the promoted name keeps showing up
				// in both sections — the exact duplication promotion exists to end.
				deleteCollectionColor(name);
				queueColors = getQueueColors();
				items = await getAll();
				collections = listCollections(items, Object.keys(queueColors));
				updateCounts();
			}
		} finally {
			promoting = false;
		}
	}

	async function generateInviteLink() {
		if (!openCollection) return;
		inviteLink = '';
		inviteCopied = false;
		inviteQr = '';
		showInviteQr = false;
		inviteError = '';
		const link = await createInvite(openCollection, window.location.origin, {
			setBusy: () => {},
			setError: (e) => (inviteError = e)
		});
		if (link) {
			inviteLink = link;
		}
	}

	// The QR code is only rendered on demand — most people just copy the link,
	// and generating it up front would mean pulling in the encoder for every
	// visitor to this panel rather than the ones who ask for it.
	async function toggleInviteQr() {
		showInviteQr = !showInviteQr;
		if (showInviteQr && !inviteQr && inviteLink) {
			const { toQrSvg } = await import('$lib/qrcode');
			inviteQr = await toQrSvg(inviteLink);
		}
	}

	async function loadOpenMembers() {
		if (!openCollection) return;
		loadingMembers = true;
		openMembers = await listMembers(openCollection.id, { setBusy: () => {}, setError: () => {} });
		loadingMembers = false;
	}

	async function copyInviteLink() {
		if (!inviteLink) return;
		await navigator.clipboard.writeText(inviteLink);
		inviteCopied = true;
		setTimeout(() => (inviteCopied = false), 2000);
	}

	async function doRemoveMember() {
		if (!removingMember || !openCollection) return;
		const result = await removeMemberAndRotate(openCollection, removingMember.userId, {
			setBusy: () => {},
			setError: (e) => (removalError = e)
		});
		if (result) {
			await loadSharedCollections();
			openCollection = sharedCollections.find((c) => c.id === openCollection!.id) || null;
			removingMember = null;
			await loadOpenMembers();
		}
	}

	// ── Personal Lists ────────────────────────────────────────────────────────
	let queueColors = $state<Record<string, string>>({});
	let collections = $state<string[]>([]);
	let collectionCounts = $state<Record<string, number>>({});
	let items = $state<WatchlistItem[]>([]);
	let renamingCollection = $state<string | null>(null);
	let renameInput = $state('');
	let deleteArmed = $state<string | null>(null);
	let manageBusy = $state(false);
	let newCollectionInput = $state('');

	// ── Read-only link ───────────────────────────────────────────────────────
	// The account-free counterpart to Share/promote: a disposable, one-way
	// snapshot link — no sign-in for the creator or the recipient, nothing to
	// keep in sync.
	let readOnlyLinkFor = $state<string | null>(null);
	let readOnlyLinkCreating = $state(false);
	let readOnlyLinkUrl = $state('');
	let readOnlyLinkCopied = $state(false);
	let readOnlyLinkError = $state('');

	async function createReadOnlyLink(name: string) {
		readOnlyLinkFor = name;
		readOnlyLinkUrl = '';
		readOnlyLinkCopied = false;
		readOnlyLinkError = '';
		const tagged = items.filter((i) => i.queue_tag === name);
		await createShareLink(tagged, new Set([name]), [name], {
			setShareCreating: (v) => (readOnlyLinkCreating = v),
			setShareUrl: (v) => (readOnlyLinkUrl = v),
			setShareError: (v) => (readOnlyLinkError = v)
		});
	}

	async function copyReadOnlyLink() {
		if (!readOnlyLinkUrl) return;
		await navigator.clipboard.writeText(readOnlyLinkUrl);
		readOnlyLinkCopied = true;
		setTimeout(() => (readOnlyLinkCopied = false), 2000);
	}

	function updateCollectionColor(tag: string, color: string) {
		setQueueColor(tag, color);
		queueColors = { ...queueColors, [tag]: color };
	}

	// Lists aren't a stored entity of their own — a name only "exists" via
	// items tagged with it, or (for one created here with nothing tagged yet)
	// via a color-palette entry. Assigning a palette color is therefore enough
	// to create an empty list; see listCollections's extraNames.
	function createCollection() {
		const name = newCollectionInput.trim();
		if (!name || collections.includes(name)) {
			newCollectionInput = '';
			return;
		}
		updateCollectionColor(name, queueColors[name] ?? '#888888');
		collections = listCollections(items, Object.keys(queueColors));
		updateCounts();
		newCollectionInput = '';
	}

	async function renameCollection(oldName: string, newName: string) {
		if (!newName.trim() || newName === oldName) {
			renamingCollection = null;
			renameInput = '';
			return;
		}

		manageBusy = true;
		try {
			// NOTE: Rename is a bulk write, and with last-write-wins sync (#101), this can race with
			// per-item edits on another device. If a rename on device A races with an edit on device B
			// for the same item, the result is unpredictable — the rename may land on some items but not
			// others. This is acceptable for v1 given how rare it is; long-term fix is to version the
			// list itself rather than denormalizing the name.
			//
			// Persist via a targeted cursor update, not getAll()+replaceAll() — replaceAll clears the
			// whole store, and getAll() (rightly) excludes soft-deleted tombstones, so replaceAll(items)
			// would silently drop them from the store instead of leaving them for GC.
			await renameCollectionTag(oldName, newName);
			for (const item of items) {
				if (item.queue_tag === oldName) {
					item.queue_tag = newName;
				}
			}
			renameCollectionColor(oldName, newName);
			queueColors = { ...queueColors };
			collections = listCollections(items, Object.keys(queueColors));
			updateCounts();
			renamingCollection = null;
			renameInput = '';
		} finally {
			manageBusy = false;
		}
	}

	async function deleteCollection(name: string) {
		if (!deleteArmed) {
			deleteArmed = name;
			return;
		}

		manageBusy = true;
		try {
			// Items are never deleted, only uncategorized. Targeted cursor update — see the
			// comment in renameCollection for why this isn't getAll()+replaceAll().
			await clearCollectionTag(name);
			for (const item of items) {
				if (item.queue_tag === name) {
					item.queue_tag = undefined;
				}
			}
			deleteCollectionColor(name);
			queueColors = { ...queueColors };
			collections = listCollections(items, Object.keys(queueColors));
			updateCounts();
			deleteArmed = null;
		} finally {
			manageBusy = false;
		}
	}

	function updateCounts() {
		const counts: Record<string, number> = {};
		for (const collection of collections) {
			counts[collection] = items.filter((i) => i.queue_tag === collection).length;
		}
		collectionCounts = counts;
	}

	onMount(async () => {
		queueColors = getQueueColors();
		syncEnabled = await isSyncEnabled();
		if (syncEnabled) await loadSharedCollections();

		items = await getAll();
		collections = listCollections(items, Object.keys(queueColors));
		updateCounts();
	});
</script>

<svelte:head><title>Queuest — Lists</title></svelte:head>

<h1 class="sr-only">Lists</h1>

<div class="mx-auto max-w-md space-y-6 xs:space-y-10">
	<!-- Lists -->
	<section class="space-y-3">
		<h2 class="text-sm font-semibold uppercase tracking-widest text-gray-500">Lists</h2>
		<p class="text-sm text-gray-600 dark:text-gray-400">
			Organize your queue into lists, then assign items to them from the detail panel. Importing a
			shared list automatically creates one.
		</p>
		<form
			class="flex gap-2"
			onsubmit={(e) => {
				e.preventDefault();
				createCollection();
			}}
		>
			<input
				type="text"
				maxlength="40"
				placeholder="New list…"
				bind:value={newCollectionInput}
				class="flex-1 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-orange-500 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
			/>
			<button
				type="submit"
				disabled={!newCollectionInput.trim()}
				class="rounded-lg bg-orange-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-orange-400 disabled:opacity-50"
			>
				Create
			</button>
		</form>
		{#if collections.length === 0}
			<p class="text-sm text-gray-400 dark:text-gray-600">No lists yet.</p>
		{:else}
			<div class="space-y-2">
				{#each collections as collection (collection)}
					{@const color = queueColors[collection] ?? '#888888'}
					{@const count = collectionCounts[collection] ?? 0}
					{@const isRenaming = renamingCollection === collection}
					{@const isDeleting = deleteArmed === collection}
					{@const isPromoting = promoteArmed === collection}
					{@const isReadOnlyLink = readOnlyLinkFor === collection}
					<div>
						<div
							class="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2.5 dark:bg-gray-800/60"
						>
							<div class="flex items-center gap-2.5 min-w-0 flex-1">
								<span class="h-3 w-3 shrink-0 rounded-full" style="background:{color};"></span>
								{#if isRenaming}
									<!-- svelte-ignore a11y_autofocus -->
									<input
										type="text"
										aria-label="New list name"
										maxlength="40"
										value={renameInput}
										oninput={(e) => (renameInput = e.currentTarget.value)}
										onkeydown={(e) => {
											if (e.key === 'Enter') renameCollection(collection, renameInput);
											if (e.key === 'Escape') renamingCollection = null;
										}}
										autofocus
										class="flex-1 rounded px-1 py-0.5 text-sm bg-white border border-gray-300 dark:bg-gray-900 dark:border-gray-600 dark:text-white focus:outline-none focus:ring-1 focus:ring-orange-500"
									/>
								{:else}
									<span class="truncate text-sm font-medium text-gray-800 dark:text-gray-200"
										>{collection}</span
									>
									<span class="shrink-0 text-xs text-gray-500 dark:text-gray-400">({count})</span>
								{/if}
							</div>
							<div class="flex items-center gap-1 ml-2 shrink-0">
								{#if isRenaming}
									<button
										disabled={manageBusy}
										onclick={() => renameCollection(collection, renameInput)}
										class="text-xs px-2 py-1 rounded text-orange-500 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50"
									>
										Save
									</button>
									<button
										disabled={manageBusy}
										onclick={() => {
											renamingCollection = null;
											renameInput = '';
										}}
										class="text-xs px-2 py-1 rounded text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50"
									>
										Cancel
									</button>
								{:else if isDeleting}
									<div class="text-xs text-gray-600 dark:text-gray-400 mr-2">
										Delete list? Items stay.
									</div>
									<button
										disabled={manageBusy}
										onclick={() => deleteCollection(collection)}
										class="text-xs px-2 py-1 rounded text-red-500 hover:bg-red-100 dark:hover:bg-red-900/20 disabled:opacity-50"
									>
										Confirm
									</button>
									<button
										disabled={manageBusy}
										onclick={() => (deleteArmed = null)}
										class="text-xs px-2 py-1 rounded text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50"
									>
										Cancel
									</button>
								{:else}
									<label class="relative cursor-pointer" title="Change color">
										<span
											class="block h-6 w-6 rounded border border-gray-300 shadow-sm dark:border-gray-600"
											style="background:{color};"
										></span>
										<input
											type="color"
											aria-label="List color"
											value={color}
											oninput={(e) =>
												updateCollectionColor(
													collection,
													(e.currentTarget as HTMLInputElement).value
												)}
											class="absolute inset-0 h-full w-full cursor-pointer opacity-0"
										/>
									</label>
									{#if syncEnabled}
										<button
											disabled={manageBusy || promoting}
											onclick={() => {
												promoteArmed = collection;
												promoteError = '';
											}}
											class="text-xs px-2 py-1 rounded text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50"
											title="Share this list with other people — everyone gets an account and stays in sync"
										>
											Share
										</button>
									{/if}
									<button
										disabled={manageBusy || readOnlyLinkCreating || count === 0}
										onclick={() => createReadOnlyLink(collection)}
										class="text-xs px-2 py-1 rounded text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50"
										title={count === 0
											? 'Add a title to this list first'
											: "Get a link anyone can open to view this list — no account needed, and it won't update after they open it"}
									>
										Read-only link
									</button>
									<button
										disabled={manageBusy}
										onclick={() => {
											renamingCollection = collection;
											renameInput = collection;
										}}
										class="text-xs px-2 py-1 rounded text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50"
										title="Rename list"
									>
										Rename
									</button>
									<button
										disabled={manageBusy}
										onclick={() => deleteCollection(collection)}
										class="text-xs px-2 py-1 rounded text-gray-500 hover:bg-red-100 dark:hover:bg-red-900/20 disabled:opacity-50"
										title="Delete list"
									>
										Delete
									</button>
								{/if}
							</div>
						</div>
						{#if isPromoting}
							<div
								class="mt-1 rounded-lg border border-orange-300 bg-orange-50 px-3 py-2.5 text-xs dark:border-orange-900/60 dark:bg-orange-950/30"
							>
								<p class="font-medium text-gray-900 dark:text-gray-100">
									Share “{collection}” with other people?
								</p>
								<p class="mt-1 text-gray-700 dark:text-gray-300">
									Its {collectionCounts[collection] ?? 0} title{(collectionCounts[collection] ??
										0) === 1
										? ''
										: 's'} move into a shared list and leave this queue. From then on they live online,
									reachable only through this account —
									<span class="font-medium"
										>if you lose both your passphrase and your recovery code, they're gone for good.</span
									>
								</p>
								{#if promoteError}
									<p class="mt-1.5 text-red-600 dark:text-red-400">{promoteError}</p>
								{/if}
								<div class="mt-2 flex items-center gap-1">
									<button
										disabled={promoting}
										onclick={() => doPromoteCollection(collection)}
										class="rounded px-2 py-1 text-xs font-medium text-orange-600 hover:bg-orange-100 disabled:opacity-50 dark:text-orange-400 dark:hover:bg-orange-900/30"
									>
										{promoting ? 'Sharing…' : 'Share it'}
									</button>
									<button
										disabled={promoting}
										onclick={() => (promoteArmed = null)}
										class="rounded px-2 py-1 text-xs text-gray-500 hover:bg-gray-100 disabled:opacity-50 dark:hover:bg-gray-700"
									>
										Cancel
									</button>
								</div>
							</div>
						{/if}
						{#if isReadOnlyLink}
							<div
								class="mt-1 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 text-xs dark:border-gray-700 dark:bg-gray-800/60"
							>
								<p class="text-gray-700 dark:text-gray-300">
									Anyone with this link can view “{collection}” — no account needed. It's a
									snapshot: their view won't update when you change the list, and the link stops
									working after 30 days. For an ongoing, two-way list instead, use
									<span class="font-medium">Share</span> above.
								</p>
								{#if readOnlyLinkCreating}
									<p class="mt-1.5 text-gray-500 dark:text-gray-400">Creating link…</p>
								{:else if readOnlyLinkUrl}
									<div class="mt-2 flex gap-1">
										<input
											type="text"
											readonly
											value={readOnlyLinkUrl}
											class="flex-1 rounded px-2 py-1 bg-white border border-gray-300 text-gray-900 dark:bg-gray-900 dark:border-gray-600 dark:text-white"
										/>
										<button
											onclick={copyReadOnlyLink}
											class="px-2 py-1 rounded text-orange-600 hover:bg-orange-50 dark:text-orange-400 dark:hover:bg-orange-900/20"
										>
											{readOnlyLinkCopied ? '✓' : 'Copy'}
										</button>
									</div>
								{/if}
								{#if readOnlyLinkError}
									<p class="mt-1.5 text-red-600 dark:text-red-400">{readOnlyLinkError}</p>
								{/if}
								<button
									onclick={() => (readOnlyLinkFor = null)}
									class="mt-2 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
								>
									Close
								</button>
							</div>
						{/if}
					</div>
				{/each}
			</div>
		{/if}
	</section>

	<div class="border-t border-gray-200 dark:border-gray-800"></div>

	<!-- Shared Lists -->
	{#if syncEnabled}
		<section class="space-y-3">
			<h2 class="text-sm font-semibold uppercase tracking-widest text-gray-500">Shared Lists</h2>
			<p class="text-sm text-gray-600 dark:text-gray-400">
				Lists you're watching through with other people. To start one, use
				<span class="font-medium">Share</span> on a list above.
			</p>

			{#if sharedCollections.length === 0}
				<p class="text-sm text-gray-400 dark:text-gray-600">No shared lists yet.</p>
			{:else}
				<div class="space-y-2">
					{#each sharedCollections as coll (coll.id)}
						<div
							class="rounded-lg bg-gray-50 px-3 py-2.5 dark:bg-gray-800/60 flex items-center justify-between"
						>
							<div class="min-w-0 flex-1">
								<p
									class="text-sm font-medium text-gray-800 dark:text-gray-200 flex items-center gap-1.5"
								>
									{coll.name}
									{#if newActivityCounts[coll.id]}
										<span
											class="rounded-full bg-orange-500 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white"
										>
											{newActivityCounts[coll.id]} new
										</span>
									{/if}
								</p>
								<p class="text-xs text-gray-500 dark:text-gray-400">
									{coll.role === 'owner' ? 'You own this' : 'Member'}
								</p>
							</div>
							<div class="flex gap-1 ml-2">
								<a
									href={resolve('/collections/[id]', { id: coll.id })}
									class="text-xs px-2 py-1 rounded text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700"
								>
									Open
								</a>
								{#if coll.role === 'owner'}
									<button
										onclick={async () => {
											openCollection = coll;
											await generateInviteLink();
										}}
										class="text-xs px-2 py-1 rounded text-orange-600 hover:bg-orange-50 dark:text-orange-400 dark:hover:bg-orange-900/20"
									>
										Invite
									</button>
								{/if}
								<button
									onclick={() => {
										if (openCollection?.id === coll.id) {
											openCollection = null;
										} else {
											openCollection = coll;
											openMembers = [];
											loadOpenMembers();
										}
									}}
									class="text-xs px-2 py-1 rounded text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700"
								>
									{openCollection?.id === coll.id ? 'Hide' : 'Info'}
								</button>
							</div>
						</div>
						{#if openCollection?.id === coll.id}
							<div
								class="ml-3 pl-3 border-l border-gray-200 dark:border-gray-700 space-y-2 text-xs text-gray-600 dark:text-gray-400"
							>
								{#if inviteLink && openCollection.id === coll.id}
									<div class="flex gap-1">
										<input
											type="text"
											readonly
											value={inviteLink}
											class="flex-1 rounded px-2 py-1 bg-white border border-gray-300 text-gray-900 dark:bg-gray-900 dark:border-gray-600 dark:text-white"
										/>
										<button
											onclick={copyInviteLink}
											class="px-2 py-1 rounded text-orange-600 hover:bg-orange-50 dark:text-orange-400 dark:hover:bg-orange-900/20"
										>
											{inviteCopied ? '✓' : 'Copy'}
										</button>
										<button
											onclick={toggleInviteQr}
											class="px-2 py-1 rounded text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700"
										>
											{showInviteQr ? 'Hide QR' : 'QR code'}
										</button>
									</div>
									{#if showInviteQr}
										<div class="flex justify-center rounded bg-white p-2">
											{#if inviteQr}
												<!-- eslint-disable-next-line svelte/no-at-html-tags -->
												{@html inviteQr}
											{:else}
												<p class="py-8 text-gray-500">Generating…</p>
											{/if}
										</div>
									{/if}
								{/if}
								{#if inviteError}
									<p class="text-red-600 dark:text-red-400">{inviteError}</p>
								{/if}
								{#if loadingMembers}
									<p>Loading members…</p>
								{:else if removingMember?.collectionId !== coll.id}
									<ul class="space-y-1">
										{#each openMembers as member (member.userId)}
											<li class="flex items-center justify-between gap-2">
												<span class="truncate"
													>{member.email}{member.role === 'owner' ? ' (owner)' : ''}</span
												>
												{#if coll.role === 'owner' && member.role !== 'owner'}
													<button
														onclick={() => {
															removingMember = { collectionId: coll.id, userId: member.userId };
															removalError = '';
														}}
														class="shrink-0 text-red-500 hover:underline"
													>
														Remove
													</button>
												{/if}
											</li>
										{/each}
									</ul>
								{/if}
								{#if removingMember?.collectionId === coll.id}
									<div class="bg-red-50 dark:bg-red-900/20 rounded p-2 space-y-1">
										<p>Remove member and rotate key?</p>
										<div class="flex gap-1">
											<button
												onclick={doRemoveMember}
												class="px-2 py-1 rounded text-white text-xs bg-red-600 hover:bg-red-700"
											>
												Confirm
											</button>
											<button
												onclick={() => (removingMember = null)}
												class="px-2 py-1 rounded text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700"
											>
												Cancel
											</button>
										</div>
										{#if removalError}
											<p class="text-red-600 dark:text-red-400">{removalError}</p>
										{/if}
									</div>
								{/if}
							</div>
						{/if}
					{/each}
				</div>
			{/if}
		</section>
	{:else}
		<p class="text-sm text-gray-500 dark:text-gray-400">
			<a href={resolve('/settings')} class="text-orange-500 hover:underline">Turn on sync</a> to share
			a list with other people and watch together.
		</p>
	{/if}
</div>
