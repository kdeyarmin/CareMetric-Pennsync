# PennSync to CareMetric data migration runbook

Status: **planning and read-only inventory complete; backup, migration, and
domain cutover are blocked**.

This runbook covers data from the old PennSync Base44 application
(`68ee80d98929370f9e8f2932`, `https://pennsync.base44.app`) that must eventually
be reconciled into the CareMetric application (`694ec16e72e01b60d22f7cbf`,
`https://caremetricai.base44.app`). It does not authorize an export, a write to
either app, an identity migration, a file copy, or a domain change.

## Verified inventory boundary

A complete ID-only, paginated read on 2026-09-03 counted all 236 hosted entity
types in each app. No row bodies or file contents were exported.

| Inventory | Old PennSync | CareMetric |
| --- | ---: | ---: |
| Total rows | 8,672 | 3,190 |
| Nonempty entity types | 35 | 37 |
| Users | 8 | 2 |
| Patients | 387 | 1 |
| Functions | 239 | 240 |
| Connected connectors | 0 | 0 |

User IDs have zero overlap (8 old-only and 2 CareMetric-only). Patient IDs have
zero overlap (387 old-only and 1 CareMetric-only). Therefore the apps are
separate data and identity systems; pointing `pennsync.com` at CareMetric would
not migrate or preserve access to the old records.

Seventeen entity types exist with data only in old PennSync, totaling 2,093
rows. The largest or clinically relevant cohorts are:

| Entity | Old rows | CareMetric rows |
| --- | ---: | ---: |
| NoteConversion | 712 | 0 |
| PendingPatientUpdate | 522 | 0 |
| Physician | 420 | 0 |
| Visit | 198 | 0 |
| ComplianceAudit | 190 | 0 |
| DocumentTemplate | 11 | 0 |
| CarePlan | 10 | 0 |
| OASISUpload | 5 | 0 |

Other material differences include UserActivity (4,812 vs 862), SystemLog (521
vs 9), SecurityLog (444 vs 217), TrainingCourse (57 vs 19), and
TrainingQuestion (131 vs 55). Nineteen entity types are populated only in
CareMetric, totaling 1,397 rows, including 1,230 AgencyKPI rows. These are merge
inputs, not overwrite candidates.

Both apps expose the same 236 hosted schema names. Six definitions differ:
`Patient`, `OASISAssessment`, `OASISUpload`, `PatientOutcomeMetric`, `AgencyKPI`,
and `PDGMRateConfig`. CareMetric adds `agency_id` scoping and tighter
service-owned authorization on the clinical/outcome path. The target also has
one additional function (`getPDGMRateConfig` by set comparison), and automation
attachments differ.

## Non-negotiable safeguards

1. Keep the old app and its domains live and write-capable until a separately
   approved maintenance window. Do not use DNS as a migration mechanism.
2. Obtain a restorable, point-in-time backup of old entity data, authentication
   identities, uploaded files, and configuration through a Base44-supported
   process. Encrypt the backup, restrict access, record checksums, and perform a
   restore rehearsal into a disposable nonproduction app.
3. Create an immutable migration manifest with a source ID, destination ID,
   entity type, source checksum, transformation version, result state, and
   error state for every migrated record. Never infer success from row counts
   alone.
4. Merge into CareMetric. Never truncate, replace, or bulk-overwrite its current
   3,190 rows. Preserve source timestamps and provenance in approved fields.
5. Do not guess tenant ownership. Every legacy clinical record must map through
   an owner-approved agency and user identity table. Quarantine any ambiguous or
   orphaned row.
6. Keep OASIS v2, outcome publication, and PDGM reimbursement default-off
   throughout migration. Do not create or activate a global outcome schedule.
7. Keep Apple bundle `com.caremetric.ai`, Google package `com.caremetic.ai`, the
   permanent `caremetricai.base44.app` origin, PWA identity, and Eastern-time
   configuration unchanged.

## Required mapping design

Before a migration rehearsal, approve these explicit maps:

- old User ID/email to target User ID, including invited, inactive, and
  unmatched identities;
- old organization/agency values to one exact target Agency ID;
- old entity ID to new target ID for every entity type;
- every foreign-key and embedded-reference field that must use the ID map;
- old file URL/object to copied target file plus content checksum;
- each old-only entity's disposition: migrate, archive externally under an
  approved retention policy, or quarantine for review;
- schema transforms for the six differing definitions, including required
  tenant keys and service-owned provenance; and
- duplicate/collision policy for logs, learning content, templates, clinical
  records, and the non-overlapping target Patient.

Authentication records must use a Base44-supported identity migration path.
Creating entity rows that resemble users is not an authentication migration.
Passwords, sessions, MFA state, store subscriptions, and device credentials
must never be copied through a custom row script.

## Notification authority migration gate

Notification migration is a producer-cutover-first operation. It is **not safe
to backfill existing Notification rows while legacy producers can continue
creating new unscoped rows**.

The repository census on 2026-09-07 finds 40 direct Notification write call
sites in 30 backend source files. Classification is per call site, because
`handleTelnyxStatusWebhook` contains both authority-v1 and legacy writes:

| Mutually exclusive call-site classification | Count | Current treatment |
| --- | ---: | --- |
| Authority-v1 | 6 | Exact agency, user, membership, membership revision, authority state, and row revision are stamped. Three are separately runtime-gated. |
| Explicitly quarantined legacy | 0 | No current endpoint is proven unreachable merely by the workflow schedule manifest. |
| Source-disabled legacy | 2 | Unreachable behind a literal early-return containment boundary. |
| Runtime-gated legacy | 3 | Inbound SMS/voice notification branches remain paused. |
| Reachable or not statically gated legacy | 29 | Unmigrated release blockers; a service-role write may still succeed. |

Twelve of the 29 reachable-or-unknown legacy calls belong to targets whose
**workflow schedules** are quarantined. That is an operational annotation, not
endpoint containment: built-in administrators can still invoke those
functions directly, and the protected owner can invoke the fax-status target.
Seven of those calls are browser-reachable after an administrator selects and
mounts the System Health panel: its query invokes `testAutomations`
immediately and every five minutes, and `testAutomations` invokes
`sendPersonnelExpirationNotifications`, `sendTrainingNotifications`, and
`sendExpirationNotifications`. The census therefore reports both
`workflow_schedule_quarantined: 12` and
`browser_reachable_legacy_unmigrated: 7` without excluding either group from
`reachable_legacy_unmigrated: 29`.

Run the deterministic source census from the repository root:

```bash
pnpm run audit:notification-producers -- --summary
```

The census scans `.js`, `.jsx`, `.mjs`, `.cjs`, `.ts`, `.tsx`, `.mts`, and
`.cts` and detects statically resolvable `create` and `bulkCreate` calls through
direct, bracket, assigned/chained entity-alias, and assigned/chained
method-alias forms. Aliases must trace through simple assignments to a path
containing Base44 `entities`; a coincidental path such as
`config.Notification` is not treated as a producer. A discovered call fails if
it is new, removed, method-changed, unclassified, or lacks authority-v1
evidence bound to the actual call argument. That evidence rejects top-level
spreads or duplicate authority keys and, for a factory, requires one object
return, an exact factory-call assignment, and no intervening statically
apparent assignment/update to the bound payload. Generated build outputs and
tests are excluded. This is a static contract, not whole-program data-flow
analysis; computed/dynamic calls and mutations through unknown callees still
require source review. Registry pairing uses source-order ordinals; two
same-method legacy calls can be reordered or have their payload bodies changed
without proving their semantic identity, so the source diff still requires
human review.

`Notification` direct RLS is deny-all. `manageMyNotifications` returns only an
active authority-v1 row whose agency/user/membership identity and membership
revision still match the current active membership. Therefore a legacy
service-role producer can persist a row that is invisible in the notification
center. Successful creation is not delivery evidence, and legacy rows must not
be exposed by temporarily weakening RLS.

