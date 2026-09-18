# Synthetic S3 manual referral subset, version 1

This staging contract ports a manual referral linked to an existing synthetic patient through creation and manual confirmation. It is not full S3, new-patient admission, document processing or production selection. This document describes the database contract; the transferred staging UI is documented in `../authority-client/MANUAL_REFERRAL_UI.md`. Production Base44 functions, providers, customer records, native packages, public URLs and release controls remain unchanged. It depends on the S4 migration's active/inactive patient field but does not change S4 behavior.

## Source boundary

- `base44/functions/manageAuthorizedReferral/entry.ts`, `createReferral`: creation key binds agency, actor and request; exact retries require an unchanged version-1 referral. Tenant and optional patient authority are checked before creation and replay.
- The same broker's `updateReferral`: an exact authorized referral is conditionally updated at its observed revision and increments its revision once.
- `src/pages/ReferralIntake.jsx`, `handleConfirmMatch`: sets exactly `patient_id`, `requires_manual_review: false`, `manually_confirmed: true`, and `status: ready_for_admission`. This existing-patient branch writes only Referral.
- `base44/entities/Referral.jsonc` defines the preserved field names and states. The live-readiness fixture's S3 create supplies a manual, normal-priority, new referral.

The current source also supports unlinked referrals, patient relinking, broad extracted clinical fields, new Patient creation, AI/document processing, assignments, follow-ups, declined and SOC states, and general edits. Those are outside this subset and must be rejected, not silently discarded. The two supported workflow steps remain independently visible transactions; they are not collapsed into a fabricated successful admission.

## Scope and input

Only `agency_admin`, `manager`, and `office_staff` in an active membership and active/trial agency may create, confirm, read or list. Office staff additionally require an active assignment, locked and rechecked inside each transaction including replay. This is the transferred assignment branch; creator-provenance office access remains unavailable. Assigned and empty clinicians are both denied. There is no owner bypass. The already linked patient must be active, synthetic, and in the exact agency; the staging roster cannot represent the source's hospitalized/discharged states yet.

Every call reuses current native user/session, identity-map, agency and membership checks. Actor and patient versions are mandatory. Read and both write retries use current authority, even if an earlier write succeeded. Trusted revocation and maintenance must use the existing application lock.

The create RPC accepts a fixed staging app ID, agency ID, patient ID, expected actor/patient revisions, a UUID request ID, and an exact field object:

| Field | Accepted value |
| --- | --- |
| `patient_name` | String beginning `Synthetic `, at most 120 UTF-16 code units |
| `priority` | `low`, `normal`, `high`, or `urgent` |
| `document_type` | `manual` |
| `status` | `new` |
| `requires_manual_review` | Boolean `true` |
| `manually_confirmed` | Boolean `false` |

The patient link, creator IDs/email, creation key, timestamps, referral ID and version are derived from the authoritative parameters and live context. Caller-provided server fields or additional clinical fields fail. No submitted patient name is evidence of identity matching; the explicit existing-patient ID determines the link.

Confirm takes the same scope/revisions, referral ID, expected referral revision `1`, and a separate UUID request ID. It preserves the existing patient link, sets the four source confirmation fields and advances the referral to revision `2`. This contract cannot relink or confirm again under a new request. Current read accepts exact scope/revisions and referral ID; it is an authorized referral read, not an actor-private receipt endpoint.

## Transactions and retries

Each write stores its Referral change and immutable typed receipt in one transaction. Creation uses a unique agency/actor/request binding. Confirmation uses one conditional version-1 transition and a unique confirmation receipt. An uncertain response is retried with the identical request, payload and revisions; changed payloads or stale results fail with deterministic HTTP 409 rather than performing a second write. Different create request IDs are distinct referrals; no patient-name deduplication is claimed.

Create replay fails after confirmation, matching the source's version-1 replay restriction. Confirm replay returns the exact stored version-2 result only after live authority, scope, payload and current-result verification. Read verifies the current referral against the corresponding immutable receipt. Hashes bind the canonical PostgreSQL JSONB request and referral bytes; they are integrity checks in this database, not a cryptographic attestation of an operator or an implemented Base44 archive importer.

The new tables are private, FORCE RLS, with no browser CRUD grants or allowing policies. Public functions are invoker wrappers; only private entry implementations are definer functions. Existing administrative and S4 receipts remain unchanged. Input and result bounds are checked before writes with fixed errors that contain no submitted content.

## Exact public RPCs

All four names start with `public.pennsync_staging_`. All require `p_app_id` (fixed `6a9881683dc68a0bd54f1ef7`), `p_agency_id`, `p_patient_id`, `p_expected_actor_version`, and `p_expected_patient_version`.

