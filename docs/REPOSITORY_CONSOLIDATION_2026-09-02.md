# PennSync repository consolidation

Status: **P0 mixed-release containment required — staging candidate validated; production remains blocked**.

## Canonical destination

- GitHub repository: `kdeyarmin/CareMetric-Pennsync`
- Protected preparation branch: `consolidation/pennsync-unified-2026-09-02`
- Initial destination baseline: `b95b567ea9487e2841e438777b12d65796c34f69`
- Consolidated `main` baseline: `67d9d5ee66aad222a712e6ba49d00461d0a68337`
  (merged PR `#142`). The isolated hosted-validation branch and draft PR `#143`
  are based on this commit.
- Feature source: `kdeyarmin/pennsync2` at `3e73ea75bd37ef2819dad952cbd5343c179bccb1`
- `kdeyarmin/pennsync` is already an ancestor of the PennSync2 feature history;
  it does not require a second code merge.

The PennSync2 feature tree was squash-integrated so its current functionality is
retained without attaching its 2,579-commit experimental history or 35,062
accidentally tracked `.pnpm-store` cache files. The original repositories and
remote `archive/pre-consolidation-2026-09-02` branches preserve their exact
pre-consolidation histories.

## Production identity anchors

These identifiers must not be renamed or moved during source consolidation:

| Surface | Required identity |
| --- | --- |
| Base44 app | CareMetric AI, `694ec16e72e01b60d22f7cbf` |
| Permanent app origin | `https://caremetricai.base44.app/` |
| Current CareMetric custom app domain | `app.caremetricai.com` |
| Apple App Store | Apple ID `6757097720`, bundle `com.caremetric.ai` |
| Google Play | Existing package `com.caremetic.ai` (spelling is intentional) |
| PWA | Relative `id`, `start_url`, and `scope`; all four icons retained |

The installed mobile apps continue to use their existing store records. Adding
PennSync domains later must point those domains at the same CareMetric Base44
app; it must not change the permanent origin embedded in the iOS shell.

## Immediate production containment (P0, identified 2026-09-03)

Read-only comparison of the live old frontend baseline (`c545729`) with the
hosted schemas auto-synced by `67d9d5e` found a real compatibility incident.
The 14 entity-schema changes contain no field deletion and add no required
field, but eight change RLS behavior. No production record was inspected, so the
analysis establishes reachable risk, not proof that a user already triggered it.

| Area | Live mixed-release risk |
| --- | --- |
| Patient merge — P0 | The old browser merge can fail to reassign now-service-only OASISAssessment, OASISUpload, and PatientOutcomeMetric rows, swallow those errors, then archive the duplicate Patient. This can strand protected rows on an archived chart |
| OASIS saves/reviews — high | Old direct OASIS creates/updates now fail closed. Some paths perform another action first, so a failed save can leave changed Patient care type, an unbound uploaded PDF/LLM cost, or an audit entry claiming an approval/edit that did not persist |
| PDGM configuration — high/medium | The old browser catches the now-denied PDGMRateConfig read and silently treats it as no config, causing at least eight consumers to use built-in defaults. If the old save function is live, a save could overwrite configuration; the `67d9d5e` function hard-pauses that write, but hosted function revision remains unverified |
| KPI/outcome display — medium | Direct AgencyKPI and PatientOutcomeMetric reads now fail closed. The outcome view shows an error and the KPI dashboard degrades to missing values; this is availability loss rather than a write-corruption path |
| New Patient rows — migration debt | Patient creation still works because `agency_id` is optional and Patient RLS is unchanged, but the old frontend does not stamp it, so new charts created during the mixed window require audited tenant backfill |

Until containment is complete, operators must not use production patient merge,
OASIS save/upload/review, PDGM rate settings, or rate-dependent decisions. A
blanket schema rollback is not recommended because it would reopen PHI-sensitive
writes and formerly unrestricted reads. The safest technical containment is an
urgent, explicitly approved roll-forward of the matching `67d9d5e` fail-closed
frontend (or equivalent route-level maintenance), followed by logs, smoke tests,
and rollback monitoring.

A no-publish containment build of exact production source `67d9d5e` succeeded
with the production app id. It contains 507 files / 18,160,451 bytes, references
`index-egZIJufH.js` (SHA-256
`145532107c092fa272821a6c215b886f3188d71091682d02af6ca529675928f7`),
has aggregate sorted-file hash
`e014a239fb3a0bb0a34949e2e8360c3570debdc106b253aef0d6db949958e2f3`,
contains the production app id and no staging app id, and includes the
fail-closed merge/reporting controls. The source worktree remains clean. This
build is prepared evidence only: no production roll-forward or rollback has
been performed by this staging work.

## Nonproduction hosted-validation evidence (updated 2026-09-03)

The first release gate has now been synchronized and validated in a separate
Base44 application. The table below is the authoritative current state. The
paragraphs after it are the chronological audit trail, so their intermediate
inventory counts and “not yet deployed” statements describe those earlier
checkpoints rather than the current staging state. None of these operations
targeted the CareMetric production app.

