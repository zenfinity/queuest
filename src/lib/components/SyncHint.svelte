<script lang="ts">
	// Onboarding nudge toward sync (#191) — shown once a queue represents real
	// investment (its own trigger threshold, computed by the caller) and sync
	// isn't already on. #191's original proposal also included "second device
	// detected" as a trigger, but that needs an account to observe in the
	// first place — a chicken-and-egg signal for a hint whose whole point is
	// getting someone to create one. Left out rather than faked.
	//
	// Copy is deliberately plain, not a cheerful "keep your queue everywhere!"
	// pitch — #191 calls this out explicitly: sync means a passphrase and a
	// recovery code, and losing both is unrecoverable by design. That's a real
	// tradeoff worth one honest sentence, not something to gloss over to sell
	// the feature.
	import { resolve } from '$app/paths';
	import Hint from './Hint.svelte';

	let { show = false }: { show?: boolean } = $props();
</script>

<Hint {show} dismissKey="sq:sync-hint-dismissed">
	{#snippet children(dismiss)}
		Keep this queue on your other devices too — end-to-end encrypted, we can't read it. Set up
		<a
			href={resolve('/settings#sync')}
			onclick={dismiss}
			class="font-medium text-orange-400 underline">Sync</a
		>
		(keep the recovery code it gives you — losing both it and your passphrase means losing the data).
	{/snippet}
</Hint>
