declare global {
	namespace App {
		// No server-side platform bindings — storage is client-side IndexedDB
		interface Platform {}
	}
}

export {};