| Surface | Current hosted staging evidence |
| --- | --- |
| Base44 app | `caremetric-pennsync-staging-2026-09-02`, `6a9881683dc68a0bd54f1ef7` |
| Staging URL | `https://caremetric-pennsync-staging-2026-09-d54f1ef7.base44.app/` |
| Runtime candidate | Draft PR `#143` code baseline `655624f749c1c94542e6eb616a31b1c9c1135eef`; merged canonical `main` baseline remains `67d9d5ee66aad222a712e6ba49d00461d0a68337` |
| Frontend | The complete canonical candidate is synchronized with staging-specific app configuration; frozen install, staging-ID build, and the managed Vite root all pass |
| PWA/native identity | Relative manifest `id`, `start_url`, and `scope`; four manifest icons retained; Apple bundle `com.caremetric.ai`; Google package `com.caremetic.ai`; iOS WebView origin `https://caremetricai.base44.app/` |
| Entities | All 241 source schemas are hosted and semantically exact; `PatientCareTeamAssignment`, `DocumentTenantBinding`, and the required `OutcomeComputationRun.transition_version` / `result_summary_hash` fields are present; direct CRUD remains denied on the new authority/binding schemas |
| Functions | 258 reviewed functions are hosted and byte-exact. Exactly two source functions are deliberately absent: `computeOutcomeMeasures` and `managePatientCareTeamAssignment` |
| Data | Rechecks confirm zero staging rows in Agency, AgencyMembership, Patient, PatientCareTeamAssignment, DocumentTenantBinding, OutcomeComputationRun, PatientOutcomeMetric, and AgencyKPI; no migration or production data write occurred |
| Secrets/schedules | `INTERNAL_FN_SECRET` remains absent and no outcome schedule was added |
| Feature gates | No AgencySettings row exists; OASIS v2 remains default-off, `saveOasisResponses` remains hard-paused, PDGM reimbursement remains source-disabled, and both withheld functions remain unwired |
| Time zone | `America/New_York` is the default business/agency clock, giving Eastern Standard or Daylight Time as seasonally appropriate |
| Validation | 2,077 core, 34 schema/contract, 414 security, 47 deduplication, and 1,005 component tests pass (3,577 package checks); a broader 616-test function/security sweep, all 260 function transpiles, all 244 shared-helper comparisons, type diagnostics, ESLint, actionlint, OASIS worksheet, and staging build also pass |
| Production auto-sync | PR `#142` auto-fast-forwarded the CareMetric Base44 source workspace to merged `main` `67d9d5ee66aad222a712e6ba49d00461d0a68337` at 2026-09-02 19:58:30 UTC, and the workspace remains clean there. Read-only hosted metadata also exposes fields/RLS introduced by that merge; the git diff changed 14 entity schemas. This was a production source and hosted-schema change, not a source-only event |
| Production function status | Whether the PR `#142` sync also deployed backend function revisions is not yet verified; production CLI log/function inventory requires a fresh authenticated device session. Do not infer either deployment or non-deployment until that read-only check completes |
| Live production surfaces | On 2026-09-03, `caremetricai.base44.app` and `app.caremetricai.com` both returned HTTP 200 and the same existing `CareMetric AI` bundle `index-BQUjg8kG.js`; staging returned its distinct `PennSync by CareMetric` bundle `index-DoqEmZdz.js`; `pennsync.com` still returned the separate `PENNSync` bundle `index--wkWNhXC.js`, so no production bundle publish or domain cutover occurred |
| Manifest nuance | The production-facing manifest already says `PennSync by CareMetric` and is byte-identical to staging. Git history traces that manifest branding to 2026-06-30 and its blob did not change in PR `#142` or today's staging work; its relative PWA identity and four icons remain intact, but the mixed old HTML bundle/newer manifest branding must be explicitly reconciled at release |
| Current safety boundary | Today's isolated staging work made no additional production data/schema API mutation, secret/scheduler change, bundle publication, domain move, native upload, or Apple/Google record change. The earlier PR `#142` production source/schema auto-sync is recorded separately above; both store listings were still live on 2026-09-03 |

The initial entity deployment exposed unsupported `$contains` array-membership
RLS in Message and SharedDocument. Draft PR `#143` replaces it with Base44's
accepted `data.<array>.$in` form and adds a repository-wide operator contract.
Both PR workflows pass.

