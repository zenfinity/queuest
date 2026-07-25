export const welcomeState = $state({ show: false });

export function openWelcome() {
	welcomeState.show = true;
}

export function closeWelcome() {
	welcomeState.show = false;
	try {
		localStorage.setItem('sq:welcomed', '1');
	} catch {}
}

export function initWelcome() {
	try {
		if (!localStorage.getItem('sq:welcomed')) openWelcome();
	} catch {}
}
