# PennSync repository consolidation

Status: **Post-synchronization source hardening validated locally; PR #143 hosted-staging evidence remains intact; production containment unchanged; merge/production release remains blocked**.

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

## Nonproduction hosted-validation evidence (updated 2026-09-04)

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
| Runtime candidate | Deployed staging runtime commit `f4e41dc2d5481c7e23dd84e6e70464691bfdabd8`, tree `94888934ebf417071b286e3a74904c872bd70777`, from draft PR `#143`; the evidence-only documentation commit after this deployment does not change runtime resources |
| Frontend | Clean-path, frozen-lockfile staging build serves `assets/index-D2D5VcVB.js` (450,726 bytes), SHA-256 `a27bd29cc0f1797e4769ec6b873248ae3c12d952f7547ce4a6f402a9a1955c13`. All 505 local build files matched their hosted counterparts byte-for-byte with zero errors; `/`, `/privacy`, `/privacypolicy`, the manifest, and all four icons return HTTP 200. The complete build contains the staging app id once, the production app id zero times, and `America/New_York` nine times |
| PWA/native identity | Relative manifest `id`, `start_url`, and `scope`; four manifest icons retained; Apple bundle `com.caremetric.ai`; Google package `com.caremetic.ai`; iOS WebView origin `https://caremetricai.base44.app/` |
| Entities | Hosted staging and the deployed checkpoint have the same 241 entity names. Canonical deployed-source-to-host comparison is exact for `Document`, `OutcomeComputationRun`, `PDGMRateConfig`, and `PatientPathwayAssignment`, including required `OutcomeComputationRun.lease_expires_at` and the reviewed operation-specific access rules. The newer source-only PR head has 242 names because it adds the private `AIContentAgreementAttestation` authority entity; it also changes Document/RLS definitions and is not hosted |
| Functions | Hosted staging has 263 functions: the exact deployed 265-function PR checkpoint minus deliberately withheld `computeOutcomeMeasures` and `managePatientCareTeamAssignment`. The newer source-only PR head has 267 functions and is not hosted. Both withheld functions remain absent from hosted staging, and the hosted inventory contains zero automation entries |
| Data | Post-deployment privileged rechecks found zero rows in OutcomeComputationRun, AgencyMembership, Agency, Patient, Visit, Document, PatientCareTeamAssignment, OASISAssessment, OASISUpload, PatientOutcomeMetric, AgencyKPI, PDGMRateConfig, and PatientPathwayAssignment; User remained at its pre-existing count of one. No probe residue, migration, or production data write occurred |
| Secrets/schedules | No secret was changed and no schedule or automation was added; `computeOutcomeMeasures` remains deliberately unhosted |
| Feature gates | Clinical AI, OASIS, and legacy PDGM financial paths remain fail-closed: six anonymous safe-pause probes returned the expected HTTP 409 reasons. `computeOutcomeMeasures` and `managePatientCareTeamAssignment` remain absent and unwired. The legacy `getPatientContext` endpoint is hosted only as an HTTP 410 tombstone |
| Time zone | `America/New_York` is the default business/agency clock, giving Eastern Standard or Daylight Time as seasonally appropriate |
| Validation | The deployed staging checkpoint passed 2,122 utility/core, 36 schema/contract, 490 security, 47 deduplication, and 1,069 component tests (3,764 package checks); all 265 function transpiles, all 243 shared-helper consumers, full and workflow-target ESLint, type checks, actionlint, the OASIS worksheet, the 19-check component accessibility gate, and the staging-ID build also passed. The newer source-only tranche is recorded separately below and is not hosted |
| Production auto-sync | PR `#142` auto-fast-forwarded the CareMetric Base44 source workspace to merged `main` `67d9d5ee66aad222a712e6ba49d00461d0a68337` at 2026-09-02 19:58:30 UTC, and the workspace remains clean there. Read-only hosted metadata also exposes fields/RLS introduced by that merge; the git diff changed 14 entity schemas. This was a production source and hosted-schema change, not a source-only event |
| Production function status | Inventory remains 240. Pulled `deduplicatePatients`, `saveOasisResponses`, and `calculatePDGM` match the hardened baseline. `computeOutcomeMeasures` entry SHA-256 remained `2c2a37bf...` while its existing schedule was intentionally set to `is_active:false`; no post-change logs were returned |
| Live production surfaces | Rechecked on 2026-09-04: `caremetricai.base44.app` and `app.caremetricai.com` return HTTP 200 and the verified `index-egZIJufH.js` asset with unchanged SHA-256 `145532107c092fa272821a6c215b886f3188d71091682d02af6ca529675928f7`; `pennsync.com` still returns separate `index--wkWNhXC.js`, so no domain cutover occurred |
| Manifest/PWA | The production-facing manifest says `PennSync by CareMetric`; its relative `id`, `start_url`, and `scope`, four icons, and historical branding remain intact. The contained frontend and manifest are now on the same verified source baseline |
| Current safety boundary | The deployed PR `#143` checkpoint is synchronized only to the isolated staging app; the newer source-only PR head is not hosted. Production remains on the contained site bundle; its only later backend revision was the separately authorized byte-identical `computeOutcomeMeasures` scheduler disablement. No production data/schema API mutation, additional function or secret change, domain move, native upload, or Apple/Google record change occurred |

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

