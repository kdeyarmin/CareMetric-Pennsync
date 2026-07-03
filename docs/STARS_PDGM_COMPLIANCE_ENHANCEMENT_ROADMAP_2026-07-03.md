# PennSync — Star Rating · PDGM Revenue · CMS Compliance Enhancement Roadmap

**Date:** 2026-07-03 (revised same day — see the revision note below)
**Type:** Full-app feature review + prioritized enhancement roadmap.
**Business goals (agency-stated):** (1) increase the Medicare Quality of Patient Care star rating,
(2) increase revenue under PDGM, (3) ensure the highest compliance with CMS regulations —
**"beginning from the referral process."**
**Relationship to other docs:** Complements — does **not** supersede —
[`GROWTH_FEATURE_ROADMAP_2026-07.md`](./GROWTH_FEATURE_ROADMAP_2026-07.md) (2026-07-01). Since that
roadmap was written, most of its engines were **built and unit-tested but never wired into the
running app** — this document verifies that state item by item (against code as of 2026-07-03) and
re-plans from here.

> **Revision (2026-07-03): rescoped for companion-EMR deployment.** PennSync runs **alongside the
> agency's EMR, not as a replacement** — so not every visit, order, claim, or assessment will be
> entered in this app. The first draft of this roadmap included deadline/absence trackers (NOA
> 5-day clock, recert-window alerts, LUPA visit counting, OASIS-transmission deadlines,
> 485/order-signature aging, claim-readiness). In a companion deployment those would raise open
> alerts for work that was completed — just in the EMR — creating a wall of false alarms that
> trains staff to ignore alerts. Those items are **removed** (kept on record in §7). Every
> surviving item obeys the design rule in §2.
>
> **Second revision (same day): enhance-existing orientation.** The agency is happy with the
> feature set and prefers **deepening what exists over inventing new surfaces**. This revision
> applies that lens: every item now lands inside an existing page, tab, panel, or report
> (e.g., star measures become a section of the existing OASIS Center Quality tab rather than a
> new tab; the referral-source scorecard becomes a fix to the existing Referral Volume Report,
> with the new master-data entity deferred). §5 now also folds in the goal-relevant subset of the
> existing enhancement backlog in
> [`FEATURE_ENHANCEMENT_REVIEW_2026-07-01.md`](./FEATURE_ENHANCEMENT_REVIEW_2026-07-01.md),
> instead of inventing a parallel list. Notable progress since 2026-07-01 that this revision
> verified and credits: quick-phrase expansion (`QuickPhraseTextarea.jsx`) and note→OASIS
> autofill (`NoteToOasisPrefill.jsx` in `SmartOASISAssessment.jsx`) are now live.

**Goals key:** ⭐ = QoPC star rating · 💰 = PDGM revenue · ✅ = CMS compliance
**Effort:** S = days · M = 1–2 wk · L = 2–4 wk (single developer, rough order of magnitude)

---

## 1. Executive summary

PennSync already captures nearly all the raw material the three goals need — the referral AI
extraction pulls F2F, insurance, SDOH, and OASIS pre-fill from the uploaded packet; diagnosis
sequencing is PDGM-aware at intake; the OASIS/PDGM analytics suite is deep; the Smart Note
compliance scrubber is genuinely strong. **The core finding of this review is that the last mile
never landed:** several flagship engines are fully built and unit-tested but are wired into
nothing, so the app computes (or could compute) the exact numbers that drive stars, revenue, and
compliance — and then discards them.

