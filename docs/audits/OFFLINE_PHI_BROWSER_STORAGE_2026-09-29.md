<!--
Filed into the tree on 2026-09-29, unchanged below this comment.

This is a DATED MEASUREMENT, not a standing description of the code. It was written
against `main` at `da99e35f` and extended the same day against `8bc9d214`; #364 has since
merged, so the code it describes has moved. Re-measure before quoting any of it.

Two things a reader should carry from the top:

- The line "Nothing was changed. No branch, no commit, no PR." was true when section 1 was
  written and is no longer: #364 ("Purge the acknowledged retired offline entries on
  logout") shipped the part of this finding that discards nothing. Addendum section C
  records what shipped and what deliberately did not.
- Section 5 contains a claim its own author corrected. The correction is struck through
  there and explained in addendum section B. Read the addendum before quoting section 5.

A later measurement, not in this file: the truthiness check in `purgeSyncedOfflineEntries`
was corrected to require the literal `synced === true` after review, because a stored
`{ synced: 'false' }` is an unexpectedly-shaped value the function's own docstring promises
to leave untouched.
-->

# Retired offline PHI is never purged from browser storage — measurement

Measured 2026-09-29 on `main` at **`da99e35f`** ("Admit patient_name to the state-reportable
submit, and do not honour it (#355)"), in a **shallow clone** (50 commits; `.git/shallow`
present), which bounds two questions below.

Nothing was changed. No branch, no commit, no PR. No production read of any kind.

**An addendum at the end of this file, measured later the same day on `8bc9d214`, answers
two follow-up questions, CORRECTS one claim in section 5, and records what shipped.** Read
it before quoting section 5.

## 1. The mechanism, as it actually stands

`src/lib/phiStorage.js:735 clearCachedPHI()` purges `PURGE_FULL_PREFIXES` always, and
`PURGE_AFTER_RETIREMENT_KEYS` **only** when `retirementCompleted()` (`phiStorage.js:508`)
reads `pennsync_offline_retired === '1'`.

Two independent reasons that second branch never runs in production:

**(a) The flag has one writer and it is dead.** `OFFLINE_RETIRED_FLAG` is written only by
`src/lib/retiredOfflineQueue.js:72 markRetired()`. Nothing in the repository imports that
module except its own spec — and that is *enforced*, not incidental:
`src/lib/hostedPaths.spec.js:51-57` walks the production source files, filters out the
module itself, and asserts the importer list is `[]`. I re-derived it independently: every
mention of `retiredOfflineQueue` outside specs and tooling is a comment, every mention of
`flushAndRetireOfflineQueue` outside its own spec is a comment or the export itself, and
every `import(...)` in `src/` is a static string literal (no computed or template
specifier anywhere), so there is no dynamic route in. The literal
`'pennsync_offline_retired'` appears only in `localPhiKeys.js:96` and in assertions.

**(b) `clearCachedPHI` itself has no production caller.** This is where my reading
**differs from the relayed finding**, which said logout and timeout are "what clearCachedPHI
exists for". They are not wired to it. `src/lib/AuthContext.jsx:1120 logout()` calls
`invalidatePersistedAuthorityDraftMarkersForLogout()`, `purgeAuthorityBoundDrafts()` and
`purgeRefetchablePhiForAuthorityTransition()` — never `clearCachedPHI`. Idle timeout is the
same path: `src/components/security/SessionTimeoutManager.jsx:50` calls `logout()`.
Repository-wide, `clearCachedPHI` appears only at its own definition, in `phiStorage.spec.js`
(which calls it directly), in `localPhiKeys.test.js` comments, and in one **stale comment**
at `src/components/UserNotRegisteredError.jsx:12-17` asserting that logout does
`queryClient.clear() + clearCachedPHI()`. There is no namespace import of `phiStorage`
anywhere, so no indirect route. Within the 50 commits visible here, `AuthContext.jsx` never
called it; when the caller was lost, if it ever existed, is outside the window.

So the gate is a dead branch inside a dead function.

**No other purge path reaches these keys, by design.** The live logout purge,
`purgeRefetchablePhiForAuthorityTransition()` (`phiStorage.js:711`), touches
`PURGE_FULL_PREFIXES` and `REFETCHABLE_SESSION_KEYS` only. `purgeAuthorityBoundDrafts()`
deliberately leaves the recovery queues; `phiStorage.spec.js:424-428` and `:446` assert
exactly that. `retiredBrowserCacheCleanup.js` — the one retirement module `main.jsx` *does*
invoke — touches no `localStorage` at all. The only `localStorage.clear()` in the tree is
`src/test/setup.js:27`. Nothing in production removes these keys under any condition.
(Addendum section A re-derives this exhaustively, by removal site rather than by key name.)

## 2. What the keys hold

`PURGE_AFTER_RETIREMENT_KEYS` = `offline_pending`, `offline_visit_drafts`,
`offline_sync_queue` (`localPhiKeys.js:103-106`).

No live writer. Grepping each literal across the tree returns only the registry entry and
test seeds — the subsystems that wrote them were removed. So anything present was written by
an **earlier release** on that device, and the current build can only read or delete it.

The shapes are documented by the surviving mapper, `src/lib/offlineMigration.js`, which is
the code that was to replay them:

| key | item shape | replayed as |
|---|---|---|
| `offline_sync_queue` | `{ id, type: 'visit'\|'note'\|'vitals'\|'task', data }` | `CREATE_VISIT` / `UPDATE_VISIT` / `CREATE_TASK` |
| `offline_pending` | `{ id, type: 'visit_create'\|'incident_create'\|'visit_update', data, entityId, status }` | `CREATE_VISIT` / `CREATE_INCIDENT` / `UPDATE_VISIT` |
| `offline_visit_drafts` | `[{ ...visitData, id, lastSaved }]` (skipped when no `patient_id`) | `CREATE_VISIT` |

Each `data` is passed through `stripLocal()` and sent as an entity payload, so the stored
objects are `Visit` and `Incident` payloads. The mappers name `patient_id`, `nurse_notes`
and `vital_signs` directly.

**Does it contain patient-identifying fields?** Yes, on two grounds. `Incident`
(`base44/entities/Incident.jsonc`) carries **`patient_name`** as a field of its own, plus
`details`, `report`, `resolution_notes` and `photo_urls`. `Visit`
(`base44/entities/Visit.jsonc`) carries no name column, but carries `nurse_notes`,
`raw_transcription`, `audio_url`, `vital_signs` and `family_update_text` — free clinical
narrative and a voice recording locator, tied to a `patient_id`. This is PHI on any reading.

**How much of it** cannot be measured from the repository. The field set of a given stored
object is whatever the removed writer put there, and those writers are outside the shallow
window — the schemas above bound what the *replay* would send, not what a device holds.

## 3. Is the stranded work still recoverable?

**No, not by anything that exists.** The only replay path is
`flushAndRetireOfflineQueue`, which is quarantined; its own header gives the reason —
"has no production caller because its oldest records do not carry exact principal/tenant
authority" — and `hostedPaths.spec.js` fails the build if anything imports it.
`docs/audits/FEATURE_INVENTORY.md` (F10) says the same and adds that stranded work
"requires supervised authority-bound recovery".

I searched for that supervised workflow. There is no page, component, admin tool or script
for it — every hit for recovery language is in the same four lib files and in docs. So the
data is orphaned in practice: nothing sends it to the server today, and nothing is scheduled
to.

## 4. What purging on logout would discard

- From `offline_pending`: only entries **not** marked `status: 'synced'` are unsynced work
  (`offlineMigration.js mapPending` skips synced ones).
- From `offline_sync_queue` and `offline_visit_drafts`: **no synced marker is consulted at
  all** by their mappers, so nothing in the tree distinguishes an entry already on the
  server from one that is not. Whether such a marker exists in practice is not measurable
  from here. (Addendum section B settles this from history: it does not.)
- `offline_conflicts` is *not* in this set. It is `QUARANTINED_OFFLINE_KEYS`, excluded from
  every purge even after retirement (`localPhiKeys.js:110-116`, asserted at
  `phiStorage.spec.js:446`). It holds manual conflict resolutions **and** the conflicting
  server copy. Today nothing removes it either, under any condition — a separate and
  strictly larger exposure than the one that started this.

## 5. Engineering vs. the owner's call

There **is** an engineering-only change available, and it is narrower than the remedy:

`purgeSyncedOfflineEntries()` (`phiStorage.js:519`) already drops only entries a queue's own
`synced` marker says reached the server, from `PURGE_SYNCED_KEYS`
(`penn_sync_offline_pending_visits`, `penn_sync_offline_pending_updates`). It lives inside
`clearCachedPHI`, so it never runs either. Reaching it — by wiring `clearCachedPHI` into the
logout path, or folding that helper into the live transition purge — removes only
provably-synced duplicates and **discards nothing unsynced**. ~~The same argument extends to
`offline_pending` entries whose own `status` is `'synced'`.~~ **[Corrected — see addendum
section B: no code in this repository's history ever wrote that value, so such a filter
would delete nothing.]** That is a function doing what its name says, and it is ours.

What it does **not** reach is the rest: the unsynced entries, and the two keys with no
synced marker. Removing those can drop a nurse's visit note or incident report, so it is the
owner's.

The framing that matters for that decision: **keeping it is not keeping the recovery option
open.** The replay code is quarantined behind a build guard for an authority reason, no
supervised recovery exists, and none is scheduled. So "keep" means this PHI stays on the
device indefinitely with no route to the server — not that it is waiting to be rescued.

## 6. Not measurable from here — stated, not estimated

- **Whether any real device holds anything in these keys.** That is a fact about browsers in
  the field, not about this repository. Unmeasured.
- **Whether any shipped release ever set the retirement flag.** The module has never had a
  caller in the visible window, and the clone is shallow. Moot in any case: with
  `clearCachedPHI` uncalled, a set flag changes nothing.
- **The actual field set of any stored object**, per section 2.

## 7. Provenance and scope

- The suites are green and skipped nothing: `vitest run` over `phiStorage.spec.js`,
  `hostedPaths.spec.js`, `retiredOfflineQueue.spec.js` → 3 files, 61 tests, 0 failures;
  `node --test src/lib/localPhiKeys.test.js` → 5 pass, 0 fail, **skipped 0**. Nothing fails
  today, because `phiStorage.spec.js` calls `clearCachedPHI` directly and sets the flag by
  hand (`:262`) — it proves the unit, and nothing proves the caller or the flag exists.
- This predates the Railway migration and is untouched by it. One entry point, one route
  table, one build for both backends, so it is true of the pre-migration app too: a repair,
  not a regression, and it gates nothing. **[Provenance corrected in addendum section E: as
  written here this came from relayed readings, one of which its author has since asked not
  be carried as measured. It is now measured by me, and holds.]**
- I asked batch B (session `cse_011fK4SgNufGpAscu4x1mopN`) for its finding first-hand before
  relying on it. No reply had arrived when this was written, and no peer session was
  reachable via `ListAgents`. Everything above is my own first-hand reading of
  `da99e35f`; where it differs from the relay — section 1(b) — I have said so rather than
  reconciled it.

---

# Addendum, same day: the marker, the removal-site sweep, and what shipped

Two questions came back on the survey above. Both are answered here, measured on `main`
at **`8bc9d214`** ("Prove what applying a record migration does and does not establish
(#356)"), which is `da99e35f` plus `ef1115ce` (#358) and `8bc9d214` (#356). Neither of
those touches the storage code — `git diff da99e35f..main` over `phiStorage.js`,
`localPhiKeys.js`, `AuthContext.jsx`, `offlineMigration.js`, `retiredOfflineQueue.js` and
`UserNotRegisteredError.jsx` is empty — so nothing in the survey above is stale.

To get at the removed writers I deepened the clone from 50 commits to 1,230.

## A. "Is the purge unreachable, or is there no purge?" — it differs per key

Answered exhaustively by REMOVAL SITE rather than by key name, which is the stronger
direction: every `removeItem` / `clear` in production `src/` (specs, tests and
`src/test/` excluded), and what each can reach.

| site | reaches |
|---|---|
| `phiStorage.js:115,124,176,193` | the three named authority-marker keys |
| `phiStorage.js:214` | prefixes `visit_draft_`, `pennsync.oasis.draft.v2` only |
| `phiStorage.js:231` | `sessionStorage.clear()` — per-tab, not `localStorage` |
| `phiStorage.js:558` | `PURGE_SYNCED_KEYS` only (the new live call) |
| `phiStorage.js:650` | `PURGE_FULL_PREFIXES` / `REFETCHABLE_SESSION_KEYS` |
| `phiStorage.js:792` | `clearCachedPHI` — no production caller |
| `offlineMigration.js:286` | reachable only from the dead `retiredOfflineQueue` |
| `app-params.js` (9 sites) | named token / app-id / functions-version keys |
| `browserAuthorityEpoch.js` | named probe and revocation keys |
| `main.jsx:153` | one `sessionStorage` chunk-retry key |
| `SmartOASISAssessment.jsx:348`, `draftStorage.js:149` | OASIS draft keys |
| `ErrorBoundary.jsx:73`, `SmartNoteAssistant.jsx:213,372` | `sessionStorage` |
| `useCourseContentBuilder.js:95` | an array helper, not storage at all |

So, precisely: for `offline_pending`, `offline_visit_drafts` and `offline_sync_queue` a
purge EXISTS and is UNREACHABLE. For `offline_conflicts` there is NO purge at all, under
any condition, and that one is deliberate (`QUARANTINED_OFFLINE_KEYS`). The broader
sentence — "there is no purge" — is not supportable and should not be used.

## B. The marker: legible, confirmed-on-ack, and only for two keys

The setters are gone from the tree, so the field's meaning had to be read from history
rather than from its name. `mobile/OfflineStorage.jsx` and `offline/OfflineSyncService.jsx`
were both deleted at **`87b3fda3`** (#16, the offline consolidation) — long before offline
mode itself was removed at `d8af5823` (#135). The consolidated replacement
(`lib/offlineSync.js`) used IndexedDB and uses `synced` only as a local counter, so #16 is
where the last writer of these localStorage markers goes.

**`penn_sync_offline_pending_visits` / `_updates` — CONFIRMED ON ACKNOWLEDGEMENT.**
`OfflineStorage.jsx:536 markVisitSynced` and `:574 markUpdateSynced` set `synced: true`,
and each is called only after the awaited `Visit.create` / `Visit.update` resolved; a throw
goes to the catch, which logs, records a sync error and increments the retry count without
marking. The manual-conflict branch `continue`s unmarked too. So a marked entry is a
duplicate of a record the server acknowledged. One narrowing worth knowing:
`cleanupSyncedItems` kept synced items for 24 hours and then removed them, so the surviving
population is only what a device held when it stopped running that release within a day of
its last sync. That makes the set small; it does not make it unsafe.

**`offline_pending` — NO SETTER HAS EVER EXISTED.** `status: 'synced'` is written by
nothing in this repository's history: `addPendingChange` (`:166-180`) writes
`status: 'pending'`, and `syncPendingChanges` DROPS resolved changes from the queue rather
than marking them. `git grep` for the value across `82e6801b`, `ec244e66`, `87b3fda3^`,
`87b3fda3` and `d8af5823^` returns one hit, in `offlineMigration.spec.js`. So both readers
of that branch — the old drain and today's `mapPending` — are defensive against a value
nothing produces. **This corrects section 5 above**, which said the synced-entry argument
"extends to `offline_pending` entries whose own `status` is `'synced'`". It extends in
principle and is empty in fact: such a filter would delete nothing. That key is excluded.

**`offline_sync_queue` — no marker.** `OfflineSyncService` rewrote the queue without the
sent items instead of flagging them.

**`offline_visit_drafts` — no usable marker.** `OfflineNoteEditor.jsx:60` writes
`synced: false` at creation and nothing ever sets it true.

## C. What shipped, and what deliberately did not

Draft PR **#364** on `claude/project-thread-5yxcrq`, from `8bc9d214`. It moves the
already-existing acknowledged-entry pass into `purgeRefetchablePhiForAuthorityTransition`,
the purge logout actually calls, so it runs at all; it covers `PURGE_SYNCED_KEYS` and
nothing else. The helper now verifies its removals and returns their failures rather than
swallowing them, so the strict purge can refuse on a storage failure while still leaving a
malformed value alone — and a failure leaves the queue no shorter than what reached the
server. It also corrects the `UserNotRegisteredError.jsx` comment.

Everything that can drop data stays out: the unsynced entries, the two keys with no marker,
and `offline_conflicts`.

### The test, and the sabotage that made it worth having

`logoutPhiPurgeContract.spec.jsx` drives `AuthContext.logout` with the real `phiStorage`,
because the gap the whole finding rests on is precisely that `AuthContext.spec.jsx` mocks
the module while `phiStorage.spec.js` calls the purges directly. Proving this on
`clearCachedPHI` would have rebuilt the defect inside its own fix.

Every assertion was checked by breaking what it names, at each entry point separately:

| sabotage | result |
|---|---|
| remove the purge call from the transition purge | acknowledged-entry cases fail |
| `items.filter(() => false)` | the preservation cases fail too |
| remove `logout`'s own immediate purge call | **GREEN** with mutations idle |
| remove the tenant-teardown copy alone | **GREEN** — either copy suffices |
| remove the immediate call, with a hung mutation | fails — that call site is pinned |

The two green rows are the point. Two call sites reach the same purge during logout, so
each is individually deletable with the suite green; only a hung mutation — the documented
reason the immediate call exists, and the state that blocks the teardown's copy —
separates them. The teardown copy is still not pinned by anything in this PR; its coverage
stays with `AuthContext.spec.jsx`'s mock assertion, and that residual is stated rather than
hidden.

### Validation on `8bc9d214`

`pnpm test` exit 0 (250 files, 2,189 tests in the component suite, every script in the
chain ran); `pnpm run lint` clean at 0 errors and 0 warnings; `lint:actions` passed for 12
workflows; `typecheck:signal` 0 findings; `pnpm run build` passed over 508 files;
`check:base44-surface`, `check:frontend-destination`, `check:entity-routes` and
`check:ported-call-sites` all exit 0; `node --test src/lib/localPhiKeys.test.js
src/testRegistryContract.test.js` 9 pass, **skipped 0**.

## D. Still unmeasured, and still not to be estimated

Whether any real device holds anything in any of these keys. That is a fact about browsers
in the field.

## E. Provenance repair: "predates the migration, one build for both backends"

Section 7 asserted this off two relayed readings — the module's own retirement comments, and
a third thread's report about the SPA having one entry point and one route table. Batch B has
since asked, first-hand, that its half not be carried as measured, because it inferred it
from those comments rather than measuring it. It is right to ask. Measured here instead, on
`8bc9d214`:

- **Predates the migration, by commit date rather than by comment.** Offline mode was removed
  at `d8af5823` on **2026-08-29**; the Base44 exit plan and decisions landed at `cffe376a` on
  **2026-09-19**. Twenty-one days apart.
- **One build serves both backends, at the entry and route level.** A single `createRoot` in
  production `src/`, at `main.jsx:263`. One route table, `src/routes.jsx`. No
  `VITE_PENNSYNC_BACKEND` or `'independent-staging'` conditional in `main.jsx`, `routes.jsx`
  or `App.jsx`. So the finding applies to the pre-migration app.

Both hold. **"Gates nothing" remains a judgement rather than a measurement** and should be
read as one: it rests on the migration not touching this code, which is measured, plus a view
about what the go-live plan depends on, which is not.

## F. Two method holes left open, named rather than closed

- **A writer that CONCATENATES the retirement flag's key** would defeat both my sweep and
  batch B's. Mine rules out any holder of the literal `'pennsync_offline_retired'`
  repository-wide; a key assembled from parts is not ruled out by either of us. Nothing
  should lean on its absence.
- **Whether any shipped release ever set that flag on a real device.** `localPhiKeys.js`'s own
  header allows for it ("even if an old build set the retirement flag"), and I did not
  establish otherwise. It changes nothing while the function reading the flag has no caller —
  which is why the missing caller, not the dead writer, is the load-bearing absence.