Final verification for the current source revision is recorded once in the
post-synchronization checkpoint below. The nonvendored official CMS HHGS ZIPs
were not present for a fresh external verifier run; the previously recorded
310/310 manifest-matching run remains evidence for the verifier only, not
PennSync grouper parity.

The staging pass also removed mutable `account_type`/agency-profile privilege
from the highest-risk service-role paths: dashboard and alert reads/mutations,
message and fax writes, training questions/badges, chart-PDF export, PDF
index/search and risk analysis, bulk import/discharge processing, follow-up
portal minting/tasks, telehealth tokens, and state-reportable incident filing.
These now require direct immutable ownership/assignment or the protected Base44
admin role plus the configured platform-owner email, and they re-check exact
identifiers and relationships after privileged reads.

### PR #143 reviewed staging synchronization (2026-09-04)

The approved staging-only deployment was preceded by Base44 checkpoint
`Pre-PR143 reviewed staging deployment — 2026-09-04` and targeted only
`caremetric-pennsync-staging-2026-09-02`
(`6a9881683dc68a0bd54f1ef7`). The deployed runtime source is commit
`f4e41dc2d5481c7e23dd84e6e70464691bfdabd8`, tree
`94888934ebf417071b286e3a74904c872bd70777`.

- The hosted schema inventory has 241 names with no source/host name diff.
  Canonical definitions match for `Document`, `OutcomeComputationRun`,
  `PDGMRateConfig`, and `PatientPathwayAssignment`.
- The hosted function inventory has 263 entries and exactly equals the PR
  function set minus `computeOutcomeMeasures` and
  `managePatientCareTeamAssignment`. Both withheld functions are absent and the
  inventory contains zero automation entries.
- Anonymous function checks returned eleven expected HTTP 401 denials, six
  expected HTTP 409 safe-pauses, and the expected HTTP 410 legacy-context
  tombstone; no probe returned 2xx or 5xx. Anonymous creates against
  `OutcomeComputationRun`, `PDGMRateConfig`, and `PatientPathwayAssignment`
  returned HTTP 403.
- The corrected clean-path frontend build serves `assets/index-D2D5VcVB.js`,
  SHA-256
  `a27bd29cc0f1797e4769ec6b873248ae3c12d952f7547ce4a6f402a9a1955c13`.
  Every one of 505 build files matched the hosted byte stream, all reviewed
  public routes and PWA assets returned HTTP 200, and the manifest retained
  relative `id`, `start_url`, and `scope` plus all four icons.
- Privileged post-probe counts remained zero for the reviewed clinical,
  tenant, document, outcome, PDGM, and assignment entities; the staging User
  count remained one. No probe residue was found.
- Production stayed at 236 schemas and 240 functions. Both CareMetric origins
  continued to serve unchanged `index-egZIJufH.js` bytes with SHA-256
  `145532107c092fa272821a6c215b886f3188d71091682d02af6ca529675928f7`,
  while `pennsync.com` continued to serve its separate bundle. No production,
  secret, data, domain, native, or store mutation was part of this deployment.

