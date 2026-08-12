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
			// 'hash' (not 'auto'): the app has at least one prerendered route (the
			// landing page), and SvelteKit refuses to build at all if app.html's
			// shared template contains %sveltekit.nonce% while any route prerenders
			// — a nonce is per-request by definition, which is meaningless for a
			// static prerendered page. Hash mode works uniformly for prerendered and
			// dynamic routes and is computed fresh every build/request either way,
			// so it can't go stale the way a hardcoded hash in a header string can.
			mode: 'hash',
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
