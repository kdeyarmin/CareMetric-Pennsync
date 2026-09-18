# Synthetic S4-create subset, version 1

This ports one bounded create path from `src/components/smartNote/persistVisitNote.js` into an independent staging transaction. It is **not complete S4**, UI acceptance, AI/compliance evaluation, customer-data migration, or production selection. Production source, native packages, public URLs, Base44 security, and external integration controls are unchanged. The staging client is also unchanged; the HTTP harness calls two named public RPCs directly.

The source creates a scheduled Visit, saves completed documentation, then separately saves PatientNoteHistoryEntry, NoteConversion and ComplianceAudit. This port creates the completed Visit and all three supporting artifacts in **one PostgreSQL transaction**, followed by a typed receipt. Failure at any insert leaves none of the five records. It does not adopt or repair partial source records.

## Exact input contract

Only an active synthetic patient in the caller's current agency is eligible. Agency administrators and currently assigned clinicians may save. Empty clinicians, foreign patients, inactive agency/membership/patient, unmapped users, and expired/deleted native sessions cannot save or replay. Membership and patient versions are checked on every save/read/replay. Auth UUID, legacy actor, canonical email, agency, creator/nurse fields, timestamps, artifact IDs and hashes are server-derived.

`public.pennsync_staging_s4_create` takes exactly:

- `p_app_id`: fixed staging namespace `6a9881683dc68a0bd54f1ef7`.
- `p_agency_id`, `p_patient_id`: current authorized synthetic scope.
- `p_expected_actor_version`, `p_expected_patient_version`: current revisions.
- `p_request_id`: caller-generated UUID retained unchanged across an uncertain response. A new UUID represents a new create; semantic duplicate visits with different request IDs are not automatically merged.
- `p_fields`: exact object below; every key is required and extras fail.

| Field | Accepted value |
| --- | --- |
| `visit_date` | Real calendar date, `YYYY-MM-DD` |
| `visit_type` | `skilled_nursing` only |
| `status` | `completed` only |
| `documentation_source` | `smart_note` only |
| `grounding_pending` | Boolean `false` |
| `nurse_notes` | Nonblank string, at most 250,000 UTF-16 code units |
| `raw_transcription` | String, at most 250,000 UTF-16 code units |
| `homebound_justification` | String, at most 20,000 UTF-16 code units |
| `homebound_status_verified`, `skilled_intervention_documented` | Explicit booleans from the reviewed synthetic result |
| `compliance_score`, `draft_presence_score` | Finite JSON numbers in 0–100 |
| `vital_signs` | Object containing only the eight source vital keys; numeric magnitude at most 1,000,000; null entries are removed |
| `compliance_issues`, `ai_tags`, `chart_findings`, `denial_findings`, `sustained_trends`, `rule_versions` | Empty arrays only |
| `acknowledgment` | Explicit `null` only |
| `diagnosis` | Empty string only; the synthetic roster has no authoritative diagnosis |

Vital keys are `temperature`, `blood_pressure_systolic`, `blood_pressure_diastolic`, `heart_rate`, `respiratory_rate`, `oxygen_saturation`, `pain_level`, and `weight`. These are source transport bounds, not physiological validation. The request's canonical JSONB representation is bounded to 2,400,000 bytes. PostgreSQL UTF-8 JSON rejects NUL and invalid Unicode surrogate representations.

