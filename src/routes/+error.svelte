<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import Button from '$lib/components/Button.svelte';
</script>

<svelte:head>
	<title>Error — Queuest</title>
</svelte:head>

<div class="flex min-h-screen flex-col items-center justify-center px-4">
	<div class="text-center">
		<h1 class="text-4xl font-bold text-gray-900 dark:text-white">
			{#if page.status === 404}
				404
			{:else if page.status === 500}
				500
			{:else}
				Error
			{/if}
		</h1>
		<p class="mt-2 text-xl text-gray-600 dark:text-gray-400">
			{#if page.status === 404}
				Page not found
			{:else if page.status === 500}
				Something went wrong
			{:else}
				An error occurred
			{/if}
		</p>
		<p class="mt-4 text-sm text-gray-500 dark:text-gray-500">
			{page.error?.message || "Sorry, we couldn't process your request."}
		</p>
		<Button href={resolve('/app')} class="mt-6 inline-block px-6 py-3 text-sm">
			Return to Queue
		</Button>
	</div>
</div>
