# PennSync — Complete Feature Review & End-User Enhancement Roadmap

**Date:** 2026-07-01
**Scope:** Every user-facing feature in the app, reviewed one by one against the real code, for opportunities to enhance and improve the experience for end users (home-health **nurses**, **clinicians**, and **agency admins**).
**Method:** 27 feature clusters (derived from `src/lib/nav.manifest.js`) were each reviewed against their actual source, then the findings were de-duplicated and prioritized. Reviewers were told to skip already-known refactors (test coverage, mega-component decomposition, `InvokeLLM` wrapper standardization) and hunt for **new, user-facing** wins.

**Totals:** 27 features reviewed · **202 enhancement opportunities** identified · **45** of them are genuine correctness bugs that hurt users. The full per-feature list is the appendix; the curated, prioritized set is below.

> This document is the "review" deliverable. A first batch of the safest, highest-value items has already been **implemented in this PR** (see §3). Everything else is a vetted backlog with real file references.

---

## 1. Executive summary

PennSync is a large, mature, well-architected platform — routing is manifest-driven, the design system is consistent (`PageHeader` / `StatCard` / `EmptyState` / `LoadingState`), backend PHI scoping and webhook security are strong, and the core clinical logic (OASIS scoring, PDGM grouping, SmartNote compliance) is pure and well-tested. So the opportunities here are **not** structural — they are the layer of polish, correctness, and end-user ergonomics that separates a capable app from one that feels effortless in a nurse's hand at a patient's kitchen table.

The findings cluster into a handful of **cross-cutting themes** (§2) that repeat across many features. Fixing them once, as shared patterns, lifts the whole app.

---

## 2. Cross-cutting themes

These patterns showed up across many features. Each is worth a small shared solution rather than N one-off fixes.

1. **AI output lacks provenance, timestamps, and a "verify before clinical use" guardrail.**
   AI-drafted text (chart summaries, narratives, insights, pathway dollar figures) is shown — and sometimes written toward the record — with no generated-at time, no source attribution, and no clinician confirmation. In a Medicare/HIPAA setting this both risks hallucinated content and erodes trust. *Appears in:* Patient chart AI summary, Incidents, Templates, Predictive Analytics, Compliance, Clinical Pathways.
   → *Bigger bet:* one shared `AICaveat` / provenance component (generated-at + "AI-generated, verify before clinical use" + review-ack) applied everywhere AI text lands.

2. **Admin role gates use raw `role === 'admin'` instead of the shared `isAdminView` / `isSuperAdmin` predicates**, silently locking out `agency_admin` / `super_admin` accounts on ~8 pages (Compliance, Pathways, Console, User Management, libraries). The router admits them, then the page shows "Access Required" — a self-inconsistent permissions gap. `src/lib/roles.js` already exports the correct predicate.

3. **Date-only `YYYY-MM-DD` values parsed with `new Date()` shift back a day in US timezones.** The roster already fixed this; the mobile card, patient overview card, and provider directory had not — rendering admission / last-visit / age one day early, which is material near recert windows and the Medicare-65 boundary. *(Fixed this PR via a shared helper — see §3.)*

4. **No offline / stale-data awareness in a product marketed as offline-capable for field nurses.** Several features hit the network with no `navigator.onLine` guard and never surface an offline banner or cache age, so a nurse in a dead-zone can't tell cached data from live.

5. **Destructive / irreversible actions lack confirmation, undo, or dirty-state guards** — patient merges, provider hard-deletes, official-rate overwrites, template deletes, in-call hang-ups, and long unsaved rate-sheet/OASIS edits all commit on a single tap.

6. **Static count/summary cards that should be one-tap filters or drill-throughs are inert** — StatCards, risk-list rows, and performance rows are decorative `div`s; users expect to tap the number they're looking at to filter or open the record.

7. **Missing loading/empty-state distinction** — several pages default query data to `[]` and never read `isLoading`, so a mid-fetch screen shows "0 high-risk patients" / all-zero KPIs, indistinguishable from a genuinely empty period or a load failure.

8. **Raw patient-ID text fields and un-searchable long `Select`s** are used where the app's own `SearchablePatientSelect` belongs (Event Report, PDF Search, Education Hub), causing mistyped-ID failures found only at submit.

9. **Native `window.prompt` / bare inputs** used for OASIS reject reasons, folder creation, and PDF annotation — unstyled, not screen-reader labeled, and suppressed in some mobile webviews.

10. **TCPA quiet-hours / SMS-consent enforced only server-side, not surfaced before the user sends** — the nurse only learns a text is blocked *after* composing; masked call-backs can ring a patient at 6am from a scroll-tap.

---

## 3. Implemented in this PR

A first batch of safe, self-contained, high-value items — all verified (`build` clean, lint clean on changed files, **306/306** component tests pass, plus **8** new tests):

| # | Feature | Change | Type |
|---|---|---|---|
| 1 | Reports & Analytics | **Fixed blank/broken PDF report exports.** `pdfExporter` only understood `{headers, rows}`; the OASIS, PDGM, Nurse-Performance and Referral reports pass `{columns, data}`, so `headers.length` threw. The exporter now accepts both shapes. | bug |
| 2 | Patient Education | **Handout Customizer now shows the real bullet text** ("Call 911 if…", "Signs of infection") instead of "Item 1, Item 2", so a nurse can see exactly which instructions they include/exclude on a patient handout. | patient-safety |
| 3 | Resource Library | **Fixed a hard crash** on the Patient Education tab — cards called an undefined `onSelectMaterial`. The catalog is now safe to browse; cards stay interactive in the patient chart. | bug |
| 4 | Smart Note | **Fixed the falsy-0 compliance badge** (a 0% note showed *no* badge, reading as "all good") and **color-coded it** green/amber/red so the least-compliant note gets the clearest warning at copy/save. | trust-safety |
| 5 | Provider Directory | **Made phone & email tappable** (`tel:` / `mailto:`) with formatted display, so a nurse taps to call/email instead of re-typing an unformatted 10-digit string. | quick-win |
| 6 | Messages | **Added an inbox search box** (subject / sender / body) so nurses find a patient's thread in seconds instead of scrolling + "Load more". | quick-win |
| 7 | Clinical Reference | **Added copy-to-clipboard** to every assessment scale, protocol, and the vitals table, so nurses paste exact criteria into notes instead of retyping from memory. | quick-win |
| 8 | Patient roster / Dashboard | **Fixed the UTC date-shift** on mobile-card age, patient-overview admission/last-visit dates (new shared, tested `src/lib/dateLocal.js` helper); age-0 no longer hidden. | bug |
| 9 | Performance Dashboard | **Fixed the inverted "Avg Doc Time" trend** — a team that got *slower* was shown with an up-arrow reading as improvement. Added an `invertTrend` prop + "lower is better" label. | bug |
| 10 | Messages | **Resilient send** — success toast + the composed/reply text is now **preserved on failure** (was cleared optimistically), so a nurse on flaky cellular never loses typed words. | reliability |

### Second batch (also in this PR)

Verified the same way (`build` clean, lint clean, **306/306** component tests pass):

| # | Feature | Change | Type |
|---|---|---|---|
| 11 | Dashboard | **Favorites are now a filter, not a gate** in `RealTimePatientAlerts` — a nurse who hasn't starred anyone now sees alerts across **all their assigned patients** instead of an empty "All patients on track". | bug |
| 12 | Patient chart | **Removed the dead "Schedule Visit" quick action** that fired a developer-placeholder error toast (`"implement as needed"`) on tap. A real scheduler is tracked below. | bug |
| 13 | Admin role lockout (Theme 2) | **Adopted the shared `isAdminView` / `isSuperAdminView` predicate** on the pages that hard-coded `role === 'admin'` for current-user access gates — Admin Console, Clinical Pathways, Training Analytics, User Management, Nurse Performance, Background Jobs — so `agency_admin` / `super_admin` accounts are no longer blocked by the page after the router admits them. Other-user checks (admin counts, created-user role) were intentionally left unchanged. | bug |

### Third batch (also in this PR) — role lockout fix completed app-wide

| # | Feature | Change | Type |
|---|---|---|---|
| 14 | Admin role lockout (Theme 2, cont.) | **Completed the `isAdminView` adoption** across every remaining page that hard-coded a current-user `role === 'admin'` check: `ReportsAnalytics`, `AnalyticsDashboard`, `PatientDataManagement`, `MedicareGuidelinesLibrary`, `TimeOff`, `IncidentReportingModule`, `AdminUserSetup`, `AdminTraining`, `LearningCenter`, `TrainingCoursePlayer`, `OASISCenter`, `DocumentHub`, `TemplateManagement`, `OnCallSchedule`. The four `role === 'admin' \|\| isSuperAdmin(...)` sites collapsed to a single `isAdminView(...)`. Every current-user admin check in the app now flows through the shared predicate; **other-user** checks (approver filters, admin counts, created-user manual label, per-row role badges, the `isManager` helper) were deliberately preserved. | bug |

### Fourth batch (also in this PR) — patient-select ergonomics + actionable stats

| # | Feature | Change | Type |
|---|---|---|---|
| 15 | Event Report | **Replaced the raw patient-UUID text field** with `SearchablePatientSelect` (search by name/MRN, recents, favorites), so a reporter can't mistype an ID and discover the failure only at submit. | ux-polish |
| 16 | Patient Education Hub | **Swapped both 2000-row patient `<Select>` dropdowns** for `SearchablePatientSelect`, preserving the "fill patient email on select" behavior. Finding a patient is now type-to-search instead of scroll. | ux-polish |
| 17 | Patient roster | **Made the roster stat cards one-tap filters** — "Total" clears the status filter, "Active" filters to active, "New (30 days)" filters to the last 30 days — so tapping the number a nurse is already looking at narrows the list. | quick-win |

### Fifth batch (also in this PR) — safety confirms + mobile ergonomics

| # | Feature | Change | Type |
|---|---|---|---|
| 18 | Templates | **Added a delete confirmation** to document-template deletion (was a single-tap, irreversible `DocumentTemplate.delete`). | trust-safety |
| 19 | Mobile shell | **Lock body scroll while the mobile menu is open**, so a scroll gesture over the drawer no longer scrolls the page underneath and leaves the user lost on close. | accessibility |
| 20 | Provider Directory | **Made the provider office address a maps link** (opens Google Maps directions/search in a new tab) so a nurse can navigate to a provider without re-typing the address. | quick-win |

> Follow-up noted: an in-call "End session?" confirm for Telehealth needs a **fullscreen-safe** pattern (a portalled dialog can render behind a fullscreen `<video>` element), so it was intentionally deferred rather than shipped as a dialog that might not display.

### Sixth batch (also in this PR) — drill-through + filter visibility + reply priority

| # | Feature | Change | Type |
|---|---|---|---|
| 21 | Predictive Analytics | **Made the population risk-list rows navigate to the patient chart** (each row is now a link to `PatientDetails` with a chevron affordance + focus ring), so an admin can jump from a high-risk name straight into the record. | ux-polish |
| 22 | Patient roster | **Added removable chips for the Has-Visits and created-after/before filters** — they counted toward the active-filter badge but had no chip, so a filter (including the new "New (30 days)" stat-card shortcut) was invisible and un-clearable. | ux-polish |
| 23 | Messages | **Added an "urgent" toggle to the reply composer** so a nurse can escalate a specific reply above the thread's inherited priority; it resets after send and on thread switch. | quick-win |

### Seventh batch (also in this PR) — start of the AI-trust layer (Theme 1)

| # | Feature | Change | Type |
|---|---|---|---|
| 24 | Shared UI | **New reusable `AICaveat` component** (`src/components/ui/AICaveat.jsx`, tested) — a consistent "AI-generated — verify before clinical use" provenance line with an optional generated-at timestamp, to drop under any AI output. | trust-safety |
| 25 | Patient chart AI summary | Applied `AICaveat` **with a generated-at timestamp**, and added a **Copy button** (flattens the structured summary to paste-able text) so the summary carries a trust signal and isn't trapped in the widget. | trust-safety |
| 26 | Predictive AI insights | Applied `AICaveat` with a generated-at timestamp under the population insights executive summary. | trust-safety |

> The `AICaveat` component is now the shared primitive for Theme 1.

### Eighth batch (also in this PR) — AI-caveat coverage extended

| # | Feature | Change | Type |
|---|---|---|---|
| 27 | Incident reporting | `AICaveat` shown under the incident narrative **only when AI wrote it** ("AI-assisted draft — review and correct before submitting"), tracked via a per-generation flag. | trust-safety |
| 28 | Template editor | `AICaveat` shown under the content editor **after an AI enhance** ("AI-enhanced — verify accuracy before saving or using"). | trust-safety |
| 29 | Clinical Pathways (generate) | `AICaveat` above the AI-generated pathways list ("review clinically before creating"). | trust-safety |
| 30 | Clinical Pathways (update) | `AICaveat` above the AI update recommendations ("review clinically before applying"). | trust-safety |

> Theme 1's **UI caveat coverage is now broad** — every major surface that shows AI-drafted text (patient summary, predictive insights, incident narrative, template enhance, pathway generate/update) carries a consistent provenance line. Remaining Theme-1 work is a **review-acknowledgement gate before AI text is persisted to a chart** (a bigger, backend-touching change left for a dedicated pass).

### Ninth batch (also in this PR) — persistent offline indicator (Theme 4 start)

