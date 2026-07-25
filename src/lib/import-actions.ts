import type { ImportFormat, ImportRow } from './import';
import type { WatchlistItem } from './types';
import { addItem, replaceAll, setServices } from './db';
import { decrypt } from './crypto';
import { parseImportBackup } from './share-schema';
import { setQueueName, setQueueColor } from './queue-colors';
import { parseImportCSV } from './import';

export interface ImportActionDeps {
	setImporting: (importing: boolean) => void;
	setImportTotal: (total: number) => void;
	setImportDone: (done: number) => void;
	setImportAdded: (added: number) => void;
	setImportError: (error: string) => void;
	setMissedTitles: (titles: string[]) => void;
	setImportDoneOnce: (done: boolean) => void;
}

export interface RestoreDeps extends ImportActionDeps {
	setThemeDark: (dark: boolean) => void;
}

const BATCH = 10;

export async function importRows(rows: ImportRow[], deps: ImportActionDeps): Promise<void> {
	if (!rows.length) return;
	deps.setImporting(true);
	deps.setImportError('');
	deps.setImportTotal(rows.length);
	let importDone = 0;
	let importAdded = 0;
	let missedTitles: string[] = [];

	try {
		for (let i = 0; i < rows.length; i += BATCH) {
			const batch = rows.slice(i, i + BATCH);
			const res = await fetch('/api/import-search', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(batch)
			});
			if (!res.ok) throw new Error(await res.text().catch(() => res.statusText));
			const matched = (await res.json()) as Array<{
				title: string;
				result: Omit<WatchlistItem, 'id' | 'added_at' | 'watched_at'> | null;
			}>;
			for (const { title, result } of matched) {
				if (result) {
					try {
						await addItem(result);
						importAdded++;
					} catch (e) {
						if (e instanceof DOMException && e.name === 'ConstraintError') {
							importAdded++;
						} else {
							throw e;
						}
					}
				} else {
					missedTitles = [...missedTitles, title];
				}
				importDone++;
				deps.setImportDone(importDone);
			}
		}
		deps.setImportDoneOnce(true);
		deps.setMissedTitles(missedTitles);
		try {
			localStorage.setItem('sq:import-missed', JSON.stringify(missedTitles));
		} catch {}
		deps.setImportAdded(importAdded);
	} catch (e) {
		deps.setImportError(e instanceof Error ? e.message : 'Import failed.');
	} finally {
		deps.setImporting(false);
	}
}

export async function replaceAllItems(
	items: Omit<WatchlistItem, 'id' | 'added_at' | 'watched_at'>[]
): Promise<void> {
	// parseImportBackup's declared type omits id/added_at/watched_at, but at
	// runtime it passes the raw object through unmodified (see share-schema.ts),
	// so a backup produced by buildExportBlob still carries the real values here.
	// Preserve them when present rather than stamping every item as "added just
	// now, never watched" — and never reuse the exported id: ids are IndexedDB
	// autoIncrement, so they're device-local and would collide with (or
	// silently shadow) whatever this device already assigned to other items.
	const fullItems = items.map((item) => {
		const { added_at, watched_at } = item as unknown as {
			added_at?: unknown;
			watched_at?: unknown;
		};
		const { id: _id, ...rest } = item as unknown as Partial<WatchlistItem>;
		return {
			...(rest as Omit<WatchlistItem, 'id' | 'added_at' | 'watched_at'>),
			added_at: typeof added_at === 'string' ? added_at : new Date().toISOString(),
			watched_at: typeof watched_at === 'string' ? watched_at : null
		};
	});
	await replaceAll(fullItems);
}

export async function restoreBackup(
	file: File,
	passphrase: string,
	deps: RestoreDeps
): Promise<void> {
	if (!file || !passphrase) return;
	deps.setImporting(true);
	deps.setImportError('');
	try {
		const parsed = parseImportBackup(
			JSON.parse(await decrypt(await file.arrayBuffer(), passphrase))
		);

		const ops: Promise<void>[] = [replaceAllItems(parsed.items)];

		if (parsed.prefs?.theme) {
			const dark = parsed.prefs.theme === 'dark';
			deps.setThemeDark(dark);
			localStorage.setItem('sq:theme', parsed.prefs.theme);
			document.documentElement.classList.toggle('dark', dark);
		}
		if (
			typeof parsed.prefs?.weeklyHours === 'number' &&
			typeof parsed.prefs?.weeksPerMonth === 'number'
		) {
			localStorage.setItem('sq:budget:weekly', JSON.stringify(parsed.prefs.weeklyHours));
			localStorage.setItem('sq:budget:weeks', JSON.stringify(parsed.prefs.weeksPerMonth));
			localStorage.setItem(
				'sq:budget',
				JSON.stringify(parsed.prefs.weeklyHours * parsed.prefs.weeksPerMonth)
			);
		} else if (typeof parsed.prefs?.budget === 'number') {
			localStorage.setItem('sq:budget:weekly', JSON.stringify(Math.round(parsed.prefs.budget / 4)));
			localStorage.setItem('sq:budget:weeks', '4');
			localStorage.setItem('sq:budget', JSON.stringify(parsed.prefs.budget));
		}
		if (typeof parsed.prefs?.queueName === 'string') setQueueName(parsed.prefs.queueName);
		if (parsed.prefs?.queueColors && typeof parsed.prefs.queueColors === 'object') {
			for (const [tag, color] of Object.entries(parsed.prefs.queueColors)) {
				if (typeof color === 'string') setQueueColor(tag, color);
			}
		}
		if (typeof parsed.prefs?.sort === 'string') localStorage.setItem('sq:sort', parsed.prefs.sort);
		if (typeof parsed.prefs?.view === 'string') localStorage.setItem('sq:view', parsed.prefs.view);

		if (parsed.services) ops.push(setServices(parsed.services));
		await Promise.all(ops);
		deps.setImportDoneOnce(true);
	} catch (e) {
		deps.setImportError(e instanceof Error ? e.message : 'Import failed.');
	} finally {
		deps.setImporting(false);
	}
}

export async function fetchCsvFromUrl(
	url: string
): Promise<{ rows: ImportRow[]; format: ImportFormat }> {
	if (!url.trim()) return { rows: [], format: 'unknown' };
	try {
		try {
			const direct = await fetch(url.trim());
			if (direct.ok) return parseImportCSV(await direct.text());
		} catch {
			// CORS blocked — fall through to server proxy
		}
		const res = await fetch('/api/import-fetch', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ url: url.trim() })
		});
		if (!res.ok) throw new Error(await res.text().catch(() => res.statusText));
		return parseImportCSV(await res.text());
	} catch (e) {
		throw e instanceof Error ? e : new Error('Failed to fetch URL.');
	}
}
