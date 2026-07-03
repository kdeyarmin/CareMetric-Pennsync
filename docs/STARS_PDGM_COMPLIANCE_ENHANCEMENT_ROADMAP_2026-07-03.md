# PennSync — Star Rating · PDGM Revenue · CMS Compliance Enhancement Roadmap

**Date:** 2026-07-03
**Type:** Full-app feature review + prioritized enhancement roadmap.
**Business goals (agency-stated):** (1) increase the Medicare Quality of Patient Care star rating,
(2) increase revenue under PDGM, (3) ensure the highest compliance with CMS regulations —
**"beginning from the referral process."**
**Relationship to other docs:** Complements — does **not** supersede —
[`GROWTH_FEATURE_ROADMAP_2026-07.md`](./GROWTH_FEATURE_ROADMAP_2026-07.md) (2026-07-01). Since that
roadmap was written, most of its engines were **built and unit-tested but never wired into the
running app** — this document verifies that state item by item (against code as of 2026-07-03) and
re-plans from here. It also promotes several items that roadmap deferred (§8 there): the NOA clock,
recert-due board, LUPA monitor, physician-order/485 tracking, eligibility capture, and
referral-source management.

**Goals key:** ⭐ = QoPC star rating · 💰 = PDGM revenue · ✅ = CMS compliance
**Effort:** S = days · M = 1–2 wk · L = 2–4 wk · XL = >1 mo (single developer, rough order of magnitude)

---

## 1. Executive summary

PennSync already captures nearly all the raw material the three goals need — the referral AI
extraction pulls F2F, insurance, SDOH, and OASIS pre-fill from the uploaded packet; diagnosis
sequencing is PDGM-aware at intake; the OASIS/PDGM analytics suite is deep; the Smart Note
compliance scrubber is genuinely strong. **The core finding of this review is that the last mile
never landed:** at least six flagship engines are fully built and unit-tested but are wired into
nothing, so the app computes (or could compute) the exact numbers that drive stars, revenue, and
compliance — and then discards them.

| Built-but-unwired engine | File | What it would deliver | Goal |
|---|---|---|---|
| Intake-to-SOC / Timely Initiation tracker | `src/components/referral/intakeToSocTracker.js` | The QoPC process measure + referral aging board | ⭐✅ |
| Outcome-measure computation | `base44/functions/computeOutcomeMeasures/entry.ts` | 5 improvement measures + GG discharge function score → `AgencyKPI` | ⭐ |
| Star-metric display | *(no consumer exists)* | Nothing anywhere reads `AgencyKPI` or `PatientOutcomeMetric` | ⭐ |
| Denial guardrail | `src/components/compliance/denialGuardrailEngine.js` | Pre-save check on the top-4 denial clusters | ✅💰 |
| F2F persistence | `toFaceToFaceEncounter` in `faceToFaceValidator.js` | An auditable `FaceToFaceEncounter` record (validation today is in-memory only) | ✅💰 |
| HIPPS / LUPA grouper | `src/components/pdgm/pdgmGrouper.js` + `caseMixWeightsLoader.js` | HIPPS codes + real per-group LUPA thresholds (needs the CMS weight CSV) | 💰 |
| Compliance risk monitor | `base44/functions/monitorComplianceRisks/entry.ts` | Daily PatientAlerts (missed visits, missing discharge OASIS, homebound gaps) — no schedule registered | ✅ |

Because the engines and (in most cases) the entity schemas already exist, **Tier 1 of this roadmap
is mostly wiring, not building** — low-risk, days-to-weeks each, and it starts exactly where the
agency asked: the referral process. Tier 2 adds the highest-ROI missing features on established
in-app patterns (PatientAlert crons, hub tabs, the e-signature and token-portal stacks). Tier 3 is
strategic (HHCAHPS, claims activation, QAPI, survey readiness).

Two defects found during review are called out because they silently corrupt the metrics this
roadmap creates:

- **`ReferralTriage.jsx` creates Patients with no `Referral` record** (`handleCreatePatientFromTriage`,
  lines 30–78) — those admissions are invisible to the intake queue, follow-up QA, volume report,
  and every timeliness denominator. Fix bundled into Tier 1 (item 2.7 executed with 1.1).
