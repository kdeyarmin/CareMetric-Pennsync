# Independent staging authority store

This is an additive **synthetic staging slice**, not the production authority migration. It is fixed to Base44 staging identity namespace `6a9881683dc68a0bd54f1ef7`. It does not call Base44, copy customer data, create real Auth accounts, change production release controls, or modify existing integration/PennTrain tables. It implements independent membership context/selection, a minimal synthetic patient roster, assignment changes and clinician membership revocation. A second migration adds the strictly bounded [S4-create subset](S4_CREATE_SUBSET.md): an atomic synthetic note save and own-receipt lookup. A third adds the [S3 manual referral subset](S3_REFERRAL_SUBSET.md): create and confirm an existing-patient referral, with current authorized read and transaction receipts. These are not complete S3/S4, UI acceptance or production feature selection.

## Storage and privilege boundary

The CLI-created migrations are under `supabase/migrations/`. The first creates six tables in the new, unexposed `pennsync_private` schema and six explicit public RPC wrappers. The S4 subset adds five private tables and two wrappers; S3 adds two private tables and three wrappers. All public wrappers are `SECURITY INVOKER`; entry implementations are private `SECURITY DEFINER` functions with empty fixed search paths. Only the eleven private entry functions receive authenticated execution; internal helpers do not. Every table has RLS enabled and forced, with no allowing policy and no browser CRUD grant. The first migration intentionally refuses an already-existing private schema instead of modifying unknown resources.

Deploy only through a trusted database migration administrator with `SUPERUSER` or `BYPASSRLS`, plus the existing rights required to read/lock Auth user/session rows and access the new private tables. The migration checks that role attribute before creating the schema and refuses an ordinary table owner, which would still be subject to forced RLS. Do not add allowing policies or grant `BYPASSRLS` to application/browser roles to make deployment succeed. All private definer functions must retain that verified administrator owner; hosted owner/grant checks remain required. The Data API must expose `public`, **never `pennsync_private`**. This setting and real hosted role grants still require separate verification before deployment. This package has no deployment command or linked project configuration.

Every RPC validates the actual database role is `authenticated`, the JWT role, `auth.uid()`, token expiry, and the UUID `session_id` against current `auth.sessions`. Native users must have a confirmed email, be nonanonymous, not deleted and not currently banned. Sessions must exist, belong to that exact user, be within `not_after`, and be less than 12 hours old. The 12-hour absolute staging bound is independent of provider refresh/inactivity policy; it requires a new sign-in after expiry. The database relies on the API gateway for JWT signature verification. Local Auth stubs do **not** prove that gateway behavior.

Identity mapping stores the independently corroborated canonical email, source Base44 user ID, evidence SHA-256 and verification timestamp. Auth UUID, legacy identity, email and evidence are immutable; disabling a mapping is terminal in this slice. A source evidence digest records trusted operator provenance, not an automatic proof that an arbitrary supplied mapping is correct. No public mapping/provisioning API exists. Any later fixture loader must independently verify these mappings before inserting them.

All six existing tenant-role names are finite schema values. Only `agency_admin` and `clinician` receive roster behavior in this first slice. Administrators see their agency's synthetic patients; clinicians see active assignments. Other valid roles can obtain context but cannot use the roster yet. No owner exception exists, and the existing protected staging owner's Base44 ID cannot enter this fixture identity map. Mutation endpoints cannot promote users, revoke administrators or self, or change agency identity. Exposed write actions are assignment grant/revoke, clinician-membership revoke and the bounded S4-create subset.

## Transaction and replay behavior

All calls require READ COMMITTED. A fixed application advisory lock is shared for reads and exclusive for writes; it is deliberately broad for a small staging fixture and is not a throughput claim. The common acquisition order is app lock, caller native user/session and identity, agency and actor membership, then target membership, patient/assignment and target identity/native checks as needed, followed by the receipt. Current native rows are held `FOR SHARE` until transaction completion. Operations through this API serialize with revocation. Trusted manual maintenance must use the same app lock and avoid unscheduled direct mutations.

