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

**Updated 2026-09-22:** the second service now exists and is also deliberately
serving nothing — see stage B. The last sentence is unchanged and is the one
that matters: every user request is still answered by Base44.

Probed 2026-09-21:

| Probe | Result | Reading |
| --- | --- | --- |
| `pennsync-integrations-production.up.railway.app/healthz` | `{"status":"alive","release":"paused","revision":"cffe376…"}` | Deployed and healthy, released to nobody |
| same host `/readyz` | HTTP 503; `released:false`, `operations:[]`, `authorityMode:"base44"`, `base44ExecutionDependency:true`, `trafficCutoverVerified:false`, `browserReleased:false` | Zero of seven brokered operations enabled; still asks Base44 who the caller is |
| `pennsync-api-production.up.railway.app/healthz` | HTTP 404, `Application not found` | The service does not exist. **Created 2026-09-22: now HTTP 200, `release:"paused"`, revision `f18b053` — see stage B** |
| `app.caremetricai.com/` | HTTP 200 | Base44 |
| `caremetricai.base44.app/` | HTTP 200 | Base44 |
| Supabase account project list | `CM Train`, `caremetric-pennsync-staging`, `PennPaps`, `CareMetric Support Hub`, `bolt-native-database-62871816` | **No production project** |
| `caremetric-pennsync-staging` migration list | 9 versions, newest `20260918204105` | Five authority migrations behind; **no record store at all**. **Closed later the same day: 59 applied, 68 recorded — see stage A** |
| `node tools-pennsync-cutover.mjs --check` | `status: blocked`, `PINNED_INPUTS_REQUIRED`, `release_authorized:false` | None of the 15 gates has a receipt |
| `pnpm run check:base44-surface` | `client_importers=366/366 entity_call_sites=445/445 core_integration_sites=41/41 function_wrappers=83/83` | The frontend has not moved one call site |

The deployed runtime revision `cffe376` is two commits behind `origin/main`
(`4f73ec6`) — it predates PR #228 and PR #229 entirely.

**Corrected 2026-09-22.** That count is of the REPOSITORY, and it was then read
as though the service were stale, which is a different claim. Measured against
the service's own source,
`git diff --stat cffe376 origin/main -- services/integration-runtime` is EMPTY:
not one byte of that directory has changed in the seven commits since. The
runtime is current and the redeploy this sentence implied was withdrawn.

## 1. The gap that actually matters: built is not deployed

The source work is far along and the hosted work has barely started. That
distinction is the whole plan, and it is easy to lose because the transition
plan's status table reads as progress without saying where the progress lives.

| Artifact | Built | Applied or deployed anywhere hosted |
| --- | ---: | ---: |
| Authority store migrations | 15 | ~~9~~ **14** (one is deliberately never hosted) — applied 2026-09-21 |
| Record store migrations (store, brokers, 51 contracts, purpose policies, file map) | 54 | ~~0~~ **54** — applied 2026-09-21 |
| Ported handlers registered in `services/pennsync-api/handlers.mjs` | 75 | ~~0~~ **74 deployed, 0 released** — deployed 2026-09-22; the 75th (`generatePatientHandout`, D81) ships with the next deploy |
| Railway services | 2 defined | ~~1 deployed, paused; 1 never created~~ **2 deployed, paused** — 2026-09-22 |
| Frontend call sites moved off Base44 | 0 of 445 | 0 |

Everything merged in PRs #227, #228 and #229 — the record store, the care-team
narrowing, the audit trail and seventy-two ported capabilities — has been proved
only against PGlite and ephemeral local PostgreSQL. Two thirds of that gap has
since closed and the third has not. The chain **does** apply in order to a
Supabase project and the role and grant model **does** survive contact with
Supabase's own roles — both measured on 2026-09-21 against
`caremetric-pennsync-staging`, stage A. What is still unproved is the last
clause: **no handler has answered over HTTP with a real JWT.** The 74 are
deployed as of 2026-09-22 and every one of them refuses, because the release
gate is shut and there is no real identity to authorize. That needs stages C
and D, not more schema.

The port queue, measured today rather than quoted:

```
port queue: entity_not_carried=7 entity_authorization=8 files=12
            core_integration=2 external_secret=2 none=73
```

