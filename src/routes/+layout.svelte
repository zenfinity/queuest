<script lang="ts">
	import '../app.css';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { onMount } from 'svelte';
	import { initTheme } from '$lib/theme.svelte';
	import '$lib/motion.svelte';
	import { queueControls } from '$lib/queue-controls.svelte';
	import QueueDock from '$lib/components/QueueDock.svelte';

	let { children } = $props();

	const navLinks = [
		{ href: '/budget', label: 'Budget', exact: false },
		{ href: '/add', label: 'Add', exact: false },
		{ href: '/app', label: 'Queue', exact: true },
		{ href: '/share', label: 'Share', exact: true }
	] as const;

	function isActive(href: string, exact: boolean) {
		return exact ? page.url.pathname === href : page.url.pathname.startsWith(href);
	}

	let isLanding = $derived(page.url.pathname === '/');
	let isQueue = $derived(page.url.pathname === '/app');

	onMount(() => {
		initTheme();
		// iOS Safari misreports viewport width during keyboard animation (and after
		// native pickers dismiss), making sm: breakpoints fire on narrow screens.
		// Re-stamping the viewport meta on every resize corrects it.
		function fixViewport() {
			const vp = document.querySelector<HTMLMetaElement>('meta[name=viewport]');
			if (vp) vp.content = 'width=device-width, initial-scale=1';
		}
		window.addEventListener('resize', fixViewport);
		return () => window.removeEventListener('resize', fixViewport);
	});
</script>

<svelte:document
	onclick={(e) => {
		const t = e.target as Element;
		if (queueControls.filterOpen && !t.closest('[data-queue-dock]'))
			queueControls.filterOpen = false;
	}}
/>

<div class="min-h-screen w-full bg-gray-50 text-gray-900 dark:bg-gray-950 dark:text-gray-100">
	<nav class="sticky top-0 z-50 bg-white/90 backdrop-blur dark:bg-gray-900/90">
		<div
			class="mx-auto flex h-11 max-w-5xl items-stretch gap-1.5 border-b border-gray-200 px-3 sm:h-14 sm:gap-6 sm:px-4 dark:border-gray-800"
		>
			<a
				class="flex items-center text-base font-bold tracking-tight text-gray-900 sm:text-xl dark:text-white"
				href={resolve('/')}
			>
				Queu<span class="text-orange-400">est</span>
			</a>

			{#if !isLanding}
				<!-- Folder-tab strip: active link is a raised, connected piece of the content
				     area below it — filled with the page background (so it visually merges with
				     what's under the nav) and rounded at the top. `items-end` + `-mb-px` on the
				     active tab is what sells the illusion: the tab's own background paints over
				     that single pixel of the nav's bottom border, breaking it exactly where the
				     tab sits, as if the tab were a physical continuation of the page below. -->
				<div class="flex items-end gap-0.5 sm:gap-1">
					{#each navLinks as link (link.href)}
						{@const active = isActive(link.href, link.exact)}
						<a
							class="relative flex items-center rounded-t-md px-1.5 py-1.5 text-xs font-medium transition-colors sm:rounded-t-lg sm:px-3.5 sm:py-2 sm:text-sm
								{active
								? '-mb-px bg-gray-50 text-gray-900 dark:bg-gray-950 dark:text-white'
								: 'text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white'}"
							href={resolve(link.href)}
						>
							{link.label}
						</a>
					{/each}
				</div>
			{/if}

			<div class="flex-1"></div>

			{#if isQueue && queueControls.ready && queueControls.hasItems}
				<!-- Inline nav placement (lg+ only) — the mobile/tablet floating placement lives
				     outside <nav> below, since backdrop-filter on <nav> would otherwise confine a
				     fixed-position dock to the nav's own box (see QueueDock.svelte). -->
				<div class="hidden self-center lg:block">
					<QueueDock floating={false} />
				</div>
			{/if}

			{#if !isLanding}
				{@const settingsActive = isActive('/settings', false)}
				<!-- "Half tab": same lifted/connected mechanism as the primary tabs, but tighter
				     padding and a smaller radius so an active Settings reads as secondary to the
				     5 main tabs rather than a 6th peer. Inactive gets no tab chrome at all. -->
				<a
					class="relative flex items-center self-end rounded-t px-1 py-1 text-xs font-medium transition-colors sm:px-2 sm:py-1.5 sm:text-sm
					{settingsActive
						? '-mb-px bg-gray-50 text-gray-900 dark:bg-gray-950 dark:text-white'
						: 'text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white'}"
					href={resolve('/settings')}
					aria-label="Settings"
				>
					<svg class="h-4 w-4 sm:hidden" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
						<path
							fill-rule="evenodd"
							d="M8.34 1.804A1 1 0 019.32 1h1.36a1 1 0 01.98.804l.295 1.473c.497.144.971.342 1.416.587l1.25-.834a1 1 0 011.262.125l.962.962a1 1 0 01.125 1.262l-.834 1.25c.245.445.443.919.587 1.416l1.473.294a1 1 0 01.804.98v1.361a1 1 0 01-.804.98l-1.473.295a6.95 6.95 0 01-.587 1.416l.834 1.25a1 1 0 01-.125 1.262l-.962.962a1 1 0 01-1.262.125l-1.25-.834a6.953 6.953 0 01-1.416.587l-.294 1.473a1 1 0 01-.98.804H9.32a1 1 0 01-.98-.804l-.295-1.473a6.957 6.957 0 01-1.416-.587l-1.25.834a1 1 0 01-1.262-.125l-.962-.962a1 1 0 01-.125-1.262l.834-1.25a6.957 6.957 0 01-.587-1.416l-1.473-.294A1 1 0 011 10.68V9.32a1 1 0 01.804-.98l1.473-.295c.144-.497.342-.971.587-1.416l-.834-1.25a1 1 0 01.125-1.262l.962-.962A1 1 0 015.38 3.03l1.25.834a6.957 6.957 0 011.416-.587l.294-1.473zM13 10a3 3 0 11-6 0 3 3 0 016 0z"
							clip-rule="evenodd"
						/>
					</svg>
					<span class="hidden sm:inline">Settings</span>
				</a>
			{/if}
		</div>
	</nav>

	{#if isQueue && queueControls.ready && queueControls.hasItems}
		<!-- Floating placement (below lg:) — deliberately outside <nav>, see the comment
		     on the inline instance above for why. -->
		<div class="lg:hidden">
			<QueueDock floating={true} />
		</div>
	{/if}

	<main class="mx-auto max-w-5xl px-3 py-4 sm:px-4 sm:py-8">
		{@render children()}
	</main>

	<footer class="mt-8 border-t border-gray-200 py-4 sm:mt-16 sm:py-6 dark:border-gray-800">
		<div
			class="mx-auto flex max-w-5xl flex-col items-center gap-2 px-3 sm:flex-row sm:justify-between sm:px-4"
		>
			<img
				src="https://www.themoviedb.org/assets/2/v4/logos/v2/blue_short-8e7b30f73a4020692ccca9c88bafe5dcb6f8a62a4c6bc55cd9ba82bb2cd95f6c.svg"
				alt="The Movie Database (TMDB)"
				class="h-3.5 opacity-70 sm:h-4"
			/>
			<p class="text-center text-[10px] text-gray-500 sm:text-right sm:text-xs">
				This website uses TMDB and the TMDB APIs but is not endorsed or approved by TMDB.
			</p>
		</div>
	</footer>
</div>
