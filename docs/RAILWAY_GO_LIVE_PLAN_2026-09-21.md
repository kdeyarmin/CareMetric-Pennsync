# Railway go-live: measured state and the remaining plan

Date: 2026-09-21
Last re-measured: **2026-09-25 against `13821b7`** for the tree and the
Railway services; **2026-09-23 against `b8e4e021`** for the CI job logs on
`main` and the hosted store. The Railway readings on 2026-09-25 were taken by
a session holding the Railway connector and are attributed as such below — this
page's author cannot re-derive them from the repository, and neither can you.
Status: a live-probe assessment and the plan that follows from it. Like
[the transition plan](BASE44_TO_RAILWAY_TRANSITION_PLAN_2026-09-19.md) it
authorizes nothing: every hosted change below still needs its own review, cost
approval, evidence and release-owner sign-off under
`docs/REPOSITORY_CONSOLIDATION_2026-09-02.md` and
`docs/PENNSYNC_EXTERNAL_CUTOVER_EVIDENCE.md`.

**Every count in this document is a hypothesis until re-measured**, and the
2026-09-23 pass found stale numbers in section 1 and in stages A, B, C, D and G.
Two of them — the port queue in section 1 and the release-wave table in stage D
— are pinned to the tools that produce them now, so a change that moves either
and leaves this page alone fails the build. Everything else here is prose and
can still go stale: prefer `pnpm run check:*` and a job log to any number
written below.

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
| same host `/readyz` | HTTP 503; `released:false`, `operations:[]`, `authorityMode:"base44"`, `base44ExecutionDependency:true`, `trafficCutoverVerified:false`, `browserReleased:false` | Zero of seven brokered operations enabled; still asks Base44 who the caller is. **Re-read 2026-09-25 by the release thread: `operations: []` and `authorityMode: "base44"` still.** Do not watch `trafficCutoverVerified` for a `true` — it is a literal `false` at `integration-runtime/runtime.mjs:79` and `pennsync-api/runtime.mjs:115`, assigned nothing else anywhere, so it is not a signal |
| `pennsync-api-production.up.railway.app/healthz` | HTTP 404, `Application not found` | The service does not exist. **Created 2026-09-22: HTTP 200, `release:"paused"`, revision `f18b053`. Redeployed 2026-09-25 onto `20c15d8`: still `release:"paused"`, 80 capability names, and an `appId`/`appStated` pair the old revision did not carry — see stage B** |
| `app.caremetricai.com/` | HTTP 200 | Base44 |
| `caremetricai.base44.app/` | HTTP 200 | Base44 |
| Supabase account project list | `CM Train`, `caremetric-pennsync-staging`, `PennPaps`, `CareMetric Support Hub`, `bolt-native-database-62871816` | **No production project** |
| `caremetric-pennsync-staging` migration list | 9 versions, newest `20260918204105` | Five authority migrations behind; **no record store at all**. **Closed later the same day: 59 applied, 68 recorded — see stage A. Re-read 2026-09-23 from the `hosted-gap` job on `b8e4e021`: `already_applied: 73`, `pending: []`, one skipped by name** |
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
| Record store migrations (store, brokers, 83 contracts, purpose policies, file map) | ~~54~~ **59** | ~~0~~ **59** — 54 on 2026-09-21 and the rest since; the hosted ledger holds 73 of the 74 committed migrations with nothing pending, read from the `hosted-gap` job on `b8e4e021` 2026-09-23 |
| Ported handlers registered in `services/pennsync-api/handlers.mjs` | ~~77~~ **80** | ~~0~~ ~~74 deployed~~ **80 deployed; waves 1 to 3 released 2026-09-25, 8 operations serving as at 05:43Z** (release state moves without a commit — read `/readyz`) — the six-name gap closed by the 2026-09-25 redeploy. It did not close by itself and will not stay closed by itself: the service's source is **pinned to a commit**, so every future merge reopens it until somebody repoints the pin — **or until the next variable change, which rebuilds from `main` regardless of the pin** (measured 2026-09-25 05:41Z). See stage B |
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

**The store half of that table is no longer the moving part; the deployment
is.** Re-measured 2026-09-23 on `b8e4e021`: the hosted ledger was caught up and
the running `pennsync-api` revision was eight commits behind its own directory.
The schema and the service had swapped which one is stale.

**Updated 2026-09-25, and the update is about the mechanism rather than the
number.** The service was redeployed and is current for its own directory. But
the reason it had drifted eight commits was not neglect: **`pennsync-api`'s
Railway source is pinned to a commit and does not follow `main`.** It was
pinned to `f18b0531` from 2026-09-22, with exactly one deployment ever across
94 changed files, which is why nothing merged in between reached it. It is now
pinned to `20c15d8`, kept pinned with the intent that a merge cannot deploy
the service in the middle of a release. So the drift is structural, not
accidental, and the way to close it is a standing step rather than a one-off —
written down in stage B, because the next person to read "just merge it" here
would be wrong.

**That intent does not hold, measured 2026-09-25 05:41Z**, and stage B carries
it: a variable change makes Railway rebuild, and the rebuild takes `main`'s
latest commit rather than the pinned one. So a merge reaches the service at its
next variable change, each release wave is a variable change, and the pin
prevents exactly the case it was kept for only while nobody touches a variable.
Do not move `main` during a release.

The port queue, measured on this tree rather than quoted. The line below is the
tool's own `portQueueLine` and is now pinned by a test, so a change that moves
the queue and leaves this page alone fails the build — the guard AGENTS.md got
in #250 and this page did not:

```
port queue: entity_authorization=7 files=12 external_secret=2 none=78
```

99 carried capabilities, **78 written, 21 blocked** (2026-09-23, after D89, D90
and D91). `records_schema` is absent from that line rather than zero in it,
because `portQueueLine` omits an empty bucket — and that bucket is empty with
every capability in it BUILT, which is the first time. Three of the buckets
below have emptied, one of them twice, and the fourth has shrunk by one:

- `entity_not_carried` **7 → 0** (D84). Three of the seven were in the wrong
  place — two follow D8 to the Hub, one is the read side of the comms domain D7
  carries paused. The other four are carried capabilities with one uncarried
  LEG, now settled per capability in the manifest's `uncarried_legs` block with
  what serves each leg instead.
- `core_integration` **2 → 0** (D86). Both are ported, as the caller gate plus
  the original's own paused answer. That does **not** mean the send was
  released: D56 is untouched, and `SendEmail` is still not a brokered operation.
- `entity_authorization` **8 → 7**. D83 took two out by retiring them — a
  `global` reference table is written by migration, never at runtime — and D84
  put `offboardUser` in, where the measurement always said it belonged. D82
  settled the profile-write path and moved none of them, because all six write
  somebody else's row, a column outside the allowlist, or a payload nothing can
  read.
- `records_schema` **0 → 3 → 0**. D84 moving three capabilities in was the queue
  working rather than regressing: "blocked on a schema" became "its port is not
  written yet", against a store that exists. All three have since been written —
  `distributePolicyAcknowledgment` (D89), `sendExpirationNotifications` (D90)
  and `generateAIReport` (D91). D75 had taken this bucket to zero on a
  *correction*; this is the first time it reaches zero with every capability in
  it built, which is why the count falling is worth reading and the bucket
  vanishing from the line is not.

