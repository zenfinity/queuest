import { dev } from '$app/environment';
import { base } from '$app/paths';

// A browser only re-checks a service worker's script on navigation, and a
// home-screen PWA can stay open for days without one — so also ask on
// visibilitychange, at most this often.
const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;

/** Registers src/service-worker.ts. Prod only: in `vite dev` a worker would
 *  cache static files underneath HMR. Safe to call more than once. */
export function initServiceWorker(): void {
	if (dev || !('serviceWorker' in navigator)) return;

	const register = () => {
		navigator.serviceWorker
			.register(`${base}/service-worker.js`)
			.then(watchForUpdates)
			.catch((err) => {
				// Never let this break the app — it just won't work offline.
				console.error('Service worker registration failed', err);
			});
	};

	if (document.readyState === 'complete') register();
	else window.addEventListener('load', register, { once: true });
}

function watchForUpdates(registration: ServiceWorkerRegistration): void {
	let lastCheck = Date.now();
	document.addEventListener('visibilitychange', () => {
		if (document.visibilityState !== 'visible') return;
		if (Date.now() - lastCheck < UPDATE_CHECK_INTERVAL_MS) return;
		lastCheck = Date.now();
		// Rejects when offline; nothing to do about that.
		registration.update().catch(() => {});
	});
}
