import type { Provider } from './types';
import { getAll, replaceAll, patchProviders, getServices, setServices } from './db';
import { encrypt } from './crypto';
import { getQueueName, getQueueColors } from './queue-colors';

export interface SettingsActionDeps {
	setRefreshing: (refreshing: boolean) => void;
	setRefreshError: (error: string) => void;
	setRefreshSuccess: (success: boolean) => void;
	setRefreshTotal: (total: number) => void;
	setRefreshDone: (done: number) => void;
	setFeedbackError: (error: string) => void;
	setFeedbackIssueUrl: (url: string) => void;
}

export async function buildExportBlob(
	passphrase: string,
	weeklyHours: number,
	weeksPerMonth: number
): Promise<Blob> {
	const [items, services] = await Promise.all([getAll(), getServices()]);
	const payload = {
		version: 1,
		prefs: {
			theme:
				typeof document !== 'undefined'
					? document.documentElement.classList.contains('dark')
						? 'dark'
						: 'light'
					: 'light',
			weeklyHours,
			weeksPerMonth,
			budget: weeklyHours * weeksPerMonth,
			queueName: getQueueName(),
			queueColors: getQueueColors(),
			sort:
				typeof localStorage !== 'undefined'
					? (localStorage.getItem('sq:sort') ?? 'added')
					: 'added',
			view:
				typeof localStorage !== 'undefined' ? (localStorage.getItem('sq:view') ?? 'grid') : 'grid'
		},
		items,
		services
	};
	const buf = await encrypt(JSON.stringify(payload), passphrase);
	return new Blob([buf], { type: 'application/octet-stream' });
}

export async function refreshProviders(deps: SettingsActionDeps): Promise<void> {
	deps.setRefreshing(true);
	deps.setRefreshError('');
	deps.setRefreshSuccess(false);
	try {
		const items = await getAll();
		const payload = items.map(({ id, tmdb_id, media_type }) => ({ id, tmdb_id, media_type }));
		deps.setRefreshTotal(payload.length);
		deps.setRefreshDone(0);

		if (!payload.length) {
			deps.setRefreshSuccess(true);
			return;
		}

		const res = await fetch('/api/refresh-providers', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(payload)
		});

		if (!res.ok) throw new Error(await res.text().catch(() => res.statusText));

		const results = (await res.json()) as Array<{
			id: number;
			providers: Provider[];
			rentable?: boolean;
			release: any;
			seasons?: any;
			runtime_minutes?: number | null;
			genres?: string[];
			cast?: any[];
			director?: string | null;
			creator?: string | null;
		}>;

		for (const r of results) {
			await patchProviders(
				r.id,
				r.providers,
				r.rentable ?? false,
				r.release,
				r.seasons,
				r.runtime_minutes,
				r.genres,
				r.cast,
				r.director,
				r.creator
			);
			deps.setRefreshDone(results.indexOf(r) + 1);
		}
		deps.setRefreshSuccess(true);
	} catch (e) {
		deps.setRefreshError(e instanceof Error ? e.message : 'Refresh failed.');
	} finally {
		deps.setRefreshing(false);
	}
}

export async function submitFeedback(
	title: string,
	body: string,
	deps: SettingsActionDeps
): Promise<void> {
	if (!title.trim()) return;
	deps.setFeedbackError('');
	deps.setFeedbackIssueUrl('');
	try {
		const res = await fetch('/api/feedback', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ title, body })
		});
		if (!res.ok) {
			const msg = await res.text().catch(() => res.statusText);
			deps.setFeedbackError(msg || 'Something went wrong.');
		} else {
			const data = await res.json();
			deps.setFeedbackIssueUrl(data.url);
		}
	} catch (e) {
		deps.setFeedbackError(e instanceof Error ? e.message : 'Network error.');
	}
}

export async function resetEverything(): Promise<void> {
	await Promise.all([replaceAll([]), setServices([])]);
	const keys = [
		'sq:theme',
		'sq:budget',
		'sq:budget:weekly',
		'sq:budget:weeks',
		'sq:sort',
		'sq:view',
		'sq:queue-name',
		'sq:queue-colors',
		'sq:welcomed',
		'sq:import-missed'
	];
	for (const k of keys) {
		try {
			localStorage.removeItem(k);
		} catch {}
	}
	if (typeof window !== 'undefined') {
		window.location.href = '/';
	}
}
