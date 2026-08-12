import type { SharePayload, ShareItem, Provider } from './types';
import { coerceString, coerceNumber, validatePath } from './validate';

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
