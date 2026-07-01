# PennSync — Go-Live Review & Fixes (2026-07-01)

A full-application correctness/security pass ahead of go-live. Objective health
gates were re-run (all green), then a multi-domain adversarial review fanned out
across every feature area (clinical/OASIS/PDGM/SmartNote/fax/SMS-voice/training/
compliance/patient-ops/admin/referral/e-sign/offline/frontend-infra/backend
functions). Every candidate defect was verified against the source before fixing.
**22 confirmed issues were fixed** (1 P0, 14 P1, 7 P2). All fixes ship with the
gates still green: `lint` (0 errors, 0 warnings), `typecheck`, `check:backend-transpile`
(207 fns), `test` (668 utils + 8 contracts + 4 security + 276 component), `build`.

## P0 — clinical safety

1. **Deterioration predictor read vital trends backwards.**
   `PatientDeteriorationPredictor` serialized visits most-recent-**first** while the
   LLM prompt labeled them "most recent last", so a declining O2/rising HR was
   presented as improving — able to suppress a needed physician escalation. Now
   ordered chronologically before the prompt. (`src/components/predictive/PatientDeteriorationPredictor.jsx`)

## P1

2. **Offline CREATE_TASK / CREATE_INCIDENT weren't idempotent** — a crash mid-drain,
   a migration re-run, or two tabs draining the shared queue duplicated safety
   incidents and follow-up tasks. Added `client_request_id` to both entity schemas,
   attach it at every enqueue/migration site, and dedupe in the drain (mirrors the
   existing CREATE_VISIT discipline). (`offlineSync.js`, `offlineMigration.js`,
   `OfflineTaskManager.jsx`, `SmartNoteAssistant.jsx`, `Incident.jsonc`, `Task.jsonc`)
3. **Quiz answer key shipped to the learner's browser.** The course player fetched
   full `TrainingQuestion` records (incl. `correct_answer_json`/`rationale`). Added a
   server function `getCoursePlayerQuestions` that returns answer-free questions
   (matching keeps only left prompts); learner path now uses it. Grading was already
   server-side. (`base44/functions/getCoursePlayerQuestions`, `TrainingCoursePlayer.jsx`)
4. **`issueCertificate` never verified a pass.** Added a pass-state gate (assignment
   passed **or** a passing `TrainingAttempt` exists — works with the trusted internal
   caller's ordering) and now derives the score from the verified source instead of
   the request body. (`base44/functions/issueCertificate`)
5. **M1860 (Ambulation) defined twice** with conflicting value scales, colliding React
   keys, and one ambiguous `answers['m1860']` slot. De-duplicated to the correctly-
   positioned definition, with the fall-prevention alert preserved. (`oasisQuestions.jsx`)
6. **Value-guard blocked faithful notes.** Bare labeled vitals ("HR 82", "T 98.6")
   produced no tokens, so the scribe's unit-bearing restatement was flagged as
   hallucinated and the note couldn't be saved. Fold HR/RR/temp/weight into the
   allowed-token set. (`smartNote/compliance/factExtraction.js`)
7. **"Weight: 80 kg" (with a colon) wasn't converted to lbs**, fabricating a ~96 lb
   weight-loss trend. Colon added to the kg-normalizer regex. (`visitComparison.js`)
8. **`processScheduledFaxes` marked a fax "sent" even when every recipient failed**
   (a silent PHI delivery failure). Now inspects the send result like its priority
   sibling. (`base44/functions/processScheduledFaxes`)
9. **Advanced duplicate scan orphaned clinical history.** It only set
   `status:'discharged'` — never reassigned related records or archived the duplicate,
   so duplicates stayed in the roster with history stranded. Now routes through the
   shared `mergePatientInto` and picks the survivor by completeness. (`DuplicateScanner.jsx`)
10. **"Manager" role was selectable but always rejected by the backend.** Removed it
    from the two write dialogs (filter/badge kept for legacy records). (`UserManagement.jsx`)
11. **Reset-password dialog showed an empty temp-password box** with "share this"
    text (backend never returns it, by design). Removed the misleading box. (`UserManagement.jsx`)
12. **Malformed AI-extracted dates crashed the whole Referral Intake list** via
    `format(new Date(...))`. Added a validity-guarded `safeDate` helper at all sites.
    (`ReferralIntake.jsx`)
13. **Referral auto-created a duplicate patient even when flagged for manual match
    review.** Added a `requires_manual_review` guard before the auto-create. (`ReferralIntake.jsx`)
14. **Nurse assignment could persist without notifying** when the date was
    unparseable. Date now guarded; notification is sent before the assignment is
    persisted so the two are atomic from the operator's view. (`ReferralIntake.jsx`)
15. **`generateDischargeSummary` hardcoded fabricated clinical facts** (disposition
    `home_independent`, "improved functional status", fake 95% confidence) into a
    signed Medicare document the reviewer never saw. Stopped fabricating; surfaced
    disposition + functional status as required editable review fields.
    (`base44/functions/generateDischargeSummary`, `DischargeSummaryWorkflow.jsx`)

## P2

16. **Offline visit vitals queued as raw/empty strings** into a numeric Visit schema.
    Coerced to numbers, blanks dropped. (`OfflineTaskManager.jsx`)
17. **Diabetes Management suggestion fired on M2020=3** (oral-med management), flagging
    non-diabetic patients. Removed the unrelated trigger. (`oasisScoringEngine.js`)
18. **PDGM estimate disclosure was never rendered** — dollar figures showed with no
    "estimate only, not billable" label. Added the disclosure banner (propagates to
    `OASISRevenueAnalysis`). (`PDGMRevenueComparison.jsx`)
19. **Wage-index formula shown to admins was a false equation** (ignored labor share).
    Replaced with a non-contradictory statement. (`PDGMRevenueComparison.jsx`)
20. **A calendar date like "3/10" was misread as a pain score.** `extractPain` now
    requires pain/rating context. (`visitComparison.js`)
21. **`sendBatchFax` omitted `webhook_url`**, so scheduled faxes never got Telnyx
    delivery callbacks. Added it (mirrors `sendFax`). (`base44/functions/sendBatchFax`)
22. **Patient verification step crashed on a malformed stored DOB.** Validity-guarded
    the DOB render. (`PatientVerificationStep.jsx`)

## Deploy note

Findings #2, #3, #4, #8, #15, #21 touch hosted Base44 backend functions and two
entity schemas (`Incident`, `Task` gain `client_request_id`). These deploy with the
app from this repo; the new `getCoursePlayerQuestions` function must be deployed for
the learner quiz path (grading is unchanged). Platform blockers from
`GO_LIVE_READINESS_2026-06-26.md` (RLS, secrets, webhooks, one cron per dispatcher,
PDGM rate posture) remain the governing launch gate and are unchanged by this pass.
