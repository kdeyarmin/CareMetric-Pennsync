# Smart Note Assistant — In-Depth Feature Review

Date: 2026-06-03

## Purpose

A focused deep-dive on the **Smart Note** feature: the workflow that lets a home
health (or hospice) nurse type a rough draft / bullet points and have AI turn it
into a Medicare-compliant nursing note that can be pasted into the EMR. This
complements the whole-product reviews in `COMPREHENSIVE_APP_REVIEW.md`,
`PHASE2_REVIEW.md`, and `UI_UX_REVIEW.md`, none of which examined this workflow
end-to-end.

The goal of the feature (per product intent): **ask the specific questions a
note needs, guarantee everything required is present, and make compliant notes
faster to write** — while keeping the AI from inventing clinical facts.

## What was reviewed

- Orchestrator page: `src/pages/SmartNoteAssistant.jsx` (~850 LOC).
- Live sub-components actually wired into the page (21 of them), e.g.
  `FinalNoteDisplay`, `ComplianceChecklist`, `VitalSignValidator`,
  `StructuredNoteDrafter`, `NoteDiffView`, `SmartNoteTabs`,
  `VoiceClinicalNoteRecorder`, `NoteTemplateSelector`.
- The full `src/components/smartNote/` directory (143 components, ~41.7k LOC).
- Data contracts written by the flow: `Visit`, `Patient`, `NoteConversion`,
  `ComplianceAudit` (`base44/entities/*.jsonc`).
- Downstream consumers of `NoteConversion` analytics (KPI / ROI dashboards).

## How the feature works today

```
STEP 1  Write
  • pick patient (optional) + visit type (HH or Hospice set, by care_scope)
  • input: textarea  ·  live dictation  ·  audio upload  ·  SOAP audio  ·
    structured "Draft from Vitals" form  ·  saved templates
  • live, deterministic VitalSignValidator flags out-of-range vitals as you type
        │  "Analyze & Check Compliance"  (note ≥ 20 chars)
        ▼
STEP 2  Analyze  →  2 parallel InvokeLLM calls
  • Call A: Medicare compliance analysis → score + findings + enhanced_note
  • Call B: clinical decision support → clinical_alerts
        │
        ├─ if 0 findings need clarification → auto-build (no user action)
        └─ if findings need clarification   → [INTENDED: ask the nurse questions]
        ▼
        Build  →  InvokeLLM merges enhanced_note + approved additions
        ▼
  Persist: Visit (completed) + Patient.clinical_notes + enhanced_notes_history
           + NoteConversion + ComplianceAudit ; then follow-up tasks + supply use
        ▼
  FinalNoteDisplay: editable note · Copy · PDF export · raw-vs-enhanced diff
```

## What's genuinely good (keep these)

These are real strengths and should be preserved through any refactor:

1. **Deterministic vital-sign safety net** (`VitalSignValidator`). Regex-extracts
   BP/HR/O2/temp/RR/weight and applies fixed clinical thresholds — no LLM, so it
   can't hallucinate and always fires. This is the right pattern for safety-
   critical checks.
2. **Raw-vs-enhanced diff** (`NoteDiffView`). LCS word-level diff that shows
   exactly what the AI added/removed. This is the single best trust feature in
   the flow and directly supports the "never invent information" promise.
3. **Strong anti-hallucination prompting.** The compliance prompt repeats "NEVER
   invent clinical information," separates "write the exact sentence" vs "ask the
   nurse," and the build prompt restricts to source material only.
4. **Clean Home Health vs Hospice separation.** Distinct visit-type sets, distinct
   regulatory frameworks (42 CFR Part 484 vs Part 418), distinct required-element
   lists — driven by `currentUser.care_scope`.
5. **Low-friction happy path.** When nothing needs clarification the note builds
   automatically; drafts autosave to `sessionStorage` + IndexedDB with a restore
   prompt; patient context persists across tabs.
6. **Transparency.** `ComplianceChecklist` shows the nurse which standards are
   being checked before they submit.

## Critical findings

### C1 — The "ask the nurse the required questions" step is not wired up (highest priority)

