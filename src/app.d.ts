declare global {
	namespace App {
		interface Platform {
			env?: {
				SHARE_KV?: KVNamespace;
				DB?: D1Database;
			};
		}
	}
}

export {};
