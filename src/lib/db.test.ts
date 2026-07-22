import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import * as db from './db';
import type { WatchlistItem, Provider } from './types';

// db.ts caches a single open IDBDatabase connection for the module's lifetime and
// never closes it, so deleting/recreating the database between tests would queue
// behind that open connection and hang. Clearing both stores through the module's
// own functions keeps one long-lived connection and avoids that entirely.
beforeEach(async () => {
	await db.replaceAll([]);
	await db.setServices([]);
});

function makeItem(overrides: Partial<Omit<WatchlistItem, 'id' | 'added_at' | 'watched_at'>> = {}) {
	return {
		tmdb_id: 100,
		media_type: 'movie' as const,
		title: 'Test Title',
		poster_path: null,
		overview: null,
		providers: [],
		runtime_minutes: 100,
		seasons: [],
		watched_seasons: [],
		current_season: null,
		current_episode: null,
		...overrides
	};
}

describe('db: watchlist items', () => {
	it('starts empty', async () => {
		expect(await db.getAll()).toEqual([]);
	});

	it('adds and retrieves an item', async () => {
		await db.addItem(makeItem({ title: 'Arrival' }));
		const all = await db.getAll();
		expect(all).toHaveLength(1);
		expect(all[0].title).toBe('Arrival');
		expect(all[0].watched_at).toBeNull();
		expect(typeof all[0].added_at).toBe('string');
	});

	it('rejects a duplicate tmdb_id + media_type pair', async () => {
		await db.addItem(makeItem({ tmdb_id: 1, media_type: 'movie' }));
		await expect(db.addItem(makeItem({ tmdb_id: 1, media_type: 'movie' }))).rejects.toThrow();
	});

	it('allows the same tmdb_id across different media types', async () => {
		await db.addItem(makeItem({ tmdb_id: 1, media_type: 'movie' }));
		await db.addItem(makeItem({ tmdb_id: 1, media_type: 'tv' }));
		expect(await db.getAll()).toHaveLength(2);
	});

	it('removes an item by id', async () => {
		await db.addItem(makeItem());
		const [{ id }] = await db.getAll();
		await db.removeItem(id);
		expect(await db.getAll()).toEqual([]);
	});

	it('sets and clears watched_at', async () => {
		await db.addItem(makeItem());
		const [{ id }] = await db.getAll();

		await db.setWatched(id, true);
		let item = (await db.getAll())[0];
		expect(item.watched_at).not.toBeNull();

		await db.setWatched(id, false);
		item = (await db.getAll())[0];
		expect(item.watched_at).toBeNull();
	});

	it('updates show progress', async () => {
		await db.addItem(makeItem({ media_type: 'tv' }));
		const [{ id }] = await db.getAll();
		await db.updateShowProgress(id, [1, 2], 3, 5);
		const item = (await db.getAll())[0];
		expect(item.watched_seasons).toEqual([1, 2]);
		expect(item.current_season).toBe(3);
		expect(item.current_episode).toBe(5);
	});

	it('replaceAll clears existing items and inserts the given ones', async () => {
		await db.addItem(makeItem({ title: 'Old' }));
		const replacement: WatchlistItem = {
			id: 99,
			tmdb_id: 5,
			media_type: 'movie',
			title: 'New',
			poster_path: null,
			overview: null,
			providers: [],
			runtime_minutes: 90,
			seasons: [],
			watched_seasons: [],
			current_season: null,
			current_episode: null,
			added_at: new Date().toISOString(),
			watched_at: null
		};
		await db.replaceAll([replacement]);
		const all = await db.getAll();
		expect(all).toHaveLength(1);
		expect(all[0].title).toBe('New');
	});
});

describe('db: services (subscribed providers)', () => {
	const netflix: Provider = { provider_id: 8, provider_name: 'Netflix', logo_path: '/n.png' };
	const hulu: Provider = { provider_id: 15, provider_name: 'Hulu', logo_path: '/h.png' };

	it('starts with no subscribed services', async () => {
		expect(await db.getServices()).toEqual([]);
	});

	it('toggleService adds a service the first time and reports true', async () => {
		const nowSubscribed = await db.toggleService(netflix);
		expect(nowSubscribed).toBe(true);
		expect(await db.getServices()).toEqual([netflix]);
	});

	it('toggleService removes an already-subscribed service and reports false', async () => {
		await db.toggleService(netflix);
		const nowSubscribed = await db.toggleService(netflix);
		expect(nowSubscribed).toBe(false);
		expect(await db.getServices()).toEqual([]);
	});

	it('tracks multiple subscribed services independently', async () => {
		await db.toggleService(netflix);
		await db.toggleService(hulu);
		const services = await db.getServices();
		expect(services.map((s) => s.provider_id).sort((a, b) => a - b)).toEqual([8, 15]);
	});

	it('setServices replaces the whole set', async () => {
		await db.toggleService(netflix);
		await db.setServices([hulu]);
		expect(await db.getServices()).toEqual([hulu]);
	});
});
