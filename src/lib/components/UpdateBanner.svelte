<script lang="ts">
	import { updated } from '$app/state';

	// SvelteKit polls _app/version.json (kit.version.pollInterval) and flips
	// `updated.current` once a newer build has shipped. The service worker is
	// network-first for pages, so a reload picks the new build up immediately.
</script>

{#if updated.current}
	<div
		role="status"
		class="fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-[60] mx-auto flex w-fit max-w-full items-center gap-3 rounded-full border border-gray-200 bg-white/95 py-2 pr-2 pl-4 text-sm text-gray-700 shadow-lg backdrop-blur-md dark:border-gray-700 dark:bg-gray-900/95 dark:text-gray-200"
	>
		<span>A new version of Queuest is available.</span>
		<button
			type="button"
			onclick={() => location.reload()}
			class="rounded-full bg-orange-500 px-3 py-1 text-xs font-semibold text-white transition-colors hover:bg-orange-600"
		>
			Reload
		</button>
	</div>
{/if}
