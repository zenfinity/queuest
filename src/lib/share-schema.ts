import type { SharePayload, ShareItem, WatchlistItem, Provider } from './types';

function coerceString(val: unknown, maxLen: number): string {
	const s = typeof val === 'string' ? val : '';
	return s.slice(0, maxLen);
}

function coerceNumber(val: unknown, max?: number): number | null {
	const n = typeof val === 'number' ? val : null;
	if (n === null) return null;
	if (max !== undefined && n > max) return max;
	if (n < 0) return 0;
	return Math.round(n);
}

function validatePath(val: unknown): string | null {
	if (typeof val !== 'string') return null;
	if (!/^\/[\w.-]+$/.test(val)) return null;
	return val;
}

function parseShareItem(raw: unknown): ShareItem | null {
	if (!raw || typeof raw !== 'object') return null;
	const item = raw as Record<string, unknown>;

	const media_type = item.media_type;
	if (media_type !== 'movie' && media_type !== 'tv') return null;

	const tmdb_id = coerceNumber(item.tmdb_id);
	if (tmdb_id === null || tmdb_id === 0) return null;

	const title = coerceString(item.title, 500);
	if (!title) return null;

	const poster_path = validatePath(item.poster_path);
	const providers = Array.isArray(item.providers)
		? item.providers
				.slice(0, 50)
				.map((p: unknown) => {
					if (!p || typeof p !== 'object') return null;
					const provider = p as Record<string, unknown>;
					const pid = coerceNumber(provider.provider_id);
					const pname = coerceString(provider.provider_name, 100);
					const plogo = validatePath(provider.logo_path);
					if (pid === null || pid === 0 || !pname || !plogo) return null;
					return { provider_id: pid, provider_name: pname, logo_path: plogo };
				})
				.filter((p): p is Provider => p !== null)
		: [];

	const runtime_minutes = coerceNumber(item.runtime_minutes, 100000);
	const seasons = Array.isArray(item.seasons)
		? item.seasons
				.slice(0, 100)
				.map((s: unknown) => {
					if (!s || typeof s !== 'object') return null;
					const season = s as Record<string, unknown>;
					const snum = coerceNumber(season.season_number);
					const sruntime = coerceNumber(season.runtime_minutes, 100000);
					if (snum === null || snum === 0) return null;
					return { season_number: snum, runtime_minutes: sruntime ?? 0 };
				})
				.filter((s): s is ShareItem['seasons'][0] => s !== null)
		: [];

	const queue_tag = typeof item.queue_tag === 'string' ? item.queue_tag.slice(0, 40) : undefined;

	return {
		tmdb_id,
		media_type,
		title,
		poster_path,
		providers,
		runtime_minutes,
		seasons,
		...(queue_tag ? { queue_tag } : {})
	};
}

export function parseSharePayload(raw: unknown): SharePayload {
	if (!raw || typeof raw !== 'object') throw new Error('Invalid share payload');
	const payload = raw as Record<string, unknown>;

	const v = payload.v;
	if (v !== 1) throw new Error('Unsupported share format version');

	const queue_name =
		typeof payload.queue_name === 'string' ? payload.queue_name.slice(0, 100) : undefined;
	const items: ShareItem[] = [];

	if (Array.isArray(payload.items)) {
		for (const raw of payload.items.slice(0, 500)) {
			const item = parseShareItem(raw);
			if (item) items.push(item);
		}
	}

	return {
		v: 1,
		...(queue_name ? { queue_name } : {}),
		items
	};
}

export function parseImportBackup(raw: unknown): {
	items: Omit<WatchlistItem, 'id' | 'added_at' | 'watched_at'>[];
	prefs?: {
		theme?: string;
		weeklyHours?: number;
		weeksPerMonth?: number;
		budget?: number;
		queueName?: string;
		queueColors?: Record<string, string>;
		sort?: string;
		view?: string;
	};
	services?: { provider_id: number; provider_name: string; logo_path: string }[];
} {
	if (!raw || typeof raw !== 'object') throw new Error('Invalid backup file');
	const payload = raw as Record<string, unknown>;

	const items: Omit<WatchlistItem, 'id' | 'added_at' | 'watched_at'>[] = [];

	// Legacy format: direct array
	if (
		Array.isArray(payload) &&
		payload.length > 0 &&
		payload[0] &&
		typeof payload[0] === 'object'
	) {
		for (const item of payload.slice(0, 5000)) {
			if (item && typeof item === 'object') {
				const obj = item as Record<string, unknown>;
				if (
					typeof obj.tmdb_id === 'number' &&
					(obj.media_type === 'movie' || obj.media_type === 'tv') &&
					typeof obj.title === 'string'
				) {
					items.push(item as any);
				}
			}
		}
		return { items };
	}

	// New format: { version, prefs, items, services }
	const items_raw = payload.items;
	if (Array.isArray(items_raw)) {
		for (const item of items_raw.slice(0, 5000)) {
			if (item && typeof item === 'object') {
				const obj = item as Record<string, unknown>;
				if (
					typeof obj.tmdb_id === 'number' &&
					(obj.media_type === 'movie' || obj.media_type === 'tv') &&
					typeof obj.title === 'string'
				) {
					items.push(item as any);
				}
			}
		}
	}

	const prefs =
		payload.prefs && typeof payload.prefs === 'object'
			? (payload.prefs as Record<string, unknown>)
			: {};
	const parsed_prefs = {
		...(typeof prefs.theme === 'string' && ['light', 'dark'].includes(prefs.theme)
			? { theme: prefs.theme }
			: {}),
		...(typeof prefs.weeklyHours === 'number' && prefs.weeklyHours > 0
			? { weeklyHours: Math.round(prefs.weeklyHours) }
			: {}),
		...(typeof prefs.weeksPerMonth === 'number' && prefs.weeksPerMonth > 0
			? { weeksPerMonth: Math.round(prefs.weeksPerMonth) }
			: {}),
		...(typeof prefs.budget === 'number' && prefs.budget > 0
			? { budget: Math.round(prefs.budget) }
			: {}),
		...(typeof prefs.queueName === 'string' ? { queueName: prefs.queueName.slice(0, 100) } : {}),
		...(prefs.queueColors && typeof prefs.queueColors === 'object'
			? {
					queueColors: Object.fromEntries(
						Object.entries(prefs.queueColors as Record<string, unknown>)
							.filter(([_, v]) => typeof v === 'string')
							.slice(0, 50)
							.map(([k, v]) => [k.slice(0, 100), (v as string).slice(0, 50)])
					)
				}
			: {}),
		...(typeof prefs.sort === 'string' && ['added', 'runtime', 'title'].includes(prefs.sort)
			? { sort: prefs.sort }
			: {}),
		...(typeof prefs.view === 'string' && ['grid', 'list', 'lanes'].includes(prefs.view)
			? { view: prefs.view }
			: {})
	};

	const services = Array.isArray(payload.services)
		? payload.services
				.slice(0, 100)
				.map((s: unknown) => {
					if (!s || typeof s !== 'object') return null;
					const svc = s as Record<string, unknown>;
					const id = coerceNumber(svc.provider_id);
					const name = coerceString(svc.provider_name, 100);
					const logo = validatePath(svc.logo_path);
					if (id === null || id === 0 || !name || !logo) return null;
					return { provider_id: id, provider_name: name, logo_path: logo };
				})
				.filter((s): s is Provider => s !== null)
		: [];

	return {
		items,
		...(Object.keys(parsed_prefs).length > 0 ? { prefs: parsed_prefs as any } : {}),
		...(services.length > 0 ? { services } : {})
	};
}
