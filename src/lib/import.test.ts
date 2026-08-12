import { describe, it, expect } from 'vitest';
import { parseTextList, parseLetterboxdCSV, parseImdbCSV, detectFormat } from './import';

describe('parseTextList', () => {
	it('parses simple titles', () => {
		const rows = parseTextList('Arrival\nBlade Runner');
		expect(rows).toHaveLength(2);
		expect(rows[0].title).toBe('Arrival');
		expect(rows[1].title).toBe('Blade Runner');
		expect(rows[0].mediaTypeHint).toBe('auto');
	});

	it('extracts trailing years', () => {
		const rows = parseTextList('Arrival 2016\nBlade Runner (1982)');
		expect(rows[0]).toEqual({ title: 'Arrival', year: '2016', mediaTypeHint: 'auto' });
		expect(rows[1]).toEqual({ title: 'Blade Runner', year: '1982', mediaTypeHint: 'auto' });
	});

	it('handles titles that are years (issue #118)', () => {
		const rows = parseTextList('1917\n2012\n1984\n300');
		expect(rows.map((r) => r.title)).toEqual(['1917', '2012', '1984', '300']);
		expect(rows.every((r) => r.year === null)).toBe(true);
	});

	it('skips empty lines and whitespace-only lines', () => {
		const rows = parseTextList('Arrival\n\n  \nBlade Runner');
		expect(rows).toHaveLength(2);
	});

	it('skips completed checkboxes', () => {
		const rows = parseTextList('Arrival\n[x] Blade Runner\n[X] Inception');
		expect(rows).toHaveLength(1);
		expect(rows[0].title).toBe('Arrival');
	});

	it('strips list decorators', () => {
		const rows = parseTextList('- Arrival\n* Blade Runner\n1. Inception\n> Arrival 2\n• Arrival 3');
		expect(rows).toHaveLength(5);
		expect(rows.map((r) => r.title)).toEqual([
			'Arrival',
			'Blade Runner',
			'Inception',
			'Arrival 2',
			'Arrival 3'
		]);
	});

	it('strips open checkbox markers', () => {
		const rows = parseTextList('[ ] Arrival');
		expect(rows).toHaveLength(1);
		expect(rows[0].title).toBe('Arrival');
	});

	it('strips emoji', () => {
		const rows = parseTextList('Arrival ✅\nBlade Runner 🎬');
		expect(rows.map((r) => r.title)).toEqual(['Arrival', 'Blade Runner']);
	});

	it('strips non-year parentheticals', () => {
		const rows = parseTextList("Arrival (2016)\nBlade Runner (Director's Cut)");
		expect(rows[0]).toEqual({ title: 'Arrival', year: '2016', mediaTypeHint: 'auto' });
		expect(rows[1]).toEqual({ title: 'Blade Runner', year: null, mediaTypeHint: 'auto' });
	});

	it('handles indented items', () => {
		const rows = parseTextList('  - Arrival\n    - Blade Runner');
		expect(rows).toHaveLength(2);
		expect(rows.map((r) => r.title)).toEqual(['Arrival', 'Blade Runner']);
	});

	it('strips completion dates', () => {
		const rows = parseTextList('Arrival 2024-02-01\nBlade Runner 1982 2024-02-01');
		expect(rows[0]).toEqual({ title: 'Arrival', year: null, mediaTypeHint: 'auto' });
		expect(rows[1]).toEqual({ title: 'Blade Runner', year: '1982', mediaTypeHint: 'auto' });
	});

	it('collapses multiple whitespace', () => {
		const rows = parseTextList('Arrival   2016');
		expect(rows[0].title).toBe('Arrival');
		expect(rows[0].year).toBe('2016');
	});

	it('rejects out-of-range years', () => {
		const rows = parseTextList('Film 1899\nFilm 2101');
		expect(rows.map((r) => r.title)).toEqual(['Film 1899', 'Film 2101']);
		expect(rows.every((r) => r.year === null)).toBe(true);
	});
});

