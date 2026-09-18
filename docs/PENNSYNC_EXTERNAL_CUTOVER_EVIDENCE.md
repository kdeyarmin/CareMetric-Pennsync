# Independent PennSync cutover evidence contract, version 1

`tools-pennsync-cutover.mjs` checks the integrity, exact deployment binding and
coverage of an externally assembled cutover evidence packet. It is offline and
has no release, publishing, DNS, database, credential or network operation. It
does not provision accounts, migrate data, perform a cutover or authorize one.

A successful result is **`evidence_coverage_complete`**, never “migration
verified.” The report always includes `migration_independently_verified: false`,
`manual_assertions_cryptographically_proven: false` and `release_authorized: false`.
An operator can fabricate an internally consistent packet. Hashing its receipts
binds retained bytes; it does not prove their authorship, execution, clinical
correctness or the truth of physical-device/manual assertions. Review the
underlying protected run artifacts independently. This tool cannot replace that
review or a live probe.

## Two different scopes

- `business_backend_exit`: authentication, authorization, records, files,
  functions and other business execution are independent; the existing
  Base44-hosted static compatibility shell remains. The target frontend must
  identify a Base44 origin, and endpoint/independence receipts must explicitly
  acknowledge the retained hosting dependency.
- `complete_hosting_exit`: no Base44 business or hosting dependency remains.
  Target/rehearsal frontend origins must be independent and the retained-shell
  flags must be false. A production receipt must attest that the permanent
  origin remains available without Base44 hosting. The validator cannot
  establish vendor control of that hostname. A supported arrangement preserving
  `caremetricai.base44.app`, or an appropriate native compatibility transition,
  must be reviewed before this assertion is credible.

Neither mode permits a Base44 backend origin, paid-operation fallback or hidden
runtime execution dependency. Already-paused capabilities may stay paused only
with a receipt attesting both the baseline pause and the preserved target pause.
Disabling a previously working feature is not preservation.

## Trust inputs and invocation

Keep the packet in a restricted operator directory outside the repository.
It contains no passwords, tokens, raw emails, patient data, clinical narratives,
file bytes, signed storage URLs or free-form comments. Principals/agencies are
represented by stable SHA-256 identifiers prepared through the approved identity
mapping process. Do not mistake an arbitrary hash or email for authentication.

Set these environment variables through the operating environment:

| Variable | Input |
| --- | --- |
| `PENNSYNC_CUTOVER_EXPECTATIONS_PATH` | Externally reviewed expectation JSON file |
| `PENNSYNC_CUTOVER_EXPECTATIONS_SHA256` | SHA-256 of those exact file bytes, independently pinned before evaluating evidence |
| `PENNSYNC_CUTOVER_EVIDENCE_PATH` | Evidence index JSON file |
| `PENNSYNC_CUTOVER_RECEIPTS_DIR` | Canonical, nonsymlink directory holding `<sha256>.json` receipts |

From a checkout containing every referenced source/candidate commit, run:

```sh
node tools-pennsync-cutover.mjs --check
```

Only `--check` is accepted. Exit `0` means complete evidence coverage, `1` means
coverage/receipt blockers, and `2` means unavailable or invalid pinned inputs.
Output contains fixed blocker codes only; it never echoes paths, principals,
URLs, arbitrary receipt text or parser error fragments. Source/candidate Git
objects are read without checking out or changing a branch. JSON inputs are
bounded to 2 MiB, have a maximum nesting depth of 40, reject duplicate keys
(including escaped equivalents) and reject every field not in the versioned
schemas below. A normal workflow must not automatically replace the independent
expectations hash with whatever unreviewed file is supplied.

`validateExpectations`, `createCutoverCensus`, `bindingSha256` and
`checkCutoverEvidence` are exported for reviewed tooling. Their direct callers
are responsible for the same pinned-input trust boundary; injecting a made-up
census into the pure checker is not repository inventory proof. No command
generates a passing packet.

## Strict expectation schema

Every key listed is required; no other key is accepted. `sha256` means a
lowercase, nonzero 64-character hex value; a commit/tree is a nonzero lowercase
40-character Git object ID. Timestamps are canonical millisecond UTC strings.

| Key | Required type/value |
| --- | --- |
| `format` | `pennsync-external-cutover` |
| `schema_version` | Integer `1` |
| `mode` | One of the two scopes above |
| `source`, `target`, `rehearsal` | Exact object with `frontend` and `backend` deployment objects |
| `census_sha256` | SHA-256 of the canonical computed inventory records |
| `hosted_capabilities` | Unique array of additional `hosted:<identifier>` capabilities, at most 10,000, including functions/features known only from hosted inventory; empty only if independent review found none |
| `public_endpoints` | Unique array of exact canonical HTTPS URLs, no credentials/query/fragment, including `https://caremetricai.base44.app/` and `https://app.caremetricai.com/`; at most 100 |
| `owner_subject_sha256` | Hash of the protected owner's independent mapped subject, excluded from the test roles |
| `actors` | Exactly four actor objects in order: `admin_a`, `clinician_a`, `clinician_a_empty`, `admin_b` |
| `minimum_observation_seconds` | Positive safe integer determined in the reviewed release plan |
| `evidence_not_before`, `evidence_not_after` | Closed evidence window: start before end; end must not be in the future when evaluated |

