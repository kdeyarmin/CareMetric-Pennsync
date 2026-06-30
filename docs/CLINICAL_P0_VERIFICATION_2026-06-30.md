# Clinical P0 verification — 2026-06-30

A re-verification of every **P0** item in `docs/NURSE_APP_IMPROVEMENTS.md` (dated
2026-06-03) against the **current** code. The codebase moved a month past that
review, so each item was re-checked at the source before any change.

**Result: most of the P0 list is closed — resolved, made moot by later refactors,
or a defensible current design — but two items are NOT fully closed and remain
applicable: #2 (offline note audit marker) and #9 (OASIS ↔ care-plan consistency).**
Those two are tracked as follow-ups below rather than retired. Evidence per item
(file:line on `main`).

| # | P0 item | Status | Evidence |
|---|---------|--------|----------|
| 1 | Readmission-risk `ReferenceError` (`comorbidityCount`) | **Fixed + dead** | `src/components/patient/HospitalReadmissionRisk.jsx:136,151` now use `_comorbidityCount` consistently (no bare `comorbidityCount` to throw). The component is also orphaned (no importer) — unreachable. |
| 2 | AI note persisted as "verified" when grounding skipped (offline) | **Partially addressed — follow-up open** | The *false* "verified" claim is closed: `src/components/smartNote/ConstrainedNoteReviewer.jsx` runs a deterministic offline `valueGuard` (188) that blocks invented values even offline; the offline path sets `fixRequired.offlinePending` (208) so `finalApi.verified` is **false** (347); a "Verification pending — review before pasting into EMR" banner shows (476); grounding **auto-runs on reconnect** (275-290); and `src/components/smartNote/persistVisitNote.js` stamps no "verified" flag. **Remaining gap:** the offline branch (`persistVisitNote.js:60-71`) queues the visit with `status: "completed"` and **no grounding-deferred marker**, and `src/pages/SmartNoteAssistant.jsx:711` intentionally leaves Save **enabled** while `offlinePending` is true. So an offline-saved note becomes a completed visit with nothing on the record showing live grounding was deferred until reconnect — an audit-trail completeness gap (see follow-ups). |
| 3 | `functional_baseline` in note carry-forward | **Fixed** | `src/components/smartNote/compliance/requiredElements.js:299-302` — `CARRY_FORWARD` is `{homebound, diagnoses, allergies, emergency_plan, advance_directives, terminal_prognosis, benefit_period}`; `functional_baseline` is **absent**, with a comment documenting the anti-cloning rationale. |
| 4 | Auto-append "was not documented" sentences | **Defensible design** | `src/components/smartNote/ConstrainedNoteReviewer.jsx:147-152,408` — the literal *"Not documented this visit"* is added only for **non-critical** elements (criticals are hard-blocked before generation, 215-219) and is explicitly labelled in the UI. It states a documentation gap, not a fabricated clinical negative; the nurse can instead confirm a standard negative. Not a bug. |
| 5 | Vital plausibility + critical-value escalation | **Addressed** | Plausibility validation implemented (per the review itself). Critical-vital **escalation is live** in the note flow: `detectNoteCriticalVitals` + a "Create provider follow-up task" action (`src/components/smartNote/ConstrainedNoteReviewer.jsx:357-376`). |
| 6 | Visit-completion pre-flight checks | **Moot** | `src/components/visit/VisitCompletionButton.jsx` no longer exists; the flow was refactored. |
| 7 | "Verify-before-use" gate on AI clinical content | **Addressed** | The note flow has an extensive verification surface — value-guard, grounding, a green "verified against what you wrote" gate, dirty-state re-check, and a per-sentence provenance panel (`src/components/smartNote/ConstrainedNoteReviewer.jsx:500-533`). OASIS output is validated via the live `OASISValidationPanel`. |
| 8 | Harden medication interaction safety / disclaimer | **Moot** | `src/components/medication/MedicationInteractionChecker.jsx` no longer exists; `src/components/medication/drugInteractions.js` has no live consumer. There is no live medication-interaction UI to harden. |
| 9 | OASIS ↔ care-plan consistency guard | **Still applicable — follow-up open** | **Not moot.** The `CarePlan` entity and an OASIS→care-plan write path are live: `src/components/hub-tabs/SmartOASISAssessment.jsx:224-268` reads existing care plans (`base44.entities.CarePlan.filter`, 226) and **creates** care-plan records from OASIS-derived interventions (`base44.entities.CarePlan.create`, 258). The standalone Care Plans *page/builder* was removed, but the entity and the assessment-driven creation remain, so the original concern — keeping the generated care plan consistent with the OASIS findings that produced it — still has a real target (see follow-ups). |

## Method

For each item: located the cited file/symbol in the current tree, read the
surrounding logic, and classified as Fixed / Addressed / Defensible / Moot /
Still-applicable with a repo-root `file:line` citation. No behavioral change was
made to any clinical flow in this PR.

## Open follow-ups (the two items above that are NOT closed)

These are intentionally **not** bundled into this verification PR — each is a
deliberate, additive change, called out here so the list reflects real residual
risk rather than reading as fully closed:

1. **#2 — offline-note audit marker.** Persist a `grounding_pending` (or
   equivalent) marker on offline-saved notes so an auditor can see live grounding
   was deferred until reconnect. Today the saved record makes no "verified" claim
   either way, but it also carries no "grounding deferred" signal while sitting as
   a `completed` visit. This is audit-completeness, not a false-claim correctness
   bug — but it is not "closed", so it stays open.
2. **#9 — OASIS ↔ care-plan consistency guard.** Because `SmartOASISAssessment`
   still creates `CarePlan` records from OASIS-derived interventions, a guard that
   flags drift between the OASIS findings and the care plan they generated is still
   warranted. Scope it against the live `CarePlan` entity and the OASIS assessment
   flow.

## Recommendation

- **Annotate** the P0 section of `docs/NURSE_APP_IMPROVEMENTS.md` with the status
  above rather than retiring it wholesale — items #2 and #9 are still open, so a
  blanket "closed" would understate residual risk.
- Treat the two follow-ups above as the remaining P0 work.
