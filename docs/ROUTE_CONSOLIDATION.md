# Route & Page-Family Consolidation

Date: 2026-06-03

Follow-up to the routing findings in `UI_UX_REVIEW.md` / `PHASE2_REVIEW.md`.

## Where routing stands now

- **Single source of truth.** `App.jsx` renders routes from `src/routes.jsx`
  (`ROUTES` + `REDIRECTS`). `pages.config.js` is auto-generated and **not imported
  by live code** — there is no real "dual routing" problem anymore.
- **Nav is consistent.** `src/components/navigation/navConfig.js` (consumed by the
  sidebar, command palette, and breadcrumbs) now has **56 entries, every one of
  which is routed or redirected → zero dead nav links.**

## What was consolidated (safe, done)

- **Routed 11 linked-but-unrouted pages** that real screens navigated to but which
  dead-ended on PageNotFound (e.g. `OASISAnalyzer`, `NursePerformanceDashboard`,
  `FaxAnalytics`, `TemplateManagement`).
- **Removed 3 OASIS drill-downs from the nav** (`OASISComplianceReview`,
  `OASISDocumentationReview`, `OASISRevenueAnalysis`). They read `location.state`
  from `OASISAnalyzer` (they render empty when opened directly), so they stay
  *routed* — for OASISAnalyzer's navigate-with-state drill-down — but are not
  standalone nav destinations. (`OASISClinicalReview` is the same pattern.)
- **Removed 6 redirect-backed duplicate nav entries** whose canonical was already
  in the nav: `ComplianceDashboard`→ComplianceCenter, `Reports`→ReportsAnalytics,
  `IncidentReporting`→Incidents, `StaffTrainingHub`→AdminTraining,
  `AdminDashboard`→AdminOperations, `Support`→Help. The path redirects remain for
  old bookmarks.
- **Added redirect** `MedicareComplianceDashboard → ComplianceCenter` (duplicate
  audit-metrics page).

## Key finding: the raw "family" counts overstate duplication

The earlier review counted Dashboard ×18, Training ×13, Compliance ×10, OASIS ×8.
Reading the pages shows **most are distinct features, not duplicates** — so blanket
consolidation would remove real functionality. Breakdown:

### OASIS
- **Canonical:** `OASISAnalyzer` (upload/extract/score hub) and `SmartOASISAssessment`
  (guided form) — distinct entry points, both kept.
- **Drill-downs (state-dependent, de-nav'd, kept routed):** Compliance/Documentation/
  Revenue/Clinical Review.
- **Distinct, kept:** `OASISAuditDashboard` (independent audit queue), `OASISReview`
  (AI-suggestion approval). `OASISAnalyticsDashboard` is a component rendered inside
  OASISAnalyzer, not a page.

### Compliance
- **Canonical:** `ComplianceCenter`.
- **True duplicates → redirected:** `ComplianceDashboard` (already), now
  `MedicareComplianceDashboard`.
- **Distinct, kept:** `SecurityCompliance` (HIPAA/security — different domain),
  `AIComplianceInServices` (in-service training), `ComplianceMonitoringDashboard`
  (personnel/credential monitoring).
- **Product decision (left):** whether to fold `RealTimeComplianceDashboard` /
  `RegulatoryCompliance` / `ComplianceRegulatory` (thin wrappers/components) into
  ComplianceCenter as tabs.

### Training / Learning
- **Distinct, kept:** `LearningCenter`, `MyLearning`, `AdminTraining`,
  `TrainingCoursePlayer`, `NurseTraining`, etc.
- **Duplicates:** `MyTraining` and `StaffTrainingHub` both render the same
  `MyTrainingDashboard`; StaffTrainingHub already redirects to AdminTraining and was
  removed from the nav. **Product decision (left):** point `/MyTraining` at the
  canonical too, or keep it.

### Dashboards
- **Mostly distinct** (NursePerformance, Analytics, FaxLogs, PatientRecord,
  ManagerSkillGap, ClinicalInsights…) — NOT duplicates; kept.
- **Empty placeholder stubs** (`QualityDashboard`, `ProductivityDashboard`,
  `FaxDashboard` renders the Fax component): **product decision (left)** — these are
  "coming soon" headers; build them out or remove from nav. Left in place (harmless)
  rather than guess they're abandoned.

## Remaining work (needs product decisions, not code bugs)

1. Fold the thin compliance wrappers into `ComplianceCenter` tabs (or leave).
2. Decide the fate of the empty placeholder dashboards (build vs retire).
3. Point `/MyTraining` at the canonical training page if it's redundant.

`CustomizableDashboard` is the only page with zero inbound references; it's left in
place because page files are coupled to the auto-generated `pages.config.js`
registry (deleting one requires regenerating that file).
</content>
