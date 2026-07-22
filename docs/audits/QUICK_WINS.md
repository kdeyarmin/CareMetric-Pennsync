# PennSync Quick Wins

_Audit date: 2026-07-22. Quick wins are low-to-medium complexity tasks that do not require redesigning the entire platform._

| ID | Quick win | Why it matters | Affected files/modules | Acceptance criteria | Complexity |
|---|---|---|---|---|---|
| QW-01 | Add an intentional-unrouted-pages test/report | Prevents accidental dead pages and documents legacy duplicates | `src/routes.jsx`, `src/lib/nav.manifest.js`, `src/pages` | CI lists unrouted pages and fails unless each is allowlisted with canonical replacement | Low |
| QW-02 | Add minimum identity guard to referral patient creation UI | Avoids placeholder patient records | `ReferralTriage.jsx`, `ReferralIntake.jsx` | User cannot create Patient until name plus one configured identifier/contact is present; incomplete referral task is created instead | Medium |
| QW-03 | Add public-token error-state matrix tests | Improves signer/provider/patient trust | `SignerPortal.jsx`, `ProviderFollowUpPortal.jsx`, `JoinTelehealth.jsx`, token functions | Expired, missing, malformed, revoked, already-used token states render distinct accessible messages | Medium |
| QW-04 | Add dashboard role-priority checklist | Makes first screen useful per role | `Dashboard.jsx`, `src/components/dashboard/*` | Nurse/admin/QA/intake demo users each see at least five role-relevant priority cards/queues | Medium |
| QW-05 | Standardize empty-state component usage | Reduces dead ends | Shared UI plus high-traffic pages | Patients/referrals/faxes/training/messages/incidents empty states include next action and required permission note | Low |
| QW-06 | Add route chunk bundle report | Protects lazy-loading gains | Vite/CI/package scripts | Build produces per-route chunk report and warns on configured threshold | Low |
| QW-07 | Add shared status glossary constants | Reduces conflicting filters/labels | Domain constants across referral, note, incident, training, fax/SMS | Common statuses defined once and referenced by filters/badges for at least three high-risk modules | Medium |
| QW-08 | Add communications delivery banner pattern | Prevents false success assumptions | Fax/SMS/signature/provider follow-up pages | Send actions show queued state, provider tracking ID when available, retry/failure status link | Medium |
| QW-09 | Add accessibility smoke script for public pages | Catches obvious public access barriers | `/privacy`, `/join`, `/signer`, `/followup` | Automated a11y smoke runs in CI with no serious violations on no-token states | Medium |
| QW-10 | Add admin setup checklist | Accelerates demos and pilots | `AgencySettings.jsx`, `UserManagement.jsx`, integration/admin pages | New admin can see missing Base44 app config, agency profile, staff invites, Telnyx secret status, templates, required training | Medium |
| QW-11 | Document third-party sandbox requirements | Makes validation repeatable | `docs/`, `.env.example` | Docs list required sandbox credentials/webhook URLs and expected callback test outcomes | Low |
| QW-12 | Add “last refreshed/source” labels to analytics cards | Builds trust in dashboards | Reports/analytics/dashboard components | KPI cards show source entity/function and last refreshed timestamp | Low |

## Phase 2 quick-win status update (2026-07-22)

- **QW-09:** Partially implemented repo-side via `src/lib/accessibilitySmokeMatrix.js`; browser/axe runner still required.
- **QW-10:** Implemented repo-side via `src/components/admin/adminOnboardingChecklist.js`; UI placement and product copy remain pending.
- **QW-12:** Implemented repo-side via `src/lib/metricDictionary.js`; analytics card integration remains pending.

## Phase 3 quick-win status update (2026-07-22)

- **QW-11:** Partially implemented repo-side via `docs/audits/PHASE_3_COMPLETION_REPORT.md` manual verification requirements for payer/EHR/AI provenance sandboxes; external credential details still require environment-specific documentation.

## Phase 4 quick-win status (2026-07-22)

| Quick win | Status | Acceptance criteria satisfied | Remaining follow-up |
|---|---|---|---|
| Define patient portal capability/readiness contract before building UI | Implemented repo-side | Tests prove access is allowed only when patient identity, token/account status, consent scope, non-expired token, requested capability, and caregiver proxy prerequisites align. | Product/security must approve actual patient/caregiver UX and hosted authorization policy. |
| Require evidence and provenance for risk/documentation-defense alerts | Implemented repo-side | Tests prove alerts without provenance or complete evidence are invalid and clinician decisions are auditable. | Clinical governance must validate recommendations before live UI/API integration. |

