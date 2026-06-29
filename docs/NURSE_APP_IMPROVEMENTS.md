# Nurse App — Functional Review & Improvement Recommendations

Date: 2026-06-03

## Purpose & scope

PennSync2 is a large home-health & hospice application for nurses (React/Vite + Base44 SDK +
Supabase): **138 page components, 111 data entities, ~1,027 source files, and 213 files that
call `InvokeLLM`**. This document is a whole-app functional review with a prioritized list of
recommendations to improve how the app works for nurses and administrators.

It **consolidates still-open items** from the existing review docs and **adds newly found,
verified findings**. It does not repeat already-completed work (route consolidation, dark-mode
fix, navigation manifest, etc.). See the cross-references to:
`COMPREHENSIVE_APP_REVIEW.md`, `AI_TRUSTWORTHINESS_AUDIT.md`, `OASIS_REVIEW.md`,
`SMARTNOTE_REVIEW.md`, `UI_UX_REVIEW.md`, `PHASE2_REVIEW.md`, `ROUTE_CONSOLIDATION.md`,
`SECURITY-RLS-CHECKLIST.md`.

Items marked **[verified]** were confirmed by reading the cited code during this review. Each
recommendation carries a `file:line` reference so it can be picked up directly.

> Scope note: faxing is intentionally **outbound-only**. Inbound fax reception is explicitly
> out of scope for this product and is not recommended here.

---

## P0 — Patient safety & clinical correctness (do first)

1. **Fix the readmission-risk `ReferenceError`** **[verified]**.
   `src/components/patient/HospitalReadmissionRisk.jsx:134` declares `let _comorbidityCount = 0;`
   but line 149 increments `comorbidityCount` (undefined → `ReferenceError` in strict ES modules).
   The risk calculation throws whenever a high-risk comorbidity is encountered. One-character fix,
   high impact.

2. **Stop persisting AI clinical content as "verified" when grounding was skipped** **[verified]**.
   `src/components/smartNote/ConstrainedNoteReviewer.jsx:112-118`: the offline path returns
   `{ ok: true, offline: true }` and saves the note as verified with only `offlinePending: true`.
   A note with hallucinated findings can reach the chart unverified. Save offline notes as
   **draft — pending grounding**, block chart submission, and re-verify on reconnect.

3. **Remove `functional_baseline` from note carry-forward (Medicare cloning risk)** **[verified]**.
   `src/components/smartNote/compliance/requiredElements.js:301` includes `functional_baseline`
   in `CARRY_FORWARD`. Functional status must be re-assessed each visit; pre-filling it from the
   prior note invites cloned findings. Re-frame all carry-forward fields as
   "pre-filled — confirm or edit" with explicit nurse confirmation required.

4. **Don't auto-append "was not documented" sentences to generated notes** **[verified]**.
   `src/components/smartNote/ConstrainedNoteReviewer.jsx:145-146` appends
   `computeNotDocumented()` phrases. Asserting "X was not documented" as note text fabricates a
   negative. Instead, require the nurse to answer the missing critical element before generation.

5. **Add vital-sign plausibility validation + critical-value escalation.** *(plausibility
   validation **implemented**; escalation + "same as last visit" gating still recommended.)*
   `src/components/visit/VitalSignsForm.jsx` previously accepted any number (temp 200°F, HR 999).
   Each field now carries a deliberately-wide plausible range and shows a non-blocking
   "please confirm" warning when a value falls outside it — this catches data-entry/unit mistakes
   (e.g. a Celsius temperature) without blocking genuine abnormal-but-real readings. Still
   recommended: a critical-value **escalation** path (BP >180/120, O2 <88%, pain 10/10 → alert
   supervisor/physician instead of silently saving) and gating the "same as last visit" flow so
   vitals must be re-measured.

6. **Add visit-completion pre-flight checks.** *(result null-check **implemented**; content
   pre-flight still recommended server-side.)*
   `src/components/visit/VisitCompletionButton.jsx` called `processCompletedVisit` and dereferenced
   `result.success` with no guard — a null/5xx response crashed the handler. Now hardened to throw a
   clear error on an empty response (and default `tasks_created`). The remaining recommendation —
   require a minimum narrative length + at least BP/HR + homebound answered before completion —
   belongs in the **`processCompletedVisit` backend function** (server-side validation), since this
   button component only receives `visitId` and has no access to the visit's narrative/vitals.

7. **Make AI-generated clinical content explicitly "verify-before-use."**
   OASIS suggestions (`src/components/oasis/AIGeneratedOASISAssessment.jsx`, where `ai_suggested: true`
   is set but never surfaced), care plans (`src/components/carePlan/AICarePlanGenerator.jsx`), and the
   LLM drug-interaction analysis (`src/components/medication/MedicationInteractionChecker.jsx`) present AI output without a consistent
   badge or attestation gate. Add a shared "AI-Generated — reviewed by nurse" badge + checkbox,
   logged to the audit trail. Enforces the unfulfilled policy in `AI_TRUSTWORTHINESS_AUDIT.md`.

