# Queuest Design Reference

Queuest is a streaming-queue manager. The visual language is **Tailwind v4 utilities only** — no custom component classes, no CSS modules. Dark mode is toggled by a `.dark` class on `<html>` (not `prefers-color-scheme`). The only custom breakpoint is `xs` at 375px.

---

## Semantic Color Roles

| Role | Light | Dark |
|------|-------|------|
| **Page background** | `bg-gray-50` | `dark:bg-gray-950` |
| **Surface / card** | `bg-white` | `dark:bg-gray-900` |
| **Surface secondary** | `bg-gray-100` | `dark:bg-gray-800` |
| **Nav bar** | `bg-white/90 backdrop-blur` | `dark:bg-gray-900/90 backdrop-blur` |
| **Primary text** | `text-gray-900` | `dark:text-gray-100` |
| **Secondary text** | `text-gray-600` | `dark:text-gray-400` |
| **Muted text** | `text-gray-500` | `dark:text-gray-500` |
| **Border** | `border-gray-200` | `dark:border-gray-800` |
| **Card ring** | `ring-1 ring-gray-200` | `dark:ring-0` |

### Brand / Interactive
- **Primary action:** `bg-orange-500 hover:bg-orange-400` — used on every CTA button and active indicator
- **Focus ring:** `ring-orange-500` (on inputs and focused controls)
- **Active nav underline:** `border-gray-900 dark:border-white`

### Semantic States
| State | Background | Text |
|-------|-----------|------|
| Watched / success | `bg-teal-100 dark:bg-teal-900/60` | `text-teal-700 dark:text-teal-400` |
| Warning / upcoming | `bg-amber-50 dark:bg-amber-950/20` | `text-amber-800 dark:text-amber-300` |
| Release chip | `bg-orange-100 dark:bg-orange-950/40` | `text-orange-700 dark:text-orange-300` |
| Destructive hover | `hover:bg-red-100 dark:hover:bg-red-900/50` | `hover:text-red-600 dark:hover:text-red-400` |
| Subscribed service | border `#22c55e` (inline style) | — |

---

## Typography

All type is system default — no custom font loaded. Sizes from smallest to largest used in the app:

```
text-[9px]   — micro metadata (season chip labels)
text-[10px]  — axis labels, timestamps, fine print
text-[11px]  — provider chip labels
text-xs      — dropdown items, secondary labels
text-sm      — primary body text, button labels
text-base    — hero/landing copy
text-xl      — page headings (sm:text-2xl)
text-4xl     — landing hero (sm:text-5xl)
```

Font weights: `font-medium` (500) · `font-semibold` (600) · `font-bold` (700).  
Line heights: `leading-tight` on headings, `leading-relaxed` on descriptions, `leading-none` on icon-only elements.

---

## Border Radius

| Value | Usage |
|-------|-------|
| `rounded` | Inline chips, season pills |
| `rounded-md` | Segment-control buttons inside a group |
| `rounded-lg` | Standard buttons, inputs, dropdowns |
| `rounded-xl` | Cards, service chips, Gantt bars, modals (sm+) |
| `rounded-2xl` | Bottom-sheet modal (mobile) |
| `rounded-full` | Cancel-candidate badge, avatar fallback |

---

## Component Patterns

### Primary Button
```html
<button class="rounded-lg bg-orange-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-orange-400">
  Label
</button>
```
Large variant (landing CTA): `rounded-xl px-8 py-3 text-sm font-semibold`

### Secondary / Ghost Button
```html
<button class="flex items-center gap-1.5 rounded-lg bg-gray-100 px-3 py-2 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-200 hover:text-gray-900 dark:bg-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white">
  Label
</button>
```

### Destructive Button (inline — e.g. remove)
```html
<button class="rounded-md bg-gray-100 px-2 py-1 text-xs text-gray-500 transition-colors hover:bg-red-100 hover:text-red-600 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-red-900/50 dark:hover:text-red-400">
  ✕
</button>
```

### Watched / Success Button
```html
<button class="rounded-lg bg-teal-100 py-2 text-sm font-medium text-teal-700 transition-colors hover:bg-teal-200 dark:bg-teal-900/40 dark:text-teal-400 dark:hover:bg-teal-900/60">
  ✓ Watched
</button>
```

### Input Field
```html
<input class="flex-1 rounded-lg bg-gray-100 px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 outline-none ring-1 ring-gray-300 transition-shadow focus:ring-orange-500 dark:bg-gray-900 dark:text-gray-100 dark:placeholder-gray-500 dark:ring-gray-800 dark:focus:ring-orange-500" />
```