This synchronization proves the 241-name schema inventory, canonical parity for
the four reviewed schemas, the 263-function name inventory, byte-for-byte
frontend parity, the recorded anonymous denials and safe-pauses, and zero
checked-row residue for the isolated staging candidate. It does not supply the
authenticated two-agency workflow evidence or the datastore atomicity,
migration, clinical, device, store, and production-cutover approvals listed
below.

### Post-synchronization source-only hardening (2026-09-04)

Three revisions must remain distinct. The isolated staging app still runs
`f4e41dc2d5481c7e23dd84e6e70464691bfdabd8`, tree
`94888934ebf417071b286e3a74904c872bd70777`. Before this tranche, draft PR
`#143` pointed to evidence-only commit
`869dd08c987897fe3e99fbb2a905b655f2ff1d23`, tree
`cb0b51e9f61f1a3b95bab53dad093b70b15ff5b7`. The source hardening below is the
source-only PR head containing this checkpoint; it has not been deployed, and
the earlier hosted parity, anonymous probes, and zero-row evidence do not prove
it.

- Live-readiness input is harder to false-pass. A plan-only, non-PHI fixture
  manifest pins the exact staging target, five actors, two agencies, three
  synthetic patients, and only the A1-to-Clinician-A assignment. Its validator
  rejects production or unreviewed targets, topology drift, credentials, and
  PHI-shaped fields without network access or writes. The evidence reporter now
  requires the exact LR-01/LR-02 matrix and staging identity, rejects
  placeholders, unknown fields, malformed or extra CLI input, and a capability
  marked done without artifact references for every required probe (`V1`–`V6`,
  `T1`–`T4`, or `S1`–`S4`). It does not echo private input details. Candidate
  and hosted deployable-resource hashes are independently reviewed external
  inventory attestations, not manifests generated or retrieved by this
  repository; their scope and exclusions still require release review. A
  successful local validation proves only plan structure: it neither
  provisions fixtures nor supplies hosted evidence. The withheld assignment
  mutation broker still prevents approved creation of the hosted assignment,
  and this fixture plan does not encode the Referral needed by `S3` or the
  reviewed Visit-creation prerequisite needed by `S4`.
- The unwired Document foundation advances from the hosted version-1 public-URL
  binding to a source-only version-2 private-storage design.
  `createAuthorizedDocument` uses `UploadPrivateFile`, keeps the opaque
  `file_uri` only in the service-owned binding, emits metadata-only Document
  rows, and validates exact current care-team assignment authority.
  `getAuthorizedDocument` creates a 60-second signed URL only for an exact
  download purpose, revalidates authority after signing, and returns
  `Cache-Control: no-store`; list responses never expose or sign a storage
  pointer. Version 2 is not wired, migrated, or runtime-proved, and direct
  legacy Document creation remains permitted as explicit debt.
- `saveOasisResponses` now contains a server-owned create-draft design beneath
  the literal `OASIS_V2_WRITES_PAUSED = true` gate. It derives tenant,
  clinician, chart, schema, lifecycle, and response provenance; validates exact
  membership, Agency, Patient, optional Visit, assignment, settings, and
  clinician-selected v2 rows; and uses service-role create plus exact
  readbacks. The gate returns HTTP 503 before body parsing, client creation,
  authentication, or data access, and no browser path is wired. Tests exercise
  the dormant branch only in an isolated rewritten copy. Idempotency,
  transaction/recovery semantics, named Visit-to-time-point clinical review,
  hosted two-agency proof, and update/upload/submit/approval workflows remain
  open.
- `UserActivity` is source-locked against every direct SDK write and remains
  admin-readable. Generic browser activity/audit helpers are no-ops; retained
  backend appenders use service role and minimize phone numbers, MRNs, clinical
  narratives, search text, and storage capabilities. AI-agreement acceptance
  derives and rechecks the exact actor, appends a minimized `UserActivity`
  audit event, then creates and reads back a dedicated immutable
  `AIContentAgreementAttestation`. The new status broker trusts only that
  service-owned authority entity; historical versions re-prompt and legacy
  mutable User agreement flags are ignored. The cross-entity audit/attestation
  sequence is still nontransactional and needs hosted idempotency, retry, and
  recovery proof.
