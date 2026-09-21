# Railway go-live: measured state and the remaining plan

Date: 2026-09-21
Status: a live-probe assessment and the plan that follows from it. Like
[the transition plan](BASE44_TO_RAILWAY_TRANSITION_PLAN_2026-09-19.md) it
authorizes nothing: every hosted change below still needs its own review, cost
approval, evidence and release-owner sign-off under
`docs/REPOSITORY_CONSOLIDATION_2026-09-02.md` and
`docs/PENNSYNC_EXTERNAL_CUTOVER_EVIDENCE.md`.

## 0. The answer: no, and the distance is not where the documents suggest

The app is **not live on Railway**. One of the two Railway services is
deployed and it is deliberately serving nothing; the other has never been
created. Every user request today is still answered by Base44.

Probed 2026-09-21:

| Probe | Result | Reading |
| --- | --- | --- |
| `pennsync-integrations-production.up.railway.app/healthz` | `{"status":"alive","release":"paused","revision":"cffe376…"}` | Deployed and healthy, released to nobody |
| same host `/readyz` | HTTP 503; `released:false`, `operations:[]`, `authorityMode:"base44"`, `base44ExecutionDependency:true`, `trafficCutoverVerified:false`, `browserReleased:false` | Zero of seven brokered operations enabled; still asks Base44 who the caller is |
| `pennsync-api-production.up.railway.app/healthz` | HTTP 404, `Application not found` | The service does not exist |
| `app.caremetricai.com/` | HTTP 200 | Base44 |
| `caremetricai.base44.app/` | HTTP 200 | Base44 |
| Supabase account project list | `CM Train`, `caremetric-pennsync-staging`, `PennPaps`, `CareMetric Support Hub`, `bolt-native-database-62871816` | **No production project** |
| `caremetric-pennsync-staging` migration list | 9 versions, newest `20260918204105` | Five authority migrations behind; **no record store at all**. **Closed later the same day: 59 applied, 68 recorded — see stage A** |
| `node tools-pennsync-cutover.mjs --check` | `status: blocked`, `PINNED_INPUTS_REQUIRED`, `release_authorized:false` | None of the 15 gates has a receipt |
| `pnpm run check:base44-surface` | `client_importers=366/366 entity_call_sites=445/445 core_integration_sites=41/41 function_wrappers=83/83` | The frontend has not moved one call site |

The deployed runtime revision `cffe376` is two commits behind `origin/main`
(`4f73ec6`) — it predates PR #228 and PR #229 entirely.

## 1. The gap that actually matters: built is not deployed

The source work is far along and the hosted work has barely started. That
distinction is the whole plan, and it is easy to lose because the transition
plan's status table reads as progress without saying where the progress lives.

| Artifact | Built | Applied or deployed anywhere hosted |
| --- | ---: | ---: |
| Authority store migrations | 15 | ~~9~~ **14** (one is deliberately never hosted) — applied 2026-09-21 |
| Record store migrations (store, brokers, 51 contracts, purpose policies, file map) | 54 | ~~0~~ **54** — applied 2026-09-21 |
| Ported handlers registered in `services/pennsync-api/handlers.mjs` | 74 | **0** |
| Railway services | 2 defined | 1 deployed, paused; 1 never created |
| Frontend call sites moved off Base44 | 0 of 445 | 0 |

Everything merged in PRs #227, #228 and #229 — the record store, the care-team
narrowing, the audit trail and seventy-two ported capabilities — has been proved
only against PGlite and ephemeral local PostgreSQL. **It has never been applied
to a hosted database and has never served a request.** The suites are real and
they pass; what they do not establish is that the migration chain applies in
order to a Supabase project, that the role and grant model survives contact with
Supabase's own roles, or that a handler answers over HTTP with a real JWT.

The port queue, measured today rather than quoted:

```
port queue: entity_not_carried=7 entity_authorization=8 files=12
            core_integration=3 external_secret=2 none=72
```

104 carried capabilities, 72 written, 32 blocked. **No blocker in that list is
the record store, and none is another port.** The remaining 32 need a decision,
the file layer, a brokered send, or a new brokered operation — not more schema.

## 2. The critical path

Six things gate everything else, in this order. Only the first is free.

1. ~~**Apply what is already committed to the staging project.**~~ **Done
   2026-09-21**: all 59 outstanding migrations applied to
   `caremetric-pennsync-staging`, 68 recorded in the ledger, the pin landed on
   staging with `source 'default'`. The 54 record migrations are no longer
   unproven against a hosted database; the 74 handlers still are, because
   nothing has served a request yet — that is stage B.
