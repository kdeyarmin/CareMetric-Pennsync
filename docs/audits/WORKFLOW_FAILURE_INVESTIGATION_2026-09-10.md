# Production workflow failure investigation — 2026-09-10

## Finding

The production CareMetric AI app (`694ec16e72e01b60d22f7cbf`) had active
schedules invoking handlers that deliberately returned HTTP 503 while their
release gates were closed. All 22 failed workflow runs returned by the
authenticated three-day query had explicit release-block responses. This was a
mismatch between hosted schedule activation and handler release state.

The investigation inspected the repository at
`dca619e24049d128b5854d6decc3c53b45d1f1fd`, the production workflow inventory,
workflow run errors, and the Base44 dashboard. The repository's existing
[workflow migration audit](WORKFLOW_MIGRATION_AUDIT_2026-09-06.md) records the
validation requirements behind the closed gates. That audit's staging snapshots
do not establish production workflow activation or successful processing.

## Confirmed failures and initial state

| Workflow | Failed runs in query | Backend response | State before remediation |
|---|---:|---|---|
| Check Stale Follow-Up Requests | 2 | HTTP 503, `stale_follow_up_workflow_disabled`: processing disabled pending hosted validation | Active |
| Dispatch Scheduled Signature Reminders | 5 | HTTP 503, `signature_reminder_dispatch_unavailable` | Inactive; automatically paused after consecutive failures |
| Auto Retry Failed Faxes | 5 | HTTP 503, `OUTBOUND_DELIVERY_RELEASE_PAUSED`, channel `fax`, `retryable: false` | Inactive; automatically paused after consecutive failures |
| Process Inbound Referral Faxes | 5 | HTTP 503, `inbound_fax_workflow_disabled`: processing disabled pending hosted validation | Inactive; automatically paused after consecutive failures |
| Poll Fax Statuses | 5 | HTTP 503, `Fax status polling is not released` | Inactive; automatically paused after consecutive failures |

The September 9 and September 10 stale-follow-up failures lasted 57.1 and
105.9 seconds respectively. These are workflow elapsed times; the available
evidence does not identify the source of that latency. Both ended with the same
explicit release-block response. No function logs were returned for the five
handlers, including an error-level query; the workflow run errors supplied the
failure evidence.

## Remediation applied and verified

The production dashboard's **Deactivate** action was applied only to
**Check Stale Follow-Up Requests**, workflow ID
`6a9d3c6727a31b1a14a450b8`. This stopped the remaining daily schedule from invoking
a handler whose processing was intentionally unavailable.

Both the dashboard and a subsequent authenticated CLI inventory confirmed this
workflow was **inactive**. Its existing 48-run history and two consecutive
failures remained present. All seven current production workflows were inactive
after the change:

| Workflow | Verified state |
|---|---|
| Check Stale Follow-Up Requests | Inactive; changed during this investigation |
| Dispatch Scheduled Signature Reminders | Inactive; unchanged |
| Auto Retry Failed Faxes | Inactive; unchanged |
| Process Inbound Referral Faxes | Inactive; unchanged |
| Poll Fax Statuses | Inactive; unchanged |
| Process Scheduled Faxes | Inactive; unchanged |
| Nightly Outcome Measure Computation | Inactive; unchanged |

The configuration change was completed in Base44 before this documentation PR.
Merging or reverting this note does not alter hosted workflow state. The
investigation did not edit application code, deploy resources, change release
secrets or permissions, invoke handlers, send traffic, or modify patient records.
The operational effect concerns staff relying on automated follow-up escalation;
that processing was already unavailable behind its release gate.

## Remaining limitations and reactivation

Pausing schedules resolves the repeated invocation of intentionally unavailable
handlers. It does **not** restore fax processing, follow-up escalation, signature
reminders, scheduled fax delivery, or outcome computation. Existing failed runs
remain historical failures.

Reactivation is a separate hosted configuration action. Follow the existing
workflow migration audit's per-handler validation and release requirements,
including scheduler authentication, tenant/recipient provenance, concurrency,
notification authority, and the applicable provider or signature checks. Keep
each hosted schedule inactive until its handler is ready. Turning a schedule
back on while its gate is closed recreates the same HTTP 503 failures; removing
a gate or converting its response to success would not prove restored behavior.

## Read-only verification commands

These commands select the production app explicitly and require existing Base44
authentication. They read metadata and errors; they do not invoke workflows.
Telemetry is disabled as required by the validation environment, and `--yes`
avoids an interactive installation prompt if the CLI is not already cached.

```sh
BASE44_DISABLE_TELEMETRY=1 npx --yes base44 --app-id 694ec16e72e01b60d22f7cbf workflows runs --status failed --since 3d --limit 40
BASE44_DISABLE_TELEMETRY=1 npx --yes base44 --app-id 694ec16e72e01b60d22f7cbf --json workflows list --limit 30
```

The relative three-day window reproduces the inspection method, not a permanent
historical snapshot. The observations above were captured on September 10, 2026.
