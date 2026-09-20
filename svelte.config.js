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
		// src/service-worker.ts is built regardless; this only stops Kit from
		// registering it itself. Registration is manual and prod-only
		// (src/lib/pwa.ts) so `vite dev` never runs a worker that would cache
		// static files under HMR's feet.
		// robots.txt is for crawlers; Kit's default filter already drops .DS_Store.
		serviceWorker: { register: false, files: (file) => !/\.DS_Store|robots\.txt$/.test(file) },
		// Poll _app/version.json so a long-lived tab (a home-screen PWA can stay
		// open for days) learns a new build shipped — drives UpdateBanner.
		version: { pollInterval: 30 * 60 * 1000 },
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
				// Explicit script-src (rather than relying on default-src's
				// fallback) so Cloudflare's Web Analytics beacon is allowed
				// alongside the per-build hash SvelteKit adds automatically (#233).
				'script-src': ['self', 'https://static.cloudflareinsights.com'],
				'style-src': ['self', 'unsafe-inline'],
				'img-src': ['self', 'https://image.tmdb.org', 'https://www.themoviedb.org', 'data:'],
				'connect-src': ['self', 'https://api.themoviedb.org', 'https://cloudflareinsights.com'],
				// Falls back to default-src anyway; stated so the service worker
				// (#257) doesn't silently depend on that fallback staying put.
				'worker-src': ['self'],
				'form-action': ['self'],
				'object-src': ['none'],
				'base-uri': ['self'],
				'frame-ancestors': ['none']
			}
		}
	}
};