- Direct `SecurityLog` mutation is source-locked and generic browser security
  logging is a no-op. Purpose-specific backend writers use service role and
  omit the reviewed phone, secret, tenant-name, clinical, and caller-supplied
  network fields. This is containment, not an authoritative hosted audit
  boundary: built-in admins can still read the global log through direct
  browser consumers, so tenant/provenance-scoped read brokers, migration, and
  two-agency proof remain required. Login telemetry is deliberately disabled
  until Base44 exposes a provider-authenticated, idempotent session event.
- `markMessageRead` now authorizes before its write-free retry path and requires
  bounded `updateMany` results plus exact persisted readback for both reader and
  completion updates. Ambiguous results, missing persistence, participant drift,
  duplicates, and pagination fail closed. Hosted Base44 concurrency and
  `updateMany` semantics remain unproved for this revision.
- Patient communications and telehealth now fail closed wherever routing or
  provider authority still depends on caller-editable records. Direct
  `SmsConsent`, `ScheduledSms`, `SmsMessage`, `ScheduledFax`, and
  `TelehealthSession` access is disabled. Scheduled SMS creation/dispatch, SMS
  redrive, batch/scheduled/retry fax transmission, and telehealth token minting
  have literal HTTP 503 migration gates before SDK construction or hosted
  reads. After Ed25519 verification, signed inbound SMS, inbound fax, and
  inbound-call routing return retryable HTTP 503 before any mutable
  `User`/`AgencySettings` route lookup; outbound delivery-status reconciliation
  remains reachable. This intentionally pauses inbound STOP/START processing
  too: the current consent ledger cannot safely bind a dialed number to one
  immutable tenant, so this source must not be deployed until compliant keyword
  capture and service-owned routing bindings are implemented. Remaining active
  provider actions and phone administration are restricted to the exact
  configured protected owner, and `sendSms` performs its already-authorized
  message bookkeeping with service role. Legacy exact creator, assignee,
  self-duty, and incident-owner paths now additionally require one exact active
  service-owned `AgencyMembership`; mutable `User.is_active`, `account_type`,
  `agency_name`, and phone fields grant no reviewed authority.
- Task-bearing AI pathway activation and direct IDT coordination-alert creation
  are paused pending atomic, idempotent patient-authorized brokers. Dormant
  `CareCoordinationAlert`, `TeamNote`, `PatientRecommendation`, and
  `OASISAutomationRule` access is fail-closed. These are containment decisions,
  not completed workflows.
- Source-only RLS review reduces the pinned debt from `19 / 25 / 34` to
  `10 / 16 / 28` for schemas with no RLS, unrestricted mutations, and
  unrestricted reads. The remaining education, fax/Medicare configuration,
  discharge/note, and Document policies still require tenant provenance,
  purpose-bound brokers, backfill, and authenticated cross-tenant proof.
  Built-in admin-only rules reduce exposure but do not create tenant isolation.

Source validation passes 2,151 utility/core, 51 schema/contract, 559 security,
47 deduplication, and 1,084 component tests: 3,892 package checks with zero
failures. The 19-test accessibility subset, all 267 backend transpiles, all 242
shared-helper consumers, full ESLint, both type checks, actionlint, the 36-item
OASIS worksheet, the source build, and `git diff --check` also pass. The current
source inventory is 242 entity schemas and 267 backend functions. The fixture
plan validates, and the untouched evidence template correctly exits 2 because
it contains no hosted proof. The production dependency audit reports one
low-severity advisory and no high-severity advisory. The CMS verifier was not
executed because its three official ZIP inputs are not vendored.

No Base44 deployment, schema or function push, hosted-data access or mutation,
secret or schedule change, production publication, domain move, native upload,
or store-record change occurred for this source-only checkpoint.

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

Do not merge or deploy this branch to production, move domains, enable OASIS
v2, register new scheduled functions, or upload a native binary until all of
these are complete:

