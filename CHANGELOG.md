# Changelog

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