104 carried capabilities, 73 written, 31 blocked (2026-09-22, after D81 wrote
`generatePatientHandout`). **No blocker in that list is the record store, and
none is another port.** The remaining 31 need a decision,
the file layer, a brokered send, or a new brokered operation — not more schema.

## 2. The critical path

Six things gate everything else, in this order. Only the first is free.

1. ~~**Apply what is already committed to the staging project.**~~ **Done
   2026-09-21**: all 59 outstanding migrations applied to
   `caremetric-pennsync-staging`, 68 recorded in the ledger, the pin landed on
   staging with `source 'default'`. The 54 record migrations are no longer
   unproven against a hosted database; the 74 handlers still are, because
   nothing has served a request yet. Stage B has since deployed them, paused —
   serving one needs an identity, so it is stages C and D.
2. ~~**Create the `pennsync-api` Railway service**, deployed paused, exactly as
   the integration runtime was.~~ **Done 2026-09-22**: live at
   `pennsync-api-production.up.railway.app`, `release: paused`, revision
   `f18b053`, 74 handlers implemented and every one refusing. See stage B.
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

And one thing the suite found in the migrations themselves, which is a residue
rather than a hole and is recorded so it stays visible:

- **A blanket revoke only reaches the functions that exist when it runs.**
  `20260918015112_independent_staging_authority.sql` does `revoke all on all
  functions in schema pennsync_private from public, anon, authenticated` and
  grants back the six it means to expose. Every function a LATER migration adds
  therefore keeps PostgreSQL's default `PUBLIC EXECUTE`, and three do:
  `file_object_immutable`, `protect_deployment`, `protect_enrollment_receipt`.
  All three `returns trigger`, which is what makes this harmless — PostgreSQL
  refuses a direct call to a trigger function before its body runs, PostgREST
  does not expose one, and `anon` holds no `USAGE` on that schema anyway, so
  two independent gates stand in front of the grant. It is identical in the
  reference build, so it is a property of the committed migrations rather than
  hosted drift, and correcting it is a migration rather than a fix to make from
  here. `hosted-store.test.mjs` refuses the thing that would matter — a
  *callable* private function reachable anonymously — and pins the trigger set,
  so a fourth one fails.

  **A correction must revoke the three by name, never by repeating the blanket.**
  `AGENTS.md` already forbids a second `revoke all on all functions in schema
  pennsync_private`: every `pennsync_staging_*` wrapper is an invoker calling an
  inner function granted to `authenticated`, so the blanket takes that grant
  away and nine suites go red. The obvious reading of this finding is the one
  thing not to do, which is why it is written down beside the finding and in the
  test's own comment rather than only here.

#### Stage E's database dependency is present

Checked while the store was open, because nothing else checks it and stage E
fails late without it. `services/integration-runtime/authority.mjs` is the
whole of `authorityMode: independent`; it pins the project
(`AUTHORITY_TARGETS` names `xxtyweswohkvgkprimwa`) and a fixed RPC name that no
caller or environment value selects. Both are real on the migrated project:
`public.pennsync_staging_context(p_app_id text, p_agency_id text)` exists,
`authenticated` may execute it, `anon` may not — and the same holds for the
whole `pennsync_staging_*` family the independent path calls. The runtime's own
suites stub that endpoint and the store's suites never looked outside PGlite,
so a changed signature or a revoke that reached `authenticated` would have
surfaced as the runtime failing to leave `base44` mode on deploy, which is
where it is least diagnosable. It is asserted now.

#### The suites, hosted

