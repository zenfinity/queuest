# Changelog

## [0.5.4] — 2026-07-25

### Documentation & licensing

- **README corrected**: license section said MIT — the repo is AGPL-3.0. Added the `license` field to `package.json`, fixed the `preview`/`.dev.vars` setup instructions (previously pointed at `.env.local`, which `wrangler pages dev` never reads), corrected the budget-is-configurable-in-Settings claim (it's at `/budget`) in both the README and the in-app copy, and updated stale repo-slug links. (#126)

### Infrastructure & repo hygiene

- **ESLint + Prettier + `lint`/`format` scripts**, wired to match the existing hand-formatted style (tabs, single quotes, no trailing commas, 100-char width). `tsconfig.json` gained `noUnusedLocals`/`noUnusedParameters`. `.gitignore` cleaned up; `.claude/launch.json`'s hardcoded path removed from tracking. (#124)
- **Deleted dead code**: the orphaned `/services` and `/import` routes (both superseded by earlier work), the fully-unwired `welcome.svelte.ts` module, the unrendered `backdrop_path` field, the always-null `current_season`/`current_episode` fields, and several smaller unused exports/params surfaced by the new strict TS flags. (#123)

### Bug fixes

- **Backup restore, reset, and view-whitelist defects**: restoring a backup could silently drop data on certain shapes, "Reset everything" left stale entries in a couple of lists, and a filter's allowed-view whitelist didn't match its actual options. (#96)

### Testing & maintainability

- **Wired the remaining actions modules** into their components — `settings`, `add`, `share-create`, `share-token`, and `import` now all follow the same dependency-injected, unit-tested pattern as `queue-actions.ts`, closing the gap left by v0.5.3's initial extraction pass. Along the way, fixed a real bug where CSV-import-from-URL was fetching and then discarding the response body, always returning an empty result. (#92, #94)
- **`app/+page.svelte` decomposed** from 1102 to 505 lines: extracted `QueueGanttView`, `QueueListView`, and `QueueGridView` into `$lib/components/`, each landed as its own commit. `resolvedHue` centralized into `$lib/colors.ts`. (#119, #120)
- **`tmdb.ts` test coverage** added (17 tests): Disney+/Hulu provider disambiguation, tier/bundle filtering, and movie/TV release-date branching via mocked `fetch` + `vi.setSystemTime`. `add/page-server.test.ts` no longer mocks the pure `augmentProviders`. (#127)
- **Duplicated helpers consolidated**: `hms()` (5 copies) and a provider-aggregation loop (4 copies, inconsistently keyed by name vs. id — now uniformly by `provider_id`) moved into `lib/progress.ts`; the budget-prefs triple-write, the `res.ok`-throw pattern, `ConstraintError`-as-success checks, and base64url encoding each consolidated into shared helpers. (#121)
- **API routes**: the same-origin guard and error-response shape were inconsistent across all six routes (a mix of thrown SvelteKit error pages, bare-string responses, and a success-shaped body on failure) — settled on one `{ error: string }` JSON contract everywhere, added the guard to the one route that lacked it, and replaced `refresh-providers`' silent truncation of over-limit batches with a rejection, matching `import-search`. (#122)

---

## [0.5.3] — 2026-07-22

### Security

- **Share payload validation** — runtime schema validators for all untrusted input (share links, `.queuest` backup files). Payloads are rebuilt field-by-field from an allowlist, clamping strings (title ≤500, overview ≤5000, paths validated), numbers (runtime ≤100k), and array lengths (items ≤500, seasons ≤100 per title). Prevents oversized payloads from breaking queue views or budget math, and closes off prototype-pollution vectors. (#70)

### Bug fixes & cleanup

- **CORS console spam eliminated** — removed the doomed `extractLogoHue()` call that tried to extract logo colors from TMDB's CDN (which never sends CORS headers). Lane colors now rely entirely on the existing `providerHue()` brand-hue table + hash fallback, which was already working as the extraction always failed. (#81)

### Onboarding & UX

- **Guided new-user flow** — "Get Started" from the landing page now routes through `/budget?onboarding=1` (with introductory copy and a curated list of major streaming services fetched from TMDB) → `/add?onboarding=1` (with a callout to the Import section for users who already have a watchlist elsewhere). Returning users navigating directly to `/budget` or `/add` see the normal UI without onboarding scaffolding. (#80)

### Testing & maintainability

- **Extracted testable business logic** — refactored 5 route/component files (`settings`, `add`, `ImportPanel`, `share`, `share/[token]`) to follow the `queue-actions.ts` pattern: plain, dependency-injected async functions in `$lib/*-actions.ts` with full unit test coverage (72 tests total across 6 test files). Svelte components now stay slim, wiring their own state to the logic functions with no other changes. (#90)

---

## [0.5.2] — 2026-07-22

### Bug fixes

- **Card/List click opens detail panel**: root cause finally found — a global click-outside-closes-popups listener was resetting `detailItem` back to null on the very same click that opened it, for any click except directly on the poster image. Fixed with `stopPropagation`; List view rows are now fully clickable too (previously only the title text was wired up). (#64)
- **Subscribed filter** no longer includes titles with no streaming provider at all — it now only shows items actually on a subscribed service. The option grays out when zero services are selected. (#83)
- **iOS zoom-on-focus**: the Add page search input was under the 16px font-size threshold that triggers Safari's auto-zoom on focus, hiding the right side of the app. (#82)

### Navigation & UI

- **Responsive filter dock**: inline in the nav (right-justified) at `lg:` and above, floating pill at the bottom below that — same component and state either way. (#84)
- **Sort direction + Clear**: an ascending/descending arrow next to the active sort option, and a Clear action that resets sort back to Recent. (#85)
- **Add page**: "Search" is now a subheading matching the Budget page's style; Import (CSV/URL/text-list/backup restore) is now a collapsible section on the same page instead of a separate link, sharing its logic with the standalone `/import` route via a new `ImportPanel` component. (#86)
- **Redundant page headers removed** — "Budget" and "Settings" duplicated what the nav already showed. "What to Subscribe to Next" and "Share Your Queue" are now subheadings instead of large titles. (#87, #88)

### Security

- **`/api/share` hardening**: same-origin guard on POST, a minimum-payload-size check (anything under 28 bytes can't be a valid encrypted blob), and `nosniff`/`Content-Disposition: attachment` on GET responses. (#68)

### Resilience

- **Add page**: a TMDB outage no longer crashes the whole page — shows an inline error with Retry instead, and a loading skeleton distinguishes "searching" from "no results found." (#48)
- **Queue page**: IndexedDB failures on toggle/remove/season-progress now show a dismissable error instead of failing silently — and no longer leave the button stuck in a disabled "busy" state forever. (#48)

### Infrastructure

- **Vitest test harness**: 41 initial tests covering `progress.ts`, `crypto.ts` (including the PBKDF2 legacy-iteration fallback), and `db.ts` (watchlist CRUD + subscribed services). (#47)

---

## [0.5.1] — 2026-07-02

### Security

- **SSRF fix** on the import-fetch proxy: allowlist limited to Criterion, Letterboxd, and IMDb; 2 MB response cap; 10 s timeout. (#65)
- **Same-origin enforcement** on all POST API routes via `Sec-Fetch-Site` header; cross-origin requests are rejected with 403. (#66)
- **Feedback endpoint hardening**: 200-char title cap, 5 000-char body cap, generic error message returned to client. (#67)
- **Security headers** via `_headers`: `Content-Security-Policy`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, HSTS (1 year + subdomains), `Permissions-Policy` (camera/mic/geo off). (#69)
- **PBKDF2 strengthened** to 600 000 iterations; existing `.queuest` exports encrypted at 200 000 iterations are transparently migrated on next import. (#74)

### Bug fixes

- **Clipped dropdown** on queue grid cards: removed `overflow-hidden` from the card wrapper so season/release popups are no longer cut off. (#52)
- Attempted fixes for the green subscribed-service chip stroke (#51) and card-tap-opens-detail-panel (#64) — **neither actually resolved on review; both remain open.**

### Onboarding & UX

- **Budget callout**: shown once on first visit when no monthly budget is set; inputs for hrs/week × weeks/month with Save and Skip options. (#54)
- **Save before leaving**: browser-native "leave site?" dialog appears when the queue has items and the user tries to close or navigate away. (#55)
- **Landing page always accessible**: `/?preview` bypasses the returning-visitor redirect so the landing page can be revisited; Settings → About links there. (#56)

### Navigation

- **Search renamed to Add**: nav link, route (`/add`), and page title updated; `/search` issues a 301 redirect to `/add` preserving the `?q=` param. (#57)
- **Floating filter dock**: a pill dock fixed at the bottom of the Queue page replaces the old toolbar dropdowns — Card/List/Timeline view switcher, an inclusive Watched toggle (mixes watched items in with a teal badge instead of an exclusive tab), and a Filter button opening a Sort-by/Services popover. A summary line above content reads "N titles · ~Xh remaining." Reworked from an initial inline-nav-controls attempt after design review. (#58)
- **Add Titles / Import / Share row removed** from the Queue page toolbar — Share is now its own nav page (`/share`); an Import link was added to the Add page header.
- Service filter labels corrected to **All / Subscribed / Not Subscribed**.

### Accessibility & motion

- **`prefers-reduced-motion` support**: new `motion.svelte.ts` store gates scroll-reveal and float animations on the landing page and zeroes the `animate:flip` duration on queue grid cards when reduced motion is active. (#45)

### Infrastructure

- **Build fix**: upgraded `@sveltejs/kit` `0.0.30` → `2.69.0` and `@sveltejs/adapter-cloudflare` `0.0.1` → `7.2.9`; both were ancient stubs that caused `svelte-kit sync` to fail on Cloudflare Pages. Moved `_headers` to the project root as required by adapter 7.x.

---

## [0.5.0] — 2026-06-21

### Services & subscription awareness

- **Subscribed services** — new Services page lets users mark which streaming services they currently subscribe to. State is stored in IndexedDB alongside queue data and shared reactively across the app via a singleton Svelte store. (#36)
- **Service-aware queue filter** — Filter dropdown gains "Subscribed only" and "Not Subscribed" toggles that filter all three views (Grid, List, Gantt) by whether each title is available on a subscribed service. (#37)
- **Share pre-filtering by subscribed services** — the Share modal pre-selects the user's subscribed providers as the default filter when generating a share link.

### Landing page

- **Standalone landing page at `/`** — welcome content moved from a modal to a full marketing page at the root route. Returning visitors are redirected directly to `/app`. (#38)
- **Landing page redesign** — hero with interactive product mock (Grid / List / Gantt tab switcher), ambient parallax glow, scroll-reveal animations, Features 4-up, "How it works" 3-step section, and bottom CTA card. App nav links hidden on the landing page.

### Navigation

- **Search in top nav** — "Search" added as the leftmost nav link, surfacing the add-titles flow as a first-class destination. (#53)

### Design

- **Design reference** — `.design-sync/design-reference.md` added as a canonical record of the app's visual language: semantic color roles, typography scale, border radius, component class patterns, layout conventions, z-index stack, and transitions.

---

## [0.4.1] — 2026-05-31

### Bug fixes

- **Episode count for upcoming/current seasons** — the orange chip row in the detail panel now shows episode count (e.g. "8 eps") alongside the release date, consistent with watchable season rows. Only shown when TMDB has the count.

### Docs

- **Welcome modal** — added "Share your queue" as a fourth feature point covering encrypted share links and pre-share filtering.
- **README** — added previously undocumented features: Rent/Buy indicator, Kanopy/Hoopla library fallback links, named queues with per-queue color coding, and 30-day share link expiration.

---

## [0.4.0] — 2026-05-31

### Detail panel

- **Detail panel on search page** — tapping a poster in search now opens the same detail panel as the queue page, with an "Add to Queue" footer instead of watched/remove actions.
- **Compact title bar** — replaced the tall blurred backdrop header with a slim title bar + close button, recovering significant vertical space on mobile.
- **Runtime lollipop in detail panel** — the same provider-colored sparkline shown in grid/list cards now appears in the detail panel's runtime row.
- **Tap-to-expand poster lightbox** — tapping the poster in the detail panel zooms it to a full-screen overlay (`w500` resolution); tap anywhere to close.
- **Episode count per season** — the seasons section in the detail panel now shows episode count alongside each season chip (e.g. "S1 · 8 eps").

### Release chip fixes

- **Mid-season vs. premiere distinction** — shows actively releasing new episodes (where `last_episode_to_air` and `next_episode_to_air` share the same season number) now show "S1 new episode Jun 5" or "S1 airing now" instead of "S1 premieres". (#28)

### Mobile sizing

- **xs breakpoint (375px)** — added a custom Tailwind breakpoint at 375px for a proper three-tier responsive system: base / `xs:` iPhone mini+ / `sm:` tablet+. (#28)
- **`overflow-x: clip` replaces `overflow-x: hidden`** — `hidden` creates a scroll container that iOS Safari can still pan into; `clip` is a true hard clip with no scroll container. Combined with `max-width: 100vw` on `html`/`body`. (#28)
- **Viewport meta reset on resize** — iOS Safari misreports viewport width during keyboard and file-picker animations, causing `sm:` breakpoints to fire on narrow screens. A global resize listener re-stamps the viewport meta to correct it. (#28)
- **Tighter nav and spacing** — nav height, logo/link text, main padding, footer, and empty-state sizes all reduce at the base tier and expand at `xs:`/`sm:`. (#28)

### Export / Import

- **Complete state capture** — export now includes `weeklyHours`, `weeksPerMonth`, `queueColors`, `sort`, and `view` preferences in addition to theme and queue name. A fresh import is now a full restore. (#28)
- **Queue name restored on import** — was missing from the export payload. (#28)
- **"Shared Queues" rename** — the section formerly called "Imported Queues" in Settings is renamed to avoid confusion with the file import feature. (#28)

---

## [0.3.0] — 2026-05-29

### Sharing

- **Encrypted share links** — share a filtered subset of your queue as a short URL. The decryption key lives only in the URL fragment; the server stores only the encrypted blob and can never read plaintext. Links expire after 30 days. (#13, #14)
- **Share filters** — choose what to include before generating a link: To Watch / Watched / Both, Movies / TV / All, per-provider toggles, and (when 2+ named queues exist) a queue picker. (#14, #25)
- **Queue tags preserved on import** — each shared item now carries its original queue tag. Recipients' items land in the correct queue rather than all being lumped into "Shared List". Old share links without per-item tags fall back gracefully. (#25)
- **Queue name in share header** — when sharing a single named queue, its name becomes the share title. (#25)

### Season chips

- **Orange upcoming-season chip** — unreleased seasons appear as an outlined orange chip in the same row as watchable season chips. Clicking the chip opens a popup with the full premiere date. (#20, #21)
- **Unreleased seasons are not checkable** — seasons at or beyond `next_season`, and seasons TMDB lists with zero episodes (announced but not yet airing), are hidden from the regular chip row and replaced by the orange chip. Fixes Severance, Dune: Prophecy, and similar shows. (#22, #24)
- **✓ replaces S on watched seasons** — `S2` becomes `✓2` when marked watched. Same character count keeps chip width stable; unambiguous for colorblind users. (#22)
- **Consistent chip height** — all three chip states (watched/teal, unwatched/gray, upcoming/orange) now use `inline-flex items-center` so height is driven by padding rather than per-character font metrics. The orange chip's wrapper div is also removed as a flex item. (#23, #24)
- **Backfill seasons on Refresh Providers** — items added before per-season data was stored had `seasons: []`. Settings → Refresh Providers now writes seasons and runtime back to IndexedDB, fixing missing chips without requiring titles to be re-added. (#21)

### Bug fixes

- **Share page "Add to my queue"** — Svelte 5 `$state` wraps array elements in Proxy objects that IndexedDB's structured clone algorithm cannot serialize (`DataCloneError`). Fixed by mapping providers to plain objects before storing. (#15, #16, #17, #21)
- **Runtime sort accuracy** — list view was sorting by total `runtime_minutes` while displaying remaining runtime after watched seasons. Sort now uses `effectiveRuntime` so order matches what's shown. (#19)
- **Disney+/Hulu provider disambiguation** — FX originals (e.g. The Bear) no longer show Disney+ instead of Hulu. Provider resolution now uses TMDB network/company metadata to determine which of the pair is the canonical home. (#12)
- **Season chips clipped in grid view** — `overflow-hidden` on the outer card div was clipping the chip row when a neighboring card was shorter. Moved to just the poster container. (#21)

### Polish

- **Flat SVG cog icon** — the mobile nav gear was a 3D emoji (renders as colored on iOS/Android); replaced with a monochrome Heroicons-style SVG consistent with the rest of the app. (#18)
- **Settings → Danger Zone** — two-step "Reset everything" clears the IndexedDB queue and all preferences, then redirects to `/` with the welcome screen. First click arms a confirmation banner; Cancel disarms safely. (#25)
- **IDB connection caching** — the `IDBDatabase` promise is cached at module level so all `addItem` calls reuse one connection. (#16)

---

## [0.2.0] — 2026-05-12

### Features

- **Provider polish** — Disney+ inferred from TMDB-native metadata (networks/production companies) since JustWatch removed their catalogue; bundle deduplication removes tier variants (Peacock Premium Plus) and bundle-only entries (Apple TV Amazon Channel). (#9, #12)
- **Release dates** — surfaces theatrical windows, estimated streaming dates, and next-season premieres on every card across Grid, List, Gantt, and Search. (#9)
- **Gantt improvements** — bar widths and labels use remaining runtime (accounting for watched seasons); lanes sort by the active filter (Recent, A–Z, Runtime). (#9)
- **Settings** — compound budget input (hrs/week × weeks/month); Refresh provider data button; in-app feedback (files GitHub issues); version badge. (#9)
- **Suggest** — ranked by total remaining runtime instead of title count. (#9)

---

## [0.1.0] — 2026-05-11

### Features

- **Grid, List, and Gantt views** — runtime sparklines, provider swimlanes, and draggable lane ordering. (#3, #6)
- **Local-only storage** — watchlist lives in IndexedDB; encrypted `.queuest` backup/restore via AES-GCM + PBKDF2. (#2)
- **Season tracking** — per-season chip toggles with progress tracking. (#6)
- **Light/dark mode** — full theme system with flash-prevention; persisted in localStorage. (#6)
- **Welcome modal** — first-visit onboarding; re-accessible from Settings. (#6)
- **Runtime estimates** — fetches movie runtime and TV total hours from TMDB on add. (#1)
