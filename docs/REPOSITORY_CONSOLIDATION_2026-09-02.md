# PennSync repository consolidation

Status: **Production frontend containment verified; staging hardening continues; merge/production release remains blocked**.

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

## Legacy-data boundary (read-only inventory, 2026-09-03)

The old PennSync Base44 app is not empty and cannot be replaced by a DNS-only
domain move. A complete ID-only, paginated inventory counted all 236 hosted
entities without reading or exporting row contents:

| Inventory | Old PennSync app | CareMetric app |
| --- | ---: | ---: |
| Total rows | 8,672 | 3,190 |
| Nonempty entities | 35 | 37 |
| User rows | 8 | 2 |
| Patient rows | 387 | 1 |
| Hosted functions | 239 | 240 |

No User or Patient IDs overlap between the two apps. Seventeen entity types are
populated only in the old app (2,093 rows total), including 198 Visit, 10
CarePlan, 5 OASISUpload, 420 Physician, 190 ComplianceAudit, 522
PendingPatientUpdate, and 712 NoteConversion rows. Nineteen entity types are
populated only in CareMetric (1,397 rows total), led by 1,230 AgencyKPI rows.
The apps expose the same 236 schema names, but `Patient`, `OASISAssessment`,
`OASISUpload`, `PatientOutcomeMetric`, `AgencyKPI`, and `PDGMRateConfig` differ.
In particular, the CareMetric definitions add tenant scoping and tighter
service-owned access that make a blind copy or overwrite unsafe.

The required backup, transform, merge, reconciliation, and rollback sequence is
defined in
[`PENNSYNC_DATA_MIGRATION_RUNBOOK_2026-09-03.md`](./PENNSYNC_DATA_MIGRATION_RUNBOOK_2026-09-03.md).
No backup/export, row mutation, user/auth migration, file transfer, or domain
change was performed during this inventory.

## Production frontend containment (completed 2026-09-03)

Operational record and stop/rollback gates:
[`PRODUCTION_MIXED_RELEASE_CONTAINMENT_2026-09-03.md`](./PRODUCTION_MIXED_RELEASE_CONTAINMENT_2026-09-03.md).

Read-only comparison had identified a real compatibility incident between the
older browser bundle and the 14 hosted entity-schema changes auto-synced by
`67d9d5e`. An explicitly approved site-only publish contained that risk without
deploying backend resources.

- Both CareMetric origins now return HTTP 200 and serve
  `index-egZIJufH.js`.
- The live entry-asset SHA-256 is
  `145532107c092fa272821a6c215b886f3188d71091682d02af6ca529675928f7`,
  exactly matching the prepared fail-closed `67d9d5e` artifact.
- Production function inventory remained 240. Pulled
  `deduplicatePatients`, `saveOasisResponses`, and `calculatePDGM` source
  matched the hardened baseline.
- Focused production logs returned no retained `computeOutcomeMeasures`
  entries for the 2026-09-03 06:00 UTC schedule window or post-deployment
  period. A separately approved targeted revision then preserved the exact
  function code and changed only the existing scheduler to
  `is_active: false`; immediate pull-back verified the inactive state.
- No production-data migration, function/schema deployment, secret change,
  domain move, native upload, or Apple/Google record change was performed.
  `pennsync.com` continues to serve its separate `index--wkWNhXC.js` bundle.