- **Added `services/authority-store/tests/hosted-store.test.mjs`** and the
  `hosted-store` job in `pennsync-authority.yml`. It measures the migrated
  project against a reference built from the same committed migrations rather
  than against constants written into the test, so it fails on drift in either
  direction, and it asserts the platform facts above that no reference build
  can produce. It is read-only structurally rather than by intention: every
  statement is checked with the migrate tool's own `isReadOnly`, which fails
  closed, before it is sent. 15 tests, green against hosted staging.

  **What it compares is STRUCTURE rather than counts, and that distinction was
  a review finding rather than the first design.** The first version compared
  table names, policy names and function counts grouped by owner — all of
  which survive the drifts that matter. An `alter policy … using (true)`, a
  dropped `chart_assignment_request_key`, a rewritten contract body and a
  `revoke execute … from authenticated` each leave every name and total
  exactly as they were. The comparison now carries each policy's command,
  roles, permissiveness, `qual` and `with_check`; each index and constraint
  definition; each function's owner, security mode, settings, volatility,
  grants and body digest; each trigger definition; and each column's type and
  nullability — across **both** schemas, since `pennsync_private` is where the
  authority answers come from and measuring only the record store left a
  dropped membership constraint or a detached immutability trigger invisible.
  Each of those was proved to fail by sabotaging a reference build, not by
  reading the query.

  Two more of the same kind. Caller table privileges are asked through
  `has_table_privilege` rather than read from
  `information_schema.role_table_grants`, because that view lists grants made
  to a named grantee and omits what a role holds through `PUBLIC`: a
  `grant select … to public` left the old count at **0** while every caller
  inherited the privilege, which is measured and recorded rather than
  asserted. And the read-only barrier is an ALLOWLIST of the three statements
  the suite sends, not a scan of leading verbs — `select <write contract>(…)`
  and `explain analyze insert …` both pass a verb scan and both mutate, and
  the credential in play is account-wide.

  Hosted is PostgreSQL 17.6 and PGlite is 18.3, and everything above compares
  byte for byte across that gap. The single exception is handled explicitly:
  PostgreSQL 18 gives NOT NULL its own `pg_constraint` row and 17 does not, so
  constraints exclude `contype = 'n'` and nullability is compared through
  `pg_attribute.attnotnull`, which both answer identically. The coverage is
  kept rather than dropped.
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

**On `main` a missing credential fails once the measurement is REQUIRED**, and
the shape of that gate was settled the hard way.

The suite turns an absent target into a skipped test, which is right for the
credential-free step and would be silent failure on main: a renamed or expired
secret would leave the job green having read nothing, and a required check that
has quietly stopped checking is the exact shape this job exists to catch — the
hosted project sat fifty-nine migrations behind because nothing looked. So the
review asked for a refusal, and the first version refused any absent credential
on main.

**It turned main red on the first run after merge, and the reason is worth
keeping.** Neither `PENNSYNC_STAGING_DATABASE_URL` nor `SUPABASE_ACCESS_TOKEN`
was configured as a repository secret at the time — `hosted-gap` had been
skipping for that same reason since the day it was written, which is why nobody
knew. (Both were added on 2026-09-22; this paragraph records how the gap was
found, not the current state.) A refusal
written for "the credential broke" fired on "the credential was never added",
and those are not the same event.

`HOSTED_MEASUREMENT_REQUIRED` separates them, and it governs only what an
ABSENT credential means:

- absent and not required (the state until 2026-09-22) — a `::notice` saying
  the store was not measured, and a green job;
- absent and required — a failure, which is the finding, intact;
- set but unusable — a failure either way, because a target that is configured
  and broken is the renamed-or-expired case the finding was actually about;
- set and usable — measured, whatever the flag says, so the job starts working
  the moment the secrets land rather than waiting for somebody to remember.

~~**Adding those two secrets and flipping the flag to `true` in the same change
is the last thing stage A owes**, and it is an owner action: the credentials
cannot be added from the repository.~~ **Done 2026-09-22**, in two steps rather
than one, which is worth recording precisely because this paragraph asked for
one. The secrets were added in repository settings; #237 set the flag. The
05:38Z run on main proves that order — it shows `HOSTED_MEASUREMENT_REQUIRED:
false` alongside both credentials masked and fifteen real measurements, so the
secrets were already in place about sixteen minutes before #237 merged.

**The gap was harmless, and for the reason the bullets above give.** A usable
credential is measured whatever the flag says, so the measurement started the
moment the secrets landed; the flag adds only that the job can never quietly
stand down again. Had the order been reversed the stage would have gone red
instead — which is the behaviour asked for, not a defect. Those bullets are
kept; only the "today" in the first of them has moved on.