2. **Create the `pennsync-api` Railway service**, deployed paused, exactly as the
   integration runtime was.
3. **Enroll real people.** Ten Supabase Auth invitations accepted and verified
   out of band. Nothing downstream of authority can be proved with four
   synthetic actors.
4. **Create the production Supabase project** (D4) and provision it with
   `tools-pennsync-provision.mjs`, the one path that tool was written for.
5. **Move the frontend.** 445 entity call sites, 366 client importers, 41 Core
   integration sites, 83 function wrappers — untouched. This is now the largest
   single body of remaining work in the migration and the least started.
6. **Assemble the evidence packet** until `tools-pennsync-cutover.mjs` reports
   `evidence_coverage_complete`.

Everything else parallelizes around these.

## 3. Stages

Each stage names its deliverable, its exit criterion, and who has to unblock it.
Sizes assume the current cadence; they are estimates, not commitments.

### Stage A — Prove the committed store on hosted staging (size S, days; no approval needed)

The cheapest and most overdue step in the migration, and the only one on the
critical path that needs nothing from anybody.

- Apply the five missing authority migrations to `caremetric-pennsync-staging`:
  `20260919090000_deployment_app_pin`, `20260919114500_enrollment_receipt`,
  `20260920040000_chart_assignment`, `20260920180000_chart_assignment_lifecycle`,
  `20260920200000_membership_lifecycle`. The app pin goes first; unset it
  defaults to staging, which is the correct outcome for this project, but the
  `deployment` row should record that it was *chosen*.
- Then apply all 54 `supabase/record-migrations/` files, in order.
  `tools-pennsync-provision.mjs` cannot do this — it refuses a database that
  already holds `pennsync_private` (`PROVISION_STORE_ALREADY_PRESENT`), by
  design, because re-provisioning would try to re-pin an immutable pin.
- **The tool for it now exists**: `tools-pennsync-migrate.mjs`, the mirror of
  the provisioner. It refuses a database with no store, refuses a
  half-provisioned one, reconciles what has run BY NAME against the Supabase
  ledger, refuses a sequence with a hole in it, applies the pending set in the
  provisioner's own order, and re-reads the pin afterwards to prove nothing
  moved it. It plans by default and applies only with `--apply`:

  ```sh
  PENNSYNC_MIGRATE_DATABASE_URL=… node tools-pennsync-migrate.mjs           # plan
  PENNSYNC_MIGRATE_DATABASE_URL=… node tools-pennsync-migrate.mjs --apply   # run
  ```

  Two things it encodes that were previously prose only. Migrations are
  matched on NAME, because the hosted project's versions were stamped by the
  CLI at push time and do not match the repository's file prefixes — matching
  on version would report every applied migration as pending and re-run the
  lot. And `synthetic_archive_patient_import` is held back explicitly, with
  its reason, in `LOCAL_ONLY_MIGRATIONS`: the hosted project was built without
  it deliberately, that fact lived in one sentence of the transition plan, and
  a tool applying "everything pending" would have installed it on the next run
  with nothing to complain.
- **The plan has now been run against the real target, read-only**, and it is
  the documented gap exactly: **9 applied, 59 pending, 1 skipped** with its
  reason, and `deployment_pin_pending: true` — the pin migration is the first
  thing pending, which is what made judging the pin before reading the ledger
  refuse this database. `mutated: false`; nothing was written.
- **A second transport had to exist before that plan could be run at all, and
  that is a finding rather than a convenience.** From this container — and from
  any runner allowed outbound HTTPS and nothing else, which includes CI here —
  the database is not reachable on its own protocol: `db.<ref>.supabase.co`
  does not resolve, because Supabase's direct host is IPv6-only, and both
  poolers time out on TCP 5432 and 6543. The management query endpoint runs as
  `postgres` over ordinary HTTPS and is reachable. So
  `tools-pennsync-supabase-db.mjs` speaks the migrate tool's `db` interface
  over that endpoint, chosen by URL scheme — `supabase://<project-ref>`, with
  the token in the environment rather than the URL, so it cannot reach a log
  line or a shell history.

  It carries statements and decides nothing. Three of its properties are
  refusals rather than conventions, because the endpoint is *not* a connection
  and behaves like one until it matters. It takes no parameters, since dropping
  them would send a literal `$1`. It refuses a body that would end with a
  transaction still open, because every POST is its own connection while
  `applyMigrations` depends on the migration and its ledger row committing
  together. And it never re-sends a write: a request that times out after the
  server committed is indistinguishable from one that never arrived, so
  recovery is to run the tool again — which is safe for exactly the reason the
  ledger row sits inside the transaction.
