# Phase 2 — Merge Document Visit into Smart Notes (design)

_Status: design / not yet implemented. Companion to
`DOCUMENTATION_CONSOLIDATION_PLAN.md` (read that first for the why)._

## Decision

**Smart Note Assistant is the surviving page.** It owns the deterministic
compliance engine and the constrained Q&A reviewer — the rigor we want every
visit note to get. Document Visit's value is its *entry point* (you arrive at an
existing scheduled visit) and a handful of field-capture features, not its
free-text-plus-AI-polish save path. So we teach Smart Notes to **attach to an
existing visit**, bring over Document Visit's must-have features, redirect its
links, and retire the page.

> One engine. `?visitId=` means "attach to this scheduled visit"; its absence
> means "compose a new one." Everything else is the same flow.

## What exists today (verified)

- `src/pages/SmartNoteAssistant.jsx`
  - **Reads no URL params at all** (no `useSearchParams`/`window.location`). So
    the referral deep-links that already point here (`?patient_id=`,
    `?referral_id=`, `?visit_type=` — see inventory) are silently ignored today.
    Fixing that is a Phase 2 bonus.
  - State init at `:58-84`; `serviceLine` derived from `currentUser.care_scope`
    (`:84`) — **not** `patient.care_type` (Phase 1 used the patient on Document
    Visit; we should unify on the patient, see Slice 4).
  - `persistNote` already branches **create vs. update** on `savedVisitId`
    (`:249-297`) and writes `Visit` + `Patient.clinical_notes` /
    `enhanced_notes_history` + `NoteConversion` + `ComplianceAudit`.
  - `startReview` (`:199-204`) clears `savedVisitId` → always create mode.
  - Restores patient/draft from `sessionStorage` on mount (`:120-153`) — URL
    params must take precedence over this.
- `src/pages/DocumentVisit.jsx`
  - Access gate `canAccessVisit(visitId)` + `logSecurityEvent` (`:107-125`).
  - Lifecycle: `scheduled → in_progress` with `start_time` stamp on load
    (`:196-203`); `→ completed` + `end_time` + `VISIT_DOCUMENTATION_COMPLETED`
    + `trackVisitCompletion` on save.
  - Unique feature imports at `:15-56`.
- Routing
  - `src/routes.jsx`: `ROUTES` derive from `NAV_MANIFEST`; a page is reachable
    iff it has a manifest entry **and** a `src/pages/<Name>.jsx` file.
  - `REDIRECTS` table (`:67-80`) renders as **static** `<Navigate to replace>`
    (`App.jsx:123`) → **drops query strings**. A bare
    `{from:'/DocumentVisit', to:'/SmartNoteAssistant'}` would lose `?visitId=`.
  - `createPageUrl` just lowercases the name; React Router matches
    case-insensitively.

## Feature parity: what moves, what's dropped

| Document Visit feature | Disposition |
|---|---|
| `canAccessVisit` gate + security logging | **MUST port** (HIPAA-relevant) |
| `scheduled → in_progress → completed` + start/end time | **MUST port** (attach mode) |
| Structured vitals form (`SmartVitalsInput`) | **SHOULD** — already shared; offer in attach mode |
| 30s autosave + offline `saveUpdate` | **SHOULD** — Smart Notes has draft autosave to sessionStorage/IndexedDB; reconcile |
| Scanned documents | **SHOULD** — small, keep |
| Voice commands, AI template gen, audio→narrative merge, care-plan progress, vitals-vs-previous, one-click actions | **EVALUATE** — several flagged lower-trust in `AI_TRUSTWORTHINESS_AUDIT.md`; bring only high-value ones as optional input methods, drop the rest. Not blockers for retirement. |

## Deep-link inventory to update (from Phase 1 doc)

Point these at `/SmartNoteAssistant` with normalized params, then add the
query-forwarding shim for bookmarks:
- `DocumentVisit?visitId=` → `ComplianceAlertAggregator.jsx:69`, `PatientDetails.jsx:660`
- `DocumentVisit?patientId=&template=` → `TemplateLibrary.jsx:42`
- Smart Note links with mixed params (`patient_id` vs `patientId`, `referral_id`,
  `referral_data`) → `ReferralProcessor.jsx`, `ReferralAdmissionNote.jsx:195`,
  `ReferralIntake.jsx:1256,1277`, `PatientDataManagement.jsx:573`,
  `QuickActionsPanel.jsx:57`. Normalize on a single param contract (below).

