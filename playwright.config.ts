import { defineConfig, devices } from '@playwright/test';

// E2E harness (#253) — a small, deliberately narrow tripwire suite for the
// flows a unit test structurally can't see (two real browser contexts
// converging on the same server state), not a coverage push. See e2e/README.md
// for what's in scope and why this isn't wired into the required PR checks yet.
export default defineConfig({
	testDir: './e2e',
	fullyParallel: false,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 1 : 0,
	workers: 1,
	reporter: 'list',
	timeout: 30_000,
	use: {
		baseURL: 'http://localhost:8788',
		trace: 'retain-on-failure'
	},
	projects: [
		{
			name: 'chromium',
			use: { ...devices['Desktop Chrome'] }
		}
	],
	webServer: {
		command: 'npm run build && npm run preview',
		url: 'http://localhost:8788',
		reuseExistingServer: !process.env.CI,
		timeout: 120_000
	}
});
