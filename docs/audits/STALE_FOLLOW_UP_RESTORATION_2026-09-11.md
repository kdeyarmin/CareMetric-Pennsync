# Stale follow-up restoration — 2026-09-11

## Findings and fixes

The failures recorded in `WORKFLOW_FAILURE_INVESTIGATION_2026-09-10.md` were deliberate release-gate HTTP 503 responses. Production's daily workflow was then paused. Restoring the handler required correcting defects exposed by source review and synthetic hosted validation, not merely enabling its environment flag.

| Finding | Resolution |
| --- | --- |
| New hosted Referral records return `created_by_id` without the legacy `created_by` email. The previous worker rejected an otherwise valid synthetic referral with HTTP 500. | Worker and Referral broker accept the exact platform creator ID; every supplied platform identity must agree with immutable broker provenance. Missing or conflicting identities still fail. Legacy email records remain supported. |
| Hosted schemas materialize `archived_at: null`; queries using only `$exists: false` miss those active referrals. | Worker and staff Referral list explicitly include missing/null archive fields and continue rejecting returned archived or foreign-tenant rows. |
| Ordinary Referral edits could overwrite worker claim/finalization markers. | All five stale-notification fields are server-owned. Edits preserve them for the same follow-up generation, including equivalent timestamp formats; a new instant starts without old or caller-forged markers. |
| A lease could expire while Notification.create was still running; rolling a claim back after a timeout could allow duplicate publication. | A version/revision CAS persists publication intent before create. Later workers reconcile the existing notification and never create again after an uncertain publication. |
| Unrelated legacy rows and one failing tenant could abort the daily scan before valid work. | Skip unrelated referrals before validating eligibility; count eligible-row failures and continue independent tenants. Scan-limit and query-scope failures still prevent writes in that tenant. |
| Recipient or agency authority could change between the scan and publication. | Revalidate agency and exact active recipient membership before the publication CAS. The inbox independently enforces the current membership revision. |
| The earlier “empty args” unit test supplied `stale_days`. | Test the actual empty object, protected-admin access, ordinary-user denial, and the native workflow's empty input in staging. |

Base44 documents both platform creator fields in its [entity schema reference](https://docs.base44.com/developers/backend/resources/entities/entity-schemas). The compatibility change is based on actual staging responses, not an assumption that all environments omit the email field.

## Hosted validation

Staging app: `6a9881683dc68a0bd54f1ef7`. Production app: `694ec16e72e01b60d22f7cbf`.

- Inspected deployed production Notification, Referral and AgencyMembership schemas: direct CRUD remains denied. The deployed stale worker and `manageMyNotifications` matched the repository before changes.
- Staging initially had no Agency, AgencyMembership, Referral or Notification records. Created one clearly labeled synthetic agency, membership and referral; disabled billing on that synthetic agency. No patient data or outbound email/fax was used.
- Enabled only `WORKFLOW_RELEASE_CHECK_STALE_FOLLOW_UP_REQUESTS=enabled-v1` in staging and deployed the affected functions. All other workflow release flags remain unset.
- Native workflow **Run now** with `{}` completed in about one second on empty staging data: run `37d4d3ec-3ce3-4346-831f-afe874eaaa60`, 2026-09-11 15:48 UTC. This is a manual workflow test, not proof of an unattended timer firing.
- An unattended scheduled run subsequently completed at 16:05 UTC: `118fad0f-c21b-46da-aff9-07acebb72907`, `triggerType: scheduled`, `isTestRun: false`, duration 3.433 seconds. A temporary five-minute staging cron exercised a fresh synthetic request generation and created exactly one additional notification. The workflow was then deactivated and its daily UTC schedule restored; the synthetic agency/membership were suspended/revoked, its notifications invalidated and its referral archived with history retained.
- The synthetic referral reproduced the platform metadata incompatibility, then passed after the fix: scanned 1, escalated 1, failed 0. Hosted version/revision conditional writes persisted claim, publication intent and finalization.
- Repeated concurrent invocations with `{}` returned escalated 0, failed 0; exactly one authority-v1 notification existed.
- `manageMyNotifications` returned that one alert with `complete: true`. Mark-read advanced its version from 1 to 2; dismiss advanced it to 3; the next inbox list was empty.
- The platform-admin account was denied by `manageAuthorizedReferral`, as designed. Staging has no ordinary staff login; positive staff Referral access is covered by the broker contract suite, not a claimed hosted staff session.

## Validation commands

Focused Referral, stale-worker, notification-broker and workflow contracts pass. Regression cases include platform identity conflicts, null archives, marker forgery, malformed rows, tenant isolation, lost create responses, delayed publication, overlapping workers, recipient suspension and idempotent replay.

Lint, informational typecheck, high-signal typecheck, shared-helper parity, all 278 backend transpiles and the production build pass locally. The build has no hosted app environment configured; it is a compilation check.

The full registered suites were also attempted. Windows' shell length limit requires invoking their existing Node file lists directly. Remaining local failures concern Windows path separators/file URLs, symlink permissions, POSIX file modes and a Node test-runner deserialization error; the component failures are path-based source inventories. Both Linux checks passed for the initial PR revision; the final revision must also be green before merge. No unrelated test expectations were weakened.

Review identified a read between the successful publication CAS and create that could strand an alert without attempting it. The CAS now immediately starts create. A regression test simulates a Referral read outage after that decision and verifies publication occurs once, then finalization recovers without a second create.

## Release and recovery

The source still defaults to HTTP 503 before SDK construction unless the exact environment flag is enabled. The native workflow remains the only schedule owner; no legacy function automation is introduced. Production activation must follow review, green CI and hosted checks. Preserve the production schedule `0 12 * * *` in UTC.

An unresolved publication intent is intentionally reported as a failed escalation. Do not clear its marker or resend merely because a read returned no notification: the original create may still commit. Inspect the exact agency/referral/generation key and provider outcome, reconcile a verified existing row, and only repair an absent publication after the original attempt is conclusively stopped. Ordinary staff edits cannot perform this recovery.

Rollback: deactivate **Check Stale Follow-Up Requests** first, then remove or disable its release flag. Retain notification and Referral evidence for reconciliation. Other inactive workflows and quarantined provider/fax capabilities are separate restoration work.