### Card (Grid)
```html
<div class="flex flex-col overflow-hidden rounded-xl bg-white ring-1 ring-gray-200 dark:bg-gray-900 dark:ring-0">
  <!-- poster: aspect-[2/3] rounded-t-xl overflow-hidden -->
  <!-- body: p-2.5 sm:p-3 -->
</div>
```

### Card (List Row)
```html
<div class="flex flex-col bg-white px-3 py-2.5 transition-colors hover:bg-gray-50 dark:bg-gray-900/40 dark:hover:bg-gray-900/80">
</div>
```

### Segment Control (Tab / Sort toggle)
```html
<div class="flex gap-0.5 rounded-lg bg-gray-100 p-1 dark:bg-gray-800">
  <button class="rounded-md px-3 py-1 text-xs font-medium transition-colors bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-white">Active</button>
  <button class="rounded-md px-3 py-1 text-xs font-medium transition-colors text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white">Inactive</button>
</div>
```

### Type / Season Chip
```html
<!-- Active/watched -->
<span class="inline-flex items-center rounded bg-teal-100 px-1.5 py-0.5 text-[9px] font-semibold leading-none text-teal-700 dark:bg-teal-900/60 dark:text-teal-400">✓S1</span>
<!-- Inactive -->
<span class="inline-flex items-center rounded bg-gray-100 px-1.5 py-0.5 text-[9px] font-semibold leading-none text-gray-500 dark:bg-gray-800 dark:text-gray-500">S2</span>
```

### Queue/Filter Chip (round pill)
```html
<!-- Active -->
<button class="flex items-center gap-1.5 rounded-full bg-orange-50 px-2.5 py-1 text-xs font-medium text-orange-700 ring-1 ring-orange-300 transition-colors dark:bg-orange-950/40 dark:text-orange-400 dark:ring-orange-800">Tag</button>
<!-- Inactive -->
<button class="flex items-center gap-1.5 rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-500 ring-1 ring-gray-200 transition-colors hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:ring-gray-700">Tag</button>
```

### Navigation Bar
```html
<nav class="sticky top-0 z-50 border-b border-gray-200 bg-white/90 backdrop-blur dark:border-gray-800 dark:bg-gray-900/90">
  <div class="mx-auto flex h-11 max-w-5xl items-stretch gap-3 px-3 sm:h-14 sm:gap-6 sm:px-4">
    <!-- logo: text-base font-bold tracking-tight -->
    <!-- links: flex items-center border-b-2 text-xs sm:text-sm transition-colors -->
  </div>
</nav>
```

### Dropdown / Popup
```html
<div class="absolute left-0 top-full z-40 mt-1 min-w-max rounded-xl bg-white p-2 shadow-lg ring-1 ring-gray-200 dark:bg-gray-900 dark:ring-white/10">
</div>
```

### Bottom-sheet Modal (mobile) / Right Drawer (sm+)
```html
<div class="fixed bottom-0 inset-x-0 z-50 flex max-h-[90vh] flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl dark:bg-gray-900 sm:inset-y-0 sm:right-0 sm:left-auto sm:w-[22rem] sm:max-h-none sm:rounded-t-none sm:rounded-l-2xl">
</div>
<!-- Scrim -->
<div class="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"></div>
```

### Warning / Cancellation Alert
```html
<div class="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-700/40 dark:bg-amber-950/20">
  <!-- icon or logo -->
  <p class="text-sm text-amber-800 dark:text-amber-300">Message</p>
  <button class="text-amber-400 hover:text-amber-600">✕</button>
</div>
```

---

## Layout Conventions

- **Max content width:** `max-w-5xl` with `px-3 sm:px-4` gutters
- **Page vertical rhythm:** `py-4 sm:py-8`
- **Card grid:** `grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5` with `gap-3 sm:gap-4`
- **Section spacing:** `space-y-4 xs:space-y-6`
- **Responsive text:** most labels use `hidden sm:inline` to show full labels at sm+, icons or abbreviations below

---

## Overlay / Z-index Stack

```
z-20  — inline popup (release chip tooltip)
z-40  — scrim, dropdown
z-50  — modal, Gantt popup, nav
z-[60] — poster lightbox
```

---

## Transitions

All interactive elements use `transition-colors`. Duration is Tailwind's default (150ms). The Gantt bar uses `transition-all duration-100` for tighter feedback. Sparkline bars use `transition-all duration-300`.

---

## Accessibility Notes

- Disabled buttons use `disabled:opacity-40`
- Scrim clicks dismiss overlays (no `<dialog>` element used)
- `aria-label` on icon-only buttons (settings gear, close ✕)
- `data-item`, `data-dropdown`, `data-detail-panel` used as click-outside sentinels
