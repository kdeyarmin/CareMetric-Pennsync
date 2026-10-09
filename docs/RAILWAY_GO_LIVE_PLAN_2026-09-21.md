# Railway go-live: measured state and the remaining plan

Date: 2026-09-21
Last re-measured: **2026-09-25 against `13821b7`** for the tree and the
Railway services; **2026-09-23 against `b8e4e021`** for the CI job logs on
`main` and the hosted store. Most Railway readings on 2026-09-25 were taken by
a session holding the Railway connector and are attributed as such below — a
variable's value, a deploy's trigger and a service's settings cannot be
re-derived from this repository, by this page's author or by you. **The
readings after the 09:40Z mail switch are the exception and are weaker
evidence of a different kind**: they are unauthenticated `GET /readyz` calls
on each service, made by this page's author, so they report what the service
publishes about itself rather than what its settings say. That is the right
tool for "is the capability on" and the wrong one for "which variable turned
it on".
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
| `pennsync-integrations-production.up.railway.app/healthz` | `{"status":"alive","release":"paused","revision":"cffe376…"}` | Deployed and healthy, released to nobody. **Now `release:"enabled"` on `38cb0be` — released 2026-09-25 `08:19:25Z`** |
| same host `/readyz` | HTTP 503; `released:false`, `operations:[]`, `authorityMode:"base44"`, `base44ExecutionDependency:true`, `trafficCutoverVerified:false`, `browserReleased:false` | Zero of seven brokered operations enabled; still asks Base44 who the caller is. **Re-read 2026-09-25 at `08:23Z`, and this line is now history: HTTP 200, `released:true`, `operations:["InvokeLLM","ExtractDataFromUploadedFile"]`, `authorityMode:"independent"`, `base44ExecutionDependency:false`, browser route still shut — see stage E for the whole body.** **And that reading is history too: after the owner's 09:40:32Z mail line, `operations` is those two plus `SendEmail`, with `browserOperations:[]` and `browserReleased:false` unchanged. Two re-reads in ninety minutes is the rate this field actually moves at** Do not watch `trafficCutoverVerified` for a `true` — it is a literal `false` at `integration-runtime/runtime.mjs:79` and `pennsync-api/runtime.mjs:134`, assigned nothing else anywhere, so it is not a signal |
| `pennsync-api-production.up.railway.app/healthz` | HTTP 404, `Application not found` | The service does not exist. **Created 2026-09-22: HTTP 200, `release:"paused"`, revision `f18b053`. Redeployed 2026-09-25 onto `20c15d8`: still `release:"paused"`, 80 capability names, and an `appId`/`appStated` pair the old revision did not carry — see stage B** |
| `app.caremetricai.com/` | HTTP 200 | Base44 |
| `caremetricai.base44.app/` | HTTP 200 | Base44 |
| Supabase account project list | `CM Train`, `caremetric-pennsync-staging`, `PennPaps`, `CareMetric Support Hub`, `bolt-native-database-62871816` | **No production project** |
| `caremetric-pennsync-staging` migration list | 9 versions, newest `20260918204105` | Five authority migrations behind; **no record store at all**. **Closed later the same day: 59 applied, 68 recorded — see stage A. Re-read 2026-09-23 from the `hosted-gap` job on `b8e4e021`: `already_applied: 73`, `pending: []`, one skipped by name.** **And read again on 2026-09-25 after the owner applied #279's migration from his own machine at about `18:18Z`: 74 rows, the new `20260920600000_locally_verified_identity` newest, nothing pending, the same one still skipped by name.** That last reading is the applying session's, taken from the database rather than from CI, and the arithmetic agrees from here: 75 migrations are pinned (16 authority, 59 record) and `LOCAL_ONLY_MIGRATIONS` holds exactly one back |
| `node tools-pennsync-cutover.mjs --check` | `status: blocked`, `PINNED_INPUTS_REQUIRED`, `release_authorized:false` | None of the 15 gates has a receipt |
| `pnpm run check:base44-surface` | `client_importers=366/366 entity_call_sites=453/453 core_integration_sites=41/41 function_wrappers=83/83` | The frontend has not moved one call site |

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
| Authority store migrations | ~~15~~ **16** | ~~9~~ ~~14~~ **15** (one is deliberately never hosted) — 14 applied 2026-09-21, and D99's `20260920600000_locally_verified_identity` applied by the owner 2026-09-25 |
| Record store migrations (store, brokers, 83 contracts, purpose policies, file map) | ~~54~~ **59** | ~~0~~ **59** — 54 on 2026-09-21 and the rest since; the hosted ledger holds ~~73 of the 74~~ **74 of the 75** committed migrations with nothing pending — 73 read from the `hosted-gap` job on `b8e4e021` 2026-09-23, and the 74th after the owner applied D99's migration 2026-09-25. The count that moved is authority, not record: this row is unchanged at 59 |
| Ported handlers registered in `services/pennsync-api/handlers.mjs` | ~~77~~ **80** | ~~0~~ ~~74 deployed~~ **80 deployed; waves 1 to 3 released 2026-09-25, 8 operations serving as at 05:43Z** (release state moves without a commit — read `/readyz`) — the six-name gap closed by the 2026-09-25 redeploy. It did not close by itself and will not stay closed by itself: the service's source is **pinned to a commit**, so every future merge reopens it until somebody repoints the pin — **or until the next variable change, which rebuilds from `main` regardless of the pin** (measured 2026-09-25 05:41Z). See stage B |
| Railway services | 2 defined | ~~1 deployed, paused; 1 never created~~ ~~2 deployed, paused — 2026-09-22~~ **2 deployed and RELEASED — 2026-09-25**: `pennsync-api` serving all 80 names, `pennsync-integrations` serving the two AI operations and `SendEmail`. Outbound delivery ON since `16:19Z`; the runtime's browser route still off |
| Frontend call sites moved off Base44 | 0 of 453 | 0 |

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

**That sentence is about `pennsync-api` and does NOT describe
`pennsync-integrations`**, which deploys on merge and waits for no CI — read
the per-service config in stage E before applying either behaviour to the
other.

The port queue, measured on this tree rather than quoted. The line below is the
tool's own `portQueueLine` and is now pinned by a test, so a change that moves
the queue and leaves this page alone fails the build — the guard AGENTS.md got
in #250 and this page did not:

```
port queue: entity_authorization=5 files=8 external_secret=2 none=82
```

98 carried capabilities, **79 written, 19 blocked** (2026-09-30, after D223),
which is the line above summed — `none` is the written total and the other
three buckets are the blocked one. Derive it that way rather than carrying it
forward: this paragraph read 78 and 20 for a day after the queue line beside it
had moved, so the page carried two measurements of one thing that disagreed,
which is the defect its own next sentence is about.

The previous reading was **78 written, 20 blocked** (2026-09-29, after D153),
and it is kept because of what it shows rather than for the numbers. The
carried total fell by one there rather than the written total rising, because
D153 retired `enforceStaffRoleIntegrity` instead of porting it: the owned store
constrains `staff_role` on both tables and lets nobody write it, so the sweep
that reverted a spoofed value has no work left. **A bucket shrinking is not the
same event as a port landing, and this page should not let the two read
alike** — a written count that did not move is the tell. D223 is the other
shape: `setNurseDutyStatus` was really written, so `none` rose and the carried
total did not.
`records_schema` is absent from that line rather than zero in it,
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
  released. On 2026-09-25 the owner lifted D56 for these two names,
  `SendEmail` joined the runtime's operation list at `09:42Z`, and
  `PENNSYNC_API_DELIVERY` was written at `16:19Z`. Both switches are now on and
  mail can be sent; see §4's `Core.SendEmail` row. What a release of these two
  is NOT is a release of invitations, which have no send at all — their
  `delivery_paused: true` is a literal on an audit entry (D42).
- `entity_authorization` **8 → 7 → 6**. D83 took two out by retiring them — a
  `global` reference table is written by migration, never at runtime — and D84
  put `offboardUser` in, where the measurement always said it belonged. D82
  settled the profile-write path and moved none of them out, because each of the
  profile writers it then held writes somebody else's row, a column outside the
  allowlist, or a payload nothing can read. D153 then took a third out by
  retiring it, which is a capability leaving rather than a port landing.
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
   staging with `source 'default'`. **As read from the `hosted-gap` job on
   `b8e4e021`, the ledger stood at 73 with nothing pending at that commit**;
   this is a dated reading rather than the current state, which is not readable
   from this tree. The 59 record migrations are no longer unproven against a
   hosted database; the handlers still are, because nothing has served a
   request yet. Stage B has since deployed them, paused —
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
   wave as well as at the name.

   **Wave 6, the AI wave, went out at `08:39Z` on his own words at
   `08:31:40Z`.** Measured here by an unauthenticated GET of `/readyz`, not
   relayed:

   ```
   /healthz  release: enabled   revision: 1a93f5b
   /readyz   released: true     operations: 78   implemented: 80
             integrationsRequired: true   integrationsConfigured: true
             deliveryReleased: false
             appId: 6a9881683dc68a0bd54f1ef7   appStated: true
             authorityMode: independent   base44ExecutionDependency: false
   ```

   **The two names missing from `operations` are exactly
   `sendAccountReadyEmail` and `sendWelcomeEmail`** — the set difference
   against `implemented` is those two and nothing else, so `OWNER_HELD` held
   through a hand-checked value. That is the control that makes this a
   measurement rather than a count: 78 of 80 would be satisfied by any two
   names going missing.

   **`deliveryReleased: false` is the other half, and the field's EXISTENCE is
   the news.** It is published by `#269`'s code, which this write is the first
   to ship. So the service now carries the ability to send and cannot send:
   read the field, not the absence of the field, because before this write
   there was no field to read.

   `integrationsRequired` flipped `false → true` with the AI names, and
   `integrationsConfigured: true` pairs it with the runtime released an hour
   earlier — the combination `publicReadiness` exists to make visible.

   **Both writes deployed `main`'s head** — `cd48dc1` for wave 4 and `75d465a`
   for the writes wave — the third and fourth times a variable change has
   rebuilt from the tip. The fourth is the sharpest illustration this page has:
   `75d465a` is a change to THIS DOCUMENT, merged twenty minutes earlier, and a
   release wave shipped it. Harmless both times, and checked rather than
   assumed (`services/pennsync-api` is byte-identical across `20c15d8`,
   `cd48dc1` and `75d465a`), but the standing step above is why it was harmless
   and not why it is safe.

   **Wave 6 is the fifth, and it did both things at once.** `1a93f5b` is again
   a change to this document — and it is also the first write to carry a real
   service change, `#269`'s delivery gate, merged ninety minutes earlier at
   `38cb0be`. So the same deploy shipped a doc commit nobody chose and a code
   change somebody did, and only one of them was part of the decision being
   made. Check the diff between the tip and the commit the surface was last
   measured on **before** the write, every time; this is the wave where not
   doing so would finally have cost something.

   That is a dated reading and not a standing fact: release state is the one
   thing on this page that can change without any commit, so **read it off
   `/readyz` rather than off this page** — `released` and `operations` say what
   is actually being served, and the page cannot.
4. **Enroll real people.** Ten Supabase Auth invitations accepted and verified
   out of band. Nothing downstream of authority can be proved with four
   synthetic actors.
5. **Create the production Supabase project** (D4) and provision it with
   `tools-pennsync-provision.mjs`, the one path that tool was written for.
6. **Move the frontend.** Still the largest single body of remaining work in
   the migration. **"Untouched" is what this item said, and it was reading one
   instrument as though it answered a second question.** The surface ratchet's
   `453/453`, `366/366`, `41/41` and `83/83` in section 0 are unchanged and
   correctly so — that gate counts BASE44 COUPLING, and the SPA serves both
   backends, so a call site can be served by an owned route today and still
   import the Base44 client. It is not a statement that nothing has moved, and
   routes have been declared and are serving call sites now.

   It is also not one body of work. Crossing the same 453 against their
   entities' dispositions splits them three ways: sites a route already serves,
   sites that could be adopted against the owned store, and sites that **cannot
   land at all** because the entity's domain was decided `hub` or
   `preserved_paused` — no amount of frontend work reduces them. Sizing this
   item off the single number 453 overstates the editable part and understates
   the decisions. **But "those need a product answer" is wrong as a blanket
   claim**: the `hub` domain's answer was given by D8, and D7 exempts the
   schema-and-data half of `preserved_paused` in its own words. The split, its
   instruments and what is genuinely left for the owner are under Stage J
   below, with the counts marked as a dated reading.

   **What makes this item tractable, and Stage G's remaining bucket not, is one
   distinction that runs under both**: whether a capability exists, and whether
   anything can call it. Here the capability exists and the gate PROVES
   something can call it, by putting each site's own arguments through the
   declared route rather than trusting the declaration — so what is left is
   per-screen editing. Stage G's bucket is the mirror image and says so in its
   own row.

   The measured split, from `check:frontend-destination` and
   `check:entity-routes`, is in **Stage J**, in pinned blocks carrying each
   tool's own output. Read it there; it is deliberately not restated here,
   because a second copy of a pinned reading is a second representation that
   nothing keeps in step — and, measured on 2026-09-26, a verbatim duplicate of
   that block earlier in this page **silently relocated the guard that reads
   the prose beneath it**, so a restatement Stage J forbids became invisible
   while the suite stayed green. The six-line fix for it — refusing a page that
   carries the pinned block's first line more than once — was written, proved
   both ways and handed to another thread rather than landed here.
   **It is not in the tree, and the first sentence written here about it said
   it would ride the next change to that block, which #338 then made without
   it.** So the guard reading this region is still the blind one: read
   `tools-entity-routes.test.mjs` for whether that is still true rather than
   this paragraph, since a `copies` count appearing there is the whole of the
   fix. Meanwhile this item's pointing instead of restating is what keeps the
   region honest, and every earlier `entity routes:` reading in Stage J is safe
   only because each records a different head and so differs from the current
   block's first line by construction. **That clause carried a count until
   2026-09-29, and the count was wrong the moment it was written** — there were
   four earlier readings and it said five — then became right by accident when
   #343 demoted the then-current block into the record. Nothing failed in
   either state. So do not put a number on a population this page itself grows:
   that is this item's own subject arriving inside the item, for the second
   time in the paragraph above it.
7. **Assemble the evidence packet** until `tools-pennsync-cutover.mjs` reports
   `evidence_coverage_complete`.

Everything else parallelizes around these.

## 3. Stages

Each stage names its deliverable, its exit criterion, and who has to unblock it.
Sizes assume the current cadence; they are estimates, not commitments.

### Stage A — Prove the committed store on hosted staging (size S, days; no approval needed)

**Done 2026-09-21: the migrations this stage names were applied to
`caremetric-pennsync-staging`.** The instrument is this stage's own dated record
under *Applied 2026-09-21* below. ~~The cheapest and most overdue step in the
migration, and the only one on the critical path that needs nothing from
anybody.~~ Everything that follows is kept as the procedure and as what the
stage found, not as work outstanding — which is why the two bullets below are
struck rather than deleted.

- ~~Apply the five missing authority migrations to `caremetric-pennsync-staging`:
  `20260919090000_deployment_app_pin`, `20260919114500_enrollment_receipt`,
  `20260920040000_chart_assignment`, `20260920180000_chart_assignment_lifecycle`,
  `20260920200000_membership_lifecycle`. The app pin goes first; unset it
  defaults to staging, which is the correct outcome for this project, but the
  `deployment` row should record that it was *chosen*.~~
- ~~Then apply every `supabase/record-migrations/` file, in order — 54 when this
  was written, 59 now.~~
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

  **That half is now closed by measurement rather than by reasoning, 2026-09-25.**
  Until then the fix was believed on the strength of the diff: no session here
  runs on Windows, so the thing the `.gitattributes` line exists to change had
  never been observed changed. The owner ran the apply from his own Windows
  machine at about `18:18Z` and read a Postgres function body back out of the
  database with **no carriage returns in it**. So CRLF is no longer an open risk
  on this page, and a `md5(prosrc)` failure from here on is drift to diagnose
  rather than a line-ending artefact to suspect first.

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

  **The red that appears at the moment of the merge is STALE, not new drift,
  and it does not clear itself.** That run's store job executes before the
  operator applies anything, so it reports the ledger short by the arriving
  migrations and can report nothing else — it is measuring a store the apply
  has not reached yet. What clears it is a RE-RUN of the workflow after the
  apply, and the re-run is the reading to diagnose. Worked instance,
  2026-09-25: #279 merged at about `18:12Z` and its `main` run failed the
  ledger check by one row; the owner applied the migration at about `18:18Z`;
  the re-run came back green, 22 of 22, `skipped 0`. Anyone reading the first
  run as a schema problem is debugging the clock.

  **Second worked instance, 2026-10-01, and it is recorded here as a DATED
  READING with its reporters named rather than as a state of the store.** A
  staging apply landed against `main` at `82bd9c94`, with the apply output
  stamped `19:23:47Z`, and the hosted ledger moved from 74 rows to 90. **None of
  that was measured from this tree.** The apply session's own transcript is the
  primary source; it reached this page through a worker of the coordinator
  session, so it is second-hand here, and that session's report is saved outside
  the repository as `staging-apply-report-2026-10-01.md`. The ledger movement was
  read independently of that transcript, from `main`'s CI logs, by two further
  sessions. A reading corroborated three ways is still a reading of one moment:
  `PENNSYNC_MIGRATE_DATABASE_URL=… node tools-pennsync-migrate.mjs` with no
  `--apply` is what answers what a store holds now, and this sentence does not.

  **What that reading does NOT say is what is pending, which is a different
  instrument.** At `543a0271` two record migrations had arrived and not been
  applied, and `node tools-pennsync-apply-signal.mjs --base origin/main` on the
  head carrying this paragraph reports one more arriving with it — measured here,
  five runs agreeing, rather than inferred from the ledger figure above. D106's
  rule is the whole point: what is committed, what reaches a deployment and what
  a deployment has RUN are three counts, each derived, and subtracting one from
  another across two instruments is how they get merged by accident.
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

