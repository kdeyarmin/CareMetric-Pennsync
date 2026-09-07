# Base44 workflow migration audit — 2026-09-06

## Scope and conclusion

Commit `35ef5e12` added six Base44 workflow definitions that preserve legacy automation schedules. This branch also adds the inbound referral-fax processor. All seven workflow files have valid single-function targets, CLI-deployable function automations, exact schedules, explicit empty arguments, and an explicit inactive release state protected by `base44/workflowMigrationContract.test.js` and `base44/functionAutomationConfigContract.test.js`.

Repository correctness does not prove a hosted workflow is active, inactive, or successfully invoking a deployed function. Base44 stores that operational status remotely. An authenticated, read-only CLI and dashboard inspection was therefore completed against the isolated staging app on 2026-09-06. It made no hosted write, deployment, workflow creation, merge, or production change.

## Hosted staging observation — 2026-09-06

| Check | Observed result | Consequence |
|---|---|---|
| Target | App `6a9881683dc68a0bd54f1ef7` (`caremetric-pennsync-staging-2026-09-02`) | Evidence is staging-only. |
| Functions | Hosted before deployment: 269; reviewed source: 273 | `getAuthorizedInboundReferralFax`, `sendAuthorizedReferralFax`, `dispatchNightlyOutcomeMeasures`, and `manageMyNotifications` are not yet present in the hosted pre-deployment inventory. |
| Workflows | `base44 workflows list`: `This app has no workflows.` | The pre-deployment app has no schedules. The reviewed deployment adds all seven definitions in an explicitly inactive state. |
| Workflow runs | `base44 workflows runs`: `This app has no workflows, so there are no runs.` | There is no hosted execution evidence to review yet. |
| Integration capacity | Dashboard reports that integration credits are exhausted | Provider-backed staging tests may fail or be blocked even after source deployment; credits must be restored before interpreting provider failures as code defects. |

The read-only commands used were:

```sh
BASE44_DISABLE_TELEMETRY=1 npx --yes base44 --app-id 6a9881683dc68a0bd54f1ef7 workflows list
BASE44_DISABLE_TELEMETRY=1 npx --yes base44 --app-id 6a9881683dc68a0bd54f1ef7 workflows runs
BASE44_DISABLE_TELEMETRY=1 npx --yes base44 --app-id 6a9881683dc68a0bd54f1ef7 functions list
```

`BASE44_DISABLE_TELEMETRY=1` is the CLI's supported telemetry opt-out. It is required in the validation environment so the audit does not depend on an unrelated analytics endpoint.

## Reviewed workflow matrix

| Workflow | Schedule | Handler state in this branch | Release decision |
|---|---:|---|---|
| Auto Retry Failed Faxes | Every 15 minutes | Rebuilt with strict tenant, provider, retry-generation, and private-document checks | Keep inactive. An exact immutable Referral↔Document link/backfill and hosted single-winner/provider-idempotency proof are still missing. |
| Check Stale Follow-Up Requests | Daily at 12:00 UTC | Rebuilt with tenant-bound conditional claims, recipient provenance, and non-2xx aggregate failure signaling | Keep inactive. The shared Notification entity cannot be locked down until every legacy producer is migrated, and legacy rows/CAS recovery still require hosted proof. |
| Dispatch Scheduled Signature Reminders | Every 15 minutes | Rebuilt implementation remains behind a source-level false release gate | Keep inactive with the rest of e-signature until legal, identity, concurrency, finalization, immutable-audit, and tenant gates are approved and tested. |
| Nightly Outcome Measure Computation | Daily at 06:00 UTC | Empty-payload schedule moved to a bounded per-agency dispatcher; dispatcher and worker are environment-gated and the automation is inactive by default | Keep inactive pending hosted CAS, single-winner publication, stable-snapshot, tenant-provenance, and two-agency proof. The former `{}` → one-agency-writer mismatch is fixed in source. |
| Poll Fax Statuses | Every 5 minutes | Rebuilt with exact credential revision, sender provenance, conditional transitions, and durable notification claims | Keep inactive. Retry response-loss reconciliation, legacy row migration, and hosted atomicity/failure-injection evidence are incomplete. |
| Process Inbound Referral Faxes | Every 10 minutes | Rebuilt with tenant-bound ingress provenance, conditional claims, OCR, and referral matching | Keep inactive. Integration credits are exhausted, its notification producer has not completed the authority-v1 cutover, and aggregate failure signaling/hosted OCR replay evidence remain incomplete. |
| Process Scheduled Faxes | Every 10 minutes | Rebuilt with private-document authority, HMAC-bound internal dispatch, conditional claims, and exact sender/provider provenance | Keep inactive. Hosted uniqueness/atomicity, immutable Referral↔Document authority, and sender-binding backfill remain incomplete. |

## Migration defects contained

1. A workflow file can exist while its target is intentionally blocked. The new contract makes that release state explicit and fails when an added workflow is not reviewed.
2. The nightly outcome workflow no longer sends an empty legacy payload to the one-agency writer. `dispatchNightlyOutcomeMeasures` resolves and revalidates each active/trial tenant, derives the previous completed UTC day and deterministic idempotency key, and sends an HMAC-bound request to `computeOutcomeMeasures`. Both functions and the schedule remain default-off pending the hosted evidence in `OUTCOME_WORKFLOW_RESTORATION_AUDIT_2026-09-06.md`.
3. Imported fax retry, polling, and scheduled-fax handlers now retain hardened implementations, but all unattended automations remain inactive until their exact provenance, concurrency, and hosted failure-injection gates pass.
4. The notification broker/schema additions are additive only. The global all-false Notification RLS and secure-inbox UI cutover were deliberately deferred because legacy producers still depend on the previous entity contract; deploying a partial cutover would hide or break existing notifications.
5. The restored referral workflows use new service-owned authority paths; they do not weaken or bypass the broader fax, signing, OASIS, messaging, or telehealth quarantines.

## Hosted completion gates

Before enabling any workflow in staging:

1. Restore staging integration credits.
2. Sync the exact reviewed entity/function revision to staging, including all four functions missing from the pre-deployment inventory; keep every automation inactive in the same change.
3. Provision one reviewed Telnyx IntegrationSecret and exact TelecomDestinationBinding per receiving number.
4. Run direct, authenticated two-agency positive and negative function tests, including token replay/expiry, inbound fax replay, cross-tenant fax identity, OCR failure, duplicate-click handling, signed webhook replay, and provider-network ambiguity.
5. Prove exact hosted readback for all seven inactive automations and that the obsolete worker-owned outcome schedule is removed. Invoke only zero-data or purpose-built staging probes until the relevant external capacity and provenance fixtures are approved.
6. Capture sanitized run identifiers, timestamps, deployed revision, and pass/fail evidence in the live-readiness packet.
7. Complete the Notification producer migration or introduce a separate service-only workflow-delivery ledger before activating stale-follow-up, inbound-fax, polling, or fax notification paths.
8. Keep production merge and deployment blocked until the repository checks and hosted evidence both pass and a release owner explicitly approves them.