| Built-but-unwired engine | File | What it would deliver | Goal |
|---|---|---|---|
| Intake-to-SOC turnaround tracker | `src/components/referral/intakeToSocTracker.js` | Referral aging board + intake turnaround metric | ⭐✅ |
| Outcome-measure computation | `base44/functions/computeOutcomeMeasures/entry.ts` | 5 improvement measures + GG discharge function score → `AgencyKPI` | ⭐ |
| Star-metric display | *(no consumer exists)* | Nothing anywhere reads `AgencyKPI` or `PatientOutcomeMetric` | ⭐ |
| Denial guardrail | `src/components/compliance/denialGuardrailEngine.js` | Pre-save check on the top denial clusters | ✅💰 |
| F2F persistence | `toFaceToFaceEncounter` in `faceToFaceValidator.js` | An auditable `FaceToFaceEncounter` record (validation today is in-memory only) | ✅💰 |
| HIPPS / case-mix grouper | `src/components/pdgm/pdgmGrouper.js` + `caseMixWeightsLoader.js` | HIPPS codes + official case-mix weights for revenue analysis (needs the CMS weight CSV) | 💰 |
| Comorbidity reconciler | `src/components/oasis/comorbidityReconciler.js` | Missed comorbidity-adjustment capture during coding | 💰 |

Because the engines and (in most cases) the entity schemas already exist, **Tier 1 of this roadmap
is mostly wiring, not building** — low-risk, days-to-weeks each, and it starts exactly where the
agency asked: the referral process, which lives entirely inside PennSync.

Two defects found during review are called out because they silently corrupt the referral metrics
this roadmap creates:

- **`ReferralTriage.jsx` creates Patients with no `Referral` record** (`handleCreatePatientFromTriage`,
  lines 30–78) — those admissions are invisible to the intake queue, follow-up QA, volume report,
  and every turnaround denominator. Fix bundled into Tier 1 (item 2.7 executed with 1.1).
- **`ReferralVolumeReport.jsx` shows hardcoded metrics** — "Avg Processing Time 2.3d" is a string
  literal (line 111) and the per-source "Avg Priority" badge always renders "Normal" (line 187).

---

## 2. The companion-EMR design rule

PennSync is used **in conjunction with the agency's EMR**. That splits the data world in two:

**PennSync fully owns** (complete by construction, safe to measure and alert on):
- The referral pipeline — uploads, extraction, processing, follow-up requests, dispositions
- Documents created in-app — Smart Notes, in-app OASIS assessments, faxes sent from here
- Data explicitly imported by an admin (e.g., a vendor survey file)

**The EMR owns** (PennSync sees only a partial, best-effort copy):
- Visit schedules and the complete record of delivered visits
- Claims, billing, NOA submission
- 485s / physician orders and their signatures
- Recertification scheduling and completion
- OASIS transmission to iQIES
- The authoritative census (admissions/discharges)

**The rule every roadmap item must obey:**

1. **Never alert on the *absence* of EMR-owned data.** A missing visit, recert, NOA, signature,
   or transmission record in PennSync usually means "it's in the EMR," not "it wasn't done."
2. **Act at the moment of work performed in-app** (a note being saved, a referral being
   processed) — those checks are always valid because the artifact is right here.
3. **Dashboards over in-app data are fine, alerts are not** — and every dashboard must label its
   coverage ("based on N episodes documented in PennSync"), because in-app data is a sample, not
   the census.

Consequence: PennSync's lane in this partnership is **referral-side operational excellence,
documentation quality at the point of creation, and revenue/quality *analysis*** — while the EMR
remains the system of record for scheduling, billing, and official CMS reporting.

---

## 3. App review by goal

### A) Star rating (Quality of Patient Care)

**Exists and wired:** OASIS Center hub (`src/pages/OASISCenter.jsx`) with SmartOASIS assessment,
scoring engine (`oasisScoringEngine.js`), validation stack; PPH rehospitalization-prevention
worklist (`pphWorklistEngine.js`, wired into `PredictiveAnalytics.jsx`).

