import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config';

export default mergeConfig(
	viteConfig,
	defineConfig({
		test: {
			environment: 'jsdom',
			include: ['src/**/*.test.ts', 'src/**/*.svelte.test.ts'],
			coverage: {
				provider: 'v8',
				reporter: ['text', 'html']
			}
		},
		resolve: {
			conditions: ['browser']
		}
	})
);
