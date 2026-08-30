<script lang="ts">
	// Onboarding nudge toward ranked-choice voting on a shared list (#210,
	// #191) — shown once a shared list actually has enough titles for ranking
	// to mean something and the viewer hasn't ranked anything yet. Mounted
	// inside SharedListSection.svelte, where the trigger condition (title
	// count, this viewer's own ballot) already lives.
	import Hint from './Hint.svelte';

	let { show = false }: { show?: boolean } = $props();
</script>

<Hint {show} dismissKey="sq:ranking-hint-dismissed">
	Rank your top picks — tap ☆ on a title. The group's combined choice shows up under 🏆 Rankings.
</Hint>
