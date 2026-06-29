# Mobile Responsiveness Review

Date: 2026-06-03

Goal: review the whole app for robustness and responsiveness on a phone-sized
screen (~320–414px wide), and fix the systemic issues that degrade the mobile
experience.

## Summary

The app is already in good shape for mobile. It ships a complete responsive
navigation shell and a documented page standard, so most pages inherit correct
behavior automatically:

- **Navigation shell** (`src/components/Layout.jsx`): a `DesktopSidebar` shown
  only at `md+`, plus a mobile-only `MobileHeader` (fixed top, `h-16`),
  `MobileMenu` (slide-over), and `MobileBottomNav` (fixed bottom, `h-16`). The
  `<main>` reserves space for both bars (`pt-16 pb-20 md:pt-0 md:pb-0`) and
  clips horizontal overflow (`overflow-x-hidden`, `w-0 md:w-auto`).
- **Page standard** (`docs/UI_PAGE_STANDARD.md`): every page uses
  `PageContainer` + `PageHeader`, both of which are responsive (fluid width,
  `flex-col lg:flex-row` header, `sm:` type scaling).
- **Shared primitives**: the `Table` component auto-wraps in
  `overflow-auto`; raw `<table>` usages are individually wrapped in
  `overflow-x-auto`; `index.css` already enforces 44–48px touch targets,
  full-screen dialogs on mobile, touch-friendly selects, and horizontally
  scrollable tab bars.

This review found one **systemic** problem affecting dozens of screens, plus a
handful of smaller issues, and fixed them. The remaining items are lower-impact
polish, listed as recommendations.

## Fixed in this change

### 1. Tab bars rendered as fixed grids crammed/clipped on phones (systemic)

~44 `TabsList` elements are written as `grid w-full grid-cols-4` (and up to
`grid-cols-8`). A CSS grid with a fixed column count keeps **all N columns on a
single row at every width**, so on a phone each tab shrinks below its label
width. Because tab triggers are `whitespace-nowrap`, the labels then clip or
spill out of their tab. (Pages that used the
`inline-flex … md:grid` + `overflow-x-auto` scroll pattern — e.g.
`PatientDetails`, `SendFax`, `PhoneCenter` — were already correct and were left
alone.)

**Fix** — a single global rule in `src/index.css` (inside the existing
`@media (max-width: 640px)` block). On small screens any grid tab bar becomes a
**content-sized, wrapping flex row**: each trigger keeps at least its label
width (`min-width: max-content`) and grows to share leftover space, so a few
tabs fill the row and many tabs wrap to additional rows — never clipping, never
overflowing. This fixes all ~44 grid tab bars at once without touching each
page, and leaves the already-responsive (`md:`-prefixed, scroll-pattern) bars
unaffected at their own breakpoints.

### 2. Safe-area insets had no effect on notched phones

The bottom nav and several helpers use `env(safe-area-inset-*)` (`.safe-bottom`,
`.safe-area-inset`), but `env()` returns `0` unless the viewport opts in.

**Fix** — added `viewport-fit=cover` to the viewport meta in `index.html`, so
the existing safe-area code actually applies under the home indicator / notch.
Because `cover` makes the layout extend into the unsafe insets, the fixed
chrome was updated to match: `MobileHeader` now carries `.safe-top` (so the bar
fills behind the status bar/notch and its controls sit below it), and `<main>`
reserves `pt-[calc(4rem + env(safe-area-inset-top))]` /
`pb-[calc(5rem + env(safe-area-inset-bottom))]` so content clears the now
inset-aware header and the `.safe-bottom` bottom nav. On non-notched devices the
insets resolve to `0`, so the offsets stay exactly `pt-16` / `pb-20`.

### 3. Patient picker popover wider than a phone

`SearchablePatientSelect` (used across documentation/scribe flows) hardcoded its
popover to `w-[500px]`, which overflows a 375px screen.

**Fix** — `w-[calc(100vw-2rem)] max-w-[500px]`: full available width on phones,
capped at the original 500px on larger screens.

### 4. O2 vitals row cramped on phones

`SmartVitalsInput` put O2 saturation + a source `Select` + flow into
`grid-cols-3` at all widths, crushing the dropdown on phones.

**Fix** — `grid-cols-2 sm:grid-cols-3`.

### 5. Card header robustness on very narrow screens

`PatientDetails` "Schedule New Visit" header used `justify-between` with no
wrap; added `flex-wrap gap-2` so the title/button never collide at ≤320px.

## Verification

- `npm run build` — passes.
- ESLint on changed files — clean.

## Recommendations (not yet done — lower impact)

These are polish items; none block mobile use:

1. **Large stat numbers**: a few dashboards use `text-4xl` for KPI numbers with
   no `sm:` downscale (e.g. `SecurityCompliance.jsx`). Acceptable today; consider
   `text-3xl sm:text-4xl` for consistency.
2. **Dense stat grids**: a handful of non-tab content grids use `grid-cols-3/4`
   without a responsive base (e.g. `ReportsAnalytics`, `OASISAuditDashboard`,
   `ClinicalPathwayManager`). They hold short numbers and read acceptably on
   phones, but `grid-cols-2 md:grid-cols-4` would be tidier.
3. **Fixed-height scroll areas**: some panels use `ScrollArea h-[400px]/[500px]`
   that are tall relative to a phone viewport (e.g. `StaffTrainingOverview`,
   `AnnouncementManager`); consider `max-h-[60vh]` style caps.
4. **Manual device QA**: exercise the primary clinician flows (Dashboard →
   Patients → PatientDetails → SmartNote/Scribe, Messages, SendFax) on a real
   iPhone/Android to confirm tap targets and keyboard behavior.
