import { describe, it, expect, vi, beforeEach } from 'vitest';

// $env/dynamic/private and $lib/tmdb are SvelteKit path aliases / virtual modules that
// don't exist as real files outside the SvelteKit build — vi.mock intercepts the exact
// specifier text before real resolution is attempted, so no alias config is needed here.
vi.mock('$env/dynamic/private', () => ({ env: { TMDB_API_KEY: 'test-key' } }));

const searchMulti = vi.fn();
const getWatchProviders = vi.fn();
const getRuntime = vi.fn();
const augmentProviders = vi.fn();

vi.mock('$lib/tmdb', () => ({
	searchMulti: (...args: unknown[]) => searchMulti(...args),
	getWatchProviders: (...args: unknown[]) => getWatchProviders(...args),
	getRuntime: (...args: unknown[]) => getRuntime(...args),
	augmentProviders: (...args: unknown[]) => augmentProviders(...args)
}));

const { load } = await import('./+page.server');

interface LoadResult {
	results: Array<Record<string, unknown>>;
	query: string;
	error: string | null;
}

// PageServerLoad's generated return type doesn't narrow to a concrete shape when the
// function is called directly outside SvelteKit's own request pipeline (it resolves to
// a generic PageData union) — assert the shape we know the function actually returns,
// same as any other unit test of a function whose declared type is broader than one
// specific call site needs.
async function runLoad(q: string): Promise<LoadResult> {
	return load({ url: urlFor(q) } as Parameters<typeof load>[0]) as unknown as Promise<LoadResult>;
}

function urlFor(q: string): URL {
	return new URL(`http://localhost/add${q ? `?q=${encodeURIComponent(q)}` : ''}`);
}

beforeEach(() => {
	searchMulti.mockReset();
	getWatchProviders.mockReset();
	getRuntime.mockReset();
	augmentProviders.mockReset();
});

describe('/add server load', () => {
	it('returns an empty, error-free result when there is no query — and never calls TMDB', async () => {
		const result = await runLoad('');
		expect(result).toEqual({ results: [], query: '', error: null });
		expect(searchMulti).not.toHaveBeenCalled();
	});

	it('surfaces a TMDB search failure as an inline error instead of throwing', async () => {
		searchMulti.mockRejectedValue(new Error('network down'));
		const result = await runLoad('inception');
		expect(result.error).toBe('Could not reach TMDB. Please try again.');
		expect(result.results).toEqual([]);
		expect(result.query).toBe('inception');
	});

	it('surfaces a per-title provider/runtime failure the same way', async () => {
		searchMulti.mockResolvedValue([
			{ id: 27205, media_type: 'movie', title: 'Inception', release_date: '2010-07-16' }
		]);
		getWatchProviders.mockRejectedValue(new Error('boom'));
		getRuntime.mockResolvedValue({
			runtime_minutes: 148,
			seasons: [],
			networkIds: [],
			companyIds: [],
			release: null,
			genres: [],
			cast: [],
			director: null,
			creator: null
		});

		const result = await runLoad('inception');
		expect(result.error).toBe('Could not reach TMDB. Please try again.');
		expect(result.results).toEqual([]);
	});

	it('returns matched results on the happy path, with no error', async () => {
		searchMulti.mockResolvedValue([
			{
				id: 27205,
				media_type: 'movie',
				title: 'Inception',
				poster_path: '/x.jpg',
				overview: 'A thief...',
				release_date: '2010-07-16'
			}
		]);
		getWatchProviders.mockResolvedValue({
			providers: [{ provider_id: 8, provider_name: 'Netflix', logo_path: '/n.png' }],
			rentable: false
		});
		getRuntime.mockResolvedValue({
			runtime_minutes: 148,
			seasons: [],
			networkIds: [],
			companyIds: [],
			release: null,
			genres: ['Sci-Fi'],
			cast: [],
			director: 'Christopher Nolan',
			creator: null
		});
		augmentProviders.mockReturnValue([
			{ provider_id: 8, provider_name: 'Netflix', logo_path: '/n.png' }
		]);

		const result = await runLoad('inception');
		expect(result.error).toBeNull();
		expect(result.results).toHaveLength(1);
		expect(result.results[0]).toMatchObject({
			id: 27205,
			media_type: 'movie',
			title: 'Inception',
			year: '2010',
			runtime_minutes: 148,
			director: 'Christopher Nolan'
		});
	});

	it('truncates results to the first 8 matches', async () => {
		searchMulti.mockResolvedValue(
			Array.from({ length: 12 }, (_, i) => ({ id: i, media_type: 'movie', title: `Title ${i}` }))
		);
		getWatchProviders.mockResolvedValue({ providers: [], rentable: false });
		getRuntime.mockResolvedValue({
			runtime_minutes: 90,
			seasons: [],
			networkIds: [],
			companyIds: [],
			release: null,
			genres: [],
			cast: [],
			director: null,
			creator: null
		});
		augmentProviders.mockReturnValue([]);

		const result = await runLoad('title');
		expect(result.results).toHaveLength(8);
	});
});
