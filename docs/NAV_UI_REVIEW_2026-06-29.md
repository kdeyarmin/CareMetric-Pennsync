# Navigation & UI Review — 2026-06-29

A whole-app review focused on making CareMetric easy to use for every employee
(nurses, facility admins, super admin) **without losing robustness**. This
complements the earlier `UI_UX_REVIEW.md`, `NAV_LINK_AUDIT.md`,
`MOBILE_RESPONSIVENESS_REVIEW.md`, and `NURSE_APP_IMPROVEMENTS.md` — it does not
repeat their completed work (the navigation manifest, reachability-aware nav,
dark-mode fix, `PageHeader`/`PageContainer` standard, mobile shell, gray→slate
sweep). It records the gaps still open in the *navigation shell* and fixes the
highest-value, lowest-risk ones.

## Overall assessment

The navigation architecture is genuinely strong and should be kept as-is:

- **One source of truth.** `src/lib/nav.manifest.js` drives the sidebar, mobile
  drawer, breadcrumbs, and `⌘K` command palette. Routes are derived from it, so
  nav can't offer a destination that doesn't render.
- **Role-aware.** A clean three-tier model (`super_admin` / `facility_admin` /
  `nurse`, `src/lib/roles.js`) gates both the routes and what each surface shows.
  Nurses get a focused clinical view; admin tooling is folded behind an Admin
  Console launchpad + palette rather than bloating the sidebar.
- **Discoverable + accessible.** Visible "Search ⌘K" trigger, recent pages,
  skip-to-content link, keyboard-navigable palette, safe-area-aware mobile chrome.

The remaining issues are shell-level polish, not structural.

## Fixed in this change

### 1. Sub-pages left the navigation with no "you are here" indicator — FIXED ✅

`Layout.jsx` computed the active nav item with an **exact match**
(`currentPageName === pageName`). Every detail / sub page in the manifest carries
`category: null` (PatientDetails, PatientAlerts, SmartNoteAssistant, the OASIS
sub-tabs, AgencyAnalytics, every admin sub-page, UserGuides, …), so as soon as a
user drilled in from a sidebar section, **no sidebar item was highlighted at
all** — the single most common "where am I?" failure in the app. The mobile
bottom bar had the same gap (e.g. opening a patient chart didn't keep "Patients"
lit).

**Fix.** Added two pure helpers to `nav.manifest.js`:

- `navActivePage(pageName)` — walks the existing `breadcrumbParent` chain to the
  nearest entry that *is* a sidebar item, so a sub-page resolves to the section
  that should stay highlighted (PatientDetails → **Patients**, AgencyAnalytics →
  **Reports & Analytics**, UserGuides → **Help**, AdminTrainingAnalytics →
  **Admin Console**). Cycle-safe.
- `isNavItemActive(currentPageName, candidatePage)` — true on an exact match
  (so non-sidebar shortcuts like the bottom-nav "Notes" still light on their own
  page) **or** when the candidate is that nearest sidebar ancestor.

`Layout.jsx`'s `isActive` now delegates to `isNavItemActive`, so the desktop
sidebar, mobile drawer, **and** mobile bottom bar all gain correct active state
from one change. Because each page has a single ancestor chain, at most one
sidebar item per section ever lights — verified by test.

Covered by `src/lib/nav.manifest.spec.js` (10 cases, incl. multi-hop chains, the
cyclic-chain guard, and the "exactly one item lights" invariant).

### 2. Sidebar collapse state reset every session — FIXED ✅

The desktop sidebar collapse toggle lived in `useState(false)`, so a user who
prefers the compact rail had to re-collapse it on every reload. It now persists
to `localStorage` (read lazily so the first paint matches the saved choice;
storage failures in private mode are non-fatal).

## Verification

- `npx vitest run src/lib/nav.manifest.spec.js` — 10/10 pass.
- `npx vitest run src/test/navPages.test.jsx` — 72/72 pages still mount.
- `npm run build` — passes.
- ESLint on changed files — clean (`--max-warnings 0`).