## Phase 5 quick-win status (2026-07-22)

| Quick win | Status | Acceptance criteria satisfied | Remaining follow-up |
|---|---|---|---|
| Define SSO/audit-export readiness before IdP work | Implemented repo-side | Tests validate required SSO metadata and PHI-minimized enterprise audit export fields. | Hosted SAML/OIDC and audit export endpoint implementation require IdP/Base44 access. |
| Add deterministic bundle budget evaluator | Implemented repo-side | Tests pass/fail route chunks and report exact overage. | CI artifact parser and budget thresholds require team decision. |
| Add shared UX state copy contract | Implemented repo-side | Tests validate required copy for empty/error/destructive states. | Adopt in shared UI components. |
| Add terminology/status glossary | Implemented repo-side | Tests validate canonical labels and duplicate/missing-field detection. | Expand through product copy review and UI adoption. |
| Strengthen PR evidence checklist | Implemented repo-side | PR template now prompts for workflow, data/lifecycle, permissions/privacy, docs, hosted verification, testing, rollback, and screenshots. | Optional automation can enforce required checklist completion. |

## Phase 6 quick-win status (2026-07-22)

| Quick win | Status | Acceptance criteria satisfied | Remaining follow-up |
|---|---|---|---|
| Add a go/no-go live-readiness gate | Implemented repo-side | Tests prove capabilities remain blocked until owner, product/security approvals, hosted environment, credentials/sandbox, test evidence, rollback, and monitoring are present. | Populate evidence from real hosted validation and approvals before live rollout. |

## Phase 7 quick-win status (2026-07-22)

| Quick win | Status | Acceptance criteria satisfied | Remaining follow-up |
|---|---|---|---|
| Add evidence packets for live-readiness review | Implemented repo-side | Tests prove packets expose missing evidence, missing references, missing reviewer approvals, and summary counts. | Integrate with release checklist or CI artifact storage when the team chooses a system of record. |

## Phase 8 quick-win status (2026-07-22)

| Quick win | Status | Acceptance criteria satisfied | Remaining follow-up |
|---|---|---|---|
| Add PHI-safe release ledger rows | Implemented repo-side | Tests prove release metadata and complete evidence packets are required, and export rows include counts rather than raw evidence values. | Wire into CI/release-management once artifact storage and sign-off process are selected. |

## Phase 9 quick-win status (2026-07-22)

| Quick win | Status | Acceptance criteria satisfied | Remaining follow-up |
|---|---|---|---|
| Add CI-ready readiness report contract | Implemented repo-side | Tests prove reports pass only for complete ledgers and classify metadata, capability, reference, and reviewer blockers without raw evidence values. | Add dry-run CI workflow after artifact storage and enforcement policy are approved. |

## Phase 10 quick-win status (2026-07-22)

| Quick win | Status | Acceptance criteria satisfied | Remaining follow-up |
|---|---|---|---|
| Add local readiness-report CLI | Implemented repo-side | Tests prove the CLI emits PHI-minimized reports, returns 0 for pass, 1 for readiness blockers, and 2 for usage/input errors. | Run against real evidence JSON and wire into non-blocking CI once artifact policy is approved. |

## Phase 11 quick-win status (2026-07-22)

| Quick win | Status | Acceptance criteria satisfied | Remaining follow-up |
|---|---|---|---|
| Validate readiness evidence JSON before reporting | Implemented repo-side | Tests prove invalid release/evidence/matrix/reviewer shapes return field-specific errors and the CLI returns input-error status without echoing raw values. | Publish a formal JSON Schema and wire editor/CI validation when artifact policy is approved. |

## Phased report closeout quick-win status (2026-07-22)

| Quick win | Status | Acceptance criteria satisfied | Remaining follow-up |
|---|---|---|---|
| Add a final phased rollout closeout report | Implemented documentation-only | The report summarizes Phase 0-11 status, live-readiness blockers, and the stop/go statement for future hosted evidence collection. | Collect real LR-01/LR-02 evidence instead of adding more repository-only phase artifacts. |