| # | Feature | Change | Type |
|---|---|---|---|
| 31 | App shell | **New persistent `OfflineIndicator`** (`src/components/offline/OfflineIndicator.jsx`, tested) rendered at the top of the page content on every route. It shows an unmissable "You're offline — viewing cached data; changes sync on reconnect" banner while offline and disappears when connectivity returns. Complements (doesn't duplicate) the bottom-right `OfflineSyncStatus` card, which owns pending-count + manual "Sync now". | trust-safety |

> This is the awareness slice of Theme 4. The larger offline work — cache-age/staleness labeling and an offline write-queue for incidents/notes with auto-sync — remains a roadmap item (much of the sync-queue plumbing already exists in `src/lib/offlineSync.js` + `OfflineManager`).

### Tenth batch (also in this PR) — patient-centric ⌘K

| # | Feature | Change | Type |
|---|---|---|---|
| 32 | Command palette | **⌘K now jumps straight to any patient chart.** Typing ≥2 chars of a name or MRN surfaces a "Patients" group (the roster is fetched lazily only while the palette is open, and is server-scoped by RLS); selecting one navigates to `PatientDetails`. Collapses the most common navigation (find a patient's chart) to a single keystroke. | new-capability |

> **Sidebar Favorites was intentionally *not* touched here.** Investigation showed it's not a simple ID-vs-object bug: the sidebar and favorite-scoped alerts read `currentUser.favorited_patients` as `{id, name}` objects, but **no client code writes that field**, while a *separate* localStorage favorites system (patient IDs) lives only inside `SearchablePatientSelect`. Making Favorites work means **unifying those two systems** — a persisted star action on the chart that writes `favorited_patients` as `{id, name}`, reconciled with the local system — which is a real feature with a data-shape decision, not a safe drop-in. Left as a scoped roadmap item.

---

## 4. Prioritized backlog (not yet implemented)

### Top quick wins (high impact · low effort · low risk)

- **Bring back a real "Schedule Visit"** dialog on the patient chart (Visit.create + date/type form) to replace the removed placeholder. *(new-capability)*
- **Gate the patient-chart AI summary behind an explicit action** (it still auto-fires an Opus call on chart open) — the copy + timestamp are done; the auto-fire is a behavior/perf decision left for you. *(performance)*

### Bigger bets (roadmap)

1. **Unified AI-trust layer** — the shared `AICaveat` primitive now exists and is applied to the patient-chart summary and predictive insights (batch 7); **extend it** to the remaining AI surfaces and add a review-ack before AI text is persisted to a chart (Theme 1).
2. **First-class offline mode across the shell** — persistent offline indicator, cache-age warnings, and an offline write-queue for incidents/notes with auto-sync on reconnect (Theme 4).
3. **Working sidebar Favorites** — ⌘K patient jump is **done** (batch 10); the remaining piece is unifying the two disconnected favorites systems (`User.favorited_patients` objects vs `SearchablePatientSelect` localStorage IDs) behind a persisted star action so the sidebar Favorites and favorite-scoped alerts populate.
4. **Safe, auditable patient-merge workflow** — history-aware survivor selection, demographic back-fill, undo, and persistent "not duplicates" dismissals.
5. **Real date-range reporting** across analytics tabs — payer/surveyor windows, bookmarkable URLs, proper empty-vs-error states, and honest "estimated" labeling on revenue figures.

---

## 5. Per-feature review (appendix)

Every feature, one by one: what it does today, the concrete end-user pain points, and the full enhancement list with impact / effort / risk / type. Items already shipped in §3 are also listed here in their feature context for completeness.

### Dashboard (home / daily overview)

_The Dashboard (src/pages/Dashboard.jsx) greets the nurse/admin by first name and time of day, then loads a server-scoped bundle via the getDashboardData Base44 function (active patients, TODAY's visits only, recent incidents) so non-admins only receive their assigned patients' PHI. It shows three StatCards (Today's Visits, Notes, Time Saved), a row of quick-action links, a SmartRouteOptimizer for scheduled visits, ProactiveClinicalSupport for the first visit's patient, and lazy-loaded widgets: HospitalizationRiskWidget (manual AI analysis), HighRiskPatientsWidget, PendingReferralsWidget, RealTimePatientAlerts, and TopTemplatesWidget. It supports pull-to-refresh on mobile and prompts for care scope on first login. Stats come from calculateNurseStats in statsCalculator.jsx._

**Pain points:**
- 'No visit in X days' and stale high-risk alerts in RealTimePatientAlerts can never fire correctly because getDashboardData returns ONLY today's visits (visit_date: today), yet the alert logic needs historical completed visits to measure days-since-last-visit.
- RealTimePatientAlerts keys entirely off currentUser.favorited_patients: a nurse who hasn't starred anyone sees 'All patients on track' even if their assigned patients are overdue or high-risk, so a brand-new nurse gets a silent, empty safety net.
- The 'Time Saved' card is labeled '30 days' but calculateNurseStats computes timeSavedDisplay from ALL-TIME note conversions (totalConversions x 20 min), so the number and the label disagree and the figure keeps growing forever.
- The 'Notes' StatCard shows noteConversions.length capped at the 100 most-recent records fetched, so a productive nurse's count silently plateaus at 100 and 'AI-assisted' undercounts their real work.

| Enhancement | Benefit | Impact | Effort | Risk | Type |
|---|---|:--:|:--:|:--:|---|
| **Show assigned high-risk patients even when the nurse hasn't favorited anyone** | A new nurse (or anyone who ignores the star feature) still sees overdue visits, recent incidents, and high-risk flags for their assigned patients, so real safety signals aren't hidden behind an opt-in. | high | S | low | bug |
| **Show an offline / stale-data banner and last-updated time on the dashboard** | A nurse in a rural home with no signal instantly knows they're looking at cached data from an hour ago instead of unknowingly acting on a stale visit list or missing new alerts. | high | S | low | trust-safety |
| **Fix 'No visit in N days' alerts — they silently never fire (today-only visit data)** | Nurses actually get warned when an assigned patient hasn't been seen in over a week — the alert's core purpose — instead of a permanently empty widget that hides overdue patients. | high | M | medium | bug |
| **Add a confirm + live progress + cap to the Hospitalization Risk 'Analyze' button** | Admins get clear feedback and control before triggering an expensive bulk AI run, avoid an unresponsive dashboard, and can see partial results stream in instead of staring at a spinner for a minute. | high | M | medium | trust-safety |
| **Scope the High-Risk widgets to assigned patients (avoid pulling agency-wide PHI to a nurse's device)** | Field nurses only see risk lists for their own patients — less PHI on the device, clearer signal, and consistent with the minimum-necessary scoping the rest of the dashboard already enforces. | high | M | medium | trust-safety |
| **Make the 'Time Saved' card match its '30 days' label** | Nurses see an honest, non-inflated 'time saved this month' figure they can trust rather than an ever-growing all-time total mislabeled as 30 days. | medium | S | low | bug |
| **Fix the 'Notes' count that silently caps at 100** | Productive nurses get accurate credit for their documentation volume instead of a number that stops climbing at 100 and quietly misrepresents their work. | medium | S | low | bug |
| **Make the 'Today's Visits' stat card actionable and honest about its counts** | The single most common morning question ('who and when is my next visit?') is answered on the home screen instead of requiring a tap into another page. | medium | S | low | quick-win |
| **Fix nested vertical scroll from PullToRefresh wrapping the app content** | Eliminates the janky double-scrollbar / accidental refresh nurses hit when scrolling the long dashboard on a phone, making one-handed field use smoother. | medium | M | medium | ux-polish |

### Patient Roster & Patient Details chart

_The Patients roster (src/pages/Patients.jsx) lists non-archived patients with debounced fuzzy search, an advanced-filter popover, sortable columns, roster stat cards, bulk select/merge, and separate mobile (SwipeablePatientCard) vs desktop (PaginatedPatientList) renderers. PatientDetails.jsx is a 10-tab chart driven by a single getPatientContext server fetch that seeds child caches; tabs cover Overview (AI dashboard summary + quick actions), Vitals trends, History, Clinical, OASIS, Events, AI Tools, Telehealth, Docs, and Messaging. A separate PatientRecordDashboard.jsx offers a grid/list overview with a selected-patient side panel. The roster's calculateAge was already hardened against UTC date-shift, but the mobile card and several date displays were not._

**Pain points:**
- Mobile patient cards can show the wrong age at Medicare-band boundaries because SwipeablePatientCard parses DOB as UTC (the same bug the roster page already fixed), and age 0 is hidden entirely.
- Opening any patient silently fires a full Opus AI summary every time (and again on every context refetch) with no timestamp, no way to see it's cached/stale, and no opt-out — every other AI tool on the page is gated behind a button.
- The Overview 'Quick Actions' Schedule Visit button is dead: it just fires a red error toast telling the nurse the feature is unimplemented.
- Advanced filters count 'Has Visits' and date-range toward the active-filter badge but never render a removable chip for them, so a nurse can't tell why results are filtered or clear just that one filter.

| Enhancement | Benefit | Impact | Effort | Risk | Type |
|---|---|:--:|:--:|:--:|---|
| **Fix UTC age-shift and hidden age-0 in the mobile patient card** | Nurses in the field see a patient's correct age — critical near the 65 Medicare boundary and for pediatric/infant cases — instead of an off-by-one age or a blank. | high | S | low | bug |
| **Gate the auto-firing AI dashboard summary behind an explicit action and cache it** | Faster patient-chart loads, far lower AI cost/latency, and the nurse decides when to spend a summary instead of it firing on every glance at a chart. | high | M | medium | performance |
| **Add a generated-at timestamp and copy button to the AI dashboard summary** | Clinicians can tell whether the summary reflects the latest visit, trust it appropriately, and paste its highlights straight into their documentation instead of retyping. | medium | S | low | trust-safety |
| **Wire up (or remove) the dead 'Schedule Visit' quick action** | The most prominent quick action actually schedules a visit instead of showing the nurse a scary red 'not implemented' error. | medium | S | low | bug |
| **Render removable chips for Has-Visits and date-range filters** | Nurses can see exactly which filters are narrowing their roster and clear just one without opening the popover or nuking every filter. | medium | S | low | ux-polish |
| **Fix UTC date-shift on roster/overview last-visit and admission dates** | Admission and last-visit dates on the record dashboard read correctly instead of appearing one day early, which matters for recert windows and visit compliance. | medium | S | low | bug |
| **Make roster stat cards clickable filters** | One tap on the number a nurse is already looking at filters the roster to those patients, instead of hunting through the filter popover. | medium | M | low | quick-win |
| **Surface last visit and visit count on the mobile roster card** | Field nurses can triage who needs to be seen next straight from the roster, spotting overdue patients without drilling into each chart. | medium | M | low | new-capability |

### Patient Alerts & duplicate detection

_Patient Alerts (src/pages/PatientAlerts.jsx) renders a dashboard of AI-generated PatientAlert rows (PatientAlertsDashboard.jsx) fetched via the server-scoped getScopedPatientAlerts function, plus an on-demand AI analyzer (PatientAlertAnalyzer.jsx) that runs an LLM over a patient's recent visits/vitals/incidents and writes alerts to the DB. Nurses can search/filter by severity, type, and active/resolved status, then acknowledge, flag urgent, resolve (with free-text notes), or dismiss. Duplicate Patients (src/pages/DuplicatePatients.jsx, adminOnly) auto-scans the full roster on load using a pure deterministic scoring engine (patientDuplicateUtils.js: names/DOB/MRN/phone/address/contact with union-find clustering and an identity guard), then lets an admin merge a group into a chosen survivor (mergePatients.js reassigns ~50 related entities and soft-archives duplicates). A separate PotentialDuplicateDialog warns at add-time and PatientMergeDialog offers a 3-step manual merge._

**Pain points:**
- A nurse who hasn't 'favorited' a patient sees NO alerts for that patient on the Patient Alerts page, even patients actively assigned to them — the showAllPatients prop is silently ignored, so life-threatening alerts can be invisible.
- Resolving or dismissing an alert requires opening the details dialog first; there is no one-tap resolve from the list, and dismissing captures no reason, so the audit trail can't tell a false-positive from a handled event.
- The AI analyzer must be run manually per patient and shows no timestamp of when a patient was last analyzed, so nurses can't tell whether the alerts shown are current or weeks stale.
- On the admin merge page, keeping a sparse 'suggested' record loses demographics (DOB/phone/MRN) that only existed on the archived duplicate, because the group-merge path never back-fills empty survivor fields the way the advanced scanner does.

| Enhancement | Benefit | Impact | Effort | Risk | Type |
|---|---|:--:|:--:|:--:|---|
| **Fix: nurses only see alerts for FAVORITED patients, not all assigned patients** | A nurse opening Patient Alerts sees every critical/high alert for patients on their caseload instead of an empty or partial list that hides deteriorations for patients they never happened to favorite — directly a patient-safety fix. | high | S | low | bug |
| **One-tap Resolve and reason-captured Dismiss directly from the alert list** | Nurses clear the alert queue in one tap instead of two clicks per alert, and dismiss reasons create an audit trail that lets the agency tune the AI (distinguish false positives from real events) — fewer clicks, better trust in the alert stream. | high | S | low | quick-win |
| **Surface visit count and last-visit date on each duplicate record so admins pick the right survivor** | Admins keep the record with the real clinical history instead of accidentally keeping an empty stub and archiving the chart with all the visits — prevents data loss during merges. | high | M | low | ux-polish |
| **Show 'last analyzed' timestamp and staleness warning on the Alert Analyzer** | Nurses instantly know whether the AI risk picture reflects the latest visit or is stale, so they don't act on out-of-date alerts or skip re-running after documenting a concerning visit. | medium | S | low | trust-safety |
| **Make alert summary cards and severity filter actionable / accessible** | A nurse triaging in the field taps the red Critical count to instantly see just critical alerts instead of hunting the severity dropdown, and screen-reader / keyboard users can operate the alert actions — faster mobile triage plus accessibility. | medium | S | low | accessibility |
| **Back-fill empty survivor demographics when merging on the admin Duplicate page** | When a nurse or admin keeps the 'wrong' (sparser) record, no demographic data silently disappears — the surviving chart ends up as complete as the union of the duplicates, reducing re-entry and missing-contact errors. | medium | M | medium | bug |
| **Add an Undo affordance after a merge (restore soft-archived duplicate)** | An admin who merges the wrong pair — or clicks 'Merge all' too eagerly — can recover in one click instead of filing a support request, making the destructive action feel safe and encouraging cleanup of a dirty roster. | medium | L | medium | trust-safety |
| **Persist 'Not duplicates' dismissals so the same false pair doesn't reappear every scan** | Admins stop re-reviewing the same false-positive twins on every visit, so the duplicate list shrinks to only genuinely new candidates and stays trustworthy over time. | medium | L | low | new-capability |

### OASIS Center (assessment entry, scoring, review)

_OASISCenter.jsx is a role-gated tab router (Assessment / Analyze / Review / Clinical / Compliance+Documentation, plus admin-only Analytics/Revenue/Audit) with shareable ?tab= deep-links. The core entry experience is SmartOASISAssessment.jsx: a split-pane form driven by the ~30 items in oasisQuestions.jsx, with a live right panel showing rule-based AI Recommendations (oasisScoringEngine.js), Compliance flags (OASISComplianceWarnings.jsx), and a Logic Check for clinically contradictory answers (OASISClinicalReasoningEngine.jsx). Nurses can pick a patient, watch a completion %/care-scope badge update live, print a PDF transcription guide, and save the answers as an OASISAssessment. The Review tab (OASISReview.jsx + OASISComparisonView.jsx) lets reviewers approve/edit/reject AI-extracted OASIS values with an audit trail._

**Pain points:**
- All in-progress answers live only in React useState (SmartOASISAssessment.jsx line 208); switching to another OASIS Center tab, navigating away, or a phone-battery/refresh event silently wipes an entire partially-completed assessment — brutal for a field nurse on a flaky connection who just entered 25 items.
- Every OASIS item shows the affordance 'Click for real-world scenarios & guidance' (SmartOASISAssessment.jsx line 97), but OASISQuestionGuidance returns null (line 11) for the 21 of 30 items that have no entry in oasisGuidanceData.jsx — so tapping most questions' help does nothing, a dead-click on a touch device.
- Save always hard-codes visit_type: 'Start of Care' (SmartOASISAssessment.jsx line 248) with no way to pick the assessment reason (Recert, Resumption, Discharge, etc.), and there is no unsaved-changes warning, so a nurse doing a recert saves a mislabeled record and can lose work by clicking away.
- The right-panel Compliance/Logic tabs surface critical CMS flags, but on mobile the fixed 320px right panel (RightPanel, w-80) sits beside a scrollable form — a nurse scrolling the questions can't see which item triggered a flag, and there's no way to jump from a flag to the offending question.

| Enhancement | Benefit | Impact | Effort | Risk | Type |
|---|---|:--:|:--:|:--:|---|
| **Auto-save the in-progress assessment to localStorage (draft recovery)** | A nurse who tab-switches, gets a phone call, loses signal, or accidentally refreshes doesn't lose 20+ hand-entered OASIS answers — the single most costly failure in the current flow. | high | M | low | new-capability |
| **Make compliance & logic-check flags jump to the triggering question** | Instead of manually hunting through 15 collapsible sections to find what triggered a critical CMS flag, the nurse taps the flag and lands on the exact item — far less scrolling on a phone in the field. | high | M | low | ux-polish |
| **Add an unsaved-changes guard and mobile-friendly bottom sheet for the AI panel** | Field nurses on phones get the whole screen for data entry and a thumb-reachable summary of flags, and never lose a half-finished assessment by accidentally hitting back. | high | M | low | accessibility |
| **Stop advertising guidance on items that have none (dead-click fix)** | Nurses stop tapping a 'get help' link that does nothing, and the ones that DO have rich scenario guidance become discoverable instead of buried among no-ops. | medium | S | low | bug |
| **Let the nurse choose the assessment reason (RFA) instead of hard-coded Start of Care** | Recerts and discharges are saved with the correct assessment type instead of being silently mislabeled as Start of Care, which matters for the downstream review/audit tabs and CMS accuracy. | medium | S | low | bug |
| **Surface a 'required items still blank' checklist before Save** | Nurses catch skipped OASIS items (e.g. forgot the entire Medications or Fall Risk section) before saving, reducing incomplete assessments that get bounced back in review. | medium | S | low | quick-win |
| **Replace window.prompt reject + free-text edit with a proper dialog and code dropdown in review** | Reviewers can't accidentally save an invalid OASIS response code, the reject reason is keyboard/screen-reader accessible, and the interaction matches the rest of the app instead of a jarring browser popup. | medium | M | medium | trust-safety |
| **Prefill diagnosis/prognosis from the selected patient record** | Cuts redundant re-entry of data the system already knows about the patient, while the 'verify' framing preserves clinician control and OASIS accuracy. | low | M | medium | quick-win |

### PDGM case-mix & reimbursement tooling

_Two admin-facing pages plus a shared math layer. PDGMRateSettings.jsx lets an agency admin edit the base 30-day rate, four case-mix tables (clinical-group weights, functional thresholds/multipliers, comorbidity multipliers) and the ICD-10 prefix→clinical-group map, persisting them through the gated savePDGMRateConfig backend function; those saved rates are merged over built-in CY2026 defaults by calculatePDGM (the canonical engine) so every OASIS analysis uses agency numbers. DocumentationImpact.jsx is an admin-only ROI view: it aggregates estimated_payment across analyzed OASIS uploads, shows a per-nurse leaderboard and per-assessment before→after uplift table with CSV export, and provides a before/after case-mix simulator powered by reimbursementImpact.js. reimbursementImpact.js mirrors the backend formula (base × clinical × functional × comorbidity, wage index applied to labor share) and never fabricates unknown combinations. A separate table-driven pdgmGrouper.js + caseMixWeightsLoader.js exist as an unwired, reconciled-future reference and ship no CMS data._

**Pain points:**
- The Documentation Impact simulator silently uses national CY2026 defaults and wage index 1.0 even after an admin has entered official agency rates in PDGM Rate Settings, so the same admin sees two different 'before' dollar figures for the same scenario (simulator vs. the OASIS analyzer), undermining trust in the ROI numbers.
- PDGM Rate Settings has no dirty-state / unsaved-changes protection: an admin can edit dozens of weights or ICD rows, click a nav link or refresh, and lose everything with no warning.
- Saving a rate set marked 'Official CMS rates' is a one-click overwrite of the single shared config with zero confirmation, no audit of what changed, and no visibility of who last edited it or when — high-stakes for numbers that drive every payment estimate.
- The functional-thresholds table is editable in Rate Settings but the DocumentationImpact simulator only exposes low/medium/high as a dropdown and never applies thresholds, so admins can't see how many functional points separate the levels or which OASIS items would move a patient across a threshold.

| Enhancement | Benefit | Impact | Effort | Risk | Type |
|---|---|:--:|:--:|:--:|---|
| **Make Documentation Impact use the agency's saved rates and wage index, not national defaults** | Admins see the same 'before' dollars in the ROI simulator that the OASIS analyzer already shows for real patients, so the documentation-impact story is internally consistent and trustworthy instead of quietly off by the agency's real base rate and wage index. | high | M | low | bug |
| **Warn before navigating away from unsaved PDGM rate edits** | An admin re-entering a full CMS rate sheet (dozens of weights + ICD rows) can't lose 20 minutes of work to an accidental refresh or nav click — the single most damaging failure mode on this page. | high | M | low | ux-polish |
| **Confirm + show provenance before overwriting the official rate set** | Admins get accountability and a safety net on numbers that drive every reimbursement estimate — they can see who last touched the official rates and are stopped before silently clobbering a verified set. | high | M | low | trust-safety |
| **Add plausibility validation to rate cells before save** | A fat-fingered base rate (20382.2 instead of 2038.22) or a weight typo can't silently 10x every payment estimate agency-wide — the admin is caught at the source with a clear, specific warning. | medium | S | low | trust-safety |
| **Reframe the per-nurse leaderboard away from a revenue competition** | Agencies can use the view to coach documentation completeness without creating the appearance (to staff or auditors) of a bonus-style leaderboard for higher billing per patient — protecting both nurses and the agency. | medium | S | low | trust-safety |
| **Validate ICD prefix rows and flag mappings to unweighted groups** | Admins customizing diagnosis routing get told when two rows collide (silently dropping one) or when a mapping points at a group with no weight — preventing quiet mis-grouping of principal diagnoses that changes the case-mix weight. | medium | S | low | bug |
| **Show functional-point thresholds and the weight breakdown in the impact simulator** | Admins and educators can explain to a nurse exactly what moves a patient from Medium to High (how many functional points, which multiplier changed) instead of an unexplained dollar delta, making the documentation coaching concrete. | medium | M | low | new-capability |
| **Show patient name/date on the impact drill-down so admins can find the assessment** | An admin who spots a large uplift row can jump straight to that patient's assessment to verify the documentation change, and can pre-fill the simulator from any real assessment instead of only the 50 most recent. | medium | M | low | ux-polish |

### Smart Note Assistant (typed AI clinical note + compliance)

_SmartNoteAssistant.jsx is a two-step "constrained scribe" flow: in Step 1 the nurse picks a patient (optional) and visit type, optionally captures structured vitals (VitalSignsForm), starts from a template, dictates or records audio, and types rough bullet points; in Step 2 ConstrainedNoteReviewer runs a deterministic offline compliance scan, asks gap-filling questions (with carry-forward pre-fill, standard-negative bulk-confirm, and an LLM completeness critic), then generates a note where the LLM only re-voices the nurse's own words and a value-guard + grounding pass verify every value/medication/sentence traces back to the input. The verified note can be copied, exported to PDF, and saved to the chart (create-or-update Visit + Patient history + ComplianceAudit + NoteConversion), with offline queuing, follow-up-task generation, supply analysis, chart cross-check, and critical-vital escalation. Drafts autosave per-patient to sessionStorage + IndexedDB for cross-session restore._

**Pain points:**
- A note that scores 0% compliance coverage shows NO score badge at all (falsy-0 bug in FinalNoteDisplay), so the nurse who most needs the warning gets the least feedback, and the PDF prints 'Score: N/A%'.
- The reviewer computes exactly which required elements are missing/not-documented, but none of that reaches the exported PDF — the PDF's 'Compliance Report & Findings' section is dead code because SmartNoteAssistant always passes findings: [], so a printed/faxed note carries no gap summary.
- A critical BP/O2/HR typed into the structured Vital Signs grid in Step 1 only triggers a mild 'confirm range' warning; the red 'hypertensive urgency — notify physician' clinical alert (VitalSignValidator) only fires on note TEXT, so grid-entered critical vitals are silent until Step 2.
- Live dictation just concatenates chunks with a space — no interim/live transcript feedback and no way to undo a mis-heard chunk except hunting through the textarea; a nurse in the field can't tell if the mic is capturing correctly.

| Enhancement | Benefit | Impact | Effort | Risk | Type |
|---|---|:--:|:--:|:--:|---|
| **Fix falsy-0 compliance-score badge so a 0% note isn't shown as 'no score'** | The nurse whose note is least compliant gets the clearest visible warning at the copy/save step instead of a missing badge that reads as 'all good', reducing denied visits. | high | S | low | bug |
| **Carry the 'not documented' gap list into the saved note and the exported PDF** | A printed or faxed note (still the reality for many agencies and physician offices) shows exactly which Medicare-required elements were left blank, so the clinician/QA reviewer can act on it instead of discovering the gap at audit time. | high | M | low | trust-safety |
| **Run critical-vital alerting on structured grid vitals in Step 1, not just note text** | A dangerous vital captured in the structured form triggers the notify-provider prompt immediately in Step 1 instead of being clinically silent, closing a patient-safety gap for nurses who prefer the grid over free text. | high | M | low | trust-safety |
| **Show a live interim transcript and an 'undo last dictation' while dictating** | A nurse dictating in a noisy home can confirm the mic is capturing correctly in real time and instantly remove a garbled phrase, rather than re-reading and hand-editing the whole draft. | medium | M | low | ux-polish |
| **Inline patient picker at the save step instead of a disabled button + tooltip** | Saving to the chart from a note the nurse started before choosing a patient becomes one tap in place, eliminating the scroll-back-and-hunt round trip at the most time-pressured moment. | medium | M | low | quick-win |
| **Pre-generation 'here's what will be marked Not Documented' confirm summary** | The nurse sees and consciously confirms every 'not documented' line before it lands in the chart, avoiding accidental gaps that read as incomplete care at review, without adding friction for a genuinely brief visit. | medium | M | low | trust-safety |
| **Make dictation appends punctuation- and spacing-aware** | Dictated drafts come out readable ('...verbalized understanding. Fall risk noted...') instead of run-on lowercase fragments, so the nurse spends less time cleaning up before the note is presentable. | low | S | low | ux-polish |
| **Give the two-step progress and coverage meter a screen-reader live region** | Low-vision clinicians using VoiceOver/TalkBack get spoken confirmation of coverage progress and when the note is verified, instead of relying on color alone. | low | S | low | accessibility |

### Visit Scribe / audio & live dictation documentation

_Test current state._

| Enhancement | Benefit | Impact | Effort | Risk | Type |
|---|---|:--:|:--:|:--:|---|
| **Test** | Test benefit. | high | M | low | bug |

### Incidents & event reporting

_The primary reporting surface is /Incidents (src/pages/Incidents.jsx), which renders SmartIncidentForm (patient picker, incident type, severity, an auto-detected "state reportable" path, AI-assisted narrative via useAICall, and camera/photo capture) plus a read-only IncidentRecentList sidebar. State-reportable events route through submitStateReportableIncident (server persists incident, generates/retains a PDF, emails all admins, and creates an in-app alert); standard incidents go through submitIncidentReport. Admins triage in /IncidentReview via IncidentReviewQueue (filter tabs, acknowledge=under_review, resolve with notes, 60s refetch). There is also a legacy /IncidentReportingModule (its own dialog form + stats + admin state-reportable folder) and a separate /EventReport form for the formal state event report. A proven offline path (CREATE_INCIDENT in src/lib/offlineSync.js, used by OfflineTaskManager) exists but the main SmartIncidentForm does not use it._

**Pain points:**
- A nurse who photographs a wound/injury on a STATE-REPORTABLE event (abuse, injury-related transfer, etc.) has those photos silently discarded — the state-reportable submit path in SmartIncidentForm never passes photo_urls, so the most legally-critical evidence is lost.
- Reporting a safety incident in the field with no signal fails: SmartIncidentForm calls the server function directly with no offline fallback, so a nurse in a dead zone either loses the entry or is blocked, even though a CREATE_INCIDENT offline queue already exists.
- The AI-generated incident narrative is dropped straight into the legal record with no visible 'AI-drafted, review before submit' guardrail, no way to see it's AI-written after submission, and the nurse can submit it verbatim — risky for a HIPAA/compliance document.
- The 'Recent Reports' tab passes a `detailed` prop that IncidentRecentList ignores, so the tab is identical to the sidebar and shows no report text, status, reporter, or photos — nurses can't actually review what they filed.

| Enhancement | Benefit | Impact | Effort | Risk | Type |
|---|---|:--:|:--:|:--:|---|
| **Fix: state-reportable incidents silently discard uploaded photos** | Nurses documenting abuse, injury-related hospital transfers, or pressure injuries keep their photo evidence attached to exactly the events where it matters most legally, instead of uploading photos that vanish. | high | S | low | bug |
| **Let nurses report incidents offline through the existing sync queue** | Field nurses in dead zones can capture a fall or safety event immediately instead of losing it or being blocked; the report syncs automatically on reconnect with no duplication. | high | M | medium | new-capability |
| **Add an AI-narrative trust guardrail (label, review confirmation, provenance flag)** | Protects nurses from unknowingly submitting hallucinated or inaccurate AI wording in a compliance/legal document, and gives admins a provenance signal when reviewing. | high | M | low | trust-safety |
| **Make the 'Recent Reports' tab actually detailed (honor the ignored `detailed` prop)** | Nurses can actually review what they filed and, critically, see whether the office has acknowledged or resolved each incident — closing the loop that today shows only a severity chip. | medium | S | low | ux-polish |
| **Replace the raw Patient ID text field in EventReport with a searchable patient select** | No more memorizing/copying opaque patient IDs and no more filling out a 3,500-character report only to be rejected at submit for a typo — patient selection becomes a searchable name pick. | medium | S | low | ux-polish |
| **Add a 24-hour reporting-deadline countdown for state-reportable events** | Admins immediately see which reportable events are approaching or past the regulatory 24-hour window, reducing the risk of a missed state filing and the penalties that follow. | medium | M | low | trust-safety |
| **Give admins a one-tap way to reply/notify the reporting nurse on resolution** | Nurses learn that the office acted on the safety event they reported and what was decided, instead of it disappearing into an admin queue — building trust that reporting is worthwhile. | medium | M | medium | new-capability |
| **Warn on future-dated / mismatched incident date-time before submit** | Prevents accidentally filing an incident dated in the future or on the wrong day, which distorts the safety record and can undermine a regulatory timeline. | low | S | low | bug |

### Patient Education Hub

_The Patient Education Hub (src/pages/PatientEducationHub.jsx) is a tabbed page (Create & Customize, Teach-Back, Sent/Tracking) where nurses pick from 20 hard-coded condition templates, optionally attach a patient, tune reading level/format/branding, then preview, download, or email a PDF handout generated by the backend generatePatientHandout function. A separate AI generator (PersonalizedEducationGenerator) produces per-patient education from diagnosis/meds/cognitive status. The Teach-Back tab (PatientEducation.jsx) and Sent/Tracking tab (PatientEducationPortal.jsx) are lazy-loaded, and a parallel EducationLibrary.jsx manages reusable EducationMaterial records with send/track. Several flows overlap and share backend LLM calls.</currentState>
<parameter name="topEndUserPainPoints">["When customizing a handout, HandoutCustomizer lists bullets as blank 'Item 1 / Item 2 / Item 3' with no text, so a nurse deselecting content is flying blind and can accidentally strip a warning-signs bullet.", "The AI Personalized Education Generator is always fed empty care plans and visit notes (carePlans={[]}, recentVisits={[]}), so its whole 'based on care plan goals and recent visits' promise silently produces generic output.", "Teach-back verification done in the hub's Teach-Back tab is stored only in local component state and vanishes on navigation/refresh, so the nurse's documented teach-back is never saved.", "A nurse in a home with no signal who taps Download PDF just gets a raw error toast because generation is a live backend call with no offline messaging.", "Emailing personalized education sends full PHI (diagnosis, medications) as plain-text email with no address validation or consent step.", "The Select Patient dropdown lists up to 2000 patients with no search box, forcing long scrolling on a phone."]_

| Enhancement | Benefit | Impact | Effort | Risk | Type |
|---|---|:--:|:--:|:--:|---|
| **Show real bullet text in the Handout Customizer instead of "Item 1, Item 2"** | Nurses can see exactly which instructions they are including or excluding, so they don't accidentally remove a 'Call 911' or 'Signs of infection' bullet from a patient's handout. | high | S | low | bug |
| **Validate email and confirm real delivery before showing success** | Nurses don't get a false 'emailed to patient!' confirmation for a bounced or never-sent handout, avoiding the patient never receiving critical instructions the nurse believes were delivered. | high | S | low | bug |
| **Feed real care plans and recent visits into the Personalized Education Generator** | The AI handout actually reflects the patient's real care-plan goals and last visit, so the material a nurse hands over is personalized instead of a generic diagnosis explainer that ignores the plan of care. | high | M | medium | new-capability |
| **Persist Teach-Back records to the patient chart instead of local state** | Nurses stop losing their teach-back documentation and get a durable, auditable record of patient understanding tied to the chart, which is required for OASIS/PDGM compliance. | high | M | medium | trust-safety |
| **Make handout Download offline-aware with a clear field message** | Field nurses without signal get an honest, calm explanation instead of a scary technical error, and don't repeatedly tap a button that can't work. | medium | S | low | ux-polish |
| **Don't auto-publish duplicated library materials** | Prevents half-finished '(Copy)' materials with the wrong patient wording from being accidentally sent to real patients, keeping the sendable library trustworthy. | medium | S | low | trust-safety |
| **Add a HIPAA guardrail before emailing PHI to patients** | Protects patients from PHI going to a mistyped or shared inbox and gives the agency a documented consent trail, reducing HIPAA exposure while keeping the convenience of emailing. | medium | M | low | trust-safety |
| **Add a searchable/typeahead patient picker in the hub** | A nurse can type a name to jump straight to the right patient in one or two keystrokes instead of scrolling hundreds of entries on a small screen in the field. | medium | M | low | ux-polish |

### Documents & E-Signing (DocumentHub, signing, PDF tools)

_DocumentHub is a tabbed hub (Signatures / Documents / Discharge / Templates / Analytics / admin-only Audit) with URL-driven deep links and sub-tabs. Signature workflows live in DocumentSignatures (list with 5s polling, stats, patient/text filters, sign + admin-only remind), SignDocument (internal iframe preview + SignatureCanvas draw/type capture, server-authorized submit via submitDocumentSignatures), and a public token-gated SignerPortal → SignerPackageViewer → SignerDocumentSigner path using SignaturePadCanvas. SignatureRequestCreator is a 3-step wizard (upload/library → recipients+reminders → drag-place fields → email tokens). PDFTools offers Annotate (PDFEditor), Merge (PDFMerger), Manage Pages (PDFPageManager); PDFSearch wraps PDFSearchInterface. Signing security was hardened (CSPRNG tokens, server-side authorization, single-use tokens), but several end-user workflow and mobile gaps remain._

**Pain points:**
- A nurse placing signature fields in SignatureRequestCreator Step 3 spends real effort dragging fields onto the document, but those `fields` are validated-then-discarded (never sent to DocumentSignature.create), so the placement has no effect on what the signer sees — wasted work and a false mental model of where signatures will land.
- A field nurse on a tablet/phone cannot annotate a PDF at all: PDFEditor only wires mouse events (onMouseDown/Move/Up) and uses window.prompt() for text, so touch draw/highlight and text entry are broken on mobile — the exact device nurses carry.
- In DocumentSignatures the 'Remind' button is admin-only via `currentUser?.role === 'admin'` (missing isSuperAdmin), and there is no way for anyone to copy or resend a signer's secure link — if an email bounces or a signer loses it, staff are stuck.
- PDFSearch forces the nurse to paste a raw patient UUID into a plain text 'Patient ID' box, while the rest of the app uses SearchablePatientSelect — nurses don't know UUIDs, so the patient filter is effectively unusable.

| Enhancement | Benefit | Impact | Effort | Risk | Type |
|---|---|:--:|:--:|:--:|---|
| **Persist placed signature fields (Step 3 work is silently discarded)** | The nurse's drag-and-drop field placement actually drives where signatures are collected instead of being thrown away, matching the tool's implied promise and preventing signers from signing the wrong spot. | high | M | medium | bug |
| **Add touch support and inline text entry to the PDF annotator** | Field nurses can highlight, draw on, and add text to PDFs from a tablet or phone instead of the feature being desktop-mouse-only. | high | M | medium | accessibility |
| **Add 'Copy signing link' and fix reminder role gating in DocumentSignatures** | Staff can recover from bounced/lost signature emails without re-creating the whole request, and super_admins regain the reminder control they currently lose. | medium | S | low | quick-win |
| **Replace the raw Patient ID text box in PDFSearch with SearchablePatientSelect** | Nurses can scope a document search to a patient by typing a name instead of needing to know an internal UUID they'll never have. | medium | S | low | ux-polish |
| **Show a consent affirmation and add a legally-binding notice on internal SignDocument** | Signatures collected in person carry a clear consent statement, improving the legal defensibility of the record the agency relies on for compliance. | medium | S | low | trust-safety |
| **Give the SignDocument preview a download/open control and full-height view** | Signers can read the full document before signing instead of squinting at a tiny embedded frame — fewer blind signatures and less risk of signing the wrong thing. | medium | S | low | ux-polish |
| **Add a Decline-with-reason path to internal signing** | A refused signature is captured with a reason and stops showing as 'overdue' noise, giving admins an accurate picture and an audit trail instead of a stuck request. | medium | M | medium | new-capability |
| **Add a bulk 'Remind all overdue' action with per-request sent feedback** | An admin chasing signatures can nudge every overdue signer in one click and see which ones were just reminded, instead of hunting row by row. | medium | M | low | quick-win |

### Templates (clinical/document template library & management)

_The Templates area has two surfaces. TemplateLibrary.jsx pairs a hard-coded set of AI-generated clinical templates (6 visit types + 8 conditions in ClinicalTemplateLibrary.jsx) with a TemplateEditor: clicking a template card fires an invokeLLM call to generate structured content, the nurse fills "Quick Fill" clinical prompts, optionally runs "Enhance with AI", then copies or hands off to Clinical Notes. TemplateManagement.jsx is an admin CRUD screen for text DocumentTemplate records (with {{placeholder}} extraction) plus a lazy-loaded PDF Templates tab (PDFTemplateManager.jsx) for uploadable PDF forms with field mappings, signature fields, and versioning. Patient selection is offered on the library page but is only wired into the editor's Enhance step, not the initial generation._

**Pain points:**
- The library promises 'Template will be personalized for this patient's diagnosis' (TemplateLibrary.jsx:109) but the initial AI generation in ClinicalTemplateLibrary never receives the patient, so the first template is generic and the nurse must remember to run a second 'Enhance with AI' pass to actually personalize it.
- Every click on a template card re-runs a full LLM generation with no caching (ClinicalTemplateLibrary.jsx:173) and generated clinical templates can never be saved for reuse, so nurses pay latency/cost repeatedly for the same 14 fixed templates.
- 'Enhance with AI' overwrites the whole editor content with no undo (TemplateEditor.jsx:81), so a nurse who has manually typed findings loses them if the AI result is worse.
- Required Fields are displayed as a yellow alert but never enforced (TemplateEditor.jsx:236) — a nurse can copy/hand off an incomplete note that's missing Medicare-required elements.

| Enhancement | Benefit | Impact | Effort | Risk | Type |
|---|---|:--:|:--:|:--:|---|
| **Non-destructive AI enhance with a one-tap 'Undo' / revert** | Nurses can try the AI enhancement without fear of losing manually typed clinical findings, increasing trust in the AI feature. | high | S | low | trust-safety |
| **Actually pass the selected patient into initial template generation** | The template the nurse sees on first click is already tailored to the patient's diagnosis, removing a hidden second step and matching what the UI promised. | high | M | low | bug |
| **Enforce required fields before 'Use in Visit Documentation'** | Catches missing required documentation before it reaches Clinical Notes, reducing rework and compliance risk for the nurse. | high | M | low | trust-safety |
| **Cache generated clinical templates per template id (session) and allow saving as a reusable DocumentTemplate** | Nurses stop waiting for (and re-paying for) the same AI generation, and agencies can standardize their best template wording once. | high | L | medium | performance |
| **Add a delete confirmation to document-template deletion** | Admins can't destroy a shared template with a single mis-tap, protecting agency-wide documentation assets. | medium | S | low | trust-safety |
| **Offline-aware guard and empty-search state in the clinical library** | Field nurses get an actionable explanation offline instead of a generic failure, and never stare at an empty tab wondering if the app broke. | medium | S | low | ux-polish |
| **Fix version auto-increment for non-numeric and rolling-over versions** | Admins get sane, predictable version numbers when duplicating a PDF template instead of a 'vNaN' template that confuses the whole version history view. | medium | S | low | bug |
| **Reconcile the 'Optional' patient label with the required-patient hand-off** | Removes a confusing dead-end where the UI says a step is optional but then blocks the nurse's primary action. | medium | S | low | ux-polish |

### Messages (secure internal messaging)

_src/pages/Messages.jsx is a phone-styled secure inbox: it lists Message entities (200 most recent), groups them into threads by thread_id, filters to threads where the current user is sender or recipient, and supports priority/read filters, a conversation view with read receipts, and a reply composer. A separate embedded component, src/components/messaging/CareTeamMessaging.jsx (used in PatientDetails), offers per-patient threads plus AI Summarize/AI Assist and Save-to-Chart. Messages support attachments, priority (normal/high/urgent), read_by tracking, and optional patient linkage per the Message entity (base44/entities/Message.jsonc). Sending is a plain React Query mutation with no optimistic update, no success/error feedback, and no polling._

**Pain points:**
- A nurse can only pick ONE recipient when starting a message: the New Message recipient Select does `recipients: [value]` (Messages.jsx:446), overwriting any prior pick, so care-team broadcasts (e.g. notify both the case manager and the on-call nurse) are impossible.
- Nurses can receive attachments but can never send one: attachments render as links (Messages.jsx:278-292) yet there is no upload control in the compose or reply UI, so a wound photo or document can't be shared from the field.
- Sending gives no confirmation and silently swallows failures: sendMessageMutation (Messages.jsx:99-112) has no onError and no success toast, and handleReply clears the textbox (line 216) before the send resolves, so an offline/failed send loses the nurse's typed message with zero feedback.
- The inbox never updates on its own (no refetchInterval / refetchOnWindowFocus), so a nurse awaiting an URGENT reply must leave and re-open Messages to see it arrive.

| Enhancement | Benefit | Impact | Effort | Risk | Type |
|---|---|:--:|:--:|:--:|---|
| **Show success toast and preserve text on send failure (reply + new message)** | Nurses on flaky cellular connections get clear confirmation their secure message actually sent, and never lose a typed message to a silent failure. | high | S | low | trust-safety |
| **Add multi-recipient selection to New Message** | Nurses can notify the whole relevant care team (case manager + on-call + therapist) in one message instead of sending the same thing 3 times, which is the normal home-health coordination pattern. | high | M | low | new-capability |
| **Let nurses attach a photo/file when composing or replying** | A field nurse can send a wound photo, a signed form, or a med list directly in the secure thread instead of falling back to unsecured texting, keeping PHI inside the HIPAA-compliant channel. | high | M | medium | new-capability |
| **Poll the inbox and open thread for near-real-time delivery** | A nurse waiting on a response about a patient sees the reply land without manually reloading, which matters when the message is marked urgent. | medium | S | low | ux-polish |
| **Allow escalating priority on a reply** | When a routine conversation becomes time-critical, the nurse can flag it urgent so it stands out in everyone's inbox and gets a faster response. | medium | S | low | quick-win |
| **Add a search box to the Messages inbox** | A nurse can find the thread about a specific patient or topic in seconds instead of scrolling and repeatedly clicking 'Load more'. | medium | S | low | quick-win |
| **Prevent duplicate Save-to-Chart appends in CareTeamMessaging** | Prevents duplicated clinical-communication entries in the legal patient chart, which admins/clinicians rely on for accuracy during audits. | medium | S | low | bug |
| **Batch the mark-as-read writes into a single update per thread** | Opening a busy thread feels instant and doesn't hammer the backend, and unread counts clear immediately instead of flickering as each write returns. | medium | M | low | performance |

### Phone Center (SMS / voice / masked calls / duty status)

_PhoneCenter.jsx renders a phone-shaped shell (PhoneFrame) with five tabs — Texts (SmsConversationList → SmsThreadView), Recents (CallHistoryList), Callbacks (CallbackQueue), Scheduled (ScheduledSmsList), and Duty (DutyStatusCard) — all scoped to the logged-in nurse and routed through their masked Telnyx work number so their personal cell stays hidden. Nurses text patients (with quick replies, templates, SMS-segment counter, consent gating, schedule-send), one-tap call back missed/voicemail/callback items, tag calls with dispositions/notes, and set on/off duty plus scheduled weekend time-off. Queries poll every 30s; consent, opt-out (STOP), agency business hours, and pure utils for TCPA recipient quiet hours (quietHours.js), cost/destination controls, and ringdown ordering all exist. The header shows live on/off-duty and work-line badges._

**Pain points:**
- A nurse types a full text, hits Send, and only THEN gets a 403 'outside the recipient's TCPA quiet hours' error (sendSms/entry.ts:520) — the compose screens (SmsThreadView, PatientContactActions, ScheduleSendDialog) never warn beforehand even though quietHours.js is right there.
- One accidental tap on the green 'Call back' button in Recents/Callbacks immediately rings the nurse's phone and dials a patient (CallHistoryList.jsx:169, CallbackQueue.jsx:122) — no confirmation, and it fires even when the nurse is off duty or it's the patient's quiet hours.
- With up to 300 texts and 200 calls loaded, there is no way to search or filter the Messages inbox or Recents list to find one patient — the nurse must scroll.
- Marking a callback 'Resolve' is a one-way action with no undo (CallbackQueue.jsx:131); a mis-tap silently drops a call that needs following up out of the worklist.

| Enhancement | Benefit | Impact | Effort | Risk | Type |
|---|---|:--:|:--:|:--:|---|
| **Warn about recipient TCPA quiet hours in the compose UI before Send** | Nurse learns a text will be blocked/deferred before composing and losing the message, and is nudged to schedule-send instead — fewer failed sends, fewer TCPA violations. | high | S | low | quick-win |
| **Confirm one-tap masked call-back and block it when off duty / in quiet hours** | Prevents an accidental scroll-tap from ringing a patient at 6am or when the nurse is off shift, and gives a clear 'your phone rings first' expectation before the call starts. | high | M | low | trust-safety |
| **Flag clinically-urgent inbound texts in the Messages inbox** | A nurse scanning the inbox in the field immediately spots a possibly life-critical patient text ('can't breathe', 'fell') instead of it sitting mid-list among routine messages. | high | M | low | trust-safety |
| **Add a search/filter box to the Messages inbox and Recents list** | A nurse covering many patients can jump straight to one conversation or call instead of scrolling a 300-message inbox on a phone screen in the field. | medium | S | low | ux-polish |
| **Optimistic Resolve with an Undo toast in the Callback queue** | Resolving a callback feels instant and a mis-tap is recoverable, so nurses trust the worklist and don't accidentally drop a call that still needs handling. | medium | S | low | ux-polish |
| **Surface the nightly expiry of the On-Duty toggle in DutyStatusCard** | Nurses stop believing they're reachable the morning after forgetting to toggle off; they know calls route to the office overnight and to re-arm each shift, preventing silently-missed patient calls. | medium | S | low | trust-safety |
| **Add tel:/native quick-actions and a caller label to the drilled-in SMS thread header** | Escalating a text conversation to a private call is one tap in-context, matching how nurses actually work a patient issue, and stays on the masked work line. | medium | M | low | new-capability |
| **Show a 'transcription pending' state for voicemails without a transcript yet** | A nurse triaging voicemails knows whether to wait for the transcript or just play the audio, instead of assuming a silent gap means nothing was left. | low | S | low | ux-polish |

### Fax (send/track fax)

_The Fax Center (src/pages/SendFax.jsx) is a tabbed workspace with four "Send" modes (Photo upload, Camera capture, Document picker, Batch merge) plus management tools (Templates, Status tracker, Search, History, Contacts, Logs, admin-only Analytics). Each sender builds a PDF client-side with jsPDF, optionally stamps a drawn/saved signature and prepends an AI-generated HIPAA cover sheet, then calls the sendFax cloud function. Delivery is tracked via RealtimeFaxStatusTracker (5s polling + entity subscription) and EnhancedFaxHistory (15s polling), with failed-fax retry backed by a config-aware backoff policy in faxRetry.js. An address book, physician selector, CSV import, and OCR metadata extraction round out the flow._

**Pain points:**
- A nurse can send PHI to a mistyped or wrong fax number with a single tap: none of the four senders validate or normalize the number (only `!toNumber.trim()` is checked), and there is no confirm-recipient step before transmitting patient records — a real HIPAA-breach and wasted-charge risk.
- The recipient's name/organization is not shown at the moment of sending; the nurse only ever sees the raw digits they typed, so a misdial is invisible until the fax fails or lands at the wrong office.
- Photo-upload faxes stretch every image to fill the page (aspect ratio ignored), so a portrait clinical document arrives distorted and can be hard to read at the receiving end.
- There is no 'resend' action on a fax in History/Search — to re-send an already-built fax (e.g. to a corrected number) the nurse must rebuild the whole packet from scratch.

| Enhancement | Benefit | Impact | Effort | Risk | Type |
|---|---|:--:|:--:|:--:|---|
| **Validate & normalize the fax number before sending (E.164 + inline error)** | Stops wasted/charged transmissions and, more importantly, catches typos that would send patient PHI to a wrong or invalid number before it leaves the device. | high | S | low | trust-safety |
| **Confirm recipient (with name/org echo) before transmitting PHI** | A deliberate last-look before PHI leaves the device turns a one-tap misdial into a catchable mistake, directly reducing HIPAA wrong-recipient breaches. | high | M | low | trust-safety |
| **Add 'Resend' / 'Send to different number' from History and Status** | Re-sending a fax to a corrected number or a second recipient becomes one tap instead of re-scanning/re-uploading and re-assembling the whole document. | high | M | medium | new-capability |
| **Preserve image aspect ratio in Photo-upload PDF generation** | Faxed documents arrive undistorted and legible at the receiving office, reducing callbacks and re-sends for unreadable pages. | medium | S | low | bug |
| **Make the retry cap config-driven and consistent between History and Status** | Nurses get consistent, honest retry behavior that matches agency policy, and understand when a fax truly needs manual attention rather than another retry. | medium | S | low | ux-polish |
| **Warn on oversized / high-page-count fax packets before sending** | Nurses in the field on cellular avoid slow uploads and surprise costs, and get a heads-up before an accidental 40-page fax from too many camera captures. | medium | M | low | ux-polish |
| **Fix the dead 'Save to Profile' button in the signature panel** | Removes a misleading button so nurses can reliably save a reusable signature once and stop re-drawing it on every fax. | low | S | low | bug |
| **Invalidate fax-logs after every send so History/Status update immediately** | A fax the nurse just sent shows up instantly in History and the Status tracker, giving immediate confirmation instead of an unsettling delay. | low | S | low | quick-win |

### Provider Directory

_The Provider Directory (src/components/physician/PhysicianDirectory.jsx, rendered by src/pages/PhysicianDirectory.jsx) is a searchable list of referral providers backed by the Physician entity. Nurses/admins can search by name/practice/specialty/tags, filter by specialty, add/edit providers via PhysicianForm, bulk-import via ProviderCsvImport (admin-only backend), and pick a provider through PhysicianSelector (reused in FaxAddressBook). Selecting a provider increments referral_count and stamps last_referral_date. Each card shows fax, phone, email, and address as plain text, plus a "Frequent" badge over 10 referrals. It requires full_name and fax_number._

**Pain points:**
- Fax/phone/email on each card are plain text, not tappable — a nurse in the field must memorize or re-type a 10-digit fax to send an order, and CSV-imported numbers show as raw unformatted digits like '2155551234'.
- Every provider card is fully rendered inside a max-h-[600px] scroll list capped at 500 records; there is no pagination or virtualization, and no way to jump to accepts_home_health / accepts_hospice providers even though those flags exist on the entity.
- Removing a provider does a hard delete that permanently destroys referral_count / last_referral_date / contact history, despite the schema and list query already supporting a soft-delete via is_active.
- The Add/Edit form silently accepts malformed data: no NPI check-digit validation, no email/phone format hints, and the specialty is a free-text box so the same specialty gets typed three different ways and fragments the specialty filter list.

| Enhancement | Benefit | Impact | Effort | Risk | Type |
|---|---|:--:|:--:|:--:|---|
| **Make fax / phone / email tappable (tel:, fax:, mailto:) with formatted display** | A nurse standing in a patient's home can tap the phone number to call the office or tap the fax to hand off to the fax composer, instead of squinting at and re-typing a 10-digit unformatted number — fewer wrong-number errors on faxed orders. | high | S | low | quick-win |
| **Soft-delete providers instead of hard delete to preserve referral history** | Admins stop losing a provider's fax number and years of referral history on a single mis-tap; a deactivated provider can be restored, and referral analytics stay intact. | high | S | low | bug |
| **Add 'Accepts Home Health' / 'Accepts Hospice' quick filters and card badges** | When a nurse needs a provider who will actually sign home-health orders, they can filter to those in one tap instead of scrolling and guessing, and see acceptance at a glance on the card. | high | S | low | new-capability |
| **Show CSV import result summary (skipped rows) instead of only a success count** | An admin importing a payer/hospital provider export immediately sees that 5 providers didn't make it in (bad fax column) instead of assuming the whole file loaded and later failing to find those providers when faxing orders. | medium | S | low | ux-polish |
| **Copy-to-clipboard on NPI and address, and a one-tap map/directions link** | Nurses and billers copy the exact NPI/address in one tap instead of transcribing it, cutting transcription errors on claims and orders, and can navigate to an office without re-typing the address into Maps. | medium | S | low | quick-win |
| **Validate NPI (Luhn check digit) and normalize specialty in PhysicianForm** | Prevents a mistyped NPI from silently propagating onto faxed orders and claims, and keeps the specialty filter clean so nurses actually find the cardiologist under one 'Cardiology' entry instead of three variants. | medium | M | low | trust-safety |
| **Role-gate Add / Edit / Delete / Import controls for nurses** | Nurses stop seeing buttons that either 403 (CSV import) or let them destroy a shared agency-wide directory; the directory becomes safe shared reference data with edit rights limited to admins. | medium | M | medium | trust-safety |
| **Debounce search and virtualize/paginate the 500-row list** | Search stays smooth and the list scrolls without lag on the older tablets nurses use in the field, so finding a provider mid-visit doesn't stall. | medium | M | low | performance |

### Telehealth (video visits, join flow)

_PennSync's Telehealth lets clinicians schedule Telnyx-backed video visits (src/pages/Telehealth.jsx), share a capability-token join link with patients (src/components/telehealth/telehealthUtils.js), and run a call through a green-room device check (PreJoinDeviceCheck.jsx) into a live VideoRoom.jsx with chat, screen share, network-quality readout, and an in-call vitals monitor (RealtimeVitalMonitor.jsx). Patients join with no login via a public /join page (src/pages/JoinTelehealth.jsx). On end, the provider fills SessionDocumentation.jsx, and PatientTelehealthPanel.jsx additionally writes a linked Visit to the chart. Sessions are role-scoped by host_email and refetched every 30s._

**Pain points:**
- A patient can click their link and sit in the room, but the clinician has no idea they're waiting — the 'joined' toast in VideoRoom.jsx only fires AFTER the clinician is already in the call, so early patients are effectively invisible on the Upcoming list.
- If the clinician ends or cancels the session, the patient who reopens their /join link just sees 'Waiting for your provider to join…' forever with no explanation that the visit is over.
- The nurse records vitals mid-call in RealtimeVitalMonitor, but the post-call SessionDocumentation form is seeded from a session snapshot taken at join time, so those vitals are blank and must be re-typed — duplicate entry on the exact numbers most likely to be transcribed wrong.
- 'Text link' blasts an SMS to the patient with no consent / quiet-hours check, even though the app already has TCPA consent + quiet-hours infrastructure everywhere else.

| Enhancement | Benefit | Impact | Effort | Risk | Type |
|---|---|:--:|:--:|:--:|---|
| **Tell the patient when the visit has ended or was cancelled instead of an infinite 'Waiting for provider'** | Elderly/anxious home-health patients get a clear, reassuring message instead of staring at a spinner and calling the office confused about whether their visit happened. | high | S | low | ux-polish |
| **Show a live 'Patient is waiting' indicator on the Upcoming session card** | Clinicians stop leaving patients sitting alone in an empty video room; nurses can triage who to join first when running back-to-back virtual visits. | high | M | low | new-capability |
| **Pre-fill post-call documentation with vitals already captured during the call** | Eliminates double-entry of vital signs — the single most transcription-error-prone data in the visit — and speeds up post-visit charting. | high | M | low | bug |
| **Respect SMS consent and quiet-hours before texting the patient a join link** | Protects the agency from TCPA violations and keeps patient trust — the link still reaches consenting patients, and staff get a clear reason when it's blocked rather than a silent compliance risk. | high | M | low | trust-safety |
| **Guard the New Session form against a missing patient phone and warn before texting is impossible** | Nurses learn up front that a patient can't be texted and choose Copy Link / another channel, instead of scheduling then hitting a wall at visit time. | medium | S | low | ux-polish |
| **Prevent accidental hang-ups with an 'End session?' confirm on the in-call red button** | Nurses don't accidentally end a live visit — and trigger premature charting — with a fat-finger tap on a phone or tablet in the field. | medium | S | low | trust-safety |
| **Make past telehealth visits reviewable from the main Telehealth page** | Clinicians and admins can look back at what happened in a virtual visit (findings, plan, who attended) for continuity of care and audit, without hunting through the chart. | medium | M | low | new-capability |
| **Add a visible countdown/auto-retry and clearer copy to the reconnecting state** | Field nurses on spotty cell service don't lose the visit and have to re-navigate; brief network blips self-heal without the patient thinking the provider hung up. | medium | M | medium | ux-polish |

### Learning Center & course player

_Test._

| Enhancement | Benefit | Impact | Effort | Risk | Type |
|---|---|:--:|:--:|:--:|---|
| **t** | b | high | S | low | bug |

### Reference libraries (Clinical Templates, Clinical Reference, Medicare Guidelines, Patient Education)

_The Resource Library page (src/pages/ResourceLibrary.jsx) tabs between three surfaces: Clinical Templates (ClinicalLibraryManager — entity-backed "quick phrase" templates with folders, bulk-move, AI generate/improve/refine, and an Analytics tab), Clinical Reference (ClinicalReferencePanel — a fully hardcoded set of 8 assessment scales, 6 protocols, and a vitals table with per-tab search), and Patient Education (the static components/education/EducationLibrary.jsx with 28 hardcoded topic cards). A separate Medicare Guidelines Library (src/pages/MedicareGuidelinesLibrary.jsx) lets admins fetch/store CMS.gov pages and shows them as searchable/filterable cards with a markdown detail dialog. Templates expand into full notes server-side via base44/functions/expandClinicalPhrase, incrementing usage_count._

**Pain points:**
- Opening the Resource Library's 'Patient Education' tab and clicking any of the 28 topic cards crashes the tab, because ResourceLibrary renders <EducationLibrary /> with no onSelectMaterial prop and every card's onClick calls it.
- A super_admin (platform owner) or an account_type==='agency_admin' administrator cannot Add/Delete Medicare guidelines or create agency-wide templates, because both screens gate on the narrow role==='admin' instead of the app's own isAdminView helper.
- Nurses charting in the field must manually retype Braden/Morse ranges, GG scores, and vitals thresholds into their notes because the Clinical Reference panel has no copy-to-clipboard anywhere.
- Search in the Clinical Reference panel is scoped to the currently open sub-tab, so a nurse searching 'fall' while on the Vitals tab sees nothing even though the Morse scale and Fall Prevention protocol match.

| Enhancement | Benefit | Impact | Effort | Risk | Type |
|---|---|:--:|:--:|:--:|---|
| **Fix crash: Patient Education tab in Resource Library calls undefined onSelectMaterial** | A nurse browsing patient education from the Resource Library no longer crashes the tab and can actually view/use the 28 topics. | high | S | low | bug |
| **Admin gating excludes super_admin and agency_admin on guidelines and agency-wide templates** | Agency administrators and the platform owner can actually curate agency-wide templates and CMS guidelines instead of being silently locked out. | high | S | low | bug |
| **Add copy-to-clipboard to Clinical Reference scales, protocols, and vitals** | Nurses paste exact, correctly-worded clinical criteria straight into visit notes instead of retyping ranges from memory, reducing transcription errors. | high | S | low | quick-win |
| **Replace window.prompt folder creation with an accessible dialog** | Folder creation works consistently on every device (including mobile webviews) and is keyboard/screen-reader accessible. | medium | S | low | accessibility |
| **Make Clinical Reference search cross-tab with a result count and vitals search** | One search reliably surfaces the right reference no matter which sub-tab the nurse happens to be on, cutting hunt-and-peck across three tabs. | medium | M | low | ux-polish |
| **Deep-link and offline-cache Medicare guideline detail** | A field nurse can reopen or share the exact CMS guideline they need and still read a previously-viewed guideline with no signal in the home. | medium | M | medium | new-capability |
| **Add live preview + phrase-collision warning when creating a template** | Nurses avoid creating duplicate/conflicting trigger phrases that silently shadow each other, and can confirm the exact text a phrase will insert before relying on it in real charting. | medium | M | low | trust-safety |
| **Batch bulk-move and folder-delete instead of firing N independent mutations** | Organizing many templates at once gives a single clear confirmation instead of a wall of toasts, and partial failures are reported honestly. | low | M | low | ux-polish |

### Referral Intake & Triage

_ReferralIntake.jsx is a 1,744-line hub with three tabs (Intake, Process, Admission Note). On the Intake tab, an admin uploads a referral PDF/fax/image; the file is uploaded, auto-classified, and either routed through MultiReferralDetector (multi-doc PDFs) or run through a quick AI scan (runReferralQuickScan) that pre-populates the form and suggests priority/tasks/care plans. Full processing (ReferralPDFSummarizer) extracts OASIS-grade data, then handleProcessingComplete runs priority + intake analysis, does deterministic + AI patient matching, auto-creates/links a Patient, generates coordination Tasks, and can require manual patient verification (PatientVerificationStep). A separate ReferralTriage.jsx page lets staff paste raw fax/email text into ReferralTriageAnalyzer for an AI urgency/risk assessment and one-click patient+task creation. Nurse assignment sends a secure Message with the processed packet attached, with a rollback if the notification fails._

**Pain points:**
- The entire Referral Triage page's core 'Analyze Referral' action is almost certainly broken in production: ReferralTriageAnalyzer.jsx calls a raw relative fetch('/functions/triageReferralWithAI') that resolves to the SPA origin, not the Base44 backend (serverUrl), and carries none of the auth/appId headers base44.functions.invoke attaches.
- On tablets and phones the nurse-assignment dropdown is completely hidden (the Assigned To column is xl:table-cell only), so an admin triaging referrals from an iPad in the field literally cannot assign a referral to a nurse.
- After an admin uploads a referral and clicks 'Create & Process Referral', a large modal opens and runs a long multi-step AI pipeline (extraction + 3 backend analyses + patient matching) with no progress feedback beyond a spinner; there's no indication of what step it's on or how long it will take.
- Rejecting a referral is a one-click terminal action with no reason captured, so the agency loses the 'why' (duplicate, out of service area, insurance denied) that admins and referral sources need.

| Enhancement | Benefit | Impact | Effort | Risk | Type |
|---|---|:--:|:--:|:--:|---|
| **Fix broken Referral Triage analysis call (raw fetch bypasses Base44 backend)** | The Referral Triage page's primary feature actually works for nurses/admins instead of silently erroring, restoring the paste-a-fax-and-analyze workflow. | high | S | low | bug |
| **Show the nurse-assignment control on tablet/phone, not just XL screens** | Field admins and charge nurses working on tablets can actually assign referrals to nurses, which is currently impossible on their primary devices. | high | S | low | accessibility |
| **Warn on likely-duplicate patient before Referral Triage creates a new chart** | Prevents duplicate patient charts (a real HIPAA/clinical-safety hazard) that split a patient's history and medication list across two records. | high | M | medium | trust-safety |
| **Capture a rejection reason when declining a referral** | Admins and referral sources get an auditable 'why' for every decline, which supports agency reporting and avoids re-processing the same rejected referral. | medium | S | low | trust-safety |
| **Give Referral Triage a human-readable export instead of raw JSON only** | A nurse can paste a readable triage summary into the chart, a message, or a fax back to the referral source, instead of unusable JSON. | medium | S | low | quick-win |
| **Add step-by-step progress feedback during referral processing** | Admins see the AI is actively working and roughly where it is, reducing the urge to close/retry the modal mid-pipeline (which can create partial data) during a 20-40s wait. | medium | M | low | ux-polish |
| **Deep-link the assignment message and pending widget straight to the referral** | A newly-assigned nurse taps one link and lands directly on their referral's analysis instead of scanning a paginated 200-row list to find it. | medium | M | low | quick-win |
| **Surface AI extraction confidence and low-confidence field warnings at intake** | Admins are prompted to verify shaky AI extractions (misread handwriting/fax) exactly where it matters, reducing wrong-name/wrong-priority referrals entering the system. | medium | M | low | trust-safety |

### Reports & Analytics (operational dashboards)

_The Reports & Analytics area is admin-only (gated in ReportsAnalytics.jsx via `currentUser?.role === 'admin'`). It renders seven tabs — KPI Dashboard, Performance Dashboard (AnalyticsDashboard.jsx), Referral Volume, Nurse Performance, OASIS, PDGM, and Reports Center — each backed by React Query pulls from Base44 entities with recently-fixed row limits. Cards and Recharts visualizations aggregate NoteConversion, ComplianceAudit, OASISAssessment, Referral, PatientAlert and User data, and most tabs offer a PDF or JSON/CSV export via pdfExporter.jsx / statsCalculator.jsx. AgencyAnalytics.jsx is a separate admin page with Overview/Compliance/Performance/Training/Financial tabs and a CSV export._

**Pain points:**
- An admin who exports the OASIS, PDGM, Nurse Performance, or Referral Volume PDF gets a report whose data tables are completely blank — the exporter reads {headers, rows} but those components pass {data, columns}.
- There is no date-range control anywhere on the ReportsAnalytics tabs; the range is hard-coded to the last 3 months (`_setDateRange` is unused), so an admin cannot answer 'how did we do last month/last quarter?' without editing code.
- The 'Avg Doc Time' trend on the Performance Dashboard shows a rising time as a green up-arrow ('good'), when slower documentation is actually bad — the metric direction is inverted and misleads admins.
- PDGM 'Estimated Revenue' and case-mix counts are fabricated from fixed ratios and flat dollar amounts, not real reimbursement data, yet presented (and exported) as concrete financial figures.

| Enhancement | Benefit | Impact | Effort | Risk | Type |
|---|---|:--:|:--:|:--:|---|
| **Fix blank tables in exported PDFs (OASIS, PDGM, Nurse Performance, Referral)** | Admins actually get the compliance/case-mix/performance/referral tables they think they're exporting for surveyors, leadership, and audits, instead of a PDF with empty tables. | high | S | low | bug |
| **Clearly label estimated/simulated PDGM figures as estimates, not booked revenue** | Protects admins (and the agency) from citing fabricated dollar figures in financial or payer conversations, and keeps trust in the analytics that ARE real. | high | S | low | trust-safety |
| **Add a real date-range selector to the ReportsAnalytics tabs** | Admins can pull the exact reporting window a payer, surveyor, or leadership meeting needs (e.g. last calendar month) without waiting for a code change, and can bookmark/share the exact view. | high | M | low | new-capability |
| **Fix inverted 'Avg Doc Time' trend direction on Performance Dashboard** | Admins reading the dashboard trust the color/arrow to mean 'better vs worse'; today a slowdown looks like an improvement, which can hide a real productivity regression. | medium | S | low | bug |
| **Add empty-state messaging when a report period has no data** | Admins can immediately tell the difference between 'genuinely nothing happened this period' and 'the report failed to load', and don't accidentally distribute an all-zeros PDF. | medium | M | low | ux-polish |
| **Make nurse-performance rows drill through to that nurse's detail** | An admin reviewing rankings can go from 'this nurse is at 62% compliance' straight to that nurse's trend/detail in one click instead of re-navigating and re-selecting. | medium | M | low | ux-polish |
| **Give the OASIS/Nurse-Performance bar charts accessible, non-truncating labels on mobile** | Admins reviewing on a tablet/phone can actually read nurse and source names, and screen-reader users get the underlying numbers instead of an opaque chart. | medium | M | low | accessibility |

### Predictive Analytics (risk/forecast)

_PredictiveAnalytics.jsx fetches active Patients, recent OASISUpload (200), Visits (500), and active PatientAlerts via React Query, then renders four tabs: Overview (PopulationRiskOverview + optional PatientRiskScorecard), Rehospitalization (RehospitalizationPredictor), Therapy Need (TherapyNeedForecaster), and AI Insights (PredictiveInsightsPanel). Overview computes deterministic rule-based risk scores client-side from the latest OASIS snapshot (patientOASIS[0]), visits, and alerts; the other tabs add on-demand per-patient AI analysis via useAICall/InvokeLLM (claude_opus_4_8) with JSON schemas. There is also a PatientDeteriorationPredictor used on PatientDetails (not wired into this page) that analyzes vital-sign trends. AI output is held only in component useState and never persisted, exported, or written back as alerts/tasks._

**Pain points:**
- A nurse who waits 15-30s for an AI rehospitalization prediction or therapy forecast loses it the moment they switch tabs: Radix TabsContent (tabs.jsx line 69, no forceMount) unmounts the inactive tab, wiping the 'predictions'/'forecasts'/'aiAnalysis'/'insights' useState. There is no way to keep, export, or print the result.
- While the four React Query calls in PredictiveAnalytics.jsx are still loading, the page shows a fully-rendered but empty dashboard ('0 High Risk Patients', empty charts, empty patient list) with no skeleton or spinner, because the component never reads isLoading/isPending and defaults every dataset to []. It looks broken or like the agency has no at-risk patients.
- The risk lists show a high-risk patient's name but offer no way to open that patient. No predictive component imports useNavigate/createPageUrl, so a nurse must leave the page, go to patient search, and re-find the person to act on the risk.
- AI surfaces actionable findings (RehospitalizationPredictor 'clinical_alerts'/'preventive_actions'; PatientDeteriorationPredictor 'physician_notification: true') but they are dead-ends - nothing can be converted into a PatientAlert or task, so insights evaporate.

| Enhancement | Benefit | Impact | Effort | Risk | Type |
|---|---|:--:|:--:|:--:|---|
| **Persist AI predictions across tab switches with forceMount (or lift state)** | Nurses stop losing expensive AI analyses when they navigate between tabs to compare rehospitalization vs therapy views for the same patient - no re-running, no re-waiting, no wasted LLM cost. | high | S | low | bug |
| **Show loading skeletons instead of a fake-empty dashboard** | Admins and nurses immediately understand the app is working and loading, rather than mistrusting a dashboard that appears to report zero at-risk patients. | high | S | low | ux-polish |
| **Make risk-list rows navigate to the patient record** | One tap takes a nurse from 'this patient is high risk' straight to the chart to act, instead of manually re-searching for the patient by name. | high | S | low | ux-polish |
| **Turn AI findings into a PatientAlert / task with one click** | A predicted deterioration or preventable readmission becomes a tracked, assignable alert the whole care team sees, instead of a fact the nurse has to remember and re-enter elsewhere. | high | M | medium | new-capability |
| **Display OASIS assessment date + a data-freshness badge on the scorecard** | Nurses can judge how much to trust a risk score and know when a fresh reassessment is overdue, which is critical for a score computed from a single possibly-old snapshot. | medium | S | low | trust-safety |
| **Add a trust/verify disclaimer and timestamp to population AI insights** | Admins reading strategic/financial AI suggestions get honest framing about their AI origin and freshness, reducing the risk of acting on hallucinated numbers in a HIPAA/clinical setting. | medium | S | low | trust-safety |
| **Honor the Risk Level filter on the Therapy tab and show active-filter feedback** | The filter behaves consistently, so nurses aren't misled into thinking a full patient list is only their high-risk subset. | medium | M | low | ux-polish |
| **Surface the existing vital-sign deterioration predictor inside this page** | From the population risk view, a nurse can drill into a selected patient and immediately see vital-sign-based deterioration warnings and physician-notification prompts without navigating away. | medium | M | medium | new-capability |

### Compliance Center

_The Compliance Center (src/pages/ComplianceCenter.jsx) is an admin-only hub with three top tabs (Dashboard, Regulatory, Security & Policies) and nested sub-tabs, all deep-linkable via ?tab=/?view=. The Dashboard tab shows a Medicare-audit Overview (StatCards, a compliance-score trend line, an AI Insights generator, a report generator, and an AI compliance Q&A assistant), a live Real-Time Monitoring view that derives overdue-training and expiring-credential issues from TrainingAssignment/PersonnelCredential/User data (grouped per employee with a bulk email "Notify" action), plus two lazy sub-dashboards (ComplianceMonitoringDashboard, RealTimeComplianceDashboard) that recompute similar signals. Shared filter/group/count logic lives in complianceIssueStats.js and is unit-tested. Reports export as plain .txt and the aggregated dashboard exports raw JSON._

**Pain points:**
- Agency admins identified by account_type 'agency_admin' (not role 'admin'), and super admins identified by owner-email, are locked out of the entire Compliance Center with an 'Admin Access Required' wall even though the app's own role model grants them access.
- The 'Notify' button fires HIPAA-relevant compliance emails to selected staff instantly with no preview or confirmation, so a mis-click blasts real people (and PHI-adjacent details) with no undo.
- Generating AI Insights on the Overview costs a full Opus call but silently discards critical_priorities, systemic_issues, and trend_analysis - the admin waits for and pays for analysis they never see.
- Compliance reports download as raw .txt (and the other dashboard as raw .json), which admins can't hand to a surveyor or leadership without reformatting.

| Enhancement | Benefit | Impact | Effort | Risk | Type |
|---|---|:--:|:--:|:--:|---|
| **Fix role gate so agency admins and super admins can open Compliance Center** | Agency administrators and platform super admins can actually reach compliance monitoring, alerts, and reports that they are entitled to, instead of hitting a false access wall. | high | S | low | bug |
| **Add a preview/confirm step before bulk compliance notification emails** | Admins avoid accidentally blasting the wrong people with compliance emails and can verify the message content before real, un-undoable emails go out to staff. | high | S | low | trust-safety |
| **Render the AI Insights fields that are already being requested (or stop requesting them)** | Admins get the complete strategic analysis (critical priorities, systemic issues, trend narrative) they waited for, instead of two of five sections, making the AISHIssue button worth the wait. | medium | S | low | quick-win |
| **Show due/expiration dates and a fix-it link on live monitoring issue cards** | Admins can see exactly when each item is/was due and jump straight to the record to resolve it, instead of reading a vague sentence and manually searching for the employee. | medium | S | low | ux-polish |
| **Sort per-employee compliance issue cards by severity/count so the worst are on top** | Admins triage the highest-risk employees first instead of scrolling a randomly-ordered list to find who has critical issues. | medium | S | low | ux-polish |
| **Export compliance report as printable PDF/HTML instead of raw .txt** | Admins get a clean, branded, survey-ready compliance document they can print or attach for leadership, instead of a plain-text or JSON dump they'd have to reformat. | medium | M | low | new-capability |
| **Add keyboard/label accessibility to the per-employee selection checkboxes** | Admins using assistive tech (or just larger touch targets on a tablet) can reliably tell and control which employee they're selecting before sending notifications. | low | S | low | accessibility |
| **Persist acknowledged AI Insights / conversation and add a copy-to-clipboard action** | Admins can capture and reuse AI compliance guidance (paste into policies, tickets, staff emails) instead of losing it on the next click or having to re-run and re-pay for the analysis. | low | S | low | quick-win |

### User Management, setup, credentials & personnel

_Admins manage users from UserManagement.jsx (search/filter, edit role+name+phone+credential, disable/enable, reset password, delete, invite, and an inline per-user activity panel). AdminUserSetup.jsx is a lighter invite-only page. Invitations flow through the createUserWithTempPassword backend function, which sends a platform invite plus a branded welcome email and creates a UserInvitation record. Staff self-manage licenses/certs/insurance in PersonnelFile.jsx via PersonnelCredentialForm and CredentialRenewalPortal (upload document + expiration date, submit for admin approval); admins approve/reject in AdminCredentialApproval and monitor agency-wide expirations in CredentialComplianceReport (with CSV export). PersonnelCredential RLS lets any user read/write their own records and any role:'admin' read/write all._

**Pain points:**
- A facility admin who picks 'Admin' in the Add New User dialog gets a raw failure toast ('Only a super admin can invite a user with an admin role') because the backend rejects it, but the UI still offers Admin as a selectable role with no hint that it will fail.
- Inviting an email that already has an account or a pending invitation is not blocked client- or server-side, so admins can silently create duplicate invitations / re-send the platform invite to already-registered users.
- CredentialComplianceReport flags every admin and office-staff user with zero personnel items as 'No Credentials / Need upload', burying the nurses who actually have expired licenses in false positives.
- AdminCredentialApproval lists pending credentials for ALL agencies (filters only by status), while the PersonnelFile 'Approvals (N)' tab badge counts only the current agency — the count and the list disagree, and a facility admin sees other agencies' staff PHI.

| Enhancement | Benefit | Impact | Effort | Risk | Type |
|---|---|:--:|:--:|:--:|---|
| **Hide/disable the 'Admin' role option for non-super-admins in both invite dialogs** | Facility admins stop hitting a cryptic red error toast after filling out the whole invite form; the UI matches what the backend actually permits, so they know up front they need a super admin to add another admin. | high | S | low | ux-polish |
| **Block duplicate invites for existing users / pending invitations before sending** | Prevents an admin from silently emailing a fresh 'welcome/set your password' invite to a nurse who is already active (confusing and a support ticket), and stops duplicate pending-invitation rows cluttering the dashboard. | high | S | low | bug |
| **Scope AdminCredentialApproval to the admin's own agency** | Facility admins only see and act on their own staff's pending credentials, the tab badge number finally matches the list, and cross-agency staff documents stop leaking into the wrong admin's queue. | high | S | medium | trust-safety |
| **Add a 'Send reminder' action per expiring/expired staff row in the compliance report** | An admin can nudge a nurse to renew an expiring license in one click from the compliance screen instead of copying emails into Outlook, closing the loop where the report currently just shows a problem without a way to act on it. | high | M | low | new-capability |
| **Show expiring-soon credentials in the renewal portal, not just expired ones (Renew button gap)** | A nurse never has a lapsed license silently vanish from their 'Renew Now' list because of a status-string mismatch — the portal always shows what actually needs renewing based on the real date. | medium | S | medium | bug |
| **Surface the invited role and email-status on pending invitation rows and validate email in the primary flow** | Admins get instant 'invalid email' feedback on the page they actually use most, avoiding a bounced invite the nurse never receives, and invitation rows read in the same plain language ('Nurse') as the rest of the table instead of the internal 'user' role string. | medium | S | low | quick-win |
| **Only flag clinical staff (not admins/office staff) as 'No Credentials'** | The compliance officer's 'No Credentials' count reflects nurses who genuinely need to upload a license, instead of being padded by every admin/office account — faster to see who is actually out of compliance. | medium | M | low | ux-polish |
| **Add a text confirmation (type name) or clearer visual separation for destructive Delete User** | An admin working on a phone or tablet can't accidentally delete or disable the wrong nurse by fat-fingering an icon in a cramped action row; the highest-consequence action gets a deliberate, harder-to-trigger gesture. | medium | M | low | trust-safety |

### Admin Console / Operations & nurse performance

_AdminOperations.jsx is a tabbed command center (Overview / User Activity / Data Quality / System Health / Settings) with a searchable tool directory (AdminConsoleDirectory) and live overview (AdminDashboardOverview). NursePerformanceDashboard.jsx renders an AI-generated performance grade, KPI tiles, and nine tabs (Insights, Quality, Outcomes, Utilization, Burnout, Goals, Skills, Trends, Suggest) driven by the analyzeNursePerformance backend function, plus per-nurse CRUD goals. UserActivityReport.jsx aggregates up to 5000 UserActivity rows into per-user engagement cards with CSV/PDF export, alongside a raw activity log tab. Access is gated at the router by getRoleView (super_admin/facility_admin/nurse), but the pages re-check role internally in inconsistent ways._

**Pain points:**
- An agency admin whose access comes from account_type==='agency_admin' (not literal role==='admin') is let through the router but then hits an 'Access Restricted' wall on AdminOperations and a degraded, self-only NursePerformanceDashboard — the console silently breaks for a legitimate admin.
- NursePerformanceDashboard's copy is written for the nurse ('My Performance Goals', 'Track your professional development'), but the page is adminOnly in the nav manifest, so nurses can never open it to see their own AI insights, burnout signals, or goals.
- While performance data is still loading or missing, the Compliance Score tile paints a good nurse's 0% in alarming red because getScoreColor(undefined) falls through to the <70 branch.
- Admins exporting the User Activity Report (name, email, pages, entities for every user) generate an un-audited PHI-adjacent data extract — no 'export' activity is logged, even though the rest of the app logs exports via ActivityActions.EXPORT.

| Enhancement | Benefit | Impact | Effort | Risk | Type |
|---|---|:--:|:--:|:--:|---|
| **Fix admin role gate so agency admins aren't locked out of the console** | Agency administrators who were provisioned by account_type rather than the literal 'admin' role can actually use the Admin Console and pick any nurse in the performance dashboard, instead of being bounced or silently downgraded. | high | S | low | bug |
| **Audit-log User Activity Report exports as PHI extracts** | Compliance officers get a complete, self-consistent HIPAA audit trail — including who exported the roster of everyone's activity and when — closing a gap where the most sensitive export in the console was invisible. | high | S | low | trust-safety |
| **Give nurses a read-only self-service view of their own performance dashboard** | Nurses can see their own AI grade, growth opportunities, burnout warning signs, and set/track personal goals — turning a manager-only surveillance tool into a self-improvement loop that the UI copy already promises. | high | M | medium | new-capability |
| **Stop painting loading/empty compliance scores as failing red** | Nurses and managers don't get a false alarming impression of failing compliance during the normal loading window; the tile only turns red when the data genuinely warrants it. | medium | S | low | trust-safety |
| **Add a live last-updated timestamp and optional auto-refresh to the User Activity Report** | An admin investigating a live access/security concern can see how stale the report is and refresh it in one click, instead of unknowingly acting on minutes-old aggregates. | medium | S | low | ux-polish |
| **Clamp the utilization workload bar and clarify overload** | Managers instantly see when a nurse is over their optimal visit load (a burnout precursor) instead of a bar that silently maxes out and hides the overage. | medium | S | low | bug |
| **Let admins jump from a suspicious activity card straight into that user's report and history** | During an access review or incident, an admin drills from 'this account looks unusually active' to that account's exact event timeline in a single tap, cutting investigation clicks. | medium | M | low | ux-polish |
| **Rename the 'Enhancements Completed' KPI to match its data** | Nurses and admins read an accurate, unambiguous productivity number instead of a mislabeled 'enhancements' figure that actually counts completed visits. | low | S | low | quick-win |

### Clinical Pathways manager

_ClinicalPathwayManager.jsx is an admin-only page (4 tabs: Pathways, AI Generate, OASIS, ICD-10) for creating/editing "clinical pathways" — rule sets that match on a patient's diagnosis (trigger_conditions) and then surface documentation prompts, PDGM rescore/revenue opportunities, comorbidity checklists, functional focus areas, and auto-generatable tasks. Admins can hand-build pathways in a Dialog form, load 3 hard-coded samples (CHF, Diabetes, Post-Surgical), duplicate/delete, AI-generate whole pathways from a diagnosis (AIPathwayGenerator), or AI-analyze an existing pathway against guidelines and append recommendations (AIPathwayUpdater). Downstream, ClinicalPathwayTrigger and AIPathwayRecommender evaluate active pathways against OASIS/PDGM data during real visits, rendering the documentation checklists, rescore dollar amounts, and one-click task creation to nurses._

**Pain points:**
- A super_admin (account_type based) whose role isn't literally 'admin' is fully locked out of managing pathways, because the gate at ClinicalPathwayManager.jsx:358 uses `currentUser?.role !== 'admin'` and omits the `isSuperAdmin(currentUser)` helper that every other admin surface (OASISCenter, DocumentHub, TemplateManagement, SendFax, OnCallSchedule) ORs in.
- The edit form only lets an admin change name, description, priority, active flag, and trigger conditions — there is NO UI to view or edit the documentation_prompts, rescore_opportunities, recommended_tasks, comorbidity_checklist, or functional_focus_areas that are the actual clinical payload nurses see. Admins can see a count (e.g. '3 Doc Prompts') but can never read or correct the content that drives patient documentation.
- The AI Update advisor's 'Apply This Update' is append-only (AIPathwayUpdater.jsx:110-119): every apply spreads new items onto the existing arrays with no de-dup or replace, so re-analyzing or applying twice silently piles duplicate prompts/tasks into the pathway, and all of them then render for every nurse in ClinicalPathwayTrigger.
- There is no way to test which patients a pathway will fire on. An admin edits raw trigger_conditions (type/operator/value) blind, with no preview against a sample diagnosis, so mis-typed codes (e.g. 'I50' vs 'I 50') silently never trigger and no one notices until documentation is missed.

| Enhancement | Benefit | Impact | Effort | Risk | Type |
|---|---|:--:|:--:|:--:|---|
| **Fix super_admin lockout: use isSuperAdmin() in the access gate** | A super_admin (e.g. agency owner) stops being incorrectly locked out of the entire Clinical Pathways surface, so they can actually manage the pathways that drive documentation for their whole agency. | high | S | low | bug |
| **De-dupe when applying AI update recommendations** | Nurses stop seeing the same documentation prompt or duplicate 'Create Tasks' items 2-3 times in ClinicalPathwayTrigger, and admins don't unknowingly bloat pathways every time they re-run the analyzer. | high | S | low | bug |
| **Make the rich pathway content viewable and editable in the form** | Admins can finally inspect and correct the exact documentation guidance and revenue claims that nurses will be shown, instead of managing pathways blind by count badges — critical for catching a bad AI-generated prompt before it reaches the field. | high | M | low | new-capability |
| **Show AI provenance + 'verify before use' on generated/updated pathway content** | Nurses and admins can distinguish human-verified pathways from raw AI output and won't over-trust fabricated revenue numbers — important for HIPAA/Medicare compliance and clinical trust in the tool. | high | M | low | trust-safety |
| **Warn on duplicate pathway names and surface bulk-create errors** | Prevents nurses from seeing the same pathway's guidance twice and gives admins clear feedback when a create fails, instead of a silent partial success that leaves the pathway library in an unknown state. | medium | S | low | quick-win |
| **Add active/inactive filter + search to the pathway list** | Admins managing a large pathway library can quickly find and enable/disable a specific diagnosis pathway (e.g. temporarily disable a mis-configured one) with one click instead of scrolling and opening a dialog. | medium | S | low | ux-polish |
| **Add a 'Test this pathway' trigger preview in the form** | Admins get immediate confidence that a pathway will actually fire on the intended patients, preventing the silent failure mode where a mistyped trigger means nurses never get the documentation prompts and the agency loses PDGM revenue. | medium | M | low | quick-win |
| **Give the 'AI Update' card button a clearer destination and confirmation** | Admins clearly see which pathway they're updating before applying AI changes to it, reducing the risk of accidentally appending guideline recommendations to the wrong pathway. | low | S | low | ux-polish |

### Settings, Notifications, Time Off, On-Call, Offline Mode, Help

_This feature area bundles six self-service/admin tools. UserSettings.jsx manages profile (phone/credential), care scope, credentials, and AI preferences saved to AIConfiguration. NotificationSettings.jsx + NotificationPreferences.jsx let users toggle in-app/email/push per notification type, digest cadence, and quiet hours. TimeOff.jsx orchestrates request/approval/calendar tabs backed by server functions. OnCallSchedule.jsx renders a month calendar of holiday all-day and Mon–Thu overnight (5pm–9am) coverage; admins assign staff. OfflineMode.jsx caches selected patients to localStorage and drains a unified IndexedDB sync queue (src/lib/offlineSync.js) on reconnect. Help.jsx offers static PDFs, quick-start, FAQ search, and a generated manual download._

**Pain points:**
- A nurse can enable 'Push Notifications' and per-type push toggles in NotificationPreferences.jsx, but the app never calls Notification.requestPermission or registers a service worker anywhere in the codebase — so the toggle silently does nothing and the nurse never receives the critical/patient push alerts they think they turned on.
- Non-admin nurses can view the On-Call calendar but there is no 'who is on call right now / tonight' answer and no tap-to-call — a nurse with a 2am patient emergency has to eyeball a month grid, find today's cell, read a first name, then look the number up elsewhere.
- OfflineMode caches PHI (name, DOB, MRN, diagnoses, meds) to localStorage and stamps offline_cache_timestamp, but the page never shows how old the cache is or warns when it is stale — a nurse in the field may document against day-old meds/allergies without any staleness cue.
- The AI 'Save Preferences' button and the profile 'Save Contact Info' button are separate; a nurse who edits phone in the Profile tab then changes an AI toggle and hits the bottom 'Save Preferences' has their intent split across two buttons, and there is no unsaved-changes warning if they switch tabs or navigate away.

| Enhancement | Benefit | Impact | Effort | Risk | Type |
|---|---|:--:|:--:|:--:|---|
| **Wire the Push Notifications toggle to a real browser permission request (or hide it until supported)** | Nurses actually receive the critical patient/compliance push alerts they opted into, instead of a toggle that lies. No more missed urgent notifications while away from the app. | high | S | low | bug |
| **Surface offline cache age and a staleness warning in Offline Mode** | Nurses know at a glance whether their offline patient data is fresh, avoiding clinical decisions based on outdated meds/allergies/orders. | high | S | low | trust-safety |
| **Add an 'On call right now' banner with tap-to-call to the On-Call page for all users** | A nurse facing a 2am emergency instantly sees who covers tonight and taps to call them, instead of decoding a month grid and hunting for a phone number. | high | M | low | new-capability |
| **Clarify Quiet Hours scope and that critical alerts still come through** | Nurses correctly understand that quiet hours won't hide urgent patient/critical alerts, so they don't miss emergencies or wrongly rely on being un-disturbed. | medium | S | low | trust-safety |
| **Warn on unsaved AI-preference/profile changes when navigating away or switching tabs** | Nurses don't silently lose AI/documentation preference changes when they tab around or leave the page, reducing repeated re-configuration frustration. | medium | M | low | ux-polish |
| **Add a 'Test notification' button and quiet-hours preview to Notification settings** | Nurses can immediately verify their alert settings actually fire (sound/push/permission) rather than discovering a misconfiguration during a real emergency. | medium | M | low | quick-win |
| **Show pending on-call/coverage gaps to admins and let a nurse request coverage from Time Off** | Admins spot and fill on-call coverage gaps quickly, and approvers avoid approving time off that leaves a required overnight/holiday shift uncovered — fewer scramble-for-coverage emergencies. | medium | L | medium | new-capability |
| **Make the non-functional Help resource cards actually do something** | Nurses aren't misled by clickable-looking cards that do nothing; the help page's shortcuts actually take them somewhere useful. | low | S | low | bug |

### Cross-cutting shell: navigation, mobile ergonomics, layout, command palette

_The shell (src/components/Layout.jsx) is a role-gated frame that fans out a single nav.manifest.js source of truth into a DesktopSidebar, MobileHeader, MobileMenu, MobileBottomNav, Breadcrumbs, and a Cmd/Ctrl+K CommandPalette. Layout drives runtime badges (unread messages/SMS/notifications, pending time-off), a HIPAA SessionTimeoutManager, a floating OfflineSyncStatus, and a skip-to-content link. The command palette offers verbs (Quick Actions), recents, and manifest-derived destinations, filtered by role and to actually-routed pages. Mobile uses a bottom nav whose two middle slots swap by role (nurse: Notes/Fax; admin: Referrals/Documents), plus a slide-over menu and a search icon that opens the palette._

**Pain points:**
- Sidebar 'Favorites' section is broken: favorited_patients is stored as an array of patient-ID strings, but DesktopSidebar renders each as an object (patient.name / patient.id), so favorites show blank labels and link to PatientDetails?id=undefined.
- Nurses in the field get no persistent 'You are offline' signal in the shell chrome — OfflineSyncStatus only appears when there are queued writes, so a nurse can be offline with nothing pending and see a fully normal UI, then be surprised when actions fail.
- The mobile slide-over menu doesn't lock body scroll or trap focus, so the page behind it scrolls under the drawer and keyboard/AT focus escapes into hidden content.
- The command palette (the fastest way to reach the 60+ routed pages) has no persistent on-screen hint on desktop pages themselves, and its search doesn't match a page's keywords when they're shown — recents/quick-actions are good but there's no 'jump to a patient' capability, which is the single most common nurse target.

| Enhancement | Benefit | Impact | Effort | Risk | Type |
|---|---|:--:|:--:|:--:|---|
| **Add a persistent offline indicator to the shell chrome** | Field nurses in dead-zone homes know immediately they're offline before they try to save a note or open a patient the app can't fetch, preventing 'why won't this load' confusion and lost work. | high | S | low | trust-safety |
| **Fix broken sidebar Favorites: favorited_patients are ID strings, not objects** | Nurses actually get one-tap access to their favorited patients from the sidebar (today the feature is dead), and favorite-scoped patient alerts start surfacing instead of silently returning empty. | high | M | low | bug |
| **Let the command palette jump straight to a patient** | From any screen, a nurse types a patient's name and hits Enter to open that chart — the single highest-frequency navigation collapses from ~4 taps to one keystroke. | high | M | medium | new-capability |
| **Lock body scroll and trap focus while the mobile menu is open** | A one-handed nurse opening the menu on a phone doesn't accidentally scroll the page underneath, and keyboard/screen-reader users stay inside the menu instead of tabbing into hidden content behind it. | medium | S | low | accessibility |
| **Make command-palette search match page keywords, not just labels** | Palette search returns only genuinely relevant pages instead of dumping the whole Actions or Recent group whenever the query happens to contain 'action' or 'recent', so users find the right page on the first try. | medium | S | low | bug |
| **Add a 'More' overflow to the mobile bottom nav** | Nurses reach less-common but still-daily destinations (OASIS, alerts, on-call) from the thumb zone instead of hunting through a long slide-over list. | medium | S | low | ux-polish |
| **Show the badge count on the mobile bottom-nav Messages and add badges for alerts** | A nurse glancing at the thumb bar sees unread clinical alerts/messages counts without opening the menu or scrolling up to the header bell, reducing missed time-sensitive patient alerts. | medium | S | low | quick-win |
| **Persist and restore scroll position / suppress page-transition slide when returning via back** | Returning from a patient chart to a long roster or message list keeps the nurse's scroll position, eliminating the frustrating re-scroll on every drill-in/back cycle in the field. | medium | M | medium | ux-polish |
