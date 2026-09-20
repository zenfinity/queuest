// Whether the browser thinks it has a connection. `false` is reliable ("you're
// offline" — airplane mode, no signal); `true` isn't a guarantee a request will
// succeed (captive portals, dead wifi), so this is for explaining what's
// unavailable, never for deciding whether to attempt something.
export const network = $state({ online: true });

/** Call once at startup (root layout's onMount). Returns a cleanup function. */
export function initNetwork(): () => void {
	network.online = navigator.onLine;
	const goOnline = () => (network.online = true);
	const goOffline = () => (network.online = false);
	window.addEventListener('online', goOnline);
	window.addEventListener('offline', goOffline);
	return () => {
		window.removeEventListener('online', goOnline);
		window.removeEventListener('offline', goOffline);
	};
}