This is the feature's headline capability, and it is currently broken.

- The compliance LLM **does** generate, for each gap that needs nurse input,
  `needs_clarification: true`, a `question`, and a `[bracketed]` placeholder
  template (`SmartNoteAssistant.jsx:259-283`).
- `proceedToBuild` **reads** `answers[f.id]` to substitute those placeholders
  (`:430`).
- **But no UI ever renders `f.question` or captures input into `answers`.**
  `setAnswers` is only ever called to *clear* the object (`:227`, `:487`); there
  is no `<input>`/`<textarea>` bound to it anywhere in the page (verified across
  the whole `src` tree).

Consequences:

- The nurse is never actually asked the questions the note needs — the core
  selling point ("asks specific questions necessary to the note") does nothing.
- Because `answers` is always empty, `proceedToBuild` keeps the unanswered
  findings' `suggestion` = the **`[bracketed placeholder]`** text, selects them
  (`filter(f => f.suggestion)`), and the build step merges them in. The
  "Medicare-compliant" note that gets copied into the EMR can therefore contain
  literal placeholders like `[describe why patient is homebound]`.

This is both a broken feature and a compliance/clinical-accuracy hazard.
**A fix is included in this change set** — see "Changes made."

### C2 — The note is saved before the nurse reviews it, and edits are never persisted

- `autoBuild` writes the `Visit` (status `completed`), updates
  `Patient.clinical_notes` + `enhanced_notes_history`, and creates the
  `NoteConversion` / `ComplianceAudit` records **before** `FinalNoteDisplay` is
  shown (`:370-405`).
- The nurse then edits the note in the final textarea — but the **"Save" button
  has no `onClick`** (`FinalNoteDisplay.jsx:40`). It is a dead control.