1. Continue authenticated validation in the separate nonproduction Base44 app.
   The last deployed staging runtime remains `f4e41dc2`, with 241 schemas and
   263 functions; its synchronization evidence applies only to that tree.
   Pre-update PR head `869dd08c` is evidence-only, and the current source-only
   PR head has not been deployed. Before production,
   deploy the new revision only to isolated staging and repeat exact
   schema/function/site parity, anonymous denials, authenticated two-agency
   positive and cross-tenant tests, and post-probe residue checks.

   The reviewed fixture-plan validator and stricter evidence reporter prevent
   several local false-pass shapes, but they neither provision hosted
   identities nor prove LR-01/LR-02. The reviewed assignment mutation broker
   remains withheld, so the required A1-to-Clinician-A fixture cannot yet be
   created through an approved path. Do not substitute direct entity CRUD.
   Named owners, real evidence references, all reviewer approvals, and the full
   hosted matrix remain required.

   Current source reduces the pinned RLS cohorts to `10` no-RLS, `16`
   mutation-open, and `28` read-open schemas; hosted `f4e41dc2` remains at
   `19 / 25 / 34`. The reduction is containment, not tenant isolation. Complete
   server-owned tenant provenance and purpose-bound brokers for the remaining
   education, fax/Medicare configuration, discharge/note, and Document
   surfaces. Any education-policy deployment must include its compatible
   frontend because stale clients still stamp synthetic `assigned_by` values.
   `SecurityLog` direct mutation is now closed in source, but its built-in-admin
   read remains global and multiple browser screens still list it directly;
   replace those reads with tenant/provenance-scoped brokers and prove them with
   two agencies before treating that log as authoritative application evidence.
   The canonical Admin-A/Admin-B fixture identities deliberately use built-in
   `User.role=user` plus immutable `AgencyMembership.tenant_role=agency_admin`,
   while the current SPA grants facility-admin navigation only from the built-in
   role. Those actors therefore render nurse UX: raw broker probes may proceed,
   but admin UI workflows remain blocked until navigation derives a freshly
   validated server-owned membership context without restoring mutable User
   claims.
   Before production, replace the remaining permissive policies with reviewed
   per-operation tenant rules and prove authenticated multi-user isolation,
   uploads, shared-patient workflows, and negative cross-tenant cases with at
   least two agencies and owner/admin/clinician test users. Membership lifecycle
   and offboarding writes are intentionally restrictive, reconcile exact User,
   membership, and cleanup readbacks, and reject the protected platform owner
   as a membership-lifecycle target, but they are still sequential rather than transactional;
   add datastore CAS/uniqueness, operational partial-failure reconciliation,
   and a terminal rehire path. Current source removes the direct permanent User
   deletion control, and that frontend is now hosted; complete authenticated UI
   validation before a later production publication so offboarding cannot be
   bypassed.
   Patient creation and bounded updates are now broker-only, and hard deletion
   is disabled; direct Patient create/update/delete all fail closed. The eight
   legacy broad Patient writers are paused before access. The roster,
   exact-chart, Visit, OASIS, and Document read brokers are now hosted,
   but still require authenticated two-agency positive and cross-tenant proof.
   `PatientDetails` now
   consumes the hardened exact Patient and Visit schedule brokers behind a
   neutral whole-chart containment state, with immutable singleton route-scope
   normalization and explicit agency requirements for ambiguous users. The
   broad legacy context endpoint is hosted as a 410 tombstone pending final
   consumer retirement. Patient read RLS remains broad and most consumers still use
   direct entity access plus client filtering. Migrate every remaining read
   consumer and prove authenticated multi-row hosted keyset traversal, cache
   eviction, and concurrency behavior. Hosted Visit read brokers and OASIS
   exact/summary reads require the same two-agency proof before production wiring.
   Hosted staging still has the version-1 Document binding that stores a public
   `file_url`. The version-2 private-storage create/read/download brokers are
   source-only, unwired, and unproved. Before cutover, prove multipart
   transport, `UploadPrivateFile.file_uri`, signed delivery, expiry, no-store
   behavior, gateway limits, assignment revocation, and cross-tenant denial
   with real staging actors. Add datastore binding uniqueness or an operational
   reconciliation design for nontransactional metadata/binding creation and
   orphaned private objects. Migrate and verify legacy files, tenant/patient
   provenance, bindings, duplicates, and corruption; retire direct Document
   create/read/download callsites; then set direct Document creation false.

   Fax must accept a stable server-authorized document or private-artifact
   identifier, not a caller-supplied URL. The current fax path does not prove
   that a supplied URL belongs to the selected Document, Patient, agency, or
   caller, and persisting a short-lived signed URL would break retries. Bind
   every single, batch, scheduled, manual-retry, and automatic-retry fax to a
   stable source, derive Patient linkage server-side, and sign only immediately
   before provider dispatch. Current source locks direct `ScheduledFax` access
   and literally pauses every batch, scheduled, manual-retry, and automatic-
   retry transmitter before SDK construction; those are containment gates, not
   completed fax workflows. The protected-owner-only single-fax broker still
   requires the same stable binding before broader use. Prove the protected owner
   has no existing membership rows and quarantine/remove any such rows through
   a reviewed migration. Current source makes the new tenant-context and
   clinical authorization paths fail closed when owner membership state is
   observed; verify that behavior with authenticated staging actors. The
   immutable user-id care-team assignment schema is now hosted with direct
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

   The new UserActivity boundary, dedicated AI agreement authority/status
   brokers, message-read reconciliation, SecurityLog mutation containment, and
   disabled AI mutation paths are also source-only. Prove service-owned audit
   append/readback and PHI minimization with the required LR-01 V6 hosted
   samples; resolve AI audit/attestation idempotency and sequential partial
   failure; and prove message `updateMany`/readback behavior under concurrent
   hosted requests. Generic browser audit helpers now intentionally record
   nothing, so every required compliance event needs a purpose-specific server
   broker before it can be claimed as covered. Keep login telemetry disabled
   until a provider-authenticated idempotent session event exists. Task-bearing
   pathway activation and coordination-alert creation must remain disabled
   until atomic, idempotent, patient-authorized brokers exist.

   Telecom and telehealth must remain unavailable until immutable bindings map
   each provider number or room to one tenant, Patient/session, and authorized
   destination. Current source closes direct SMS/session rows and pauses
   scheduled SMS, redrive, telehealth token minting, and all signed inbound
   patient routing after signature verification. Existing browser conversation,
   consent, schedule, analytics, and telehealth screens therefore fail closed
   and must be migrated to narrow purpose-bound brokers before activation.
   Restore compliant STOP/START handling before any inbound SMS webhook is
   deployed, prove provider retry behavior without duplicate effects, generate
   unguessable room ids behind a server-owned session/provider binding, and
   replace all `User.work_phone_number`, `personal_cell_e164`, `agency_name`,
   and caller-shaped host/room authority with immutable records. Keep every
   literal pause closed until authenticated two-agency positive, negative,
   replay, collision, and offboarding tests pass in isolated staging.
