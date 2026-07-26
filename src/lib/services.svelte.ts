import { getServices } from './db';

export const services = $state({ ids: new Set<number>() });

let _loaded = false;
let _promise: Promise<void> | null = null;

export function setSubscribedIds(next: Set<number>) {
	services.ids = next;
	_loaded = true;
}

export function ensureSubscribedLoaded(): Promise<void> {
	if (_loaded) return Promise.resolve();
	if (_promise) return _promise;
	_promise = getServices()
		.then((svcs) => {
			services.ids = new Set(svcs.map((s) => s.provider_id));
			_loaded = true;
			_promise = null;
		})
		.catch(() => {
			_promise = null;
		});
	return _promise!;
}
