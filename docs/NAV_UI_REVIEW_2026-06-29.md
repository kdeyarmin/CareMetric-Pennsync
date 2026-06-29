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

## Roadmap — further nav/UI opportunities (not done here)

Recommended next, in priority order. None block use today; each is a deliberate
product decision rather than a safe mechanical change.

**P1 — robustness / clarity**
- **Role-aware mobile bottom bar.** `MobileBottomNav` hardcodes Home / Patients /
  Notes / Fax / Messages for everyone. Faxing is an admin/back-office task; a
  nurse's most-used fifth slot is more likely Messages or the OASIS center.
  Drive the 5 slots from role (mirror the sidebar's role split) so each employee
  gets their real top tasks.
- **Command-palette quick actions.** The palette only navigates. Adding a few
  verbs ("New referral", "Start Smart Note", "Send fax", "Request time off")
  would turn it into a do-things bar, which is the highest-leverage speed-up for
  power users.

**P2 — information architecture**
- **Duplicate page families.** `UI_UX_REVIEW.md` finding #4 (OASIS / Compliance /
  Training / Dashboard near-duplicates) is partly consolidated via redirects;
  finish collapsing each family to one canonical page with tabs so employees
  never wonder "which OASIS page do I use?".
- **Surface the Admin Console launchpad to facility admins consistently.** Many
  admin tools are `category: null` and reachable only via the console + palette;
  confirm the console directory lists every one so nothing is palette-only.

**P3 — polish**
- Remaining mobile items from `MOBILE_RESPONSIVENESS_REVIEW.md` §Recommendations
  (responsive stat grids, `max-h-[60vh]` scroll caps, KPI font downscale).

## Changes made

| File | Change |
| --- | --- |
| `src/lib/nav.manifest.js` | Add `navActivePage` + `isNavItemActive` (ancestor-aware active state) |
| `src/components/Layout.jsx` | `isActive` delegates to `isNavItemActive`; persist sidebar collapse to `localStorage` |
| `src/lib/nav.manifest.spec.js` | **New** unit tests for the active-state helpers |
| `docs/NAV_UI_REVIEW_2026-06-29.md` | This review |