Blank-note validation uses the exact 25 WhiteSpace and LineTerminator code points in [ECMAScript TrimString](https://tc39.es/ecma262/multipage/text-processing.html#sec-trimstring), matching the source's JavaScript `trim()` check independently of database locale. The check does not trim stored notes: surrounding whitespace and content characters such as U+0085, U+180E and U+200B remain unchanged. The follow-up migration replaces only this validation helper and preserves its existing grants.

Complete serialized UTF-8 JSONB artifacts are also bounded: Visit and history each at 2,400,000 bytes, conversion and audit each at 16,384 bytes, and the combined artifact object at 4,800,000 bytes. History contains the note twice, and JSON escaping can expand its bytes even when a string satisfies its UTF-16 field bound. These combined limits are checked before any insert; exceeding one returns fixed `22023` / `PENNSYNC_S4_ARTIFACT_LIMIT` with no record content or constraint detail.

Nonempty findings, trend tags, overrides, configured rule versions and diagnoses are rejected rather than discarded. Other visit types, manual/audio sources, pending review, edits, legacy recovery, audio/file handles, AI execution and full patient-chart projections are unsupported. No generic create/update/delete or clinical capability-complete claim is exposed.

## Artifacts and replay

The result has exactly `contract: cm.pennsync.s4-create.staging.v1`, `staging`, `synthetic`, `app_id`, `request_id`, current `context`, `replayed`, `artifacts` and `receipt`. `artifacts` contains `visit`, `note_history`, `note_conversion`, and `compliance_audit`, each with an immutable ID and consistent agency/patient/Visit linkage. `receipt` contains `payload_sha256` and `artifacts_sha256`.

The Visit retains completed Smart Note fields, `grounding_pending: false`, cleared-null vital sanitization, server creator fields, `emr_handoff_status: not_started`, empty handoff history and null documentation-review acknowledgment. History is an immutable append entry containing both note fields, actor/membership provenance and server timestamps. It does not mutate legacy Patient history arrays.

Conversion values match `toNoteConversionFields`, including JavaScript UTF-16 lengths, draft score, and `max(0, score - draft_score)` improvement. The audit matches `buildAuditFields` for the **empty-findings/default-rule subset**: score 90+ maps to `passed`, 80+ to `flagged`, otherwise `critical`; issues and rules are empty and acknowledgment null. These values reproduce existing review-result persistence. The RPC does not infer clinical truth or independently calculate/verify a caller-submitted score or boolean.

SHA-256 uses this independent contract's canonical PostgreSQL JSONB bytes. Note SHA-256 uses UTF-8 bytes. History logical/event/payload hashes are staging identities, **not** interchangeable with Base44 history hashes or an implemented archive importer. Existing customer IDs/data are untouched.

The dedicated receipt is keyed by `(app_id, actor_id, request_id)` and stores typed scope, revisions, four artifact IDs and two SHA-256 digests. It does not widen the administrative receipt's 4,096-byte bound. Its request digest includes the complete original field object, including explicitly cleared vitals, and all authoritative scope/version/request parameters. A changed payload with the same request ID fails HTTP 409/`PT409`. Exact retries return the same artifacts only after current authority and artifact integrity checks.

`public.pennsync_staging_s4_read` takes the same parameters except `p_fields`. It reads only the current actor's own scoped receipt, even when another administrator can otherwise see the patient. This is a narrow recovery endpoint, not a chart read API. Missing, relinked or modified artifacts fail with `PENNSYNC_S4_ARTIFACTS_CHANGED`; stale receipt revisions fail closed.

All five tables are private, FORCE RLS, without browser CRUD grants or allowing policies. Update/delete triggers preserve this create-only subset. Public functions are invoker wrappers; private entry functions reuse existing session checks and the shared/exclusive app advisory lock. Native user/session, agency/membership and patient rows remain locked until transaction completion. Revocation wins before save (no write) or after complete save (next access denied). Trusted maintenance must use the same app lock. This broad serialization is staging evidence, not throughput proof.

## Evidence and limits

`tests/s4.test.mjs` has 16 actual PostgreSQL/PGlite scenarios: pure source helper comparisons, exact first/read/retry artifacts, four-role scope, complete-payload idempotency, unsupported/malformed inputs, Unicode bounds, all JavaScript trim characters and preserved non-trim content, native-session/assignment/membership/patient changes, five rollback points, immutable records, artifact corruption detection and RLS.

`tests/s4-postgres.test.mjs` uses separate sessions in a newly generated loopback-only database and observes real lock waits. Ten scenarios cover exact JavaScript blank-note validation, escaped-note size preflight, same/different concurrent retries, both orderings of save/revoke and save/native logout, patient deactivation, and failure at every insert. It drops only its own `pennsync_s4_test_<pid>_<random>` database afterwards.

The actual-Auth HTTP suite uses signed tokens and the publishable key for exact create/read/retry checks, unsupported findings and scope denials, assignment/membership revocation, native logout, re-login reconciliation and final artifact counts. It sends no email and contacts no Base44 endpoint. No privileged key is used for these RPCs. Its result is valid only after the Docker-backed job passes; SQL tests are not substitutes. This subset does not satisfy full S4, clinical UI, hosted migration, customer restore, native-device or production cutover gates.