**The decision lives in `tools-pennsync-hosted-gate.mjs` rather than in the
workflow, and that is the fourth version of it.** The first bound the
credentials through an env-level ternary; the second made any absent credential
fatal and turned main red; the third read "the URL is empty" as "nothing is
configured", so a token left behind by a renamed URL secret — a partial, and
therefore broken, configuration — took the green stand-down path. Each was
checked by hand and each looked right, because a shell block inside YAML is the
one place in this repository nothing can test.

**And a fourth, which the module could not have prevented.** The step invoked
the gate bare and branched on `$?`. Actions runs `run:` under `bash -e`, which
`set -uo pipefail` does not clear, so the stand-down exit of 3 ended the step
at 3 instead of being read — main went red a second time, with the `::notice`
printed in the log immediately above the error. The call is `|| gate=$?` now,
the left side of `||` being exempt from `-e`. The check that missed it ran the
same step body under a plain `bash script.sh`, reproducing everything except
the one flag that mattered; the suite now executes the real body under
`bash -e` with both `node` calls stubbed, and that test fails against the shape
that shipped.

It is a module with a table-driven suite now. Every combination of (target,
token, required) has a row, the two rules are asserted as properties rather
than rows — `required` may turn an absent configuration into a failure and may
never turn a broken one into a pass; nothing but a wholly unset pair may stand
down — and a test reads the workflow itself and fails if the step stops calling
the gate or regrows a credential check of its own. The step branches on an exit
code (0 measure, 3 stand down, 1 refuse) and asks about no credential at all.

The containment is two steps rather than one, and the repository insisted on
it. The first version bound the secrets through an env-level
`github.ref == 'refs/heads/main' && secrets.X || ''`, which keeps the token out
of the environment on every other ref just as effectively —
`src/testRegistryContract.test.js` failed it anyway, because it ratchets on the
step carrying the token being gated by a literal `if:` on the REF. The ratchet
is right: the property then lives in one line a reviewer reads rather than an
expression they have to evaluate. So the measuring step is `if:` main with the
secrets, and a second step with no secrets at all runs the suite everywhere
else, which is what keeps it exercised on a pull request.

**Exit**, as four claims rather than three, because two of them were being
carried by one "done" that was half true:

1. every committed migration applied to one real hosted project — **done**
   (59 applied, 68 recorded, pin on staging);
2. the structural suites green against that project — **done**, 15 tests, run
   against `caremetric-pennsync-staging` itself;