8. **Harden medication safety.**
   `src/components/medication/drugInteractions.js` has only ~17 deterministic pairs and matches
   drug names by exact substring (typos slip through). Expand to ≥50 high-severity pairs, add
   fuzzy/RxNorm matching, add a drug–condition contraindication check (NSAID+CKD, beta-blocker+
   asthma), and add an "AI-assisted — verify against authoritative source" disclaimer on LLM output.

9. **OASIS ↔ care-plan consistency guard.**
   `src/components/oasis/oasisScoringEngine.js` intervention IDs (`fp-1`…) have no backing definitions, and
   care-plan goals aren't validated against OASIS function scores (a "bedfast" patient can get an
   "ambulate independently" goal). Add a consistency check and resolve intervention IDs to a real
   library.

## P1 — Compliance, audit integrity & reliability

10. **Debounce the live compliance checker** **[implemented]**.
    `src/components/compliance/UnifiedComplianceEngine.jsx:58-62` fired an `InvokeLLM` pass on every
    keystroke past 100 chars (deps `[noteContent, autoCheck]`, no debounce) — hammering the LLM API,
    running up cost, and flagging mid-sentence false positives. Now debounced (~1.5 s idle, pending
    checks cancelled on each change). Error handling was already adequate: each of the four parallel
    calls has a `.catch` fallback and the whole pass is wrapped in `try/catch`.

11. **Offline + versioned compliance rules.**
    Compliance/audit checks (`src/components/compliance/UnifiedComplianceEngine.jsx`, `src/components/audit/AIDocumentationAudit.jsx`)
    are LLM-only and break offline. Add a lightweight client-side rule pass (homebound present?
    vitals present? abbreviations expanded?) and add `effective_date`/`cms_reference`/version to
    `MedicareComplianceRule` so each note records which rule version judged it. Add an
    override/waiver path ("patient refused — documented") so valid exceptions stop re-flagging.

12. **Enforce the state-reportable incident workflow.**
    `src/components/incident/` collects incidents but doesn't auto-classify state-reportable events
    or enforce the typical 24-h reporting deadline, and has no status tracking or de-dup. Add
    auto-classification + deadline banner, post-submission status (pending→in-progress→closed),
    duplicate detection, draft auto-save, and confirmed alert delivery/acknowledgement.

13. **Close the training-certificate RLS gap.**
    Per `SECURITY-RLS-CHECKLIST.md §2/§8`, `TrainingCertificate` is still client-writable; set
    `INTERNAL_FN_SECRET` and route writes only through the `gradeTrainingAttempt` backend function
    to prevent forged certificates. Complete the deferred IDOR audit on patient-scoped functions
    (`predictPatientRisks`, `analyzeClinicalRisks`, `generatePatientChartPDF`, `getScopedPatientAlerts`).

14. **Concurrency safety on shared records.**
    OASIS approval (`src/components/oasis/OASISApprovalWorkflow.jsx`) and patient/visit edits use read-modify-write
    with no optimistic locking, and patient create has no uniqueness guard → lost updates and
    duplicate patients. Add version/`updated_date` checks and a server-side uniqueness constraint
    (name+DOB+address). This also backs the existing **DuplicatePatients** page.

