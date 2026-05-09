<script lang="ts">
	import '../app.css';
	import { page } from '$app/state';

	let { children } = $props();

	function isActive(path: string) {
		return page.url.pathname.startsWith(path);
	}
</script>

<div class="min-h-screen bg-gray-950 text-gray-100">
	<nav class="sticky top-0 z-50 border-b border-gray-800 bg-gray-900/90 backdrop-blur">
		<div class="mx-auto flex h-14 max-w-5xl items-center gap-6 px-4">
			<a class="text-xl font-bold tracking-tight text-white" href="/">
				Stream<span class="text-orange-400">Q</span>
			</a>
			<div class="flex gap-5">
				<a
					class="text-sm transition-colors {isActive('/search')
						? 'text-white'
						: 'text-gray-400 hover:text-white'}"
					href="/search"
				>
					Search
				</a>
				<a
					class="text-sm transition-colors {isActive('/suggest')
						? 'text-white'
						: 'text-gray-400 hover:text-white'}"
					href="/suggest"
				>
					Suggest
				</a>
			</div>
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
