# Growth Feature Roadmap — PennSync by CareMetric

**Date:** 2026-07-01
**Type:** Product / business roadmap (revenue · star ratings · documentation speed & compliance ·
office coordination).
**Relationship to other docs:** Complements — does **not** supersede — the engineering roadmap in
[`APP_IMPROVEMENT_ROADMAP_2026-06.md`](./APP_IMPROVEMENT_ROADMAP_2026-06.md) and the nurse-workflow
review in [`NURSE_APP_IMPROVEMENTS.md`](./NURSE_APP_IMPROVEMENTS.md). Those cover code health,
security, and clinical-safety fixes. **This doc covers net-new / conversion features that grow the
business.** Where they overlap (e.g. offline notes, vital escalation), this doc defers to them.

---

## 1. Executive summary

PennSync is a large, mature platform (~180 backend Deno functions, ~200 Base44 entities, 124
pages). It is genuinely strong at the constrained AI **SmartNote scribe** (write→verify with
anti-fabrication grounding), the **OASIS scrubber + scoring engine**, the **PDGM case-mix
estimation engine**, **Telnyx fax/SMS/voice**, **referral intake + AI patient matching**, the
**training/LMS**, **telehealth**, and **offline capture**.

**The core finding: the app already captures the raw material for all four business goals but
never converts it into the outputs that move the business.** Several assets are built and then
discarded. Verified against current code (2026-07-01):

| Latent asset | State today | Consequence |
|---|---|---|
| `PatientOutcomeMetric` entity (models ambulation/bathing/transfer/oral-meds improvement + readmission/ER) | **Dead** — zero reads/writes anywhere | The single most direct star-rating input is collected then discarded; SOC and Discharge OASIS are never paired into change scores |
| `PDGMCaseMix.is_lupa` / `lupa_threshold_visits` / `actual_visits` | Fields exist, **no engine populates them** | The only LUPA logic (`monitorComplianceRisks` RISK 4) uses the *wrong, pre-PDGM* rule ("4 therapy visits in a 60-day episode") |
| `expandClinicalPhrase` + full phrase-library UI | Backend + authoring UI exist, **no trigger in any note editor** | The biggest advertised documentation-speed feature is unreachable at the point of care |
| `mapNoteToOASIS` (verbatim-evidenced, confidence-scored M-item suggestions) | Exists, **never pre-fills the OASIS form** | Nurses re-enter ambulation/dyspnea/meds/pain/wounds by hand |
| `OfflineVisitNoteCapture` | Plain free-text, **bypasses the compliance stack** | Notes reach the chart with no required-element scan / grounding — exactly when nurses (WiFi-dead homes) need it most |
| `Referral.status` | Ends at `ready_for_admission`, **no SOC timestamp** | Intake→start-of-care timeliness (a star process measure) cannot be computed |
| Face-to-Face encounter | **No entity or check anywhere** (appears only in help text) | A top auto-reject denial cause is caught nowhere |

