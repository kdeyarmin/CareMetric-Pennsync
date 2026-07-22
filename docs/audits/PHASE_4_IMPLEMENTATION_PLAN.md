# Phase 4 Implementation Plan

_Audit follow-up date: 2026-07-22. Scope: Phase 4 strategic new-feature foundations only. Phase 5 enterprise/scaling work is excluded._

## Phase 4 goals

- Add safe, repository-verifiable foundations for the two strategic Phase 4 backlog items without creating production patient-facing access or unaudited clinical automation.
- Make patient-portal readiness explicit before any portal route, token flow, or hosted Base44 permissions are implemented.
- Make predictive/documentation-defense recommendations explainable, reviewable, and auditable before wiring them into clinical workflows.

## Included backlog IDs

| ID | Item | Phase 4 interpretation |
|---|---|---|
| P3-01 | Add lightweight patient portal | Implement a pure access/readiness contract for patient portal capabilities, consent, token scope, status, and missing setup prerequisites. |
| P3-05 | Add explainable risk/documentation-defense engine | Implement pure evidence normalization, alert validation, and clinician decision/audit helpers for risk/documentation-defense alerts. |

## Excluded items

- P3-04 SSO and enterprise audit export; this remains Phase 5 scope.
- P4-01 through P4-05 scaling, release-process, glossary, and polish work; these remain Phase 5 or later technical-debt scope.
- Live patient portal authentication, public portal routes, hosted Base44 permission policy, email/SMS invitations, and patient/caregiver account management; these require security/product decisions and hosted credentials.
- Production predictive model training, automated care-plan changes, or autonomous clinical decisions.

## Current state after revalidation

| Feature | Current state | Evidence reviewed |
|---|---|---|
| Patient-facing access | Public token pages exist for signer, telehealth join, and provider follow-up, but no general patient portal capability/consent contract exists. | `src/pages/SignerPortal.jsx`, `src/pages/JoinTelehealth.jsx`, `src/pages/ProviderFollowUpPortal.jsx`, `docs/audits/IMPLEMENTATION_ROADMAP.md` |
| Patient education/documents/messages | Staff-facing education, document, and messaging modules exist, but patient-visible scope is not centrally defined. | `src/pages/PatientEducationHub.jsx`, `src/pages/DocumentHub.jsx`, `src/pages/Messages.jsx` |
| Predictive/risk workflows | Predictive and alert UI exists, and Phase 3 added AI provenance helpers, but risk alerts lack a shared evidence/decision contract. | `src/pages/PredictiveAnalytics.jsx`, `src/components/alerts/*`, `src/lib/aiProvenanceRegistry.js` |
| Phase 3 foundations | AI provenance, denial feedback, and FHIR-lite helpers are present and tested. | `docs/audits/PHASE_3_COMPLETION_REPORT.md`, related utility tests |

## Proposed changes

### Batch 1: Patient portal readiness foundation

- Add `src/components/portal/patientPortalAccess.js` with:
  - canonical portal capability keys;
  - token/account/consent/status normalization;
  - least-privilege capability evaluation;
  - patient-safe profile projection that omits staff/internal fields;
  - audit-event helper for future portal access logging.
- Add `src/components/portal/patientPortalAccess.test.js` covering allowed access, missing consent, expired/revoked token, guardian/caregiver scope, and PHI-safe projection.

### Batch 2: Explainable risk/documentation-defense foundation

- Add `src/components/predictive/explainableRisk.js` with:
  - evidence normalization requiring source type, source id, summary, date, and confidence;
  - alert validation requiring patient id, category, severity, recommendation, evidence, and provenance id;
  - safe alert normalization sorted by severity and confidence;
  - clinician decision/audit helper for accepted, overridden, dismissed, and escalated outcomes.
- Add `src/components/predictive/explainableRisk.test.js` covering valid alerts, missing evidence/provenance rejection, status decisions, PHI-minimized display rows, and severity ordering.

### Batch 3: Documentation and test-script wiring

- Update `package.json` `test:utils` so new tests run in the standard utility suite.
- Update `IMPROVEMENT_BACKLOG.md`, `FEATURE_INVENTORY.md`, `IMPLEMENTATION_ROADMAP.md`, and `QUICK_WINS.md` with Phase 4 status and remaining limitations.
- Create `PHASE_4_COMPLETION_REPORT.md` with commands, validation results, and manual verification requirements.

## Files and modules likely affected

- `src/components/portal/patientPortalAccess.js`
- `src/components/portal/patientPortalAccess.test.js`
- `src/components/predictive/explainableRisk.js`
- `src/components/predictive/explainableRisk.test.js`
- `package.json`
- `docs/audits/IMPROVEMENT_BACKLOG.md`
- `docs/audits/FEATURE_INVENTORY.md`
- `docs/audits/IMPLEMENTATION_ROADMAP.md`
- `docs/audits/QUICK_WINS.md`
- `docs/audits/PHASE_4_COMPLETION_REPORT.md`

## Database changes

No Base44 entity schema changes are planned in this repository-only slice. Production portal access and explainable risk workflows will likely require persisted consent, portal sessions/invitations, risk alerts, clinician decisions, and audit logs after product/security review.

## API changes

No hosted functions or API endpoints are planned in this slice. Future APIs must enforce patient/caregiver identity, tenant isolation, token scope, consent, and role-based staff review permissions server-side.

## Permission changes

No runtime permissions are changed. The new helpers encode least-privilege readiness and decision contracts for future endpoint/UI work.

## UI changes

No new patient portal route, invitation UI, or predictive dashboard UI is planned in this slice. This avoids exposing unfinished strategic features to users.

## Testing requirements

- Focused Node tests for the new Phase 4 helpers.
- Standard utility suite after script wiring.
- Lint, typecheck, production build, and full test suite.
- Document live verification blocked by missing hosted Base44 patient-facing auth, consent policy, and clinical validation board.

## Dependencies and risks

- Patient portal scope requires product/security decisions about patient vs caregiver access, consent revocation, proxy access, MFA, and data categories.
- Explainable risk/documentation-defense recommendations require clinical governance, provenance retention rules, and review workflows before being shown in production.
- Adding only foundations may not improve end-user workflows until Phase 4 UI/API decisions are approved.

## Recommended implementation order

1. Patient portal readiness foundation and tests.
2. Explainable risk/documentation-defense foundation and tests.
3. Wire tests and run focused validation.
4. Update audit/backlog/roadmap documents.
5. Run full validation matrix.

## Rollback considerations

- New helper modules are not imported by production UI in this slice, so rollback is limited to removing the new files, package script additions, and documentation updates.
- No data migrations or hosted API changes are introduced.

## Acceptance criteria

- P3-01 has a tested readiness/access contract for portal capabilities, consent, token status, expiration, relationship scope, and patient-safe projection.
- P3-05 has a tested explainable-alert contract that refuses alerts without evidence and provenance and records clinician decisions.
- No Phase 5 items are started.
- Documentation records implemented repo-side status, remaining limitations, validation commands, and manual verification required.