So the patient chart and the compliance audit store the *pre-edit* AI draft,
while the nurse copies a *different*, hand-corrected version into the EMR. The
record of care and the actual care note diverge. Recommended: persist on an
explicit **Sign & Save**, capture the visit id from `autoBuild`, and update that
same record on edit (don't create a second `Visit`).

### C3 — ~85% of the feature directory is dead code

- `src/components/smartNote/` contains **143 components / ~41,724 LOC**, of which
  **122 (85%) are never imported anywhere** (verified by import scan).
- Those orphans contain **72 of the directory's `InvokeLLM` call sites** — unused
  prompts that still ship in the bundle and still encode PHI-handling logic.
- This buries the ~21 components that actually run, multiplies onboarding and
  regression cost, and is the main reason this domain tops the lint-debt tables
  in `PHASE2_REVIEW.md` (78 issues). Many are near-duplicates of each other
  (`ConsolidatedAIFeedback`, `ConsolidatedAISuggestions`, `UnifiedAISuggestions`,
  `UnifiedAIPanel`, `NuancedFeedbackPanel`, … all dark).

Recommended: delete the orphan set in a dedicated, build-verified PR (no
behavior change), leaving only the wired components.

### C4 — Compliance scores and ROI metrics are fabricated, then fed to dashboards

- `overall_score` / `compliance_score` / `quality_score` are free LLM outputs
  with no rubric or anchoring, so the same note scores differently run-to-run —
  yet they drive `ComplianceAudit.status` (`passed`/`flagged`/`critical`, `:394`).
- Worse, `NoteConversion` is written with **hardcoded** improvement numbers:
  `rough_note_compliance: compliance_score - 20` and `compliance_improvement: 20`
  (`:393`). The "20-point improvement" was never measured.
- `NoteConversion` feeds ~10 reporting surfaces (`NoteConversionReport`,
  `QualityMetricsDashboard`, `KPIDashboard`, `SmartNotesStatsCard`,
  `NursePerformanceReport`, `statsCalculator`, …). So a made-up ROI figure
  propagates into agency- and nurse-level analytics.

Recommended: score against an explicit rubric (or a deterministic
required-elements checklist — see C7), and compute "before" compliance by
actually scoring the rough draft, not by subtracting a constant.

### C5 — "Revenue impact" dollars are LLM free-text, regex-summed into a total

`calculateTotalRevenueImpact` (`:448`) pulls `$N` out of the LLM's free-text
`revenue_impact` field and sums it. These dollar amounts are not grounded in any
fee schedule; presenting a summed "$X at risk" to clinicians/managers implies a
precision the data doesn't have. Recommended: either remove the dollar framing
or derive it from real PDGM/LUPA logic the app already has elsewhere.

### C6 — Structured Medicare fields on `Visit` are left empty

The `Visit` entity has `homebound_status` (required) and
`homebound_status_verified` (boolean) fields built specifically for Medicare
compliance, but `autoBuild` only writes free-text `nurse_notes`. The very data
point the feature exists to guarantee is never stored where compliance reports
can query it — it's buried in prose. Recommended: have the compliance pass emit a
structured result (homebound verified y/n, skilled-need present y/n, etc.) and
write it to these fields.

### C7 — "Everything required is present" is asserted by the LLM, not verified

The promise that the note contains all required elements rests entirely on the
model. There is no deterministic post-check that the *final* note actually
contains, per visit type, the required elements (homebound statement, skilled
need, patient response, teach-back, etc.). Recommended: add a small rule-based
required-elements checklist (like `VitalSignValidator`) that runs on the final
text and blocks/│warns before copy. This also gives a trustworthy compliance
score for C4.

## Secondary findings

- **S1 — No attestation / signature gate.** For a legal clinical note there is no
  "I attest this reflects the care I provided" step; signature is optional and
  only reaches the PDF export. (`SignatureCapture` exists but is orphaned.)
- **S2 — Offline can't enhance.** Drafts persist offline and visit creation
  queues, but `analyze()` requires the LLM, so the core convert step fails with
  no connectivity — common in patients' homes. Consider a "queue for enhancement"
  path that runs on reconnect.
- **S3 — 3–5 model/function calls per note** (compliance + CDS + build +
  follow-up tasks + supply). The 402 credit-limit handling suggests this ceiling
  is hit in practice. Compliance + CDS could be merged into one structured call.
- **S4 — PHI minimization.** Full identifiers (name, DOB, dx, meds) are
  interpolated into prompts. The model doesn't need real name/DOB to improve
  prose; de-identifying before the call would shrink PHI exposure (confirm a BAA
  covers the LLM provider regardless).
- **S5 — Compliance-finding checkbox double-toggles.** The row `<div>` has
  `onClick={toggle}` and the inner `<input>` has `onChange={toggle}`, so clicking
  the checkbox itself fires both and cancels out. (**Fixed** in this change set.)
- **S6 — Naive section/vitals parsing.** `parseNoteSections` and the vitals regex
  are keyword/pattern heuristics that can misclassify; acceptable for display,
  not for compliance decisions.
- **S7 — No tests.** There are zero tests touching SmartNote despite it being the
  largest domain. The deterministic pieces (`VitalSignValidator` rules, diff,
  a future required-elements checker) are easy, high-value unit-test targets.

## Prioritized roadmap

### P0 — correctness, low risk
- **C1** Wire the clarification Q&A (done here) and stop placeholder leakage.
- **S5** Fix the checkbox double-toggle (done here).
- **C2** Make "Save" persist edits to the existing visit; move persistence to an
  explicit Sign & Save after review.

### P1 — trust & integrity
- **C4/C7** Replace LLM-only scoring with a deterministic required-elements
  checklist; compute real before/after compliance.
- **C6** Write structured homebound / skilled-need fields on `Visit`.
- **C5** Remove or ground the dollar "revenue impact."

### P2 — maintainability & resilience
- **C3** Delete the 122 orphaned components in a build-verified cleanup PR.
- **S3** Consolidate compliance + CDS into one call.
- **S2** Offline "enhance on reconnect" queue.
- **S7** Unit tests for the deterministic pieces.
- **S1/S4** Attestation gate; de-identify prompt context.

## Changes made in this pass

A surgical, behavior-restoring fix for the headline capability (C1) plus the
related correctness bug (S5):

| File | Change |
| --- | --- |
| `src/pages/SmartNoteAssistant.jsx` | Render the AI-generated clarification **questions** with answer inputs bound to `answers`; only merge answered (or already-complete) findings so no `[placeholder]` can reach the final note; show an answered/total counter; fix the compliance-finding checkbox double-toggle |
| `docs/SMARTNOTE_REVIEW.md` | This review |

The remaining items (C2–C7, S1–S4, S6–S7) are left as documented,
prioritized recommendations because they touch persistence semantics, scoring
integrity, or large-scale deletion and warrant their own reviewed changes.

---

## Update — full redesign implemented (2026-06-03)

The recommendations above were taken further than a surgical fix: the Smart Note
flow was re-architected into a **constrained-scribe pipeline** and the same
guarantees were extended to the Visit Scribe page.

**New deterministic engine** — `src/components/smartNote/compliance/` (pure,
offline, unit-tested): `requiredElements` (single source of truth for required
elements per service line × visit type, with severity/CoP/keywords/negatives/
carry-forward flags), `factExtraction`, `presenceDetection` (+ `computeCarryForward`),
`normalize`, `valueGuard`, `coverageScore`, `schemas` (zod), `generation`
(constrained generation + AI grounding). 29 unit tests.

**Status of findings:**

| Finding | Status |
| --- | --- |
| C1 — clarification Q&A never rendered | **Fixed** — questions are deterministic gaps; answered/confirmed feed the note |
| C2 — save-before-review / dead Save button | **Fixed** — review→Save-to-chart; edits re-verify; same Visit updated (no dup) |
| C4 — fabricated/non-deterministic scores | **Fixed** — reproducible coverage score; real before/after written to `NoteConversion` (same fix applied to `UnifiedDocumentReview`) |
| C5 — LLM "revenue impact" dollars | **Removed** from the flow |
| C6 — empty structured `Visit` fields | **Fixed** — `homebound_status_verified` / `homebound_justification` / `skilled_intervention_documented` now populated |
| C7 — "everything required" asserted by LLM | **Fixed** — deterministic required-elements gate + coverage |
| Hallucination (core goal) | **Fixed** — LLM is a constrained scribe; value-guard + AI grounding **block** unverified values |
| S1 — attestation | **N/A** — note is copied into the external EMR; no in-app signing (Save-to-chart only) |
| S2 — offline | **Partial** — scan/value-guard run offline; grounding deferred to reconnect |
| Pre-fill from chart | **Added** — stable elements carry forward from the last note for confirmation; visit-specific findings never auto-carried (anti-cloning) |
| Visit Scribe parity | **Done** — extracted shared `ConstrainedNoteReviewer`; `VisitScribe`/`UnifiedDocumentReview` run the same pipeline |
| Single reviewer (no duplication) | **Done** — `SmartNoteAssistant` Step 2 now renders the same `ConstrainedNoteReviewer` (via a `renderFinalNote` host API that keeps its Save-to-chart + PDF/signature) |
| C3 — orphaned dead code | **Done** — removed 115 unreferenced `smartNote/` components (~35k LOC), build-verified |
| Other live note paths | **Done** — `StructuredNoteDrafter` now assembles the nurse's fields deterministically (no LLM, no fabricated defaults); `MedicalScribe` routes its transcription through `ConstrainedNoteReviewer` and writes a real coverage score (was a hardcoded `quality_score: 95`) |

**Still open:** S3 (consolidate the generation + grounding into fewer calls),
S6/S7 polish, and consolidating the near-duplicate `MedicalScribe`/`VisitScribe`
routes (a product decision). The two LLM calls (generation + grounding) and the
chart-save path still warrant a manual run against the live Base44 backend.

---

## Update — visit-over-visit trend comparison (2026-06-20)

Closes the "check the note against the chart … so trends can be caught, and
changes can be noted in the note" half of the product intent, which previously
lived only in the separate `VitalsTrendAnalysis` tab and was not woven into the
note-building flow.

**New deterministic engine** — `compliance/visitComparison.js` (pure, offline,
9 unit tests): `compareVisits(currentNote, priorNote)` extracts the same
clinically-significant values the value-guard uses (BP, HR, O2, temp, weight,
pain) from both the note being written and the patient's last saved note, and
reports each metric whose change clears a per-metric noise threshold — with a
`concern` flag when a value crosses a clinical threshold. `buildTrendSummary`
renders a single, purely factual, plain-text sentence ("Compared to the prior
documented visit, blood pressure 150/92 to 132/84 mmHg; …") — values only, no
interpretation.

**Wiring** — `ConstrainedNoteReviewer` now renders a **Changes Since Last
Visit** panel (`VisitComparisonPanel`) in the review step for every caller that
already supplies a prior note (`SmartNoteAssistant`, `UnifiedDocumentReview`).
The nurse can opt to add the change summary to the note; when they do, the
summary is whitelisted as source input so it passes the value-guard and grounding
(its current values trace to the draft, its prior values to the chart note — it
is real chart data, not an LLM invention), and it is appended verbatim rather
than re-voiced. Opt-out leaves the note untouched. Gracefully renders nothing
when there is no prior note or no comparable change.

`detectSustainedTrends` extends this to **multi-visit** trends: it reads the last
few notes from the patient's `enhanced_notes_history` (already on the chart
record — no extra fetch) and flags any value that moved monotonically across ≥3
consecutive visits past a per-metric total threshold (e.g. weight 180 → 184 →
188 lbs). The single-visit delta can be noise; a sustained directional run is the
clinically meaningful signal. These render as an **advisory** band in the same
panel and are never auto-inserted (multi-visit significance is the nurse's call).

## Update — chart cross-check (2026-06-20)

Closes the broader "check the note against other info in that patient's chart"
half of the intent: comparing the note not just to the prior visit's vitals but
to the standing chart.

**New deterministic engine** — `compliance/chartCrossCheck.js` (pure, offline,
8 unit tests): `crossCheckChart(noteText, patient)` compares what the nurse
documented this visit against the chart and surfaces advisory findings:

- **Allergy conflict** (critical) — a medication named in the note that also
  appears in the patient's documented allergies.
- **Medication reconciliation** (info) — a note medication not on the chart's
  `current_medications` list (new order vs. unreconciled chart).
- **Fall-safety gap** (warning) — chart flags HIGH `functional_status.fall_risk`
  but the note never mentions fall precautions / safety.

It reuses the dictionary-backed `extractMedications` and the shared safety
pattern, so it never invents a discrepancy.

**Wiring** — `ConstrainedNoteReviewer` now takes a `patient` prop and renders a
**Chart Cross-Check** panel (`ChartCrossCheckPanel`) at the top of the review
step for callers that supply the chart record (`SmartNoteAssistant`,
`UnifiedDocumentReview`). Advisory findings never edit the note or feed the
value-guard, and the panel renders nothing when the note is consistent with the
chart.

**Save-time safety gate.** A *critical* cross-check finding (e.g. a documented
medication the patient is allergic to) previously vanished once the note was
generated — invisible at the moment of saving. The reviewer now re-surfaces
critical findings in the final-note view with an explicit acknowledgment
checkbox, exposes `chartRisk.hasUnacknowledgedCritical` on its `renderFinalNote`
api, and `SmartNoteAssistant` disables Save-to-chart (with a defensive guard in
`handleSave`) until the nurse acknowledges the conflict. Copy/PDF stay available;
only the chart write is gated.

**Persistence for reporting.** The chart conflicts and multi-visit trends now
flow into the saved records so they reach compliance dashboards, not just the
live UI. `compliance/reportingFields.js` (pure, 6 unit tests) maps them onto the
existing fields: `ComplianceAudit.issues` (structured element/severity/problem),
an escalated `ComplianceAudit.status` (`critical` whenever a critical conflict is
present, regardless of coverage score), `Visit.ai_tags` (concise searchable
`trend:<metric>:<dir>` / `chart_flag:<category>` tags), and `Visit.compliance_issues`
(human-readable strings for critical conflicts). `ConstrainedNoteReviewer` carries
`chartFindings` + `sustainedTrends` on its save-ready `result`, and
`SmartNoteAssistant.persistNote` writes them on all three paths (online create,
re-save update, and the offline sync-queue payload). The pure
`buildVisitReportingFields` / `buildAuditFields` builders centralize "which field
gets what" and are unit-tested (13 tests total) so the wiring can't silently drift.

**Reporting follow-ups (hardening the above).**
- *Offline visits now get an audit.* The offline save attaches an `__audit` meta
  blob to the `CREATE_VISIT` queue item; the `OfflineManager` drain peels it off
  (it is not a `Visit` field) and creates the matching `ComplianceAudit` after the
  visit, so offline-documented visits are no longer invisible to the compliance
  dashboards. Older queue items simply lack `__audit` and behave as before.
- *Acknowledgment trail.* The critical-conflict checkbox now has an optional
  rationale field; on save the override is persisted to a new
  `ComplianceAudit.acknowledgment` object (`acknowledged_by` / `acknowledged_at` /
  `justification` / `finding_ids`) and surfaced in `ComplianceAuditResults`, so an
  audit can distinguish "reviewed and accepted with reason" from "never noticed".
- *Re-save keeps the audit in step.* `persistNote` remembers the created audit id
  (`savedAuditId`) and updates that row on re-save, so editing to resolve a
  conflict clears the stale `critical` status/issues instead of leaving them.
- *Auto-tagger reconciliation.* SmartNote's `ai_tags` are namespaced
  (`trend:` / `chart_flag:`); `AIAutoTagger` now skips a visit only when it has a
  *semantic* (non-system) tag and merges rather than overwrites, so writing trend
  tags at save time no longer suppresses or clobbers clinical tagging.
- *Severity + suggestion polish.* `toAuditIssues` translates the advisory
  vocabulary (critical/warning/info) to the dashboard's color scale
  (critical/high/low) and carries each finding's `recommendation` through as the
  issue `suggestion`, so audit rows render the right color and an actionable fix.

## Update — nurse-experience pass (2026-06-20)

Six improvements aimed at field friction and turning the safety signals the
engine already computes into one-tap actions:

1. **Voice-dictate the gap-question answers.** Each required-element question in
   `ConstrainedNoteReviewer` now has a mic button (`DictationButton`, reusing the
   browser `SpeechRecognition` + `enhanceTranscription` the main note uses).
   Dictated text *appends* to the answer and clears the "carried from last visit"
   flag. Lets a nurse answer hands-free at the bedside instead of typing.
2. **One-tap "routine negatives".** A *Confirm all routine negatives (no acute
   changes)* button bulk-confirms every standard-negative element the nurse hasn't
   typed an answer for, collapsing a dozen taps to one on a stable patient. Each
   remains individually editable.
3. **Per-patient draft recovery.** Drafts are now keyed per patient (plus an
   `unassigned` bucket) instead of a single global slot, so switching patients
   never clobbers another patient's in-progress note. Autosave writes under the
   *active* patient (via ref, not a `patientId` effect dep, to avoid the clobber);
   selecting a patient auto-restores their draft, and a note typed before a
   patient is picked migrates to the patient chosen for it.
4. **Critical chart conflict → action.** The critical-conflict panel and the
   critical-vitals banner expose a *Create provider follow-up task* button. The
   reviewer hands the findings to an `onEscalate` host callback;
   `SmartNoteAssistant` persists them as high-priority `notify` `Task` records
   (assigned to the nurse, linked to the visit) and surfaces them in the
   follow-up panel. Guarded so a group can't be escalated twice.
5. **Inline provenance ("show me the proof").** A *Show verification detail*
   toggle annotates the final note sentence-by-sentence —
   `compliance/provenance.js` (pure, 6 unit tests) reuses the value-guard's own
   extraction to mark each value/medication green (traces to the nurse's input)
   or red (not found), so the "every value verified" claim is inspectable.
6. **Critical-vital escalation at documentation time.**
   `compliance/noteEscalation.js` (pure, 5 unit tests) maps the note's extracted
   vitals onto the shared `detectCriticalVitals` thresholds, so a hypertensive
   crisis / severe hypoxia / 10-of-10 pain written into the note raises an
   advisory provider-notification banner (with the same escalate action). Never
   blocks saving a genuine reading.

## Update — robustness & hardening pass (2026-06-20)

A follow-up audit (dead-code, error-handling, offline, a11y) surfaced seven gaps;
all are fixed here:

- **A. Offline drafts were durable-in-name-only and leaked PHI.** `saveDraftNoteLocally`
  wrote a `draft_<patientId>` row on every keystroke, but nothing ever read or
  deleted it (restore was `sessionStorage`-only), so drafts didn't survive a
  browser restart and a PHI row accumulated per patient forever. Now: a
  `getDraftNoteLocally(id)` durable fallback restores from IndexedDB when
  `sessionStorage` is empty (on mount and on patient switch), and `clearDraft`
  deletes both stores on save and on reset — bounding accumulation to genuinely
  unsaved work.
- **B. "Copy to EMR" could fail silently.** `navigator.clipboard.writeText` is now
  wrapped in try/catch in `ConstrainedNoteReviewer`, `SmartNoteAssistant`,
  `FinalNoteDisplay`'s callback, `VisitSummaryGenerator`, and `StructuredNoteDrafter`,
  with an error toast — so the nurse never sees a false "Copied!" and pastes stale
  text into the chart.
- **C. Offline provider-escalation was dropped.** `escalateToTasks` now queues a
  `CREATE_TASK` sync item when offline (or on a failed create); `OfflineManager`
  drains it on reconnect, so a critical conflict/vital follow-up is never lost.
- **D. Concurrent dictation mics.** A module-level `dictationController`
  (`claim`/`release`) ensures only one `SpeechRecognition` runs at a time across
  the main note dictation and every per-question mic (browsers allow one).
- **E. No timeout on LLM calls.** `compliance/withTimeout.js` (pure, 3 unit tests)
  bounds the generation (45s) and grounding (30s) calls so a hung request surfaces
  a re-checkable error instead of an indefinite "Building…" spinner.
- **F. Trend comparison ignored units.** `visitComparison` now normalizes a
  documented kg weight to lbs before comparing, so a visit-to-visit unit switch
  isn't reported as a huge swing (2 new tests).
- **G. Accessibility.** The icon-only reset button (`FinalNoteDisplay`) gets an
  `aria-label`; `SmartNoteTabs` get `role="tablist"`/`role="tab"`/`aria-selected`
  and a visible focus ring.

The audit also confirmed **no dead code** (all 20 components in
`src/components/smartNote/` are wired in) and **no TODO/FIXME debt**.

## Update — efficiency / usability / note-quality pass (2026-06-27)

A fresh deep review found five remaining gaps; all are fixed here. None weaken the
anti-hallucination guarantees — two of them *close* holes in it.

1. **Structured vitals reached the chart but never the note (silent data loss).**
   Vitals entered in the Step 1 `VitalSignsForm` were saved to `Visit.vital_signs`
   but were never passed to `ConstrainedNoteReviewer`, so a nurse who used the form
   (instead of retyping vitals into the draft) got a note with no vitals *and* a
   false "vitals not documented this visit" gap. New pure `formatVitalsSentence`
   (`compliance/factExtraction.js`) maps the canonical `vital_signs` shape to one
   factual sentence using the exact measurement token spellings the value-guard
   recognizes; the reviewer now (a) folds it into presence/coverage detection so
   vitals score as documented, (b) whitelists it as source for the value-guard /
   grounding, and (c) appends it verbatim to the note — the same treatment the
   deterministic trend summary already gets. A node test asserts the sentence
   value-guards against itself (guards the token shapes).
2. **Generation prompt was home-health-only.** `generateConstrainedNote` hardcoded
   "Medicare-compliant **home health** nursing note" even for hospice. It now takes
   `serviceLine` + `visitType` and selects a framing phrase (home health → 42 CFR
   484; hospice → 42 CFR 418, comfort/terminal-plan framing; plus an
   admission/recert/discharge/PRN clause). The "ABSOLUTE RULES" anti-hallucination
   block is unchanged byte-for-byte; only the role/framing sentence varies.
3. **Step 1 input overload + an anti-hallucination side-door.** `VoiceClinicalNoteRecorder`
   ran its *own* GPT pass that rewrote the audio into polished narrative *before*
   the constrained scribe saw it — pre-embellishing the "rough draft" the whole
   architecture is built to avoid. Removed from Step 1 (one of four redundant voice
   paths); the remaining voice inputs (live dictation, record-and-transcribe, SOAP)
   are now grouped under one labeled "Voice input" control.
4. **Misleading two-step "Generate".** The Step 1 button read "Generate Note" with a
   Sparkles icon but only opened a deterministic review/questions screen — the real
   LLM generation is the Step 2 "Generate Final Note". Relabeled to "Review &
   Complete" (and `StepIndicator` to "Review & Generate"); Sparkles now marks only
   the true generation.
5. **S3 (efficiency) — grounding trimmed, calls kept separate.** Merging generation
   + grounding was rejected (it makes the model self-grade its own output in one
   turn — weak verification). Instead, on a fresh generate, the grounding pass now
   classifies only the LLM-authored note; the deterministic verbatim extras (trend
   summary, vitals sentence, "not documented" fallbacks) are already value-guarded
   and are excluded, shrinking that call without weakening the check. A re-check
   after a manual edit still grounds the whole note.

## Update — follow-on rounds: drafter parity, dead-code removal, recorder merge (2026-06-27)

Three further passes building on the round above (all build- and test-verified; net
~28k LOC removed across them):

**R2 — Structured-Drafter parity + first cleanups.**
- The "Draft from Vitals" tab (`StructuredNoteDrafter`) had the same silent-vitals-loss
  bug fixed above, in a second place: its vitals reached the chart but not the note.
  New pure `toCanonicalVitalSigns` (`compliance/factExtraction.js`) maps the drafter's
  legacy field names to the canonical `vital_signs` shape; the drafter now emits
  structured vitals on handoff (and strips its own vitals line to avoid duplication),
  so they flow through `formatVitalsSentence` into coverage, trends, escalation, and
  chart cross-check.
- Removed dead backend functions `enhanceNoteOptimized` and `smartNoteAssistant` (no
  caller — superseded by the client-side constrained-scribe pipeline).
- Finished the Scribe-route consolidation: `/MedicalScribe` already redirected to the
  Clinical Notes hub, so removed the unreachable `MedicalScribe.jsx` page and its
  scribe-only orphans (`ScribeNoteRecorder`, `NoteReviewPanel`).

**R3 — Retire the dead `DocumentVisit` page.** `DocumentVisit.jsx` (~1.7k LOC) was
already redirect-retired and not in the route manifest. Removed it plus the closure of
~40 components imported only by it (each grep-gated for zero importers, build/test the
backstop), and the `transcribeAndExtractClinicalData` backend fn (its sole caller was
the removed `MedicalScribeAssistant`). Shared utilities (`VitalSignsForm`,
`vitalEscalation`, `oasis/AIDocumentationAssistant`, the `compliance/*` utils, …) kept.

**R4 — Merge the Step-1 audio recorders + final orphan removal.**
- Replaced the two side-by-side recorders with one `VisitAudioRecorder` carrying a
  **Narrative | SOAP** format toggle and a single record/stop button; the hardened
  PHI-audio cleanup (detach `onstop` before stop, release mic, revoke blob URLs) is
  ported verbatim. Narrative reuses `DictationSectionMapper`; SOAP reuses the existing
  `transcribeAndGenerateSOAPNote` formatting. Covered by `VisitAudioRecorder.smoke.test.jsx`.
- `performanceTracking.jsx` turned out to be entirely unreferenced (its one apparent
  caller defines its own same-named function) — removed wholesale.
- Removed 11 further components verified to have zero importers (visit/clinical/alerts/risk),
  including `OASISScrubber.jsx` (its only importer was the removed `EnhancedOASISScrubber`);
  kept the still-tested `oasisScrubberPrompt.jsx`/`.spec.js`.

</content>