Patient merge, OASIS write/upload/review, PDGM reimbursement/rate editing, and
outcome/KPI publication remain held until their separate release gates pass.
Service-worker retirement is intentional; the SPA fallback at
`/service-worker.js` is not a deployment defect.

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
| Runtime candidate | Hosted functional baseline `655624f749c1c94542e6eb616a31b1c9c1135eef`; the latest staged frontend checkpoint predates later source-only changes in draft PR `#143`. The current draft source also controls the deliberately unhosted `computeOutcomeMeasures` pause |
| Frontend | Hosted staging contains the last synchronized frontend baseline with staging-specific app configuration. Later PR `#143` roster, PDGM-retirement, reactivation, and User-deletion UI hardening remains source-only; the current source staging-ID build passes |
| PWA/native identity | Relative manifest `id`, `start_url`, and `scope`; four manifest icons retained; Apple bundle `com.caremetric.ai`; Google package `com.caremetic.ai`; iOS WebView origin `https://caremetricai.base44.app/` |
| Entities | Hosted staging contains the same 241 entity names. `PatientCareTeamAssignment`, `DocumentTenantBinding`, and the required `OutcomeComputationRun.transition_version` / `result_summary_hash` fields are hosted. Current source-to-host semantic equality has not been re-established after later source-only schema hardening, including the required `OutcomeComputationRun.lease_expires_at` field |
| Functions | Hosted inventory remains 258. The current candidate source contains 265 functions. Seven are deliberately unhosted: `computeOutcomeMeasures`, `managePatientCareTeamAssignment`, `getAuthorizedVisit`, `listAuthorizedVisits`, `readAuthorizedOASISAssessments`, `getAuthorizedDocument`, and `listAuthorizedDocuments`; hardening to several already-hosted functions is also source-only pending a later reviewed staging deployment |
| Data | Rechecks confirm zero staging rows in Agency, AgencyMembership, Patient, PatientCareTeamAssignment, DocumentTenantBinding, OutcomeComputationRun, PatientOutcomeMetric, and AgencyKPI; no migration or production data write occurred |
| Secrets/schedules | `INTERNAL_FN_SECRET` remains absent and no outcome schedule was added |
| Feature gates | No AgencySettings row exists; OASIS v2 remains default-off and the hosted `saveOasisResponses` remains hard-paused. Hosted PDGM reimbursement remains disabled; current source adds an independent retirement lock that has not been deployed. All seven deliberately unhosted functions remain unwired |
| Time zone | `America/New_York` is the default business/agency clock, giving Eastern Standard or Daylight Time as seasonally appropriate |
| Validation | Current source verification passes 2,122 utility/core, 36 schema/contract, 490 security, 47 deduplication, and 1,069 component tests (3,764 package checks); all 265 function transpiles, all 243 shared-helper consumers, full and workflow-target ESLint, type checks, actionlint, the OASIS worksheet, the 19-check component accessibility gate, and the staging-ID build also pass |
| Production auto-sync | PR `#142` auto-fast-forwarded the CareMetric Base44 source workspace to merged `main` `67d9d5ee66aad222a712e6ba49d00461d0a68337` at 2026-09-02 19:58:30 UTC, and the workspace remains clean there. Read-only hosted metadata also exposes fields/RLS introduced by that merge; the git diff changed 14 entity schemas. This was a production source and hosted-schema change, not a source-only event |
| Production function status | Inventory remains 240. Pulled `deduplicatePatients`, `saveOasisResponses`, and `calculatePDGM` match the hardened baseline. `computeOutcomeMeasures` entry SHA-256 remained `2c2a37bf...` while its existing schedule was intentionally set to `is_active:false`; no post-change logs were returned |
| Live production surfaces | Rechecked on 2026-09-04: `caremetricai.base44.app` and `app.caremetricai.com` return HTTP 200 and the verified `index-egZIJufH.js` asset with unchanged SHA-256 `145532107c092fa272821a6c215b886f3188d71091682d02af6ca529675928f7`; `pennsync.com` still returns separate `index--wkWNhXC.js`, so no domain cutover occurred |
| Manifest/PWA | The production-facing manifest says `PennSync by CareMetric`; its relative `id`, `start_url`, and `scope`, four icons, and historical branding remain intact. The contained frontend and manifest are now on the same verified source baseline |
| Current safety boundary | The frontend containment changed only the production site bundle. A later, separately authorized change redeployed only the byte-identical `computeOutcomeMeasures` function to disable its existing scheduler. Subsequent membership, outcome/recovery, Patient/Visit/OASIS/Document read-broker, schema-hardening, and PDGM-retirement work is source-only in draft PR `#143`. No production data/schema API mutation, other function/secret change, domain move, native upload, or Apple/Google record change occurred |

The initial entity deployment exposed unsupported `$contains` array-membership
RLS in Message and SharedDocument. Draft PR `#143` replaces it with Base44's
accepted `data.<array>.$in` form and adds a repository-wide operator contract.
All four PR workflows pass.

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
inventory is `19 / 241` schemas with no RLS, `25 / 241` permitting unrestricted
mutations, and `34 / 241` permitting
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

The same checkpoint made `getAuthorizedPatient` assignment-aware for one exact
chart id. Agency-wide platform-owner/agency-admin/manager access and immutable
Patient-creator access remain; otherwise access requires one exact active
`PatientCareTeamAssignment` bound to the agency, patient, immutable user id and
email, current membership id and enablement version, and validated lifecycle,
source, transition, and version evidence. Tenant, Patient, and assignment
preimages are re-read before the finite purpose projection is returned.
`getMyTenantContext` now exposes the validated `membership_version`;
active/suspended membership rows carrying revocation metadata fail closed;
backend errors are logged without provider or PHI objects; and client wrappers
reject sparse, extra, or ill-typed projections.

