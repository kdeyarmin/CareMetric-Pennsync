# Phase 0 Implementation Plan and Revalidation Notes

_Audit follow-up date: 2026-07-22. Scope: Phase 0 only from `IMPLEMENTATION_ROADMAP.md` and P0-01 through P0-05 from `IMPROVEMENT_BACKLOG.md`._

## Revalidation before editing

| Backlog item | Current-code evidence revalidated | Repo-verifiable implementation path | External blocker |
|---|---|---|---|
| P0-01 | Existing `base44/securityGuardrails.test.js` already checks several PHI RLS and scheduler-auth regressions; entity JSONC files include RLS blocks for key records. | Add a Phase 0 contract test that high-risk patient/document/message/training/payroll entities expose scoped read policies. | Actual deployed Base44 tenant policies and cross-tenant denial behavior require hosted policy access and seeded users. |
| P0-02 | Repository instructions still say the Base44 backend is hosted and not locally runnable; no Playwright/staging credentials are present. | Document the required staging E2E environment and add a test that prevents silently marking this complete without credentials. | Do not mark P0-02 complete until a Base44 hosted staging tenant, test credentials, seeded data, and provider mocks/sandboxes exist. |
| P0-03 | Entity schemas exist, but no SQL migrations/foreign-key/index files exist. Several high-risk relationship/idempotency fields are present. | Add a repository contract test proving required relationship/idempotency fields exist in entity schemas. | Enforced uniqueness/indexes/foreign keys depend on Base44 schema capabilities or function-layer enforcement decisions. |
| P0-04 | Some features have audit fields, but no shared lifecycle vocabulary existed across final clinical/legal/business records. | Add pure shared lifecycle helpers and tests for canonical statuses, valid transitions, and audit-event shape. | Existing records/pages/functions need a product-approved migration before forced adoption. |
| P0-05 | Fax/SMS/signature/provider-follow-up entities have status fields and several retry utilities exist, but no single delivery-state vocabulary existed. | Add pure shared outbound delivery-state helpers and tests for canonical states, provider status mapping, terminal/dead-letter decisions, and traceable event shape. | Provider callback semantics and UI re-drive behavior still require sandbox/live verification. |

## Work-unit plan

1. **Security/data contract guardrails:** Add `base44/phase0Contract.test.js` to assert repo-visible access, relationship/idempotency, lifecycle, and delivery-state invariants.
2. **Lifecycle foundation:** Add `src/lib/recordLifecycle.js` and `src/lib/recordLifecycle.test.js` as behavior-preserving pure utilities.
3. **Delivery-state foundation:** Add `src/lib/outboundDeliveryState.js` and `src/lib/outboundDeliveryState.test.js` as behavior-preserving pure utilities.
4. **Validation wiring:** Add new tests to package scripts so `pnpm test` covers the Phase 0 contracts.
5. **Audit status update:** Update `IMPROVEMENT_BACKLOG.md` and `IMPLEMENTATION_ROADMAP.md` with implemented repo-side status and remaining manual/external verification.

## Stop conditions

- Do not alter production workflows to enforce lifecycle/status transitions until business owners approve migrations for existing records.
- Do not fabricate E2E credentials, Base44 policies, or provider sandbox results.
- Do not begin Phase 1 backlog items.
