# Outcome publication restoration — 2026-09-11

## Problem and final path

The previous outcome worker remained paused because query/create contender election could admit two publishers, expired leases did not exclude delayed writes, and offset pagination could mix changing source cohorts. Hosted validation also exposed optional properties materialized as null, preventing run publication and broker reads.

The native nightly workflow calls `dispatchNightlyOutcomeMeasures`, which signs one exact tenant/day request for `computeOutcomeMeasuresV2`. The original `computeOutcomeMeasures` endpoint is a permanent 503 stub with an empty automation list. In staging, service-to-service calls to the original name continued executing its old paused revision after repeated successful deployments, while direct calls saw updated source. The new endpoint consistently executed updated source through the same internal SDK path. No floating revision selector or authorization bypass was added.

## Publication and source guarantees

- An existing Agency row owns a bounded map of per-window claims. Full-map conditional updates preserve unrelated windows and tolerate lost acknowledgements through exact token readback.
- Before publishing, the worker consumes its unexpired building claim into a committing claim referencing the exact run. Committing ownership cannot expire into a second publisher until the referenced run has been conditionally terminated or verified terminal. Unconfirmed release returns a retryable failure and retains the fence.
- OASIS cohorts use strict id keyset scans with bounded pages and reject foreign scope, duplicate/nonmonotonic ids, and overflow. All source cohorts and Patient metadata are captured before a complete second pass. Append-only OASIS writers and matching full-row hashes/revisions establish a common boundary. Any source change fails before derived writes.
- The published summary records the boundary, source digest, cohort/row counts and patient count. No source values are included in this snapshot metadata.
- Optional null and absent object properties share the derived-row hash representation. Arrays, false, zero and actual recorded values remain significant. Summary hashing still preserves null rates. Run transitions retain the exact stored null/absent preimage in their CAS query. The read broker omits unset values and checks the same row hashes.
- Existing tenant authority, signed worker capabilities, immutable derived generations, publication reconciliation, RLS and browser read restrictions remain enforced.

## Validation

- 235 outcome, dispatcher, broker, automation, OASIS writer and security guardrail tests passed locally, including contention, expired ownership, lost acknowledgements, source mutation, null defaults, replay, revocation and content tampering.
- Lint: zero errors/warnings. High-signal typecheck: zero findings. Build passed. Shared helper parity: 219 consumers. Backend syntax: 280 functions.
- Staging used two explicitly synthetic agencies, one sample patient and SOC/discharge pair each. Both published exactly one metric and one KPI. Concurrent dispatch reported contention rather than success; replay returned both saved publications without creating duplicates. Both claim maps returned to empty.
- The native staging workflow completed in 4.8 seconds, run `da77b9a2-3c78-48ec-ad82-ebc9ecb06087`. Both authorized broker reads returned only the expected synthetic patient. After Agency suspension, both reads returned 403 and the dispatcher discovered zero active test agencies.
- One early synthetic run failed before publication due to the hosted null representation. Its exact building preimage was conditionally retired; it produced no derived rows. Synthetic history is retained under suspended agencies. The diagnostic signing helper was removed after proof.

## Release procedure and bounds

Merge after review and green CI. Add only `Agency.outcome_window_claims`, preserving all existing fields and RLS. Deploy the retired endpoint, V2 worker, dispatcher and reader to the explicit target app; set `OUTCOME_PIPELINE_RELEASE=enabled-v1` only after validation. Run the native workflow and inspect its result before activating the existing daily 06:00 UTC schedule. Source deployment leaves the flag closed by default.

Concurrency can return HTTP 409 from the worker and 502 from a dispatcher whose bounded retry overlaps an active owner; replay the same logical day after the owner completes. Ambiguous committing claims are retained for reconciliation. The map is bounded at 500 unresolved windows; source scans and tenant fanout retain explicit caps. These are internal unadjusted proxies, not official CMS rates or eligibility determinations.
