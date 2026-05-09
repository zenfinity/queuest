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
</div>
