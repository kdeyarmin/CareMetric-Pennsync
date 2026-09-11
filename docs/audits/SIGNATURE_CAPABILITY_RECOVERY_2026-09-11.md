# Signature capability recovery — 2026-09-11

The user confirms that approved consent and signer-verification policies exist. Exact configuration is still being located; policy existence is not a reason to defer independent implementation. The full feature inventory and release dependencies remain in `SIGNATURE_RESTORATION_AUDIT_2026-09-06.md`.

## Defect inventory before changes

- Validation creates unlimited review grants despite the token's existing `access_count` field. Concurrent validation requires a conditional increment, with no grants or signed URLs on an unconfirmed increment.
- Validation and submission trust the original token expiration without checking shortened package/document deadlines. Date-only values must reject impossible calendar dates.
- Submission checks claim ownership before asynchronous audits, leaving a gap before private upload. A stale worker can resume after another invocation takes its lease.
- Upload failure is marked irreversible only after the upload response arrives. An uncertain upload acknowledgement can therefore release claims and allow a duplicate upload. Stale takeover must not cross a persisted upload-start marker without finding the exact immutable artifact.
- Signature source and artifact URI validators reject the hosted `mp/private/<app-id>/...` format, already proven by the document restoration. Full source-document provenance still needs the secure package creation broker.
- Remaining release work includes secure package creation, the configured identity method, HMAC key lifecycle, immutable completed PDFs/certificates, reminder concurrency and operator reconciliation, public UI, and hosted end-to-end evidence. Public release gates remain off until the complete flow is verified.

## Implemented and validated

Review attempts now use an exact token revision/count conditional update, capped at 20, followed by readback before creating any grant. A lost acknowledgement consumes the attempt without issuing grants. Issuance, scheduling, dispatch, review and submission consistently validate available package/document deadlines and reject impossible date-only dates. Current deadlines are rechecked at submission boundaries; exact completed retries only reconcile their existing artifact.

Submission rechecks both claims after audits, persists an upload-start owner marker with a conditional update, and verifies ownership before and after private upload. Lost marker/upload acknowledgements retain the fence. Stale retries with no confirmed artifact cannot upload again. A completed artifact clears the marker only when its token transition is reconciled. All five brokers accept the verified hosted private URI format.

The 120 focused signing/security tests pass, including twelve runtime recovery/concurrency cases; lint and signal checking pass, 280 functions transpile, and the build passes. No production signing release or provider delivery occurred. The remaining inventory above continues to apply, including an audited operator path for indeterminate attempts and full hosted proofs.
