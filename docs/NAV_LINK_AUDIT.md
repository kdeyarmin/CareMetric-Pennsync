# Navigation Link Audit

Date: 2026-06-03

A verification pass over **every link reachable from the navigation bar** — that
each link resolves to a routed page *and* that the page actually mounts and
renders without crashing. Complements the IA/organization work in
`UI_UX_REVIEW.md` and `ROUTE_CONSOLIDATION.md`.

## Scope — 33 unique link targets

| Surface | Source |
| --- | --- |
| Desktop sidebar | `nav.manifest.js` entries with `category != null` (24 non-admin + 8 admin) |
| Mobile drawer | same manifest data as the sidebar |
| Mobile bottom bar | 5 hardcoded (`MobileBottomNav.jsx`): Home, Patients, Notes, Fax, Messages |
| Logo / favorites | Dashboard; favorites resolve to nav pages + `PatientDetails` |

The command palette (⌘K) and breadcrumbs are **safe by construction** — both are
filtered to routed pages in `nav.manifest.js` (`buildPaletteEntries`,
`isLinkablePage`), so they cannot offer an unrouted destination.

## How links resolve

`createPageUrl(page)` lowercases the page key (`SmartNoteAssistant` →
`/smartnoteassistant`); React Router matches case-insensitively against the
PascalCase route `path` (`/SmartNoteAssistant`), so every nav URL resolves to its
route. Page keys contain no spaces, so the helper's space→hyphen step never
applies to nav links.

## Layer 1 — static audit (link resolves to a real page)

For each of the 33 targets: confirmed it is **routed** (a `src/pages/*.jsx` file
exists and is in `PAGE_NAMES`), has a **default export**, and is **not a
placeholder stub**.

- **Result: 33/33 pass — zero dead links, zero missing files, zero stubs.**
- False positives ruled out: an early scan flagged 18 pages for
  "placeholder"/"coming soon" — all benign (input `placeholder=` attributes; one
  sub-feature toast `alert('… coming soon')` inside the 1762-line `DocumentVisit`).
  `PhysicianDirectory` (19 lines) is a valid thin wrapper around the
  `<PhysicianDirectory>` component.
- No `REDIRECT` `from` path collides with a sidebar target (no mis-routing).

## Layer 2 — build (module + import graph resolve)

`npm run build` compiles every routed page and its full transitive import graph
into its own lazy chunk. Build is green and emits a per-page chunk for all 122
routed pages — proof that each nav target's module loads and its imports resolve.

## Layer 3 — render smoke test (the page actually mounts)

`src/test/navPages.test.jsx` (Vitest + jsdom + Testing Library) mounts every
nav-bar page with the base44 backend, auth context, and the browser APIs jsdom
lacks (ResizeObserver, IntersectionObserver, canvas, DOMMatrix, …) all mocked,
and asserts each page mounts without throwing — the class of runtime crash a
build can't catch. The page list is derived from the live manifest, so new
sidebar entries are covered automatically.

Run it with `npm run test:components` (or `npx vitest run src/test/navPages.test.jsx`).

- **Result: 33/33 nav pages mount without crashing.**

### Bug surfaced by the smoke test: `PageHeader` crashed on lucide icons

The smoke test surfaced a real crash. `PageHeader` chose how to render its `icon`
prop with `typeof IconProp === "function"`. lucide-react (1.17.0) icons are
`React.forwardRef` **objects**, not functions, so that check fell through to
rendering the bare object as a child — which React rejects with *"Objects are not
valid as a React child (found: object with keys {$$typeof, render})"*. Every page
that passes `icon={SomeLucideIcon}` to `PageHeader` and renders it (≈13 pages,
including the nav pages **PhysicianDirectory, ResourceLibrary, Telehealth,
UserSettings, PatientDataManagement, DocumentHub, ReferralIntake**) crashed when
the header rendered. The crash is invisible to a build (it compiles fine) and was
caught by the smoke test mounting the pages that render `PageHeader` on first
paint; pages that render it only after a loading guard mask the same bug behind
their loading state.

**Fix** (`src/components/ui/PageHeader.jsx`): use `isValidElement` to tell an
already-built element (render as-is) from a component type (render via
`<IconProp/>`), which works for function components, `forwardRef`, and `memo`.
This exact fix also landed on `main` independently while this branch was open
(corroborating the bug), so it arrives via the merge; the value this branch adds
is the smoke test that now guards against the crash regressing.

## Caveat

This verifies routing, module integrity, and component mount/render — everything
that determines whether a nav link lands on a working page. It does not exercise
full interactive behavior with live data (the pages fetch PHI from the base44
backend, which needs auth and isn't available offline). The mocked data is empty,
so it confirms pages render their loading/empty states without crashing, not that
every data-driven view is correct.

## Bottom line

All 33 navigation-bar links resolve to routed pages, and all 33 pages mount and
render without crashing (after the `PageHeader` fix). The smoke test is committed
so the guarantee is repeatable and extends to future nav entries automatically.
