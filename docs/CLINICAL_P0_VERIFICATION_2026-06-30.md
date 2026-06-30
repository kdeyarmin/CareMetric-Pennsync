# Clinical P0 verification — 2026-06-30

A re-verification of every **P0** item in `NURSE_APP_IMPROVEMENTS.md` (dated
2026-06-03) against the **current** code. The codebase moved a month past that
review, so each item was re-checked at the source before any change.

**Result: the entire P0 list is closed — every item is already resolved, made
moot by later refactors, or is a defensible current design. No code change is
warranted; changing the working clinical flows to match the stale review would
*reduce* safety, not improve it.** Evidence per item below (file:line on `main`).

| # | P0 item | Status | Evidence |
|---|---------|--------|----------|
| 1 | Readmission-risk `ReferenceError` (`comorbidityCount`) | **Fixed + dead** | `patient/HospitalReadmissionRisk.jsx:136,151` now use `_comorbidityCount` consistently (no bare `comorbidityCount` to throw). The component is also orphaned (no importer) — unreachable. |
| 2 | AI note persisted as "verified" when grounding skipped (offline) | **Addressed** | `smartNote/ConstrainedNoteReviewer.jsx`: a deterministic offline `valueGuard` (188) blocks invented values even offline; the offline path sets `fixRequired.offlinePending` (208) so `finalApi.verified` is **false** (347); a "Verification pending — review before pasting into EMR" banner shows (476); grounding **auto-runs on reconnect** (275-290). `persistVisitNote.js` stamps no "verified" flag, so no false claim is persisted. |
| 3 | `functional_baseline` in note carry-forward | **Fixed** | `compliance/requiredElements.js:299-302` — `CARRY_FORWARD` is `{homebound, diagnoses, allergies, emergency_plan, advance_directives, terminal_prognosis, benefit_period}`; `functional_baseline` is **absent**, with a comment documenting the anti-cloning rationale. |
| 4 | Auto-append "was not documented" sentences | **Defensible design** | `ConstrainedNoteReviewer.jsx:147-152,408` — the literal *"Not documented this visit"* is added only for **non-critical** elements (criticals are hard-blocked before generation, 215-219) and is explicitly labelled in the UI. It states a documentation gap, not a fabricated clinical negative; the nurse can instead confirm a standard negative. Not a bug. |
| 5 | Vital plausibility + critical-value escalation | **Addressed** | Plausibility validation implemented (per the review itself). Critical-vital **escalation is live** in the note flow: `detectNoteCriticalVitals` + a "Create provider follow-up task" action (`ConstrainedNoteReviewer.jsx:357-376`). |
| 6 | Visit-completion pre-flight checks | **Moot** | `visit/VisitCompletionButton.jsx` no longer exists; the flow was refactored. |
| 7 | "Verify-before-use" gate on AI clinical content | **Addressed** | The note flow has an extensive verification surface — value-guard, grounding, a green "verified against what you wrote" gate, dirty-state re-check, and a per-sentence provenance panel (`ConstrainedNoteReviewer.jsx:500-533`). OASIS output is validated via the live `OASISValidationPanel`. |
| 8 | Harden medication interaction safety / disclaimer | **Moot** | `medication/MedicationInteractionChecker.jsx` no longer exists; `medication/drugInteractions.js` has no live consumer. There is no live medication-interaction UI to harden. |
| 9 | OASIS ↔ care-plan consistency guard | **Moot** | The Care Plans feature (pages, builder, components, entities) was removed; there is no care plan to cross-check. |

## Method

For each item: located the cited file/symbol in the current tree, read the
surrounding logic, and classified as Fixed / Addressed / Defensible / Moot with a
`file:line` citation. No behavioral change was made to any clinical flow.

## Recommendation

- **Retire the P0 section of `NURSE_APP_IMPROVEMENTS.md`** (or annotate each item
  with the status above) so a closed list doesn't keep reading as open risk.
- The only *optional, additive* enhancement noted (not a safety bug): persist a
  `grounding_pending` marker on offline-saved notes so an auditor can see grounding
  was deferred. Today the saved record makes no "verified" claim either way, so this
  is audit-completeness polish, not a correctness fix — left for a deliberate
  decision rather than bundled here.
