import { getServices } from './db';
import { SvelteSet } from 'svelte/reactivity';

export const services = $state({ ids: new SvelteSet<number>() });

let _loaded = false;
let _loadError: string | null = null;
let _promise: Promise<void> | null = null;

export function setSubscribedIds(next: Set<number> | SvelteSet<number>) {
	services.ids = next as SvelteSet<number>;
	_loaded = true;
	_loadError = null;
}

export function getLoadError(): string | null {
	return _loadError;
}

export function ensureSubscribedLoaded(): Promise<void> {
	if (_loaded || _loadError) return Promise.resolve();
	if (_promise) return _promise;
	_promise = getServices()
		.then((svcs) => {
			services.ids = new SvelteSet(svcs.map((s) => s.provider_id));
			_loaded = true;
			_loadError = null;
			_promise = null;
		})
		.catch((err) => {
			_loadError = err instanceof Error ? err.message : 'Failed to load subscribed services';
			_promise = null;
		});
	return _promise!;
}