Hosted anonymous-write probes then proved that Base44 does not enforce the
legacy top-level `rls.write` key as a create rule: synthetic rows could be
created in PatientOutcomeMetric, AgencyKPI, and PDGMRateConfig. The three exact
probe rows were deleted through a temporary exact-id, service-role-only cleanup
function, and that function was removed. The critical schemas now use hosted
operation-specific `create`, `read`, `update`, and `delete` rules. A second
hosted probe returned HTTP 403 for anonymous creates on OASISAssessment,
OASISUpload, PatientOutcomeMetric, AgencyKPI, and PDGMRateConfig; anonymous
lists exposed no records, and authenticated staging queries confirmed zero
matching probe rows. The staging candidate now migrates every legacy
top-level `rls.write` policy to Base44's hosted `create`, `update`, and
`delete` keys, prefixes custom record fields with `data.`, removes mutable
`account_type` authorization branches, and pins those invariants in contract
tests. That syntax migration deliberately preserves each policy's effective
access while the actual authorization model is redesigned. A reviewed
fail-closed pass then locked unused, service-only, disabled OASIS, inbound-fax,
parallel-message, and dormant clinical PHI entities without breaking a live
client path. `CertificatePacketCache` is now service-role-only and its private
file references are available only through the authorized packet function. The
service-only PDGM case-mix, supply inventory/usage/prediction, low-stock alert,
and skill-badge definitions are now fail-closed as well. Their backend consumers
use service-role access; no browser consumer reads them directly. The remaining
inventory is `20 / 238` schemas with no RLS, `26 / 238` permitting unrestricted
mutations, and `35 / 238` permitting
unrestricted reads. Those exact cohorts are hash-pinned so the debt
cannot change without explicit review. Per-operation integrity, tenant-owned
authority, and hosted authenticated workflow proofs remain production blockers.
The complete staging schema push succeeded. All 58 shaped anonymous POST probes
returned HTTP 403: the prior 51-entity cohort plus CertificatePacketCache,
PDGMCaseMix, SkillBadge, SupplyItem, SupplyLowStockAlert, SupplyPrediction, and
SupplyUsageLog. The original cohort includes the 40 previously fail-closed
entities, Message, TrainingQuestion,
FaxLog, FaxContact, FaxTemplate, and the five critical OASIS/outcome/PDGM
entities, plus the owner-only PDFIndex. Every anonymous list returned an empty
array, and privileged connector queries confirmed `count: 0` for the same
58-entity cohort, so no probe row was created. Anonymous calls to the hardened
certificate packet and cleanup functions return HTTP 401 and 403 respectively.
The hosted staging site and all five PWA icons return HTTP 200. Local release
validation passes 2,040 core tests, 33 schema/contracts, 188 security tests, 47
deduplication tests, and 950 component
tests; all 242 backend functions transpile and the staging-bound frontend builds.

The 2026-09-03 hardening checkpoint then added a service-owned
`AgencyMembership` authority model whose direct CRUD is entirely disabled.
`getMyTenantContext` resolves only an exact immutable Base44 `User.id` plus
canonical email, validates an active exact Agency, rejects duplicate or
inconsistent membership rows, and ignores mutable custom User tenant/admin
claims. This is the first tenant-authority phase, not a production-ready tenant
system: the lifecycle broker can provision, activate, suspend, change, and
revoke an exact membership, but datastore uniqueness/CAS, invitation and
terminal-rehire workflows, operational agency provisioning, stamping/backfill,
and integration into every protected clinical path are still required. New
training/reference brokers remove browser-wide reads and direct evidence
writes; scenario scoring and attempt ownership are derived server-side. The
three newly authenticated functions initially missed the standard deactivated
session guard; full validation caught that defect, all three were fixed, and
the ratchet test now passes.

The same checkpoint added append-only outcome attempts plus a single
`OutcomeComputationRun` publication gate, deterministic source/output
fingerprints, exact replay-cohort validation, staged readback, and final-claim
revalidation. These changes prevent a failed run from being presented as the
published result, but Base44 still provides no proved datastore uniqueness or
compare-and-swap primitive. Concurrent writers, crash/lease recovery, and stable
source snapshots remain production blockers. A publication-aware reader now
exists but remains disconnected from the UI pending authenticated two-agency
hosted proof. The job is unscheduled and its staging internal secret is unset.

The PDGM candidate now includes source-pinned CY 2026 functional scoring for
M1800 through M1860, the complete ten-flag M1033 risk calculation, threshold
semantics, admission-source validation, and low-functional subgroup
interactions. Its official 432-row CY 2026 case-mix table matches the source
table for weights and LUPA thresholds. Diagnosis grouping, complete
comorbidity/timing assignment, official grouper parity, and golden payment
cases remain incomplete, so the grouper still returns `complete:false` and no
HIPPS code or reimbursement amount can be emitted.

The second hosted deployment contained 238 schemas and 249 functions. Anonymous
calls to the seven user-facing new functions returned HTTP 401; a validly
shaped `computeOutcomeMeasures` call returned the expected missing-internal-
secret HTTP 500. Direct anonymous lists of `AgencyMembership`,
`OutcomeComputationRun`, `Competency`, `PolicyLibrary`, `ScenarioAttempt`, and
`TrainingAuditLog` returned empty arrays and direct creates returned HTTP 403.
Connector rechecks found zero rows in every changed evidence/outcome entity.
The hosted root, both privacy-policy paths, manifest, and all four manifest
icons return HTTP 200. The built bundle contains the staging app id and
`https://base44.app`, contains no production CareMetric app id, preserves the
relative PWA identity, and defaults to `America/New_York`. That checkpoint's
local validation passed 2,055 core tests, 33 schema/contracts, 231 security
tests, 47 deduplication tests, and 950 component tests; all 249 backend functions
transpiled, ESLint passed, dependency audit had no high-severity findings, all
four GitHub Action files passed actionlint, and the 36-item OASIS worksheet was
current.

The third staging checkpoint completes the next reviewed containment layer:

- `manageAgencyMembership` owns versioned lifecycle transitions and rejects
  duplicate/corrupt all-status membership sets, unsafe self/owner/peer changes,
  stale authority, and noncommitting writes. Direct membership CRUD remains
  fail-closed.
