const query =
	typeof window !== 'undefined' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;

export const motion = $state({ reduced: query?.matches ?? false });

if (query) {
	query.addEventListener('change', (e) => {
		motion.reduced = e.matches;
	});
}
