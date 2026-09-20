<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import Button from '$lib/components/Button.svelte';
	import { network } from '$lib/network.svelte';

	// Offline, SvelteKit lands here for any client-side navigation whose data
	// request fails (e.g. /add, which loads on the server) — with a bare
	// "500 · Failed to fetch". That's an accurate description of the mechanism
	// and useless to the person holding the phone.
	let offline = $derived(!network.online && page.status !== 404);
</script>

<svelte:head>
	<title>{offline ? 'Offline' : 'Error'} — Queuest</title>
</svelte:head>

<div class="flex min-h-screen flex-col items-center justify-center px-4">
	<div class="text-center">
		{#if offline}
			<h1 class="text-4xl font-bold text-gray-900 dark:text-white">You're offline</h1>
			<p class="mt-4 text-sm text-gray-500 dark:text-gray-500">
				This page needs a connection. Your queue, lists and budget still work.
			</p>
		{:else}
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
		{/if}
		<Button href={resolve('/app')} class="mt-6 px-6 py-3 text-sm">Return to Queue</Button>
	</div>
</div>
