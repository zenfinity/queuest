import type { PageServerLoad } from './$types';
import type { Provider, Suggestion } from '$lib/types';

export const load: PageServerLoad = async ({ platform }) => {
	const db = platform?.env?.DB;
	if (!db) return { suggestions: [] as Suggestion[], totalUnwatched: 0 };

	const result = await db
		.prepare('SELECT providers FROM watchlist WHERE watched_at IS NULL')
		.all<{ providers: string }>();

	const counts = new Map<string, Suggestion>();

	for (const row of result.results) {
		const providers: Provider[] = JSON.parse(row.providers ?? '[]');
		for (const p of providers) {
			const existing = counts.get(p.provider_name);
			if (existing) {
				existing.count++;
			} else {
				counts.set(p.provider_name, {
					provider_id: p.provider_id,
					name: p.provider_name,
					logo_path: p.logo_path,
					count: 1
				});
			}
		}
	}

	const suggestions = Array.from(counts.values()).sort((a, b) => b.count - a.count);

	return { suggestions, totalUnwatched: result.results.length };
};