- **The pin's preconditions are verified on the target.** The migration refuses
  to run without `SUPERUSER` or `BYPASSRLS`; `postgres` there has `BYPASSRLS`
  and `CREATEROLE`. `pennsync.deployment_app_id` is unset, so the pin resolves
  to staging — the restrictive default, and the correct value for this project —
  and the `deployment` row will record `source = 'default'` rather than
  `'setting'`. Choosing it explicitly is the one open decision in this stage.
- CI reports the gap read-only on every run once
  `PENNSYNC_STAGING_DATABASE_URL` exists (`hosted-gap` in
  `pennsync-authority.yml`); it never applies anything.

#### Applied 2026-09-21

**The write path has been run against `caremetric-pennsync-staging`.** All 59
outstanding migrations applied, in the provisioner's two-sequence order, each
recording itself inside its own transaction. `applied: 59`, `mutated: true`, no
failures and no partial run; a second read-only plan immediately afterwards
reports `pending: 0`, `already_applied: 68`, `deployment_pin_pending: false`.

- **The pin landed as predicted and was verified independently of the tool that
  wrote it**: `app_id 6a9881683dc68a0bd54f1ef7`, `label staging`, **`source
  'default'`**, one `deployment` row. `pennsync.deployment_app_id` was left
  unset, so the pin resolved to the restrictive default. That answers this
  stage's one open decision by taking it: staging was not chosen explicitly, it
  was defaulted to, and the `deployment` row says so. Anyone who wants the pin
  to record a deliberate choice has to say so before the store is built,
  because D11 makes it immutable afterwards.
- **The ledger holds one row per migration**: 68 rows, 68 distinct versions, 68
  distinct names, no duplicates — the nine that were already there plus the 59
  applied. `synthetic_archive_patient_import` is absent, which is the point of
  holding it back in `LOCAL_ONLY_MIGRATIONS`.
- The store came out at **157 record tables, all owned by
  `pennsync_records_owner`, row level security enabled *and* forced on every
  one, 591 policies, 82 contract functions** in `public`.

#### What the stage found

The assumption the stage was told to distrust **holds**: on managed Postgres
`pennsync_records_owner` has neither `SUPERUSER` nor `BYPASSRLS`, so the 591
policies bind on the role the brokers run as. So does the rest of the
composition — a PGlite database built from the same committed migrations and
measured by the same SQL is byte-identical to the hosted one on tables, owners,
forced RLS, policy names, contract inventory, helper inventory and function
ownership. Nothing about managed Postgres contradicted the model.

Two things a local database could not have told us, and both are about the
platform rather than the store:

- **Four platform roles reach the record store past RLS.** A hosted project
  carries five roles holding `SUPERUSER` or `BYPASSRLS`, and `postgres`,
  `supabase_admin`, `supabase_etl_admin` and `supabase_read_only_user` all hold
  `USAGE` on both schemas. `supabase_read_only_user` is the one to say out
  loud: it bypasses all 591 policies, so Supabase's own read-only access reads
  every record table past the tenant predicates. This is inherent to managed
  Supabase and cannot be revoked from inside the store; it is recorded as a
  baseline set in `hosted-store.test.mjs` so a sixth one fails the suite. It
  belongs in the evidence packet as a stated property of the hosting, not as a
  defect to fix.
- **`service_role` bypasses RLS and is held out by the grant model alone.** It
  holds `BYPASSRLS` and no `USAGE` on either schema, so unlike every other
  caller nothing about the policies contains it. Granting it schema usage at
  any future point would silently open the whole store; PGlite cannot show
  this, because there `service_role` has no bypass at all.

#### The suites, hosted

- **Added `services/authority-store/tests/hosted-store.test.mjs`** and the
  `hosted-store` job in `pennsync-authority.yml`. It measures the migrated
  project against a reference built from the same committed migrations rather
  than against constants written into the test, so it fails on drift in either
  direction, and it asserts the platform facts above that no reference build
  can produce. It is read-only structurally rather than by intention: every
  statement is checked with the migrate tool's own `isReadOnly`, which fails
  closed, before it is sent. 14 tests, green against hosted staging.
