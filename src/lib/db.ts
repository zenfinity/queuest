import type { WatchlistItem } from './types';

const DB_NAME = 'streamq';
const STORE = 'watchlist';
const VERSION = 1;

function open(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const req = indexedDB.open(DB_NAME, VERSION);
		req.onupgradeneeded = (e) => {
			const db = (e.target as IDBOpenDBRequest).result;
			if (!db.objectStoreNames.contains(STORE)) {
				const store = db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
				store.createIndex('tmdb_media', ['tmdb_id', 'media_type'], { unique: true });
			}
		};
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error);
	});
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
		const full: Omit<WatchlistItem, 'id'> = {
			...item,
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

export async function updateShowProgress(
	id: number,
	watchedSeasons: number[],
	currentSeason: number | null,
	currentEpisode: number | null
): Promise<void> {
	const db = await open();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(STORE, 'readwrite');
		const store = tx.objectStore(STORE);
		const get = store.get(id);
		get.onsuccess = () => {
			const item = get.result as WatchlistItem;
			item.watched_seasons = watchedSeasons;
			item.current_season = currentSeason;
			item.current_episode = currentEpisode;
			const put = store.put(item);
			put.onsuccess = () => resolve();
			put.onerror = () => reject(put.error);
		};
		get.onerror = () => reject(get.error);
	});
}

export async function replaceAll(items: WatchlistItem[]): Promise<void> {
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