A deployment object has exactly `commit`, `tree`, `artifact_sha256`, `origin`,
and `deployment_id`. `origin` is an exact HTTPS origin with no path, query,
fragment or credentials. A deployment ID is 1–128 characters using letters,
digits, underscore, period, colon or hyphen, beginning with a letter/digit.
Rehearsal frontend/backend commit, tree and artifact hashes must equal the
corresponding final target builds. Rehearsal backend origin must differ from
production. Actual deployment IDs and origins are included in every receipt
binding, so an otherwise matching build from another environment cannot pass.

Each actor object has exactly `role`, `subject_sha256`, `agency_sha256`.
All four subjects must be distinct and different from the protected owner.
The first three roles share Agency A; Admin B must use a distinct Agency B.
The identity receipt additionally attests real independent authentication.

The expectation's whole canonical JSON hash is `binding_sha256`. It covers
both previous deployments, both candidate deployments, both rehearsal
deployments, actors, census, public endpoints, mode and observation window.
Changing any of these invalidates old receipts. Its canonical hash differs
from the CLI's exact-file-byte hash; both checks are intentional.

## Capability census and coverage

The census reads the exact committed Git trees, verifies their tree IDs, and
unions separately identified source and candidate resources. Removed source
handlers therefore still need dispositions. Frontend resources come from each
frontend commit; backend resources come from each backend commit.

Included file families:

- Every `base44/functions/<name>/entry.[c/m]js` or TypeScript equivalent.
- Every `base44/workflows/*.json` or `.jsonc` resource.
- Every `base44/entities/*.json` or `.jsonc` schema.
- Every non-test JavaScript/TypeScript/JSX/TSX module recursively under `src/`
  and `services/`, including public/legacy pages, client functions, auth/session
  seams, nested service handlers and SQL migration definitions. Files bearing
  `.test.` or `.spec.` and directories named `test`, `tests` or `__tests__` are
  excluded.
- Independently reviewed `hosted_capabilities` additions.

Records are sorted `{id, blob}` objects; `id` is `source:<repo-path>`,
`target:<repo-path>` or `hosted:<identifier>`, and hosted additions use a null
blob. `sha256(canonical(records))` is the expected census digest. Source functions
and candidate pages must both exist; selected symlinks are rejected.

This is a conservative file census, **not an exhaustive dynamic call graph**.
It does not discover out-of-repository schedules/resources by itself, interpret
every branch within a page, or prove the preserved pause in source. The required
inventory receipt explicitly covers complete deployed inventories and dynamic
resources; reviewers must inspect their protected underlying artifacts and add
every hosted-only capability. Additional feature-level entries can also be
listed as `hosted:` identifiers to retain finer coverage.

The evidence index has exactly `format`, `schema_version`, `binding_sha256`,
`capabilities`, `gates`. Its format/version match expectations.

Each capability is exactly `{id, state, receipt_sha256}`. The ID set must equal
the census set, with no duplicate, omission or extra. The state is `independent`
or `preserved_paused`. A production-context receipt may batch multiple IDs,
but every covered ID must point back to that exact receipt and same state.

The capability receipt kinds and exact claims are:

- `capability_independent`: `capability_ids` unique nonempty array,
  `base44_execution_calls: 0`, `outcomes_verified: true`.
- `capability_preserved_paused`: `capability_ids` unique nonempty array,
  `base44_execution_calls: 0`, `baseline_pause_verified: true`,
  `target_pause_verified: true`.

## Content-addressed receipt schema

Every receipt is retained as `<sha256-of-exact-file-bytes>.json`. The checker
reads the file, recomputes its hash, parses its schema, and checks the binding
and exact deployment object. A hash string without its retained matching bytes
cannot satisfy a gate. One receipt ID cannot identify two different byte sets.

Required receipt keys:

| Key | Required value |
| --- | --- |
| `format` | `pennsync-external-cutover-receipt` |
| `schema_version` | `1` |
| `receipt_id` | Bounded identifier using the deployment-ID syntax |
| `binding_sha256` | Canonical hash of the entire pinned expectations object |
| `kind` | Exact gate name below, or capability receipt kind above |
| `context` | Required `rehearsal` or `production` for that gate |
| `captured_at` | Canonical timestamp inside the pinned evidence window |
| `deployment` | Exact complete `rehearsal` or `target` frontend/backend pair from expectations |
| `result` | Literal `pass` |
| `claims` | Exact gate-specific claim object below; no arbitrary text/metadata |

The index `gates` must contain exactly the 15 gate names below, each mapped
to its receipt SHA-256. Boolean claims below must be `true` unless an explicit
different value is stated.