### Param contract for the unified page

`/SmartNoteAssistant?` accepts (all optional):
- `visitId` — attach mode (load + access-gate + lifecycle + update-on-save).
- `patientId` — preselect patient (accept legacy `patient_id` too).
- `visitType` — preselect type (accept legacy `visit_type`).
- `template` — prefill the draft with template text.
- `referralId` / `referralData` — prefill from a referral (accept legacy
  `referral_id` / `referral_data` / `referral_mode`).

## Sequenced slices (each independently shippable + reversible)

**Slice 1 — URL-param ingestion (no behavior removed).**
Add a mount effect to `SmartNoteAssistant` that reads the param contract and
seeds `patientId` / `visitType` / `note` (template/referral). URL params take
precedence over the `sessionStorage` restore. This alone **fixes the currently
dead referral/template deep-links.**
_Accept:_ opening `/SmartNoteAssistant?patientId=X&visitType=admission`
preselects them; no regression to the blank-entry flow.

**Slice 2 — Attach mode (`?visitId=`).**
On `visitId`: enforce `canAccessVisit` (port the gate + logging), load the
`Visit`, seed `patientId`/`visitType`, prefill `note` from `nurse_notes`, set
`savedVisitId = visitId` up front, advance `scheduled → in_progress` + stamp
`start_time`. Extend `persistNote`'s update branch to also set
`status: 'completed'` + `end_time`, log `VISIT_DOCUMENTATION_COMPLETED`, and
call `trackVisitCompletion` when in attach mode.
_Accept:_ `/SmartNoteAssistant?visitId=V` loads the scheduled visit, runs the
compliance reviewer on its existing note, and Save updates **that** visit
(no duplicate) with the full audit trail; unauthorized access is blocked + logged.

**Slice 3 — Repoint in-app deep links.**
Update the call sites above to `/SmartNoteAssistant` with the normalized params.
_Accept:_ every former Document Visit / referral entry point lands on Smart
Notes with the right context.

**Slice 4 — Unify service-line + bring must-have field features.**
Derive `serviceLine` as `patient?.care_type` → `currentUser.care_scope` →
`home_health` (consistent with Phase 1). Surface the structured vitals form and
scanned-docs in attach mode; reconcile autosave/offline.
_Accept:_ a hospice patient scores against hospice elements regardless of the
clinician's `care_scope`; vitals/offline parity holds.

**Slice 5 — Retire Document Visit.**
Replace `src/pages/DocumentVisit.jsx` with a thin **query-forwarding redirect
shim** (`<Navigate to={'/SmartNoteAssistant?' + forwardedParams} replace />`,
mapping `visitId`/`patientId`/`template`). Keep its manifest entry so
`/DocumentVisit?visitId=…` bookmarks still resolve and forward. Delete the old
~1.7k-line implementation and its now-unused feature imports.
_Accept:_ `/DocumentVisit?visitId=V` forwards to the unified page with `V`
intact; no PageNotFound; bundle shrinks.

**Slice 6 (later) — Remove the shim.**
Once analytics show negligible direct `/DocumentVisit` hits, drop the shim +
manifest entry and add a plain `REDIRECTS` entry for any bare bookmarks
(query no longer needed by then).

## Risks & mitigations

- **Access-control regression (highest).** Attach mode must gate every
  `visitId` open exactly as Document Visit does. Mitigation: port `canAccessVisit`
  verbatim; Slice 2 acceptance test includes the unauthorized path.
- **Duplicate visits.** Attach mode must `update`, never `create`. Mitigation:
  seed `savedVisitId` before the reviewer mounts; reuse the existing update branch.
- **sessionStorage clobbering URL context.** A stale saved patient could override
  `?visitId=`. Mitigation: when any URL param is present, skip the
  `SAVED_PATIENT_KEY`/`DRAFT_KEY` restore.
- **Lost query on redirect.** Covered by the forwarding shim (not a `REDIRECTS`
  entry) in Slice 5.
- **Feature-loss surprise.** The "EVALUATE" features get an explicit keep/drop
  decision in Slice 4 rather than silent removal.

## Out of scope

`VisitScribe`, `MedicalScribe`, `RealTimeDictationScribe`, and the Offline
documentation pages — same as Phase 1.
