// The page the service worker answers with when a page that needs the network is
// opened offline (src/service-worker.ts). It lives here, as a string the worker
// builds a Response from, rather than as a file in static/: Cloudflare Pages
// redirects /offline.html to /offline (a route that doesn't exist), so
// precaching the file made the worker's install fail outright.
//
// Deliberately static — no scripts, styles inline (the site's CSP allows inline
// styles) — so it renders from the worker alone.
export const OFFLINE_HTML = `<!doctype html>
<html lang="en">
	<head>
		<meta charset="utf-8" />
		<meta name="viewport" content="width=device-width, initial-scale=1" />
		<title>Offline — Queuest</title>
		<meta name="robots" content="noindex" />
		<style>
			:root {
				color-scheme: light dark;
			}
			body {
				margin: 0;
				min-height: 100vh;
				display: flex;
				align-items: center;
				justify-content: center;
				padding: 1.5rem;
				box-sizing: border-box;
				font-family:
					system-ui,
					-apple-system,
					'Segoe UI',
					Roboto,
					sans-serif;
				background: #fff;
				color: #111827;
			}
			main {
				max-width: 24rem;
				text-align: center;
			}
			h1 {
				margin: 0 0 0.5rem;
				font-size: 1.5rem;
			}
			p {
				margin: 0 0 1.5rem;
				line-height: 1.5;
				color: #4b5563;
			}
			a {
				display: inline-block;
				padding: 0.75rem 1.5rem;
				border-radius: 0.5rem;
				background: #f97316;
				color: #fff;
				font-weight: 600;
				text-decoration: none;
			}
			@media (prefers-color-scheme: dark) {
				body {
					background: #030712;
					color: #f9fafb;
				}
				p {
					color: #9ca3af;
				}
			}
		</style>
	</head>
	<body>
		<main>
			<h1>You're offline</h1>
			<p>This page needs a connection. Your queue, lists and budget still work.</p>
			<a href="/app">Open my queue</a>
		</main>
	</body>
</html>
`;
