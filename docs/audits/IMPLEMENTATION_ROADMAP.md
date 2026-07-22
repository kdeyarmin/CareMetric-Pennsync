# PennSync Implementation Roadmap

_Audit date: 2026-07-22. Roadmap references backlog IDs in `docs/audits/IMPROVEMENT_BACKLOG.md`._

## Phase 0: Critical stabilization

- **Goals:** Establish safety boundaries, prove core runtime behavior, prevent catastrophic data/security failures.
- **Included backlog items:** P0-01, P0-02, P0-03, P0-04, P0-05.
- **Dependencies:** Base44 policy visibility, staging tenant, test credentials, provider sandbox/mocks, schema constraint options.
- **Risks:** Hosted platform may not support DB-level constraints directly; function-layer enforcement may be required.
- **Validation:** Auth/tenant contract tests, seeded E2E smoke suite, relationship/uniqueness tests, lifecycle audit tests, communications dead-letter tests.
- **Expected outcome:** Application can be evaluated safely in a controlled pilot environment with known security/data integrity boundaries.
- **2026-07-22 implementation note:** Repo-side guardrails/foundations were added for Phase 0, including P0 contract tests, lifecycle helpers, delivery-state helpers, and implementation-status documentation. Hosted Base44 staging, cross-tenant policy tests, provider sandbox verification, and migration decisions remain required before Phase 0 can be declared fully complete.

## Phase 1: Core feature completion

- **Goals:** Make the highest-risk day-to-day workflows coherent and finishable.
- **Included backlog items:** P1-01 through P1-07.
- **Dependencies:** Phase 0 audit/lifecycle model, workflow owner decisions, staging E2E harness.
- **Risks:** Consolidating pages may expose hidden dependencies or user expectations from legacy routes.
- **Validation:** E2E flows for referral-to-patient, SmartNote finalization, OASIS review/export, incident closure, signature/provider token flows, credential/offboarding.
- **Expected outcome:** Pilot users can perform core clinical/admin workflows without placeholder data, dead ends, or unclear statuses.
- **2026-07-22 implementation note:** Phase 1 repo-side work improved referral triage identity gating, provider follow-up token status handling, route drift guardrails, role queue foundations, incident lifecycle foundations, and user offboarding foundations. Remaining Phase 1 limitations are documented in `PHASE_1_COMPLETION_REPORT.md`; hosted Base44 verification and several UI migrations remain required before declaring all P1 workflows fully production-complete.

## Phase 2: Workflow and usability improvements

- **Goals:** Improve adoption, reduce clicks, make the app usable on mobile and at realistic data volumes.
- **Included backlog items:** P2-01, P2-02, P2-03, P2-05, P2-06, P2-07.
- **Dependencies:** Canonical metrics, backend pagination/indexes, device/browser test plan.
- **Risks:** Analytics consolidation requires stakeholder agreement; mobile fixes may touch many pages.
- **Validation:** KPI definition review, axe checks, 10k-record performance tests, mobile smoke tests, admin onboarding checklist completion tests.
- **Expected outcome:** Pilot feedback improves; first-time users understand dashboards and field users can complete visits on mobile.
- **2026-07-22 implementation note:** Phase 2 repo-side foundations were added for metric definitions, public-route accessibility smoke metadata, large-list pagination utilities, unified patient timeline normalization, mobile visit readiness, and admin onboarding progress. P2-04 remains deferred to Phase 3 per the roadmap; UI integration, browser/axe runs, hosted pagination/index validation, and real device testing remain required before declaring Phase 2 production-complete.

## Phase 3: Reporting, automation, and integrations

- **Goals:** Turn operational data into measurable management value and reduce manual follow-up.
- **Included backlog items:** P2-04, P3-02, P3-03.
- **Dependencies:** AI provenance storage, billing/EHR data-source agreements, integration security reviews.
- **Risks:** External integrations increase compliance and support scope; AI governance requires privacy review.
- **Validation:** AI output registry reports, denial import test files, EHR import/export contract tests, integration failure-path tests.
- **Expected outcome:** PennSync demonstrates measurable documentation, compliance, and revenue-cycle improvement.
- **2026-07-22 implementation note:** Phase 3 repo-side foundations were added for AI provenance normalization/export, billing denial feedback normalization/linkage, and FHIR-lite Patient/ServiceRequest boundaries. Live payer/EHR integrations, persisted provenance storage, endpoint authorization, and sandbox validation remain required before declaring Phase 3 production-complete.

