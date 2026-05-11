<script lang="ts">
	import '../app.css';
	import { page } from '$app/state';

	let { children } = $props();

	const navLinks = [
		{ href: '/',        label: 'My Queue', exact: true },
		{ href: '/suggest', label: 'Suggest',  exact: false },
	];

	function isActive(href: string, exact: boolean) {
		return exact ? page.url.pathname === href : page.url.pathname.startsWith(href);
	}
</script>

<div class="min-h-screen bg-gray-950 text-gray-100">
	<nav class="sticky top-0 z-50 border-b border-gray-800 bg-gray-900/90 backdrop-blur">
		<div class="mx-auto flex h-14 max-w-5xl items-stretch gap-6 px-4">
			<a class="flex items-center text-xl font-bold tracking-tight text-white" href="/">
				Stream<span class="text-orange-400">Q</span>
			</a>

			<!-- Left links -->
			<div class="flex gap-5">
				{#each navLinks as link (link.href)}
					{@const active = isActive(link.href, link.exact)}
					<a
						class="flex items-center border-b-2 text-sm transition-colors
							{active
								? 'border-white font-semibold text-white'
								: 'border-transparent text-gray-400 hover:text-white'}"
						href={link.href}
					>
						{link.label}
					</a>
				{/each}
			</div>

			<!-- Spacer -->
			<div class="flex-1"></div>

			<!-- Settings (right-justified; gear icon on mobile, text on sm+) -->
			<a
				class="flex items-center border-b-2 text-sm transition-colors
					{isActive('/settings', false)
						? 'border-white font-semibold text-white'
						: 'border-transparent text-gray-400 hover:text-white'}"
				href="/settings"
				aria-label="Settings"
			>
				<span class="sm:hidden" aria-hidden="true">⚙</span>
				<span class="hidden sm:inline">Settings</span>
			</a>
		</div>
	</nav>

	<main class="mx-auto max-w-5xl px-4 py-8">
		{@render children()}
	</main>

	<footer class="mt-16 border-t border-gray-800 py-6">
		<div class="mx-auto flex max-w-5xl flex-col items-center gap-3 px-4 sm:flex-row sm:justify-between">
			<img
				src="https://www.themoviedb.org/assets/2/v4/logos/v2/blue_short-8e7b30f73a4020692ccca9c88bafe5dcb6f8a62a4c6bc55cd9ba82bb2cd95f6c.svg"
				alt="The Movie Database (TMDB)"
				class="h-4 opacity-70"
			/>
			<p class="text-center text-xs text-gray-600 sm:text-right">
				This website uses TMDB and the TMDB APIs but is not endorsed, certified, or otherwise approved by TMDB.
			</p>
		</div>
	</footer>
</div>
