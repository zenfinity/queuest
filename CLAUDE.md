# CLAUDE.md

## Server-side / production caution

Be conservative with actions that touch production infrastructure — the live Cloudflare D1 database, KV namespaces, Workers deployments, DNS, or account settings — even when they seem safe (e.g. additive-only DDL like `CREATE TABLE IF NOT EXISTS`).

- Prefer read-only queries to inspect/diagnose state.
- For anything that writes, migrates, or deploys against production, explain what you intend to run and why, then let the user run it themselves (e.g. `npx wrangler d1 migrations apply queuest-db --remote`) rather than executing it directly, unless they've explicitly asked you to run it yourself in that specific instance.
- Local/dev D1 (`--local` or no `--remote` flag) and test databases are fine to act on freely.
