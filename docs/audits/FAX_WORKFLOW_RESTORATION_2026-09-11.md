# Fax workflow restoration — 2026-09-11

## Problem and behavior

The paused inbound, scheduled and automatic-retry fax workers could hide queued work, duplicate notifications or provider starts after interrupted requests, and report successful runs despite storage or reconciliation failures.

- Inbound scans now handle both missing and null optional queue fields, reject incorrect scope/eligibility, and surface unverified claims. Empty OCR results retry; OCR has a 90-second deadline.
- New ingress rows carry a one-shot notification state. Before creating an alert, the worker saves its exact payload and completed OCR/routing result. Interrupted publications reconcile that intent without repeating OCR or creating another alert. An absent or inactive recipient skips the alert explicitly while preserving the completed document for authorized review. Storage errors and uncertain publications still require reconciliation.
- Suggested matches link to an authorized document review on ReferralFollowUp. The reader rechecks the referral and exact completed fax twice, including tenant and role scope. Suggestions do not accept clinical answers or attach documents automatically.
- Scheduled and retry dispatches consume a conditional start marker on their existing parent row. Replayed capabilities cannot each create a recipient transmission. Uncertain starts remain available for reconciliation; missing legacy state is never proof of permission to send.
- Inbound and scheduled queue creation reserve their purpose key through a conditional update of the existing Agency row, then repeat the child lookup inside the reservation. Confirmed creation releases the reservation; uncertain creates retain it. Reservations are bounded and contain only digests and opaque tokens.
- Scheduled completion requires a successful broker response with exact schedule/attempt IDs and integer totals. Both workers expose storage, claim and reconciliation failures through non-success HTTP results.
- `OUTBOUND_FAX_WORKFLOW_RELEASE=enabled-v1` releases only the opted-in queue workers, schedule creation and internal batch dispatch. Interactive batch sending and unrelated email/SMS/voice remain on the existing global delivery gate.

## Schema and release requirements

Additive fields, no RLS changes or defaults granting publication permission:

- Agency: `fax_workflow_reservations`.
- IncomingFax: `processing_notification_state`, `processing_notification_intent`, `processing_completion`, `queue_creation_reservation_token`.
- ScheduledFax: `dispatch_submission_state`, `queue_creation_reservation_token`.
- FaxLog: `retry_submission_state`.

Deploy schemas before the reviewed revisions of `handleTelnyxStatusWebhook`, `processInboundFaxes`, `getAuthorizedInboundReferralFax`, `sendBatchFax`, `processScheduledFaxes` and `autoRetryFailedFaxes`, plus `pollFaxStatuses` and `checkAllIntegrations`. The frontend change must be published with the document reader. Keep each native workflow and its release flag closed until hosted validation succeeds. No blanket backfill changes a legacy absent state to ready.

## Validation so far

- 158 focused fax, authorization, provider, replay, queue, notification and readiness contracts pass, including the review and hosted-data regression cases.
- Lint: zero errors/warnings. High-signal typecheck: zero findings. Shared helper parity: 219 consumers. All 279 backend functions transpile.
- Full local test invocation was attempted. Windows shell command-length, path-separator/file-URL, symlink permission and mode-bit assumptions fail existing platform-dependent tests. Node suites were also invoked directly to bypass the shell limit. Linux CI remains required before merging.
- Staging schema readback confirms all additive fields and unchanged RLS, including recovered-creation tokens. The connector returned HTTP 504 on some successful changes; no destructive schema push was used. The initial six-function deployment and empty-queue invocations passed; reviewed revisions are being redeployed.
- Production inspection found one active Agency, no queued inbound/scheduled/retry fax records, and no active destination or private-document bindings. No test fax has been sent. Production fax schedules remain paused pending hosted validation and verified sender/document/destination configuration.

## Remaining restoration work

Stale follow-up checks and fax status polling are already restored. Outcome computation and signature reminders remain separate, unfinished parts of the authorized restoration work. Outcome publication needs an existing-row ownership mechanism and stable source cohort. Signature reminders depend on the private document signing, verification, consent configuration and completed-document path. The user confirms their consent and verification policies exist.

## Review corrections and hosted evidence

- Reservation cleanup retries full-map CAS conflicts, tolerates lost acknowledgements, and releases only the matching token persisted on the recovered child. A replay cannot clear another creator's reservation.
- Persisted inbound completion is schema-validated before finalization; it cannot overwrite tenant, provider, lease, or notification authority. Started publication reconciles its original recipient intent after membership revocation or revision. New publications still require active membership.
- Suggested document delivery compares the current referral patient against the persisted suggestion on both reads.
- Unknown automatic retries retain their original claim for delayed-child recovery. The poller selects the exact next generation, so older rejected children cannot poison later recovery. A producer-owned ready state proves submission never started and allows bounded backoff; absent or started states do not.
- Scheduled partial preparation failures preserve proven unstarted recipients only when all earlier attempts have durable accepted/rejected results. A real sender harness proves the accepted recipient is deduplicated on resume and uncertain provider results never reopen the fence. Stale ready claims receive bounded backoff; workers do not initialize legacy submission permissions.
- Office forwarding retains claims after 5xx and ambiguous 408/409/425 responses. Only definite provider rejection releases the claim.
- Integration readiness includes the dedicated fax-delivery prerequisite. Environment and release documentation now describe the flag.
- Hosted reservation tests on absent/null/empty maps proved one winner under concurrent claims, exclusion during uncertain creation, independent keys, and preservation of another key during release. All synthetic agencies were suspended after the proof.
- A hosted OCR exercise stalled during private upload before IncomingFax creation; it is not counted as a successful OCR proof. The execution was stopped, its synthetic membership revoked, and its binding and agency suspended. No provider transmission occurred.
- Subsequent hosted OCR validation passed with a private synthetic PDF: two concurrent invocations processed it exactly once, persisted a suggested match and completed notification state, and created exactly one notification. A replay processed zero rows and left the notification count at one. The synthetic membership was revoked and the binding/agency suspended after verification.
- Hosted referrals store nullable `archived_at` and may identify their creator through `created_by_id` rather than the legacy email field. The scan and creator validator now support those persisted forms while retaining exact immutable creator provenance checks. Regression tests reject conflicting and missing creator metadata.
- Reconciliation of a definitely rejected retry advances the generation and schedules another attempt when policy budget remains. Disabled/exhausted policies settle terminally; unavailable or malformed policy reads retain the claim and report recovery failure. This addresses the additional review-body finding before merge.

- Final review found that a permanently absent recipient could cause repeated OCR. A producer-owned ready alert now finishes as `skipped_no_recipient` when exact membership lookup proves no active recipient, retaining the completed document and authorized review link. Missing legacy state, ambiguous membership, storage errors, and already-started publications do not use this path.
