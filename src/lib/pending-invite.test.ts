import { describe, it, expect, beforeEach } from 'vitest';
import { setPendingInvite, takePendingInvite } from './pending-invite';

beforeEach(() => {
	sessionStorage.clear();
});

describe('pending-invite', () => {
	it('returns null when nothing is pending', () => {
		expect(takePendingInvite()).toBeNull();
	});

	it('round-trips what was stashed', () => {
		setPendingInvite({ token: 'tok123', dek: 'the-dek' });
		expect(takePendingInvite()).toEqual({ token: 'tok123', dek: 'the-dek' });
	});

	it('is single-use — a second read returns null', () => {
		setPendingInvite({ token: 'tok123', dek: 'the-dek' });
		takePendingInvite();
		expect(takePendingInvite()).toBeNull();
	});

	it('ignores malformed JSON left in storage rather than throwing', () => {
		sessionStorage.setItem('queuest-pending-invite', 'not json');
		expect(takePendingInvite()).toBeNull();
	});

	it('ignores a stored value missing the expected shape', () => {
		sessionStorage.setItem('queuest-pending-invite', JSON.stringify({ token: 'only-token' }));
		expect(takePendingInvite()).toBeNull();
	});
});
