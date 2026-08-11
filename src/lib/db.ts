import type { WatchlistItem, Provider } from './types';

const DB_NAME = 'streamq';
const STORE = 'watchlist';
const SERVICES_STORE = 'services';
const VERSION = 2;

let _dbPromise: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
	if (_dbPromise) return _dbPromise;
	_dbPromise = new Promise((resolve, reject) => {
		const req = indexedDB.open(DB_NAME, VERSION);
		req.onupgradeneeded = (e) => {
			const db = (e.target as IDBOpenDBRequest).result;
			if (!db.objectStoreNames.contains(STORE)) {
				const store = db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
				store.createIndex('tmdb_media', ['tmdb_id', 'media_type'], { unique: true });
			}
			if (!db.objectStoreNames.contains(SERVICES_STORE)) {
				db.createObjectStore(SERVICES_STORE, { keyPath: 'provider_id' });
			}
		};
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => {
			_dbPromise = null;
			reject(req.error);
		};
	});
	return _dbPromise;
}

export async function getAll(): Promise<WatchlistItem[]> {
	const db = await open();
	return new Promise((resolve, reject) => {
		const req = db.transaction(STORE).objectStore(STORE).getAll();
		req.onsuccess = () => resolve(req.result as WatchlistItem[]);
		req.onerror = () => reject(req.error);
	});
}

export async function addItem(
	item: Omit<WatchlistItem, 'id' | 'added_at' | 'watched_at'>
): Promise<void> {
	const db = await open();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(STORE, 'readwrite');
		// JSON round-trip strips Svelte 5 reactive Proxies — structuredClone cannot clone them
		const plain = JSON.parse(JSON.stringify(item)) as typeof item;
		const full: Omit<WatchlistItem, 'id'> = {
			...plain,
			added_at: new Date().toISOString(),
			watched_at: null
		};
		const req = tx.objectStore(STORE).add(full);
		req.onsuccess = () => resolve();
		req.onerror = () => reject(req.error);
	});
}

export async function removeItem(id: number): Promise<void> {
	const db = await open();
	return new Promise((resolve, reject) => {
		const req = db.transaction(STORE, 'readwrite').objectStore(STORE).delete(id);
		req.onsuccess = () => resolve();
		req.onerror = () => reject(req.error);
	});
}

export async function setWatched(id: number, watched: boolean): Promise<void> {
	const db = await open();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(STORE, 'readwrite');
		const store = tx.objectStore(STORE);
		const get = store.get(id);
		get.onsuccess = () => {
			const item = get.result as WatchlistItem;
			item.watched_at = watched ? new Date().toISOString() : null;
			const put = store.put(item);
			put.onsuccess = () => resolve();
			put.onerror = () => reject(put.error);
		};
		get.onerror = () => reject(get.error);
	});
}

export async function setQueueTag(id: number, tag: string | null): Promise<void> {
	const db = await open();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(STORE, 'readwrite');
		const store = tx.objectStore(STORE);
		const get = store.get(id);
		get.onsuccess = () => {
			const item = get.result as WatchlistItem;
			item.queue_tag = tag ?? undefined;
			const put = store.put(item);
			put.onsuccess = () => resolve();
			put.onerror = () => reject(put.error);
		};
		get.onerror = () => reject(get.error);
	});
}

export async function updateShowProgress(id: number, watchedSeasons: number[]): Promise<void> {
	const db = await open();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(STORE, 'readwrite');
		const store = tx.objectStore(STORE);
		const get = store.get(id);
		get.onsuccess = () => {
			const item = get.result as WatchlistItem;
			item.watched_seasons = watchedSeasons;
			const put = store.put(item);
			put.onsuccess = () => resolve();
			put.onerror = () => reject(put.error);
		};
		get.onerror = () => reject(get.error);
	});
}

export async function patchProviders(
	id: number,
	providers: WatchlistItem['providers'],
	rentable: boolean,
	release: WatchlistItem['release'],
	seasons?: WatchlistItem['seasons'],
	runtime_minutes?: number | null,
	genres?: string[],
	cast?: WatchlistItem['cast'],
	director?: string | null,
	creator?: string | null
): Promise<void> {
	const db = await open();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(STORE, 'readwrite');
		const store = tx.objectStore(STORE);
		const get = store.get(id);
		get.onsuccess = () => {
			const item = get.result as WatchlistItem;
			item.providers = providers;
			item.rentable = rentable;
			item.release = release;
			if (seasons && seasons.length > 0) item.seasons = seasons;
			if (runtime_minutes != null) item.runtime_minutes = runtime_minutes;
			if (genres !== undefined) item.genres = genres;
			if (cast !== undefined) item.cast = cast;
			if (director !== undefined) item.director = director;
			if (creator !== undefined) item.creator = creator;
			const put = store.put(item);
			put.onsuccess = () => resolve();
			put.onerror = () => reject(put.error);
		};
		get.onerror = () => reject(get.error);
	});
}

export async function replaceAll(
	items: (Omit<WatchlistItem, 'id'> & { id?: number })[]
): Promise<void> {
	const db = await open();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(STORE, 'readwrite');
		const store = tx.objectStore(STORE);
		store.clear();
		for (const item of items) store.put(item);
		tx.oncomplete = () => resolve();
		tx.onerror = () => reject(tx.error);
	});
}

export async function getServices(): Promise<Provider[]> {
	const db = await open();
	return new Promise((resolve, reject) => {
		const req = db.transaction(SERVICES_STORE).objectStore(SERVICES_STORE).getAll();
		req.onsuccess = () => resolve(req.result as Provider[]);
		req.onerror = () => reject(req.error);
	});
}

export async function setServices(services: Provider[]): Promise<void> {
	const db = await open();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(SERVICES_STORE, 'readwrite');
		const store = tx.objectStore(SERVICES_STORE);
		store.clear();
		for (const s of services) store.put(s);
		tx.oncomplete = () => resolve();
		tx.onerror = () => reject(tx.error);
	});
}

export async function toggleService(service: Provider): Promise<boolean> {
	const id = service.provider_id;
	const plain: Provider = {
		provider_id: id,
		provider_name: service.provider_name,
		logo_path: service.logo_path
	};
	const db = await open();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(SERVICES_STORE, 'readwrite');
		const store = tx.objectStore(SERVICES_STORE);
		const getReq = store.get(id);
		getReq.onsuccess = () => {
			if (getReq.result) {
				store.delete(id);
				tx.oncomplete = () => resolve(false);
			} else {
				store.put(plain);
				tx.oncomplete = () => resolve(true);
			}
		};
		getReq.onerror = () => reject(getReq.error);
		tx.onerror = () => reject(tx.error);
	});
}