- `getPublishedOutcomeMeasures` returns only one exactly reconciled published
  run to an immutable active tenant authority. Writer and reader recompute a
  deterministic per-row content hash, so copied provenance cannot hide changed
  diagnosis, nested measure, or KPI content. The reader is intentionally not
  connected to a production UI.
- all five known browser/offline Visit-create paths use
  `createAuthorizedVisit`. Tenant/user provenance is service-stamped, ordinary
  users need pre-existing Patient access, and the legacy auto-assignment
  function is an unconditional no-op so creating a Visit cannot grant Patient
  PHI access.
- offboarding is protected-owner-only, revokes and reconciles every revocable
  membership before deactivating the User, and reactivation restores identity
  only. A hosted anonymous probe found an uncaught auth rejection; the function
  was corrected and now returns HTTP 401 before every privileged operation,
  with a regression contract.
- twelve zero-consumer reference/settings entities are now all-operation
  fail-closed, reducing the pinned RLS cohorts to `20 / 26 / 35` for no-RLS,
  mutation-open, and read-open respectively.

Immediately before the latest schema push, the local and hosted staging
inventories both contained the same 238 entity names. Connector queries found
zero rows in all changed clinical, authority, outcome, and dormant entities.
After deployment, hosted inventory reports 238 schemas, 252 functions, and only
`SUPER_ADMIN_EMAIL`. Anonymous calls to `manageAgencyMembership`,
`getPublishedOutcomeMeasures`, `createAuthorizedVisit`, `getMyTenantContext`,
and `offboardUser` return HTTP 401. A validly shaped
`computeOutcomeMeasures` request returns the expected missing-secret HTTP 500,
and `autoAssignNurseToPatient` returns a static skipped response without reads
or writes. Anonymous GETs for the 17 changed/evidence entities return `[]`, all
17 shaped POSTs return HTTP 403, and privileged post-probe queries report zero
residue. Root, both privacy aliases, manifest, and all four manifest icons
return HTTP 200. The fresh bundle contains only the staging app id, uses
`https://base44.app`, preserves relative PWA identity, and defaults to
`America/New_York`.

Current local validation passes 2,065 core tests, 34 schema/contracts, 297
security tests, 47 deduplication tests, and 950 component tests (3,393 checks
across the package groups); all 252 backend functions transpile and all 242
shared-helper consumers match. ESLint, dependency audit, actionlint for all four
workflows, the 36-item OASIS worksheet, the staging build, and `git diff
--check` pass.

The fourth staging checkpoint closes the new-chart creation and hard-delete
boundary without touching existing Patient rows:

- all eight browser Patient-create paths now use `createAuthorizedPatient`;
  there is no direct production `Patient.create` or `Patient.delete` call under
  `src`;
- the broker accepts only an explicit initial-chart allowlist, requires one
  exact active all-status-validated `AgencyMembership` (or an exact agency
  selector when the caller has multiple memberships), and permits initial chart
  creation only to `agency_admin`, `manager`, and `clinician` tenant roles;
- the server stamps `agency_id`, immutable built-in creator id and normalized
  email, `created_by`, active/non-sample/non-archived lifecycle defaults, and a
  scoped agency:user:request idempotency key. It rechecks membership and Agency
  state before and after the privileged write, verifies exact readback, and
  removes only its just-created row on a failed authority proof;
- `Patient.rls.create` and `Patient.rls.delete` are now false. The mobile hard-
  delete control was removed; a retention-aware archive workflow must be built
  before deletion can return; and
- `processPatientFileUpdate` remains available for protected-owner preview, but
  every commit/apply request returns HTTP 503 before reading the supplied file,
  enumerating Patients, or writing. It must receive an exact target agency and
  identical server-owned provenance before apply mode can be restored.

Before this deployment, connector queries again reported zero Patient, Agency,
and AgencyMembership rows. The 238-schema push completed, only
`createAuthorizedPatient` and `processPatientFileUpdate` were explicitly
deployed, and hosted function inventory is now 253. Anonymous calls to both
functions return HTTP 401; direct anonymous Patient list returns `[]`; direct
Patient create returns HTTP 403; and post-probe connector counts remain zero.
The staging root, both privacy paths, relative manifest, and four manifest icons
return HTTP 200. The build contains the staging app id, contains no production
CareMetric app id, and preserves `America/New_York`.

Current validation now passes 2,065 core tests, 34 schema/contracts, 310
security tests, 47 deduplication tests, and 950 component tests (3,406 checks
across the package groups). All 253 backend functions transpile and all 243
shared-helper consumers match; ESLint, the staging build, and `git diff --check`
pass. Direct Patient update and broad read authorization, legacy provenance and
assignment backfill, service-role Patient maintenance functions, and hosted
two-agency positive/cross-tenant tests remain production blockers.

The latest isolated staging checkpoint closes the remaining direct Patient
mutation boundary and moves note history to a service-owned append-only
projection:

- `Patient` and `Visit` now deny direct create, update, and delete operations.
  All nine production browser Patient-update paths use
  `updateAuthorizedPatient`, which accepts a bounded canonical action set,
  validates exact immutable membership and chart authority, checks the projected
  combined lifecycle before one write, and verifies the readback. Chart creation
  remains brokered and hard deletion remains unavailable;