Complete these steps in order:

1. **Freeze the census.** Require zero unclassified calls, zero missing expected
   calls, and zero invalid authority evidence. Record the source revision and
   the aggregate census output; it contains no row data.
2. **Cut over producers before touching rows.** Migrate every reachable legacy
   producer to one reviewed authority-v1 broker, or prove the function endpoint
   itself is contained/source-disabled. A workflow-schedule quarantine or a
   runtime gate is not a migration and must not be released while its producer
   is legacy. Require the census to show zero reachable legacy-unmigrated calls
   before planning a backfill.
3. **Prove the producer cutover.** In an isolated environment, demonstrate
   exact tenant/recipient membership derivation, revision revalidation at the
   side effect, duplicate/replay containment, revoked membership behavior, and
   two-agency negative tests for every producer family. Do not infer this from
   repository tests alone.
4. **Export a read-only audit snapshot through an approved process.** The local
   snapshot must be an exact JSON object with `snapshot_version: 2` plus
   `agencies`, `users`, `memberships`, and `notifications` arrays. User rows
   are required so the audit can reject missing, disabled, unverified, or
   service identities instead of calling their notifications current. Restrict
   and securely dispose of the source file because it can contain PHI. Do not
   commit it.
5. **Run only the aggregate dry-run audit:**

   ```bash
   read -r -s -p 'Restricted snapshot path: ' NOTIFICATION_AUTHORITY_SNAPSHOT_PATH
   export NOTIFICATION_AUTHORITY_SNAPSHOT_PATH
   pnpm --silent run audit:notification-authority
   unset NOTIFICATION_AUTHORITY_SNAPSHOT_PATH
   ```

   This tool has no datastore/network client or file-write path. It never
   returns row identifiers, email addresses, titles, messages, metadata, or
   per-row findings; it reports predefined categories/reason counts and always
   reports `backfill_authorized: false` and `mutations_performed: 0`. Mutation-
   shaped flags such as `--apply`, `--write`, `--fix`, and `--backfill` are
   rejected. The hidden environment-path invocation above prevents pnpm from
   echoing the restricted path; do not append `--input <path>` to a package
   command. Audit validation mirrors the recipient broker's current user,
   agency, tenant-role, membership binding/revision, notification content/state
   integrity checks, and also reports duplicate membership bindings,
   Notification identities, and non-empty dedupe-key collisions for review.
   Invalidated rows do not bypass those checks. The report also includes
   `producer_cutover_verified_by_this_tool: false`; only the separately
   reviewed source census and hosted evidence can satisfy that prerequisite.
6. **Design the mapping from immutable provenance.** An email address, title,
   message, action URL, patient name, or other mutable content is never enough
   to assign authority. Each candidate needs one exact approved agency, built-
   in user ID, AgencyMembership ID, membership revision valid at creation, and
   source/workflow evidence. Duplicate, orphaned, ambiguous, stale, partially
   stamped, or unsupported-version rows stay quarantined or are explicitly
   invalidated under an approved retention decision.
7. **Review a separate backfill implementation.** The dry-run audit is not a
   backfill tool and this runbook does not authorize one. Any future writer must
   use an immutable manifest, expected old-state predicates, idempotent
   conditional updates, bounded batches, before/after aggregate reconciliation,
   an independent operator, and a tested rollback procedure.
8. **Backfill only after Steps 1–7 are signed off**, then rerun the aggregate
   audit and recipient-broker tests. Any new legacy producer or row stops the
   migration and returns the cohort to quarantine review.

## Reusable-content and auxiliary-data authority gate

The source-direction model for reusable content is hybrid: each
`CustomValidationRule`, `EducationMaterial`, `LearningPlan`, `LibraryDocument`,
`PDFTemplate`, or `TrainingCourse` root is platform-curated global content or
private to exactly one Agency through service-owned `ContentScopeBinding`.
`LearningPlanCourse` inherits only from its exact `LearningPlan.plan_id`, and
`TrainingModule` only from its exact `TrainingCourse.course_id`. This is not an
approved migration or CRUD policy.

