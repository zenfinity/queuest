import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import * as db from './db';
import type { WatchlistItem, Provider } from './types';
import { makeNewItem as makeItem } from './test-fixtures';

// db.ts caches a single open IDBDatabase connection for the module's lifetime and
// never closes it, so deleting/recreating the database between tests would queue
// behind that open connection and hang. Clearing both stores through the module's
// own functions keeps one long-lived connection and avoids that entirely.
beforeEach(async () => {
	await db.replaceAll([]);
	await db.setServices([]);
});

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

	it('getItemByTmdbId finds the row a duplicate add collided with', async () => {
		await db.addItem(makeItem({ tmdb_id: 1, media_type: 'movie', title: 'Arrival' }));
		const found = await db.getItemByTmdbId(1, 'movie');
		expect(found?.title).toBe('Arrival');
	});

	it('getItemByTmdbId returns undefined when there is no match', async () => {
		expect(await db.getItemByTmdbId(999, 'movie')).toBeUndefined();
	});

	it('removes an item by id', async () => {
		await db.addItem(makeItem());
		const [{ id }] = await db.getAll();
		await db.removeItem(id);
		expect(await db.getAll()).toEqual([]);
	});

	it('removeItem is a no-op for an id that does not exist', async () => {
		await expect(db.removeItem(999)).resolves.toBeUndefined();
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
		await db.updateShowProgress(id, [1, 2]);
		const item = (await db.getAll())[0];
		expect(item.watched_seasons).toEqual([1, 2]);
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
			added_at: new Date().toISOString(),
			watched_at: null
		};
		await db.replaceAll([replacement]);
		const all = await db.getAll();
		expect(all).toHaveLength(1);
		expect(all[0].title).toBe('New');
	});

	it('rejects setWatched when id does not exist', async () => {
		await expect(db.setWatched(999, true)).rejects.toThrow('Item with id 999 not found');
	});

	it('rejects updateShowProgress when id does not exist', async () => {
		await expect(db.updateShowProgress(999, [1, 2])).rejects.toThrow('Item with id 999 not found');
	});

	it('rejects setQueueTag when id does not exist', async () => {
		await expect(db.setQueueTag(999, 'Favorites')).rejects.toThrow('Item with id 999 not found');
	});

	it('stamps updated_at on add', async () => {
		await db.addItem(makeItem());
		const item = (await db.getAll())[0];
		expect(typeof item.updated_at).toBe('string');
	});

	it('bumps updated_at on setWatched, updateShowProgress, and setQueueTag', async () => {
		await db.addItem(makeItem({ media_type: 'tv' }));
		const [{ id }] = await db.getAll();

		await db.setWatched(id, true);
		let item = (await db.getAll())[0];
		expect(typeof item.updated_at).toBe('string');

		await db.updateShowProgress(id, [1]);
		item = (await db.getAll())[0];
		expect(typeof item.updated_at).toBe('string');

		await db.setQueueTag(id, 'Favorites');
		item = (await db.getAll())[0];
		expect(typeof item.updated_at).toBe('string');
	});

	it('does not stamp updated_at from patchProviders', async () => {
		await db.addItem(makeItem());
		const [{ id, updated_at: original }] = await db.getAll();
		await db.patchProviders(id, [], false, null);
		const item = (await db.getAll())[0];
		expect(item.updated_at).toBe(original);
	});

	it('patchProviders persists providers, rentable, release, and the optional fields', async () => {
		await db.addItem(makeItem({ media_type: 'tv' }));
		const [{ id }] = await db.getAll();
		const providers: Provider[] = [
			{ provider_id: 8, provider_name: 'Netflix', logo_path: '/n.png' }
		];
		const release = {
			theatrical_date: null,
			digital_date: '2026-06-01'
		} as WatchlistItem['release'];
		const seasons = [{ season_number: 1, episode_count: 8, name: 'S1', runtime_minutes: 240 }];

		await db.patchProviders(
			id,
			providers,
			true,
			release,
			seasons,
			240,
			['Drama'],
			[{ name: 'Actor', character: 'Lead', profile_path: null }],
			'Director Name',
			'Creator Name',
			'tt0111161'
		);

		const item = (await db.getAll())[0];
		expect(item.providers).toEqual(providers);
		expect(item.rentable).toBe(true);
		expect(item.release).toEqual(release);
		expect(item.seasons).toEqual(seasons);
		expect(item.runtime_minutes).toBe(240);
		expect(item.genres).toEqual(['Drama']);
		expect(item.cast).toEqual([{ name: 'Actor', character: 'Lead', profile_path: null }]);
		expect(item.director).toBe('Director Name');
		expect(item.creator).toBe('Creator Name');
		expect(item.imdb_id).toBe('tt0111161');
	});

	it('patchProviders leaves seasons/runtime untouched when not provided', async () => {
		await db.addItem(makeItem({ media_type: 'tv', runtime_minutes: 100 }));
		const [{ id }] = await db.getAll();
		await db.updateShowProgress(id, []); // no-op, just to have a stable baseline
		await db.patchProviders(id, [], false, null, [], null);
		const item = (await db.getAll())[0];
		expect(item.seasons).toEqual([]);
		expect(item.runtime_minutes).toBe(100);
	});

	it('rejects patchProviders when id does not exist', async () => {
		await expect(db.patchProviders(999, [], false, null)).rejects.toThrow(
			'Item with id 999 not found'
		);
	});
});