3. those suites RUNNING IN CI — ~~**not done**~~ **done 2026-09-22 (#237)**.
   Both secrets are configured and `HOSTED_MEASUREMENT_REQUIRED` is `'true'`.
   Proved from the job log rather than the tick: `PENNSYNC_HOSTED_DATABASE_URL`
   and `SUPABASE_ACCESS_TOKEN` both masked as `***`, then 15 tests, 15 passed,
   **0 skipped**, against `caremetric-pennsync-staging` itself. Note which half
   of the gate carried it: the secrets landed BEFORE the flag was flipped, and
   the measurement ran anyway, because `HOSTED_MEASUREMENT_REQUIRED` governs
   only what an ABSENT credential means and a usable one is measured whatever
   it says. The flag is what stops the job ever silently standing down again;
4. the row-behaviour suites green there — **blocked on stage C**, which is where
   the identities come from.

**Stage A is therefore open on 4 alone**, and 4 cannot be closed from outside
stage C: a caller here is an `auth.users` row. Three of the four are done and
the drift on the hosted project is now watched on every push to main, which is
the condition stage B needed.

### Stage B — Deploy `services/pennsync-api`, paused (size S; owner creates the service)

- New Railway service in the CareMetric Train project, root
  `/services/pennsync-api`, its committed `Dockerfile`, healthcheck `/healthz`,
  configuration in service settings rather than a `railway.toml` — the same
  pattern `services/integration-runtime` already proves.
- Deploy with the release gate closed and the released-function list empty, so
  `/readyz` answers 503 with `released:false` and every handler name is refused.
  The refusal is `PENNSYNC_API_NOT_RELEASED` (503, `app.mjs:61`), which is the
  whole-service gate. An earlier revision of this stage named
  `FUNCTION_NOT_RELEASED` (409, `app.mjs:63`) and that is the WRONG one: it is
  the inner refusal for a name absent from `PENNSYNC_API_FUNCTIONS`, reachable
  only once the service is released. The real behaviour is stricter than this
  stage used to claim.
- Point it at hosted staging from Stage A.
- ~~Redeploy the integration runtime at the same time; it is two commits
  stale.~~ **Withdrawn 2026-09-22, and the reason is worth keeping.** It is not
  stale. Its deployed revision is `cffe376` (#227) and
  `git diff --stat cffe376 origin/main -- services/integration-runtime` is
  EMPTY: seven commits have landed since and none touches that directory. The
  original count measured repo HEAD rather than the service's own source, which
  is the same mistake in miniature as reading a status table as progress. A
  redeploy would rebuild identical source and only re-stamp
  `RAILWAY_GIT_COMMIT_SHA`, and `cffe376` is already a valid 40-hex SHA, so
  `browserRevisionBound` is already true and nothing depends on the bump.

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

#### Deployed 2026-09-22

The service exists at `pennsync-api-production.up.railway.app`. Measured by
probing it, not taken from the deploying agent's report:

```
/healthz  200  {"status":"alive","release":"paused",
                "revision":"f18b0531bfe6cc1a5f92641061e8775e80e308a3"}
/readyz   503  ready:false  released:false  operations:[]
               authorityMode:"independent"  base44ExecutionDependency:false
               authorityConfigured:true     integrationsConfigured:true
               implemented: 74 handlers
```

`revision` is #236's merge commit rather than `unbound`, so the deploy is
traceable to a commit. `authorityConfigured` and `integrationsConfigured` being
true means the authority URL, the publishable key and the integrations URL all
passed their allowlists — the three values most likely to be wrong.

**The gate was checked at the request path, not only in the readiness report**,
because a service can report itself paused and still serve. `POST
/v1/functions/{listAgencyRoster,createAuthorizedPatient,analyzeReferral}` each
answer `503 PENNSYNC_API_NOT_RELEASED`, and an unknown route answers `404
NOT_FOUND` rather than a stack trace.

The integration runtime is byte-identical to its pre-stage state — revision
`cffe376`, `release: paused`, `authorityMode: "base44"`, `configured: true`,
`operations: []`. Not redeployed, per the withdrawn bullet above.

**One thing this stage cannot prove.** Nothing on `/healthz` or `/readyz`
exposes `PENNSYNC_API_APP_ID`, so the payload above is identical whatever it is
set to. What the probe cannot see splits into TWO cases with opposite failure
modes, and they need different responses:

| At release time | What happens |
| --- | --- |
| **Absent** (unset or empty) | `loadConfig` throws `IMPLICIT_APP_BINDING` and the service does not start. Loud, immediate, and asserted by `api.test.mjs`. |
| **Stated but wrong** (production `694ec16e…` against a store pinned to staging) | Every startup check passes, `/readyz` reports ready, and every authorization call is refused. |

Only the second is silent, and only the second is what the first authenticated
call has to catch. The first announces itself the moment
`PENNSYNC_API_RELEASE` is set, so a service that will not start after a release
is the *good* outcome here, not a regression to debug.

While the deployment is paused neither case is distinguishable from a correct
one, which is why stage C carries the binding rather than this stage.

**Exit — met 2026-09-22 for both hosted claims:** `/healthz` alive on both
services; `/readyz` 503 on both with an empty operation set; no traffic change
anywhere. The app binding is deferred to stage C as above.

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
- **Carried from stage B: prove `PENNSYNC_API_APP_ID` on the deployed service.**
  It must be the staging app `6a9881683dc68a0bd54f1ef7`, because the store's
  D11 pin on `xxtyweswohkvgkprimwa` resolved to staging. No probe can see it,
  and the two ways it can be wrong fail differently: an ABSENT value refuses to
  start at all (`IMPLICIT_APP_BINDING`, the moment `PENNSYNC_API_RELEASE` is
  set), while a STATED BUT WRONG one starts, reports ready, and is refused by
  every authorization call. So a service that will not boot after release has
  told you the answer; one that boots and then fails authorization while
  otherwise healthy is the case to check this for, before anything else.
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
  the adapter routed ELEVEN ported names; `PORTED_FUNCTIONS` held seventy-four
  when this was measured and nobody had re-measured. `tools-ported-call-sites.mjs`
  measures it (the gate's summary carries the live count — 75 routed names and
  72 call sites after D81 admitted the handout's two):

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

### Stage E — Independent authority on the runtime (size ~~M~~ **S: configuration only**)

**Corrected 2026-09-22: the code this stage describes is written and tested.**
It was listed as work to do; measured, it is done. `services/integration-runtime`
already implements `INTEGRATIONS_AUTHORITY_MODE=independent` — caller authority
from the Supabase session plus the owned store's context RPC, no Base44
`getMyTenantContext` — and readiness already reports `authorityMode` and
`base44ExecutionDependency` from the selected mode. The two suites the old text
said needed updating pass unchanged, alongside the one that covers the mode:

| Suite | Result |
| --- | --- |
| `authority-independence.test.mjs` | 28/28 — including *"a released independent deployment completes work without any Base44 request"* |
| `caller-binding.test.mjs`, `runtime.test.mjs` (with the above) | **111/111**, unchanged |

The suite sits at the service root, not under `tests/`, which is how a search of
`tests/` alone reports the mode untested.

**What is left is four variables on the Railway runtime, set together:**

| Variable | Value | Where it comes from |
| --- | --- | --- |
| `INTEGRATIONS_AUTHORITY_MODE` | `independent` | literal |
| `INTEGRATIONS_AUTHORITY_URL` | `https://xxtyweswohkvgkprimwa.supabase.co` | the only hosted target `AUTHORITY_TARGETS` admits — the staging store Stage A migrated |
| `INTEGRATIONS_AUTHORITY_PUBLISHABLE_KEY` | an `sb_publishable_…` key for that project | the same key already set on `pennsync-api` as `PENNSYNC_API_AUTHORITY_PUBLISHABLE_KEY` |
| `INTEGRATIONS_APP_ID` | **`6a9881683dc68a0bd54f1ef7`** — the staging app | see below |

**The app id is the one value that fails silently, and it is proved by running
`loadConfig` rather than by reading it.** Every other wrong value refuses at
startup: omitting the id refuses `IMPLICIT_APP_BINDING`, a secret or
service-role key refuses `INVALID_AUTHORITY_KEY`, any other URL refuses
`INVALID_AUTHORITY_TARGET`. But the **production** id `694ec16e72e01b60d22f7cbf`
is in `ALLOWED_APPS`, so stating it **boots, reports ready, and is then refused
by every authorization call**, because the store's pin is staging. It is the
same shape Stage B carried for `PENNSYNC_API_APP_ID`: an absent binding is loud
and a stated-but-wrong one is silent.

Safe to do now: the runtime is released to nobody (`INTEGRATIONS_RELEASE` unset),
so the change alters readiness and nothing else, and removing
`INTEGRATIONS_AUTHORITY_MODE` reverts to the Base44 default. It needs Railway
access, which this repository does not have.

**Exit:** readiness says `independent` on the hosted runtime with the browser
transport still unreleased — `/readyz` reporting `authorityMode: "independent"`
and `base44ExecutionDependency: false`. Read it from the probe, not from the
deploy's own report.

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

### Stage G — The last 31 ports (size M, parallel to D and E)

**Measured 2026-09-22: the startable side is at ZERO.** `tools-transition-disposition.mjs`
reports 73 capabilities with no blocker, and all 73 are registered in
`services/pennsync-api` — so every port that *can* be written without a decision
has been. The 73rd is `generatePatientHandout` (D81), which the queue counted
`core_integration` although only its email action sends: D79 found it, and it
was written the same day. Two buckets the queue used to report are also empty now, on
corrections rather than ports: `records_schema` (D75) and `ported_function`
(D76). What is left is exactly the 31 below, and **not one of them is waiting on
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
| `core_integration` | 2 | An owner's decision to broker `Core.SendEmail`, which the runtime already implements. Both are capabilities whose whole body is the send; this is a release gate, not a build |
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

**And the count understates it a second way (D80).** "Replace call sites tier
by tier" reads as a refactor whose size is the count. Crossing all 445 against
their entity dispositions — `pnpm run check:frontend-destination`, added
2026-09-22 — says otherwise:

| | Call sites | |
| --- | ---: | --- |
| `record_store` | 232 | a table exists |
| `broker_family` | 7 | the generic family serves that read |
| `activity_trail` | 3 | D25's successor |
| **can land** | **242** | |
| `no_table` | 193 | `hub` (119) and `preserved_paused` (74) — no table here at all |
| `broker_is_read_only` | 9 | a write to an entity the family serves readonly |
| `no_realtime_seam` | 1 | `subscribe`, which the owned store has nowhere to put |
| **cannot land** | **203** | |

**203 of 445 — 46% — reach a domain the migration has decided not to carry.**
119 of them are the training domain, whose destination is the Hub; 75 are
`preserved_paused`. Each needs a product answer about what the feature becomes,
not an edit somebody has not got to yet, so a plan that sizes this stage by the
call-site count is sizing the wrong thing.

The nine `broker_is_read_only` are the ones a per-ENTITY reading would have
called fine: the family serves `Announcement`, `FacilityDocumentationRule` and
`RegulatoryUpdate` readonly, and the frontend creates, updates and deletes all
three. Being served is a property of the entity; having a destination is a
property of the call site.

`store_can_hold` is not `capability serves it`. The 232 `record_store` sites
have somewhere for the row to live; whether a ported capability covers the
operation is Stage G's question and this gate deliberately does not answer it.

**Measured 2026-09-22: none of the 242 has a browser path today, and the obvious
proxy for "which could" overstates it.** Two facts, both measured:

- *No generic route exists, by design.* `pennsync-api` has exactly three routes —
  health, readiness, and one release-gated function dispatch — and its header
  says there is deliberately no generic entity, query or proxy route. So an
  entity call reaches the owned store **only** through a named handler. In the
  independent build every entity call now refuses by name
  (`STAGING_OPERATION_UNAVAILABLE`, `operation: entities.<Entity>.<op>`), where it
  used to crash with a raw `TypeError`; that seam is where a route to a handler
  will attach, one call site at a time.
- *"A shipped handler touches the entity" is not coverage.* Crossing the 242 with
  what each shipped handler's original reads and writes says **131 covered** —
  and the list shows why that number must not be used. `AgencySettings.write`
  (10 sites) counts as covered by `sendCredentialRenewalReminders`, a reminder
  sweep that stamps a marker, not a settings screen. `AdrAuditCase.write` (8) is
  "covered" by `checkAdrDeadlines`, a deadline sweep. `User.read` (37) by
  handlers that read a user to authorize and expose none. A handler that
  **touches** an entity for its own reasons is not one that **serves** a call
  site.

**The 203 that cannot land have their own docket:**
[FRONTEND_DECISION_DOCKET_2026-09-22.md](FRONTEND_DECISION_DOCKET_2026-09-22.md).
Two findings in it change the plan. 81 of the 119 training sites sit in 35
screens the learning cutover's switch never reaches — the course player and the
compliance reports among them — so the learning cutover is a *sequencing
dependency* of the exit. And the paused-domain screens are live today (direct
entity calls bypass D7's function-level pauses), so D7's "carried paused" and
"no table" contradict each other at the exit and need an owner's answer.

So Stage J's unit of work is not "repoint a call site"; it is, per call site,
*find a handler that exposes the rows this screen needs, under a purpose that
admits them — or record that none does.* The largest single lead is the 37
`User.read` sites, whose real successor is the roster pair
(`listAgencyRoster`, `getAgencyRosterMember`). Even that is not mechanical: the
roster deliberately projects no `role`, `account_type`, `agency_id` or
`agency_name` (D23), so a screen that reads a user to decide what to show a user
needs its authorization moved to the tenant context, not a new data source.

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

Nothing in Stages C, F or L can be done from the repository (Stage B's row is
settled — see below). Listed plainly so none of it sits waiting on a
misunderstanding:

| Needed | For | Note |
| --- | --- | --- |
| ~~Approval to run the migrate tool's write path against hosted staging~~ | Stage A | **Granted and run 2026-09-21.** 59 migrations applied, 68 recorded, pin on staging with `source 'default'`. The hosted-target CI job is added and its structural suite is green against the real project. When this row was written the stage's exit still lacked TWO things: the job actually measuring in CI, and the row-behaviour half. The first was closed on 2026-09-22 by the row below; only the second is open, and it needs identities, so it moved to stage C |
| ~~Add `PENNSYNC_STAGING_DATABASE_URL` and `SUPABASE_ACCESS_TOKEN` as repository secrets, and set `HOSTED_MEASUREMENT_REQUIRED` to `true` in the same change~~ | Stage A | **Done 2026-09-22 (#237).** Both secrets are configured and the flag is `'true'`. The job log shows both masked and then 15 tests, 15 passed, 0 skipped against the real project — read from the log rather than from the green tick, which is what this gate exists to distrust. The committed store's drift is now watched on every push to main |
| ~~Create the `pennsync-api` Railway service~~ | Stage B | **Created 2026-09-22.** Live at `pennsync-api-production.up.railway.app`, paused, revision `f18b053`, 74 handlers implemented and every one refusing `PENNSYNC_API_NOT_RELEASED`. The integration runtime was correctly left alone. One setting no probe can confirm — `PENNSYNC_API_APP_ID` — is carried to Stage C |
| Cost approval and creation of the production Supabase project | Stage F | D4: dedicated, us-east-1, not `CM Train` |
| Set the four `INTEGRATIONS_AUTHORITY_*` / `INTEGRATIONS_APP_ID` variables on the Railway runtime | Stage E | The code is done and tested (111/111); this is the whole of Stage E now. `INTEGRATIONS_APP_ID` must be the **staging** id `6a9881683dc68a0bd54f1ef7` — the production id boots and then refuses every call. Reversible, and the runtime serves nobody |
| **Correct the Google Play Data Safety declaration** | **Today** — independent of every stage | Live listing says "No data collected" and "No data shared with third parties" for an app handling clinical data. A policy violation that can draw enforcement against the listing. A Play Console form — needs no key and no binary, so nothing else here blocks it |
| Ten Supabase Auth invitations accepted, each verified out of band | Stage C | The enrollment tool cannot and must not do this |
| A decision on whether the owned store ever holds real names | Stage C, F | Today every deployment refuses a real agency or patient name, and production serves no RPC |
| A decision to broker `Core.SendEmail` | Stage G | Unblocks 2 ports whose whole body is the send, and the email action of a third — `generatePatientHandout`, whose document half is ported (D81). The runtime already implements it |
| Dispositions for 7 capabilities on retiring domains | Stage G | Training records, paused comms logs, real-time metrics |
| Who runs an unattended per-tenant sweep | Stage K | D49; governs 4 capabilities |
| Named owners for Product, Security, QA, Release, Hosting | Stage L | LR-01/LR-02 still TBD |
| Base44 owner-signed export permits | Stage I | Production and legacy apps |
| Recover Android signing, and Apple **account** access | Stage L — and **before the frontend moves** | Corrected 2026-09-22 ([runbook](MOBILE_RECOVERY_RUNBOOK_2026-09-22.md)). *Android:* whether it can ever be updated turns on one setting — Play Console → App integrity → is Play App Signing enabled? If yes, a lost upload key can be reset; if no, the only copy of the key is the PWABuilder output zip, and without it the app cannot be updated. *iOS:* "never regenerated" was wrong here — iOS certificates and profiles are reissued routinely without breaking updates; continuity is the app record `6757097720` staying in the same team, so recovery is signing into that account (lead: team `JC83GT8MG8`). Both apps load `caremetricai.base44.app`, so both must be recoverable before Stage J moves the origin |
| Find the Android build's origin | Stage L | Searched 2026-09-22: no Android file in this repository's full history (4,338 commits, 175 branches), nor in `CM-Go`, `CMbackup` or `App-Studio` — and all three were created after the live build's Jan 15, 2026 update, so none could have produced it. Per the July audit it is a PWABuilder TWA, which has no source to find; the artefact is the output zip holding the key |
| Recover or reimplement the IAP entitlement path | Stage L, and today | Four live products; no StoreKit, receipt validation or subscription state in this repository. **This repository's `ios/` is not the live app** — it has no StoreKit and targets iOS 15.0 where the live app requires 15.6 — so submitting it as an update would remove purchase and restore for paying subscribers |
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
