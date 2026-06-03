import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { ImportRow } from '$lib/import';

export const POST: RequestHandler = async ({ request }) => {
	const { url } = await request.json() as { url: string };
	if (!url || !url.startsWith('https://www.criterion.com/')) {
		return new Response('Invalid URL — must be a criterion.com page', { status: 400 });
	}

	let html: string;
	try {
		const res = await fetch(url, {
			headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Queuest/1.0)' }
		});
		if (!res.ok) return new Response(`HTTP ${res.status}`, { status: 502 });
		html = await res.text();
	} catch (e) {
		return new Response(`Could not reach criterion.com: ${e instanceof Error ? e.message : String(e)}`, { status: 502 });
	}

	const rows = parseCriterionHTML(html);
	if (!rows.length) {
		return new Response('No film titles found on this page. Try a /shop/collection/ URL.', { status: 422 });
	}

	return json(rows);
};

function parseCriterionHTML(html: string): ImportRow[] {
	// Strategy 1: Shopify JSON-LD (most structured)
	const ldRows = tryJsonLd(html);
	if (ldRows.length) return ldRows;

	// Strategy 2: HTML product title elements
	const htmlRows = tryHtmlTitles(html);
	if (htmlRows.length) return htmlRows;

	return [];
}

function tryJsonLd(html: string): ImportRow[] {
	const rows: ImportRow[] = [];
	const scripts = html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/gi);
	for (const m of scripts) {
		try {
			const data = JSON.parse(m[1]);
			const items: unknown[] =
				data['@type'] === 'ItemList' ? (data.itemListElement ?? []) :
				Array.isArray(data) ? data : [];
			for (const el of items) {
				const raw = (el as Record<string, unknown>);
				const name = (raw.name ?? (raw.item as Record<string, unknown>)?.name) as string | undefined;
				if (name) rows.push(cleanCriterionTitle(name));
			}
		} catch { /* malformed JSON-LD — skip */ }
	}
	return rows;
}

function tryHtmlTitles(html: string): ImportRow[] {
	// Criterion product cards: look for <a> links pointing to /films/ paths,
	// or headings/spans with common product-title class patterns.
	const rows: ImportRow[] = [];
	const seen = new Set<string>();

	// Film detail links: <a href="/films/NNN/slug">Title</a>
	for (const m of html.matchAll(/href="\/films\/\d+\/[^"]+">([^<]{2,80})<\/a>/g)) {
		const title = decodeHTMLEntities(m[1].trim());
		if (title && !seen.has(title)) { seen.add(title); rows.push(cleanCriterionTitle(title)); }
	}
	if (rows.length) return rows;

	// Class-based: product-title, g-title, item__title, product__title
	for (const m of html.matchAll(/class="[^"]*(?:product|item|g)-?title[^"]*"[^>]*>([^<]{2,80})</g)) {
		const title = decodeHTMLEntities(m[1].trim());
		if (title && !seen.has(title)) { seen.add(title); rows.push(cleanCriterionTitle(title)); }
	}

	return rows;
}

// Strip Criterion-specific suffixes and extract year if present
function cleanCriterionTitle(raw: string): ImportRow {
	let s = raw
		.replace(/\s*[-–—]\s*The Criterion Collection.*$/i, '')
		.replace(/\s*\(Criterion Collection\)/i, '')
		.replace(/\bSpine\s*#?\d+\b/i, '')
		.trim();

	let year: string | null = null;
	const m = s.match(/\((\d{4})\)\s*$/);
	if (m && parseInt(m[1]) >= 1900 && parseInt(m[1]) <= 2100) {
		year = m[1];
		s = s.slice(0, m.index!).trim();
	}

	return { title: s, year, mediaTypeHint: 'movie' as const };
}

function decodeHTMLEntities(s: string): string {
	return s
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n)))
		.replace(/&apos;/g, "'");
}
