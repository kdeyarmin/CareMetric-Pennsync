# CareMetric / PennSync — application-wide functionality review

**Date:** September 16, 2026.  
**Repository:** `kdeyarmin/CareMetric-Pennsync`.  
**Review branch:** `fix/app-wide-functionality-audit-20260916`.  
**Starting source:** `fabf84b85b0444fdfe000f9efafea0426778a628` (includes merged vehicle review #182 and the platform's subsequent package update).  
**Existing production Base44 app:** `694ec16e72e01b60d22f7cbf`.

## Executive determination

The application contains a substantial tested codebase, but it is **not verified as an entirely functioning, production-ready clinical application**. Code tests, deployed schema registration, the published frontend, authenticated tenant isolation, provider deliveries and physical-device acceptance are different claims. This review does not collapse them into a single green status.

This change repairs reproducible build, membership/manager authorization, timesheet data-integrity, time-off input, credential input, training-roster scope and misleading readiness behavior. It also adds repeatable isolated negative testing for **every one of the 282 backend entries**. The fixes were prepared and tested in a separate checkout and branch, not by editing the production workspace. No patient or employee records, memberships, clinical/outbound release controls, app-wide recording setting or native app identity were changed during this audit.

Two deployment problems were independently observed: the live sites still served release `3003a6125964`, and Base44's entity-schema readback did not contain `FleetServiceReview` or the corresponding reservation fields required by already-merged fleet code. The platform-injected recording script also remained present in the live HTML. These must not be described as resolved by a passing code build.

## 1. Scope, evidence and limits

| Inventory / test scope | Result |
| --- | --- |
| Backend entry files enumerated | 282 |
| Non-test page components enumerated | 87 |
| Entity-schema definitions enumerated | 253 |
| Application/backend source files indexed | 1,353 |
| Test files in indexed source/backend paths | 489 |
| No-session negative scenarios | Every backend tested with empty JSON and forged body role/tenant fields: 564 isolated handler executions |
| Real production records read or changed | None |
| Authenticated hosted clinical transactions tested | None in this audit |
| Provider messages, faxes, calls, model requests or payments sent | None |

The complete row-by-row backend, page and schema list is in [APP_FUNCTIONALITY_INDEX_2026-09-16.md](APP_FUNCTIONALITY_INDEX_2026-09-16.md). A machine-readable source/policy index was also generated in the isolated audit workspace. Source hashes, lexical test references and call-site associations make omissions visible. An additional AST scan cataloged 21,493 function definitions, including repeated generated helpers; this is a structural count, not individual manual acceptance. None of these static associations is a code-coverage percentage or evidence that every valid-user execution path was exercised.

The negative sweep transpiles the actual handler into an isolated VM, supplies no user session and substitutes an inert SDK. Network, record reads/writes, provider operations and timers are trapped. The sole HTTP 200 is the existing inert retirement of automatic patient assignment. The signed Telnyx webhook's verification-configuration read is the sole explicitly documented read exception; the mock blocks that read and the handler rejects the request. No business-record operation is permitted by this exception. The tests verify that the harness detects deliberately unsafe example handlers instead of producing a no-op green result.

## 2. Reproducible defects fixed in this branch

### Build reproducibility

Base44 auto-commit `fabf84b8` changed the Vite plugin requirement to `^1.0.40` without updating its lockfile. The first frozen installation failed with `ERR_PNPM_OUTDATED_LOCKFILE`. The branch regenerates the matching lock entry and extends only the already-existing exact-version age exception for the platform-required plugin. It does not relax frozen installation or general supply-chain checks, and it does not adopt unrelated major upgrades. A clean pinned Node 24.18.0 / pnpm 11.9.0 installation then passed.

This fixes the observed revision. The provider may make another manifest-only upgrade later; that continuing platform behavior is not claimed eliminated by this patch.

### Shared membership and manager authorization — 73 backend consumers

The compatibility helper previously searched only active membership rows. An active row plus a revoked/suspended duplicate could therefore appear unique. Its integrity checks also omitted canonical lifecycle fields already required by the newer tenant brokers. Finally, a caller's mutable `is_manager` field passed through unchanged.

`trustedCallerClaims` now validates all bounded lifecycle rows before selecting a single active agency. It checks canonical IDs/keys, normalized identity, allowed role/status, version, creator, transition actor/email/time/reason, activation and revocation consistency, and duplicate IDs/keys/agencies. Multiple active agencies remain ambiguous for these legacy callers because they do not supply a selected-tenant argument. Lookup failure never creates a grant.

`is_manager` is reconstructed from manager/agency-admin membership, rather than accepted from an editable profile. The canonical shared source was updated and **73 generated consumers** regenerated. Existing protected built-in administrator behavior remains unchanged; this is not a conversion of every legacy function to the stricter platform-owner-only model. Tests first reproduced duplicate-state, missing-lifecycle and forged-manager acceptance, then passed after the repair.

### Timesheet integrity and uncertain saves

The old code could treat payroll-profile lookup failure as no profile, point-schedule failure as zero points, approved-PTO lookup failure as zero PTO, and an existing-timesheet query failure as an empty list. A successful save under those conditions could preserve incorrect payroll inputs. These failures now stop the save with a useful retry/reconciliation response rather than silently inventing zero values.

Daily entries must have unique valid calendar dates inside the selected 14-day pay period. Extra rows are rejected rather than silently sliced; negative, nonnumeric and object/boolean numeric inputs are rejected rather than normalized to valid zeros. Server-owned phone reimbursement remains authoritative, and historical valid inputs preserve the existing calculations. No wage, benefit or reimbursement policy/formula was redesigned.

Multiple existing timesheets for one employee/service/period now require reconciliation. The old post-create race cleanup could delete a record and overwrite a winner after another request changed it. That destructive cleanup was removed. A detected concurrent duplicate is retained and reported, not silently collapsed. **This is evidence-preserving error handling, not a guarantee that the hosted datastore prevents concurrent duplicate creation.** A proper idempotent payroll-write/reconciliation protocol remains a follow-up requirement.

### Approver selection and fallback notifications

Timesheet and time-off submission now require a verified active membership for ordinary user accounts. A selected approver's manager/administrator rights and agency are rebuilt from protected identity and canonical membership; editable role flags or agency names cannot grant that right.

Fallback recipients are resolved from canonical agency-admin memberships and the configured protected platform owner, not a global list filtered by users' claimed `super_admin`/`agency_admin` strings. Incomplete or ambiguous recipient lookups do not deliver to guessed accounts. Notification failure remains distinct from a saved request; no provider delivery was triggered in testing. Regression cases cover both the formerly accepted impostor and a legitimate membership-backed manager whose editable profile has no manager flag.

### Time-off and personnel credentials

Time-off requires exact calendar dates and a real boolean half-day choice. A request spanning more than one year is rejected before iterating its calendar; a timestamp suffix or the string `"false"` cannot be misinterpreted. These are input-integrity and bounded-execution guards, not changes to the organization's leave entitlement.

Credential inputs must be text of bounded size. Impossible dates, an issue date after expiration, and object values are rejected. A supplied upload URL must be HTTPS without URL-embedded credentials. This URL validation does not prove document ownership, malware safety, or the correctness of the separate upload/private-storage workflow.

### Training permissions, scope and readiness presentation

Team readiness no longer accepts a self-declared educator/supervisor profile flag as permission to inspect coworkers. Its authorized manager path comes from the validated membership helper. Agency roster scope is resolved through canonical service-owned memberships and matching built-in user identity, not the employees' editable agency-name strings. Missing identities, ambiguous memberships and capped source windows return an explicit incomplete/unavailable result instead of a purported complete percentage.

With no required assignments, the backend returns no percentage and the UI says **Not assessed**, not **100%**. The UI also handles the old backend's empty `pct:100` response safely, keys the query by user and tenant, and marks the displayed roster section for recording exclusion. Real nonempty aggregates still display the existing calculation. Legacy assignment records remain email-oriented; a broader immutable tenant/assignment-ownership migration is not claimed completed here.

### Repeatable all-backend negative testing

`tools-anonymous-function-audit.mjs` and its registered security tests provide a reusable check against missing authentication, premature business-record access, side effects, and body-supplied role/tenant claims. They are added to the normal security test command, not an unattached one-time script. The harness does not load production credentials or real SDK/provider packages.

## 3. Functional-area disposition

| Area | Review and improvements | What still needs valid-user/hosted proof |
| --- | --- | --- |
| Login, account lifecycle and tenant selection | Full source inventory; shared membership defects repaired; existing account/tenant contracts run | Real owner, agency-admin, ordinary employee, inactive user and multi-agency sign-in/sign-out/MFA sessions |
| Patient roster, chart access and care-team assignment | Existing secured-broker, assignment, query-key, context-expiry and cross-record contract suites run; no patient data or access policy changed | Two-agency positive/negative raw API acceptance using synthetic staging charts |
| Visits, clinical documentation and note history | Full build and existing component/core/authorization tests run | Create, save, reopen, amend, sign and discharge workflows in an authenticated test tenant; device camera/microphone/file paths |
| OASIS and PDGM | Existing reference/worksheet/core tests passed; generated worksheet parity checked | Deliberately disabled AI, rate/grouper and recommendation capabilities require their own clinical/tenant/reference evidence; no safety gates were flipped |
| Referrals and admissions | Referral, fax-binding, patient-creation and ownership contract suites included | Hosted intake/assignment/duplicate handling, real private-file binding and authorized conversion to a patient |
| Documents, signatures and PDFs | Existing upload/document/signer/authority tests included; production JS inspection passed | Several public signer/PDF mutation paths remain intentionally unavailable; valid-signature, private-file and receipt preservation must be verified before activation |
| Secure messaging, telephone, SMS and fax | Existing consent, provider-destination, webhook, private-fax and delivery guardrails included; negative sweep covers entry points | Provider credentials, sandbox delivery receipts, retry/reconciliation, routing and consent acceptance; current paused operations are not counted as working sends |
| Telehealth | Public invalid-link page and isolated-preview tests passed; token/capability guards preserved | A successful clinician/patient session, join-token expiry, media permissions, reconnect and consent on actual devices |
| Workforce: payroll, leave and credentials | Reproduced data-integrity, approver/recipient and input faults repaired | Full employee → approver → payroll/export lifecycle; hosted concurrency and authoritative record ownership across employee transfers |
| Education, courses and certificates | Readiness permission/scope/empty-data fixes; course/integrity/component suites included | Authenticated enrollment, grading, progress/certificate restore, Hub content migration and disabled cutover evidence |
| Fleet / vehicle maintenance | Previously merged review changes retained; branch passes their tests; live schema divergence identified | Register/verify review and reservation fields, then authenticated vehicle → employee entry → admin review round-trip and multi-client append semantics |
| Reports, analytics and search | Full source/page inventory, build, query-key and rendered-component tests included | Real tenant-scoped report totals and authorized exports; absence of rows must not be interpreted as proven compliance |
| Support, administration and background jobs | Existing helper, workflow, cron-token and no-session checks included | Authenticated help submission and authoring/playback; scheduled jobs with configured internal credentials and delivery receipts |
| Browser privacy and session recording | Generated bundle inspected; isolated preview and stale-authority tests included; live HTML loader checked | Platform recorder configuration, retained recordings/access and authenticated capture controls remain a separate unresolved privacy issue |
| Native Apple / Google applications | Existing native identity source/contracts retained; no signing/store changes | Signed builds, purchases/restore, subscription entitlement continuity and physical iOS/Android acceptance |

These are review dispositions, not an assertion that every listed area is release-ready. A test of an unavailable page proves its safe unavailable state, not that its business capability works.

## 4. Verification completed

The complete local test command produced successful summaries for all six suites: 130 central-administration tests, 2,327 utility/core tests, 331 schema/integration tests, 869 security tests, 47 deduplication tests and 1,691 component tests: **5,395 tests** at that checkpoint. Additional cases were subsequently added and the updated security suite passed **873 tests**; the final PR checks must bind to the final source, not reuse an earlier green run. Component tests cover 217 files. The host tool initially timed out while the long command was running, but the retained log subsequently included the completed passing summary; no timeout was reclassified as a test pass by itself.

Targeted final workforce tests cover 20 cases; the shared-claims suite has 10 cases; the anonymous audit suite has seven tests, two of which each exercise all 282 handlers. Those are included in the security count and must not be counted again as additional independent tests.

The source linter and high-signal typecheck passed. The repository's broader informational type baseline still reports 15,750 low-signal/test-fixture diagnostics; passing the selected gate is not a clean full-typecheck claim. All 282 backend functions transpile and client function targets exist. All 225 generated-helper consumers match their canonical source. The OASIS review worksheet remained current at 36 items.

The exact hosted-style build invocation, `npm run build -- --mode production`, passed. Its final inspector read 501 generated JavaScript files with no detected diagnostic statements or parsing errors. This covers generated application assets, not scripts later injected by the platform.

Ten Chromium public-route/secure-preview tests passed with retries disabled. The initial browser attempt could not launch because Chromium was missing from the fresh environment; after installing the standard Playwright browser/system dependencies, all ten ran and passed. No application code was weakened to pass the browser tests.

The production dependency audit returned zero critical, high or moderate advisories and one low-severity Quill advisory, GHSA-v3m3-f69x-jf25. GitHub's advisory page, checked September 16, still identifies Quill 2.0.3 and no patched version. The existing DOMPurify-based HTML sanitization remains; the dependency finding was not suppressed or falsely described as patched. Reference: https://github.com/advisories/GHSA-v3m3-f69x-jf25

## 5. Live findings that block an all-clear

### Published source is behind reviewed source

Unsigned reads on both `caremetricai.base44.app` and `app.caremetricai.com` at **2026-09-16 12:47:04Z** returned HTTP 200 but still referenced `./assets/index-DRJ8X4H_-3003a6125964.js`. Therefore neither the already-merged #182 frontend changes nor this new audit branch is proved live by GitHub status. This audit did not initiate another publication.

### Vehicle schema registration is behind merged code

A fresh Base44 metadata request for FleetServiceReview, FleetVehicle and FleetServiceEntry returned only the latter two with their older property sets. `FleetServiceReview`, service/review creation claims and new provenance fields were absent from that readback. This does not establish how the provider treats unknown fields during every write, but it does establish that the required deployed schema definition has not been verified. Apply the reviewed additive schema changes in the controlled rollout, re-read them, then verify the actual hosted broker. Do not assume a repository merge creates every platform resource.

### Recorder is still injected by the hosting platform

Both live HTML responses still contained the session-recording loader. Earlier synthetic testing established that the then-enabled recorder could capture displayed identifying text despite masking input fields. This audit did not re-open real charts, inspect retained recordings, or re-read the master toggle. Loader presence is not a fresh assertion that every visit was recorded. No actual patient-data disclosure is established by this audit.

The prior recommendation to disable recording for the clinical app and assess retained recordings remains distinct from code linting. The app-wide setting was deliberately left unchanged here. Module-level recording-block attributes and log removal are not substitutes for resolving the hosting-platform configuration.

### Hosted acceptance evidence remains unfinished

The current `live-readiness-evidence.draft.json` still contains unresolved deployment, fixture, reviewer and authenticated-test placeholders. They were not replaced with invented attestations. No live credentials were requested or extracted; a saved editor session is not assumed to be an employee session in the app.

## 6. Prioritized follow-through

**Before declaring the updated software live:** review this source change, pass exact-head CI, reconcile Base44 schemas/resources to the chosen release, then publish once and verify the exact entry/module files on both domains. Review membership-integrity rejects against existing service-owned records before broad rollout; do not repair malformed membership by trusting employee-editable role fields.

**Before expanding clinical use or enabling paused capabilities:** resolve the recorder issue and execute the already-defined two-agency authenticated staging matrix. Cover allowed access, foreign/unassigned denial, offboarded/revoked sessions, stale tabs, private uploads, cache/clipboard expiry and role transitions. Preserve controls while evidence is gathered.

**Before relying on payroll totals or approvals:** exercise failure and retry paths with an isolated test employee/approver; inspect duplicate periods before review/export. This branch refuses uncertain source data but does not implement a new transactional payroll ledger. Remaining legacy record ownership and approval workflows deserve dedicated immutable-tenant migration work rather than piecemeal authorization widening.

**Before enabling integrations or native release:** use provider test modes and retain delivery/receipt evidence; validate signing, purchases/restoration, sessions and device media permissions. Paused e-sign, telehealth, telecom, AI and learning-cutover controls should only change as separate reviewed releases with their own success/rollback evidence.

The source repairs and evidence are actionable work completed in this review. They are not a claim that the provider configuration, every live user journey, or the native store release has been completed.