Before migrating any of these rows:

1. obtain named human decisions for create/read/update/delete and legacy-row
   disposition; quarantine rather than guess any ambiguous owner;
2. inventory and reconcile every direct user/service consumer—TrainingCourse
   alone currently has 15 user-scope and 14 service-role source-file consumers,
   and its published global read is incompatible with agency-private scope;
3. reject orphaned `LearningPlanCourse` / `TrainingModule` rows, noting that
   `TrainingModule.course_id` is not yet schema-required;
4. define exact scope compatibility for every `PDFTemplate` parent version and
   packet-document reference;
5. deliver learner content only through an exact parent-bound sanitized broker.
   Field-level denial covers the typed TrainingModule `correct_answer` and the
   TrainingCourse assessment/spaced-recall payloads in source, but generic
   `TrainingModule.content` / `content_json` can still carry answers and hosted
   nested-field RLS behavior is unproved; and
6. prove the migrated model with authenticated two-agency, revoked-membership,
   forged-parent, orphan, and cross-scope-family tests before unquarantining it.

Separately, do not migrate raw `ComplianceAudit`, `NoteConversion`, or
`TrainingAssignment` data merely to restore dashboard totals. Purpose-bound
tenant aggregate brokers do not yet exist. `Incident` and `User` browser
post-filtering is an interim boundary, not a migration authority. Keep affected
analytics unavailable until server-side boundaries and hosted proof exist.

Readiness source-contract v4 pins this source model and its schemas as a true
artifact union, but its source-marker/regex scanners are regression tripwires,
not formal interprocedural containment proofs. It does not prove runtime
`ContentScopeBinding` enforcement or production readiness.

## Rehearsal sequence

1. Record source and destination app IDs, schema hashes, function inventories,
   automation schedules, domain mappings, and aggregate counts.
2. Create and restore the verified backup into a disposable isolated app.
3. Provision two synthetic agencies and owner/admin/clinician test identities;
   do not use production identities for the first rehearsal.
4. Run the approved deterministic transform into an empty migration target.
5. Reconcile every manifest entry, entity count, foreign-key edge, required
   field, tenant key, file checksum, and source-to-destination ID map.
6. Prove two-agency positive and negative access through server-owned brokers,
   including revoked memberships and care-team assignments. Direct entity reads
   are not positive evidence.
7. Prove Notification producer cutover before any Notification authority
   backfill; retain all ambiguous/legacy rows in quarantine and record the
   aggregate dry-run audit in the evidence packet.
8. Exercise clinical workflows for migrated Patients, Visits, Documents,
   CarePlans, OASIS artifacts, logs, and templates. Confirm that quarantined
   records remain inaccessible to tenant users.
9. Simulate rollback by discarding the target, restoring the backup again, and
   reproducing the same hashes and counts.
10. Obtain named security, clinical, privacy/legal, and release-owner sign-off on
   the evidence packet before scheduling any production migration.

## Production cutover gate

A later production run requires an explicitly approved maintenance window and
an operator other than the migration author to verify the stop/go checklist:

- fresh restorable backup and restore proof;
- final source write freeze with recorded boundary timestamp;
- deterministic delta capture after the rehearsal snapshot;
- complete migration manifest with zero unexplained failures;
- zero reachable legacy Notification producers, producer cutover proof recorded
  before any Notification backfill, and zero unexplained authority-audit
  findings;
- reconciled counts and references, including all 2,093 old-only rows;
- authenticated two-agency isolation and revoked-access proof;
- target web/device smoke tests and app-store identity continuity;
- DNS TTL and rollback plan that leaves the old app intact; and
- observation window with error, login, file, and critical-workflow monitoring.

Only after those checks pass may `pennsync.com` and `app.pennsync.com` be moved
to the CareMetric app. Retain the old Base44 app and all three GitHub repositories
read-only through the approved rollback/retention period. Domain success must
never be treated as evidence that users, files, references, or clinical records
were migrated.
