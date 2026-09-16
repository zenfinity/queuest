<script lang="ts">
	import { trapFocus } from '$lib/focus-trap';

	// A focused list-membership picker, distinct from DetailPanel's full
	// view — reachable from the drag-drop action bar's "Add to list" tile
	// (which has no stable element left to anchor a popover to once the
	// drag ends) and from a "Choose lists →" button inside DetailPanel
	// itself. Centered modal, not an edge-anchored sheet, matching the
	// app's other centered dialog (the Feedback modal in
	// src/routes/settings/+page.svelte) rather than DetailPanel's own
	// bottom-sheet/right-drawer pattern — this is a quick, self-contained
	// pick, not a "view everything about this item" surface.
	let {
		item,
		existingCollections,
		queueColors,
		onAddTag,
		onRemoveTag,
		onClearTags,
		sharedCollections,
		activeSharedCollectionIds,
		sharedListColors,
		onAssignShared,
		onClose
	}: {
		item: { id: number; title: string; activeQueueTags?: string[] };
		existingCollections: string[];
		queueColors: Record<string, string>;
		onAddTag: (tag: string) => Promise<void>;
		onRemoveTag: (tag: string) => Promise<void>;
		onClearTags: () => Promise<void>;
		sharedCollections: { id: string; name: string }[];
		activeSharedCollectionIds: string[];
		sharedListColors: Record<string, string>;
		onAssignShared: (collectionId: string) => Promise<void>;
		onClose: () => void;
	} = $props();

	let collectionBusy = $state(false);
	let active = $derived(item.activeQueueTags ?? []);
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="fixed inset-0 z-[65] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
	onclick={onClose}
>
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<div
		class="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl dark:bg-gray-900"
		onclick={(e) => e.stopPropagation()}
		role="dialog"
		aria-modal="true"
		aria-labelledby="choose-list-title"
		tabindex="-1"
		use:trapFocus={{ onEscape: onClose }}
	>
		<div class="mb-3 flex items-start justify-between gap-2">
			<h2
				id="choose-list-title"
				class="min-w-0 truncate text-base font-semibold text-gray-900 dark:text-white"
			>
				Choose lists for "{item.title}"
			</h2>
			<button
				type="button"
				onclick={onClose}
				aria-label="Close"
				class="shrink-0 text-gray-400 transition-colors hover:text-gray-600 dark:hover:text-gray-200"
			>
				<svg
					class="h-5 w-5"
					fill="none"
					stroke="currentColor"
					viewBox="0 0 24 24"
					aria-hidden="true"
				>
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="2"
						d="M6 18L18 6M6 6l12 12"
					/>
				</svg>
			</button>
		</div>

		<div class="flex items-center justify-between gap-2">
			<span class="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400"
				>List</span
			>
			{#if active.length > 0}
				<button
					type="button"
					disabled={collectionBusy}
					onclick={async () => {
						collectionBusy = true;
						try {
							await onClearTags();
						} finally {
							collectionBusy = false;
						}
					}}
					class="text-[10px] font-medium text-gray-500 hover:text-gray-700 disabled:opacity-50 dark:text-gray-400 dark:hover:text-gray-200"
				>
					Clear all
				</button>
			{/if}
		</div>
		{#if existingCollections.length > 0}
			<div class="mt-1.5 flex flex-wrap gap-1">
				{#each existingCollections as name (name)}
					{@const isActive = active.includes(name)}
					{@const color = queueColors[name] ?? '#f97316'}
					<button
						type="button"
						disabled={collectionBusy}
						aria-pressed={isActive}
						onclick={async () => {
							collectionBusy = true;
							try {
								if (isActive) await onRemoveTag(name);
								else await onAddTag(name);
							} finally {
								collectionBusy = false;
							}
						}}
						class="rounded-full border px-2 py-0.5 text-[10px] font-medium transition-colors disabled:opacity-50 {isActive
							? 'text-white'
							: 'hover:bg-gray-50 dark:hover:bg-gray-800'}"
						style={isActive
							? `background:${color}; border-color:${color};`
							: `border-color:${color}; color:${color};`}
					>
						{name}
					</button>
				{/each}
			</div>
		{:else}
			<p class="mt-1.5 text-xs text-gray-400 dark:text-gray-600">No lists yet.</p>
		{/if}
		{#if sharedCollections.length > 0}
			<div class="mt-2">
				<p class="text-[9px] font-medium uppercase tracking-wide text-gray-400 dark:text-gray-500">
					Shared
				</p>
				<div class="mt-1 flex flex-wrap gap-1">
					{#each sharedCollections as coll (coll.id)}
						{@const isActive = activeSharedCollectionIds.includes(coll.id)}
						{@const sharedColor = sharedListColors[coll.id] ?? '#9ca3af'}
						<button
							type="button"
							disabled={collectionBusy || isActive}
							class="rounded-full border px-2 py-0.5 text-[10px] font-medium transition-colors disabled:cursor-default {isActive
								? ''
								: 'hover:bg-gray-50 dark:hover:bg-gray-800'}"
							style="border-color:{sharedColor}; color:{sharedColor};"
							onclick={async () => {
								collectionBusy = true;
								try {
									await onAssignShared(coll.id);
								} finally {
									collectionBusy = false;
								}
							}}
						>
							{coll.name}{isActive ? ' ✓' : ''}
						</button>
					{/each}
				</div>
			</div>
		{/if}

		<button
			type="button"
			onclick={onClose}
			class="mt-4 w-full rounded-lg bg-gray-100 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
		>
			Done
		</button>
	</div>
</div>
