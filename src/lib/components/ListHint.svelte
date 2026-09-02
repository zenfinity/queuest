<script lang="ts">
	// In-flow nudge toward Lists (#242, formerly a floating pill — #191/#208).
	// Shown under the queue grid once there's enough queued to make grouping
	// worth suggesting and no list exists yet — the same trigger as before,
	// just rendered as permanent layout copy instead of a dismiss-once
	// overlay: it stops on its own once a list exists, no separate dismissal
	// key needed.
	let { show = false }: { show?: boolean } = $props();
</script>

{#if show}
	<p
		class="border-l-2 border-orange-400 pl-3 text-xs leading-relaxed text-gray-500 dark:text-gray-400"
	>
		Select a few of these to group them into a list — date night, with the kids.
	</p>
{/if}