## Phase 4: Strategic new features

- **Goals:** Expand product differentiation after core workflows are stable.
- **Included backlog items:** P3-01, P3-05.
- **Dependencies:** Patient-facing auth/consent design, clinical validation process, explainability standards.
- **Risks:** Patient portal and predictive recommendations materially increase security, usability, and clinical-risk obligations.
- **Validation:** Patient portal security/accessibility tests, risk-model validation reports, override/audit workflow tests.
- **Expected outcome:** Stronger market differentiation without undermining clinical safety.

## Phase 5: Scaling, optimization, and enterprise readiness

- **Goals:** Prepare for larger agencies, enterprise procurement, and long-term maintainability.
- **Included backlog items:** P3-04, P4-01 through P4-05 plus recurring performance/security reviews.
- **Dependencies:** SSO provider, audit export format, bundle/performance budgets, release governance.
- **Risks:** Enterprise controls can slow feature velocity if not designed as platform capabilities.
- **Validation:** SSO staging test, audit export acceptance, route bundle budgets, PR checklist adoption, operational SLO dashboards.
- **Expected outcome:** Enterprise-ready security/compliance posture, predictable performance, and maintainable feature delivery.

### Phase 4 implementation note (2026-07-22)

Phase 4 repo-side strategic foundations were added for P3-01 and P3-05 without creating patient-facing routes or automated clinical actions. Patient portal work now has a tested access/readiness contract covering token/account status, consent scope, expiration, caregiver proxy authorization, capability scoping, patient-safe projection, and audit-event shape. Explainable risk/documentation-defense work now has tested contracts requiring source evidence and AI provenance before an alert can be treated as valid, plus clinician decision events for accepted, overridden, dismissed, and escalated outcomes. Live patient portal authentication, hosted Base44 permissions, consent UX, persisted risk-alert entities, model validation, clinical governance, and E2E security/accessibility testing remain prerequisites before production rollout. Phase 5 enterprise/scaling work was not started.

### Phase 5 implementation note (2026-07-22)

Phase 5 repo-side enterprise/scaling foundations were added for P3-04 and P4-01 through P4-05. The repository now has tested helpers for SSO readiness checks, enterprise audit-export row normalization/redaction, route chunk budget evaluation, shared UX state copy contracts, terminology/status glossary validation, PR readiness evidence, and legacy-reference inventory. Live SSO, IdP metadata exchange, hosted Base44 session-policy changes, audit-export endpoints, CI bundle artifacts, UI-wide copy migration, glossary adoption, automated PR enforcement, and legacy page deletion remain future work that requires product/security/team approval.

## Phase 6: Post-roadmap live-readiness gate

- **Goals:** Convert repository-side foundations into an explicit go/no-go readiness process for hosted implementation.
- **Included live-readiness items:** LR-01 through LR-09 in `IMPROVEMENT_BACKLOG.md`.
- **Dependencies:** Product owner approval, security approval, hosted Base44 staging credentials, external sandbox credentials, test evidence, rollback plans, and monitoring plans.
- **Risks:** Treating repo-side foundations as production-ready without external verification would create security, clinical, support, and compliance risk.
- **Validation:** `src/lib/liveReadinessGate.test.js`, hosted E2E evidence once credentials exist, security review sign-off, and production-readiness checklist review.
- **Expected outcome:** Teams can prioritize live rollout candidates based on actual evidence instead of confusing foundation code with production readiness.
- **2026-07-22 implementation note:** A tested live-readiness gate now tracks remaining hosted capabilities and blocks live-readiness status until all required evidence is present. No hosted integrations, migrations, routes, or policies were changed.

## Phase 7: Live-readiness evidence packetization

- **Goals:** Turn the Phase 6 readiness gate into a reviewable evidence-packet workflow for each live capability.
- **Included live-readiness items:** LR-10 in `IMPROVEMENT_BACKLOG.md`.
- **Dependencies:** Phase 6 capability matrix, evidence artifacts, product/security/QA/release reviewers, and a future place to store signed release evidence.
- **Risks:** Without references and reviewer decisions, teams may mark readiness based on informal knowledge that cannot be audited later.
- **Validation:** `src/lib/liveReadinessEvidencePacket.test.js`, full utility suite, and eventual release-manager review of attached evidence artifacts.
- **Expected outcome:** Each live rollout candidate has an auditable packet showing what is present, what lacks references, and which reviewers have not approved.
- **2026-07-22 implementation note:** Evidence-packet helpers now create per-capability checklists and summary counts without enabling any hosted capability.