**This roadmap is scoped to 11 curated features**, in three tiers, chosen to weight star ratings,
documentation speed/compliance, and office coordination first, with revenue second. **Most are
wiring and conversion, not greenfield** — they extend the assets above rather than replacing the
strong surfaces the app already has (see [§6, Do Not Rebuild](#6-do-not-rebuild)).

### The 11 features at a glance

| # | Feature | Goal(s) | Priority | Effort |
|---|---|---|---|---|
| 1 | OASIS Outcome-Measure Engine | Star | P0 | L |
| 2 | Discharge-OASIS completion enforcer | Star | P0 | S |
| 3 | Quick-phrase expansion in the note editor | Docs speed | P0 | M |
| 4 | Note → OASIS autofill | Docs speed | P0 | M |
| 5 | Compliance flow for offline capture | Docs compliance | P0 | M |
| 6 | Timely Initiation of Care / Intake-to-SOC tracker | Star + Office | P1 | M |
| 7 | Deterministic denial-reason guardrail engine | Docs compliance + Revenue | P0–P1 | L |
| 8 | Face-to-Face validator — **referral analyzer only** | Docs + Revenue | P1 | M |
| 9 | PPH rehospitalization-prevention worklist | Star | P0 | L |
| 10 | Front-end diagnosis validation | Revenue | P1 | M |
| 11 | Comorbidity capture assistant | Revenue | P1 | L |

Effort: S (days) · M (1–2 wk) · L (2–4 wk) · XL (>1 mo), single-developer rough order of magnitude.

---

## 2. Regulatory context (2025–2026)

Stated as dated rationale for the picks — **not** as claims about current code. Confirm against
the CMS source before building.

- **Expanded HHVBP** adjusts Medicare FFS payment by up to **±5%** off a 0–100 **Total Performance
  Score** (achievement *or* improvement points, whichever is higher, per measure). CY2026 category
  weights are roughly **OASIS-based 40% / claims-based 40% / HHCAHPS 20%**.
- **Within-Stay Potentially Preventable Hospitalization (PPH)** is the highest-weighted claims
  measure (**~26%**), having replaced the 60-day acute-care-hospitalization measure; **Discharge to
  Community – PAC (DTC-PAC)** tracks a 31-day post-discharge window.
- The **Quality of Patient Care (QoPC) star** is built from ~7 measures, ~5 of which are the
  OASIS-based functional/symptom improvement outcomes (ambulation, bed transfer, bathing, dyspnea,
  management of oral medications), plus **Timely Initiation of Care** (the one process measure) and
  utilization. A measure needs **≥20 complete quality episodes**, and an agency needs **≥5 of 7
  measures** to receive a star.
- **~51%** of home-health improper payments trace to *insufficient documentation*; the recurring
  denial clusters are medical necessity / skilled need, **Face-to-Face encounter**, cert/recert
  completeness, and physician signature. The **F2F encounter** must occur **90 days before or 30
  days after** SOC, be performed by an eligible certifying practitioner, and relate to the primary
  home-health diagnosis (42 CFR 424.22 / the Conditions of Participation).

---

## 3. Tier 0 — Foundational quick wins

### 3.1 OASIS Outcome-Measure Engine — *P0 · Star · the keystone*

**Problem.** The five QoPC/HHVBP OASIS outcome measures and the HHVBP Discharge Function Score are
all **change scores** computed by pairing the Start/Resumption-of-Care OASIS with the Discharge
OASIS. PennSync captures the raw M-items and `OASISAssessment.visit_type` already enumerates
`Start of Care` / `Resumption of Care` / `Discharge`, but **nothing pairs SOC↔Discharge**, applies
denominators/exclusions, or writes a result. `PatientOutcomeMetric` models exactly these primitives
(`functional_improvement.{ambulation,bathing,transferring,medication_management}_improved`) yet is
**dead code**. The most direct star input is collected and discarded.

**What to build.** A deterministic engine (mirroring the pure/offline `oasisScoringEngine.js`
pattern) that, on Discharge-OASIS completion: locates the matching SOC/ROC `OASISAssessment` for the
same patient/episode; computes per-measure improvement (discharge value better than SOC) for
ambulation (**M1860**), dyspnea (**M1400**), oral-meds (**M2020**) — all already modeled in the
engine's `RULES` — plus bathing (**M1830**) and bed-transferring (**M1850**), which the engine does
**not** yet model and must be added; derives the GG-based Discharge Function Score; applies CMS
denominators/exclusions (e.g. exclude deaths, patients already at best score); and writes a
completed `PatientOutcomeMetric` row. Add a lightweight `episode` linkage (the SOC assessment id) to
the discharge assessment. Roll results into `AgencyKPI` rows (`metric_category: 'quality'`) per
measure so agency-level improvement rates exist for the first time. Keep it deterministic-first
(AI only labels), consistent with the app's anti-fabrication posture.

**Existing hooks.** `src/components/oasis/oasisScoringEngine.js` (evaluate pattern + M-item `RULES`
trigger map — already includes the M1860/M1400/M2020 triggers; bathing M1830 and bed-transferring
M1850 are **not** in `RULES` and must be added); `base44/entities/OASISAssessment.jsonc`
(`visit_type`, `oasis_items[]`); `base44/entities/PatientOutcomeMetric.jsonc` (the dead
`functional_improvement.*_improved` fields to wire up); `base44/entities/AgencyKPI.jsonc`
(`metric_category`, `benchmark_value`); `src/components/oasis/oasisScoringEngine.test.js` as the
deterministic-unit-test pattern.

**Impact.** Produces ~5 of the 7 QoPC-star inputs and ~40% of the HHVBP score from already-captured
M-items. **Foundational** — features 2 and 9 read these rows.

### 3.2 Discharge-OASIS completion enforcer — *P0/S · Star*

**Problem.** Improvement measures only count when a Discharge OASIS pairs with the SOC OASIS. A
missed/unplanned discharge assessment erases demonstrated improvement and can drop the agency below
the 20-episode / 5-of-7-measure thresholds needed to even receive a star. There is no episode-timing
framework and no rule for "open episode without a discharge OASIS."

**What to build.** Extend the existing `monitorComplianceRisks` scheduled cron with an
episode-completeness rule: for each patient with a SOC/ROC `OASISAssessment` and a discharge event
(`Visit.visit_type='discharge'`, discharge disposition set, or 60-day recert boundary) but no
matching Discharge `OASISAssessment`, raise a `PatientAlert` ("Discharge OASIS required to capture
outcome") and surface an episode-tracker tile showing complete quality episodes per measure vs the
20-episode threshold. Reuse the cron's existing service-role patient walk + alert-creation.

**Existing hooks.** `base44/functions/monitorComplianceRisks/entry.ts` (patient walk, alert
pattern); `base44/entities/{OASISAssessment,Visit,PatientAlert,PatientOutcomeMetric}.jsonc`.

**Impact.** Protects star *eligibility* and prevents silent loss of demonstrated improvement.
Low-effort guardrail; pairs with §3.1.

### 3.3 Quick-phrase expansion in the note editor — *P0/M · Docs speed*

**Problem.** The biggest advertised speed feature is unreachable at the point of care.
`expandClinicalPhrase`, the `ClinicalLibraryTemplate`/`SharedPhraseLibrary` entities, and the full
authoring/analytics UI all exist — but **no note textarea has an inline trigger**, so nurses can
author phrases but can't invoke them while charting. `usage_count` is collected but the writing
surface never benefits.

**What to build.** An inline expansion trigger in the SmartNote textarea: a `/`-slash menu and a
dot-token pattern (e.g. `.diabeticedu`) detected on input. On trigger, call `expandClinicalPhrase`,
insert the returned `expandedText` at the cursor, and let the backend increment `usage_count`.
Surface the top phrases for the current diagnosis/visit type by sorting the nurse's
`ClinicalLibraryTemplate` records by `usage_count`. **Anti-fabrication preserved:** inserted text
becomes note content and therefore flows through the same constrained-scribe review
(`ConstrainedNoteReviewer` + `valueGuard`) before save — expanded text is treated as nurse-authored
input, not AI-verified output.

**Existing hooks.** `base44/functions/expandClinicalPhrase/entry.ts` (template lookup + AI fallback
+ `usage_count` increment); `base44/entities/ClinicalLibraryTemplate.jsonc`;
`src/pages/SmartNoteAssistant.jsx` (textarea ref + note state);
`src/components/smartNote/ConstrainedNoteReviewer.jsx` + `src/components/smartNote/compliance/valueGuard.js`;
`src/components/templates/ClinicalTemplateLibrary.jsx` (authoring UI).

**Impact.** Directly cuts keystrokes on the most repetitive narrative sections (education, wound
care, homebound) and finally makes an already-built library pay off. Near-zero new backend.

### 3.4 Note → OASIS autofill — *P0/M · Docs speed*

**Problem.** OASIS entry duplicates work the nurse already documented. `mapNoteToOASIS` produces
verbatim-evidenced, confidence-scored, decline-flagged M-item suggestions, but `SmartOASISAssessment`
/ `AIGeneratedOASISAssessment` are manual, question-by-question forms — the verified note never
pre-fills the assessment.

**What to build.** After a note is verified and persisted, offer "Pre-fill OASIS from this note"
that calls `mapNoteToOASIS` and lands the confidence-scored M-item suggestions into
`SmartOASISAssessment` as **draft** answers, each flagged `ai_suggested` and requiring explicit
per-item nurse attestation before it counts (reuse the honest "est." labeling already in the OASIS
suite). Suggestions populate **empty items only**, never overwrite a nurse's entry. Keep the
deterministic `OASISValidationPanel` cross-checks running on the merged result so autofill can't
introduce a contradictory M-item.

**Existing hooks.** `base44/functions/mapNoteToOASIS/entry.ts`;
`src/components/hub-tabs/SmartOASISAssessment` (lazy-loaded in `src/pages/OASISCenter.jsx`);
`src/components/oasis/{AIGeneratedOASISAssessment,ClinicalNoteToOASISMapper,OASISValidationPanel}.jsx`.

**Impact.** Removes the largest duplicate-entry burden (note **and** OASIS on the same visit) and
improves note↔OASIS consistency, which protects PDGM accuracy and reduces audit contradictions.

### 3.5 Compliance flow for offline capture — *P0/M · Docs compliance*

**Problem.** The moment connectivity drops, documentation quality silently degrades.
`OfflineVisitNoteCapture` is a plain free-text form: it maps fields to `nurse_notes` and queues a
`Visit`, but **bypasses** the required-element scan, gap questions, value grounding, and chart
cross-check entirely, and carries no grounding-deferred audit marker.

**What to build.** Run the deterministic, offline-capable compliance layer inside
`OfflineVisitNoteCapture` **before** queuing: `getRequiredElements(serviceLine, visitType)` +
`presenceDetection` + `coverageScore` + `crossCheckChart` (all pure JS, already offline-first) to
show the same gap questions, coverage score, and critical-vital/allergy cross-check the online flow
shows. Mirror the existing deferred-grounding pattern in `persistVisitNote.js`: set the queued
visit's `grounding_pending: true` flag and set the associated audit record's status to
`pending_review` — the deferred-grounding marker lives on `Visit.grounding_pending` and the audit
record, **not** on `Visit.status` (whose enum has no such value). Grounding then re-runs on
reconnect and the note is never shown as verified until then. Only the LLM re-voicing stays
deferred; the deterministic scan runs offline.

> **Note:** This overlaps `NURSE_APP_IMPROVEMENTS.md #2` and `APP_IMPROVEMENT_ROADMAP_2026-06 B1`
> (offline-note grounding). This item is the *product* framing (bring the full compliance assist
> offline); coordinate with those clinical-safety items so the audit-marker work isn't duplicated.

**Existing hooks.** `src/components/offline/OfflineVisitNoteCapture.jsx`;
`src/components/smartNote/compliance/{requiredElements,presenceDetection,coverageScore,chartCrossCheck,valueGuard}.js`;
`src/lib/offlineSync.js` + `src/lib/indexedDB.js` (queue + `client_request_id` dedup);
`base44/functions/processCompletedVisit` (server-side completion pre-flight).

**Impact.** Closes the offline compliance hole so field notes keep the same denial-prevention assist
and audit trail as online notes — the highest-value fix for real in-home use.

### 3.6 Timely Initiation of Care / Intake-to-SOC tracker — *P1/M · Star + Office · cross-cutting*

**Problem.** Timely Initiation of Care is the only process measure in the QoPC star and is fully
operationally controllable, yet PennSync has no intake-to-SOC timing: `Referral.status` ends at
`ready_for_admission` with no SOC-completion state or timestamp, and nothing computes
referral-received / ordered-start → first-visit turnaround. There is no admission-timeliness
dashboard and no aging/at-risk referral view (though `estimated_start_date` is already captured).

**What to build.** Add a physician-ordered/agency start date and an actual SOC-completion timestamp
to the referral→visit flow (extend `Referral` with a SOC-completed status/date, link to the
admission `Visit`), then compute TIC compliance (first visit within the timely window of the ordered
start/referral). Surface an intake-timeliness board listing referrals aging toward the window edge
with escalation, and roll the pass/fail rate into an `AgencyKPI`/`PatientOutcomeMetric` so the
process measure has a live number. Reuse the referral intake pipeline and the `monitorComplianceRisks`
cron for aging alerts. **This also anchors the NOA 5-day clock** (a Notice of Admission penalty of
1/30 of the period per day) should the agency later add NOA tracking — the SOC timestamp is the
shared prerequisite.

**Existing hooks.** `base44/entities/Referral.jsonc` (`status` enum, `estimated_start_date`,
`assigned_to`); `src/pages/ReferralIntake.jsx` + `src/components/referral/*`;
`base44/entities/Visit.jsonc` (`visit_type: 'admission'`, `visit_date`);
`base44/functions/monitorComplianceRisks/entry.ts`; `base44/entities/AgencyKPI.jsonc`.

**Impact.** Converts a documentation/scheduling problem into a reliably high score on 1 of the 7
QoPC measures, produces an office KPI, and strengthens NOA/PDGM timeliness. Fully controllable,
high-certainty gain.

---

## 4. Tier 1 — High-value core

### 4.1 Deterministic denial-reason guardrail engine — *P0–P1/L · Docs compliance + Revenue*

**Problem.** Insufficient documentation drives ~51% of home-health improper payments, and the same
clusters recur across TPE/RCD/ADR denials. PennSync has strong per-note compliance but no pre-save
gate scoring the note against the recurring clusters, and its homebound monitoring elsewhere is
naive keyword matching that passes negated/boilerplate mentions.

**What to build.** Extend the deterministic required-element/rule stack into a pre-save
"denial-reason" guardrail that scores the note and blocks or soft-confirms before save on: (1)
homebound narrative **quality** — apply the `completenessCritic`/`answerAdequacy` heuristics (not
bare keywords) to reject conclusory "patient is homebound"; (2) skilled-need specificity; (3)
**medical-necessity linkage** tying primary diagnosis + skilled need + frequency/duration orders
together as a deterministic rule. Encode as `MedicareComplianceRule` categories folded via
`ruleLibrary.buildMergedElements` so agencies can tune without weakening the floor.

> **Scope reconciliation with §4.2 (F2F).** Because Face-to-Face is validated **only at referral
> intake** and must not appear in the note or chart, this note-time engine deliberately **omits the
> F2F cluster.** F2F is checked once, upstream, on the uploaded referral — never re-checked in the
> SmartNote. This keeps the note free of F2F concerns and avoids duplicating (or leaking) the check.

**Existing hooks.** the deterministic compliance modules under `src/components/smartNote/compliance/`
(`requiredElements`, `ruleLibrary`, `answerAdequacy`, `completenessCritic`, `criticReconcile`); the
compliance surfaces under `src/components/compliance/` (`defaultMedicareRules.js`,
`VisitTypeComplianceChecker.jsx`, `AIComplianceAuditor.jsx` — rules already keyed to 42 CFR CoP
citations); replace the naive homebound keyword matcher in `monitorComplianceRisks`;
`base44/entities/{MedicareComplianceRule,AgencyComplianceRule,ComplianceRule}.jsonc`.

**Impact.** Moves the top note-side denial causes to caught-before-submission, lowering the agency's
own error rate toward MAC thresholds and protecting cash flow by preventing takebacks.

### 4.2 Face-to-Face (F2F) encounter validator — REFERRAL ANALYZER ONLY — *P1/M · Docs + Revenue*

**Problem.** F2F is a top ADR/auto-reject denial reason, yet there is **no F2F entity or check
anywhere** (it appears only in help text). Medicare rejects claims when the F2F fails on timing,
practitioner eligibility, or diagnosis relevance.

**Scope constraint (explicit).** This validator lives **only on the uploaded referral, inside the
referral analyzer.** It must **not** be part of the nurse's SmartNote, the OASIS flow, or anywhere
in the patient chart.

**What to build.**
- A new `src/components/referral/FaceToFaceEncounterValidator.jsx` that reads the already-extracted
  referral fields and validates: F2F encounter present; performed by an eligible certifying
  practitioner; within the **90-days-before / 30-days-after-SOC** window; and substantively linked
  to the primary home-health diagnosis. It emits a `pass` / `flag` / `fail` status + a
  missing-elements list.
- **Renders** inside `src/components/hub-tabs/ReferralProcessor.jsx` (after `ReferralAnalyzer`,
  before the PDGM Diagnosis Optimization block); a `pass/flag/fail` badge shows in the referral
  table in `src/pages/ReferralIntake.jsx`.
- **Data in:** derive from the *existing* extracted fields —
  `extracted_data.demographics.referring_physician`, the `admission_details` dates
  (`admission_date`, `referral_date`, `referral_reason`), and `orders_treatments.physician_orders`
  produced by `src/components/referral/referralExtraction.js`. **Do not** add an F2F field to
  `REFERRAL_EXTRACTION_SCHEMA` / `extracted_data` (see the isolation constraint below); if the
  referral lacks an explicit encounter date/certifier, capture it **top-level on `Referral`**, not
  inside `extracted_data`.
- **Persist:** add `face_to_face_validation` (object: `encounter_date`, `certifier`,
  `within_window`, `dx_linked`, `compliance_status`, `notes`) + `f2f_validator_notes` to
  `base44/entities/Referral.jsonc`, written in `ReferralIntake.jsx` `handleProcessingComplete()`.

**Isolation — a design constraint to enforce, not an automatic property.** There is **more than one**
referral→note bridge, so keeping F2F out of the note/chart depends on keeping F2F data **off**
`extracted_data`:
- `base44/functions/extractReferralDataForSmartNote/entry.ts` copies only
  demographics / diagnoses / vitals(text) / meds / skilled-needs / goals-of-care and does **not** read
  F2F today; **but**
- `src/components/referral/AIAdmissionNoteGenerator.jsx` prompts on `JSON.stringify(referralData, …)`,
  and `src/components/hub-tabs/ReferralProcessor.jsx` / `ReferralAdmissionNote` pass the full
  `extracted_data` into admission-note generation.

So: store the F2F result **only** on the top-level `Referral.face_to_face_validation` /
`f2f_validator_notes` fields (which those bridges do not read), and feed the validator from the
existing extracted fields listed above. **Do not** add an F2F field to `REFERRAL_EXTRACTION_SCHEMA`
— that is the path that would leak into generated admission notes; if an explicit F2F capture field
is unavoidable, put it top-level on `Referral` and redact it in the two admission-note bridges above.
Do **not** add any F2F inheritance into `SmartNoteAssistant` or `ComplianceChecklist`.

**Impact.** Converts a leading auto-reject denial cause into a structured, caught-at-intake check,
scoped exactly where the agency wants it — on the referral, before a patient is ever admitted.

### 4.3 PPH rehospitalization-prevention worklist — *P0/L · Star*

**Problem.** The highest-weighted HHVBP measure (~26%) is now the Within-Stay Potentially
Preventable Hospitalization (PPH); DTC-PAC tracks 31-day post-discharge outcomes. PennSync has
strong per-patient risk prediction, but it is (a) individual, ad-hoc, LLM-driven risk %, not pointed
at the PPH/DTC-PAC measure definitions or the 31-day window, and (b) not surfaced as an agency-wide
prioritized worklist that drives proactive intervention. Hospitalization today is only an unadjusted
raw count in `QualityMetricsDashboard`.

**What to build.** A population-level at-risk worklist that runs the existing risk scoring across all
active patients, ranks by preventable-hospitalization risk, and drives an intervention loop: escalate
high-risk to front-loaded visit scheduling, MD-contact task, and medication review; capture whether
the intervention was applied (`PatientRiskAssessment.interventions_applied` already exists) and
whether a hospitalization/ED event followed (`Incident.incident_type` `hospitalized`/`emergency_visit`).
Feed the outcome back into `PatientOutcomeMetric.readmission_30_day` / `er_visit_30_day` (from §3.1) so
the PPH and DTC-PAC rates become measurable. Re-point the risk window on the 31-day post-discharge
horizon for DTC-PAC.

**Existing hooks.** `src/components/predictive/RehospitalizationPredictor.jsx` +
`PopulationRiskOverview.jsx`; `src/components/oasis/PredictiveOutcomesAnalyzer.jsx`;
`base44/functions/predictPatientRisks/entry.ts`; `monitorComplianceRisks` (high-risk-dx walk);
`base44/entities/{PatientRiskAssessment,Incident,PatientOutcomeMetric}.jsonc`.

**Impact.** Targets the single highest-weighted HHVBP measure (~26% of TPS, up to 5% of Medicare
revenue) plus DTC-PAC and the QoPC utilization measure. Turns ad-hoc risk tooling into an agency
prevention program.

---

## 5. Revenue (secondary weight, part of the original ask)

### 5.1 Front-end diagnosis validation — *P1/M*

**Problem.** The **primary** diagnosis alone determines the clinical group; if it is on CMS's
"unacceptable"/questionable-encounter list the claim is Returned to Provider with **no payment**
until corrected, and a suboptimal-but-acceptable primary lowers the case-mix weight. Today the
primary-Dx check in `calculatePDGM` (`validatePrimaryDiagnosis`) only validates ICD-10 **format** —
it never checks acceptability, and the coder never sees the clinical-group consequence before the
claim is built.

**What to build.** At OASIS/intake, validate the primary ICD-10 against CMS's unacceptable list
(hard-block/flag) and show the resulting clinical group + case-mix consequence before finalization;
where the code is unmapped/unacceptable, prompt for a valid, higher-specificity primary. Build on
the engine's existing "return null rather than guess on unmapped codes" behavior so unacceptable
primaries surface instead of silently defaulting.

**Existing hooks.** Extend `validatePrimaryDiagnosis` + `mapDiagnosisToClinicalGroup` and the
admin-editable `ICD10_CLINICAL_GROUPS` map in `base44/functions/calculatePDGM/entry.ts` (surfaced in
`src/pages/PDGMRateSettings.jsx` via `PDGMRateConfig`); reuse the null-on-unmapped `assignClinicalGroup`
contract in `src/components/pdgm/pdgmGrouper.js`; surface in the OASIS validation UI; store approved
codes on `base44/entities/MedicalCode.jsonc` (currently unused).

**Impact.** Stops zero-payment RTP claims at the source and lands patients in the correct,
highest-appropriate clinical group from the first assessment.

### 5.2 Comorbidity capture assistant — *P1/L*

**Problem.** Comorbidity adjustment (none/low/high) is driven by secondary diagnoses and is captured
only ~60% of the time industry-wide because OASIS secondary-Dx data isn't reconciled during coding —
a direct per-episode revenue loss, especially the high-value interaction pairs. The app's comorbidity
logic (`calculateComorbidityAdjustment`) is a coarse keyword list, and `rankDiagnosesByPDGM` is
free-form LLM advisory; the deterministic `assignComorbidityAdjustment` in `pdgmGrouper.js` already
models subgroups + interaction pairs but is unwired and unfed.

**What to build.** A reconciliation step that compares the OASIS/assessment condition list against
the coded secondary-diagnosis list, maps to the CY2026 low subgroups / high interaction pairs, and
proactively surfaces when coded conditions qualify for a low or high adjustment (including
combinatorial interaction pairs). Flag OASIS-vs-coding mismatches (e.g. insulin-dependent diabetes
documented but only unspecified diabetes coded) that lose both the adjustment and create audit
exposure. Show the case-mix/dollar impact of each capture (behind the financials permission).

**Existing hooks.** Wire the already-modeled `assignComorbidityAdjustment` in
`src/components/pdgm/pdgmGrouper.js`, supplied with the CY2026 comorbidity table
(`docs/pdgm-cy2026.md`); back/replace the keyword `calculateComorbidityAdjustment` and the LLM
`rankDiagnosesByPDGM` in `base44/functions/`; reuse the comorbidity panel in
`src/components/oasis/AutomatedPDGMNavigator.jsx`; use `mapNoteToOASIS` / `analyzeOASISNarrativeMatch`
for the OASIS-vs-coding consistency pass.

**Impact.** Recovers the ~40% of comorbidity adjustments (low, and especially high interaction pairs)
currently missed — a recurring per-episode case-mix uplift the agency is already clinically entitled to.

---

## 6. Do Not Rebuild

These surfaces are strong today. Every feature above **extends** them; none should be replaced:

- **Constrained SmartNote scribe** + grounding/anti-fabrication (`ConstrainedNoteReviewer`, `valueGuard`).
- **OASIS scrubber + `oasisScoringEngine`** and the OASIS validation stack.
- **PDGM case-mix estimation engine** + what-if modeler (`calculatePDGM`, `pdgmGrouper.js`).
- **Telnyx fax/SMS/voice** with signature-verified webhooks + TCPA enforcement.
- **Referral intake + AI patient matching** (`referralExtraction.js`, `PatientMatchReview`).
- **Training/LMS**, **telehealth**, and the **offline capture queue** with `client_request_id` idempotency.

---

## 7. Suggested build sequence

Foundational items unlock later ones; within a wave, order by effort.

1. **Wave 1 (foundation & quick wins):** §3.1 OASIS Outcome-Measure Engine → §3.2 Discharge-OASIS
   enforcer (reads §3.1) · §3.3 phrase expansion · §3.4 Note→OASIS autofill · §3.5 offline
   compliance. These are mostly self-contained and produce the outcome rows everything else needs.
2. **Wave 2 (measure the business):** §3.6 TIC/Intake-to-SOC · §4.3 PPH worklist (reads §3.1's
   `PatientOutcomeMetric`).
3. **Wave 3 (compliance & revenue guardrails):** §4.1 denial-reason guardrail · §4.2 F2F validator
   (referral-only) · §5.1 diagnosis validation · §5.2 comorbidity capture.

---

## 8. Out of scope for this roadmap

Deliberately excluded per the curated scope (candidates for a future roadmap): physician-order/CMS-485
lifecycle tracker, agency scheduling/assignment board, HHCAHPS survey engine, HHVBP Total Performance
Score projection, EVV capture + state-aggregator export, trigger-driven medication reconciliation,
missed-visit prevention, hospital ADT intake, LUPA threshold monitor, NOA 5-day clock, multi-payer
eligibility / MA prior-auth, recert-due board, denial/remittance ledger, and per-episode margin
analyzer. Several are cross-referenced above where a Tier-0/1 feature lays their groundwork
(e.g. §3.6 anchors the NOA clock; §3.1 anchors the HHVBP TPS engine).