describe('db: soft-delete tombstones', () => {
	it('removeItem sets deleted_at and updated_at instead of deleting the row', async () => {
		await db.addItem(makeItem({ title: 'Arrival' }));
		const [{ id }] = await db.getAll();

		await db.removeItem(id);

		const all = await db.getAllIncludingDeleted();
		expect(all).toHaveLength(1);
		expect(all[0].title).toBe('Arrival');
		expect(typeof all[0].deleted_at).toBe('string');
		expect(typeof all[0].updated_at).toBe('string');
	});

	it('getAll() excludes tombstoned items', async () => {
		await db.addItem(makeItem({ title: 'Arrival' }));
		const [{ id }] = await db.getAll();
		await db.removeItem(id);

		expect(await db.getAll()).toEqual([]);
	});

	it('getAllIncludingDeleted() returns tombstoned items alongside live ones', async () => {
		await db.addItem(makeItem({ tmdb_id: 1, title: 'Live' }));
		await db.addItem(makeItem({ tmdb_id: 2, title: 'Deleted' }));
		const all = await db.getAll();
		const toDelete = all.find((i) => i.title === 'Deleted')!;
		await db.removeItem(toDelete.id);

		const everything = await db.getAllIncludingDeleted();
		expect(everything).toHaveLength(2);
		expect(everything.map((i) => i.title).sort()).toEqual(['Deleted', 'Live']);
	});

	it('gcTombstones removes tombstones older than the 90-day horizon', async () => {
		await db.addItem(makeItem({ title: 'Old deletion' }));
		const [{ id }] = await db.getAll();
		await db.removeItem(id);

		const ninetyOneDaysLater = new Date(Date.now() + 91 * 24 * 60 * 60 * 1000);
		const removed = await db.gcTombstones(ninetyOneDaysLater);

		expect(removed).toBe(1);
		expect(await db.getAllIncludingDeleted()).toEqual([]);
	});

	it('gcTombstones leaves tombstones within the horizon alone', async () => {
		await db.addItem(makeItem({ title: 'Recent deletion' }));
		const [{ id }] = await db.getAll();
		await db.removeItem(id);

		const oneDayLater = new Date(Date.now() + 24 * 60 * 60 * 1000);
		const removed = await db.gcTombstones(oneDayLater);

		expect(removed).toBe(0);
		expect(await db.getAllIncludingDeleted()).toHaveLength(1);
	});

	it('gcTombstones leaves live items alone', async () => {
		await db.addItem(makeItem({ title: 'Still here' }));

		const farFuture = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
		const removed = await db.gcTombstones(farFuture);

		expect(removed).toBe(0);
		expect(await db.getAll()).toHaveLength(1);
	});
});

