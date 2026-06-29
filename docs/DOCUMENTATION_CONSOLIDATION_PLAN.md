# Documentation Surfaces Consolidation Plan

_Status: Phase 1 in progress. Author-facing doc; not a user manual._

## Why this exists

The app has three places a nurse can produce a visit narrative. They look like
three features but are really **three doorways onto one data model**. The only
real differences are *where the nurse starts from* and *how much compliance
machinery runs on save*. This doc records the differences, the end-state we
want, and the phased path to get there safely.

## The three surfaces today

| Surface | File | Starts from | What it's for |
|---|---|---|---|
| **Clinical Documentation** (hub) | `src/pages/ClinicalDocumentation.jsx` | n/a — it's a tabbed launcher | Picks a method; its first tab literally renders `SmartNoteAssistant` (`ClinicalDocumentation.jsx:7,38`) |
| **Smart Note Assistant** | `src/pages/SmartNoteAssistant.jsx` | A blank/rough draft; patient optional | *Compose* a compliant note from scratch (creates a new `Visit`) |
| **Document Visit** | `src/pages/DocumentVisit.jsx` | An existing `visitId` (a scheduled visit) | *Complete/finalize* a pre-existing visit |

"Clinical notes" itself is not a feature — it's the **destination field**
`Patient.clinical_notes` (`base44/entities/Patient.jsonc:178`), with a running
log in `Patient.enhanced_notes_history` (`:187`). Both surfaces above ultimately
produce a `Visit.nurse_notes` (`base44/entities/Visit.jsonc:46`).

## The gap (what makes them feel inconsistent)

`SmartNoteAssistant.persistNote()` (`SmartNoteAssistant.jsx:233-297`) writes a
**fully-audited** record on save:

- `Visit.nurse_notes` + a **deterministic** `compliance_score`
- `Patient.clinical_notes` + appends `enhanced_notes_history`
- `NoteConversion` (before/after metrics)
- `ComplianceAudit` (the audit trail)

`DocumentVisit.handleSave()` (`DocumentVisit.jsx:915-985`) only does the first
half — it `secureUpdate`s the `Visit` (`:946`) and **never computes a score**
(`DocumentVisit.jsx:969` literally reads `compliance_score: null, // Will be
filled by compliance checker`). It does **not** touch `Patient.clinical_notes`,
`enhanced_notes_history`, `NoteConversion`, or `ComplianceAudit`.

So a note finalized via Document Visit is invisible to the patient-level
`clinical_notes` field and skips the deterministic compliance gate that Smart
Notes applies. Same data model, two different levels of rigor.

## End state we want

> **One authoring engine. The entry point only decides whether you're attaching
> to an existing scheduled visit or creating a new one.**

The deterministic compliance engine already lives in
`src/components/smartNote/compliance/` (pure, offline, unit-tested):
`normalizeDraft` → `getRequiredElements` → `detectPresence` →
`computeCoverageScore` / `deriveStructuredVisitFields` / `toNoteConversionFields`.
Consolidation means **every doorway runs that same engine and writes the same
records.**

## Phased path

### Phase 1 — Unify the engine (this PR). Low risk, additive, no routing change.

Make Document Visit produce **identical, fully-audited output** to Smart Notes,
without disturbing its UI, its access control, or its status lifecycle.

- New pure helper `src/components/smartNote/compliance/scoreNoteFromText.js`
  (+ `node:test` unit test): wraps the existing engine into a single
  `scoreNoteFromText({ text, serviceLine, visitType })` →
  `{ coverageScore, draftScore, presence, required, structured }`. Reuses the
  exact functions Smart Notes uses, so scores are computed the same way.
- `DocumentVisit.handleSave()` now:
  - computes a real `compliance_score` from the finalized narrative and stores
    it (plus the structured `homebound_*` / `skilled_intervention_documented`
    fields) on the `Visit`;
  - propagates the note to `Patient.clinical_notes` + `enhanced_notes_history`;
  - writes `NoteConversion` + `ComplianceAudit` via the same
    `toNoteConversionFields` mapper Smart Notes uses;
  - passes the real score to `trackVisitCompletion` (was hard-coded `null`).

Safety properties of Phase 1:
- **Additive.** The existing `Visit` write, `canAccessVisit` gate
  (`DocumentVisit.jsx:107-125`), `VISIT_DOCUMENTATION_COMPLETED` logging, offline
  path, autosave, and status transitions are untouched.
- **Non-blocking.** The new patient/audit writes are wrapped so a failure there
  can never fail an already-saved, completed visit.
- **No empty-overwrite.** Patient `clinical_notes` is only updated when the
  finalized narrative is non-empty, so a blank completion can't wipe the chart.
- **Service line aware.** Derived from `User.care_scope` (`base44/entities/User.jsonc:5`),
  matching `SmartNoteAssistant.jsx:81`.

### Phase 2 — Unify the page (future, separate PR). Medium risk.

> **Detailed design:** see `DOCUMENTATION_CONSOLIDATION_PHASE2.md` (decision:
> Smart Note Assistant is the surviving host; sequenced slices + risks).

Collapse to one route that accepts **either** an existing `visitId` **or**
patient/referral context:

- On the `visitId` path, preserve `canAccessVisit` + the security logging and the
  `scheduled → in_progress → completed` lifecycle (`DocumentVisit.jsx:189-205`).
- On the new-note path, keep the create-or-update branch that already exists in
  `SmartNoteAssistant.persistNote()` (`:249-268`).
- Promote the Phase 1 audit/patient writes into a single shared persistence
  function that **both** entry paths call (full DRY).
- Normalize/redirect the deep links below, then retire the second page.

#### Deep-link inventory (must keep working via redirect)

`DocumentVisit`:
- `src/components/compliance/ComplianceAlertAggregator.jsx:69` — `?visitId=`
- `src/pages/PatientDetails.jsx:660` — `?visitId=`
- `src/pages/TemplateLibrary.jsx:42` — `?patientId=&template=` *(already
  inconsistent — DocumentVisit is built around `visitId`, not `patientId`)*

`SmartNoteAssistant`:
- `src/components/patient/QuickActionsPanel.jsx:57`
- `src/pages/ReferralProcessor.jsx:162,414`
- `src/pages/ReferralAdmissionNote.jsx:195` — `?patient_id=&visit_type=admission&referral_mode=...`
- `src/pages/PatientDataManagement.jsx:573` — `?patientId=`
- `src/pages/ReferralIntake.jsx:1256,1277` — `?referral_id=`

The inconsistent params are themselves an argument for consolidating.

### Explicitly out of scope

`VisitScribe`, `MedicalScribe`, `RealTimeDictationScribe`, and the Offline
documentation pages also emit visit notes. Folding those in is a separate effort;
pulling them into this plan would turn a focused merge into a big-bang refactor.
