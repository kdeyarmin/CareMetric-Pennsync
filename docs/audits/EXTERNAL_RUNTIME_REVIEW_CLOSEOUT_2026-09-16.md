# External runtime review continuation — September 16, 2026

PR #186 review findings are addressed by request admission, provider validation, safe pre-execution retry and scheduler-drain changes. The proposal remains separate from production PennSync traffic.

## Findings

1. Supabase's actual /object/sign relative response is resolved under /storage/v1 and strictly bound to the expected private object; full-path and absolute forms are also checked. Invalid destinations, credentials, traversal, fragments and duplicate tokens are rejected.
2. Explicit falsy model/schema values are rejected rather than silently starting a different paid operation.
3. Confirmed pre-provider failures may retry with the same idempotency key and a new claim. Actor locking, a three-attempt maximum and a durable daily budget preserve ownership/quota. Pending, uncertain and completed work never becomes a fresh provider call.
4. Slow/unauthenticated request bodies no longer occupy verified-work slots. Malformed credentials fail before body consumption; separate bounded pools, five-second reads and native request/header deadlines limit stalled senders.
5. Per-token/process admission bounds the retained Base44 authority dependency before provider-quota checks. It is not described as a distributed denial-of-service guarantee.
6. Sender syntax and operation-aware preflight requirements agree with readiness; an email-only configuration does not require Anthropic.
7. Known unresolved SDK promises keep their scheduler slot after UI timeout; late success/failure both release it. Direct SDK timeouts cannot be overridden into paid retries.
8. README and CI commands cover all runtime, retry and scheduler-drain tests.

## Actual external database work

Applied the safe-retry reservation/budget migration to the dedicated integration state, retaining private grants. The first synthetic hosted transaction caught an SQL insert parameter-name error; it was repaired immediately and the complete transaction then passed and rolled back. Zero jobs, files and budget records remained. The exact change and installed correction are recorded under migrations/.

## Preservation and acceptance boundary

Existing ios/public assets remain protected against production baseline 1ff6018c. No patient/employee record, store package, signing key or uploaded customer file was changed. No Base44 production publication or external traffic activation is implied by these source changes. Source tests, final-head CI, real deployment revision and actual authenticated/provider acceptance must be reported independently. The external authority callback, legacy file contracts, other providers/workflows and zero-credit ledger verification remain explicit migration work, not completed capabilities.