## Phase 8: PHI-safe live-readiness release ledger

- **Goals:** Summarize evidence packets into a deterministic release ledger that can be attached to release records without exposing raw evidence contents.
- **Included live-readiness items:** LR-11 in `IMPROVEMENT_BACKLOG.md`.
- **Dependencies:** Phase 7 evidence packets, release metadata, evidence artifact references, and future release-management storage.
- **Risks:** Copying raw evidence, credentials, or PHI into release summaries would increase compliance and security exposure.
- **Validation:** `src/lib/liveReadinessReleaseLedger.test.js`, full utility suite, and future release-manager review of ledger rows and artifact links.
- **Expected outcome:** Release reviewers can see whether live-readiness evidence is complete while keeping sensitive evidence contents outside repository-generated summaries.
- **2026-07-22 implementation note:** A tested release-ledger helper now summarizes metadata, readiness blockers, and evidence-reference counts without changing hosted behavior.

## Phase 9: CI-ready live-readiness report contract

- **Goals:** Convert release ledgers into deterministic pass/fail report objects for future CI or release-management automation.
- **Included live-readiness items:** LR-12 in `IMPROVEMENT_BACKLOG.md`.
- **Dependencies:** Phase 8 release ledger, team decision on CI enforcement timing, and artifact storage.
- **Risks:** Enforcing CI gates before evidence owners and artifact storage exist could block releases without giving teams a practical remediation path.
- **Validation:** `src/lib/liveReadinessCiReport.test.js`, full utility suite, and future dry-run CI evaluation.
- **Expected outcome:** Future automation can consume a stable readiness report contract without exposing raw evidence values.
- **2026-07-22 implementation note:** A tested CI report helper now produces pass/fail status and blocker categories without adding CI enforcement or hosted behavior.

## Phase 10: Non-blocking live-readiness report CLI

- **Goals:** Provide a local/dry-run command for generating the Phase 9 readiness report from evidence JSON.
- **Included live-readiness items:** LR-13 in `IMPROVEMENT_BACKLOG.md`.
- **Dependencies:** Phase 9 report contract, evidence JSON, and future release-management/CI artifact decisions.
- **Risks:** Treating the CLI as a production gate before evidence storage and enforcement policy are approved would create process friction without auditable artifacts.
- **Validation:** `tools-live-readiness-report.test.mjs`, `pnpm run readiness:report -- <evidence.json>` with real evidence files, and future dry-run CI execution.
- **Expected outcome:** Teams can generate readiness reports locally or in dry-run automation before adopting blocking CI enforcement.
- **2026-07-22 implementation note:** A tested local CLI and package script now generate PHI-minimized readiness reports without changing hosted behavior or CI workflows.

## Phase 11: Live-readiness evidence input validation

- **Goals:** Validate readiness evidence JSON before local report generation to avoid confusing or unsafe report output.
- **Included live-readiness items:** LR-14 in `IMPROVEMENT_BACKLOG.md`.
- **Dependencies:** Phase 10 CLI, evidence JSON shape, and future formal schema/artifact decisions.
- **Risks:** Accepting malformed evidence files could hide missing approvals or cause misleading readiness reports.
- **Validation:** `src/lib/liveReadinessInputValidation.test.js`, `tools-live-readiness-report.test.mjs`, and full utility suite.
- **Expected outcome:** Local readiness reports fail fast on malformed input with field-specific, PHI-safe messages.
- **2026-07-22 implementation note:** A tested validator now blocks malformed release/evidence/matrix/reviewer shapes before report generation.

## Phased rollout closeout (2026-07-22)

The repository-side phased report is complete through Phase 11. Future work should stop adding additional repository-only phases and instead use `docs/audits/PHASED_ROLLOUT_FINAL_REPORT.md` to collect real LR-01/LR-02 hosted tenant, RLS, and authenticated staging evidence. No hosted-production readiness should be claimed until the live-readiness gate, evidence packets, release ledger, CI report, and CLI validation are populated with real external evidence and reviewer approvals.