**No blocker in that list is the record store, and none is another port.** The
remaining 21 are: the administrative profile-write path (7), the file layer (12,
and D85 re-measured that blocker as real — carrying the bytes needs the
integration runtime's authorization model changed), and a transcription vendor
(2, D87).

## 2. The critical path

Seven things gate everything else, in this order. Only the first is free, and
the newest of them — item 3 — is the one that has arrived since this list was
written.

1. ~~**Apply what is already committed to the staging project.**~~ **Done
   2026-09-21**: all 59 outstanding migrations applied to
   `caremetric-pennsync-staging`, 68 recorded in the ledger, the pin landed on
   staging with `source 'default'`. **The ledger has since taken the five
   migrations merged after that and stands at 73 with nothing pending**, read
   from the `hosted-gap` job on `b8e4e021` rather than from the tick. The 59 record migrations are no
   longer unproven against a hosted database; the handlers still are, because
   nothing has served a request yet. Stage B has since deployed them, paused —
   serving one needs an identity, so it is stages C and D.
2. ~~**Create the `pennsync-api` Railway service**, deployed paused, exactly as
   the integration runtime was.~~ **Done 2026-09-22**: live at
   `pennsync-api-production.up.railway.app`, `release: paused`, revision
   `f18b053`, 74 handlers implemented and every one refusing. See stage B.
   **Re-probed 2026-09-23 and unchanged** — the same revision, still paused,
   `authorityConfigured` and `integrationsConfigured` both true. Recorded again
   because this line was read as open work twice on 2026-09-23 and a decision
   card asking the owner to authorize creating it was raised and withdrawn:
   nothing about this service is an ask. ~~**Its staleness has grown and is the one
   number here that moves on its own**~~: it was two commits behind main for its
   own directory when that was written and was **eight** on `b8e4e021`
   (2026-09-23), which was six handler names it did not implement. Stage D's
   deployment probe measures that rather than assuming it.
   **Closed 2026-09-25, and the phrase "moves on its own" was the error.** It
   moved because the service's Railway source is **pinned to a commit** and had
   been deployed exactly once; nothing about a merge reaches it. It was
   repointed to `20c15d8` and redeployed, and that pin is byte-current for
   `services/pennsync-api` against `13821b7`. It will go stale again at the next
   merge that touches the directory, by the same mechanism and not by drift —
   see stage B for the standing repoint.
3. ~~**Redeploy `pennsync-api` from current `main`, before releasing any wave —
   because the running revision cannot report its own app binding.**~~ **Done
   2026-09-25**, and the wording above was wrong in a way worth keeping, because
   it is the wording anybody would write. There is no "from current `main`":
   **the service's Railway source is pinned to a commit**, so a redeploy rebuilds
   whatever commit the pin names. Bringing it up to date is a *repoint* of that
   pin **and then** a redeploy, and it is a **standing step** — it has to be
   done again for every merge you want served. Stage B carries the procedure,
   the outside-observable tell and the rollback.

   The reason the step comes before any wave is unchanged and still the one to
   carry: the OBVIOUS reason was names (`f18b053` implemented 74 of 80, so waves
   4, 5 and 6 were refused against it outright), but the BINDING reason applied
   to **every** wave, the early ones included. `f18b053` predated #247, so
   `/readyz` carried no `appId` and no `appStated`, and the ladder answered "app
   binding: not reported by this revision, so it cannot be checked here" — which
   would have made any release a release against a `PENNSYNC_API_APP_ID` nobody
   could verify, this document's one silent failure. The redeploy is what makes
   it checkable, and it did: the running revision now reports
   `appId: 6a9881683dc68a0bd54f1ef7`, the staging app, which is the value the
   store's own pin requires. **Do not drop this step next time because the early
   waves' names happen to be present** — that is the reading this item exists to
   refuse, and the reason it refuses it is the binding, not the count.

   **The redeploy makes waves 1 to 3 releasable; it does not release them.**
   `PENNSYNC_API_RELEASE` and `PENNSYNC_API_FUNCTIONS` are the flip and they
   are the owner's, and the owner gave that line on 2026-09-25.

   **Waves 1 to 3 are live. Measured by the redeploy thread, 2026-09-25**, and
   these are its readings rather than a summary of them:

   ```
   /healthz  release: enabled
   /readyz   ready: true   released: true   implemented: 80
             appId: 6a9881683dc68a0bd54f1ef7   appStated: true
             operations: listAuthorizedPatients, getAuthorizedPatient,
                         createAuthorizedPatient, updateAuthorizedPatient,
                         listAuthorizedVisits, getAuthorizedVisit,
                         createAuthorizedVisit, updateAuthorizedVisit
   ```

   The waves went **2 → 4 → 8 operations, one at a time, with the service
   re-read after each** — which is the shape to repeat, because it is what
   makes a bad wave attributable to the wave that caused it. `appStated: true`
   beside the staging id is the binding check this document spent two stages
   asking for, answered at last from outside.

   **Wave 4 followed at 2026-09-25 06:16Z**, on the owner's line at 06:14Z, and
   it went out as the ladder's `read-only` value **with the two account-email
   names cut out of it by hand**. Read from outside at 06:18Z, independently of
   the thread that made the write:

   ```
   /readyz   released: true   operations: 29   implemented: 80
             appId: 6a9881683dc68a0bd54f1ef7   appStated: true
             sendAccountReadyEmail: NOT in operations
             sendWelcomeEmail:      NOT in operations
   ```

   29 where the tool emitted 31, and the two missing names were the two that
   matter — the value was the tool's output with both cut out **by hand**. That
   gap is closed: `#267` made the withholding a property of the emitter, so
   `--wave` now emits 29 for this wave and prints a `# WITHHELD` line naming
   each held name and why. The tool and the service agree. **Which wave those
   two names sit in can move** — building their send moves them to
   `integration` — so read the `# WITHHELD` lines wherever they appear rather
   than expecting them under one wave.

   **The writes wave followed at 06:38Z.** Read from outside at 07:00:44Z:

   ```
   /readyz   released: true   operations: 61   implemented: 80
             appId: 6a9881683dc68a0bd54f1ef7   appStated: true
             revision: 75d465a
             sendAccountReadyEmail / sendWelcomeEmail: NOT in operations
             resendInvitation / resendInvitationV2:    in operations
   ```

   61 is exactly what `--wave mutating` emits, so the two now agree at the
   wave as well as at the name. Wave 6, the AI wave, is untouched.

   **Both writes deployed `main`'s head** — `cd48dc1` for wave 4 and `75d465a`
   for the writes wave — the third and fourth times a variable change has
   rebuilt from the tip. The fourth is the sharpest illustration this page has:
   `75d465a` is a change to THIS DOCUMENT, merged twenty minutes earlier, and a
   release wave shipped it. Harmless both times, and checked rather than
   assumed (`services/pennsync-api` is byte-identical across `20c15d8`,
   `cd48dc1` and `75d465a`), but the standing step above is why it was harmless
   and not why it is safe.

   That is a dated reading and not a standing fact: release state is the one
   thing on this page that can change without any commit, so **read it off
   `/readyz` rather than off this page** — `released` and `operations` say what
   is actually being served, and the page cannot.
4. **Enroll real people.** Ten Supabase Auth invitations accepted and verified
   out of band. Nothing downstream of authority can be proved with four
   synthetic actors.
5. **Create the production Supabase project** (D4) and provision it with
   `tools-pennsync-provision.mjs`, the one path that tool was written for.
6. **Move the frontend.** 445 entity call sites, 366 client importers, 41 Core
   integration sites, 83 function wrappers — untouched. This is now the largest
   single body of remaining work in the migration and the least started.
7. **Assemble the evidence packet** until `tools-pennsync-cutover.mjs` reports
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
- Then apply every `supabase/record-migrations/` file, in order — 54 when this
  was written, 59 now.
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

  **Before `5c31d8ae` (#254, 2026-09-23) neither of those lines did anything on
  Windows, and neither said so.** The direct-invocation guard compared
  `import.meta.url` against a `file://` string pasted together from
  `process.argv[1]`, which never matches a backslash path or one holding a
  space, so the tool exited 0 having printed nothing. Twelve CLIs shared the
  defect and six of them are CI gates. It is fixed on `main`; a checkout that
  predates that commit still has it, so **an exit 0 from an older checkout is
  not evidence that anything ran** — check that the plan's JSON actually
  printed. The same change added `* text=auto eol=lf`, because the same
  checkout had been writing `\r\n` into eight Postgres function bodies, which
  the hosted comparison reads through `md5(prosrc)` and correctly failed on.

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

  **The same plan on 2026-09-23 reads `already_applied: 73, pending: [], 1
  skipped, mutated: false`**, with the pin still `6a9881683dc68a0bd54f1ef7` /
  `staging` / `source 'default'`. Read from the `hosted-gap` job's log on
  `b8e4e021`, which is the only place in this repository that can see the
  hosted ledger at all.

  **And merging a migration does not apply it — which cost a day before anyone
  wrote it down (D93).** `planMigration` matches on a file's NAME and the
  ledger holds no content hash, so an ADDED migration leaves `main` failing
  `hosted-store`'s ledger check until an operator runs the `--apply` line
  above, and an EDITED one is skipped on every store that already ran it. The
  `apply-signal` job now says both on the pull request: which migrations
  arrive, that the ledger check will be short by that many rows until the
  apply, and the command. It is a signal and not a gate, because nothing inside
  a pull request can satisfy it.
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
  closed, before it is sent. 15 tests when it was written; **21 on `b8e4e021`,
  21 passed, 0 skipped**, read from the job log on 2026-09-23. A green reading
  of it is dated — the job is what makes hosted drift visible, so re-read the
  log rather than quoting this line.

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
  than an omission.** `record-tenant-isolation`, `activity-audit` and the 45
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

  **Corrected 2026-09-22: "a caller is an `auth.users` row" was true and was
  not the binding constraint, and reading it as one hid what is actually
  missing.** The hosted project already carries four accepted identities —
  real account ids, confirmed emails, none anonymous or banned — each mapped in
  `identity_map` with `expected_email` matching, each with an active
  `membership`, in the fixture's own topology: two admins split across
  `agency-a` and `agency-b`, two clinicians in `agency-a` of which one holds
  the `assignment` on `patient-a1`. `auth.pennsync_local_test_double()` is
  absent, so none of it came from `fixtures.sql`. `identity_map` was never
  empty; nobody looked. The map rows are counted against `actor()`'s own
  predicate — app id, `enabled`, `revoked_at`, `expected_email` against the
  user's current email, `verified_at` in the past — rather than a looser one,
  because that count is what the enrolment claim rests on.

  What `actor()` refuses on is a thing it requires that the plan never named:
  a row in `auth.sessions` whose id matches the caller's `session_id` claim and
  whose `created_at` is **within the last twelve hours**. There are none.
  Measured on the project through the same transport the structural suite uses,
  as `authenticated` with an enrolled subject and a fabricated session id, the
  gate answers `PENNSYNC_SESSION_INACTIVE`.

  **Read that refusal for exactly what it says, which is less than an earlier
  draft of this paragraph claimed.** `actor()` checks `auth.users`
  (`20260919090000_deployment_app_pin.sql:194`), THEN `auth.sessions` (202),
  THEN `identity_map` (211) — the session before the map, not after it. So
  `PENNSYNC_SESSION_INACTIVE` proves the subject cleared `auth.users`, live and
  confirmed and unbanned and not anonymous, and proves nothing at all about the
  map: an unenrolled subject refuses at the very same line. The enrolment is
  carried by the count above and by nothing else. Both together say the session
  is what is missing; neither says it alone.

  **Four gate refusals are therefore measured hosted now**, in
  `hosted-store.test.mjs`: no claims (`PENNSYNC_SESSION_REQUIRED`), an unknown
  subject (`PENNSYNC_IDENTITY_INACTIVE`), `anon` (refused at the grant, which is
  also what proves the role switch takes effect through this transport), and the
  enrolled-subject case above. That is a real slice of claim 4 and it is not the
  whole of it: none of the four reads a row a policy protects, and none of them
  exercises the map, which no caller can reach without a session.

  **Three things stand between here and the rest of claim 4, and only the first
  is the owner's.**

  1. **A live session per caller, which only a sign-in creates.** That needs
     the project's publishable key and a credential for each of the four
     accounts. The twelve-hour window is not a token lifetime and refreshing
     does not move `auth.sessions.created_at`, so a session cannot be held as a
     CI secret: the job has to sign in at the start of each run.
  2. **Seeding, which the record store needs and this transport cannot roll
     back.** `pennsync_records` is empty — 0 patients, 0 visits across all 157
     tables — so every `contract-*` assertion has to create the rows it reads.
     On PGlite that is `db.exec` on a database nobody else has; on hosted every
     request is its own connection, so seed, impersonate, assert and undo must
     be one body, and `assertSingleTransaction` in
     `tools-pennsync-supabase-db.mjs` admits only `begin; … commit;` — never
     `rollback`. `record-tenant-isolation` needs more than that again: it grants
     its caller role table privileges as part of its own setup, which on a
     shared project is a real change to the grant model and is exactly what
     that suite elsewhere proves a deployment must not have.
  3. **The `chart_assignment` row.** The fixture carries two rows for one care
     team — `assignment` for the synthetic patient and `chart_assignment` for
     the chart of record, because D24 authorizes from the second. Hosted has
     the first and not the second, so sixteen suites would read an empty team
     and pass for the wrong reason.

     **And that third one was never a gap, which is worth writing down because
     it was re-proposed as work within the hour.** The two tables count
     different populations: `assignment` keys to `pennsync_private.patient`,
     which holds 3 synthetic rows, while `chart_assignment` names a chart of
     record in `pennsync_records.patient`, which holds 0. Measured on the
     project 2026-09-22: patient 3, assignment 1, chart_assignment 0, records
     patient 0, records visit 0. An empty `chart_assignment` beside a populated
     `assignment` is exactly what a store with synthetic patients and no charts
     must look like — there is no chart for a care team to be on. **Do not seed
     one.** `chart_assignment` is deliberately unkeyed on patient, because a
     chart lives in a schema another role owns, so nothing would refuse a row
     naming a chart that does not exist; and D33's provenance trigger refuses
     every delete and every change to `(id, app_id, agency_id, patient_id,
     membership_id)`, so that row would be permanent.

  **Withdrawn by the owner, 2026-09-22.** The first of those three is off the
  table: no sign-in, no publishable key, no use of the staging accounts. That
  closes the ask rather than deferring it, so the question becomes what claim 4
  can say without a hosted caller at all — and the answer is most of it, by
  composition rather than by a new measurement.

  **What is proved, and where.** Row behaviour is proved against a build whose
  policies and function bodies are proved identical to the hosted project's.
  `http-authority.test.mjs` runs twenty-one scenarios over a real local Supabase
  stack — real GoTrue password sign-ins creating native sessions, PostgREST in
  front, the same four actors in the same topology — and exercises the whole of
  `actor()` including the two legs no hosted test can reach, then tenant
  scoping across two agencies, the assigned and unassigned clinician, care-team
  grant and revoke, membership revocation closing a live session, and logout
  invalidating an unexpired token. The record store's own half is proved beside
  it rather than through that stack: twelve suites run on real PostgreSQL 17 in
  the transactions job — `record-contract-postgres` for the contracts and their
  two-connection races, and the S3, S4, documentation, context, schedule and
  referral suites for the policies — on top of the `contract-*` suites on
  PGlite. Meanwhile
  `hosted-store.test.mjs` compares the hosted store against that same reference
  build over tables, columns, constraints, indexes, triggers, grants, **policy
  `qual` and `with_check` text, and `md5(prosrc)` of every function body** — so
  the predicates whose meaning the local suites establish are the byte-identical
  predicates the hosted project holds, `actor()`'s own body included.

  **What stays unprovable, stated narrowly.** One leg: `auth.sessions` at
  `20260919090000_deployment_app_pin.sql:202`, and everything behind it — the
  `identity_map` step and any read of a protected row on the hosted project. A
  test running as `postgres` cannot satisfy it. The claim is checked against the
  table, not against the JWT, so no arrangement of `set_config` claims reaches
  it; the only way through is to INSERT a row into `auth.sessions`, which is a
  write, is a fabricated Supabase Auth session on a live project, and is exactly
  what `fixtures.sql`'s `auth.pennsync_local_test_double()` guard exists to
  prevent — a guard `hosted-store.test.mjs` now asserts is absent there for this
  reason. It would also prove nothing: a session written by the test satisfying
  a check written in the same repository is not evidence about the environment.
  And do not write this paragraph into the migration, which is the obvious place
  for it: `hosted-store.test.mjs` compares `md5(prosrc)` of every function body
  against the deployed one, so a comment added to `actor()` here turns the
  hosted equality test red until the migration is applied there. The note
  belongs in this document and in the suite header, and it is in both.

  So what remains open in claim 4 is not the behaviour of the rows. It is
  whether Supabase's own Auth issues a session the gate accepts, on that
  project, with those accounts — and the owner has decided not to answer it
  there.

  **Nothing depends on the four enrolled identities.** The hosted suite reads
  them and asserts no count: the enrolled-subject test branches when the count
  is zero and asserts the refusal that case produces, and the prerequisites test
  asserts types and `mapped <= auth_users` and nothing more. So removing the
  accounts leaves all twenty tests green and turns one of them vacuous, which it
  says in its own comment. That is read off the branches rather than measured —
  the zero-enrolment branch has never executed, because the project has never
  had zero — and it is written down as a reading, not as a result.

  **And a correction to the stage's own name for this work.** "Prove the
  committed store" is right; "confirm migrated rows behave correctly" — how the
  claim gets restated — is not, because there are no migrated rows. What was
  migrated in stage A was the DDL. Customer data is stage I, after stage F.
  Whatever runs here reads rows a test seeded minutes earlier.
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
   **0 skipped**, against `caremetric-pennsync-staging` itself. It has kept
   measuring: the same job on `b8e4e021` (2026-09-23) reports 21 tests, 21
   passed, 0 skipped. Note which half
   of the gate carried it: the secrets landed BEFORE the flag was flipped, and
   the measurement ran anyway, because `HOSTED_MEASUREMENT_REQUIRED` governs
   only what an ABSENT credential means and a usable one is measured whatever
   it says. The flag is what stops the job ever silently standing down again;
4. the row-behaviour suites green there — **partly done 2026-09-22, and the
   remainder is now a decision rather than work**. ~~Blocked on stage C, which
   is where the identities come from.~~ ~~What is open is a live session (stage
   C, and only a sign-in makes one), a seed-and-undo transport the record suites
   can use, and the missing `chart_assignment` row.~~ The identities the fixture
   topology needs are already on the project and the four caller-gate refusals
   are measured there. The owner withdrew the sign-in on 2026-09-22, which
   retires the other two with it: a seed transport and a `chart_assignment` row
   exist to serve a hosted caller there is no longer going to be. What the
   suites would have shown is carried instead by the composition recorded under
   "the row-behaviour half" above — behaviour proved locally against policy text
   and function bodies proved identical to hosted's — and the one leg that
   composition does not reach is named there.

**Stage A is therefore open on 4 alone, and nothing in 4 is owed by a person.**
~~The part of 4 that needs a person is narrower than this stage said: a sign-in
for four accounts that already exist, not ten invitations.~~ The owner withdrew
the sign-in on 2026-09-22, so what is left of 4 is not work and not an ask: it
is the single leg named under "the row-behaviour half" above, which no test can
reach on hosted by construction. Three of the four claims are done, the gate
itself is measured hosted, and the drift on the hosted project is watched on
every push to main, which is the condition stage B needed.

### Stage B — Deploy `services/pennsync-api`, paused (size S; owner creates the service, a connected session can redeploy it)

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

**Re-probed 2026-09-23: the same payload, field for field, and that is now the
finding rather than the reassurance.** Same revision `f18b053`, still paused,
still 74 implemented — against 80 in the registry and eight commits touching
that directory since. The payload also carries no `appId` or `appStated`, which
is the visible sign that this revision predates #247 and therefore cannot have
its app binding checked from outside. Which six names are missing, and which
waves they block, is in stage D.

#### Redeployed 2026-09-25 — and the deploy model is a pinned commit

The service was redeployed and its acceptance check passed: **80 capability
names** on `/readyz`, up from 74, and the `appId`/`appStated` pair the old
revision did not carry at all, with `appId` reading
`6a9881683dc68a0bd54f1ef7` — the staging app, which is what the store's D11 pin
on `xxtyweswohkvgkprimwa` requires. That value was **read and never written**.
The service is still `release: paused` and still serving nobody.

Everything in this subsection about Railway itself was measured by a session
holding the Railway connector, through that connector's own read tools. It is
**attributed, not re-derivable from this repository** — nothing in the tree
records what a Railway service's source is pinned to, which is precisely why
the drift below went unnoticed for three days.

**The finding that matters is not the redeploy; it is why one was needed.**
`pennsync-api`'s Railway source is **pinned to a commit**. It does not track
`main`. It was pinned to `f18b0531` from 2026-09-22, and had **exactly one
deployment ever**, across 94 changed files — so every merge to `main` between
those dates built nothing and reached nothing. A plain redeploy would have
rebuilt `f18b0531` again. The pin was repointed to `20c15d8` first, and only
then redeployed.

It is **kept pinned on purpose**, with the intent that an auto-deploying
service cannot rebuild itself in the middle of a release wave on whatever
happened to merge. The cost of that choice is that bringing the service up to
date is a **manual repoint plus a redeploy** — a standing step in this plan,
not a one-off that stage B discharged. Concretely, on any future change you
want served:

1. Merge to `main` as usual. This does not deploy **by itself**, and see the
   next paragraph for why that is not the same as "cannot reach the service".
2. **Repoint the source with `connect-service-source`, naming the commit.**
   This is the step that builds. Pick a `main` commit that `hosted-store` has
   measured green on `main`, since a green run is evidence about the repository
   and the service is what serves.
3. Re-read `/readyz` yourself: the `revision`, the implemented name count, and
   the `appId`/`appStated` pair. Do not take the deploying agent's report for
   it; this stage has been wrong that way once already.

**`redeploy` is not the step that updates it, and that trap cost a run.**
Measured by the redeploy thread: `redeploy` **reuses the existing build**, so
against a pinned source it rebuilds the pinned commit and changes nothing. In
its words, "pushes to main were never going to deploy it and `redeploy` reuses
the existing build, so the briefed operation would not have done the job.
`connect-service-source` with a commitSha is what builds a new one." Brief the
repoint, not the redeploy.

**The pin does NOT hold across a variable change, and that is the correction
this subsection most needs.** Measured by the redeploy thread at 2026-09-25
05:41Z, immediately after setting wave 1's variables: setting a variable makes
Railway rebuild, and that rebuild took **`main`'s latest commit rather than the
commit the service is pinned to** — it picked up the lockfile fix that had
merged minutes earlier. The service was re-read afterwards and nothing
unintended shipped (80 names, the staging binding, the build context
byte-identical), so this is a finding about the mechanism and not an incident.

Two consequences, and the second is the one that bites:

- A merge **does** reach `pennsync-api` — at the service's next variable change
  or rebuild, whenever that happens, not at merge time. "A merge deploys
  nothing" is true only until somebody touches a variable.
- So the pin does not do the job it was kept for. Each release wave is a
  variable change, so **each wave rebuilds the service from whatever `main` is
  at that moment**. That is precisely the mid-release rebuild the pin was
  supposed to prevent. Until that is solved, the operational rule is the crude
  one: **do not move `main` while a release is in progress**, and treat a green
  `main` at the moment of each variable change as a prerequisite of that wave.

**The worst thing a variable write can ship is a migration that has not been
applied**, and the ladder thread named it from outside on 2026-09-25 05:48Z: "a
variable change is also a deploy, so before the next wave I'll check what's
sitting on main first, because a migration merged but not yet applied to the
database would get shipped into a service that expects it." That is the
combination this document has spent two decisions on arriving at once — D93
says merging a migration does not apply it, and the pin finding says a variable
write deploys `main` — so a wave set while an unapplied migration sits on
`main` puts code in front of a store that does not carry its schema.

**The check for it already exists and needs no building.** D93 keeps `main` RED
until an operator applies a merged migration, and applying is the owner's
(`tools-pennsync-migrate.mjs --apply`, §4). So the standing step before ANY
variable write is two readings, not one:

1. **`hosted-store` green on `main`, with the "Measure the hosted staging
   store" step EXECUTED** and `skipped 0`. A run where that step is skipped and
   "Exercise the suite without a hosted target" ran instead is the PR-run
   stand-down: it is green and it says nothing about the store.
2. **The `services/pennsync-api` diff** between the running revision and
   `main`'s tip, since the tip is what the write will build.

**A visible consequence, and how to read it.** The service's RECORDED commit
and the commit it is actually RUNNING disagree: the config still reads
`commitSha: 20c15d8f` while the running revision is `0e262b34`, `main`'s head,
because `set-variables` redeploys and that redeploy re-resolved the branch. It
was harmless here — the redeploy thread checked that `services/pennsync-api`,
the whole build context, is **byte-identical across `20c15d8f`, `13821b7a` and
`0e262b34`** — but the rule it leaves behind is general and worth quoting: "the
config's commitSha is not what runs; `/readyz`'s `revision` is, and a merge
reaches this service on the next variable change whoever makes it." So read the
running revision off `/readyz`, and expect it to differ from the source pin
after any variable write.

**Rollback, and two INFERENCES recorded as inferences rather than as
measurements.** The measured part is the procedure: a rollback is **both
release variables removed, plus a source reconnect to `f18b0531` if the commit
matters.**

What is inferred, because **nobody has tested a rollback**:

- Removing both variables is itself a variable change, so it would presumably
  rebuild from `main`'s tip and could ship whatever has merged since.
- Therefore **do the reconnect AFTER removing the variables**, not before: a
  variable change made after a reconnect would re-resolve to `main`'s tip and
  undo it.

Both follow from the measured behaviour rather than from an observation of a
rollback, and they are the order to follow until somebody tests one. Either way
the standing step is the same and holds for any variable write, a rollback
included: **check what `main`'s tip builds before touching a variable**,
because the tip is what you will get.

**How to tell which model a service is on.** Read the service's source: in the
same Railway project, `PennTrain`'s carries **no** `commitSha` and follows
`main`; `pennsync-api`'s carries one. Two services in one project, two
different deploy models — so "the project auto-deploys" is true of that project
and false of this service, and reasoning from the project rather than from the
service is how this was missed. Note what this costs: reading it needs the
Railway connector or the dashboard, so **nothing outside Railway can tell you
which model a service is on**, and no probe of `/healthz` or `/readyz` can
either — the `revision` field tells you what is RUNNING, never what a redeploy
would build next.

**Rollback for the 2026-09-25 change.** Reconnect the source to `f18b0531` (the
prior deployment `f1e39948-c67e-4a31-bdb7-3abcb9c23a6a` is REMOVED, with
`canRollback: true`; the new one is `ee1848a8-0e1e-43cd-9289-84af0e9622f2`),
**and** remove both release variables if they have been set by then. Both
halves: `PENNSYNC_API_FUNCTIONS` and `PENNSYNC_API_RELEASE` are validated at
startup whether or not the release flag is open, so clearing the flag alone
leaves a name the rolled-back revision does not implement and the service does
not start.

**Who can do this.** The Railway connector is reachable from a session — a
thread started after 2026-09-25 05:02Z has it, and the redeploy above was
carried out that way. A session picks connectors up when it STARTS, so a thread
already running does not gain one. What a connected session may do is read the
service and redeploy it; **creating or deleting anything, and setting the
release variables, stay the owner's**, and the release variables need the
owner's own words naming that operation rather than a relayed summary of them.

**The gate was checked at the request path, not only in the readiness report**,
because a service can report itself paused and still serve. `POST
/v1/functions/{listAgencyRoster,createAuthorizedPatient,analyzeReferral}` each
answer `503 PENNSYNC_API_NOT_RELEASED`, and an unknown route answers `404
NOT_FOUND` rather than a stack trace.

The integration runtime is byte-identical to its pre-stage state — revision
`cffe376`, `release: paused`, `authorityMode: "base44"`, `configured: true`,
`operations: []`. Not redeployed, per the withdrawn bullet above. **One thing
about it is unmeasured and should not be assumed either way**: whether
`pennsync-integrations`' Railway source is pinned like `pennsync-api`'s or
follows `main` like `PennTrain`'s has not been read. It has not mattered yet
because nothing under that directory has changed since `cffe376`. It will
matter the first time something does, so read the service's own source before
concluding a merge reached it.
**Re-measured 2026-09-23 and the withdrawal still holds**: 26 commits have
landed on main since `cffe376` and `git diff --stat cffe376 HEAD --
services/integration-runtime` is still EMPTY. The two services have diverged on
exactly this point — one is current because nothing has changed under it, the
other is stale because a great deal has.

**One thing this stage could not prove, and no longer is.** On the 2026-09-22
revision nothing on `/healthz` or `/readyz` exposed `PENNSYNC_API_APP_ID`, so
the payload was identical whatever it was set to. Since #247 readiness reports
`appId` and `appStated`, and since the 2026-09-25 redeploy the running revision
is one that does: it reads `6a9881683dc68a0bd54f1ef7`, the staging app. The two
cases below are still the two cases — keep them, because they are what a future
redeploy onto a wrong value would produce, and because the second is still the
only silent one. What the probe cannot see splits into TWO cases with opposite failure
modes, and they need different responses:

| At release time | What happens |
| --- | --- |
| **Absent** (unset or empty) | `loadConfig` throws `IMPLICIT_APP_BINDING` and the service does not start. Loud, immediate, and asserted by `api.test.mjs`. |
| **Stated but wrong** (production `694ec16e…` against a store pinned to staging) | Every startup check passes, `/readyz` reports ready, and every authorization call is refused. |

Only the second is silent, and only the second is what the first authenticated
call has to catch. The first announces itself the moment
`PENNSYNC_API_RELEASE` is set, so a service that will not start after a release
is the *good* outcome here, not a regression to debug.

While the deployment was paused neither case was distinguishable from a
correct one, which is why stage C carried the binding rather than this stage.
That deferral is now discharged: the binding is reported and reads staging.

**Exit — met 2026-09-22 for both hosted claims:** `/healthz` alive on both
services; `/readyz` 503 on both with an empty operation set; no traffic change
anywhere. ~~The app binding is deferred to stage C as above.~~ **Closed
2026-09-25 by the redeploy**, which is also what turned this stage's one
undischargeable claim into a readable field.

### Stage C — Real identities (size M; ten people plus an operator)

- Send Supabase Auth invitations; each enrollee accepts their own. The tool
  cannot create a native account and must not be given a way to.
- **This stage now also carries stage A's unfinished half.** The hosted proof of
  tenant isolation — `record-tenant-isolation`, `activity-audit` and the 45
  `contract-*` suites run against the hosted project rather than PGlite — needs
  seeded callers, and a caller is an `auth.users` row that only a real accepted
  invitation can create. Stage A proved the policies bind, arrived intact and
  are unreachable except through the brokers; what it could not prove is what
  any one of them returns to a real person. The publishable key and actor UUID
  map belong to that job, here, rather than to the structural suite stage A
  added.

  **Narrowed 2026-09-22.** Four of those invitations were already accepted:
  four identities are mapped, verified and members, in the fixture's own
  topology, and stage A now measures the caller gate reaching them. The actor
  UUID map is therefore readable from the project rather than owed by anybody.
  Two things are still owed and they are smaller than "ten invitations":
  - ~~**The publishable (anon) key, and a sign-in credential for each of the
    four accounts.**~~ **Withdrawn by the owner, 2026-09-22: the staging
    accounts are not to be used.** Recorded because the reasoning still holds
    for anything that would ask again — `actor()` requires an `auth.sessions`
    row created within the last twelve hours, which is not a token lifetime and
    which a refresh does not extend, so such a session could never be a stored
    secret and the job would have to sign in at the start of every run. Stage A
    claim 4 no longer waits on it; see the composition recorded there.
  - ~~**The `chart_assignment` row for the existing care team.**~~ **Retired
    with the sign-in, 2026-09-23, and the stale copy of it lived HERE while
    stage A above and the ask table below both carried the correction.** There
    is no gap: `assignment` keys to the synthetic staging patients and
    `chart_assignment` names a chart of record in `pennsync_records`, which is
    empty, so an empty second table beside a populated first is what this store
    must look like. Measured on the project 2026-09-22 and **re-measured
    2026-09-23, unchanged**: patient 3, assignment 1, chart_assignment 0,
    records patient 0, records visit 0. The suites that read
    it needed a hosted CALLER, which the withdrawn sign-in was to supply, so
    seeding the row now buys nothing and cannot be undone — the table is
    deliberately unkeyed on patient, so nothing would refuse a row naming a
    chart that does not exist, and the provenance trigger refuses every update
    and delete. **Do not seed it.** It was proposed again within an hour of
    being refuted once; this bullet is why.

  The other six invitations are still this stage's, and so is everything below;
  what changed is that stage A's fourth claim no longer waits on all ten.
- Verify each identity out of band, then run `tools-pennsync-enroll.mjs` with the
  digest-addressed plan. Every run lands in `enrollment_receipt`.
- ~~Retire the four pinned actor IDs in `services/authority-client/client.mjs` in
  favour of verified identity-map rows.~~ **Withdrawn 2026-09-23, on two counts,
  and it needed no enrollee — this was the last item in stage C that did not.**

  Read what `ACTORS` actually does before acting on this bullet. It is not a
  lookup that a derived one could replace: its live use is
  `!ACTORS.has(config.email)` → `INVALID_STAGING_TARGET`, at
  `services/authority-client/client.mjs:166`, so the KEYS are an allowlist of
  which addresses may be configured as the staging caller and the check runs
  **before any request is made**. Deriving that fence from `identity_map` is
  circular: it would read the store to decide whether it may talk to the store.
  The pin two lines below it is the same discipline and its own comment says why
  — "Both values must match exactly; URL shape and caller approval flags confer
  no authority" — so pinning here is the design rather than an omission.

  And the four identities it names are the staging accounts the owner withdrew
  at 2026-09-22 22:26Z. A refactor to serve them more faithfully is work spent
  on accounts that are not to be used.

  What the bullet was really guarding — that the pins could drift from the store
  without anybody noticing — is closed instead by a check.
  `hosted-store.test.mjs` compares `ACTORS` against `identity_map` in both
  directions and is vacuous on an empty project, so deleting those accounts
  leaves it green rather than red. Measured against hosted 2026-09-23: the pins
  and the store's identities agree, and that assertion passed on main in the
  same run that caught the D82 policy gap. That is the cheaper half of this
  bullet and it is already done.
- **Carried from stage B: prove `PENNSYNC_API_APP_ID` on the deployed service.**
  It must be the staging app `6a9881683dc68a0bd54f1ef7`, because the store's
  D11 pin on `xxtyweswohkvgkprimwa` resolved to staging. No probe can see it,
  and the two ways it can be wrong fail differently: an ABSENT value refuses to
  start at all (`IMPLICIT_APP_BINDING`, the moment `PENNSYNC_API_RELEASE` is
  set), while a STATED BUT WRONG one starts, reports ready, and is refused by
  every authorization call. So a service that will not boot after release has
  told you the answer; one that boots and then fails authorization while
  otherwise healthy is the case to check this for, before anything else.
  **"No probe can see it" stopped being true on 2026-09-23**: readiness now
  reports `appId` and `appStated`, and
  `tools-pennsync-release-ladder.mjs --wave <name> --deployment <host>` reads
  them and refuses a release whose binding is defaulted.
  **Discharged 2026-09-25.** The redeploy put a revision that reports those
  fields onto the service, and its acceptance check read
  `appId: 6a9881683dc68a0bd54f1ef7` — the staging app this bullet requires, read
  and never written. The paragraph above stops being the way to tell and becomes
  the way to tell **after the next repoint**, since a redeploy onto a revision
  predating #247 would silence the fields again.
- ~~Give the four tenant roles that can hold context but cannot use it their roster
  behaviour.~~ **Done in the record store 2026-09-23, and it needed no
  enrollee.** The four are `manager`, `office_staff`, `social_worker` and
  `spiritual_care` — the roles `current_patient_context` and
  `current_visit_documentation` exclude, both constraining `tenant_role` to
  `agency_admin` and `clinician`. `contract_roster` already served them (its
  admission is "holds a membership", not a role list), but nothing had ever
  CALLED it as one: every fixture here holds `agency_admin` and `clinician`
  only, and so does hosted staging (measured 2026-09-23: two and two). So two
  branches of a shipped contract were unreachable — the privilege gate's
  `manager` arm and the `is_manager` derivation's, both `in ('agency_admin',
  'manager')`. `contract-roster.test.mjs` now seeds a third agency whose four
  members hold those roles and proves that each of them gets the roster and
  the other agency's refusal, that a `manager` is privileged, and that the
  other three see the working roster with every administrative field null
  rather than absent. Three sabotages fail it: dropping `manager` from the
  privilege gate, dropping it from `is_manager`, and refusing the three
  context-only roles. What is still owed hosted is only the exercise, which
  needs memberships in those roles, which needs identities.
  Note while reading that fixture: the carried `staff_role` admits `nurse`,
  `office_staff`, `social_worker` and `spiritual_care` and has no `manager` at
  all — the job label and the tenant role are different things, and only the
  second decides anything.
- **Decide the synthetic-name question.** `agency` and `patient` names must begin
  `Synthetic ` in every deployment, and `actor()` refuses any non-staging
  deployment outright with `PENNSYNC_STAGING_RPC_SURFACE_ONLY`. That guard is
  correct today and is a hard stop on production. Lifting it is a compliance
  decision about whether this store ever holds real names — not a refactor — and
  it has to be made before Stage F can mean anything.

**Exit:** the two-agency positive and negative matrix from
`docs/PENNSYNC_EXTERNAL_CUTOVER_EVIDENCE.md` passes hosted with real Auth;
`identities`, `isolation` and `revocation` rehearsal receipts producible.

**Nothing buildable remains in this stage** — measured item by item 2026-09-23,
and recorded because "everything waits on the owner" is the kind of claim this
project has had to re-measure before. Every remaining bullet needs an enrollee
or an owner decision. Re-read against the tree on `b8e4e021` later the same day
and unchanged, which is worth one line because this table is the reason not to
go hunting for work here:

| Item | Waits on |
| --- | --- |
| The six invitations | The owner; an enrollee accepts their own |
| Stage A's hosted half (`record-tenant-isolation`, `activity-audit`, the 45 `contract-*` suites) | A hosted caller, which is an `auth.users` row only an accepted invitation creates. Structurally, not merely queued: the sign-in that would drive it is withdrawn |
| `tools-pennsync-enroll.mjs` against real identities | Enrollees. The tool and its suite are built |
| ~~`PENNSYNC_API_APP_ID` on the deployed service~~ | ~~The redeploy~~ **Nothing — closed 2026-09-25.** The service was repointed and redeployed, and its readiness now reports `appId: 6a9881683dc68a0bd54f1ef7`, the staging app. What replaces it is not a wait but a standing step: the source is pinned, so the next merge you want served needs its own repoint (stage B) |
| The four context-only roles' roster behaviour, hosted | Memberships in those roles, so identities. Done in the store and proved locally by #247 |
| The synthetic-name question | The owner. A compliance decision about whether this store ever holds real names, not a refactor |
| The pinned actor IDs | Nothing — withdrawn above as obsolete rather than owed |

The machinery under the exit criteria is already built and does not wait: the
matrix's own cells (`admin_a:A1` … `clinician_a_empty:B1`) are consumed by
`tools-pennsync-cutover.mjs` with a suite over them, and the policy semantics
they assert are proved on PGlite by `record-tenant-isolation.test.mjs`. What is
owed is the hosted EXERCISE, which is a caller away and not a build away.

### Stage D — Release handlers end to end, one at a time (size M)

- **Fix the `agency_id` gap first, and it is seventeen times the documented
  size.** The transition plan names four call sites. That was measured when
  the adapter routed ELEVEN ported names; `PORTED_FUNCTIONS` held seventy-four
  when this was measured and nobody had re-measured. **The routed-name count
  has moved twice more since — 74, then 75, and 80 today — which is the argument
  for reading the gate rather than the table**: `pnpm run check:ported-call-sites`
  prints the live count, and on `b8e4e021` (2026-09-23) it is 80 routed names
  over 73 call sites.

  | | Count |
  | --- | ---: |
  | Ported capabilities `src/` reaches | 54 of 80 |
  | Routed call sites | 73 |
  | …naming a tenant | **3** |
  | …demonstrably not naming one | 33 |
  | …whose payload is a variable, so unreadable | 37 |
  | **Work Stage D has to do** | **70** |

  The 37 are carried with the 33 deliberately: a call site whose tenant cannot
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

  **Updated 2026-09-22: the fragility that remains is real, and this document
  had its failure mode backwards.** It said a future bare
  `getMyTenantContext()` "would refuse on the routed path while the bootstrap
  kept working" — loud, and findable by running the app. Measured against the
  staging fixture it does not refuse. `portedCall`'s fallback, added in the
  bullet above, supplies the bound tenant when a call site names none, so the
  call reaches the service as `{ agency_id: 'agency-a', params: {} }` and
  resolves. What it drops is `expectedMembershipId` and
  `expectedMembershipVersion`, the two values `resolveMyTenantContext` compares
  the answer against — so a revalidation carrying no expectation revalidates
  nothing. It asks what the bound tenant is and is told, which is the question
  it already knew the answer to. The fix for the 67 call sites inverted this
  prediction as a side effect and nobody re-read it, which is D47's and D75's
  lesson in a fourth place: a claim outlived the code it was measured against.

  The adapter is right to serve such a call — it cannot tell a revalidation
  apart from any other ported name, and inventing an expectation would be
  worse — so the invariant belongs at the call sites, and
  `check:ported-call-sites` is not the gate that holds it. That gate counts
  tenant-free payloads and these six call sites are not in its census at all:
  it sees the wrapper's own `invoke` line, not the hooks above it.
  `tools-tenant-revalidation-path.mjs` holds the two shapes the reasoning
  above actually rests on — every revalidation call site passes
  `trustedTenantRequest(...).options`, and the pre-tenant seam keeps its single
  importer, `src/lib/AuthContext.jsx`. Both are invariants rather than counts,
  so there is no baseline to drift: a call that does not carry a trusted
  request fails `pnpm run check:tenant-revalidation` whether it is the first or
  the seventh. `trustedTenantRequest` returning options without an `agencyId`
  was already fenced by `src/lib/trustedTenantRequest.spec.js`; the runtime
  behaviour corrected here is proved in
  `src/lib/independentStagingAdapter.spec.js`.
- **Every call the service makes already resolves on hosted staging — measured
  2026-09-22, and now pinned.** PostgREST matches `/rest/v1/rpc/<name>` by the
  function's name AND the names of the body's keys, and nothing had checked the
  service's side of that: every `pennsync-api` suite stubs the network and every
  contract suite calls its function positionally in SQL, so a parameter renamed
  on one side would have passed everything and surfaced here, as a release that
  refuses every request. Queried read-only against `caremetric-pennsync-staging`:
  all 87 functions the service could call at the time — the authority RPC, the
  audit append, the broker family's list and get, and the eighty contracts —
  are present in `public`, executable by `authenticated`, closed to `anon`, not
  overloaded, and every key the service sends is a parameter while every
  parameter without a default is sent. **That 87 grows with each port and the
  registry now holds 83 contracts**, so it is a dated reading rather than a
  current inventory: the hosted query was a one-off and what keeps the property
  true is the suite below. `services/authority-store/tests/service-rpc-signatures.test.mjs`
  now proves the same at PR time: it captures each capability's real request body
  through its own code path and compares it with `pg_proc` over every migration.
  What Stage D still has to prove is authority, not wiring — a real signed session
  and a released name.
- Then release per function, behind the existing per-name gate: the patient read
  pair, then the create, then the visit family, then the rest by blast radius.

  **That ladder is now derived and checked rather than described.**
  `tools-pennsync-release-ladder.mjs` reads, per handler name, which reviewed
  contracts it reaches, which record migrations that reach NEEDS, whether any
  of them writes, and whether it depends on the integration runtime — and
  `pnpm run check:release-ladder` gates it. The three waves above are declared
  in the tool, because their order is a judgement about blast radius and this
  document is where such a judgement belongs; each is then re-checked against
  the tree, so a declared name that stops being a handler, or a read wave that
  gains a write, fails the build. "The rest by blast radius" is derived:
  read-only, then mutating, then the nineteen that reach the paused runtime.

  | Wave | Handlers | Migrations |
  | --- | ---: | ---: |
  | `patient-read` (declared) | 2 | 3 |
  | `patient-write` (declared) | 2 | 5 |
  | `visit` (declared) | 4 | 5 |
  | `read-only` (derived) | 21 | 16 |
  | `mutating` (derived) | 32 | 30 |
  | `integration` (derived) | 19 | 14 |

  Those six rows are pinned to `checkLadder` by a test, for the reason the port
  queue in section 1 now is: every port since #245 has landed in a DERIVED wave
  and the three declared ones have not moved, so this table drifts on its own
  and nothing used to notice. The counts are each wave's OWN handlers and
  prerequisite migrations; `--wave <name>` emits the CUMULATIVE value an
  operator pastes, which is a longer list.

  `node tools-pennsync-release-ladder.mjs --wave patient-read` emits the
  cumulative `PENNSYNC_API_FUNCTIONS` value and the migrations the target
  deployment must already have applied, so the operator copies a value the
  repository has checked rather than typing one.

  **The two account-email capabilities have MOVED out of `read-only`, and D92
  is why the move could not be forgotten (D97).** `sendAccountReadyEmail` and
  `sendWelcomeEmail` sat in that wave while each refused
  `OUTBOUND_DELIVERY_RELEASE_PAUSED` before reaching an integration — honestly,
  because the shipped code really did send nothing. They now send, so both take
  `integration`, both carry `needsIntegration: true`, and the ladder places them
  in `integration`: read-only 23 → 21 and integration 17 → 19 in the table
  above. That is the cross-check working as designed rather than a renumbering.
  `account-email.mjs`'s header had been promising for two ports that a release
  deleting those refusals must move the flag in the same change, and nothing
  asked until the ladder crossed the flag against whether each handler's
  `handle` destructures `integration` at all, in BOTH directions. A change that
  released the sends while leaving them in the wave whose whole promise is that
  nothing in it sends now fails the build.

  **What still keeps them out of every value is the emitter, not the wave.**
  `OWNER_HELD` withholds both names from the per-wave and the cumulative value,
  prints why beside it, and refuses a value carrying one, so the move between
  waves changes nothing an operator can paste. And the send has a switch of its
  own, separate from `PENNSYNC_API_RELEASE`: `PENNSYNC_API_DELIVERY=enabled-v1`,
  read exactly and untrimmed, without which `SendEmail` is not in the brokered
  set at all and both senders answer 503 as before.

  Mail also needs the integration runtime's side, and that is a build rather
  than a switch: the runtime is unreleased and its operation list is EMPTY, so
  `SendEmail` has to join `INTEGRATIONS_ALLOWED_OPERATIONS` as well. Whether its
  SendGrid key is already usable is **not** answerable from `/readyz`:
  `missingProviders` is `config.operations.filter(...)`, so an empty operation
  list yields an empty answer whatever keys exist, and reading that as "the
  provider is configured" is this page's own recurring defect — an empty answer
  over an empty input. `preflight.mjs` really does call
  `api.sendgrid.com/v3/scopes` and check for `mail.send`, but only when
  `SendEmail` is on the list. So the provider question is settled by a variable
  read or a preflight run, and not before.

  One thing that must be deliberate when `SendEmail` does join that list: it
  must NOT join the browser list. `INTEGRATIONS_ALLOWED_OPERATIONS` is the
  ceiling for `INTEGRATIONS_BROWSER_OPERATIONS`, which is why an empty service
  list makes the browser route impossible today rather than merely closed.

  **What the release gate cannot refuse is the reason this exists.**
  `loadConfig` already rejects a name that is not in the registry, a duplicate,
  a release with no authority and a release with no stated app — all loudly, at
  startup. It cannot see whether the target STORE carries the contract the name
  reaches. Release `createAuthorizedPatient` against a deployment that has not
  applied `20260920110000_claim_new_chart.sql` and every startup check passes,
  `/readyz` reports ready, and each create fails inside the store: the same
  silent shape as a stated-but-wrong `PENNSYNC_API_APP_ID`, which this stage
  already singles out for exactly that reason. So a wave's prerequisites are
  the whole CALL CLOSURE of its contracts, not the migration each contract is
  written in.

  **The mirror of that gap is the deployment, and it bit on the first probe.**
  The ladder derives its names from committed source; the running service
  answers from the revision it was built at. Re-probed 2026-09-23 on
  `b8e4e021`: revision `f18b053`, release `paused`, **74 handlers implemented
  against the ladder's 80**. That gap was one name when this paragraph was
  written and had become six, which was the part to act on:

  | Missing from the 2026-09-22 revision | First wave it blocked |
  | --- | --- |
  | `generatePatientHandout`, `sendAccountReadyEmail`, `sendWelcomeEmail` | `read-only` |
  | `distributePolicyAcknowledgment`, `sendExpirationNotifications` | `mutating` |
  | `generateAIReport` | `integration` |

  **Closed 2026-09-25**: the service was repointed to `20c15d8` and redeployed,
  and `/readyz` now reports 80 names. But read the mechanism rather than the
  number, because the number will be wrong again. **The gap did not widen with
  every port — it widened with every port after the one the source pin names**,
  and the pin only moves by hand (stage B). The table above is therefore a
  worked example of a recurring condition, not a closed item: before releasing
  any wave, drive `--wave <name> --deployment https://<host>` against the live
  service and read what it answers, rather than reading this table.

  Note also what the six names were, because it bears on wave 4:
  `sendAccountReadyEmail` and `sendWelcomeEmail` are now **present on the
  running revision**, which they were not before. They are refusal-only — they
  authorize the caller and then answer `OUTBOUND_DELIVERY_RELEASE_PAUSED` — so
  their presence changes nothing about what the service sends. It does mean the
  name check no longer keeps them out of a release value, so the only thing
  keeping them unreleased is what the operator pastes, and §4's
  `Core.SendEmail` row is the decision that governs it.

  **Wave 4 was released on 2026-09-25 at 06:16Z with both names cut out of the
  value by hand**, so for a few hours the exclusion protecting that hold lived
  nowhere but in what an operator typed: the ladder still emitted both names,
  and D92's guard is a build-time check on `needsIntegration` that cannot see a
  pasted value.

  **`#267` moved it into the emitter.** `--wave` now withholds both names from
  every value it emits and prints a `# WITHHELD` line carrying the reason, so
  the tool's output is the value — do not edit it. Re-deriving a wave, or
  composing a later one, can no longer release them by accident.

  **`#268` then closed the route that gate could not see.** D92 asks whether a
  handler destructures `integration`, which is the brokered route; D42 records
  that the invitation capabilities' original send had no successor at all,
  because Base44's `inviteUser` minted the account and delivered the link. The
  plausible successor is a **Supabase Auth call**, which never touches
  `integration` — so a handler that gained one could have shipped under a name
  already sitting in a live value with nothing in the build firing.
  `authSendReach` now scans the whole service for the five Auth calls Supabase
  mails on, and `authSendHolds` refuses in both directions: an undeclared
  reach, and a declaration whose reach has gone. `AUTH_SEND_DECLARED` is empty
  today, and that is a measurement rather than a placeholder.

  **The check after a write is that `operations` GREW**, not merely that it is
  non-empty. `#268` also renamed the per-wave `functions` field to `adds`,
  because it held that wave's own names while `--wave` prints the cumulative
  value and consecutive waves share none: composing a release from the field
  would have set the new wave's names and **silently revoked every name already
  serving**. That is the wave-4 finding from the other side — the operator's
  paste is the control — so read the count back, not just the state.

  Driven against the live service rather than reasoned about: `--wave visit
  --deployment https://pennsync-api-production.up.railway.app` answers "this
  revision implements every name above", and `--wave read-only` answers
  "REFUSED: this revision does not implement generatePatientHandout,
  sendAccountReadyEmail, sendWelcomeEmail".

  **Read that answer for what it checks, which is names.** It was tempting to
  conclude that waves 1 to 3 could therefore be released against the 2026-09-22
  revision and only the later ones needed a redeploy. **They should not have
  been, and the reason was the binding rather than the names.** That revision
  predated #247, so its readiness reported no `appId` and no `appStated` and the
  probe said so in as many words: "app binding: not reported by this revision,
  so it cannot be checked here". A release onto it would have been a release
  against a `PENNSYNC_API_APP_ID` nobody could verify from outside — and a
  stated-but-wrong binding is the one failure this whole document singles out as
  silent: the service boots, reports ready, and is refused by every
  authorization call. The redeploy is what makes the binding checkable at all,
  so **it comes first, before any wave**, and the name gap is the second reason
  rather than the first. That ordering held on 2026-09-25 and holds again after
  every future repoint; it is a rule about the sequence, not a note about one
  stale revision, and it was followed: the redeploy came first, then the waves.
  **Measured by the redeploy thread 2026-09-25 05:43Z, after all three waves:
  `release: enabled`, eight operations serving, still bound to the staging app
  id, and one commit through all three waves.** Date any successor to this
  sentence the same way and read the current state off `/readyz`. Pasting a refused wave's value is
  `INVALID_FUNCTION_RELEASE` at startup, which is a crash loop rather than a
  refusal an operator can read. So `--wave <name> --deployment https://<host>`
  reads `/readyz` and refuses three things before an operator sets anything: a
  name the revision does not implement, a value BEHIND the deployment (the
  waves are cumulative, so an earlier wave pasted over a later one revokes what
  is being served), and a startup throw the payload already predicts —
  `INCOMPLETE_AUTHORITY_CONFIGURATION`, `INTEGRATIONS_NOT_CONFIGURED` for a
  wave that needs the paused runtime, and `IMPLICIT_APP_BINDING`.

  **On release state, believe the service and not this page.** Every statement
  here about what is released is a reading with a date on it, because the two
  release variables change what is served without changing a commit — so a page
  merged hours later can be accurate about the code and wrong about the
  service. `/readyz`'s `released` and `operations` are the answer.

  That last one needed the service to say something it did not: readiness now
  reports `appId` and `appStated`, so the binding this stage calls out as
  silent can be compared against the store's own pin BEFORE a release. Neither
  id is a secret — both are literals in `runtime.mjs` and one ships in the SPA
  bundle. The probe reads both as OPTIONAL, because the running revision
  predates them, and an absent binding is reported as unreported rather than
  cleared: demanding it would refuse exactly the deployment the check is for.
  The probe is opt-in and read-only; `check:release-ladder` still reaches no
  network.

  **The store side of every wave is applied, measured rather than assumed.**
  The union of `patient-read`, `patient-write` and `visit` is ten prerequisite
  migrations, and all ten are in `caremetric-pennsync-staging`'s ledger — as is
  everything the later waves need, because the ledger has nothing pending at
  all (`already_applied: 73`, read from the `hosted-gap` job on `b8e4e021`,
  2026-09-23). ~~**The store is no longer what holds any wave back; the running
  revision is.**~~ **Neither does, as of 2026-09-25**: the ledger has nothing
  pending and the running revision implements every name. What holds the waves
  back is the owner's word on the two release variables, and — for every wave
  after a future merge — the source repoint in stage B.

  The check took one correction to be
  usable: the ladder printed FILE names while
  `supabase_migrations.schema_migrations` keys on the file's whole STEM, so an
  operator comparing the two matched nothing. It now prints both, taking the
  ledger form from `tools-pennsync-migrate.mjs`'s own `ledgerVersion` rather
  than reproducing it.

  Measured the same day, for the record of what a release would actually serve:
  the only PennSync Supabase project that exists is `caremetric-pennsync-staging`
  (`xxtyweswohkvgkprimwa`), and its `pennsync_private.deployment` pin is
  `6a9881683dc68a0bd54f1ef7` — the staging app, not this service's default. So
  a release on that service is a STAGING release, whatever Railway's default
  environment is named, and it needs `PENNSYNC_API_APP_ID` set to that id or
  every authorization call is refused. The production store of the critical
  path's item 5 does not exist yet.

  Two things about the write classifier are worth carrying, because both drafts
  of it were wrong in opposite directions. It first matched
  `update\s+"?pennsync\b`, which never fires against the store's own
  `update "pennsync_records"."patient_alert"` — `_` continues the word — so
  `contract_alert_update`, whose body is four update statements, read as
  read-only. It then took each function's body as everything up to the next
  definition, which swept in the migration's own statements, so
  `20260920050000_patient_purpose_policy.sql`'s backfill made every patient
  READ contract look like a write and the declared read wave was refused. A
  name-shape check catches the first kind and cannot catch the second, so the
  body is bounded by its dollar quotes and the false-write case is pinned by
  its own test.
- Each release wants its own hosted proof, not a suite that passed locally.
  **Unchanged, and still owed to stage C**: a hosted proof needs a signed-in
  caller, and the ladder above says only what a release DEPENDS on, never that
  it has been exercised against hosted staging.

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

**Corrected 2026-09-25: this is a BUILD, not a switch, and the table below was
missing the variable that matters most.** The release thread read the deployed
runtime rather than its health line and found `operations: []` with
`authorityMode: "base44"` — so releasing it would release nothing, and flipping
the `pennsync-api` side alone would advertise 78 capabilities while the 17 that
reach this runtime fail on every call. That is this document's own
healthy-looking-but-false shape, and it is why the AI wave is not one variable
write.

**`INTEGRATIONS_ALLOWED_OPERATIONS` decides what this service serves, and this
page did not name it.** It belongs in the table below and is listed there now.
Two things about it are load-bearing:

- **It is the only guard on outbound mail anyone here can confirm.**
  `runtime.mjs:69` counts `SendEmail` a missing provider only when the SendGrid
  key or the sender address is absent, and `SENDGRID_API_KEY` and
  `NOTIFICATION_FROM_EMAIL` are both **present on the service as names**. That
  is all that has been read: `list-variables` answers with names and
  `valuesRedacted: true`, so **nobody here has seen either value.** An empty or
  revoked key would be a second lock — but an unchosen one that nothing
  observes, so it is not a control and must not be planned around. Treat this
  variable as the whole guard, set it to exactly the operations the wave needs
  and nothing else, and do not tell anyone either that a working mail account
  is in place or that one needs buying until somebody has a reading behind it.

  **The counter-example is on this same service.**
  `INTEGRATIONS_ALLOWED_OPERATIONS` is itself present as a name with an
  **empty** value — which is exactly why the AI wave is a build rather than a
  switch. So here, on this service, "the name is set" has already been proved
  not to mean "the value is usable". This page said the mail credentials were
  set and drew a conclusion that only their values could support; that is the
  same one-representation mistake, two paragraphs apart.

  **Two readings that look like evidence about provider keys and are not.**
  `missingProviders` filters `config.operations` (`runtime.mjs:67`), so it is
  empty whenever that list is empty, whatever the keys hold. And `configured`
  (`runtime.mjs:46-48`) wants the Supabase URL, the service-role key and two
  distinct 64-hex keys, and names no provider key at all.
- **It is a CEILING on the browser surface, not a parallel list.** Releasing
  the service does not expose it to the browser app: `app.mjs:44` refuses a
  browser request unless `INTEGRATIONS_BROWSER_RELEASE` is `enabled-v2` — note
  the **v2**, so copying the service flag's `enabled-v1` does not turn it on —
  and `INTEGRATIONS_BROWSER_OPERATIONS` is non-empty, and `app.mjs:64` refuses
  any operation outside that list. `runtime.mjs:19-20` then requires the
  browser list to be a **subset** of this one or startup throws
  `INVALID_BROWSER_OPERATION_CONFIGURATION`. So capping this variable at the
  two AI operations caps the browser at those two as well, even if somebody
  later sets both browser variables.

**What is left is five variables on the Railway runtime, set together:**

| Variable | Value | Where it comes from |
| --- | --- | --- |
| `INTEGRATIONS_ALLOWED_OPERATIONS` | exactly the operations that wave needs | see above — this is the mail guard and the browser ceiling |
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

**The shape is shared; the GATE is not, and the error name is the same in both
services.** Here `IMPLICIT_APP_BINDING` fires on `authorityMode ===
'independent'` (`integration-runtime/runtime.mjs:45`), so a runtime left in
`base44` mode with no app id boots whatever the release flag says. On
`pennsync-api` it fires on being **released** (`pennsync-api/runtime.mjs:65`),
which is why Stage B's passage says "the moment `PENNSYNC_API_RELEASE` is set".
Both passages are correct as written; do not carry either condition across to
the other service when editing one.

Safe to do now: the runtime is released to nobody (`INTEGRATIONS_RELEASE` unset),
so the change alters readiness and nothing else, and removing
`INTEGRATIONS_AUTHORITY_MODE` reverts to the Base44 default. **That safety is
about the four authority variables, not about the operation list** — adding an
operation to `INTEGRATIONS_ALLOWED_OPERATIONS` is what makes the service able to
do the thing, and for `SendEmail` the provider behind it may well be live; plan
as though it is, because nothing here can check.
Railway is no longer out of reach of a session (see §4), but this service is
owned by the release thread and its writes wait on the owner's words.

**Why "set together" is mechanical rather than tidy: `loadConfig` THROWS.**
It does not report itself unready — five distinct errors between
`runtime.mjs:31` and `:45` (`INVALID_AUTHORITY_MODE`,
`INVALID_AUTHORITY_TARGET`, `INVALID_AUTHORITY_KEY`,
`INCOMPLETE_AUTHORITY_CONFIGURATION`, `IMPLICIT_APP_BINDING`) each stop the
service booting. Written one at a time, the service is **down** between the
writes, not merely unready. `INTEGRATIONS_RELEASE` is a plain string equality
(`runtime.mjs:53`) and cannot throw. So the call that can take the service down
is the config call, and it is the one made while nothing is released — which is
the order to keep.

**And know what `ready: true` will mean afterwards: configured and released.**
It does not mean one AI call has succeeded. `missingProviders` filters
`config.operations` (`runtime.mjs:67`), so once the operation list is populated
the Anthropic check becomes real and reduces to `!config.anthropicKey` —
`config.model` defaults to `claude-sonnet-4-6` at `runtime.mjs:55` and is never
empty — but a present key can still be a revoked one, and proving the authority
round trip needs a login, which is out of reach (§4). Expect a first real call
to be the proof, and do not let a green readiness line stand in for it.

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

### Stage G — The last 21 ports (size M, parallel to D and E)

**Measured 2026-09-23: the startable side is at ZERO, and the count of what is
left has fallen twice since this heading was written — 31, then 24 after D82 to
D87, then 21 once D89 to D91 wrote the three ports those decisions unblocked.**
`tools-transition-disposition.mjs` reports 78 capabilities with no blocker, and
all 78 are registered in `services/pennsync-api` — so every port that *can* be
written without a decision has been. The heading said 31 and says 21; read
`pnpm run check:transition-disposition` rather than either. Four buckets the
queue used to report are empty: `records_schema` (D75 on a correction, then
D84 refilled it and D89 to D91 emptied it again by building all three),
`ported_function` (D76), `entity_not_carried` (D84) and `core_integration`
(D86).

Re-derive that from the registry rather than by searching for quoted names: a
first pass here looked for each capability as a quoted string and reported 18
outstanding, because `handlers.mjs` registers them as bare object keys. The
answer was 0. That is D47's lesson once more — read the shape from the tree.

Re-measured after D82 to D87 (2026-09-23), which settled every decision this
table was waiting on, and again after D89, D90 and D91 wrote the three ports
those decisions unblocked. **What is left is no longer "ports that are simply
not written yet"** — that bucket is empty. It is the file layer, seven
administrative write paths, and a vendor key.

| Blocker | Count | What it needs |
| --- | ---: | --- |
| `files` | 12 | Stage H, and one decision that is not this repository's. D85 re-measured D77 and it holds: the integration runtime serves a stored object only to its uploader, and a migrated object has no uploader. The mapping, resolver and planner are built; the bytes are not copied. Four different things in one bucket — 2 wait only on the reader model, 5 need the copy and the reader model, 5 have a write leg that needs neither, and 1 has two further blockers |
| `entity_authorization` | 7 | Ports to write, not decisions. D82 settled D23's open profile-write path at the caller's own row, and these are the seven admin and scheduled paths it deliberately does NOT reach: `autoApproveInvitedUser`, `autoEndDutyDay`, `enforceStaffRoleIntegrity`, `offboardUser`, `setNurseDutyStatus`, `userManagement`, `userManagementV2`. D83 took the two `MedicareGuideline` writers out of this bucket by retiring them: a `global` table is written by migration |
| ~~`records_schema`~~ | 0 | **Emptied by D89, D90 and D91.** The three capabilities D84 kept as `port` with an uncarried leg — `distributePolicyAcknowledgment`, `sendExpirationNotifications`, `generateAIReport` — are all written. D75 had taken this bucket to zero on a correction; this is the first time every capability that was in it has been built. Note that `portQueueLine` omits an empty bucket, so it no longer appears in the measured line at all |
| `external_secret` | 2 | A new brokered operation for audio transcription, with the reservation, quota, encrypted result and audit the other seven have — over a PHI payload. Designed in D87; the key stays unwired, and `generateNoteFromRecording` has two further blockers that no key clears (the owned bucket's MIME set admits no audio, and it pins a model the broker does not accept) |
| ~~`entity_not_carried`~~ | 0 | Settled by D84. Three changed destination, four stayed `port` with the leg recorded in `uncarried_legs` |
| ~~`core_integration`~~ | 0 | Emptied by D86, which ported both capabilities as the caller gate and the D56 pause. Releasing `Core.SendEmail` is now a flag flip rather than a build, and it stays the owner's |

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

Nothing in Stages C, F or L can be done from the repository, and stage D now
has one Railway action of its own (Stage B's creation row is settled — see
below). One correction to the premise of this whole section, 2026-09-25:
**Railway itself is no longer out of reach of a session.** A thread started
after 2026-09-25 05:02Z holds the Railway connector and can read the services
and redeploy them, and the redeploy in stage B was carried out that way — so a
row here is owed to the owner because of what it COSTS or COMMITS (money, a
release, a message to a real person), not because nobody else can press the
button. Listed plainly so none of it sits waiting on a misunderstanding:

**The owner gave a direction on both remaining decisions on 2026-09-25.** At
06:35:37Z he was told, in these words, that "only two decisions are left, and
both are yours: turning on the AI features, which send data to an outside AI
provider, and sending email or invitations to real people." At 06:40:12Z he
answered:

> turn on everything

**Read that as the direction it is, not as a switch.** The working practice in
this project is that each switch takes his words naming THAT switch — which is
why the writes wave, which he named, went out at 06:38Z, and the AI wave, which
he has not, has not. A general yes is what removes the question; it is not the
line that sets a variable. Keep bringing each one as a single line, and record
the line beside the change it authorized.

**He then answered the outside-provider question on its substance**, at
07:07:29Z:

> Patient and clinical text may go to an outside provider

That is the AI hold answered, and it is the one this page had carried longest.
What it leaves is engineering, not a decision: the release thread's reading
below shows the runtime is not built to serve those operations yet.

**Invitations took a different shape rather than a yes.** Delivering one as a
plain message would have meant putting a privileged Supabase key in the
integration runtime, which D49 refuses by design. The decision taken instead,
2026-09-25, is to **build an acceptance flow** for invited people — ours to
build, no privileged key, and the send that follows it stays behind its own
switch and his words. #268's whole-service Auth-send ratchet is what will hold
that flow to it.

| Needed | For | Note |
| --- | --- | --- |
| ~~Approval to run the migrate tool's write path against hosted staging~~ | Stage A | **Granted and run 2026-09-21.** 59 migrations applied, 68 recorded, pin on staging with `source 'default'`. The hosted-target CI job is added and its structural suite is green against the real project. When this row was written the stage's exit still lacked TWO things: the job actually measuring in CI, and the row-behaviour half. The first was closed on 2026-09-22 by the row below; only the second is open. It moved to stage C for identities, and on 2026-09-22 the identities turned out to be largely there already. ~~What it waits on is a sign-in, a seed transport and one `chart_assignment` row.~~ The owner withdrew the sign-in the same day, which retires the other two with it; claim 4 now rests on the composition recorded in stage A |
| ~~Add `PENNSYNC_STAGING_DATABASE_URL` and `SUPABASE_ACCESS_TOKEN` as repository secrets, and set `HOSTED_MEASUREMENT_REQUIRED` to `true` in the same change~~ | Stage A | **Done 2026-09-22 (#237).** Both secrets are configured and the flag is `'true'`. The job log shows both masked and then 15 tests, 15 passed, 0 skipped against the real project — read from the log rather than from the green tick, which is what this gate exists to distrust. The committed store's drift is now watched on every push to main |
| ~~Create the `pennsync-api` Railway service~~ | Stage B | **Created 2026-09-22.** Live at `pennsync-api-production.up.railway.app`, paused, revision `f18b053`, 74 handlers implemented and every one refusing `PENNSYNC_API_NOT_RELEASED`. The integration runtime was correctly left alone. ~~One setting no probe can confirm — `PENNSYNC_API_APP_ID` — is carried to Stage C~~ **That setting is now reported and reads the staging app**, since the 2026-09-25 repoint and redeploy put a post-#247 revision on the service |
| ~~**Redeploy `pennsync-api` from current `main`**~~ **Repoint the pinned source commit, then redeploy — every time** | Stages B and D | **Done once, 2026-09-25, and it is a standing step rather than a discharged one.** It was the live blocker for two reasons, the second binding: `f18b053` implemented 74 of 80 names, and it predated the readiness fields that report the app binding, so **every** wave pasted onto it would have released against a `PENNSYNC_API_APP_ID` no probe could check. Both closed — `20c15d8`, 80 names, `appId` reading the staging app. **It is no longer the owner's alone**: a session holding the Railway connector can repoint and redeploy, and one did. What stays the owner's is creating or deleting anything, and setting `PENNSYNC_API_FUNCTIONS` and `PENNSYNC_API_RELEASE`. What recurs is the repoint: the source is pinned on purpose, so a merge does not deploy by itself — but measured 2026-09-25 05:41Z, **the pin does not survive a variable change**, which rebuilds from `main`'s latest commit, so each release wave redeploys the service from whatever `main` is at that moment. See stage B |
| Cost approval and creation of the production Supabase project | Stage F | D4: dedicated, us-east-1, not `CM Train` |
| Set the four `INTEGRATIONS_AUTHORITY_*` / `INTEGRATIONS_APP_ID` variables on the Railway runtime | Stage E | The code is done and tested (111/111); this is the whole of Stage E now. `INTEGRATIONS_APP_ID` must be the **staging** id `6a9881683dc68a0bd54f1ef7` — the production id boots and then refuses every call. Reversible, and the runtime serves nobody |
| **Correct the Google Play Data Safety declaration** | **Today** — independent of every stage | Live listing says "No data collected" and "No data shared with third parties" for an app handling clinical data. A policy violation that can draw enforcement against the listing. A Play Console form — needs no key and no binary, so nothing else here blocks it |
| Ten Supabase Auth invitations accepted, each verified out of band | Stage C | The enrollment tool cannot and must not do this. **Four are already accepted, mapped and verified as of 2026-09-22**; six remain |
| ~~The publishable (anon) key and a sign-in credential for the four accepted accounts~~ | ~~Stage A claim 4, Stage C~~ | **Withdrawn 2026-09-22 — the owner declined to use the staging accounts.** Nothing is owed here. Stage A claim 4 stands on the composition recorded in that stage instead, and the one leg it cannot reach is named there |
| A decision on whether the owned store ever holds real names | Stage C, F | Today every deployment refuses a real agency or patient name, and production serves no RPC |
| A decision to broker `Core.SendEmail` | Stage G | **Releases** rather than unblocks, since D86 (2026-09-23). The 2 capabilities whose whole body is the send are written and gated — `sendAccountReadyEmail` and `sendWelcomeEmail` authorize the caller and then refuse `OUTBOUND_DELIVERY_RELEASE_PAUSED`, as the email action of a third does (`generatePatientHandout`, whose document half is ported, D81). The runtime already implements it. What the yes still costs is named in `services/pennsync-api/account-email.mjs`: broker `SendEmail`, carry the field checks and the renderer that the pause makes unreachable, and delete the two refusals — **plus, since D92, move both capabilities out of the `read-only` release wave in the same change, which the ladder now refuses to let a change skip** |
| ~~Dispositions for 7 capabilities on retiring domains~~ | Stage G | **Settled by D84 (2026-09-23), and the description of them was wrong.** Measured, the 7 split 3 and 4. Three belong to a retiring domain and change destination: `analyzeNurseDeficits` and `analyzeRealTimePerformance` to the hub, `getCommsDashboard` to preserved-paused. The other four — `distributePolicyAcknowledgment`, `generateAIReport`, `offboardUser`, `sendExpirationNotifications` — are carried capabilities that touch one uncarried entity in passing, so they stay `port` with that leg settled by name and reason in `tools-transition-disposition.json`'s `uncarried_legs`, which the tool re-checks against the tree rather than trusts. None of the four leaves the queue: each moves on to its next real blocker. `fetchMedicareGuideline` and `scheduledGuidelineSync` also stop being carried, but that is D83 and they were never in this bucket |
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