- **`ReferralVolumeReport.jsx` shows hardcoded metrics** — "Avg Processing Time 2.3d" is a string
  literal (line 111) and the per-source "Avg Priority" badge always renders "Normal" (line 187).

---

## 2. App review by goal

### A) Star rating (Quality of Patient Care)

**Exists and wired:** OASIS Center hub (`src/pages/OASISCenter.jsx`) with SmartOASIS assessment,
scoring engine (`oasisScoringEngine.js`), validation stack; PPH rehospitalization-prevention
worklist (`pphWorklistEngine.js`, wired into `PredictiveAnalytics.jsx`) targeting the
highest-weighted HHVBP claims measure; discharge-OASIS completeness enforcement logic
(`dischargeComplianceEnforcer.js`, mirrored into `monitorComplianceRisks`).

**Built but dead:** `computeOutcomeMeasures` pairs Discharge↔SOC/ROC OASIS and computes the five
QoPC improvement measures (M1860 ambulation, M1850 bed transfer, M1830 bathing, M1400 dyspnea,
M2020 oral meds) plus the GG discharge function score, with CMS-style exclusions and the
20-episode / 5-of-7-measure star-eligibility floors (`STAR_MIN_EPISODES`, `STAR_MIN_MEASURES` in
`outcomeMeasureEngine.js`). It writes `PatientOutcomeMetric` and `AgencyKPI` rows — but its
frontend invoker (`src/functions/computeOutcomeMeasures.js`) has zero callers, no platform schedule
is documented for it, and **no frontend file reads `AgencyKPI` or `PatientOutcomeMetric`**. The
same is true of the intake-to-SOC tracker (Timely Initiation of Care, the one process measure in
the star).

**Missing entirely:** a star-rating dashboard; HHCAHPS/patient-satisfaction capture (the
`patient_satisfaction_score` field exists on `PatientOutcomeMetric` but nothing populates it); a
real hospitalization/ED data feed (the `readmission_30_day`/`er_visit_30_day` outcomes are set only
by the manual PPH worklist path).

### B) PDGM revenue

**Exists and wired:** `calculatePDGM` (`base44/functions/calculatePDGM/entry.ts`) — clinical group,
functional-impairment level, comorbidity adjustment, timing, admission source → estimated 30-day
payment, with server-side financial gating; deterministic PDGM diagnosis sequencing at intake
(`diagnosisCodeGenerator.js`, persisted to `Referral.diagnosis_coding` with RTP badges in the
queue); comorbidity reconciler (`comorbidityReconciler.js`); the large admin PDGM analytics suite
(navigator, trend, scenario/what-if, revenue comparison); rate config (`PDGMRateSettings.jsx` /
`PDGMRateConfig`).

**Built but dead:** the table-driven HIPPS grouper (`pdgmGrouper.js`) and CMS case-mix CSV loader
(`caseMixWeightsLoader.js`, carries per-group LUPA thresholds) — explicitly reference-only until
fed the CMS weight file, which the repo doesn't ship; the aggregate front-door diagnosis guard
(`validateIntakeDiagnoses`/`previewClinicalGroup` in `intakeDiagnosisValidator.js`) at the
upload/quick-scan moment (note: per-code RTP screening *does* fire during full processing via
`diagnosisCodeGenerator.js`).

**Missing entirely:** HIPPS codes anywhere in the live path (`calculatePDGM` emits none); real LUPA
management (`PDGMCaseMix.is_lupa` has no writer; the only LUPA alert uses the wrong pre-PDGM
"4 visits per 60-day episode" rule at `monitorComplianceRisks/entry.ts:218`); NOA tracking of any
kind (a late NOA costs 1/30 of the period payment **per day**); a billing/claims layer
(`Billing`/`Invoice`/`Payment` entities are schema-only with zero readers or writers); eligibility
or MBI verification; referral-source management (free-text `referral_source` string only).

### C) CMS compliance

