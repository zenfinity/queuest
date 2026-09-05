import { getAll, replaceAll, patchProviders, setServices } from './db';
import { encrypt } from './crypto';
import { throwIfNotOk } from './http';
import { serializeAppState, SYNCED_KEYS, LOCAL_KEYS } from './app-state';
import type { RefreshResult } from '../routes/api/refresh-providers/+server';

export interface SettingsActionDeps {
	setRefreshing: (refreshing: boolean) => void;
	setRefreshError: (error: string) => void;
	setRefreshSuccess: (success: boolean) => void;
	setRefreshTotal: (total: number) => void;
	setRefreshDone: (done: number) => void;
	setFeedbackError: (error: string) => void;
	setFeedbackIssueUrl: (url: string) => void;
}

export async function buildExportBlob(passphrase: string): Promise<Blob> {
	const payload = await serializeAppState();
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

		await throwIfNotOk(res);

		const results = (await res.json()) as RefreshResult[];

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
				r.director_id,
				r.creator,
				r.imdb_id,
				r.backdrop_path
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
			const data = await res.json().catch(() => null);
			deps.setFeedbackError(data?.error || 'Something went wrong.');
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
	for (const k of [...SYNCED_KEYS, ...LOCAL_KEYS]) {
		try {
			localStorage.removeItem(k);
		} catch {
			// Best-effort localStorage cleanup; app navigates away after reset regardless
		}
	}
	if (typeof window !== 'undefined') {
		window.location.href = '/';
	}
}
