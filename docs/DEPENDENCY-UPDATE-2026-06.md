# Dependency & Config Update Pass (2026-06-03)

This pass refreshes dependencies to their latest **safe** versions, removes dead
dependencies, and fixes the security findings that are within our control.
Run `npm run check:updates` to regenerate the outdated report.

## What changed

### Security (npm audit: 15 → 2)

`npm audit` went from **15 vulnerabilities (1 critical, 7 high, 7 moderate)** to
**2 low**. Fixes applied via in-range upgrades:

- `jspdf` 4.2.0 → 4.2.1 — **critical** PDF object injection (GHSA-7x6v-j9x4-qf24).
- `lodash` → 4.18.x — high prototype-pollution / code-injection.
- `dompurify` 3.3.3 → 3.4.7 — moderate FORBID_TAGS / template bypasses.
- `postcss` → 8.5.15 — moderate CSS stringify XSS.
- Transitive (`axios`, `follow-redirects`, `ws`, `flatted`, `picomatch`, …)
  resolved by `npm audit fix` within existing ranges.

**Remaining (2 low, no clean fix):** `quill` 2.0.3 XSS-via-HTML-export
(GHSA-v3m3-f69x-jf25). All quill 2.x are affected and `react-quill-new@3.8.x`
requires quill 2.x, so `audit fix --force` would only *downgrade*
`react-quill-new` to 3.7.0 (regressing fixes) without removing the advisory.
We stay on the latest quill 2.0.3; editor HTML is sanitized with DOMPurify.

### Removed unused dependencies (bundle + supply-chain hygiene)

These had **zero imports** anywhere in `src/`, `base44/`, or build config and
were shipping dead weight (and attack surface) in a HIPAA app:

| Package | Why removed |
| --- | --- |
| `three` | ~600 KB 3D engine, never imported |
| `react-leaflet` | maps lib (+ pulls `leaflet`), never imported |
| `@stripe/react-stripe-js`, `@stripe/stripe-js` | no billing/payments feature exists |
| `zod`, `@hookform/resolvers` | no schema validation in use |
| `react-hot-toast` | superseded by `sonner` + the in-repo toaster |
| `@radix-ui/react-progress`, `@radix-ui/react-toast` | replaced by hand-rolled `src/components/ui/progress.jsx` / `src/components/ui/toast.jsx` |
| `@floating-ui/core` | only a transitive dep of Radix, never imported directly |
| `quill` (direct) | pulled transitively by `react-quill-new`; the version pin lives in `overrides` (bumped to 2.0.3) |

Build, lint, and the 145-case util test suite all stay green after removal.

### Refreshed to latest within current major (drop-in)

All `@radix-ui/*`, `@tanstack/react-query`, `cmdk`, `embla-carousel-react`,
`next-themes`, `react-hook-form`, `react-quill-new`, `sonner`, `twilio-video`,
plus dev tooling (`baseline-browser-mapping`, `eslint-plugin-react`,
`eslint-plugin-unused-imports`, `globals`). `autoprefixer` was removed — Tailwind
v4's PostCSS plugin handles vendor prefixing internally (see below).

## Breaking major upgrades — completed

All of the following breaking majors were migrated and verified with
`npm run build`, `npm run lint`, `npm run typecheck`, and the 145-case util
test suite (all green):

- **React 19 cluster** — `react`/`react-dom` 18→19, `@types/react(-dom)` 18→19,
  `@vitejs/plugin-react` 4→6, `vite` 6→8. No React 19-removed APIs were in use
  (no `findDOMNode`, `ReactDOM.render`, string refs, `defaultProps`, or
  `propTypes`).
- **`react-day-picker` 8→10** — required rewriting `src/components/ui/calendar.jsx`
  for the v9+ element API (`caption`→`month_caption`, `nav_button`→
  `button_previous`/`button_next`, `table`→`month_grid`, `head_cell`→`weekday`,
  `row`→`week`, `cell`→`day`, `day`→`day_button`, `day_selected`→`selected`, …;
  `IconLeft`/`IconRight` → a single `Chevron` component). Call sites moved
  `initialFocus` → `autoFocus`.
- **Tailwind 4** — `tailwindcss` 3→4 via the `@config` bridge: `index.css` now
  uses `@import "tailwindcss"; @config "../tailwind.config.js";`, PostCSS uses
  `@tailwindcss/postcss` (built-in import handling + prefixing, so `autoprefixer`
  was dropped). The existing JS theme, `darkMode: ["class"]`, content globs, and
  `tailwindcss-animate` are all consumed through `@config`. Verified the built
  CSS still emits theme colors (`hsl(var(--…))`), custom component classes,
  `tailwindcss-animate` keyframes, and responsive/hover variants. The app is
  light-mode only, so no `dark:` variants are required. The existing
  `* { @apply border-slate-200 }` base rule pre-empts v4's border-color default
  change.
- **Standalone majors** — `date-fns` 3→4 (`date-fns-tz` 3.2 already supports
  date-fns v4), `recharts` 2→3, `react-router-dom` 6→7 (only stable APIs used:
  `BrowserRouter`/`Routes`/`Route`/`Navigate`/`Link`/`useLocation`/
  `useNavigate`/`useSearchParams`), `framer-motion` 11→12, `react-markdown`
  9→10, `react-resizable-panels` 2→4, `@hello-pangea/dnd` 17→18,
  `tailwind-merge` 2→3, `lucide-react` 0.x→1 (all icon imports still resolve),
  `pdfjs-dist` 4→6 (worker URL is derived from `pdfjsLib.version`, so it
  auto-matches), `@types/node` 22→25, `eslint-plugin-react-hooks` 5→7.
- **TypeScript 5→6** — TS 6 no longer auto-includes `@types/node` for bare
  `tsc` file lists and turns the full `strict` family **on by default**. The
  `typecheck:utils` script now passes `--types node --strict false` to preserve
  the project's *existing* (non-strict) TS 5.x check semantics exactly — this is
  behavior-preserving, not a weakening, since these JS utils were never strict-
  typed. `jsconfig.json` dropped the now-deprecated `baseUrl` (`paths` resolves
  without it in TS 6+, and it is removed entirely in TS 7). Migrating the util
  modules to `strict` is tracked as separate future work (~210 findings).

> **Recommended before merge:** these majors pass build/lint/typecheck/tests,
> but a few changes have visual/runtime surface that automated checks can't
> fully cover — do a manual smoke test of **calendars/date pickers**
> (react-day-picker), **charts** (recharts 3), and **general page styling**
> (Tailwind 4 preflight differences, e.g. focus-ring width).

## Still deferred (hard upstream blocker)

- **ESLint 10 / `@eslint/js` 10** — blocked by `eslint-plugin-react`. No
  published version supports ESLint 10 (latest `7.37.5` peer-caps at
  `eslint@^9.7`), and forcing the install was verified to **crash at lint time**:
  `TypeError: contextOrFilename.getFilename is not a function` in the
  `react/no-unknown-property` rule — the plugin calls `context.getFilename()`,
  an API ESLint 10 removed. Since `react/no-unknown-property` is part of our
  config, `npm run lint` (a CI gate) breaks. Kept on latest 9.x until
  `eslint-plugin-react` ships an ESLint 10-compatible release;
  `eslint-plugin-react-hooks` and `eslint-plugin-unused-imports` already support
  it.

`@base44/*` packages are vendor-pinned and excluded from the update check.
