// Runs before first paint to prevent a flash of the wrong theme.
// Kept as a separate same-origin file (not inline) so it never needs CSP
// script-src hash/nonce coverage — 'self' is enough, and that never changes.
try {
	if (localStorage.getItem('sq:theme') !== 'light') document.documentElement.classList.add('dark');
} catch (e) {
	document.documentElement.classList.add('dark');
}