| Suffix | Additional parameters |
| --- | --- |
| `s3_create` | `p_request_id` UUID, `p_fields` exact object above |
| `s3_confirm` | `p_referral_id` UUID, `p_expected_referral_version` integer `1`, `p_request_id` UUID |
| `s3_read` | `p_referral_id` UUID |
| `s3_list` | `p_limit` integer 1–50, `p_after_id` UUID or null |

List results contain exactly `contract: cm.pennsync.s3-referral-list.staging.v1`, `staging: true`, `synthetic: true`, `app_id`, `action: list`, current `context`, `items` and `next_cursor`. Each item contains exactly the current `referral` and its `referral_sha256`. Records are ordered by stable ascending referral UUID; a non-null next cursor is the final returned UUID when another row exists. The supplied anchor must belong to the same authorized patient and pass current receipt integrity validation. Each page rechecks authority and locks/verifies every disclosed record. This is current pagination, not a multi-page snapshot.

Write results contain exactly `contract: cm.pennsync.s3-referral.staging.v1`, `staging: true`, `synthetic: true`, `app_id`, `action`, `request_id`, current `context`, `replayed`, `referral` and `receipt`. Receipt contains `payload_sha256` and `referral_sha256`. Read returns the same contract/scope markers with `action: read`, current `context`, current `referral`, and `referral_sha256`; it does not claim to replay another actor's request.

Create fields are bounded to 2,048 serialized JSONB bytes. Complete request and Referral representations each have a 4,096-byte preflight bound, retained in table checks. A request ID is scoped to agency plus actor; the same actor may use the same request ID in another independently authorized agency, matching the source creation key. Within an agency, create and confirm cannot reuse the same actor/request binding for different actions. A new create request ID represents another referral, even if the patient/name match.

Read checks current expected authority revisions rather than requiring the revision originally recorded by the writer. Write replay requires the entire original payload, including original revisions. An authorized membership change can therefore allow a newly versioned read while invalidating an old write replay. The staging browser client validates all four finite methods; the app uses list followed by exact read to reopen saved referrals.

## Evidence and limits

The additional `referral-list-postgres.test.mjs` suite covers exact pending/confirmed records and hashes, page bounds and cursor isolation, current role/version checks, corrupted receipts, both orderings of assignment/patient/session revocation, and both orderings of list disclosure versus confirmation. Restore verification invokes the list after recovery. The compiled real-Auth browser journey opens existing referrals through their displayed links. The original migration evidence below remains historical baseline evidence, not a replacement for current UI/hosted acceptance.


`tests/s3.test.mjs` has 12 PostgreSQL/PGlite scenarios covering exact create/confirm/read/replay; source field transitions; all three intake roles; four-role/two-agency denials; agency/actor request-key dimensions; unsupported fields and bounds; create replay after confirmation; payload, revision and result conflicts; native-session/membership/patient changes; direct CRUD denial and tamper detection; and rollback at each record/receipt write. They run from the existing `test:authority-store` registry.

`tests/s3-postgres.test.mjs` has 10 tests using separate native PostgreSQL connections and observed lock waits for concurrent same/different creates, same/different confirmation requests, both orderings of confirmation and membership revocation/native logout, patient deactivation, and failure at all write points. It requires the existing local test roles before any database creation; it does not provision cluster roles. Each creates and drops only its generated `pennsync_s3_test_<pid>_<random>` loopback database, and cleanup runs only after ownership was established by successful creation. Its CI step runs sequentially after the other PostgreSQL suites, while preserving real connection concurrency inside each test.

Actual Auth/PostgREST coverage creates/confirms/reads both agencies' referrals, rejects both clinicians and foreign patients, rejects unsupported fields and stale replay, logs out/re-authenticates the actual intake administrator, and verifies trusted control-plane membership revocation closes every S3 path. The latter uses the required app lock; the existing public revocation endpoint intentionally remains clinician-only. After observing denial, a finally block restores only the asserted owned synthetic membership baseline under the same lock, including on test failure, so later independent suites retain their baseline. All RPCs use signed test sessions and the publishable key. Direct endpoints for both new private tables must remain inaccessible. SQL stubs alone do not prove HTTP or hosted acceptance; the Docker-backed job must pass before claiming HTTP acceptance. No hosted, customer, native-device or production cutover proof is supplied by this subset.

The 48 combined authority/S4/S3 PGlite tests and 10 native S3 PostgreSQL 17.10 tests passed locally. Supabase CLI 2.109.1 security advisors returned no findings against a newly owned local database containing all three migrations; that database was dropped. Current Supabase changelog, function grant/search-path and session-lifecycle documentation were checked. No extension, Realtime, hosted gateway, Auth-provider or Management-log change is needed for this additive SQL subset. HTTP acceptance still requires the dedicated CI result.