**Exists and wired:** the Smart Note compliance stack (~20 modules under
`src/components/smartNote/compliance/` — required elements, presence detection, coverage score,
chart cross-check, value guard, provenance, escalation) feeding `ComplianceAudit`;
CoP-cited rule library (`defaultMedicareRules.js` — homebound 42 CFR 484.55(c), skilled need
484.75, POC 484.60, plus PA 28 Pa. Code §601.31/32); F2F validation at referral intake
(`faceToFaceValidator.js` wired into `ReferralAnalyzer.jsx`; 42 CFR 424.22 practitioner/window/
diagnosis-linkage checks); the CFR-cited provider follow-up engine (`referralFollowUpEngine.js`)
with the token-gated provider portal; regulatory sync (`syncCMSRegulations`,
`scheduledGuidelineSync`); credential compliance; incident reporting.

**Built but dead:** `denialGuardrailEngine.js` (top-4 denial-cluster pre-save scoring — imported
only by its test); F2F persistence (`toFaceToFaceEncounter` never called; no
`FaceToFaceEncounter.create` exists — F2F status is recomputed in memory per view and the intake
queue's Process-dialog path never displays it at all); `monitorComplianceRisks` (no registered
schedule).

**Missing entirely:** plan-of-care/CMS-485 lifecycle and physician-order tracking (verbal-order
log, signature turnaround — "plan_of_care"/"physician_orders" exist only as note keyword rules);
recert-window tracking (day 56–60; recert is only a visit-type label); OASIS 30-day
transmission-deadline tracking; visit frequency adherence (ordered vs delivered); QAPI (CoP
§484.65) tooling; survey-readiness tooling.

---

## 3. Tier 1 — Wire what's already built

Every item here finishes tested code. Line references verified 2026-07-03.

### 1.1 SOC completion + Timely Initiation of Care — ⭐✅ · S–M · **do first**

The agency's "begins from the referral process" priority, and the anchor for the Tier 2 NOA clock.
Today no referral ever records an SOC date; referrals terminate at `ready_for_admission` and the
star's only process measure cannot be computed. The `Referral` schema already has `soc_date`,
`first_visit_date`, `soc_completed_by`, and the `soc_completed` status — only writes and UI are
missing.

- **"Mark SOC Complete" action** in the `ReferralIntake.jsx` actions cell (`ready_for_admission`
  branch, ~line 1326): dialog with SOC-date picker (defaults today) + optional first-visit date,
  calling `Referral.update(id, markStartOfCareCompleted(referral, { socDate, by: user.email }))`.
  Add `soc_completed` to the status filter (~line 1113) and `getStatusColor` (line 1024).
- **Auto-complete hooks:** after a Start-of-Care `OASISAssessment.create` in
  `SmartOASISAssessment.jsx:247` and `OASISQuickUpdate.jsx:64`, look up the open referral by
  `patient_id` and apply the same update, non-blocking try/catch (mirror the diagnosis-coding
  pattern at `ReferralIntake.jsx:483–493`).
- **Aging board:** new `src/components/referral/ReferralAgingBoard.jsx` rendering
  `buildAgingBoard(referrals)` (on-track / due-soon / overdue, oldest first); mount below the
  StatCards on the intake tab and as a sidebar card on `ReferralFollowUp.jsx` (already loads the
  same referrals under queryKey `['referrals']` — zero extra fetches).
- **KPI:** compute `rollupTimelyInitiation` live in the star dashboard (1.2); persist
  `toTimelyInitiationKPIs` rows when month-over-month trend history is wanted.
- **Risk:** until 2.7 lands, ReferralTriage admissions bypass the denominator — ship 2.7 in the
  same sprint (it is S).

### 1.2 Star Rating dashboard + schedule `computeOutcomeMeasures` — ⭐ · M · **goal #1's centerpiece**

