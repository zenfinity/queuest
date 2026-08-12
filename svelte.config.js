import adapter from '@sveltejs/adapter-cloudflare';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
export default {
	preprocess: vitePreprocess(),
	kit: {
		adapter: adapter(),
		env: {
			publicPrefix: 'PUBLIC_'
		},
		csp: {
			// 'auto' = nonces for dynamically-rendered pages, hashes for prerendered
			// ones — both computed fresh on every build/request, so this can't go
			// stale the way a hardcoded hash in a header string can.
			mode: 'auto',
			directives: {
				'default-src': ['self'],
				'style-src': ['self', 'unsafe-inline'],
				'img-src': ['self', 'https://image.tmdb.org', 'https://www.themoviedb.org', 'data:'],
				'connect-src': ['self', 'https://api.themoviedb.org'],
				'form-action': ['self'],
				'object-src': ['none'],
				'base-uri': ['self'],
				'frame-ancestors': ['none']
			}
		}
	}
};
