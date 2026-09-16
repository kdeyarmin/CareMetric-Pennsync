# PR #184 — review fixes and rollout continuation

Date: September 16, 2026. App: `694ec16e72e01b60d22f7cbf`.
Review base: `4ba6cb891b463d51b54db755c1ca59a874765c99`.

## Eight review findings addressed

1. **Agency report isolation:** manager/agency-admin readiness now queries the validated agency roster, exactly scoped employee identities, assignments for those identities, and only their referenced courses. Unrelated tenants cannot consume the local report limits. The platform-wide report retains a separate explicit bound. No capped data is reported as complete. A regression uses 5,500 unrelated assignments, 2,200 unrelated users, and 1,100 unrelated courses with one own-agency assignment.
2. **Inclusive leave limit:** the 366-calendar-date bound includes both endpoints and uses UTC calendar keys so daylight-saving offsets do not change the count. Tests cover leap and non-leap boundaries. This is a bounded-input guard, not a leave-entitlement rule.
3. **Audit discovery completeness:** no missing, empty, unreadable, or symlinked function entry may silently disappear from the sweep. Every discovered name has a corresponding result; discovery failures make the audit fail. Empty discovery cannot pass. Tests compare the exact discovered set rather than a minimum count.
4. **Whitespace amounts:** whitespace-only numeric strings are invalid; truly empty/omitted optional fields retain their prior meaning. Daily and period fields share the check.
5. **Runtime-error distinction:** arbitrary 5xx responses and execution exceptions fail. Existing deliberate unavailable/configuration states must match the full reviewed name/status/body in `tools-anonymous-function-expectations.json` and are reported as `expected_unavailable`, not successful authentication rejections. Changing the status/body or adding fields invalidates the exception. This manifest contains response-only expectations, not successful clinical behavior.
6. **Measured audit telemetry:** removed the hard-coded `hostedRequests` field/assertion. The replacement counts actual calls reaching the stubbed fetch boundary. A test verifies two intercepted attempts. The harness is explicitly not a process-level network-monitoring system.
7. **Stored payroll service type:** malformed explicit profile or fallback service types are rejected before saving. An absent legacy type may use the existing default, but an invalid type cannot silently become home health.
8. **Retirement response:** the sole inert HTTP 200 requires the exact `{success:true, skipped:'automatic patient assignment disabled'}` object. Missing/false success and extra payload fields fail.

## Platform privacy change verified

TinyFish run `e20071e9-1c28-4a13-9deb-b924649373f4` used the saved authenticated Base44 profile. Session Recordings was enabled, sampling 100%, admins excluded. The master toggle was turned OFF and remained OFF after the settings panel was reloaded. Existing recordings were neither opened, played, exported, nor deleted. Clinical audit logging, visibility, domains, roles, and other settings were unchanged.

Independent anonymous HTML checks at `2026-09-16T13:42:39Z` returned HTTP 200 from both production domains. Neither response contained the session-recording ingestion reference or rrweb/recording-library reference. The frontend entry was still `index-DRJ8X4H_-3003a6125964.js` at that point; toggling recorder settings is not publication of this source change.

This verifies the master setting and newly fetched pages. It does not inspect previously open tabs, retained recordings, or historical capture/access. Privacy-officer assessment of any existing recordings remains separate; do not delete potential evidence merely to clear a setting.

## Fleet schema registration rechecked

Fresh Base44 metadata now returns all four expected definitions: Agency, FleetVehicle, FleetServiceEntry, and FleetServiceReview. It includes `Agency.fleet_vehicle_creation_claims`, `FleetVehicle.creation_claim_token/service_creation_claims`, `FleetServiceEntry.creation_claim_token/review_creation_claims`, and the append-only FleetServiceReview entity. Direct CRUD on all three fleet entities remains denied. No schema rewrite or database record mutation was needed for this fresh readback: the provider had synchronized the merged definitions since the prior audit.

Metadata registration alone does not prove a successful authenticated write, ordered native append under concurrency, or every production backend revision. Those remain explicit acceptance checks.

## Current validation and boundaries

Targeted workforce review cases: 25 passing tests. Anonymous-audit harness: 14 passing tests, including two complete all-function sweeps. Final full-suite, exact-head GitHub checks, merge, and publication results are recorded separately after they occur; no future outcome is assumed here.

All source repairs were made on the isolated PR branch, not by rewriting production records or broadening permissions. Existing clinical/outbound/signing/learning controls remain unchanged. No credentials or session-token values appear in this record.
