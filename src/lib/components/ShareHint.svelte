<script lang="ts">
	// Permanent copy explaining Read-only vs. Share (#242, formerly a
	// dismiss-once floating pill — #191). Not really a hint any more: the
	// distinction is genuinely non-obvious from two adjacently-labeled
	// buttons and otherwise only lives in each button's hover title
	// (invisible on touch), so this is the one place it's spelled out for
	// good rather than shown once and gone. Still gated on sync being on —
	// Share doesn't exist as an option without it, so explaining it earlier
	// would describe a button that isn't there.
	let { show = false }: { show?: boolean } = $props();
</script>

{#if show}
	<p
		class="border-l-2 border-orange-400 pl-3 text-xs leading-relaxed text-gray-500 dark:text-gray-400"
	>
		<span class="font-medium text-gray-700 dark:text-gray-300">Read-only</span> sends the list as-is
		— <span class="font-medium text-gray-700 dark:text-gray-300">Share</span> lets others collaborate
		on it with you.
	</p>
{/if}