## Roadmap follow-through — all items actioned

The roadmap below was implemented in the same effort (a second commit on this
branch). Each is recorded with its outcome.

**P1 — robustness / clarity — DONE ✅**
- **Role-aware mobile bottom bar.** `MobileBottomNav` previously hardcoded Home /
  Patients / Notes / Fax / Messages for everyone, surfacing back-office faxing to
  nurses while hiding referrals/documents from admins. It now takes `isAdmin`
  (passed by `Layout`) and renders the role's real top tasks: nurses keep the
  clinical set (Notes, Fax); facility/super admins get **Referrals** and
  **Documents**. Both keep Home / Patients / Messages. Active state is the new
  ancestor-aware match, so deep pages keep the right tab lit.
- **Command-palette quick actions.** The `⌘K` palette is now a "do things" bar,
  not just a jump list: a top **Actions** group offers *Start a Smart Note*,
  *Send a fax*, *New message*, *Request time off*, and *New referral / intake*
  (admin-gated). Each routes to the page that begins the flow, so an action can
  never dead-end.

**P2 — information architecture — DONE ✅**
- **Duplicate page families** (`UI_UX_REVIEW.md` #4) — verified **already
  complete**: OASIS (9 variants), Compliance (5), Learning/Training (8), and the
  dashboard duplicates each now redirect into a single canonical tabbed page (see
  `REDIRECTS` in `src/routes.jsx`). Every family has exactly one routed home;
  nothing unsafe remained to collapse. Deleting the orphaned page files still on
  disk is a separate "dead code" effort (`NURSE_APP_IMPROVEMENTS.md` #23),
  deliberately not bundled into this nav/UI change.
- **Admin Console launchpad completeness.** Audited every admin routed page
  against `AdminConsoleDirectory`. The only gap was **ReferralIntake /
  ReferralTriage** (reachable via the sidebar but absent from the console). Added
  an **Intake & Referrals** group so the launchpad now lists every admin tool.

**P3 — polish — DONE ✅**
- Applied the genuine non-tab mobile offenders: `ClinicalPathwayManager`'s 4-up
  stat grid (`grid-cols-2 sm:grid-cols-4`) and its 3-up trigger-editor form row
  (`grid-cols-1 sm:grid-cols-3`, so the dropdowns stack on phones). The remaining
  `grid-cols-4/5` instances are all `TabsList` bars already handled by the global
  wrapping-flex rule from `MOBILE_RESPONSIVENESS_REVIEW.md` #1, and the dashboard
  KPI fonts/scroll areas were already responsive — so no further churn was
  warranted.

## Dead-code cleanup (orphaned redirected pages)

Followed up by removing the page files that were retired into redirects and are
no longer imported anywhere — each currently compiled into its own unused build
chunk. Verified by exhaustive whole-repo reference check before deletion:

- **Removed** `ClinicalChart`, `ClinicalInsightsDashboard`, `MyLearning`,
  `NurseEducationVideos` — only referenced by their `REDIRECTS` entries (kept, so
  old links/bookmarks still resolve) and stale comments.
- **Kept** `AnalyticsDashboard.jsx` — although it has no standalone route, it is
  still lazy-imported and rendered as the "Performance Analytics" tab inside
  `ReportsAnalytics`, so it is live code, not dead. (Deleting it would have broken
  that tab — the reason every candidate was import-checked, not just
  redirect-checked.)
- Repointed a backend notification deep-link (`remindPlanOverdueStaff`
  `action_url`) from the retired `/MyLearning` to the canonical
  `/LearningCenter?tab=courses` so it links directly instead of via a redirect hop.

### SmartNote orphan-component sweep

Followed `NURSE_APP_IMPROVEMENTS.md` #23 / `SMARTNOTE_REVIEW.md`. The directory had
already shrunk from 143 files (review-time) to 45 product files, so most orphans
were gone. Rather than trust the old count, ran a **reachability analysis** (BFS
over the static + dynamic + `import.meta.glob` import graph, rooted at every
routed page) to find files unreachable from any route, then grep-verified each.

**Removed (7):** five unreferenced components — `AIPatientSummaryReport`,
`RichTextNoteEditor`, `VoiceClinicalNoteRecorder`, `smartNote/PatientSummaryGenerator`
(the live summary generator is `components/patient/PatientSummaryGenerator`, a
distinct file), `SmartVitalsInput` (only a test naming-convention string named it)
— plus `compliance/scoreNoteFromText.js` and its test (used only by that test, and
the test isn't even in the `test:utils` run, so doubly dead).

**Kept intentionally:** `smartNote/GuidelineContextRetriever` — it has three real
importers in `components/guidelines/`, one chaining from the (possibly live)
`UnifiedComplianceEngine`. It's only "dead" if that whole guidelines/compliance
cluster is dead, which is a separate subsystem analysis. Two guidelines components
(`InlineGuidelineSuggester`, `GuidelineReferencePanel`) also appear unimported and
are noted as a **follow-up** — deliberately not touched here to keep this sweep
scoped to the SmartNote directory.

Verified: clean build, `vitest run` (55 files / 303 tests) and `test:utils`
(624 tests) all pass after removal.

### App-wide dead-component elimination (reachability fixpoint)

Extended the SmartNote analysis to the **whole `src/` tree**. The reachability
script classifies each non-routed, non-test file by how many *other* files
mention its basename; **zero mentions repo-wide (`src/` + `base44/`) ⇒ nothing
imports it ⇒ dead.** Each candidate was additionally cross-checked against
`package.json` test/lint targets and the build configs, and the production build
is the final backstop (a missed import fails compilation).

Removed **223 unreferenced files** across the component tree, iterating to a
fixpoint (deleting a file exposes files only it imported — 4 rounds until none
remained). These were never wired into any route: abandoned AI-feature variants,
duplicate dashboards/widgets, superseded document/signature and training
modules, and unused `ui/` primitives. Largest areas: training (32), documents
(24), compliance (21), analytics (18), `ui/` (16), patient (13), import (11),
fax (10), dashboard (10).

Notably this also removed `patient/HospitalReadmissionRisk.jsx` — the component
carrying the `comorbidityCount` `ReferenceError` flagged P0 in
`NURSE_APP_IMPROVEMENTS.md` #1. It was dead code (rendered nowhere), so the bug
was unreachable; deleting it resolves the finding.

**Kept (not dead):** files whose basename is referenced elsewhere — including
heavily-used infra the BFS under-roots (`api/entities.js`, `ui/sonner.jsx`,
`ui/form.jsx`, `lib/notify.js`) — were never in the zero-reference set and were
left untouched. Three `src/functions/*` wrappers whose names merely *collide*
with same-named `base44/` backend functions/comments were verified (the
references are comments + the backend function itself, not imports of the
wrapper) and removed.

Verified after the fixpoint: clean build, `vitest run` (303 tests) and
`test:utils` (624 tests) all green.

Also removed `ui/Pagination.jsx` (its only mentions were two comments; nothing
imports it), which clears the project's last ESLint warning — **lint is now
0 errors / 0 warnings**.

### Retained for re-wiring: `clinical/OASISQuickUpdate.jsx`

`clinical/OASISQuickUpdate.jsx` was orphaned and initially in the removal set, but
it is a complete, tested quick OASIS functional-entry tool (built on the
`oasisScales` engine). Rather than delete it, it is **kept** and **wired into the
patient record** (an "OASIS" tab in `PatientDetails`) in a separate feature PR.
So it became live, not dead — the dead-code count excludes this one file.

### Finding (not a deletion): orphaned but well-tested clinical engines

An import-graph pass surfaced a set of files that **no product code imports, yet
their unit tests do** — notably the pure clinical engines `pdgm/pdgmGrouper.js`,
`oasis/oasisScales.js`, `medication/drugInteractions.js`,
`visit/clinicalIndicators.js`, and the `visit/*Results` OASIS-scrubber panels.
Their former UI consumers were orphaned/removed over time, so the logic is
currently **unwired** in the app.

These were **deliberately kept**. They are correct, covered, valuable
clinical/PDGM/OASIS logic (the product's core per the engineering reviews) —
deleting them to chase a "0 unused files" metric would *remove robustness*, the
opposite of the goal. The right follow-up is to **re-wire** them into their
intended screens (PDGM grouping, OASIS scrubber, drug-interaction checks), which
is a feature/product decision, not a cleanup. Logged here so the team can pick it
up rather than have it rot silently.

### Unused-dependency removal

The 224-file deletion left several runtime packages with no remaining importer.
Each candidate was verified with a **complete** usage scan (static + side-effect
`import "x"` + dynamic `import("x")` + CSS `@import`, across `src/`, `base44/`,
and `index.html`) — an earlier, naïve scan would have wrongly flagged
`@telnyx/video` (telehealth, loaded via dynamic import), `dompurify` (XSS
sanitization), `react-signature-canvas` (e-signing), and `date-fns-tz`, so those
were **kept**. Removed 12 genuinely-unused packages (runtime deps 61 → 49):

`@radix-ui/react-aspect-ratio`, `@radix-ui/react-context-menu`,
`@radix-ui/react-hover-card`, `@radix-ui/react-menubar`,
`@radix-ui/react-navigation-menu`, `@radix-ui/react-toggle-group` (backed deleted
`ui/` primitives), `embla-carousel-react`, `vaul`, `input-otp`,
`react-resizable-panels`, `canvas-confetti` (same), and
`@fontsource-variable/inter` (imported nowhere — Inter is served via the Google
Fonts `<link>` in `index.html`, so typography is unchanged). Smaller install =
less supply-chain surface. `npm ci` stays consistent (lockfile synced).

### Self-host the Inter font (drop the Google Fonts CDN)

Done as a follow-up. The app fetched Inter from `fonts.googleapis.com` via an
`index.html` `<link>` — an external request on every load, undesirable for an
offline-capable, HIPAA-conscious clinical app. Switched to self-hosting:

- `src/main.jsx` imports `@fontsource-variable/inter` (weight axis 100–900); Vite
  bundles the woff2 subsets (verified: 7 `inter-*.woff2` emitted into `dist/`).
- Removed the Google Fonts `<link>` + `preconnect` tags from `index.html`
  (verified: zero `fonts.googleapis`/`gstatic` refs in the built HTML).
- Fixed `tailwind.config.js` `fontFamily.sans`: `"InterVariable"` →
  `"Inter Variable"`. The old name never matched any `@font-face` (which is why
  the package previously appeared unused and the CDN's "Inter" was doing the
  work); the corrected name resolves to the self-hosted variable font, so Inter
  now loads with **no third-party request**.

## Changes made

| File | Change |
| --- | --- |
| `src/lib/nav.manifest.js` | Add `navActivePage` + `isNavItemActive` (ancestor-aware active state) |
| `src/components/Layout.jsx` | `isActive` delegates to `isNavItemActive`; persist sidebar collapse; pass `isAdmin` to bottom nav |
| `src/components/layout/MobileBottomNav.jsx` | Role-aware nurse vs admin tab sets |
| `src/components/navigation/CommandPalette.jsx` | Add role-gated quick-action verbs |
| `src/components/admin/AdminConsoleDirectory.jsx` | Add Intake & Referrals group (launchpad completeness) |
| `src/pages/ClinicalPathwayManager.jsx` | Responsive stat grid + trigger-editor form row |
| `src/pages/{ClinicalChart,ClinicalInsightsDashboard,MyLearning,NurseEducationVideos}.jsx` | **Removed** — orphaned redirected pages (no imports) |
| `src/routes.jsx` | Refresh feature-audit consolidation comment (page files now removed) |
| `base44/functions/remindPlanOverdueStaff/entry.ts` | Repoint notification deep-link to canonical `/LearningCenter?tab=courses` |
| `src/lib/nav.manifest.spec.js` | **New** unit tests for the active-state helpers |
| `docs/NAV_UI_REVIEW_2026-06-29.md` | This review |