- `PatientNoteHistoryEntry` is an additive 239th schema with all four direct RLS
  operations denied. `appendPatientNoteHistory` derives its immutable patient,
  tenant, Visit, note, and fingerprint provenance server-side, while
  `getAuthorizedPatientNoteHistory` exposes the authorized projection. Both the
  new projection and retained legacy embedded history are merged for current
  readers without rewriting existing Patient rows;
- `calculateDataQualityScores`, `deletePatientsMissingFirstName`,
  `enforceDataCompleteness`, `migrateExistingData`,
  `monitorClinicalDataForCarePlanUpdates`, `predictPatientRisks`,
  `predictiveRiskAnalysis`, and `processDischargeReport` now return static HTTP
  503 before request parsing, client creation, authentication, AI, entity reads,
  or writes; and
- `analyzeDocument`, `generateFaxCoverPage`, and `sendMessage` now validate the
  exact Document-to-Patient-to-tenant boundary and immutable actor authority.
  The first anonymous `sendMessage` probe exposed an uncaught failure as HTTP
  500; that path was corrected and redeployed, and the repeated probe returned
  HTTP 401.

Immediately before the schema push, staging contained 238 schemas and the only
local-only addition was `PatientNoteHistoryEntry`; there was no staging-only
schema and therefore no deletion or rename target. After deployment, staging
contains 239 schemas and 256 functions. Connector queries before and after the
probes reported zero Agency, AgencyMembership, Patient, Visit, Document,
PatientNoteHistoryEntry, outcome-run, and outcome/KPI rows. Anonymous calls to
`updateAuthorizedPatient`, `appendPatientNoteHistory`,
`getAuthorizedPatientNoteHistory`, `analyzeDocument`,
`generateFaxCoverPage`, and the corrected `sendMessage` return HTTP 401. Direct
anonymous Patient and PatientNoteHistoryEntry creates return HTTP 403 and lists
return `[]`. The staging root, privacy routes, manifest, and icons return HTTP
200; the manifest keeps relative `id`, `start_url`, and `scope`, and the build
keeps the `America/New_York` default.

This checkpoint did not change the CareMetric production Base44 app, production
data or schema, either custom domain, any scheduler or secret, the OASIS-v2 or
PDGM gates, a native binary, or an App Store/Google Play record. Production is
still blocked: direct Document entity RLS remains open, Patient reads have not
yet been migrated to a server-authorized boundary, staging has no two-agency
data/user matrix, and tenant backfill plus datastore uniqueness/CAS are
unproved. The outcome, official PDGM, OASIS, physical-device, signing, privacy,
store, and rollback gates below also remain open.

The subsequent Patient read-broker checkpoint explicitly deployed two reviewed,
read-only functions to the same isolated staging app:
`getAuthorizedPatient` for one exact chart and `listAuthorizedPatients` for a
bounded authorized roster. The list broker was subsequently redeployed in place
after removing unstable offset and mutable-field sorting; continuation now uses
one context-bound `id` keyset and re-resolves authority on every request. Base44
accepts the exact `$gt` plus `sort: "id"` query shape, but the empty app cannot
prove multi-row ordering or collation. Shaped anonymous POST probes returned
HTTP 401 with `{"error":"Unauthorized"}` before privileged access. Hosted
function inventory remains 258 and schema inventory remains 239. Post-probe
connector queries again reported zero Agency, AgencyMembership, Patient, Visit,
Document, PatientNoteHistoryEntry, OutcomeComputationRun,
PatientOutcomeMetric, and AgencyKPI rows.

An earlier source checkpoint added an unwired `DocumentTenantBinding` schema
with all direct operations denied and a purpose-bound
`createAuthorizedDocument` upload/create broker. It validates finite multipart
files, resolves exact immutable actor/membership/Agency/optional-Patient
authority, binds idempotency to that authority, verifies exact readback, and
compensates only the request-created Document on failure. This is foundation,
not a production-ready Document cutover: datastore uniqueness/transactions,
orphan upload reconciliation, private or signed delivery, storage-host
allowlisting, full parsing and malware scanning, existing-row backfill, and all
legacy read/write migrations remain open. Neither the schema nor function was
deployed at that checkpoint; both are now present in staging, but remain unwired
and cannot be treated as a production-ready Document cutover.

An additive `PatientCareTeamAssignment` authority foundation was initially
present only in source. All direct entity operations are denied, browser callsites are
absent, and every mutation is hard-paused by the literal
`CARE_TEAM_ASSIGNMENT_MUTATIONS_ENABLED = false` before client creation,
authentication, or service-role access; no environment switch can open it. The
dormant lifecycle candidate uses the documented Base44 SDK 0.8.46
`updateMany` predicate plus `$inc` as a full-preimage conditional transition,
binds replay to action, actor, request, reason, and result version, and preserves
stored assignee evidence during emergency suspension/revocation even if the
target User, membership, or Patient no longer exists. This does not make grants
deployable: Base44 exposes no documented atomic create-if-absent, unique schema
constraint, or multi-entity transaction. Hosted uniqueness, cross-entity
authorization atomicity, two-request CAS proof, legacy backfill/quarantine, and
patient-merge collision handling remain blockers. The schema is now hosted with
direct CRUD denied; its mutation broker is still deliberately withheld and
unwired.