A later source-only checkpoint added assignment-aware bounded roster discovery
to `listAuthorizedPatients` and migrated `PatientEducationPortal` to an opt-in
authorized roster hook. The roster requires the same immutable membership and
assignment enablement versions and rejects unstable keyset pages. The exact
Patient hook was separately hardened to conceal and evict cached PHI during
authority revalidation, failures, and session changes. It remains unwired after
three proposed UI cutovers were reverted because those consumers did not yet
provide a proved agency boundary.

At that source-only checkpoint, read-only staging queries found zero Agency,
AgencyMembership, Patient, OutcomeComputationRun, PatientOutcomeMetric, and
AgencyKPI rows, and `PatientCareTeamAssignment` was not yet hosted. The later
full synchronization rechecked zero rows, added the assignment schema, and made
`transition_version` required without a backfill because the run table was
still empty. That earlier checkpoint pushed no schema or function and changed no
staging or production data,
production app, domain, scheduler, secret, OASIS-v2/PDGM gate, native binary,
or app-store record.

The authorized roster has one opt-in SPA consumer; the exact Patient hook and
most Patient reads remain unmigrated. Direct `Patient.rls.read` therefore remains
broad rather than false. Cutover still requires migrating every remaining
Patient read consumer, proving authenticated multi-row hosted keyset traversal
without gaps or duplicates, completing assignment-version-aware cache
invalidation across every consumer, tenant/provenance and legacy-assignment
backfill, and the authenticated two-agency matrix. The roster and hook source
checkpoints made no further hosted or production change. The separately
described full synchronization did change isolated staging schema/function
state, but not production.

The latest source-only hardening adds finite read boundaries for the next
clinical surfaces without deploying or wiring them:

- `getAuthorizedVisit` and `listAuthorizedVisits` enforce immutable tenant,
  creator, and care-team authority, bounded keyset traversal, exact projections,
  and a final disclosure-time recheck.
- `readAuthorizedOASISAssessments` supports one exact verified-response read or
  one bounded metadata-only list. It rejects legacy, AI, unverified, duplicate,
  oversized, cross-tenant, and unstable rows and returns no response payload in
  list mode.
- `getAuthorizedDocument` and `listAuthorizedDocuments` bind every read through
  `DocumentTenantBinding`, Patient and assignment authority, and repeated
  disclosure-time preimage checks. The new brokers expose no `file_url` and
  cannot support downloads. Legacy direct Document readers and View/Download
  controls still consume stored `file_url`, and the legacy uploader still
  performs direct upload/create; those paths remain release-blocking migration
  debt.
- Membership lifecycle operations now reconcile exact User and membership
  preimages/readbacks, reject unapproved User-field drift, verify cleanup rows,
  and recheck the exact current caller at mutation boundaries. Reactivation is
  hard-paused before client creation because legacy creator/email grants could
  otherwise restore PHI without tenant authority; the UI no longer offers it.
  Offboarding revalidates the protected owner at each mutation phase and removes
  canonical plus bounded legacy-case Patient assignments with exact readback.
  The membership
  broker rejects the configured owner identity as the target of inspect,
  provision, activate, suspend, revoke, or role-change actions. This prevents
  that broker from creating or transitioning owner memberships. Current source
  also makes tenant context and every new Patient/Visit/OASIS/Document authority
  load exact-query owner membership state and fail closed on any row or
  duplicate. Because that source is not hosted, staged proof plus reviewed
  cleanup of any preexisting owner rows remain blockers. These checks reduce
  sequential failure risk but do not create a datastore transaction or
  uniqueness guarantee.
- The browser-side permanent `User.delete` control and mutation path are removed
  in source. Offboarding is the only retained account-removal workflow, and a
  registered contract prevents direct browser User deletion from returning.
  This source-only removal is not yet present in the live production bundle.
- `getPatientContext` is now a static HTTP 410 tombstone with no request, SDK,
  auth, entity, or service-role access. `PatientDetails` uses only the exact
  Patient `display` and bounded Visit `schedule` brokers, stores no returned
  Visit rows, and renders a neutral containment state with no patient name or
  downstream chart panel. Both brokers append an awaited, server-derived
  privileged disclosure record before returning PHI and fail closed if that
  audit write fails. Patient and Visit proof must freshly settle after mount;
  cache identity includes immutable user/membership authority; foreign-patient
  rows, scope drift, offline-paused proof, stale refetches, duplicate pages, and
  a 5,000-Visit overrun are rejected.