Unique keys prevent duplicate identity/membership/assignment bindings. Mutations require actor, target and assignment versions. The result and complete typed payload are durably stored in the same transaction under `(app_id, actor_id, request_id)`. Exact replays check live actor authority, payload equality and current target/result state before returning. A changed payload or stale result fails; it cannot resurrect a revoked assignment. Membership revocation updates all active assignments and its receipt in the same transaction. A receipt failure rolls everything back.

## RPC interface

All names have the `public.pennsync_staging_` prefix. IDs are canonical text matching `[A-Za-z0-9_-]{1,128}`; existing Base44 record IDs remain usable. Auth user/session and request identifiers are UUIDs. Every response binds `contract: cm.pennsync.authority.staging.v1`, `staging: true`, `synthetic: true`, `app_id` and `auth_user_id`.

| Suffix | Parameters |
| --- | --- |
| `context` | `p_app_id`, `p_agency_id` |
| `memberships` | `p_app_id` |
| `patients` | `p_app_id`, `p_agency_id`, `p_limit` (1–100, default 50), `p_after_id` (default null) |
| `patient` | `p_app_id`, `p_agency_id`, `p_patient_id` |
| `assignment` | `p_app_id`, `p_agency_id`, `p_patient_id`, `p_target_membership_id`, `p_action` (`grant`/`revoke`), `p_expected_actor_version`, `p_expected_target_version`, `p_expected_assignment_version` (0 means absent), `p_request_id` |
| `revoke_membership` | `p_app_id`, `p_agency_id`, `p_target_membership_id`, `p_expected_actor_version`, `p_expected_target_version`, `p_request_id` |

Context uses the legacy `src/lib/roles.js` fields, including `user_id`, `user_email`, exact `agency_id:user_id` membership key, membership ID/version/status and `is_platform_owner: false`. It also includes independent `auth_user_id` and `identity_version`. Membership list returns `memberships: [context, ...]`, bounded to 50 and rejecting saturation. Patient list returns `context`, `items`, and `next_cursor`; an unknown, foreign or inaccessible cursor is rejected. Get returns `context` and `patient`.

Patient projections intentionally contain only `id`, `agency_id`, `display_name`, `version`, and `synthetic: true`. They are not full chart payloads. Names must begin `Synthetic `; no generic entity CRUD exists. S4 additionally requires current patient status active; existing roster projections remain unchanged. S4 uses its own response contract, documented in its scope file. Mutation results include the exact action, request ID, returned state/version and `replayed` flag. The assignment action names in results are `grant_assignment` and `revoke_assignment`; membership revocation uses `revoke_membership`.

SQLSTATEs preserve failure categories: `28000` session/native identity failures, `42501` permission/scope failures, `22023` invalid input, `PT409` stale authority/version/result, and `23505` mismatched idempotency binding. `PT409` maps to HTTP 409 in PostgREST. These deterministic business conflicts must not use `40001` (serialization failure): PostgREST 14.14's Hasql transaction runner retries that code, repeating a conflict that cannot succeed without new caller input. Native PostgreSQL serialization failures retain their normal code and transaction semantics. No lock, live-authority check, optimistic version check, receipt binding or rollback boundary is relaxed. No exception interpolates a user name, email, patient content or credential.

