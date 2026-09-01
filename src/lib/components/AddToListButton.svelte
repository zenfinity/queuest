<script lang="ts">
	// Split "add" button — the default click does the primary action (usually
	// "add to queue"), the caret opens a popover offering personal Lists and
	// Shared lists as direct destinations, so adding straight to a list
	// doesn't need a trip through the detail panel or bulk-select. Self-
	// contained (owns its own open/closed state and document-click dismissal)
	// so callers can drop one in per row/card without any shared parent state.
	import type { SharedCollection } from '$lib/collection-actions';

	let {
		label = '+ Add to Queue',
		busy = false,
		busyLabel = 'Adding…',
		done = false,
		disabled = false,
		existingCollections,
		queueColors,
		sharedCollections,
		sharedListColors,
		onAddToQueue,
		onAddToList
	}: {
		label?: string;
		busy?: boolean;
		busyLabel?: string;
		done?: boolean;
		disabled?: boolean;
		existingCollections: string[];
		queueColors: Record<string, string>;
		sharedCollections: SharedCollection[];
		sharedListColors: Record<string, string>;
		onAddToQueue: () => void;
		onAddToList: (target: { tag: string } | { collection: SharedCollection }) => void;
	} = $props();

	let open = $state(false);
	let hasLists = $derived(existingCollections.length > 0 || sharedCollections.length > 0);
	let isDisabled = $derived(disabled || busy || done);
</script>

<svelte:document
	onclick={(e) => {
		const t = e.target as Element;
		if (!t.closest('[data-add-menu]')) open = false;
	}}
/>

<div class="relative flex gap-1">
	<button
		class="flex-1 rounded-md py-1.5 text-xs font-medium transition-colors disabled:opacity-50
			{done
			? 'bg-teal-100 text-teal-700 dark:bg-teal-900/50 dark:text-teal-400'
			: 'bg-orange-500 text-white hover:bg-orange-400'}"
		disabled={isDisabled}
		onclick={onAddToQueue}
	>
		{#if busy}
			{busyLabel}
		{:else if done}
			✓ Added
		{:else}
			{label}
		{/if}
	</button>
	{#if hasLists}
		<button
			aria-label="Add to a specific list"
			aria-expanded={open}
			disabled={isDisabled}
			onclick={(e) => {
				e.stopPropagation();
				open = !open;
			}}
			data-add-menu
			class="shrink-0 rounded-md px-2 text-xs font-medium transition-colors disabled:opacity-50
				{done
				? 'bg-teal-100 text-teal-700 dark:bg-teal-900/50 dark:text-teal-400'
				: 'bg-orange-500 text-white hover:bg-orange-400'}"
		>
			▾
		</button>
		{#if open}
			<div
				data-add-menu
				class="absolute bottom-full right-0 z-30 mb-1 w-44 rounded-2xl border border-gray-200 bg-white p-1.5 shadow-xl dark:border-white/10 dark:bg-gray-900"
			>
				<button
					onclick={() => {
						open = false;
						onAddToQueue();
					}}
					class="flex w-full items-center rounded-lg px-2 py-1.5 text-left text-xs text-gray-700 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-800/50"
				>
					Queue
				</button>
				{#if existingCollections.length > 0}
					<div class="my-1 h-px bg-gray-100 dark:bg-gray-800"></div>
					{#each existingCollections as name (name)}
						<button
							onclick={() => {
								open = false;
								onAddToList({ tag: name });
							}}
							class="flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-xs text-gray-700 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-800/50"
						>
							<span
								class="h-2 w-2 shrink-0 rounded-full"
								style="background:{queueColors[name] ?? '#9ca3af'}"
							></span>
							<span class="truncate">{name}</span>
						</button>
					{/each}
				{/if}
				{#if sharedCollections.length > 0}
					<div class="my-1 h-px bg-gray-100 dark:bg-gray-800"></div>
					<p class="px-2 py-1 panel-label">Shared</p>
					{#each sharedCollections as coll (coll.id)}
						<button
							onclick={() => {
								open = false;
								onAddToList({ collection: coll });
							}}
							class="flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-xs text-gray-700 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-800/50"
						>
							<span
								class="h-2 w-2 shrink-0 rounded-full"
								style="background:{sharedListColors[coll.id] ?? '#9ca3af'}"
							></span>
							<span class="truncate">{coll.name}</span>
						</button>
					{/each}
				{/if}
			</div>
		{/if}
	{/if}
</div>
