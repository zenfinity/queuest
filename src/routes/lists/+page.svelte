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
	import { SvelteSet } from 'svelte/reactivity';
	import { hasActiveTag, type WatchlistItem } from '$lib/types';
	import { resolve } from '$app/paths';
	import { onMount } from 'svelte';
	import { getAll, renameCollectionTag, clearCollectionTag } from '$lib/db';
	import { isSyncEnabled } from '$lib/sync';
	import {
		listCollections as listSharedCollections,
		promoteCollection,
		createInvite,
		listInvites,
		revokeInvite,
		removeMemberAndRotate,
		renameSharedCollection,
		setSharedCollectionColor,
		listMembers,
		loadCollectionItems,
		type SharedCollection,
		type CollectionMember,
		type OutstandingInvite
	} from '$lib/collection-actions';
	import { getLastViewed, countNewActivity } from '$lib/collection-activity';
	import { createShareLink } from '$lib/share-create-actions';
	import {
		getQueueColors,
		setQueueColor,
		renameCollectionColor,
		deleteCollectionColor,
		sharedListColor
	} from '$lib/queue-colors';
	import {
		listCollections,
		sortByRank,
		sortByField,
		filterByService,
		reorderCollectionItems,
		toggleWatched,
		removeQueueItem,
		toggleSeasonProgress,
		type QueueActionDeps
	} from '$lib/queue-actions';
	import { DEFAULT_BUDGET_HOURS, releaseChip } from '$lib/progress';
	import { readNumber } from '$lib/storage';
	import { services, ensureSubscribedLoaded } from '$lib/services.svelte';
	import { queueControls, SORT_DEFAULT_DIR } from '$lib/queue-controls.svelte';
	import type { SortKey, ViewKey } from '$lib/queue-controls.svelte';
	import SharedListSection from '$lib/components/SharedListSection.svelte';
	import DetailPanel from '$lib/components/DetailPanel.svelte';
	import ListHint from '$lib/components/ListHint.svelte';
	import ShareHint from '$lib/components/ShareHint.svelte';
	import Button from '$lib/components/Button.svelte';
	import QueueGridView from '$lib/components/QueueGridView.svelte';
	import QueueListView from '$lib/components/QueueListView.svelte';

	// Mirrors app/+page.svelte's own helper — sortBy/sortDir/viewMode are
	// shared, persisted preferences (#273), so whichever of /app or /lists is
	// mounted needs to both hydrate and keep writing them.
	function loadPref<T extends string>(key: string, fallback: T): T {
		try {
			return (localStorage.getItem(key) as T) ?? fallback;
		} catch {
			return fallback;
		}
	}

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
	let outstandingInvites: OutstandingInvite[] = $state([]);
	let loadingInvites = $state(false);
	let revokingInviteId: string | null = $state(null);
	let revokeError = $state('');
	let newActivityCounts: Record<string, number> = $state({});
	let renamingSharedId: string | null = $state(null);
	let sharedRenameInput = $state('');
	let sharedRenameBusy = $state(false);
	let sharedRenameError = $state('');
	// Deliberately its own map, not queueColors — that one is keyed by
	// personal list *name* and doubles as the "which names exist" source for
	// the Lists section (see listCollections's extraNames below). Reusing it
	// keyed by shared-list *id* briefly leaked shared list ids in as phantom
	// empty personal lists the first time this shipped.
	let sharedListColors = $state<Record<string, string>>({});

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
		const updated: Record<string, string> = {};
		for (const coll of sharedCollections) updated[coll.id] = sharedListColor(coll);
		sharedListColors = updated;
	}

	// Owner-only (#237) — server-enforced too, so this is UX, not the real
	// gate. The color is now the same for every member/device, so letting
	// any member repaint it would be the same odd asymmetry rename already
	// avoids by being owner-only.
	async function updateSharedListColor(coll: SharedCollection, color: string) {
		const result = await setSharedCollectionColor(coll, color, {
			setBusy: () => {},
			setError: () => {}
		});
		if (!result) return;
		sharedCollections = sharedCollections.map((c) => (c.id === result.id ? result : c));
		sharedListColors = { ...sharedListColors, [result.id]: color };
	}

	async function loadActivityCount(coll: SharedCollection) {
		const watermark = await getLastViewed(coll.id);
		if (!watermark) return;
		const { items } = await loadCollectionItems(coll, { setBusy: () => {}, setError: () => {} });
		newActivityCounts = { ...newActivityCounts, [coll.id]: countNewActivity(items, watermark) };
	}

	// Promotion is the only way a shared list is born (#145) — there is no
	// create-from-scratch form, so there's exactly one on-ramp rather than two
	// unrelated things both called "Lists".
	async function doPromoteCollection(name: string) {
		promoting = true;
		promoteError = '';
		try {
			// Carried over to the shared side so promoting doesn't hand the list
			// a random new color it never had before.
			const oldColor = queueColors[name];
			const created = await promoteCollection(name, items, {
				setBusy: () => {},
				setError: (e) => (promoteError = e)
			});
			if (created) {
				sharedCollections = [...sharedCollections, created];
				promoteArmed = null;
				// Best-effort: a failure here shouldn't read as the promotion
				// itself having failed — the list already exists at this point,
				// just without its carried-over color.
				if (oldColor) await updateSharedListColor(created, oldColor);
				// The personal list's own color entry is left alone — promotion
				// is additive (#274), so "{name}" still exists as a real personal
				// list with its item(s) in it, showing under both sections here
				// is the correct, intended state, not a leftover to clean up.
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
			await loadOutstandingInvites();
		}
	}

	async function loadOutstandingInvites() {
		if (!openCollection) return;
		loadingInvites = true;
		outstandingInvites = await listInvites(openCollection.id, {
			setBusy: () => {},
			setError: () => {}
		});
		loadingInvites = false;
	}

	async function doRevokeInvite(invite: OutstandingInvite) {
		if (revokingInviteId !== invite.id) {
			revokingInviteId = invite.id;
			revokeError = '';
			return;
		}
		const ok = await revokeInvite(openCollection!.id, invite.id, {
			setBusy: () => {},
			setError: (e) => (revokeError = e)
		});
		if (ok) {
			outstandingInvites = outstandingInvites.filter((i) => i.id !== invite.id);
			revokingInviteId = null;
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

	function startSharedRename(coll: SharedCollection) {
		renamingSharedId = coll.id;
		sharedRenameInput = coll.name;
		sharedRenameError = '';
	}

	async function saveSharedRename(coll: SharedCollection) {
		const name = sharedRenameInput.trim();
		if (!name || name === coll.name) {
			renamingSharedId = null;
			return;
		}
		sharedRenameBusy = true;
		const result = await renameSharedCollection(coll, name, {
			setBusy: () => {},
			setError: (e) => (sharedRenameError = e)
		});
		sharedRenameBusy = false;
		if (result) {
			sharedCollections = sharedCollections.map((c) => (c.id === coll.id ? result : c));
			renamingSharedId = null;
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

	// ── Per-list rank / titles (#274 PR2, restyled #273) ─────────────────────
	// Each list — personal or shared — is its own accordion: a card bordered
	// in the list's identity color, with titles revealed on expand. Matches
	// how shared lists always looked (SharedListSection's own non-inline
	// mode, unchanged) below the queue before #273 moved them here. Personal
	// lists render via QueueGridView/QueueListView, the same components /app
	// uses, keyed by viewMode like everything else on this page — items are
	// already true WatchlistItem[] here, so unlike SharedListSection (whose
	// CollectionItems need their own identity scheme) these drop in directly.
	// Multiple lists can be expanded at once, same as shared lists always
	// allowed (each SharedListSection/QueueGridView/QueueListView instance
	// owns its own expanded state) — no single "one list at a time" restriction.
	let expandedCollections = new SvelteSet<string>();
	let listItemBusy = new SvelteSet<number>();
	let reorderError = $state('');
	let budgetHours = $state(DEFAULT_BUDGET_HOURS);
	let detailItem = $state<WatchlistItem | null>(null);
	let releasePopupId: number | null = $state(null);

	const listActionDeps: QueueActionDeps = {
		setItems: (next) => {
			items = next;
		},
		setBusy: (id, isBusy) => {
			if (isBusy) listItemBusy.add(id);
			else listItemBusy.delete(id);
		},
		setError: (message) => {
			reorderError = message;
		}
	};

	// Collapsing clears any armed destructive/edit state targeting this list
	// (#273 follow-up) — those controls only live in the now-expanded-only
	// footer, so leaving one armed behind a collapse would sit one click from
	// firing with none of the context of having just clicked it.
	function toggleExpanded(name: string) {
		if (expandedCollections.has(name)) {
			expandedCollections.delete(name);
			if (deleteArmed === name) deleteArmed = null;
			if (promoteArmed === name) promoteArmed = null;
			if (readOnlyLinkFor === name) readOnlyLinkFor = null;
			if (renamingCollection === name) {
				renamingCollection = null;
				renameInput = '';
			}
		} else {
			expandedCollections.add(name);
		}
	}

	async function toggle(item: WatchlistItem) {
		await toggleWatched(item, listActionDeps);
	}
	async function remove(item: WatchlistItem) {
		await removeQueueItem(item, listActionDeps);
	}
	async function toggleSeason(item: WatchlistItem, seasonNum: number) {
		await toggleSeasonProgress(item, seasonNum, listActionDeps);
	}

	// ── Read-only link ───────────────────────────────────────────────────────
	// The account-free counterpart to Share/promote: a disposable, one-way
	// snapshot link — no sign-in for the creator or the recipient, nothing to
	// keep in sync.
	let readOnlyLinkFor = $state<string | null>(null);
	let readOnlyLinkCreating = $state(false);
	let readOnlyLinkUrl = $state('');
	let readOnlyLinkCopied = $state(false);
	let readOnlyLinkError = $state('');
	let readOnlyLinkQr = $state('');
	let showReadOnlyLinkQr = $state(false);

	async function createReadOnlyLink(name: string) {
		readOnlyLinkFor = name;
		readOnlyLinkUrl = '';
		readOnlyLinkCopied = false;
		readOnlyLinkError = '';
		readOnlyLinkQr = '';
		showReadOnlyLinkQr = false;
		const tagged = items.filter((i) => hasActiveTag(i, name));
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

	// Same on-demand generation as the invite QR above — most people just copy
	// the link, so the encoder only loads for the ones who ask for a code.
	async function toggleReadOnlyLinkQr() {
		showReadOnlyLinkQr = !showReadOnlyLinkQr;
		if (showReadOnlyLinkQr && !readOnlyLinkQr && readOnlyLinkUrl) {
			const { toQrSvg } = await import('$lib/qrcode');
			readOnlyLinkQr = await toQrSvg(readOnlyLinkUrl);
		}
	}

	// ── Whole-queue read-only link ───────────────────────────────────────────
	// Same mechanism as the per-list read-only link, just unscoped — sharing
	// requiring a list first was real friction for the most natural first
	// share ("check out my queue") for anyone who hasn't organized into lists
	// yet. Deliberately no filter UI (status/type/provider) like the old
	// standalone /share page had — one unfiltered snapshot of everything is a
	// much smaller surface than that page was, which is the point.
	let showWholeQueueLink = $state(false);
	let wholeQueueLinkCreating = $state(false);
	let wholeQueueLinkUrl = $state('');
	let wholeQueueLinkCopied = $state(false);
	let wholeQueueLinkError = $state('');
	let wholeQueueLinkQr = $state('');
	let showWholeQueueLinkQr = $state(false);

	async function createWholeQueueLink() {
		showWholeQueueLink = true;
		wholeQueueLinkUrl = '';
		wholeQueueLinkCopied = false;
		wholeQueueLinkError = '';
		wholeQueueLinkQr = '';
		showWholeQueueLinkQr = false;
		// Empty selectedQueueNames means activeQueues.length is never 1 inside
		// createShareLink, so it falls back to the account's own queue name
		// (Settings → Export) rather than picking one list's name arbitrarily.
		await createShareLink(items, new Set(), [], {
			setShareCreating: (v) => (wholeQueueLinkCreating = v),
			setShareUrl: (v) => (wholeQueueLinkUrl = v),
			setShareError: (v) => (wholeQueueLinkError = v)
		});
	}

	async function copyWholeQueueLink() {
		if (!wholeQueueLinkUrl) return;
		await navigator.clipboard.writeText(wholeQueueLinkUrl);
		wholeQueueLinkCopied = true;
		setTimeout(() => (wholeQueueLinkCopied = false), 2000);
	}

	async function toggleWholeQueueLinkQr() {
		showWholeQueueLinkQr = !showWholeQueueLinkQr;
		if (showWholeQueueLinkQr && !wholeQueueLinkQr && wholeQueueLinkUrl) {
			const { toQrSvg } = await import('$lib/qrcode');
			wholeQueueLinkQr = await toQrSvg(wholeQueueLinkUrl);
		}
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
			// Re-fetch rather than hand-mutating `items` in place — renaming a
			// tag a row already independently also carries under `newName`
			// leaves that row's `newName` entry untouched (see
			// renameCollectionTag's own comment), so assuming every matching
			// item's rendered tag changed the same way could show the UI a
			// state the DB doesn't actually have.
			items = await getAll();
			renameCollectionColor(oldName, newName);
			queueColors = getQueueColors();
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
			// comment in renameCollection for why this isn't getAll()+replaceAll(), and for
			// why this re-fetches rather than hand-mutating `items`.
			await clearCollectionTag(name);
			items = await getAll();
			deleteCollectionColor(name);
			queueColors = getQueueColors();
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
			counts[collection] = items.filter((i) => hasActiveTag(i, collection)).length;
		}
		collectionCounts = counts;
	}

	onMount(() => {
		budgetHours = readNumber('sq:budget', DEFAULT_BUDGET_HOURS);
		// sortBy/sortDir/viewMode are shared with /app (#273) — hydrate here too
		// so landing on /lists first (without ever visiting /app this session)
		// still picks up the saved preference rather than resetting to defaults.
		queueControls.sortBy = loadPref<SortKey>('sq:sort', 'added');
		queueControls.sortDir = loadPref<'asc' | 'desc'>(
			'sq:sortDir',
			SORT_DEFAULT_DIR[queueControls.sortBy]
		);
		queueControls.viewMode = loadPref<ViewKey>('sq:view', 'grid');
		queueControls.ready = true;

		(async () => {
			queueColors = getQueueColors();
			syncEnabled = await isSyncEnabled();
			if (syncEnabled) await loadSharedCollections();
		})();

		(async () => {
			items = await getAll();
			collections = listCollections(items, Object.keys(queueColors));
			updateCounts();
		})();

		ensureSubscribedLoaded();

		return () => {
			queueControls.ready = false;
			queueControls.hasItems = false;
		};
	});

	// Persists sortBy/sortDir/viewMode changes made via the dock while this
	// page is mounted — mirrors app/+page.svelte's identical effect, needed
	// here too since only whichever page is currently mounted is listening
	// for these changes (#273).
	$effect(() => {
		try {
			localStorage.setItem('sq:sort', queueControls.sortBy);
			localStorage.setItem('sq:sortDir', queueControls.sortDir);
			localStorage.setItem('sq:view', queueControls.viewMode);
		} catch {
			// Best-effort localStorage write; app works fine without persisted preferences
		}
	});

	// Lets the nav know whether the dock has anything to show — reactive
	// (not a one-time onMount snapshot) since promoting/removing a shared
	// list changes this after mount, same reasoning as /app's own effect.
	$effect(() => {
		queueControls.hasItems = items.length > 0 || sharedCollections.length > 0;
	});

	// Timeline view has no meaning here (#273) — coerce away from it rather
	// than rendering nothing, same as the dock hiding the Timeline button.
	$effect(() => {
		if (queueControls.viewMode === 'lanes') queueControls.viewMode = 'grid';
	});
</script>

<svelte:head><title>Queuest — Lists</title></svelte:head>

<svelte:document
	onclick={(e) => {
		const t = e.target as Element;
		if (!t.closest('[data-release-popup]')) {
			releasePopupId = null;
		}
	}}
/>

{#snippet seasonPicker(item: WatchlistItem)}
	{@const chip = releaseChip(item.release)}
	{#if item.media_type === 'tv' && (item.seasons?.length || chip)}
		<div class="flex flex-wrap gap-0.5 pt-0.5">
			{#each (item.seasons ?? []).filter((s) => s.episode_count > 0 && (!chip || item.release?.next_season == null || s.season_number < item.release.next_season)) as season (season.season_number)}
				{@const watched = (item.watched_seasons ?? []).includes(season.season_number)}
				<button
					class="inline-flex items-center rounded px-1.5 py-0.5 text-[9px] font-semibold leading-none transition-colors
						{watched
						? 'bg-teal-100 text-teal-700 dark:bg-teal-900/60 dark:text-teal-400'
						: 'bg-gray-100 text-gray-500 hover:text-gray-700 dark:bg-gray-800 dark:text-gray-500 dark:hover:text-gray-300'}"
					onclick={(e) => {
						e.stopPropagation();
						toggleSeason(item, season.season_number);
					}}
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
					onclick={(e) => {
						e.stopPropagation();
						releasePopupId = isOpen ? null : item.id;
					}}
					data-release-popup
				>
					{item.release?.next_season != null ? `S${item.release.next_season}` : 'Next'}
					{#if isOpen}
						<div
							class="absolute top-full left-0 z-20 mt-1 w-max max-w-[14rem] rounded-lg bg-white px-2.5 py-1.5 text-[10px] leading-snug text-gray-700 shadow-lg ring-1 ring-gray-200 dark:bg-gray-900 dark:text-gray-300 dark:ring-gray-700"
						>
							{chip}
						</div>
					{/if}
				</button>
			{/if}
		</div>
	{/if}
{/snippet}

<h1 class="sr-only">Lists</h1>

<div class="mx-auto max-w-md space-y-6 xs:space-y-10">
	<!-- Lists -->
	<section class="space-y-3">
		<h2 class="section-heading">Lists</h2>
		<p class="body-text">
			Organize your queue into lists, then assign items to them from the detail panel. Accepting a
			read-only link automatically creates one.
		</p>
		<ShareHint show={syncEnabled} />
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
			<Button type="submit" disabled={!newCollectionInput.trim()} class="px-3 py-1.5 text-sm">
				Create
			</Button>
		</form>
		{#if collections.length === 0}
			<p class="text-sm text-gray-400 dark:text-gray-600">No lists yet.</p>
			<ListHint show={items.length >= 5} />
		{:else}
			<div class="space-y-2">
				{#each collections as collection (collection)}
					{@const color = queueColors[collection] ?? '#888888'}
					{@const count = collectionCounts[collection] ?? 0}
					{@const isRenaming = renamingCollection === collection}
					{@const isDeleting = deleteArmed === collection}
					{@const isPromoting = promoteArmed === collection}
					{@const isReadOnlyLink = readOnlyLinkFor === collection}
					{@const isExpanded = expandedCollections.has(collection)}
					<!-- One bordered card per list (#273 follow-up) — border-color is
					     the list's own identity color. Header (name/count/chevron, or
					     the rename input in its place) is always visible; titles and
					     management actions reveal on expand instead of sitting pinned
					     above a separate accordion box. -->
					<div class="rounded-xl border-2" style="border-color: {color}">
						<div class="flex items-center gap-2.5 px-3 py-2.5">
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
									class="min-w-0 flex-1 rounded px-1 py-0.5 text-sm bg-white border border-gray-300 dark:bg-gray-900 dark:border-gray-600 dark:text-white focus:outline-none focus:ring-1 focus:ring-orange-500"
								/>
								<button
									disabled={manageBusy}
									onclick={() => renameCollection(collection, renameInput)}
									class="shrink-0 text-xs px-2 py-1 rounded text-orange-500 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50"
								>
									Save
								</button>
								<button
									disabled={manageBusy}
									onclick={() => {
										renamingCollection = null;
										renameInput = '';
									}}
									class="shrink-0 text-xs px-2 py-1 rounded text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50"
								>
									Cancel
								</button>
							{:else}
								<button
									onclick={() => toggleExpanded(collection)}
									class="flex flex-1 min-w-0 items-center gap-2 text-left"
									aria-expanded={isExpanded}
									aria-label="Toggle {collection}"
								>
									<span
										class="min-w-0 flex-1 truncate text-sm font-medium text-gray-800 dark:text-gray-200"
									>
										{collection}
									</span>
									<span class="shrink-0 text-xs text-gray-400 dark:text-gray-500">
										{count} title{count === 1 ? '' : 's'}
									</span>
									<span
										class="shrink-0 text-gray-400 transition-transform dark:text-gray-500 {isExpanded
											? 'rotate-90'
											: ''}">▸</span
									>
								</button>
							{/if}
						</div>

						{#if isExpanded}
							{@const filtered = filterByService(
								(queueControls.watchedOn ? items : items.filter((i) => !i.watched_at)).filter((i) =>
									hasActiveTag(i, collection)
								),
								queueControls.serviceFilter,
								services.ids
							)}
							{@const sortedItems =
								queueControls.sortBy === 'rank'
									? sortByRank(filtered, collection, queueControls.sortDir)
									: sortByField(filtered, queueControls.sortBy, queueControls.sortDir)}
							<div class="border-t border-gray-100 p-3 dark:border-gray-800/60">
								{#if sortedItems.length === 0}
									<p class="text-xs text-gray-400 dark:text-gray-600">
										{count === 0 ? 'Nothing here yet.' : 'Nothing matches these filters.'}
									</p>
								{:else if queueControls.viewMode === 'list'}
									<QueueListView
										items={sortedItems}
										{budgetHours}
										busy={listItemBusy}
										rankMode={queueControls.sortBy === 'rank'}
										onToggle={toggle}
										onRemove={remove}
										onOpenDetail={(item) => (detailItem = item)}
										onReorder={(newOrder) =>
											reorderCollectionItems(newOrder, collection, listActionDeps)}
										{seasonPicker}
									/>
								{:else}
									<!-- 'grid' is the fallback branch, not 'lanes' coerced into looking
									     like grid: this page's own effect already coerces viewMode away
									     from 'lanes' on mount, so a third branch here would be dead code. -->
									<QueueGridView
										items={sortedItems}
										{budgetHours}
										busy={listItemBusy}
										rankMode={queueControls.sortBy === 'rank'}
										onToggle={toggle}
										onRemove={remove}
										onOpenDetail={(item) => (detailItem = item)}
										onReorder={(newOrder) =>
											reorderCollectionItems(newOrder, collection, listActionDeps)}
										{seasonPicker}
									/>
								{/if}
								{#if reorderError}
									<p class="mt-1.5 text-red-600 dark:text-red-400">{reorderError}</p>
								{/if}
							</div>

							<div
								class="border-t border-gray-100 px-3 py-2 dark:border-gray-800/60 flex flex-wrap items-center gap-1"
							>
								{#if isDeleting}
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
									<label class="relative shrink-0 cursor-pointer" title="Change color">
										<span
											class="block h-4 w-4 rounded-full border border-gray-300 shadow-sm dark:border-gray-600"
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

							{#if isPromoting}
								<div
									class="border-t border-orange-200 bg-orange-50 px-3 py-2.5 text-xs dark:border-orange-900/40 dark:bg-orange-950/30"
								>
									<p class="font-medium text-gray-900 dark:text-gray-100">
										Share “{collection}” with other people?
									</p>
									<p class="mt-1 text-gray-700 dark:text-gray-300">
										Its {collectionCounts[collection] ?? 0} title{(collectionCounts[collection] ??
											0) === 1
											? ''
											: 's'} also join a new shared list — they stay in “{collection}” here too. The
										shared copy lives online, reachable only through this account —
										<span class="font-medium"
											>if you lose both your passphrase and your recovery code, that copy is gone
											for good.</span
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
								<div class="border-t border-gray-100 px-3 py-2.5 text-xs dark:border-gray-800/60">
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
											<button
												onclick={toggleReadOnlyLinkQr}
												class="px-2 py-1 rounded text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700"
											>
												{showReadOnlyLinkQr ? 'Hide QR' : 'QR code'}
											</button>
										</div>
										{#if showReadOnlyLinkQr}
											<div class="mt-2 flex justify-center rounded bg-white p-2">
												{#if readOnlyLinkQr}
													<!-- eslint-disable-next-line svelte/no-at-html-tags -->
													{@html readOnlyLinkQr}
												{:else}
													<p class="py-8 text-gray-500">Generating…</p>
												{/if}
											</div>
										{/if}
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
						{/if}
					</div>
				{/each}
			</div>
		{/if}

		<button
			onclick={createWholeQueueLink}
			disabled={items.length === 0 || wholeQueueLinkCreating}
			class="mt-1 w-full rounded-lg border border-dashed border-gray-300 px-3 py-2.5 text-left text-xs text-gray-500 hover:border-gray-400 hover:text-gray-700 disabled:opacity-50 dark:border-gray-700 dark:text-gray-400 dark:hover:border-gray-600 dark:hover:text-gray-300"
		>
			Or share your whole queue as a read-only link
		</button>
		{#if showWholeQueueLink}
			<div
				class="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 text-xs dark:border-gray-700 dark:bg-gray-800/60"
			>
				<p class="text-gray-700 dark:text-gray-300">
					Anyone with this link can view your whole queue — no account needed. It's a snapshot:
					their view won't update when you change your queue, and the link stops working after 30
					days.
				</p>
				{#if wholeQueueLinkCreating}
					<p class="mt-1.5 text-gray-500 dark:text-gray-400">Creating link…</p>
				{:else if wholeQueueLinkUrl}
					<div class="mt-2 flex gap-1">
						<input
							type="text"
							readonly
							value={wholeQueueLinkUrl}
							class="flex-1 rounded px-2 py-1 bg-white border border-gray-300 text-gray-900 dark:bg-gray-900 dark:border-gray-600 dark:text-white"
						/>
						<button
							onclick={copyWholeQueueLink}
							class="px-2 py-1 rounded text-orange-600 hover:bg-orange-50 dark:text-orange-400 dark:hover:bg-orange-900/20"
						>
							{wholeQueueLinkCopied ? '✓' : 'Copy'}
						</button>
						<button
							onclick={toggleWholeQueueLinkQr}
							class="px-2 py-1 rounded text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700"
						>
							{showWholeQueueLinkQr ? 'Hide QR' : 'QR code'}
						</button>
					</div>
					{#if showWholeQueueLinkQr}
						<div class="mt-2 flex justify-center rounded bg-white p-2">
							{#if wholeQueueLinkQr}
								<!-- eslint-disable-next-line svelte/no-at-html-tags -->
								{@html wholeQueueLinkQr}
							{:else}
								<p class="py-8 text-gray-500">Generating…</p>
							{/if}
						</div>
					{/if}
				{/if}
				{#if wholeQueueLinkError}
					<p class="mt-1.5 text-red-600 dark:text-red-400">{wholeQueueLinkError}</p>
				{/if}
				<button
					onclick={() => (showWholeQueueLink = false)}
					class="mt-2 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
				>
					Close
				</button>
			</div>
		{/if}
	</section>

	<div class="divider"></div>

	<!-- Shared Lists -->
	{#if syncEnabled}
		<section class="space-y-3">
			<h2 class="section-heading">Shared Lists</h2>
			<p class="body-text">
				Lists you're watching through with other people. To start one, use
				<span class="font-medium">Share</span> on a list above.
			</p>

			{#if sharedCollections.length === 0}
				<p class="text-sm text-gray-400 dark:text-gray-600">No shared lists yet.</p>
			{:else}
				<div class="space-y-2">
					{#each sharedCollections as coll (coll.id)}
						{@const isRenamingShared = renamingSharedId === coll.id}
						<SharedListSection
							collection={coll}
							color={sharedListColors[coll.id] ?? '#9ca3af'}
							{budgetHours}
							isRenaming={isRenamingShared}
							newCount={newActivityCounts[coll.id]}
						>
							{#snippet nameSlot()}
								<!-- svelte-ignore a11y_autofocus -->
								<input
									type="text"
									aria-label="New list name"
									maxlength="100"
									value={sharedRenameInput}
									oninput={(e) => (sharedRenameInput = e.currentTarget.value)}
									onkeydown={(e) => {
										if (e.key === 'Enter') saveSharedRename(coll);
										if (e.key === 'Escape') renamingSharedId = null;
									}}
									autofocus
									class="min-w-0 flex-1 rounded px-1 py-0.5 text-sm bg-white border border-gray-300 dark:bg-gray-900 dark:border-gray-600 dark:text-white focus:outline-none focus:ring-1 focus:ring-orange-500"
								/>
								<button
									disabled={sharedRenameBusy}
									onclick={() => saveSharedRename(coll)}
									class="shrink-0 text-xs px-2 py-1 rounded text-orange-500 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50"
								>
									Save
								</button>
								<button
									disabled={sharedRenameBusy}
									onclick={() => (renamingSharedId = null)}
									class="shrink-0 text-xs px-2 py-1 rounded text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50"
								>
									Cancel
								</button>
							{/snippet}
							{#snippet footerActions()}
								{#if coll.role === 'owner'}
									<label class="relative shrink-0 cursor-pointer" title="Change color">
										<span
											class="block h-4 w-4 rounded-full border border-gray-300 shadow-sm dark:border-gray-600"
											style="background:{sharedListColors[coll.id] ?? '#888888'};"
										></span>
										<input
											type="color"
											aria-label="List color"
											value={sharedListColors[coll.id] ?? '#888888'}
											oninput={(e) =>
												updateSharedListColor(coll, (e.currentTarget as HTMLInputElement).value)}
											class="absolute inset-0 h-full w-full cursor-pointer opacity-0"
										/>
									</label>
								{:else}
									<span
										class="block h-4 w-4 shrink-0 rounded-full border border-gray-300 shadow-sm dark:border-gray-600"
										style="background:{sharedListColors[coll.id] ?? '#888888'};"
										title="List color — only the owner can change this"
									></span>
								{/if}
								<span class="shrink-0 text-xs text-gray-500 dark:text-gray-400">
									{coll.role === 'owner' ? 'You own this' : 'Member'}
								</span>
								<a
									href={resolve('/lists/[id]', { id: coll.id })}
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
									<button
										onclick={() => startSharedRename(coll)}
										class="text-xs px-2 py-1 rounded text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700"
									>
										Rename
									</button>
								{/if}
								<button
									onclick={() => {
										if (openCollection?.id === coll.id) {
											openCollection = null;
										} else {
											openCollection = coll;
											openMembers = [];
											outstandingInvites = [];
											revokingInviteId = null;
											revokeError = '';
											loadOpenMembers();
											loadOutstandingInvites();
										}
									}}
									class="text-xs px-2 py-1 rounded text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700"
								>
									{openCollection?.id === coll.id ? 'Hide' : 'Info'}
								</button>
								{#if sharedRenameError && isRenamingShared}
									<p class="w-full text-xs text-red-600 dark:text-red-400">{sharedRenameError}</p>
								{/if}
								{#if openCollection?.id === coll.id}
									<div
										class="w-full mt-1 rounded-lg border border-gray-100 p-2 space-y-2 text-xs text-gray-600 dark:border-gray-800/60 dark:text-gray-400"
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
										{#if coll.role === 'owner'}
											{#if loadingInvites}
												<p>Loading invites…</p>
											{:else if outstandingInvites.length > 0}
												<div>
													<p class="font-medium text-gray-500 dark:text-gray-400">
														Pending invites
													</p>
													<ul class="mt-1 space-y-1">
														{#each outstandingInvites as invite (invite.id)}
															<li class="flex items-center justify-between gap-2">
																<span class="truncate">
																	Sent {new Date(invite.createdAt).toLocaleDateString()}, expires {new Date(
																		invite.expiresAt
																	).toLocaleDateString()}
																</span>
																{#if revokingInviteId === invite.id}
																	<span class="shrink-0 flex items-center gap-1">
																		<button
																			onclick={() => doRevokeInvite(invite)}
																			class="text-red-500 hover:underline"
																		>
																			Confirm
																		</button>
																		<button
																			onclick={() => (revokingInviteId = null)}
																			class="text-gray-500 hover:underline"
																		>
																			Cancel
																		</button>
																	</span>
																{:else}
																	<button
																		onclick={() => doRevokeInvite(invite)}
																		class="shrink-0 text-red-500 hover:underline"
																	>
																		Revoke
																	</button>
																{/if}
															</li>
														{/each}
													</ul>
													{#if revokeError}
														<p class="mt-1 text-red-600 dark:text-red-400">{revokeError}</p>
													{/if}
												</div>
											{/if}
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
							{/snippet}
						</SharedListSection>
					{/each}
				</div>
			{/if}
		</section>
	{:else}
		<p class="text-sm text-gray-500 dark:text-gray-400">
			<a href={resolve('/settings')} class="text-orange-500 hover:underline">Turn on sync</a> to share
			a list with other people and let them collab with you on it.
		</p>
	{/if}
</div>

<!-- ── Detail panel (#273) ────────────────────────────────────────────────
     Minimal — no onAddTag/onRemoveTag/onClearTags/sharedCollections/
     onAssignShared, so DetailPanel's List section (gated on onAddTag)
     doesn't render here; assignment stays on the Queue page. showSeasons
     is wired through toggleSeasonProgress since personal items can be TV
     shows with real progress to track, unlike search results. -->
{#if detailItem}
	{@const di = detailItem}
	<DetailPanel
		item={di}
		{budgetHours}
		showSeasons={true}
		onToggleSeason={(seasonNum) => toggleSeason(di, seasonNum)}
		onClose={() => (detailItem = null)}
	>
		{#snippet footer(item)}
			<button
				class="flex-1 rounded-lg py-2 text-sm font-medium transition-colors
					{item.watched_at
					? 'bg-teal-100 text-teal-700 hover:bg-teal-200 dark:bg-teal-900/40 dark:text-teal-400 dark:hover:bg-teal-900/60'
					: 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'}"
				disabled={listItemBusy.has(item.id)}
				onclick={async () => {
					await toggle(di);
					detailItem = items.find((i) => i.id === item.id) ?? null;
				}}>{item.watched_at ? '↩ Unwatch' : '✓ Watched'}</button
			>
			<button
				class="rounded-lg bg-gray-100 px-4 py-2 text-sm text-gray-500 transition-colors hover:bg-red-100 hover:text-red-600 disabled:opacity-40 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-red-900/50 dark:hover:text-red-400"
				disabled={listItemBusy.has(item.id)}
				onclick={async () => {
					await remove(di);
					detailItem = null;
				}}>✕ Remove</button
			>
		{/snippet}
	</DetailPanel>
{/if}
