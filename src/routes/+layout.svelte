<script lang="ts">
	import '../app.css';
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import { initTheme } from '$lib/theme.svelte';
	import { welcomeState, initWelcome, closeWelcome } from '$lib/welcome.svelte';

	let { children } = $props();

	const navLinks = [
		{ href: '/',        label: 'My Queue', exact: true },
		{ href: '/suggest', label: 'Suggest',  exact: false },
	];

	function isActive(href: string, exact: boolean) {
		return exact ? page.url.pathname === href : page.url.pathname.startsWith(href);
	}

	onMount(() => {
		initTheme();
		initWelcome();
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

<div class="min-h-screen w-full bg-gray-50 text-gray-900 dark:bg-gray-950 dark:text-gray-100">
	<nav class="sticky top-0 z-50 border-b border-gray-200 bg-white/90 backdrop-blur dark:border-gray-800 dark:bg-gray-900/90">
		<div class="mx-auto flex h-11 max-w-5xl items-stretch gap-3 px-3 sm:h-14 sm:gap-6 sm:px-4">
			<a class="flex items-center text-base font-bold tracking-tight text-gray-900 sm:text-xl dark:text-white" href="/">
				Queue<span class="text-orange-400">st</span>
			</a>

			<div class="flex gap-4 sm:gap-5">
				{#each navLinks as link (link.href)}
					{@const active = isActive(link.href, link.exact)}
					<a
						class="flex items-center border-b-2 text-xs transition-colors sm:text-sm
							{active
								? 'border-gray-900 font-semibold text-gray-900 dark:border-white dark:text-white'
								: 'border-transparent text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white'}"
						href={link.href}
					>
						{link.label}
					</a>
				{/each}
			</div>

			<div class="flex-1"></div>

			<a
				class="flex items-center border-b-2 text-xs transition-colors sm:text-sm
					{isActive('/settings', false)
						? 'border-gray-900 font-semibold text-gray-900 dark:border-white dark:text-white'
						: 'border-transparent text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white'}"
				href="/settings"
				aria-label="Settings"
			>
				<svg class="h-4 w-4 sm:hidden" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
					<path fill-rule="evenodd" d="M8.34 1.804A1 1 0 019.32 1h1.36a1 1 0 01.98.804l.295 1.473c.497.144.971.342 1.416.587l1.25-.834a1 1 0 011.262.125l.962.962a1 1 0 01.125 1.262l-.834 1.25c.245.445.443.919.587 1.416l1.473.294a1 1 0 01.804.98v1.361a1 1 0 01-.804.98l-1.473.295a6.95 6.95 0 01-.587 1.416l.834 1.25a1 1 0 01-.125 1.262l-.962.962a1 1 0 01-1.262.125l-1.25-.834a6.953 6.953 0 01-1.416.587l-.294 1.473a1 1 0 01-.98.804H9.32a1 1 0 01-.98-.804l-.295-1.473a6.957 6.957 0 01-1.416-.587l-1.25.834a1 1 0 01-1.262-.125l-.962-.962a1 1 0 01-.125-1.262l.834-1.25a6.957 6.957 0 01-.587-1.416l-1.473-.294A1 1 0 011 10.68V9.32a1 1 0 01.804-.98l1.473-.295c.144-.497.342-.971.587-1.416l-.834-1.25a1 1 0 01.125-1.262l.962-.962A1 1 0 015.38 3.03l1.25.834a6.957 6.957 0 011.416-.587l.294-1.473zM13 10a3 3 0 11-6 0 3 3 0 016 0z" clip-rule="evenodd" />
				</svg>
				<span class="hidden sm:inline">Settings</span>
			</a>
		</div>
	</nav>

	<main class="mx-auto max-w-5xl px-3 py-4 sm:px-4 sm:py-8">
		{@render children()}
	</main>

	<footer class="mt-8 border-t border-gray-200 py-4 sm:mt-16 sm:py-6 dark:border-gray-800">
		<div class="mx-auto flex max-w-5xl flex-col items-center gap-2 px-3 sm:flex-row sm:justify-between sm:px-4">
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

	<!-- ── Welcome modal ─────────────────────────────────────────────────── -->
{#if welcomeState.show}
	<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
		onclick={closeWelcome}
	>
		<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
		<div
			class="w-full max-w-md rounded-2xl bg-white p-4 sm:p-8 shadow-2xl dark:bg-gray-900"
			onclick={(e) => e.stopPropagation()}
		>
			<!-- Brand -->
			<div class="mb-4 text-center sm:mb-7">
				<p class="text-xl font-bold tracking-tight sm:text-2xl">
					Queue<span class="text-orange-400">st</span>
				</p>
				<p class="mt-1.5 text-xs leading-relaxed text-gray-500 sm:mt-2 sm:text-sm dark:text-gray-400">
					Figure out how long you actually need a streaming subscription — before paying for another month.
				</p>
			</div>

			<!-- Three points -->
			<div class="mb-4 space-y-3 sm:mb-8 sm:space-y-5">
				<div class="flex gap-3 sm:gap-4">
					<span class="mt-0.5 text-lg leading-none sm:text-xl">🔍</span>
					<div>
						<p class="text-xs font-semibold sm:text-sm">Build your watch queue</p>
						<p class="mt-0.5 text-[11px] leading-relaxed text-gray-500 sm:text-xs dark:text-gray-400">
							Search for movies and shows and add them. Queuest fetches runtime and which services carry each title.
						</p>
					</div>
				</div>
				<div class="flex gap-3 sm:gap-4">
					<span class="mt-0.5 text-lg leading-none sm:text-xl">≋</span>
					<div>
						<p class="text-xs font-semibold sm:text-sm">See your subscription value</p>
						<p class="mt-0.5 text-[11px] leading-relaxed text-gray-500 sm:text-xs dark:text-gray-400">
							The Gantt view groups titles by provider. Bar width = watch time relative to your monthly budget.
						</p>
					</div>
				</div>
				<div class="flex gap-3 sm:gap-4">
					<span class="mt-0.5 text-lg leading-none sm:text-xl">🔒</span>
					<div>
						<p class="text-xs font-semibold sm:text-sm">Your data, your device</p>
						<p class="mt-0.5 text-[11px] leading-relaxed text-gray-500 sm:text-xs dark:text-gray-400">
							Everything lives in your browser — no account needed. Use <span class="font-medium text-gray-700 dark:text-gray-300">Settings → Export</span> to back up.
						</p>
					</div>
				</div>
			</div>

			<button
				onclick={closeWelcome}
				class="w-full rounded-xl bg-orange-500 py-2.5 text-xs font-semibold text-white transition-colors hover:bg-orange-400 sm:py-3 sm:text-sm"
			>
				Get started →
			</button>
		</div>
	</div>
{/if}
</div>
