<script lang="ts">
	// Last of the original three onboarding nudges, same shape as
	// NavHint/ListHint — this one explains the two sharing options once
	// someone actually has a list to share, which is also the first moment
	// both buttons are visible at once. The distinction (snapshot vs. ongoing
	// collaboration) isn't obvious from two adjacently-labeled buttons alone,
	// and the fuller explanation only otherwise exists in each button's hover
	// tooltip — invisible on touch. Only shown with sync on, since Share
	// doesn't exist as an option without it; mentioning it before then would
	// point at a button that isn't there. This is most of what #191's
	// proposed "Collaboration hint" asked for; see RankingHint.svelte for the
	// other collaboration-adjacent hint #191 identified.
	import Hint from './Hint.svelte';

	let { show = false }: { show?: boolean } = $props();
</script>

<Hint {show} dismissKey="sq:share-hint-dismissed">
	<span class="font-medium text-orange-400">Read-only</span> sends the list as-is —
	<span class="font-medium text-orange-400">Share</span> lets others collaborate on it with you
</Hint>
