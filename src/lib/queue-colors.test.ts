import { describe, it, expect, beforeEach, vi } from 'vitest';

const localStorageMock = (() => {
	let store: Record<string, string> = {};
	return {
		getItem: (key: string) => store[key] || null,
		setItem: (key: string, value: string) => {
			store[key] = value;
		},
		removeItem: (key: string) => {
			delete store[key];
		},
		clear: () => {
			store = {};
		}
	};
})();

vi.stubGlobal('localStorage', localStorageMock);

const { getQueueColors, setQueueColor, renameCollectionColor, deleteCollectionColor } =
	await import('./queue-colors');

beforeEach(() => {
	localStorageMock.clear();
});

describe('queue-colors', () => {
	describe('renameCollectionColor', () => {
		it('moves the color entry from old name to new name', () => {
			setQueueColor('Action', '#ef4444');
			setQueueColor('Drama', '#3b82f6');

			renameCollectionColor('Action', 'Action Movies');

			const colors = getQueueColors();
			expect(colors['Action Movies']).toBe('#ef4444');
			expect(colors['Action']).toBeUndefined();
			expect(colors['Drama']).toBe('#3b82f6');
		});

		it('does nothing if the source name does not exist', () => {
			setQueueColor('Drama', '#3b82f6');

			renameCollectionColor('Action', 'Action Movies');

			const colors = getQueueColors();
			expect(colors['Action']).toBeUndefined();
			expect(colors['Action Movies']).toBeUndefined();
			expect(colors['Drama']).toBe('#3b82f6');
		});

		it('handles localStorage errors gracefully', () => {
			const setItemSpy = vi.spyOn(localStorageMock, 'setItem').mockImplementation(() => {
				throw new Error('storage full');
			});

			expect(() => {
				renameCollectionColor('Action', 'Action Movies');
			}).not.toThrow();

			setItemSpy.mockRestore();
		});
	});

	describe('deleteCollectionColor', () => {
		it('removes the color entry for a collection', () => {
			setQueueColor('Action', '#ef4444');
			setQueueColor('Drama', '#3b82f6');

			deleteCollectionColor('Action');

			const colors = getQueueColors();
			expect(colors['Action']).toBeUndefined();
			expect(colors['Drama']).toBe('#3b82f6');
		});

		it('does nothing if the collection does not exist', () => {
			setQueueColor('Drama', '#3b82f6');

			deleteCollectionColor('Action');

			const colors = getQueueColors();
			expect(colors['Action']).toBeUndefined();
			expect(colors['Drama']).toBe('#3b82f6');
		});

		it('handles localStorage errors gracefully', () => {
			const setItemSpy = vi.spyOn(localStorageMock, 'setItem').mockImplementation(() => {
				throw new Error('storage full');
			});

			expect(() => {
				deleteCollectionColor('Action');
			}).not.toThrow();

			setItemSpy.mockRestore();
		});
	});
});
