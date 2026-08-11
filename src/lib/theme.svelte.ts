export const theme = $state({ dark: true });

export function initTheme() {
	try {
		theme.dark = localStorage.getItem('sq:theme') !== 'light';
	} catch {
		theme.dark = true;
	}
}

export function toggleTheme() {
	theme.dark = !theme.dark;
	try {
		localStorage.setItem('sq:theme', theme.dark ? 'dark' : 'light');
	} catch {
		// Best-effort localStorage write; theme toggle always updates DOM regardless
	}
	document.documentElement.classList.toggle('dark', theme.dark);
}
