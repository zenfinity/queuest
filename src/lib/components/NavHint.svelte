<script lang="ts">
	// One-time onboarding nudge (#169) toward the swipe (#162) / Alt+←→ (#168)
	// tab-switching gestures — neither is discoverable without being told.
	// Shown right after the first successful add (see add/+page.svelte) —
	// on the Queue page it fired too late, after the user had already
	// navigated there by tapping the nav link once with no idea swipe/Alt+
	// arrow existed. Visibility, auto-hide, dismissal, and the one-at-a-time
	// gate all live in Hint.svelte (#191); this component only supplies the
	// trigger, dismissal key, and copy.
	import Hint from './Hint.svelte';

	let { show = false }: { show?: boolean } = $props();

	let isTouch = $state(false);
	$effect(() => {
		if (show) isTouch = window.matchMedia('(pointer: coarse)').matches;
	});
</script>

<Hint {show} dismissKey="sq:nav-hint-dismissed">
	{#if isTouch}
		Swipe <span aria-hidden="true">← →</span> to switch tabs
	{:else}
		<kbd class="rounded bg-white/20 px-1 py-0.5 font-mono text-xs">Alt</kbd> +
		<span aria-hidden="true">← →</span> to switch tabs
	{/if}
</Hint>