15. **Replace toast-only failures with a retry queue.**
    Fax/SMS/time-off/incident failures surface a single auto-dismissing toast with no client-side
    retry (e.g. `src/components/fax/FaxDashboard.jsx:70`, `src/components/messaging/SmsThreadView.jsx:56-63`). Add a persisted
    "unsent" queue that retries on reconnect, plus **exponential backoff on outbound-fax retries**
    keyed to the actual `failure_reason` (don't retry "invalid number"; back off "busy").

## P2 — Nurse workflow & operations features

16. **Voicemail transcription + richer duty status.**
    `src/components/voice/CallbackQueue.jsx` plays voicemail audio but offers no transcript; duty
    status is binary (`src/components/voice/DutyStatusCard.jsx`). Add async speech-to-text on
    voicemails, a multi-state duty dropdown (on-break / in-visit / lunch / off), and a callback SLA
    timer with escalation. (A live Twilio connectivity probe already exists — `PhoneProvisioningPanel`
    invokes the `testTwilioConnection` backend function — so that gap is already covered.)

17. **Messaging upgrades.**
    Add read receipts, group/broadcast SMS (by diagnosis or last-visit age), keyword auto-replies
    (confirm visit, pain check), extensible merge fields, and "export thread to chart." Note that
    `src/components/messaging/smsTemplates.js:43-48` already strips the dangling space when a merge
    field is empty (renders `"Hi,"`, not `"Hi ,"`), so the residual gap is just the missing
    personalization — optionally warn the nurse when a referenced merge field has no value rather
    than silently sending an unpersonalized greeting.

18. **Scheduling & time-off visibility.**
    `src/components/scheduling/AIScheduleOptimizer.jsx` collects feedback that is never persisted or
    used — wire it up, and add soft constraints (nurse/patient preferences, continuity) plus
    pre-assignment conflict checks against approved time off. In `src/components/timeoff/`, surface
    accrual progress and carryover-expiration warnings (logic already exists in
    `src/components/timeoff/timeOffUtils.js`), and show coverage
    impact in the approval queue.

19. **Outbound-fax operational polish.**
    Keep faxing outbound-only. Improve it with: batch send (one document to multiple referring
    physicians), delivery-proof detail (sent vs delivered timestamps), an escalation task after the
    final failed retry instead of a lone toast, and CSV-import validation/de-dup in
    `src/components/fax/FaxAddressBook.jsx` (validate fax-number format, skip-and-continue on bad rows).

20. **Real system telemetry** **[verified: metrics are synthetic]**.
    `src/components/admin/SystemHealthMonitor.jsx:22-25` generates API response/uptime/error via
    `Math.random()` (labeled "simulated for demo"). Replace with real backend telemetry and add
    real-time degradation alerts (email/SMS). Make the user activity log searchable/exportable for
    HIPAA/SOC2, and add bulk user operations + an active-invitations view to `src/components/admin/UserManagement.jsx`.

## P3 — Code health & long-term reliability

21. **Add a shared AI-call hook** **[foundation implemented]**.
    ~200 files called `InvokeLLM` with no shared timeout/retry/error policy. Added
    `src/lib/aiCall.js` (pure, unit-tested timeout + exponential-backoff retry with a sensible
    "don't retry auth/credit/4xx" classifier) and the `src/hooks/useAICall.js` hook on top
    (loading/error/data state, stale-response guarding). Tests live in `src/lib/aiCall.test.js`
    and run under `npm run test:utils`. Adopters so far: `MedicationInteractionChecker.jsx`
    (30 s timeout, 2 retries) and `carePlan/AICarePlanGenerator.jsx` (45 s timeout, 2 retries).
    **Next:** continue incremental adoption at the remaining compliance/OASIS call sites. Still
    open: the `useWorkflowExecution` hook recommended in `COMPREHENSIVE_APP_REVIEW.md`.

22. **Decompose mega-components.**
    `src/components/visit/OASISScrubber.jsx` (4,146 lines), `src/pages/OASISAnalyzer.jsx` (3,162),
    `src/components/oasis/AutomatedPDGMNavigator.jsx` (2,278),
    `src/components/visit/QuickTemplatesLibrary.jsx` (1,969). At minimum extract pure logic into
    `.js` modules with unit tests (the pattern already used for
    `src/components/oasis/oasisScoringEngine.js`), splitting OASIS upload/extract/analyze/save phases.

23. **Delete SmartNote dead code.**
    `SMARTNOTE_REVIEW.md` documents ~122 orphan components (with ~72 unused `InvokeLLM` prompts)
    shipping in the bundle. Remove in one build-verified PR to cut bundle size, lint noise, and
    onboarding burden.

24. **Raise the testing floor.**
    Test coverage is ~0.7% of LOC and limited to utilities. Add the three workflow-engine
    integration tests from `COMPREHENSIVE_APP_REVIEW.md` (no-trigger / partial-failure /
    dup-prevention) and smoke tests for the core journeys: patient intake, referral→admission,
    OASIS upload→export, document signing, outbound fax send+retry, training completion.

25. **Pay down lint/typecheck debt and unify severity vocabulary.**
    `PHASE2_REVIEW.md` reported 631 lint issues; expand `typecheck` scope to `src/lib` + `src/api`
    and run a full eslint sweep targeting <100 issues. Separately, unify the severity scales that
    currently diverge across modules (OASIS high/medium/low vs drug critical/major/moderate vs risk
    Very-High…Low) onto one Critical/High/Medium/Low/None scale to prevent nurse misreads.

---

## Suggested sequencing

- **Sprint 1 (safety):** items 1–4 (small, verified, high-risk), then 5–6.
- **Sprint 2 (cost/compliance):** items 10, 13, 12.
- **Then:** work down P1 reliability (11, 14, 15) and pull P2/P3 items by business priority.

The P0 list is deliberately front-loaded with low-effort, high-impact fixes (several are a few
lines) that reduce real patient-safety and Medicare-compliance exposure.