**This whole finding is `pennsync-api`'s and generalises to nothing.** The
other service's config was read on 2026-09-25 and it deploys on every merge
that touches its directory, without waiting for CI; stage E carries the
measurement and the config lines. Two services, two mechanisms, and the
per-service config is the only thing that says which is which.

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
(`tools-pennsync-migrate.mjs --apply`, §4). Read the RIGHT run, though: the run
that fires at the merge itself is stale by construction, because its store job
runs before the apply (§3, stage A). After an apply, re-run the workflow and
read the re-run. A red that has not been re-run since the apply says nothing
either way. So the standing step before ANY variable write is two readings, not
one:

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

  **A second kind of enrollment now exists in the store and changes nothing in
  this stage (D99, #279, applied 2026-09-25).** This stage's population is the
  ten people who HELD Base44 accounts; D99 admits a person who never held one,
  as `locally_verified` rather than `base44_migrated`. Everything above still
  governs them — the account is not created by the tool, the invitation is
  accepted by the person, the evidence is read and hashed rather than declared
  — and the new kind is additionally **switched off**: a plan naming it is
  refused at parse time unless `PENNSYNC_ENROLL_NEW_STAFF` reads exactly
  `enabled-v1`. Setting it is D6, the owner's. A migration plan never asks the
  gate at all, so the six enrolments below are unaffected in either direction.
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

~~**Nothing buildable remains in this stage**~~ — measured item by item
2026-09-23, and recorded because "everything waits on the owner" is the kind of
claim this project has had to re-measure before. Every remaining bullet needs an
enrollee or an owner decision. Re-read against the tree on `b8e4e021` later the
same day and unchanged.

**And then something buildable arrived, 2026-09-25, which is the more useful
lesson.** D99 is enrollment work squarely in this stage's territory, it was
built and applied inside two days of that measurement, and nothing failed when
the sentence above went stale — the claim was a fact about the DECISIONS taken
by 2026-09-23, not a property of the stage. It became false when the owner took
a new one. So read the table below as what waits today, and re-measure it rather
than quoting this paragraph:

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
  | Ported capabilities `src/` reaches | 54 of 136 |
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
  read-only, then mutating, then the twenty-seven that reach the runtime.

  | Wave | Handlers | Migrations |
  | --- | ---: | ---: |
  | `patient-read` (declared) | 2 | 3 |
  | `patient-write` (declared) | 2 | 5 |
  | `visit` (declared) | 4 | 5 |
  | `read-only` (derived) | 61 | 34 |
  | `mutating` (derived) | 68 | 45 |
  | `integration` (derived) | 27 | 25 |

  **Three of them — `extractPatientDataFromDocument`, `extractClinicalDocument`
  and `splitReferralPDF` — carry an operator cost the other twenty-four do not.**
  They are the first three ports out of the `files` bucket, and they get there
  by taking the document's BYTES rather than a locator, so each brokers
  `UploadFile` under the caller's own subject — which put that name into
  `BROKERED_OPERATIONS`. The second and third added no operator cost the first
  had not already added, and no migration: the same shape over a different
  integration (`InvokeLLM` with the document attached rather than
  `ExtractDataFromUploadedFile`) and then over a different document.

  **What none of the three clears is `CROSS_SUBJECT_DOCUMENT_READ`**, recorded
  in Stage H. They read a document for the length of one request; a locator
  stored so a COLLEAGUE can open it later is a different question with a
  different answer, and the third port sits beside exactly such a locator
  (`Referral.document_url`) without touching it. `node tools-pennsync-release-ladder.mjs
  --wave integration --integration-deployment https://<runtime-host>` now
  requires it, so **a runtime serving only the two AI operations and
  `SendEmail` does not hold this wave**: `UploadFile` has to join
  `INTEGRATIONS_ALLOWED_OPERATIONS` on the integration runtime in the same
  release. That is a release-variable write and belongs to whoever holds that
  connector; nothing here performs it, and the gate refusing is the check doing
  its job rather than a defect. Read the runtime's own `/readyz` for what it is
  serving — this page does not say.

  **One capability in this wave is a PARTIAL port, and it is not the two
  above.** `syncCMSRegulations` sends `model: "gemini_3_1_pro"` and
  `add_context_from_internet: true`. The owned runtime admits `automatic` or
  the one model an operator configured, and refuses a web search BY NAME, so
  the call is refused whatever that configuration is — measured 2026-09-29 by
  driving the port's own constants through `validateParams`, which answers
  `MODEL_MAPPING_REQUIRED` and then, if an operator named that model,
  `WEB_SEARCH_NOT_MIGRATED`. Nothing in `src/` calls it.

  **The search leg is now PAUSED BY NAME** (`WEB_SEARCH_RELEASE_PAUSED`, 503,
  raised before the model is reached), which is D42 and D81's shape. It was
  settled on correctness rather than weighed: the only alternative is dropping
  the search and asking the model anyway, which stores regulations recalled
  from training as CURRENT CMS regulations in a compliance product, and a
  capability that refuses is strictly better than one that answers confidently
  and wrongly. The refusal is unconditional rather than gated on an operator
  setting, because what it waits on is a provider that does not exist rather
  than a decision anybody can take; the port below the guard is kept whole, so
  restoring it is deleting one guard.

  **Two things about how this was found are worth more than the fix.** Nothing
  crossed the two halves — the business API builds the model call and the
  runtime decides whether to make it, and each half was right on its own — so
  `pennsyncApiOriginalParity` now drives every port's model constant through
  the runtime's own validator and names this one exception with its reason,
  which fails the build if a second arrives or this one vanishes. And the
  capability had **no behavioural test of any kind** until the pause, which is
  how a 130-line port with a record contract and a trail append shipped with a
  call neither half could make.

  **Those two rows were RE-DERIVED on the merged tree, not reconciled.** Two
  branches moved them and neither could see the other: one read 64 and 42
  against 22 and 17, the other 49 and 37 against 24 and 23, and the merged tree
  reads neither pair. `node tools-pennsync-release-ladder.mjs --summary` is the
  instrument and it is the only thing either figure should ever be copied from.

  **A THIRD row moved on the next merge, and it is the one that never
  conflicted.** `read-only`'s migration count went 28 → 29 because
  `20260920745000_dashboard_visit_documentation.sql` arrives in that wave, and
  both sides of that merge wrote 28: the branch adding the file never touched
  this row, and `main` could not see the file. Git records what two branches
  both edited, which is a different set from what the merge makes false, so a
  row can be stale on the merged tree with no marker anywhere near it. Re-derive
  EVERY row from the tool, not the rows that conflicted.

  `read-only` went 36 → 43 and `mutating` 39 → 42 with batch E, which added ten
  capabilities over the seven entities whose screens read them RAW — seven
  reads and three writes — and both migration counts rose by the one migration
  those ten share. Nothing moved between waves; every one of the ten is new.
  Batch D's fourteen over the operational tables then took `read-only` to 50
  and `mutating` to 49, again with one shared migration each and nothing moved
  between waves. The crossed-chart read control then added one migration to
  `read-only` and none to `mutating` or `integration`, and no handler to
  anything: it replaces four reads that already exist, so no capability
  arrived, and the write half of that defect was closed in the batch before
  it. The `operational_limit` repair then added one more to `read-only` and
  nothing else, for the same reason: it replaces one helper the seven paged
  reads already call. The five compliance reads then took `read-only` to 55
  with one shared migration, and moved neither `mutating` nor `integration` —
  which is what a read-only port should look like: five capabilities that
  create nothing, over five entities the frontend already writes through
  Base44. The provider directory's three writes then took `mutating` to 52 with
  one shared migration and moved neither of the other two: `createPhysician`,
  `updatePhysician` and `deletePhysician` are the whole delta, and `physician`
  was already read through a capability in `read-only`, so the entity arrives in
  no wave it was not already in. Every other movement since batch D belongs to a sibling batch rather
  than to this one — which is what the paragraph below means about the figures
  being global, and why the row is re-derived on the merged tree instead of
  being added to. This row was re-derived on seven bases over the life of one
  pull request; the number above is a reading of the tree it merges onto and of
  no other.

  The roster's telecom keys then added ONE migration to EACH of the three derived
  waves and no handler to anything: a forward file over `roster_entry` (D88), so
  every handler reaching a roster contract needs it and no capability arrived. It
  is the shape the `operational_limit` repair and the crossed-chart control
  already had — a wave gains a migration without gaining work — and worth saying
  each time rather than once, because a count that moved for no new capability is
  the one a reader is likeliest to read as a port.

  Note WHICH waves moved, because the obvious guess is wrong: a roster read is a
  read, so `read-only` is the expected row and the other two are not. They move
  because the roster is read by handlers that then WRITE, and by handlers that
  also reach the runtime, and a wave's migrations are the ones ITS handlers need
  — so a shared read contract lands in every wave that reaches it. This is the
  same property the compliance writes recorded from the other side, where one
  file joined two waves: three rows moving for one file is the derivation
  working, not a file counted three times.

  The timesheet approver gate then added ONE migration to `mutating` and nothing
  to the other five, and no handler to anything: a forward file over
  `contract_timesheet_review` (D88), so the two timesheet handlers need it and no
  capability arrived. Only `mutating` moves because `contract_timesheet_review` is
  reached by no read-only handler and by nothing touching the runtime — which is
  the contrast worth keeping beside the shared-read cases, where one forward file
  moves every derived row at once: a wave's migrations are the ones ITS handlers
  need, so how many rows move says which handlers reach the function rather than
  how big the change is.

  The five compliance WRITES then took `mutating` to 54 and left `read-only`
  and `integration` where they were. Its migrations rose by **two** for one
  file, and that is the derivation working rather than a miscount: a wave's
  migrations are the ones its handlers need, and these contracts open with a
  precondition on the compliance READ migration, so that file now belongs to
  both waves. A wave's migration count is therefore not a partition of the
  directory and the six rows do not sum to it — read each row as what that
  wave's operator must have applied, never as a share of the whole.
  The duty-status port (D223) then took `mutating` to 55 and its migrations to
  40, and left `read-only` and `integration` where they were. One handler, one
  migration, and both counts move by one — which is what a plain port looks
  like, and is worth recording precisely because the two rows above it each
  move by something other than one for reasons that are not miscounts.

  **These counts are GLOBAL, so this row belongs to whichever batch merges
  next rather than to the plan.** Re-derive it from
  `node tools-pennsync-release-ladder.mjs --summary` on the rebased tree and
  never add to the number already printed here: a batch that branched before a
  sibling merged and then added its own delta reds `main` on its own merge,
  with its own CI green throughout. The figures above already carry batch A's
  seven reference reads and batch C's fourteen library and configuration
  capabilities.

  The three reference tables' writes then took `mutating` to 63 with one shared
  migration, and moved neither `read-only` nor `integration`. Six capabilities
  and not nine: `LibraryDocument` gets an update and a delete and no create,
  because its entity requires the storage locator the contract refuses until the
  file copy has run. All three entities were already read through capabilities
  in `read-only`, so again no entity arrives in a wave it was not already in —
  which is the shape to expect from a port that gives an existing read its
  missing write half, and the reason the read row does not move.

  The `mutating` row's migrations rose by one with D108, and the derivation
  rather than the number: that entry's forward migration redefines
  `library_chart` and `patient_education_chart`, so the wave carrying the
  handlers over those two contracts gains it as a prerequisite. Its handler
  count does not move, because the entry adds no capability — the file is
  classified into a wave rather than merely no longer refused by
  `LADDER_FUNCTION_DEFINED_TWICE`, which are different claims. The figure in
  the row above was re-derived on the tree that carries batch D, not carried
  over from the reading this entry was first written against: that earlier
  reading said 32 → 33, and replaying it onto a base where batch D had landed
  would have stated a delta over a total that no longer existed. Re-derive this
  row, never replay it.

  The three derived migration counts were last re-derived that way, on a tree
  rebased onto the merge of the entry above, and each rose by two over the
  figures that entry left: the roster's `created_date` order and its display
  name are two forward record migrations. Every derived wave moved because
  these values are **cumulative supersets rather than prefixes**, so a
  migration in the read-only wave is in the two beyond it as well. No handler
  count moved, which is the check worth reading here — the change adds no
  capability, so a handler count that had moved would have meant the wave
  classification shifted rather than that work arrived. The +2 was read off
  `--summary` on the merged tree rather than added to either side's number:
  the two conflicting readings above were both correct for their own tree, and
  reconciling them by arithmetic is how a delta gets stated over a total that
  no longer exists.

  The `mutating` row's migrations rose by one again, and ONLY that row, because
  the leave-review approver fix's forward migration redefines
  `contract_time_off_review` — one contract, reached by handlers in no other
  wave. Contrast the roster telephone change next to it, where a forward file
  over a shared READ contract moved all three derived rows at once: which rows
  move is a property of how widely the contract is reached, not of how large the
  change is. The handler count does not move, because the change adds no
  capability; a handler count that had moved would have meant the classification
  shifted rather than that work arrived. Re-derived from `--summary` on this
  tree rather than added to the figure above, for the reason the D108 paragraph
  gives: replaying a delta onto a base that has moved states it over a total
  that no longer exists.

  The `read-only` row's migrations then rose by one with the dashboard
  documentation signal, and the derivation again rather than the number: that
  forward migration redefines `dashboard_visit`, which `contract_dashboard`
  projects through, so the wave carrying `getDashboardData` gains it as a
  prerequisite. No handler count moved anywhere, which is the check to read —
  the change adds no capability, it widens one projection by a derived
  boolean. The other two rows did NOT move, and that is worth saying because
  the paragraphs above record the opposite case: these rows are each wave's
  OWN prerequisites, not the cumulative value, so a migration reaching only
  `read-only`'s handlers moves only `read-only` — while the value `--wave
  mutating` emits does grow, because THAT is the superset.

  **What that paragraph did NOT do on its own branch is edit the row**, and
  neither did `main`. The table above said 28 on both sides of the merge and
  the tool said 29, so the prose was right and the figure beside it was wrong,
  with nothing conflicting. Re-deriving the whole table on the merged tree is
  what found it; re-deriving the figures a merge happened to mark is what would
  have missed it.

  The `integration` row's migrations went 14 → 15 with D98, and the reason is
  worth reading rather than the number: those two senders resolve their recipient
  against the caller's agency roster now, so the wave that carries them needs
  `contract_roster`'s migration applied — a capability's prerequisites follow
  from the contracts it calls, and D98 gave two handlers their first contract
  call. The test is what said so; nobody counted it.

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

  **What kept them out of every value was the emitter, not the wave — and that
  is spent.** `OWNER_HELD` withheld both names from the per-wave and the
  cumulative value, printed why beside it, and refused a value carrying one, so
  the move between waves changed nothing an operator could paste. **The owner
  emptied it on 2026-09-25 at `13:35:01Z` and #283 shipped that**, so the ladder
  emits all 80 names and prints no `# WITHHELD` line. D100 records the decision
  and the rule worth carrying: an empty hold is not the absence of one. The
  facility stays and is still the place a future hold goes; because an empty
  list fires none of its six guards, each is driven from a synthetic hold in its
  tests rather than left vacuous.
  **Four workforce capabilities have MOVED out of `mutating` the same way, and
  this time a migration column moved with them.** `submitTimeOffRequest`,
  `reviewTimeOffRequest`, `reviewPersonnelCredential` and
  `submitPersonnelCredential` each answered a constant `delivery_paused: true`
  and reached no integration; they now send their staff notice, so all four
  carry `needsIntegration: true` and the ladder places them in `integration`:
  mutating 54 → 50 and integration 19 → 23 in the table above. The check worth
  reading is that the handler total does not change — 2 + 2 + 4 + 55 + 50 + 23
  is 136 either way — because a transfer moves a capability between waves while
  an arrival raises the sum.

  The migration columns went 39 → 37 and 17 → 19, which is two files changing
  wave rather than two files arriving, and the derivation is per-file:
  `20260920240000_contract_credential.sql` and
  `…250000_contract_credential_review.sql` are reached by these two credential
  capabilities and by nothing else left behind — the credential LIST reads
  through `20260920660000_contract_compliance_reads.sql` — so both follow their
  handlers. `20260920230000_contract_time_off.sql` does NOT move, because
  `cancelTimeOffRequest` stays in `mutating`: its notice cannot be built until
  the cancel contract returns the status it replaced, so the file is a
  prerequisite of both waves now. Measured by diffing `--wave` on this tree
  against `00ccac41`, not inferred from the deltas.

  Restoring the in-app rows those two time-off senders never minted then took
  `integration`'s migrations 19 → 22 with no handler moving and no new SQL
  written: the two capabilities call the existing `createNotification` contract,
  so the wave gains that contract's own file, the mint facility it is the only
  writer through (`20260920285000_notification_mint.sql`, D48) and
  `20260920300000_contract_notification.sql`, whose helpers it uses. A wave's
  prerequisites follow from the contracts its handlers call, and these two
  handlers gained a contract call. The read waves do not move, because those
  three files were already theirs.

  The fifth workforce sender transferred with them once the store could answer
  its condition: mutating 50 → 49 and integration 23 → 24, with integration's
  migrations 22 → 23 for the forward file
  `20260920680000_time_off_cancel_previous_status.sql`, which replaces the
  cancel contract so its answer names the status it replaced.
  `20260920230000_contract_time_off.sql` still does not move a column, but the
  reason has changed and is worth writing down: it stayed before because
  `cancelTimeOffRequest` was left behind in `mutating`, and now nothing is left
  behind — `getApprovedTimeOff` reaches that file from `read-only`, which holds
  it either way. A prerequisite that did not move for one reason and then does
  not move for another looks like nothing happening.

  The send's own switch, separate from `PENNSYNC_API_RELEASE`, is
  `PENNSYNC_API_DELIVERY=enabled-v1`, read exactly and untrimmed; it was written
  at `16:19Z` the same day. **What `/readyz` says about it is a reading, not a
  property of this page**: on **2026-09-29 at 06:13:47Z**, by an unauthenticated
  `GET https://pennsync-api-production.up.railway.app/readyz`, it answered
  `deliveryReleased: true` with both senders among 80 `operations` and the
  staging `appId`. Nothing here compares a document to a running service, so
  take the reading again rather than quoting this one —
  `curl <service>/readyz` is the whole instrument. **It reports the RUNNING
  REVISION and not this tree**: at that reading the API was serving `d01359a3`
  while `main` was `af4b3185`, eight commits of which touch
  `services/pennsync-api`. "The service serves it" and "the repository contains
  it" are two claims, and this page is beside the source, which is where they
  get merged. And keep two things apart
  that the field's name invites collapsing: **released means a call ATTEMPTS a
  real send, not that mail arrives** — no delivery has been observed — and
  **invitations are outside it entirely**, their `delivery_paused: true` being a
  literal on an audit entry (D42) rather than anything this endpoint reports.

  Mail also needs the integration runtime's side, and **that side is now
  done**. The runtime was released 2026-09-25 `08:19:25Z` with the two AI
  operations and nothing else; on the owner's 09:40:32Z line, `SendEmail`
  joined `INTEGRATIONS_ALLOWED_OPERATIONS` and its `/readyz` lists three
  operations. That was the cheap half — one name on a list that already
  existed. The expensive half was the api's `PENNSYNC_API_DELIVERY` and the
  `OWNER_HELD` lift the value had to be derived through; both were spent on
  2026-09-25, the lift in #283 and the variable at `16:19Z`.

  Whether the runtime's SendGrid key is usable was **never** answerable from
  `/readyz`:
  `missingProviders` is `config.operations.filter(...)`, so an empty operation
  list yields an empty answer whatever keys exist, and reading that as "the
  provider is configured" is this page's own recurring defect — an empty answer
  over an empty input. `preflight.mjs` really does call
  `api.sendgrid.com/v3/scopes` and check for `mail.send`. **Its gate is the KEY
  being non-empty, not the operation list** (`preflight.mjs:21`): the list only
  decides whether the result counts as `required` and what the not-configured
  fallback says. A preflight run answered the provider question on 2026-09-25
  and the answer is in Stage E: the key is real and carries `mail.send`. What
  that does **not** settle — the sender identity, and the account's plan and
  limits — is recorded there too.

  One thing had to be deliberate when `SendEmail` joined that list, and it was:
  it must NOT join the browser list. `INTEGRATIONS_ALLOWED_OPERATIONS` is the
  ceiling for `INTEGRATIONS_BROWSER_OPERATIONS` (`runtime.mjs:19-20`), and what
  that ceiling did while `SendEmail` was off the service list is sharper than
  "refuse the request": putting the name on the browser list would have thrown
  `INVALID_BROWSER_OPERATION_CONFIGURATION` at module load, so **the container
  would not have booted at all**. A write aimed entirely at the service side
  removed that. Measured after it, `browserOperations` is `[]` and
  `browserReleased` is false, so the browser route is shut — and it must stay
  that way.

  **Count what actually changed, because two versions of this paragraph got it
  wrong in opposite directions.** The first said the route was "one variable
  away"; the second said two and stopped there. **Since #281 there is no number
  for `SendEmail` at all** — `BROWSER_FORBIDDEN_OPERATIONS` (`contracts.mjs:19`)
  names it, `runtime.mjs:24` refuses to BOOT a container whose browser list
  carries a forbidden name, and `app.mjs:69` refuses such a request again at
  dispatch. No pair of Railway variables opens a browser send of mail; setting
  them takes the service down instead. Read the three cases apart, because one
  number describes none of them:

  - **Mail: never.** Two refusals, one at boot and one at dispatch, and neither
    is a setting.
  - **An operation already on the service list** (today the two AI names): two
    settings, `INTEGRATIONS_BROWSER_RELEASE` set to exactly `enabled-v2` — note
    the **v2**, so copying the service flag's `enabled-v1` does not turn it on —
    and a non-empty `INTEGRATIONS_BROWSER_OPERATIONS`. `app.mjs:44` refuses if
    either is unmet and `app.mjs:64` re-checks the operation at dispatch.
  - **Any other name:** three, because the service list is the browser list's
    ceiling (`runtime.mjs:19-20`), so the name must join
    `INTEGRATIONS_ALLOWED_OPERATIONS` first or the container will not boot.

  What changed in KIND is still the thing to carry, and it now runs the other
  way: **a configuration setting became a structural refusal again.** Do not
  write any of this as a lock count — a reader who sees "one lock left" goes
  looking for a second to add.

  **This is the worked example of a hold kept by hand becoming a hold kept by
  the code.** The exclusion was described here as restorable and unrestored,
  which is a promise; #281 made it a refusal, which is a check. Its own comment
  at `app.mjs:66-68` says why the dispatch half exists although `loadConfig`
  already refuses to build such a config: so the refusal is a property of the
  REQUEST rather than of how the config was made, with a test that drives it
  from a hand-built config to prove it is not decorative.

  **And read what the suite said during the window in between**, because the
  finding is the reason the refusal is worth having rather than a footnote to
  it. Recorded by the thread that owns `services/integration-runtime`, in its
  own words:

  > A test at `caller-binding.test.mjs:188` asserted that `SendEmail` on the
  > browser operation list throws. Its fixture set the service list to
  > `InvokeLLM` alone, so what it actually exercised was the SUBSET rule
  > wearing a `SendEmail` costume. It passed before `SendEmail` joined the
  > service list on 2026-09-25 and passed after, while the property it appears
  > to prove went false in between. Anyone auditing the browser mail ceiling
  > would have found that assertion and stopped there. The general form: a test
  > whose fixture makes it pass for an older, broader reason reads exactly like
  > one that covers the case, and only sabotage tells them apart.

  Two things about that, so it is not read for more than it says. It is
  evidence about a TEST, not about the service: the browser route was shut
  throughout by both halves of `app.mjs:44`, the gap was latent — two settings
  away for `SendEmail`, which was already on the service list, and three for a
  name that is not — and nothing was ever exposed, a first account of it having
  reported a live browser send and been corrected, because the 200 came from a
  fixture that opens the route. And it is another instance of this page's own
  defect, arriving inside a test rather than a check: the thing written to catch
  a class of mistake was the thing that hid one.

  And the general form, which is not about `SendEmail`: the service list is the
  browser ceiling for **every** operation, so any widening of
  `INTEGRATIONS_ALLOWED_OPERATIONS` widens the browser ceiling for the name it
  adds. That has always been true here; this is the first time it cost
  something.

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
  running revision**, which they were not before. **What they do there changed
  with D97 and this paragraph is read together with it**: the send is built, and
  it is gated on `PENNSYNC_API_DELIVERY` reading exactly `enabled-v1`. So on a
  deployment where that variable is unset — which is every one of them at the
  time of writing — both still authorize the caller and then answer
  `OUTBOUND_DELIVERY_RELEASE_PAUSED`, and their presence changes nothing about
  what the service sends; on one where it is set, they send. Their presence in a
  release value is therefore no longer the only question about them. **All three
  things that stood here are now spent, and the paragraph is kept because the
  SHAPE is the reusable part.** One kept the name out of the value — the
  ladder's `OWNER_HELD` (`#267`), emptied on the owner's word and shipped in
  #283. Two more stood between a released name and a message leaving the
  system, and they were safeguards against an effective release rather than
  second copies of that hold: `PENNSYNC_API_DELIVERY`, written at `16:19Z` on
  2026-09-25, and D98's refusal to report `ready` at all while a released set
  contains a sender and that variable stays unset — which is now the thing
  CONFIRMING the switch from outside rather than guarding against it — it
  answered `ready: true` with `deliveryReleased: true` when last read, on
  2026-09-29 at 06:13:47Z, which is the same reading Stage D's delivery
  paragraph carries and is a property of that moment and of the revision then
  running, rather than of this sentence or of this tree. Read the three
  together anyway: one kept the name out, two kept a send from happening, and a
  future hold over a future name wants all three again rather than one.
  §4's `Core.SendEmail` row records the decision that governed the flip.

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

  **The store side of every wave WAS applied when this was measured, and that
  is a dated finding rather than a standing property.** The union of
  `patient-read`, `patient-write` and `visit` is ten prerequisite migrations,
  and all ten were in `caremetric-pennsync-staging`'s ledger — as was
  everything the later waves need, because the ledger had nothing pending at
  all (`already_applied: 73`, read from the `hosted-gap` job on `b8e4e021`,
  2026-09-23). ~~**The store is no longer what holds any wave back; the running
  revision is.**~~ **Neither did, as of 2026-09-25**: the ledger had nothing
  pending and the running revision implemented every name. What held the waves
  back on that reading was the owner's word on the two release variables, and —
  for every wave after a future merge — the source repoint in stage B.

  **Do not carry either reading forward as the current answer.** What it
  measures moves on every merge and this page does not: a migration merged
  since is pending until an operator applies it (D93), which is exactly the
  condition both readings happened to find absent. The answer today comes from
  `PENNSYNC_MIGRATE_DATABASE_URL=… node tools-pennsync-migrate.mjs` with no
  `--apply`, or from the `hosted-gap` job on a fresh `main` run — one command,
  which is why this page states neither. Note the DIRECTION of this one: a
  stale "nothing is pending" HIDES work, where AGENTS.md's stale `user_update`
  sentence invented some. Same defect, and only one of the two reads as
  alarming, which is why the one that reads as reassuring is the one to
  distrust.

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

**Corrected 2026-09-25: this was a BUILD, not a switch, and the table below was
missing the variable that matters most.** The release thread read the deployed
runtime rather than its health line and found `operations: []` with
`authorityMode: "base44"` — so releasing it would have released nothing, and
flipping the `pennsync-api` side alone would have advertised 78 capabilities
while the 17 that reach this runtime failed on every call. That is this
document's own healthy-looking-but-false shape, and it is why the AI wave was
not one variable write.

**That build was done the same day and the runtime is live.** On the owner's
word at `08:14:51Z` the release thread wrote six values in **two calls** and
released the service at `08:19:25Z`. Everything below this line that reads as
work still to do is kept as the record of what was decided and why, because the
reasoning is what a later wave needs; **what it says is left has been done.**
The readings are at the end of this stage.

**`INTEGRATIONS_ALLOWED_OPERATIONS` decides what this service serves, and this
page did not name it.** It belongs in the table below and is listed there now.
Two things about it are load-bearing:

- **It is the only guard on outbound mail anyone here can confirm.**
  `runtime.mjs:69` counts `SendEmail` a missing provider only when the SendGrid
  key or the sender address is absent, and `SENDGRID_API_KEY` and
  `NOTIFICATION_FROM_EMAIL` are both **present on the service as names**. For
  most of this migration that was all anybody had: `list-variables` answers
  with names and `valuesRedacted: true`, so **nobody had seen either value**,
  and an empty or revoked key would have been a second lock — an unchosen one
  that nothing observes, which is not a control and must not be planned
  around. Treat this variable as the whole guard and set it to exactly the
  operations the wave needs and nothing else. That part is unchanged.

  **The value has since been read, and this is what it said.** The release
  thread took the reading described further down this stage, from the
  `pennsync-integrations` deploy log on deployment `9ee4913b`, released boot
  `2026-09-25T08:19:25.039Z`, with the boot before it at `08:18:27.503Z`
  identical:

  ```
  "sendgrid":{"status":200,"valid":true,"senderConfigured":true,"required":false}
  ```

  Read against the code rather than as a rollup, here is exactly what that
  line establishes. `status` is set nowhere but inside `check()` (`preflight.mjs:10-11`)
  — the absent-key branch (`:24`) and the thrown-fetch branch (`:12`) both omit
  it — so a `status` of 200 means the GET of `api.sendgrid.com/v3/scopes`
  really completed, with a 2xx. On that branch `valid` is
  `Array.isArray(data.scopes) && data.scopes.includes('mail.send') &&
  validSender(config.fromEmail)` (`:23`), so `valid: true` is SendGrid's own
  answer that **the credential is real and carries `mail.send`**, plus a local
  parse of the sender address. Note that `valid` already ANDs in
  `validSender`, so `senderConfigured: true` beside it is implied and adds
  nothing here — that field only carries information when `valid` is **false**,
  where it splits the key from the address. (#288 renamed it
  `fromAddressWellFormed` on 2026-09-25 without changing what it computes. The
  readings quoted on this page are left as the log printed them.) And `required: false` is
  `needsEmail`, i.e. `SendEmail` is off the operation list, which is exactly
  the state in which the report's `passed` is vacuous; the reading was taken
  from `checks.sendgrid` and not from `passed`, which is the correct way round.
  **That condition has since flipped**: `SendEmail` joined the list on
  2026-09-25, so `required` is now true and `passed` is no longer vacuous about
  mail. Read `checks.sendgrid` anyway — a rollup that is meaningful today
  became meaningful without anyone changing it, and it can stop being
  meaningful the same way.

  **This page used to end that first bullet by saying nobody should be told
  either that a working mail account was in place or that one needed buying
  until somebody had a reading behind it. That instruction is now discharged,
  and narrowly.** Somebody does have a reading. It says a real credential
  exists and is permitted to send, so **nothing needs buying in order to
  attempt a first send** — but read what `/v3/scopes` actually returns before
  taking it further than that. It returns **the API key's scopes**. It does not
  report the account's plan, its monthly sending allowance, or its standing, so
  "we do not need to buy mail" is an inference and not the measurement. Two
  loose ends sit beside the good news, and neither is exotic:

  - **The sender identity is unverified as far as anything here knows.**
    `validSender` is a regular expression in this repository
    (`runtime.mjs:74-76`), and whether SendGrid has approved the specific
    address we would send *as* is a separate setting on their side that
    nothing in this codebase reads. It is a normal reason a first send bounces.

    **And the existing preflight cannot close it — a correction made
    2026-09-25 after this page's own advice was read back wrong.** The
    preflight's SendGrid check is a `GET /v3/scopes`
    (`preflight.mjs:21`), which measures the KEY, and the key was already
    measured on 2026-09-25 at `10:27Z`. The field beside it that reads like a
    sender answer, `senderConfigured`, is `validSender(config.fromEmail)`
    (`preflight.mjs:23`) — the same local regex, no network call. `verified_senders`
    appeared nowhere in this repository.

    **Both of those sentences are now history, and the field has a different
    name: #288 (`720d1401`, merged 2026-09-25 `19:29Z`) built the probe.** The
    local regex is still there and still local, renamed
    `fromAddressWellFormed` at `preflight.mjs:218` — the same expression on
    either side of the change, so a reader comparing an older boot log to a
    newer one is looking at a rename and not at a behaviour change. What is
    new is a SIBLING of `checks.sendgrid` rather than a field inside it,
    `checks.sendgridSender`, and it really asks the provider.

    **And there is nothing to switch on: the preflight is already running on
    every boot of the live runtime, and its current boot said exactly this.**
    `runPreflight` is called only when `INTEGRATIONS_PREFLIGHT` reads
    `read-only` (`server.mjs:36`), so a report in the deploy log IS the
    variable being set — which the `08:19:25.039Z` boot quoted above already
    demonstrated, and which the release thread confirmed again from the
    revision running now, `e159c189`, booted `2026-09-25T11:26:41.906Z`:
    `"sendgrid":{"status":200,"valid":true,"senderConfigured":true,"required":true}`.
    So the answer is not "would be"; it is on the page, from production, twice.
    `required` has flipped to `true` since the first reading because `SendEmail`
    joined the operation list, which is the one thing that changed.

    Read what that cost somebody who asked for the probe expecting it to settle
    the sender: they got `valid: true` and `senderConfigured: true`, which look
    like confirmation that the from-address is approved when nothing had asked
    the provider. This page's house shape, in the field somebody would use to
    settle it, twice over. Note also that the `10:27Z` mail-key reading carried in
    project notes is that same field, so whatever else it settles it says
    nothing about the sender.

    **How to read `checks.sendgridSender`, which is where the answer lives
    now.** It carries a `verdict`, and the values are deliberately four rather
    than a boolean:

    - `VERIFIED` — SendGrid said the address may send, by one of two routes,
      named in `route`: `single_sender` (the address is on the verified-senders
      list) or `authenticated_domain` (its domain is authenticated). Two routes
      and not one, because an authenticated sender domain is used WITHOUT a
      single sender, so a check consulting only the first list would report the
      recommended production setup as unverified. **That is not a hypothetical
      here.** The single-sender list is read FIRST and returns immediately when
      it answers yes, so `route: authenticated_domain` on the live reading below
      means that route did not answer yes for this address — a one-list check
      would have said `NOT_VERIFIED` or `NOT_MEASURED` on this account today,
      never `VERIFIED`, while the provider does authenticate the sending domain.
      What the log cannot say is WHICH: a positive short-circuits and the
      verdict object carries no sender detail, so `false` and "the read was
      inconclusive" are indistinguishable from outside, and neither is a claim
      about any other address on the account.
    - `NOT_VERIFIED` — SendGrid answered, on BOTH routes, that it may not. Both
      is the condition, not either.
    - `NOT_MEASURED` — the absence of a verdict rather than a soft no, with the
      cause in `reason`. A key without the scope to read a list, a response
      shape the code will not guess at, or a page it cannot prove was the last
      one each land here, because recording any of them as `NOT_VERIFIED` would
      be a verdict nobody issued. **`NOT_MEASURED` with `passed: false` is a
      finding about the KEY, not about the sender, and not a failure of the
      probe** — read `reason` before concluding anything about the address.
    - `NOT_APPLICABLE` — `SendEmail` is off the operation list, so the question
      was not asked at all. It is `valid: true`, which is the same absent-key
      trap `checks.sendgrid` has: not an answer.

    **And it has been read. The sender is verified.** The runtime rebuilds on
    any merge touching its directory, so #288 was live within seconds, and the
    first boot after it — `2026-09-25T19:30:14Z`, on the revision built from
    `720d1401` — reports `checks.sendgridSender` with `verdict: VERIFIED`,
    `route: authenticated_domain`, `fromDomain: cmcarebase.com`, and the report's
    own `passed: true`. `checks.sendgrid` is `valid: true` on that same boot,
    which is the key carrying `mail.send`. The probe re-runs on every restart, so
    this is a standing reading rather than a one-off. Taken from the deploy log
    by the release thread, which holds the Railway connector.

    **Two things that reading is not, and both matter more than the good news.**
    `senderConfigured` never measured the provider — it is a local regex under a
    misleading name, and nothing on this page should be read as it having
    verified anything, which is the whole reason #288 exists. And **`VERIFIED`
    is not `delivered`**: SendGrid saying the domain may send is not a message
    arriving, only a real send answers that, and no login exists to make one. So
    the end-to-end proof is still the first real user call, exactly as it was
    before this probe existed. What the probe removes is one specific way a
    first send was expected to fail; the account's plan and limits it does not
    reach at all.
  - **The plan and the limits are unmeasured.** A key can carry `mail.send` on
    an account that is at its cap, throttled, or suspended. Nothing read so far
    distinguishes those from a healthy account.

  Neither is a reason to delay anything, and neither is settled by the probe;
  they are what to check first when a send is actually attempted. And the good
  news moved nothing on its own. The hold moved later, and separately: **the
  owner lifted it on 2026-09-25 at 09:40:32Z — "Turn on the account-ready and
  welcome emails."**

  **That bought one of the two switches, and this is the paragraph to read
  before assuming it bought both.** Measured afterwards by an unauthenticated
  `GET /readyz` on each service:

  - `pennsync-integrations` now lists `SendEmail` in `operations` beside the
    two AI operations, so the runtime brokers a send. `browserOperations` is
    still `[]` and `browserReleased` still false — the service list is the
    browser list's ceiling (`app.mjs:44`, `app.mjs:64`), and `SendEmail` must
    never join the browser list.
  - `pennsync-api` still reports `deliveryReleased: false`.
    `PENNSYNC_API_DELIVERY` is unset, and `sendAccountReadyEmail` and
    `sendWelcomeEmail` are in `implemented` and **absent from `operations`**.

  At that reading **no mail could be sent**. Both are required and only one was
  on: the runtime brokering `SendEmail` and the API being permitted to send are
  two independent switches on two services, and the second could not even be
  derived until `OWNER_HELD` was emptied. A measurement removed a *question*;
  the owner removed a *hold*; neither removed the second switch.

  **The second switch was written later the same day, and here is that
  reading.** `OWNER_HELD` was emptied in #283, and `PENNSYNC_API_DELIVERY` was
  written at `16:19Z`. Measured afterwards by an unauthenticated `GET /readyz`
  on each service, from a session with no Railway access:

  ```
  pennsync-api            ready: true   released: true
                          deliveryRequired: true   deliveryReleased: true
                          operations: 80   (sendAccountReadyEmail, sendWelcomeEmail both present)
                          appId: 6a9881683dc68a0bd54f1ef7   appStated: true
                          authorityMode: independent   base44ExecutionDependency: false
  pennsync-integrations   operations: 3   (InvokeLLM, ExtractDataFromUploadedFile, SendEmail)
                          browserReleased: false   browserOperations: []   browserReady: false
  ```

  So **mail can now be sent**, and the browser route is still shut by both
  halves of `app.mjs:44` — and, for `SendEmail` alone, by two refusals that are
  not settings at all (§4's browser paragraph). The paragraph above is kept as
  the 09:40Z record rather than rewritten: the gap between the owner's yes and
  the capability being on was about seven hours and three separate writes, and
  a page that edited the first reading away would lose exactly that.

  **Read D100's "what this does not do" against its own clock.** It was written
  about the state at the `13:35Z` lift and says `PENNSYNC_API_DELIVERY` is unset
  and no mail can be sent, which was true then and was overtaken at `16:19Z`,
  before the entry merged. A dated entry is a record and is not rewritten, so
  this page carries the later reading and D100 keeps its own. Its other two
  halves did not expire and still hold: D98's recipient binding still refuses an
  address nobody in the caller's agency roster holds, and the runtime's release
  is still a separate switch on a separate service.

  **The counter-example was on this same service.**
  `INTEGRATIONS_ALLOWED_OPERATIONS` was itself present as a name with an
  **empty** value — which is exactly why the AI wave was a build rather than a
  switch. So here, on this service, "the name is set" had already been proved
  not to mean "the value is usable". This page said the mail credentials were
  set and drew a conclusion that only their values could support; that is the
  same one-representation mistake, two paragraphs apart. (That variable now
  carries the two AI operations; `SendEmail` is still not among them.)

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
  `INVALID_BROWSER_OPERATION_CONFIGURATION`. So capping this variable caps the
  browser at the same names, even if somebody later sets both browser
  variables. It now carries three, `SendEmail` among them — and that is exactly
  why the ceiling stopped being enough on its own: since #281,
  `BROWSER_FORBIDDEN_OPERATIONS` (`contracts.mjs:19`) refuses `SendEmail` on the
  browser list at boot (`runtime.mjs:24`) and again at dispatch (`app.mjs:69`),
  whatever this variable holds.

**What was left was five variables on the Railway runtime, set together — all
five written at `08:17Z` on 2026-09-25, in one call, with the release flag
following as a second:**

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

Why that was safe to do, and why the split into two calls was not tidiness:
the runtime was released to nobody (`INTEGRATIONS_RELEASE` unset), so the
config write altered readiness and nothing else, and removing
`INTEGRATIONS_AUTHORITY_MODE` reverts to the Base44 default. `loadConfig`
**throws** on a partial set rather than reporting itself unready, so the call
that can take the service down ran while nothing was released, and the release
flag — a plain string equality that cannot throw — went second. Keep that
ordering for any future config change here. **The safety was about the four
authority variables, not about the operation list** — adding an operation to
`INTEGRATIONS_ALLOWED_OPERATIONS` is what makes the service able to do the
thing, and for `SendEmail` the provider behind it is in fact live, as the
reading above now shows.

**That last question was answerable, this page said it was not, and it has
now been answered.** `INTEGRATIONS_PREFLIGHT=read-only` makes the service run
`runPreflight` at startup and print the report (`server.mjs:36-38`). It calls
`api.sendgrid.com/v3/scopes` whenever `config.sendgridKey` is non-empty —
**the operation list does not gate it** (`preflight.mjs:21`) — and reports
whether the key carries `mail.send` and whether `NOTIFICATION_FROM_EMAIL`
parses. It does the same for the Anthropic key against `/v1/models`, including
whether the configured model exists (`preflight.mjs:17-19`). Besides those two
GETs it probes our own project — the storage bucket, one `fileGet` RPC with a
zero id, and the authority RPC — and **sends no message at all**, so it answers
the mail question without touching the owner's hold and without releasing
anything.

**Be exact about WHICH mail question, because this page was not, on
2026-09-25.** The question the preflight answers is the KEY's: does it exist,
and does it carry `mail.send`. It is not "can a message leave". `/v3/scopes`
asks the provider about the key and about nothing else, and the sender half is
a local regex — see the bullet above for the whole reading and for what closing
it would take. Both were answered long ago, and the probe is not something
waiting to be switched on: `INTEGRATIONS_PREFLIGHT` already reads `read-only`
on the live runtime, so the report is printed at every boot and the current
revision's is quoted in that bullet. Asking for it again adds no measurement
and produces a report that is easy to read as more than it is.

**It ran on 2026-09-25 at `08:19:25.039Z`, and the SendGrid answer is in the
bullet above.** The paragraph that used to stand here called this a reading
that *could* be taken. What is worth keeping from that is not the answer but
the shape of the mistake: this page had called the question unreachable while
the code that answers it was already deployed and printing to a log every time
the service booted. Not a wrong reading — never looking for one.

**One check here is a real control and not just a report**, and it is the
reading behind any claim that anonymous access to the owned store is refused.
With `authorityMode: independent` the preflight POSTs the fixed authority RPC
carrying the **publishable key alone**, and `valid` is
`[401, 403].includes(response.status)` — so a *successful* anonymous call
fails the preflight. The code says why in its own comment: a call that
succeeded on the publishable key would mean the caller's own token is not what
authorizes. Note that `checks.authority.required` is `needsAuthority`, so
unlike the two provider checks this one **does** count toward `passed` in
independent mode — `passed` is vacuous about the providers while the operation
list is empty, not vacuous about everything.

**Read `checks.sendgrid`, and do not read `passed`.** The rollup is
`every(check => check.required === false || check.valid === true)`, and
`required` is `needsEmail`, which is false while `SendEmail` is off the list.
So `passed: true` is compatible with a dead mail key and says nothing about
mail at all — this page's own defect standing in the field somebody would use
to settle it. Inside that one object, three fields and not one:

- `status` present means the probe really called SendGrid. Its absence, with
  `configured: false`, means the key was **empty** — and note that in that case
  `valid` is reported **`true`**, because the list does not require it. A bare
  `valid: true` therefore does not mean the key works.
- `valid` is scopes carrying `mail.send` **and** `NOTIFICATION_FROM_EMAIL`
  parsing, so a bare `false` does not say which failed.
- `senderConfigured` separates them: `valid: false` with
  `senderConfigured: true` is the key, and `senderConfigured: false` is the
  address. **It separates them locally**, and since #288 it is called
  `fromAddressWellFormed` (`preflight.mjs:218`) — the same expression, whether
  the string parses as an address, not whether SendGrid has approved it. A boot
  log from before that merge carries the old name and means the same thing.
  Nothing in this object asks the provider anything about the sender; the
  sibling `checks.sendgridSender` does, and stage E says how to read it.

**`checks.anthropic` has the same trap and the same remedy.** Its `required` is
`needsAI`, derived from the same operation list, so with the list empty
`passed: true` is equally compatible with a dead Anthropic key. Its absent-key
branch is `{ valid: !needsAI, configured: false }` (`preflight.mjs:19`), the
mirror of SendGrid's at `:24`, so **`valid: true` alone is compatible with no
key at all here too.** The read that holds, for either key, is **`status`
present AND `valid === true`** — did it run, then what did it say. `status` is
set only when a fetch completed (`preflight.mjs:10-11`); a thrown check has
none either (`:12`). For Anthropic, `valid` then requires the key to work
**and** the configured model to appear in `/v1/models`. Once the operation list is written both
`required` flags become true and `passed` starts to mean something — but by
then the config is already in, which is after the moment the probe was worth
running. **So a sentence anywhere saying "run the preflight and check it
passes" is wrong in the one state it will be run in.**

**Do not cite the report's `paidCalls`, `writes` or `base44FunctionCalls`**:
all three are hardcoded literals on the return (`preflight.mjs:55`), the same
kind of field as `trafficCutoverVerified` in §0. They happen to be true here,
and what makes them true is the calls themselves, which is what to check.

**And it is a deploy-log read, not an endpoint** (`server.mjs:36-38`): the
report is written once to stdout at startup. Whoever asks for the probe has to
ask for the log after the boot as well, or the report is produced and nobody
reads it.
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

**Met on 2026-09-25 at `08:19:25Z`. These are the readings.** Taken by the
release thread as an unauthenticated HTTPS GET, with no Railway tool involved,
and read independently by the ladder thread at `08:23Z` field for field.
`/readyz`, whole body:

```json
{"ready":true,"released":true,"configured":true,
 "operations":["InvokeLLM","ExtractDataFromUploadedFile"],
 "missingProviders":[],"authorityMode":"independent",
 "base44ExecutionDependency":false,"trafficCutoverVerified":false,
 "revision":"38cb0bea4637a0339a19c75a1c15a450181c3165",
 "browserContract":"cm.integrations.v2","browserRevisionBound":true,
 "browserReleased":false,"browserOperations":[],"browserReady":false}
```

The exit condition is the `authorityMode` and `base44ExecutionDependency` pair,
and it is met. Four further notes, each of which is a reading and not a
reassurance:

- **The browser route is shut, and by both conditions.** `browserReleased:
  false` and `browserOperations: []` mean neither half of `app.mjs:44` is
  satisfied. Because `runtime.mjs:19-20` makes `operations` a ceiling on
  `browserOperations`, the list caps the browser at the same names even if
  somebody later sets both browser variables — which is the ceiling this stage
  described, now with a non-empty list under it. That list has since grown to
  three with `SendEmail`, and the ceiling alone would therefore have admitted a
  browser send of mail; #281 closed that with a refusal rather than a
  convention. Both browser readings above are unchanged at the latest
  measurement.
- **`missingProviders: []` is a real answer here for the first time.** It
  filters `config.operations`, so it was vacuous while that list was empty;
  with two AI operations on it, the empty result means the Anthropic key and
  model are present. At that reading it still said nothing about `SendEmail`,
  which was not on the list; `SendEmail` joined it later the same day, so a
  fresh `missingProviders: []` now covers the SendGrid key too.
- **`trafficCutoverVerified: false` is not a measurement** and must not be
  cited either way. It is a hardcoded literal in both services
  (`integration-runtime/runtime.mjs:79`, `pennsync-api/runtime.mjs:134`), like
  the preflight's `paidCalls`, `writes` and `base44FunctionCalls`.
- **`revision` is `38cb0be`, which was `main`'s tip when the write happened,
  not a commit anybody chose.** That is the coupling this document records
  elsewhere: a variable change is a deploy and it rebuilds from the tip. It
  cost nothing here because that commit changed no service code, but check the
  diff before the next write rather than after it.

**The startup preflight from the same boot** — deployment
`9ee4913b-4aac-4860-8f44-a19eedae0b0c`, read out of the Railway deploy log:

```json
{"anthropic":{"status":200,"valid":true,"model":"claude-sonnet-4-6","hasMore":false,"required":true},
 "sendgrid":{"status":200,"valid":true,"senderConfigured":true,"required":false},
 "storage":{"status":200,"valid":true},
 "stateRpc":{"valid":true},
 "authority":{"status":401,"valid":true,"anonymousDenied":true,"required":true},
 "resultEncryption":{"valid":true},
 "identityHashing":{"valid":true}}
```

**The `401` is the pass, and a few hours after this was written `#276` showed
that the pass was not enough.** A status of 401 in a log reads like a failure,
so it needs saying plainly that the check requires 401 or 403: a successful
anonymous call would mean the caller's own token is not what authorizes. What
the status could not say is **which** 401 it is. The gateway refuses a
**revoked** publishable key with the same 401 the database uses to refuse an
anonymous caller — so the check passed in exactly the state it exists to
catch, which is this document's own recurring defect arriving inside the probe
written to measure things.

Only the body separates them, measured against the real cluster on 2026-09-25:
a live key reaches PostgREST and PostgreSQL answers
`{"code":"42501", … "permission denied for function pennsync_staging_context"}`,
while a revoked one never gets that far and the gateway answers without a
SQLSTATE. `#276` adds `keyAccepted`, which reads the body for that code, and
keeps it **beside** `anonymousDenied` rather than replacing it — an anonymous
SUCCESS is still the real defect and is still caught, and a failure has to say
which half failed. That is the same reason `senderConfigured` (now
`fromAddressWellFormed`, #288) sits beside
SendGrid's `valid`.

**So read the reading above for what it is.** It was taken at `08:19:25Z`,
before that change, so it carries `anonymousDenied` and no `keyAccepted`: it
proves the RPC exists and that an anonymous caller is refused, and it does
**not** distinguish a live authority key from a revoked one.

**The next boot carried the field, and it answered.** The runtime rebuilt on
`17c9cdc` and its preflight at `09:10:04Z` read `authority {status:401,
valid:true, anonymousDenied:true, keyAccepted:true}` — the first time anybody
has measured that the live publishable key **reaches the database** rather
than being turned away at the gateway. Both halves now hold: anonymous is
refused, and the refusal came from PostgreSQL. Neither version proves a real
SESSION succeeds — no login exists for that round trip (§4), so **the first
real call is still the proof**.

**One thing could not be read back on this service, and `#276` closed it the
same day — but not yet on the running service.** This stage says the app id is
the value that fails silently: the production id is in `ALLOWED_APPS`, so
stating it boots, reports ready, and is then refused by every authorization
call. `pennsync-api` publishes `appId` and `appStated` on its own `/readyz` for
exactly that reason. The integration runtime's `publicReadiness` published
neither, so its binding was written-not-verified — correct, and unconfirmable.

It now publishes the pair (`runtime.mjs:95`), and `#276` goes further than
reporting: `AUTHORITY_APP_PINS` declares which app each reviewed target's store
carries, a mismatch throws `APP_BINDING_MISMATCH` at startup (`:53`), and a
target with no declared pin throws rather than defaulting — so adding a target
forces the decision instead of inheriting silence. Note why that is pinned per
target rather than as "the production id is always wrong": that stops being
true the day a production project joins the target list, and a pin does not.

**And checking whether the tree's state had reached the service turned up
something bigger, which is recorded in full at the end of this stage: it
already had.** The live runtime answers with `appId
6a9881683dc68a0bd54f1ef7` and `appStated true` — so the binding is confirmed,
by the service itself, and is no longer written-not-verified. Confirm it from
`/readyz` rather than from this paragraph.

**A merge reaches these two services DIFFERENTLY, and this page had one rule
for both.** First measured 2026-09-25 shortly after `#276` merged, by an
unauthenticated GET of each `/healthz`, with `main` at `17c9cdc`:

| Service | Running revision | Where that is |
| --- | --- | --- |
| `pennsync-integrations` | `17c9cdc` | **`main`'s tip** — four merges past its last variable write |
| `pennsync-api` | `1a93f5b` | what `main`'s tip was when its last variable write ran |

So the rule this document repeated — a variable change is a deploy that
rebuilds from the tip, therefore a merge reaches a service at its next
variable change — is only **half** the picture on `pennsync-integrations`,
which was carrying code merged minutes earlier with no variable write in
between. `#276`'s own commit message says "this reaches the service at its
next variable change"; it had already arrived.

**Both triggers are live on that service, and the second reading proved it.**
An hour later the runtime was on `55496b5` — `#277`'s merge commit — and
`#277` touches only the release-ladder tool, nothing under
`/services/integration-runtime/**`, so that deploy cannot have come from a
merge. It came from the mail-switch variable write. So a release-variable
write rebuilds **either** service from `main`'s tip, and the runtime
**additionally** deploys on merges touching its directory. The first draft of
this section said only "deploys on merge", which is incomplete rather than
wrong — and the correction came from re-reading the revision, not from
re-reading the config, which is the reason to read `/healthz` again after any
change rather than trusting a mechanism already written down.

**Two revisions are not a mechanism, so the mechanism was read.** From
outside, a service sitting on the tip cannot be told apart from one somebody
redeployed a moment ago. The thread holding the Railway connector read the
per-service config, which is the only place this is readable, and confirmed it
made no variable write on the runtime after `08:20Z`:

```
pennsync-integrations  source: {branch: "main", rootDirectory: "/services/integration-runtime",
                                checkSuites: false}
                       build.watchPatterns: ["/services/integration-runtime/**"]

pennsync-api           source: {branch: "main", commitSha: "20c15d8f",
                                rootDirectory: "/services/pennsync-api"}   ← no watchPatterns
```

**So the conservative reading above is the measured one: the runtime deploys
on merge.** Every push to `main` creates a deployment row on it, and the watch
pattern decides whether that row builds or reads `SKIPPED`. `#276` touched
that directory and read **SUCCESS at `09:09:44`, two seconds after the
merge**; `#272`, `#273`, `#274` and `#275` all read `SKIPPED`. On
`pennsync-api` the latest deployment is still the `08:34` variable write, and
`#273` touched **its** directory without deploying it.

**And `checkSuites: false`: the deploy does not wait for CI.** `main`'s run
for that merge started at `09:09:42` and was still going minutes later, so the
code was serving before any of it finished.

That does **not** mean nothing gates this service, which is how a first draft
of this paragraph put it. There are two gates; they sit either side of the
merge rather than before the deploy, and both were read from the tree at
`17c9cdc`:

- **CI gates the MERGE.** `ci.yml`, `pennsync-app.yml`, `pennsync-authority.yml`
  and `pennsync-browser.yml` carry no `paths:` filter, so lint,
  `typecheck:signal`, `pnpm test` and all eight gates run on a runtime-only
  pull request; `external-integrations.yml` adds the runtime's own suites on
  top. `checkSuites: false` only means the deploy does not consult any of it.
  So **the merge decision is the last gate that exists.**
- **The Docker build re-runs the runtime's suites.** The builder is the
  Dockerfile, whose `RUN node --test *.test.mjs` runs inside the container as
  `node`, with no `node_modules` (that package declares no dependencies), no
  network and no environment. A failing top-level suite fails the BUILD, so
  there is no image and no deploy, and the previous container keeps serving.

Two things follow from the second. It is a real second gate, independent of
CI. And it constrains what a **top-level** `*.test.mjs` there may do: no
dependency, no network, no file outside the directory — D60's rule arriving as
a build context rather than as a guard. `tests/` is outside that glob and has
its own lockfile, which is where a suite needing any of those belongs.

**The healthcheck is `/healthz`, which is liveness only** (`app.mjs`): it
answers `{status:'alive', release, revision}` with 200 for any process that
listens, and never consults `publicReadiness`. `/readyz` does answer 503 when
not ready, and Railway is deliberately not pointed at it — a paused release
must still be able to deploy.

Two consequences, now measured rather than contingent:

- **The screening moves to the pull request** for `services/integration-runtime`.
  The pre-write diff in this stage exists because a variable change ships
  whatever is at the tip; on a service that deploys on merge, that check
  happens after the code is already serving.
- **A merge-hold during an in-flight variable write protects nothing there**,
  because the merge *is* the deploy.

#### What a runtime pull request has to answer

Neither gate can see the thing that actually breaks this service.
`server.mjs:7` calls `loadConfig()` at module top level, so its thirteen
startup refusals (`runtime.mjs:15-53`, plus `INVALID_PORT` at `server.mjs:10`)
are evaluated against the **live variables** — which no test and no CI job
ever sees, because every one of them supplies a fixture. The live values are
not in the diff. That splits two ways:

- **A throw at startup is loud and safe.** Nothing listens, the healthcheck
  never passes, the deploy does not go active, and the merge simply does not
  reach the service.
- **A boot that SUCCEEDS while the configuration is wrong** in a way
  `loadConfig` does not check is the dangerous class: `/healthz` says alive,
  the deploy goes active, and every call is refused. That is the only way a
  merge replaces a working service with a broken one, and it is the class
  `#276` closed two members of.

So the question is not "do the tests pass" — the build answers that twice —
but **"does this change what the running container's environment must contain,
and is that true of the live variables today?"** Read a diff in this order:

1. **Does it touch `loadConfig` or anything it reads (`runtime.mjs:9-57`)?**
   Adding a throw, tightening a regex, or requiring a previously optional
   variable is each a claim about the live environment. `#276` added
   `UNPINNED_AUTHORITY_TARGET` and `APP_BINDING_MISMATCH`, both reading live
   values; that was checked before merge, and nothing would have caught it
   after.
2. **Does it change `OPERATIONS` (`contracts.mjs:10`)?** `runtime.mjs:17`
   refuses a live `INTEGRATIONS_ALLOWED_OPERATIONS` naming an operation the
   code does not list, so **removing** a name from the code while the variable
   still carries it refuses the boot. `:19` additionally requires the browser
   list to be a subset of the service list — which enforces the ceiling's
   direction but **not** the exclusion, so nothing in code stops the browser
   list gaining a name it should not have (§ the mail switch).
3. **Does it move work across `server.listen` (`server.mjs:33`), or change
   what `/healthz` answers?** Work moved above the listen widens the safe
   class; a check moved below it converts a failed deploy into a live broken
   service. Pointing the healthcheck at readiness would make a paused release
   fail its own deploy.
4. **Does it add a top-level `*.test.mjs` needing a dependency, the network,
   or a file outside the directory?** In Railway that reads as "the merge did
   not deploy", not as a test failure.
5. **Does it touch `AUTHORITY_APP_PINS`, `validAuthorityTarget`,
   `validAuthorityKey`, or the storage binding literal (`runtime.mjs:24`)?**
   All four read live values.

**And note what "touches its directory" includes.** The watch pattern is
`/services/integration-runtime/**`, not a source glob, so a change to a file
in that directory that is never executed — this service's own README, for
instance — still builds and deploys it. The pull request adding the paragraph
above did exactly that. The new container serves identical code and the effect
is a restart rather than a change, but it is a real deploy of a live service
from a documentation edit, so say so in the pull request rather than letting a
reviewer assume documentation is inert here.

**The ordering rule the whole thing reduces to:** on this service the variable
write comes **before** the merge when the code tightens what the environment
must satisfy, and **after** the merge when it widens it. `pennsync-api` is the
exact opposite — a variable write is what rebuilds it, so there the merge is
free and the write carries whatever `main` holds at that moment.

Two things beside this are **not** measured and are written as such. That a
deploy failing its healthcheck leaves the previous container serving is
Railway's documented behaviour, not something observed on this service —
observing it means breaking the service. And `preDeployCommand` is empty: it
could run `loadConfig` against the live environment in the new image, but the
healthcheck path already refuses that case, so the gain is a legible
deploy-log error instead of a 120-second timeout rather than extra safety.

**Keep the two mechanisms apart, and note that the pin does not hold.**
`pennsync-api`'s config names `commitSha: "20c15d8f"` while the service runs
`1a93f5b`, so a variable write on it still rebuilds from `main`'s tip rather
than from the pinned commit. One project, two behaviours, and only the
per-service config distinguishes them — which is why neither can be inferred
from the other.

### Stage F — Production Supabase project (size S to provision; the owner creates the project and approves the cost, a connected session provisions it)

- **The owner creates the project**, for the same two reasons Stage B gives for
  the Railway service: it lives in his Supabase account rather than ours, and it
  is paid infrastructure, which is one of his standing holds. Nobody here
  provisions it on his behalf. What a connected session does is the step after —
  run the provisioner against the database URL he supplies.
- New dedicated project, us-east-1, per D4. Do not reuse `CM Train`: it carries
  Hub Auth triggers and a different access boundary.
- `tools-pennsync-provision.mjs` against it — app pin set to production, read back
  from a new session, both migration directories applied in order, records last.
  This is the path the tool was built and tested for. **It creates no project**:
  it reads `PENNSYNC_PROVISION_DATABASE_URL` and expects a database that already
  exists, so provisioning is never the thing that brings one into being.
- Blocked by Stage C's synthetic-name decision: until that is settled the store
  serves no RPC in a production-pinned database, by construction.
- **A provisioned production store is not a store that can hold a patient, and
  the gap between those two readings is the whole of Stage C.** The name
  constraints are not a staging-only guard: `pennsync_private.agency.name` and
  `patient.display_name` carry `like 'Synthetic %'` and `patient.synthetic`
  carries `check (synthetic)` with no escape, and `20260919090000_deployment_app_pin.sql`
  says in its own header that these "are untouched and still refuse real names in
  every deployment. Relaxing those is a separate, separately reviewed migration."
  That migration does not exist in the tree. The same header says the pin opens
  enrollment — `identity_map`, `agency`, `membership`, `assignment` — to a
  production deployment; that half is the header's statement and is not
  independently verified here, while the refusal above was read from the
  constraints themselves. So **nobody should read "production database created"
  as "production ready for a real patient"**: the store can take staff and cannot
  take a chart until that migration is written, merged AND applied, and applying
  it is the owner's, as relaxing a real-name refusal is one of his standing holds.

**Exit:** production store provisioned; the pin proved chosen rather than
defaulted; `deployment` row dated.

### Stage G — The ports that are left (size M, parallel to D and E)

**Measured 2026-09-23: the startable side is at ZERO, and the count of what is
left has fallen twice since this heading was written — 31, then 24 after D82 to
D87, then 21 once D89 to D91 wrote the three ports those decisions unblocked.**
`tools-transition-disposition.mjs` reports 78 capabilities with no blocker, and
all 78 are registered in `services/pennsync-api` — so every port that *can* be
written without a decision has been. **The heading carried 31, then 21, and now
carries no count at all**, because it was wrong at both and the figure has since
moved again — D153's retirement of `enforceStaffRoleIntegrity` took the
`entity_authorization` bucket down by one and nothing updated the heading.
A count written into this prose is wrong within a merge, so there is none here:
the table below carries it, and `pnpm run check:transition-disposition` is the
instrument. Four buckets the
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
not written yet"** — that bucket is empty. It is the file layer, the
administrative write paths, and a vendor key.

| Blocker | Count | What it needs |
| --- | ---: | --- |
| `files` | 12 | Stage H, and one decision that is not this repository's. D85 re-measured D77 and it holds: the integration runtime serves a stored object only to its uploader, and a migrated object has no uploader. The mapping, resolver and planner are built; the bytes are not copied. Four different things in one bucket — 2 wait only on the reader model, 5 need the copy and the reader model, 5 have a write leg that needs neither, and 1 has two further blockers |
| `entity_authorization` | 6 | **NOT all ports, and this row said otherwise until D153 measured it.** D82 settled D23's open profile-write path at the caller's own row, and these are the admin and scheduled paths it deliberately does NOT reach: `autoApproveInvitedUser`, `autoEndDutyDay`, `offboardUser`, `setNurseDutyStatus`, `userManagement`, `userManagementV2`. **Two of these six are decisions rather than ports**: `autoApproveInvitedUser` and `autoEndDutyDay` carry the `schedulerAuth` fence and so have no caller at all, which is D49's unchosen per-agency scheduler identity and not a contract anybody can write; a declaration would not unblock either. A third decision, `enforceStaffRoleIntegrity`, has left the bucket entirely: D153 retired it because the owned store made it unnecessary. Of the six left, none can be ported against a capability that already exists: all six write `User`, and nothing in the store writes `pennsync_records.user` at all, so each is a forward migration rather than a repoint. D83 took the two `MedicareGuideline` writers out of this bucket by retiring them: a `global` table is written by migration |
| ~~`records_schema`~~ | 0 | **Emptied by D89, D90 and D91.** The three capabilities D84 kept as `port` with an uncarried leg — `distributePolicyAcknowledgment`, `sendExpirationNotifications`, `generateAIReport` — are all written. D75 had taken this bucket to zero on a correction; this is the first time every capability that was in it has been built. Note that `portQueueLine` omits an empty bucket, so it no longer appears in the measured line at all |
| `external_secret` | 2 | A new brokered operation for audio transcription, with the reservation, quota, encrypted result and audit the other seven have — over a PHI payload. Designed in D87; the key stays unwired, and `generateNoteFromRecording` has two further blockers that no key clears (the owned bucket's MIME set admits no audio, and it pins a model the broker does not accept) |
| ~~`entity_not_carried`~~ | 0 | Settled by D84. Three changed destination, four stayed `port` with the leg recorded in `uncarried_legs` |
| ~~`core_integration`~~ | 0 | Emptied by D86, which ported both capabilities as the caller gate and the D56 pause. Releasing `Core.SendEmail` is a flag flip rather than a build, and it stayed the owner's until he flipped it on 2026-09-25 — the runtime half at `09:42Z`, the `OWNER_HELD` lift in #283, and the api's `PENNSYNC_API_DELIVERY` at `16:19Z`. All three are spent and both capabilities now send |

**Where those readings come from, so the next person re-runs them rather than
quoting this row.** The bucket and its names are `pnpm run
check:transition-disposition`'s own `port queue` line, which this page pins in
Stage B. The split between decisions and ports is `schedulerAuth` in each
capability's module crossed against whether any file under `src/` names it: the
fenced ones are named nowhere, the rest are named by a screen, and the row above
says which is which. **Written without tallies deliberately** — this paragraph
carried a three-and-four split adding to seven, against a table that already
said six, because D153's retirement of `enforceStaffRoleIntegrity` was recorded
in the row and not here. The row's shape can move under a disposition ruling
without any capability being written, so re-measure rather than quote either.

**And there is a third reading, which is the one that changes how this bucket
should be planned.** None of them — the ports included — can be written against
a capability that already exists. Every one of them writes `User`, and
nothing under `services/authority-store/supabase/record-migrations/` writes
`pennsync_records.user` at all, so D82's `user_update` policy and
`user_self_write_guard` trigger are a permission with no performer: the store
admits a write nothing in it makes.

**That is the column this table and Stage J's both lack.** "A capability
exists" and "something can call it" are two questions, and a migration list
answers only the first. Stage G satisfies it and fails the second, which is
invisible in any list of what shipped. Stage J is the same pair with the
answers the other way round: its gate counts a call site as served only after
running that site's own arguments through the declared route, so what it
reports is reachability from the browser adapter through to the `grant
execute`, and what is left there is per-screen editing rather than SQL. Read
the two together and the difference is most of what remains — Stage G needs the
capability built before anything can call it, Stage J needs callers pointed at
capabilities that are already there.

### Stage H — Files (size M, can start once the production bucket exists)

- Read-only inventory of uploaded files in both production apps.
- Copy into the private bucket with a SHA-256 manifest; originals untouched.
- Migrate the 31 `UploadFile` call sites to `UploadPrivateFile`.
- `file_url` consumers resolve `cmfile:` handles to 60-second signed URLs at use
  time; fax and document flows bind to stable artifact ids, never to signed URLs.

**Exit:** `private_files` rehearsal receipt — source hash equals download hash,
foreign and revoked denial, expiry and renewal.

#### The duty toggle, and the first caller of D82's profile write

`setNurseDutyStatus` is served by `20260920710000_contract_duty_status.sql`,
and it is the first thing in the store that writes `pennsync_records.user`.
D82 built that path — an update policy naming `caller_user_id()` and a trigger
admitting only `PROFILE_SELF_WRITABLE` — and nothing had called it, so
`contract-duty-status.test.mjs` is the first evidence either half works.

It reached the queue's startable bucket and left it in the same change, on a
correction rather than a decision: `writtenColumns` could not read a patch
assembled into a local object before the call, so a capability whose six
columns are all on the allowlist was reported as writing outside it.

Four divergences from the original, each proved against it rather than
described:

* **The cross-user leg is refused by name.** Its only gate is
  `isProtectedSuperAdmin`, the platform tier D14 and D22 removed, and
  `user_update` would refuse the write anyway — as a row that did not update,
  which reaches the caller as success.
* **Membership is the only way in.** The original admits the platform owner
  *instead of* an active membership. A narrowing, and not one D40 widens back:
  there is no agency-scoped successor to "may set anyone's duty status".
* **A caller holding two agencies is served, and in Base44 is not.**
  `hasExactActiveAgencyMembership` refuses unless exactly one row comes back,
  which is how a handler with no envelope establishes a tenant. The business
  API's invariant is that every request names its tenant, so the compensation is
  deleted (D68). Its whole blast radius is which agency's activity trail the
  entry lands in, and the caller holds both.
* **The change and its trail entry are one transaction.** The original writes
  `UserActivity` with `.catch()`, so a failed audit leaves the change made and
  unrecorded (D37).

One detail cannot be ported and is recorded rather than approximated. The
off-duty message is cut at 320 **UTF-16 code units**, and JavaScript's `slice`
will cut between the halves of a surrogate pair. PostgreSQL text cannot hold a
lone surrogate, so `duty_message_bounded` counts units the way D33's
`bounded_reason` does and drops a character whose second unit would cross the
bound rather than splitting it — identical for every message that does not cut
mid-pair, one character shorter for one that does.

The sanitizer is in SQL and not in the service, which is the one place this
departs from D67's split. The original's own comment says why: the message is
spoken to callers by TTS and sent as an SMS auto-reply, so stripping markup is a
disclosure control rather than shaping, and **a control the service applies is a
control a direct RPC call skips.**

#### CROSS_SUBJECT_DOCUMENT_READ — a stored document is a second problem, and a port never clears it

**Named because it must not be inherited from a port.** Measured 2026-09-29.

The integration runtime derives its subject as
`hash(hashKey, [appId, agencyId, user_id])` (`runtime.mjs:136`) — per **(app,
agency, USER)** — and `providers.mjs`'s `fileRecord` admits an object only when
`row.subject` equals the caller's. `pennsync-api` holds no storage credential
and forwards the caller's own bearer, so the subject is the CALLER'S.

Two consequences, and conflating them is the hazard this record exists for:

1. **Within one person's work, a handle travels.** The subject is stable across
   requests, so an object one handler mints is readable by another handler in a
   later request by the same person. `operator-acceptance.mjs:78-89` drives
   upload, extract and sign as three separate invocations and expects all three
   to succeed, with a foreign-subject denial beside it. This is what lets a
   browser-supplied document capability port at all, and it is why
   `extractPatientDataFromDocument`, `extractClinicalDocument` and
   `splitReferralPDF` could move.
2. **Between people, it does not.** A COLLEAGUE opening a document is a
   different subject and gets `FILE_ACCESS_DENIED`. So every carried locator
   that exists so somebody ELSE can open it later stays blocked — and that is
   most of them. `Referral.document_url` is the worked example: the intake
   screen stores it for the care team, the census counts it as one of the 66
   locator fields, and porting the split detector over that same document
   changes nothing about it.

**So a port of a capability that READS a document during one request is never
evidence that STORING that document is solved.** The sentence to refuse is "the
referral upload is unblocked". The capability is; the persistence is not, and
the two happen to concern the same bytes, which is exactly why they get read as
one thing.

Closing this is not a data migration. It needs a reader model the runtime does
not implement — D77 pins `RUNTIME_READER_MODEL` against `REQUIRED_READER_MODEL`
and refuses every apply precisely because they differ — and giving that runtime
record or tenant authorization is a decision about ITS authorization model.
Unchanged by any of the three ports above.

### Stage I — Customer data migration (size L; after Stage F)

Owner-signed permits for the production and legacy apps, the mapping tables from
`docs/PENNSYNC_DATA_MIGRATION_RUNBOOK_2026-09-03.md`, an importer with an
immutable manifest, and a rehearsal into a disposable project before anything
touches the real one. 8,672 legacy rows and 3,190 production rows, zero id
overlap.

**Those counts are a record, not a measurement, and their COMPOSITION matters
more than their size.** They come from an ID-only read-only inventory taken on
2026-09-03 and nothing in this repository can re-count them. Read them broken
down, from that inventory: the old PennSync app is 8,672 rows, 387 patients and
8 users; CareMetric production is 3,190 rows, **1 patient and 2 users**. So
nearly all the real patient data sits in the app that `known_app` deliberately
omits so that no deployment can ever be pinned to it, and the live production
app holds one chart. Anyone planning this as moving a working practice's records
across is planning for the wrong shape — which changes what the cutover IS
rather than how long it takes.

**There is also no import path for real rows today, and that is by construction
rather than by configuration.** Every tool in the family says so in its own
header: `tools-pennsync-archive-import.mjs` is a "Local synthetic Patient
import", requires `first_name === 'Synthetic'` and writes `synthetic: true`
itself, into `pennsync_private.patient` — the staging table, not the chart of
record; `tools-pennsync-acquire.mjs` is "Explicit synthetic staging records
only"; `tools-pennsync-archive.mjs` has "no SDK, network, import, or deletion
path"; and `tools-pennsync-cutover.mjs` implements no database operation at all.
So the importer above is a thing to build, and **nothing it needs is sized by
the row counts** — the manifest, the mapping and the rehearsal are there for
correctness and reversibility, which one chart needs as much as four hundred do.
Whether the retired app's 387 patients come across at all is an unanswered
product question, and it is the one that decides whether this stage is large.

**Exit:** `archive_restore`, `sessions` and `rollback` receipts; zero unexplained
conflicts.

### Stage J — Frontend (size L to XL; the largest untouched surface)

This is the stage the status tables consistently understate. Nothing has moved:
453 entity call sites across 69 entity types, 366 files importing the Base44
client, 198 function invocations through 83 wrappers, 41 Core integration sites,
4 SDK importers — all at ratchet BASELINE, which is what those figures are.
**445 became 453 on 2026-09-29 with no call site added**: the shared matcher
could not read a namespace bound into an object literal, and eight sites in
`src/lib/retiredOfflineQueue.js` were invisible to this ratchet and the
destination census at once. An instrument gained sight; the coupling did not
grow.

**The baseline is a CEILING and the tree now sits one under it, which is the
distinction to keep.** `pnpm run check:base44-surface` reads
`entity_call_sites=452/453` on 2026-10-08: `src/pages/ReferralFollowUp.jsx` was
deleted and its route became a redirect, taking one site with it. A ratchet
baseline is deliberately not lowered by a deletion — it is the line coupling may
not cross — so the two figures are a ceiling and a reading, and every count
below that crosses call sites against something else is over the reading. Do not
difference the two: they answer different questions.

**Re-read on the tree that removed the clinical risk-prediction and PDGM payment
features, beside that one rather than through it:** `entity_call_sites=430/430`,
and this time the baseline moved WITH the reading. That removal was an owner
decision to delete whole features, and it deleted twenty-two entity call sites;
the same change lowered every frontend maximum it moved (`client_importers`,
`entity_call_sites`, `entity_types`, `function_invocations`,
`function_wrappers`) to what the tree reads, which locks in the follow-up page's
site by the same write. The tool's own header calls a count under the baseline a
gain to be locked in by lowering it, and a deliberate removal is that case where
a page that merely went was not: leaving the headroom would let a later change
re-add coupling up to the old line without the ratchet saying anything. The two
figures still answer different questions; on that tree they are equal.

**And the count understates it a second way (D80).** "Replace call sites tier
by tier" reads as a refactor whose size is the count. Crossing all 453 against
their entity dispositions — `pnpm run check:frontend-destination`, added
2026-09-22 — says otherwise. **This table is the reading at `8bc9d214`, kept as
a dated record**; the current one is below it:

| | Call sites | |
| --- | ---: | --- |
| `record_store` | 227 | a table exists |
| `broker_family` | 7 | the generic family serves that read |
| `activity_trail` | 3 | D25's successor |
| **has somewhere to land** | **237** | |
| `no_table` | 193 | `hub` (119) and `preserved_paused` (74) — no table here at all |
| `broker_is_read_only` | 9 | a write to an entity the family serves readonly |
| `global_reference_is_read_only` | 5 | a write to a D83 reference table nothing may write |
| `no_realtime_seam` | 1 | `subscribe`, which the owned store has nowhere to put |
| **cannot land** | **208** | |

The last row arrived on 2026-09-25 and is the same shape as the broker split one
line above it, found from the other end while porting those very entities. Five
sites — `ComplianceRule.create`/`.update`, `MedicareComplianceRule.create`/
`.update` and `MedicareGuideline.update` — are `port` over tables that exist and
still cannot land, because D83 says a `global` reference table is written by
migration and never at run time, and the store implements it. **The refusal is
the GRANT, not the policy**: all eight of those tables grant no caller role
anything, so `authenticated` never reaches a policy and the error is `permission
denied for table`. Which matters, because a definer contract owned by the record
owner *could* write them — "no write path" is a decision D83 takes, not a wall
the schema builds, so if that decision is revisited these five become servable
with no schema change. The tool reads those grants out of the emitted SQL rather
than trusting D83's word, and fails if one appears.

**"Has somewhere to land" is NOT "is ready to move", and reading it as the
second sizes this stage at a fraction of itself.** The checker says so in its
own header, in capitals, and the sentence is worth carrying here because the
whole of Stage J gets estimated off that one word: "WHAT `store_can_hold` DOES
NOT MEAN. It means the record store has a table for that entity, or the generic
broker family serves that read, or D25's trail is the successor. It does NOT
mean a ported capability covers the operation — that is a narrower question this
tool deliberately does not answer, because answering it by inference is how a
bucket comes to claim more than it measured." So the 242 is a statement about
TABLES. Whether anything serves the call is a second question, and this tool is
built not to answer it.

**Re-read 2026-10-08, beside the table above rather than through it:** 452 call
sites, 244 with somewhere to land (`record_store` 234, `broker_family` 7,
`activity_trail` 3), 208 without. Two independent movements since that head, and
keeping them apart is the point of recording both:

- **`no_table` 193 became `no_table` 119 plus `no_access_contract` 74** without
  a single site changing its verdict. The eight OASIS entities (#401) and the
  fax and phone entities (#408) gained SCHEMA-ONLY tables under D7's amendment,
  so those sites have a table and still no capability over it — a more accurate
  REASON for the same refusal. The 208 did not move, which is how you can tell
  this was a relabelling and not progress.
- **`record_store` fell by one and the total with it**, because
  `src/pages/ReferralFollowUp.jsx` was deleted and its route became a redirect.
  That is a site leaving the population, not a destination being lost.

So the four refusal buckets that were NOT relabelled — 9, 5, 1 and the 208 they
sum into with the other two — are unchanged across all three readings, and that
is the stable fact.

**Re-read on the tree that removed the clinical risk-prediction and PDGM payment
features, beside both:** 430 call sites, 237 with somewhere to land
(`record_store` 227, `broker_family` 7, `activity_trail` 3), 193 without —
`no_table` 119 and `no_access_contract` 59, with the other three buckets
unchanged at 9, 5 and 1. Twenty-two sites left the population and BOTH sides of
it moved, which no earlier reading here records: seven `record_store` reads went
with the deleted screens, and fifteen sites on paused OASIS entities went with
them, every one of those from `no_access_contract`. So the 208 fell for the
first time, and it fell because screens were deleted rather than because
anything gained a destination — `hub` is untouched at 119 and nothing was
ported. The percentage moved too, to 45%, and it is still the least informative
figure in the reading.

**Do not take the by-disposition split off this table, and note that the known
by-one disagreement has MOVED buckets.** The per-ENTITY rollup reports one
destination per entity, so it disagrees with the per-SITE tally by one by
construction — `FaxLog` carries six sites in one bucket and its one `subscribe`
site in another, and the rollup folds both into whichever destination it reports
for the entity. At `8bc9d214` that put the rollup one HIGH on `no_table`
(194 against 193). On 2026-10-08 the rollup reads `no_access_contract` 75
against the per-site 74, with `FaxLog` reporting seven sites and
`no_realtime_seam` absent from the rollup altogether, because #408's
schema-only table moved FaxLog's six off `no_table`. Both readings describe one
measurement and one construction; neither bucket name is the durable part, and
summing the rollup against the per-site tally is wrong in both.

A first draft of this very paragraph carried the `8bc9d214` bucket names into a
sentence about the 2026-10-08 reading — the page's own subject arriving inside
the paragraph written to record it. The remedy was to run the tool, not to read
more carefully.

**That second question now has its own instrument, and the first version of it
got the answer wrong in a way worth keeping on the page.**
`pnpm run check:entity-routes` (#290, then rebuilt in #291) reports how many of
the 242 a route can actually serve. Its first version counted a call site as
routed when its `Entity.operation` pair was DECLARED in the route table, and
reported 36. Run properly — each site's own arguments put through the route's
`request` — **none of those 36 succeeded**: 31 ask the staff list to sort by
`created_date` or `full_name`, which the roster contract projects neither of
(the carried `user` table has no name column at all, D69). The other 5 were
refused for asking more rows than the contract's ceiling, which is no longer a
refusal: a screen naming `ALL_ROWS` is naming a bound it does not have, so the
complete-set proof answers that risk where the ceiling only approximated it,
and those 5 are served today. A declaration is not a success, and the only way
to tell them apart is to run the call.

Measured on `main` after #294, and kept as a dated record of that head rather
than maintained:

```
entity routes: 14 declared, 29/242 landable call sites SERVED, 213 still to adopt
  30 of those are sites a declared route REFUSES (User.list:sort), and 2 pass arguments this cannot read
  of those 213, across 39 entities: a wider generic family could serve 1 reads and 0 writes above D16's ceiling; 212 need a named capability
```

And after #295 and #300, also a record of that head and not maintained either:

```
entity routes: 21 declared, 38/237 landable call sites SERVED, 199 still to adopt
  30 of those are sites a declared route REFUSES (User.list:sort), and 2 pass arguments this cannot read
  of those 199, across 38 entities: a wider generic family could serve 1 reads and 0 writes above D16's ceiling; 198 need a named capability
```

And after #299, batch E's ten contracts — a record of that head, not
maintained either:

```
entity routes: 33 declared, 47/237 landable call sites SERVED, 190 still to adopt
  30 of those are sites a declared route REFUSES (User.list:sort), and 5 pass arguments this cannot read
  3 route(s) are declared but UNPROVED — every call site passes a variable, so the contract's own refusals are what checks them: NotificationPreference.create, NotificationPreference.update, PatientRecommendation.create
  of those 190, across 33 entities: a wider generic family could serve 1 reads and 0 writes above D16's ceiling; 189 need a named capability
```

And after #296 carried batch D's fourteen over the operational tables — a
record of that head, not maintained either:

```
entity routes: 52 declared, 71/237 landable call sites SERVED, 166 still to adopt
  30 of those are sites a declared route REFUSES (User.list:sort), and 20 pass arguments this cannot read
  8 route(s) are declared but UNPROVED — every call site passes a variable, so the contract's own refusals are what checks them: AgencySettings.create, AgencySettings.update, FaceToFaceEncounter.create, FaceToFaceEncounter.update, NoteConversion.create, NotificationPreference.create, NotificationPreference.update, PatientRecommendation.create
  of those 166, across 31 entities: a wider generic family could serve 1 reads and 0 writes above D16's ceiling; 165 need a named capability
```

And after the two library reads whose call sites had been called unprovable —
a record of that head, not maintained either:

```
entity routes: 54 declared, 98/237 landable call sites SERVED, 139 still to adopt
  6 of those are sites a declared route REFUSES (User.list:sort), and 21 pass arguments this cannot read
  8 route(s) are declared but UNPROVED — every call site passes a variable, so the contract's own refusals are what checks them: AgencySettings.create, AgencySettings.update, FaceToFaceEncounter.create, FaceToFaceEncounter.update, NoteConversion.create, NotificationPreference.create, NotificationPreference.update, PatientRecommendation.create
  of those 139, across 31 entities: a wider generic family could serve 1 reads and 0 writes above D16's ceiling; 138 need a named capability
```

**Nine of the sites in the pinned reading further down, across thirteen
declarations, came from routing capabilities that already shipped — no
contract, no migration and no SQL.** `manageClinicalPathway`, `manageClinicalLibraryTemplate`,
`manageClinicalLibraryFolder` and `manageEducationMaterial` each take an action
beside the id and the payload, so each serves a `create`, an `update` and a
`delete`, and twelve declarations were the whole of that. The thirteenth is
`Task.create`, and what had been holding it lived in a test file rather than in
the store: #297's regression test for the served-site subtraction planted that
exact key as its own route and asserted the measurement rises against a baseline
taken without it, so declaring it put the key in the baseline and the assertion
failed. The plant is DERIVED now, from whatever undeclared pair the tree has in
the shape that case needs, and it refuses rather than skips when there is none —
so the wall is gone rather than moved one route along, which repointing the
plant would have done. Read that as the general lesson rather than as one
route's history: a capability can be complete at every layer and still
unreachable for a reason that lives in a test, and the remedy for a check held
hostage by a name is to derive the name.

**Five of the thirteen are UNPROVED and eight are served, and the unreadable
line rising beside the served line is the expected shape rather than a
regression.** A route whose call sites all pass a variable is counted in the
first and not the second, so declaring twelve routes over sites that pass whole
payloads raises both at once. What checks those five is the contract's own
refusals against the real migration, which is the better check and not this
tool's to pre-empt.

**Two things about that change are worth keeping.** Declaring the library
writes put two DECLARED call sites into the double-call shape #297's case
needs, so the committed report now exercises that multiset subtraction with no
plant at all — measured by restoring the per-key `Set` and watching three tests
fail, one of which reads only the committed figures. And a test asserting
`Task.create` was held on the gate was deleted rather than renamed: every one of
its assertions still passed while its name and its message said the opposite of
the tree, which is the shape of a check whose subject is gone.

**The branch that made this move kept its own intermediate readings and they
are deliberately not on this page.** It measured at 95, then 102, then 104
served before merging, and 107 on the head that merged, which `main` never
stood on because another branch landed in between; those four heads are a
branch's staging history
rather than anything a deployment or a reader passed through. A record block
earns its place by being a head somebody could have been standing on; pasting a
branch's private waypoints into a chain that otherwise tracks `main` would make
the page describe a line of development that never existed. The last of those
four is the one worth naming, because it was a real pull request head with a
real CI run on it and it still does not belong here: `main` went from the
patient-alert reading straight to the merged one, and a block for the head in
between would describe a tree no reader could have checked out of `main`.

**The move into that record was three sites across two routes, and its cause
was a re-measurement rather than anything new being built.** Both capabilities have
been shipped since the clinical library landed; what changed is that this
file's own note calling their call sites unprovable was checked. It named
`ClinicalLibraryTemplate.list` and `PatientEducationAssignment.filter`, and it
was right about one site and wrong about three. The template list has TWO call
sites, not the one the note assumed: the pager passes a computed skip and is
still unreadable, while the top-templates widget passes two literals. And the
education sites pass `patient?.id`, which #300 settled is READABLE — a row id's
value decides nothing a route can be wrong about, where a sort or a limit is
shape. The note predated that rule, so the reason for the exclusion expired and
the exclusion did not, which is the same shape as a bucket keeping its name
after the reason for it has gone.

**Declaring them turned up a latent mis-order in the shared helper, and it is
the more useful half of this change.** The library reads match a screen's sort
against a list of FIELDS, and `contract_clinical_library_template_list` orders
`usage_count DESC`. A screen asking for `+usage_count` would have passed the
field check, been served the descending page, and had it re-sorted ascending in
the browser — the most-used templates handed to the screen as the least-used,
with every other part of the seam behaving correctly. Nothing was reading it
that way today, so no screen was wrong; it was one ascending call site away.
The helper's own comment already said what it needed — "the contract has to
have done the ordering, which `sortable` is the list of" — and a field list is
not that claim. Each of the seven library routes now names the exact sort
STRING its contract implements, read off that contract's `order by`, and a
direction no contract implements refuses. The re-measure was that none of the
existing call sites passes one, so this narrows the seam and moves no total.

**And the move into the record before THAT one was 24 sites, with one order
rather than any new capability behind it.** The roster contract learned to answer `created_date` descending,
which is what the `User.list` sites that were refused on their sort were asking
for; the declared count does not move, because no route was added. Every one of
the 24 leaves the sort bucket, which is why that line falls while the unreadable
line holds. The figure this block reads off its predecessor is also the one
place a reader should be most careful: the previous block's numerator and this
tree's base reading are the same number for two unrelated reasons, and the two
were told apart by running the printer on both trees rather than by reasoning
about them.

**What that block says, and why the prose below it names no total from it.**
The numerator is the count of landable call sites a declared route actually
serves when the site's own arguments are put through it, and the denominator is
the count of sites with anywhere to land at all. The numerator moved on #295
(batch C's nine reference and configuration sites) and again on #299 (batch E's
nine, which are different sites — chased rather than inferred from the
entities), and not on #300, which changed the denominator only. The third line
of the block appears exactly when the tool prints it: a route every one of
whose call sites passes a variable cannot be run through the gate at all, so
what checks it is the contract's own refusals and the suite that raises them.

**The two lines about unreadable sites and unproved routes are one population,
and that was measured rather than assumed.** Each of the three unproved routes
has exactly one call site — `src/components/oasis/OASISToPatientChartPusher.jsx`
and the two in `src/components/notifications/NotificationPreferences.jsx` — and
those three sites are three of the sites the line above counts as unreadable.
So the unreadable count rose on this merge because three sites GAINED a
declared route the gate cannot run, not because three sites stopped being
readable: nothing regressed inside a merge whose headline is capabilities
landing. The two readings could as easily have described separate populations,
which would have meant the opposite, and the only way to tell was to open the
three files. The general form is worth carrying to any reading like it: **a
figure that can only go up when a route is added should be labelled as such
wherever it appears**, because unlabelled it is indistinguishable from a count
of things that broke.

**#296 is the second merge of that shape and the label earned its keep.** Batch
D's fourteen capabilities over the seven operational tables adopted twenty-four
sites and declared five further routes the gate cannot run, so the unreadable
line rose by fifteen in a merge that adopted more sites than any before it.
Fifteen is the size and the cause is routes arriving, not screens breaking: the
ten sites beyond the five unproved routes are over entities that had no route
to be unreadable against until this merge, so they left the undifferentiated
remainder and joined a line that counts them. Every total stays in the block.

**Two denominators, both real and different populations** — every entity call
the frontend makes, and the subset with a table behind it. A served figure
quoted without saying which one it is over is the same label error this page
warns about above. **And the smaller one has moved on its own**: it fell by
five when D83's global-reference writes stopped counting as landable, and the
remainder fell by the same five with **nothing adopted**. #299 then moved that
remainder again, by nine, because nine screens adopted routes. Those two moves
look alike in the numbers and mean opposite things, which is the whole reason
this section states sizes and causes and leaves every total to the block: a
remainder falling is progress or reclassification depending on which, and only
the cause tells you. Re-derive rather than quoting — every merge that points a
screen moves the numerator and every migration that carries an entity moves the
denominator.

**And this page carries two remainders that are not the same population, which
is worth saying because they were briefly the same number.** The route gate's
remainder is call sites with nowhere to land *yet*, printed in the block above.
The destination gate's is **208**: call sites with nowhere to land *at all*,
measured by `check:frontend-destination` and not by this gate. On the head
where this paragraph was first written the two were the same number, so either
read as correct there, and #295 and #299 each moved the first and left the
second alone. A sentence that had been right became wrong with nothing changing
in it. The block's second line counts the sites a declared route REFUSES: the
route exists and the *screen* has to change, which is per-screen work rather
than per-entity work, and that is the more useful number for planning than the
remainder itself. Sites whose arguments the tool cannot read count as unserved,
because a gate that guessed would be back to counting declarations.

**The gate has three states, and the third one is why the batches can work at
all.** Proved, refused, and declared-but-unproved. A call site that passes a
variable — `AgencySettings.create(payload)` — cannot be run through a route at
all, and the first correction treated that as *cannot be served*, which failed
the build for **84 of the frontend's writes** and blocked four contract batches
from wiring anything. So refusing to COUNT an unproven route stands, and
refusing to PERMIT one does not: that question belongs to the contract's own
refusals against the real migration, not to a static check. A route whose every
call site is unreadable is declared, permitted, and reported in
`unproved_routes` — never counted as adopted, and printed, because an unproven
route nobody can see is how a declaration comes to read as coverage again.
Landed in #294.

**Two smaller properties of the same gate, both of them corrections.** A served
site is removed from the remainder as a MULTISET rather than once per file and
operation, because one file can call the same operation twice with only one of
them served — the per-key answer standing in for a per-call one, one layer out
in the arithmetic, which made the buckets sum short and failed the gate's own
test (#297; latent until a route existed over such a key). And a row id passed
as a variable is READABLE while a sort or a limit is not: `update(recordId,
fields)` was wholly unmeasurable on account of its first argument, which hid the
payload beside it, and the id's value decides nothing a route can be wrong
about. Keyed on the operation and the position — `get`, `update`, `delete` at 0
and nothing else — because a read's top-level arguments really are shape. That
is why the readable write surface is **31 sites rather than 7** (#300).

**The ceiling on avoiding the remaining work is measured, and the write half is
zero.** The obvious alternative to writing a capability per entity is to widen
the generic broker family, and D16 bounds how far that can go. #291 made the
tool run the WHOLE of `auditBrokerCeiling` rather than its read predicate
alone — the earlier 31 was that narrower reading, and the ceiling also refuses
an entity that names a clinical subject, carries a credential, can hold a file
or reaches tenancy through a clinical entity. It passes no manifest exemption,
deliberately: those exist only for entities already dispositioned `broker`, and
granting one here would be the tool inventing the decision it is measuring.

- **1 read site**, on `MedicareComplianceRule`. Four entities still clear the
  ceiling — that one plus `DocumentTemplate`, `OnCallShift` and `Physician` —
  but only this one has an unserved READ left; the rest of their remaining
  sites are writes.
- **0 write sites. None at all.**

**The zero is the figure that decides anything**: no entity behind the
remaining call sites plainly permits every write, so widening the generic
family avoids the named-capability work for not one write. The per-entity
contracts are not an expensive approach chosen over a cheap one that was
available. What is left is roughly forty entities' worth of named contracts and
handlers — the same shape as the 80 already built — rather than one design
decision.

**The reading after four patient-alert call sites adopted two routes and the
five write capabilities that had shipped without routes gained them.** A record
of that head and no longer the tree: the library-write wave landed beside this
one and the current reading is at the end of this section.

```
entity routes: 69 declared, 111/237 landable call sites SERVED, 126 still to adopt
  6 of those are sites a declared route REFUSES (User.list:sort), and 37 pass arguments this cannot read
  13 route(s) are declared but UNPROVED — every call site passes a variable, so the contract's own refusals are what checks them: AgencySettings.create, AgencySettings.update, ClinicalLibraryFolder.create, ClinicalLibraryTemplate.create, ClinicalPathway.create, ClinicalPathway.update, EducationMaterial.create, FaceToFaceEncounter.create, FaceToFaceEncounter.update, NoteConversion.create, NotificationPreference.create, NotificationPreference.update, PatientRecommendation.create
  of those 126, across 31 entities: a wider generic family could serve 1 reads and 0 writes above D16's ceiling; 125 need a named capability
```

**Four of the thirteen sites in that move are two routes' worth, and their
cause is capabilities that had been shipped for weeks reaching a screen for the
first time.**
`getScopedPatientAlerts` and `contract_alert_list` have existed since D21;
nothing was built here. What the reading needed was the strict question asked
per call site rather than per entity — does a contract answer the statement this
site makes, given its parameters, its ordering, its limit and its gate — and
four of the five `PatientAlert` sites answer yes. The fifth is a `create`, and
it is a permanent negative rather than a queue item: exactly one migration in
the record directory inserts `patient_alert`, and that insert derives every
column from an extracted clinical event and takes no caller payload, so serving
it needs a create contract rather than a route.

**A first reading of the same five got three of them wrong, and the reason is
worth more than the correction.** It called them unservable because
`contract_alert_list` clamps rows at a ceiling two of the sites ask past and one
asks ten times past. That is what the contract and the call site say together,
and it is not what happens: `independentEntityRoutes.js` had already settled it,
because a screen naming a large bound is naming one it does not expect to reach,
so the route asks for one row more up to the ceiling and a short page is the
proof it did not reach it. The reading had both ends and not the artefact in the
middle that consumes the declaration. **There are three things to read in a
question like this, not two.**

**Declaring them turned up a latent defect in the shared read helper, which is
the more useful half of this change — and it is the second one in a day.**
`screenRead`'s response read `result.entries` as a constant, because every batch
E contract answers `entries`; `contract_alert_list` answers `alerts`. A route
declared over it with the helper as it stood passed the route gate and would
have refused every real call, because the gate runs a declaration's `request`
against each call site's arguments and never exercises `response`. The answer
key is a parameter now rather than a copied response function, so the next
contract outside that family cannot inherit it by copying. The library sort
mis-order above is the same shape in the same file within the hour, which puts
the population plainly: it is not routes over unusual contracts, it is every
route whose `response` or `order` was written by copying a sibling. The claim
that the gate is blind to this is demonstrated rather than asserted — with the
key sabotaged back to the constant both projection tests fail and the gate
reports its figures unchanged.

**The reading after the library writes.** A record of that head and no longer
the tree either: it was taken on a branch that did not yet carry the route and
allowlist work, and the current reading is at the end of this section.

```
entity routes: 64 declared, 106/237 landable call sites SERVED, 131 still to adopt
  6 of those are sites a declared route REFUSES (User.list:sort), and 27 pass arguments this cannot read
  12 route(s) are declared but UNPROVED — every call site passes a variable, so the contract's own refusals are what checks them: AgencySettings.create, AgencySettings.update, ClinicalLibraryTemplate.create, CustomValidationRule.create, CustomValidationRule.update, FaceToFaceEncounter.create, FaceToFaceEncounter.update, NoteConversion.create, NotificationPreference.create, NotificationPreference.update, PatientEducationAssignment.update, PatientRecommendation.create
  of those 131, across 31 entities: a wider generic family could serve 1 reads and 0 writes above D16's ceiling; 130 need a named capability
```

**The reading after the five compliance reads.** A record of that head, and no
longer the tree: it was pinned when it was written and the route and allowlist
work below has since moved every line of it. The pinned reading is the last
block in this section.

```
entity routes: 71 declared, 138/237 landable call sites SERVED, 99 still to adopt
  6 of those are sites a declared route REFUSES (User.list:sort), and 28 pass arguments this cannot read
  12 route(s) are declared but UNPROVED — every call site passes a variable, so the contract's own refusals are what checks them: AgencySettings.create, AgencySettings.update, ClinicalLibraryTemplate.create, CustomValidationRule.create, CustomValidationRule.update, FaceToFaceEncounter.create, FaceToFaceEncounter.update, NoteConversion.create, NotificationPreference.create, NotificationPreference.update, PatientEducationAssignment.update, PatientRecommendation.create
  of those 99, across 28 entities: a wider generic family could serve 1 reads and 0 writes above D16's ceiling; 98 need a named capability
```

**Seven routes moved the served line by a multiple of themselves, and the
multiple is the finding rather than the total.** These five entities are read
from far more screens than they are declared for — compliance audits and
incidents are listed by dashboards, exports and detail panels alike — so one
route per entity method reaches many call sites at once. That is the shape to
expect from a READ port and not from a write one, where a create route typically
serves the one form that calls it. Three entities left the remaining line
entirely, which is the part that shortens the queue rather than the served count.

**The attribution was measured rather than subtracted.** These figures are
global, so a delta between two heads cannot say which change caused it: a
sibling merging in the same span moves the same line. What was run instead is
the printer TWICE ON ONE MERGED TREE, once with `main`'s
`independentEntityRoutes.js` and once with this branch's, which is the only
reading that isolates one file's effect. Under `main`'s file this tree prints
the block above; under this branch's, the block here. The same pair was run on
two different bases a day apart and gave the same deltas both times, which is
what makes them a property of these seven routes rather than of a moment.

**The reading after the five compliance WRITES.** A record of the head it was
taken on, and no longer the tree: it was pinned when it was written, and the
route and allowlist work below has since moved every line of it. The pinned
reading is the last block in this section.

```
entity routes: 76 declared, 145/237 landable call sites SERVED, 92 still to adopt
  6 of those are sites a declared route REFUSES (User.list:sort), and 33 pass arguments this cannot read
  14 route(s) are declared but UNPROVED — every call site passes a variable, so the contract's own refusals are what checks them: AdrAuditCase.create, AgencySettings.create, AgencySettings.update, ClinicalLibraryTemplate.create, ComplianceAudit.update, CustomValidationRule.create, CustomValidationRule.update, FaceToFaceEncounter.create, FaceToFaceEncounter.update, NoteConversion.create, NotificationPreference.create, NotificationPreference.update, PatientEducationAssignment.update, PatientRecommendation.create
  of those 92, across 28 entities: a wider generic family could serve 1 reads and 0 writes above D16's ceiling; 91 need a named capability
```

**A WRITE port moves the line by ONE, and that contrast is the useful half of
this reading.** The same two-tree attribution was run for these five routes —
the printer twice on this one merged tree, once with `main`'s route module and
once with this branch's — and it gives +5 declared, +7 served, −7 to adopt, +5
unreadable and +2 unproved, with the entity count unmoved at 28. Seven served
plus five unreadable is twelve, which is every call site these five routes
reach: the arithmetic closes, so nothing is unaccounted for.

Seven from five routes is barely a multiple, against thirty-two from seven a
port earlier, and the reason is structural rather than incidental. A read is
called from every screen that displays the thing; a write is called from the
one form that performs it, so the served count of a write port is close to its
call-site count by construction. **Do not size a write port by what a read port
moved**, and do not read a small move as a route that failed — the number to
compare a write port against is its own call sites, not a sibling's multiple.

The five that went to `unreadable` rather than `served` are the same finding in
its own form: `AdrAuditCase.create` builds its payload from the letter
analysis and `ComplianceAudit.update` passes `buildAuditFields`'s return, so the
gate cannot run the real arguments through `request`. "Cannot prove this serves"
is not "does not serve" — what stands in for the proof is the refusals raised
against the real migration, which `independentEntityRoutes.spec.js` requires by
name rather than taking on trust.

**No entity left the remaining line here, and that is expected rather than
disappointing.** `AdrAuditCase` keeps its read call site, which has no route
because its limit is a constant imported from another module, and
`ComplianceAudit` keeps eight read sites the census cannot even see. A write
port shortens the queue by call sites and not by entities.

**One site moved the wrong way, and it is named rather than netted off.** The
sites passing arguments this cannot read went up by one:
`ComplianceAudit.filter` in `src/components/smartNote/persistVisitNote.js`
builds its predicate in a variable, so the scan cannot see what it asks for.
Declaring a route made that site visible as unreadable where before it was not
counted at all, which is the check working — the call is made and is not proved
served. It is the recovery read of the SmartNote write path and belongs with the
write half of these domains.

**The move above is four call sites over eight route keys, and the two counts
are why the unrouted headline splits.** Ten write sites across three entities
reached a capability for the first time; four of them pass arguments the gate
can read and the other six pass a variable, so four routes are PROVED and four
are declared UNPROVED. `ClinicalLibraryTemplate.update` is one route with one
site of each, which is the cleanest demonstration that a route key and a call
site are not interchangeable. Nothing was built: all three contracts and all
three handlers shipped with the clinical library.

**A route may be counted served and still refuse every call, and the instrument
that sees it reads the HANDLER.** The gate proves a route accepts a call site's
arguments and never looks at the body it builds out of them, so a route emitting
a key its capability has no parameter for passes the gate and fails at the
service — `exactObject(params, [...])` refuses an unknown key outright. Landing
these routes added that comparison over the gate's own served set, and it found
seven route keys already in that state on this tree. Six are one shape: an
operational read declaring a field orderable where its contract takes no order
parameter. The seventh is the roster, and it is the reason the check has to read
the HANDLER rather than the contract or the SQL. Three of the four layers carry
`order`: the route emits it, the contract entry declares it and sends `p_order`,
and the store's current signature is `contract_roster_list(text, integer, text,
text)` with a matching public wrapper. The stale layer was the handler, whose
allowlist read `['limit', 'after']`, and every request is dispatched through it
before `contract()` is reached — so the call failed 400 before PostgREST or any
store was involved. **An apply would not have fixed it**, because an apply changes
the store and not the allowlist, and it survived because the order path IS covered
a layer above the one that refuses it. A test that enters below a boundary cannot
see the boundary.

**All seven are fixed as of the reading below, and the two fixes are different
things.** The six operational keys were fixed in the ROUTE — their contracts take
no order parameter, so `orderable` and `ordered` are now separate, the sort is
honoured client-side and the key is never emitted; those handler allowlists are
untouched and still lack it. The roster was fixed in the HANDLER, which now reads
`['limit', 'after', 'order']`, because that contract really does take the
parameter. Each was verified on its own rather than inferred from the pin
reaching zero, and the pin is now the empty set with a plant beside it, since an
empty expectation asserts nothing by itself.

**And the reading with both waves merged, read on `84718e6`.** It was this tree's
pinned block when it was written and is now a RECORD of that head: the compliance
writes landed under it, so the measured reading is the block further down and
this one is kept for the move it explains. Demoting it in place is what
`tools-entity-routes.test.mjs` asks for — it requires the measured reading to be
the LAST fence on the page, not the only one.

**The denominator moved too, and that is the more important half.** 237 became
245 because the shared entity-call matcher was blind to one shape and is not any
more. It matched a literal `base44.entities.Name.`, and
`src/lib/retiredOfflineQueue.js` binds its four entities into an object literal
and calls through the identifier carrying it, so eight real call sites were
counted by neither the coupling ratchet nor the destination census. The matcher
is `entityCalls` now and reads three binding forms, each required to appear in
the same file; the ratchet's `entity_call_sites` baseline moves 445 to 453 in
the same change, which records an instrument gaining sight rather than coupling
growing. A repo-wide scan bounded it first: **one module of that shape, not a
class of them.** The backend classifier has read aliasing since it was written,
so this was two halves of one question disagreeing, with the later half right.

**Three of the eight are sites a declared route REFUSES, and that is the finding
rather than the count.** `ComplianceAudit.filter` and `Incident.filter` ask
without a limit where the route requires one, and `Task.filter` filters on a
field the route does not carry — so the refusing line goes 6 to 9. A site nobody
has routed still reaches Base44; a site a route refuses has had its fallback
taken away, which is why these three belong at the front of the route audit and
not in its total. They were invisible until the matcher could see them, so the
audit is now measuring two blindnesses rather than one and neither is a separate
bug from it.

Read the arithmetic before reading the jump: **81 is 69 plus 8 less 3 plus 7**,
and the subtraction is the part worth keeping. Two branches were open at once and
both declared the three `ClinicalLibraryTemplate` write keys, which merged history
could not show either of them — a collision that lives only between two open
branches is invisible to a cross against `main` (D183). Resolving it dropped one
copy of the three keys and one of the two `libraryWrite` helpers, keeping the
landed one and carrying across the other's declaration-time refusal of an unknown
action. The seven are the compliance reads, which merged cleanly and are counted
here rather than re-measured: this block is one printer run over one tree, so no
line in it is a sum of two readings.

```
entity routes: 81 declared, 145/245 landable call sites SERVED, 100 still to adopt
  9 of those are sites a declared route REFUSES (ComplianceAudit.filter:limit_required, Incident.filter:limit_required, Task.filter:filter_field, User.list:sort), and 43 pass arguments this cannot read
  16 route(s) are declared but UNPROVED — every call site passes a variable, so the contract's own refusals are what checks them: AgencySettings.create, AgencySettings.update, ClinicalLibraryFolder.create, ClinicalLibraryTemplate.create, ClinicalPathway.create, ClinicalPathway.update, CustomValidationRule.create, CustomValidationRule.update, EducationMaterial.create, FaceToFaceEncounter.create, FaceToFaceEncounter.update, NoteConversion.create, NotificationPreference.create, NotificationPreference.update, PatientEducationAssignment.update, PatientRecommendation.create
  of those 100, across 29 entities: a wider generic family could serve 1 reads and 0 writes above D16's ceiling; 99 need a named capability
```

Then the provider directory's three writes landed and the reading moved again.
The block above is a record of the head before them and stays where it is; this
one is the current tree. Two of the three new routes are SERVED and the third is
UNPROVED — `PhysicianForm.jsx` passes form state, so no static reader can run its
arguments — which is why three declarations move the served line by two. Read the
declared count and the served count as answering different questions: declaring a
route always moves the first and moves the second only for the sites whose
arguments this can resolve.

```
entity routes: 84 declared, 147/245 landable call sites SERVED, 98 still to adopt
  9 of those are sites a declared route REFUSES (ComplianceAudit.filter:limit_required, Incident.filter:limit_required, Task.filter:filter_field, User.list:sort), and 45 pass arguments this cannot read
  17 route(s) are declared but UNPROVED — every call site passes a variable, so the contract's own refusals are what checks them: AgencySettings.create, AgencySettings.update, ClinicalLibraryFolder.create, ClinicalLibraryTemplate.create, ClinicalPathway.create, ClinicalPathway.update, CustomValidationRule.create, CustomValidationRule.update, EducationMaterial.create, FaceToFaceEncounter.create, FaceToFaceEncounter.update, NoteConversion.create, NotificationPreference.create, NotificationPreference.update, PatientEducationAssignment.update, PatientRecommendation.create, Physician.create
  of those 98, across 29 entities: a wider generic family could serve 1 reads and 0 writes above D16's ceiling; 97 need a named capability
```

**And the reading at `00ccac41`, with the compliance writes, the provider
directory's three writes and the three reference tables' writes merged
together.** It was the pinned block when it was written and is now a RECORD of
that head; the pinned one is the last block in this stage, and only that one is
checked byte for byte.

```
entity routes: 97 declared, 158/245 landable call sites SERVED, 87 still to adopt
  9 of those are sites a declared route REFUSES (ComplianceAudit.filter:limit_required, Incident.filter:limit_required, Task.filter:filter_field, User.list:sort), and 56 pass arguments this cannot read
  23 route(s) are declared but UNPROVED — every call site passes a variable, so the contract's own refusals are what checks them: AdrAuditCase.create, AgencySettings.create, AgencySettings.update, ClinicalLibraryFolder.create, ClinicalLibraryTemplate.create, ClinicalPathway.create, ClinicalPathway.update, ComplianceAudit.update, CustomValidationRule.create, CustomValidationRule.update, DocumentTemplate.create, DocumentTemplate.update, EducationMaterial.create, FaceToFaceEncounter.create, FaceToFaceEncounter.update, NoteConversion.create, NotificationPreference.create, NotificationPreference.update, OnCallShift.create, OnCallShift.update, PatientEducationAssignment.update, PatientRecommendation.create, Physician.create
  of those 87, across 29 entities: a wider generic family could serve 1 reads and 0 writes above D16's ceiling; 86 need a named capability
```

**It is one printer run over one merged tree, so read it as a reading and not as
a sum, and this block is the worked example of why.** Three branches were open
at once — the compliance reads, the compliance writes, and the provider
directory's three writes — and none could see the others' effect on these
totals. Adding the deltas gives the wrong answer in both directions here: the
declared count rose by five where two branches each claimed three and two, and
the unreadable count rose to fifty-two although neither branch set out to move
it at all. Every figure below was re-run on the merged tree rather than
reconciled.

**Two of the three matcher-fix refusals are in a module nothing imports, and that
changes what they cost rather than whether they are real.**
`ComplianceAudit.filter` and `Incident.filter` refuse in
`src/lib/retiredOfflineQueue.js`, and `src/lib/hostedPaths.spec.js` builds the
list of production source files that import that module and asserts it is empty —
so the assertion fails if one ever does, and today none does. The refusals are
real and no screen reaches them. Measured on this tree: eight entity operations
live in that module, across `NoteConversion`, `ComplianceAudit`, `Task` and
`Incident`, and none is on a path a user can execute.

**The reading above is a record of `00ccac41` and is deliberately not
maintained.** What follows it is measured on a tree where the INSTRUMENT
changed, so the two are not comparable and must not be differenced.

`limitConstants()` in `tools-entity-call-arguments.mjs` used to read exactly one
module, `src/lib/queryLimits.js`. Every call site naming a row limit declared
anywhere else read INDETERMINATE, which makes the whole call unreadable and the
site unserved — whatever its contract could do. `AdrAuditCase.list` was the
worked example and is recorded above: its contract existed, was reachable and
was tested, and the only thing between it and a route was that
`ADR_CASE_READ_LIMIT` is declared in `src/components/adr/adrCaseRead.js`. The
earlier comment in `independentEntityRoutes.js` named the broader cause and was
wrong; the limit was the SOURCE MODULE and never the module boundary, since
`PATIENT_HISTORY_ROWS` has always resolved across files.

The reader now takes every production module that exports an integer. It
refuses an AMBIGUOUS name — two modules giving one name different values — and
a local `const` SHADOWING an exported one, rather than picking, because it
resolves a name and does not follow an import graph. Both were measured clear
on this tree, and both are refusals in the code rather than sentences here, for
the reason this page keeps relearning: a reading of a tree on a day is not a
property of the tree, and a check that runs every time is the difference
between an assumption and a guarantee. Each refusal was planted and watched to
fail, and each carries a control that must pass.

**What it moved, measured rather than predicted: exactly one site.** The whole
per-site classification was captured before and after and differenced, and
`AdrAuditCase.list` in `src/pages/ADRCenter.jsx` is the only line that changed,
from unreadable to `["-created_date", 200]`. `NoteConversion.filter` was
expected to move with it and did not, and the correction is worth keeping: it
is held on its CONTRACT, which cannot express the field the site filters on —
`operationalRoutes.test.js` says so and fails if `listNoteConversions` ever
takes that field — so it was never the reader's to convert. Two sites that look
like one cause were two.

So the route below is the ruler's whole yield, and the rest of the change is
the ruler.

```
entity routes: 87 declared, 153/245 landable call sites SERVED, 92 still to adopt
  9 of those are sites a declared route REFUSES (ComplianceAudit.filter:limit_required, Incident.filter:limit_required, Task.filter:filter_field, User.list:sort), and 50 pass arguments this cannot read
  18 route(s) are declared but UNPROVED — every call site passes a variable, so the contract's own refusals are what checks them: AdrAuditCase.create, AgencySettings.create, AgencySettings.update, ClinicalLibraryFolder.create, ClinicalLibraryTemplate.create, ClinicalPathway.create, ClinicalPathway.update, ComplianceAudit.update, CustomValidationRule.create, CustomValidationRule.update, EducationMaterial.create, FaceToFaceEncounter.create, FaceToFaceEncounter.update, NoteConversion.create, NotificationPreference.create, NotificationPreference.update, PatientEducationAssignment.update, PatientRecommendation.create
  of those 92, across 29 entities: a wider generic family could serve 1 reads and 0 writes above D16's ceiling; 91 need a named capability
```

**Read the served count's rise as ONE screen, and read nothing at all into the
comparison with the block above.** A figure derived by a widened instrument and
a figure derived by the narrow one are answers to different questions, and the
only honest statement across them is that the pool was classified by a
different rule, not that it grew or shrank. Anything still reading
INDETERMINATE after this is unreadable for a reason other than where its
constant lives.

**That block records `00ccac41` read by the WIDENED instrument, and what follows
is the same tree again with the two `AIConfiguration` write routes declared.**
It is a third printer run and not an adjustment of either block above it. The
limit reader and these two routes were open at the same time and neither branch
could see the other's effect on these totals, so the figures below were
re-measured on the merged tree; adding the two deltas would have invented a
number no rule produced.

**Read the served count first, because it did not move, and that is the honest
result rather than a disappointing one.** All four call sites those routes serve
build their payload in a variable, so the argument reader cannot evaluate them
and they move from the unrouted pool into the population it declines to answer
about. The routes are declared and UNPROVED, and what checks them is the
contract's own refusals — the state eighteen write routes were already in before
these two. The gate cannot say these screens now work; it can only say they are
no longer refused before reaching the store, which is what declaring them buys.
`routedEntities` refuses an undeclared entity operation on this backend with no
Base44 fallback, so every one of those four sites refused until this landed.

So the move to read here is the unrouted pool falling by four and the unreadable
population rising by the same four. That rise is the check working: it grows
every time a route is declared over a site of that shape, and reading it as a
regression would be reading the instrument's own honesty as a fault.

```
entity routes: 89 declared, 153/245 landable call sites SERVED, 92 still to adopt
  9 of those are sites a declared route REFUSES (ComplianceAudit.filter:limit_required, Incident.filter:limit_required, Task.filter:filter_field, User.list:sort), and 54 pass arguments this cannot read
  20 route(s) are declared but UNPROVED — every call site passes a variable, so the contract's own refusals are what checks them: AIConfiguration.create, AIConfiguration.update, AdrAuditCase.create, AgencySettings.create, AgencySettings.update, ClinicalLibraryFolder.create, ClinicalLibraryTemplate.create, ClinicalPathway.create, ClinicalPathway.update, ComplianceAudit.update, CustomValidationRule.create, CustomValidationRule.update, EducationMaterial.create, FaceToFaceEncounter.create, FaceToFaceEncounter.update, NoteConversion.create, NotificationPreference.create, NotificationPreference.update, PatientEducationAssignment.update, PatientRecommendation.create
  of those 92, across 29 entities: a wider generic family could serve 1 reads and 0 writes above D16's ceiling; 91 need a named capability
```

The scope those routes send is derived from the payload rather than bound, for
a reason that is about this file's key shape rather than about the contract:
one `AIConfiguration.create` route serves an administrator writing the agency's
settings and a nurse writing their own preferences, and `user_email` is the
column that tells them apart. The contract re-decides the same question against
the stored row and refuses a mismatch by name, so a mis-derived scope is a
refusal the screen reports rather than a write to somebody else's row. And one
narrowing rides with it: the agency branch admits an `agency_admin` only, where
the Base44 entity write had no role gate at all.

**That block, and every one above it, is a DATED record. What follows is this
tree again after the duty toggle was WITHDRAWN — superseded by the contract
`main` already carries — and after the reference writes landed. It is another
printer run, not an adjustment of anything above it.** It was the PINNED block
until the reading below it was taken, and is now a dated record like the rest.

```
entity routes: 100 declared, 164/245 landable call sites SERVED, 81 still to adopt
  4 of those are sites a declared route REFUSES (ComplianceAudit.filter:limit_required, Incident.filter:limit_required, Task.filter:filter_field, User.list:sort), and 60 pass arguments this cannot read
  25 route(s) are declared but UNPROVED — every call site passes a variable, so the contract's own refusals are what checks them: AIConfiguration.create, AIConfiguration.update, AdrAuditCase.create, AgencySettings.create, AgencySettings.update, ClinicalLibraryFolder.create, ClinicalLibraryTemplate.create, ClinicalPathway.create, ClinicalPathway.update, ComplianceAudit.update, CustomValidationRule.create, CustomValidationRule.update, DocumentTemplate.create, DocumentTemplate.update, EducationMaterial.create, FaceToFaceEncounter.create, FaceToFaceEncounter.update, NoteConversion.create, NotificationPreference.create, NotificationPreference.update, OnCallShift.create, OnCallShift.update, PatientEducationAssignment.update, PatientRecommendation.create, Physician.create
  of those 81, across 29 entities: a wider generic family could serve 1 reads and 0 writes above D16's ceiling; 80 need a named capability
```

**Every figure above was re-run on the merged tree rather than reconciled from
the two sides of the merge**, and that is the rule this block exists to enforce
rather than a remark about this one. Two branches each moved the declared count
and neither could see the other, so adding their deltas is wrong in both
directions — and the instrument moved as well, which makes a difference against
any earlier block in this stage a comparison between two different questions.
Read the blocks above as dated records and difference none of them.

What this head contributes to the move is the roster's telecom projection and the
repair of three admin screens that had been asking the roster for an order it
cannot serve, so those sites moved into SERVED rather than out of the audit. The
totals it produced are the block's to state.

It was the PINNED block until the reading at the end of this section was
taken, and is now a dated record like the rest.

```
entity routes: 100 declared, 163/244 landable call sites SERVED, 81 still to adopt
  4 of those are sites a declared route REFUSES (ComplianceAudit.filter:limit_required, Incident.filter:limit_required, Task.filter:filter_field, User.list:sort), and 60 pass arguments this cannot read
  25 route(s) are declared but UNPROVED — every call site passes a variable, so the contract's own refusals are what checks them: AIConfiguration.create, AIConfiguration.update, AdrAuditCase.create, AgencySettings.create, AgencySettings.update, ClinicalLibraryFolder.create, ClinicalLibraryTemplate.create, ClinicalPathway.create, ClinicalPathway.update, ComplianceAudit.update, CustomValidationRule.create, CustomValidationRule.update, DocumentTemplate.create, DocumentTemplate.update, EducationMaterial.create, FaceToFaceEncounter.create, FaceToFaceEncounter.update, NoteConversion.create, NotificationPreference.create, NotificationPreference.update, OnCallShift.create, OnCallShift.update, PatientEducationAssignment.update, PatientRecommendation.create, Physician.create
  of those 81, across 29 entities: a wider generic family could serve 1 reads and 0 writes above D16's ceiling; 80 need a named capability
```

**Nothing was adopted or declared between these two blocks, and the move is a
POPULATION change rather than progress.** `src/pages/ReferralFollowUp.jsx` was
deleted and its route became a redirect, taking one served read of the physician
directory with it. So the landable denominator and the served numerator each
fell by one, the declared route count did not move, and the remainder is
untouched — the one shape in this stage where a falling served count is neither
a regression nor a reclassification. Difference it against the block above only
with that in mind, which is why the cause is written here and the totals are
left to the block.

**And it is the worked example of why the audit bullet below is re-derived
whole.** Its served read ratio moved because that same site left the served
pool, while its three other ratios did not move at all — so a reader adjusting
the figure that obviously changed would have been right by accident, and wrong
the next time the denominator was what moved.

**That block is a dated record too. What follows is this tree after the owner's
agency-access panel landed** — another printer run, not an adjustment of
anything above it.

It was the PINNED block until the reading at the end of this section was
taken, and is now a dated record like the rest.

```
entity routes: 100 declared, 163/245 landable call sites SERVED, 82 still to adopt
  4 of those are sites a declared route REFUSES (ComplianceAudit.filter:limit_required, Incident.filter:limit_required, Task.filter:filter_field, User.list:sort), and 60 pass arguments this cannot read
  25 route(s) are declared but UNPROVED — every call site passes a variable, so the contract's own refusals are what checks them: AIConfiguration.create, AIConfiguration.update, AdrAuditCase.create, AgencySettings.create, AgencySettings.update, ClinicalLibraryFolder.create, ClinicalLibraryTemplate.create, ClinicalPathway.create, ClinicalPathway.update, ComplianceAudit.update, CustomValidationRule.create, CustomValidationRule.update, DocumentTemplate.create, DocumentTemplate.update, EducationMaterial.create, FaceToFaceEncounter.create, FaceToFaceEncounter.update, NoteConversion.create, NotificationPreference.create, NotificationPreference.update, OnCallShift.create, OnCallShift.update, PatientEducationAssignment.update, PatientRecommendation.create, Physician.create
  of those 82, across 30 entities: a wider generic family could serve 1 reads and 0 writes above D16's ceiling; 81 need a named capability
```

**Nothing was adopted or declared between these two blocks either, and the move
is again a POPULATION change — in the opposite direction from the one above.**
`src/components/admin/AgencyAccessPanel.jsx` gained one call site: it lists the
agencies so the platform owner can grant a staff member a membership in one of
them, and no route is declared over that read. The site is landable, so the
landable denominator and the remainder each rose by one while the served count
and the declared route count held still, and the new key added one entity to
the remainder as well. Read it as one more site to adopt, not as a regression
in anything already served; the totals are the block's to state.

**That block is a dated record as well. What follows is this tree after the
owner released the care-plan screens on 2026-10-08** — another printer run, not
an adjustment of anything above it.

It was the PINNED block until the reading at the end of this section was
taken, and is now a dated record like the rest.

```
entity routes: 100 declared, 166/263 landable call sites SERVED, 97 still to adopt
  4 of those are sites a declared route REFUSES (ComplianceAudit.filter:limit_required, Incident.filter:limit_required, Task.filter:filter_field, User.list:sort), and 68 pass arguments this cannot read
  25 route(s) are declared but UNPROVED — every call site passes a variable, so the contract's own refusals are what checks them: AIConfiguration.create, AIConfiguration.update, AdrAuditCase.create, AgencySettings.create, AgencySettings.update, ClinicalLibraryFolder.create, ClinicalLibraryTemplate.create, ClinicalPathway.create, ClinicalPathway.update, ComplianceAudit.update, CustomValidationRule.create, CustomValidationRule.update, DocumentTemplate.create, DocumentTemplate.update, EducationMaterial.create, FaceToFaceEncounter.create, FaceToFaceEncounter.update, NoteConversion.create, NotificationPreference.create, NotificationPreference.update, OnCallShift.create, OnCallShift.update, PatientEducationAssignment.update, PatientRecommendation.create, Physician.create
  of those 97, across 32 entities: a wider generic family could serve 1 reads and 0 writes above D16's ceiling; 96 need a named capability
```

**No route was declared between these two blocks, and most of the move is the
population growing rather than anything being adopted.** Restoring the care-plan
management, builder and automatic-trigger screens brought their Base44 entity
calls back into `src/`, and every one of them lands in the record store. Three
of the new sites happen to call a read or create a route was already declared
over, with arguments it accepts, so they arrived SERVED; eight build their
predicate or payload in a variable and joined the population the scan cannot
read; the remaining seven, over six new keys (the trigger table's four
operations, and the care plan's list and delete), joined the unrouted
remainder. So the served count rose without anyone adopting a route, and the
remainder rose because screens came back — read neither as progress nor as a
regression. The totals are the block's to state.

**That block is a dated record as well. What follows is this tree after the
owner's decision to remove the clinical risk-prediction and PDGM payment
features from the frontend** — another printer run, not an adjustment of
anything above it.

It was the PINNED block until the reading at the end of this section was
taken, and is now a dated record like the rest.

```
entity routes: 99 declared, 159/256 landable call sites SERVED, 97 still to adopt
  4 of those are sites a declared route REFUSES (ComplianceAudit.filter:limit_required, Incident.filter:limit_required, Task.filter:filter_field, User.list:sort), and 68 pass arguments this cannot read
  25 route(s) are declared but UNPROVED — every call site passes a variable, so the contract's own refusals are what checks them: AIConfiguration.create, AIConfiguration.update, AdrAuditCase.create, AgencySettings.create, AgencySettings.update, ClinicalLibraryFolder.create, ClinicalLibraryTemplate.create, ClinicalPathway.create, ClinicalPathway.update, ComplianceAudit.update, CustomValidationRule.create, CustomValidationRule.update, DocumentTemplate.create, DocumentTemplate.update, EducationMaterial.create, FaceToFaceEncounter.create, FaceToFaceEncounter.update, NoteConversion.create, NotificationPreference.create, NotificationPreference.update, OnCallShift.create, OnCallShift.update, PatientEducationAssignment.update, PatientRecommendation.create, Physician.create
  of those 97, across 32 entities: a wider generic family could serve 1 reads and 0 writes above D16's ceiling; 96 need a named capability
```

**Nothing was adopted between these two blocks, and the move is again a
POPULATION change rather than progress or a regression.** The deleted screens
took seven served reads with them — two of `Incident.filter`, two of
`PatientAlert.filter`, and one each of `Incident.list`, `Task.filter` and
`PatientRecommendation.filter`. That last one was its key's only call site, and a
declared route nothing calls fails this gate, so the route was WITHDRAWN in the
same change: the declared count fell by one without anything being refused or
reclassified. The landable denominator and the served numerator each fell by
seven, and the refusals, the unreadable sites and the remainder did not move.
The fifteen other entity call sites the removal deleted were on paused OASIS
entities that this gate never counted as landable; they belong to the
destination gate, below.

**That block is a dated record as well. What follows is this tree after the
owner turned the phone, PDF, feedback and activity-report features back on** —
another printer run, not an adjustment of anything above it.

It was the PINNED block until the reading at the end of this section was
taken, and is now a dated record like the rest.

```
entity routes: 99 declared, 160/263 landable call sites SERVED, 103 still to adopt
  4 of those are sites a declared route REFUSES (ComplianceAudit.filter:limit_required, Incident.filter:limit_required, Task.filter:filter_field, User.list:sort), and 68 pass arguments this cannot read
  25 route(s) are declared but UNPROVED — every call site passes a variable, so the contract's own refusals are what checks them: AIConfiguration.create, AIConfiguration.update, AdrAuditCase.create, AgencySettings.create, AgencySettings.update, ClinicalLibraryFolder.create, ClinicalLibraryTemplate.create, ClinicalPathway.create, ClinicalPathway.update, ComplianceAudit.update, CustomValidationRule.create, CustomValidationRule.update, DocumentTemplate.create, DocumentTemplate.update, EducationMaterial.create, FaceToFaceEncounter.create, FaceToFaceEncounter.update, NoteConversion.create, NotificationPreference.create, NotificationPreference.update, OnCallShift.create, OnCallShift.update, PatientEducationAssignment.update, PatientRecommendation.create, Physician.create
  of those 103, across 34 entities: a wider generic family could serve 1 reads and 0 writes above D16's ceiling; 102 need a named capability
```

**Nothing was declared between these two blocks, and the move is again a
POPULATION change rather than progress.** The screens that came back brought
their own entity calls with them. The provider follow-up page's
physician-directory read returned, so the served read that left with it four
blocks above is back. The rest arrived UNROUTED: the dashboard's Time Saved
card reads the caller's own note conversions again, the restored nurse
performance page reads and writes nurse goals, and the activity logger appends a
user-activity row again — six sites, five of them over keys the remainder did
not hold before. The restored texts tab and scheduled-text queue read entities
with no owned-store table at all, so they never reach this pool and move the
destination gate instead. So the remainder rose without anybody's adoption work
going backwards, and the totals are the block's to state.

**That block is a dated record as well. What follows is this tree after the
owner turned the admin, AI, security, education and discharge screens back on**
— another printer run, not an adjustment of anything above it.

It was the PINNED block until the reading at the end of this section was
taken, and is now a dated record like the rest.

```
entity routes: 99 declared, 167/292 landable call sites SERVED, 125 still to adopt
  4 of those are sites a declared route REFUSES (ComplianceAudit.filter:limit_required, Incident.filter:limit_required, Task.filter:filter_field, User.list:sort), and 75 pass arguments this cannot read
  25 route(s) are declared but UNPROVED — every call site passes a variable, so the contract's own refusals are what checks them: AIConfiguration.create, AIConfiguration.update, AdrAuditCase.create, AgencySettings.create, AgencySettings.update, ClinicalLibraryFolder.create, ClinicalLibraryTemplate.create, ClinicalPathway.create, ClinicalPathway.update, ComplianceAudit.update, CustomValidationRule.create, CustomValidationRule.update, DocumentTemplate.create, DocumentTemplate.update, EducationMaterial.create, FaceToFaceEncounter.create, FaceToFaceEncounter.update, NoteConversion.create, NotificationPreference.create, NotificationPreference.update, OnCallShift.create, OnCallShift.update, PatientEducationAssignment.update, PatientRecommendation.create, Physician.create
  of those 125, across 37 entities: a wider generic family could serve 1 reads and 0 writes above D16's ceiling; 124 need a named capability
```

**No route was declared between these two blocks, and the move is again a
POPULATION change and not adoption.** The restored screens brought new landable
call sites into the tree: seven are reads a declared route already serves, seven
more build their arguments in a variable and joined the population the scan
cannot read, and fifteen joined the unrouted remainder over eight keys it did
not hold before — the security and activity logs, discharge summaries, education
deliveries and the job log. One restored site, the system health monitor's
incident count, was written to list the agency's incidents and narrow them on
the screen rather than filter on a field the incident route refuses, so it
landed in SERVED instead of adding a refused site. The totals are the block's
to state.

**That block is a dated record as well. What follows is this tree after the
owner turned the OASIS Center back on** — another printer run, not an
adjustment of anything above it.

**This is the PINNED block**: `tools-entity-routes.test.mjs` fails unless the
page carries it byte for byte, so paste what `pnpm run check:entity-routes`
prints and never retype, rewrap or re-indent it.

```
entity routes: 97 declared, 161/283 landable call sites SERVED, 122 still to adopt
  4 of those are sites a declared route REFUSES (ComplianceAudit.filter:limit_required, Incident.filter:limit_required, Task.filter:filter_field, User.list:sort), and 73 pass arguments this cannot read
  25 route(s) are declared but UNPROVED — every call site passes a variable, so the contract's own refusals are what checks them: AIConfiguration.create, AIConfiguration.update, AdrAuditCase.create, AgencySettings.create, AgencySettings.update, ClinicalLibraryFolder.create, ClinicalLibraryTemplate.create, ClinicalPathway.create, ClinicalPathway.update, ComplianceAudit.create, ComplianceAudit.update, CustomValidationRule.create, CustomValidationRule.update, DocumentTemplate.create, DocumentTemplate.update, EducationMaterial.create, FaceToFaceEncounter.create, FaceToFaceEncounter.update, NoteConversion.create, NotificationPreference.create, NotificationPreference.update, OnCallShift.create, OnCallShift.update, PatientEducationAssignment.update, Physician.create
  of those 122, across 36 entities: a wider generic family could serve 1 reads and 0 writes above D16's ceiling; 121 need a named capability
```

**No route was adopted between these two blocks, and the move is a POPULATION
change.** The OASIS Center's screens stopped calling entities and reach OASIS
records through the OASIS record broker and the scoped upload list instead, and
nine never-mounted duplicate OASIS components were deleted. Nine landable call
sites left with them: six that a declared route served (among them the two
pathway-library reads, the audit queue's staff read and the compliance report's
audit read), two that passed arguments the scan cannot read, and one unrouted
write — the automation engine's patient-alert create, which the broker now makes
on the server. Two of those were their key's only call site, the pathway
library's filtered read and the chart pusher's recommendation create, and a
declared route nothing calls fails this gate, so both routes were WITHDRAWN in
the same change: the declared count fell by two without anything being refused
or reclassified. The compliance-audit create moved onto the unproved list,
because its one call site that passed a literal payload was in a deleted
component; it is the same route over the same contract. The OASIS entities'
own call sites were never landable here and move the destination gate instead.
The totals are the block's to state.

#### The route audit's front, and why it is now shorter than its own list

**A site nobody has routed still reaches Base44. A site a declared route
REFUSES has had its fallback taken away.** Those are not two degrees of the same
thing and the served count cannot tell them apart, because it counts neither: a
refused site is not served and is not in the unrouted pool either. Five were
known when this section was written and went ahead of everything else in the
audit, whatever the totals said about size. **On `8bc9d214` none of the five can
fire**, for two different reasons, and both are recorded below beside the
finding rather than in place of it — the reasoning is what gets reused, and a
section rewritten to match today's answer loses it.

**Three came out of the matcher fix and could not have been seen before it**,
which is the part worth keeping — the census had counted the CALL SITES of
`src/lib/retiredOfflineQueue.js` at zero, so it had counted none of their
refusals either. They are `ComplianceAudit.filter` and `Incident.filter`, which
ask without a limit where the route requires one, and `Task.filter`, which
filters on a field the route does not carry. Driven through `routeFor` with the
arguments those lines actually pass, all three raise
`STAGING_ENTITY_ARGUMENTS_UNSUPPORTED` — demonstrated rather than read off the
gate's summary. And the module IS on the routed path: it imports `base44` from
`src/api/base44Client.js`, whose `rawBase44` is `independentAdapter?.raw` when
the independent adapter is configured, and that client's `entities` is
`routedEntities(portedCall, …)`.

**But nothing calls it, and that half was missing here.** The module is the
one-time recovery path for the retired offline feature, and
`src/lib/hostedPaths.spec.js` asserts that no production file under `src/`
imports it — it walks every non-test source and requires the importer list to
be empty. So these three refusals are real, reachable by construction and
unreachable in fact: routed if anything called it, called by nothing. Both
readings were taken of the same module and only one of them was written down,
which is the census defect at the scale of a paragraph. It does not make them
harmless, because the module exists to be wired up exactly once when somebody
decides to drain those queues — it makes them a thing to fix BEFORE that
happens rather than ahead of everything else.

**Two are ladder's, in `submitStateReportableIncident`, and they are the most
serious class the product has.** `SmartIncidentForm.jsx` and `EventReport.jsx`
both send `patient_name`; `STATE_INCIDENT_FIELDS` omits it; the wrapper is
pass-through; `exactObject` refuses the whole submission. So every
state-reportable submission from those two screens answers `INVALID_PARAMS`
against the owned backend, and nothing is visibly broken only because Base44
still serves both pages.

**That one looked like a decision and is not, which is the reusable part.** The
obvious repairs — widen the constant, or stop the screens sending the key —
both appear to touch D73's deliberate narrowing, under which that capability's
agency-wide alert names no patient because `notification_read` is agency-wide.
Reading `20260920510000_contract_state_incident.sql` settles it: the alert's
title and body are built in SQL from the event type, the SUBMITTER's verified
address and the date, and its `jsonb` carries `incident_id`,
`state_reportable` and `reported_by`. `report_text` reaches the stored incident
row and never reaches `notification_mint`. **D73's narrowing lives in the
migration, not in the service allowlist**, so the allowlist's omission was a
defect rather than a control — and `submitted_by_name` is the in-tree precedent
for the shape that was wanted all along: accepted at the boundary, used by
`buildReportText`, deliberately absent from the object handed to the contract.
The port's own builder already reads `patient_name`, carried interpolation for
interpolation from the original, so today the owned path would print a patient
ID where Base44 prints a name — if a request got through at all.

**The honest edge travels with the fix wherever it lands.** The name does reach
`report_text`, which IS stored. That is what Base44 stores today, so it is
restoration rather than change; and `factual_description` on the same
submission is free text a nurse can put a name into regardless, which is D188.
A seventeen-key allowlist is not a privacy boundary and must not be read as
one. What is contained is the ALERT, and that was never at risk.

**#355 took it, in the shape that paragraph predicted.** On `8bc9d214`
`patient_name` is in `STATE_INCIDENT_FIELDS`, `buildReportText` uses it, and the
object handed to the contract overrides it to `undefined` rather than spreading
it — `submitted_by_name`'s shape, as the precedent said. The answer reports
`patient_name_used: false`, so a caller cannot read acceptance as adoption. Two
of the front's five sites are therefore closed by a merge rather than by a
decision, which is worth noticing about the finding and not only about the
sites: what looked like a product fork dissolved once somebody read the
migration. That is the pattern to try first when a repair appears to touch a
deliberate narrowing — find where the narrowing actually lives before treating
the question as the owner's.

**So the audit's first question is not "how many sites remain" but "how many
declared routes refuse a call that is actually made".** The gate's refusing line
answers it for the route table and answers nothing about pass-through wrappers,
which is where ladder's two lived. Two instruments, two populations, and a total
that merged them would be the census defect arriving in the audit written to
describe it. **That the wrapper pair was found by a different instrument from
the route pair is the durable half** — the refusing line could not have shown
them, and it still cannot show the next ones.

#### The route audit's partition: what the remainder is actually made of

**The landable sites split four ways and the four add to the total exactly**,
which is asserted rather than assumed: the derivation cross-checks its served,
refused and unreadable counts against `measureRoutes`'s own before reading
anything, and refuses rather than reporting if any disagrees. A partition that
did not add up would be a second answer to a question the gate already answers,
which is how a bucket comes to claim more than it measured.

Beside the served sites, the remainder is three populations and they are three
different kinds of work:

- **Four are REFUSED by a declared route.** One is `User.list` asking for a
  `full_name` sort, in one file; three are the offline queue's, described above.
  These are the only sites where the Base44 fallback is already gone — but four
  refusals are ONE screen. They fall across two files, and the second is not a
  screen: `retiredOfflineQueue.js` is a lib module no production file imports.
  Four, one and one are three different counts of one bucket, and the
  one that sizes the work is the smallest. **This line moves in BOTH directions
  for reasons that are not opposites, so neither direction can be read off the
  number.** It was six when #309 merged, rose to nine on `c90ad9ae` — two keys
  became refusals by being DECLARED, where an undeclared key is skipped rather
  than refused, and the third became visible when the shared matcher stopped
  being a regular expression — and has fallen from nine to four here, across
  THREE changes none of which knew about the others: three admin screens stopped
  asking for an order the roster cannot serve, then the timesheet's approver
  dropdown did, then the leave form's did, so five sites moved into SERVED rather
  than out of the audit. A rise measures the audit's reach; this fall measures
  five call sites repaired; and a fall could equally mean a route was withdrawn.
  Read the cause, never the direction.

  **Note what that does to the arithmetic**, because it is the trap this line is
  for: each change lowered the figure independently and each was correct about
  its own tree, so adding any one's delta to another's base gives a number both
  sides would have signed off, and so does taking the union of their removals.
  The figure is re-measured at each merge rather than reconciled from the sides.
  This has now happened on two consecutive merges, which is what makes it a
  property of the slot order rather than an accident.
- **The one that remains is a single site in `Timesheets.jsx`**, and it is kept
  deliberately rather than owed. Its employee list filters `u.role === "user"`,
  and D23 keeps `role` off the roster precisely because it is self-assertable,
  so serving that page an order would turn a loud refusal into a staffing screen
  confidently showing nobody. The approver dropdown in the same file was repaired
  and asks only for `tenant_role`, which the roster does project. That contrast
  is the reason a refusal is read per SITE and not per file.
- **Seventy-three pass arguments the scan cannot read**, because the call builds
  its predicate in a variable. A route may serve them or may refuse them and
  nothing here can say which; the contract's own refusals are what check them.
  This population is neither work nor safety — it is the measurement declining
  to answer, and it grows every time a route is declared over a site of that
  shape, which is the check working rather than a regression.
- **Forty-five have no route declared at all**, over thirty-three entity and
  operation keys: thirty-two reads over twenty-one keys, and thirteen writes over
  twelve.
  Re-derived on this head rather than reconciled from either side of the merge,
  because every figure in this bullet is a property of the whole population and
  adding two branches' deltas is wrong in both directions. **The write half fell
  furthest once, and not because anyone worked on it** — the reference writes
  took eight sites out of this pool and the withdrawn duty toggle put nothing
  back — and has since grown again as restored screens brought their own writes
  back, so a bucket nobody adopted from has moved in both directions. That is
  what a remainder does: it is a property of what is LEFT, and of what ARRIVES.
  The reason the shape keeps moving is measurable on
  the sites already served: a read key there carries 2.71 call sites and a write
  key 1.29, so a read port has historically served many screens per route while
  a write port served the one form that calls it. **Do not carry that ratio into
  the remainder, though**: inside this pool a read key covers 1.52 sites and a
  write key 1.08, which is nothing like the served spread.
  Both are correct measurements of different populations, and the conclusion
  rests on the first only for what it says about PAST waves: this remainder
  costs more per site than the served count suggests, and a wave drawn from it
  will look slow against the same effort spent earlier.

  **This bullet has now been re-derived at ten consecutive heads. Across the
  first five every one of its six figures moved, reversing a finding stated in
  its own prose three times; at the sixth through the tenth only the served
  read pair did, which are the first heads where re-deriving the whole bullet
  changed one figure.** One head ago the two halves were level at fifteen sites each
  and the write key was the THINNER, at 1.15 against 1.25; the head before that
  the write key covered 1.61 and the paragraph called that inversion the
  finding; before that 1.57, and before that the writes were nearly twice the
  reads. Nothing was wrong with any of those measurements. What would have been
  wrong is carrying a sentence across a merge because it read well.

  **This head is the cleanest demonstration the bullet has produced.** The three
  reference tables' writes took eight sites out of the remainder and changed
  nothing else about it — and the remainder's READ half did not move at all,
  by either figure, while its write half fell from fifteen sites over thirteen
  keys to seven over five and its ratio rose from 1.15 to 1.40. A pin on the
  four quotients alone would have caught that; a pin on the read ratio alone
  would have seen a stationary 1.25 and reported no change, in a head where a
  third of the bucket left.

  **The mechanism is worth more than any of the numbers: a ratio over a
  REMAINDER is a property of what is LEFT.** It moves whenever anything leaves,
  in whichever direction the departure was thinner or fatter than what stayed —
  so it moves when nobody has touched it, purely because somebody else made
  progress elsewhere. That is why the direction of travel on this bullet is not
  a signal about the remaining work, and why re-deriving it beats adjusting the
  figure that obviously changed. Four of these six figures are quotients, and a
  quotient moves when either half does — it can also sit perfectly still while
  both halves move, which is the failure this paragraph could not detect about
  itself until the pin below started asserting the integer pairs.

  **All six are now pinned**, in `tools-entity-routes.test.mjs`, which derives
  both pools through the same `servedSites` / `measureDestinations` pair that
  produces the three counts above, asserts the four integer PAIRS first and only
  then the quotients formatted from them. It will fail on every pull request
  that declares a route. That is the design: the instruction is to re-derive the
  whole bullet, and a pin that goes quiet when the paragraph rots is the thing
  this section exists to complain about.

  **It moved again on this tree, and for the first time the REMAINDER did not
  move at all.** Three call sites joined the served pool — the three admin
  screens that stopped asking the roster for an order it cannot serve — and they
  joined a key that pool already held, so the served read SITES rose by three
  while its read KEYS stood still and the ratio rose from 2.56 to 2.62 with no
  route declared anywhere. The remainder is untouched, to the integer, in all
  four of its figures: those three sites always had a route declared over them
  and were sitting in the REFUSED bucket, which this bullet does not count, so
  nothing could leave a pool they were never in.

  **That is the cleanest instance yet of the mechanism this bullet keeps
  restating, and it points the opposite way from the last one.** A head ago a
  departure moved a ratio nobody had worked on; here work on three sites moved a
  ratio and left the remainder's four figures exactly as they were. A reader
  watching only the served ratio would see it rise and a reader watching only
  the remainder would see a flat line, and both would be reading this same
  change correctly. Neither number was wrong before and neither is wrong now.

  **And it moved once more on the tree this branch merges onto, for a cause the
  bullet had not seen before: a site that was being REFUSED became served.** The
  timesheet's approver dropdown stopped asking the roster for an order it cannot
  serve, so one call site crossed from the refused bucket into the served pool
  without any route being declared — the served read pair goes from 128 sites
  over 50 keys to 129 over the same 50, and the ratio with it. Every earlier
  move on this bullet came from a key being DECLARED or a population leaving the
  remainder; this one is a call site repaired, and the remainder did not move at
  all. So the four pairs are not only a guard against a quotient sitting still
  while both halves move — they are also the only thing here that can tell a
  repaired site from a new route, since both raise the served count by one.

  **And it moved once more on the tree this branch merges onto, for a cause the
  bullet had not seen before: a site that was being REFUSED became served.** The
  leave form's approver dropdown stopped asking the roster for an order it cannot
  serve, so one call site crossed from the refused bucket into the served pool
  without any route being declared — the served read pair goes from 128 sites
  over 50 keys to 129 over the same 50, and the ratio with it. Every earlier
  move on this bullet came from a key being DECLARED or a population leaving the
  remainder; this one is a call site repaired, and the remainder did not move at
  all. So the four pairs are not only a guard against a quotient sitting still
  while both halves move — they are also the only thing here that can tell a
  repaired site from a new route, since both raise the served count by one.

  **And it moved on this branch for the plainest cause of all: a new read with
  a key nobody had declared.** The agency-access panel's agency list arrived in
  the remainder as one site over one new key, so the remainder's read pair went
  from fourteen sites over eleven keys to fifteen over twelve and its read ratio
  FELL, from 1.27 to 1.25, because the newcomer was thinner than what was already
  there. The served pool did not move in any of its four figures. That is the
  remainder mechanism once more, from the side of an arrival rather than a
  departure.

  **And again when the care-plan screens were restored, which moved both pools
  at once.** Three restored sites landed on keys the served pool already held —
  two reads and a create — so its read pair went from 132 sites over 50 keys to
  134 over the same 50 and its write pair from 31 over 25 to 32 over 25, raising
  both served ratios with no route declared. The remainder took seven sites over
  six new keys, so its read pair went to seventeen over fourteen and its write
  pair from three over three to eight over seven; the write ratio left 1.00 for
  the first time in several heads, because the trigger table's update is called
  from two places.

  **It moved again when the clinical risk-prediction and PDGM payment features
  were removed, and for a cause the bullet had not seen: a served KEY left.**
  The deleted screens took seven served read sites with them, and one was the
  only caller of `PatientRecommendation.filter`, whose route was withdrawn — so
  the served read pair goes from 134 sites over 50 keys to 127 over 49, and its
  ratio from 2.68 to 2.59. The other six sites were on keys the pool keeps. Every
  earlier move of this pair came from a key being declared, a site being
  repaired or a single site leaving; here a key left with its last site, and the
  served write pair and all four of the remainder's figures stayed exactly where
  they were. A served ratio falling for that reason is screens deleted on
  purpose, not routes going thinner.

  **And again when the phone, PDF, feedback and activity-report features came
  back, which moved both pools.** The provider follow-up page's directory read
  rejoined a key the served pool already held, so its read pair went from 127
  sites over 49 keys to 128 over the same 49. The remainder took six sites:
  the goal read and a second note-conversion read moved its read pair from
  seventeen over fourteen to nineteen over fifteen, and the goal create, update
  and delete with the activity append moved its write pair from eight over seven
  to twelve over eleven — four writes over four new keys, which is why the write
  ratio fell back toward one.

  **And again when the admin, AI, security, education and discharge screens
  were turned back on — the reverse of every earlier cause: screens came back
  ON.** They put fifteen new sites into the no-route pool over eight new keys,
  so its read pair went from nineteen sites over fifteen keys to thirty-two over
  twenty-one and its write pair from twelve over eleven to fourteen over
  thirteen, and seven new reads into the served pool over keys it already held,
  so the served read pair went from 128 sites over 49 keys to 135 over the same
  49 and its ratio rose with no route declared. Nothing was declared and nothing
  was repaired; both pools grew because the population did.

  **And again when the OASIS Center was turned back on, which is the first
  head where a remainder QUOTIENT held while both of its terms moved.** The
  automation engine's patient-alert create left the no-route pool with its key —
  the OASIS record broker now makes that write on the server — so the
  remainder's write pair went from fourteen sites over thirteen keys to thirteen
  over twelve, and its ratio printed 1.08 both times. That is the failure this
  bullet's pins were written for: a pin on the quotient alone would have seen no
  change in a head where the population moved, and only the integer pair shows
  it. The remainder's read pair did not move. The served pool lost six sites as
  the OASIS screens stopped calling entities — five reads, two of them the
  pathway library's filtered read, whose key left with its last site and whose
  route was withdrawn, and one write, the deleted assistant's compliance-audit
  create, which was that key's only served site: every remaining caller passes
  a variable, so the key left the served pool for the unproved list rather than
  the remainder. So its read pair went from 135 sites over 49 keys to 130 over
  48 and its write pair from 32 over 25 to 31 over 24. Nothing was declared and nothing
  was repaired; screens moved onto a server broker the route gate does not see.

**So "how many sites remain" is three questions with three answers, and the
middle one is not a number of tasks at all.** A plan that sizes Stage J off the
remainder as a single figure counts a measurement's silence as work, and counts
a refusal — where the product is already worse off than before the route was
declared — as the same as a site nobody has touched.

#### Drawing the remainder as waves, and the column that cannot be derived

Everything below was read on `8bc9d214` and is a dated record of that head
rather than something maintained. That is deliberate and not laziness: these
figures move with every route batch, and a pinned one pays an edit per batch.
`tools-handler-allowlist.test.mjs` carries the worked example in its own header
— it pinned a handler count as a literal, five capabilities landed the next
hour, and `main` went red on a check that was measuring nothing wrong; it
compares against a derived length now. **The partition above is pinned because a
tool prints it; this is not, because no tool prints it.** A head-stamped record
stays true at every later head, which a literal does not.

**Grouped into candidate waves.** The keys fall into twelve domains. The
grouping is a reading like the rest of this section and was made with a
throwaway derivation rather than a committed tool, so what is worth recording is
the shape of its controls, not the script: every key belongs to exactly one
domain, no domain may be empty, and a key the map does not cover REFUSES the
run rather than being dropped quietly — an uncovered key would otherwise leave a
table that adds up and is short.

| domain | keys | call sites |
| --- | ---: | ---: |
| ADR audit | 4 | 9 |
| time and pay | 6 | 7 |
| compliance audit | 2 | 6 |
| document library | 6 | 6 |
| AI configuration | 2 | 4 |
| physician directory | 3 | 4 |
| on call | 3 | 3 |
| system log | 3 | 3 |
| invitations | 1 | 2 |
| note conversion | 1 | 2 |
| patient alert write | 1 | 1 |
| user filter | 1 | 1 |
| **total** | **33** | **48** |

**A domain row is not a unit of work, and the largest row proves it.** ADR audit
splits in two. Its create, update and delete have no write contract at all — the
only other ADR contract in the store is `pennsync_contract_adr_deadline_sweep` —
so they need SQL, a handler and a suite. Its read is the opposite and is not
route work either: `pennsync_contract_adr_case_list` shipped, and
`AdrAuditCase.list` is **deliberately not declared**, for a reason that is about
the INSTRUMENT rather than the contract. `src/lib/independentEntityRoutes.js`
says so in its own comment: the only call site passes `ADR_CASE_READ_LIMIT`
imported from another module, `check:entity-routes` cannot resolve a constant
across modules, so it reads the site as unserved, and a declaration would be a
route that moves no screen. Same entity, same row, two stages and neither of
them the one the row implies. Read as one thing it is the obvious first wave,
and none of it is a route to declare today.

**And a KEY is not the unit either, which is this section's own subject arriving
one level down.** `TimeOffRequest.filter` is two sites and two different
answers: `src/pages/Timesheets.jsx` asks for one person's `status: "approved"`
requests, which `getApprovedTimeOff` serves, while `src/pages/TimeOff.jsx` asks
for the same person's requests at every status so they can cancel a pending one,
and no contract serves that. A per-key cell would tell the same kind of lie the
entity row tells.

**The column that would actually size a wave is NOT derivable, and that is a
finding rather than a gap.** "Does a contract already exist for this key" is
what separates a declaration from a capability to build, and two instruments
were built for it and both abandoned. Matching contract NAMES against the entity
name is wrong in both directions — `listAdrAuditCases` matches
`AdrAuditCase.update`, which a list contract does not serve, and
`getApprovedTimeOff` serves `TimeOffRequest` and contains no entity name.
Reading the contract SQL for the entity's TABLE is wrong in both directions too:
a contract touching a table incidentally is not serving the operation, an update
is not a create, and **a write can be invisible by construction**.
`"pennsync_records".library_write(p_table, …)` builds its statement with
`execute pg_catalog.format('insert into "pennsync_records".%I …', p_table, …)`,
so the table is a STRING ARGUMENT and no static reader of a contract body can
see the write at all. Seven tables are written
through it — `ai_configuration`, `clinical_library_folder`,
`clinical_library_template`, `clinical_pathway`, `custom_validation_rule`,
`education_material` and `patient_education_assignment` — so it is a family,
not one odd contract. **Six of those seven are written ONLY that way**, and the
exception is worth naming because it is this section's own subject at the wrong
unit: `clinical_library_template` also takes a direct `update` in
`contract_clinical_phrase`, which increments its `usage_count`. So the table is
visible to a static reader and that contract's write is not. What dynamic SQL
hides is a CONTRACT's write, never a table, and a first draft of this paragraph
said seven tables because the two units read interchangeably in one English
sentence.

**The general form is worth more than the instance: the question decides whether
dynamic SQL defeats you.** `tools-pennsync-release-ladder.mjs` walks the same
call graph and is not defeated, because it asks whether a contract writes AT ALL
and which migrations its closure needs, never which table. Every contract
reaching its write through the helper classifies `mutates: true`.

**It survived by an accident of phrasing until #358, and the fix is the shape
to copy.** Its `DML` test is a text match, so it fires on the `insert into`
inside `library_write`'s `format(…)` templates. A one-pass scanner that strips
single-quoted strings, dollar-quoted blocks, `--` line comments and `/* */`
blocks TOGETHER found those matches only inside the strings — the ladder thread,
on `3c94246c`, written that way because handling quotes alone is unsound: a
comment containing an apostrophe desynchronises a quote-only scanner and inverts
the answer. An earlier attempt of mine with a regular expression that stripped
quoted text was unsound for a different reason, because SQL escapes a quote by
doubling it, and it reached the same answer anyway; that is the only kind of
agreement worth recording. So a "do not match inside strings" tightening — which
reads exactly like a correctness improvement — would have classified the helper
read-only and taken every contract reaching its write through it into a read
wave.

**The family is SEVEN contracts, and the two populations around it are not the
same set.** Seven contracts reach a write through `library_write` and through
nothing else; each has no DML of its own once quoted text and both comment forms
are removed, so the tightening would classify all seven read-only. #358's header
read six, which was a defect in the header rather than in the check, and the
way the six arose is the more useful half: they were assembled from the
contracts the classifier reported silent when each was flipped read-only, so
the set was drawn from the check's own blind spot — it measures the EXPOSURE
and reads like the POPULATION. #362 corrects the header and takes its test's
population from the bodies rather than the names, and it is on `main` as
`bd28cddb` — checked as a commit on `main` rather than off a listing's `merged`
flag, which has answered wrongly here before. The other population is the EIGHT names the classifier guard
holds, and the difference is not arithmetic:
`contract_sent_education_record` is in the second and not the first, because it
carries its own DML and was probed here as a positive control. Two sessions
measured these on independent harnesses and agreed, including the discriminating
reading underneath them — 49 of the store's 135 contracts carry their own DML
and 86 do not, re-derived here on `03a92329` — which is what makes the pair
quotable at all. It discriminates rather than answering uniformly, which is the
property to check before believing any of these numbers: a lexer that ate the
whole `$$` body would have reported the family read-only and been right about
all seven for the wrong reason.

**What made it survivable was the guard, and the guard was silent on six of the
seven.** `mutationClassifierHolds` refuses when a contract named with a writing
verb classifies read-only. Ladder measured the before-state directly, by
removing `write` from `MUTATING_VERBS` on a tree that contains the fix and
sweeping both trees: the six `_write` contracts go SILENT to HELD, the two
already covered stay HELD, and the guard's reach over the whole registry goes
from 47 of 133 origins to 53. **Nothing else moved**, which is the property
worth checking before believing either figure. The seventh was never silent —
`contract_ai_configuration_save` is held by `save`, which was already in the
list — so the family's exposure and the guard's blind spot were never the same
set, and reading either off the other gives the wrong answer by one in both
directions. **Count the controls out of the coverage figure before quoting
it**: a sweep of eight names over a family of seven yields at least three
defensible numbers, and this paragraph produced all three before anybody
measured the before-state.

**#358 closed both halves in one change**: the verb is in the list, so the same
sweep on `8bc9d214` holds for every name probed, and the matcher's header now
says the string matching is deliberate and what removing it would cost. **When a
check survives by an accident of how it is phrased, say so in its header** — and
note which half is load-bearing, because the header alone would not have stopped
the tightening from shipping green. The guard is what would have stopped it, and
only for the names it already knew.

**The cost of a row has to be read rather than measured, and reading it wrong
is the failure this section exists to warn about — so here is the instance,
because it happened while this section was being written.** The transfer thread
first read the pool as eight sites over five keys that a shipped contract could
serve. Declaring them refuted three of the five, two of them against reasons
already written down in the files a declaration would have to touch:

- `NoteConversion.filter` is held ON THE CONTRACT, deliberately, with a live
  test. `src/lib/operationalRoutes.test.js` carries it in `HELD_ON_THE_CONTRACT`
  because `persistVisitNote.js` narrows on five fields and
  `listNoteConversions` takes one, while that caller requires EXACTLY ONE ROW
  and treats anything else as an unconfirmed write. A route dropping four
  predicates turns duplicate detection into a read that can return two.
- `AdrAuditCase.list` is deliberately undeclared, and the reason is a comment in
  `src/lib/independentEntityRoutes.js`: `listAdrAuditCases` exists and is
  tested, but `ADRCenter.jsx` passes a limit constant imported from another
  module and the gate cannot resolve one across modules, so declaring it "would
  be a route that moves no screen, which is the exact thing that gate was
  rebuilt to refuse".
- `TimeOffRequest.filter` fails on the contract's BODY rather than its
  parameters, and it fails in the dangerous direction. The `Timesheets.jsx` site
  asks for one person's approved requests; `contract_time_off_approved(p_agency)`
  takes no email at all and returns the whole agency's, ordered the other way.
  Routing it would put every colleague's leave on one person's timesheet. That
  is a WIDENING, and a disclosure one.

**So the rule is the one the three share: a contract's existence is not its
fitness, and its parameter names are not its semantics.** Two of the three were
refuted by something already committed, which means the check is to read the
route file and the operational-route test before believing a match, not to read
the contract registry more carefully.

**What survives is two keys over four sites, and declaring them moves the gate's
SERVED line by ZERO.** `AIConfiguration.create` and `.update` are both served by
`saveAiConfiguration`, whose `id` is nullable so one contract covers the pair.
All four sites — two in `src/components/admin/AIConfigurationManager.jsx`, two in
`src/pages/UserSettings.jsx` — pass a payload object and an id held in a
variable, so every one of them would be declared and then counted UNPROVED.
Measured here rather than taken: the resolver read 331 of the 453 sites and
refused 122 at the head this row was written on, so it is not answering
uniformly, and it refuses all four of these. (Re-read 2026-10-08: 331 of 452
and 121 refused. Beside that one, not through it — the population moved between
the two heads, so the pair is two readings and not a delta.)
**"A route to declare" and "a served site gained" are different quantities**, and
on this row the second is zero.

**The headline is that there is no cheap wave left at all.** Two automated
crosses put the declarable row at forty and at fourteen before either was
abandoned; a hand reading put it at eight; declaring them put it at four, none
of which the gate will credit. Anyone sizing a wave off the whole keyless pool
is sizing capability work as though it were declarations. What the other
twenty-nine keys need is not settled here and is the transfer thread's to
publish — the three refuted above are not "capability to build" either, since
two of them are decisions somebody already took.

**Four of the pool are not route work at all, filed under names that read like
four declarations.** `src/pages/UserSettings.jsx` calls
`User.filter({ role: 'admin' }, undefined, ALL_ROWS)` to find the agency's
administrators and notify them that somebody asked for their account to be
deleted. D23 makes `User.role` a self-editable label that must never authorize,
and `contract_roster`'s own header says `role` and `account_type` are replaced
by `tenant_role` — so the screen asks the exact question D23 exists to refuse
and no route can be declared for it. The successor is not missing: the
enumeration belongs to `pennsync_private.agency_roster` and the fan-out to
`createNotification`, which is already ported, so this is a decision about one
screen with a strong default and nothing unbuilt behind it. The other three are
`SystemLog.create`, `.list` and `.filter` in `PatientEducationHub.jsx` and
`SystemJobMonitor.jsx` — the whole of the destination gate's `activity_trail`
bucket, enumerated rather than inferred from two counts of three matching.
`SystemLog` is dispositioned `retire`, so there is no table to route to. The
write can never be a route: D25's trail stamps the actor from the caller helpers
and refuses a payload naming one, so a browser cannot append to it — that is
`audit.mjs`'s job from inside a handler. The two reads need `agency_admin`,
where the screen shows them to whoever opens it today.

**The unreadable population is not a tooling limit waiting to be lifted, and the
obvious next idea buys a third of what it looks like.** Repo-wide there were 453
entity call sites when this was measured, of which 331 were readable and 122
were not; on 2026-10-08 the same instrument reads 452, 331 and 121. The
proportions below are of the first reading and are not re-derived, because what
the paragraph is about is the SHAPE of the unreadable pool rather than its size.
Only seven of the 122 fail because they name a module-level constant the
resolver does not carry,
over six distinct names: `tools-entity-call-arguments.mjs` resolves what
`src/lib/queryLimits.js` exports and nothing else, while `ADR_CASE_READ_LIMIT`,
`ROSTER_PAGE_SIZE`, `PAGE_SIZE`, `ACTION_ITEM_SCAN_LIMIT`,
`SUPPORTING_RECOVERY_ROW_LIMIT` and `EXACT_RECOVERY_ROW_LIMIT` each live beside
the screen that uses them. The other 115 pass a genuine run-time value. **But
carrying all six names moves the unreadable line from 122 to 119, not to 115** —
simulated by adding them and re-walking rather than reasoned about, because four
of those seven sites pass something else unreadable as well. *Seven sites name a
constant* and *seven sites would become readable* are different quantities, and
this paragraph was first drafted asserting the second.

**Last, a count of routes is not a count of call sites.** #335 fixed eight
broken routes — six sending an order their contract refuses, two reading an
answer key their contract never sends (`ClinicalEvent.filter` and
`PDFTemplate.delete`) — with a ninth carrying the sort defect latently:
`FaceToFaceEncounter.filter`, whose only call site passes `undefined` for the
sort, so it emits no order and the defect has never fired. That is eight routes
over fourteen call sites, eleven of them behind the six sort defects alone. Both
numbers are true and they are different numbers; the one that sounds better is
the one to distrust. This paragraph first said seven with a latent eighth, which
is the merged commit's own Before/After off by one in the direction that reads
tidier.

#### The destination gate, which measures a different population

Everything above this heading is the route gate's, and its measured figures
live in the pinned block rather than in the prose around it. Everything below
is `check:frontend-destination`'s — a different instrument over a different
population, whose figures are prose here and are not pinned. A paragraph put on
the wrong side of this line will read as a claim about the other gate.

**What the dropped domains cost, and by which instrument.** `node
tools-frontend-retired-inventory.mjs --summary`, first read on `main` after
#291 and re-measured on `84718e6b` on 2026-09-29: **208 call sites across 86
files and 32 entities; 59 files lose everything they read** (reads 123, writes
84, subscriptions 1), leaving 27 partially affected. Those are exact, and #291
writes them out per file and per entity as
`docs/FRONTEND_RETIRED_DOMAIN_INVENTORY.md` — a file is the unit somebody
edits and an entity is the unit somebody decided about, so that is the page to
open when this work starts, rather than this count. **Its population IS the
destination gate's 208 and cannot drift from it**, because `measureInventory`
filters that gate's own `measureDestinations` output — the two report at
different units and never from different readings. **So do not read the 194
below as this paragraph's number.** When this sentence last said 203, that was
the DROPPED TOTAL, and the subset below then said 203 as well — two different
sets wearing one number for one commit. The total has since moved to 208 and
the subset is 194, **which is what it has been since D80 was written**: at 445
the buckets were `no_table` 193, `broker_is_read_only` 9 and `no_realtime_seam`
1, so the uncarried domain was 194 there too. The eight sites the matcher
gained were all landable and the five reference writes moved out of
`record_store`, which is why the TOTAL moved and the subset did not. Two
quantities coincided, one of them moved, the other was never what the sentence
said it was, and nothing in either sentence could show either thing. The shape
a person would notice — roughly 9 top-level destinations and
about 33 hollowed-out pages — comes from a filename scan rather than that tool,
with 2 of 49 components having no importer found, so treat the first pair as
measured and the second as indicative.

(Re-read on the tree that removed the clinical risk-prediction and PDGM payment
features: **193 call sites across 77 files and 31 entities; 52 files lose
everything they read** (reads 112, writes 80, subscriptions 1), leaving 25
partially affected, and the generated page was rewritten in the same change.
`OASISScenario` left the entity count because every one of its call sites was on
a deleted screen. The population is still the destination gate's whole
cannot-land side, so it moved exactly as that side did.)

**208 of 453 — 46% — have no destination in the owned store, and 194 of those
reach a domain the migration has decided not to carry.** (Re-read 2026-10-08:
208 of **452**, the deleted follow-up page's site having left the population.
**The 46% and the 194 both came out the same**, which is the hazard this
paragraph is already about, one layer down: an operand moved and the figure
derived from it did not, so nothing looked stale. Measure, do not re-check.)
(Re-read again on the tree that removed the clinical risk-prediction and PDGM
payment features: 193 of **430**, and 179 of those uncarried — 119 `hub`,
unchanged, and 60 `preserved_paused`, fifteen fewer because those OASIS sites
were on deleted screens. This time the numerator moved with the denominator and
the percentage moved with them, to 45%; it is still the figure least worth
quoting.) The other fourteen are
writes to entities it DOES carry, read-only — nine refused by the broker
family's D2 ceiling and five by a D83 reference table's GRANT: what has no
destination there is the OPERATION rather than the domain, and conflating the
two is how this page would start overstating the product work. **It said 203
here for one commit, which is the same conflation drawn one line lower**: the
five were separated out and the nine were not, on a split keyed to the
destination bucket rather than to the disposition, which is the thing that
decides whether a table exists at all. The correction is `carried_entity` in
the inventory, derived from `CARRIED_DISPOSITIONS`, and the tell was sitting in
the next sentence the whole time — 119 plus 75 is 194, and 203 was never a
number this paragraph could reach. 119 of the 194 are the training domain,
whose destination is the Hub; 75 are `preserved_paused`. **That 75 is not an
off-by-one against the table's 74**, which counts `preserved_paused` inside one
destination bucket only — `no_table` at the head above, `no_access_contract`
since #408 gave those entities schema-only tables, which is why the bucket NAME
is not the durable half of this sentence — the 75th is the `no_realtime_seam`
site, whose entity is also
`preserved_paused`, so it is on the uncarried side too although its bucket is
the one bucket that could fall either way. A plan that sizes this stage by the
call-site count is sizing the wrong thing.

**"Each needs a product answer" was wrong, and it made this block read as the
owner's when most of it is not.** **The page already disagreed with itself**:
the paragraph above says 119 of the 194 are the training domain *whose
destination is the Hub* — an answer already given — and the sentence that
followed put all 194 under "each needs a product answer". Two adjacent
sentences, checkable without re-running anything below. Measured 2026-09-30 on
`36c828a0` against
`tools-frontend-retired-inventory.mjs`, `src/lib/nav.manifest.js`,
`discoverPausedFunctions` and `auditBrokerCeiling`. The structure below is
durable; **the counts are a dated reading, so re-run those rather than quoting
them.**

- **Training and learning — `hub`, twelve entities.** Their product answer was
  already given: D8 and `docs/CENTRAL_LEARNING_CUTOVER.md` send them to
  `kdeyarmin/caremetric-support-hub`, both controls unset behind a seven-step
  pre-cutover checklist. **They are neither his to decide nor ours to port**,
  and porting their tables into the owned store would build precisely what D8
  decided not to build. They also pass a restoration test outright — F19 in
  `docs/audits/FEATURE_INVENTORY.md` reads "Working but needs improvement",
  nine of their pages are in the nav manifest, and exactly one backing function
  is paused at source. **That is why the reading survived: functioning today
  and belonging here are different questions.**
- **OASIS — `preserved_paused`, eight entities.** D7 already exempts the half
  that looked gated: *"their schemas and data still migrate; only their
  execution stays off"*. What is his is **activation**. What is not a table
  away is the frontend: `auditBrokerCeiling` refuses all eight — seven deny
  direct reads, `OASISUpload` conditions them, six name a clinical subject, two
  can hold a file — so each call site needs a hand-written contract with its own
  gate and refusals. **A domain with no backing Base44 function is MORE work
  here, not less, because there is no capability to port.**

  **Read that D7 quote as a mechanism and not as a count.** The reason its
  sentence was unimplementable is that one field was answering two questions:
  the disposition decided both whether an entity's data is carried and whether
  its execution is on, so "schemas and data still migrate" had nowhere to be
  true. Separating the two is what makes it implementable, and that is the claim
  to carry — it holds whether or not any particular change has landed, where a
  sentence of the form "none of them has a table" goes stale the moment one
  does.

  **And do not write "the fourteen paused entities."** The `preserved_paused`
  population is **54**, measured from `tools-transition-disposition.json` on this
  tree. Eight plus six is the subject of this bullet and the fax-and-voice bullet
  below it, not a population — the two happen to sum to fourteen, and "fourteen"
  is also in use nearby for a count of FILES reached only through a paused
  ancestor, which is a different thing again. Name the bullet's own entities, or
  re-measure.

  **The restoration test the training bullet runs, run here: it fails.**
  Verified by hand on this tree, because this is the kind of claim that should
  not be relayed. `src/components/hub-tabs/OASISAnalyzer.jsx:110` is `const
  OASIS_ANALYZER_ENABLED = false;`. The file's **only** export is `export default
  function OASISAnalyzer` at `:2756`, whose first statement is `if
  (!OASIS_ANALYZER_ENABLED)` returning the "OASIS AI Analyzer Paused" card.
  `<OASISToPatientChartPusher` at `:1771` sits inside `function
  EnabledOASISAnalyzer`, declared at `:130` and **not exported**. So the call site
  is unreachable at runtime with no alternative path — the opposite of the
  training domain, where nine pages are in the nav manifest and one backing
  function is paused.

  **Why it is off is recorded, and it is a safety decision rather than neglect.**
  Eleven of the twelve source flags in this domain arrive in one commit,
  `67d9d5ee` of 2026-09-02, "Fail closed on unverified OASIS, PDGM, and
  tenant-sensitive paths" — AI correctness and PDGM payment safety: a verified
  CMS grouper, protected assessment provenance, and an explicit warning that an
  unavailable grouping is not a $0 result. That is seventeen days before this
  migration's first decision document, so it is not something the migration
  switched off and not something the migration may switch back on. **Whether
  OASIS comes back at all is the owner's**, which is the activation half D7
  already leaves to him. This bullet records the failed test; it does not propose
  restoring it.
- **Fax and voice — `preserved_paused`, six entities.** Whether these function
  today is **not answerable from this tree.** D7's pauses are attested by
  receipts rather than source flags, and the Telnyx credentials live in-app as
  `IntegrationSecret` — so `discoverPausedFunctions` reads zero paused handlers
  across all fourteen `FaxLog` functions while D7 lists fax as paused, and both
  are correct. The instrument would be an authenticated read of the hosted
  credential presence and the Base44 release flags. **None has been taken.**

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

**The ones that cannot land have their own docket:**
[FRONTEND_DECISION_DOCKET_2026-09-22.md](FRONTEND_DECISION_DOCKET_2026-09-22.md).
**Its 203 is D80's 203 and carries D80's error** — it opens by calling all of
them sites "reaching an entity the owned store will have **no table for**",
and its own closing table gives the nine admin reference writes a row of their
own. So do not cross it against the 194 above; what it enumerates is the
DROPPED TOTAL at 445, 193 `no_table` plus those 9 plus 1 subscription, and
only 194 of it is the uncarried domain. Re-run the tool if you need today's
set. Two findings in it change the plan. 81 of the 119 training sites sit in 35
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
`agency_name` **from the carried profile row** (D23) — it does return
`agency_id` and `agency_name`, sourced from the membership in the authority
store, and the contract's own header says why the distinction is the point. What
is refused is the self-editable label, not the field. So a screen that reads a
user to decide what to show a user needs its authorization moved to the tenant
context, not a new data source; a screen that merely needs to know which agency
a colleague is in is already served.

- Replace `src/api/base44Client.js` with a backend-neutral client; the
  independent adapter becomes the default under `VITE_PENNSYNC_BACKEND=independent`.

  **That mode now exists, under that exact name.** `VITE_PENNSYNC_BACKEND=independent`
  is the app's own branded sign-in, sign-out, session lease and tenant resolution
  against a configured Supabase project and the owned business API, for a real
  staff account. The staging mode's four-actor pin is lifted for this mode only;
  its app id, project reference and URL, publishable key and service origin are
  read from build configuration and checked for shape and mutual agreement rather
  than pinned, with the staging app and the staging project refused by name. The
  synthetic workspace, the `staging_*` referral actions and the `Synthetic %`
  projection are **absent** from it rather than widened. **THE SWITCH IS OFF:**
  nothing is configured and no build points anywhere. Still owed before a staff
  account can be used — invitation acceptance and password set, both of which
  deliver mail to a real person and so are the owner's to release, and an
  end-to-end acceptance job driving the COMPILED app in this mode against a local
  store pinned to the production app id.

  Two things about the bullet above, since this is the kind of line that invites a
  wrong correction. The first clause is **partly done already**:
  `src/api/base44Client.js` takes the owned adapter for either owned mode, and
  what is left is removing the Base44 client construction, which waits on the
  entity call sites rather than on the mode. And the bullet itself is **accurate
  and needs no edit** — it was read as carrying a stale value, on the grounds that
  the configuration reader accepted only `base44` and `independent-staging`, which
  was a correct measurement and the wrong conclusion. A Stage J bullet describes
  work to do, so it is not stale for naming something the code has not done yet.
- Replace call sites tier by tier — **but not by the count, and not by the
  entity.** What is left is three populations and only one of them is work;
  the waves, and the column that cannot be derived, are above. A lint rule
  blocks new direct entity calls.
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
| `base44/functions/createUserWithTempPassword/entry.ts` | The two store URLs in the invitation email, `DEFAULT_IOS_APP_URL` and `DEFAULT_ANDROID_APP_URL` — **and a second reason this file is on the list**: it consumes `APP_PUBLIC_URL` as an ORIGIN through `getAppBaseUrl`, and derives every user-visible link in that mail from it. `base44ClientRequest`'s hard-coded `https://base44.app` is the SDK's BACKEND and does **not** move with the domain; do not conflate the two. Named by constant and carrying no line number on purpose: an earlier revision of this row said `:36-37`, which are the `Base44-App-Id` header and nothing to do with a URL, and two readers on two heads disagreed by sixty lines about where the URLs actually were. **The two `ios/` rows above keep theirs for a reason that does not apply here:** `tools-app-store-migration.test.mjs` byte-pins those files to a baseline commit, so a line in them cannot move without failing that suite, while this Deno function is edited freely. `docs/HOSTING_EXIT_RUNBOOK.md` step 7 is the operational half — point `APP_PUBLIC_URL` at the new origin in the Base44 function environment, owner the repository owner, reversible |
| `tools-app-store-migration.test.mjs` | byte-pins all 25 `ios/` and `public/` files to baseline `1ff6018` and asserts the Base44 URL is still present, so any of the above FAILS the suite by design. Updating it is a reviewed act, not a fix |

`caremetricai.base44.app` must stay reachable while any installed copy of the old
binary is in use: `appURL` is hard-bound, so such a copy points there permanently
and no change in this repository can redirect it. **How long that is, nothing here
can say.** An earlier revision of this sentence ended "until adoption of the new
build is high", which offers an end date the mechanism does not supply — nothing in
this tree observes how many installed copies exist or what share has moved. The
condition is measured and its threshold is not; both halves belong in the sentence.

**What actually blocks a native release has little to do with Railway.**
`docs/APP_STORE_SUBMISSION_CHECKLIST.md` opens with a hard STOP — no IPA or AAB
may be uploaded, *including to TestFlight or Play testing tracks* — and the
reasons are recovery problems rather than engineering ones:

1. **Signing continuity — Android only.** Play App Signing for
   `com.caremetic.ai` must be RECOVERED, not substituted: a new signing key means
   existing users cannot update, and would have to uninstall and reinstall.
   Whether the enrolment exists is **unmeasured from this repository**, for the
   reason item 2 gives — say unmeasured rather than absent.

   **iOS is not in this clause, and an earlier revision of this list put it
   here.** Nothing cryptographic needs recovering on that side. The App Store
   re-signs every upload, so a distribution certificate is reissued rather than
   recovered, and `ios/project.yml` already sets `CODE_SIGN_STYLE: Automatic`.
   What makes an upload an UPDATE is an identity and not a key: the Apple team
   plus the bundle id `com.caremetric.ai`, which `ios/project.yml` pins and
   `tools-app-store-migration.test.mjs` asserts. Apple's public record for app
   `6757097720` gives the seller as this repository's owner (read 2026-10-01 from
   `itunes.apple.com/lookup`), so the record is on his own account and no App
   Store Connect transfer is involved. **What that reading does not establish**,
   and one sign-in would: whether the Developer Program membership is current and
   the credentials are to hand. The Stage L row "Recover Android signing, and
   Apple **account** access" has carried the dated correction since 2026-09-22;
   this list was contradicting it two hundred lines away, which is why the
   narrowing happens here rather than there.

   **The two bundle ids differ, and the difference is deliberate** — Apple
   `com.caremetric.ai`, Play `com.caremetic.ai`, with no `r`. Why is recorded
   once, in the comment directly above the two constants in
   `base44/functions/createUserWithTempPassword/entry.ts`, along with the note
   that both were verified to resolve. This plan points at that comment rather
   than keeping a second copy of the reason, because a second copy is a second
   thing to go stale.
2. **There is no `android/` directory in this repository.** Blocker 6 is not an
   Android update, it is a project that does not exist here.
3. **Four in-app purchase products are configured in the App Store record** —
   Monthly $29.99, Quarterly $79.99, Semi-Annual $149.99, Annual $264.99 — and
   **none of the native IAP implementation is in this repository**: no StoreKit,
   no receipt validation, no entitlement code, and no server-side subscription
   state in either store. This is a standing risk today, independent of the
   migration, and nothing in the migration plan carries subscription state
   across.

   **An earlier revision called them "four live in-app purchases", which claims
   more than the evidence carries.** What is measured is an App Store listing
   showing four subscription products with prices, and that proves they are SET
   UP in the record. It does not prove the app can sell them, and Base44's own
   documentation on store billing says it cannot — its answer is that the
   purchase has to happen on the web for now, with an explicit instruction not to
   use Stripe for payments inside a mobile app. Read from this repository,
   subscriptions are Stripe (`stripe_customer_id`, `stripe_subscription_id`,
   `stripe_price_id`), and a search of the whole tree for Apple receipt
   verification, the App Store server API or StoreKit returns nothing at all.

   **Do not read that as "there are no in-app purchases."** Whether anyone has
   ever been charged is invisible from here, and what to do about four configured
   products is the owner's decision. This stays a STOP item; what changed is its
   reason, from a thing known to be working to a thing nobody has measured.
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

**And the line that set the variable came later and separately**, at
`08:31:40Z`:

> Turn on AI features

Wave 6 went out at `08:39Z` on that line. It is the working practice above
demonstrating itself: the general yes at `06:40:12Z` removed the question and
did not set anything, and the switch waited eight hours for words naming it.
What it leaves is engineering, not a decision: the release thread's reading
below shows the runtime is not built to serve those operations yet.

**Invitations took a different shape rather than a yes.** Delivering one as a
plain message would have meant putting a privileged Supabase key in the
integration runtime, which D49 refuses by design. The decision taken instead,
2026-09-25, is to **build an acceptance flow** for invited people — ours to
build, no privileged key, and the send that follows it stays behind its own
switch and his words. #268's whole-service Auth-send ratchet is what will hold
that flow to it.

**Confirmed on a decision card at 08:10:56Z, and the shape of the answer is
the part to keep.** The card asked whether new staff who never had a Base44
account may join by invitation, and the option he chose read: *"New staff get
verified and added the same careful way as today's staff. It's built switched
off, and nobody is invited until you say so."* That is the card's wording of
the option, chosen by tapping it, not something he typed — which matters
because it authorizes **building** and authorizes nothing to be sent. Three
things follow, and the build thread owns all three:

- it is built **switched off**, on the pattern `PENNSYNC_API_DELIVERY` already
  sets;
- **nobody is invited until he names that switch in his own words**, which a
  tap on a card is not;
- **he applies its migration.** So the change that carries it puts `main` red
  on the ledger check until he does — D93's expected red, which the
  `apply-signal` job will say on the pull request rather than leaving it to be
  discovered.

This does **not** settle Stage C's six remaining enrolments, which are a
different population and still sit where that stage leaves them. The decisions
doc entry for it is the build thread's to write and number.

**The first and third are now discharged, 2026-09-25; the second is not, and it
is the one this page has to keep saying.** The build is D99, merged as #279 at
about `18:12Z`, and the owner applied its migration from his own machine at
about `18:18Z` on his own words. What the store gained is one column:
`pennsync_private.identity_map.provenance`, `text not null default
'base44_migrated'`, constrained to that value or `locally_verified`, with a
second CHECK keeping the two id spaces disjoint — a minted identity's id must
begin `ffffffff` and a migrated one's must not — and `protect_identity()`
replaced so the new column is immutable like the rest of the row rather than
rewritable on the way through a revocation.

**And the sentence this page must not let itself write is "new staff can now
sign up".** They cannot. The capability is in the store; the path stays
REFUSED while `PENNSYNC_ENROLL_NEW_STAFF` is unset, read exactly and untrimmed
as `enabled-v1` (`tools-pennsync-enroll.mjs:86-90`) and asked during PARSING,
so a plan carrying a locally verified enrollment is refused before a connection
is opened. Turning it on is not a flip anybody here may make: it is **D6, the
owner's own decision about who may join the store**, and it has not been taken.
Nothing in #279 sends anything either — a test reads the tool's own source and
fails if `inviteUserByEmail`, `generateLink`, `signInWithOtp`,
`resetPasswordForEmail`, `signUp`, `admin.createUser` or a mail provider ever
appears in it, or if anything inserts into `auth.`. So the honest reading has
two halves and needs both: **the store can hold a person who never had a Base44
account, and nobody can be admitted as one.**

| Needed | For | Note |
| --- | --- | --- |
| ~~Approval to run the migrate tool's write path against hosted staging~~ | Stage A | **Granted and run 2026-09-21.** 59 migrations applied, 68 recorded, pin on staging with `source 'default'`. The hosted-target CI job is added and its structural suite is green against the real project. When this row was written the stage's exit still lacked TWO things: the job actually measuring in CI, and the row-behaviour half. The first was closed on 2026-09-22 by the row below; only the second is open. It moved to stage C for identities, and on 2026-09-22 the identities turned out to be largely there already. ~~What it waits on is a sign-in, a seed transport and one `chart_assignment` row.~~ The owner withdrew the sign-in the same day, which retires the other two with it; claim 4 now rests on the composition recorded in stage A |
| ~~Add `PENNSYNC_STAGING_DATABASE_URL` and `SUPABASE_ACCESS_TOKEN` as repository secrets, and set `HOSTED_MEASUREMENT_REQUIRED` to `true` in the same change~~ | Stage A | **Done 2026-09-22 (#237).** Both secrets are configured and the flag is `'true'`. The job log shows both masked and then 15 tests, 15 passed, 0 skipped against the real project — read from the log rather than from the green tick, which is what this gate exists to distrust. The committed store's drift is now watched on every push to main |
| ~~Create the `pennsync-api` Railway service~~ | Stage B | **Created 2026-09-22.** Live at `pennsync-api-production.up.railway.app`, paused, revision `f18b053`, 74 handlers implemented and every one refusing `PENNSYNC_API_NOT_RELEASED`. The integration runtime was correctly left alone. ~~One setting no probe can confirm — `PENNSYNC_API_APP_ID` — is carried to Stage C~~ **That setting is now reported and reads the staging app**, since the 2026-09-25 repoint and redeploy put a post-#247 revision on the service |
| ~~**Redeploy `pennsync-api` from current `main`**~~ **Repoint the pinned source commit, then redeploy — every time** | Stages B and D | **Done once, 2026-09-25, and it is a standing step rather than a discharged one.** It was the live blocker for two reasons, the second binding: `f18b053` implemented 74 of 80 names, and it predated the readiness fields that report the app binding, so **every** wave pasted onto it would have released against a `PENNSYNC_API_APP_ID` no probe could check. Both closed — `20c15d8`, 80 names, `appId` reading the staging app. **It is no longer the owner's alone**: a session holding the Railway connector can repoint and redeploy, and one did. What stays the owner's is creating or deleting anything, and setting `PENNSYNC_API_FUNCTIONS` and `PENNSYNC_API_RELEASE`. What recurs is the repoint: the source is pinned on purpose, so a merge does not deploy by itself — but measured 2026-09-25 05:41Z, **the pin does not survive a variable change**, which rebuilds from `main`'s latest commit, so each release wave redeploys the service from whatever `main` is at that moment. See stage B |
| Cost approval and creation of the production Supabase project | Stage F | D4: dedicated, us-east-1, not `CM Train` |
| ~~Set the four `INTEGRATIONS_AUTHORITY_*` / `INTEGRATIONS_APP_ID` variables on the Railway runtime~~ | Stage E | **Done 2026-09-25 at `08:19:25Z`** on the owner's word at `08:14:51Z` (readings in stage E). This row was left unstruck after that. **Re-measured 2026-09-28** by an unauthenticated GET of `pennsync-integrations-production.up.railway.app/readyz`: `authorityMode: "independent"`, `base44ExecutionDependency: false`, `appId: "6a9881683dc68a0bd54f1ef7"` (the staging id) with `appStated: true`, `operations` `InvokeLLM`, `ExtractDataFromUploadedFile` and `SendEmail`, `missingProviders: []`, and the browser route still shut (`browserReleased: false`, `browserOperations: []`). The revision running is `720d140` (#288), not `main`'s tip, which is expected: this service redeploys on a variable write or a merge touching `/services/integration-runtime/**`, and nothing since has done either. Nothing on this row is owed. The round trip through a real login is still unproved (see stage E); a first real call is the proof |
| **Correct the Google Play Data Safety declaration** | **Today** — independent of every stage | Live listing says "No data collected" and "No data shared with third parties" for an app handling clinical data. A policy violation that can draw enforcement against the listing. A Play Console form — needs no key and no binary, so nothing else here blocks it |
| Ten Supabase Auth invitations accepted, each verified out of band | Stage C | The enrollment tool cannot and must not do this. **Four are already accepted, mapped and verified as of 2026-09-22**; six remain |
| ~~The publishable (anon) key and a sign-in credential for the four accepted accounts~~ | ~~Stage A claim 4, Stage C~~ | **Withdrawn 2026-09-22 — the owner declined to use the staging accounts.** Nothing is owed here. Stage A claim 4 stands on the composition recorded in that stage instead, and the one leg it cannot reach is named there |
| A decision on whether the owned store ever holds real names | Stage C, F | Today every deployment refuses a real agency or patient name, and production serves no RPC |
| **Whether new staff may join the store at all — `PENNSYNC_ENROLL_NEW_STAFF`** | Stage C | **D6, and only his.** Built and applied 2026-09-25 (D99, #279): `identity_map` can now hold a person who never had a Base44 account, and the path is refused until the variable reads exactly `enabled-v1`. He authorized BUILDING it, on a card, and a card authorizes nothing to be sent — the switch needs his own words, and the invitation that would follow it is a separate hold again. Nothing in the change can send: a ratchet fails the build if an Auth-send or mail call ever appears in the tool |
| A decision to broker `Core.SendEmail` | Stage G | **Releases** rather than unblocks, since D86 (2026-09-23). The 2 capabilities whose whole body is the send are written and gated — `sendAccountReadyEmail` and `sendWelcomeEmail` authorize the caller and then refuse `OUTBOUND_DELIVERY_RELEASE_PAUSED`, as the email action of a third does (`generatePatientHandout`, whose document half is ported, D81). The runtime already implements it. **#269 (D97, merged 2026-09-25) then BUILT the send**, so the code cost is spent: both capabilities really call `integration('SendEmail', …)` behind `PENNSYNC_API_DELIVERY`, an exact untrimmed `enabled-v1` that is unset, and `BROKERED_OPERATIONS` is untouched — `DELIVERY_OPERATIONS` is added per call only while that gate is open, so an unreleased deployment's surface is what it was before the senders existed. Both moved out of `read-only` into `integration` in that same change, which D92's cross-check is what made unskippable. What a yes costs is a variable on each side — `PENNSYNC_API_DELIVERY` here, and `SendEmail` joining `INTEGRATIONS_ALLOWED_OPERATIONS` on the runtime — plus lifting `OWNER_HELD`, which withholds both names from every emitted value. **The owner said yes on 2026-09-25 at 09:40:32Z** ("Turn on the account-ready and welcome emails"), and **all three are now spent.** `SendEmail` joined the runtime's `operations` within the minute, read from its own `/readyz`, with `browserOperations` still empty. `OWNER_HELD` was emptied by the owner's later word and shipped in #283, so the ladder emits all 80 names. `PENNSYNC_API_DELIVERY` was written at `16:19Z`, and `/readyz` on `pennsync-api` now reports `ready: true`, `deliveryReleased: true`, and 80 `operations` carrying both senders. **The capability is on**: a call to either name now attempts a real send through SendGrid. What remains unmeasured is what always was — the sender identity, and the account's plan and limits — and **the preflight could close neither**, since its SendGrid check measures the key and the field beside it is a local regex, and it has been running at every boot rather than waiting to be turned on (stage E). **#288 (merged 2026-09-25 `19:29Z`) built the probe that asks**: `checks.sendgridSender` puts the question to SendGrid over both routes — the verified-senders list and the authenticated domains, since a domain is used without a single sender — and answers `VERIFIED`, `NOT_VERIFIED` or `NOT_MEASURED`, the last being the absence of a verdict rather than a soft no. **And it answered `VERIFIED`** on the first boot after the merge (`19:30:14Z`), by `route: authenticated_domain` for `cmcarebase.com`, with the report's own `passed: true` — read from the deploy log, and re-run on every restart. Two bounds go with it: `senderConfigured` never measured the provider and must not be cited as though it had, and `VERIFIED` is not `delivered` — only a real send proves a message arrives, and no login exists to make one, so the first real user call is still the end-to-end proof. The account's plan and limits stay unmeasured; this probe does not reach them. The decision and the capability took seven hours and three separate writes to become the same thing; that gap is the lesson, not the delay |
| ~~Dispositions for 7 capabilities on retiring domains~~ | Stage G | **Settled by D84 (2026-09-23), and the description of them was wrong.** Measured, the 7 split 3 and 4. Three belong to a retiring domain and change destination: `analyzeNurseDeficits` and `analyzeRealTimePerformance` to the hub, `getCommsDashboard` to preserved-paused. The other four — `distributePolicyAcknowledgment`, `generateAIReport`, `offboardUser`, `sendExpirationNotifications` — are carried capabilities that touch one uncarried entity in passing, so they stay `port` with that leg settled by name and reason in `tools-transition-disposition.json`'s `uncarried_legs`, which the tool re-checks against the tree rather than trusts. None of the four leaves the queue: each moves on to its next real blocker. `fetchMedicareGuideline` and `scheduledGuidelineSync` also stop being carried, but that is D83 and they were never in this bucket |
| Who runs an unattended per-tenant sweep | Stage K | D49; governs 4 capabilities |
| Named owners for Product, Security, QA, Release, Hosting | Stage L | LR-01/LR-02 still TBD |
| Base44 owner-signed export permits | Stage I | Production and legacy apps |
| Recover Android signing, and Apple **account** access | Stage L — and **before the frontend moves** | Corrected 2026-09-22 ([runbook](MOBILE_RECOVERY_RUNBOOK_2026-09-22.md)). *Android:* whether it can ever be updated turns on one setting — Play Console → App integrity → is Play App Signing enabled? If yes, a lost upload key can be reset; if no, the only copy of the key is the PWABuilder output zip, and without it the app cannot be updated. *iOS:* "never regenerated" was wrong here — iOS certificates and profiles are reissued routinely without breaking updates; continuity is the app record `6757097720` staying in the same team, so recovery is signing into that account (lead: team `JC83GT8MG8`). **What the LIVE binaries load is unmeasured**, and an earlier revision of this row asserted that both apps load `caremetricai.base44.app`. §7 of that runbook says the live binaries' own configuration is unknown because their source was not found, and every public surface tried on 2026-10-01 leaves it unknown: both app origins serve deliberately empty association files (distinguishable from the SPA shell an invented path returns), the web manifest is origin-relative with `id`, `start_url` and `scope` all `"."`, and the marketing site references the custom domain and no Base44 host. What IS measured is **this repository's** `ios/`, pinned in the table above: `appURL` hard-bound to that host and `WKAppBoundDomains` listing only `base44.app` and `base44.com`, so that binary could not load the custom domain even if the URL changed. The owner said on 2026-10-01 that the iPhone app was *built only with Base44* — which answers how it was MADE, not what it LOADS, and says nothing whatever about Android, so the Android half keeps both unknowns and no part of that answer may be carried across to it. Either way both must be recoverable before Stage J moves the origin, which is why this row sits before the frontend move rather than inside Stage L |
| Find the Android build's origin | Stage L | Searched 2026-09-22: no Android file in this repository's full history (4,338 commits, 175 branches), nor in `CM-Go`, `CMbackup` or `App-Studio` — and all three were created after the live build's Jan 15, 2026 update, so none could have produced it. Per the July audit it is a PWABuilder TWA, which has no source to find; the artefact is the output zip holding the key |
| Recover or reimplement the IAP entitlement path | Stage L, and today | Four products **configured in the App Store record**; no StoreKit, receipt validation or subscription state in this repository, and nothing under `ios/` references `StoreKit`, `SKProduct` or `Transaction`. **This repository's `ios/` is not the live app** — it has no StoreKit and targets iOS 15.0 where the live app requires 15.6 — so it must not be submitted as an update to it. That conclusion stands on the target and the absent framework alone. An earlier revision ended "would remove purchase and restore for paying subscribers", which assumes the live app sells subscriptions; the STOP list above records why that is unmeasured, and whether anyone has ever been charged is invisible from here |
| **Repoint the App Store listing's own URLs** | Stage L, **and today** | Read off the live product page on 2026-10-01: the listing's privacy-policy, Support and EULA URLs are all `https://caremetricai.base44.app/…`. Apple requires a working privacy-policy URL, so retiring that hostname breaks the **listing** and not only the app — a failure mode the rest of this section does not cover, since every other row is about a binary. Fixing it is App Store Connect **metadata**: no upload, no signing, no StoreKit, so it is the one piece of this that is not behind the upload STOP and can be done before anything is recovered |
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
