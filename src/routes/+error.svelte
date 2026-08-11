<script lang="ts">
	import { page } from '$app/state';
</script>

<svelte:head>
	<title>Error — Queuest</title>
</svelte:head>

<div class="flex min-h-screen flex-col items-center justify-center px-4">
	<div class="text-center">
		<h1 class="text-4xl font-bold text-gray-900 dark:text-white">
			{#if $page.status === 404}
				404
			{:else if $page.status === 500}
				500
			{:else}
				Error
			{/if}
		</h1>
		<p class="mt-2 text-xl text-gray-600 dark:text-gray-400">
			{#if $page.status === 404}
				Page not found
			{:else if $page.status === 500}
				Something went wrong
			{:else}
				An error occurred
			{/if}
		</p>
		<p class="mt-4 text-sm text-gray-500 dark:text-gray-500">
			{$page.error?.message || "Sorry, we couldn't process your request."}
		</p>
		<a
			href="/app"
			class="mt-6 inline-block rounded-lg bg-orange-500 px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-orange-400"
		>
			Return to Queue
		</a>
	</div>
</div>
