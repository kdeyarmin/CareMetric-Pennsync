# Signature reminder creation recovery

The scheduler previously checked for an existing schedule key and then created a row. Concurrent callers could each create a dispatchable reminder, and retries of a pending-audit row could not resume it.

Each package now owns a permanent map from the server-built schedule key to a random creation token. An exact conditional update wins the right to create a single reminder. The row carries that token, and both replay and dispatch verify it against the package. Unknown create outcomes retain the reservation; elapsed time never authorizes a second create. The package limits this map to 500 schedules and requires operator reconciliation when a claimed create cannot be located.

A second conditional marker authorizes a single schedule-audit create attempt. Lost acknowledgements reconcile through exact readback. Pending-audit rows can resume activation once the audit is verified; unknown audit outcomes remain non-dispatchable. Requester membership and target deadline/content authority are checked again before activation. No email is sent by this scheduler.

Runtime tests cover simultaneous schedules, lost row/audit/claim acknowledgements, unknown outcomes, concurrent activation recovery, changed payloads or creation provenance, and membership revocation after audit. All 45 targeted creation, existing signing, schema and test-registry checks pass. Lint, high-signal type checking, 280 backend transpiles, 225 shared-helper consumers and build pass.

Public signing and reminder dispatch remain disabled. This change addresses creation uniqueness and audit recovery; it does not finish shared token issuance, provider-indeterminate operator resolution, signer verification, secure package creation, signed-document finalization, or the public UI. Hosted schema/proof verification is tracked separately before changing the uniqueness proof gate.

Hosted staging proof now passes: two simultaneous attempts produced one reminder, one audit event, and a successful exact replay. No email was sent; the fixture reminder and package were canceled. An initial schema update appeared in metadata while the runtime dropped the new fields. A scoped schema repair and actual field-persistence readback resolved that discrepancy before the proof passed. The separate uniqueness proof constant is now true; the product release constants remain false.

Review follow-ups recover a package reservation after a lost acknowledgement, return 409 for non-recoverable states, and include pending_audit reminders in offboarding cleanup while preserving reservation evidence. Legacy rows without creation provenance intentionally require explicit migration and cannot be silently adopted. The production reminder inventory was verified empty on 2026-09-12, so there are no existing rows to backfill in this rollout.