- **The row-behaviour half cannot run hosted yet, and that is a finding rather
  than an omission.** `record-tenant-isolation`, `activity-audit` and the 42
  `contract-*` suites prove what a policy *means* by seeding callers, and a
  caller in this store is an `auth.users` row —
  `pennsync_private.identity_map.auth_user_id` carries a foreign key to it.
  `fixtures.sql` fabricates those rows and refuses to load anywhere
  `auth.pennsync_local_test_double()` is missing, which is every hosted
  project; writing synthetic identities into a real Supabase Auth schema is
  precisely what that guard exists to prevent. So the hosted proof of isolation
  is **blocked on stage C**, not on engineering here, and the publishable key
  and actor UUID map the hosted-target job was to carry are owed to that stage
  rather than to this one. What stage A can prove without a caller — that the
  policies bind, that they all arrived, that the helpers are unreachable and
  that no caller holds a direct grant — is proved.
- The PGlite suites themselves remain green and unchanged: they are still the
  proof of what the predicates mean, and now they are no longer the *only*
  proof that the store a deployment holds is the one they describe.

#### The residual gap, stated plainly

The `hosted-store` job hands its secrets to the checked-out suite, so it gets
them **only on `main`**, for the reason already recorded on `hosted-gap`: on a
pull request that file is whatever the branch author wrote, and
`SUPABASE_ACCESS_TOKEN` is account-wide. The job still runs on every pull
request — the suite is exercised and skips each hosted assertion with a stated
reason — but the hosted measurements happen on main and on a manual run from
main. That is narrower than "CI running them on every PR" and it is the safe
reading of it. Closing it properly needs a credential scoped to reads on one
project, which Supabase does not offer today.

**Exit:** every committed migration applied to one real hosted project — **done**;
the structural suites green there and running in CI — **done**; the row-behaviour
suites green there — **blocked on stage C**, which is where the identities come
from.

### Stage B — Deploy `services/pennsync-api`, paused (size S; owner creates the service)

- New Railway service in the CareMetric Train project, root
  `/services/pennsync-api`, its committed `Dockerfile`, healthcheck `/healthz`,
  configuration in service settings rather than a `railway.toml` — the same
  pattern `services/integration-runtime` already proves.
- Deploy with the release gate closed and the released-function list empty, so
  `/readyz` answers 503 with `released:false` and `FUNCTION_NOT_RELEASED` is the
  answer to every name.
- Point it at hosted staging from Stage A.
- Redeploy the integration runtime at the same time; it is two commits stale.

**Verified 2026-09-21 by running the service, not by reading it.** Started from
this repository with **no environment at all**, which is the state a freshly
created Railway service boots in:

- `/healthz` → **200** `{"status":"alive","release":"paused","revision":"unbound"}`.
  This is the property the stage depends on and the one worth proving first: the
  healthcheck passes *while the release gate is shut*, so the first deploy goes
  green and stays paused. A service whose health endpoint only answered when
  configured would fail its first healthcheck and look broken.
- `/readyz` → **503**, `released:false`, `operations:[]`, `authorityMode:"independent"`,
  `base44ExecutionDependency:false`, and **74 handlers** in `implemented`.
- An unknown route → 404 `NOT_FOUND`, not a stack trace.
- `loadConfig` defaults every value and only opens on
  `PENNSYNC_API_RELEASE=enabled-v1`, refusing that outright without a usable
  authority (`INCOMPLETE_AUTHORITY_CONFIGURATION`). A typo in the released
  function list fails at startup rather than releasing nothing quietly.

So there is **no engineering gap in front of this stage** — it is the Railway
service itself. The `Dockerfile` also runs `node --test *.test.mjs` during the
build, so an image that builds is an image whose suite passed.

**Exit:** `/healthz` alive on both services; `/readyz` 503 on both with an empty
operation set; no traffic change anywhere.

### Stage C — Real identities (size M; ten people plus an operator)

- Send Supabase Auth invitations; each enrollee accepts their own. The tool
  cannot create a native account and must not be given a way to.
- **This stage now also carries stage A's unfinished half.** The hosted proof of
  tenant isolation — `record-tenant-isolation`, `activity-audit` and the 42
  `contract-*` suites run against the hosted project rather than PGlite — needs
  seeded callers, and a caller is an `auth.users` row that only a real accepted
  invitation can create. Stage A proved the policies bind, arrived intact and
  are unreachable except through the brokers; what it could not prove is what
  any one of them returns to a real person. The publishable key and actor UUID
  map belong to that job, here, rather than to the structural suite stage A
  added.
- Verify each identity out of band, then run `tools-pennsync-enroll.mjs` with the
  digest-addressed plan. Every run lands in `enrollment_receipt`.