- **Trigger:** register a nightly platform schedule for `computeOutcomeMeasures` on the Base44
  dashboard (the `x-internal-secret` pattern documented in
  [`LEARNING_CENTER_SCHEDULED_JOBS.md`](./LEARNING_CENTER_SCHEDULED_JOBS.md) — add this and
  `monitorComplianceRisks` to that doc's table). Add an admin "Recompute now" button using the
  existing `src/functions/computeOutcomeMeasures.js` invoker.
- **Dashboard:** new admin `stars` hub tab in `OASISCenter.jsx` (add to `TAB_KEYS` line 39 and
  `ADMIN_TABS` line 44; new lazy `src/components/hub-tabs/StarRatingDashboard.jsx`). Content: the
  five improvement measures + GG discharge function score from `AgencyKPI`
  (`metric_category: 'quality'`) with `star_eligible` flags; progress toward the 20-episode /
  5-of-7-measure eligibility floor; Timely Initiation from 1.1; per-measure trend vs
  `benchmark_value`. Secondary surface: summary card in `KPIDashboard.jsx` linking to the tab.
- **Design the sparse-data state explicitly** ("N of 20 episodes") — early months will sit below
  the floor. Verify `AgencyKPI`/`PatientOutcomeMetric` RLS read rules admit admins before shipping.

### 1.3 Denial guardrail in the Smart Note save path — ✅💰 · M

~51% of home-health improper payments trace to insufficient documentation; the engine that scores
notes against the recurring denial clusters exists and fires nowhere.

- Hook `runDenialGuardrail({ noteText, serviceLine, visitType, context })` into
  `ConstrainedNoteReviewer.jsx` `computeResult` (line 242); render findings as a "Denial Risk"
  panel beside the existing compliance checklist and include them in the save-ready result.
- **Advisory first**; for critical findings reuse the acknowledgment pattern already in
  `persistVisitNote.js:53–59` rather than hard-blocking. Because `persistVisitNote.js` is the
  shared save path, the Visit Scribe audio flow inherits the guardrail for free.
- Persist findings via `reportingFields.js` (`buildVisitReportingFields`/`buildAuditFields`) into
  `ComplianceAudit.issues` and `Visit.compliance_issues` so denial risk reaches the audit
  dashboards.
- F2F cluster input comes only from the persisted `FaceToFaceEncounter` (1.4) for admission/recert
  notes — the engine deliberately never scans the nurse's note for F2F (see the isolation
  constraint in `GROWTH_FEATURE_ROADMAP_2026-07.md` §4.2).
- **Risk:** heuristics will false-positive on some legitimate narratives — ship advisory, measure,
  tighten. Keep out of the offline path initially.

### 1.4 Persist `FaceToFaceEncounter` — ✅💰 · S

F2F is a top auto-reject denial cause; today its validation result is discarded after render.

- In `ReferralIntake.jsx` `handleProcessingComplete` (after the `Referral.update` at line 774):
  `referralToF2FInput(...)` → `validateFaceToFace(...)` → `toFaceToFaceEncounter(...)` →
  dedupe by `FaceToFaceEncounter.filter({ referral_id })`, then create-or-update. Same
  non-blocking try/catch pattern as diagnosis coding.
- Surface `validation_status` as a badge in the referral queue row — the queue's Process-dialog
  path currently never shows F2F at all (only the `?tab=process` ReferralAnalyzer flow does).
- `ReferralFollowUp` already generates the provider request when F2F is missing/invalid — no
  change needed there.

### 1.5 Front-door diagnosis guard at upload — 💰 · S

Per-code RTP screening already fires during full processing; what's missing is the aggregate
check at the **upload/quick-scan moment**, before staff invest in processing.

- After `runReferralQuickScan` populates the form (`ReferralIntake.jsx:196`), run
  `validateIntakeDiagnoses({ primary, secondaries })` + `previewClinicalGroup` from
  `intakeDiagnosisValidator.js`; render an inline Alert with findings and the clinical-group
  preview. Guard the no-codes case so free-text-only extractions don't nag.

### 1.6 Schedule `monitorComplianceRisks` + fix the LUPA heuristic — ✅⭐💰 · S

- Register the daily platform schedule (same runbook as 1.2). Its `PatientAlert` output already
  has live consumers everywhere (layout bell, NotificationCenter, RiskAlertWidget, KPIDashboard) —
  scheduling it lights all of them up with zero UI work, including the discharge-OASIS
  completeness alerts that protect star eligibility.
- Interim LUPA fix at `entry.ts:218`: replace the pre-PDGM "4 visits in 60-day episode" rule with
  30-day-period framing and a configurable threshold from `PDGMRateConfig`; real per-group
  thresholds arrive with 1.7/2.3.

### 1.7 Load CMS case-mix weights → HIPPS + real LUPA thresholds — 💰 · M–L

