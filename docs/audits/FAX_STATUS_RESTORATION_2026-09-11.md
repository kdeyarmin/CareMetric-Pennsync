# Fax status polling restoration — 2026-09-11

The historical failures were deliberate release-gate HTTP 503 responses. Restoring the five-minute schedule required fixing queue eligibility and recovery behavior before enabling `WORKFLOW_RELEASE_POLL_FAX_STATUSES=enabled-v1`.

## Defects and changes

- Hosted optional FaxLog fields are materialized as null. Missing-field-only predicates skipped nonterminal, retry-recovery and notification-recovery queues. Queries now include missing/null fields while retaining due-time, quarantine and bounded-page checks. The contract harness now distinguishes null from missing fields and returns detached FaxLog snapshots.
- Identifier normalization returned null for invalid input; equality against a stored null could pass an authority check. Both status consumers now require nonempty exact identifiers.
- A delayed Notification.create could commit after a recovery lease expired. The poller and webhook now share a conditional `ready` to `started` publication transition. Creation starts immediately after that CAS. A started or legacy publication can only reconcile an existing exact row; it cannot create another notification. Duplicate purpose-key rows fail validation.
- Partial terminal-recovery scans and unresolved publications could be reported as successful runs. Recovery failures now contribute to the sanitized non-2xx summary.
- Automatic retry rejection now prepares the final-failure publication, preserving a started publication fence. Non-accepted retry children are excluded before the bounded terminal-notification scan because their source owns rejection handling. Failed sources that still have a retry schedule are also excluded before the page limit, including overdue retries; the retry queue owns their next action. All stale-retry reservation, authority, child lookup and release failures contribute to the degraded summary.
- A missing retry child is not evidence that an interrupted submission stopped. Such stale claims remain quarantined for review. An exactly rejected child can release its source and prepare its final notification according to the agency notification policy, preserving started publications or legacy claim uncertainty; other verified child attempts remain responsible for their own reconciliation.

The additive FaxLog fields are `delivery_notify_publication_state` and `failure_notify_publication_state`, with values `ready` and `started` and no defaults. Existing security rules remain unchanged. No outbound fax, retry or signature gate is opened by this change.

## Validation evidence

Production app: `694ec16e72e01b60d22f7cbf`. Isolated staging: `6a9881683dc68a0bd54f1ef7`.

Both production function snapshots matched the repository before edits. Production queries found no nonterminal/retrying FaxLog rows and no delivered/failed rows awaiting notifications. One active Telnyx credential was present. Authenticated, read-only Telnyx requests returned HTTP 200 for the configured fax application, fax listing and an exact-ID historical fax retrieval. The historical record belonged to another connection; it was not represented as a pending fax for the configured application or copied into a synthetic tenant.

Staging checks used explicitly synthetic fax metadata, two synthetic agencies with billing disabled, and the existing test account's exact memberships. Two terminal records with null queue fields each published one authority-bound notification and finalized their publication state through hosted conditional updates. Concurrent replays created no duplicates. Each scoped inbox returned only its agency's alert; mark-read and dismiss succeeded. One inbox request returned a generic server error; later scoped requests and the repeated read/dismiss sequence passed, so its underlying cause is not established.

The staging schema update returned a transport timeout after applying. A fresh schema read verified both new fields and preserved RLS before proceeding. Targeted function deployment succeeded. Timer-run and final production activation receipts are recorded on the PR after execution; they must not be inferred from source or schema deployment alone.

Focused contracts cover hosted nulls, required identifiers, provider response identity/timeouts, queue fairness, delayed writes across poller/webhook recovery, duplicate notifications, exact rejected retry children, missing children, and partial recovery failures. Lint, high-signal typecheck, shared-helper parity, all 279 backend transpiles and build pass locally. Linux CI is required before merge. The local build has no hosted app environment configured and is a compilation check.

## Release and recovery

Keep the native workflow inactive while applying the additive fields, deploying the reviewed status consumers and the still-gated automatic retry producer and setting the polling release flag. Redeploy the poller after the flag change and verify direct invocation plus a native workflow run before activating the original five-minute schedule. Existing workers may retain the previous secret environment, as observed during stale-follow-up restoration. Never use a full resource sync to release these targeted changes.

Legacy publication claims without a protocol state, started publications without a visible notification, conflicting notifications, and quarantined retry children require operator reconciliation. Inspect the exact purpose key, provider/child outcome and recorded claim. Do not reset publication state to ready or clear a retry quarantine solely because a query returned no row: an earlier write may still commit. Confirm that the original attempt has stopped and preserve the evidence before any audited repair. No automatic legacy provenance backfill is performed.

Rollback: deactivate Poll Fax Statuses, remove its release flag, redeploy the poller and verify the closed HTTP 503 response. Keep the additive schema and shared webhook publication fence so recovery evidence and duplicate protection survive rollback. Other workflow schedules retain their existing release state.
