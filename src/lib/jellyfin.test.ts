import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as db from './db';
import {
	normalizeServerUrl,
	libraryKeysFrom,
	fetchLibraryKeys,
	itemsToMark,
	runLibraryCheck,
	connectAndCheck,
	maybeAutoCheck,
	setJellyfinConfig,
	getJellyfinConfig,
	clearJellyfinConfig,
	getLastCheck,
	AUTO_CHECK_INTERVAL_MS,
	JellyfinError
} from './jellyfin';
import { makeItem, makeNewItem } from './test-fixtures';

const CONFIG = { url: 'https://media.tail1234.ts.net', token: 'abc123' };

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json' }
	});
}

beforeEach(async () => {
	await db.replaceAll([]);
	await clearJellyfinConfig();
});

describe('normalizeServerUrl', () => {
	it('accepts a ts.net https address and strips the trailing slash', () => {
		expect(normalizeServerUrl(' https://media.tail1234.ts.net/ ')).toEqual({
			url: 'https://media.tail1234.ts.net'
		});
	});

	it('keeps a port and a path prefix', () => {
		expect(normalizeServerUrl('https://media.tail1234.ts.net:8920/jellyfin/')).toEqual({
			url: 'https://media.tail1234.ts.net:8920/jellyfin'
		});
	});

	it('rejects http, non-Tailscale hosts, junk, and embedded credentials', () => {
		expect(normalizeServerUrl('http://media.tail1234.ts.net')).toHaveProperty('error');
		expect(normalizeServerUrl('https://jellyfin.example.com')).toHaveProperty('error');
		expect(normalizeServerUrl('https://evil-ts.net')).toHaveProperty('error');
		expect(normalizeServerUrl('not a url')).toHaveProperty('error');
		expect(normalizeServerUrl('https://u:p@media.tail1234.ts.net')).toHaveProperty('error');
	});
});

describe('libraryKeysFrom', () => {
	it('maps movies and series by TMDB id, plus IMDb ids, case-insensitively', () => {
		expect(
			libraryKeysFrom([
				{ Type: 'Movie', ProviderIds: { Tmdb: '550', Imdb: 'tt0137523' } },
				{ Type: 'Series', ProviderIds: { tmdb: '1399' } },
				{ Type: 'Episode', ProviderIds: { Tmdb: '999' } },
				{ Type: 'Movie', ProviderIds: { Tmdb: 'not-a-number', Imdb: 'bogus' } },
				{ Type: 'Movie' }
			])
		).toEqual(['movie:550', 'imdb:tt0137523', 'tv:1399']);
	});
});

describe('fetchLibraryKeys', () => {
	it('sends the token and pages through the whole library', async () => {
		const page1 = Array.from({ length: 1000 }, (_, i) => ({
			Type: 'Movie',
			ProviderIds: { Tmdb: String(i + 1) }
		}));
		const page2 = [{ Type: 'Series', ProviderIds: { Tmdb: '1399' } }];
		const fetchFn = vi
			.fn()
			.mockResolvedValueOnce(jsonResponse({ Items: page1, TotalRecordCount: 1001 }))
			.mockResolvedValueOnce(jsonResponse({ Items: page2, TotalRecordCount: 1001 }));

		const result = await fetchLibraryKeys(CONFIG, fetchFn);

		expect(result.count).toBe(1001);
		expect(result.keys.has('movie:1')).toBe(true);
		expect(result.keys.has('tv:1399')).toBe(true);
		expect(fetchFn).toHaveBeenCalledTimes(2);
		const [url, init] = fetchFn.mock.calls[1];
		expect(url).toContain('https://media.tail1234.ts.net/Items?');
		expect(url).toContain('StartIndex=1000');
		// Without this, movies inside a collection come back as one BoxSet
		// and never match (the Ghostbusters 2016 bug).
		expect(new URL(url).searchParams.get('CollapseBoxSetItems')).toBe('false');
		expect(init.headers.Authorization).toBe('MediaBrowser Token="abc123"');
	});

	it('explains a rejected token', async () => {
		const fetchFn = vi.fn().mockResolvedValue(new Response('', { status: 401 }));
		await expect(fetchLibraryKeys(CONFIG, fetchFn)).rejects.toThrow(/rejected the token/);
	});

	it('explains an unreachable server', async () => {
		const fetchFn = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
		await expect(fetchLibraryKeys(CONFIG, fetchFn)).rejects.toBeInstanceOf(JellyfinError);
		await expect(fetchLibraryKeys(CONFIG, fetchFn)).rejects.toThrow(/Tailscale/);
	});
});