The local HTTP suite asserts exact 409/`PT409` responses, prompt completion, unchanged assignment/receipt state after conflict, and rejection of stale replay. The retry behavior is defined by [PostgREST MainTx](https://github.com/PostgREST/postgrest/blob/v14.14/src/PostgREST/MainTx.hs), its [Hasql dependency](https://github.com/PostgREST/postgrest/blob/v14.14/postgrest.cabal), and [Hasql's retry loop](https://github.com/nikita-volkov/hasql-transaction/blob/1.0.1/library/Hasql/Transaction/Private/Sessions.hs); [PostgREST's error mapping](https://github.com/PostgREST/postgrest/blob/v14.14/src/PostgREST/Error.hs) handles `PT` status codes.

## Reproducible local validation

From the repository root, install only the isolated service dependencies; its lockfile pins PGlite 0.5.8 and node-postgres 8.23.0:

```sh
pnpm --dir services/authority-store install --ignore-workspace --frozen-lockfile
node --test services/authority-store/tests/authority.test.mjs services/authority-store/tests/s4.test.mjs services/authority-store/tests/s3.test.mjs
```

This runs 22 authority, 16 S4 and 12 S3 executable PostgreSQL/PGlite scenarios, including refusal of an unsuitable migration owner before any authority schema is created. Each uses a fresh transaction and rolls back the synthetic fixture. Coverage includes role/tenant/assignment scope, native identity/session failures, cursor validation, immutable source mapping, uniqueness/foreign keys, current-state replay, failure rollback, service-role exclusion and defensive RLS after an accidental table grant. PGlite is single-connection; these tests alone do not prove concurrency.

For the real PostgreSQL suite, provide an explicit local test administrator URL with `/postgres`. Only loopback hosts are accepted; remote URLs and arbitrary database names are rejected. Example PowerShell invocation for the isolated local lab:

```powershell
$env:PENNSYNC_TEST_PG_URL='postgresql://postgres@127.0.0.1:54339/postgres'
node --test services/authority-store/tests/postgres.test.mjs
node --test services/authority-store/tests/s4-postgres.test.mjs
node --test services/authority-store/tests/s3-postgres.test.mjs
```

Eight authority multi-session tests observe real advisory/row lock waits and verify duplicate single-winner behavior, same-request replay, both orderings of assignment versus revocation, native session deletion, revoked-admin replay, target native banning and target identity revocation. S4 adds nine artifact/transaction tests and S3 adds ten referral/transaction tests, described in their subset contracts. Run the suites sequentially so the initial local Auth-role setup cannot race across files; each suite still uses concurrent native connections internally. S3 requires those local test roles to exist before creating its own generated database. Every suite uses a separately generated database name; no customer database is involved. Missing connection configuration fails rather than silently skipping these suites.

`tests/bootstrap.sql` and `tests/fixtures.sql` are **local Auth test doubles only**. They must never be deployed to Supabase or used to manufacture real Auth user/session rows. A real hosted rehearsal must create users through the supported Auth API in an isolated product boundary, retain independent signed-session proof, and verify hosted privileges and exposed schemas. The shared CareMetric Train Auth tenant must not be used merely because it is available; its existing provisioning triggers require a separate access-boundary review.

The migration and local SQL tests passed against PostgreSQL 17.10 and PGlite. Supabase CLI 2.109.1 security advisors also returned no warning/error findings against an empty disposable local database with this schema (`--db-url` with local `sslmode=disable`, `--type security --level warn --fail-on error`). The initial CLI connection without explicit local SSL mode failed and was not counted as an advisor pass. The base authority and S4 Docker-backed CI suites passed actual local Auth password login, signed sessions and HTTP/PostgREST acceptance. The additional S3 HTTP checks need their own successful Docker-backed run; see `tests/http-acceptance.md`. No hosted enrollment/migration, customer patient-data migration, production cutover or full clinical workflow completion is claimed here.

References checked during implementation: [Supabase session lifecycle](https://supabase.com/docs/guides/auth/sessions), [database functions](https://supabase.com/docs/guides/database/functions), [PostgreSQL locking](https://www.postgresql.org/docs/17/explicit-locking.html), [PGlite connection limitation](https://pglite.dev/docs/), [node-postgres transactions](https://node-postgres.com/features/transactions). The current Supabase changelog was inspected; no extension, Realtime-schema, Auth-provider or Management-log breaking change was needed by this SQL-only slice.
