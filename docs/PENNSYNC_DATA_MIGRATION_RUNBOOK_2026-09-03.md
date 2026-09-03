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
7. Exercise clinical workflows for migrated Patients, Visits, Documents,
   CarePlans, OASIS artifacts, logs, and templates. Confirm that quarantined
   records remain inaccessible to tenant users.
8. Simulate rollback by discarding the target, restoring the backup again, and
   reproducing the same hashes and counts.
9. Obtain named security, clinical, privacy/legal, and release-owner sign-off on
   the evidence packet before scheduling any production migration.

## Production cutover gate

A later production run requires an explicitly approved maintenance window and
an operator other than the migration author to verify the stop/go checklist:

- fresh restorable backup and restore proof;
- final source write freeze with recorded boundary timestamp;
- deterministic delta capture after the rehearsal snapshot;
- complete migration manifest with zero unexplained failures;
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
