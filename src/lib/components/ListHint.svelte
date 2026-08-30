<script lang="ts">
	// One-time onboarding nudge toward Lists — once someone has a handful of
	// titles queued and hasn't made a list yet, there's finally something
	// worth grouping, and this is the first mention that grouping is possible
	// at all. Shown on the Queue page (see app/+page.svelte) once there's
	// enough in the queue to make the suggestion land, deliberately not on
	// the very first add — that moment already carries NavHint's nudge, and
	// stacking two unrelated tips back to back defeats the point of either
	// (enforced by Hint.svelte's one-at-a-time gate, #191, not just careful
	// trigger placement). This is the "Collections hint" #191 asked for —
	// "Lists" is what Collections was renamed to (#208).
	import { resolve } from '$app/paths';
	import Hint from './Hint.svelte';

	let { show = false }: { show?: boolean } = $props();
</script>

<Hint {show} dismissKey="sq:list-hint-dismissed">
	{#snippet children(dismiss)}
		Select titles to group them into a list, or start one in
		<a href={resolve('/lists')} onclick={dismiss} class="font-medium text-orange-400 underline"
			>Lists</a
		>
	{/snippet}
</Hint>