**Built but dead:** `computeOutcomeMeasures` pairs Discharge↔SOC/ROC OASIS and computes the five
QoPC improvement measures (M1860 ambulation, M1850 bed transfer, M1830 bathing, M1400 dyspnea,
M2020 oral meds) plus the GG discharge function score, with CMS-style exclusions and the
20-episode / 5-of-7-measure star-eligibility floors (`STAR_MIN_EPISODES`, `STAR_MIN_MEASURES` in
`outcomeMeasureEngine.js`). It writes `PatientOutcomeMetric` and `AgencyKPI` rows — but its
frontend invoker (`src/functions/computeOutcomeMeasures.js`) has zero callers, no platform schedule
is documented for it, and **no frontend file reads `AgencyKPI` or `PatientOutcomeMetric`**. The
same is true of the intake-to-SOC tracker.

**Not built (and, post-revision, intentionally so):** HHCAHPS capture beyond an import hook
(surveys are vendor-administered; see §6); a hospitalization/ED data feed (EMR/claims-owned).

### B) PDGM revenue

**Exists and wired:** `calculatePDGM` (`base44/functions/calculatePDGM/entry.ts`) — clinical group,
functional-impairment level, comorbidity adjustment, timing, admission source → estimated 30-day
payment, with server-side financial gating; deterministic PDGM diagnosis sequencing at intake
(`diagnosisCodeGenerator.js`, persisted to `Referral.diagnosis_coding` with RTP badges in the
queue); comorbidity reconciler (`comorbidityReconciler.js`); the large admin PDGM analytics suite
(navigator, trend, scenario/what-if, revenue comparison); rate config (`PDGMRateSettings.jsx` /
`PDGMRateConfig`).

**Built but dead:** the table-driven HIPPS grouper (`pdgmGrouper.js`) and CMS case-mix CSV loader
(`caseMixWeightsLoader.js`) — explicitly reference-only until fed the CMS weight file, which the
repo doesn't ship; the aggregate front-door diagnosis guard
(`validateIntakeDiagnoses`/`previewClinicalGroup` in `intakeDiagnosisValidator.js`) at the
upload/quick-scan moment (note: per-code RTP screening *does* fire during full processing via
`diagnosisCodeGenerator.js`).