- Primary desktop/mobile patient links receive agency scope only from a freshly
  revalidated, server-owned singleton membership. Legacy id-only entry points
  first normalize that same immutable agency into the encoded URL and perform
  no Patient or Visit read until the subsequent explicit-route render. An
  ambiguous multi-membership user or unscoped platform owner remains disabled
  until an explicit agency selector is implemented; mutable User and Patient
  agency fields are never used as route authority.
- The offline OASIS provenance annotator now treats a `native_v2` label as an
  untrusted claim and revalidates exact canonical response definitions, value
  shapes, instrument/timepoint, source, timestamps, clinician identity, AI
  exclusion, and row uniqueness. It rejects lossy unsafe integers and ambiguous
  identifiers, quarantines the entire assessment on any invalid v2 row, writes
  report/data artifacts exclusively at mode `0600`, and requires a separate
  round-trippable `--data-out`. Applied data is persisted before completion
  evidence; the final report binds the exact data bytes by full SHA-256, and a
  failed data write cannot leave a success-looking apply report.
- Source pins the three CY 2026 CMS HHGS distribution and inner-artifact hashes
  and provides an offline Java 17 verifier. A recorded 2026-09-03 run against
  externally downloaded, manifest-matching v07.0.26, v07.1.26, and v07.2.26
  ZIPs matched all 310 bundled CMS fixture records. The ZIPs are not committed;
  this verifies the official distributions and runner, not PennSync grouper
  parity. An independent
  retirement lock now also gates every audited frontend and backend legacy PDGM
  financial consumer, so changing only the ordinary feature flag cannot restore
  reimbursement values.

No Base44 deployment, schema push, data access or mutation, secret/schedule
change, production publication, domain move, native upload, or store-record
change occurred during this latest source-only work.

Current source verification passes 2,122 utility/core tests, 36
schema/contracts, 490 security tests, 47 deduplication tests, and 1,069
component tests (3,764 package checks). All 265 local backend functions
transpile and all 243 shared-helper consumers match. Full and workflow-target
ESLint, the complete and focused type checks, actionlint, the 36-item OASIS
worksheet, the 19-check component accessibility gate, the staging-ID build,
and `git diff --check` pass. The nonvendored official CMS HHGS ZIPs were not
present for a fresh external verifier run; the previously recorded 310/310
manifest-matching run remains evidence for the verifier only, not PennSync
grouper parity. The package-registry dependency-audit endpoint was unavailable
under the current network policy, so no new dependency-audit claim is made for
this checkpoint.

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