The next source-only checkpoint strengthens outcome publication and the exact
Patient read path without changing the hosted app. `OutcomeComputationRun` now
requires `transition_version`, initializes each run at `building@v1`, and
permits only one full-writer-preimage conditional transition to an exact
terminal `@v2` state. The predicate includes every writer-owned schema field,
using `$exists: false` for absent optional fields; the update must report
`success: true`, `updated: 1`, and `has_more: false`; and exact readback must
reconcile. Published rows additionally require mutually exclusive terminal
metadata, a canonical `result_summary_hash`, count reconciliation, exact
derived-row cohort validation, and pre/post-publication window checks. These
controls close stale same-row transitions in source, but they do not provide
cross-record uniqueness. A distinct-row phantom publication race, hosted
`updateMany`/`$inc`/`$exists` atomicity proof, stable source snapshots, and
runtime-budget work remain blockers.

The same checkpoint makes `getAuthorizedPatient` assignment-aware for one exact
chart id. Agency-wide platform-owner/agency-admin/manager access and immutable
Patient-creator access remain; otherwise access requires one exact active
`PatientCareTeamAssignment` bound to the agency, patient, immutable user id and
email, current membership id and enablement version, and validated lifecycle,
source, transition, and version evidence. Tenant, Patient, and assignment
preimages are re-read before the finite purpose projection is returned.
`getMyTenantContext` now exposes the validated `membership_version`;
active/suspended membership rows carrying revocation metadata fail closed;
backend errors are logged without provider or PHI objects; and client wrappers
reject sparse, extra, or ill-typed projections. No SPA callsite was added.
`listAuthorizedPatients` did not gain assignment discovery; its only change is
shared membership-integrity and safe-logging parity.

At that source-only checkpoint, read-only staging queries found zero Agency,
AgencyMembership, Patient, OutcomeComputationRun, PatientOutcomeMetric, and
AgencyKPI rows, and `PatientCareTeamAssignment` was not yet hosted. The later
full synchronization rechecked zero rows, added the assignment schema, and made
`transition_version` required without a backfill because the run table was
still empty. That earlier checkpoint pushed no schema or function and changed no
staging or production data,
production app, domain, scheduler, secret, OASIS-v2/PDGM gate, native binary,
or app-store record.

The Patient read brokers are intentionally not wired into the SPA yet, and direct
`Patient.rls.read` remains broad rather than false. Cutover still requires
migrating every Patient read consumer, proving authenticated multi-row hosted
keyset traversal without gaps or duplicates, adding assignment-aware roster
discovery and assignment-version-aware cache eviction, completing
tenant/provenance and legacy-assignment backfill, and running the authenticated
two-agency matrix. The checkpoint changed no production app, data or schema,
domain, native binary, or app-store record.

Latest full validation passes 2,077 core tests, 34 schema/contracts, 414
security tests, 47 deduplication tests, and 1,005 component tests (3,577 checks
across the package groups). All 260 local backend functions transpile and all
244 shared-helper consumers match. ESLint, `typecheck:signal`, the
staging-bound build, dependency audit with one low and no high-severity finding,
and `git diff --check` pass.

The staging pass also removed mutable `account_type`/agency-profile privilege
from the highest-risk service-role paths: dashboard and alert reads/mutations,
message and fax writes, training questions/badges, chart-PDF export, PDF
index/search and risk analysis, bulk import/discharge processing, follow-up
portal minting/tasks, telehealth tokens, and state-reportable incident filing.
These now require direct immutable ownership/assignment or the protected Base44
admin role plus the configured platform-owner email, and they re-check exact
identifiers and relationships after privileged reads.

## Deliberate merge decisions

- Kept the newest Smart Note, visit preparation, medication reconciliation,
  referral upload, documentation review, OASIS safety, security, and responsive
  navigation work from PennSync2.
- Preserved CareMetric's entire `ios/` directory and full PWA manifest, then
  corrected the checked-in Xcode bundle identifier to the existing App Store
  bundle.
- Excluded `.base44/environment.json`, `.pnpm-store/`, and post-feature sandbox
  Docker configuration.
- Regenerated `pnpm-lock.yaml` with pnpm 11.9.0 and made both CI and Base44 use a
  frozen lockfile.
- Fixed the imported invitation lifecycle regression: invitations remain
  pending until a matching user is updated and approved.
- Kept the new OASIS v2 feature default OFF.

## Release blockers

Do not deploy this branch, move domains, enable OASIS v2, register new scheduled
functions, or upload a native binary until all of these are complete:

1. Continue validation in the separate nonproduction Base44 app. Exact entity
   and function inventory is now hosted, and anonymous-write denial is proved
   for the five critical OASIS/outcome/PDGM entities. The ignored legacy
   mutation-key syntax is fully migrated, but `20` no-RLS schemas, `26`
   mutation-open schemas, and `35` read-open schemas remain explicitly tracked
   debt. Before production, replace those permissive policies with reviewed
   per-operation tenant rules and prove authenticated multi-user isolation,
   uploads, shared-patient workflows, and negative cross-tenant cases with at
   least two agencies and owner/admin/clinician test users. Membership lifecycle
   and offboarding writes are intentionally restrictive but are still sequential
   rather than transactional; add datastore CAS/uniqueness, partial-failure
   audit/reconciliation, exact User-update readback, and a terminal rehire path.
   Patient creation and bounded updates are now broker-only, and hard deletion
   is disabled; direct Patient create/update/delete all fail closed. The eight
   legacy broad Patient writers are paused before access. Reviewed chart and
   roster read brokers are deployed to staging but intentionally unwired;
   Patient read RLS remains broad and consumers still use direct entity access
   plus client filtering. Migrate every read consumer, prove authenticated
   multi-row hosted keyset traversal and concurrency behavior. The immutable user-id care-team assignment schema is now hosted with direct
   CRUD denied, and the exact chart broker is hosted; the mutation broker remains
   deliberately withheld, unwired, and hard-paused. Prove the hosted assignment
   schema and chart broker with real staging users, then add assignment-aware
   roster discovery and design
   assignment-version-aware cache invalidation because `membership_version`
   alone cannot represent assignment revocation. Add hosted grant
   uniqueness/create-if-absent, multi-entity authorization atomicity,
   concurrent CAS proof, legacy backfill/quarantine, and merge-collision
   handling before deploying or wiring it. The mutation broker's literal
   default-off gate cannot be reviewed for opening without datastore create
   uniqueness and cross-entity atomicity. Complete the remaining subtractive
   service-role maintenance review, and remove the
   global-admin/sample read bypass only after a reviewed tenant/provenance
   backfill and authenticated two-agency proof.
2. Keep `oasis_response_schema_v2_enabled` false. Complete named clinical SME
   review, patient-access enforcement, remaining consumer wiring, and hosted RLS
   proof before any agency activation. Source now locks `OASISAssessment` and
   PHI-bearing `OASISUpload` writes to service role, hard-pauses
   `saveOasisResponses` with HTTP 503 before client creation/data access, and
   disables both browser legacy/v2 save adapters. The quick-upload widget is
   static so a PHI PDF cannot be stored before entity creation fails; dormant
   analyzer-update and supervisor-approval writers fail closed under the RLS
   rule and must not be restored directly. First build and stage a server-owned
   tenant + patient/chart authorization broker, including duplicate response
   rejection and upload/update/approval operations. Browser
   patient merge controls are now hard-paused before browser data access or
   mutation, and `deduplicatePatients` rejects every preview/apply request with
   HTTP 503 before client creation, authentication, or service-role patient
   reads. The old "dry-run" also depended on mutable claims and could expose
   cross-tenant PHI. A tenant-authoritative transactional server broker must
   atomically identify and move OASIS/outcome and every other linked row before
   either scanning or merging can return.
3. Keep `computeOutcomeMeasures` paused in production. The candidate source is
   internal-secret-only; it requires one explicit `agency_id`, stable
   `period_start`/`period_end`, and explicit supported `period_type` (including
   `custom` for non-calendar windows), scopes every service-role query, write, and
   retirement to that agency, and rejects foreign rows returned by the backend.
   Browser outcome reads/recompute and the Reports outcome summary are disabled
   meanwhile. The emitted rates are unadjusted internal proxies, not official
   CMS results. Deployment is still blocked until all of the following are
   completed:
   - the staging `OutcomeComputationRun` count was rechecked at zero immediately
     before and after the required `transition_version` / `result_summary_hash`
     schema push, so no row backfill was needed. Repeat the zero-row check before
     any future incompatible schema change and use a reviewed two-phase backfill
     if rows ever exist;
   - prove on hosted Base44 that a full-writer-preimage `updateMany` predicate
     using `$exists: false`, with one `$set` plus `$inc`, is atomic and returns
     reliable `success`, `updated`, and `has_more` values under competing
     requests;
   - add datastore-enforced single-winner uniqueness or a proved lease for each
     logical publication window. Source rejects ambiguous rows before and after
     publication, but a distinct-row phantom can still appear outside the final
     observation window; and
   - capture or pin a stable source snapshot for the complete computation run;
   - the hosted schemas now accept the optional tenant keys on `Patient`,
     `OASISAssessment`, `OASISUpload`, and `PatientOutcomeMetric`, the AgencyKPI
     lifecycle fields, `OutcomeComputationRun`, and
     `internal_gg_18_item_raw_sum` (an explicitly non-CMS context value), but
     existing-row compatibility and the
     `measure_results[].start_value`/`discharge_value` number-to-string change
     still need representative hosted migration tests;
   - every browser Patient create is now brokered and server-stamped, while the
     legacy bulk Patient apply mode is paused. OASIS assessment/upload creation
     must receive the same server-verified agency authority, and an audited
     backup + backfill must assign existing rows without guessing (legacy
     unscoped rows deliberately remain excluded and untouched);
   - every assessment writer rejects duplicate normalized item/definition rows,
     stamps verified definition/instrument provenance, and cannot be bypassed by
     a direct owner/admin entity update;
   - operation-specific RLS for `PatientOutcomeMetric`, `AgencyKPI`, and
     `OutcomeComputationRun` is service-role-only and hosted anonymous denial is
     proved; the publication-aware authorized server reader now exists, but it
     still needs authenticated two-agency hosted proof and deliberate UI
     integration before any tenant outcome surface is restored;
   - provision and operate the new service-owned `AgencyMembership` authority,
     finish invitation/rehire and datastore uniqueness guarantees, then
     integrate it into every protected Patient/OASIS/Document workflow; the
     lifecycle and tenant-context brokers exist but no staging tenant row has
     been provisioned, clinical rows are not yet stamped/backfilled, and
     Patient/OASIS admin-like RLS must still become tenant-bound;
   - replace the old global nightly invocation (`{}`) with secret-authenticated,
     one-agency requests carrying `{ agency_id, period_start, period_end, period_type }` for
     stable windows, including a defined rerun/retirement policy for windows
     whose discharges were removed or reassigned;
   - finish checkpoint/time-budget and snapshot-stability handling for the serial
     N+1 sweep. Source now paginates discharges, patient histories, exact episode
     metrics, and exact/stale KPI rows; contract tests cover a discharge cohort
     and a start assessment beyond the first 500 records. It also fails closed at
     explicit 50,000-discharge, 10,000-history-row, and 5,000-derived-row safety
     caps. Offset paging is not a stable datastore snapshot, however, and one
     invocation can still exceed a hosted runtime budget for a large agency;
   - add datastore-enforced uniqueness or a proved compare-and-swap/lease
     strategy for the computation-run key and each metric/KPI attempt. The
     append-only staging/readback/fingerprint/publication flow is substantially
     safer, but concurrent final claims can still race without a datastore
     primitive; add abandoned-run reconciliation and failure-injection tests;
   - capture or version a stable source snapshot for each run and make the
     authorized tenant reader select only the single published run. Append-only
     attempts avoid stale optional-field merges, but source changes during
     offset paging can still make one computation internally inconsistent; and
   - restore the OASIS Quality section and Reports outcome summary only through
     the proved tenant authorization boundary, with current calculation-version
     and lifecycle filters. They intentionally perform no direct entity reads now;
     and
   - keep direct Visit create/update/delete disabled and use the authorized
     create/update brokers; deletion remains unavailable. Backfill legacy Visit
     provenance and prove the full Visit lifecycle under the two-agency hosted
     matrix before any production publish.