describe('parseLetterboxdCSV', () => {
	it('parses letterboxd format', () => {
		const csv = 'name,year\nArrival,2016\nBlade Runner,1982';
		const rows = parseLetterboxdCSV(csv);
		expect(rows).toHaveLength(2);
		expect(rows[0]).toEqual({ title: 'Arrival', year: '2016', mediaTypeHint: 'movie' });
	});

	it('returns empty array for missing required columns', () => {
		const csv = 'title,year\nArrival,2016';
		const rows = parseLetterboxdCSV(csv);
		expect(rows).toEqual([]);
	});

	it('skips rows with empty titles', () => {
		const csv = 'name,year\nArrival,2016\n,2020';
		const rows = parseLetterboxdCSV(csv);
		expect(rows).toHaveLength(1);
	});

	it('handles missing year column', () => {
		const csv = 'name\nArrival\nBlade Runner';
		const rows = parseLetterboxdCSV(csv);
		expect(rows[0].year).toBeNull();
	});

	it('trims whitespace from headers and values', () => {
		const csv = ' name , year \n  Arrival  ,  2016  ';
		const rows = parseLetterboxdCSV(csv);
		expect(rows[0].title).toBe('Arrival');
		expect(rows[0].year).toBe('2016');
	});
});

describe('parseImdbCSV', () => {
	it('parses IMDb format', () => {
		const csv = 'title,year,title type\nArrival,2016,movie\nBreaking Bad,2008,tvseries';
		const rows = parseImdbCSV(csv);
		expect(rows).toHaveLength(2);
		expect(rows[0]).toEqual({ title: 'Arrival', year: '2016', mediaTypeHint: 'movie' });
		expect(rows[1]).toEqual({ title: 'Breaking Bad', year: '2008', mediaTypeHint: 'tv' });
	});

	it('classifies TV series correctly', () => {
		const csv =
			'title,year,title type\nBreaking Bad,2008,tvseries\nTrue Detective,2014,tvminiseries';
		const rows = parseImdbCSV(csv);
		expect(rows[0].mediaTypeHint).toBe('tv');
		expect(rows[1].mediaTypeHint).toBe('tv');
	});

	it('skips unwanted types', () => {
		const csv = 'title,year,title type\nFilm,2016,movie\nShort,2016,short\nVideo,2016,video';
		const rows = parseImdbCSV(csv);
		expect(rows).toHaveLength(1);
		expect(rows[0].title).toBe('Film');
	});

	it('handles missing title type column (issue #118)', () => {
		// When 'title type' column is missing, typeIdx is -1
		const csv = 'title,year,const\nArrival,2016,typeA\nBlade Runner,1982,typeB';
		const rows = parseImdbCSV(csv);
		expect(rows).toHaveLength(2);
		// Should default to 'movie' when typeIdx is -1
		expect(rows[0].mediaTypeHint).toBe('movie');
		expect(rows[1].mediaTypeHint).toBe('movie');
	});

	it('returns empty array for missing title column', () => {
		const csv = 'name,year,title type\nArrival,2016,movie';
		const rows = parseImdbCSV(csv);
		expect(rows).toEqual([]);
	});

	it('skips rows with empty titles', () => {
		const csv = 'title,year,title type\nArrival,2016,movie\n,2020,movie';
		const rows = parseImdbCSV(csv);
		expect(rows).toHaveLength(1);
	});

	it('handles missing year column', () => {
		const csv = 'title,title type\nArrival,movie';
		const rows = parseImdbCSV(csv);
		expect(rows[0].year).toBeNull();
	});

	it('handles CRLF line endings', () => {
		const csv = 'title,year,title type\r\nArrival,2016,movie\r\nBlade Runner,1982,movie';
		const rows = parseImdbCSV(csv);
		expect(rows).toHaveLength(2);
	});

	it('trims whitespace from values', () => {
		const csv = ' title , year , title type \n  Arrival  ,  2016  ,  movie  ';
		const rows = parseImdbCSV(csv);
		expect(rows[0].title).toBe('Arrival');
	});
});

describe('detectFormat', () => {
	it('detects letterboxd format', () => {
		const format = detectFormat(['Name', 'Letterboxd URI', 'Year']);
		expect(format).toBe('letterboxd');
	});

	it('detects IMDb format', () => {
		const format = detectFormat(['Title', 'Const', 'Title Type']);
		expect(format).toBe('imdb');
	});

	it('returns unknown for unrecognized formats', () => {
		const format = detectFormat(['Title', 'Year']);
		expect(format).toBe('unknown');
	});

	it('is case-insensitive', () => {
		const format = detectFormat(['LETTERBOXD URI', 'NAME']);
		expect(format).toBe('letterboxd');
	});
});