1. Continue validation in the separate nonproduction Base44 app. Hosted staging
   has 241 entity names and 258 functions. Current source has 265 functions,
   with the seven named functions deliberately unhosted, and later source-only
   schema/function hardening still requires reviewed synchronization.
   Anonymous-write denial is proved for the five critical OASIS/outcome/PDGM
   entities. The ignored legacy
   mutation-key syntax is fully migrated, but `19` no-RLS schemas, `25`
   mutation-open schemas, and `34` read-open schemas remain explicitly tracked
   debt. Before production, replace those permissive policies with reviewed
   per-operation tenant rules and prove authenticated multi-user isolation,
   uploads, shared-patient workflows, and negative cross-tenant cases with at
   least two agencies and owner/admin/clinician test users. Membership lifecycle
   and offboarding writes are intentionally restrictive, reconcile exact User,
   membership, and cleanup readbacks, and reject the protected platform owner
   as a membership-lifecycle target, but they are still sequential rather than transactional;
   add datastore CAS/uniqueness, operational partial-failure reconciliation,
   and a terminal rehire path. Current source removes the direct permanent User
   deletion control; verify that removal in hosted staging before a later
   production publication so offboarding cannot be bypassed.
   Patient creation and bounded updates are now broker-only, and hard deletion
   is disabled; direct Patient create/update/delete all fail closed. The eight
   legacy broad Patient writers are paused before access. Earlier chart and
   roster brokers are hosted, while the assignment-aware roster revision and
   its first opt-in UI consumer remain source-only. `PatientDetails` now
   consumes the hardened exact Patient and Visit schedule brokers behind a
   neutral whole-chart containment state, with immutable singleton route-scope
   normalization and explicit agency requirements for ambiguous users. The
   broad legacy context endpoint is a source-only 410 tombstone pending hosted
   replacement. Patient read RLS remains broad and most consumers still use
   direct entity access plus client filtering. Migrate every remaining read
   consumer and prove authenticated multi-row hosted keyset traversal, cache
   eviction, and concurrency behavior. Source-only Visit read brokers and OASIS
   exact/summary reads require the same two-agency hosted proof before wiring.
   Disable or migrate the existing direct Document list/download and direct
   upload/create paths, add private authenticated file delivery, and then prove
   binding and disclosure behavior on hosted staging. Prove the protected owner
   has no existing membership rows and quarantine/remove any such rows through
   a reviewed migration. Current source makes the new tenant-context and
   clinical authorization paths fail closed when owner membership state is
   observed; verify that behavior after a reviewed staging synchronization. The immutable user-id care-team assignment schema is now hosted with direct
   CRUD denied, and the exact chart broker is hosted; the mutation broker remains
   deliberately withheld, unwired, and hard-paused. Prove the hosted assignment
   schema and chart broker with real staging users, then complete
   assignment-version-aware cache invalidation across all consumers because
   `membership_version` alone cannot represent assignment revocation. Add hosted grant
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
   rule and must not be restored directly. The source-only OASIS read broker now
   provides exact verified-response and bounded metadata-summary modes, but it
   is unwired and unhosted; prove it with two real staging agencies before any
   read cutover. Build and stage a server-owned tenant + patient/chart write
   broker, including duplicate response rejection and upload/update/approval
   operations. Browser
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
     strategy for the computation-run key and each metric/KPI attempt. Source
     now includes bounded expired-run reconciliation and recovery/concurrency
     tests. Before deployment, add the required `lease_expires_at` schema after
     a fresh zero-row check or reviewed backfill, prove hosted
     `updateMany`/`$inc` semantics under competing requests, and establish
     operational failure reconciliation plus a datastore-backed single-winner
     guarantee;
   - capture or version a stable source snapshot for each run and make the
     authorized tenant reader select only the single published run. Append-only
     attempts avoid stale optional-field merges, but source changes during
     offset paging can still make one computation internally inconsistent; and
   - restore the OASIS Quality section and Reports outcome summary only through
     the proved tenant authorization boundary, with current calculation-version
     and lifecycle filters. They intentionally perform no direct entity reads now;
     and
   - keep direct Visit create/update/delete disabled and use the authorized
     create/update brokers; deletion remains unavailable. The new exact/list
     Visit read brokers are source-only and unwired. Backfill legacy Visit
     provenance and prove both read disclosure and the full mutation lifecycle
     under the two-agency hosted matrix before any production publish.
4. Keep all PennSync PDGM reimbursement amounts disabled. The candidate now
   fails closed with `paymentAvailable:false`, `totalPayment:null`,
   `caseMixWeight:null`, and an actionable **Unavailable — not $0** result in
   every active UI/export consumer. A stored `is_official` flag cannot re-enable
   the legacy estimator, rate-config writes cannot set it, and an independent
   retirement lock means changing only the ordinary reimbursement flag cannot
   revive audited frontend or backend financial consumers. Payment may be
   enabled only after all of the following are complete:
   - finish the source-verified CMS HHGS assignment into one of the official 432
     groups. The checked-in 432-row case-mix weights/LUPA thresholds and CY 2026
     functional/M1033 tables are present. Source pins the official v07.0.26,
     v07.1.26, and v07.2.26 distribution and inner-artifact hashes; a recorded
     run against externally supplied matching ZIPs reproduced all 310 included
     CMS fixture outputs offline. That validates the CMS evidence and verifier,
     not the PennSync port:
     diagnosis clinical grouping, timing/admission interaction, and complete
     comorbidity assignment are still absent;
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
   handled by the app. As rechecked on 2026-09-04, both store listings remain
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
8. Frontend mixed-release containment is complete and verified, and the
   historical production outcome schedule is now inactive. Keep remaining
   backend work staged and separately reviewed, then complete hosted two-agency,
   tenant/CAS, outcome, PDGM, Document, native-device, privacy, signing/IAP,
   backup, and rollback gates before any domain or store step.

Only after those gates pass should `pennsync.com` and `app.pennsync.com` be moved
from the old Base44 app to the CareMetric app. Keep the old repositories and old
Base44 app read-only until both domains and installed mobile apps have been
observed healthy through the rollback window.
