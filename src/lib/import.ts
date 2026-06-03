export interface ImportRow {
	title: string;
	year: string | null;
	mediaTypeHint: 'movie' | 'tv' | 'auto';
}

export type ImportFormat = 'letterboxd' | 'imdb' | 'unknown';

// Handles quoted fields, escaped double-quotes, and CRLF/LF line endings
function parseCSV(text: string): string[][] {
	const src = text.startsWith('﻿') ? text.slice(1) : text; // strip BOM
	const rows: string[][] = [];
	let cols: string[] = [];
	let field = '';
	let inQ = false;

	for (let i = 0; i < src.length; i++) {
		const ch = src[i];
		if (inQ) {
			if (ch === '"' && src[i + 1] === '"') { field += '"'; i++; }
			else if (ch === '"') inQ = false;
			else field += ch;
		} else if (ch === '"') {
			inQ = true;
		} else if (ch === ',') {
			cols.push(field); field = '';
		} else if (ch === '\r' && src[i + 1] === '\n') {
			cols.push(field); rows.push(cols); cols = []; field = ''; i++;
		} else if (ch === '\n') {
			cols.push(field); rows.push(cols); cols = []; field = '';
		} else {
			field += ch;
		}
	}
	if (field || cols.length) { cols.push(field); if (cols.some(Boolean)) rows.push(cols); }
	return rows;
}

export function detectFormat(headers: string[]): ImportFormat {
	const h = headers.map((s) => s.trim().toLowerCase());
	if (h.includes('letterboxd uri')) return 'letterboxd';
	if (h.includes('const') && h.includes('title type')) return 'imdb';
	return 'unknown';
}

export function parseLetterboxdCSV(text: string): ImportRow[] {
	const rows = parseCSV(text);
	if (rows.length < 2) return [];
	const headers = rows[0].map((h) => h.trim().toLowerCase());
	const nameIdx = headers.indexOf('name');
	const yearIdx = headers.indexOf('year');
	if (nameIdx === -1) return [];
	return rows.slice(1)
		.filter((r) => r[nameIdx]?.trim())
		.map((r) => ({
			title: r[nameIdx].trim(),
			year: yearIdx !== -1 ? (r[yearIdx]?.trim() || null) : null,
			mediaTypeHint: 'movie' as const,
		}));
}

export function parseImdbCSV(text: string): ImportRow[] {
	const rows = parseCSV(text);
	if (rows.length < 2) return [];
	const headers = rows[0].map((h) => h.trim().toLowerCase());
	const titleIdx = headers.indexOf('title');
	const yearIdx = headers.indexOf('year');
	const typeIdx = headers.indexOf('title type');
	if (titleIdx === -1) return [];

	const TV_TYPES = new Set(['tvseries', 'tvminiseries', 'tvspecial']);
	const SKIP_TYPES = new Set(['short', 'tvshort', 'videogame', 'video']);

	return rows.slice(1)
		.filter((r) => {
			const t = r[typeIdx]?.trim().toLowerCase() ?? '';
			return r[titleIdx]?.trim() && !SKIP_TYPES.has(t);
		})
		.map((r) => {
			const rawType = r[typeIdx]?.trim().toLowerCase() ?? '';
			return {
				title: r[titleIdx].trim(),
				year: yearIdx !== -1 ? (r[yearIdx]?.trim() || null) : null,
				mediaTypeHint: TV_TYPES.has(rawType) ? 'tv' as const : 'movie' as const,
			};
		});
}

// Strips list decorators, Obsidian markdown syntax, emoji, and non-year parentheticals,
// then extracts an optional trailing year. Handles plain lists, Obsidian checkboxes,
// wiki links, and completion dates (e.g. "- [x] Licorice Pizza ✅ 2024-02-01").
export function parseTextList(text: string): ImportRow[] {
	return text
		.split(/\r?\n/)
		.map((line) => {
			// Strip leading whitespace/tabs (indented sub-items treated same as top-level)
			let s = line.replace(/^[\t ]+/, '');

			// Strip leading list decorator: "- ", "* ", "1. ", "1) ", "• ", "> "
			s = s.replace(/^(?:\d+[.)]\s*|[-*•>]\s*)/, '');

			// Strip Obsidian checkbox: "[ ] " or "[x] " (any case)
			s = s.replace(/^\[[ xX]\]\s*/, '');

			// Strip Obsidian wiki links: [[...]]
			s = s.replace(/\[\[.*?\]\]/g, '');

			// Strip ISO completion dates: 2024-02-01
			s = s.replace(/\d{4}-\d{2}-\d{2}/g, '');

			// Strip emoji (Extended_Pictographic covers arrows, checkmarks, flags, etc.)
			s = s.replace(/\p{Extended_Pictographic}️?/gu, '');
			// Strip stray variation selectors and combining enclosing keycap
			s = s.replace(/[︀-️⃣]/g, '');

			// Strip parentheticals that are NOT a bare 4-digit year — e.g. "(Slater)",
			// "(Patrick H Willems vid on Zach Snyder)". Keeps "(2022)".
			s = s.replace(/\((?!\s*\d{4}\s*\))[^)]*\)/g, '');
			// Strip empty parens left behind after wiki-link removal
			s = s.replace(/\(\s*\)/g, '');

			// Collapse whitespace
			s = s.replace(/\s+/g, ' ').trim();

			if (!s) return null;

			// Extract trailing year: "(2023)", "[2023]", or bare "2023" at end
			let year: string | null = null;
			const yearMatch = s.match(/[\[(]?(\d{4})[\])]?\s*$/);
			if (yearMatch && parseInt(yearMatch[1]) >= 1900 && parseInt(yearMatch[1]) <= 2100) {
				year = yearMatch[1];
				s = s.slice(0, yearMatch.index).trim().replace(/[,;:-]+$/, '').trim();
			}
			if (!s) return null;
			return { title: s, year, mediaTypeHint: 'auto' as const };
		})
		.filter((r): r is ImportRow => r !== null);
}

export function parseImportCSV(text: string): { rows: ImportRow[]; format: ImportFormat } {
	const allRows = parseCSV(text);
	if (allRows.length < 2) return { rows: [], format: 'unknown' };
	const format = detectFormat(allRows[0]);
	if (format === 'letterboxd') return { rows: parseLetterboxdCSV(text), format };
	if (format === 'imdb') return { rows: parseImdbCSV(text), format };
	return { rows: [], format: 'unknown' };
}