- Retire the four pinned actor IDs in `services/authority-client/client.mjs` in
  favour of verified identity-map rows.
- Give the four tenant roles that can hold context but cannot use it their roster
  behaviour.
- **Decide the synthetic-name question.** `agency` and `patient` names must begin
  `Synthetic ` in every deployment, and `actor()` refuses any non-staging
  deployment outright with `PENNSYNC_STAGING_RPC_SURFACE_ONLY`. That guard is
  correct today and is a hard stop on production. Lifting it is a compliance
  decision about whether this store ever holds real names — not a refactor — and
  it has to be made before Stage F can mean anything.

**Exit:** the two-agency positive and negative matrix from
`docs/PENNSYNC_EXTERNAL_CUTOVER_EVIDENCE.md` passes hosted with real Auth;
`identities`, `isolation` and `revocation` rehearsal receipts producible.

### Stage D — Release handlers end to end, one at a time (size M)

- **Fix the `agency_id` gap first, and it is seventeen times the documented
  size.** The transition plan names four call sites. That was measured when
  the adapter routed ELEVEN ported names; `PORTED_FUNCTIONS` holds seventy-four
  now and nobody re-measured. `tools-ported-call-sites.mjs` measures it:

  | | Count |
  | --- | ---: |
  | Ported capabilities `src/` reaches | 52 of 74 |
  | Routed call sites | 70 |
  | …naming a tenant | **3** |
  | …demonstrably not naming one | 32 |
  | …whose payload is a variable, so unreadable | 35 |
  | **Work Stage D has to do** | **67** |

  The 35 are carried with the 32 deliberately: a call site whose tenant cannot
  be read is not evidence that it has one. Two further reaches are excluded
  because they go through `rawBase44`, which the adapter is not in — they are
  the two that bootstrap the tenant itself and could not name one.

  `tools-ported-call-sites-expectations.json` pins the list and
  `pnpm run check:ported-call-sites` gates it, so a new tenant-free call site
  is a build failure and the count cannot go stale again. This is the same
  shape as D47, D55, D74 and D75 — a number that kept its meaning after the
  reason for it had gone.
