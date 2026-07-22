# Phase 3 Implementation Plan

_Audit follow-up date: 2026-07-22. Scope: Phase 3 reporting, automation, and integrations only. Phase 4 strategic features and Phase 5 enterprise/scaling work are explicitly excluded._

## Phase 3 goals

Add repository-verifiable foundations that turn existing operational and clinical data into safer reporting/integration workflows: AI output provenance normalization, billing/denial feedback mapping, and an EHR/FHIR-lite import/export boundary. These foundations avoid live payer/EHR/provider integrations until source agreements, credentials, and security reviews are available.

## Included backlog IDs

- P2-04 — Add AI output provenance dashboard foundation.
- P3-02 — Add billing/denial feedback integration foundation.
- P3-03 — Add EHR/FHIR-lite import/export boundary foundation.

## Excluded items

- P3-01 patient portal, P3-04 SSO/enterprise audit export, P3-05 explainable risk/documentation-defense engine.
- Phase 4 strategic features and Phase 5 enterprise readiness work.
- Live payer clearinghouse, EHR, FHIR server, or provider sandbox integration without credentials and integration security review.

## Revalidated current state before editing

| ID | Current state confirmed in code | Proposed Phase 3 action | Key files/modules |
|---|---|---|---|
| P2-04 | SmartNote and training code contain provenance concepts, but no shared AI output registry/export shape was found. | Add pure AI provenance registry utilities with validation, filtering, redaction-safe export rows, and tests. | `src/lib/aiProvenanceRegistry.js`, tests. |
| P3-02 | ADR, SmartNote, PDGM, and documentation-impact features contain denial-risk logic, but no payer denial feedback import boundary was found. | Add denial feedback normalization and document/OASIS linkage helpers for imported payer feedback rows, without connecting to a payer system. | `src/components/billing/denialFeedback.js`, tests. |
| P3-03 | UI/help copy mentions copying to EHR, but no FHIR-lite import/export contract was found. | Add FHIR-lite patient/service-request mapping and validation helpers for future EHR import/export boundaries. | `src/lib/fhirLite.js`, tests. |

## Implementation batches

1. **AI governance/reporting foundation (P2-04):** provenance entry normalization, validation, filtering, and export-safe row shaping.
2. **Denial feedback foundation (P3-02):** denial row normalization, cause/category mapping, affected module linking, and summary metrics.
3. **FHIR-lite boundary foundation (P3-03):** app Patient/Referral to FHIR-lite export mapping and FHIR-lite Patient import normalization.
4. **Documentation and validation:** update backlog, feature inventory, roadmap, quick wins as applicable, and create completion report.

## Database changes

No database/entity schema changes are planned. Future production AI provenance or denial-feedback dashboards may need new persisted entities or hosted indexes, but this phase does not guess schema without product/security approval.

## API changes

No API endpoints or external integrations are added. The new modules define contracts and transformations for future ingestion/export endpoints.

## Permission changes

No permission changes are made. Future UI/endpoints must enforce server-side authorization for AI logs, payer data, and EHR payloads because all can contain PHI or sensitive operational data.

## UI changes

No broad dashboard or integration UI is added in this slice. The helpers are intentionally pure and tested so UI/API integration can occur in later reviewable work.

## Testing requirements

- Unit tests for AI provenance required fields, filters, and PHI-minimized export rows.
- Unit tests for denial feedback normalization, category mapping, affected workflow linkage, and summary metrics.
- Unit tests for FHIR-lite export/import shape validation and unsupported-resource failure behavior.
- Full lint, typecheck, build, and test validation after implementation.

## Dependencies and risks

- Live payer/EHR validation requires external credentials, test files, data-use/security review, and product-approved source-of-truth decisions.
- AI provenance persistence cannot be marked production-complete until storage, retention, and access controls are approved.
- FHIR-lite mappings intentionally cover a narrow Patient + ServiceRequest boundary to avoid overclaiming broad FHIR compatibility.

## Recommended implementation order

P2-04, P3-02, P3-03, then documentation/reporting.

## Rollback considerations

All Phase 3 code additions are pure helper/test/documentation changes. Rolling back removes integration/reporting foundations but does not alter current runtime workflows unless later UI/API code imports them.

## Acceptance criteria

- AI provenance entries can be normalized, validated, filtered, and exported without raw prompt/response leakage.
- Denial feedback rows can be normalized and linked to existing documentation/OASIS/PDGM/ADR workflows.
- FHIR-lite Patient and referral ServiceRequest mappings produce deterministic minimal resources and reject unsupported imports.
- Audit docs clearly distinguish repo-side foundations from live payer/EHR/AI-governance work still required.