| Gate / context | Exact claim keys and constraints |
| --- | --- |
| `inventory` / production | `source_inventory_complete`, `target_inventory_complete`, `hosted_and_dynamic_resources_reviewed`, `no_unclassified_operations` |
| `identities` / rehearsal | `actors` exactly equals expected actors; `independent_authentication`, `owner_excluded` |
| `isolation` / rehearsal | `positive`, `negative` arrays exactly match matrix below; `raw_response_assertions`, `empty_clinician_roster` |
| `revocation` / rehearsal | `reads_denied_after_revocation`, `writes_denied_after_revocation`, `role_version_change_denied`, `stale_sessions_denied`, `inflight_disclosure_fenced` |
| `concurrency` / rehearsal | `independent_clients` safe integer ≥2; `duplicate_primary_records: 0`; `unique_constraints_verified`, `stale_updates_rejected`, `revocation_linearized`, `lost_response_reconciled` |
| `clinical` / rehearsal | `patient_chart_passed`, `referral_create_accept_passed`, `visit_save_passed`, `supporting_artifacts_complete`, `retry_deduplicated` |
| `private_files` / rehearsal | `source_sha256`, equal `download_sha256`; `authorized_download`, `foreign_actor_denied`, `revoked_actor_denied`, `expiry_and_renewal_verified` |
| `archive_restore` / rehearsal | Positive safe integer `source_rows`, `source_users`, `source_files` equal respective `restored_rows`, `restored_users`, `restored_files`; `encrypted_backup`, `restore_rehearsed`, `record_manifest_reconciled`, `identity_mapping_reconciled`, `file_hashes_reconciled`, `references_reconciled`; `unexplained_conflicts: 0` |
| `sessions` / rehearsal | `old_sessions_invalidated`, `backend_identity_bound`, `cross_tab_logout_passed`, `idle_expiry_passed`, `stale_callbacks_denied`, `cached_phi_purged`, `draft_authority_preserved`, `recovery_login_passed` |
| `endpoints` / production | `urls` equals expected endpoints; `deep_links_preserved`, `legacy_file_urls_preserved`, `native_entry_preserved`; `static_compatibility_shell_retained` and `base44_hosting_dependency` true only in business-backend mode |
| `native` / production | `ios_bundle: com.caremetric.ai`, `android_package: com.caremetic.ai` (preserve this spelling), `apple_store_id: 6757097720` as strings; `physical_signed_ios`, `physical_signed_android`, `signing_continuity`, `launch_login_deep_links`, `camera_microphone`, `downloads_sharing`, `network_recovery`, `purchase_restore`, `entitlements_reconciled` |
| `rollback` / rehearsal | `write_freeze_rehearsed`, `inflight_reconciled`, `target_delta_reconciled`, `prior_artifact_restored`, `records_files_verified`, `single_authority_restored`, `sessions_revalidated` |
| `cutover` / production | `source_writes_frozen`, `inflight_reconciled`, `final_delta_reconciled`, `single_authority`, `source_data_retained`, `rollback_available`, `canary_passed`; `observation_seconds` safe integer at least pinned minimum; `unresolved_errors: 0` |
| `independence` / production | `base44_api_blocked`, `business_workflows_passed`; `base44_execution_calls: 0`, `fallback_calls: 0`; `base44_hosting_dependency` true only in business-backend mode; `permanent_origin_preserved_without_base44_hosting` true only in complete-hosting mode |
| `release_controls` / production | `master_released: false`, `browser_released: false`, `operations: []`, `browser_operations: []` |

Exact ordered isolation arrays:

```json
{
  "positive": ["admin_a:A1", "admin_a:A2", "clinician_a:A1", "admin_b:B1"],
  "negative": ["admin_a:B1", "clinician_a:A2", "clinician_a:B1", "clinician_a_empty:A1", "clinician_a_empty:A2", "clinician_a_empty:B1", "admin_b:A1", "admin_b:A2"]
}
```

All rehearsal receipts must precede or coincide with the cutover receipt.
Final native, endpoint, independence and release-control proof must follow or
coincide with cutover. Production timestamps, zero counts and booleans are
still operator attestations; the checker cannot decide whether their clocks
or instruments were honest. The currently paused release controls stay part
of the expected migration behavior. A future independent integration release
needs its own reviewed acceptance and must not mutate this packet to conceal it.

## Validation and limits

Run `node --test tools-pennsync-cutover.test.mjs`. Tests use explicitly fabricated
in-memory receipts to exercise false-completion cases; none are acceptance
evidence. Covered failures include missing receipts, altered bytes, foreign
builds/deployments, missing capabilities, owner substitution, negative-only
isolation, absent transaction/revocation proof, missing users/files, metadata-only
file assertions, stale sessions, DNS-only rollback, missing physical/native
billing proof, hidden hosting/runtime dependencies, premature releases, unknown
secret fields, duplicate JSON keys, invalid chronology and changed trusted pins.

Archive counts are corroboration only: source/target manifests and checksums must
be reviewed in protected artifacts. Native booleans must be supported by real
signed installed-device and billing/restore runs. A successful offline report
does not create those facts or give the operator permission to delete the source,
remove Base44, upload native binaries, change identities, bypass tenant policy,
or enable external integrations.