- Follow [`PDGM_CASE_MIX_WEIGHTS.md`](./PDGM_CASE_MIX_WEIGHTS.md): admin CSV-upload UI in
  `PDGMRateSettings.jsx` ingesting the official CMS 432-group file via `caseMixWeightsLoader.js`,
  persisted with payment-year stamping; show the loader's unmappable-row report to the admin.
- Consume in an **admin-only reconciliation view** (OASIS Center Revenue tab or
  `DocumentationImpact.jsx`): HIPPS code, case-mix weight, per-group LUPA threshold rendered
  beside the `calculatePDGM` estimate. Honor the grouper header's warning — `calculatePDGM`
  remains the single payment figure shown to staff; grouper output is labeled
  HIPPS/threshold/what-if until formally reconciled. Financials stay behind `canViewFinancials`.
- **Dependency for 2.3 (LUPA management) and 2.1's penalty math.**

---

## 4. Tier 2 — High-ROI new features on existing patterns

| # | Feature | Goals | Effort | Depends on |
|---|---|---|---|---|
| 2.1 | NOA 5-day tracker | 💰✅ | M | 1.1 |
| 2.2 | Recert-window tracker (day 56–60) | 💰✅ | M | 1.6 |
| 2.3 | LUPA visit-count tracker | 💰 | M–L | 1.7 |
| 2.4 | OASIS 30-day transmission tracking | ✅⭐ | S–M | 1.6 |
| 2.5 | Physician order / 485 tracking | ✅💰 | L | — |
| 2.6 | Referral-source master data + scorecard | 💰 | M | 1.1 |
| 2.7 | Unify ReferralTriage into the pipeline | ⭐✅ | S | ship with 1.1 |
| 2.8 | Eligibility/insurance capture at intake | 💰 | M | — |

- **2.1 NOA 5-day tracker** — *highest Tier 2 priority; a late NOA is a per-day revenue leak
  (1/30 of the period payment per day late).* New `NoticeOfAdmission` entity (referral_id,
  patient_id, soc_date, noa_sent_date, status, days_late), clock anchored on `Referral.soc_date`
  from 1.1. Aging alerts as a new RISK block in `monitorComplianceRisks` (existing PatientAlert +
  dedupe pattern); "NOA due within N days" StatCard + worklist on the intake tab; admin-only
  penalty estimate using `pdgmRates.js`.
- **2.2 Recert-window tracker** — derive 60-day certification periods from
  `Patient.admission_date`/SOC OASIS dates; a backend check (RISK block or sibling function)
  emits `PatientAlert`s when a patient enters day 56–60 without a completed recert OASIS/visit;
  surfaces free via existing alert consumers plus the OASIS Center assessment queue. A missed
  recert is a whole unbilled 30-day period.
- **2.3 LUPA visit-count tracker** — count delivered `Visit`s per patient per 30-day period vs the
  per-group threshold from 1.7; write `PDGMCaseMix` rows (`actual_visits`,
  `lupa_threshold_visits`, `is_lupa` — the entity finally gets a writer); worklist widget in
  `PredictiveAnalytics.jsx` beside the PPH worklist showing periods 1–2 visits short with days
  remaining. Ordered-vs-delivered adherence needs an ordered-frequency field — capture on the 2.5
  order entity (interim: on Patient).
- **2.4 OASIS transmission tracking** — add `transmitted_date`/`transmission_status` to
  `OASISAssessment.jsonc`; "mark transmitted" action in the OASIS Center Review tab;
  `monitorComplianceRisks` RISK block alerting at day 21+ post-M0090 (CMS 30-day rule). Cheap,
  pure compliance win.
- **2.5 Physician order / 485 tracking** — new `PhysicianOrder`/`PlanOfCare` entity (type:
  485/verbal/supplemental; order_date, sent_date, signed_date, physician_id → existing
  `Physician` directory). Reuse the **existing e-signature stack** (`DocumentSignature`,
  `ScheduledSignatureReminder`, `sendAutomatedSignatureReminders`, `SignerPortal` tokens) for
  physician signing, or the fax stack with `checkStaleFollowUpRequests`-style aging.
  Signature-turnaround KPI → `AgencyKPI`. An unsigned 485 is an unbillable claim, and order
  tracking is a CoP (§484.60) survey staple — this is also the gateway to Tier 3 claims work.