- **Those 67 edits are no longer the fix, and attempting them would have broken
  production.** `src/functions/*` wrappers serve BOTH backends, so every added
  `agency_id` also reaches the live Base44 original — and roughly a third of
  those reject an unknown key outright. Which third cannot be settled by
  scanning: the first attempt classified `createAuthorizedPatient` as tolerant,
  and it rejects unknown keys at `entry.ts:149` through a
  `for (const key of Object.keys(body))` loop the scan did not know. Widening
  the scan found further shapes, so "no rejection shape found" is not proof of
  tolerance — D47's and D75's lesson arriving a third time. Adding the key on
  that evidence would have broken patient creation in production.

  **So the tenant is supplied in `portedCall`**, where it reaches only the
  ported service and can never enter a Base44 payload. It comes from
  `getActiveTrustedTenantContext()` — the principal `AuthContext` already bound
  and validated, the same source the six revalidation hooks use — and that
  helper's own contract states it is not an authorization grant, because the
  server re-checks the principal and membership before work and before
  disclosure. A call site that names its tenant still decides; with no bound
  principal the original refusal stands.

  **This reverses a recorded decision** ("the adapter refuses rather than
  choosing a tenant on the caller's behalf, which is the point") and is flagged
  as such in the code. The reversal is narrow: the adapter still invents
  nothing, it reads an authority the session already holds. The one case worth
  watching is a caller holding two memberships, where the bound context is the
  one the UI is showing — which is why naming the tenant explicitly stays
  better, and why `check:ported-call-sites` keeps ratcheting downward.
- **`getMyTenantContext` is safe, and an earlier revision of this document said
  it was not.** `routesPorted` IS tested first in the adapter's dispatcher,
  ahead of every special case, so pointing `VITE_PENNSYNC_API_URL` at a service
  does route that name to it. The reason that is harmless took reading the call
  path rather than the dispatcher, and is worth recording because it is not
  obvious: the capability has TWO seams. `bootstrapMyTenantContext` — the
  pre-tenant one, used by `AuthContext` — goes through `tenantAuthorityClient`
  to the adapter's own `authority` object, which never reaches `invoke` and so
  never reaches `routesPorted` at all. The other, `getMyTenantContext`, is the
  revalidation path behind the SDK membrane, and its six call sites all pass
  `trustedTenantRequest(...).options`, which sets `agencyId` unconditionally and
  returns null rather than omitting it. So every routed call carries a tenant,
  `portedCall` lifts it into the envelope, and the contract serves it.

  What remains is a fragility rather than a defect, and it is what the gate
  above is for: a future bare `getMyTenantContext()`, or a `trustedTenantRequest`
  that ever returned options without an `agencyId`, would refuse on the routed
  path while the bootstrap kept working — a failure that would look like a
  tenant problem and be a dispatcher one.
- Then release per function, behind the existing per-name gate: the patient read
  pair, then the create, then the visit family, then the rest by blast radius.
- Each release wants its own hosted proof, not a suite that passed locally.

**Exit:** the independent staging build serves the patient and visit families
from `pennsync-api` against hosted staging, with the Base44 path untouched.

### Stage E — Independent authority on the runtime (size M)

- The runtime takes caller authority from a Supabase JWT plus the store's context
  RPC instead of Base44 `getMyTenantContext`. This is the single remaining Base44
  execution dependency inside the runtime.
- `caller-binding.test.mjs` and `runtime.test.mjs` updated; `/readyz` reports
  `authorityMode: independent` and `base44ExecutionDependency: false`.

**Exit:** readiness says `independent` on the hosted runtime with the browser
transport still unreleased.

### Stage F — Production Supabase project (size S to provision; owner approves cost)

- New dedicated project, us-east-1, per D4. Do not reuse `CM Train`: it carries
  Hub Auth triggers and a different access boundary.
- `tools-pennsync-provision.mjs` against it — app pin set to production, read back
  from a new session, both migration directories applied in order, records last.
  This is the path the tool was built and tested for.
- Blocked by Stage C's synthetic-name decision: until that is settled the store
  serves no RPC in a production-pinned database, by construction.

**Exit:** production store provisioned; the pin proved chosen rather than
defaulted; `deployment` row dated.

### Stage G — The last 32 ports (size M, parallel to D and E)

**Measured 2026-09-21: the startable side is at ZERO.** `tools-transition-disposition.mjs`
reports 72 capabilities with no blocker, and all 72 are registered in
`services/pennsync-api` — so every port that *can* be written without a decision
has been. Two buckets the queue used to report are also empty now, on
corrections rather than ports: `records_schema` (D75) and `ported_function`
(D76). What is left is exactly the 32 below, and **not one of them is waiting on
engineering capacity**.

Re-derive that from the registry rather than by searching for quoted names: a
first pass here looked for each capability as a quoted string and reported 18
outstanding, because `handlers.mjs` registers them as bare object keys. The
answer was 0. That is D47's lesson once more — read the shape from the tree.

Each bucket needs a different thing, and only one of them is code:

| Blocker | Count | What it needs |
| --- | ---: | --- |
| `files` | 12 | Stage H. The mapping, resolver and planner are built (D77); the bytes are not copied |
| `entity_authorization` | 8 | A decision, twice. Six UPDATE a profile, which D23 left open deliberately; two write `MedicareGuideline`, a `global` table no tenant surface may write — they need a platform ingestion path, not a caller-facing handler |
| `entity_not_carried` | 7 | A disposition conversation. These read training records, paused comms logs and real-time metrics from domains that are going away |
| `core_integration` | 3 | An owner's decision to broker `Core.SendEmail`, which the runtime already implements. This is a release gate, not a build |
| `external_secret` | 2 | A new brokered operation for audio transcription, with the reservation, quota, encrypted result and audit the other seven have — over a PHI payload. A capability to design |

### Stage H — Files (size M, can start once the production bucket exists)

- Read-only inventory of uploaded files in both production apps.
- Copy into the private bucket with a SHA-256 manifest; originals untouched.
- Migrate the 31 `UploadFile` call sites to `UploadPrivateFile`.
- `file_url` consumers resolve `cmfile:` handles to 60-second signed URLs at use
  time; fax and document flows bind to stable artifact ids, never to signed URLs.

**Exit:** `private_files` rehearsal receipt — source hash equals download hash,
foreign and revoked denial, expiry and renewal.

### Stage I — Customer data migration (size L; after Stage F)

Owner-signed permits for the production and legacy apps, the mapping tables from
`docs/PENNSYNC_DATA_MIGRATION_RUNBOOK_2026-09-03.md`, an importer with an
immutable manifest, and a rehearsal into a disposable project before anything
touches the real one. 8,672 legacy rows and 3,190 production rows, zero id
overlap.

**Exit:** `archive_restore`, `sessions` and `rollback` receipts; zero unexplained
conflicts.

### Stage J — Frontend (size L to XL; the largest untouched surface)

This is the stage the status tables consistently understate. Nothing has moved:
445 entity call sites across 69 entity types, 366 files importing the Base44
client, 198 function invocations through 83 wrappers, 41 Core integration sites,
4 SDK importers — all at ratchet baseline.

- Replace `src/api/base44Client.js` with a backend-neutral client; the
  independent adapter becomes the default under `VITE_PENNSYNC_BACKEND=independent`.
- Replace call sites tier by tier; a lint rule blocks new direct entity calls.
- Remove `@base44/sdk`, `@base44/vite-plugin` and `BASE44_LEGACY_SDK_IMPORTS` in
  the final PR of the stage.
- Railway static-site service for the SPA: SPA fallback, immutable asset caching,
  the existing CSP, a health endpoint. New publish workflow replacing
  `publish-production-frontend.yml`, verified by `tools-live-frontend-sync.mjs`
  after extending its origin allowlist past Base44.

**Exit:** no `base44.entities` reference in production-mode code; the build talks
only to Railway and Supabase while Base44 still serves the shell
(`business_backend_exit`).

### Stage K — Schedules and providers (size M; after Stage D)

Railway cron or `pg_cron` calling the API with the internal secret, each of the
seven workflows behind its `WORKFLOW_RELEASE_*` gate. Telnyx status webhook
re-pointed; Whisper and Anthropic keys as Railway references; HeyGen removed
after the Hub cutover; the HHGS JDK 17 adapter only when PDGM payment releases.
D49's open question — who runs an unattended per-tenant sweep in a store where
nothing holds `BYPASSRLS` — governs four capabilities and is still open. Of the
three shapes named, only a real per-agency identity contradicts nothing already
settled.

**Exit:** `release_controls` receipt shows exactly the intended released set.

### Stage L — Rehearsal, cutover, decommission (size M)

Evidence packet until `evidence_coverage_complete`; full staging rehearsal with
the enrolled actors over the minimum observation window; then production write
freeze on Base44, final delta export and import, canary, observation, and a
rollback plan that leaves Base44 intact.

#### The native half, which is a bigger blocker than the migration

**Step one ships without touching the apps at all, and that is the point.**
Under D3, `business_backend_exit` leaves Base44 serving the static shell at
`caremetricai.base44.app` while the bundle talks only to Railway and Supabase.
The origin an installed app loads does not change, so there is no rebuild, no
resubmission and nothing to approve. Base44 becomes a file host with no
business role. Everything in stages A to K can land this way.

`WKAppBoundDomains` does not complicate it: it bounds main-frame **navigation**,
not `fetch`, so a bundle calling Railway and Supabase needs no entry. The
wrapper also injects no script — `WebViewController.swift` sets
`limitsNavigationsToAppBoundDomains = true` and uses no `WKUserScript` or
`evaluateJavaScript` — so the usual app-bound trap (injection restricted to
app-bound domains) does not apply. One caveat: the current frontend
deliberately registers no service worker, and app-bound limits DO affect
service workers, so a Railway static host that adds one changes this analysis.

**Step two, the domain move, is where the apps are at risk**, and the code part
is the small part:

| Where | What |
| --- | --- |
| `ios/PennSync/WebViewController.swift:38` | `appURL` hard-bound to `https://caremetricai.base44.app/` |
| `ios/PennSync/Info.plist:52-56` | `WKAppBoundDomains` is `base44.app`, `base44.com`. It takes up to 10, so the transitional build lists OLD and NEW and one binary works either side of the DNS move |
| `base44/functions/createUserWithTempPassword/entry.ts:36-37` | store URLs in the invitation email |
| `tools-app-store-migration.test.mjs` | byte-pins all 25 `ios/` and `public/` files to baseline `1ff6018` and asserts the Base44 URL is still present, so any of the above FAILS the suite by design. Updating it is a reviewed act, not a fix |

`caremetricai.base44.app` must stay reachable until adoption of the new build is
high: an installed app on the old binary points there permanently.

**What actually blocks a native release has little to do with Railway.**
`docs/APP_STORE_SUBMISSION_CHECKLIST.md` opens with a hard STOP — no IPA or AAB
may be uploaded, *including to TestFlight or Play testing tracks* — and the
reasons are recovery problems rather than engineering ones:

1. **Signing continuity.** Apple provisioning for `com.caremetric.ai` and Play
   App Signing for `com.caremetic.ai` must be RECOVERED, not regenerated. A new
   signing key means existing users cannot update; they would have to uninstall
   and reinstall.
2. **There is no `android/` directory in this repository.** Blocker 6 is not an
   Android update, it is a project that does not exist here.
3. **Four live in-app purchases** — Monthly $29.99, Quarterly $79.99,
   Semi-Annual $149.99, Annual $264.99 — and **none of the native IAP
   implementation is in this repository**: no StoreKit, no receipt validation,
   no entitlement code, and no server-side subscription state in either store.
   This is a standing risk today, independent of the migration, and nothing in
   the migration plan carries subscription state across.
4. **Guideline 4.2.** It is a web wrapper before and after, so the move changes
   nothing here. The checklist's own recommendation is Apple Business Manager
   distribution (unlisted or custom app) rather than public listing, since the
   audience is one agency's staff.
5. **EULA.** Live Apple metadata points at `/eula`, which has no approved
   in-app route; the external page is not confirmed as governing terms.
6. **Privacy declarations** (blocker 5) are the STORE-side ones — App Store
   nutrition labels and Play Data safety. The bundled
   `ios/PennSync/PrivacyInfo.xcprivacy` is already complete and correct and is
   not what is outstanding; the two must be kept in sync.
7. **Physical-device tests** (blocker 7) on both platforms with non-PHI data.

One thing the move improves: Guideline 4.8. The hosted `/login` page is
configured in the Base44 dashboard, outside this repository, so a third-party
login button appearing there would force Sign in with Apple. Owning the origin
removes that exposure.

**Sequence accordingly.** Ship the whole backend transfer through step one,
which carries no store risk at all, and start the three recovery problems —
signing assets, the Android project, the IAP implementation — now, because they
are long-lead, unowned, and gate step two no matter how the migration goes.

**Exit:** `cutover` and `independence` production receipts; release-owner
sign-off; Base44 read-only after the retention window, credit ledger compared
with the Phase 0 baseline.

## 4. What only the owner can unblock

Nothing in Stages B, C, F or L can be done from the repository. Listed plainly
so none of it sits waiting on a misunderstanding:

| Needed | For | Note |
| --- | --- | --- |
| ~~Approval to run the migrate tool's write path against hosted staging~~ | Stage A | **Granted and run 2026-09-21.** 59 migrations applied, 68 recorded, pin on staging with `source 'default'`. The hosted-target CI job is added and its structural suite is green; what the stage's exit still lacks is the row-behaviour half, which needs identities and so moved to stage C |
| Create the `pennsync-api` Railway service | Stage B | Cost approval; same project and pattern as the runtime |
| Cost approval and creation of the production Supabase project | Stage F | D4: dedicated, us-east-1, not `CM Train` |
| Ten Supabase Auth invitations accepted, each verified out of band | Stage C | The enrollment tool cannot and must not do this |
| A decision on whether the owned store ever holds real names | Stage C, F | Today every deployment refuses a real agency or patient name, and production serves no RPC |
| A decision to broker `Core.SendEmail` | Stage G | Unblocks 3 ports; the runtime already implements it |
| Dispositions for 7 capabilities on retiring domains | Stage G | Training records, paused comms logs, real-time metrics |
| Who runs an unattended per-tenant sweep | Stage K | D49; governs 4 capabilities |
| Named owners for Product, Security, QA, Release, Hosting | Stage L | LR-01/LR-02 still TBD |
| Base44 owner-signed export permits | Stage I | Production and legacy apps |
| Recover Apple provisioning and Play App Signing continuity | Stage L | Must be recovered, never regenerated — a new key means users cannot update |
| Recover or rebuild the Android project | Stage L | There is no `android/` directory in this repository |
| Recover or reimplement the IAP entitlement path | Stage L, and today | Four live products; no StoreKit, receipt validation or subscription state in this repository |
| Store-side privacy declarations, EULA approval, physical-device tests | Stage L | Blockers 5 and 7; the bundled privacy manifest is already correct |
| Distribution route decision (public listing vs Apple Business Manager) | Stage L | Guideline 4.2 applies to a web wrapper either way |

## 5. What this plan does not change

The containment already in place stays in place until its own gate opens: all
seven production workflows inactive; messaging, e-signature, fax, OASIS v2, PDGM
payment, outcome computation, patient merge and telehealth paused by literal
gates; frontend publication manual and main-only with post-publish hash
verification; the integration runtime released to nobody. None of the stages
above is a reason to open any of those early, and Stage A in particular changes
no release posture at all — it applies committed schema to a staging project and
nothing else.
