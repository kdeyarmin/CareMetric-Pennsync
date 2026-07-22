# Phase 2 Implementation Plan

_Audit follow-up date: 2026-07-22. Scope: Phase 2 workflow and usability improvements only. Phase 3, Phase 4, Phase 5, and strategic new-feature work are explicitly excluded._

## Phase 2 goals

Improve workflow clarity, usability, and pilot-readiness foundations without changing high-risk hosted Base44 behavior: define canonical metrics, add accessibility smoke-test coverage for public pages, provide reusable pagination/large-list helpers, create a unified patient timeline normalizer, document mobile visit readiness criteria, and add an admin onboarding checklist foundation.

## Included backlog IDs

- P2-01 — Add metric dictionary and canonical analytics surfaces.
- P2-02 — Add accessibility automation.
- P2-03 — Add large-list pagination and virtualization foundations.
- P2-05 — Create unified patient timeline.
- P2-06 — Improve mobile visit workflow.
- P2-07 — Add admin onboarding checklist.

## Excluded items

- P2-04 AI output provenance dashboard because the roadmap places it in Phase 3 reporting/automation/integrations.
- P3/P4/P5 backlog items, patient portal, billing/denial import, EHR/FHIR, SSO, strategic risk engine, enterprise audit export, and broad visual redesigns.
- Live authenticated E2E, real mobile-device QA, hosted Base44 policy changes, and third-party provider tests because credentials/environments are unavailable.

## Revalidated current state before editing

| ID | Current state confirmed in code | Proposed Phase 2 action | Key files/modules |
|---|---|---|---|
| P2-01 | Analytics/reporting surfaces compute metrics locally with page-specific terminology; no central owner/formula/source dictionary was found. | Add a repo-verifiable metric dictionary with owners, formulas, source entities, refresh cadence, export routes, and validation helpers. | `src/lib/metricDictionary.js`, tests, docs. |
| P2-02 | Public no-token routes render locally, but there is no accessibility smoke matrix or automated route metadata check. | Add a lightweight accessibility smoke matrix for public routes that can be consumed by future Playwright/axe checks without adding dependencies. | `src/lib/accessibilitySmokeMatrix.js`, tests. |
| P2-03 | Large-list pages use ad hoc filtering and query patterns; no shared pagination contract exists. | Add shared pagination/windowing utilities with deterministic metadata and tests for 10k-record synthetic lists. | `src/lib/pagination.js`, tests. |
| P2-05 | Patient details, visits, documents, messages, and incidents are separate surfaces; no shared timeline normalizer exists. | Add a pure patient timeline builder that normalizes existing records into sorted timeline events with source routes and labels. | `src/components/patient/patientTimeline.js`, tests. |
| P2-06 | Offline/mobile flows exist, but mobile readiness is not expressed as a reusable checklist. | Add mobile visit readiness checklist logic for offline cache, sync queue, note draft, patient context, and connection state. | `src/components/mobile/mobileVisitReadiness.js`, tests. |
| P2-07 | Admin settings/user/integration pages exist, but no setup-progress checklist was found. | Add admin onboarding checklist logic covering app config, agency profile, staff invites, Telnyx secret status, templates, and training. | `src/components/admin/adminOnboardingChecklist.js`, tests. |

## Implementation batches

1. **Metric and accessibility foundations (P2-01/P2-02):** central metric definitions plus public-route accessibility smoke metadata/tests.
2. **Large-list and patient timeline foundations (P2-03/P2-05):** shared pagination/windowing utilities plus patient timeline normalizer/tests.
3. **Mobile and admin setup foundations (P2-06/P2-07):** mobile visit readiness checklist plus admin onboarding checklist/tests.
4. **Documentation and validation:** update backlog, feature inventory, roadmap, quick wins, and create completion report.

## Database changes

No database/entity schema changes are planned for Phase 2 repo-side foundations. Future UI integrations may require indexes or hosted query support for large-list pagination; those are documented as remaining dependencies rather than guessed here.

## API changes

No API endpoints are added or changed. New helpers normalize existing client-side records and define validation metadata for future UI/E2E adoption.

## Permission changes

No permissions are changed. Timeline and onboarding helpers require callers to pass already-authorized records; hosted RLS and tenant isolation remain the server-side boundary from Phase 0/1.

## UI changes

No broad UI redesign is planned in this repo-side slice. The new modules are safe foundations that can be integrated into dashboards, analytics, patient details, mobile visits, and admin settings in later reviewable UI slices.

## Testing requirements

- Unit tests for metric dictionary shape, owners, formulas, source entities, and export routes.
- Unit tests for public-route accessibility smoke matrix completeness and no-token expected states.
- Unit tests for pagination/window metadata, search/filter/sort composition, and 10k-record behavior.
- Unit tests for patient timeline normalization, sorting, source labels, route generation, and empty states.
- Unit tests for mobile visit readiness blocking/warning/completion states.
- Unit tests for admin onboarding checklist completion percentages and next actions.
- Full lint, typecheck, build, and test validation after implementation.

## Dependencies and risks

- Authenticated E2E cannot run without hosted Base44 credentials.
- Real accessibility findings require a browser/axe runner; this phase adds route metadata and contract coverage only.
- Real mobile readiness requires device/browser testing; this phase adds deterministic checklist logic only.
- Large-list performance depends on hosted query/index support for true server pagination.

## Recommended implementation order

P2-01, P2-02, P2-03, P2-05, P2-06, P2-07, then documentation/reporting.

## Rollback considerations

All Phase 2 code additions are pure helper/test/documentation changes. Rolling back removes guardrails/foundations but should not alter current production runtime unless a later UI slice imports these helpers.

## Acceptance criteria

- Canonical metrics have owner, formula, source, refresh cadence, and export path metadata with tests.
- Public no-token route accessibility smoke coverage is represented in an automated test.
- Large-list pagination utilities return deterministic slices and metadata for high-volume arrays.
- Patient timeline helper creates sorted, source-linked timeline events from existing record shapes.
- Mobile visit readiness helper identifies blockers/warnings and safe-to-start status.
- Admin onboarding checklist helper reports setup progress and next action.
- Audit docs accurately distinguish implemented repo-side foundations from hosted/UI work still required.
