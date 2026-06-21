<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';

	onMount(() => {
		try {
			if (localStorage.getItem('sq:welcomed')) {
				goto('/app', { replaceState: true });
				return;
			}
		} catch {}
	});

	function start() {
		try { localStorage.setItem('sq:welcomed', '1'); } catch {}
		goto('/app');
	}
</script>

<svelte:head><title>Queuest — Know when to cancel</title></svelte:head>

<div class="flex min-h-[calc(100vh-10rem)] flex-col items-center justify-center px-4 py-16">
	<!-- Hero -->
	<div class="mb-12 text-center">
		<h1 class="text-4xl font-bold tracking-tight sm:text-5xl">
			Queu<span class="text-orange-400">est</span>
		</h1>
		<p class="mx-auto mt-4 max-w-sm text-base leading-relaxed text-gray-500 sm:text-lg dark:text-gray-400">
			Figure out how long you actually need a streaming subscription — before paying for another month.
		</p>
	</div>

	<!-- Feature list -->
	<div class="mb-12 w-full max-w-sm space-y-6">
		<div class="flex gap-4">
			<span class="mt-0.5 shrink-0 text-xl leading-none">🔍</span>
			<div>
				<p class="text-sm font-semibold">Build your watch queue</p>
				<p class="mt-0.5 text-xs leading-relaxed text-gray-500 dark:text-gray-400">
					Search for movies and shows and add them. Tap any title for cast, providers, seasons, and upcoming release dates.
				</p>
			</div>
		</div>
		<div class="flex gap-4">
			<span class="mt-0.5 shrink-0 text-xl leading-none">≋</span>
			<div>
				<p class="text-sm font-semibold">See your subscription value</p>
				<p class="mt-0.5 text-xs leading-relaxed text-gray-500 dark:text-gray-400">
					Grid, List, and Gantt views. The Gantt lane per provider — bar width = watch time vs. your monthly budget.
				</p>
			</div>
		</div>
		<div class="flex gap-4">
			<span class="mt-0.5 shrink-0 text-xl leading-none">🔗</span>
			<div>
				<p class="text-sm font-semibold">Share your queue</p>
				<p class="mt-0.5 text-xs leading-relaxed text-gray-500 dark:text-gray-400">
					Send an encrypted link to share your list with anyone — filter by provider, type, or queue before sharing.
				</p>
			</div>
		</div>
		<div class="flex gap-4">
			<span class="mt-0.5 shrink-0 text-xl leading-none">🔒</span>
			<div>
				<p class="text-sm font-semibold">Your data, your device</p>
				<p class="mt-0.5 text-xs leading-relaxed text-gray-500 dark:text-gray-400">
					No account needed — everything stays in your browser. <span class="font-medium text-gray-700 dark:text-gray-300">Settings → Export</span> backs up your full queue.
				</p>
			</div>
		</div>
	</div>

	<button
		onclick={start}
		class="rounded-xl bg-orange-500 px-8 py-3 text-sm font-semibold text-white transition-colors hover:bg-orange-400"
	>
		Get started →
	</button>
</div>
