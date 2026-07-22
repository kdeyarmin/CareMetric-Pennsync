# Phase 5 Implementation Plan

_Audit follow-up date: 2026-07-22. Scope: Phase 5 scaling, optimization, and enterprise-readiness foundations only._

## Phase 5 goals

- Add repository-verifiable enterprise-readiness foundations without claiming hosted SSO, live audit export, or production scaling completion.
- Convert low-priority but high-leverage process/quality backlog items into tested contracts that can be adopted by CI and future UI/API work.
- Preserve existing production behavior; avoid deleting legacy pages or changing authentication without product and hosted Base44 support.

## Included backlog IDs

| ID | Item | Phase 5 interpretation |
|---|---|---|
| P3-04 | Add SSO and enterprise audit export | Add pure enterprise SSO readiness validation and audit-export row normalization/redaction helpers. |
| P4-01 | Add bundle analyzer budgets per route chunk | Add route chunk budget evaluation helpers and deterministic pass/fail budget tests. |
| P4-02 | Normalize empty states and confirmation dialogs | Add shared UX copy contracts for empty/destructive/loading/success/error states. |
| P4-03 | Add terminology/status glossary | Add canonical terminology/status glossary helpers and validation. |
| P4-04 | Add PR checklist for feature lifecycle/test/security evidence | Strengthen PR template and add a reusable checklist helper. |
| P4-05 | Remove dead comments/legacy references after consolidation | Add a legacy-reference inventory helper; do not remove retained legacy pages without product parity sign-off. |

## Excluded items

- Live SAML/OIDC login configuration, identity-provider metadata exchange, SCIM, or hosted Base44 session-policy changes.
- Actual route bundle analyzer plugin integration or CI hard-fail budget enforcement until the team chooses artifact format and thresholds.
- Broad UI copy rewrites or visual redesigns.
- Deleting legacy page files or comments without explicit product parity approval.
- Any Phase 0–4 live hosted verification that still requires credentials, production data, provider sandboxes, or business decisions.

## Current state after revalidation

| Area | Current state | Evidence reviewed |
|---|---|---|
| SSO/audit export | Roadmap and backlog identify the gap; no repo-side SSO readiness/export contract exists. | `docs/audits/IMPLEMENTATION_ROADMAP.md`, `docs/audits/IMPROVEMENT_BACKLOG.md` |
| Bundle budgets | Build/lazy-route concerns are documented, but there is no deterministic route chunk budget helper. | `docs/audits/COMPREHENSIVE_APP_AUDIT.md`, `src/routes.jsx` |
| Empty/confirmation states | UX standard docs exist, but there is no compact reusable copy contract for validation. | `docs/UI_PAGE_STANDARD.md`, page/component audit docs |
| Terminology glossary | Metric dictionary exists, but workflow/status terms are not centrally normalized. | `src/lib/metricDictionary.js`, audit backlog P4-03 |
| PR checklist | PR template exists but lacks explicit lifecycle/data/permission/security/documentation evidence prompts. | `.github/pull_request_template.md` |
| Legacy references | Route manifest contract allowlists retained legacy pages, but no reusable legacy-reference inventory exists. | `src/routes.manifestContract.test.js`, `src/routes.jsx` |

## Proposed implementation batches

1. **Enterprise readiness contracts**: add SSO readiness and audit-export helpers/tests.
2. **Performance/process guardrails**: add bundle-budget helper/tests and strengthen PR template/checklist helper/tests.
3. **UX/product governance contracts**: add UX state copy helper, terminology glossary, and legacy-reference inventory helper/tests.
4. **Documentation updates**: update backlog, feature inventory, roadmap, quick wins, and create the Phase 5 completion report.
5. **Validation**: run focused tests, utility suite, lint, typecheck, build, full tests, and diff check.

## Database changes

No database migrations or Base44 entity schema changes are planned. Production enterprise audit export may require persisted audit-log retention/indexing and legal-hold controls after security review.

## API changes

No hosted functions or API endpoints are planned. Future enterprise APIs must enforce admin-only access, tenant isolation, least-privilege export fields, immutable audit logging, and rate limits.

## Permission changes

No runtime permissions are changed. New helper contracts document required admin/security checks before SSO or audit export can go live.

## UI changes

Only `.github/pull_request_template.md` process copy is updated. No application UI or route behavior changes are planned.

## Testing requirements

- Focused Node tests for Phase 5 helper modules.
- Standard `pnpm run test:utils` after script wiring.
- `pnpm run lint`, `pnpm run typecheck`, `pnpm run build`, full `pnpm test`, and `git diff --check`.
- Document hosted/live verification that remains blocked by missing IdP/Base44 enterprise configuration.

## Acceptance criteria

- P3-04 has a tested SSO readiness and audit-export normalization/redaction contract.
- P4-01 has a tested route chunk budget evaluator.
- P4-02 has a tested shared UX state copy contract.
- P4-03 has a tested terminology/status glossary.
- P4-04 has an updated PR template and tested checklist helper.
- P4-05 has a tested legacy-reference inventory helper and no unapproved legacy file removal.