describe('itemsToMark', () => {
	it('matches by type+TMDB id or IMDb id and skips already-marked items', () => {
		const keys = new Set(['movie:550', 'imdb:tt0903747', 'tv:1399']);
		const items = [
			makeItem({ id: 1, tmdb_id: 550, media_type: 'movie' }),
			makeItem({ id: 2, tmdb_id: 550, media_type: 'tv' }), // same number, wrong type
			makeItem({ id: 3, tmdb_id: 1396, media_type: 'tv', imdb_id: 'tt0903747' }),
			makeItem({
				id: 4,
				tmdb_id: 1399,
				media_type: 'tv',
				in_library_at: '2026-01-01T00:00:00.000Z'
			})
		];
		expect(itemsToMark(items, keys).map((i) => i.id)).toEqual([1, 3]);
	});
});

describe('runLibraryCheck', () => {
	it('does nothing when not configured', async () => {
		const fetchFn = vi.fn();
		expect(await runLibraryCheck(fetchFn)).toBeNull();
		expect(fetchFn).not.toHaveBeenCalled();
	});

	it('marks matches, leaves others alone, and records the check time', async () => {
		await db.addItem(makeNewItem({ tmdb_id: 550, media_type: 'movie', title: 'In library' }));
		await db.addItem(makeNewItem({ tmdb_id: 600, media_type: 'movie', title: 'Not in library' }));
		await setJellyfinConfig(CONFIG);
		const fetchFn = vi.fn().mockResolvedValue(
			jsonResponse({
				Items: [{ Type: 'Movie', ProviderIds: { Tmdb: '550' } }],
				TotalRecordCount: 1
			})
		);

		const result = await runLibraryCheck(fetchFn);

		// Sync is off in this test, so there are no shared lists to check.
		expect(result).toEqual({ libraryCount: 1, newlyMarked: 1, sharedMarked: 0 });
		const byTitle = Object.fromEntries((await db.getAll()).map((i) => [i.title, i]));
		expect(byTitle['In library'].in_library_at).toEqual(expect.any(String));
		expect(byTitle['Not in library'].in_library_at).toBeUndefined();
		expect(await getLastCheck()).toEqual(expect.any(String));
	});
});

describe('connectAndCheck', () => {
	it('saves nothing when the first check fails', async () => {
		const fetchFn = vi.fn().mockResolvedValue(new Response('', { status: 401 }));
		await expect(connectAndCheck(CONFIG, fetchFn)).rejects.toThrow(/rejected the token/);
		expect(await getJellyfinConfig()).toBeNull();
	});

	it('saves the connection and marks matches once the check works', async () => {
		await db.addItem(makeNewItem({ tmdb_id: 550, media_type: 'movie' }));
		const fetchFn = vi.fn().mockResolvedValue(
			jsonResponse({
				Items: [{ Type: 'Movie', ProviderIds: { Tmdb: '550' } }],
				TotalRecordCount: 1
			})
		);

		const result = await connectAndCheck(CONFIG, fetchFn);

		expect(result).toEqual({ libraryCount: 1, newlyMarked: 1, sharedMarked: 0 });
		expect(await getJellyfinConfig()).toEqual(CONFIG);
	});
});

describe('maybeAutoCheck', () => {
	it('skips when the last check is recent, runs when it is stale, and never throws', async () => {
		await setJellyfinConfig(CONFIG);
		const fetchSpy = vi
			.spyOn(globalThis, 'fetch')
			.mockResolvedValue(jsonResponse({ Items: [], TotalRecordCount: 0 }));

		await maybeAutoCheck();
		expect(fetchSpy).toHaveBeenCalledTimes(1);

		await maybeAutoCheck();
		expect(fetchSpy).toHaveBeenCalledTimes(1);

		await maybeAutoCheck(new Date(Date.now() + AUTO_CHECK_INTERVAL_MS + 1000));
		expect(fetchSpy).toHaveBeenCalledTimes(2);

		fetchSpy.mockRejectedValue(new TypeError('Failed to fetch'));
		await expect(
			maybeAutoCheck(new Date(Date.now() + 2 * AUTO_CHECK_INTERVAL_MS))
		).resolves.toBeUndefined();
		fetchSpy.mockRestore();
	});
});

describe('config storage', () => {
	it('saves, reads, and clears the config', async () => {
		await setJellyfinConfig(CONFIG);
		expect(await getJellyfinConfig()).toEqual(CONFIG);
		await clearJellyfinConfig();
		expect(await getJellyfinConfig()).toBeNull();
	});
});

describe('db.markInLibrary', () => {
	it('marks listed items once and skips tombstoned rows', async () => {
		await db.addItem(makeNewItem({ tmdb_id: 1, title: 'A' }));
		await db.addItem(makeNewItem({ tmdb_id: 2, title: 'B' }));
		const [a, b] = await db.getAll();
		await db.removeItem(b.id);

		await db.markInLibrary([a.id, b.id]);
		const firstMark = (await db.getAll())[0].in_library_at;
		expect(firstMark).toEqual(expect.any(String));
		const tomb = (await db.getAllIncludingDeleted()).find((i) => i.id === b.id);
		expect(tomb?.in_library_at).toBeUndefined();

		await db.markInLibrary([a.id]);
		expect((await db.getAll())[0].in_library_at).toBe(firstMark);
	});
});
