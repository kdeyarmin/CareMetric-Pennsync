# Phase 6 Implementation Plan

_Audit follow-up date: 2026-07-22. Scope: post-roadmap product/security/QA live-readiness gating._

## Phase 6 goals

- Convert the Phase 0–5 repository foundations into an explicit go/no-go readiness gate for live hosted implementation.
- Prevent claims that a foundation is production-ready until external credentials, product decisions, security approvals, and hosted E2E evidence are present.
- Preserve application behavior; no live hosted integrations, migrations, routes, or permission policies are changed in this phase.

## Included work

| Work item | Purpose |
|---|---|
| Live readiness gate | Add a pure evaluator that marks a capability ready only when required approvals, credentials, environment, tests, rollback, and owner evidence are present. |
| Capability matrix | Seed the gate with the live features still blocked after Phases 0–5: tenant/RLS verification, staging E2E, patient portal, SSO/audit export, EHR/FHIR, billing denial import, AI governance, provider communications, and legacy cleanup. |
| Documentation | Record Phase 6 status, manual verification requirements, and the recommended order for turning foundations into live features. |

## Excluded work

- No Base44 migrations, hosted functions, RLS policy changes, SSO setup, patient portal routes, AI model rollout, payer imports, EHR connections, or legacy page deletion.
- No speculative business-rule decisions where product/security approval is required.

## Current state after revalidation

- Phase 5 completion states that all roadmap phases are repository-side foundations and recommends a product/security/QA readiness pass before live hosted feature work.
- Multiple remaining limitations depend on unavailable hosted Base44 credentials, IdP metadata, payer/EHR sandboxes, product decisions, clinical governance, security review, or product parity approval.
- There is no central repo-side readiness gate that prevents “implemented foundation” from being confused with “live production-ready feature.”

## Proposed implementation

1. Add `src/lib/liveReadinessGate.js` with:
   - canonical evidence keys;
   - capability definitions for post-roadmap live work;
   - readiness evaluation with missing evidence and blocker reporting;
   - sorted implementation order based on priority and readiness.
2. Add `src/lib/liveReadinessGate.test.js` covering blocked, ready, and prioritized capability states.
3. Wire the test into `package.json` `test:utils`.
4. Update roadmap/backlog/feature inventory/quick wins with Phase 6 status.
5. Create `docs/audits/PHASE_6_COMPLETION_REPORT.md`.

## Acceptance criteria

- Every live capability requires owner, product approval, security approval, hosted environment, credentials, test evidence, rollback plan, and monitoring plan before being marked ready.
- Blocked capabilities report exact missing evidence instead of guessing.
- Repository tests cover ready and blocked paths.
- Documentation clearly separates repository foundations from live production readiness.