- **2.6 Referral-source master data + scorecard** — new `ReferralSource` entity (name, type,
  contacts, NPI); typeahead on the intake dialog's `referral_source` field with
  backfill-by-string-match; rewrite `ReferralVolumeReport.jsx` to compute real per-source
  turnaround via `computeTurnaround` (replacing the hardcoded "2.3d"/"Normal") plus
  conversion-to-SOC rate. This is where PDGM revenue *growth* (not just capture) comes from.
- **2.7 Unify ReferralTriage** — in `handleCreatePatientFromTriage`, create a `Referral` record
  alongside the Patient (reuse the payload shape at `DocumentToTriageMapper.jsx:130`; status
  `ready_for_admission`, linked `patient_id`, `document_type: 'manual'`). Trivial and
  load-bearing: without it, triage admissions are invisible to QA, follow-up, and every Tier 1
  measure.
- **2.8 Eligibility/insurance capture** — structured fields on `Referral` (`payer_type`, `mbi`,
  `medicare_advantage` flag, `eligibility_verified_by/at`); a pure `mbiValidator.js`
  (format/check-digit rules, node --test pattern like the other engines); a verification
  checklist step in `PatientVerificationStep.jsx`. Real-time 270/271 clearinghouse integration
  deferred to Tier 3. Catches the Medicare Advantage surprises the follow-up engine can only
  flag advisorily today.

---

## 5. Tier 3 — Strategic / longer-term

- **3.1 HHCAHPS integration (⭐, M–L).** HHCAHPS must be administered by a CMS-approved vendor, so
  build a vendor-file import: admin upload → parse → populate
  `PatientOutcomeMetric.patient_satisfaction_score` + monthly `AgencyKPI` rows; add the
  patient-survey star composite to the 1.2 dashboard. Risk: file-format variance across vendors.
- **3.2 Claims/billing activation (💰✅, XL, phased).** `Billing`/`Invoice`/`Payment`/
  `PatientBillingInfo` are schema-only today. Do **not** start with 837 generation — start with a
  per-30-day-period **"claim readiness" checklist** composing the records Tiers 1–2 create:
  NOA sent ✓, F2F valid ✓, 485 signed ✓, OASIS complete + transmitted ✓, eligibility verified ✓,
  LUPA status known ✓. That alone prevents most RTPs; EDI/clearinghouse comes after.
- **3.3 QAPI module (✅⭐, L).** CoP §484.65 requires a data-driven QAPI program. By this point the
  data exists (`ComplianceAudit`, `PatientAlert`, `AgencyKPI`, incidents, the unused
  `CorrectiveActionPlan` entity) — this is mostly assembly: QAPI project/PIP entity + dashboard.
- **3.4 Survey-readiness tooling (✅, M–L).** CoP-mapped checklist reusing the CFR citation
  vocabulary already throughout `defaultMedicareRules`/`requiredElements`; mock-survey report
  generator over ComplianceAudit/orders/OASIS data.

---

## 6. Recommended sequencing

| Sprint | Items | Theme |
|---|---|---|
| 1 | 1.1 + 2.7 → 1.4 → 1.6 → 1.5 | All wiring, referral-first; TIC measure live, F2F auditable, alerts running |
| 2 | 1.2 → 1.3 | Star dashboard visible; denial guardrail advisory |
| 3 | 1.7 → 2.1 → 2.4 | Real case-mix table; NOA clock; OASIS transmission |
| 4+ | 2.2 → 2.3 → 2.6 → 2.8 → 2.5 → Tier 3 | Recert, LUPA, source scorecard, eligibility, orders/485 |

Rationale: Sprints 1–2 finish already-tested engines (lowest risk, immediate ⭐/✅ movement,
starting from the referral process as the agency asked). 1.7 unlocks the real LUPA/revenue work.
2.5's signed-order trail is the prerequisite for any future claims activation.

## 7. Do not rebuild

Unchanged from `GROWTH_FEATURE_ROADMAP_2026-07.md` §6: the constrained SmartNote scribe +
grounding, the OASIS scrubber/scoring engine, `calculatePDGM` + the what-if suite, the Telnyx
stack, referral extraction + AI patient matching, training/LMS, telehealth, and the offline
capture queue are strong — every item above extends them.
