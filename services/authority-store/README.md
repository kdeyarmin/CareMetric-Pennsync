# Independent staging authority store

This is an additive **synthetic staging slice**, not the production authority migration. Each deployment of it serves exactly one Base44 identity namespace, pinned once at migration time and immutable afterwards; an unconfigured deployment pins staging `6a9881683dc68a0bd54f1ef7`. See [Deployment app pin](#deployment-app-pin). It does not call Base44, copy customer data, create real Auth accounts, change production release controls, or modify existing integration/PennTrain tables. It implements independent membership context/selection, a minimal synthetic patient roster, assignment changes and clinician membership revocation. A second migration adds the strictly bounded [S4-create subset](S4_CREATE_SUBSET.md): an atomic synthetic note save and own-receipt lookup. A third adds the [S3 manual referral subset](S3_REFERRAL_SUBSET.md): create and confirm an existing-patient referral, with current authorized read and transaction receipts. These are not complete S3/S4, UI acceptance or production feature selection.

## Storage and privilege boundary

The CLI-created migrations are under `supabase/migrations/`. The first creates six tables in the new, unexposed `pennsync_private` schema and six explicit public RPC wrappers. The S4 subset adds five private tables and two wrappers; S3 adds two private tables and three wrappers. The local archive importer adds a private operator receipt. The [current Visit documentation slice](VISIT_DOCUMENTATION_READ.md) adds one private disclosure audit, stable synthetic assignment UUIDs and one wrapper. The [explicit patient context slice](PATIENT_CONTEXT_READ.md) adds immutable fictional context, a private disclosure audit and one wrapper. All public wrappers are `SECURITY INVOKER`; entry implementations are private `SECURITY DEFINER` functions with empty fixed search paths. Only the thirteen private entry functions receive authenticated execution; internal helpers do not. Every table has RLS enabled and forced, with no allowing policy and no browser CRUD grant. The first migration intentionally refuses an already-existing private schema instead of modifying unknown resources.

Deploy only through a trusted database migration administrator with `SUPERUSER` or `BYPASSRLS`, plus the existing rights required to read/lock Auth user/session rows and access the new private tables. The migration checks that role attribute before creating the schema and refuses an ordinary table owner, which would still be subject to forced RLS. Do not add allowing policies or grant `BYPASSRLS` to application/browser roles to make deployment succeed. All private definer functions must retain that verified administrator owner; hosted owner/grant checks remain required. The Data API must expose `public`, **never `pennsync_private`**. This setting and real hosted role grants still require separate verification before deployment. This package has no deployment command or linked project configuration.

Every RPC validates the actual database role is `authenticated`, the JWT role, `auth.uid()`, token expiry, and the UUID `session_id` against current `auth.sessions`. Native users must have a confirmed email, be nonanonymous, not deleted and not currently banned. Sessions must exist, belong to that exact user, be within `not_after`, and be less than 12 hours old. The 12-hour absolute staging bound is independent of provider refresh/inactivity policy; it requires a new sign-in after expiry. The database relies on the API gateway for JWT signature verification. Local Auth stubs do **not** prove that gateway behavior.

Identity mapping stores the independently corroborated canonical email, source Base44 user ID, evidence SHA-256 and verification timestamp. Auth UUID, legacy identity, email and evidence are immutable; disabling a mapping is terminal in this slice. A source evidence digest records trusted operator provenance, not an automatic proof that an arbitrary supplied mapping is correct. No public mapping/provisioning API exists. Any later fixture loader must independently verify these mappings before inserting them.

All six existing tenant-role names are finite schema values. Only `agency_admin` and `clinician` receive roster behavior in this first slice. Administrators see their agency's synthetic patients; clinicians see active assignments. Other valid roles can obtain context but cannot use the roster yet. No owner exception exists, and the existing protected staging owner's Base44 ID cannot enter this fixture identity map. Mutation endpoints cannot promote users, revoke administrators or self, or change agency identity. Exposed write actions are assignment grant/revoke, clinician-membership revoke and the bounded S4-create subset.

## Deployment app pin

Every app-scoped column is typed `pennsync_private.deployment_app`, a domain that admits exactly the app id this
database serves, and `pennsync_private.actor()` refuses any other app id before it reads anything. Both layers read
the same source: `pennsync_private.deployment`, a single row naming the one app this database is for.

That answer is a generated function, not a row. `20260919090000_deployment_app_pin.sql` reads the database setting
`pennsync.deployment_app_id`, which must be set before migrations run, and generates
`pennsync_private.deployment_app_id()` returning that one constant. It must name an app id present in
`pennsync_private.known_app`; anything else fails the migration rather than producing a store with no containment.
Leaving it unset pins staging, which is the restrictive outcome: a production database whose operator forgot the
setting refuses every production write instead of silently accepting one.

It is a function rather than a row because of restore. A domain CHECK that reads a table cannot survive `pg_restore`:
data is loaded after the schema but in its own order, `agency` comes before `deployment`, and every app-scoped row
would be checked against a pin that has not loaded yet and refused. As a constant the pin is part of the schema,
restored before any data, and the CHECK is genuinely IMMUTABLE rather than merely unchanging in practice. Changing it
afterwards means `CREATE OR REPLACE` by the function's owner -- the same trusted migration administrator who could
alter the domain directly -- so nothing is given away by holding it there.

`pennsync_private.deployment` remains as the dated record: the pinned app, whether it was chosen or defaulted
(`source`), and when. It is constrained to equal `deployment_app_id()`, so it cannot drift from what it records, and
it cannot be updated, deleted or truncated.

It is a database setting, not an environment variable, so it is not in `.env.example`. On the target project, before the migrations run:

```sql
alter database postgres set pennsync.deployment_app_id = '<app id>';
```

The registry is deliberately short. The retired app `68ee80d98929370f9e8f2932` is absent from it, so no deployment can
be pointed at that namespace even on purpose. Widening past staging and production means adding a row to
`known_app` in a reviewed migration.

This pin governs the namespace only. The synthetic-shape constraints -- agency and patient names must begin
`Synthetic `, and `patient.synthetic` must hold -- are a separate control and still apply in every deployment, so a
production-pinned database can carry enrolled identities and still cannot hold a real name.

The RPC surface is staging-only for the same reason. Every response documented below states
`contract: cm.pennsync.*.staging.v1`, `staging: true` and `synthetic: true`, and those claims are only true in the
staging deployment. Rather than relabel eighteen response builders and claim a port that has not happened,
`actor()` refuses outright when the pinned deployment is not staging (`PENNSYNC_STAGING_RPC_SURFACE_ONLY`, SQLSTATE
`42501`). It is the first call on every read and mutation path, so one guard covers all of them. A production
deployment is therefore writable by the migration administrator -- which is how an operator enrollment tool creates
identity, agency and membership rows -- and serves no RPC until each contract is revised under its own review.

## Enrollment

Identity rows are not created by any RPC. `tools-pennsync-enroll.mjs` at the repository root writes them, run by a
trusted operator against a database they already administer, from a plan addressed by its own SHA-256.

The plan names the app id it is for, the agencies it establishes, and for each person their Auth UUID, Base44 user id,
canonical address, the path to the operator's corroborating document and that document's digest. The tool reads the
document and hashes it; a declared digest that does not match the bytes is refused, so `source_evidence_sha256` records
provenance the operator actually held. It then verifies against the database that the native account already exists,
is confirmed, is neither anonymous nor deleted nor banned, and carries exactly the address the plan claims. It creates
no native account: a person who has not accepted their own invitation cannot be enrolled on their behalf.

Writes happen in one transaction under the same advisory lock the authority RPCs take, in the same order: agencies,
identities, memberships, receipt. A row that already exists must match the plan exactly -- identity provenance is
immutable by trigger, so a differing plan is a contradiction, not an update -- which makes a superset plan safe to run
after a smaller one. The plan's app id must equal the deployment pin, so nobody can enroll production identities into
the staging database. Every run is recorded in the append-only `pennsync_private.enrollment_receipt`: the plan digest,
a digest of what was written, the three counts, the database name and the operator role. Applying the same plan twice
fails on that receipt.

The CLI reads `PENNSYNC_ENROLL_DATABASE_URL`, `PENNSYNC_ENROLL_PLAN`, `PENNSYNC_ENROLL_PLAN_SHA256` and
`PENNSYNC_ENROLL_EVIDENCE_DIR`, and prints the receipt. No diagnostic carries an address, a name or any plan content.

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
| `patient_context` | `p_app_id`, `p_agency_id`, `p_patient_id`, `p_purpose` (`display` or `smart_note_context`); explicit stored fictional fields with mandatory disclosure audit |
| `visit_documentation` | `p_app_id`, `p_agency_id`, `p_visit_id` (UUID); current-authority, audited synthetic S4 documentation only |
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
node --test services/authority-store/tests/visit-documentation-postgres.test.mjs
node --test services/authority-store/tests/patient-context-postgres.test.mjs
```

Eight authority multi-session tests observe real advisory/row lock waits and verify duplicate single-winner behavior, same-request replay, both orderings of assignment versus revocation, native session deletion, revoked-admin replay, target native banning and target identity revocation. S4 adds ten artifact/transaction tests and S3 adds ten referral/transaction tests, described in their subset contracts. Current Visit documentation adds eighteen scope, audit, provenance, size and concurrency cases; explicit patient context adds sixteen. Run the suites sequentially so the initial local Auth-role setup cannot race across files; each suite still uses concurrent native connections internally. S3, Visit documentation and patient context require those local test roles to exist before creating their own generated database. Every suite uses a separately generated database name; no customer database is involved. Missing connection configuration fails rather than silently skipping these suites.

`tests/bootstrap.sql` and `tests/fixtures.sql` are **local Auth test doubles only**. They must never be deployed to Supabase or used to manufacture real Auth user/session rows. A real hosted rehearsal must create users through the supported Auth API in an isolated product boundary, retain independent signed-session proof, and verify hosted privileges and exposed schemas. The shared CareMetric Train Auth tenant must not be used merely because it is available; its existing provisioning triggers require a separate access-boundary review.

The migration and local SQL tests passed against PostgreSQL 17.10 and PGlite. Supabase CLI 2.109.1 security advisors also returned no warning/error findings against an empty disposable local database with this schema (`--db-url` with local `sslmode=disable`, `--type security --level warn --fail-on error`). The initial CLI connection without explicit local SSL mode failed and was not counted as an advisor pass. The base authority and S4 Docker-backed CI suites passed actual local Auth password login, signed sessions and HTTP/PostgREST acceptance. The additional S3 HTTP checks need their own successful Docker-backed run; see `tests/http-acceptance.md`. No hosted enrollment/migration, customer patient-data migration, production cutover or full clinical workflow completion is claimed here.

References checked during implementation: [Supabase session lifecycle](https://supabase.com/docs/guides/auth/sessions), [database functions](https://supabase.com/docs/guides/database/functions), [PostgreSQL locking](https://www.postgresql.org/docs/17/explicit-locking.html), [PGlite connection limitation](https://pglite.dev/docs/), [node-postgres transactions](https://node-postgres.com/features/transactions). The current Supabase changelog was inspected; no extension, Realtime-schema, Auth-provider or Management-log breaking change was needed by this SQL-only slice.

## Provisioning a new deployment

The pin is decided once, before the first migration runs, and cannot be edited
afterwards: a mis-pinned database is replaced, not corrected (D11). Done by
hand that is a single irreversible step with no second chance, so
`tools-pennsync-provision.mjs` does it as a checked sequence:

1. refuse an app no deployment may serve — including the retired PennSync app,
   which is absent from `known_app` on purpose — before anything is created;
2. refuse a database that already holds `pennsync_private`, so a second run
   cannot half-migrate a live store or repoint one at another app;
3. set `pennsync.deployment_app_id`;
4. read it back **from a new session** and stop if it did not stick;
5. only then apply the migrations, in name order;
6. prove the store came out pinned where it was asked, and that
   `pennsync_private.deployment.source` says `setting` rather than `default`.

Step 4 is the one that earns the tool. `alter database ... set` only reaches
sessions opened after it, so a run that trusts its own write can migrate
against the default — producing a store quietly pinned to **staging** while its
operator believes it is production, discovered only when production writes
start failing. `provision.test.mjs` pins that case: with the read-back
unconfirmed, not one migration is allowed to run.

A further test reads the app ids straight out of
`20260919090000_deployment_app_pin.sql` and fails if the tool's list and the
store's `known_app` ever disagree, so this cannot pin a database the migration
would then refuse.

Run it as the operator once the project exists:

```bash
PENNSYNC_PROVISION_DATABASE_URL=postgres://… \
PENNSYNC_PROVISION_APP_ID=694ec16e72e01b60d22f7cbf \
  node tools-pennsync-provision.mjs
```

The app id is checked before a connection is opened, so a typo never reaches a
database, and diagnostics carry error codes only — never the connection
string. `session` opens a genuinely new connection each time, which is what
makes the pin read-back mean anything.

What it does not do: it creates no hosted project, holds no credential, and
writes no row. Enrolling anyone is `tools-pennsync-enroll.mjs`, and that needs
the people to have accepted their Supabase Auth invitations first.

## The record store and its owner

`supabase/record-migrations/20260919170000_record_store.sql` creates
`pennsync_records`: the 156 carried entities, with forced row level security
and the 596 policies derived from their tenant paths and decisions (D13, D14).
It is **generated** — regenerate with
`node tools-entity-schema-plan.mjs --write-migration` and never edit the SQL by
hand; a test fails if the committed file and the generator disagree.

It sits in its own directory rather than beside the authority migrations, and
that is deliberate. `supabase/migrations/` is applied wholesale by every
authority harness — the disposable local stack the acceptance jobs bring up,
and the restore rehearsal, whose hand-reviewed fixture enumerates every table
it expects to find. None of them exercises a record table, so putting 156
generated tables there makes each one build and inventory a store it does not
use, and turns a reviewable fixture into 2,404 columns nobody can read. They
are two stores in any case: different schemas, different owners, created at
different times. `tools-pennsync-provision.mjs` applies the authority
directory and then this one, so a real deployment still gets both.

Two properties of the file are the decision it carries (D15), not incidental:

**The tables are owned by `pennsync_records_owner`, which holds neither
`SUPERUSER` nor `BYPASSRLS`.** `force row level security` binds a table's owner
— but never a role with either attribute, and every migration here requires
exactly such an administrator. Under the administrator the 596 policies would
be decorative. The migration creates the role if it is absent, and refuses
outright (`PENNSYNC_RECORD_OWNER_MUST_NOT_BYPASS_RLS`) if a role of that name
already exists carrying either attribute, rather than adopting it and emitting
policies nothing obeys.

Creating that role is not the same as being able to act as it. Since
PostgreSQL 16 a `CREATEROLE` administrator that creates a role receives
`ADMIN OPTION` but neither `INHERIT` nor `SET`, so `create schema …
authorization` refuses with *must be able to SET ROLE* — which is exactly what
a non-superuser deployment role such as Supabase's `postgres` hits, while a
superuser never does. The migration asks for `SET` explicitly and then proves
it by performing the `SET ROLE`, rather than trusting a catalog answer whose
privilege names differ between versions. A role it cannot obtain that grant
for raises `PENNSYNC_RECORD_OWNER_NOT_ASSUMABLE`, and one it cannot create at
all (`BYPASSRLS` does not carry `CREATEROLE`) raises
`PENNSYNC_RECORD_OWNER_NOT_CREATABLE`. It also refuses a database with no authority store to
ask (`PENNSYNC_AUTHORITY_STORE_REQUIRED`), because every policy is written in
terms of `pennsync_private`.

**No caller role is granted anything — not a table, not a helper.** RLS policy
expressions are evaluated with the privileges of the role running the query, so
a caller granted direct table access would also need `EXECUTE` on the caller
helpers, which answer *who is asking* and are revoked from `authenticated` for
that reason. The record owner may execute them; `anon`, `authenticated` and
`service_role` may do nothing at all.

So a caller reaches a row only through a `SECURITY DEFINER` broker owned by
`pennsync_records_owner`. Inside such a broker `current_user` becomes the owner
— so the policies bind and the helpers are callable — while the `role` setting
still reads `authenticated`, which is what `pennsync_private.actor()` requires
before it will name an identity. A broker that runs as anything else either
bypasses the policies (if it bypasses RLS) or is refused by the caller gate.

`tests/record-store-migration.test.mjs` applies the committed migration and
holds each of those properties, including that the owner is filtered by its own
policies and that a cross-tenant write through a broker is still refused.

What it does not do: applying it needs the production Supabase project. The
broker in that test exists to prove the boundary, not to be the family.

## The broker family

`record-migrations/20260919180000_record_brokers.sql` is the family, and the
only bridge across that empty grant set. Five operations — `list`, `get`,
`insert`, `update`, `delete` — over a generated allowlist of the entities
dispositioned `broker`, owned by `pennsync_records_owner` and SECURITY DEFINER,
so `current_user` becomes the owner (the policies bind, the caller helpers are
callable) while the `role` setting still reads `authenticated` (the caller gate
still recognises the session).

It grants `authenticated` USAGE on the schema and EXECUTE on those five
functions. Nothing else — not the allowlist, not the scope gate, not the payload
check, and never a table. SECURITY INVOKER wrappers in `public` keep it
reachable over PostgREST without the project exposing `pennsync_records`, which
is the shape the authority store's own RPC surface already has.

Two properties it is worth stating plainly:

- **A broker stamps tenancy; it never reads it from a payload.** `agency_id`,
  `source_app_id`, `id`, the platform timestamps, `created_by` and a `self`
  table's subject are set by the broker from the caller's verified identity. A
  payload naming one of them is refused rather than stripped. The agency is
  still a parameter — a caller may hold several — and it is checked against
  `caller_agencies()`, the membership roster, not against the request.
- **A broker never re-implements a policy.** It narrows a read to the one agency
  the request named and refuses to write reference data. Every other question of
  who may see what stays in the 596 policies.

Generated, not written: change the dispositions, the tenant decisions or
`tools-record-brokers.mjs` and re-run `node tools-record-brokers.mjs --write`.
It writes the SQL and the service's copy of the allowlist together, refuses to
run while any brokered entity fails D16's ceiling, and `check:record-brokers`
fails if either committed file has drifted.

`tests/record-brokers.test.mjs` applies the real migration on top of the real
record store and holds eighteen cases. The one worth knowing about gives a
single fixture caller two real memberships: with one membership each, RLS alone
produces the right answer, so a broker that dropped its narrowing would pass
every other case in the file.

This too creates nothing anywhere: applying it needs the production Supabase
project. And it serves **three** entities, all read-only — every clinical table
is deliberately outside it, and so is almost everything else. The allowlist was
31 until D22 taught the ceiling to read each schema's own `rls` block, which is
the platform's own statement of what a client may do to a table: 28 of the 31
declare an authority decision a generic family cannot evaluate, and `false`
there means no client may touch the rows at all. Restoring one takes a schema
that permits the read, not an edit to the allowlist — the generator refuses to
run while any allowlisted entity fails the ceiling.

## Per-capability contracts

The 28 that left the family, and the 125 clinical tables that were never in it,
are reached by a reviewed contract instead: one endpoint, one authorization,
owned by `pennsync_records_owner` and SECURITY DEFINER so the policies bind it
exactly as they bind a broker. A contract is **hand-written**, because it exists
precisely when a capability's authorization is its own and there is nothing to
generate from. Each keeps that authorization in SQL —
`services/pennsync-api/record-contracts.mjs` carries none, deliberately, so
there is no second answer to keep in agreement with the database's — projects
named columns rather than returning a row, adds no tenant predicate the policies
already enforce, and needs a test proving its refusals against the real
migration. Any divergence from the Base44 original must be a narrowing and must
be recorded in the file.

| Migration | Capability |
| --- | --- |
| `20260920000000_contract_policy_library.sql` | `listPolicyLibrary`. D19's worked example: it returns `doc_url`, the locator that keeps `PolicyLibrary` out of the family, and decides about the CALLER — drafts and archived go only to an administrator |
| `20260920010000_activity_audit.sql` | The general activity trail (D25). Append-only by absence: an insert policy and a read policy and no update or delete policy at all, so forced RLS refuses a rewrite from everyone including the record owner. A facility rather than an endpoint, reached through `services/pennsync-api/audit.mjs` |
| `20260920030000_contract_roster.sql` | `listAgencyRoster` / `getAgencyRosterMember` (D23). The authority store's membership is the FROM clause and the carried profile row contributes only what that store has no column for |
| `20260920050000_patient_purpose_policy.sql` | Not a contract: the authorized-patient purpose policies as pure functions, with no authorization in them at all. Generated by `node tools-read-purpose-policy.mjs --write` from the fenced blocks in the originals, because thirty-eight field lists across six capabilities are data and retyping them is the transcription D12 settled against |
| `20260920060000_contract_patient_read.sql` | `listAuthorizedPatients` (page and id-batch modes) and `getAuthorizedPatient` (D26). The first ported capabilities that read clinical rows. Which ROWS is the policies' answer — tenancy plus D24's chart narrowing; which FIELDS and to whom is the purpose's, and the two vocabularies are kept apart so a list caller cannot reach a single-chart projection |
| `20260920070000_visit_purpose_policy.sql` | The same, for the visit pair |
| `20260920080000_contract_visit_read.sql` | `listAuthorizedVisits` and `getAuthorizedVisit`. `visit` carries its own `agency_id` AND a `patient_id`, so D24 wrote the narrowing onto the table: a visit whose subject is null stays agency-scoped, because a visit with no patient is not yet anybody's chart. The two capabilities share three purpose NAMES and mean different projections — `compliance_review` is fourteen fields on one visit and eight on a row of a list — so each asks its own |
| `20260920090000_document_purpose_policy.sql` | The same, for the document pair |
| `20260920100000_contract_document_read.sql` | `listAuthorizedDocuments` and `getAuthorizedDocument` (D27). A `document` has no `agency_id`: `document_tenant_binding` carries it, so both the policy and these contracts read FROM the binding, and a document with no binding is in no tenant. No purpose discloses a file locator — not even `download` — which is why this family ports before the file layer rather than after it |
| `20260920110000_claim_new_chart.sql` | Not a contract and not a record-store object: the cross-store bridge (D28). `pennsync_claim_new_chart(agency)` mints a chart identity and takes the caller's own care-team seat, so that a creator can open what they created — creating a chart and being on its care team are writes to two owners. It takes an agency and nothing else, because a caller who could name the id would name a chart that already exists. It has no public wrapper and answers to the record owner alone, since its only caller is the contract below. Here rather than in the authority directory by dependency order: it asks `caller_tenant_role` |
| `20260920120000_contract_patient_create.sql` | `createAuthorizedPatient` (D28). The first ported capability that WRITES a clinical row: it claims the chart and inserts it in **one transaction**, so a clinician can open what they created. The 43 fields a client may supply are extracted from the original's own `CLIENT_PATIENT_FIELDS`; identity, tenancy, provenance and lifecycle are the contract's, and a payload naming one is refused rather than ignored |

Each one refuses a database without `caller_tenant_role`, so they apply after
the record store; `tests/provision.test.mjs` asserts that order for every file
in the directory. `caller_tenant_role(agency)` exists for contracts only: no
policy may ask it, and it is granted to the record owner alone.
