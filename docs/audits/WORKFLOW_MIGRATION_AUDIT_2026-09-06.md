# Base44 workflow migration audit — 2026-09-06

## Scope and conclusion

Commit `35ef5e12` added six Base44 workflow definitions that preserve legacy automation schedules. This branch also adds the inbound referral-fax processor. All seven workflow files have valid single-function targets and their exact schedules are now protected by `base44/workflowMigrationContract.test.js`.

Repository correctness does not prove a hosted workflow is active, inactive, or successfully invoking a deployed function. Base44 stores that operational status remotely. The hosted app must be checked with `pnpm exec base44 workflows list --json` and `pnpm exec base44 workflows runs --json` after CLI authentication.

## Reviewed workflow matrix

| Workflow | Schedule | Handler state in this branch | Release decision |
|---|---:|---|---|
| Auto Retry Failed Faxes | Every 15 minutes | Statically fail-closed before SDK access | Keep hosted workflow inactive. The legacy queue lacks immutable tenant, sender, and private-document bindings. |
| Check Stale Follow-Up Requests | Daily at 12:00 UTC | Runnable; enumerates active/trial agencies and applies tenant-bound conditional updates | Candidate for hosted staging validation. |
| Dispatch Scheduled Signature Reminders | Every 15 minutes | Static 503; no SDK access | Keep inactive with the rest of e-signature until legal, identity, replay, revocation, immutable-audit, and tenant gates are approved and tested. |
| Nightly Outcome Measure Computation | Daily at 06:00 UTC | Statically fail-closed before SDK access | Keep inactive. The migrated `{}` payload cannot satisfy the handler's required `agency_id`, period, and idempotency key, and hosted atomicity is unproved. |
| Poll Fax Statuses | Every 5 minutes | Runnable with scheduler/admin authorization | Candidate for hosted staging validation with the exact Telnyx integration and representative FaxLog rows. |
| Process Inbound Referral Faxes | Every 10 minutes | Runnable; tenant-bound ingress provenance, conditional claims, OCR, and referral matching | Candidate for hosted staging validation after exact destination binding setup. |
| Process Scheduled Faxes | Every 10 minutes | Statically fail-closed before SDK access | Keep inactive. ScheduledFax rows lack immutable tenant, sender, and private-document authority. |

## Migration defects contained

1. A workflow file can exist while its target is intentionally blocked. The new contract makes that release state explicit and fails when an added workflow is not reviewed.
2. The nightly outcome workflow preserved an empty legacy payload even though the hardened handler requires tenant and reporting-window authority. Its handler remains paused, so the mismatch cannot write data.
3. Imported fax retry and scheduled-fax cadences point to legacy queue models that cannot safely re-transmit PHI. Both handlers pause before constructing the Base44 client.
4. The restored referral workflows use new service-owned authority paths; they do not weaken or bypass the broader fax, signing, OASIS, messaging, or telehealth quarantines.

## Hosted completion gates

Before enabling any candidate workflow in staging:

1. Authenticate the local Base44 CLI and inspect remote workflow status and recent runs.
2. Sync the exact entity/function/workflow revision to the staging app.
3. Provision one reviewed Telnyx IntegrationSecret and exact TelecomDestinationBinding per receiving number.
4. Run two-agency positive and negative tests, including token replay/expiry, stale-worker idempotency, inbound fax replay, cross-tenant fax identity, OCR failure, and provider-network ambiguity.
5. Capture sanitized run identifiers, timestamps, deployed revision, and pass/fail evidence in the live-readiness packet.
6. Keep production merge and deployment blocked until the repository checks and hosted evidence both pass and a release owner explicitly approves them.
