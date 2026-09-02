<script lang="ts">
	// Permanent footer line at the foot of the queue (#242, formerly a
	// dismiss-once floating pill triggered past a size/watched threshold —
	// #191). Always visible once there's something in the queue and sync
	// isn't already on, rather than nudging past some "you've invested
	// enough now" line — the tradeoff it states (a passphrase and a
	// recovery code you can't lose) deserves to be legible whenever it's
	// relevant, not sprung once and then gone.
	import { resolve } from '$app/paths';

	let { show = false, count = 0 }: { show?: boolean; count?: number } = $props();
</script>

{#if show}
	<p class="mt-8 text-center text-xs leading-relaxed text-gray-400 dark:text-gray-600">
		{count} title{count === 1 ? '' : 's'}, on this browser only.
		<a href={resolve('/settings#sync')} class="font-medium text-orange-500 hover:underline">Sync</a>
		puts them on your other devices, encrypted so we can't read them — it needs a passphrase and a recovery
		code you can't lose.
	</p>
{/if}
