# Phase 1 Implementation Plan

_Audit follow-up date: 2026-07-22. Scope: Phase 1 only. Phase 2, Phase 3, and strategic new-feature work are explicitly excluded._

## Phase 1 goals

Complete and strengthen existing core workflows that users can already start in the application: referral triage/intake, role work queues, SmartNote/OASIS lifecycle foundations, public token portals, duplicate-route governance, incident review, and credential/offboarding administration.

## Included backlog IDs

- P1-01 — Replace placeholder patient creation in referral triage with incomplete-referral queue.
- P1-02 — Build role-specific work queues.
- P1-03 — Complete SmartNote/OASIS finalization flow.
- P1-04 — Harden public token portals.
- P1-05 — Consolidate or archive unrouted duplicate pages.
- P1-06 — Add incident investigation/corrective-action lifecycle.
- P1-07 — Complete credential/offboarding workflow.

## Excluded items

- All P2, P3, and P4 backlog work except documentation of newly discovered dependencies.
- Patient portal, denial integration, EHR/FHIR, SSO, strategic risk engine, analytics redesign, accessibility automation, and large-list optimization.
- Forced migration of existing clinical/legal records to new lifecycle statuses without product-owner and data-migration approval.
- Live provider, hosted Base44, and cross-tenant verification where credentials/environments are unavailable.

## Revalidated current state before editing

| ID | Current state confirmed in code | Proposed Phase 1 action | Key files/modules |
|---|---|---|---|
| P1-01 | `ReferralTriage.jsx` still creates patients with explicit “Not provided on referral” placeholders. `ReferralIntake.jsx` also creates patients directly from extraction when demographics exist. | Add shared referral patient-readiness validation; block triage patient creation when minimum identity is missing; create an incomplete referral/task instead; add tests. | `src/components/referral/referralPatientReadiness.js`, `ReferralTriage.jsx`, referral tests. |
| P1-02 | Dashboard has priority utilities, but Phase 1 cannot build a full production role-dashboard without hosted data. | Add repo-verifiable role work-queue summaries from existing data shapes so dashboards can adopt without backend changes; document remaining UI integration as deferred. | `src/components/dashboard/coreWorkQueues.js`, tests, docs. |
| P1-03 | Phase 0 lifecycle helpers exist; SmartNote/OASIS enforcement across existing workflows needs migration decisions. | Add workflow-specific lifecycle adapters/guardrails for finalization candidates; do not force existing statuses into production pages yet. | `src/lib/recordLifecycle.js`, tests, docs. |
| P1-04 | Provider follow-up token functions validate/submit via service role but do not write the new token `status`; expired links only set `is_active=false`. | Update provider follow-up functions to maintain token status (`expired`, `delivered`) and add static contract tests for expired/submitted behavior. | `base44/functions/validateFollowUpToken/entry.ts`, `submitFollowUpResponse/entry.ts`, contract tests. |
| P1-05 | `routes.jsx` documents retired/unrouted page files and redirects; there is no intentional-unrouted-page guardrail. | Add a route/manifest test that fails on accidental unrouted page drift while allowlisting intentionally retained public/legacy pages. | `src/routes.manifestContract.test.js`, `package.json`. |
| P1-06 | Incident review can mark under-review/resolved, but entity lacks reviewer/CAP due-date/closure fields. | Add incident investigation/CAP schema fields and pure transition helper/tests; preserve existing UI behavior. | `base44/entities/Incident.jsonc`, `src/components/incident/incidentLifecycle.js`, tests. |
| P1-07 | Credential submission/review functions already enforce pending/admin review; user offboarding is mostly UI/entity dependent and hosted auth dependent. | Add user offboarding schema/audit fields and pure helper/tests; document hosted auth/session revocation remaining. | `base44/entities/User.jsonc`, `src/components/admin/userOffboarding.js`, tests. |

## Implementation batches

1. **Referral patient-readiness vertical slice (P1-01):** shared validator, triage flow change, tests, focused referral tests.
2. **Public token hardening (P1-04):** update provider follow-up token status writes and contract tests.
3. **Governance guardrails (P1-02/P1-05):** role queue summarizer and route/unrouted-page contract test.
4. **Lifecycle/admin foundations (P1-03/P1-06/P1-07):** incident lifecycle helper/schema fields, user offboarding helper/schema fields, lifecycle guardrails.
5. **Documentation and validation:** update backlog, feature inventory, roadmap, and create completion report.

## Database changes

No SQL migrations exist in this Base44 repository. Schema changes are JSONC entity-contract changes only: add incident investigation/CAP fields, user offboarding fields, and provider follow-up token status usage. Hosted deployment/backfill behavior requires Base44 environment verification.

## API changes

- Provider follow-up token validation/submission functions will update `ProviderFollowUpToken.status` consistently.
- No new public endpoints are added.

## Permission changes

- Do not weaken Phase 0 RLS/security guardrails.
- Provider follow-up remains capability-token based and service-role scoped to the token’s referral.
- Incident and user offboarding schema additions do not grant new permissions by themselves.

## UI changes

- Referral triage will prevent patient creation with inadequate identity data and create an incomplete referral/task instead.
- Broad dashboard/incident/user-management UI redesign is deferred; pure helpers and schema support are added first to minimize regression risk.

## Testing requirements

- Unit tests for referral patient-readiness validation and incomplete-referral payloads.
- Integration/update test for `ReferralTriage.jsx` behavior.
- Backend contract tests for provider follow-up token status changes.
- Route manifest contract test for intentional unrouted page allowlist.
- Unit tests for role work queues, incident lifecycle, and user offboarding helper behavior.
- Full lint, typecheck, test, security, contract, and build validation.

## Dependencies and risks

- Hosted Base44 staging and live policy verification remain unavailable.
- Patient minimum identity rules are implemented conservatively: full name plus one verifiable identifier/contact (DOB, MRN, phone, or address).
- Existing data may lack new schema fields; defaults/optional fields preserve compatibility.
- User offboarding cannot revoke hosted sessions from this repo alone.

## Recommended implementation order

P1-01, P1-04, P1-05, P1-02, P1-06, P1-07, then documentation/reporting.

## Rollback considerations

- Referral triage change can be rolled back by restoring direct patient creation, but that reintroduces placeholder census risk.
- Provider token status writes are additive and can be ignored by older UI.
- Entity schema additions are optional fields and should be backward-compatible.
- Pure helper modules are not behavior-changing until imported by workflows/tests.

## Acceptance criteria

- Referral triage no longer creates placeholder patient records when minimum identity is missing.
- Incomplete triage creates a referral/task path that staff can finish later.
- Public provider follow-up tokens record expired/submitted state.
- Route drift is covered by an automated contract test.
- Incident and offboarding lifecycle data fields/helpers exist with tests.
- Audit docs accurately distinguish implemented, partial, blocked, and deferred work.
