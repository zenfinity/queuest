// Borda-count aggregation for shared-list ranked voting (#210). A member's
// ballot is an ordered list of up to MAX_BALLOT_SIZE choices; each position
// is worth points from MAX_BALLOT_SIZE (1st) down to 1 (last), summed across
// every member who ranked that title. Plain sum, not instant-runoff — see
// #210 for why: this is a lightweight "what should we watch" signal, not a
// formal election, and a summed score is far easier to show and explain in
// the UI than elimination rounds.
import { MAX_BALLOT_SIZE, type BallotEntry, type CollectionItem } from './collection-sync';
import { itemKey } from './types';

export interface TallyRow {
	item: CollectionItem;
	score: number;
	voters: number;
}

/**
 * Sums Borda points per title across every ballot, dropping any ballot entry
 * that no longer matches a current item — a title removed from the list
 * (#214) just falls out of the tally silently rather than needing its own
 * cleanup pass over every member's ballot, the decided answer to #210's open
 * question on this. Only titles with at least one point are returned, sorted
 * highest-scoring first (ties broken by voter count, then title).
 */
export function bordaTally(
	items: CollectionItem[],
	ballots: Record<string, BallotEntry>
): TallyRow[] {
	const byKey = new Map(items.map((i) => [itemKey(i), i]));
	const scores = new Map<string, number>();
	const voters = new Map<string, number>();

	for (const ballot of Object.values(ballots)) {
		ballot.items.forEach((key, index) => {
			if (!byKey.has(key)) return;
			const points = MAX_BALLOT_SIZE - index;
			scores.set(key, (scores.get(key) ?? 0) + points);
			voters.set(key, (voters.get(key) ?? 0) + 1);
		});
	}

	return [...scores.entries()]
		.map(([key, score]) => ({ item: byKey.get(key)!, score, voters: voters.get(key) ?? 0 }))
		.sort(
			(a, b) => b.score - a.score || b.voters - a.voters || a.item.title.localeCompare(b.item.title)
		);
}