4. Keep all PennSync PDGM reimbursement amounts disabled. The candidate now
   fails closed with `paymentAvailable:false`, `totalPayment:null`,
   `caseMixWeight:null`, and an actionable **Unavailable — not $0** result in
   every active UI/export consumer. A stored `is_official` flag cannot re-enable
   the legacy estimator, and rate-config writes cannot set it. Payment may be
   enabled only after all of the following are complete:
   - finish the source-verified CMS HHGS assignment into one of the official 432
     groups. The checked-in 432-row case-mix weights/LUPA thresholds and CY 2026
     functional/M1033 tables are present, but diagnosis clinical grouping,
     timing/admission interaction, and complete comorbidity assignment are not;
   - add CMS golden-case tests that prove grouping and payment parity for the
     applicable payment year, including wage-index and adjustment behavior;
   - keep the source-pinned M1800-M1860 and M1033 scoring fixtures aligned with
     the effective CMS grouper version, including the CY 2026 October version
     transition, and prove the remaining diagnosis/comorbidity fixtures;
   - resolve clinician-selected responses server-side from an authorized,
     tenant-scoped v2 OASIS assessment with protected provenance rather than
     trusting caller-supplied `response_schema_id` / `response_origin`; and
   - establish immutable hosted tenant authority for PDGM rate configuration.
     `PDGMRateConfig` is source-locked to service-role reads and platform-owner
     writes meanwhile; hosted Agency membership/RLS still requires proof before
     facility-admin rate editing can be restored.
5. Reconcile Apple/Google privacy disclosures with the clinical data actually
   handled by the app. As rechecked on 2026-09-03, both store listings remain
   live, but Google Play currently says “No data collected” while the product
   handles account, user-content, and clinical data. Treat this mismatch as a
   production/app-update blocker until the declaration is reviewed and corrected.
   The SPA now serves both `/privacy-policy` and the existing store-linked
   `/privacypolicy` alias. A reviewed `/eula` document still does not exist, so
   the Apple EULA link must be corrected only after approved legal text is
   available.
6. Recover and verify the original iOS and Android signing/build projects,
   in-app-purchase behavior, and store credentials before any native upload.
7. Run physical-device tests on the currently installed App Store and Play Store
   apps against the staged web release: cold launch, login, Smart Note,
   camera/microphone, uploads, downloads, telehealth, session persistence, and
   subscriptions.
8. Treat the current production app as a mixed release: PR `#142` already
   auto-synced source and hosted schema metadata, the old `CareMetric AI`
   JavaScript bundle remains live, and the pre-existing manifest says
   `PennSync by CareMetric`. Complete read-only production error-log and function
   inventory checks before any further production action. Then back up production
   data, document rollback, deploy frontend/functions/schema in one coordinated
   window, and smoke-test both permanent and custom origins. Verify that HTML,
   manifest, service worker, icons, backend function revisions, and asset hashes
   all resolve to the intended release before observing installed clients through
   rollback.

Only after those gates pass should `pennsync.com` and `app.pennsync.com` be moved
from the old Base44 app to the CareMetric app. Keep the old repositories and old
Base44 app read-only until both domains and installed mobile apps have been
observed healthy through the rollback window.
