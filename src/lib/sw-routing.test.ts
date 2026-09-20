import { describe, it, expect } from 'vitest';
import { classify, normalizeShellPath, type RouteInput } from './sw-routing';

const ORIGIN = 'https://queuest.example';
const PRECACHE = new Set([
	'/_app/immutable/entry/start.abc123.js',
	'/_app/immutable/assets/0.def456.css',
	'/theme-init.js',
	'/manifest.json'
]);

function input(url: string, overrides: Partial<RouteInput> = {}): RouteInput {
	return {
		method: 'GET',
		mode: 'cors',
		url: new URL(url),
		origin: ORIGIN,
		precache: PRECACHE,
		...overrides
	};
}

describe('classify', () => {
	describe('never intercepts data or API requests', () => {
		it.each([
			'/api/sync/blob',
			'/api/account',
			'/api/collections/abc/blob',
			'/api/search-suggestions?q=arrival',
			'/add/__data.json',
			'/__data.json',
			'/_app/version.json'
		])('%s -> passthrough', (path) => {
			expect(classify(input(`${ORIGIN}${path}`))).toBe('passthrough');
		});

		it('keeps /api/* out even as a navigation', () => {
			expect(classify(input(`${ORIGIN}/api/account`, { mode: 'navigate' }))).toBe('passthrough');
		});

		it('keeps __data.json out even if it were somehow in the precache', () => {
			const precache = new Set([...PRECACHE, '/add/__data.json', '/api/sync/blob']);
			expect(classify(input(`${ORIGIN}/add/__data.json`, { precache }))).toBe('passthrough');
			expect(classify(input(`${ORIGIN}/api/sync/blob`, { precache }))).toBe('passthrough');
		});
	});

	describe('only ever handles GET', () => {
		it.each(['POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'])('%s -> passthrough', (method) => {
			expect(classify(input(`${ORIGIN}/api/sync/blob`, { method }))).toBe('passthrough');
			expect(classify(input(`${ORIGIN}/app`, { method, mode: 'navigate' }))).toBe('passthrough');
			expect(classify(input(`${ORIGIN}/theme-init.js`, { method }))).toBe('passthrough');
		});
	});

	describe('page navigations', () => {
		it.each(['/', '/app', '/add', '/lists', '/budget', '/settings'])('%s -> shell', (path) => {
			expect(classify(input(`${ORIGIN}${path}`, { mode: 'navigate' }))).toBe('shell');
		});

		it('ignores query strings and trailing slashes when matching a shell', () => {
			expect(classify(input(`${ORIGIN}/app?__e2e=1`, { mode: 'navigate' }))).toBe('shell');
			expect(classify(input(`${ORIGIN}/add?q=arrival`, { mode: 'navigate' }))).toBe('shell');
			expect(classify(input(`${ORIGIN}/lists/`, { mode: 'navigate' }))).toBe('shell');
		});

		it.each(['/share/abc123', '/lists/join/tok', '/collections/xyz', '/nope'])(
			'%s -> navigation (offline page fallback, not a shell)',
			(path) => {
				expect(classify(input(`${ORIGIN}${path}`, { mode: 'navigate' }))).toBe('navigation');
			}
		);

		it('does not treat a prefix of a shell as that shell', () => {
			expect(classify(input(`${ORIGIN}/application`, { mode: 'navigate' }))).toBe('navigation');
			expect(classify(input(`${ORIGIN}/app/extra`, { mode: 'navigate' }))).toBe('navigation');
		});
	});

	describe('precached assets', () => {
		it('serves build and static assets in the precache list', () => {
			expect(classify(input(`${ORIGIN}/_app/immutable/entry/start.abc123.js`))).toBe('precache');
			expect(classify(input(`${ORIGIN}/_app/immutable/assets/0.def456.css`))).toBe('precache');
			expect(classify(input(`${ORIGIN}/theme-init.js`))).toBe('precache');
		});

		it('leaves same-origin assets that are not in the precache list to the network', () => {
			expect(classify(input(`${ORIGIN}/_app/immutable/entry/start.NEWHASH.js`))).toBe(
				'passthrough'
			);
			expect(classify(input(`${ORIGIN}/some-other-file.png`))).toBe('passthrough');
		});
	});

	describe('cross-origin', () => {
		it('leaves TMDB images to the browser (its HTTP cache already serves them offline)', () => {
			expect(
				classify(
					input('https://image.tmdb.org/t/p/w342/pPHpeI2X1qEd1CS1SeyrdhZ4qnT.jpg', {
						mode: 'no-cors'
					})
				)
			).toBe('passthrough');
		});

		it.each([
			'https://image.tmdb.org/other/path.jpg',
			'https://api.themoviedb.org/3/search/multi?query=x',
			'https://static.cloudflareinsights.com/beacon.min.js',
			'https://evil.example/t/p/w342/x.jpg'
		])('%s -> passthrough', (url) => {
			expect(classify(input(url, { mode: 'no-cors' }))).toBe('passthrough');
		});

		it('never treats a cross-origin navigation as a shell', () => {
			expect(classify(input('https://other.example/app', { mode: 'navigate' }))).toBe(
				'passthrough'
			);
		});
	});
});

describe('normalizeShellPath', () => {
	it('strips a single trailing slash but leaves the root alone', () => {
		expect(normalizeShellPath('/')).toBe('/');
		expect(normalizeShellPath('/app/')).toBe('/app');
		expect(normalizeShellPath('/app')).toBe('/app');
	});
});