describe('db: collection tag bulk updates', () => {
	it('renameCollectionTag updates matching non-deleted items and bumps updated_at', async () => {
		await db.addItem(makeItem({ tmdb_id: 1, title: 'A', queue_tag: 'Action' }));
		await db.addItem(makeItem({ tmdb_id: 2, title: 'B', queue_tag: 'Drama' }));

		await db.renameCollectionTag('Action', 'Thrillers');

		const after = await db.getAll();
		expect(after.find((i) => i.title === 'A')!.queue_tag).toBe('Thrillers');
		expect(after.find((i) => i.title === 'B')!.queue_tag).toBe('Drama');
		expect(typeof after.find((i) => i.title === 'A')!.updated_at).toBe('string');
	});

	it('renameCollectionTag does not touch tombstoned items', async () => {
		await db.addItem(makeItem({ tmdb_id: 1, title: 'Deleted', queue_tag: 'Action' }));
		const [{ id }] = await db.getAll();
		await db.removeItem(id);

		await db.renameCollectionTag('Action', 'Thrillers');

		const tombstone = (await db.getAllIncludingDeleted())[0];
		expect(tombstone.queue_tag).toBe('Action');
	});

	it('renameCollectionTag preserves tombstones sitting in the store', async () => {
		await db.addItem(makeItem({ tmdb_id: 1, title: 'Live', queue_tag: 'Action' }));
		await db.addItem(makeItem({ tmdb_id: 2, title: 'Deleted' }));
		const all = await db.getAll();
		await db.removeItem(all.find((i) => i.title === 'Deleted')!.id);

		await db.renameCollectionTag('Action', 'Thrillers');

		expect(await db.getAllIncludingDeleted()).toHaveLength(2);
	});

	it('clearCollectionTag clears matching non-deleted items', async () => {
		await db.addItem(makeItem({ tmdb_id: 1, title: 'A', queue_tag: 'Action' }));
		await db.addItem(makeItem({ tmdb_id: 2, title: 'B', queue_tag: 'Drama' }));

		await db.clearCollectionTag('Action');

		const after = await db.getAll();
		expect(after.find((i) => i.title === 'A')!.queue_tag).toBeUndefined();
		expect(after.find((i) => i.title === 'B')!.queue_tag).toBe('Drama');
	});

	it('clearCollectionTag preserves tombstones sitting in the store', async () => {
		await db.addItem(makeItem({ tmdb_id: 1, title: 'Live', queue_tag: 'Action' }));
		await db.addItem(makeItem({ tmdb_id: 2, title: 'Deleted', queue_tag: 'Action' }));
		const all = await db.getAll();
		await db.removeItem(all.find((i) => i.title === 'Deleted')!.id);

		await db.clearCollectionTag('Action');

		expect(await db.getAllIncludingDeleted()).toHaveLength(2);
	});
});

describe('db: custom sort order (#216)', () => {
	it('assigns each new item a later sort_order than the last', async () => {
		await db.addItem(makeItem({ tmdb_id: 1, title: 'A' }));
		await db.addItem(makeItem({ tmdb_id: 2, title: 'B' }));
		await db.addItem(makeItem({ tmdb_id: 3, title: 'C' }));

		const all = await db.getAll();
		const a = all.find((i) => i.title === 'A')!;
		const b = all.find((i) => i.title === 'B')!;
		const c = all.find((i) => i.title === 'C')!;
		expect(a.sort_order).toBeLessThan(b.sort_order!);
		expect(b.sort_order).toBeLessThan(c.sort_order!);
	});

	it('setSortOrder renumbers the given ids to match their array position', async () => {
		await db.addItem(makeItem({ tmdb_id: 1, title: 'A' }));
		await db.addItem(makeItem({ tmdb_id: 2, title: 'B' }));
		await db.addItem(makeItem({ tmdb_id: 3, title: 'C' }));
		const [a, b, c] = await db.getAll();

		await db.setSortOrder([c.id, a.id, b.id]);

		const after = await db.getAll();
		expect(after.find((i) => i.id === c.id)!.sort_order).toBe(0);
		expect(after.find((i) => i.id === a.id)!.sort_order).toBe(1);
		expect(after.find((i) => i.id === b.id)!.sort_order).toBe(2);
	});

	it('setSortOrder bumps updated_at on every reordered item', async () => {
		await db.addItem(makeItem({ tmdb_id: 1, title: 'A' }));
		const [a] = await db.getAll();

		await db.setSortOrder([a.id]);

		expect(typeof (await db.getAll())[0].updated_at).toBe('string');
	});

	it('setSortOrder leaves ids outside the list untouched', async () => {
		await db.addItem(makeItem({ tmdb_id: 1, title: 'A' }));
		await db.addItem(makeItem({ tmdb_id: 2, title: 'B' }));
		const [a, b] = await db.getAll();

		await db.setSortOrder([a.id]);

		expect((await db.getAll()).find((i) => i.id === b.id)!.sort_order).toBe(b.sort_order);
	});
});

describe('db: meta store', () => {
	it('returns undefined for an unset key', async () => {
		expect(await db.getMeta('nope')).toBeUndefined();
	});

	it('sets and gets a value', async () => {
		await db.setMeta('cursor', '42');
		expect(await db.getMeta('cursor')).toBe('42');
	});

	it('getDeviceId generates and persists a stable id', async () => {
		const first = await db.getDeviceId();
		const second = await db.getDeviceId();
		expect(first).toBe(second);
		expect(typeof first).toBe('string');
		expect(first.length).toBeGreaterThan(0);
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
