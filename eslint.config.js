import js from '@eslint/js';
import ts from 'typescript-eslint';
import svelte from 'eslint-plugin-svelte';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default ts.config(
	js.configs.recommended,
	...ts.configs.recommended,
	...svelte.configs.recommended,
	prettier,
	...svelte.configs.prettier,
	{
		languageOptions: {
			globals: { ...globals.browser, ...globals.node }
		}
	},
	{
		files: ['**/*.svelte', '**/*.svelte.ts'],
		languageOptions: {
			parserOptions: {
				parser: ts.parser,
				svelteFeatures: { experimentalGenerics: true }
			}
		}
	},
	{
		rules: {
			'@typescript-eslint/no-unused-vars': [
				'warn',
				{ argsIgnorePattern: '^_', varsIgnorePattern: '^_' }
			],
			'@typescript-eslint/no-explicit-any': 'warn',
			'svelte/no-at-html-tags': 'error',

			// Pre-existing patterns tracked by their own issues rather than
			// fixed as a side effect of introducing the linter. Downgraded to
			// warn so `npm run lint` reflects real regressions without
			// blocking on unrelated backlog work:
			//  - no-empty: silent `catch {}` blocks — #115, #117
			//  - svelte/no-unused-svelte-ignore: stale suppressions — #123
			'no-empty': 'warn',
			'svelte/no-unused-svelte-ignore': 'warn',
			// Mutable Map/Set inside runes and SvelteKit's resolve()-based
			// navigation are both real migrations, not lint hygiene — flagged
			// for awareness, not gated on here.
			'svelte/prefer-svelte-reactivity': 'warn',
			'svelte/no-navigation-without-resolve': 'warn'
		}
	},
	{
		ignores: ['.svelte-kit/', 'build/', 'dist/', 'node_modules/', '.wrangler/', 'static/']
	}
);