2. Keep `oasis_response_schema_v2_enabled` false. Hosted `f4e41dc2` contains
   the earlier hard-paused endpoint, not the new source-only create-draft
   design. Current source still returns HTTP 503 at a literal gate before body
   parsing, client creation, authentication, or data access; the dormant branch
   is tested only in an isolated rewritten copy and has no browser caller.
   Before activation, add an authority-bound idempotency key and a datastore-
   backed atomic authorization/create or safe recovery design. A post-create
   authority or kill-switch change can otherwise leave an unacknowledged draft,
   and an ambiguous retry can duplicate one. Obtain named clinical approval for
   optional Visit-to-OASIS time-point semantics, prove the exact broker with two
   staging agencies, and build the update, upload, submit, approval, merge, and
   migration paths. The source implementation is foundation, not an enabled
   OASIS workflow. Source also locks `OASISAssessment` and PHI-bearing
   `OASISUpload` writes to service role and disables both browser legacy/v2 save
   adapters. The quick-upload widget is static so a PHI PDF cannot be stored
   before entity creation fails; dormant analyzer-update and supervisor-
   approval writers fail closed under RLS and must not be restored directly.
   The hosted OASIS read broker remains unwired and needs two-agency proof.
   Browser
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
     tests. The required `lease_expires_at` schema is hosted after a zero-row
     recheck; before deploying or enabling the withheld computation function,
     prove hosted
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
     Visit read brokers are hosted and unwired. Backfill legacy Visit
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
   backup, and rollback gates before any domain or store step. The containment
   and hosted-validation claims above apply to the deployed production artifact
   and staging runtime `f4e41dc2`, not to the current source-only PR head.
   Repeat isolated staging synchronization and all
   affected hosted proofs before treating the newer source as a release
   candidate.

Only after those gates pass should `pennsync.com` and `app.pennsync.com` be moved
from the old Base44 app to the CareMetric app. Keep the old repositories and old
Base44 app read-only until both domains and installed mobile apps have been
observed healthy through the rollback window.