**Out of scope in companion mode:** live LUPA tracking against delivered-visit counts, NOA
timeliness, claims/billing workflows — all depend on EMR-owned data (see §7). PennSync's revenue
lever is **getting the documentation right at intake and at the point of note-writing** (the
inputs to the EMR's billing), plus admin-side revenue analysis.

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

**Built but dead:** `denialGuardrailEngine.js` (denial-cluster pre-save scoring — imported only by
its test); F2F persistence (`toFaceToFaceEncounter` never called; no `FaceToFaceEncounter.create`
exists — F2F status is recomputed in memory per view and the intake queue's Process-dialog path
never displays it at all).

**A caution, not a to-do:** `base44/functions/monitorComplianceRisks/entry.ts` exists but is
unscheduled — and in companion mode **that is the correct state for most of its rules**, which are
absence-based (no visit in 7 days, missing vitals, missing Discharge OASIS, a LUPA visit-count
heuristic that is additionally wrong — the pre-PDGM "4 visits per 60-day episode" rule at
`entry.ts:218`). See item 1.6.

---

## 4. Tier 1 — Wire what's already built (companion-safe)

Every item here finishes tested code and operates only on data PennSync fully owns.
Line references verified 2026-07-03.

### 1.1 Referral SOC completion + intake aging board — ⭐✅ · S–M · **do first**

The agency's "begins from the referral process" priority. Today no referral ever records an SOC
date; referrals terminate at `ready_for_admission` and pile up in the queue forever. The
`Referral` schema already has `soc_date`, `first_visit_date`, `soc_completed_by`, and the
`soc_completed` status — only writes and UI are missing.

**Companion-mode framing:** this is **intake-queue lifecycle management**, not compliance
alerting. Closing a referral (marking SOC complete or declined) is the intake coordinator's
normal workflow *in this app* — the same place they already process the referral. The aging board
lives on the intake pages only and never generates `PatientAlert`s. The turnaround number is
presented as an **operational intake metric** ("referral-to-SOC turnaround for referrals processed
in PennSync"), not as the official CMS Timely Initiation measure — official measure reporting
stays with the EMR.

- **"Mark SOC Complete" action** in the `ReferralIntake.jsx` actions cell (`ready_for_admission`
  branch, ~line 1326): dialog with SOC-date picker (defaults today) + optional first-visit date,
  calling `Referral.update(id, markStartOfCareCompleted(referral, { socDate, by: user.email }))`.
  Add `soc_completed` to the status filter (~line 1113) and `getStatusColor` (line 1024).
- **Auto-complete hooks (positive evidence only):** after a Start-of-Care `OASISAssessment.create`
  in `SmartOASISAssessment.jsx:247` and `OASISQuickUpdate.jsx:64`, look up the open referral by
  `patient_id` and apply the same update, non-blocking try/catch (mirror the diagnosis-coding
  pattern at `ReferralIntake.jsx:483–493`). These fire on work actually done in-app — never on
  absence.
- **Aging board:** new `src/components/referral/ReferralAgingBoard.jsx` rendering
  `buildAgingBoard(referrals)` (on-track / due-soon / overdue, oldest first); mount below the
  StatCards on the intake tab and as a sidebar card on `ReferralFollowUp.jsx` (already loads the
  same referrals under queryKey `['referrals']` — zero extra fetches). "Overdue" here reads as
  "still open in the intake queue" — a prompt to either complete or close it, which keeps the
  board honest by construction.
- **Turnaround metric:** compute `rollupTimelyInitiation` live where displayed (1.2 / 2.6),
  always with the denominator shown ("of N referrals closed in PennSync").
- **Ship 2.7 in the same sprint** (it is S) so triage-path admissions stop bypassing the queue.

### 1.2 Outcome measures in the existing Quality tab + schedule `computeOutcomeMeasures` — ⭐ · M

**Companion-mode framing:** a **dashboard, not an alert stream**, computed over episodes that have
both SOC and Discharge OASIS **documented in PennSync**. It is an early-warning and coaching view
of the same improvement measures CMS builds the QoPC star from — not a replica of the official
star, which CMS computes from the EMR's submissions. Coverage labeling is a first-class design
element, not a footnote.

- **Trigger:** register a nightly platform schedule for `computeOutcomeMeasures` on the Base44
  dashboard (the `x-internal-secret` pattern documented in
  [`LEARNING_CENTER_SCHEDULED_JOBS.md`](./LEARNING_CENTER_SCHEDULED_JOBS.md); add it to that doc's
  table). Add an admin "Recompute now" button using the existing
  `src/functions/computeOutcomeMeasures.js` invoker. The function only *reads* in-app OASIS rows
  and writes metric rows — it alerts no one, so partial coverage cannot create false alarms.
- **Dashboard — inside the existing Quality tab, not a new tab:** `OASISCenter.jsx`'s Quality tab
  (lines 168–183) already renders two titled sections ("Compliance Review", "Documentation
  Review"); add an admin-gated third section, **"Outcome Measures"**, above them. Content: the
  five improvement measures + GG discharge function score from `AgencyKPI`
  (`metric_category: 'quality'`); episode counts front and center ("based on N complete episode
  pairs documented in PennSync"); the 20-episode / 5-measure floors shown as context for how CMS
  reads the same math; intake turnaround from 1.1; per-measure trend vs `benchmark_value`.
  Secondary surface: summary card in the existing `KPIDashboard.jsx` linking to
  `/OASISCenter?tab=quality`.
- **Incomplete pairs** (SOC here, no discharge here) appear as a **data-coverage note on the
  dashboard** — never as patient-level alerts, since the discharge assessment most likely lives
  in the EMR.
- Verify `AgencyKPI`/`PatientOutcomeMetric` RLS read rules admit admins before shipping.

### 1.3 Denial guardrail in the Smart Note save path — ✅💰 · M

~51% of home-health improper payments trace to insufficient documentation. This is the purest
companion-safe check in the roadmap: it examines **the note being written in this app, at the
moment of saving it** — nothing absence-based about it.

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
  notes — and only as **positive** evidence ("F2F on file is out-of-window"), never "no F2F record
  exists," since the encounter may be documented in the EMR.
- **Risk:** heuristics will false-positive on some legitimate narratives — ship advisory, measure,
  tighten. Keep out of the offline path initially.

### 1.4 Persist `FaceToFaceEncounter` — ✅💰 · S

F2F is a top auto-reject denial cause; today its validation result is discarded after render.
Companion-safe: it operates on **the referral document uploaded here**, and the queue badge
reports what was found in that document — "not found in referral packet" is a statement about the
packet (grounds for the existing provider follow-up request), not a claim that no F2F happened.

- In `ReferralIntake.jsx` `handleProcessingComplete` (after the `Referral.update` at line 774):
  `referralToF2FInput(...)` → `validateFaceToFace(...)` → `toFaceToFaceEncounter(...)` →
  dedupe by `FaceToFaceEncounter.filter({ referral_id })`, then create-or-update. Same
  non-blocking try/catch pattern as diagnosis coding.
- Surface `validation_status` as a badge in the referral queue row — the queue's Process-dialog
  path currently never shows F2F at all (only the `?tab=process` ReferralAnalyzer flow does).
- `ReferralFollowUp` already generates the provider request when F2F is missing/invalid from the
  packet — no change needed there.

### 1.5 Front-door diagnosis guard at upload — 💰 · S

Per-code RTP screening already fires during full processing; what's missing is the aggregate
check at the **upload/quick-scan moment**, before staff invest in processing. Self-contained to
the document in hand.

- After `runReferralQuickScan` populates the form (`ReferralIntake.jsx:196`), run
  `validateIntakeDiagnoses({ primary, secondaries })` + `previewClinicalGroup` from
  `intakeDiagnosisValidator.js`; render an inline Alert with findings and the clinical-group
  preview. Guard the no-codes case so free-text-only extractions don't nag.

### 1.6 Companion-mode alert hygiene in `monitorComplianceRisks` — ✅ · S

The first draft of this roadmap recommended scheduling this cron. **In companion mode, do not
schedule it as-is** — most of its rules are absence-based over EMR-owned data and would flood the
alert bell with false open items:

- RISK 1 (high-risk dx with no visit in 7 days) and the missing-vitals rule assume all visits are
  in PennSync — they are not. **Strip or gate behind an explicit "PennSync is our full visit
  record" agency setting** (`AgencySettings`), default off.
- RISK 4 (LUPA) is doubly wrong: absence-based *and* built on the pre-PDGM "4 visits per 60-day
  episode" rule (`entry.ts:218`). **Remove the alert**; LUPA economics live in the admin analysis
  view (1.7) as reference information instead.
- The missing-Discharge-OASIS rule (star-eligibility enforcer) assumes discharge assessments are
  done here — surface this as the **coverage note on the 1.2 dashboard**, not as patient alerts.

What remains schedulable is anything keyed to in-app artifacts only; if nothing qualifies after
the strip, leave the function unscheduled and keep this as documented rationale.

### 1.7 Load CMS case-mix weights → HIPPS revenue analysis — 💰 · M–L

**Companion-mode framing:** an **admin analysis tool**, not a billing engine and not a visit
tracker. It answers "given the diagnoses and OASIS we documented, what HIPPS/weight does this
support, and what documentation would support better?" — all computed from in-app data.

- Follow [`PDGM_CASE_MIX_WEIGHTS.md`](./PDGM_CASE_MIX_WEIGHTS.md): admin CSV-upload UI in
  `PDGMRateSettings.jsx` ingesting the official CMS 432-group file via `caseMixWeightsLoader.js`,
  persisted with payment-year stamping; show the loader's unmappable-row report to the admin.
- Consume in an **admin-only reconciliation view** (OASIS Center Revenue tab or
  `DocumentationImpact.jsx`): HIPPS code and case-mix weight rendered beside the `calculatePDGM`
  estimate. Per-group LUPA thresholds may display as **reference information** on the same view
  (they come from the same CSV) — but no visit counting and no LUPA alerts (see §7). Honor the
  grouper header's warning — `calculatePDGM` remains the single payment figure shown to staff;
  grouper output is labeled HIPPS/what-if until formally reconciled. Financials stay behind
  `canViewFinancials`.

### 1.8 Wire the comorbidity reconciler into the existing coding flow — 💰 · S–M

`src/components/oasis/comorbidityReconciler.js` (built, tested, imported only by its test)
compares OASIS-documented conditions against the coded secondary-diagnosis list to catch missed
comorbidity adjustments — a direct per-episode case-mix uplift on documentation the nurse already
wrote. Surface its findings as a panel inside the existing PDGM coding surfaces (the
`AutomatedPDGMNavigator.jsx` comorbidity section and/or the referral `DiagnosisCodeGenerator.jsx`
card) — no new page, purely a smarter version of screens coders already use.

---

## 5. Tier 2 — Deepen existing surfaces

*(Numbering preserved from the first draft so removed items — 2.1–2.5 — remain traceable in §7.)*

### Referral pipeline (fully in-app data)

| # | Feature | Goals | Effort | Depends on |
|---|---|---|---|---|
| 2.6 | Real metrics in the existing Referral Volume Report | 💰 | S | 1.1 |
| 2.7 | Unify ReferralTriage into the pipeline | ⭐✅ | S | ship with 1.1 |
| 2.8 | Eligibility checks inside the existing intake verification step | 💰 | S–M | — |

- **2.6 Real metrics in the existing Referral Volume Report** — replace
  `ReferralVolumeReport.jsx`'s hardcoded values ("2.3d" avg processing at line 111; the literal
  "Normal" per-source priority badge at line 187) with real computed numbers: per-source
  turnaround via `computeTurnaround` (from 1.1's SOC dates), actual priority mix, and
  conversion-to-SOC rate. Referrals live entirely in PennSync, so this scorecard is accurate by
  construction — and it is where PDGM revenue *growth* (not just capture) comes from.
  *Deferred (new-surface):* a `ReferralSource` master-data entity with intake typeahead would fix
  the free-text-source fragmentation ("same referrer, five spellings") — revisit only if the
  report's string-grouped numbers prove too noisy to act on.
- **2.7 Unify ReferralTriage** — in `handleCreatePatientFromTriage`, create a `Referral` record
  alongside the Patient (reuse the payload shape at `DocumentToTriageMapper.jsx:130`; status
  `ready_for_admission`, linked `patient_id`, `document_type: 'manual'`). Trivial and
  load-bearing: without it, triage admissions are invisible to QA, follow-up, and every intake
  metric. A fix to an existing flow, not a new one.
- **2.8 Eligibility checks inside the existing verification step** — `PatientVerificationStep.jsx`
  already exists as the intake confirmation moment; add payer/MBI confirmation to it: MBI
  format/check-digit validation (pure `mbiValidator.js`, node --test pattern like the other
  engines) run against the already-extracted `insurance_primary`/`policy_numbers`, and a
  Medicare-Advantage flag surfaced from the extraction the AI already performs. Validates what
  is already captured, at the moment it's captured — no new workflow, no absence-based alerting.
  Real-time 270/271 clearinghouse integration stays out of scope.

### Goal-relevant items from the existing enhancement backlog

[`FEATURE_ENHANCEMENT_REVIEW_2026-07-01.md`](./FEATURE_ENHANCEMENT_REVIEW_2026-07-01.md) already
catalogs 202 enhancement opportunities in existing features (45 of them bugs), with many shipped.
Rather than inventing new analysis, this roadmap adopts the not-yet-implemented subset that
directly serves the three goals — all of them changes **inside screens staff already use**:

| Backlog item (existing surface) | Why it matters here | Goals | Effort |
|---|---|---|---|
| **Assessment-reason (RFA) selector in `SmartOASISAssessment.jsx`** — save currently hardcodes `visit_type: 'Start of Care'` (line 248) | **Load-bearing for 1.2:** outcome measures pair SOC↔Discharge assessments; if every in-app assessment saves as SOC, `computeOutcomeMeasures` can never pair an episode. Fix before or with 1.2 | ⭐✅ | S |
| **OASIS draft autosave + "required items still blank" pre-save checklist** (`SmartOASISAssessment.jsx`) | Fewer abandoned/incomplete assessments → more complete episode pairs for the measures; less rework | ⭐✅ | M |
| **Carry the "not documented" gap list into the saved note + exported PDF** (Smart Note; `findings: []` dead code today) | A faxed/printed note shows exactly which Medicare-required elements are missing — the denial-prevention story on paper, where reviewers actually read it | ✅ | M |
| **Critical-vital alerting on structured grid vitals in Step 1** (Smart Note) | Grid-entered critical BP/O2/HR currently bypasses the notify-physician prompt that note text triggers | ✅ | M |
| **`DocumentationImpact.jsx` uses national CY2026 defaults + wage index 1.0 even after agency rates are saved** | The ROI simulator and the OASIS analyzer show different dollars for the same scenario — fix makes the existing revenue tool trustworthy | 💰 | M |
| **PDGM Rate Settings safety rails** — unsaved-changes guard, confirm + provenance before overwriting official rates, plausibility validation on rate cells, ICD-prefix collision validation | These numbers drive every payment estimate; today a typo or accidental overwrite silently corrupts them agency-wide | 💰✅ | M |
| **Replace `window.prompt` reject / free-text edit in OASIS Review with a proper dialog + code dropdown** | Reviewers can't save an invalid OASIS response code; the reject reason becomes a usable audit trail | ✅ | M |
| **`PDGMReimbursementReport.jsx` shows self-labeled illustrative dollars** | Either feed it real per-patient PDGM data or move the illustrative framing into the report body — an admin skimming it today can mistake placeholders for actuals | 💰 | S–M |

One backlog item is **rejected under the §2 companion-EMR rule rather than fixed**: the
Dashboard's "No visit in N days" alert (the backlog proposes fixing its today-only data feed).
In companion mode the fix would make it *fire* — wrongly, for every visit documented in the EMR.
Remove or setting-gate it instead (fold into 1.6).

---

## 6. Tier 3 — Strategic (rescoped to imports and in-app data)

- **3.1 HHCAHPS vendor-file import (⭐, M–L).** HHCAHPS is administered by a CMS-approved vendor,
  so the data enters PennSync **only by explicit admin import** — accurate by construction, no
  absence semantics. Admin upload → parse → populate
  `PatientOutcomeMetric.patient_satisfaction_score` + monthly `AgencyKPI` rows; add the
  patient-survey composite to the 1.2 dashboard with the same coverage labeling. Risk:
  file-format variance across vendors.
- **3.3 Documentation-quality QAPI views (✅, L).** CoP §484.65 requires a data-driven QAPI
  program. PennSync can contribute the slice it truly owns: trends from `ComplianceAudit` (note
  compliance scores, denial-risk findings from 1.3), intake turnaround (1.1), F2F packet
  completeness (1.4), and referral follow-up resolution — packaged as exportable QAPI evidence
  the agency combines with EMR data in its program. Scoped as dashboards/exports; no PIP
  workflow tracking unless the agency later decides to run QAPI projects in PennSync.
- **3.4 Survey-readiness documentation reports (✅, M–L).** A CoP-mapped self-audit view over
  **in-app documentation only**, reusing the CFR citation vocabulary already throughout
  `defaultMedicareRules`/`requiredElements`: e.g., "notes written in PennSync this quarter, by
  CoP citation, with open compliance issues." Explicitly labeled as covering PennSync-authored
  documentation, not the full clinical record.

*(3.2 claims activation removed — see §7.)*

---

## 7. Removed in the companion-EMR revision

Recorded so the reasoning survives; each of these would alert on the absence of data the EMR owns,
producing standing false alarms in a companion deployment. If the agency ever migrates these
workflows into PennSync (or builds an EMR data feed), items here are re-candidates — the first
draft of this document (git history) contains their full implementation sketches.

| Removed item | Why it fails the §2 rule |
|---|---|
| 2.1 NOA 5-day tracker | NOA submission happens in the EMR/billing system; an "NOA overdue" alert here is usually wrong |
| 2.2 Recert-window tracker (day 56–60) | Recert visits/assessments are scheduled and documented in the EMR |
| 2.3 LUPA visit-count tracker | Requires the complete delivered-visit record, which PennSync does not have |
| 2.4 OASIS 30-day transmission tracking | Transmission to iQIES happens from the EMR |
| 2.5 Physician order / 485 signature tracking | Orders live in the EMR; "unsigned 485" alerts would mostly be false. *Conditional exception:* if the agency chooses to route order signatures through PennSync's existing e-sign/fax stack, tracking those specific documents is companion-safe — revisit only on that explicit workflow decision |
| 3.2 Claim-readiness checklist / billing activation | Composes the trackers above; claims are EMR-owned end to end |
| Scheduling `monitorComplianceRisks` as-is | Most rules are absence-based over visits/assessments (see 1.6, which replaces this with a strip-and-gate task) |
| Visit frequency adherence (ordered vs delivered) | Same delivered-visit dependency as LUPA |

---

## 8. Recommended sequencing

| Sprint | Items | Theme |
|---|---|---|
| 1 | 1.1 + 2.7 → 1.4 → 1.5 → 1.6 → 2.6 | Referral pipeline complete: SOC lifecycle, aging board, F2F on file, dx guard, alert hygiene, honest volume report |
| 2 | RFA selector → 1.2 → 1.3 | Fix the SOC-hardcoding so episodes can pair; outcome measures in the existing Quality tab; denial guardrail advisory on every in-app note |
| 3 | 1.7 → 1.8 → DocumentationImpact rates fix → PDGM Rate Settings safety rails | Revenue: official weights, comorbidity capture, trustworthy ROI tooling |
| 4 | Remaining §5 backlog items (OASIS autosave/checklist, note-PDF gap list, grid-vitals alerting, review dialog, reimbursement-report labeling) → 2.8 | Documentation quality deepening inside existing screens |
| 5+ | 3.1 → 3.3 → 3.4 | HHCAHPS import; QAPI evidence exports; survey-readiness reports |

Rationale: Sprints 1–2 finish already-tested engines (lowest risk, immediate ⭐/✅ movement,
starting from the referral process — the workflow PennSync fully owns). The RFA selector rides
ahead of 1.2 because outcome measures cannot pair episodes while every assessment saves as
"Start of Care." Everything downstream deepens existing screens — no new pages or entities
anywhere in Sprints 1–4.

## 9. Do not rebuild

Unchanged from `GROWTH_FEATURE_ROADMAP_2026-07.md` §6: the constrained SmartNote scribe +
grounding, the OASIS scrubber/scoring engine, `calculatePDGM` + the what-if suite, the Telnyx
stack, referral extraction + AI patient matching, training/LMS, telehealth, and the offline
capture queue are strong — every item above extends them.
