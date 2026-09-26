# Base44 exit: adopted implementation decisions

Date: 2026-09-19
Status: **accepted** on 2026-09-19 by Kevin Deyarmin, who holds all five owner
roles in `audits/LIVE_READINESS_CHECKLIST_LR01_LR02.md`.
`tools-transition-disposition.json` carries `review_state: "accepted"`, and with
coverage complete, no disposition contradicting its source, every retirement's
rows accounted for and nothing left undecided, the coverage tool now reports
`census_ready: true`.

Read that narrowly. It means the capability census is settled and usable as an
input to the next phase. It is **not** a migration authorization: the same tool
still reports `hosted_inventory_reconciled: false` and
`migration_authorized: false`, and nothing here has been reconciled against the
hosted apps.

This record resolves the open choices in
[the transition plan](BASE44_TO_RAILWAY_TRANSITION_PLAN_2026-09-19.md) so work
can proceed without re-deciding them per pull request: the original eight, plus
the thirty-one dispositions D9 closes, the retention schedule D10 sets, the deployment pin D11 adopts and the document port D12 settles. Adopting a decision here
authorizes source changes only. It does not authorize a hosted deployment, a
migration, a release-control change, a domain move, or any spend. Every existing
gate in `REPOSITORY_CONSOLIDATION_2026-09-02.md`,
`PENNSYNC_DATA_MIGRATION_RUNBOOK_2026-09-03.md` and
`PENNSYNC_EXTERNAL_CUTOVER_EVIDENCE.md` remains in force.

Any of these can be reversed by changing the record and the manifest; nothing
below is encoded in a way that makes reversal expensive.

## How an entry is corrected

**Append, never rewrite.** Every dated entry below is a record of what was
believed on its date, and that is the whole of its value: a reader has to be
able to trust that it says what it said. So no entry is edited after its date —
including one marked OPEN, because OPEN describes the question and not the
text, and a doc where some entries are editable with nothing marking which is a
doc where none of them can be trusted.

Leaving a claim that later turned out wrong with nothing beside it is the other
failure, and it is the one that actually bites: a reader lands on the old
paragraph, has no idea the correction exists, and carries the mistake out with
them. So a superseded entry gains one dated line at its END, naming what
superseded it and where — for example `2026-09-25: the nullability framing in
this entry is superseded by D108.` — with every word of the original left
untouched. The record stays contemporaneous and the correction is findable from
the place where the mistake is.

The same rule holds for a MEASUREMENT quoted in an entry. A count, a ratio or a
reading is true of the tree it was taken from and goes stale by the next merge;
re-measure before quoting one, and record the new reading somewhere it can be
dated rather than editing the old one to match.

## D1 — Ported business logic runs in a new Railway service

`services/pennsync-api`, Node 24, deployed from this repository with the same
Docker and no-store error posture as `services/integration-runtime`, and with
bounded request bodies and deadlines. It does not yet carry that runtime's
per-token admission pools; those exist there to protect paid provider quota,
and this service reaches no provider.

Rationale: the 282 handlers are TypeScript against the Base44 SDK, the esbuild
transpile pipeline already exists, and the team already operates Railway. Keeping
Supabase as data and authentication only avoids a second execution environment.

Consequence: authorization-critical writes stay in PostgreSQL RPCs under the
existing `pennsync_private` pattern. The service is a caller of that authority,
never a replacement for it, and holds no service-role credential for authority.

Rejected: Supabase Edge Functions (a third runtime with a different language and
deployment path) and porting handlers into the integration runtime (which would
mix paid-provider custody with ordinary business logic).

## D2 — Hybrid porting strategy

Three treatments, assigned per capability in the manifest:

- **port** — a reviewed, contract-per-capability transfer. Required for anything
  that reads or writes patient data, referrals, visits, documents, memberships
  or notifications.
- **broker** — one reviewed tenant-scoped RPC family for low-risk configuration
  and reference tables, authorized from the membership row rather than a
  bespoke contract each.
- **retire / hub / preserved_paused** — not ported here at all.

Rationale: a strict per-function transfer of all 282 handlers does not finish at
any realistic pace, and a generic entity proxy is forbidden by the existing
membrane design. A reviewed broker for non-PHI configuration is neither.

Consequence: `broker` is a ceiling on risk, not a shortcut. A capability may
only hold that disposition while it touches no PHI and no authority decision.

## D3 — Two-step cutover

Step one is `business_backend_exit`: authentication, data, files and business
execution become independent while Base44 continues to serve the static shell
and the custom domain. Step two is `complete_hosting_exit`, after a new native
build is approved and shipped.

Rationale: the iOS wrapper hard-binds `https://caremetricai.base44.app/` and
declares `base44.app` / `base44.com` as App-Bound Domains. Removing that origin
before a new signed build reaches devices breaks every installed app.

Consequence: the cutover evidence packet is assembled twice, once per mode. The
retained-shell and hosting-dependency flags must be true in step one.

## D4 — A dedicated production Supabase project

A new project in the production region. `caremetric-pennsync-staging`
(`xxtyweswohkvgkprimwa`) stays staging. `CM Train` (`xsqobvvreaovwibxwyvv`)
keeps only the integration runtime's own state and private bucket.

Rationale: `CM Train` carries the Support Hub's authentication tenant and its
provisioning triggers, which `services/authority-store/README.md` records as
needing a separate access-boundary review. Sharing it would entangle two
products' identity boundaries.

Consequence: provisioning it needs explicit cost approval, as the staging
project did on 2026-09-18. Until then no production-shaped schema exists.

## D5 — Both source apps migrate into one store with distinct namespaces

CareMetric production (`694ec16e72e01b60d22f7cbf`) and legacy PennSync
(`68ee80d98929370f9e8f2932`) are carried into the same target, keyed by
`(source_app_id, entity, id)` as the archive format already requires.

Rationale: the 2026-09-03 inventory found zero overlapping User or Patient IDs,
so the two apps are separate identity systems that cannot be merged by
coincidence of key. Preserving the namespace keeps every legacy row traceable.

Consequence: ambiguous ownership is quarantined, never guessed. The log tables
(`UserActivity`, `SystemLog`, `SecurityLog`, `AuditTrail`, `AppliedDataLog`,
`ArchivedRecord`) are deliberately left `undecided` in the manifest because the
runbook requires a separate retention decision for them.

## D6 — Identity migrates by re-enrollment, never by credential copy

Users are enrolled through Supabase Auth invitations against an
operator-verified identity map. No password hash, session, refresh token or MFA
seed is exported or recreated.

Rationale: Base44 exposes no supported credential export, and the archive format
already refuses credential-shaped material outright. The affected population is
ten accounts across both apps.

Consequence: cutover requires a communicated re-enrollment window. Base44
platform identity handlers (`onUserSignup`, `adminResetPassword`,
`resetUserPassword`, `createUserWithTempPassword`, and its V2) are `retire`,
because Supabase Auth owns those operations in the target.

Enforcement, added on this branch: `tools-pennsync-enroll.mjs` is the only path
an identity takes into the owned store, and it is built so the decision cannot be
circumvented by the operator running it. It creates no native account — every
enrollee must already exist in `auth.users`, confirmed and unbanned, with the
address on that row matching the plan — so nobody can be enrolled who has not
accepted their own invitation. It reads and hashes the corroborating document
instead of accepting a digest, so `source_evidence_sha256` records provenance the
operator actually held. It writes nothing outside one transaction, refuses a plan
that contradicts a recorded identity, and records every run in an append-only
receipt naming the plan, the outcome, the database and the role.

## D7 — Paused domains are carried as `preserved_paused`

Fax, SMS, voice, telehealth, e-signature, messaging, OASIS v2, PDGM payment,
outcome computation, patient merge and public provider follow-up keep their
current paused state through the cutover and are ported only after their own
gate passes.

Rationale: the cutover contract admits an already-paused capability only with
receipts attesting both the baseline pause and the preserved pause. Disabling a
working feature is not preservation, and releasing one during a migration would
mean proving two changes at once.

Consequence: 102 handlers and 54 entity schemas are carried without being
activated. Their schemas and data still migrate; only their execution stays off.
Eight of those handlers are counted here only because the evidence check below
reclassified them: seven were wrongly `port` or `broker`, and one was
`undecided`. All eight are fail-closed pauses, not live work.

## D8 — Learning moves to the Support Hub rather than being ported

The 45 learning, training and central-adapter handlers and their 31 entity
schemas are `hub`, per `CENTRAL_LEARNING_CUTOVER.md`.

Rationale: that direction is already recorded and already has a deployed Hub
runtime. Porting them into `pennsync-api` would build a second home for
content that is leaving.

Consequence: the Hub cutover becomes a prerequisite of the exit rather than a
parallel project, and `HEYGEN_API_KEY` retires with it. Learner history,
certificates and credits must be preserved by that cutover, not by this one.

## D9 — The thirty-one open dispositions, resolved

Decision: every capability left `undecided` now carries one, so the manifest
states a position on all 549. They fall into six groups, and the group decides
the disposition rather than a case-by-case preference.

**Provenance-free logs are retired rather than carried.** `UserActivity`,
`SecurityLog`, `SystemLog`, `AuditTrail`, `AnomalyAlert`, `SystemHealthMetric`,
`TimeSavings` and `ArchivedRecord` have no tenant key and cannot acquire one
retroactively — which is exactly why `getUserActivityLog` and `runSecurityAudit`
are already paused indefinitely. Carrying them would move PHI-adjacent rows into
the new store that no row level security policy could ever authorize, to serve
readers that stay closed. The new store already keeps a *tenant-bound* disclosure
audit (`patient_disclosure_audit`, `visit_disclosure_audit` and
`visit_list_disclosure_audit` in `pennsync_private`, written by real reads), so
the compliance role has a successor with the provenance the old tables lack.

`retire` here means "not a live table in the new system", never "deleted". The
historical rows stay in the encrypted export archive; D10 sets that period at
six years and the manifest now carries a retention basis for every retired
entity, which the coverage gate enforces.

This has a consequence worth stating plainly: 11 handlers dispositioned `port`
write `UserActivity`, 5 write `SecurityLog` and 3 write `SystemLog`. Each port
drops the breadcrumb or, for the five authority brokers
(`getAuthorizedPatient`, `getAuthorizedVisit`, `listAuthorizedPatients`,
`listAuthorizedVisits`, `generatePatientChartPDF`), writes the store's own
disclosure audit instead. That substitution is part of the port, not a follow-up.

**The Notification producers are ported with Notification itself.**
`createNotification` is the Tier A "Notification authority-v1" the plan already
names, and `Notification` is `port` with a `direct` tenant key.
`sendPersonnelExpirationNotifications` and `sendCredentialRenewalReminders` read
`PersonnelCredential`, which is `port`, and write agency HR compliance nudges;
`sendExpirationNotifications` spans both that and `TrainingAssignment`, so its
credential half ports and its training half drops out to the Hub, where
`sendTrainingNotifications` already lives. These four were the "unmigrated
`Notification` producers" the manifest previously left open; they follow the
entity rather than their scheduler, because the seven native workflows that fire
them are `preserved_paused` and the new scheduler is a Phase 6 decision.

**Learning content and its telemetry follow D8 to the Hub.** `ClinicalScenario`
and `ScenarioAttempt` are course content and learner attempt history,
`RealTimePerformanceMetric` is training telemetry keyed by `training_module_id`,
and `sendRenewalReminders` drives `TrainingAssignment`, which is already `hub`.
D8 requires learner history to be preserved by the Hub cutover, so the attempts
travel with the courses rather than being retired here.

**Patient-linked content is ported; agency configuration is brokered.**
`EducationMaterial` is patient education (wound care, diabetes, fall prevention),
not staff training, and `MaterialInteraction` records delivering it to a named
patient; `AppliedDataLog` records AI-derived data applied to a chart. All three
are clinical provenance and are `port`. `CustomValidationRule`, `LibraryDocument`
and `PDFTemplate` are agency configuration with real consumers in `src/` and no
tenant key, which is precisely the D2 broker tier — each needs an `agency_id`
added before load.

**What has no successor and no consumer is retired.** `Subscription` and
`SubscriptionSettings` mirror Stripe and Apple, which are the systems of record,
and nothing in `src/` reads either. `checkAllIntegrations` probes provider
credentials out of `Deno.env`; the Railway runtime's `/readyz` already reports
operations, missing providers and release state, so porting it would need those
secrets in a second place. `manageUserVerification` is Base44 OTP administration,
which Supabase Auth admin operations replace — the same reasoning that already
made `adminResetPassword` a retirement. `testAutomations` exists only to invoke
four other Base44 functions. The `GenerateImage` Core integration is re-exported
in `src/api/integrations.js` and called from nowhere, and the runtime
deliberately omits it from `OPERATIONS`.

**Three carry a paused domain rather than a verdict.** `IntegrationSecret` holds
the in-app Telnyx messaging, voice and fax custody that 24 functions read, and
SMS, voice and fax are `preserved_paused` under D7, so the custody travels with
them. `WorkflowDefinition` and `WorkflowExecution` back the generic automation
engine whose seven workflows are all `preserved_paused`.

Consequence: `undecided` is zero and six entities enter the carried set, so the
candidate schema grows from 150 tables to 156 and the tenant-path census from 150
to 156 rows. These dispositions are the best reading of the repository's own
evidence; the owner sign-off recorded at the top of this document is what turned
them from a working position into the accepted census.

## D10 — Six years for every retired table's rows

Decision: retiring an entity is a decision about the target store, never an
instruction to delete anything. Each of the twelve retired entities now carries
a retention basis in `tools-transition-disposition.json`, and the seven that
hold an identifier or record access to one are kept for **six years**.

| Basis | Entities | What it means |
| --- | --- | --- |
| `archive`, 6 years | `AuditTrail`, `SecurityLog`, `UserActivity`, `ArchivedRecord`, `SystemLog`, `AnomalyAlert`, `TimeSavings` | Kept in the encrypted export archive for six years from the row's creation date |
| `external_system_of_record` | `Subscription` (Stripe and Apple in-app purchase), `SubscriptionSettings` (Stripe Prices) | The entity was only ever a mirror; the system named holds the record and its retention |
| `none` | `ProductionMigrationCleanupReceipt`, `StagingReadinessFixture`, `SystemHealthMetric` | Operational or synthetic rows that record nothing about a person and carry no identifier |

Rationale for six: HIPAA §164.316(b)(2)(i) requires Security Rule documentation
to be kept six years from creation or from the date it was last in effect, and
the retired access and security records are exactly that documentation. The
period is the floor this decision adopts, not a ceiling.

`SystemLog` and `AnomalyAlert` are included deliberately even though neither is
a patient record. `SystemLog` carries `message`, `details` and `error_stack`
from jobs that process patient data, so a stack can incidentally hold an
identifier; `AnomalyAlert` carries `user_email` and is security-adjacent.
Treating an incidental identifier as no identifier is how a retention gap gets
created. `SystemHealthMetric`, by contrast, records service thresholds and
nothing else.

What `archive` obliges, and what the cutover packet must carry:

- the export exists with per-object checksums **before** the source app is
  decommissioned, not after;
- the export receipt goes in the cutover packet alongside the pause receipts;
- the archive cannot be deleted before its period ends, and the deletion date is
  recorded rather than left to a person's memory;
- restoring from it is rehearsed the way the database restore already is.

Scope limit, stated so it is not read too widely: this decides the **retired**
tables only. Medical records migrate rather than archive, and their retention is
governed by Pennsylvania law and payer contracts, which this record does not
decide and which may require longer. Where any external requirement is longer
than six years, it wins; this decision never shortens one.

Enforcement: `parseManifest` rejects a retention entry without a valid basis, an
archive of zero years, or an external system of record that cannot name its
system, and `checkCoverage` fails when an entity is retired with no basis or a
basis names something that is not retired. `census_ready` now requires
`retention_settled` as well.

## D11 — One authority store per app, pinned once and unchangeable

Decision: a deployment of the authority store serves exactly one Base44 identity
namespace, named in a single `pennsync_private.deployment` row written at
migration time and immutable afterwards. Both containment layers — the
`pennsync_private.deployment_app` domain that types every app-scoped column, and
the gate inside `pennsync_private.actor()` — read that row instead of a literal.

What this replaced: both layers were the staging app id written out as a
constant. Nothing could be enrolled for production without editing the schema, so
Phase 1 could not begin. The obvious fix — admit a *set* of app ids — is the one
thing that must not happen, because together those two pins are what stop the
hosted staging project from holding production or legacy PHI, and a set lets one
database hold both.

| Considered | Rejected because |
| --- | --- |
| An assertion inside each RPC entry | Moves containment from the store to its callers. A service that forgot the check, or a compromised one, could then write another app's rows — which is the failure the store exists not to depend on |
| A different domain definition per environment | The migration text stops being identical everywhere, so drift between deployments becomes invisible rather than impossible |
| A `deployment` table plus a trigger on every app-scoped table | Correct, but the triggers are redundant once the domain itself reads the pin, and each is a separate thing to forget on a new table |

Adopted: the third, without its triggers and — after the restore rehearsal
failed on the first attempt — without its row. Holding the pin in a table is
what broke it: a domain CHECK that reads a table cannot survive `pg_restore`,
which loads data after the schema but in its own order, so `COPY
pennsync_private.agency` was checked against a `deployment` table that had not
loaded yet and every row was refused. A store that cannot be restored is not a
store, and the rehearsal suite exists to catch exactly that.

The pin is therefore a generated constant. The migration reads
`pennsync.deployment_app_id` once and generates
`pennsync_private.deployment_app_id()`, an IMMUTABLE function returning that one
value, which both the domain's CHECK and `actor()` ask. It is part of the schema,
restored before any data. Changing it afterwards means `CREATE OR REPLACE` by
the function's owner — the same trusted migration administrator who could alter
the domain directly — so nothing is given away by holding it there rather than
in a row. `pennsync_private.known_app` lists the app ids this codebase admits at
all — staging and production. The retired app `68ee80d98929370f9e8f2932` is
deliberately absent, so no deployment can be pointed at it even on purpose;
adding a third is a reviewed migration. `pennsync_private.deployment` survives
as the dated record, constrained to equal the function so it cannot drift from
what it records.

Three properties make that safe, and each is pinned by a test:

- **Unknown fails the migration.** A value not in `known_app` aborts the
  migration rather than producing a store with no containment. A typo cannot
  quietly widen anything.
- **Unset defaults to the restrictive side.** A production database whose
  operator forgot the setting pins staging, so it refuses every production write
  instead of silently accepting one. The `source` column records whether the pin
  was chosen or defaulted, so an auditor can tell the two apart.
- **Written once.** The pin is a constant in a function body; the dated record of
  it refuses update, delete, truncate and a second row, and is constrained to
  equal the function. The domain's CHECK is genuinely IMMUTABLE, which is both
  what makes it correct and what makes a restore work.

Scope limit: this decides the **namespace**, not the data, and storage, not the
surface. The synthetic-shape constraints — agency and patient names must begin
`Synthetic `, and `patient.synthetic` must hold — are untouched and still apply in
every deployment. A production-pinned database can carry enrolled identities and
still cannot hold a real agency or patient name. Relaxing those is a separate
migration under the same review, and D4's separate staging and production
projects still stand: the pin makes one codebase serve both, never one database.

The RPC surface is held back by the same decision. Every response it builds
states `contract: cm.pennsync.*.staging.v1`, `staging: true` and
`synthetic: true`. Admitting production for storage does not make those true, and
relabelling the eighteen response builders would claim a port that has not
happened — the payloads are still the staging slice's synthetic projections. So
`actor()` refuses a non-staging deployment outright. A production database is
writable by the migration administrator, which is how the operator enrollment
tool creates identity, agency and membership rows, and serves no RPC until each
contract is revised. A test fails if a response contract stops saying `staging`,
so the guard cannot outlive its reason.

Enforcement: `services/authority-store/tests/app-namespace-containment.test.mjs`
builds two databases from the same migrations, one defaulted to staging and one
pinned to production, and requires each to admit its own app and refuse the
other's at both layers. It also fails if a new table carries an app id outside
the domain, if the pin becomes editable, or if a production-pinned database
accepts a real name.

## D12 — How a rendered document is ported

Decision: a ported document is a pure builder over a jsPDF-shaped object, its
parity is proved on drawing calls rather than on rendered bytes, the service
adopts `jspdf` at the version the frontend already uses, and the logo it draws
is supplied as configuration instead of fetched.

Three things had to be settled before any of the four document functions could
move, and each was a real reason they sat blocked rather than merely unwritten.

**Parity could not be byte-for-byte.** jsPDF stamps a creation time and a
document id into every file, so two runs of the *same* code produce different
bytes. A comparison that normalises those away proves less each time it is
relaxed. What is exactly comparable is the sequence of drawing calls — same
calls, same order, same arguments means the same page — so the original is
transpiled, its `Deno.serve` handler captured, and both implementations run
against one recording surface. The original executes rather than being read, so
the guard fails if either side changes.

**The service had no dependencies.** Every other handler is pure, and the two
Railway services deliberately carried no runtime dependency at all. Rendering
needs one. The alternative — returning the document as data for the frontend to
render — was rejected because it changes what a migrated caller receives, and
this repository holds ports to the standard that the caller sees what it saw
before. So `jspdf` is pinned to the version the frontend already resolves,
imported on first use so a deployment releasing no document handler never loads
it, and the service's tests now need `pnpm --dir services/pennsync-api install
--ignore-workspace --frozen-lockfile` first.

**The originals fetched their logo from Base44.** Each one pulled a PNG from
Base44's own storage bucket on every request. Porting that verbatim would have
carried a Base44 dependency into the service the exit exists to remove, and a
third-party fetch into a request path that otherwise makes none. The logo is now
an inline `data:` URL from configuration, validated to be a PNG so no remote
address can be pointed at a render. With none configured the document takes the
branch the original already took when that fetch failed — the original's own
fallback, not a new one, and the parity test covers both branches.

A fourth thing followed: the originals called `new Date()` inside the builder,
so the same request produced a different document either side of midnight and
its parity could not be tested at all. The builder now refuses to invent a date
and takes it from its caller.

Consequence for the response contract: a document handler answers with bytes
rather than the JSON envelope every other handler uses, because that is what its
original did. `app.mjs` takes that path only for a handler that declares itself
binary, and validates the shape it is handed rather than trusting it — a wrong
content type, a non-buffer body, or a filename carrying a path or a quote is
refused as an unavailable response instead of reaching a header.

Scope: all three rendered documents — `generateBagTechniquePDF`,
`generateSmartNoteGuide` and `generateUserManual` — are written under this
decision, and the `pdf_rendering` bucket of the port queue is empty. Only the
checklist fetched a logo, and only the checklist and the guide read a clock; the
manual ported verbatim. Each answers the way its original answered, which for
the guide means base64 inside the envelope rather than bytes. All three are
implemented and unreleased, like every other handler.

## How these decisions are enforced

`tools-transition-disposition.json` assigns one disposition to every function,
entity schema, workflow and Core integration. `pnpm run check:transition-disposition`
and its test fail when a capability is added without a disposition, or when a
manifest entry survives a capability that no longer exists.

A disposition is also checked against the source it describes. `port`, `broker`
and `hub` each assert that a capability still has behavior worth carrying, so
none of them may be given to a function whose module cannot do anything: one
that imports nothing, awaits nothing, reaches no network or environment and
constructs no Base44 client serves the same constant response to every caller.
That is the shape this repository uses to hold a quarantined, paused or retired
endpoint fail closed, and 30 of the 282 functions have it today. Such a function
can only be carried `preserved_paused` or retired; claiming otherwise would send
a reviewer to port an endpoint with nothing left in it. The check reads the
module rather than the wording of its comment or the status code it serves, so a
constant `200` that skips its own work is treated the same as a constant `503`.

Eight entries asserted exactly that before the check existed, and all eight are
now corrected:

| Function | Was | Is | Why |
| --- | --- | --- | --- |
| `analyzeClinicalData` | `port` | `preserved_paused` | Fail-closed pending a tenant-authorized broker |
| `analyzeDocument` | `port` | `preserved_paused` | Fail-closed pending a private write broker |
| `analyzeNursePerformance` | `port` | `preserved_paused` | Fail-closed pending immutable tenant provenance |
| `autoAssignNurseToPatient` | `port` | `preserved_paused` | Assignment trigger disabled pending an audited workflow |
| `generateDischargeSummary` | `port` | `preserved_paused` | Fail-closed pending a tenant-owned sink |
| `generatePatientEducation` | `port` | `preserved_paused` | Fail-closed pending a tenant-owned sink |
| `getPatientContext` | `port` | `retire` | Answers `410`; superseded by purpose-bound read brokers |
| `runSecurityAudit` | `broker` | `preserved_paused` | Fail-closed pending immutable tenant provenance |

`getUserActivityLog` was `undecided` and is a pause of the same kind, so the
evidence resolves it to `preserved_paused` as well. The `UserActivity` entity
behind it stays `undecided`: whether that history is carried at all remains a
decision for its owners, and the endpoint being paused does not make it.

Current coverage, measured on this branch:

| Family | Capabilities | Classified |
| --- | ---: | ---: |
| Backend functions | 282 | 282 |
| Entity schemas | 253 | 253 |
| Native workflows | 7 | 7 |
| Core integrations | 7 | 7 |

No entry is `undecided`: D9 resolves the last thirty-one. The distribution is

| Family | port | broker | hub | preserved_paused | retire |
| --- | ---: | ---: | ---: | ---: | ---: |
| Backend functions | 86 | 34 | 45 | 102 | 15 |
| Entity schemas | 111 | 45 | 31 | 54 | 12 |
| Native workflows | 0 | 0 | 0 | 7 | 0 |
| Core integrations | 6 | 0 | 0 | 0 | 1 |

`census_ready` is true: coverage is complete, no disposition contradicts its
source, every retirement's rows have a retention basis, nothing is undecided, and
an owner moved `review_state` to `accepted`. A test pins that state, so a new
capability left undecided or a retirement with nowhere for its rows takes the
census back down rather than passing unnoticed.

What acceptance does not do is unchanged: `hosted_inventory_reconciled` and
`migration_authorized` are hard-coded false in this tool, because it inventories
the repository and has never contacted a hosted app.

## D13 — What a table with no tenant path in its schema gets instead

`tools-tenant-path.mjs` resolves how 69 of the 156 carried entities reach their
agency and names the 87 it cannot. Those 87 are not a defect in the resolver:
the schema genuinely does not say who owns the row, so the answer has to be
decided and written where a gate can re-check it. This is that decision.

**The question underneath all of them was whether an acting account is a
tenant, and the answer is no.** Thirty-four of the 87 carry only a column
naming who touched the row — `created_by`, `approved_by`, `updated_by_email`.
Scoping such a row by that account's *current* membership is the obvious move
and it is wrong: when a person moves from agency A to agency B, every row they
wrote at A becomes visible to B and invisible to A, silently, at the moment the
membership changes. That is a disclosure in both directions, and it is caused
by the predicate rather than by any bug. So an actor column either names the
row's own subject, or it is provenance and the row needs a real key.

Four kinds, recorded per entity in `tools-tenant-decision.json` with a stated
reason, and `agency` — the restrictive one — is the default that anything not
positively established as something else falls back to:

| Kind | Entities | Predicate | Why it is safe |
| --- | ---: | --- | --- |
| `agency` | 65 | `agency_id` = the caller's agency | The key is added before load, NOT NULL, so a row cannot arrive without an owner |
| `self` | 11 | the row's own account | Subject is exactly `user_id` or `user_email`; no agency is involved, so a membership change cannot move the row |
| `shared` | 2 | caller's agency, plus the platform's rows | The table already carries `is_system_template`; platform rows are readable by all, writable by none |
| `global` | 8 | readable by any authenticated caller | Regulator-published or platform-authored reference: no agency authors a row |

**`agency_id` is added before load, never backfilled.** A row that arrives
without an owner cannot be given one afterwards without guessing, and a guess
in this column is a cross-tenant disclosure. `tools-entity-schema-plan.mjs`
therefore emits `agency_id text not null` on all 68 `agency` and `shared`
tables, taking the generated schema from 2,336 columns to 2,404 and its
tenant-scoped count from 15 to 83.

**Being on the `global` list is necessary and not sufficient.** The gate
re-checks each one against its schema and can only reject: a global table may
not carry an actor column, may not reference a carried entity, and may not hold
a file — each is a way tenant data reaches a table every agency reads.
Reference data does legitimately cite outside sources, so the three fields that
do (`MedicareGuideline.url`, `CitationLibrary.url`,
`ProviderSettings.regulatory_references[].url`) are enumerated in the decision
rather than waved through, the loader must prove each value addresses somewhere
outside our own storage, and a locator added later fails the gate until someone
decides about it.

**Reading the schemas rather than the names changed three answers, and one of
those would have leaked.** `Physician` reads like a shared directory and
carries `referral_count` and `last_referral_date` — one agency's referral
volume, which a global table would have shown its competitors. `SupplyItem`
reads like a catalogue and carries `current_quantity` and `cost_per_unit`: an
agency's inventory. `CareSetting` reads like reference data and carries
`location` and `operational_hours`: an agency's facility. All three are
`agency`.

Two findings came out of the same reading and are recorded rather than acted
on here. `FeaturePackage`, `AgencyFeatureAccess` and `AgencyInvoice` carry
`agency_code`, which is a real reference to `Agency` under another name rather
than no tenancy signal at all — they still take `agency_id` before load, because
a predicate should read a key and not a code. `VisitPointConfig` carries
`agency_name`, which is a display name: not unique, not stable, and never
authority.

`User` is not in this record. Its `agency_id` is a claim the account can
rewrite about itself, so it is excluded from authorization by construction, and
the gate refuses a decision written for it.

## D14 — The policies those predicates were blocking

D13 decided what each table's predicate should be, so the generator now writes
them: 589 policies across the 156 tables, every one derived from the resolved
path or the recorded decision rather than hand-written.

| Shape | Tables | Read | Write |
| --- | ---: | --- | --- |
| root (`Agency`) | 1 | the row is an agency the caller is in | same |
| direct / decided `agency` | 79 | `agency_id` is one of the caller's | same |
| reference | 54 | EXISTS through the entity it reaches a key by | same |
| `self` | 11 | the row's own account | same |
| `shared` | 2 | the caller's agency, plus platform rows | the caller's agency only |
| `global` | 8 | everyone | nobody |

Three things about the shape are deliberate.

**The policies name no role.** `to public` rather than `to authenticated`,
because these tables carry no grant and access runs through SECURITY DEFINER
brokers. `force row level security` subjects the table's owner to its policies,
so the broker is bound by the same predicate as anyone else; naming a role here
would exempt the broker from the rule it exists to enforce.

**A reference path is an EXISTS, joined on the whole primary key.** An id is
unique only within its source app, so matching on `id` alone would let a row in
one source app reach a row in the other. The join carries `source_app_id` too.

**A global table has a read policy and no write policy at all.** Forced RLS
with nothing to permit a write is what refuses the write, so there is no
write rule to get wrong.

`record-tenant-isolation.test.mjs` proves the denials against a real database
rather than asserting them: two agencies from the existing fixtures read the
same tables and each is shown only its own rows; a cross-tenant insert is
refused; a case cannot be attached to another agency's patient; two accounts in
the *same* agency cannot see each other's `self` rows, which is the case an
agency predicate would have passed; the platform row in a `shared` table is
readable by both and writable by neither; a `global` table refuses every write;
a caller with no session reaches nothing.

**A correction that came out of writing it.** The helper requires both
`status = 'active'` and `revoked_at is null`, and this record first said that
settles the disagreement among the thirteen copied `validateMembershipRows`
variants about a membership revoked by one marker and not the other. Reading
the store shows it was never live: `membership_check` already makes that row
unrepresentable, and the database rejects the update that would create one.
The variants disagreed about a state that cannot exist. Both markers are still
asked, because a predicate leaning on a constraint in another schema is one
migration away from being wrong, and a test now pins the constraint so the
redundancy cannot quietly become the only thing holding.

What this does not do: nothing is deployed and no row is loaded. The schema and
its policies are still generated on demand and applied only to a throwaway
database in tests. The record store itself — a migration that creates this in a
real deployment — is D15 below.

## D15 — Who owns the record store, and how a caller reaches a row

**Decision.** The record store is created by a committed migration,
`services/authority-store/supabase/record-migrations/20260919170000_record_store.sql`,
generated by `node tools-entity-schema-plan.mjs --write-migration`. Its tables
are owned by `pennsync_records_owner`, a role with neither `SUPERUSER` nor
`BYPASSRLS`.

**It is a separate directory from the authority store's migrations**, and that
is part of the decision rather than a filing choice. `supabase/migrations/` is
applied wholesale by every authority harness: the disposable local stack the
acceptance jobs bring up, and the restore rehearsal, whose fixture enumerates
by hand every table it expects to find. None of them exercises a record table.
Putting 156 generated tables there makes each of those build and inventory a
store it does not use, and replaces a reviewable fixture with 2,404 columns
nobody can read — a review that cannot be performed is not a control. They are
two stores in any case: different schemas, different owners, created at
different times. `tools-pennsync-provision.mjs` applies the authority directory
and then this one, so a deployment still gets both, and a test pins that the
record store is last — every record policy is written in terms of
`pennsync_private`, and the migration refuses a database without it.

This was settled by CI rather than by taste: putting the file in the shared
directory turned four jobs red. Three fail inside `supabase start` with no SQL
error reported even after the failure classifier was taught to name one, and
that cause is **not root-caused** — it is recorded as a constraint, not a
diagnosis. The same SQL applies cleanly to a real PostgreSQL 17 as a
non-superuser `BYPASSRLS CREATEROLE` role, which is the role model a real
deployment uses, and provisioning reaches the database directly rather than
through that CLI. No caller role — `anon`, `authenticated` or `service_role` — is
granted anything by it: not a table, not a caller helper. The surface is a
broker owned by that role.

**Why the store needed an owner of its own.** D14's review raised this and it
was recorded as open. `force row level security` binds a table's owner, but
never a `SUPERUSER` or `BYPASSRLS` role, and every authority migration requires
exactly such an administrator (`PENNSYNC_BYPASSRLS_MIGRATION_OWNER_REQUIRED`).
Tables left under that role would carry 589 policies that nothing obeys. The
migration creates a role carrying neither attribute, creates the tables while
acting as it, and refuses outright if a role of that name already exists with
either attribute — adopting it would emit the policies and silently void them.

**Why no caller is granted anything.** This is the part that changed a belief
rather than filling a gap. RLS policy expressions are evaluated with the
privileges of the role running the query, so a caller with direct table access
also needs `EXECUTE` on the caller helpers — the functions that answer *who is
asking*, which the generated DDL revokes from `authenticated` precisely so the
asker cannot call them. Granting both back hands every caller the table and the
gate together. The D14 isolation suite did grant itself both, and said so; what
it did not say is that the store as generated is therefore unusable by any
caller until someone decides this. Deciding it is D15.

So the grant set is: the record owner may execute the helpers, and nothing else
is granted at all. A caller reaches a row only through a `SECURITY DEFINER`
broker owned by the record owner, which the policies bind exactly as they bind
the owner.

**The composition was measured, not assumed.** Two PostgreSQL behaviours decide
whether this works, and both were checked against a real server before the
migration was written:

- With `force row level security` and a non-bypass owner, the owner's own
  `select` returns policy-filtered rows. Without that, the role would be
  decoration.
- Entering a `SECURITY DEFINER` function moves `current_user` to the owner but
  leaves the `role` setting reading `authenticated`. Without that,
  `pennsync_private.actor()` — which refuses any connection role but
  `authenticated` — would refuse every brokered call, and a store no caller can
  reach would have looked identical to a store that is merely well defended.

`record-store-migration.test.mjs` applies the committed migration and holds all
of it: the owner's attributes, that all 156 tables belong to it and the six
helpers deliberately do not, that no caller role holds any privilege on either,
that the owner is filtered by its own policies, that a broker serves a caller
holding nothing while the same cross-tenant write stays refused, and that the
migration refuses both a bypassing owner role and a database with no authority
store to ask. A drift test regenerates the file and fails if the committed SQL
differs.

**What this still does not do.** It creates no store anywhere: applying it needs
the production Supabase project. And it settles the ownership boundary, not the
RPC family — which brokers the 80 remaining handlers get, and whether a broker
stamps a caller's agency onto a write or requires it, is the next decision.
The broker in the test exists to prove the boundary, and is not that family.

## D16 — What may actually be brokered

**Decision.** The `broker` disposition is checked against each entity's schema
rather than assigned from its name. Fourteen entities that held it move to
`port`, and one carries an enumerated exemption with a reason.

**Why it needed checking.** D2 caps the disposition: "a capability may only hold
that disposition while it touches no PHI and no authority decision." A `broker`
entity is one a single reviewed RPC family may serve generically, so that
sentence is the whole safety argument for the family — and the assignment was
made by reading names. Reading schemas found:

- **`VerificationCode`** — a live six-digit `code` beside `expires_at`,
  `verified` and `verified_at`. Serving it generically means handing out
  somebody's unredeemed second factor.
- **`PDFIndex`** — `extracted_text` ("full text extracted from PDF") and
  `page_contents` beside a `patient_id`, reached through `Patient`.
- **`TeamNote`** — free-text clinical notes about a patient, reached through
  `Patient`.
- **`SessionTimeout`** (`session_token`), **`BIIntegration`**
  (`config.api_key`), **`EmbedConfig`** (`embed_token` and a `Document`).
- Nine more carrying a file locator (`file_url`, `pdf_url`, `doc_url`,
  `template_file_url`, `document_url`, `styling.logo_url`,
  `config.endpoint_url`): handing a locator to every caller of a generic family
  is how an uploaded file leaves.

**The check can only reject, and an exemption is enumerated.** The same shape as
D13's `global` guard, for the same reason: the crude reading is wrong in both
directions. `ServiceCode.code` is a billing classification and
`FeaturePackage.agency_code` names an agency — neither is a credential, and a
name-matching rule calls both one. So a `code` is treated as a credential only
when the entity also carries a redemption marker (`expires_at`, `verified`,
`used_at` and their siblings). That is what separates a second factor from a
billing code, and it is checkable.

`CitationLibrary.url` is the one exemption: it addresses a published citation
elsewhere rather than an object in our storage, and the same field is already an
enumerated external locator under D13. An exemption that stops matching a field
fails the gate, so it cannot outlive what it was written for.

**What this does not change.** Both `port` and `broker` are carried, so the
record store is byte-identical — 156 tables, 2,404 columns, 83 tenant-scoped.
What changes is who may serve a table: fourteen now need a reviewed
per-contract handler rather than a generic family. That is the trade D2 already
described, applied to the evidence rather than to the names.

## D17 — The tenant-scoped broker family

**Decision.** One family of five operations — `list`, `get`, `insert`,
`update`, `delete` — over a generated allowlist of the 31 entities D16 cleared,
reached through SECURITY INVOKER wrappers in `public` so no Supabase project
setting is needed. A broker **stamps** tenancy from the caller's verified
identity and refuses a payload that names it. Generated by
`tools-record-brokers.mjs`, applied as
`record-migrations/20260919180000_record_brokers.sql`, and reached from
`services/pennsync-api/records.mjs`.

**Why it had to exist at all.** D15 left the record store with no way in: no
caller role holds a table, a helper, or even USAGE on the schema, because an
RLS policy expression is evaluated with the privileges of the role running the
query — so granting a caller the table means also granting it the helpers that
answer "who is asking". That was the right call and it is also a dead end until
something bridges it. D15 said what the bridge had to be (a SECURITY DEFINER
function owned by a role RLS still binds) and measured that it works, then
recorded the shape of the family as the next decision. This is that decision.
The 62 ports the queue counts against `records_schema` were waiting on it.

**One family, not one per entity.** D2 caps the `broker` disposition at "no PHI
and no authority decision" precisely so a single reviewed family may serve those
entities generically, and D16 checked all 31 against their schemas. So the
family is five functions over an allowlist rather than 155 functions over a
naming convention: one review surface, and an entity is reachable only by being
in the generated list. The generator refuses to run while any brokered entity
fails D16's ceiling, so the safety argument is enforced rather than remembered.

**A broker stamps; it never reads tenancy from a payload.** `agency_id`,
`source_app_id`, `id`, the platform timestamps, `created_by`, and a `self`
table's subject are all set by the broker. A payload naming one of them is
REFUSED rather than stripped, because a caller that believes it set an owner it
did not is the same defect whether or not the database corrected it. So is a
payload naming something that is not a column.

The agency is still a parameter, because a caller may hold memberships in
several agencies and "stamp whatever they have" is not well-defined. The broker
takes the agency the request names, verifies it against `caller_agencies()` —
the membership roster, never the request — and stamps that one. A test gives one
fixture caller two real memberships, because with one membership each RLS alone
produces the right answer and a broker that dropped the check would pass.

**The broker never re-implements a policy.** It narrows a read to the one agency
the request named and refuses to write reference data; every other question of
who may see what stays in the policies. A broker that restated them would be a
second copy to keep in agreement with the first.

**Three smaller choices, each of which could have gone the other way:**

- **The id is generated, not accepted.** A caller choosing one could collide
  with a row it may already see inside its own agency, and an id is not a field
  anyone needs to choose.
- **Absent and invisible answer alike.** `get` returns null and `delete`
  returns false for a row that is not there and for one that is not the
  caller's. Telling them apart reports whether an id exists in another agency.
- **`list` aggregates into one JSON array.** PostgREST's shape for a
  set-returning *scalar* function has differed across versions, and an API that
  must guess whether it received `[{…}]` or `[{"fn":{…}}]` is one upgrade away
  from returning the wrong thing.

**The service holds no new credential.** The record store is the same database
as the authority store — its migration refuses to apply without
`pennsync_private.deployment_app_id()` — so `records.mjs` reuses the authority
target and publishable key already validated against a fixed pair. It replays
the caller's own bearer, so a brokered read carries exactly the caller's
authority; the key names the project and nobody. A handler is handed a function
and can neither read nor forward the token that authorizes it, exactly as with
the Core integrations.

**Refusals are a shared vocabulary, and only that.** The eight
`PENNSYNC_BROKER_*` codes are defined once in the generator, interpolated into
the SQL, and emitted to the service's own module; a test asserts the set the SQL
raises and the set the service knows are the same in both directions. Anything
else PostgREST returns — a database message, a hint, a constraint name — maps to
one code, because it would otherwise cross a trust boundary on its way to a
caller.

**What this still does not do.** It serves the 31 entities D16 cleared and no
others. The 125 `port` entities — every clinical table — are deliberately not
reachable through it, and a handler that needs one still needs a reviewed
contract of its own. It also creates nothing anywhere: like D15's migration,
applying it needs the production Supabase project.

## D18 — The same ceiling, on the function side

**Decision.** A function dispositioned `broker` is checked against the entities
its module actually touches. All 33 fail, and all 33 move to `port`. The check
is a gate in `tools-transition-disposition.mjs`.

**Why it needed checking.** D16 applied D2's ceiling to `broker` *entities* and
found fourteen assigned by reading names. The same disposition on a *function*
was never checked at all — and it claims more than the entity one does. A
`broker` entity is one a generic family may serve; a `broker` function is a
capability that can be **retired and replaced by calls to that family**. So a
`broker` function whose module does anything the family cannot do is not
optimistic, it is wrong.

D17 made the family concrete, which made the question answerable: it serves 31
entities, none of them clinical, through five operations. Measuring the 33
functions against that:

- **32 reach an entity the family does not serve.** Twenty reach one D2 names
  outright as requiring `port` — patient data, visits, memberships,
  notifications.
- **The worst case is `getDashboardData`**, which reads every active patient
  and today's visits and incidents. It was dispositioned `broker`.
- **The remaining one, `sendWelcomeEmail`, touches no entity at all.** It sends
  mail through `Core.SendEmail`. An entity family cannot be the replacement for
  a capability that uses no entity, so that is a contradiction too rather than
  the one clean case.

**Reading the module is the whole check, and two access forms nearly defeated
it.** A first pass matching `entities.Name` reported six functions as staying
inside the family. Reading those six showed the real number is zero. The misses:

- **Namespace aliasing** — `const sr = base44.asServiceRole.entities`, then
  `sr.Patient.filter(...)`. `getDashboardData` contains no occurrence of
  `entities.Patient` while reading every active patient.
- **Destructuring** — `const { Agency } = base44.entities`.

Both are now read, and `entitiesTouched` has its own tests for each form rather
than being exercised only through the gate. Dynamic access
(`entities[name]`) is tracked separately and is never a pass: a computed key
names a set nothing here can enumerate, so it cannot be shown to stay inside the
family, and the names that *were* found do not excuse it.

**Why they all land on `port`, and what that does not settle.** `port` is D2's
requirement for anything reading patient data, referrals, visits, documents,
memberships or notifications, which covers twenty of them outright. For the rest
it is the conservative landing: `port` is the strictest disposition, so choosing
it wrongly costs queue length, while choosing `broker` wrongly costs isolation.

It is genuinely not the last word on all of them. Several — `userManagement`,
`resendInvitation`, `offboardUser`, `checkExpiredInvitations` — are membership
lifecycle, and the authority store already owns memberships and exposes an RPC
for revoking one. Those may belong to it as `hub` rather than being ported here:
a reviewed change the gate now permits and records, rather than an assumption it
hides.

**Two of them were checked rather than left open, and the answer is no.**
`fetchMedicareGuideline` and `listPolicyLibrary` read what look like reference
tables, so the question was whether their entities could earn `broker` back and
let the family serve them. Running D16's ceiling over both says they cannot, for
two different reasons:

- **`PolicyLibrary` carries `doc_url`** — "URL to policy document", which is an
  object in our own storage. That is exactly the case the file-locator rule
  exists for: handing a locator to every caller of a generic family is how an
  uploaded file leaves. It stays `port`, and no exemption is warranted.
- **`MedicareGuideline` is blocked on `url`**, and that one *would* be
  exemptable — it addresses published CMS guidance rather than our storage, the
  same argument `CitationLibrary.url` already carries. But it buys nothing:
  the entity is `global`, so the family serves it read-only, and
  `fetchMedicareGuideline` creates and updates it. An exemption that unblocks
  nothing is surface with no purpose, so it is not written.

Worth noting for the next entity that looks exemptable: a D13 external-locator
declaration does **not** carry into D16. They ask different questions — D13 asks
whether a locator addresses our storage, D16 whether a generic family handing it
out is safe — so the exemption is per block, deliberately.

**What it costs.** The port queue grows from 78 to 111 functions:
`records_schema` 62 → 94 and `core_integration` 0 → 1. That is not new work
appearing — it is work that was already there, counted under a disposition that
said someone else would handle it generically. A queue that is longer and true
is worth more than one that is shorter because it was measured by name.

## D19 — What a reviewed per-capability contract is

**Decision.** A capability the generic family cannot serve gets one
hand-written SQL function in the record store, owned by
`pennsync_records_owner` and `SECURITY DEFINER`, reached through a
`SECURITY INVOKER` wrapper in `public` and through its own allowlist in
`services/pennsync-api/record-contracts.mjs`. `listPolicyLibrary` is the first,
and the pattern for the 93 still queued.

**Why it cannot be generated.** The two migrations before it are generated
because every table gets the same treatment and every brokered entity the same
five operations. A contract is the opposite: it exists precisely because a
capability's authorization is its own, so there is nothing to generate from.
D2 calls this "a reviewed, contract-per-capability transfer" and means it
literally. What is gated instead is that every contract has a test which proves
its refusals against the real migration on a real database.

**What a contract may do that the family may not.** Two things, and
`listPolicyLibrary` needs both:

- **Return a file locator.** It returns `doc_url` — "URL to policy document",
  an object in our own storage — which is exactly why D16's ceiling keeps
  `PolicyLibrary` out of the generic family. Handing a locator to every caller
  of a generic surface is how an uploaded file leaves; handing it to the callers
  of one reviewed endpoint is a decision about that endpoint.
- **Decide about the caller rather than the row.** The original gives the full
  catalog — drafts and archived included — only to a platform-protected
  built-in admin. No policy can express that: a policy decides whether a row
  belongs to the caller.

**Three properties the pattern fixes, because 93 more follow:**

1. **The decision is in the database.** The service carries no authorization
   logic for a contract at all. It would otherwise be a second answer to keep
   in agreement with the first, and the whole design rests on the database
   being the one that decides.
2. **A contract is not an exemption from the policies.** It is owned by the
   same non-bypass role, so `force row level security` binds it exactly as it
   binds a broker. `listPolicyLibrary` adds no tenant predicate of its own
   beyond the agency it was asked for; `policy_library_read` is what keeps
   another agency's rows out, and a test proves that by giving one caller two
   real memberships.
3. **It projects, it does not return the row.** The fifteen columns the
   original returns are selected by name. Returning the row would mean a column
   added later is exposed by default, which is the opposite of what a reviewed
   contract is for.

**A new helper, and why no policy may use it.**
`pennsync_records.caller_tenant_role(agency)` answers which role the caller
holds in one agency. No policy asks it and none should — a policy decides
whether a row is the caller's, and all 596 are written in terms of
`caller_agencies()`. A contract making a decision *about the caller* had
nothing to ask, which is the gap the first contract exposed. It is scalar
because `membership` is unique on `(app_id, agency_id, auth_user_id)`, it
returns null for a non-member, and it is granted to the record owner alone: a
caller must not be able to ask its own role directly.

**One divergence, recorded because it is a narrowing rather than a port.** The
original's administrator is Base44's platform-protected built-in `admin`, who
saw every agency's drafts. This deployment issues no platform-owner context at
all — the authority store's contract pins `is_platform_owner` false — so the
nearest reviewed equivalent is the agency's own `agency_admin`, who sees only
their own. That is strictly less access than before, and a test asserts both
halves: a clinician in the agency is refused the catalog, and an administrator
of another agency is refused the agency entirely.

**What it costs and what it proves.** The port queue moves for the first time
on a record-backed port: `records_schema` 94 → 93, `none` 10 → 11. Every port
written before this one either computed an answer, rendered a document or asked
a model, so the records bucket had only ever moved by reclassification. It
moves by work now.


## D20 — Only 25 of the 94 were ever waiting on the record store

**Decision.** The `records_schema` blocker is split by what each module
actually reads, against the dispositions of the entities it reads. Two new
categories rank above it, both applied over `classifyPortBlocker`'s verdict
rather than inside it, because neither is a property of the source text.

| Was | Is |
| --- | --- |
| records_schema=94 | **entity_not_carried=34**, **entity_authorization=34**, records_schema=25 |

**Why it was wrong.** `records_schema` had come to mean "touches an entity",
which is the same mistake the `core_integration` and `files` splits already
corrected once each — a category inferred from the shape of a call rather than
measured against what the call reaches. A queue saying 94 handlers wait on the
record store is wrong twice over, and the store arriving tomorrow would not move
two thirds of them.

- **`entity_not_carried` (34)** — the module reads an entity dispositioned
  `retire`, `hub` or `preserved_paused`, so the table it wants will not exist
  here at all. Nineteen touch `UserActivity`, five `SecurityLog`, four
  `SystemLog`. What is owed is a decision about that use — does the capability
  drop it, redirect it, or does the entity stop being retired — not a schema.
- **`entity_authorization` (34)** — the module reads a carried entity that has
  forced RLS and **no policy**. That entity is `User`, and its absence is
  deliberate: D14 left it "unreachable through this surface until a decision
  says how it may be read", because the only tenancy it carries is a claim the
  user can edit about themselves.

**`User` is the largest single gate in front of the port queue.** Fifty of the
94 touch it; 34 are held by nothing else. That number is the argument for taking
the decision D14 deferred rather than continuing to describe it as deferred: no
amount of record-store work moves those 34, and they are a third of everything
left.

**Precedence, and what is deliberately not refined.** `entity_not_carried`
outranks `entity_authorization` because whether a capability survives at all
comes before how a table is read, and both outrank `records_schema` because
neither is helped by the store existing. Only a `records_schema` verdict is ever
refined: a handler that reads a retired entity *and* a file still waits on the
file layer, because that stays true whatever happens to the rows. A module using
a computed key (`entities[name]`) names a set nothing can enumerate, so nothing
is claimed about it and it stays where the source put it.

**What the `User` 50 actually want, measured rather than assumed.** "Decide how
`User` may be read" sounds like it reopens what an identity is. Reading the
modules says it does not, because the need splits cleanly and neither half
wants the self-editable profile table:

- **41 read the roster** — `User.list`, `User.filter` or `User.get`, wanting the
  members of an agency and their attributes. The authority store already owns
  exactly that: `pennsync_private.membership` joined to `identity_map` is the
  roster, it is not self-editable, and it is already exposed as
  `pennsync_staging_memberships`.
- **9 write a profile** — `User.update`, which needs a mutation path rather
  than a read policy.
- **0 want only their own claims.** Every one of the 50 touches the entity
  itself, so none of them is resolved by the tenant context they already get.

What those fields are is the other half of the argument. Across the 50 the most
read are `agency_name` (120), `email` (117), `account_type` (89) and `role`
(72) — and `agency_name` and `account_type` are precisely the claims
`SELF_EDITABLE` names and D13 refused to build tenancy on. A policy over the
carried `User` table would hand those back as though they were trustworthy.

So the decision in front of the 34 is narrower than "how is `User` read": it is
whether the roster is served from the authority store, which already models it
and cannot be edited by its subject, rather than from the carried profile table.
That is a decision to take rather than a design to invent, and it is the one
thing standing in front of a third of the remaining queue.

**What this does not do.** It moves no work and unblocks nothing. It says, in a
number a test pins, that two thirds of the remaining queue is waiting on
decisions rather than on the store — and names which decision each one waits
for.


## D21 — Which representation of a care team authorizes a chart read

**Not decided here.** This records the question, names what it blocks, and
puts a number on it, because the queue was reporting those capabilities as
waiting on a schema they are not waiting on.

**Three representations exist, and nothing says which governs.**

1. **`pennsync_private.assignment`** in the authority store. Not hypothetical:
   `pennsync_private.context` already uses it to scope a clinician, so the
   owned identity path has been answering this question all along.
2. **`PatientCareTeamAssignment`**, carried into the record store as its own
   `port` entity with its own table and policies.
3. **`Patient.assigned_nurses`** — an array of emails — plus `created_by`,
   which is what every Base44 original actually reads.

**What it blocks: 15 capabilities**, including every document read and write,
visit creation and update, patient update, the clinical task generators, the
alert readers and the note history. `getScopedPatientAlerts` is typical — its
whole authorization is "a patient the caller created or is assigned to".

**Why it is not per-capability contract work.** D19 settles that a capability's
authorization is its own and belongs in its contract. This is the exception
that proves the rule: the answer has to be the *same* for all fifteen or the
system contradicts itself about who may open a chart, and a contract written
against one representation while another governs is a silent authorization
bug rather than a visible one. So it is a decision first and contracts after.

**The cost of getting it wrong is asymmetric.** Choosing a representation that
is too narrow means a clinician cannot see their own patient's alerts —
visible, annoying, safe. Too broad means they can see someone else's — invisible,
and a disclosure. The narrow failure is the recoverable one.

**Two further facts worth having before deciding**, both measured rather than
assumed. `assigned_nurses` is an email array on the patient row, so it is
editable by anyone who can update a patient, which is a weaker guarantee than
either of the other two. And `pennsync_private.assignment` is the only one of
the three that already has a working authorization path written against it.

**Where the queue stands once this is named**, out of 100 unwritten ports:

| Blocker | Count | What it waits for |
| --- | --- | --- |
| `entity_not_carried` | 34 | A decision about capabilities reading an entity that gets no table here |
| `entity_authorization` | 34 | Whether the roster comes from the authority store (D20) |
| `patient_access_model` | 15 | This decision |
| `records_schema` | 10 | The record store itself |
| `files` | 4 | The file layer |
| other | 3 | A port, a third-party key, `Core.SendEmail` |

**Ten.** That is how many of the hundred can be written today. The queue said
94 were waiting on the record store; it stands in front of a tenth of them.


## D22 — The broker family serves three entities, not thirty-one

**Decision.** D16's ceiling is extended to read each entity's own `rls` block.
Twenty-eight of the thirty-one brokered entities fail it and move to `port`.
The three that remain are served **read-only**. Found in review, and it is the
most consequential correction on this branch.

**What was wrong.** D2 caps `broker` at "no PHI and **no authority decision**".
D16 checked schemas for dangerous *fields* — credentials, clinical subjects,
file locators — and never read the block where Base44 records the entity's own
authorization. Every one of the thirty-one carries one:

| What the schema says | Entities | What the family did |
| --- | --- | --- |
| `read/create/update/delete: false` | 13, including `AIKnowledgeBase`, `AIInsightFeedback`, `AutomaticCarePlanTrigger`, `ServiceCode` | Served all four operations to any agency member |
| Conditioned — admin-only, owner-only | 15, including `OCRTrainingSession`, `ScheduledReport`, `ApprovalRequest` | Ignored the condition entirely |
| `read: true`, writes conditioned | 3 | Served writes the schema conditioned |

`false` is the strongest statement in that vocabulary: it does not mean "no
rule", it means no client may perform that operation at all and the rows are
reachable only through a reviewed backend function. Serving such an entity
through a generic family **inverts** it — every member of the agency gets what
the schema gave nobody. That is a widening against Base44, introduced by this
branch, and D17's own test suite could not see it because it tested the
mechanism rather than the allowlist's right to exist.

**The rule now.** An entity is brokerable only if its schema plainly permits a
read, and writable through the family only if it plainly permits every write.
Nothing satisfies the second, so `insert`, `update` and `delete` exist and are
provably unreachable — asserted per entity, so an entity that later becomes
writable arrives without coverage and fails loudly.

**Survivors:** `Announcement`, `FacilityDocumentationRule`, `RegulatoryUpdate`.
All three declare `read: true` and condition their writes, all three are agency
configuration rather than clinical data, and none reaches tenancy through a
clinical entity.

**A regression the fix introduced, caught the same run.** Renaming those three
from mode `tenant` to `readonly` stopped the family's agency narrowing firing,
because the SQL asked `mode = 'tenant'` literally — so a caller holding two
agencies saw both agencies' rows. The two-membership case added in D17
precisely because single-membership fixtures cannot see that failure caught it
immediately. The narrowing is keyed to a set of tenant-scoped modes now.

**What this costs, stated plainly.** D17 described a family serving 31 entities
through 5 operations. It serves 3 through 2. The machinery — the stamping, the
payload refusal, the tenant narrowing, the ownership boundary — is unchanged and
still correct; what changed is the honest answer to "what may it serve", and
D2's shortcut turns out to apply to almost nothing in this app. The 28 join the
125 entities that need a reviewed contract under D19, which was always the
safer path and is now very nearly the only one.


## D23 — The roster comes from the authority store

**Decision.** The staff roster is served from `pennsync_private.membership`
joined to `pennsync_private.identity_map`. The carried `User` table keeps
forced RLS and no policy, as D14 left it.

**Why.** D20 measured what the fifty `User`-touching capabilities actually
want: 41 read a roster, 9 write a profile, 0 want only their own claims. And
the fields they read most are `agency_name` (120 references) and
`account_type` (89) — precisely the claims `SELF_EDITABLE` names and D13
refused to build tenancy on. A policy over the carried table would hand those
back as though a user's own assertion about which agency they belong to were
trustworthy.

The authority store already models the roster, it is not editable by its
subject, and `pennsync_private.context` already authorizes against it. Serving
it from there is the smaller change *and* the stronger guarantee.

**What this unblocks.** The 34 capabilities counted `entity_authorization`.
They do not become written by this decision — each still needs its port — but
nothing in front of them is undecided now.

**What it still leaves open.** The 9 profile writes need a mutation path, which
is a narrower question than the roster and is not answered here. Until it is,
a capability that writes a profile stays blocked and should not be ported by
reading a profile write as a roster read.

**How it was built, and what building it found.** The decision above said the
roster comes from the authority store. What that turned into is a `roster`
tenant kind in the schema generator, and the shape is worth stating because it
is why `roster` is a kind of its own rather than a variant of `agency`: **the
predicate does not read the row's tenant column at all.** It asks
`caller_roster_ids()` — a new administrator-owned helper over
`pennsync_private.membership` — who the caller shares an active agency with,
and admits the row if it names one of those people. The untrusted column is not
narrowed; it is not consulted. The isolation test seeds rows carrying *lying*
labels, so a policy that consulted them would come out exactly backwards.

Three consequences, each deliberate:

- **Read only.** One select policy and nothing else, so forced RLS refuses
  every write from everyone including the record owner. That is what keeps the
  open profile-write question from resolving itself as "allowed" by accident.
- **`roster` and `profile_claim` are paired both ways.** A `roster` decision on
  an entity that has a usable tenant key would replace that key with "whoever
  shares an agency with the caller", which is wider, every time. And a profile
  claim decided any other way authorizes through the column its subject
  rewrites. The gate refuses both.
- **`User` stops being exempt.** It was excluded from needing a decision at
  all, because every kind then available would have authorized through that
  column. Nothing is exempt now.

Two findings came out of measuring rather than assuming:

1. The port queue's `entity_authorization` bucket meant "reads `User`". With a
   read policy it should have emptied — except **8 of the 43 update a
   profile**, and the classifier could not tell reading a table from writing
   one. It records writes now, and what blocks is derived from the policies the
   store actually emits rather than from the tenant path. 43 → 10.
2. The same rule caught two capabilities nothing had ever reported:
   `fetchMedicareGuideline` and `scheduledGuidelineSync` **write
   `MedicareGuideline`**, a `global` reference table that by decision no tenant
   surface may write. That was true from the day `global` was defined and was
   invisible, because every previous version of this check asked only which
   entities a module touched. They need a platform ingestion path, which is not
   a caller-facing handler.

A third, smaller: the committed schema plan recorded `broker` for 42 entities
D22 had already moved to `port`, because `comparePlan` never compared
`disposition`. It does now.

**The contract over it.** `20260920030000_contract_roster.sql` is what the 35
readers will call, and its shape follows from the same decision: the authority
store's membership is the FROM clause and the carried profile row is joined on.
So a colleague with a membership and no profile row is on the roster with empty
profile fields, and a profile row with no membership is not on it at all —
membership decides who exists. The carried row contributes only what the
authority store has no column for: staff discipline, duty status, credentials,
telephone number.

Four fields the old code reads most are therefore **not projected from the
carried row under any name**. `agency_id` and `agency_name` come from the
membership and its agency; `role` and `account_type` are replaced by
`tenant_role`. `is_manager` and `is_approved` are derived too, because both
exist as self-editable booleans and a handler gating on the stored
`is_manager` gates on the user's own assertion. Personnel detail — telephone,
credentials, licence, reporting line — widens only for an authoritative
`agency_admin` or `manager`, and is null rather than absent for everyone else
so the shape does not tell a handler which kind of caller it is serving.

Three more defects came out of testing it, and all three were the kind that
pass a test that only counts rows:

1. **A revoked colleague stayed on the roster.** The policy excluded them and
   the contract did not, so they would have appeared with every profile field
   empty — a phantom that reads as somebody who never filled anything in. Both
   now use one criterion.
2. **A cursor naming somebody no longer on the roster silently truncated the
   walk.** That is exactly what a mid-walk revocation produces: an agency of
   thirty reported as an agency of three. Answering the whole roster instead
   would repeat every colleague already seen, so it is refused and the caller
   starts again.
3. **`caller_roster_ids()` was missing from the record owner's `grant
   execute`.** A policy expression runs with the querying role's privileges,
   and inside a broker that role is the owner — so every read of the roster
   would have failed outright with `permission denied for function` rather
   than returning no rows. The check for it reads both sides out of the
   migration now: which helpers the policies call, and which the grant names.
   The hand-kept list of helpers that let this through is gone; the list is
   whatever the schema holds.


## D24 — `pennsync_private.assignment` decides who may open a chart

**Decision.** Of the three representations D21 named, the authority store's
`assignment` table governs. `PatientCareTeamAssignment` and
`Patient.assigned_nurses` do not authorize anything.

**Why.** It is the only one of the three that already has a working
authorization path written against it — `pennsync_private.context` uses it to
scope a clinician today — and the only one that is not editable by the people
it authorizes. `assigned_nurses` is an array of emails on the patient row, so
anyone who may update a patient may grant themselves access to it; that is not
a basis for deciding who may open a chart.

**What this unblocks.** The 15 capabilities counted `patient_access_model`:
every document read and write, visit creation and update, patient update, the
clinical task generators, the alert readers, the note history. One answer for
all fifteen, which is what D21 said this had to be.

**What has to be built before a single one of them is ported.** Two things,
and neither is optional:

1. **A caller helper the policies can ask.** The record store's policies are
   written in terms of `caller_agencies()`. Patient-level scoping needs the
   equivalent for assignment, owned by the administrator and granted to the
   record owner alone, exactly as `caller_tenant_role` is.
2. **A backfill.** Today's real assignments live in `assigned_nurses`. Moving
   authority to `assignment` without carrying those across means every
   clinician loses access to their own patients on cutover. The backfill is a
   reviewed data migration with its own rehearsal, and the failure it must not
   have is the quiet one: a clinician who *gains* access to a patient they were
   never assigned.

**The asymmetry D21 recorded still holds** and should shape the rehearsal: too
narrow is visible and safe, too broad is a disclosure. A backfill that drops a
row is a support ticket; one that invents a row is an incident.

**The first half, built.** Two helpers rather than one, because the answer is
not a single set: an administrator sees every chart in their agency and that
set lives in the *record* store, which an authority-store helper cannot read,
while a clinician sees an enumerable set of assignments that lives in the
authority store. So `caller_opens_every_chart(agency)` is a boolean and
`caller_assigned_patients(agency)` is a set, and a policy asks both — the same
shape `pennsync_private.visible_patient` already uses for the staging surface.

Who opens what, and it is a decision rather than a reading: `agency_admin` and
`manager` open every chart in their agency; `clinician`, `social_worker` and
`spiritual_care` open the ones they are assigned to; `office_staff` open none,
because the entity schema says that role "sees only non-clinical functions".
Where it was a tie, D21's asymmetry broke it toward narrow.

**What the narrowing is applied to is derived, not listed**, and that is what
makes it a safety rule: any carried entity with tenancy of its own and a
top-level patient column is narrowed by the next regeneration, whether or not
anybody remembered. 58 carried entities name a patient. A list would have to be
kept.

**The defect worth recording, because it is the one this nearly shipped with.**
The narrowing has to travel with the RECURSION. A reference predicate inlines
the target's *tenant* check, so narrowing `Patient` alone left `document`,
`medication`, `patient_alert`, `care_plan` and fifty others agency-wide — every
row of a chart the caller was never assigned to, in tables that looked narrowed
because their target was. The generated SQL said so plainly once it was read:
`document_read` reached `patient` and asked only whether the patient was in the
caller's agency. The chart predicate is now carried in at each hop, a test
asserts every chart-linked table is narrowed by its own predicate or a borrowed
one, and the real-database case proves both routes rather than one.

One deliberate widening, stated so it is not mistaken for an oversight: a row
whose subject is **null** stays agency-scoped. A referral taken before a
patient exists is intake data and not yet anybody's chart, and hiding it from
every clinician would break intake to protect a chart that is not there.
`Patient` has no such case, its subject being the primary key.

### The second half, and the thing that made it impossible

Writing the backfill turned up the finding that matters most in this decision,
and it was three constraints deep:

1. `pennsync_private.assignment` has a foreign key to
   `pennsync_private.patient`;
2. that table's `display_name` must be `like 'Synthetic %'`;
3. its `synthetic` column carries `check (synthetic)`, so it can never be
   false.

Together those mean **an assignment over that table could only ever name a
synthetic patient**. The patients of record live in `pennsync_records.patient`.
So the backfill D24 requires could not have written a single row, and the first
person to find out would have been whoever ran it at cutover — which is exactly
the shape of failure D21 said this decision must not have.

**The first attempt at the fix was wrong, and CI caught it.** It dropped
`assignment`'s patient key, on the reasoning that the key was a second copy of
a check `pennsync_private.mutate` already makes (`PENNSYNC_PATIENT_DENIED`).
That reasoning was true of the *grant* path and false of everything else. The
key has a second job: it is one of four RESTRICT keys that make rolling back an
imported patient **refuse** while something clinical still references it.
`tools-pennsync-archive-import.mjs` names those four and refuses the whole
import if the set differs, and its postgres suite proves the behaviour —
"dependent clinical assignment prevents deletion". Dropping the key removed a
deletion guard, and all sixteen import cases failed with
`IMPORT_SCHEMA_UNSAFE`.

**What is actually true:** one table cannot key to two patient populations.
`pennsync_private.assignment` is the *staging* care team — its patients are
synthetic by constraint, `mutate` grants it, `visible_patient` reads it, and
the import tool guards it. Production gets a sibling,
`pennsync_private.chart_assignment`, with the same shape, the same
provenance-immutable trigger, forced RLS and no policy, and the same
membership key. It carries no patient key, and there that is the honest answer
rather than a concession: `pennsync_records` belongs to
`pennsync_records_owner`, a role this store's administrator deliberately is
not, and a key across that boundary would give the record owner a referential
hold on authority rows. The failure mode inverts safely, because the narrowing
is a *filter* — an assignment naming a patient that does not exist admits no
row.

`caller_assigned_patients()` reads the new table; the backfill writes it; the
staging surface is untouched.

**Why the default test run missed it.** `test:pennsync-import:postgres` needs a
real PostgreSQL, is gated behind `PENNSYNC_TEST_PG_URL`, and is not part of
`pnpm test` — so the change passed lint, the whole suite, the build, the
typecheck gate and all seven gates, and failed only in CI. That gap is closed:
`record-store-migration.test.mjs` now reads the import tool's pinned key list
and the migrations' actual inbound keys and asserts they agree, which runs
everywhere `pnpm test` does. Reintroducing the bug fails it.

### What the backfill carries, and the source it must not read

The first version read `Patient.assigned_nurses`. That is the wrong source,
and reading the modules says so plainly rather than by implication:

- `listAuthorizedPatients` states in its own header that "mutable
  `assigned_nurses` email values **are not treated as authority**";
- the entity it does trust, `PatientCareTeamAssignment`, is server-owned —
  its schema carries `rls: {create: false, read: false, update: false,
  delete: false}`, so no client may touch it at all — and has a full
  lifecycle: grant, activate, suspend, revoke;
- that entity's `source` enum contains **`legacy_assigned_nurses`**.

The third is the one that settles it. **The migration off `assigned_nurses`
already happened inside Base44.** Those addresses were turned into
server-owned assignment rows with their provenance recorded. Reading them
again would re-derive a derivation — and, far worse, would **resurrect access
somebody revoked**, because the address stays on the patient row long after
the assignment built from it is suspended. That is exactly the invented row
this tool exists to refuse, arriving by a route the first version did not
check. A test now keeps a stale address on a patient whose assignment was
revoked, because that is the shape an email-sourced backfill gets wrong.

Carrying `PatientCareTeamAssignment` instead makes two other problems
disappear. A patient's creator keeps their own chart, because the original
records that as an assignment with `source: 'patient_creator'` rather than as
a separate rule — so D24's single-armed narrowing is complete after all, where
an `assigned_nurses` backfill would have locked every intake clinician out of
the patient they had just created. And resolution is by **Base44 user id**,
which the entity's schema calls authoritative and says never to substitute an
email for, so none of the address-matching hazards arise at all.

**What it refuses**, every case decided by D21's asymmetry — a dropped row is
a support ticket, an invented one is a disclosure nobody reports:

- **Only an `active` assignment carries.** `suspended` is reversible and
  `revoked` is terminal; both mean somebody decided this person should not
  have the chart.
- A user id resolves **exactly or not at all**, against
  `identity_map.base44_user_id`.
- The membership must be in the **assignment's** agency. A nurse working for
  two agencies has two memberships, and carrying one into the wrong agency
  hands them a chart nobody gave them.
- A role that does not open charts, or a revoked membership, is dropped.
- **An assignment already in the store is left exactly as it is**, including a
  revoked one.
- **`assigned_nurses` is reconciled, never granted.** An address with no live
  assignment behind it is reported so an operator can see what the earlier
  in-Base44 migration did not carry — but it never becomes a row, because this
  tool cannot tell "never migrated" from "migrated and later revoked".
- A malformed export **fails the run** rather than carrying the rows that
  happened to parse. A v1 export is refused by contract version, so one
  written against the old source cannot be read under the new rules.

Every drop is named in a report the operator reads before anything is written,
and that report carries counts and reasons only — no address, no name, no
patient id, because a line of it will be pasted into a ticket. The plan is
digest-addressed, so what was reviewed is what applies; the command line plans
and cannot write.

The two halves are proved to meet against a real database rather than
separately: the backfill writes a row, and the narrowing then opens that chart
and no other.


## D25 — There is a general activity trail, and retiring the old tables did not remove the obligation

**Decision.** The record store gains an append-only
`pennsync_records.activity_audit`, written through a contract and readable only
by an agency administrator. The 28 capabilities that wrote `UserActivity`,
`SecurityLog` or `SystemLog` write here instead.

**Why this was nearly lost.** Those three entities are dispositioned `retire`
with retention `archive / 6 years` — which decided where the EXISTING rows go,
not whether the product keeps auditing. Reading the modules shows what that
elision would have cost: of the 19 capabilities touching `UserActivity`, **all
19 write and only one reads**. They are not consumers of an audit table, they
are producers of the audit trail. Retiring the table without naming a successor
drops 28 audit paths in a regulated product, and the loss is invisible until
somebody needs the record.

Neither store had a general sink. The authority store has purpose-specific
receipts (`mutation_receipt`, `patient_disclosure_audit`,
`visit_disclosure_audit`) and the record store has domain logs; none of them is
a place to record "this user did this thing".

**Shape, and why each part is the way it is.**

- **Append-only by absence.** The table carries an insert policy and a read
  policy and no update or delete policy at all. Forced RLS with no policy is a
  refusal, so nothing can rewrite or remove an audit row — not a caller, not a
  contract, not the record owner. An audit trail that can be edited is a log.
- **The actor is stamped, never supplied.** `actor_user_id` and `actor_email`
  come from the caller helpers. A capability cannot write an audit row
  attributing an action to somebody else, which is the one thing an audit
  trail must refuse.
- **Appending needs no privilege; reading needs administrator.** Every
  capability audits as it works, so any member may append. Reading the trail is
  an administrative act and the contract requires `agency_admin` — the same
  division D19 drew, where the policy decides whose rows these are and the
  contract decides who may ask.
- **Detail is bounded.** A free `jsonb` column would become the place people
  put a patient's record. It is capped, and the contract refuses an oversized
  payload rather than truncating it, because a silently truncated audit entry
  is worse than a refused write.
- **It reads in time order, and the timestamps can separate two entries from
  one request.** Both halves were wrong in the first draft and neither is
  cosmetic. The list paged on `id`, which is a random uuid, so an administrator
  would have been handed the trail in arbitrary order — correct as keyset
  pagination and useless as an audit trail, which exists to answer what
  happened in what order. And the stamp was `now()`, the *transaction*
  timestamp, so a handler auditing twice while serving one request wrote two
  rows that nothing could order against each other. It is `clock_timestamp()`
  now, and the page key is `(occurred_at, id)` descending, with the id kept as
  the tiebreaker because two entries can still share a microsecond and a cursor
  that cannot separate them either repeats a row or skips one. The cursor is
  opaque and the caller does not build it; an unparseable one is refused rather
  than read as "from the beginning", because silently answering page one to a
  request for page nine looks like duplicated activity to the person reading.

## D26 — A purpose policy is data, and it is extracted rather than retyped

`listAuthorizedPatients` and `getAuthorizedPatient` are the first ported
capabilities that read clinical rows, and the first where the authorization has
two independent halves.

The first half is which rows, and the record store already answers it: tenancy
from `caller_agencies()` and D24's chart narrowing on top, both inside the
policies on `pennsync_records.patient`. The second half is **which fields, and
who may ask for them at all**, and no policy can express it — it is a property
of the request's stated purpose, not of the row or the caller alone. A
clinician assigned to a chart may open it; that does not entitle them to pull
the whole agency's contact details under the `contact` purpose, or anybody's
date of birth under `identity_match`.

The originals carry that second half as a fenced block of declarations, and
`patientReadAuthorizationContract.test.js` already asserted the markers existed
— somebody had decided the block must not drift, without anything yet reading
it as data.

**The decision: generate the policy, hand-write the contract.**

D19 says a per-capability contract is hand-written, because a capability's
authorization is its own and there is nothing to generate from. That reason is
materially false for the projection here: sixteen field lists, sixteen role
sets and eight page bounds already exist, in the originals, as data. Typing
them into `jsonb_build_object` by hand is the transcription D12 settled
against, and the failure mode is silent — the user-guide parity test caught a
single dropped trailing space in a much shorter text, and a dropped field name
here would narrow or widen a clinical disclosure with nothing to notice.

So `tools-read-purpose-policy.mjs` evaluates the fenced blocks and writes
two artifacts: `services/pennsync-api/read-purpose-policy.mjs` for the
service, and `20260920050000_patient_purpose_policy.sql` for the database. The
SQL has no authorization in it at all — it answers what a policy says, never
who is asking. `20260920060000_contract_patient_read.sql` is hand-written as
usual and is the only thing that decides. A gate re-extracts and compares, so
neither artifact can drift from the source it came from.

Five things this settled that were not obvious going in:

- **The two capabilities have different purposes, and merging them would be a
  disclosure.** A list is asked for `contact` or `roster`; one chart is opened
  for `smart_note_context`, which carries the medication list and the clinical
  notes. Nothing in either original says the vocabularies are separate — they
  are separate because each module declares its own — so the port keeps two
  `_known` functions rather than one, and a purpose from one is
  `PENNSYNC_PATIENT_PURPOSE_INVALID` in the other.
- **`platform_owner` is dropped, and that is the one authorization
  divergence.** Every purpose in both originals admits it. D14 and D22 removed
  the platform tier, so `caller_tenant_role` cannot answer it and emitting the
  branch would read like a tier that still exists. The generator refuses to
  render if dropping it would leave a purpose admitting nobody, because that
  would be turning a capability off by accident rather than narrowing it.
- **Creator provenance is not a basis, and that is a real narrowing.** The
  original grants a non-agency-wide caller the union of their active care-team
  assignments *and* the patients they created. D24 carries only the first into
  RLS. The remedy is a backfill pass recording those grants, not a second
  predicate in this contract: a creator check here would have to be repeated in
  fifty-six reference policies to stay consistent, and D24 chose one place for
  it.
- **The continuation is an id, not a context echo.** The original's cursor
  carries agency, purpose, status, page size, membership and role and refuses
  when any changed. Here those arrive as arguments, so a changed one is simply
  a different query; what is re-checked is the row the cursor names, against
  the current filter and against what the caller may still see. A revoked
  assignment or a discharged patient ends the walk in a refusal rather than
  silently reporting an agency of three hundred as an agency of fifty.
- **A merged duplicate no longer makes an agency unreadable.** The original
  rejects the whole page when one row's status is `merged` or `archived`. Both
  refuse to disclose the row; failing the page as well is a worse answer to the
  same question, so the port skips it.

One thing this cost: `record-contracts.mjs`'s "every contract has a handler"
invariant was name equality, and `listAuthorizedPatients` is one Base44
capability with two modes that are two genuinely different queries — a keyset
page and a bounded batch of ids. Keeping name equality would have forced either
one contract doing both jobs or a handler named after neither capability. The
invariant now reads the handlers' own source for what they call, which is what
it was a proxy for.

## D27 — A document's tenancy is the binding, not the chart it happens to name

Porting the authorized visit read alongside the patient one went exactly as
D26's machinery intended: two more fenced policies extracted, one more
hand-written contract, four capabilities. The document pair did not, and the
reason was a defect in the record store rather than in the capability.

`pennsync_records.document` has no `agency_id`. D13 resolved its tenancy the
only way a generated path can — through a column the row itself holds — so
`document_read` reaches `patient` by `document.patient_id`. The consequence is
that **a document with no patient is invisible to everyone, an agency
administrator included.** That is not a narrowing anybody chose. It is what a
referral document looks like before an intake becomes a patient, and both
originals serve it: `DocumentTenantBinding` carries `agency_id` and a nullable
`patient_id`, and `binding_purpose` is `patient_document` or `referral`
precisely to tell those apart.

This was found by building the contract and testing it, not by reading the
schema: the binding is visible to an agency admin, the document row is not, and
the join answers nothing. Seven of eight cases passed. The one that failed was
the fixture row invented to cover "a binding with no patient", which is the
same case D24 deliberately preserved for patients and visits — *a referral
taken before a patient exists is not yet anybody's chart, so it stays
agency-scoped.* For documents the generator had no agency column to say that
with.

**The decision: `document` gets a tenant kind that asks the binding.** The
binding points at the document, not the other way round, so no path the
generator could follow expressed it — the same shape as D23's `roster` kind,
whose predicate asks the authority store instead of reading the row's own
column. `BINDING_TENANCY` in `tools-tenant-path.mjs` declares it, and
`applyBindingTenancy` re-checks every part of the claim against the schemas
before resolving it: the entity must be carried, must NOT have an `agency_id`
of its own (a claim on one would replace a direct key with a join), the source
must be carried and must resolve to its own `agency_id`, and the source must
actually carry the named column. A claim that does not hold throws rather than
falling back, because a silent fallback would restore the defect the moment the
claim stopped being true.

Declared, never inferred. "Some carried table references me and has an agency"
is true of dozens of tables, and inferring from it would let any of them
authorize the row — including one a caller can write.

What it changed, and what it did not:

- `document_read` and its three siblings now ask `document_tenant_binding`,
  carrying that table's own D24 narrowing in — including the null-patient
  branch, so an intake document is agency-scoped exactly as a referral is.
- The two tables that reference `Document` (`EmbedConfig`,
  `TermsAcceptanceAudit`) follow the new path automatically, because a
  reference predicate inlines its target's. Twelve policies changed in total.
- A document with **no** binding is now in no tenant and belongs to nobody.
  That is the same answer both originals give — every document they serve is
  joined to a binding — and it means a write must create the binding first.
  The isolation test says so.
- `RESOLVING_KINDS` gained `binding`, so a reference may resolve through one;
  the chart-coverage test had to learn the same hop, which is how it reported
  three tables as narrowed for no reason until it did.

With that decided, `listAuthorizedDocuments` and `getAuthorizedDocument` port
on the same machinery as the other four.

One thing the aborted attempt established that is worth keeping: **no document
purpose discloses a file locator, and the capability never needed one.** Not
`download`, which returns `file_name`, `file_size` and `file_type` and nothing
to fetch with. The original goes further and refuses a document whose
`file_url` is not null, which is how it enforces that the locator has already
been moved out of the row. So the document read is portable
*ahead of the file layer* rather than behind it — the opposite of what the
`files` blocker would suggest, and only visible by reading the projections.

## D28 — Creating a chart is not opening it, and closing that gap is a write to two stores

Starting the write half of the authorized-patient family turned up a defect in
D24 that six ported reads could not have shown, because it is only visible when
something inserts.

**A clinician could not create a patient at all.** `patient_insert` carried
D24's chart predicate along with the tenant one, and for `Patient` that
predicate asks whether the row's own id is in `caller_assigned_patients`. The
row being inserted *is* the chart, so its id cannot be in anybody's assignments
yet. Applied there the predicate narrows nothing; it refuses every role that
does not already open every chart in the agency. Measured exactly that way: an
`agency_admin` inserted and a `clinician` did not, while the Base44 original
admits `agency_admin`, `manager` and `clinician` to `PATIENT_CREATE_ROLES`.

**The fix is one policy and no more.** The chart root's INSERT drops the chart
predicate and keeps the tenant one. Everywhere else an insert names a chart
that already exists, and narrowing it is exactly right — a clinician may not
file a document, a visit or a note against a stranger's record, and the
isolation test proves all three still refuse. Exactly one policy changed.

### What `returning` showed, and the gap it names

The insert succeeds for every role. `insert … returning id` does not: it is a
read of the row the statement just wrote, so the *read* policy decides it, and
a clinician who just created a patient cannot read it back. PostgreSQL reports
that as `new row violates row-level security policy`, which reads like the
insert was rejected and was not — the same insert without `returning` succeeds
for the same caller. That message cost an hour and is worth writing down.

So the real gap is not the predicate. It is that **creating a chart and being
on its care team are two writes to two different stores**: the patient row
belongs to `pennsync_records`, owned by `pennsync_records_owner`, and the
care-team grant belongs to `pennsync_private.chart_assignment`, in a schema
that owner deliberately cannot touch. The Base44 original has no such boundary
— it records a `patient_creator` assignment as part of creating — and D24's
decision to make `chart_assignment` the only authority is what introduced it.

**The shape of the answer, for whoever writes it:** grant first, then insert.
The service holds both connections, and `chart_assignment` carries no patient
foreign key precisely because it spans stores, so an assignment naming a
patient that does not exist is inert — the narrowing is a filter, and it admits
no row. Granting first and failing on the insert therefore leaves nothing
harmful behind, while inserting first and failing on the grant leaves a chart
its creator cannot open. The two orders are not equally safe and the safe one
is available.

### The bridge, built

`20260920110000_claim_new_chart.sql` is that path, and it takes an agency and
nothing else. Three properties are the whole security argument:

- **The identity is minted here, never accepted from the caller.** A caller who
  could name the id would name a chart that already exists, and the grant would
  hand them somebody else's record. There is no parameter for one, which is why
  the first test reads the signature rather than the behaviour.
- **The seat is the caller's own.** Nothing takes a subject, so this cannot put
  another person on a care team.
- **Only the roles that may create a patient may claim a chart** — the
  original's `PATIENT_CREATE_ROLES`, and no wider. A social worker opens the
  charts they are assigned to and does not start one.

Minting also makes the collision check exact rather than probabilistic: the
function reads `pennsync_records.patient` to confirm the id is free, which it
can do because it is owned by the administrator that owns both schemas'
helpers, and it refuses after a bounded number of attempts rather than looping.
What the caller learns is only that a freshly minted id was free, which it
always is.

It lives in the RECORD migration directory although it creates objects in
`pennsync_private`, and that is dependency order rather than ownership: it asks
`pennsync_records.caller_tenant_role`, and every authority migration is applied
before any record one. It is the first migration there that is a bridge rather
than a record-store object, which is what a cross-store write looks like.

The test proves the loop the way a caller sees it, through
`pennsync_contract_patient_get` rather than a privilege no caller holds: claim,
insert the patient, and the creator opens the chart while a colleague who was
not granted it does not. It also proves the half that makes the ordering safe —
a grant with no patient behind it opens nothing.

What is still not built is the create capability itself. The bridge has no
caller yet, and wiring one before the contract exists would be surface with
nothing behind it.

### The create capability, and the correction the bridge needed

`20260920120000_contract_patient_create.sql` is the bridge's caller, and
writing it corrected the design one commit old.

**D28 reasoned about the safe ORDER for two writes that could not be atomic.
They can be.** The two ownership domains are two schemas in ONE database, not
two databases — so a contract owned by `pennsync_records_owner`, granted
`usage` on `pennsync_private` and `execute` on that one function, claims and
inserts inside a single transaction. Neither write survives the other failing
and a caller never observes a half-made chart. The grant-first analysis stands
as the failure analysis; atomicity is the design.

That also settled the bridge's shape. Its first version had a public wrapper
and an `authenticated` grant, on the reasoning that it was complete and usable.
With a contract as the only caller that wrapper was surface a client could
reach to leave grants behind and create nothing, so both are gone: the bridge
answers to the record owner alone. What `usage` on the private schema buys that
owner is measured rather than asserted — no table at all, and two trigger
functions that refuse to run outside a trigger.

**A blanket `revoke all on all functions in schema pennsync_private` would have
tidied those two away and taken the entire staging surface with them**, because
every `pennsync_staging_*` wrapper is an invoker calling an inner function
granted to `authenticated`. It was written, then removed before it reached a
commit. Nine suites would have said so.

The contract itself decides four things and the caller decides the rest:

- **The identity**, minted by the bridge and never taken from the payload.
- **Tenancy** — the agency the caller was checked against, and a payload naming
  one is refused rather than ignored, because a caller who names `agency_id`
  believes it took effect.
- **Provenance** — `created_by_user_id`, the normalized email and
  `patient_creation_key`, stamped from the caller helpers.
- **Lifecycle** — `active`, not sample, not archived.

The 43 fields a client may supply are extracted from the original's own
`CLIENT_PATIENT_FIELDS` rather than retyped, the same argument as the purpose
policies and a different shape: the declaration is not fenced, so extraction is
by NAME and a declaration that was renamed or removed fails the run. The
payload becomes a row through `jsonb_populate_record` rather than a column list
this contract would have to keep in step with the extracted one — unknown keys
cannot reach it, because the loop above refuses them.

Idempotency is the original's and is not a convenience: a retry of the same
`client_request_id` answers the same chart, the key carries the agency and the
user so nobody can collide with somebody else's, and the same id with different
names is a conflict rather than a match — answering the first chart would
silently discard the second request's data.

## D29 — A workflow action is a policy too, and porting a mutation is what shows what D24 costs

`updateAuthorizedPatient` is the first ported capability that CHANGES a
clinical row, and it turned out to need one new idea, to confirm one old one,
and to make two narrowings visible that nothing before it could have shown.

### An action is the same kind of declaration as a purpose

D26 settled that a read's purpose policy is data and is extracted rather than
retyped. A mutation declares the mirror image and the original fences it the
same way: `ACTION_FIELD_NAMES` and `ACTION_ROLE_NAMES`, six named workflow
actions over twenty-nine fields, each deciding both which columns it may touch
and which tenant roles may perform it. A caller never sends a patch — it names
an action — which is the whole reason the capability can be ported at all,
because an arbitrary patch would have no reviewable authorization.

So the same tool carries it, and `tools-read-purpose-policy.mjs` now emits
`patient_action_known`, `_admits`, `_writes` and `_rank` beside the purpose
functions. Three checks the read policies did not need:

- **The field sets must be DISJOINT.** The original merges a batch of actions
  into one write and throws at runtime if two of them assign the same field.
  That property was asserted and never proved; the generator proves it now and
  refuses to render without it. It is what lets the contract do one `UPDATE`
  whose result does not depend on the order the caller sent the actions in.
- **No action field may be one the original protects.** `PROTECTED_PATIENT_FIELDS`
  is read as a check and deliberately NOT emitted: the contract accepts only
  the fields an action declares, so a protected one cannot reach it, and a
  policy function nothing can call is dead SQL. What the check catches is
  drift — an action that grew `agency_id` fails the run rather than shipping.
- **An action's field list must not carry `id`.** A read projection must
  (D26's rule, so a row can be followed up); a mutation names the row and
  never rewrites its identity.

The canonical order is emitted too, as `_rank`, because the original declares
`ACTION_CANONICAL_ORDER` and sorts a submitted batch into it. It is the one
piece of a policy that exists so an answer does not depend on arrival order.

### The set list is built from the keys that moved, not from a column list

The contract could have enumerated twenty-nine columns in its `UPDATE`. It
builds the assignment list from the keys the caller actually supplied instead,
each already proven by `patient_action_writes` against a closed list of
literals. That is not a convenience. A hand-kept column list has exactly one
failure mode and it is silent: a field added to an action in the original would
pass validation and then not be written, and the caller would be told it
changed. The dynamic list cannot have that bug, and a test writes every one of
the twenty-nine fields through the contract and reads the column back.

### Two narrowings, and neither is this contract's doing

**`office_staff` can perform no action on any chart.** The original admits that
role for `edit_demographics` and `edit_insurance`. The action gate here admits
it too — faithfully, because the gate answers the policy's question — and D24
answers a different one: `office_staff` opens no chart at all, so the read
finds nothing and the action never runs. The refusal a caller sees is
`PENNSYNC_PATIENT_NOT_VISIBLE` rather than a role refusal, which is the honest
one. Restoring the capability means deciding that `office_staff` opens charts.
That is a D24 decision and it is not a contract's to make.

The same boundary is why the original's creator-may-edit rule needs no
translation: D28 puts the creator on the care team at the moment of creation,
so the two agree for every chart made through the ported path. A chart carried
in from Base44 whose creator was never assigned is the case that narrows, and
`tools-pennsync-assignment-backfill.mjs` is what decides it.

### The collision check that cannot see the whole agency

`medical_record_number` is the one field where faithfulness and D24 genuinely
conflict. The original refuses a number that already belongs to another patient
in the agency, and it can ask that question because it holds a service role.
This contract is bound by the same policies as its caller, so it sees only the
charts they open — and **a collision check that cannot see every chart is not a
narrower check, it is a broken one**: it would let a duplicate through, which
is the one thing a port may not do.

So the field is admitted exactly where the check is honest: a caller for whom
`caller_opens_every_chart` is true gets the original's behaviour, and everybody
else gets `PENNSYNC_PATIENT_MRN_SCOPE`. A narrowing, recorded, with a real
consequence — a clinician cannot correct a medical record number.

**What would remove it is a uniqueness constraint on the column, and the entity
schemas are worth reading before adding one.** `Patient.medical_record_number`
declares nothing. Eleven other fields do — they say in their own descriptions
that they would be unique if the datastore allowed it, starting with
`Patient.patient_creation_key` ("Best-effort until Base44 exposes a datastore
uniqueness constraint"). We own the datastore now, and D30 carries those. MRN
is not among them, so giving it a constraint would be inventing a rule rather
than carrying one, and that is why this contract narrows instead.

## D30 — The keys the schemas said would be unique are unique now

Eleven entity schemas say, in the descriptions of their own fields, that a key
would be unique if the datastore allowed one. `Patient.patient_creation_key` is
"Best-effort until Base44 exposes a datastore uniqueness constraint"; the rest
say some version of "code must still detect duplicates because datastore
uniqueness is not assumed". Every one is a server-derived idempotency or
identity key, and every one carries a hand-written duplicate check in the
capability that writes it, because Base44 gave them nothing to lean on.

**We own the datastore.** So the claim is carried rather than re-argued, and it
is carried the way D27 carries a binding claim: enumerated in
`DECLARED_UNIQUE`, checked against the schemas on every generator run, and a
claim that does not hold throws rather than falling back. The half that matters
is the other direction — a field whose description makes this claim and is NOT
enumerated fails the run, because the next such key will be written by somebody
who has not read the list.

### Three kinds, and the difference is the schemas' own

Reading all eleven rather than the two that were obvious is what produced the
split:

- **`unique` (8)** — duplicates are a defect the writing code works around.
  `AgencyMembership.membership_key`, `DocumentTenantBinding.binding_key`,
  `Message.message_creation_key`, `Notification.dedupe_key`,
  `Patient.patient_creation_key`, `PatientCareTeamAssignment.assignment_key`,
  `Referral.referral_creation_key`, `ScheduledFax.schedule_key`. Six of the
  eight get a partial unique index on `(source_app_id, column)`; `Message` and
  `ScheduledFax` are not carried entities and have no table to index, which the
  enumeration records rather than forgets.
- **`unproved` (2)** — `ContentScopeBinding.binding_key` and
  `PhysicianAgencyProfile.profile_key` say uniqueness "must still be proved
  before migration". That is a statement about the EXISTING rows, not a hedge:
  an index would fail to build on import, and building it is not what proves
  the data. They get nothing, and the reason is in the enumeration rather than
  in somebody's memory.
- **`conditional` (1)** — `TelecomDestinationBinding.binding_key` is unique
  among ACTIVE rows only. Which column means active, and whether a superseded
  binding may repeat a key, is an authority decision about telecom routing. A
  generator cannot read that off a sentence, so it gets nothing and says so.

The indexes are partial (`where key is not null and key <> ''`) because an
absent key is not a duplicate of another absent key: these columns are null on
almost every row, and an empty string is how a caller sends "none" through a
text field. They are scoped by `source_app_id` like the primary key. The agency
is already inside every one of these keys, which is what makes a tenant column
unnecessary here.

### What it fixes immediately

`createAuthorizedPatient`'s idempotency was a lookup followed by an insert with
nothing underneath it — exactly what the original's own comment admits. Two
retries of one request could both miss the lookup and both insert, and the
product would hold two charts for one patient with neither caller told.

The contract now runs the claim and the insert inside one plpgsql block, which
is a savepoint, and catches `unique_violation` **for that index by name**,
re-raising anything else. The loser unwinds — its minted chart id and its
care-team grant go with it — re-reads the key and answers the chart the winner
made. `record-contract-postgres.test.mjs` proves it with two real connections
and a real lock wait rather than a sleep: one chart, one care-team seat, from
two concurrent requests carrying one key. It is the twelfth suite that needs a
real PostgreSQL, registered in `.github/workflows/pennsync-authority.yml` and
in AGENTS.md, because PGlite is one connection and cannot interleave two
callers.

One consequence to know before a data migration: these indexes mean an import
carrying duplicate keys will fail to load rather than quietly accepting them.
That is the correct outcome — it is the defect the schemas were describing —
but it is work to do at import time, and the two `unproved` entities are the
ones that said so first.

## D31 — A capability can be ported in part, and the part that is not says why

`updateAuthorizedVisit` is the browser's clinical write: it is what SmartNote
calls to save a note, what the EMR handoff advances through, and what records
that a clinician reviewed suggested documentation before copying it. It is also
the first capability that **cannot be ported whole**, and reading it carefully
is what produced the shape of the answer rather than a judgement call about
"enough".

Nine actions. Four are ported. The other five are not, and each one is
unported for a different, statable reason:

- **`set_ai_tags` has no performer left.** `requireActionPolicy` admits it to
  `user.role === 'admin'` whose address equals the configured
  `SUPER_ADMIN_EMAIL`, and to nobody else. D14 and D22 removed the platform
  tier. Dropping it does not narrow the action — it closes it. That is exactly
  the case the purpose generator already refuses to render silently
  (`POLICY_PURPOSE_ADMITS_NOBODY`), and the same rule applies here: who may set
  an AI tag on a visit is a decision to take, not a rendering detail.
- **`read_ai_processing_source`, `claim_ai_processing` and
  `publish_ai_processing` are server-to-server**, behind `INTERNAL_FN_SECRET`,
  and their one caller is `processCompletedVisit`, which is not ported. The
  record store has no concept of a service identity: every contract asks
  `caller_tenant_role` and every policy asks `caller_agencies`, and a
  background job is neither. That is a capability to design.
- **`legacy_recovery` answers 503 at source**, deliberately, until an
  owner-approved recovery protocol exists. Porting it would be re-enabling it,
  which is the same mistake D7 named for paused domains.

### The reasons are data, not comments

The obvious way to ship a partial port is to refuse the rest with one code and
explain it in a comment. That is worse than it looks, because the next person
to add an action upstream gets no signal at all — their action simply becomes
unreachable, and the comment still reads as if it were complete.

So the extraction carries the dispositions. `ACTION_INPUT_POLICIES` names which
actions this port **serves** and, for each one it does not, **why**, and the
generator refuses to run if a declared action is neither — or is both. What
reaches the database is `visit_action_known`, `visit_action_served` and
`visit_action_unported(action) → text`, so "no such action" and "that action is
not ported, and here is the reason" are different answers a caller can act on.
An action added to the original fails the build until somebody decides.

### A second action shape, and the differences are all real

This is not the patient mutation's policy with a flag on it, which is why it is
a separate list with a reader of its own:

- **The fields are INPUTS, not columns.** `advance_handoff` accepts
  `next_status` and writes `emr_handoff_status` and its history;
  `set_review_ack` accepts a hash and writes none of it. So the emitted
  function is `_accepts`, never `_writes`, and which columns move stays the
  contract's to decide from the action's own logic.
- **The sets may overlap.** Disjointness matters when a batch becomes one
  write. This capability takes one action per call, and `save_documentation`
  and `set_ai_tags` both accept `ai_tags`.
- **The roles are code in the original**, one rule per action group, so the
  contract states them. `requireActionPolicy` requires `tenant_role =
  'clinician'` — exactly that, not an agency administrator and not a manager —
  for the three clinical actions, while `reschedule` has no gate of its own and
  is left to D24. Inventing a data shape for three lines of code would be
  transcribing a decision rather than carrying one.

### `note_fnv1a`, and why a hash had to be ported exactly

`set_review_ack` stores `note_hash`, a 32-bit FNV-1a of the note text. The
browser **recomputes that same hash locally** to decide whether an
acknowledgement has gone stale — `isAcknowledgementStale` in
`src/components/smartNote/emrHandoff.js` compares the stored value against
`hashNoteText(currentText)`. So this is not an internal detail with freedom to
differ: a different answer for one emoji would make every subsequent note look
edited, and a clinician would be told their review no longer covers text they
never touched.

JavaScript's `charCodeAt` walks UTF-16 **code units**, so a character outside
the basic plane is two steps there. The SQL folds two steps for the same
character. The test imports `hashNoteText` from the frontend rather than
reimplementing it, because a copy would agree with itself; 250,000 characters
fold in about 100ms, and a note is usually a few thousand.

Two smaller things the port settled on the way:

- **A NUL in a note is refused by the type system, not by the contract.**
  `jsonb` rejects `\u0000` on input because PostgreSQL text cannot hold one.
  The original stored it, because Base44's datastore is JSON all the way down.
  Worth knowing before a data migration: a carried note containing one will not
  load.
- **The row is locked, and that replaces the compare-and-swap.** The original
  filters its UPDATE on all forty-six columns of the row it read, because
  Base44 gives it no transaction. `select … for update` takes the row lock and
  the UPDATE policy's authorization in one statement, so there is no window to
  defend and nothing to undo afterwards.

## D32 — The entities that say they are append-only now are

Reading `PatientNoteHistoryEntry` before porting it turned up a gap that had
been there since the record store was generated. Its schema description is
"Immutable, server-authored clinical-note revision", and the store gave it a
full set of four policies — read, insert, **update and delete** — because the
generator applies the same family to every carried table and never looked at
what the entity said about itself.

So the immutability of an immutable clinical log rested entirely on every
future contract remembering not to rewrite it. That is exactly the arrangement
D25 rejected for the activity trail, where the absence of an update policy is
the mechanism and the comment says "do not add one".

### Four tables, and the signal is not the `rls` block

The obvious place to look is each schema's `rls` block, and it is the wrong
one. Sixty-eight of the 156 carried entities declare
`{create, read, update, delete: false}` — including `Patient` and `Visit`,
which are plainly mutable. In Base44 that block means "no *client* may do this,
only a service-role function may", and in the record store every path is a
service-role path. It says nothing about whether the row can change.

The signal is the entity's own description, and reading all of them is what
separated the cases. Twelve mention immutability. **Four say it about the
ROW** — `ContentScopeBinding`, `DocumentTenantBinding`, `FleetServiceReview`
("Append-only … No application update or deletion path") and
`PatientNoteHistoryEntry` — and **eight say it about a FIELD inside a row that
is otherwise versioned**: `AgencyMembership` binds "an immutable Base44 User
id" and then transitions through pending, active, suspended and revoked;
`PatientCareTeamAssignment` is explicitly "versioned" and D24 depends on its
lifecycle. A regular expression cannot tell those apart, so all twelve are
enumerated in `DECLARED_IMMUTABLE` by kind, a `field` claim owes a reason, and
a thirteenth mention fails the run. Three of the twelve name entities that are
not carried; they are enumerated anyway, so the list keeps covering the schemas
as dispositions move.

### The mechanism is an absence, and its shape is worth being exact about

An append-only table gets a read policy and an insert policy and nothing else.
With no policy for a command, PostgreSQL has nothing to evaluate — so the
statement **succeeds and matches no rows** rather than raising. That is not a
weaker refusal: the row is equally unchangeable, and the caller is not told it
exists, which is the better of the two answers. The tests assert zero rows
rather than an error, because the first draft asserted an error and was wrong.

The half that matters is that it binds the **record owner**, since every
contract is SECURITY DEFINER owned by that role. `record-tenant-isolation.test.mjs`
proves the caller half on PGlite, where the migration's role wrapper is not
applied; `record-contract-postgres.test.mjs` proves the owner half on a real
PostgreSQL, where the role exists. The second draft of that assertion used the
migration administrator, which is a superuser and bypasses RLS however it is
declared — the same trap this file's own BYPASSRLS test exists to name.

589 policies now, down from 597: four tables × two commands.

One consequence to carry forward: a capability that needs to correct one of
these rows writes a new one. That is what append-only means, and it is what
`appendPatientNoteHistory` already does — every save creates a new
tenant-stamped event rather than editing the last.

## D33 — The one capability whose port re-enables it, and the conditions that bought that

**Decision.** Port `managePatientCareTeamAssignment` in full — the `inspect`
action and all four mutations — even though the four mutations are **paused at
source** in the Base44 original and refuse with a 503 before the handler reads
anything. Extend `pennsync_private.chart_assignment` with a `suspended` status
and a transition trail, and serve the capability from
`20260920180000_contract_assignment.sql`.

Re-enabling a paused capability is the one thing a port normally must not do, so
this is a decision rather than a step, and it is deliberately revertible as a
single commit: nothing else in the port depends on it and `claim_new_chart`
keeps working without it.

**Why it is allowed here.** The pause is not a product judgement. It names three
conditions, in its own words:

> HARD RELEASE GATE: Base44 currently exposes no documented atomic
> create-if-absent/unique constraint for assignment_key and no multi-entity
> transaction spanning membership, Agency, Patient, and assignment authority.
> Keep every assignment mutation unavailable until those hosted guarantees and
> the authenticated concurrency matrix are proved.

Those are Base44's limits. The owned store does not have them:

* **The create-if-absent constraint** is the table's own primary key,
  `(app_id, patient_id, membership_id)`, plus the partial unique index
  `chart_assignment_request_key` on `(app_id, last_request_key)` that makes a
  retry idempotent.
* **The transaction spanning four authorities** is an ordinary one, because
  membership, agency, chart and assignment are four tables in one database —
  the same fact D28 already leaned on when `contract_patient_create` claims a
  chart and inserts it atomically.
* **The authenticated concurrency matrix** is the third, and it is a thing to
  prove rather than assert. `record-contract-postgres.test.mjs` drives two real
  connections through it: two concurrent grants, two concurrent transitions,
  and a retry racing its own first attempt.

**What the matrix found.** Not a formality. The first draft passed every PGlite
test and then failed the two-connection grant race: `select … for update` locks
a row that exists and therefore serializes nothing when the row does not, so
both callers reached the insert and the loser was told `duplicate key value
violates unique constraint "chart_assignment_pkey"`. That leaks the storage to
the caller and reaches the HTTP boundary as an error it cannot classify. The
contract now catches `unique_violation` for those two constraints **by name**,
re-raises anything else, re-reads under the fresh snapshot, and answers
`PENNSYNC_ASSIGNMENT_EXISTS` — or, if the row carries the caller's own request
key, answers the grant that request already made. This is the same idiom
`contract_patient_create` uses for `patient_patient_creation_key_unique`, and it
was arrived at the same way: by racing it.

**Why it matters more than one capability.** This is what makes **D24 operable**.
Until now the only writers of `chart_assignment` were the operator backfill and
`claim_new_chart`, so a clinician could be put on a chart by creating it and
taken off it by nothing at all. Every other ported capability authorizes on
these rows through `caller_assigned_patients`. A care-team model with no way to
suspend a seat is not a care-team model; it is a growing list.

`suspended` rather than only `revoked` is the whole reason the status set grew.
`caller_assigned_patients` already filters `status = 'active'`, so a suspension
closes the chart with no helper change, while leaving the record that the person
was once on it. A revocation stays terminal: putting somebody back afterwards is
a new decision, not a transition. The lifecycle test asserts the closure through
`listAuthorizedPatients` — a capability already ported, called as the clinician —
rather than through the row it just wrote or through a helper no caller may
execute.

**A trap found on the way.** The coherence constraint requires `granted_at`, and
both pre-existing writers insert an active row without naming it. With the
column merely nullable the constraint refused every grant they made — the shared
test fixtures failed on their first insert. `granted_at` carries a default, and
the backfill of existing rows runs before the default is attached so an
assignment that already existed keeps the moment it was actually made.

**The narrowings.** Four, each recorded in the migration header. The protected
platform owner is neither admitted nor protected as a target, because D14 and
D22 removed the tier. The agency is the one the caller is acting in rather than
a request field. The target is named by Base44 user id and resolved through
`identity_map`. And the answer carries the assignment and the roster identity
rather than the original's membership and patient snapshots — the caller is an
agency manager who can ask the roster for the rest.

`boundedReason` is ported rather than approximated, and proved against the
original's own function across twenty-four inputs. Three things a plain
`btrim(x) <> '' and length(x) <= 500` gets wrong: JavaScript's trim strips the
Unicode space separators, `String.prototype.length` counts UTF-16 code units so
astral characters count twice, and the control-character class is tested only
after trimming — because the trim removes the vertical tab and form feed the
class would otherwise reject.

Port queue: `records_schema` 62 → 61, written 25 → 26.

## D34 — The bucket called `records_schema` contained capabilities the record store was never going to serve

**Decision.** Port `listMyTenantMemberships` and `getMyTenantContext` as a
contract over `pennsync_private.membership` — the authority store's own model —
rather than over anything in `pennsync_records`. Serve them from
`20260920190000_contract_tenant_context.sql`, and take the acting agency from
the request envelope rather than from a parameter of their own.

**What this found.** Both originals read exactly two entities, `AgencyMembership`
and `Agency`, and the port queue counted them `records_schema` because the
classifier records "touches an entity". D20 and D21 already split that bucket by
what each module READS; this is the first case where the right question was
*which store owns the thing being read*. The authority store has carried a
native membership model since the first migration — `pennsync_private.membership`
with a generated `membership_key`, a tenant-role check, a status check and a
revocation-coherence check. Nothing in `pennsync_records` was ever going to be
the answer for these two.

That is a category, not a one-off. `records_schema` still means "waits on the
record store" for 59 capabilities; it meant something else for these two, and
the way to tell them apart is to read which entities the module touches against
which store models them, not to look at the bucket.

**Most of both originals is machinery for not having a transaction.** Each loads
the caller's memberships, does its work, loads them again, compares the two
snapshots with `JSON.stringify`, and refuses with "Tenant membership changed
during request" if they differ — then does the same for the agency, then
re-reads the caller and compares that too. Three double-reads and three
comparison helpers across two files. One statement in one transaction has no
interval to be torn, so all of it goes. This is the same fact D33 leaned on when
it re-enabled a capability whose pause named "no multi-entity transaction", and
the same fact D28 used to claim a chart and insert it atomically. It keeps
paying.

`validateMemberships` — the forty-line per-read integrity check — goes for a
different reason. Every property it re-derives is a CHECK constraint or a
generated column here. A Base44 entity is re-validated on every read because any
service-role writer could have corrupted it; a table with the constraint cannot
hold the bad row at all. The test asserts the constraints themselves, including
that `membership_key` is stored-generated from `agency_id` and `base44_user_id`,
so deleting one fails the suite rather than quietly re-opening the gap.

**What reading the names would have got wrong.** The authority store already
exposes `pennsync_staging_memberships(app_id)` and
`pennsync_staging_context(app_id, agency_id)`, both granted to `authenticated`,
and `resolveAuthority` already calls the second on EVERY request the business
API serves — so `actor` carries the membership id, version, tenant role and
agency before any handler runs. On the names alone this contract is redundant.
Reading the bodies shows the difference that matters: the staging pair projects
`pennsync_private.agency.name`, a column constrained `like 'Synthetic %'`
because that table holds this deployment's own synthetic tenants, and it labels
its own answer `staging: true, synthetic: true`. The real name is `agency_name`
on the carried row, which is what both originals project. The staging pair also
carries no optimistic binding and bounds at 50 where the originals bound at 25.

**Where they live, and the narrowing that comes with it.** These are PRE-TENANT
capabilities in Base44: `listMyTenantMemberships` takes an empty body and
`getMyTenantContext` an optional `agency_id`, because a Base44 caller has no
envelope. The business API's one invariant is that every request names the
agency it acts in and `resolveAuthority` proves the caller holds it. So the
bootstrap — a caller who holds no agency yet asking which they hold — stays on
the authority store's own RPC, and these two serve a caller already inside one
agency who wants the full context for it, or the list to switch from. The
narrowing is explicit: reaching them through the business API requires already
holding one agency. The alternative was an envelope exemption, and weakening the
service's one invariant to serve two capabilities that another store already
bootstraps is the worse trade.

`getMyTenantContext` therefore takes no `agency_id` parameter. The contract keeps
its auto-select branch for a caller holding exactly one agency because that is
the correct answer in SQL, but nothing in this service reaches it.

**The narrowings.** No platform owner, and no `is_platform_owner` field at all —
a field that is always false invites a client to test it. The agency must be
enabled in the authority store AND carried and enabled in the record store,
where the originals could only see the second. The optimistic binding is
all-or-nothing rather than half-ignored. And the whole list is refused when one
agency is unavailable, as the originals refuse it: omitting that row instead
would let the caller carry on in their other agencies, which is more than the
originals allow, not less.

Port queue: `records_schema` 61 → 59, written 26 → 28.

## D35 — The membership lifecycle, and the second capability an action outlived its performer

**Decision.** Port `manageAgencyMembership` as a PARTIAL port serving five of
its six actions — `inspect`, `activate`, `suspend`, `revoke` and `change_role`.
Extend `pennsync_private.membership` with `pending` and `suspended`, a
transition trail and the coherence the original re-derives per read. Refuse
`provision` by name.

**`provision` has no performer left.** Its guard is not a difficulty, it is a
tier:

> `if (input.action === 'provision') { throw new PublicError(403, 'Only the
> protected platform owner may provision memberships'); }`

reached for every caller who is not the protected platform owner. D14 and D22
removed that tier, so nobody can perform it. This is D31's `set_ai_tags`
exactly: an action a port cannot serve because the only role that could ever
perform it no longer exists. The same rule takes a slice out of the five that
ARE served — the original reserves an `agency_admin` target, or a request for
that role, to the platform owner too, so an agency administrator manages their
subordinates and can neither make nor unmake another administrator. **Dropping
the platform tier without keeping that rule would have widened the capability
rather than narrowing it**, which is why there is a test for it rather than a
comment.

In this deployment a membership is created by `tools-pennsync-enroll.mjs` or by
an operator. That is an operator path, not a caller-facing capability, and
saying so is the honest answer rather than inventing a performer.

**Two statuses, and why adding them closes rather than opens.** Twenty-seven
places in this store's SQL read a membership and every one filters
`status = 'active'`. A status that is not `active` is therefore admitted by
none of them — `caller_agencies`, `caller_tenant_role`, `caller_roster_ids`,
the staging context and D34's selector all close. This is the same property
that made D33's `suspended` safe on `chart_assignment`, and it is a property of
the READERS: it is worth re-checking rather than inheriting if one ever stops
filtering. The test asserts the closure through D34's selector, the way a
caller would notice it, rather than through the row.

`activated_at` carries a default, which is D33's lesson applied before it bit
rather than after. Every existing writer inserts an ACTIVE row and names none
of the new columns; on `chart_assignment` the equivalent column was merely
nullable and the coherence check then refused every grant those writers made.

**A defect the test found, and the substitution it forced.** The original's
`targetCanReceiveMembership` reads the carried `User.is_active`. Reading that
row here means reading it under `user_read`, whose predicate is
`id in caller_roster_ids()` — and that helper admits only ACTIVE memberships.
So a SUSPENDED colleague's profile is invisible, the check failed closed, and
**no suspended member could ever be reactivated**. The check fired exactly when
it must not.

The fix is a substitution rather than a workaround, and the store had the right
column already: `identity_map.enabled`, with `revoked_at` and a coherence check
beside it. It is visible to the definer regardless of any policy, and it is
authoritative where a carried `is_active` is a self-editable label D23 says must
never authorize. Its own trigger makes revocation **one-way** — any update
setting `enabled` back to true or clearing `revoked_at` is refused — which is
the strongest argument for the substitution and is what the test asserts. This
is the move `20260920160000_contract_alert.sql` made when it replaced
`patientBelongsToCaller` with the policies.

**One narrowing that is the helper's doing rather than a choice.** A SUSPENDED
agency refuses every action here, where the original refuses only the enabling
ones: `caller_tenant_role` admits a membership only while its agency is
`active` or `trial`, so the caller has no standing at all and is refused before
the agency is looked at. Harmless — a suspended agency already denies every
capability through `caller_agencies()`, so there is no access left to withdraw.
The `AGENCY_UNAVAILABLE` check is kept as the second line rather than deleted,
because it is what would refuse an enabling transition if that helper ever
stopped gating on agency status.

The reconcile-after-write in the original — write, read back, compare field by
field, "Provisioned membership could not be reconciled" — is the same
no-transaction machinery D34 described, and goes for the same reason.

Port queue: `records_schema` 59 → 58, written 28 → 29.

## D36 — Tenancy is not ownership, and a comment is not a permission

**Decision.** Port `policyAcknowledgment`'s `acknowledge` action and refuse
`list` by name — the third partial port. Record no caller-supplied audit
fields.

**`list` has no performer left**, for the reason D31 already named. Its gate is
`isAdminLike(user)`, which is `u.role === 'admin'`: the Base44 built-in admin,
the platform tier D14 and D22 removed. Dropping the gate would not narrow the
action, it would open it.

**A comment is not a permission, and this one is a trap.** The original says in
its own header that the list exists "so account_type-based admins
(agency_admin/super_admin) are honored", and the body then scopes a
non-`super_admin` caller to `user.agency_name`. But `isAdminLike` admits
neither: every caller without `role === 'admin'` is refused before that code is
reached, so the agency-scoping branch is unreachable. Porting the intent would
hand an agency administrator a capability the code never gave them — a widening
dressed as a bug fix. Whether they should have it is a product decision, not a
port's to take. The comment is quoted in the migration header so the next reader
meets the argument rather than the temptation.

**Tenancy is not ownership.** This is the property the port turns on, and the
original states it plainly: the entity's write RLS is admin-only *precisely* so
a learner cannot sign somebody else's row, and the function does the ownership
check itself because its write goes through a service role that bypasses RLS.
In the owned store the write goes through a contract that the policies DO bind
— and the policies say the row is in an agency the caller holds, which is not
the same as saying the row is theirs. Two acknowledgments in one agency are
both visible to both colleagues. The contract's own check is what keeps one
from signing the other's, and the test proves it by having a colleague try.

The ownership comparison reads `caller_email()` — `identity_map.expected_email`
— rather than the Base44 profile's `email`, which is D23's rule again.
`policy_acknowledgment.user_id` holds an EMAIL rather than an id; that is the
carried column's actual content, and the original's own comparison is
`sameEmail(ack.user_id, user.email)`.

**No `ip_address`, and no `device_metadata`.** The original reads
`x-forwarded-for` and `user-agent` from the request. A contract cannot see a
request, and taking them as parameters would let the person signing choose what
the audit trail says about them. For a compliance record a forgeable field is
worse than an absent one, so they are not taken at all and the columns stay
null. A test asserts the contract contains no statement that writes either, and
another asserts the answer carries no `doc_url` — the file locator that is why
D16 keeps this entity's family out of the generic brokers.

Signing twice is idempotent and deliberately does not move the original stamp:
an acknowledgment records *when* somebody signed. The signature is bounded at
200 characters with control characters refused, where the original bounds it
nowhere — narrower, which is the only direction available.

Port queue: `records_schema` 58 → 57, written 29 → 30.

## D37 — The first port that audits, and what one transaction replaces

**Decision.** Port `acceptAiContentAgreement` and `getAiContentAgreementStatus`
onto `20260920220000_contract_ai_agreement.sql`, and have the accept contract
write D25's activity trail **in SQL, in the same transaction as the
attestation** rather than through `audit.mjs`.

**This is the first port that audits anything.** D25 built the activity trail
because `UserActivity`, `SecurityLog` and `SystemLog` are dispositioned
`retire` — a decision about where their existing rows GO, never that the
product stops auditing. Thirty ported capabilities later, none had audited
anything, so the trail had a test suite and no caller. It has one now.

**Why the contract writes it, and not the handler.** `audit.mjs` is handed to
every handler as `audit`, and it stays the right way for a handler to record
something it did. It is the wrong way here for a reason that is structural
rather than stylistic: the attestation carries `audit_event_id`, so the audit
entry must exist and be identified *before* the row that references it, and two
HTTP round trips cannot be one transaction. The contract calls
`contract_activity_append` directly, which it may because both are SECURITY
DEFINER owned by `pennsync_records_owner`.

That is the whole difference from the original, and it is worth spelling out
what it removes. `acceptAiContentAgreement` writes the `UserActivity` row,
reads it back and compares eleven fields, rechecks the actor, writes the
attestation, reads THAT back and compares eight more, and rechecks the actor
twice again — four identity rechecks and two full readbacks. Every one of them
defends the same gap: a crash between the two writes leaves gate authority with
no audit trail behind it, or an audit entry for an acceptance that never took
effect. In one transaction neither half can exist without the other. The
readbacks are not skipped; they are unnecessary.

**`blockedActor` is not ported, because it is already the floor.** The original
refuses a caller whose `User` row is `is_active: false`, `disabled: true`,
`is_service: true` or `is_verified: false`. All four are carried, self-editable
labels D23 says must never authorize — and none needs porting:
`pennsync_private.actor` admits an identity only while
`i.enabled and i.revoked_at is null`, so a revoked person has no caller identity
at all and every `caller_*` helper answers null. A test revokes an identity and
watches both contracts refuse, and a second asserts the contract's text contains
none of those four field names.

**Tenancy IS ownership here, and that is the contrast with D36.**
`ai_content_agreement_attestation`'s read policy is
`user_id = caller_user_id()`, so the contract adds no ownership check —
restating it would be a second answer to keep in agreement with the first. One
capability earlier, `policy_acknowledgment` is agency-tenanted and the contract
must check ownership itself. The difference is the policy, and reading it is how
you tell.

**The words are the original's words.** `AGREEMENT_VERSION` and the three
`AGREEMENT_ACKNOWLEDGMENTS` sentences are constants in the original module and
SQL literals here, because a migration cannot import one. The test imports them
from the original and compares byte for byte — the D12 discipline, and here it
guards the one defect that would actually matter: attesting to different
sentences than the person read.

Accepting twice answers the first acceptance and writes nothing — no second
attestation and no second audit entry, because accepting twice is not an event
and recording one would be a false trail. A stale version is refused distinctly
from a malformed request, as the original refuses it, because somebody who
accepted an older agreement has to go and read the current one.

Port queue: `records_schema` 57 → 55, written 30 → 32.

## D38 — Four capabilities, one question, four wrong answers

**Decision.** Port the whole time-off domain — `submitTimeOffRequest`,
`cancelTimeOffRequest`, `reviewTimeOffRequest` and `getApprovedTimeOff` — as one
contract family in `20260920230000_contract_time_off.sql`.

**They are one change because they are one bug.** Each of the four asks the same
question — *is this caller entitled to act on this agency's leave?* — and each
answers it by reading the carried `User` row:

* `submitTimeOffRequest` checks `user.is_approved`, then an approver's
  `is_manager` and `account_type`, then compares `agency_name` strings.
* `cancelTimeOffRequest` builds an `isAdminLike` from `role` and
  `account_type`, then re-reads the employee's `agency_name`.
* `reviewTimeOffRequest` does the same and adds `manager_email === user.email`.
* `getApprovedTimeOff` collects every `User` whose `agency_name` matches the
  caller's and filters the requests by those addresses.

All five fields are self-editable labels D23 says decide nothing. Porting them
one at a time would have meant writing the substitution four times and getting
to compare them four times; writing them together makes the shared answer
obvious, and the test proves it rather than asserting it — a clinician whose
carried row claims `is_approved`, `is_manager`, `account_type: agency_admin`,
`agency_name: Agency B` and `role: admin` still has no standing in agency B,
because membership is what answers.

**What disappears rather than moving.** `getApprovedTimeOff`'s whole
address-collection step is gone: the table's policy is
`agency_id in caller_agencies()`, so the rows a caller can see are already the
agency's. Reimplementing the filter would have been a second answer to keep in
agreement with the first. Likewise the cancel and review capabilities' "re-read
the employee and compare `agency_name`" steps — the row is in the caller's
agency or it is not there.

**Two things the originals compute that this had to reproduce exactly.**
`totalRequestedDays` counts business days Monday to Friday, subtracts half a
day for a half-day request and never goes below half a day; a count that
disagreed would put a different number of days on somebody's leave balance, so
the test compares the SQL against the original's own function over a table of
ranges including weekend-only spans and a leap day. And the original rejects
`2026-02-31` explicitly because JavaScript rolls it forward to March;
PostgreSQL refuses it outright, so the contract parses the date rather than
taking a `date` parameter — turning a raw cast error from PostgREST into the
same named refusal the original gives.

**A defect the tests caught.** The first draft declared the resolved approver as
a plpgsql `record`. With no approver named — the common path, since the field is
optional — the record is never assigned and reading a field of it raises
`record "v_manager" is not assigned yet`. Six of the eight tests failed on it;
the two that passed were the two that always name an approver.

**The narrowings.** No platform tier, so an `agency_admin` is the widest
reviewer. An approver must be an `agency_admin` or `manager` of the same agency,
proved through membership. A `manager` reviews only the request that NAMED them,
because the original's second reviewer is an address match on the request rather
than a role. Nobody reviews their own leave whatever their role — and the test
makes the administrator try. `reason` and `coverage` are truncated at 2000 as
the original truncates them, because their content is the employee's own words.

**And one thing found on the way.** `employee_name`, `manager_name` and
`reviewer_name` are addresses here. All three originals write
`user.full_name || user.email`, and the carried `User` table **has no
`full_name` column at all** — `contract_roster` projects no name either, for
the same reason. So the fallback is the only branch that can ever run. Recorded
rather than silently collapsed, because a reader comparing the two would
otherwise go looking for where the name went.

**Outbound delivery is not ported.** Three of the four send an approver or
employee email behind `OUTBOUND_DELIVERY_RELEASE=enabled-v1`. That gate does not
refuse the request — it skips the send and reports `delivery_paused`. The
handlers report `delivery_paused: true` exactly as the originals do when the
gate is closed, because outbound delivery belongs to the integration runtime,
which is deployed and paused.

Port queue: `records_schema` 55 → 51, written 32 → 36.

## D39 — A whole capability with no performer, and the question that raises

**Decision.** Port `submitPersonnelCredential`. Do **not** port
`reviewPersonnelCredential`, and do not add an approve path to
`20260920240000_contract_credential.sql` until somebody decides who may approve
a credential.

**This is the first time the platform tier takes a whole endpoint.** Three
earlier ports lost ONE ACTION of a capability whose others survived — D31's
`set_ai_tags`, D35's `provision`, D36's `list`. `reviewPersonnelCredential`
does nothing else. Its entire gate is:

> `if (!isAdminLike(user)) return 403;` — where `isAdminLike = u.role === 'admin'`

the Base44 built-in admin, removed by D14 and D22. Approving and rejecting is
all the endpoint does, so there is no half of it left to port.

**The open question, stated so it can be answered.** A credential filed through
the ported contract stays `pending_approval` for ever. An `agency_admin` is the
obvious candidate for the missing reviewer, and giving them the power would be
a **widening** — the code never granted it to anyone but the platform admin,
and every earlier decision here refused exactly that move. So the question goes
in this document rather than into the SQL:

> **Who approves a staff credential once there is no platform tier?** The
> candidates are an `agency_admin` of the employee's agency (consistent with
> how every other review in the product now works, and a widening of the
> original), or a new operator path outside the caller-facing API (consistent
> with how `provision` was handled in D35).

Until that is answered, `reviewPersonnelCredential` stays in the port queue.
That is the accurate state: it is not waiting on a schema, it is waiting on a
decision, and the queue showing it as unwritten is the reminder.

The contract's test asserts the ABSENCE rather than leaving it to be noticed:
it fails if the migration ever sets `status` to `'approved'` or writes
`approved_by`/`approved_at` to anything but null, so adding an approve path
without this decision breaks a test instead of slipping through review.

**What the ported half does.** The writable set is the original's
`SELF_SERVICE_FIELDS`, and an unknown key is **refused rather than filtered**.
The original filters silently, so a caller who misspells `expiration_date`
files a credential with no expiry and is never told — and the same silent
filter is what keeps `status` and `approved_by` out of a caller's reach, which
is worth making explicit rather than implicit. Editing a credential returns it
to `pending_approval` and clears the previous decision, because an edited
credential is not the one that was approved. A renewal stamps the old
credential's notes and leaves its status alone, so it stays valid until a
reviewer supersedes it — and a renewal naming somebody else's credential stamps
nothing.

`uploaded_file_url` is carried with the original's own check — HTTPS, no user
information in the authority — and it is stored but not projected back. Nothing
in the port fetches a locator, which is the position the document pair already
took, so this is not the file-layer dependency that blocks an upload capability.

Port queue: `records_schema` 51 → 50, written 36 → 37.

## D40 — The built-in admin's successor is an agency administrator

**Decision (the owner's, not the port's).** Where a capability's only gate is
Base44's built-in `role === 'admin'` — the platform tier D14 and D22 removed —
the successor is an **`agency_admin`, scoped to their own agency**.

**This is the first deliberate WIDENING in the whole migration, and it is
recorded as one.** Every earlier decision refused exactly this move: D31 left
`set_ai_tags` unported, D35 left `provision`, D36 left `list`, and D39 left
`reviewPersonnelCredential` — each time because dropping a platform gate does
not narrow an action, it opens it, and who may perform it is a product decision
rather than a rendering detail. That reasoning still holds. What changed is that
the decision has now been taken, by the person entitled to take it, and the
rule the port follows is no longer "refuse" but "grant to the agency's own
administrator, over the agency's own rows, and nothing wider."

**What it unblocks.** Five capabilities in the port queue are refused outright
without it: `reviewPersonnelCredential`, `auditDataQuality`,
`monitorClinicalDataForCarePlanUpdates`, `resendInvitation` and
`resendInvitationV2` — a tenth of what remained.

**The scope is the narrowest reading.** `agency_admin` and no other role;
`super_admin` and the cross-agency branches stay closed with the tier; and the
agency half is the table's own policy rather than a predicate in the contract,
so a capability cannot widen past its rows by accident.

**A widening creates risks a narrowing never does, and the first one is already
here.** `reviewPersonnelCredential`'s own header says the approval lives in a
function precisely so that staff cannot approve their own credential. Under
Base44 the reviewer was a platform admin, who holds no credentials in any
agency, so self-approval was impossible *by construction*. An `agency_admin` is
a member of staff with credentials of their own, so it is possible for the first
time — and `20260920250000_contract_credential_review.sql` refuses it
explicitly, the way `contract_time_off_review` refuses self-review. **That check
is not redundant with the role gate; the role gate is what makes it necessary.**

The general form, for the four that follow: when this decision hands a
capability to an `agency_admin`, re-read what the platform tier was
*structurally* preventing, not just what it was permitting. Anything that was
safe only because the reviewer stood outside every agency has to be made safe
again explicitly.

Port queue: `records_schema` 50 → 49, written 37 → 38 with the first of the
five.

## D41 — A derived scope leaks; a policy cannot

**Decision.** Port `auditDataQuality` under D40's gate, and delete its entire
agency-scoping block rather than reimplementing it.

**What the original does.** It fetches every active patient, every user, every
completed visit and every credential in the deployment, then rebuilds "which of
these are mine" in JavaScript: filter users by
`u.agency_name === user.agency_name`, collect their addresses into
`agencyEmails`, keep a patient whose `created_by` is one of those OR whose
`assigned_nurses` array contains one, keep a visit whose `patient_id` survived
that, keep a credential matched by `agency_name` or `employee_email`.

Every input to that is a representation this migration has already thrown out.
`agency_name` is the self-editable label D23 refuses; `assigned_nurses` is the
stale-address care team D21 and D24 replaced; `created_by` is an address on a
row rather than an authority.

**The original's own comment is the argument.** It records that the filter had
to be rewritten once already, because the first version kept `super_admin`
accounts and so "surfaced platform-staff profiles in every agency's
user_issues", and seeded `agencyEmails` such that "any patient created by a
super_admin (central intake / bulk import) counted as in-agency for EVERY
tenant and their name + gaps leaked cross-agency."

That is the characteristic failure of a derived scope: it is a second answer to
a question the store already answers, and the two drift. The test seeds exactly
that shape — agency B's patient, created by agency A's administrator, carrying
agency A's clinician in `assigned_nurses` — and asserts agency A's audit does
not see it. Under the original's filter it would have.

Here all four tables are agency-tenanted by their own policies, so the rows a
caller can see ARE the agency's and the block has nothing left to do. The
audited population of PEOPLE is the roster rather than every `User` row whose
`agency_name` string matches, which also supplies the verified address the
carried table has no column for.

**Two computations kept exactly.** `nurse_notes` counts as missing below a
hundred characters rather than when empty. And an empty object or array counts
as missing, which the original had to say out loud because `vital_signs: {}` is
TRUTHY in JavaScript and a bare `!v` inflated the score. The percentages keep
the original's zero-guard, added because a tenant with no completed visits
emitted the string `NaN` into the dashboard.

Port queue: `records_schema` 49 → 48, written 38 → 39. Three of D40's five
remain: `monitorClinicalDataForCarePlanUpdates`, `resendInvitation` and
`resendInvitationV2`.

## D42 — Two capabilities that are one file, and a send with nothing behind it

**Decision.** Port `resendInvitation` and `resendInvitationV2` as **one**
contract under D40's gate, keeping both handler names. Do not port the
invitation email.

**They are the same file.** Byte-identical apart from a trailing line in the
second:

> `// Production replacement endpoint: resendInvitationV2 (registered 2026-09-09)`

Porting them separately would put two identical endpoints in the new service
and give a future reader two places to keep in agreement. Both names stay, so a
migrating caller of either gets the behaviour it had, and both reach one
contract. That is the inverse of `listAuthorizedPatients`, which is one
capability reaching two contracts because its two modes are genuinely two
queries. The test READS both files and fails if they ever diverge, rather than
asserting they are the same — at which point the port has to decide which one
it serves.

**The send is not a paused delivery; it is a service that does not exist.** The
original calls `base44.users.inviteUser(...)` — the Base44 platform's own
invitation service, which mints the account and delivers the link. Everywhere
else in this port an unported send is an email the integration runtime would
have carried (`OUTBOUND_DELIVERY_RELEASE`); here it is a platform capability
with no successor at all. So the contract does the record half — mark the
invitation pending, extend it seven days, stamp the moment, increment the count
— the handler reports `delivery_paused`, and **the audit entry itself carries
`delivery_paused: true`** so the trail does not read as though a message went
out. Until an owned invitation path exists, a resend records the intent and the
invitee receives nothing.

**The agency check is the policy's, and the fixture proves why that matters.**
The original resolves the invitation's agency from its own `agency_name` string
and, failing that, by looking up the INVITER's `User` row and reading THEIR
`agency_name` — two self-editable labels, and a second answer to a question the
policy already answers (D41). The test's fixture sets `agency_name` to
`'Agency A'` on **every** invitation including agency B's, precisely so that a
port which read that column would get it wrong; the contract refuses agency B's
row as not found.

The audit entry goes to D25's trail in the same transaction (D37). The original
writes a `UserActivity` row inside a `try/catch` and logs the failure, so a
resend could happen with nothing recording it.

Port queue: `records_schema` 48 → 46, written 39 → 41. One of D40's five
remains: `monitorClinicalDataForCarePlanUpdates`.

## D43 — The third and fourth originals whose own comments document a derived-scope bug

**Decision.** Port `saveVisitPointConfig` and `savePayrollProfile` as one
contract file under D40, and delete both of their scope reconstructions.

**They share a shape and a scar.** Each is a single-row-per-scope upsert whose
scope the original rebuilds in JavaScript, and each records in its own comments
what that cost:

* `saveVisitPointConfig` reads its agency from `user.agency_name`, lists up to
  fifty rows matching that string, and when none match scans the fifty newest
  for an UNSCOPED legacy row. Its comment: *"The removed `length <= 1` arm also
  adopted a lone TENANT-scoped row, so a platform admin (no agency) saving
  config silently overwrote that agency's point math."*
* `savePayrollProfile` looks the target employee up by address in `User`, reads
  THEIR `agency_name`, compares it to the caller's, filters up to five thousand
  profiles by address, and then — after creating one — re-reads the table to
  collapse duplicates it may just have made.

Both tables are agency-tenanted here, so "the caller's row" is what the policy
returns. The legacy scan, the duplicate collapse and the `agency_name`
comparison all have nothing left to do. That is now the third and fourth time
an original's own comments have documented a bug a derived scope caused and a
policy cannot — after D41's audit and D42's invitation lookup. It is the most
common defect this migration finds, and the fix is always the same: delete the
reconstruction, do not port it.

The test seeds the exact shape the point-config comment describes — another
agency's row with no `agency_name`, which is what that scan looked for — and
checks it is untouched.

**Two computations kept as the originals compute them**, because they are
business rules rather than validation: `toNonNegativeNumber` turns anything
that is not a finite non-negative number into **zero** rather than refusing, so
a save stays a save; and a hospice profile earns no points while `earns_points`
must be an explicit `true` to count. The one guard kept verbatim is the
point-config empty-body refusal, which exists because *"an accidental
invocation with no body would overwrite the facility's point config with all
zeros."*

The payroll employee is proved a colleague through `agency_colleague` —
membership — rather than by comparing the target's self-editable `agency_name`
to the caller's. A string on a profile deciding who may be paid what is exactly
what D23 refuses.

Port queue: `records_schema` 46 → 44, written 41 → 43.

## D44 — The first port where D40's widening puts the reporter and the reviewer in one person

**Decision.** Port `submitIncidentReport` and `updateIncident`'s three actions
as one contract file, and add the self-review refusal that D40 makes necessary.

**The original's field split is a security control and says so.** `severity`,
`state_reportable` and `ai_tags` are patchable by a reviewer only, because they
are the inputs to `incidentNeedsCorrectiveAction`, which is what the resolve
gate reads:

> *"if the reporter could write them, they could downgrade their own
> high-severity incident and clear the state-reportable flag, after which the
> resolve gate reads the softened values and lets it close with no corrective
> action -- defeating the control this function exists to enforce."*

In the original that control had a second leg nobody wrote down: the reviewer is
the protected platform owner, who never reports an agency's incidents, so the
reporter and the reviewer **could not be the same person**. D40 makes the
reviewer an `agency_admin`, who files incidents like anybody else — and an
administrator could otherwise report a high-severity event, soften it, and close
it. `PENNSYNC_INCIDENT_SELF_REVIEW` refuses a privileged patch, a transition and
a reassignment on one's own incident; the narrative half stays theirs, because
that is their account of what happened. This is D40's own lesson applied a
second time, after the credential self-approval refusal: **a widening creates
risks a narrowing never does — re-read what the platform tier was structurally
preventing.**

**The severity split has a direction, and reading it as "reviewer-only" breaks
the control it protects.** The reporter NAMES the severity when filing, exactly
as the original does, defaulting to `medium`. They may not soften it afterwards.
A first draft of this contract floored severity at submission on the theory that
a reviewer's field is a reviewer's field throughout — which would have recorded
a nurse's high-severity fall as low, and the gate reads the STORED value, so the
control would never fire. The rule is about mutation, not about authorship.

**Three of the original's six owner-patchable fields have no carried column.**
`witnesses`, `follow_up_required` and `follow_up_notes` are not in
`pennsync_records.incident`. They are refused by name as
`PENNSYNC_INCIDENT_FIELD_NOT_CARRIED` rather than silently dropped: a reporter
who sent a witness list would otherwise believe it was recorded.

**The urgent-alert fan-out is ported, not paused, because its recipients are
records rather than a message.** The original selects them by listing five
thousand `User` rows and comparing `account_type` and `agency_name`, and carries
two bug fixes in its own comments for having got that wrong — admins past the
first two hundred rows were never alerted, and an unscoped fan-out *"leaked
patient name/id to every tenant's agency_admins."* Here the recipients ARE the
agency's active `agency_admin` memberships, which is what that comparison was
approximating, and the query cannot reach another tenant at all. That is the
fifth original whose comments document a derived-scope bug a policy cannot have.

**The alert names no patient, and that is a narrowing this store requires.**
`notification_read` is agency-WIDE while D24 narrows a chart to its care team, so
a patient name on a notification would be readable by an `office_staff` member
who opens no chart. The alert carries the incident's id and its category; the
addressed administrator opens the incident, which is chart-narrowed, to see
whose it is. A test asserts the name, the surname and the chart id appear
nowhere in the title, the message or the metadata.

**Two more narrowings.** `patient_name` is read off the chart rather than taken
from the payload — a denormalized name that disagrees with the chart is a
falsehood in a safety record, and the caller has already been proved able to
open that chart to name it. And `reassign_patient` requires the destination
chart to be one the reviewer can open; the original accepts any id at all, so
the duplicate-patient merge it exists for could move a safety event out of the
agency.

**D37 deletes an apparatus rather than a line.** Both originals write their
audit entry after the row is already committed, catch its failure, and return
`audit_recorded: false` with *"Record this transition manually"*. In one
transaction neither half can exist without the other, so the flag, the catch and
the warning all go. The patch entry records the KEYS and never the values, which
is the original's own rule: *"the values can contain incident narrative, witness
names, notes, or photo URLs and belong only on Incident itself."*

**One divergence deliberately not made.** The offline drain dedupes retries by
`client_request_id`, and the original explains why the key must survive into the
row: *"an interrupted drain (server committed, queue removal failed) creates a
second copy of the same safety event on the next pass."* That check is ported as
the original has it — read, then insert — and it is racy for the same reason.
`Incident.client_request_id` makes no uniqueness claim in its own schema, so D30
emits no index for it and there is nothing for a named `unique_violation` catch
to name. Closing it means the SCHEMA claiming uniqueness, which is an entity
decision and not this contract's to make.

Port queue: `records_schema` 44 → 42, written 43 → 45.

## D45 — The authority envelope is not a derived scope, and porting the reader proved the writer wrong

**Decision.** Port `manageMyNotifications` as three contracts behind its one
action envelope, keep the notification authority envelope, and delete the
revalidation machinery built around it.

**Tenancy is not ownership, and this time the policy says so plainly.**
`notification_read` and `notification_update` are agency-WIDE: every member of
the agency matches them. A port that trusted the policies would have let anybody
in the agency read and dismiss anybody else's notifications. The predicate that
makes a row the caller's is the contract's own, and it is two columns rather
than one — `recipient_user_id` is the identity and `user_email` is what the
original's integrity check requires to agree with it, so a row carrying one of
each is delivered to neither person. That is D36's rule reaching a second
capability; **read the policy to tell which case you are in** remains the
instruction.

**The envelope looks like the derived scope D41 and D43 delete, and it is the
opposite.** The original filters, and then re-checks, on `recipient_user_id`,
`recipient_membership_id`, `recipient_membership_version`, `authority_version`,
`authority_state` and `user_email`. A derived scope ASKS a self-editable field
who the caller is. This RECORDS which membership, at which version, a
notification was minted for — so a person whose membership changed stops seeing
what was addressed to the grant they no longer hold. It is kept, and
`recipient_membership_id`/`_version` come from `pennsync_private.caller_membership`
— this store's membership, as D34 settled — never from Base44's
`AgencyMembership`. The list FILTERS on it, so a stale row is hidden rather than
refused; the integrity check on top can then only fire for content, which in
this store means a contract wrote a bad row, and that is worth failing on.

**What is deleted is the compensation around it.** `manageMyNotifications` calls
`revalidateScope` three to five times per request, re-reads each transitioned
row and asserts its new version, and verifies `updateMany`'s
`{success, updated, has_more}` — all because between any two of its service-role
calls the caller's membership could change and nothing would notice. One
transaction removes every one of those. `mark_all_read` becomes a single
statement instead of one full transition per row, each with three scope reloads,
which is also why the original has to report how much of the page it got
through.

**Porting the reader found a defect in the writer, and nothing else could
have.** D44's urgent-alert fan-out stamped `recipient_user_id`, `user_email`,
`type` and `priority` — three of the six columns this reader filters on — and
none of `recipient_membership_id`, `recipient_membership_version`,
`authority_version`, `authority_state` or `version`. Every alert it wrote would
have matched no reader's filter and been invisible to the administrator it was
for. Both contracts' own suites passed throughout. The fix is in D44's file,
`pennsync_private.agency_admin_recipients` now carries the recipient's
membership id and version, and the guard is a CROSS-CONTRACT test: submit an
urgent incident through one contract, read the alert through the other. **A
capability that writes a row another capability reads is not proved by either
suite alone.**

**Two projection rules kept as the original states them.** `safeActionUrl`
admits a same-origin path and nothing else — a notification's link is rendered
as a button, so an absolute URL or a protocol-relative `//host` would be an open
redirect out of the product — and the projection carries no `metadata`, no
`user_email` and no recipient identity, because the caller knows who they are
and the envelope columns are authority rather than content.

Port queue: `records_schema` 42 → 41, written 45 → 46.

## D46 — Two of eight actions needed no SQL, and a reservation protocol became a lock

**Decision.** Port `manageVehicleMaintenance` as six contracts, route its other
two actions to contracts that already exist, and replace its creation-claim
protocol with the lock it was emulating.

**Check which store already models what the original reads.** D34 established
this for `listMyTenantMemberships` and `getMyTenantContext`; here it applies
inside a single capability. `context` lists the agencies the caller may keep a
fleet in — that is `contract_tenant_memberships`, with `tenant_role` in place of
its `can_manage`. `staff` is the assignee picker: the original lists
`AgencyMembership`, re-reads every lifecycle state to prove the page
unambiguous, and joins `User` for a name — which is `contract_roster` exactly.
Neither got a line of new SQL. **Two of eight.** A test reads the migration and
fails if a `contract_fleet_context` or `contract_fleet_staff` ever appears.

The one honest seam that leaves: D22's roster pages by KEYSET and the original
pages by a numeric offset, and the two do not translate. The original already
solves this for its own `history` action — it forwards an opaque token in the
offset property, and *"Stale numeric offsets are rejected, not skipped"* — so
`staff` does the same, passing a cursor through and refusing a number that is
not the first page rather than silently answering the first page again.

**`createOnce` becomes `select … for update`.** None of the three fleet entities
claims uniqueness on `request_key` in its own schema, so D30 emits no index, and
the original compensates with a reservation protocol: hash the scope into a
64-hex key, append a `{key, token}` claim to a `*_creation_claims` ARRAY on a
PARENT row, re-read, then create. Here the parent row always exists — an agency
for a vehicle, a vehicle for an entry, an entry for a review — so locking it
serializes the check and the insert in one transaction, which is what the
protocol was emulating. The `creation_claim_token` and `*_creation_claims`
columns are carried and this contract writes neither; a test asserts they stay
null. Note the contrast with D44: there the parent of a deduplicated incident is
the incident itself, which does not exist yet, so `for update` had nothing to
lock and the race stayed open.

**D32 working, rather than being asserted.** `FleetServiceReview` is one of the
four entities whose own description calls the ROW immutable, so it has a read
and an insert policy and no update or delete policy at all. The original already
honours that, in its own words — *"Reviews are independent immutable rows. Never
replace the service entry's review array: concurrent administrators cannot erase
each other"* — so a review INSERTS a row and touches the entry not at all. The
entry's stored `review_status` stays `pending` and the ANSWER's is the latest
event; a test checks both.

**Two more compensations deleted.** `validFleetMembership` and
`validAssigneeMembership` re-prove a membership row's whole canonical lifecycle
on every request, because in Base44 any service-role writer could half-write
one; `pennsync_private.membership` holds it with CHECK constraints, and D34
already deleted the same forty-line `validateMemberships`. And the history page
is ONE keyset statement: the original runs up to three queries and re-sorts in
JavaScript for a reason it states — *"The SDK supports one sort field"* — while
a row comparison over `(service_date, id)` sorts on two. The cursor's
`v1:<agency>:<vehicle>:<day>:<id>` shape is kept verbatim, because
already-published clients forward it.

**Two narrowings the policies do not give.** `fleet_vehicle`'s policies are
agency-wide, so "a vehicle assigned to me, and not retired" is the contract's
rule — D45's lesson a third time. And an assignee is proved through membership
(D23) with their verified address as the display name, because the carried
`user` table has no name column (D38).

Port queue: `records_schema` 41 → 40, written 46 → 47.

## D47 — The paused-at-source check was measuring one shape, and six capabilities hid in the other

**Decision.** Teach the paused-at-source check the unconditional-return shape,
and carry the six capabilities it finds as `preserved_paused` rather than
`port`.

**This is the same failure the check was written to fix.** D7 says a paused
domain is carried paused and ported only after it is turned back on, and
`isPausedFunction` enforces that by finding a module-level `const FLAG = false`
whose guard returns a refusal. Its own comment records what that was worth:
*"seven paused capabilities sat in the port queue as writable work — the inert
check could not see them, and a reader going by the feature name would not
either."*

Nine modules here pause with **no flag at all**. The refusal is simply the first
statement of the handler, with the real body unreachable below it:

```ts
Deno.serve(async (req) => {
  // SECURITY CONTAINMENT: keep the legacy bulk Patient writer unreachable
  // until an immutable tenant-authorized, atomic replacement is available.
  return Response.json({ error: '…', code: 'legacy_patient_service_writer_paused' }, { status: 503 });

  try { /* four hundred unreachable lines */ }
});
```

Six of the nine were dispositioned `port` and counted in the port queue as work
somebody could start: `calculateDataQualityScores`, `enforceDataCompleteness`,
`monitorClinicalDataForCarePlanUpdates`, `predictPatientRisks`,
`predictiveRiskAnalysis` and `processDischargeReport`. Two more were already
`retire` and one already `preserved_paused`, so only the six move.

`isRefusingHandler` errs toward calling a module live in exactly the way the
flag check does: only a handler whose opening brace is followed by nothing but
comments and a `return` counts, so a guard, an assignment or an `await` first is
a live module, and an expression-bodied handler has no first statement to
inspect at all — that is `isInertFunction`'s question. Comments are skipped
because a pause is normally introduced by one saying why.

**The rule this leaves.** A measurement is only as good as the shape it looks
for, and "we already check for that" is not the same as "we check for every way
it is written." When a check exists to stop a class of mistake, re-derive the
shapes from the tree rather than from the check.

**What is NOT decided here.** Every one of the six names the same conditions —
*immutable tenant authorization and an atomic write broker* — and
`predictiveRiskAnalysis` names three more precisely: a conditional claim, a
datastore-enforced unique idempotency key on `PatientAlert`, and an atomic alert
write. Those are conditions the owned store may now meet, which makes each a
D33-shaped question rather than a product judgement: D24 gives immutable tenant
authorization and a contract gives an atomic write. Re-enabling any of them is
its own decision with its own contract, and none is taken here. Carrying them
paused is what the evidence supports today.

Port queue: `records_schema` 40 → 36, `entity_authorization` 10 → 8, written
unchanged at 47.

## D48 — The envelope becomes a facility, and a preference moves to the only session that can read it

**Decision.** Port `createNotification`, move the authority envelope into
`notification_mint` — a facility both it and the incident fan-out call — and
honour the recipient's in-app preference in the reader rather than the writer.

**One place left to get it wrong.** D45 found that the incident fan-out stamped
three of the six authority columns its reader filters on, so every urgent alert
it wrote was addressed to nobody while both contracts' own suites passed.
Porting the canonical writer would have inlined that envelope a second time,
which is the same bet again. `notification_mint` is now the only thing in the
store that inserts a notification row — a FACILITY rather than an endpoint, the
shape `contract_activity_append` has under D37, and for the same reason: a
contract that must write a notification inside its own transaction cannot make a
second round trip. A test reads the four migrations and fails if any of them but
the facility contains an `insert into … notification`. It applies BEFORE both
callers on purpose: a plpgsql body resolves its calls at run time, so a later
migration could have supplied it and a half-applied store would then have a
fan-out that fails on its first call instead of at migration time.

`pennsync_private.agency_roster` moves there too, and is the general form of
three helpers written one at a time as each port needed one: `agency_colleague`
(by address), `agency_member` (by id) and `agency_admin_recipients` (by role).
The last is deleted here; the other two should collapse into it the next time
either changes.

**A preference the sender cannot read.** The original reads the recipient's
`NotificationPreference` to decide whether to create an in-app row at all. In
this store `notification_preference_read` is `user_email = caller_email()`, and
the table is force-RLS so no role escapes it — the policy that makes a
preference the RECIPIENT's own makes it unreadable by the sender. The reader is
the only session that can ask, so `contract_notification_list` and
`contract_notification_mark_all` honour it. That is also the better place: the
preference that decides what somebody sees is the one they hold now rather than
the one they held when it was sent, and the row is retained either way, so what
was sent stays answerable. **Where a check belongs is decided by which session
can evaluate it, not by which one the original put it in.**

**The email half is not ported**, because `Core.SendEmail` is not in the
runtime's brokered set, and everything that gated the EMAIL goes with it: quiet
hours, `digest_mode` and `email_notifications_enabled` are not evaluated,
because there is nothing for them to gate. The original's own fix to that
default is recorded in the contract header so it is not lost when the send
returns: *"a user who never opened Notification Settings got NO emails at all,
including priority:'critical' patient alerts."*

**"Has the recipient charted on this patient" becomes "does the recipient open
this chart".** The original answers it by filtering `Visit` for a row the
recipient created, which is an act rather than an authority; D24 made care-team
membership the authority for chart access. `pennsync_private.member_opens_chart`
asks that, and it has to be a helper rather than a policy because the question
is about the RECIPIENT and a policy binds the caller.

Port queue: `records_schema` 36 → 35, written 47 → 48.

## D49 — A scheduled sweep has no tenant, and this store has nothing that is cross-tenant

**Decision.** Port the per-agency half of `checkExpiredInvitations` under D40,
and record the scheduled cross-tenant half as an OPEN decision covering all four
scheduler capabilities still in the queue.

**Two gates, one successor.** These capabilities admit either the built-in
`role === 'admin'` or a shared secret in a header:

```js
function isSchedulerAdmin(user) { return !!user && user.role === 'admin'; }
```

D40 answers the first: an `agency_admin`, scoped to their own agency. The second
is how the SCHEDULER calls it, and it cannot simply be recreated. The original
sweeps every pending invitation in the deployment; nothing in this store is
cross-tenant, because `pennsync_records_owner` must never hold `BYPASSRLS` and
every policy asks `caller_agencies()`. A caller with no tenant sees no rows —
by design, and the design is load-bearing.

**What the open decision is.** Three shapes were considered and none is taken
here:

1. **Per-agency, under a real identity.** The scheduler enumerates agencies and
   calls this contract once per agency as an actor holding that agency. Nothing
   bypasses anything, the sweep's writes are attributable to a visible and
   revocable member, and the contract needed is the one written here. It costs
   a maintenance identity per agency, in `identity_map` and `membership`.
2. **A `pennsync_private` definer with no caller.** Rejected on inspection: a
   definer does not escape forced RLS either, so it would need a bypass role,
   which is the one thing the record store's design forbids outright.
3. **A maintenance predicate in the policies.** Rejected: it would touch all 589
   generated policies and reintroduce, as a permanent fixture, exactly the
   cross-tenant reach D14 and D22 removed.

Shape 1 is the only one that does not contradict something already decided, and
it is a decision about identity rather than about this capability, which is why
it is named rather than taken. **The four capabilities it governs**:
`checkAdrDeadlines`, `checkExpiredInvitations`,
`sendCredentialRenewalReminders` and `sendPersonnelExpirationNotifications`.
Each is portable today as an agency administrator's action; each waits on shape
1 to run unattended.

**The paused branch is the original's own.** It already returns
`{ expired, expiring_soon, notifications_sent: 0, delivery_paused: true,
code: 'OUTBOUND_DELIVERY_RELEASE_PAUSED' }` whenever `outboundDeliveryReleased()`
is false, and in that branch it deliberately does NOT stamp
`expiring_soon_notified_at` — *"do not claim an email tier that was never
sent."* The digest is `Core.SendEmail`, which nothing here brokers, so this port
IS that branch: expiry maintenance happens, the expiring-soon tier is counted
and not claimed, and the answer says so.

**The sixth derived-scope bug an original documents.** Its digest scopes by
comparing the invitation's `agency_name` STRING to each admin's, and its comment
records what that cost: *"Unscoped fan-out emailed invitee names/emails to every
tenant's admins."* After D41, D42, D43 and D44, the count is six. The test seeds
agency B's invitation with `agency_name` saying "Agency A" precisely so a port
reading that field would fail.

**And a comment worth keeping.** The original carries an explicit 5000-row limit
because *"an unlimited filter() only returns the server's default page (~50), so
past that this sweep leaves the overflow pending — expired invitations stay
accepted and the reported counts under-report."* A SQL `update … where` has no
page to overflow. It is the clearest statement in the tree of what these ports
keep deleting.

Port queue: `records_schema` 35 → 34, written 48 → 49.

## D50 — Three crons shared a marker column once, and the table still carries the scar

**Decision.** Port `sendPersonnelExpirationNotifications` and
`sendCredentialRenewalReminders` as TWO contracts over one shared sweep, under
D40's gate and D49's open scheduler decision.

**The reason they are separate is the most important thing either records.**
From the renewal capability's own comment:

> *"Use a marker field dedicated to THIS job. The three credential-reminder
> crons previously shared `reminder_offsets_sent` with different tier sets, so
> whichever fired a shared tier first consumed it for the others (e.g.
> sendExpirationNotifications marking tier 30 suppressed this renewal email)."*

That is why `personnel_credential` carries `reminder_offsets_sent`,
`renewal_email_offsets_sent` AND `expiration_note_offsets_sent`. The shared body
takes the marker column and the tier set as parameters precisely so a future
change cannot quietly give one capability the other's column, and a test proves
that claiming every tier on one marker leaves the other sweep's tiers
untouched. **Do not merge them, and do not give a third caller either of
theirs.**

**The ±90-day window goes, and every past-due credential is flipped.** The
original constrains to that window *"BEFORE the row cap"*, because otherwise *"a
historical backlog of already-expired credentials (which accumulates without
bound over time) [would] fill the 1000-row cap and starve the upcoming
expirations this job exists to notify about."* A SQL `update … where` has no cap
to starve, so the window has nothing left to protect — and keeping it would
leave a credential that expired 200 days ago permanently un-flipped, which is
the artefact rather than the rule. This is the second port in a row where a
limit existed only to survive a paged client (D49's was 5000 rows); both are
deleted for the same reason.

**Two rules kept exactly as the originals state them.** A tier fires AT OR BELOW
its offset rather than on an exact-day match — *"so a missed cron run
(downtime/deploy/DST) doesn't skip a tier permanently"* — and today is the
agency's calendar day, because these compare *"on local calendar days, not UTC
midnight"*.

**And the ordering rule for when a send returns.** Both originals claim the tier
BEFORE sending and re-read to confirm the claim, and say why: *"Prior code
stamped offsets in a bulk `updates` array before emails ran — if send failed,
the tier was still marked sent and the reminder was permanently lost; concurrent
runs could also both send before either stamp landed."* The send is
`Core.SendEmail`, which nothing here brokers, so these ports are the originals'
own paused branch — expiry maintained, tiers counted and not claimed — and the
claim-before-send ordering is recorded in the contract header so it returns with
the send rather than being rediscovered.

Port queue: `records_schema` 34 → 32, written 49 → 51.

## D51 — The sweep with nothing paused, and the defect that proves the facility

**Decision.** Port `checkAdrDeadlines` whole — the last of D49's four and the
only one with nothing to pause, because its reminder is a `Notification` ROW
rather than an email.

**It is the evidence for why `notification_mint` is a facility.** This original
creates its reminder with `user_email`, `title`, `message`, `type`, `priority`,
`metadata`, `is_read`, `action_url` and `action_label` — and none of
`recipient_user_id`, `recipient_membership_id`,
`recipient_membership_version`, `authority_version` or `version`.
`manageMyNotifications` FILTERS on all of those. **So in Base44 today, an ADR
deadline reminder matches no reader's filter and is shown to nobody.**
`submitIncidentReport` has the same shape and the same result. That is a defect
in the product rather than in the port, and it is exactly the defect D45 caught
this migration about to reproduce. Minting through the facility makes it
impossible to repeat; a test proves the reminder is readable by reading it back
through the reader, and READS the original to confirm the omission is still
there, so if it is ever fixed upstream this port's stated reason fails rather
than going stale.

**Its tenancy is the CHART, not an agency column.** `adr_audit_case` carries no
`agency_id`; its policies reach tenancy through `patient_id` into `patient`. The
contract still names the agency in its own predicate rather than leaning on the
policy, because `caller_agencies()` returns every agency the caller holds and
one holding two would otherwise sweep the other's cases. **A plpgsql body does
not resolve column names at creation, so the migration applied cleanly with a
`c."agency_id"` that does not exist; only the test found it.** That is the
second time in this migration that building and running the thing caught what
reading it did not.

One consequence, which is the schema's rather than this contract's: a case with
a null `patient_id` is in no chart and therefore in no tenant, so it is
invisible to everyone — the same shape D27 found for a `Document` bound to an
agency and no patient.

**The once-a-day rule is enforced twice, and the two can disagree.** The
original's claim is `deadline_reminders.last_notified_date`, a field on the case
that anything may edit; the port adds `notification_dedupe_key_unique`, an
index. When they disagree the index wins, the case is counted
`already_reminded`, and the `unique_violation` is caught BY NAME so any other
one still raises — the rule D30 set and D44 followed. The original's `claimed_by`
run token and its release-on-failure path go with the transaction: a reminder
and its claim cannot now disagree.

**A case whose owner has left is reported, not dropped.** The original mints a
row addressed to whatever string is on `created_by`. Here the owner is resolved
through the roster, and a case naming somebody who is no longer a member comes
back in the answer as `unreachable` — a deadline with no owner is the thing an
administrator most needs to see, and *"Documentation not received by the
deadline is treated as missing and the claim is denied."*

Port queue: `records_schema` 32 → 31, written 51 → 52. D49's four are now three
ported and one — the unattended run itself — still open.

## D52 — Almost nothing an employee sends decides what they are paid

**Decision.** Port `submitTimesheet` and `reviewTimesheet` as one domain, and
delete the unscoped legacy point-config fallback that is the read side of D43's
bug.

**The originals are unusually disciplined, and the port's job is mostly to keep
that.** The service line and points eligibility come from the payroll profile an
administrator keeps, *"not chosen by the employee"*. Points are the agency's
configured per-type values times the visit counts, *"server-authoritative, so
the client cannot set points directly"*. Paid time off carries in from approved
`TimeOffRequest` rows rather than being typed. The phone reimbursement is the
profile's, *"an expense reimbursement (not pay/wages)"*. In daily mode the
per-day rows are authoritative and the client's period totals are discarded. All
five are ported, and each has a test that sends something else and checks it was
ignored.

**Divergence 2 is D43's bug from the other side.** The original, failing to find
a point config for the caller's `agency_name`, adopts the newest row in the
DEPLOYMENT, *"so nurses with an agency don't silently compute 0 points"*. D43
deleted the same fallback from the WRITE side, where the original's own comment
records what it cost: *"a platform admin (no agency) saving config silently
overwrote that agency's point math."* Reading it is the same defect: one
agency's point schedule paying another agency's nurses. An agency with no
schedule now computes zero and the answer says `point_config_missing`, so the
gap is visible rather than papered over with somebody else's numbers. The test
seeds agency B's schedule and checks agency A's nurse earns nothing from it.

**Three labels stop deciding things.** The submission gate was
`user.is_approved !== true`; the approver test was `role === 'admin' ||
account_type === … || is_manager === true` followed by an `agency_name` string
comparison; the reviewer test was the same. All are self-editable fields on the
carried profile (D23), and membership answers all of it — an approver is a
colleague whose tenant role is `agency_admin` or `manager`, and a reviewer is an
`agency_admin` or the sheet's own assigned approver.

**And tenancy is not ownership, for the third time.** `timesheet_read` and
`timesheet_update` are agency-WIDE, so "my timesheet" and "a timesheet I may
review" are the contract's rules. Both originals already refuse self-review
*"even as an admin"*, and that is kept by identity rather than by two address
comparisons.

One detail worth keeping: on an edit the original sets the review fields to
EMPTY rather than `undefined`, because *"undefined ... JSON-omits and would
leave the stale values in place"* — a rejected sheet that was resubmitted would
otherwise still show who rejected it. The port nulls them, and a test
resubmits and checks.

Port queue: `records_schema` 31 → 29, written 52 → 54.

## D53 — Sequencing a model and a write, and where `audit_recorded` belongs

**Decision.** Port `triageReferralWithAI` as the first capability that asks a
brokered model and then writes, and establish the shape the remaining
model-backed ports follow.

**This was the open question, and measuring answered it.** Eleven of the
capabilities still in the port queue call `Core.InvokeLLM` and touch records,
and the worry was that they needed an orchestration nothing had built. They do
not. `InvokeLLM` is already brokered, the handler is already handed
`integration`, `audit`, `records` and `contract`, and the sequence is just: ask
the model, shape the answer, record only what may be recorded, say whether the
record was made. What was missing was a worked example, not a mechanism.

**The containment rule is the original's, and it is the interesting part.** From
its own comment:

> *"Log only the triage category. The analysis contains patient identity and
> clinical detail; UserActivity is a broad operational audit surface, not a
> second copy of the referral record."*

So the trail entry carries the urgency level and nothing else — the same
discipline D44 kept for a patched incident, where only the KEYS of the change
are recorded. `auditUrgencyLevel` normalises anything unexpected to `UNKNOWN`
rather than writing what the model said, which matters because a model can
answer in prose and that prose would otherwise land in the trail. A test sends
`"EXTREMELY URGENT — patient is Ada Lovelace"` as the urgency and checks the
trail says `UNKNOWN`.

**`audit_recorded` returns, and that is not a reversal of D37.** D37 deleted
that flag, its `catch` and its *"Record this transition manually"* warning from
the incident port, because one transaction made it impossible for the change and
its record to disagree. This handler has no transaction to offer: the model call
is one network round trip and the trail append is another, so a failed append
after a successful analysis is a state that can really happen. The original
swallows it and returns the analysis, which is right — the analysis has already
been paid for and losing it helps nobody — and the port says so in the answer
rather than silently. **The flag belongs wherever a transaction does not, and
nowhere else.**

The prompt is read out of the original by the test rather than asserted, so a
rewording fails the suite instead of quietly changing what the model is asked.

Port queue: `records_schema` 29 → 28, written 54 → 55. The eleven model-backed
ports are now blocked on nothing but their own record contracts.

## D54 — A model's answer is data, and the columns are what decide whether it may be stored

**Decision.** Port `syncCMSRegulations` as a model call followed by a record
contract, and have the contract check every enumerated field the model supplies
against the column's own constraint before storing it.

**This is the first port whose write is a record contract rather than a trail
append**, so it is where D53's pattern meets a real table. The order is the
same: ask the model, shape the answer, store what may be stored, record the
sync. The prompt asks the model to search the internet, so
`add_context_from_internet` and the response schema pass through the broker
unchanged — the runtime takes an operation's params as given.

**The interesting part is what the columns refuse.** `regulatory_update`
constrains `source`, `category`, `impact_level` and `status`, and the thing
supplying three of them is a MODEL. The original writes them straight through:

```js
category: reg.category || 'documentation',
impact_level: reg.impact_level || 'medium',
```

A model asked for free text will sooner or later answer `"reimbursement policy"`
where the enum says `billing`, or `"VERY HIGH"` where it says `high`. That
insert raises a check violation, and the original's per-row `try/catch` logs it
and continues — so the regulation is silently lost and the reported count is
wrong. The contract treats an unrecognised value as an ABSENT one, which is the
only reading that neither loses the regulation nor writes something the store
refuses, and reports `regulations_adjusted` so the substitution is visible.
Matching is case-insensitive, and case alone is not counted as an adjustment.

**The batch is one transaction.** The original creates each row in its own call
inside a `catch` that logs and continues, so a sync can half-succeed and report
a count nobody can reconcile. A test sends a good regulation beside a malformed
one and checks that neither lands.

**Two smaller rules.** A regulation with no title is skipped rather than stored
as a row nothing can act on, and an effective date the store cannot hold becomes
today — which is what the original already does for an absent one.

**Not diverged:** running the sync twice stores everything twice.
`RegulatoryUpdate` claims no uniqueness in its own schema, and deciding what
makes two regulations the same row — title, CMS reference, effective date — is
an entity decision, which D30 is where it belongs.

**One invariant widened.** `record-contracts.test.mjs` checked that every
declared contract is reached by scanning `handlers.mjs`; this is the first
capability whose body lives in its own module and reaches its contract from
there, so the scan now covers every module of the service. Scanning one file
would have reported a live contract as dead surface.

Port queue: `records_schema` 28 → 27, written 55 → 56.

## D55 — When the trail is a module's whole record half, `records_schema` names something already finished

**Decision.** Re-classify a capability whose ONLY entity reach is one of D25's
three retired log tables by what else its module needs.

**The second correction in this queue, and the same shape as the first.**
`classifyPortBlocker` answers with the first thing it finds, and entities come
first — which is right while the record store is the question. It stops being
right for a module whose only entity is `UserActivity`, `SecurityLog` or
`SystemLog`: D25 built the trail those retire into, so the record half of such a
module is **already done**, and `records_schema` names a finished thing.

The refinement already skipped past an audited entity so it would not become
`entity_not_carried`. It never re-asked what was left. Four capabilities sat in
the queue as record work:

| Capability | Only entity | Actually waits on |
| --- | --- | --- |
| `mergePDFs` | `UserActivity` | the file layer |
| `reorderDeletePDFPages` | `UserActivity` | the file layer |
| `generatePatientHandout` | `SystemLog` | `Core.SendEmail`, which nothing brokers |
| `transcribeAudioWithWhisper` | `UserActivity` | `OPENAI_API_KEY`, called directly rather than through the brokered runtime |

A reader going by the count would have started a record contract for a
capability whose records are finished.

**The entity accesses are masked rather than the classifier reordered**, because
the order is correct for every module this does not apply to: a capability that
reads a chart AND uploads a file waits on the chart first. `classifyWithoutEntities`
is consulted only when every entity a module touches is an audited retired one,
and a test pins both directions — including that a chart plus a file is still
`records_schema`.

**The rule, and it is D47's rule arriving from the other side.** D47 found
capabilities counted as available that refuse every caller. This finds
capabilities counted as blocked on a thing that is built. Both are the same
failure: **a bucket keeps its name after the reason for it has gone.** When a
decision supplies something the queue was waiting for, re-measure what the
waiting was actually for rather than assuming the bucket still describes it.

Port queue: `records_schema` 27 → 23, `files` 4 → 6, `core_integration` 1 → 2,
`external_secret` 1 → 2. Written unchanged at 56 — nothing was ported here.

## D56 — "Waits on the file layer" does not mean the file layer is missing

**Decision.** Record what the fifteen file-bound capabilities are actually
waiting for, because the phrase this queue has been using for them names the
wrong thing.

**The adapter is built and acceptance-tested.** `services/integration-runtime`
implements `UploadFile`, `UploadPrivateFile` and `CreateFileSignedUrl`. Both
uploads return **durable private `cmfile:` handles, never permanent public
`file_url` values**; `CreateFileSignedUrl` validates the actual Supabase
relative storage path and the exact object, host and token, and its links live
sixty seconds so an expired one needs a new signing request rather than another
paid upload. The runtime's own operator acceptance exercises private signing and
a download hash comparison. The transition plan has called this "Adapter only"
since it was written.

**So what the fifteen wait on is Phase 3's DATA work, not a missing path**: the
inventory of what exists in both production apps, the copy into the production
private bucket under a SHA-256 manifest, the `file_url` → `cmfile:`
compatibility layer, and the migration of 31 `UploadFile` call sites. The
carried rows hold `file_url` strings pointing at Base44's own storage host —
`FILE_URL_ALLOWED_HOSTS` in the shared helpers names
`qtrypzzcjebvfcihiynt.supabase.co`, `base44.app` and `base44.io` — and porting
any of these capabilities verbatim would carry that host into the service. That
is the real blocker, and it is a data migration with a compatibility layer
rather than an adapter to write.

**The service's allowlist is a ratchet, not an inventory of what exists.**
`BROKERED_OPERATIONS` in `services/pennsync-api/integrations.mjs` is
`['InvokeLLM', 'ExtractDataFromUploadedFile']`, and its own comment says why:
*"The runtime brokers more than this; this is the subset the ports in this
service actually use, so releasing a handler cannot widen the surface by
accident."* It grows when a port needs it.

**Which means a phrase used in D42, D49, D50, D52 and D54 was true but
misleading.** Those ports say the email half is not ported because
`Core.SendEmail` is *"not in the runtime's brokered set"* or *"nothing here
brokers it"*. Accurate about this service; it reads as though no implementation
exists. **The runtime implements `SendEmail`.** The delivery halves of those
ports are therefore waiting on a DECISION to broker it rather than on a
capability to build — and that decision is the owner's, not this migration's,
because:

* it is outward-facing and irreversible in a way nothing else on this branch is;
* the paused digests carry personnel and invitee names, so releasing them
  releases PHI to an external provider; and
* the runtime is deployed **paused**, so widening the allowlist alone would
  change nothing and would remove a guard for no gain.

Nothing is widened here. The allowlist stays at two, and the correction is that
those ports are one decision away from complete rather than one build away.

**The rule, which is D55's a third time.** A blocker's NAME is not its content.
"Waits on the file layer" and "nothing brokers it" both survived long after what
they described had changed shape. Before starting work a blocker implies,
re-read what it is actually naming.

Port queue: unchanged — 23 `records_schema`, 56 written. This records what the
blockers mean; it moves nothing.

## D57 — When the arithmetic is the capability, prove it against the original rather than against a retyped copy

**Decision.** Port `predictSupplyNeeds` onto a record contract, replace its
`assigned_nurses` authorization with the chart policies, and prove the ported
arithmetic by running the original's own block rather than by asserting
expected numbers.

**The authorization is the D21/D24 reconstruction one more time**, and this
original is unusually candid about it. Its comment reads:

> *"Authorize against the patient (assigned nurse or admin) before reading their
> supply usage and writing a SupplyPrediction. The 404 above only covers global
> non-existence, not access. RLS-independent code check."*

It then reads `created_by`, `assigned_nurses`, `account_type` and `agency_name`,
and lists five thousand `User` rows to decide whether the patient is in the
caller's agency. All of that is gone. `supply_usage_log` and `supply_prediction`
have no `agency_id` and reach tenancy through `patient_id`, exactly as the chart
does, so the policies answer both halves of the question — who may ask, and
which usage rows the answer is built from — and the contract's own visibility
check exists only to name the refusal.

**What is new here is the TEST, not the port.** Almost the whole capability is
arithmetic: six-month bucketing, a trend classification, a population standard
deviation, a confidence clamp, a reorder projection. Asserting a table of
expected numbers would prove that the SQL agrees with numbers *I* computed,
which is the transcription D12 settled against — and every one of those numbers
is a place a port can quietly drift. So `contract-supply-prediction.test.mjs`
lifts the arithmetic out of `entry.ts` between the original's own two comments,
wraps it in a function over the five names it is closed over, runs it, and
requires the contract to agree field for field on seven series at once. The
anchors are asserted, so a rewrite upstream fails the test loudly instead of
quietly proving nothing. Perturbing a single trend threshold in the SQL — 1.2 to
1.5 — fails it, which is the check that the harness bites.

**D38 did the same thing and could import a named function.** This handler keeps
every line inline in `Deno.serve`, so there was nothing to import. The block
still lifts cleanly because it is closed over `usageData`, `supply`, `supplyId`,
`patientId` and `now`, and that is the general trick: an inline block is
importable if you can name what it reads.

**The floor is the load-bearing detail, and it is not what the comment says.**
The original reads:

```js
const usageData = usageBySupply[supplyId];
if (usageData.length < 2) continue; // Need at least 2 data points
```

`usageData` is USAGE LOG ROWS. The `data_points` it then reports is
`quantities.length`, which is distinct MONTHS. Two logs in one month therefore
produce a prediction with one data point, zero variance and the 95 confidence
ceiling — and porting the comment instead of the code would have silently
stopped producing predictions the product produces today. **D36's rule cuts both
ways: a comment is not a permission, and it is not the behaviour either.** The
contract's header says so where the next reader will look.

**Six divergences, each recorded in the file.** The chart decides (1). Every
date is a stored date or `agency_today()`, never the server process's zone (2) —
the original buckets a UTC-midnight `Date` through LOCAL `getFullYear()` and
`getMonth()`, so behind UTC the last day of a month lands in the month before,
and it then builds the reorder date by local `setDate()` and serialises it
through a UTC `toISOString()`. A prediction with no reorder date sorts LAST (3);
the original sorts on `a.days - b.days`, which is `NaN` for every comparison
involving the null a zero predicted usage produces. `supply_item` is joined on
the caller's agency (4); the original reads the five thousand newest supplies in
the DEPLOYMENT and matches by id, so another agency's figures could build this
agency's prediction and this agency's supply could fall off the page and
silently produce nothing. The six-month window is six months (5); the original's
`setMonth(getMonth() - 6)` overflows from a month end onto the 3rd of the
following month. A log row with no `quantity_used` counts as zero (6) rather
than poisoning every number in the row with `NaN`.

**One rounding detail worth keeping.** `supply_round` multiplies in DOUBLE and
then rounds, because the original does `Math.round(x * 10) / 10` on a double and
`round(x::numeric, 1)` is exact decimal rounding — they disagree in the last
digit wherever the binary representation falls just under a half. The parity
test would have caught it; the function is there so the reason is written down.

**Not diverged:** every run appends a new prediction row per supply.
`SupplyPrediction` claims no uniqueness in its own schema, and deciding whether
a re-run replaces or appends is an entity decision, which D30 is where it
belongs.

**One request-shape change.** The original's body key is `patientId`, the only
camelCase body in the set; every capability in the ported API names a chart
`patient_id`, and nothing in `src/` calls this one, so there is no caller to
keep in step with the outlier.

Port queue: `records_schema` 23 → 22, written 56 → 57.

## D58 — A reorder task with no patient is a task in no tenant, and the original writes one

**Decision.** Port `analyzeVisitForSupplyUsage` as a read contract, a model call
and a write contract, and stamp the reorder task it creates with the authorized
chart — because without a patient the task, and the low-stock alert that names
it, are written where nobody can read them.

**The fourth instance of one defect, and the first that a stamped envelope
column does not fix.** D45 found it in the notification envelope, D51 found it
in the ADR reminder and the incident alert, and here it is again: the original
ends with

```js
const task = await base44.asServiceRole.entities.Task.create({
  title: `Reorder ${matchedSupply.name}`, …, assigned_to: user.email, …
});
await base44.asServiceRole.entities.SupplyLowStockAlert.update(alert.id, {
  reorder_task_created: true, task_id: task.id,
});
```

No `patient_id`. In this store `task` reaches tenancy through `patient_id` and
`supply_low_stock_alert` reaches it through `task_id`, so the pair is in no
tenant at all — invisible to the agency's administrator, to the care team, and
to the very clinician the task is assigned to. A test seeds exactly that pair
and reads it back as two different callers to prove it, rather than asserting
it.

**The fix is the original's own `assigned_to`.** It hands the reorder task to
`user.email`, the clinician who just documented the visit, and that clinician
opens this chart — so the authorized `patient_id` makes the task visible to
precisely the person it was given to, plus the rest of the care team and anyone
who opens every chart. The other three capabilities in the tree that create a
`Task` all name a patient, and `generateFollowUpTasks` says why in its own
comment: *"Chart-attached tasks require a patient the caller can access."* This
one is the outlier, and a test reads the original and fails if that ever stops
being true.

**What was considered and rejected.** Giving `SupplyLowStockAlert` or `Task` an
`agency_id` of its own would also work, and the tenant-decision gate refuses it
by name — *"has a decision but its tenant path already resolves"* — because the
decision file is for entities whose path does NOT resolve. Overriding a
resolved path is a change to the derivation, not a decision, and it was not
needed: the capability already knows the chart.

**Three compensations deleted, all of them for having no transaction.**

* `supply_usage_claimed_by`. The original writes a claim token to the visit,
  reads it back, and treats a mismatch as "claimed by a concurrent run" — and
  it is racy anyway, since two runs that both write and then both read their
  own token both proceed. The record contract takes `select … for update` on
  the visit row and skips what is already logged against it, so the second run
  is a no-op with no token to lose. D46's rule: a reservation protocol becomes
  the lock it was emulating.
* `runningQuantities`. That map exists so two line items in ONE run do not both
  write against the same frozen snapshot. It does nothing about two concurrent
  RUNS, which lose one another's decrement entirely.
  `greatest(0, current_quantity - qty)` under the row lock is correct for both.
* The create-then-update of the alert. The task is created first, so the alert
  carries `task_id` and `reorder_task_created` at insert.

**Two divergences that are the store's shape rather than a choice.**
`supply_item` is matched inside the caller's agency — the original scans the
five thousand newest supplies in the DEPLOYMENT, which D57 records as a read
defect and which here WRITES to whatever it matches. And the duplicate-alert
check sees what the caller sees: the alert is chart-bound, so there is no
agency-wide read of it to make, and a second clinician on a different chart can
open a second active alert for the same supply. That is also what the
original's `assigned_to: user.email` implies, since each of them is handed the
reorder task.

**Not diverged.** A malformed element of the model's answer is SKIPPED rather
than refusing the batch, because the original guards each one deliberately and
says why, and refusing would throw away the extractions that were good — the
opposite of D54, where the original's per-row `catch` was the accident. Two
line items matching the same supply in one run both log and both decrement.

**And the body keys stay camelCase**, which is the counter-case to D57.
`src/pages/SmartNoteAssistant.jsx` sends `{ visitId, visitNotes, patientId }`
and the SPA is shared between the two backends, so renaming them would break
the capability on the independent path the moment it shipped. D57's rename was
safe because nothing in `src/` calls `predictSupplyNeeds`. **Check the call
site before normalising a request shape.**

Port queue: `records_schema` 22 → 21, written 57 → 58.

## D59 — A capability with two input sources can be half of it today

**Decision.** Port `importProvidersCsv`'s `csv_text` branch and refuse its
legacy `file_url` branch by name, because only one of the two touches the file
layer — and the original's own comment says which.

**The fourth partial port**, after D31's nine visit actions, D35's six
membership actions and D36's policy acknowledgment. The shape is the same: the
branch that has a successor is served, the one that does not is refused BY NAME
with its reason, and a test asserts the refusal so the gap cannot close by
accident. What is new is the axis — earlier partial ports split on an ACTION,
this one splits on where the input comes from.

The original accepts exactly one of `csv_text` or `file_url`. The second
downloads through `isSafeFetchUrl`, whose `FILE_URL_ALLOWED_HOSTS` is
`qtrypzzcjebvfcihiynt.supabase.co`, `base44.app` and `base44.io` — carrying that
into the service is precisely what D56 measured as the file-bound blocker, and
it is a data migration with a compatibility layer rather than a path to write.
The first needs none of it, and the original says so in its own words: *"A
provider directory CSV needs no storage upload or AI integration."* It is also
the only branch `src/components/physician/ProviderCsvImport.jsx` calls.

**D40's widening was half made in this original already.** Its gate is

```js
const isAdminUser = (user) => user?.role === 'admin'
  || user?.account_type === 'agency_admin' || user?.account_type === 'super_admin';
```

Three tiers, of which the built-in `admin` is the one D40 replaces, the
`account_type` check is the self-editable label D23 says decides nothing, and
`super_admin` is the tier D14 and D22 removed. All three collapse onto
`caller_tenant_role(agency) = 'agency_admin'`, so the ported gate is narrower
than what the label allowed and no wider than what D40 grants.

**And the derived scan D41 and D43 keep deleting is here in its WRITING form.**
The original builds its duplicate map from `Physician.list('-updated_date',
5000)` — every provider in the DEPLOYMENT — and then UPDATES whatever it
matched. `Physician` is agency-tenanted under D15, so one agency's import could
rewrite another agency's directory entry, and past five thousand providers it
would silently create duplicates instead of finding its own. The policy answers
both: the match runs inside `caller_agencies()` and has no page. That is the
fourth original whose scope reconstruction is a bug, and the third time a row
limit turns out to be the artefact of a paged client rather than a rule.

**Where the split falls.** Text shaping is not authorization, so the
character-by-character CSV parser stays in `services/pennsync-api/
provider-import.mjs` and every record decision — who may import, which rows are
the same provider, create or update — is the contract's. The six helpers
(`parseCSV`, `normalizeHeader`, `cleanValue`, `cleanPhone`, `titleCase`,
`formatProviderName`) are named functions in the original, so the test imports
them and compares over a table of awkward inputs rather than asserting a retyped
copy — D38's parity, available directly this time where D57 had to lift an
inline block.

That parity caught one thing worth keeping: `titleCase` lowercases the whole
string before capitalising each word, so `"Smith, John, MD"` becomes
`"John Md Smith"`. It is the original's behaviour, the test says so, and
correcting it would be a divergence nobody asked for.

**One transaction.** The original creates and updates in chunks of three with a
150 ms pause between them, so a failure halfway leaves a partly-imported
directory and a count nobody can reconcile. A test sends seven good rows beside
one malformed field and checks that none of them lands.

Port queue: `records_schema` 21 → 20, written 58 → 59.

## D60 — The containment check was measuring imports, and five tests had been reading files

**Decision.** Make `services/pennsync-api`'s build-context guard check whether a
quoted literal RESOLVES TO A FILE outside the directory, rather than whether it
matches a pattern — and move the five suites that were reading one.

**How it surfaced.** D59's provider-import test imported `transpileTs` from
`../../`, which the guard caught immediately. Its comment explains itself
clearly: the Dockerfile copies that directory as its entire build context and
runs `node --test *.test.mjs` inside it, so anything reaching `../` fails the
image build, and *"Test files count: they are copied and executed too."*

**But the guard read import specifiers and nothing else.** Five suites in that
directory were reading a file outside it by PATH — `referral-triage.test.mjs`
and `visit-supply-usage.test.mjs` read their Base44 originals to compare a
prompt against them, `provider-import.test.mjs` read one to lift six helpers,
`audit.test.mjs` read the activity-trail migration to check its refusal codes,
and `record-contracts.test.mjs` read four more. Every one of those breaks the
image build exactly as an import does. Three of the five were written in this
session, under a check whose own comment named the class it was meant to stop.

**That is D47's lesson a second time, and it is now stated twice in the tree:
when a check exists to stop a class of mistake, re-derive the shapes from the
tree rather than from the check.** The first time it was a paused handler with
no flag; this time a file read with no import.

**And the fix went through two wrong patterns first, which is the other half of
the lesson.** A pattern for `'../…'` flagged the guard's own
`startsWith('../')`. A pattern for `'../…'` plus a repository directory name
flagged `'../../etc/passwd.pdf'`, a path-traversal FIXTURE that names no file,
and missed `'../authority-store/…'`, which names a real one. So the check stopped
guessing: a literal is a finding when it resolves to a file that exists outside
the directory. A fixture resolves to nothing. A bare `'../../'` is a directory.
A path in a comment is prose, so comments are stripped first.

**Proved by doing the thing rather than modelling it.** The directory was copied
to an empty temporary tree with its dependencies and `node --test *.test.mjs`
was run there — which is what the image does. That is how the fifth instance
(`record-contracts.test.mjs`) was found after the widened pattern had declared
the directory clean, and it is the check worth repeating when this guard next
changes.

The five suites' original-reading halves now live in
`base44/functionTests/pennsyncApiOriginalParity.test.js`, beside the other
`pennsyncApi*Parity` suites, where both trees are visible and neither ships.
What they prove is unchanged.

Port queue: unchanged. This fixes a guard and moves tests; it ports nothing.

## D61 — A reference the schema does not require is not a tenancy

**Decision.** Stop counting a reference through an OPTIONAL column as a
resolved tenant path, decide the twelve entities that leaves as `agency`, and
let D24's chart narrowing apply wherever a subject is named.

**Found by measuring the class D58 stumbled into.** D58 discovered, while
porting a capability that writes one, that a `Task` with no `patient_id` is in
no tenant: `task` reaches tenancy through `patient_id`, so a null there means no
policy admits the row, and the reorder task the original creates was invisible
to everybody including the person it was assigned to. Rather than fix that one
row, the question was asked of the whole tree — **how many carried entities
reach tenancy only through a column their own schema does not require?**

Thirteen, of fifty-three reference-tenanted entities:

```
AdrAuditCase, ClinicalLibraryTemplate, ComplianceAudit, DocumentAnalysisHistory,
DocumentRecord, FaceToFaceEncounter, MaterialInteraction, NoteConversion,
NoteFeedback, PDFIndex, ScheduleFeedback, SupplyLowStockAlert, Task
```

Every one of them could hold a row that nobody could read — not the care team,
not the agency's administrator, nobody. Three of those had already produced
real defects that had to be found one at a time: D58's reorder task and its
alert, and the ADR test that asserted, as though it were correct, that *"a case
with no patient is in no chart and therefore in no tenant … invisible to
everyone, and no predicate here can reach it."*

**The fix is in the derivation, not in a list.** `tools-tenant-path.mjs`
resolved a reference whenever a column pointed at a tenanted entity, without
asking whether the column was always there. It now requires the column to be in
the entity's own `required` list — the same discipline D30 and D32 follow of
taking the schema's own words as the signal. Twelve entities became blocking
(`ComplianceAudit` re-resolved through a required `visit_id`) and each was
decided `agency`, which is the default and needs no positive claim. The
generator stamps `agency_id` before load, and D24's derivation gives the eleven
with a `patient_id` the predicate `Referral` already had:

```sql
agency_id in caller_agencies()
  and (patient_id is null or caller_opens_every_chart(agency_id)
       or patient_id in caller_assigned_patients(agency_id))
```

which is exactly what D24 already said in words: *"A row whose subject is null
stays agency-scoped, because a referral taken before a patient exists is not yet
anybody's chart."* The rule existed; only entities with their own key could
obey it.

**D58's divergence is withdrawn as a result.** That port stamped the authorized
chart on the reorder task so somebody could read it. With the table carrying
its own tenancy, the task names no patient — exactly as the original has it —
and is visible to the agency, which is who reorders supplies. The narrower fix
is gone and the port is more faithful than it was.

**Three tests changed, and each change is the finding.** The ADR sweep's
"unreachable case" is now reminded, and the comment says why. The visit-supply
suite's proof that an orphan pair is readable by nobody became a proof that a
subjectless task is the agency's and stops at the agency boundary — and that
the orphan cannot be written at all, because the column is `not null`. The
isolation suite's example of reference tenancy moved from `adr_audit_case`,
which no longer has one, to `supply_usage_log`, which does.

**The general rule.** A tenancy that a row can be missing is not a tenancy.
When a path is derived rather than declared, ask what happens when the thing it
is derived from is absent — and measure the answer across the tree rather than
waiting for a port to trip over it, which is how three of these thirteen were
found and how the other ten would have been.

Port queue: unchanged. `ClinicalLibraryTemplate` becoming readable is what
unblocks `expandClinicalPhrase`, which is the next port rather than this one.

## D62 — A template row may not widen what a caller may read about a patient

**Decision.** Port `expandClinicalPhrase` on D61's tenancy, delete both of its
agency reconstructions, and constrain the patient fields a template can ask for
to the fields `smart_note_context` already discloses.

**The port D61 was written for.** `clinical_library_template` reached tenancy
only through its OPTIONAL `patient_id`, so every generic and every agency-wide
template — nearly the whole library — was in no tenant and readable by nobody.
With the table carrying its own `agency_id` and D24 still narrowing a bound
template to the chart it names, the policies are the WHOLE of the template
scoping, and both of the original's reconstructions of it can go:

* one `User.list('-created_date', 5000)` to decide whether the requested
  patient is in the caller's agency, and
* a second to decide whether an agency-wide template was authored there.

That is the fifth original in this migration whose scope reconstruction the
tenancy replaces, after D41, D42, D43 and D44. Its `isPlatformWide` branch —
which lets a `super_admin` or a bare `role: 'admin'` use any agency's
agency-wide template — goes with the tier D14 and D22 removed.

**The new rule is divergence 3, and it is a disclosure rule.** A
`patient_specific` template names `patient_data_fields`, and the original
interpolates whatever columns that array holds straight into the prompt:

```js
template.patient_data_fields.forEach(field => {
  if (patientData[field]) patientContext += `${field}: ${JSON.stringify(patientData[field])}\n`;
});
```

`patientData` there is a full service-role row. So a template — an ordinary
agency-editable record — could put a patient's address, phone, insurance or
anything else in front of a caller whose read purposes disclose none of it.
D26's purposes exist precisely to bound that, so the contract asks
`patient_exact_purpose_row('smart_note_context', patient)` and selects from
THAT. The purpose's own role gate is the gate, and a field outside the
projection is **refused by name in the answer** rather than dropped, because a
template that quietly stopped including a field would read as a model that
ignored it.

Note where the refusal is reachable and where it is not: a template BOUND to a
chart is already narrowed by the policies, so a caller outside the care team
never sees it to be refused for it. The role gate bites on a `patient_specific`
template with no `patient_id` — the shape the original reaches through its
`templates.find(t => !t.patient_id && …)` branch.

**Two smaller things kept deliberately.** A field named twice is interpolated
twice, because the original's `forEach` appends once per entry; the refusals
are de-duplicated because the original has no refusal list at all. And the
phrase is normalised with `bounded_reason`, which performs JavaScript's trim —
the Unicode space separators included — rather than `btrim`'s ASCII one, so
`' vitals stable'` matches where it otherwise would not.

**Not diverged.** A patient-bound template wins over a generic one; an
agency-wide template loses to one the caller authored only by coming second in
the same scan; `usage_count` is incremented on a template that answers and not
on a generic AI expansion; an inactive template answers nothing; and the body
keys stay camelCase because `QuickPhraseTextarea.jsx` sends them (D58).

Port queue: `records_schema` 20 → 19, written 59 → 60.

## D63 — A model's answer decides a column's value and that column's own date

**Decision.** Port `generateFollowUpTasks` on D61's `Task` tenancy, delete its
`SUPER_ADMIN_EMAIL` read and its claim token, and compute each task's due date
from the timeframe that is STORED rather than the one the model sent.

**Three deletions, each already established.** The chart decides, replacing the
`created_by` and `assigned_nurses` reads (D21, D24) — and with them a
`Deno.env.get('SUPER_ADMIN_EMAIL')` comparison, which is the platform tier D14
and D22 removed and **the only reason this capability was ever near a secret at
all**. The patient context in the prompt is the `smart_note_context` projection
and nothing else (D62). And `followup_tasks_claimed_by` becomes the row lock it
was emulating, with the original's own `related_visit_id` + `source` dedupe
doing the work it actually relied on (D46, D58).

**The new rule is a refinement of D54.** `task` constrains `type`, `priority`
and `due_timeframe`, and the thing supplying all three is a model. The original
writes them straight through inside a `Promise.all`, so one plausible but
unlisted answer raises a check violation that loses **every task in the batch**
— worse than D54's per-row `catch`, which at least kept the others. So an
unrecognised value takes the same default an absent one does, and case alone is
not an adjustment.

But there is a second half this port found. The original computes the due date
separately:

```js
const map = { today: 0, '24_hours': 1, '48_hours': 2, this_week: 7, next_visit: 3 };
date.setDate(date.getDate() + (map[timeframe] ?? 3));
```

That lookup is case-SENSITIVE, and the stored value is
`task.due_timeframe || 'next_visit'`. So a model answering `TODAY` gets a row
whose `due_timeframe` is the invalid string `TODAY` and whose `due_date` is
three days out — a task that says "today" and is due on Thursday. **The date
follows the value that is stored**, so the two cannot disagree. An unrecognised
answer still lands on three days, because `next_visit` is the substituted
default and the map gives it three.

**Two smaller narrowings.** A task with no title is skipped and counted rather
than written as a row nothing can act on, and the batch is bounded at fifty
where the prompt asks for two to five and the original bounds nothing.

Port queue: `records_schema` 19 → 18, written 60 → 61.

## D64 — A capability that only reads needs only a read

**Decision.** Port `analyzeClinicalEvents` and `analyzeClinicalTrends` as one
read contract each and nothing behind them, and name every column that reaches
a prompt.

**The third step of D53's sequence is genuinely absent here, not paused.**
Every model-backed port so far has been read, ask, record. These two ask a
model to analyse a chart and hand the analysis straight back; nothing is
stored. Saying so is worth a decision, because the alternative reading — that a
capability which does not write must be waiting on a write contract nobody has
built — is exactly the mistake D47, D55 and D56 each had to correct once.

**The scoping deletions are the established ones.** Both originals read
`assigned_nurses` and `created_by` off the patient row and then scan five
thousand `User` rows to decide whether the patient is in the caller's agency
(D21, D24, D41), and both interpolate the name, the diagnosis and the
medication list straight out of a full service-role row, which D62 bounds to
the `smart_note_context` projection.

**The new rule is divergence 3, and it is one line of SQL.** `clinical_event`
carries `source_text` — the raw note the event was extracted from — alongside
`text_anchor_start` and `text_anchor_end`. The originals build their prompt
context by MAPPING named fields, so neither leaks it today; a contract that
returned the row would. **Every column that reaches a prompt is named**, and a
test seeds `source_text` with a sentinel and asserts it appears in neither
answer.

**Two things kept that look like the artefacts this migration deletes.** The
page limits stay exactly as the originals have them — five thousand unverified
events for the review, a hundred events and a hundred visits for the trends.
D49, D50 and D59 each deleted a limit that existed only to survive a paged
client, and these look the same, but here the page bounds **what goes into a
prompt**: raising or lowering it changes the analysis rather than the plumbing.
And the event grouping is a SUBSTRING test (`strpos`), because the original's
`event_type?.includes('medication')` is one — so `medication_change` is a
medication event, and a row whose type is null is in neither group.

Port queue: `records_schema` 18 → 16, written 61 → 63.

## D65 — The queue put the record store first because the record store did not exist

**Decision.** Where a module reaches the file layer AND its record half is
otherwise clear, report `files` rather than `records_schema`.

**Found by starting a port that could not be written.** `generateNoteFromRecording`
sat in `records_schema`, which a reader takes as *startable today*. It is a
chart read, a transcription and a note — except the transcription is

```js
await base44.asServiceRole.integrations.Core.InvokeLLM({
  model: 'gemini_3_flash', file_urls: [audio_url], …
});
```

and `audio_url` arrives through `isSafeFetchUrl`, whose `FILE_URL_ALLOWED_HOSTS`
names `qtrypzzcjebvfcihiynt.supabase.co`, `base44.app` and `base44.io`. It is
file-bound, and D56 already measured what that means: a data migration, a
`file_url` → `cmfile:` compatibility layer and thirty-one call sites.

**The classifier said so in its own comment, and the comment had expired.**
`classifyWithoutEntities` ends:

> *The entity accesses are masked rather than the classifier reordered, because
> the ORDER is correct for every module this does not apply to: a capability
> that reads a chart AND uploads a file waits on the chart first.*

That was true when it was written. The record store is built now, with
sixty-three ports over it and a chart read that is a repeatable shape
(`clinical_chart_context`, the purpose projections, the contract skeleton). The
chart is an afternoon; the file layer is not. **So a module needing both is not
waiting on the store**, and the bucket named the half that was already solved.

**Six capabilities move**, and the "can be written today" count falls from
sixteen to ten: `createAuthorizedDocument`, `generateAdrPacket`,
`generateNoteFromRecording`, `indexPDF`, `preparePDFWithPatientInfo` and
`processPatientFileUpdate`. `files` goes from six to twelve, which makes it the
largest blocker in the queue by a wide margin and says plainly what the next
piece of infrastructure is.

**The refinement fires AFTER the entity checks, deliberately.**
`entity_not_carried` and `entity_authorization` name a DECISION nobody has
made; the file layer names work that is merely large. A decision outranks size,
so a capability that also writes a profile still reports the profile.

**This is the fourth correction of one kind on this branch** — D47, D55, D56 and
now this — and the rule they share is worth restating in the form this one
takes: **a classifier's precedence encodes what was true when it was written.**
D55 masked entity access rather than reorder, and said why; the reason it gave
stopped holding the moment the store it named was finished. Re-read a
precedence when the thing it ranks first gets built.

Port queue: `records_schema` 16 → 10, `files` 6 → 12. Nothing ported; this
measures.

## D66 — "Generate" named a suggestion, and two compensations went with it

**Decision.** Port `analyzeAndGenerateClinicalTasks` as a read contract and a
model call, with nothing behind them — it creates no task — and delete the two
service-role compensations its lookup carries.

**The name is the trap D64 exists for.** This capability is called "generate
clinical tasks"; it reads the chart, asks a model for three to seven
suggestions, attaches a due date to each and returns them. `Task.create` never
appears. A reader who took the name for a write would go looking for a write
contract that should not exist, which is precisely why D64 made "a capability
that only reads needs only a read" a decision rather than an observation. A
test asserts the absence against the original's own source.

**Two compensations for not trusting a service-role result.** The original
fetches the patient with a limit of **two** so it can refuse when it gets two
rows or a row whose id is not the one it asked for, and then re-checks that
every visit, alert and task it loaded really names that patient:

```js
if (childSets.some((rows) => !Array.isArray(rows)
  || rows.some((row) => row?.patient_id !== patient.id))) { … 409 … }
```

Both are honest defences against a filter that is not proof. Here `id` is half
the primary key and the predicate is the contract's own, so the first can
return nothing to disambiguate and the second is asking whether `where
patient_id = $1` returned rows with a different `patient_id`.

**And the third deletion is D63's, a second time.** `Deno.env.get('SUPER_ADMIN_EMAIL')`
is the platform tier D14 and D22 removed, and this is the second capability
whose only brush with a secret was that comparison.

**One divergence worth the line it costs.** The original maps the visit rows
and calls `.substring(0, 300)` on each nurse's note in the handler — after the
whole note has left the store. The contract cuts it in SQL, so the other nine
hundred characters never travel.

**And one thing deliberately NOT normalised.** The due-date map is
case-sensitive with a `default` of three days, and the model's `due_timeframe`
passes through unchanged. D63 normalises exactly this, because there a STORED
column and its stored date could disagree; nothing here is stored, so there is
no second thing to agree with. The only change is which day it counts from: the
store's own, which the contract returns, rather than whichever zone a service
happened to run in.

Port queue: `records_schema` 10 → 9, written 63 → 64.

## D67 — A spread is a field set nobody chose

**Decision.** Port `extractClinicalEvents` on the established shape, and store
the ten fields its own response schema declares rather than whatever the model
returned.

**The defect is one line of JavaScript.** The original builds each row as

```js
const eventData = { patient_id, visit_id, event_date: visit_date, ...event,
  text_anchor_start, text_anchor_end, verified: false };
await base44.asServiceRole.entities.ClinicalEvent.create(eventData);
```

`...event` is **every key the model returned**. The platform accepts unknown
keys quietly, so a model that answers `verified: true`, `verified_by`, or a
`patient_id` of its own writes them — and `verified` is the field a nurse's
fact-check sets. The contract names the ten fields the response schema
declares, sets `verified` itself, and IGNORES everything else.

**Ignoring rather than refusing is D54's rule, not D59's.** An operator's CSV
column that nobody recognises is a typo worth refusing, because somebody meant
it. A model's extra key is noise, and refusing the batch would lose the events
that were good. The two rules look alike and the source decides which applies.

**Two more the pattern already covers.** `event_date` comes from the VISIT
rather than from a `visit_date` in the request body — the visit is bound to the
patient by then, so its own date is the only one that cannot be claimed. And
`events_extract_claimed_by`, its read-back and the "re-check the claim before
stamping" dance become the row lock they were emulating; the original's own
comment calls its version *"best-effort; not true CAS"*.

**One new divergence.** The follow-up task is assigned to the CALLER, not to
`evPatient.created_by || user.email`. A chart's creator is an address on a
carried row that may belong to nobody in the agency any more, and the original
says in its own comment why the field matters at all: without an assignee *"the
create is rejected and the follow-up task is silently never made"*.

**And one split worth naming.** The text anchors stay in the SERVICE. They are
`indexOf` over a string the caller sent, with a case-insensitive retry, and
reproducing JavaScript's `indexOf`, `trim` and `toLowerCase` in SQL would be a
transcription with nothing to gain — the same call D59 made for the CSV parser.
The rule that emerges from both: **text arithmetic over caller-supplied input
belongs in the service; every decision about what may be STORED belongs in the
contract.** The parity test runs the original's own search over the same inputs
rather than asserting a copy of it.

Port queue: `records_schema` 9 → 8, written 64 → 65.

## D68 — Two thirds of the largest capability is compensation, and one name carries two capabilities

**Decision.** Port `manageAuthorizedReferral` — all six actions — as one
contract, and route the synthetic staging flow that shares its name by ACTION
rather than by name.

**It is 1,275 lines and the contract is 700, and the difference is not
compression.** Five things go, each of them a workaround for something the
owned store has:

1. `validateMembershipRows`, `validateActiveAssigneeMembership` and
   `loadExactEnabledAgency` re-prove a membership row's whole canonical
   lifecycle on every request — `membership_key`, both normalized addresses,
   both transition actors, the instant, the reason, the version floor, the
   status/timestamp coherence — because in Base44 any service-role writer could
   half-write one. `pennsync_private.membership` holds all of it in CHECK
   constraints. This is the fourth time a port has deleted the same code (D34,
   D35, D46).
2. `loadAuthority(…, expectedSnapshot)` runs two to four times per request and
   compares a ten-field snapshot each time. One transaction.
3. `getReferral` reads the row, re-reads authority, reads the row again and
   compares the two projections. `createReferral` re-reads the row, re-reads
   the creation key, re-reads authority, and on any failure calls
   `removeCreatedReferral` — a compensating DELETE, with its own verification
   read. `updateReferral` and `deleteReferral` re-read and re-compare before
   writing and verify every field afterwards. One transaction.
4. `MEMBERSHIP_SCAN_LIMIT`, `USER_SCAN_LIMIT` and `EXACT_ROW_LIMIT` fetch N+1
   rows to prove a lookup unambiguous, because the SDK pages and a filter is
   not a key. `(source_app_id, id)` is the primary key here.
5. `validateReferralIntegrity` re-derives `referral_creation_key` from the
   row's own columns on every row of every list. The key is a column with a
   unique index on it (D30).

**One deletion needed reading twice, and the rule is worth more than the
deletion.** The original writes `where version = <what I just read> and
updated_date = <what I just read>` and answers 409 when that matches nothing.
That LOOKS like optimistic concurrency, and it is not: the client sends no
version, so the predicate is built from a read the same handler performed
microseconds earlier. It is protecting the handler from itself, which is what a
transaction does for free — so `select … for update` replaces it and nothing a
caller relies on is lost. Contrast `updateFleetVehicle` (D46) and
`contract_patient_update` (D29): both originals take an `expected_version` or
an `expected_updated_date` **from the caller**, and both ports keep it. **Read
where the expectation comes from before deciding a version check is
machinery.**

**`list_assignees` needed no SQL of its own beyond a filter.** The original
lists `AgencyMembership` and then, for every row, calls `loadExactAssignee` —
two more queries per person, re-proving a membership and a `User` row. That is
`pennsync_private.agency_roster` (D48) filtered to three roles, in one
statement. D34's rule for the fourth time: **check which store already models
what the original reads.** Note which helper was right: `agency_colleague`
resolves by address and does not carry the membership id and version the
published client validates; `agency_roster` does. `full_name` is null, because
the carried `user` table has no name column (D38, D46).

**D24 narrows this capability, and the narrowing is recorded rather than worked
around.** `referral` has `agency_id` and a top-level `patient_id`, so its
policies carry the chart rule. `office_staff` is an INTAKE role in the original
— the role whose job this is — and opens no chart. So an office_staff caller
sees a referral until it names a patient, loses it the moment it is linked, and
cannot create a linked one at all. An `agency_admin` or `manager` opens every
chart and is unaffected. This is the same shape `contract_patient_update`
recorded, and it is the price of D24 rather than a decision this contract took.
**If it bites in practice the answer is a decision about `office_staff` and the
chart, not an exemption in this contract.**

**The role gate is narrower than D24 in the other direction, and both gates are
load-bearing.** Intake is `agency_admin`, `manager`, `office_staff`. An
assignee is `agency_admin`, `manager`, `clinician`. The two sets are different
in the original and different here: a clinician may be GIVEN a referral and may
not work the queue, and an office_staff member works the queue and may not be
given one. Delete either and the policies would admit the wrong half.

**The defect this port introduced, and how it was found.** Adding
`manageAuthorizedReferral` to `PORTED_FUNCTIONS` broke the synthetic staging
referral flow. `src/lib/independentStagingAdapter.js` routes to the ported
service by NAME, and this is the only Base44 name in the tree that carries TWO
capabilities: the real broker (`list`, `get`, `list_assignees`, `create`,
`update`, `delete`) and the S3 staging flow (`staging_list`, `staging_create`,
…), which the adapter serves from its own RPCs. Every `staging_*` call was
shadowed and failed `STAGING_TENANT_SELECTION_REQUIRED`, because the staging
envelope is `{action, params}` with no top-level `agency_id`. Every other
special-cased name there is the SAME capability served two ways, where
shadowing is the intended fallback — so nothing had ever measured the
difference. The action decides now, and the regression test asserts the
REFUSAL CODE rather than the absence of a request: the broken routing also made
no request, so "nothing was sent" does not tell the two branches apart. **An
assertion that both the correct and the broken path satisfy proves nothing;
sabotage the fix and watch the test fail before believing it.**

**Two smaller things worth keeping.** A top-level null is stripped from the
answer, because the original's `pickFields` yields `undefined` for an unset
column and `Response.json` drops those keys — while `jsonb_build_object` keeps
them, and the published client reads `referral.status === undefined ||
STATUSES.has(referral.status)`, so a null `status` would fail an integrity
check an absent one passes. Stripped at the TOP LEVEL only: `jsonb_strip_nulls`
is recursive and would reach inside `extracted_data`, editing a caller's own
payload on the way out. And the fourteen `follow_up_requests` capability fields
— the portal token and submission provenance, the inbound-fax binding, the
stale worker's claim markers — are stripped from what a caller sends and
carried across from the stored row when the `generated_at` INSTANT matches,
never its text: a client that reformats the same moment must not reset a claim.

Port queue: `records_schema` 8 → 7, written 65 → 66.

## D69 — A three-way gate with two dead branches, and a column with no source

**Decision.** Port `generateUserRosterPDF` on a contract that delegates its
paging to D22's roster, gates on `agency_admin`, and counts its summary over
the whole agency. Drop the Name column rather than filling it.

**The gate reads wider than it is, and that was worth measuring.** The original
admits

```js
user.role === 'admin' || user.account_type === 'agency_admin'
  || user.account_type === 'super_admin'
```

and `account_type` has already been through the shared `withTrustedClaims`
helper, which **strips** a claimed `agency_admin` or `super_admin` back to
`'user'` unless a canonical ACTIVE `AgencyMembership` says otherwise. So:

- `account_type === 'super_admin'` can never be true — `super_admin` is in
  `PRIVILEGED_PROFILE_ACCOUNT_TYPES`, so a profile claiming it is demoted, and
  the trusted branch only ever writes `'agency_admin'` or the non-privileged
  base. The test is dead code.
- `account_type === 'agency_admin'` means "holds an `agency_admin` membership".
- `role === 'admin'` is the platform tier D14 and D22 removed.

**So this is NOT one of D40's widenings**, which is what it looked like before
the helper was read. An `agency_admin` could already run the report; what
leaves is the platform admin. D36's rule with the polarity reversed: there, a
comment promised a capability the code never gave; here, a gate appears to
offer three ways in and has one. **Read what the code can reach, not what it
appears to offer** — and note that the test proved it by DRIVING the original
through that helper with a canonical membership row, not by reading it.

**The derived scope goes, for the fourth time.** The original lists 5,000
`User` rows across every tenant and keeps the ones whose `agency_name` STRING
matches the caller's — plus every row whose `account_type` is `super_admin`,
which put the removed platform tier into every agency's report. This is the
reconstruction D41 and D43 delete, and `caller_roster(agency)` is the answer
the authority store already holds.

**Why a second roster contract rather than reusing the first.** The answer is
the same; the GATE is not. `contract_roster_list` admits every member, because
35 capabilities want the working roster, and reusing it would have handed a
clinician the agency's staff report. So `contract_roster_report` gates and then
**delegates** — it calls `contract_roster_list` for the page rather than
copying the keyset, the two cursor refusals and the projection. That makes two
of its four declared refusal codes INHERITED, which is the exception to "each
contract declares its own": a code can cross when one contract really calls
another, and the suite raises both through it rather than asserting the
comment.

**The summary is counted over the whole agency, not the page,** because the
original counts its entire unpaged list. A first page reporting "Total Users:
25" for an agency of 600 is worse than no total. The handler walks every page
for the table and takes the summary once — and the walk is **bounded**, because
a contract answering a cursor equal to its own input would spin.

**There is no name, and the column goes.** The carried `user` table has no name
field (D38, D46), so `full_name || 'N/A'` has no source. Three answers were
possible: print 'N/A' down the page, substitute the verified address as D46
did, or drop the column. D46's substitution worked because there was no
adjacent email field; here there is one right beside it, so substituting prints
the same string twice. The column goes and the five that remain take its 60mm.
The parity test expresses exactly that as one transform of the original's
recorded calls — **scoped to the table**, because the summary draws
`Total Users:` at x=15 and `LPN:` at x=250, the same coordinates the Name and
Status columns use, so an x-only rule would have deleted the total and moved
the LPN count.

**Two more columns stop reading a self-editable label.** `Status` was
`u.is_approved || u.role === 'admin'` and is now the identity being enabled —
an authoritative, one-way fact, and the right one: a colleague who can no
longer sign in while their membership stands is exactly who a roster report
should show as pending. `Role` was `u.role || 'user'`, the Base44 built-in,
which is `'user'` for everybody but the removed tier — a column of one value —
and is now the tenant role.

Port queue: `records_schema` 7 → 6, written 66 → 67.

## D70 — A capability whose entire gate is what three decisions removed

**Decision.** Port `generatePatientChartPDF`. Its authorization becomes the
chart policies, because its own gate no longer exists; every column reaching
the prompt is named; the `SecurityLog` write becomes D25's trail.

**All three of its tests are gone.** The original admits a caller who is

- `normalizeProtectedEmail(patient.created_by) === callerEmail` — an address on
  a carried row, which is the derived scope D41 and D43 delete;
- in `patient.assigned_nurses` — which `listAuthorizedPatients` says **in its
  own header** is not authority, and which the D24 backfill refuses to read for
  a reason that applies exactly here: the address stays on the patient row
  after an assignment is suspended, so reading it resurrects access somebody
  revoked;
- `isProtectedSuperAdmin(user)` — the `SUPER_ADMIN_EMAIL` platform tier D14 and
  D22 removed.

So the port adds no gate at all. `patient_read`, `visit_read` and
`incident_read` narrow to the care team (D24): an `office_staff` member opens
no chart and is refused by the read, a clinician opens the charts they are
assigned, and an `agency_admin` or `manager` opens every chart in their agency.
That is **narrower** than the original where it matters — a revoked nurse whose
address is still on the row no longer qualifies — and wider only where D24
already decided it should be. When a capability's whole gate is made of things
earlier decisions removed, the answer is not to reconstruct it; it is to check
that the policies already say what it was trying to say.

**The projection is the widest in the application, so every column is named.**
The prompt carries the patient's home address, telephone, electronic address,
physician's contact details and emergency contact alongside diagnoses,
allergies, medications history, vitals, functional status, social history and
advance directives. D64's rule earns its keep here: `select *` would have meant
a column added to `patient` reaching a model because somebody regenerated a
migration. The test reads the twenty-two columns **out of the original's own
template** — and had to widen its scan past the template itself, because
`secondary_diagnoses` and `past_medical_history` are joined into locals a few
lines above it and a regex over the template alone reported twenty.

**Three things about the original worth recording rather than fixing.**

1. **It renders no PDF**, despite its name. It asks a model for formatted text
   and answers with the text; nothing in it touches a PDF library. Same reading
   D64 made of `analyzeAndGenerateClinicalTasks`, whose name says generate and
   which creates nothing. Kept, because correcting it would change what a
   caller receives.
2. **What the model contributes is formatting.** A deterministic renderer, of
   the kind `documents.mjs` already holds three of, would produce the same
   document without sending a complete chart to a model at all. That is a
   product decision rather than a porting one, and it is recorded here for the
   owner rather than taken.
3. **It has no caller in the SPA.** `src/` references it nowhere; only two
   Base44 contract tests do. It is ported because its disposition is `port` and
   removing a capability is not a porting decision — but if it is to be wired
   up, point 2 is the moment to decide it.

**Two smaller carries.** The `includeVisits` / `includeIncidents` flags stay
booleans-only, and the original says why in its own comment: they reach a
privileged audit record, so a caller-supplied object or string could put
arbitrary data — or PHI — into it. And the trail entry carries those two flags
and the patient id and nothing else; the original's `ip_address: 'server-side'`
is dropped rather than carried, because a constant standing in for an address
is worse than an absent one (D36).

Port queue: `records_schema` 6 → 5, written 67 → 68.

## D71 — `created_by` was there because `patient_id` could not be trusted

**Decision.** Port `searchPDFs` with the corpus decided in SQL and BM25 in the
service, and delete the `created_by` scope its own comment explains away.

**The original says it plainly:**

> Unscoped searches cannot safely infer PDFIndex ownership from the mutable
> `patient_id` relationship, so an ordinary caller is restricted to Base44's
> immutable `created_by` field.

So a search with no patient returns only rows the caller CREATED, and a search
naming one proves access through `created_by`, `assigned_nurses` or the
`SUPER_ADMIN_EMAIL` owner. Every part of that exists because the relationship
could not decide who may read a row. **It can now.** `PDFIndex` is one of
D61's twelve: it carries `agency_id NOT NULL`, and `pdf_index_read` is agency
plus the chart wherever a subject is named.

Both directions of the change are D24's rather than this contract's, and both
are worth naming. A clinician **gains** their team's charts' documents — which
is what a care team is for — and **loses** rows they created for a chart they
have since been taken off, which is exactly what a revocation should do and
what `created_by` could never express. An `office_staff` member reaches only
the rows that name no patient.

**The split is D67's, and this is the case that makes it concrete.** BM25 is
text arithmetic over a query somebody typed: a token regex, a logarithm, a
length normalisation and a tie-break. Reproducing it in SQL would be a
transcription with nothing to gain, exactly as D59 concluded for the CSV parser
and D67 for the text anchors. Which rows enter the corpus, and whether their
extracted text travels with them, is the contract's — because that is a
decision about what may be READ.

**Two bounds are kept because they are disclosure controls rather than paging,
which is the distinction D50 asks for.** The count mode projects no row at all
— the original calls it "a safe broker for the browser badge", and its corpus
is the extracted PHI of every indexed document, so a count that carried text
would be a search nobody asked for. And the `limit * 2` fetch cap stays, with
its ceiling re-applied in SQL: a bound a caller could raise is not a bound, and
the original's own comment records the cost — a caller sending `500000` pulls
the entire index into memory per request.

**The scorer's parity is D57's, not a table of numbers.** The test lifts the
original's `tokenize`, `buildBm25`, `bm25Score` and `extractSnippet` out of
`entry.ts`, imports them, and runs both implementations over the same corpus
for seven queries — then rebuilds the composite score, the fuzzy gate and the
sort from the original's own pieces and compares. Perturbing any constant in
either fails it.

**One thing is carried unfixed and said so.** `extractSnippet` coerces its
TEXT — the original's comment explains why: "a keywords-only index match can
reach here with no `extracted_text`" — and then reads `query.length` raw, so an
undefined query throws. It is unreachable, because the handler refuses a query
shorter than two characters before anything is scored, and a divergence there
would change the window for a real value. The test asserts the throw rather
than papering over it.

**And `pdf_url` is not projected.** The original spreads the whole index row
into each result (`...doc`); `pdf_url` is a locator into Base44's storage,
which is exactly why `PDFIndex` is outside the generic family (D16). The
corpus names the eight columns the scorer reads and no more.

Port queue: `records_schema` 5 → 4, written 68 → 69.

## D72 — A field list is not an invention when it is measured

**Decision.** Port `getDashboardData`. Its five collections are projected by
name, and the names come from the dashboard's own widgets rather than from a
judgement about what a dashboard ought to show.

**This is the port that was parked**, and the note against it was right: the
original returns five WHOLE entity rows — `patients`, `visits`, `incidents`,
`recentCompletedVisits`, `carePlans` — with no projection at all, D64 requires
every disclosed column to be named, and two of those entities have no extracted
read purpose to name them from. "Inventing two field lists is a decision, not a
transcription."

**What unparked it: the lists exist already, in the consumers.**
`todayPriorities.js`, `coreWorkQueues.js`, `RealTimePatientAlerts.jsx` and
`SmartRouteOptimizer.jsx` name every field they read. The projection is those
fields, and **the test re-derives it from those four files**, so a widget that
starts reading a new column fails the build instead of silently receiving
`undefined`. That is D57's shape (run the original's own block) and D70's (read
the original's own template) applied to a third kind of source. **Before
deciding that a field set has to be invented, check whether the code that
consumes it has already written one down.**

**And the derivation found three defects in the live product.** Four fields
those widgets read exist in NEITHER the record store nor the Base44 entity
schemas:

- `patient.risk_level` and `patient.hospitalization_risk`. The "N high-risk
  patients to review" priority is computed from them and from a `riskLevel`
  spelling that is also absent — so **that priority can never fire**, in Base44
  today as much as here.
- `visit.note_id`. The "N completed visits need notes" priority is
  `visit.status === 'completed' && !visit.note_id`, and with the field always
  undefined the negation is always true — so it **over-reports**, counting
  every completed visit rather than the undocumented ones.
- `patient.full_name` and `patient.name`, the two fallbacks in `patientName()`.
  Neither exists; the names always come from `first_name` and `last_name`
  (D38's family again).

None is invented here. The projection carries what the store holds, the
behaviour is unchanged, and the three are recorded — the same treatment D45 and
D51 gave the notification envelope. Fixing them means adding columns and
deciding what populates them, which is a product decision rather than a port.

**Three deletions, each an earlier decision's.** `patientBelongsToCaller` is
`patient.created_by` plus `patient.assigned_nurses`, exactly as in D70, and
`patient_read` answers it. `isProtectedSuperAdmin`'s cross-tenant branch is the
platform tier D14 and D22 removed, and what it was for at tenant scope is
D24's: an `agency_admin` or `manager` opens every chart in their agency. And
the five SCAN limits go while the five DISPLAY limits stay — D50's distinction —
because the scan limits exist only to over-fetch so a JavaScript filter can
re-check what a service-role query returned. The policies are the boundary.

Port queue: `records_schema` 4 → 3, written 69 → 70.

## D73 — A reviewer's field is not made a caller's by adding an endpoint that wants it set

**Decision.** Port `submitStateReportableIncident` as a SIBLING of
`contract_incident_submit`, not as an argument to it. The PDF retention and the
email are paused by name and reported as paused; the notification fan-out is
not, because a notification is a row.

**Why a second contract rather than a flag.** D44 made `severity`,
`state_reportable` and `ai_tags` reviewer-only on a submit, and its header says
why: they are the inputs to the resolve gate. A caller who could pass
`state_reportable: true` to the ordinary submit would have that control back.
So this endpoint **sets both itself**. The reporter chooses the event TYPE —
one of the state's codes — and the contract decides what that means for the
record: `state_reportable` true, `severity` high, and an incident type derived
from the code. **A field a reviewer decides is not made a caller's by adding an
endpoint that wants it set** — the same rule as D67's `verified` and D29's
`reserved`, applied to an endpoint rather than a payload.

The type mapping is the original's and is a reporting requirement rather than a
convenience: its own comment says mapping the state code onto a real
`incident_type` is what makes "these — the most severe events — appear in
falls/hospitalization/med-error aggregates instead of vanishing into 'other'."

**The fifth PARTIAL port, and both pauses are reported.** The PDF retention
calls `createAuthorizedDocument`, which is the file layer — the largest
remaining blocker, and porting it verbatim would carry Base44's storage host
into the service. The email is `Core.SendEmail`, D56's open owner decision, as
for the invitation send and four others. Neither is silently skipped: the
answer carries `document_retention_paused` and `email_paused`, and — following
D42 — the incident's own `details` record both, so the compliance record cannot
read as though a document was retained or a message went out. `alert_triggered`
stays false for the same reason, which is the original's own discipline: it
raises those flags only after a side effect succeeds.

**The fan-out is not paused, and the alert names no patient.** A notification
is a ROW rather than a message (D51), so it ships. Its recipients are the
agency's active `agency_admin` memberships through
`pennsync_private.agency_roster` — not the original's 5,000-row `User` scan
filtered by `role === 'admin'` crossed with the patient's `created_by` and
`assigned_nurses`, which is the removed platform tier crossed with D41's
derived scope. And D44's naming rule bites harder here than anywhere: the
original's message is *"<reporter> submitted a state reportable event for
<patientName> on <date>"*, `notification_read` is agency-WIDE, and D24 narrows
a chart to its care team — so an `office_staff` member who opens no chart would
have read the name of a patient in the most serious incident class the product
has.

**Two smaller carries.** The reporter on the record is the VERIFIED address,
not `payload.submitted_by_name`: the carried `user` table has no name column
(D38), and a compliance record naming whoever the form said is worse than one
naming the account that filed it. The claimed name still appears inside the
report narrative, which is the clinician's own account of the event. And a
caller-supplied `report_text` still wins over the generated one, because a
clinician who edited the narrative in the form is submitting what they wrote.

**One test note worth keeping.** Two assertions here scan the contract for the
gates and the integrations it deletes — and both failed first, on the contract's
own HEADER, which names all of them while explaining what it removes. The scans
strip comments now. A check that reads a file for an absent name has to say
whether it means absent from the code or absent from the page.

Port queue: `records_schema` 3 → 2, written 70 → 71.

## D74 — The claims helper reads authorization, not records

**Decision.** A capability whose ENTIRE entity reach is the generated
`trustedCallerClaims` helper is not waiting on the record store. Re-classify it
by what else it needs.

**The fifth correction of this shape**, after D47, D55, D60 and D65, and the
same sentence every time: *a bucket keeps its name after the reason for it has
gone.*

`trustedCallerClaims` reads `AgencyMembership` and `Agency` to answer one
question — what tenant role does this caller hold. The ported service answers
it from the request envelope: `resolveAuthority` runs on every request, and
**D34 already settled** that those two are the authority store's native model
rather than anything `pennsync_records` was ever going to serve. The classifier
did not know, because its rule is "touches an entity → `records_schema`", and
that rule was written before there was a second store to be native to.

**It fires on exactly one capability in the queue, and the effect is the
number the plan leads with.** `sendAccountReadyEmail`'s whole body is one
`Core.SendEmail` behind an admin gate — it reaches no record at all — so
reporting it as startable-today said a capability could be written whose only
work is the send D56 has not decided. It reads `core_integration` now, which is
**the answer the classifier had already computed** in `entityFreeBlockers` and
was discarding. `records_schema` 2 → 1, `core_integration` 2 → 3.

**Measured, not asserted.** The set is derived by removing the fence and
re-running the SAME extractor the classifier uses: a module that also reads a
real row keeps its entities and is untouched. That matters because three other
capabilities have all their entity references inside a shared helper and are
NOT in this set — `discoverTelnyxResources` and `retryFailedFax` read
`IntegrationSecret`, `AgencySettings` and `FaxRetryConfig` through their own
credential helpers, and a credential is a record. Only the claims helper is
authorization.

`autoImportPatients` also qualifies and is `preserved_paused`, so it is in no
bucket and the refinement changes nothing for it — which is the check that this
fires where it should and nowhere else.

**One capability is left waiting on the record store**: `processCompletedVisit`,
which writes `Task` and `Notification` and is real record work.

Port queue: `records_schema` 2 → 1, `core_integration` 2 → 3, written 71.

## D75 — A flag pinned `true` is the same pause written the other way round

**Decision.** Teach the paused-at-source check the second polarity, and move
`processCompletedVisit` to `preserved_paused` in the same change.

**This is D47's failure for the third time, and its own lesson for the third
time.** D7 named the shape `const RELEASED = false` with `if (!RELEASED)
return refusal`. D47 found nine modules pausing with **no flag at all** — an
unconditional return as the handler's first statement — and taught the check
`isRefusingHandler`, writing down the rule it had just re-learned: *when a
check exists to stop a class of mistake, re-derive the shapes from the tree
rather than from the check.*

The tree also uses the polarity the check never learned:

```js
const PROCESS_COMPLETED_VISIT_PAUSED = true;
Deno.serve(async (req) => {
  if (PROCESS_COMPLETED_VISIT_PAUSED) {
    return Response.json({ error: '…temporarily unavailable…' }, { status: 503 });
```

**Thirteen modules pause this way and the check detected none of them.** Twelve
already carried `preserved_paused`, because somebody had read them — which is
the evidence that the hand-dispositioning was right and only the automated
check was blind. The thirteenth carried `port`.

**That thirteenth was the last entry in the `records_schema` bucket**, reported
as the single capability that could still be written against the record store.
It refuses every caller. So the number the plan leads with reached zero on a
CORRECTION rather than on a port — which is the honest way to say it, and the
fourth time this migration has had to.

`records_schema` **1 → 0**. Nothing is left waiting on the record store: every
capability that could be written against it has been written. What remains is
twelve on the file layer, eight on what a read policy cannot give, seven on
domains that are going away, three on `Core.SendEmail` (D56), two on
third-party keys, and one on another port.

**D47's rule applies to the disposition too**: *switching a capability off
means changing its disposition in the same change.* `processCompletedVisit` was
switched off long ago and the disposition never caught up, so the widened check
contradicted it until it did — which is the gate working.

Port queue: `records_schema` 1 → 0, written 71.

## D76 — "Waits on that one" stopped being true the day that one was written

**Decision.** Teach `ported_function` to ask who the callee is, and port the
capability it was holding — `extractReferralDataForSmartNote`.

**The seventh correction of the recurring shape, and the first that ends a wait
rather than renaming one.** D47, D55, D60, D65, D74 and D75 each found a check
or a bucket keeping its name after the reason for it had gone, and each moved
capabilities between categories. This one moves one from blocked to startable.

*This paragraph first read "the sixth" and listed five, dropping D60 — which
D74's own entry counts in the series. Corrected at D79, which needed the
ordinal to be true before it could claim one.*

The rule was a single unconditional line:

```js
if (/\bbase44\s*\.\s*functions\b/.test(source)) return 'ported_function';
```

and the bucket's own documentation says what it means: *"calls another Base44
function, so it waits on that one."* It answers on the SHAPE of the call.
Nothing ever asked who the callee was, so the queue went on reporting the wait
for sixty-eight ports after **D68 wrote the thing being waited for.**

`discoverPortedFunctions` was already in the file, with a comment reading
*"Nothing blocks a port that has happened"* — but it was only consulted about
the capability itself, never about what the capability calls.

**The discovery fails closed.** Every `base44.functions` reach is counted and
only the two shapes the tree uses are parsed — `invoke('name', …)` and
`fetch('/name', …)`, the second addressing the function by PATH. A reach the
parser does not consume leaves the set `dynamic`, and a dynamic set claims
nothing: `testAutomations` invokes a name it was handed, which is the same case
`entityReach` refuses to claim anything about for a computed key. Eleven
modules invoke a function; ten are enumerable and one is not.

**The port itself was almost entirely already written.** The transform and its
admission-note template were built and parity-pinned long ago, and
`api.test.mjs` carried an assertion that the handler was NOT registered, with a
comment stating the reason:

> It needs an authorized referral read that this service does not yet have;
> exposing it would let a caller supply its own referral payload.

D68 built that read. The reason expired and the assertion outlived it, which is
this decision's shape in miniature — a guard that records why it exists is the
kind that can be retired honestly.

**What the port deletes is the cross-call half of D68's rule.** Between
invoking the broker and mapping its answer, the original runs `exactKeys` over
the envelope, re-checks `referral.agency_id !== agencyId`, requires a safe
integer version and parses two dates. Every one of those asks *did the other
function answer about the thing I asked about* — the cross-call form of the
compensations D68 deleted for having no transaction. A contract taking
`p_agency` and `p_referral_id` and selecting on exactly those cannot answer
about a different referral.

Its `INTAKE_ROLES` check goes for **D69's** reason rather than this one:
`referral_authority` admits `agency_admin`, `manager` and `office_staff` and
nothing else, so the refusal is INHERITED from the contract this delegates to.
A clinician who may be ASSIGNED a referral still cannot seed a note from one.

**What is not machinery is the `extracted_data` check.** A referral nobody has
run the extractor over has nothing to seed a note with, and `referral_row`
drops null-valued keys, so an unprocessed referral arrives with no such key at
all rather than a null one.

**The port found a gap in D68's own suite.** `exactObject` refuses an unknown
key and does not require a known one, so a caller sending `{}` reaches the
contract with a null id — and nothing proved that `contract_referral_get`
refuses it. It does, with `PENNSYNC_REFERRAL_ID_INVALID`, and now a test says
so; sabotaging the guard fails it. **A refusal a handler depends on needs a
test on the side that raises it**, not on the side that inherits it.

Port queue: `ported_function` 1 → 0, written 71 → 72.

## D77 — Half the file census has nothing here to re-point

**Decision.** Build the two halves of D56's file work this repository can hold
— the `file_url` → `cmfile:` mapping with its resolver, and the copy PLANNER —
and record that the copy-and-rewrite scope is **34 locator fields across 27
entities**, not the census's 66 across 58.

**The measurement came first and changed the shape of the work.** The census
(`tools-file-reference-census.mjs`) lists every field in every entity schema
that can hold a retrievable address. Split by disposition:

| Disposition | Entities | Locator fields |
| --- | ---: | ---: |
| `port` (carried) | 27 | **34** |
| `preserved_paused` | 17 | 18 |
| `hub` | 8 | 13 |
| `retire` | 1 | 1 |

**An inventory should be complete and a rewrite should not.** You look at every
file before deciding what to do with it, so the census stays at 66. But a
locator on `FaxLog`, `TrainingModule` or `CallLog` has no row in the record
store to re-point — those entities get no table at all — so copying their bytes
into this store's bucket would be copying them for a reader that does not
exist. The planner reports both numbers and refuses to merge them.

### The mapping, and why it is immutable

`20260920520000_file_locator_map.sql` creates `pennsync_private.file_object`
and `pennsync_private.resolve_file_locator(text)`. Four properties are the
whole design, each proved rather than asserted:

**It is not a place a caller reads.** A locator is projected by the contract
that authorizes the read of the row holding it — D71 makes that explicit by
deliberately NOT projecting `pdf_url` from `pdf_index`, *because a storage
locator is why `PDFIndex` is outside the generic broker family at all*. So the
table has forced RLS and **no policy**, like `chart_assignment`, and the
resolver is granted to `pennsync_records_owner` alone with no public wrapper,
like `claim_new_chart`. A caller who could ask it directly would be asking
about a file without having read the row that references it.

**It is keyed on the locator, not on (entity, row, field).** A `Document`, the
`DocumentVersion` under it and a `Referral` naming the same upload are three
paths to one object. Keying on the row would copy it three times and let two of
the copies drift.

**A mapping is immutable, and that is load-bearing.** Every carried row holding
a legacy URL resolves through this table, so remapping one locator silently
repoints every row referencing it at different bytes — a patient's document
becoming another patient's, with nothing in either row changed to show it.
D32's rule in its strongest form: the trigger refuses every update and every
delete, including of a column that looks harmless.

**It fails closed.** An unmapped legacy locator resolves to **null**, never to
itself. The tempting alternative is exactly what D56 forbids: *"Do not widen
the allowlist to unblock yourself."* A fallback that returned the input would
hand a Base44 storage URL back to a caller that asked for an owned handle, and
the caller would fetch it — carrying that host into the service the exit exists
to remove, silently, for precisely the rows the copy missed. Sabotaging this
one line fails three tests.

**And an owned handle passes straight through**, because the write side is
already owned: the integration runtime returns durable private `cmfile:`
handles from both uploads, so a row written after cutover needs no mapping and
a resolver that demanded one would break the half that already works.

### The planner, and the asymmetry it inherits

`tools-pennsync-file-copy.mjs` copies nothing. Like the census it contacts no
app and downloads no object; like the D24 backfill it plans from an operator's
export, reports, and applies only a plan whose digest matches what was
reviewed.

**The backfill's asymmetry is sharper for files.** A copy that DROPS a file is
a support ticket — somebody opens a document, it is not there, and they say so.
A copy that maps a locator to the WRONG BYTES is a disclosure, and nobody
reports it, because the row looks right to the person now reading another
patient's document. So every ambiguity skips, every skip is named by FIELD (never
by row), and a locator the copy did not produce is dropped rather than guessed
at. That is also why the database mapping is immutable: a plan that mapped a
locator wrongly cannot be corrected in place.

Two details worth keeping. `isStorageLocator` matches a host exactly or as a
suffix after a dot, never as a substring — `notbase44.app` and
`base44.app.evil.example` are not Base44, and a test drives both. And the
`uncarried_entity` check runs AFTER the shape checks, so an unfamiliar path on
a paused entity is still reported as unfamiliar: a census the schemas have
outgrown is a finding whatever the disposition says.

### The test defect worth recording

The first draft of the planner's suite typed its own field paths —
`DocumentVersion.file_url` and `FaxLog.file_url`. The real ones are `pdf_url`
and `document_url`, so the deduplication test was exercising `unknown_field`
while claiming to exercise deduplication, and passed two of three references.
**D72's rule arriving as a test defect**: before deciding a field list has to
be written, check whether something has already written it down. The paths are
read from the census now, so a census change fails the build.

### The cross-contract test, and the second defect it took to get right

The PLANNER computes `locator_key` in JavaScript and the RESOLVER recomputes it
in SQL. If they ever disagreed, every mapping would be invisible — resolving to
null, which is exactly what an unmapped locator does — and **both suites would
go on passing**, because the planner's compares its key only to itself and the
migration's computes the key the same way the planner does. That is D45's rule
in the shape that makes it necessary, so a test drives a plan all the way
through `applyFileCopy` into the database and reads it back through the
function.

Its first draft did not work, and the way it failed is the lesson. The locator
it used was `…?v=3&x=%20%C3%A9` — described in its own comment as "a non-ASCII,
query-bearing locator on purpose", and **entirely ASCII**, because `%C3%A9` is
percent-escaped text rather than the character it encodes. Changing the
planner to hash in `latin1` instead of `utf8` left both suites green. With a
RAW `é` in the locator the planner's twelve tests still pass and the
cross-check fails, which is the whole point of having it.

**Sabotage is what told the two apart.** A test whose comment describes
something the test does not do reads exactly like one that works.

### What this does not do

The copy itself needs a live Base44 app and a live bucket. Nothing here fetches
an object, and the twelve file-bound capabilities stay blocked until an
operator runs the plan — but what they wait on is now DATA rather than design,
which is what D56 said it should be.

### One thing the copy is blocked on that is NOT data: who may open a copy

The mapping is keyed on the locator, so one upload referenced by three rows
becomes **one** owned handle — the property that stops two copies drifting,
and also the sharp end. The runtime that would serve that handle is
**uploader-owned**: `services/integration-runtime/providers.mjs` admits a row
only when its `subject` equals the caller's hashed subject, the object path
embeds that subject, and `cm_integration_files.id` is a primary key, so the
same handle cannot be registered once per reader. A migrated object has no
uploader. Whichever subject the copy ran as would be the only person who could
ever open it; every other authorized caregiver would get `FILE_ACCESS_DENIED`.

That model is right for what it was built for — a file a caller uploaded in
their own session — and wrong for a carried row whose readers are decided by a
contract. **This decision does not change it.** Giving the runtime record or
tenant authorization is a decision about that service's authorization model,
not about this table, and D56's rule applies to an ownership check exactly as
it applies to a host allowlist: do not widen it to unblock yourself.

What D78's rule about checks demanded here is that the constraint not live only
in this paragraph. **So `applyFileCopy` refuses every apply**, unconditionally,
and the first attempt at that is worth recording because it read as a control
and was a hint.

That version took a `readerModel` from the operator, refused `uploader_owned`
by name and **accepted `record_authorized`** — which nothing implements. The
label was never checked against anything, so the only accepted value was the one
that cannot be true, and the refusal message named it: an operator following the
error would type the word that let immutable rows be written for handles nobody
but one person can open. **Pre-allowing the name of a model nobody has built is
worse than no check at all, and an attestation a tool cannot verify is not a
control.** Codex caught it on the revision that introduced it.

So there is no label. `RUNTIME_READER_MODEL` pins what the runtime implements,
`REQUIRED_READER_MODEL` what a migrated object needs, and the refusal is that
they differ — which makes lifting it one line when the decision lands. The pin
is a fact about another service, so a test reads that service's own two checks
and fails when either goes.

The capability splits from its primitive so the refusal costs nothing else:
`fileCopyRows` validates and builds the rows, `writeFileObjects` is the
transaction and the lock, and `applyFileCopy` is the refusal plus both. The
round-trip test drives the planner's own `locator_key` through those two into
the database and back out through the resolver, because that property — the key
the planner writes is the key the resolver reads — is about the two halves of a
hash agreeing, not about whether a copy may be recorded. Sabotaging the
encoding still leaves the planner's own suite green and fails only the
cross-check, which is what having it is for.

Note also which way this fails. An unopenable handle is `FILE_ACCESS_DENIED` —
a loud refusal and a support ticket, the same safe half of the asymmetry the
planner already takes when it drops an ambiguous locator. It is not a
disclosure.

## D78 — The trap this repository wrote down, and then walked into twice

**Decision.** Two ported contracts were guarding a create-if-absent with
`select … for update`, which **locks nothing when the row does not exist**.
Give each the composite unique index its correctness was already assuming,
enumerate those keys in the generator rather than hand-writing them beside the
contracts, and prove both with two real connections.

**The defect is the same one, in two capabilities.**

`contract_timesheet_submit` looks for a timesheet matching `(agency, employee,
service line, pay period)`, refuses when it finds one, and inserts when it does
not. Two submissions of one period — a retried request, a second tab — both
found nothing and both inserted. The original's own comment says what that
costs: *"Prevents a duplicate row from being double-counted in payroll."* The
port kept the sentence and lost the guarantee.

`contract_visit_points_save` has the same shape over an agency's point
schedule. An agency setting one for the first time from two sessions ended up
with two active configs, and since every reader takes `active is not false`
with `limit 1`, which one paid its nurses depended on an `order by`.

**What makes this worth a decision rather than a patch** is that D33 already
wrote the rule down, about `chart_assignment`, in this document:

> `select … for update` serializes nothing when the row does not exist, so two
> concurrent grants both reach the insert, and the contract catches
> `unique_violation` … **by name**.

Two later ports were written with exactly the shape that paragraph warns
about. Neither could be caught by its own suite: PGlite is one connection, and
one connection cannot interleave. **A rule in a document is not a check.** The
only reason these were found at all is that a reviewer read the SQL.

### The keys are generated, and each one names the contract that catches it

`pennsync_records` table DDL is generated — that is the repository's rule, and
an index hand-written beside a contract would split the source of truth for a
table's shape. So `CONTRACT_UNIQUE` in `tools-entity-schema-plan.mjs` is a
second, separate family beside `DECLARED_UNIQUE`, and the distinction is real:

| | `DECLARED_UNIQUE` (D30) | `CONTRACT_UNIQUE` (D78) |
| --- | --- | --- |
| Where the claim comes from | the entity SCHEMA's own description | a hand-written CONTRACT's correctness |
| Shape | one column | a composite business key |
| Checked against | the schemas, in both directions | the planned columns, and the contract's catch |

Each entry owes its columns, a reason, **and the contract and migration that
depend on it**. That last pair is what makes the index NAME checkable, and D30
is the reason it has to be: it says a rename *"turns a correct retry answer
into a raw database error"* — and then nothing checked it for sixty ports.
`tools-entity-schema-plan.test.mjs` now reads the named migration and fails
unless it compares the caught constraint against exactly this index. Renaming
one key fails four tests.

**Columns only, never an expression.** Free SQL in a generator is a predicate
nobody re-derives. The timesheet's lookup normalises with
`lower(coalesce(employee_email, ''))`, so a plain-column index is only
equivalent because the contract WRITES `caller_email()` and
`pennsync_private.identity_map` constrains `expected_email` to
`lower(btrim(expected_email))`. That is an argument the enumeration's reason
has to make, not something the emitter may assume.

**The point-config index is partial over active rows, and that is the general
rule: constrain exactly what is relied on.** A whole-table key would have said
one schedule per agency ever, which is a narrowing of the entity nobody asked
for; a deactivated schedule is history it may keep, and no reader consults it.

### The two answers are different, and both are the uncontended one

The timesheet's loser is **refused**, with the same code the lookup gives for
the same state — a duplicate period is not a legitimate second request. The
point config's loser is **answered**: saving your own agency's schedule twice
is legitimate, so it retries once and lands on the winner's row rather than
beside it, carrying the values this caller sent. In both cases the caller
cannot tell a race from the uncontended path, which is the point.

### Proved with two connections, and watched failing

`record-contract-postgres.test.mjs` gains both races. What they assert is the
**block** rather than the row count: with the two indexes commented out of the
generated migration the second caller does not wait for the first, so the
lock-wait assertion is what fails, seconds before any duplicate is counted.
Four tests fail under that sabotage. That is the only way to tell a test that
works from one that merely passes — and given that this decision exists because
a written-down rule was not a check, it seemed worth doing to the check as well.

## D79 — Two buckets describing rules they had stopped using

**Decision.** Correct what `entity_authorization` and `CARE_TEAM_SIGNALS` say
they measure, pin both against the tree, and record that the port queue has
nothing startable left.

**The eighth correction of the recurring shape, and the first where nothing
moves.** D47, D55, D60, D65, D74, D75 and D76 each found a check or a bucket
keeping its name after the reason for it had gone, and every one of them
reclassified capabilities — a count changed, and the change is what made the
correction visible. Here the classifier is right, the counts are right, and
what is wrong is only what a reader is told. That is the harder version of the
same defect: nothing fails, so nothing surfaces it.

### `entity_authorization` describes a rule that fires on nothing

Its paragraph says the bucket is *"the module reads a carried entity that has
forced RLS and no policy. That is `User`"*, and that what it now counts is *"a
roster read waiting on that RPC"*. Measured against this tree:

- `discoverPolicylessEntities` returns **empty**. No carried entity lacks a
  read policy, so the read rule cannot fire at all;
- `User` has had a read policy keyed on the authority store's roster since
  **D23**;
- the roster RPC the paragraph says eight capabilities are waiting for
  **shipped**, as `contract_roster` with `listAgencyRoster` and
  `getAgencyRosterMember` over it.

What populates the bucket is the *write* rule five hundred lines below, and in
two populations: **six** that UPDATE a profile — the path D23 leaves
deliberately open, because the roster policy is read-only and nothing may
settle that question by accident — and **two** that write `MedicareGuideline`,
a `global` reference table no tenant surface may write. A seventh profile
writer, `offboardUser`, also reads four `preserved_paused` comms tables and is
held by `entity_not_carried` first.

A reader acting on the paragraph would go and write a roster RPC that already
exists. The inline comment beside the live rule was accurate throughout, and
its counts had drifted the other way — `8` and `35` where the tree measures
`7` and `39`, because D75 moved three profile writers out of `port` and the
ports since moved readers into the shipped set.

### `CARE_TEAM_SIGNALS` says an answered question is open

It opens *"Three representations of 'who may see this patient' exist, and which
one governs has never been decided"* and ends *"A capability reading the third
cannot be ported until one of them is authoritative."* Four hundred and eighty
lines below, in the same file, `refine` says:

> D24. Both halves exist, so a care-team dependency is no longer a thing to
> decide — it is a port to write, against a store that can answer.

`patient_access_model` is empty and has been since D24. **And D24 answered it
with none of the three the comment lists**: `caller_assigned_patients` reads
`pennsync_private.chart_assignment`, a production table that the staging
`assignment` in (1) is not — the two are explicitly not interchangeable — with
`tools-pennsync-assignment-backfill.mjs` carrying (2) into it. (3) is not
merely unchosen but **refused as a source**, because an address stays on the
patient row after its assignment is suspended, so reading those emails again
resurrects access somebody revoked.

The signals stay, because they are what *enforces* that answer rather than what
waits on it: delete either half of D24 and every dependent is blocked again.

### The fix is tests, because prose is what failed

Both paragraphs were written accurately and went stale where nothing could
notice. So the reasons are asserted rather than described — which read-only
entity holds each member of the bucket, that the policyless set is empty, and
that the roster handlers exist. A rewrite that gets the reason wrong now fails
instead of being read and believed. Giving `user` an `update` policy empties
the bucket and fails four tests.

### The milestone the counts do not state, and the one exception

`none` means *portable today*, and a reader takes a non-empty one as work
available now. It is 72, and **all 72 are written**: the queue's portable set
is exactly the shipped handler registry, less the two roster facilities D22
serves outside `base44/functions`. Nothing in `none` is startable and
unwritten.

**One capability outside it is, and the first draft of this decision said
otherwise.** `generatePatientHandout` is counted `core_integration`, which the
bucket defines as needing "the integration runtime's brokered path released".
That is true of one of its two actions. Its single `Core.SendEmail` sits
inside `if (action === 'email' && patientEmail)`, and eleven lines after the
request is parsed the module ALREADY refuses that action itself:

```js
if (action === 'email' && !outboundDeliveryReleased()) {
  return outboundDeliveryPausedResponse('email');
}
```

The document action reaches no integration, answers with a rendered PDF, and
waits on nothing: six sibling capabilities already render one in the ported
service, and its only entity is a retired log table D25 gives a successor. The
email action is the same owner decision that D42, D49, D50, D52, D54 and D73
each ship *with the delivery paused and reported as paused* — six precedents
for exactly this shape.

So this is **D76's defect in the family next door**: the rule is
`/\.\s*integrations\s*\./`, it answers on the SHAPE of the call, and nothing
asks whether the call is on a path the module itself already refuses. The
ninth instance of the recurring shape, found while writing the eighth — and
nearly shipped inside it, because "nothing is startable" was asserted over the
`none` bucket and then stated about the whole queue.

The discriminator is D74's own words about `sendAccountReadyEmail`, whose
"whole body is one `Core.SendEmail`": **does the module have a success answer
that is not the integration's result?** Measured over all three, the two
siblings have exactly one success answer each and both read `email sent`;
`generatePatientHandout` has two that carry a PDF. The test asserts that
contrast rather than reclassifying, because a general rule derived from one
instance is what D77 warns against — pre-allowing a shape nobody has measured
is worse than no check. `core_integration` still reports 3, and what changed
is that the record now says which of the three is work.

Every other capability left is behind a decision or a phase rather than behind
somebody's time:

| Bucket | Left | Waiting on |
| --- | --- | --- |
| `files` | 12 | Phase 3's data work — and D77's copy, which refuses every apply while the runtime's reader model is uploader-owned |
| `entity_authorization` | 8 | D23's open profile-write path (6) and how a `global` reference table may be written (2) |
| `entity_not_carried` | 7 | domains that are going away: training records, paused comms logs, real-time metrics |
| `core_integration` | 3 | releasing `Core.SendEmail` to the brokered set — an owner decision, since those digests carry personnel and invitee names |
| `external_secret` | 2 | a third-party transcription key, which belongs to the runtime's brokered path |

### The test's own first draft was the defect it was written against

It asserted the milestone in both directions: nothing in `none` unwritten, and
nothing blocked with a handler. Only the first is an equality. `checkCoverage`
sends a ported capability to `none` **without consulting `refine`**, so
"blocked, yet written" cannot occur however wrong a blocker is.

Found by sabotage rather than by reading: flipping `PolicyLibrary` to `hub`
should have pushed the shipped `listPolicyLibrary` into `entity_not_carried`.
The queue did not move at all. The assertion had been passing for a reason that
has nothing to do with the queue being right, in a test whose comment claimed
otherwise — **a test whose comment describes something the test does not do
reads exactly like one that works**, which is D77's lesson arriving in the same
change that cites it.

Port queue: unchanged at 7 / 8 / 0 / 0 / 12 / 0 / 3 / 0 / 2 / 72 — and one of
the three in `core_integration` is a partial port waiting to be written rather
than a capability waiting on the runtime. D81 wrote it the same day.

## D80 — Half the frontend's entity traffic has nowhere to land

**Decision.** Measure every frontend entity call site against its entity's
disposition, gate it, and size Stage J by what can actually be repointed
rather than by the call-site count.

**The count was never the question.** The surface ratchet reports 445 entity
call sites and says nothing about where they go, and Stage J is written as
"replace call sites tier by tier" — a refactor whose size is the count. Crossed
against the dispositions:

| Destination | Call sites | |
| --- | ---: | --- |
| `record_store` | 232 | a table exists |
| `broker_family` | 7 | the generic family serves that read |
| `activity_trail` | 3 | D25's successor |
| **can land** | **242** | |
| `no_table` | 193 | `hub` 119, `preserved_paused` 74 |
| `broker_is_read_only` | 9 | a write the family refuses |
| `no_realtime_seam` | 1 | `subscribe` |
| **cannot land** | **203** | |

**203 of 445 reach a domain the migration decided not to carry.** The training
domain alone is 119 — more call sites than the broker family serves in total —
and it is `hub`, a different destination entirely. Those are not edits waiting
for someone's time; each is a product decision about what the feature becomes,
and a plan sizing the stage by the count is sizing the wrong thing.

### Being served is a property of the entity; having a destination is a property of the call site

The nine `broker_is_read_only` sites are the ones a per-entity tool would have
reported fine. The family serves exactly three entities — `Announcement`,
`FacilityDocumentationRule`, `RegulatoryUpdate` — and all three are `readonly`
under D2's ceiling as D22 re-checks it against each schema. The frontend
creates, updates and deletes all three. Classify the call, not the table.

`subscribe` is the same shape from the other side: the entity behind it could
be `port` with a table waiting, and the owned store still has no realtime seam,
so the operation decides before the disposition does.

### Two things it deliberately does not claim

`store_can_hold` is **not** `a capability serves it`. The 232 `record_store`
sites have somewhere for the row to live; whether a ported capability covers
the operation is a narrower question, and answering it by inference is exactly
how a bucket comes to claim more than it measured — the whole of D74 through
D79. `check:transition-disposition` owns that half.

And nothing defaults. An unknown operation or disposition **throws**, because a
new operation is either a read the broker family might serve or a write it
refuses, and guessing is the difference between "this is fine" and "this
silently cannot work".

An entity with **no** disposition at all is a row too, with destination
`undeclared`, and it fails the gate. The first version skipped such a site: the
run still failed on the undeclared list, but the report it failed with
understated the total and the unserved count — in the one state where somebody
reads them closely — while the comment three lines above said every counted
site contributes a row. Found by a review bot; a fixture test now drives the
real walker over a tree with one declared and one undeclared entity and checks
both are counted.

### One matcher, so one count

It walks `src/` through the ratchet's own `sourceFiles` and `ENTITY_CALL`
rather than re-deriving them, and a test asserts the two totals agree. The
first measurement of this read **475 call sites and 220 unserved** because it
included the `.test.` and `.spec.` files the ratchet excludes on purpose — its
header says why, that they "deliberately model the very surface being retired".
A real number about a different question, and two walkers agreeing by
coincidence is how one tool comes to describe a different frontend from the
other while both pass their own suites (D45).

Proved by sabotage rather than by reading: a new `TrainingCourse.list()` in
`src/` takes the gate to 204/203 and exits 1, and renaming the shared matcher
fails four tests.

## D81 — The handout was work, so it is written

**Decision.** Port `generatePatientHandout` as the sixth PARTIAL port, after
D31, D35, D36, D59 and D73. The document action is served. The email action —
the delivery D42, D49, D50, D52, D54 and D73 each ship paused — is refused with the answer the original itself gives while
`OUTBOUND_DELIVERY_RELEASE` is not `enabled-v1`: 503,
`OUTBOUND_DELIVERY_RELEASE_PAUSED`, not retryable, in the original's order
(the condition checks, then the address, then the pause). Releasing a send to
a patient's address is D56's owner decision, not something a port may take.

It reads no record — the patient's name is text the caller typed, rendered
into a document handed back to that caller and stored nowhere — so what it
requires is what every ported document requires: an active membership in the
agency the request names. The original required only a signed-in account.

### Carried, and how that is proved

- **The text is copied, never retyped.** The twenty templates, the checklists
  and the resource links live in `patient-handout-templates.mjs`, extracted
  from the original's source, and the parity suite compares the two blocks as
  SOURCE — so a change to a line nothing draws by default (a deselectable
  bullet, a link target) fails too. This is a patient's instructions at home.
- **The page is the original's, call for call**, driven through the real
  transpiled original as every ported document is: all twenty conditions, and
  then all five colour schemes × four layouts × three typefaces over three
  conditions whose union the test asserts, from the templates, reaches all
  eight section and page branches — 180 comparisons on top of the twenty.
- **So are its failures.** The original catches per block and the catches
  differ — a failed section leaves a red "[Could not render: …]" line, a failed
  subsection skips to the next, the notes, checklist, tracker and links drop
  their block — and the port keeps all six. Both sides are handed a surface
  that fails while drawing the same named line, and the test then asserts the
  ORIGINAL took the branch that line was chosen for.
- **Its answer**: JSON carrying base64, `{ pdf, filename, diagnostics }`,
  because that is how the original answered. It fits the authority client's
  1 MiB JSON ceiling with room: the largest guide is 86 KB of base64 and a
  configured logo is embedded once however many pages carry it.
- The logo is supplied and the date is supplied, as for every ported document;
  the date keeps the original's long form ("September 22, 2026").

### Three narrowings, each an input the original could not render

Each is proved by driving the ORIGINAL rather than by reading it (D69):

| Input | What the original did | The port |
| --- | --- | --- |
| an unknown colour scheme | threw on the first fill, and its catch answered **`success: true`** with a generic "we could not generate the full guide" page, which the client downloads and reports as a success | `INVALID_STYLE_OPTIONS` |
| `condition: 'constructor'` | passed its template check (a plain-object index) and drew a page with no title and no sections, as `constructor_handout.pdf` | `INVALID_CONDITION` |
| an object where text belongs | printed `[object Object]` on the patient's handout | `INVALID_PARAMS` |

Typeface and layout the original defaulted rather than crashed on; they are
refused too, because one rule is simpler than three and the client cannot
send anything else. The published client's own request passes all of it, and
a test sends that request key for key.

### Not carried: the generic page, and the two `SystemLog` writes

Every input that reached the fallback page is refused before a render starts —
a failed sign-in and an unreadable body by the service itself, the rest above —
so all that is left to reach it is a render that genuinely fails. A patient
handed a page saying "contact your nurse", by a nurse who was told the guide
downloaded, is worse than an error the nurse can see; the failure is the
service's opaque 503 instead. The two `SystemLog` writes recorded exactly
those failures and the email's, so they have no successor: this port either
refuses the case by name or does not have it. The original audited nothing on
success, and neither does the port.

### Recorded, not fixed: four controls that change nothing

`PatientEducationHub` offers a **Reading Level** selector, a **Format**
selector, a **Custom Header** field and a **Two Column** layout. The original
never reads `readingLevel` or `format`, computes `customHeader` and never
draws it, and renders `two_column` as a single column with a 16 mm margin. The
port accepts all four — the client sends them, and refusing would break the
only caller — and draws exactly what the original drew. Honouring them would
be inventing a behaviour; they are a product question, the same kind D72
recorded for the dashboard's three dead fields. The original's `clean()` also
strips "°" from "Fever over 100.4°F" in six templates, printing "100.4F";
carried, because a port answers the way its original did.

### The first port through the call-site ratchet

`check:ported-call-sites` refused the change: the handout's two call sites in
`PatientEducationHub.jsx` now route to the service without naming a tenant.
They are not new call sites — the capability became routed — and
`portedCall` supplies the bound tenant, so they WORK. They are admitted in a
reviewed diff because the fallback is right exactly where the tenant decides
nothing the caller could have meant differently, and here it decides nothing
on the page. The gate's own comment still said such a site "will refuse the
moment the service is pointed at", which stopped being true when the adapter
began supplying the tenant; it now says what the refusal is for.

### The test's first two drafts claimed more than they did

The failure test first injected failures by COUNTING calls, and its comment
named a subsection bullet, the checklist's second box and the first link.
Instrumented, every one of them landed in a section catch — the counts shift
as soon as an earlier block fails — and a failure in the wrong place still
compares equal, so the test proved one branch while describing four. The style
matrix's first draft deselected `copd_oxygen`'s last section, which is its
only `important` one, on a condition with no plain paragraph, checklist or
links. Both now assert their coverage from data rather than from a comment.
And one sabotage — the original draws its failure marker in Helvetica whatever
the document's face — passed until the failure cases ran in Times, because
under the default face the two are the same. **A test whose comment describes
something the test does not do reads exactly like one that works**, for the
third time since D77; ten sabotages now fail the suite, each one.

### Three bounds the original did not need, because it ran alone

On Base44 each call ran in its own isolated invocation, so an expensive one
hurt only itself. This service is one shared Node process and jsPDF renders
synchronously, so what the original could afford is not automatically
affordable here. Measured, not assumed:

- **`splitTextToSize` is worse than quadratic in lines.** 20,000 lines take
  0.85 s and 40,000 take 5.6 s; the service's 1 MiB request cap holds 400,000,
  which would stall every caller for tens of minutes. Only two caller fields
  reach it — the nurse's note and the footer — so both are capped **before**
  any render (a note at 20,000 characters or 400 lines, a footer at 2,000 or
  40), far above anything that can print. The caps are tested on
  `handoutRequest`, which never renders, so a regression fails there instead of
  hanging the suite.
- **A note too tall for the page is refused by name** (`HANDOUT_NOTES_TOO_LONG`)
  — the fourth narrowing, and the one with a clinical edge. The original's
  notes callout has no page break: driven with a 39-line note it draws the last
  line into the footer band, and at sixty lines below the bottom of the page,
  still answering 200. The nurse's last instructions reach the patient
  overprinted or not at all. The edge is measured with a real jsPDF in each
  layout (38, 45 and 28 lines fit in standard, compact and large print), and a
  note that fits draws exactly as before. Paginating the note instead would
  print everything, and is the owner's call: it changes the document.
- **The answer has a ceiling** (`HANDOUT_TOO_LARGE`, 1 MiB less 16 KiB). The
  authority client refuses a larger JSON answer as an opaque
  `INVALID_AUTHORITY_RESPONSE`, after the work; the patient's name is drawn but
  never split, so it is the one field still able to reach it. The ceiling is
  proved against the real client by sending an answer of exactly that size
  through it, not by comparing two constants.

Six sabotages each fail the test meant to catch them. The footer's own
first-line truncation — the original prints only the first wrapped line of a
custom footer — is carried and recorded; it is agency boilerplate, not a
patient's instructions.

Port queue: 7 / 8 / 0 / 0 / 12 / 0 / **2** / 0 / 2 / **73**. What is left in
`core_integration` is the two whose whole body is the send.

## D82 — A person may say what is theirs to say, and the store decides which columns those are

**Decision.** The profile-write path D23 left open is settled at the narrowest
shape that works. `pennsync_records.user` gains **one** write policy — update,
`id = caller_user_id()`, the same predicate in `using` and `with check` — and a
`before update` trigger that raises `PENNSYNC_PROFILE_FIELD_NOT_SELF_WRITABLE`
unless every column that changed is named in `PROFILE_SELF_WRITABLE`. There is
no insert policy and no delete policy. So: your own row, a named set of columns,
and nothing else — not for a manager, not for an administrator, not for the
record owner, which forced RLS binds too.

**Why this shape and not a wider one.** D23 wrote that the question was left
open "so it would not be settled by accident". The two ways it could still be
settled by accident are the two this refuses:

- **A predicate alone.** RLS `with check` sees only the row being written; it
  has no `old`. A policy can say whose row and cannot say which columns, so a
  self-only update policy by itself lets a clinician set their own `role` to
  `admin`. Column-level `grant update (…)` does not close it either — the broker
  runs as the table's owner, and column privileges do not bind an owner the way
  `force row level security` does. The comparison has to happen where `old` and
  `new` both exist, which is a trigger.
- **A denylist.** A list of columns nobody may write settles the question again
  every time a column is added, in the permissive direction, silently. The
  columns that get added to a staff table are job titles, approvals and scopes.
  So the guard is an **allowlist**, driven off `to_jsonb(new)` rather than a
  column list, and a column added tomorrow is refused until somebody names it.

The narrow shape is also the one that can be widened later without a data
migration: adding a column to the allowlist is a line in the generator.

### What is on the list, and what is deliberately not

Three kinds of column and nothing else: **preference** (bookmarks, language,
notification and fax delivery settings), **own contact** (the numbers a person
can be reached on), and **own presence and mark** (duty status, the off-duty
message and its schedule, the saved signature).

What is absent is absent by decision:

- `role`, `account_type`, `agency_id`, `agency_name`, `agency_role`,
  `staff_role`, `care_scope`, `is_manager`, `is_approved`, `is_active` and
  `manager_email` are **authority**, and D23 already replaced every one of them
  with the membership. A handler gating on the stored `is_manager` gates on the
  user's own assertion; so would a person setting it.
- `credentials`, `credential_type` and `license_number` are **attestations
  somebody verifies**, and `contract_credential_review` is where that happens.
- The `offboarded_*` trio is **the record of a decision taken about the person**.
  A subject who could clear it would re-admit themselves.
- `work_phone_number` and `twilio_phone_number_sid` are **one provisioned
  pair**. Letting the subject rewrite half of it points the agency's own number
  at a handset nobody assigned. `phone`, `phone_number` and `personal_cell_e164`
  are on the list; these two are not, and the difference is who provisioned them.
- `ai_content_agreement_accepted` and its two companions are **already
  answered** by `contract_ai_agreement_accept` against its own attestation
  table. Writing them here would be a second answer to keep in agreement with
  the first — the defect D41, D43 and D62 each found in an original.

No insert and no delete, for the same reason in two directions: a profile row
exists because enrolment created it, and a person who could delete their own row
would leave the roster while keeping the membership that authorizes them.

### What it does to the queue: nothing, and that is the finding

`entity_authorization` is eight before this decision and eight after it. A
decision that settles the question a bucket was named for and moves no capability
out of it is worth stating plainly rather than dressing up, because the reason is
the useful part: **every one of the eight writes something this decision does not
permit.** Six write a profile and two write a `global` reference table, which is
D83's. Of the six:

- `autoApproveInvitedUser` writes `is_approved` and `role` on somebody else's
  row. `enforceStaffRoleIntegrity` writes `staff_role` on somebody else's.
  `userManagement` and `userManagementV2` write whatever their `updates` object
  holds, assembled behind an `isAdmin` gate. All four need the administrative
  write path, which this decision does not build.
- **`autoEndDutyDay` is the one worth reading twice.** Both columns it writes —
  `duty_status`, `duty_on_since` — ARE on the allowlist, and it stays blocked
  because it has no caller: it carries the `schedulerAuth` fence, and "the
  caller's own row" admits a shared secret to nothing. A rule written over
  columns alone would have reported a nightly sweep of every on-duty person in
  the deployment as a self-service profile edit.
- **`setNurseDutyStatus` is the one this decision actually reaches**, and it
  stays in the bucket for a reason worth separating from the other five. Its own
  gate already reads `let target = user` and requires `isProtectedSuperAdmin` to
  name anybody else, and every column it touches is on the list — so the self
  leg now has a shape in the store it can be written against, which it did not
  have this morning. What keeps it here is that the module writes through
  `asServiceRole` with a payload assembled elsewhere, so nothing can read it as
  staying inside the narrowing. Porting it is therefore the D81 shape — the self
  leg served, the super-admin leg refused by name — rather than a verbatim
  carry, and it is the next port. It is named here so it is not rediscovered.

### The classifier had to be corrected in the same breath, which is the point

`entity_authorization` asked "does the store permit a write to this table". On
the day the policy landed that became true of `user`, and all six of its `port`
writers would have been reported unblocked — the ninth instance of this
repository's recurring defect, arriving from the other direction: not a bucket
keeping its name after the reason went, but a bucket LOSING its name while the
reason stayed. So the classifier now measures two more things, both read from
what the store emits rather than from the decision that asked for it:

- `discoverColumnNarrowing` parses the guard's allowlist out of the generated
  SQL, beside `discoverEntityPolicies`, which parses the policies. A second copy
  kept by hand is a copy that drifts, and this one would drift in silence.
- `entitiesTouched` records WHICH columns a module writes per entity, and
  answers `null` where the payload could not be read. Unknown is not empty:
  `userManagement` hands over an object assembled earlier, and treating that as
  "writes no columns" is how an admin path reads as a self-service one.

A write is admitted only where the payload can be read, every column of it is
named, and the module has a caller. Everything else stays blocked.

### Proved against a real database, not against the generator

`record-store-migration.test.mjs` builds a broker over the real migration under
PGlite and spends it: the caller corrects their own `phone`; the same caller
updating a colleague's row changes **no rows at all** — not an error, the policy
simply does not see it, and both callers are on each other's roster, so that is
the assertion saying sharing an agency is not owning the row; five columns of
four different kinds each raise with the offending column named; the delete
finds nothing to remove; and the owner, acting with no identity, updates nothing,
because `caller_user_id()` is null and forced RLS binds the owner here too.

One rule in the migration test had to be split, and it was worth splitting. It
asserted that every function in the schema stays administrator-owned and out of
every caller's reach. The first half is a **caller helper's** rule — those read
`pennsync_private` through forced RLS, so an owner-owned one would deny every
row — and it does not apply to a trigger function that reads nothing and
compares `old` to `new`. The second half applies to both: `create function`
grants execute to PUBLIC, so a guard nobody revoked is a function every caller
role can call by name. The test now splits them by the catalog's own return
type rather than by a naming convention.

Port queue unchanged: 7 / 8 / 0 / 0 / 12 / 0 / 2 / 0 / 2 / 73.

## D83 — A platform reference table is written by migration, and there is no runtime that writes one

**Decision.** A `global` reference table's contents arrive by migration. No
caller-facing handler and no scheduled job writes one. `fetchMedicareGuideline`
and `scheduledGuidelineSync` are therefore **not carried**: they are
dispositioned `retire`, not blocked ports.

**Why.** D23 found these two by accident — the rule that separated reading a
table from writing one caught them, and nothing had ever reported them, because
every earlier check asked only which entities a module touched. D23 recorded
what they needed as "a platform ingestion path, which is not a caller-facing
handler", and then left them in the queue as `port`, where they read as two
handlers somebody has yet to write.

They are not. A `global` table is the one table in the store every agency reads
and no tenant surface writes; that is what the disposition means and what the
emitted policy enforces — a read policy and no write policy, so forced RLS
refuses the insert whoever asks. A handler whose whole purpose is to write one
has no shape it could take here that the store would accept. Porting it would
mean either widening `global`, which is the decision the disposition exists to
make, or giving the service a credential that bypasses the store, which is the
thing the exit is removing.

And what each actually does makes the ingestion reading exact rather than
charitable. Both fetch a CMS page over HTTP, hand it to a model, and upsert the
result. `fetchMedicareGuideline` fetches through `api.base44.com/v1/fetch-website`
— a Base44 platform endpoint, in a capability the exit exists to take off that
platform. A pipeline that scrapes a public regulator and has a model summarise
it is content preparation. Content preparation belongs in a migration, where it
is reviewed once, versioned with the schema, and identical in every deployment,
rather than in a handler that produces different text each time it runs.

**What this costs, said plainly rather than left to be discovered.**
`MedicareGuidelinesLibrary.jsx` offers a protected administrator two controls
that now have no destination: "add a guideline by URL", which called
`fetchMedicareGuideline`, and "retire this guideline", which wrote
`is_active: false` directly. Both were runtime writes to a `global` table and
neither is carried. The page keeps its reading half, which is the whole of what
a clinician uses it for. Changing the library's contents becomes a change to the
migration — slower, reviewed, and the same in staging and production, which for
a table of regulatory citations is the behaviour you want.

Port queue: 7 / **6** / 0 / 0 / 12 / 0 / 2 / 0 / 2 / 73.

## D84 — A capability is not blocked because one of its nine legs is leaving

**Decision.** The seven capabilities `entity_not_carried` held are settled, and
they do not settle the same way, because they were never the same thing. Three
change destination; four are carried, each with one uncarried LEG recorded in
the manifest against the capability it belongs to.

**Why they had to be read one at a time.** The bucket means "reaches a table
that will not exist here", which is a property of a module and says nothing
about whether the capability survives. Read as a group they looked like one
answer — training records, paused comms logs, real-time metrics, none of them
carried. Read one at a time, four of the seven turned out to be carried
capabilities where the leaving table supplies a summary row or two figures of a
report. `generateAIReport` was reported as blocked on the record store for
`training_completed` and `avg_training_score`, two lines of one PDF, while its
other eight datasets — visits, patients, incidents, compliance audits, note
quality, alerts, tasks, nurse performance — are all carried.

### The three that change destination

- **`analyzeNurseDeficits` → `hub`.** `TrainingRecommendation` is the only data
  it reads; the other three entities are its authorization fence. Its four call
  sites are all under `src/components/training/`. Of the thirty-five training
  and learning functions, thirty-three were already `hub`; this was one of the
  two that were not. Porting it builds the second home for training content
  that D8 exists to prevent.
- **`analyzeRealTimePerformance` → `hub`.** An adaptive-difficulty engine over
  `RealTimePerformanceMetric`, which D9 already sent to the Hub by name as
  "training telemetry keyed by `training_module_id`". It has no frontend call
  site anywhere in the tree, so there is not even a caller left behind.
- **`getCommsDashboard` → `preserved_paused`.** The strongest single
  measurement in this batch: of the twenty-seven SMS, fax and voice functions,
  twenty-six are `preserved_paused` and this was the only `port`. It is the
  READ side of the paused comms domain — strip `SmsMessage`, `CallLog` and
  `FaxLog` and its summary, its failure list and its per-number breakdown all
  return empty. D7 carries that domain without activating it, and its dashboard
  turns on when the domain's own gate passes. D7's own consequence paragraph
  describes this correction happening seven times before.

### The four that are ports with a settled leg

Each is recorded in `tools-transition-disposition.json` under `uncarried_legs`,
naming the entities, what serves them instead, and why:

- **`distributePolicyAcknowledgment`** — `PolicyLibrary` to
  `PolicyAcknowledgment` and `Notification`, all carried. Its one
  `TrainingAuditLog` row is a fire-and-forget summary written after the loop,
  whose failure the module already logs and ignores, and whose contents are the
  shape D25's activity trail takes. Fourteen of the fifteen modules that write
  that table are `hub`; this was the only `port` one, which is what makes the
  row an orphan leg of a policy capability rather than a learning capability.
- **`generateAIReport`** — the two figures above. D8 says learner history is
  preserved by the Hub cutover rather than this one, and the Hub already has
  `exportLearningReportCSV` and `getTeamTrainingReadiness`.
- **`offboardUser`** — the core is carried PHI revocation: deactivate, revoke
  memberships, unassign charts, clear on-call, cancel invitations. Every
  uncarried leg is a separate try-caught block appended after it. The three
  schedule cancels exist to defuse dispatchers that D7 carries paused — the
  module's own comment says they exist because `dispatchScheduledSms` would
  otherwise still fire, and it does not run here. The `UserActivity` row is
  D25's case exactly, and it is load-bearing rather than incidental: the module
  says an auditor treats its counts as proof that PHI access was withdrawn. It
  is repointed at the trail as part of the port, never dropped.
- **`sendExpirationNotifications`** — D9 settled this one by name and the queue
  had not caught up: the credential half ports and the training half drops out
  to the Hub, where `sendTrainingNotifications` already lives. The module is two
  independent symmetric loops feeding one admin fan-out, so the credential half
  stands alone with the same expiry tiers, the same claim-token idempotency and
  the same agency scoping.

### Why the reason is in the manifest and not only here

Because a reason that lives only in prose is the failure this repository has now
recorded nine times: a bucket keeps its name after the reason for it has gone,
nothing fails, and nothing surfaces it. `uncarried_legs` is checked. An entry is
refused unless its capability is still a `port` and still reaches every entity
it names, and a stale entry blocks the census the way an unspecified retention
does. Repointing a leg, porting it, or retiring the capability each fail the
check until the entry goes with it. `because` has a floor of twenty characters,
exactly as `broker_ceiling` requires one, because a reason nobody had to write
is a reason nobody wrote.

The manifest format goes to version 3.

### What the queue does, which includes a bucket going UP

`entity_not_carried` 7 → **0**. `records_schema` 0 → **3**, and that is the
queue working rather than regressing: three capabilities left a bucket that
said "blocked on a schema" for one that says "its port is not written yet",
against a store that exists. A count that can only ever fall cannot represent
work arriving, and this queue's whole purpose is to route people to work that
can start.

Port queue: **0** / 7 / 0 / **3** / 12 / 0 / 2 / 0 / 2 / 73.

## D85 — The file copy's blocker re-measures as true, and the twelve are four different things

**Decision.** Do not carry the bytes. D77's claim holds under re-measurement:
serving a migrated object needs the integration runtime's authorization model
changed, and that is a decision about that service. The `files` bucket stays at
twelve and `applyFileCopy` stays refused.

**Why this was re-measured at all.** D77 was written before the reader model was
looked at again, and this project has had three documented claims break under
re-measurement in one day. So the chain was read rather than quoted, and it is
closed in code rather than in prose:

- `providers.mjs` admits a stored object only when `row.subject` equals the
  caller's hashed subject AND the object path is `appId/subject/id`. Every read
  path goes through it; there is none that skips it.
- The subject is hashed per (app, agency, user), so two clinicians in the same
  agency have different subjects.
- The same handle cannot be registered once per reader at three levels: a
  primary key on the id, a unique constraint on the object path, and a
  path-binding check in the record function.
- The bucket is closed to every other identity by a restrictive storage policy,
  and `pennsync-api` holds no storage credential at all — it forwards the
  caller's own bearer, so the runtime derives the CALLER's subject, never a
  service one.
- `pennsync_private.file_object` holds one handle per locator and is immutable,
  so it cannot encode a fan-out either.

A migrated object has no uploader, so whichever subject ran the copy would be
the only person who could ever open it. The verdict stands.

### Three things the re-measurement found that D77 does not record

None of them reverses it; all three change what the queue should say.

1. **The blocker is symmetric and forward-looking, not a property of migrated
   rows.** D77 frames it as "a migrated object has no uploader". An object
   uploaded by the PORTED runtime under subject X is equally unreadable by
   subject Y. So lifting the byte copy alone unblocks none of the twelve — and,
   in the other direction, **two of the twelve are not waiting on the byte copy
   at all.** `createAuthorizedDocument` and `generateDynamicCoverSheet` only
   write; they wait solely on the reader model. D77's summary says the twelve
   "wait on DATA rather than design", and for those two it is the wrong half of
   the sentence.
2. **The enforcement is application-level, which makes "do not widen it" a
   choice rather than a constraint.** Nothing in storage or RLS enforces
   uploader-ownership; it is four expressions in one function plus two checks in
   the migration. And the record-authorized predicate a migrated object needs
   already exists and is proved in the record store — `pdf_index_read` composes
   the deployment pin, the caller's agencies, and both chart-scope helpers. What
   is missing is a path from a handle to that predicate. D77 is right to refuse
   to decide it; it is one service's authorization model, not a research
   problem.
3. **`generateNoteFromRecording` has two further blockers no file work clears.**
   It carries audio, and the owned bucket's MIME set admits PDF, PNG, JPEG,
   WebP, plain text and CSV — enforced again by the storage table's own check
   constraint — so the bytes could never be carried there. It also pins a model
   the broker does not accept. See D87, which is the same wall from the other
   side.

So the twelve are: **2** waiting only on the reader model, **5** read-only that
need the copy and the reader model, **5** partial with a write leg that needs
neither, and **1** with two independent blockers on top. They are left in one
bucket in this change, because splitting a blocker is a change to the queue's
vocabulary and this decision already changes the queue in three other places;
what is recorded here is that `files` is four questions wearing one name, and
that the reader-model decision is the single gate that unblocks the most of it.

Port queue unchanged by this decision: 0 / 7 / 0 / 3 / **12** / 0 / 2 / 0 / 2 / 73.

## D86 — Two capabilities whose whole body is a send, ported as the refusal

**Decision.** Port `sendAccountReadyEmail` and `sendWelcomeEmail` as the seventh
and eighth PARTIAL ports, with nothing in the served half: the caller gate ships
and the send is refused with the answer the originals give today — 503,
`OUTBOUND_DELIVERY_RELEASE_PAUSED`, not retryable. The send is not released and
this decision does not release it; D56 does, and D56 is the owner's.

**Why porting a capability that can only refuse is worth doing.** Because the
refusal is stronger here than in the original. In Base44 the pause is an
environment variable: set `OUTBOUND_DELIVERY_RELEASE` to `enabled-v1` and mail
goes out. In this service the refusal is in the handler AND the operation is not
in `BROKERED_OPERATIONS`, so a deployment that released the gate still could not
send. Releasing becomes three deliberate things rather than one variable, and
none of them can happen by accident.

It also empties `core_integration`, and the empty bucket must not be misread:
**it does not mean D56 was decided.** It means nothing is waiting on that
decision in order to be WRITTEN. The decision is exactly where it was.

**The caller gate is a narrowing, and it is D23's.** Both originals gate on
`user.role`, `user.account_type` or both — self-editable columns of the carried
profile, so a handler reading them gates on the caller's own assertion about
themselves. The port asks `tenantRole` from the frozen actor projection, which
is the membership. The two originals also disagree with each other:
`sendAccountReadyEmail` admits a platform `admin`, a `super_admin` and an
`agency_admin`; `sendWelcomeEmail` admits only a platform `admin`. This service
has no global scope — every request names one agency and is authorized within it
— so a platform-wide role has nowhere to land, and `agency_admin` is the whole
of what remains. That is a narrowing for the first and a widening for the
second, and it is the same narrowing every other port here already made.

**The order of the two checks is the originals' order**, and it is asserted
rather than assumed: authorization first, the pause second. A non-admin is
refused 403 by a paused deployment exactly as by a released one. The other way
round would tell a caller their request would have been accepted.

**What is deliberately NOT carried, so nobody reads this as finished.** Both
originals validate the body AFTER the pause and then render a branded HTML
message. None of that runs while the pause holds, so none of it is here: an
unreachable validation nobody can exercise is not a port, it is a claim.
Releasing means brokering `SendEmail` in the runtime, carrying the field checks
and the renderer, and deleting two `fail` lines. The flag flip is the owner's;
the other two are a morning's work that would be waste if the answer is no.

**Which of the two is the reason D56 exists.** `sendAccountReadyEmail` puts a
recipient address and a display name on the wire. `sendWelcomeEmail` puts those
and **a working temporary password** in the message body. Of everything in this
queue, that is the one that most belongs where D56 put it.

Port queue: 0 / 7 / 0 / 3 / 12 / 0 / **0** / 0 / 2 / **75**.

## D87 — The transcription capability is designed, and the key stays unwired

**Decision.** Design the capability and wire no credential.
`transcribeAndGenerateSOAPNote` and `transcribeAudioWithWhisper` stay `port` and
stay blocked, and what they are blocked on is now measured rather than named.

**Why the bucket needed re-measuring.** `external_secret` says "calls a
third-party API with a key from the environment", which reads as one missing
credential — as though adding `OPENAI_API_KEY` to the runtime would release
both. It would not. There are three walls, they are independent, and removing
any one leaves the other two:

1. **There is no operation to broker.** The integration runtime's whole
   vocabulary is `InvokeLLM`, `ExtractDataFromUploadedFile`, `SendEmail`,
   `UploadFile`, `UploadPrivateFile` and `CreateFileSignedUrl`. Nothing carries
   audio, and a request for anything outside that list is refused
   `INTEGRATION_NOT_MIGRATED`.
2. **The runtime holds no key for the provider either function calls.** It
   holds an Anthropic key and a SendGrid key and nothing else, so even a
   brokered audio operation would have nothing to call with.
3. **The owned bucket admits no audio type.** `MIME` is PDF, PNG, JPEG, WebP,
   plain text and CSV, enforced again by the storage table's own check
   constraint, so the bytes could not be carried there whatever the reader
   model D85 discusses decided.

All three are asserted in `tools-transition-disposition.test.mjs` rather than
written down here alone, because a sentence in a decision is exactly what has
drifted from the tree three times in this project.

**The design, which is a seam rather than a handler.** The capability divides
where the credential boundary already falls, and the two halves are not equally
blocked:

- **Audio to text.** Needs a provider this platform has no relationship with.
  Blocked on all three walls above, and on a fourth that is this service's own:
  `pennsync-api` accepts `application/json` under a 1 MiB ceiling, and
  `transcribeAudioWithWhisper`'s client posts `multipart/form-data` while
  `transcribeAndGenerateSOAPNote`'s posts base64 that inflates a forty-five
  second recording to the limit. Releasing this is a vendor decision AND a
  transport change, and the vendor decision is the owner's for the same reason
  D56 is: a recording of a clinical visit is the most identifying artefact in
  the product.
- **Text to a SOAP draft.** Needs no key at all. It is a prompt and a parse, and
  `InvokeLLM` already brokers exactly that with the credential held in the
  runtime, one hop from the handler, where no handler can read it.

**So why the second half is not being written today**, having just said it
needs nothing. Three changes come with it and none of them is a port decision:
the brokered contract takes no `system` parameter, so the original's system
prompt has to fold into the user prompt; the model changes, because the broker
admits `automatic` or the runtime's configured default and the original pins a
specific one; and `response_json_schema` is honoured by a forced tool call,
which would replace the original's regex extraction of the first JSON object.
Each is a behaviour change to a step that drafts a clinical note. The live
client already treats that draft as advisory and feeds the raw transcript into
the note instead, precisely so a fabrication cannot reach a chart unverified —
so porting the drafting half alone ships the half the product deliberately
de-emphasises, with three differences from the original, while the half the
client actually uses stays blocked.

The capability is designed and the seam is named. It is written when the audio
half has a vendor, so both halves change together and the parity comparison is
against a whole capability rather than a third of one.

Port queue unchanged: 0 / 7 / 0 / 3 / 12 / 0 / 0 / 0 / 2 / 75.

## D88 — A migration a deployment has applied is not editable in place

**Decision.** A change to an already-applied migration ships as a FORWARD
migration in the same change. Regenerating `20260919170000_record_store.sql` is
a change to what a NEW store gets and reaches nothing that exists, so from here
the regeneration and the catch-up move together, and a pin over every
migration's text makes the edit visible where it is made.

**How it was found, which is the whole of it.** D82 put the profile-write path
into the generated record store migration, as AGENTS.md instructs: change the
entity definitions and re-run `--write-migration`. Every gate agreed.
`check:entity-schema-plan` compared the file with the generator and found them
in step. `record-store-migration.test.mjs` applied it under PGlite and proved
the policy and the trigger do what D82 says. `record-tenant-isolation.test.mjs`
proved the narrowing holds against lying agency labels. Sixty-nine suites
passed, #246 merged, and the hosted comparison on `main` reported

```
policies: 1 difference(s) between the committed migrations and hosted
+ [ 'missing from hosted: pennsync_records.user.user_update' ]
```

with `tests 20 / pass 19 / skipped 0` — a real measurement against the hosted
project, not a stand-down.

**The mechanism.** `planMigration` decides what to apply by NAME:
`ledgerName(file)`, then `have.has(name)`. That is deliberate and right — the
Supabase CLI stamps its own versions when a migration is pushed, so the
timestamp is not an identity and the name is the only stable key the two sides
share (`tools-pennsync-migrate.mjs` says so in its own words). The consequence
nothing said is that the ledger holds no CONTENT. A file whose text changes
after it has been applied is skipped forever on every store that ran it, and
applied in full on every store built afterwards. Two different databases, one
committed tree, and nothing between them that compares.

**Why every suite could pass.** Every suite in `services/authority-store/tests`
builds from nothing. That is the one case this defect cannot appear in, because
a fresh build applies the edited file. The only thing that reads an existing
store is `hosted-store.test.mjs`, and `pennsync-authority.yml:332` gates it on
`refs/heads/main` — correctly, since it holds a hosted credential. So the check
that could see it was structurally downstream of the merge.

**What ships.** `20260920530000_profile_self_write.sql`, which is DERIVED
rather than typed: `tools-pennsync-record-catchup.mjs` reads the four
statements out of the generated migration and wraps each in its idempotent
form — `create or replace function`, `create or replace trigger`, and a `drop
policy if exists` before the policy. Derived because a second hand-kept copy
would drift in precisely the direction nothing measures, which is a deployment
holding an older rule than a fresh build; and the bodies are byte-identical on
purpose, because the hosted comparison reads `md5(prosrc)` and
`pg_get_triggerdef`, so a reformatted body reads as drift rather than as a fix.
It runs as `pennsync_records_owner` for the same reason: the comparison reads
`pg_get_userbyid(p.proowner)`, and a catch-up applied as the administrator
would close one difference and open another.

**The test that matters is the one that does not build from nothing.**
`record-store-catchup.test.mjs` cuts the D82 block back out of the generated
migration, builds a store from what the hosted project actually ran, and proves
the catch-up leaves it field-for-field equal to a fresh build. Asserting that
the catch-up "creates a policy" against a database that already has one would
pass with the file empty — the shape of assertion D79's own first draft was
caught on. Both sabotages were run and both bit: deleting the trigger statement
failed the equality test, deleting the `revoke` failed the privilege one.

**And a ratchet, because this recurs by instruction.** Regenerating that file
is not a mistake to avoid; AGENTS.md tells you to do it whenever an entity, a
tenant decision or the generator changes, and every such regeneration has this
property — a new table added that way would reach no deployment either.
`tools-pennsync-migration-fingerprints.mjs` pins all 70 migrations' sha256 and
reports a CHANGED file apart from an ADDED one, because they ask for different
things: an added migration wants one line of housekeeping, a changed one wants
a forward migration or an explicit statement that no deployment has run it yet.
The pin claims nothing about any deployment — that is a fact about the
deployment and the hosted comparison is what reads it. It says only that the
text moved, at PR time, where the person moving it can answer.

**Why the pin is in the repository and not in the ledger.**
`supabase_migrations.schema_migrations` already carries a `statements` column,
so the ledger is not unable to record what a migration held — it is being told
nothing. Measured on hosted staging rather than sampled: 59 of its 68 rows have
it empty, which is exactly the set `tools-pennsync-migrate.mjs` applied; the
nine that carry statements were pushed by the Supabase CLI, which populates it.
Filling it is the better long-run shape and it is deliberately NOT this change,
for two reasons. It would say nothing about a migration already applied — the
59 stay empty, and the file that caused this is one of them — so a comparison
over it would be vacuous for precisely the case it is wanted for. And
populating it faithfully means splitting a migration into statements, which
means a parser that handles dollar-quoted bodies; every function in this store
is one, and a splitter that got it subtly wrong would write a plausible wrong
answer into the place the next person trusts. The pin answers a different
question anyway, at a different time: not "what does this deployment hold" but
"did this commit change a file that was pinned", before a merge and with no
database. Keep both when the ledger side is built.

**One correction to the suite that found it.** `compare()` asserted per
category, inside a loop over seven in a fixed order, so the first failing
category ended the test and the ones after it were never compared. D82's gap is
three objects — a policy, a function and a trigger — and the run could only
name the policy; fixing that alone would have gone red at `functions`, then at
`triggers`, three rounds reading like new regressions when nothing new had
happened. It now collects across every category and asserts once. Run against
hosted staging before the catch-up was applied, it states the whole gap in one
go:

```
3 difference(s) between the committed migrations and hosted
+ [ 'policies: missing from hosted: pennsync_records.user.user_update',
+   'functions: missing from hosted: pennsync_records.user_self_write_guard()',
+   'triggers: missing from hosted: pennsync_records.user.user_self_write_guard' ]
```

**The general rule, and where it sits beside the others.** The repository's
recurring defect is a bucket keeping its name after the reason for it has gone
— nine instances, D47 through D81, each found because nothing failed. This is
the same shape in the migration sequence rather than the classifier: a
generator that was right while the store was being built stayed right in the
tree and stopped being right about the world, and the one check that could
notice ran too late to matter. **When a tool decides what to do from a name,
ask what it would do if the thing behind the name changed.**

Port queue unchanged: 0 / 7 / 0 / 3 / 12 / 0 / 0 / 0 / 2 / 75. Nothing here
moves a capability; it carries a policy that had already been decided to the
store that was missing it. The store itself still needs the migration applied —
one pending file, DDL only — and until it is, the hosted comparison stays red
on the ledger count as well as the three objects.

## D89 — Distributing a policy version, and a key declared before its race shipped

**Decision.** `distributePolicyAcknowledgment` is ported as
`20260920540000_contract_policy_distribute.sql`, the SEVENTH partial port. The
successor performer is an `agency_admin` scoped to their own agency; the four
cohort filters have no carried column and are refused by name; the idempotency
the original's header claims becomes a real composite index under D78; and the
notification ships, because a notification is a row (D51).

**Who may ask, established by driving rather than reading.** The original's
gate is
`role === 'admin' || account_type === 'agency_admin' || account_type === 'super_admin'`,
which is D69's shape, so it was driven through the module's own
`withTrustedClaims` helper before anything was decided. Two callers pass: the
built-in `role === 'admin'` with no membership at all, and a caller whose
CANONICAL membership says `agency_admin`. The `super_admin` test is DEAD — the
helper strips a claimed `super_admin` back to `'user'` unless a canonical
membership says otherwise, and its tenant branch only ever writes
`'agency_admin'` or that stripped value, so the only caller who could still
carry it is one who already returned on the first test.

So this is **not** one of D40's widenings: the agency administrator was always
a live, membership-backed performer here. What is dropped is the platform tier
D14 and D22 removed, and D44's question — what was that tier structurally
preventing? — has a sharp answer in this module. The original applies its own
agency filter only when `me.agency_name` is set, and a built-in admin carries
no `agency_name`, so for that caller the filter is skipped and the policy is
distributed to **every tenant in the deployment**. That reach is the thing
being dropped, and dropping it is the point.

**The first harness proved nothing, which is why driving beat reading.** Its
first draft stubbed a membership row as `{id, user_id, agency_id, status}` and
an agency as `{id, name, status}`. `canonicalClaimMembership` rejected every
one of them, all nine caller shapes printed "refused", and the run read exactly
like evidence that `agency_admin` was dead too. Only a row satisfying the whole
of that helper — `membership_key`, `user_email_normalized`, `version`,
`created_by_user_id`, the transition columns, and an agency carrying
`agency_name` rather than `name` — reached the live branches. **A harness that
never reaches the branch answers the question it was built to answer, wrongly
and confidently.**

**Four filters with no column, refused by name and only where they were read.**
The original narrows with `filters.role`, `department`, `business_line` and
`location`. The carried `user` table has none of `department`, `business_line`,
`location` or `job_title` — only `credential_type` and the self-editable
`role`, and `role` is matched upstream against `job_title || credential_type ||
role`, so with `job_title` absent the same request would select a DIFFERENT set
of people than the administrator saw when they chose it. All four are refused,
following D44, and dropping them would be worse here than in most places: a
dropped narrowing does not fail, it distributes a compliance assignment to MORE
people than were asked for, and every one of them is then overdue on a policy
nobody meant to give them.

Two details of that refusal are the original's rather than this port's, and
both were read off its code rather than its comments. `filters` is consulted
only in the `else` of `userEmails.length > 0`, so a request naming people
explicitly never had its filters applied in Base44 either and is served here;
and `userEmails: []` is the ABSENCE of an explicit cohort, not an empty one —
`PolicyAcknowledgmentManager.jsx` sends all four keys on every call and passes
`[]` for the whole-roster button, so reading it as "nobody" would have refused
or no-opped every unfiltered distribution the product makes. D58's rule: check
the call site before deciding what a request shape means.

**The key, and the race the repository had already written down.** The
original's header claims it is "idempotent within a version on (policy_id,
policy_version, user_id)" and its own comment admits the hole in the same
breath: *"Concurrent distributes can still race the prefetch->create gap."* It
emulates the constraint with a prefetched set, then a create, then a re-read,
then a DELETE of its own duplicate. `CONTRACT_UNIQUE` now enumerates
`PolicyAcknowledgment.distribution` over `(agency_id, policy_id,
policy_version, user_id)`, D30's emitter writes the partial index, and the
contract catches `unique_violation` for
`policy_acknowledgment_distribution_unique` BY NAME and re-raises anything
else. The prefetch, the re-read and the compensating delete all go.

The key is WHOLE-table rather than partial, unlike D78's point-config entry: an
acknowledgment of a superseded version is the compliance record that the person
acknowledged that version, so a new version assigns afresh and the old rows
stand beside it. Plain columns, no expression.

**What the sabotage found, and what it corrected.** Commenting the index out of
the generated migration does NOT make the concurrency test's `blocked`
assertion fail, which is what D78's two existing entries had led the test's
first comment to claim. The second caller still blocks — on
`notification_dedupe_key_unique`, which keys the same (policy, version, person)
through the mint — and then writes the duplicate assignment anyway. So here the
COUNTS are the claim and the block only holds the timing; commenting out both
indexes is what makes `blocked` fail. The two back each other up, and a store
missing the distribution key serializes its distributions and still
double-assigns. The comment now says what was measured rather than what the
neighbouring tests measured.

**Two enforcements with different lifetimes.** The assignment row can be
deleted and the notification row cannot, so a redistribution after an
assignment was cleared writes a real new assignment and must not hand the
person a second copy of a message they may not have read. The index wins, as it
does in D51, and the difference is REPORTED rather than hidden (D54): the
answer carries `notified` alongside `distributed`, and they differ exactly when
this fired.

**What the store answers that the original reconstructed.**
`User.list('-created_date', 5000)` filtered by `u.agency_name ===
me.agency_name` is D41's and D43's derived scope in its WRITING form, over an
entity whose own schema calls `agency_name` a self-editable label (D23). It is
deleted. `pennsync_private.agency_roster` is the authoritative population and
carries the verified address AND the membership envelope the notification
needs, so one query replaces the scan, the `is_approved` check, the
`role !== 'admin'` exclusion and the address lookup. `failed` and `failures` go
with the compensations: the original reports them because each create stands
alone, and one transaction has no partial state to report.

The trail entry is `policy_distributed` on subject kind `other`, which is what
`invitation_resent` uses and what that kind is in the list for — the activity
trail's kind enumeration lives in a migration every deployment has applied, so
naming a policy there would be a forward migration against a shared facility
(D88) to say what the subject id and `policy_title` already say.

**D88 applied on purpose for the first time.** Regenerating the record store to
add the index is a change to what a NEW store gets and reaches no deployment
that already ran the file, so `20260920545000_policy_distribution_index.sql`
ships beside it, DERIVED by `tools-pennsync-record-catchup.mjs` rather than
typed, with the fingerprints re-pinned in the same change. It uses `create
unique index if not exists` rather than a drop and recreate: dropping a unique
index on a live table opens exactly the window the index is there to close.
**No deployment has run the regenerated file yet**, so nothing is owed beyond
applying both — and hosted staging is still owed D82's catch-up first.

**The existing call site is admitted, and this is the reasoning the gate asks
for.** `src/functions/distributePolicyAcknowledgment.js:4` names no tenant, so
it relies on `portedCall`'s bound one — the second such site after D81's two,
and the gate refuses until a reviewed diff says the fallback is right here. It
is. `PolicyAcknowledgmentManager.jsx` lists its policies through
`listPolicyLibrary`, which binds the same active tenant context, so the policy
an administrator picks and the roster this distributes to come from one agency;
and a mismatch cannot distribute to the wrong roster, because the contract
takes both the policy and the cohort from `p_agency` and answers
`PENNSYNC_POLICY_NOT_FOUND` when the policy is not in it. Fails closed either
way.

Port queue: 0 / 7 / 0 / 2 / 12 / 0 / 0 / 0 / 2 / 76 — `records_schema` falls
from 3 to 2, which is the first time the bucket has fallen by a port being
WRITTEN since D75 took it to zero by correction. The two left are
`generateAIReport`, which carries two `Core.SendEmail` behind
`outboundDeliveryGate` and stops at the owner's flip, and
`sendExpirationNotifications`, which is D49's shape and waits on a scheduler
identity nobody has chosen. (D90 then wrote the second of those, and found
that second sentence half wrong where it matters most: the capability has no
integration reach at all, so the wait is on the unattended run and nothing
else. The measured line is in AGENTS.md; read it rather than this one.)

## D90 — Warning a nurse that a credential is about to expire, and the label that routed a reader wrong

`sendExpirationNotifications` becomes
`services/authority-store/supabase/record-migrations/20260920550000_contract_expiration_notices.sql`,
the eighth PARTIAL port (after D31, D35, D36, D59, D73, D81 and D89) and the
last of D49's four scheduler capabilities. It is partial on two axes and
NEITHER was decided here — both were already settled and the port only had to
read them.

**The label was wrong before the module was read, and that is the finding to
carry.** This page said at D89 that the capability "puts `schedulerAuth`
beside `role === 'admin'`, which is D49's shape, so the per-agency half ports
and the unattended cross-tenant run waits on a scheduler identity nobody has
chosen" — true — and the working notes around it had it filed as a delivery
hold, "partial at best". It has **zero integration reach**: no `Core.`, no
`integrations.`, no send of any kind, and every output is a
`Notification.create` row, which D51 settled is a row rather than a message.
So it touches no owner hold at all. That is the same error as the routing
written three hours earlier from three handler NAMES and corrected two minutes
later by reading three modules, and the same error D74, D75, D76 and D79 each
record once: **a bucket keeps its name after the reason for it has gone, and
so does a note about a bucket.** Re-derive from the tree.

**Axis one: the training half is not here and is not zero.** The module is two
independent sweeps in one handler. The first reads `TrainingAssignment`,
dispositioned `hub`, and D84's `uncarried_legs` entry already settles that leg
by name — `sendTrainingNotifications` lives on the Support Hub (D9). The
answer therefore says `training_expirations: 'served_by_hub'` with a code,
rather than reporting a count of zero that reads as "no training expired".
D73's rule about a paused half, arriving about an absent one.

**Axis two: D49's gate, for the fourth and last time.** The human gate is the
built-in `role === 'admin'` that D14 and D22 removed, whose successor is
D40's `agency_admin` scoped to their own agency; the machine gate is a shared
secret over every tenant, which has no successor because nothing in this store
is cross-tenant. This is the per-agency half. **The scheduler identity was not
taken to unblock the port, and taking it was not necessary:** "a real
per-agency identity the scheduler acts as" means minting a long-lived
credential with standing access across tenants, which is a decision about an
authorization model rather than a choice among identities that already exist —
D56's rule, as D77 applied it to the file runtime's ownership check.

**The tier arithmetic is D50's, reused rather than rewritten, and this is the
capability D50 names.** The renewal original's own comment says the three
credential-reminder crons once shared `reminder_offsets_sent` with different
tier sets, "so whichever fired a shared tier first consumed it for the others
(e.g. sendExpirationNotifications marking tier 30 suppressed this renewal
email)" — this one. Its column is `expiration_note_offsets_sent`, the third of
the three, and `credential_due_offsets(expiration, sent, tiers)` already takes
the marker's VALUE and the tiers as parameters for exactly that reason. It does
NOT reuse `credential_sweep`: that body COUNTS the due tiers and deliberately
does not claim them, because its two capabilities' send is paused and a claim
without a send loses the reminder permanently. Here the send exists, so this
body claims. The suite proves the isolation in BOTH directions — this sweep
fires although both sibling markers are full, and the siblings still have work
after this one claims.

**The deletions are the familiar ones.** The 500-row cap goes (D50's
distinction: the ASCENDING order is the rule, because the original's own
comment records a descending sort dropping the imminent expirations off the
tail; the cap is the paged-client artefact). The 5000-row `User` scan goes
twice over — once as `agencyByEmail` and once as the administrator list built
from `role`, `account_type` and `agency_name` — which is D41 and D43's rule
and the sixth original whose derived scope the tenancy replaces. The claim
token, the read-back that checks it survived, and the release-on-failure write
go with the transaction (D46, D51). A credential whose holder is no longer on
the roster is REPORTED as `unreachable` rather than addressed at a dead
identity, and its tiers are not consumed, so the warning is still owed.

**Two INDEPENDENT enforcements, and the reading was measured rather than
reasoned about.** The marker column is a field anything may edit; the dedupe
key is an index; the row is also taken `for update`. D89's lesson was that
which enforcement answers cannot be read off the code, so
`record-contract-postgres.test.mjs` removes each in turn. The result
contradicted this port's own first draft of the comment: with `for update`
gone the loser still blocks — on the dedupe index, inside the mint — and
answers `already_warned: 1` while writing and claiming nothing; with the
dedupe key made unique per mint the lock alone holds it; only removing BOTH
warns the holder twice. So unlike D89's pair, either alone is sufficient here,
the lock decides where the loser stops and the index decides that it stops.
**The first draft of the header asserted the opposite and read exactly like a
correct one.**

**The administrators' summary names nobody, and the test that said so proved
nothing.** The original's `metadata: { expirations: scoped }` carries each
colleague's name, their credential's title and its date, and
`notification_read` is agency-WIDE — D44's rule, arriving about personnel
rather than a patient. Nothing in the SPA reads that blob: the type appears
only in three allowlists. The first version of the assertion read
`summary.metadata` back through `pennsync_contract_notification_list`, whose
`projectNotification` says in its own comment that it returns no `metadata` —
so putting every name back in the blob passed the test. It now reads the
STORED row. That the reader drops the column is not a reason to store it: the
detail would sit in an agency-wide table with nothing reading it, a disclosure
surface with no consumer, and D45's defect was precisely a writer and a reader
disagreeing about which columns matter.

**One divergence is the port's own and is a narrowing.** The original mints an
administrator summary on every invocation; this one keys it on (agency, day,
recipient), so a second press of the button does not notify colleagues twice.
The suppressed ones are COUNTED (D54), not hidden. The wording also drops
"training certifications or", which this half no longer reaches.

One property is inherited rather than chosen and is worth knowing: the mint
sets no `expires_at`, so neither do the ADR, incident, policy or credential
ports. Nothing in this store reads that column, so the original's 30-day and
7-day expiries are inert here.

This port is purely ADDITIVE — no `CONTRACT_UNIQUE` entry, so no regeneration
and no forward migration under D88. The fingerprint pin shows one ADDED file
and zero CHANGED, which is the shape that says so.

**Port queue:** `records_schema` falls 2 to 1, the second time by a port being
written rather than by a correction. What is left is `generateAIReport`, which
carries two `Core.SendEmail` behind `outboundDeliveryGate` plus an
`InvokeLLM` — D81's template, and it stops at the owner's flip.
(**Corrected by D91**, which read the module: it carries ONE `Core.SendEmail`,
the other match being a docstring, and that one sits on a branch the module
already refuses itself. It was a partial port rather than a wait, and the
sentence above is left standing because it is the eleventh instance of the
defect this entry is about.)

## D91 — The AI report, and a scope filter that let its caller choose its own scope

`generateAIReport` is ported as the **ninth partial port** (after D31, D35,
D36, D59, D73 and D81): the document is served and `recipients` gets the
original's own paused refusal. `20260920560000_contract_report_metrics.sql` is
the read, `services/pennsync-api/report-metrics-source.mjs` carries the
original's arithmetic and page, `report-metrics.mjs` feeds them and
`ai-report.mjs` is the capability.

**The label on it was wrong, and this page carried the wrong label.** D90's own
entry, the port-queue paragraph in AGENTS.md and the working notes all said this
capability "carries two `Core.SendEmail` behind `outboundDeliveryGate` plus an
`InvokeLLM`", which made it read as blocked on the owner's delivery decision. It
has **one** `Core.SendEmail`, at line 393; the other match was a docstring
saying "Returns an HTML string for SendEmail's body". And the one send sits
inside `if (recipients.length > 0)`, on a branch the module **already refuses
itself** at line 275 through the generated gate. That is D79's
`generatePatientHandout` exactly, and D79 wrote the discriminator for it: does
the module have a success answer that is NOT the integration's result? This one
answers with a PDF. So it was never one flip away; it was a partial port, and it
took an afternoon. **A grep for a call's SHAPE is not a measurement of what the
code can reach** — that is D76's defect and this is its eleventh instance, again
in a note somebody wrote confidently the same day.

**What the original's scope filter actually was.** Its own comment says the
filter exists "so an agency_admin cannot pull every tenant's PHI into a
PDF/email". No `agency_admin` can reach the code. The gate is `isAdminLike`,
which is `u.role === 'admin'` and nothing else, and `withTrustedClaims` returns a
built-in admin's profile **untouched** — its first line is
`if (profile.role === 'admin') return profile`. So the only caller the code can
reach is the platform tier, and for that caller `account_type` and `agency_name`
are the self-editable labels D23 describes. **The scope was selected by the
person it was meant to constrain**: `account_type: 'super_admin'` skips the
filter entirely, and any `agency_name` scopes to that agency. D69's rule (read
what the code can REACH) and D36's (a comment is not a permission) arrive in one
place. Under D40 the successor is an `agency_admin` scoped to their own agency —
the sixth widening — and the boundary is real for the first time.

**The contract COUNTS rather than projects,** which is new. The original pulls
nine collections — up to 5,000 patients, 5,000 profiles, 5,000 tasks, 5,000
alerts, 5,000 notes, 1,000 visits, 500 incidents, 500 audits — into an isolate
to count them, and every one of those rows is a chart or a colleague. The report
is counts, rates and a staff table, so the counting happens where the policies
are and what crosses the boundary is arithmetic inputs. That also makes D64's
naming rule trivial to honour: there is no row to project.

The split with the service is D71's. Which rows may be counted is SQL; the
arithmetic over the counts is the original's own `calculateMetrics` and
`calculateDailyTrend`, handed arrays rebuilt from the aggregates. **Why that is
faithful and not a re-implementation:** those functions read each array in
exactly two ways — count members matching a literal field value, and sum one
numeric field — so an array with the same members carrying the same values
produces the same answer, and it is the original's `.filter`, `.reduce`,
`.toFixed(1)` and division doing the producing. The one thing that could have
gone wrong is a float sum, and the contract's two groupings are complete
PARTITIONS of the rows they count, so every sum is carried whole on one member
and the rest add zero. Where a sum is taken in SQL its accumulation order is
pinned to the original's, because float addition is not associative and an
unordered `sum()` is not reproducible between two runs of the same query.

**Two findings about the tables, both from the policies rather than from
reading the original.** `compliance_audit` reaches tenancy through its **visit**,
not its patient — the first draft of the contract asked the patient column and
counted zero audits. And the original's `!x.patient_id || ...` branch is LIVE
for an audit (visible through the visit) and DEAD for a `patient_alert`, whose
only path is the patient, so an alert with no chart is in no tenant and nobody
has ever read one. Read the policy to tell which case you are in.

**Two sabotages found real gaps rather than confirming the tests.**

*The agency naming looked redundant because no fixture held two agencies.*
Removing `v."agency_id" = p_agency`, and removing the audit's whole visit
predicate, both left every test green — because the fixtures' callers hold one
membership each, so the policies' `caller_agencies()` happened to be a single
agency. That is precisely D51's trap. A test that gives one administrator
memberships in BOTH agencies and asserts every figure counts one of them now
exists, and it is the test that gives the agency naming its teeth.

*The daily trend's timezone risk is invisible in a UTC process.*
`calculateDailyTrend` buckets with `setHours(0, 0, 0, 0)`, which is LOCAL time,
while the contract counts by UTC day. The bridge feeds it a stub at UTC noon so
the two frames agree; changing that to midnight passed every test, because the
test process runs in UTC — and would have shifted every bar a day back in any
western zone, which is where this service would actually run. The test that can
tell sets `TZ` to `America/New_York`.

**Recorded and not honoured**, in the original's own shape: `metrics` is
destructured with a default of `['all']` and never referenced again, so every
report is the full report; and `Math.floor(Number(raw) || 30)` means a caller
asking for **zero** days gets the default month rather than one day, while a
negative number does floor to one. Kept as written.

**One ordering divergence, and it is a narrowing.** The original checks its role
gate, then `report_type`, then the delivery pause. Authorization is the
contract's here, so the required-field check moves after it: a caller who may not
run the report can no longer learn whether their body was well formed.

The training figures are **absent rather than zero**. `TrainingAssignment` is
`hub` and D84's `uncarried_legs` entry already settled that leg by name, so the
two lines are omitted from the page — printing the zero an empty array produces
would tell an administrator that nobody in the agency trained, and a marker in
their place would render as `Avg Training Score: served_by_hub/100`. The answer
says where the leg is served. That is D69's scoped transform.

There is no SPA call site for this capability at all, as there was none for
D70's chart export.

**Port queue:** `records_schema` falls 1 to **0**. D75 took that bucket to zero
on a CORRECTION; this is the first time it reaches zero with every capability in
it written — D84 put three there deliberately and D89, D90 and D91 built all
three. Note that `portQueueLine` omits an empty bucket, so the measured line no
longer names `records_schema` at all. What remains is `entity_authorization` 7
(the admin and write paths D82 does not reach), `files` 12 (the integration
runtime's uploader-owned reader model, D77 and D85) and `external_secret` 2 (the
transcription key, D87) — none of which is engineering capacity here.

## D92 — The release ladder's integration flag, crossed against what the tree can reach

`tools-pennsync-release-ladder.mjs` places a handler in a wave partly by
`HANDLERS[name].needsIntegration`, and it reads that flag off the registry
rather than deriving it. The comment above `integrationDependents` gives the
reason and the reason is right: `runtime.mjs` decides `/readyz` from the same
flag, so a second answer computed here could disagree with the thing that
actually gates the deployment.

**What was missing is the cross-check, and a module header already claimed it
existed.** `services/pennsync-api/account-email.mjs` ends its own header with
"Releasing therefore means three things, and a fourth that a gate rather than a
person asks for", and names the fourth: the release sets `needsIntegration:
true` on both registry entries in the same change, or the ladder hands a
deployment two outbound senders inside the wave whose whole promise is that
nothing in it writes or sends. No gate asked. The sentence described a check
that did not exist, which is the shape D77 records about a test whose comment
describes something the test does not do, arriving this time in a module
header — and D78's lesson exactly: a rule written down is not a check, and
`chart_assignment`'s locking rule was written down and then broken twice.

**The derivation is the handler's own signature.** `integration` is minted per
request in `app.mjs` and handed to `handle` as one property of one object;
there is no module-level access to it. So a handler that does not destructure
`integration` cannot call the runtime whatever its module imports, and one that
does can. `integrationReach` reads the parameter list of every registry entry's
`handle`, and `integrationFlagHolds` refuses `LADDER_INTEGRATION_FLAG_DISAGREES`
when the two sets differ.

**Both directions are refused and they are different mistakes.** Reach without
the flag is the wave-4 hazard: a released send placed in a wave that does not
require the runtime to be configured. The flag without the reach is the
opposite and still wrong — it holds a name out of an earlier wave for a
dependency it does not have, and a wave nobody can release is how a ladder
stops being used.

**It fails closed on a shape it cannot read**, the rule `handlerReach` follows
for a computed contract name and `invokedFunctions` for an unparsed callee. All
80 registry entries destructure today; a `handle(deps)` reading
`deps.integration` is refused as `LADDER_HANDLER_DEPENDENCIES_UNREADABLE`
rather than read as reaching nothing, because the silent answer is the
dangerous one. D47 and D75 are three instances of a check that knew one shape
of a pause and missed two others, so a check written today declares which shape
it can read.

**One bypass is closed with it.** Four handlers destructure `config`, which
carries `integrationsUrl`, so a module could fetch the runtime without the
capability at all. Nothing outside `integrations.mjs` and `runtime.mjs` names
that field, and `LADDER_INTEGRATION_RUNTIME_REACHED_DIRECTLY` keeps it that
way — which is what makes the signature derivation sufficient rather than
merely usual.

On the committed tree the two answers agree on all 17 handlers, so nothing
moves and no wave changes. `sendAccountReadyEmail` and `sendWelcomeEmail` stay
in the read-only wave, which is what the shipped code honestly is: they reach
no runtime while their sends are refused, and `SendEmail` is not in
`BROKERED_OPERATIONS` either. All four refusals were proved by sabotage against
the real tree before the fixtures were written.

## D93 — What merging a migration owes an operator, said before the merge

D88 recorded that a migration a deployment has applied is frozen, and pinned
every file's sha256 so an EDIT to one is answered at PR time. The other half
was never said anywhere: an ADDED migration is the ordinary case, and merging
it does not apply it either. `main` then goes red in `hosted-store`, whose
ledger check is the only thing in the repository that can see the gap, and
whose credential is why it runs on `refs/heads/main` — structurally after the
merge. On 2026-09-23 that cost a day: the red was diagnosed from scratch,
found to be a merge nobody had applied, and cleared by an operator run.

So the consequence of merging is now reported on the pull request, by
`tools-pennsync-apply-signal.mjs` and the `apply-signal` job beside
`hosted-gap`. It names the arriving migrations, says that until an operator
applies them the `hosted-store` job fails its ledger check by that many rows —
**an expected red rather than new drift** — and gives the command. An edit and
a withdrawal are reported apart from an addition, because the answers differ: an
edit wants a forward migration, a withdrawal leaves `MIGRATE_LEDGER_UNKNOWN` on
every deployment that ran the file.

**It is a signal and not a gate**, and that is the decision rather than a
default. The apply is an operator action on a machine CI cannot reach, so
nothing inside a pull request could satisfy a gate, and one would stall every
merge in the repository on one person's availability. The only non-zero exit is
a refusal to MEASURE.

**It claims nothing about any deployment, deliberately.** "Does this change add a
migration" is a fact about the diff and needs no credential; what a store
actually holds stays `hosted-store.test.mjs`'s half. Merging the two answers is
how a prediction comes to be read as a measurement.

**What it reads is the pin, and the pin is cross-checked on both sides before
anything is counted.** `migration-fingerprints.json` already carries every
committed migration keyed `<directory>/<file>`, and `git show <base>:<pin>` reads
it at a commit with no worktree and no second copy of the provisioner's ordering
rules. The risk that brings is this repository's recurring defect — a check that
decides from one representation and is silently wrong when the same thing arrives
in another — in its sharpest form: a change that added a migration and did not
re-pin would be reported here as adding **nothing**, quietly, while the
fingerprint ratchet failed elsewhere for its own reasons. So the head side is
compared against the real directories through `fingerprints()` and the base side
by NAME through `git ls-tree`, and a disagreement REFUSES rather than reporting a
number. Names only on the base side is a deliberate limit, stated where it is
enforced: it catches the one drift that would understate the count, a file
present at the base and missing from its pin, which makes the same file at the
head look new.

`LOCAL_ONLY_MIGRATIONS` is imported from the migrate tool rather than re-listed,
so the one migration deliberately held back from every deployment is named with
its reason and owes no apply — the difference between a count somebody can check
and one they have to trust.

The base is the caller's to choose and an unreadable one is refused rather than
defaulted. On a `pull_request` run the checkout is the MERGE commit, so the tree
is the merged result and its first parent is the base branch: the comparison is
literally "what would merging do". On a push the payload's `before` is exact
where `HEAD^` would miss all but the last of several commits.

Each check was proved by SABOTAGE rather than by reading: dropping the head
cross-check, counting the held-back migration, and dropping the base cross-check
each fail exactly one test and no others.

## D94 — The ledger records what it ran, from here forward and never backwards

**Decision.** Every migration applied by `tools-pennsync-migrate.mjs` from now
on records its own text in `supabase_migrations.schema_migrations.statements`,
inside the same transaction as the migration and its `version` and `name`. A
row that is already there is **left alone** and reads as `unrecorded`,
permanently. That is not a gap waiting to be filled; it is the answer.

**So a ledger whose `statements` are almost all null is CORRECT, and is not a
bug in this change.** Every row hosted staging holds was written before this
existed and none of them will ever be filled: emptiness there means the text is
unknown, which is true, and the alternative — a confident wrong answer — is the
thing D88 was written about. The column fills in from the next migration
applied through the tool onward, one row at a time, so the longer ago a store
was built the emptier it looks. Read the `verdict` rather than the column's
fullness.

**Why now.** D88 is the defect: `planMigration` decides what to apply from a
migration's NAME — rightly, because the Supabase CLI stamps its own version at
push time and the name is the only stable key the two sides share — and the row
it wrote carried nothing about the content. So a file edited after it ran is
skipped forever on the store that ran it and applied in full on every store
built afterwards, with nothing between them that compares. Every suite in this
repository builds from nothing, which is the one case the defect cannot appear
in. D88 recorded that the column exists and the ledger was simply being told
nothing, deferred filling it, and said **keep both when the ledger side is
built**. Both are here: the sha256 pin answers "did this commit change a file
that was pinned", before a merge and with no database; this answers "does this
store hold what the tree says it ran", with a database and no commit.

**D88's first reason for deferring holds, and is now a verdict rather than a
paragraph.** Backfilling the rows already there would say nothing true. The
insert this tooling wrote names `version` and `name` only — re-read from the
code rather than remembered — so for every migration it has applied, the text
is not recoverable from the store or from the tree: the row carries no time,
and the fingerprint pin is a fact about a commit rather than about a
deployment. Writing today's text into those rows would assert something nobody
observed, and for `20260919170000_record_store.sql` — the file this defect
actually happened to — it would record the edited text as though it had been
applied, erasing the evidence of the gap. So `compareLedgerStatements` reports
such a row `unrecorded` and the whole verdict `unverifiable`, never `verified`.
A store that says nothing must not read like a store that says yes.

**D88's second reason is answered by two things rather than by a promise.** The
hazard it named is real: populating the column faithfully means splitting a
migration into statements, which means a reader that handles dollar-quoted
bodies — every function in this store is one — and a splitter subtly wrong
would write a plausible wrong answer into the place the next person trusts.
There is no new parser. The split is taken from `executableText`, the reader
`migrationWithLedgerRow` and the management transport already share, and it
splits by OFFSET into the original text with the result checked to reconstruct
it exactly. A split in the wrong place is then still a faithful record of what
ran; a split that lost or duplicated a byte is a refusal rather than a row.
Measured against the corpus rather than assumed: a nesting-aware reading of all
74 committed migrations is byte-for-byte identical to `executableText`'s, so
nothing in the tree exercises the one construct it reads loosely.

**The ledger has two writers, so a row says who wrote it.** Nine of hosted
staging's rows were pushed by the Supabase CLI, which populates `statements` in
its own shape. Comparing one of those against this module's split would report
drift where there is none, and a check that cries wolf is a check that gets
ignored. Every array this tooling writes begins with
`-- pennsync:ledger-statements:v1` — a SQL comment, so the array is still a
sequence of harmless statements to anything else that reads it, and versioned,
so a later format is told apart rather than silently compared. A row whose
first element is not that marker is `foreign` and nothing is claimed about it.

**One migration is over the budget, and it is the ironic one.** Recording the
text doubles the request that carries it: the migration travels once as SQL and
once as a literal inside its own ledger row, and it has to be ONE request
because the row commits inside the migration's transaction. `record_store.sql`
is about 463 KiB, which already works; about 926 KiB is untested, and the
management endpoint's real ceiling is not measurable from this repository. So
`LEDGER_STATEMENT_BUDGET` is **a bound chosen, not a limit measured**, and it
is written that way. Over it the migration still applies and its row is written
without statements, reported as skipped with its reason — the capability is
never traded for the record, and the degradation is in the answer rather than
in an empty column found later. Exactly one committed migration is over it
today and a test names which, so the day a second crosses is a failure rather
than a surprise. It is worth saying plainly that this is the very file D88 was
about: on a store that has already applied it — which is every store that
matters — nothing changes, and on a fresh one the forward-migration rule and
the pin are what cover it.

**What it does not claim.** Nothing about hosted staging. All of its rows
predate this, so the first thing this can say there is about the next migration
applied through the tool, and until then its verdict is `unverifiable` and
correct. The hosted comparison on `main` stays the only thing that reads what a
deployment holds. Merging the two answers is how a prediction gets read as a
measurement, which is D93's rule and unchanged.

**The test that matters is the one that is not either half's own.** The writer
builds a literal and the reader parses a column, and two halves that only ever
meet inside one process are not proved to agree by either one's suite — D45's
rule, learned when a fan-out stamped three of six envelope columns and both
contracts' suites passed. `services/authority-store/tests/migrate.test.mjs`
applies a migration carrying a plpgsql body, a doubled single quote, semicolons
inside a string and inside both comment forms, and a dollar tag naming the
literal's own default, through a real ledger column in PGlite; reads the row
back out of the database rather than out of the value that was written; then
edits the file and watches `pending` stay empty — the defect, unchanged and
unfixable, since an applied migration is never re-applied — while the verdict
moves to `drifted`. That is the whole of what changes: the tool still will not
re-apply it, and now it says so.

**Five sabotages were run and the one that did NOT bite is the useful one.**
Trimming each statement, dropping the marker check, calling an unrecorded
ledger verified, and splitting on every semicolon each fail the suite. Quoting
the literal by doubling single quotes instead of dollar-quoting **passed** —
because it is also correct. So the comment that claimed dollar quoting was the
safe choice was rewritten to say what is actually load-bearing: that the tag is
checked absent from the text rather than assumed absent. A sabotage that does
not bite is not always a missing test; sometimes it is prose claiming more than
the code does.

## D95 — What the hosted comparison could not see, and what it is not asked to

**Decision.** `hosted-store.test.mjs`'s inventory now compares each object by a
representation chosen against a planted change rather than by the first
representation that came to hand. Eight dimensions are added — relation KIND,
column DEFAULT, whether a column is GENERATED or an identity, index VALIDITY,
a function's full ARGUMENT list, STRICT, LEAKPROOF, and a schema's CREATE
privilege beside its USAGE. `store-inventory.test.mjs` plants a case for each of
them in a scratch build and fails if the comparison stays quiet. The dimensions
listed at the end of this entry are deliberately NOT compared, and the reason
is written down beside each.

**Why now.** This suite is the project's answer to "do the prerequisites hold".
Every deployment question routes to it and a green reading is taken as proof
that the committed migrations and the hosted store are the same artifact. So
its blind spots are the project's blind spots — and nobody had audited it,
which means every one would have been found the way the first five instances of
the house defect were found: by costing something first.

**The finding is the house defect again, in the suite written to catch drift.**
A check decides from ONE representation and is silently wrong when the same
thing arrives in another. Here it arrived twice over. The OBJECT KINDS it
compares left a whole class out: `relkind = 'r'` means ordinary tables, so a
VIEW beside a record table was invisible in the table list, in the column list
and in the caller-privilege cross-product at once. And for the kinds it did
compare, the representation left the semantics out: `format_type` and
`attnotnull` are not the column, `pg_get_triggerdef` is not the trigger, and
`pg_get_function_identity_arguments` is not the signature.

**Every change in this table was BLIND, measured and not reasoned about.** Each
was planted in a PGlite copy of the committed store and the comparison reported
zero faults. Ten of them; they collapse into the eight dimensions above, and
the shipped fixture pins one case per dimension rather than all ten — a
materialized view and a sequence are closed by the same relation-kind widening
as the view, and pinning the cheapest of the three keeps the suite at two
builds.

| planted | why it matters |
| --- | --- |
| a view over `pennsync_records.patient`, granted to `authenticated` | reads every tenant's rows past every policy |
| a materialized view, same | the same, with a stale copy of the rows on disk |
| a sequence granted to callers | a relation kind the store does not create, appearing in it |
| `chart_assignment.granted_at`'s DEFAULT dropped | D33: both pre-existing writers insert without naming it |
| `membership.membership_key` made a plain column | D34: it replaces a forty-line `validateMemberships` |
| `provenance_immutable` disabled | every immutability guard in this store is a trigger |
| `chart_assignment_request_key` left invalid | a unique index that enforces nothing; D78 catches it by name |
| an argument default removed from a contract wrapper | PostgREST resolves an RPC by the names of the body's keys, so the defaults decide which call shapes exist |
| STRICT dropped, LEAKPROOF added | both live outside `prosrc`, which `md5(prosrc)` is the whole of |
| CREATE granted on `pennsync_records` | `usage` was asked and `create` was not |

The view is the sharpest and was proved rather than argued: on a real
PostgreSQL 16 cluster, `authenticated` reading `pennsync_records.patient`
answers `permission denied for function deployment_app` and the same role
reading a view over it answers the row. A dashboard SQL editor session runs as
`postgres`, so this is one convenience view away at any time.

**A blind spot I reported to myself and had to withdraw.** A foreign key's ON
DELETE action first read as uncompared, and it was not: `pg_get_constraintdef`
carries it, and the scratch harness that "proved" otherwise had quietly dropped
`constraints` from its own copy of the inventory. Two lessons, and the second
is the one to keep. Sabotage catches what reading misses, and a sabotage
harness is itself a check that can be wrong — so a case that comes back BLIND
is not a finding until the harness has been shown to bite on something. Three
already-covered dimensions (that foreign key action, a policy widened to
`true`, a rewritten function body) are now permanent CONTROLS in the new suite
for exactly this reason: a fixture that only asserts the gaps it just closed
cannot tell a real gap from a hole in itself.

**The new fields are deparse-stable across the version gap, measured.** Hosted
is PostgreSQL 17.6 and the reference build is PGlite's 18.3, and two of the
additions carry deparsed text (`pg_get_expr` for a default, and
`pg_get_function_arguments`) where a version difference would be a false red
every run. The whole extended inventory was built on a real PostgreSQL 16
cluster and compared field for field against the PGlite build: **0 differences
across 179 relations, 3,402 columns, 582 constraints, 208 indexes, 413
functions and 21 triggers.** 17 sits between 16 and 18, so this is strong
evidence and not a measurement OF 17 — the first hosted run is that, and the
`contype = 'n'` note already in the suite's header is what a real gap looks
like when there is one.

**One dimension is READ and not asserted, and that is the awkward answer rather
than the tidy one.** A record table in a logical replication publication
streams its rows to whatever holds the slot, which on a Supabase project is
Realtime, enabled per table from the dashboard with one click — a row path out
of the store that no policy here sits on. The reference build publishes
nothing, so comparing the two would assert that hosted publishes nothing
either, and whether Supabase's `supabase_realtime` arrives empty or `FOR ALL
TABLES` is a platform fact this repository cannot measure: the job holding the
credential runs on `main`, so a wrong guess puts main red for a reason
discoverable only after the merge, which is D93's cost exactly. So
`publication_tables` goes out with the rest of the inventory, a test proves the
reading happened, and the first green run on `main` supplies the number.
Turning it into an assertion is then one line in `WHOLE_PARTS`. **Read the
number and close this**; an unasserted reading is a promise, and promises in
this repository go stale where nothing can notice.

**What is deliberately NOT compared, and why.** A longer list of comparisons is
not the goal; a slow or flaky suite would cost more than it caught.

- **Rows.** The suite's header already carries this and it is unchanged: no
  assertion reads a patient, a visit or a roster, because that needs a caller
  through the gate and no hosted caller will hold a session (the owner declined
  the staging accounts on 2026-09-22).
- **Column ordinal position.** The key is the column's NAME, and every contract
  projects by name while PostgREST is name-based throughout, so a reordering
  changes nothing any caller here does — and it cannot happen without a table
  rebuild, which moves constraints and indexes that ARE compared.
- **Collation.** No column in either schema declares a non-default collation
  (measured: zero), and the two sides are different PostgreSQL versions on
  different libc, so a collation's version legitimately differs and comparing
  it would be a false red. D78's argument that the timesheet's lookup is
  equivalent to a plain-column index rests on `identity_map` constraining the
  address with `lower(btrim(…))`, which is text normalisation rather than
  collation. **Revisit the day a migration declares one.**
- **Default privileges.** `alter default privileges` governs objects created in
  FUTURE, and an object created in future appears in this comparison as a key
  of its own. Comparing the cause when the effect is already compared buys
  nothing.
- **Storage parameters, statistics targets, compression, fillfactor.**
  Performance, not semantics. None of them changes what a caller may read.
- **Replica identity.** It decides what a publication streams, and publication
  membership is the thing read above; with no table published there is nothing
  for it to qualify.
- **Extensions, event triggers, publications' own definitions, FDW servers.**
  Cluster-scoped rather than schema-scoped. The suite reaches the hosted
  project through an account-wide management credential behind a fixed
  statement ALLOWLIST, so every read added is a statement that credential can
  send; widening it past the two schemas this store owns is a cost paid against
  objects this repository does not create.

**One correction carried in the same change.** The `hosted-store` job's own
comment said the suite "checks every statement with the migrate tool's own
`isReadOnly`". It has not for some time — the suite's header records why that
was replaced by a fixed allowlist, since `isReadOnly` classifies leading verbs
and `select some_write_contract(…)` passes it. Prose outliving the code it
describes, next to the credential it describes, is the same shape as everything
else in this entry.

## D96 — The publication reading, closed by the run that measured it

D95 widened the hosted comparison by eight dimensions and left a ninth
**read but not asserted**: publication membership. This entry closes it, and
the reason it is a separate entry rather than a footnote to D95 is that the
closing is the interesting half.

### What was deferred, and why it had to be

A table in a publication streams its rows to whatever holds the replication
slot. On a Supabase project that is Realtime, enabled per table from the
dashboard with one click. It is a row path out of the store that no policy in
this repository sits on — the record policies gate `select` by the querying
role, and a replication slot is not a querying role.

So it belonged in the inventory. What it could not be was an assertion. The
reference build publishes nothing, so comparing the two sides is an assertion
that **hosted** publishes nothing, and nothing in this repository could
establish that: Supabase creates a `supabase_realtime` publication on every
project, and whether it arrives empty or `FOR ALL TABLES` is a platform fact,
not a property of the tree. The job holding the credential is gated on
`refs/heads/main`, so a wrong guess would have been discoverable only from a
red `main` after the merge. That is precisely the cost D93 records and spent a
day on.

### What was done instead of guessing

The reading shipped with the inventory and the test **printed** it, because the
alternative — leaving a note that says "somebody should check this" — resolves
only if somebody remembers, and this repository's own record is that a thing
remembered goes stale in exactly the place nothing can notice. D79 is the same
lesson from the other side: the fix for prose that went stale was assertions,
not better prose.

### The measurement

The first `main` run under the widened check, on `a38a199`, 2026-09-23:

- the pairing was the real one — "Exercise the suite without a hosted target"
  **skipped**, "Measure the hosted staging store" **executed**;
- `tests 22 / pass 22 / fail 0 / skipped 0`;
- the printed reading: **no record or authority table is published.**

Worth recording beside it, because it is the answer to the sharper question
D95 opened: **"the hosted store is exactly what the committed migrations
produce" passed under the widened check.** No view, no materialized view, no
sequence, no dropped default, no removed GENERATED expression, no disabled
trigger, no invalid index, no changed argument default, no STRICT or LEAKPROOF
drift, no CREATE granted on either schema. The `relkind = 'r'` filter was a
hole in the net rather than something already through it. That is a statement
about hosted staging at that commit and about nothing else; it is exactly as
durable as the next run.

### The change

`publication_tables` moves from a read-only key into `WHOLE_PARTS` in
`services/authority-store/tests/store-inventory.mjs`, so it is differenced like
the caller privileges and the schema privileges. A record table enabled for
Realtime is now a fault with its own name in it.

The dedicated test in `hosted-store.test.mjs` stays rather than being deleted
into the comparison, for a reason worth keeping: a fault names a
**difference**, so with both sides empty the comparison is silent — and silence
is also what a reading that never happened looks like. The test asserts the
reading happened and keeps printing what it found, so the next person reads the
state rather than inferring it from the absence of a complaint.

`store-inventory.test.mjs` gains a thirteenth damage,
`create publication supabase_realtime for table pennsync_records.patient`, and
its expectation. **The new assertion was proved to bite before it was
believed**: with the damage planted and `publication_tables` in `WHOLE_PARTS`
all thirteen cases report; with the key taken back out, exactly one test fails
and it is the new one, the other twelve staying green. That ordering is D95's
own rule about the three controls, applied to the case that closes it — a
harness that has not been shown to bite proves nothing about what it does not
report.

Note that this case is not like the other nine in that file. Those were
**blind** and measured blind before the widening. This one was never blind; it
was unasserted on purpose. It is planted for the same reason regardless, which
is that an assertion nobody has broken is an assumption.

### The reusable part

Where a check cannot measure the value it would assert, there are three moves
and only the third is honest:

1. assert the plausible value — reds `main` after the merge when it is wrong,
   which is the thing D93 exists to stop;
2. leave it out and write a note — goes stale where nothing can notice;
3. **read it, print it, and say in the same breath what closing it takes** —
   the deferral closes by being seen.

This is the first deferral in the migration taken that way and closed within a
day of being taken. A dimension judged not worth comparing is still a real
answer, as D95 says, as long as the reason is written down; a dimension left
unmeasured is a promise, and a promise needs a date on it.

### What this does not change

Nothing about what is deliberately not compared. Rows, column ordinal position,
collation, default privileges, storage parameters, replica identity and
anything cluster-scoped stay out, each with its reason in D95. A longer list of
comparisons was never the goal.

## D97 — The mail channel, released separately from the service that carries it

D86 ported `sendAccountReadyEmail` and `sendWelcomeEmail` as the refusal and
nothing else, and wrote down in `account-email.mjs`'s own header what releasing
them would take: broker `SendEmail`, carry the field checks and the renderer,
delete the two `fail` lines, and move `needsIntegration` in the same change.
It left the work unbuilt because the answer might have been no. This entry is
all four of those, and it is recorded here because the code cites it in seven
places and a decision the code names has to exist.

### The one difference from D86's plan, and why it is the whole of the entry

The brokering is **not unconditional**. `PENNSYNC_API_DELIVERY` is a second
switch, read exactly and untrimmed as `PENNSYNC_API_RELEASE` is, and
`SendEmail` joins the brokered set only while it reads `enabled-v1`. Unset —
which is every deployment at the time of writing — this service reaches no mail
provider at all and both senders answer exactly what they answered before:
403 to a non-admin, 503 `OUTBOUND_DELIVERY_RELEASE_PAUSED` to an admin.

The switch exists because releasing a capability that writes a record and
releasing one that sends a person a message are different decisions with
different owners. D56 says the second is the owner's, so the flip has to be an
act rather than a consequence of the next deploy. Two properties follow from
that and are load-bearing:

- **`BROKERED_OPERATIONS` is untouched.** It stays D56's ratchet, so a reader
  still sees exactly what an unreleased deployment may ask for, and
  `DELIVERY_OPERATIONS` is the separate set an operator adds. Widening the
  ratchet would have made the two answers one.
- **The gate is a property of the config, not of the transport.** A brokered
  send is not the only way a message could leave, so `requireDeliveryReleased`
  asks the config and any future delivery path has to ask it too.

`branded-email.mjs` is a **copy** of the generated `brandedEmail` block as it is
emitted into the original, not a reimplementation: D81 set that rule for the
patient handout's templates and the reason is the same one, that the output is a
message a person reads. The parity suite loads the block out of the original,
renders both over fixtures exercising every branch, and extracts each sender's
own `renderBrandedEmail({...})` argument out of its `Deno.serve` body by
matching parentheses, checking that the match reconstructs the original text
exactly — D94's rule for a split.

Releasing delivery without `PENNSYNC_API_INTEGRATIONS_URL` throws at startup,
as every other incomplete release in `loadConfig` does: a channel that cannot
carry anything should not report itself open.

### What is deliberately not here

**Invitation delivery, which cannot be built as a send.**
`pennsync_records.user_invitation` carries no token column, and the original's
delivery is `base44.users.inviteUser`, which mints the account and delivers the
link in one platform call. A message from the owned stack would carry nothing an
invitee could sign in with. Giving it one means either a Supabase Auth admin
invite — a service-role key, which `validAuthorityKey` refuses by design — or
an acceptance path, and D6 already says what an acceptance path is here. Both
are decisions rather than ports, so `contract_invitation_resend` still freezes
`last_sent_at` and `resend_count` and the audit entry still carries
`delivery_paused: true`.

**Anything on `pennsync-integrations`.** Mail needs both services to permit it:
this switch, plus `INTEGRATIONS_RELEASE`, `SendEmail` in
`INTEGRATIONS_ALLOWED_OPERATIONS`, and a configured provider. That service's
configuration is not this decision's to change.

## D98 — A role gate is not a recipient, and a ready service that serves nothing

Two review findings on D97, taken rather than argued with, and they are the same
mistake at two levels: something was checked, and the thing it implied was not.

### The recipient was never bound to the agency

D97's `requireSender` asks the caller's `tenantRole` and nothing else, and
`params.email` reached the provider as the caller typed it. So once both
switches were on, any `agency_admin` could send a PennSync-branded message to
any address on the internet — and `sendWelcomeEmail` puts a working temporary
password in the body, so the relayed message is a credential notice carrying the
product's own branding.

**D40's standing instruction is the whole diagnosis.** Where a capability's only
gate was the built-in `role === 'admin'`, the successor is an `agency_admin`
scoped to their own agency, and when that widening hands you a capability you
re-read what the platform tier was **structurally** preventing rather than what
it permitted. One trusted operator sending branded mail is not the same
capability as every tenant administrator sending it. `sendWelcomeEmail`'s
original admitted the platform tier **alone**, which is exactly the signal D44
acted on when it added a self-approval refusal to a credential review: the role
gate is what makes the second check necessary.

So the recipient is resolved against `caller_roster(p_agency)` through
`listAgencyRoster`, and an address nobody in the agency holds is refused
`RECIPIENT_NOT_IN_AGENCY`. Four properties of that:

- **Nothing is derived.** The roster is already the answer to "who is in the
  agency I am acting in" — active memberships, with the verified address the
  carried `user` table has no column for (D41) — so there is no scope to
  rebuild, and the contract's own gate plus the policies decide.
- **What reaches `to` is the roster's address, not the request's.** They differ
  only in case, and taking the store's copy means the provider sees an address
  this store vouches for.
- **The resolution happens AFTER the pause.** A paused deployment answers 503
  without reading the roster, so it cannot be used to ask whether an address
  belongs to an agency. The order stays the originals' — authorization, pause,
  body — with the read last because it is the first step that reads anything.
- **The page walk is bounded**, the way `generateUserRosterPDF`'s is, so a
  contract answering a cursor equal to its own input cannot spin.
- **The two ends of that bound are different answers**, which is review's own
  finding and worth carrying as a rule. `RECIPIENT_NOT_IN_AGENCY` asserts a fact
  about the agency, so it is raised only where the walk saw the whole roster —
  the pages ran out, or the contract answered its own cursor back. A walk that
  stopped because the page budget ran out with `next` still set established
  nothing about the agency, and says so: 503 `RECIPIENT_LOOKUP_INCOMPLETE`. The
  ceiling is 200 pages of `contract_roster_list`'s own default page, so 40,000
  active memberships in one agency, which no agency reaches — the distinction is
  kept anyway, because **a bound that reports the wrong reason is how a real
  member's refusal gets read as policy.** The exact lookup that would remove the
  bound is not available without a migration: `contract_roster_get` resolves by
  user id and refuses anything that is not 24 hex, and these two capabilities
  are handed an address, so a by-address roster read belongs beside it in the
  contract rather than as a wider walk in the handler.

The narrowing is real and is the point: an administrator can no longer mail
somebody who is not in their agency. Anybody who can sign in has a membership,
so anybody these two messages are *about* is on that roster.

### Readiness reported a deployment that could serve no send

`publicReadiness` published `deliveryReleased` and ignored it. A deployment that
released either sender without `PENNSYNC_API_DELIVERY` answered `ready: true`
and then refused every send, so a rollout probe passed while the released
capability served no work. That is the defect the same expression already guards
one layer down for the integration runtime, in a comment that says so:
"a service reporting healthy and serving nothing, which is the failure readiness
exists to prevent."

`needsDelivery` on the registry entry and `requiresDelivery` over the released
set close it, mirroring `needsIntegration`/`requiresIntegration` exactly, and
`deliveryRequired` is published beside the flag so an operator can tell a
deployment that needs delivery and has it from one that needs it and does not.
Reading the registry's own flag rather than a second list of names here is
deliberate: two answers to one question is how they come to disagree.

`OWNER_HELD` still keeps both names out of every value the ladder emits. That
hold and this one are independent on purpose — the emitter refuses to produce
the value, and the deployment refuses to report itself ready for it — because a
hold kept only by what nobody pasted is one slip from gone.

## D99 — A person who never held a Base44 account, admitted the same careful way

D6 says identity moves by re-enrollment and never by credential copy: a person
is verified out of band, **accepts a Supabase Auth invitation themselves**, and
only then does an operator bind the two together with
`tools-pennsync-enroll.mjs`, which D6 calls "the only path an identity takes into
the owned store". That is the acceptance flow, and it works.

What it could not do is onboard anybody. `identity_map.base44_user_id` is
`not null` and shaped `^[a-f0-9]{24}$`, so every row needed an id issued by the
platform being left. The table was built to migrate ten known accounts, which is
a deliberate shape rather than an omission — and a dead end the first time
somebody joins who was never on Base44. The owner took that decision on
2026-09-25: build it, switched off, invite nobody.

This entry supersedes D6 in one respect only — **who may be admitted** — and in
no other. The invitation still comes from Supabase Auth and the person still
accepts it. The verification is still out of band. The operator step is still
the only way in, and no endpoint in the application creates an account.

### What changed, and the four things that did not

A second provenance kind: `base44_migrated`, which is every row the migration
writes, and `locally_verified`, which is a person admitted on evidence alone.

- **The column is not renamed and not made nullable.**
  `membership.base44_user_id` is `not null`, `membership_key` is GENERATED from
  it, `caller_identity`, `caller_roster` and `caller_roster_ids` join on it,
  `contract_roster_get` checks its parameter against the 24-hex shape, and 589
  record policies reach it through `caller_user_id()`. A nullable identity would
  have to be handled again at every one of those. So the column keeps its shape
  and every consumer keeps working; what widens is what it may hold — which is
  already what the consumers call it, since `caller_roster` returns it as
  `user_id`.
- **The two id spaces are disjoint by construction.** A locally verified id is
  minted rather than issued and must begin `ffffffff`; a migrated one must not.
  A Base44 id is an ObjectId whose leading four bytes are a unix timestamp, so
  that prefix is a date in 2106 — but that is why the prefix was CHOSEN, not what
  the rule rests on. What it rests on is the CHECK: if a real Base44 id ever
  arrived with that prefix, enrolling that person would be refused rather than
  conflated with a minted identity. It fails closed either way, so somebody
  else's id format is not load-bearing here.
- **The default is load-bearing, the reason D33's `granted_at` carries one.** It
  fills the rows that already exist, and it makes a writer that forgets the
  column fail closed: a minted id inserted without naming its kind is
  `base44_migrated`, which the id-space constraint refuses. The omission is an
  error rather than a row recorded as the wrong kind.
- **The kind is in the receipt's projection**, because the receipt is what a
  later audit reads to say what a run wrote, and how somebody was admitted is
  the part of that this decision added.

### The defect this migration would have introduced, which is the house shape

`protect_identity()` enumerates the columns it protects. Adding a column left it
**mutable**: the only update the trigger permits is a revocation, and a
revocation could have carried a `provenance` rewrite through with it. That is a
check deciding from an enumeration and being silently wrong about what the
enumeration does not name — D47, D75 and D79's shape, arriving in a trigger. The
function is replaced in the same migration, and the test plants that exact
update: a legitimate revocation with the column smuggled into it, refused, and
the same revocation without it permitted as the control.

### Switched off, and what that means concretely

The new kind is refused unless `PENNSYNC_ENROLL_NEW_STAFF` reads exactly
`enabled-v1`, untrimmed and case-sensitive, the discipline
`PENNSYNC_API_RELEASE` and D97's `PENNSYNC_API_DELIVERY` follow. It is asked
during PARSING, so a plan carrying a locally verified enrollment is refused
before a connection is opened, and a migration plan never asks it at all.

Nothing here sends anything. A test reads the tool's own source and fails if
`inviteUserByEmail`, `generateLink`, `signInWithOtp`, `resetPasswordForEmail`,
`signUp`, `admin.createUser` or a mail provider ever appears in it, and if
anything ever inserts into `auth.`. D99 is the decision that would have been the
moment to break that property, so it is a check now rather than a sentence.

**Merging this does not apply it.** The migration is a new file, so the hosted
ledger check will fail by one row until an operator applies it, which is D93's
expected red and is reported on the pull request by the apply-signal job. The
fingerprint pin moves in the same change.

## D100 — The owner hold is lifted, and an empty hold is not the absence of one

The owner released the two account emails on 2026-09-25. In the release thread
at 13:35:01Z, in his own words:

> Empty the owner-hold list so the account-ready and welcome emails can be
> released.

That answers D56, which is the decision `OWNER_HELD` carried. D56 held
`sendAccountReadyEmail` and `sendWelcomeEmail` out of every value the release
ladder emits for two reasons the entries stated: releasing them hands invitee
names to an outside provider, and `sendWelcomeEmail` puts a working temporary
password in the body of the message. Both were the owner's to weigh and he has
weighed them. `OWNER_HELD` is empty as of `d01359a`, and the ladder emits all
80 of the service's handler names.

### What this does not do

**It releases nothing by itself.** Lifting the hold lets a value be DERIVED
that names the two senders. Three things still stand between that and a message
leaving, and none of them is this decision's to move:

- **`PENNSYNC_API_DELIVERY` on `pennsync-api`**, which is unset. Until it holds
  the exact untrimmed `enabled-v1`, `SendEmail` is not in the brokered set and
  both senders answer 503 `OUTBOUND_DELIVERY_RELEASE_PAUSED`.
- **D98's recipient binding.** The address is resolved against the caller's own
  agency roster and an address nobody in that agency holds is refused. Lifting a
  release hold does not widen who may be written to.
- **The integration runtime's own release**, which is a separate service with a
  separate switch. The runtime brokering `SendEmail` and the API being permitted
  to send have always been two independent things, and they still are.

So the correct sentence about the product today has two halves and needs both:
the hold on the NAMES is gone, and no mail can be sent. Stating either alone is
how a posture change goes unnoticed in one direction and how a release gets
announced early in the other.

### An empty hold is not the absence of a hold

Six places withheld a held name: `releasable`, `heldLeaks`, `releaseLadder`,
`wave`, `cumulativeValue` and `reportDelta`. With the list empty none of them
can fire from the real tree, so deleting any one of them would have failed no
test — the guards would have kept their shape and lost the property that makes
them guards, silently, on the day the hold was lifted.

They are therefore parameterised: each takes the held set, defaulting to
`OWNER_HELD`, and the tests drive them from a SYNTHETIC hold built out of two
real handler names taken from the live ladder rather than typed, so a rename
upstream moves it instead of staling it. Each of the six was broken in turn and
each failure was observed before the change was believed.

The facility stays for the next name somebody must keep out of a value, and its
two rules stay with it: a held name must be a real handler, and its entry must
carry a reason rather than a label. Both are vacuous over an empty list, so both
are also driven over the synthetic one — a rule only ever checked against an
empty set is a rule nobody has seen work.

**And the assertion that matters most now runs the other way.** The tests assert
that both account emails ARE in the full cumulative value, and that the value's
length equals the handler count. A hold quietly restored, or any name dropping
out of the value, fails the build — because a value SHORTER than the deployment
is serving revokes the difference when it is written, which is the expensive
failure, not the noisy one.

### On the record

D98's paragraph saying `OWNER_HELD` still keeps both names out of every emitted
value was true when D98 was written and is left exactly as it stands. A dated
entry is a record of what was decided and known at its date; this entry
supersedes that sentence rather than editing it.

## D102 — An agency-wide setting keyed on an absent owner, against a schema that requires one (OPEN)

**This entry records a contradiction rather than settling it.** Nothing depends
on it today and closing it is a product decision, not a porting one.

`AIConfiguration` is one table doing two jobs. `UserSettings.jsx` writes a
person's own preferences and sends `user_email`; `AIConfigurationManager.jsx`
writes the agency's settings and sends none, so an agency-wide row is
identified by `user_email` being null — which is what
`contract_ai_configuration_read`'s `agency` scope filters on, and what the
admin screen has always created. The entity's own schema declares `user_email`
**required**.

Both cannot be right. Either the agency's settings are a row of the same table
distinguished by an absent owner, in which case the schema's requirement has
never described that screen's rows, or they are something else and the screen
has been writing invalid rows since it was written. Base44's own enforcement of
`required` is not measurable from this repository, which is why this is not
settled here: the only evidence in the tree is that one live screen satisfies
the requirement and another does not.

What the port does in the meantime is state the divergence where it happens.
`contract_ai_configuration_save` applies the requirement on the personal scope
and not on the agency one, `library_required` takes its list per call site
precisely so that this is visible at the call rather than hidden in a table,
and `contract-clinical-library.test.mjs` asserts the agency row is created with
a null `user_email`. So the behaviour is pinned and a later change to it fails
a test rather than passing silently.

**Whoever next opens that screen owns this.** The question is what an
agency-wide setting is keyed on. A separate `setting_scope` column, a separate
table, or a decision that the schema's `required` was always wrong for this
entity are all answers; guessing one inside a contract is not.

Note also the general finding this came out of, which is not about this entity:
the generated record store makes **every** entity column nullable and emits
**no column defaults at all**, so every capability's create path accepts rows
the Base44 schema would have rejected and writes null where the schema declared
a default. That is one generator decision with two consequences, and it reaches
every batch rather than this one.

*2026-09-25: the nullability framing in the paragraph above is superseded by
D108. The generator's universal nullability is deliberate and documented in its
own header — a legacy row predating a requirement has to be able to migrate
rather than be refused at load — so it is not a defect. The missing column
DEFAULTS are the real and separate gap. Every other word of this entry stands
as written.*

## D103 — Two screens decide what a caller sees from a label its subject can edit (OPEN)

**The finding.** `src/pages/AdminTraining.jsx:109` and
`src/pages/ManagerSkillGapDashboard.jsx:42` both widen the staff list they
render when `currentUser.account_type === 'super_admin'`, and
`ManagerSkillGapDashboard.jsx:17` treats `super_admin` or `agency_admin` as a
manager for the whole screen. D23 names `account_type` in `SELF_EDITABLE`: it is
a label the profile's own subject writes, which is why the roster contract
refuses to project it and derives `is_manager` from the authoritative tenant
role instead.

**The bound, stated here so the next reader does not have to re-derive it.**
This is a DISPLAY gate over rows the caller already holds, not an access
control. The list those branches filter was fetched by `User.list` under the
carried table's read policy, so what a claimed `super_admin` changes is which of
those rows the page renders and which layout it draws — not what the backend
hands over. D69 established separately that the backend strips a claimed
`super_admin` back to `'user'` through the shared `withTrustedClaims` helper
before anything privileged happens, so no server-side decision follows from it.
Nothing in `src/` reads these branches to authorize a write.

**Why it is recorded rather than fixed.** It is not a defect a port introduces
or removes, and fixing it means deciding what each screen should gate on, which
is the same per-screen work Stage J is made of. Fixing it inside a port would
change what a screen shows while claiming to change where it reads from.

**What it is evidence for.** It is the argument against projecting
`account_type` or `role` through the roster contract, which was proposed and
refused on 2026-09-25: the screens that read those columns are exactly the
screens that get them wrong, so projecting them for display would put a
self-asserted label back on the page beside the authoritative one under a
different name. A superseded column is not a missing one — `tenant_role` is the
answer to the question these branches are asking, and it is already projected.

**Whoever repoints these two screens owns this.** The substitution is
`tenant_role` for the `agency_admin` half; the `super_admin` half has no
successor, because D14 and D22 removed the platform tier and D40 replaced it
with an `agency_admin` scoped to their own agency. So the branch does not
translate — it goes, and what the screen shows an administrator changes. That is
a product-visible difference and belongs to the owner, not to a port.

## D104 — The training assignment wizard targets on five columns no store holds (OPEN)

2026-09-26. `job_title`, `department`, `discipline`, `business_line` and
`location` are read to decide who a course is assigned to, and **none of the
five exists in either store.** Read out of the record migration: the carried
`pennsync_records.user` table has 47 columns, and none of those five is among
them (nor is `full_name`). The authority store models identities, memberships
and agencies, and has no such field either.

The count is the point. The first two turned up in a column census and the
other three only when the same file was read line by line, so a reader who
stops at the first name will under-report this by three.

**`src/components/training/AssignmentWizard.jsx` offers five filters, and all
five are broken — in two different ways.**

Three can never narrow anything, because the column behind them is always
`undefined`. `:17` filters on `user.department` and `:33` builds that Select
from `unique(users.map((user) => user.department))`; `:18` and `:34` do the same
for `business_line`; `:19` and `:35` for `location`. Each dropdown can only ever
offer its "All …" entry.

Two silently degrade to a different field. `:15` and `:31` target on
`user.job_title || user.credential_type || user.role`, and `:16` and `:32` on
`user.discipline || user.credential_type` — so both run on `credential_type`,
and a course aimed at a job title lands on a credential. `:47` prints the same
degraded chain as the person's role.

**Two more readers outside that file.**

- `src/components/learning/ceTranscript.js:56` builds its matching haystack as
  `[user?.job_title, user?.credentials, user?.credential_type, user?.role]`,
  putting a dead field FIRST, and the comment above it says that ordering is
  deliberate ("job_title first, the ...").
- `src/pages/ManagerSkillGapDashboard.jsx:70` labels a person `member?.job_title
  || member?.credential_type || member?.department || "Employee"`. Here
  `credential_type` is live and sits second, so the label is right by accident:
  the first and third terms are both dead and the middle one answers.

**Why this was hard to find, which is the part worth carrying.**
`src/components/learning/ceTranscript.test.js:139-141` seeds fixtures that set
`job_title` directly — `{ job_title: 'Home Health Aide' }` and two more — so
that suite passes on data the product cannot produce. The test is not evidence
here. A field absent from every store is invisible to a suite that supplies it
itself, and stays invisible for as long as the fixture does.

**Why it is recorded rather than fixed.** This is D72's shape exactly — the
`patient.risk_level`, `patient.hospitalization_risk` and `visit.note_id` reads
that exist in neither store — and D72's precedent is to record such a field
rather than invent around it. Fixing it means deciding whether the product
should carry a job title, a department, a discipline, a business line and a
location at all, where each is set and who may set it. That is a product
decision, and a port that supplied them would be inventing a field set, which
D12 settled against.

**What it is NOT.** It is not the `full_name` question, although that column is
missing from the same table. A name is on the owner's card as a decision about
people's data; these five are structure the training system already assumes
exists. They may be answered together, but settling the name does not settle
these.

**Whoever picks this up owns the fixture too.** Leaving `ceTranscript.test.js`'s
`job_title` fixtures in place after the decision would leave a suite asserting
behaviour over a field the store still does not hold, which is how this survived
to be found by a column census rather than by a failing test.

## D105 — A total on a page, where a generated file already holds it

2026-09-26. The rule, in the words it was settled in: **where a page states a
total that a generated file already holds, pin the page to that file or drop
the figure. Stage J and the pennsync-api README are the two instances on
record.**

A generated file is measured on every run and a page is measured never, so a
figure copied from the first into the second is correct exactly once. Nothing
fails when it stops being correct — the page still reads well, the number is
still plausible, and the tool that knows better is printing the right answer a
few lines away in the same CI log.

**Instance one, #303.** Stage J of `docs/RAILWAY_GO_LIVE_PLAN_2026-09-21.md`
paraphrased `check:entity-routes` into a blockquote. It now carries that tool's
output **byte for byte in a fenced block**, and `tools-entity-routes.test.mjs`
holds it there. Paste what the tool prints; never retype, rewrap or re-indent
it, because a comparison that normalised first would be a second
representation of the same thing, which is the defect this exists to stop.

**Instance two, #307.** `services/pennsync-api/README.md` said the broker
family serves **31** entities. `brokered-entities.mjs` holds **three**, all
read-only, and `check:record-brokers` prints `5 operations over 3 entities`
every CI run. 31 was the pre-D22 allowlist — wrong by ten, in the direction
that reads as write access to thirty-one tables, beside a sentence naming
`insert`, `update` and `delete`. `records.test.mjs` now derives the count from
`BROKERED_ENTITIES` and holds the page to it.

**Two assertions, not one.** Each pin checks that the page carries the thing at
all AND that what it carries is current. A single conditional that compared
only when it found a block would **pass by finding nothing** — the
instrument-always-returns-true failure, arriving inside the check written to
stop it. An absent name and a stale number are different failures and each owes
its own message.

**Read both forms.** The README spells small numbers out, so the pin reads
digits and number words alike. A check that read one form would be the
one-representation defect it exists for.

**A historical figure stays sayable.** "The allowlist was 31 until D22" is a
record; "the family serves 31 entities" is a stale total. The same distinction
governs Stage J: a move is stated as its **size and its cause**, and the total
it produced is left to the block. Forbidding every numeral would delete the
sentence that separates a remainder falling by five because D83's
global-reference writes stopped counting as landable, with nothing adopted,
from the same remainder falling by nine because nine screens adopted routes —
same arithmetic, opposite news — and the page would become MORE misleading by
passing.

**Where a pin stops reading is part of the page, not only of the test.** Stage
J's scanned region runs from the block to the next heading of any level. A
stage-wide scan failed a correct page the day `routes` reached 33 and collided
with prose about "about 33 hollowed-out pages" — a different instrument's
figure, legitimately there. Spelling that number into the check would have been
a relaxation dressed as a fix, and an allowlist is how a check comes to vouch
for prose it stopped reading. So the page gained a `####` heading where the
destination gate's material starts. **Cost, stated rather than hidden:** a
route-gate total placed below that heading escapes the check.

**What this does not settle.** It is a rule about pages that quote generated
totals, not a rule against prose describing measurements. And a pin proves the
page agrees with the file; it says nothing about whether the file agrees with a
deployment, which stays the hosted comparison's half (D88, D95).

## D106 — Prose beside a figure states the derivation, not the result

2026-09-26. The rule, in the words it was settled in: **prose beside a figure
states the DERIVATION, not the result — a number can survive a change for a
different reason and its explanation goes stale with nothing failing.**

A sibling of D105 and not the same rule. D105 is about a page carrying a total
a generated file already holds, and its remedy is a pin. This one cannot be
pinned, because what goes wrong is the sentence rather than the number. The
remedy is to write the derivation, so a reader recomputes instead of trusting.

**The instance.** `AGENTS.md` said the fingerprint tool "pins all 75 committed
migrations' sha256 — one fewer reaches a deployment, since
`LOCAL_ONLY_MIGRATIONS` holds one back, which is why the hosted ledger's row
count is 74". Measured from the tools rather than from the page:
`fingerprints()` and `readPin()` both answer 78, the directory holds 78 `.sql`
files, `readMigrations` — the provisioner's own list, which is what
`hosted-store.test.mjs` compares against — also answers 78, and
`LOCAL_ONLY_MIGRATIONS` has exactly one entry. So it is **78 committed, 77
reaching a deployment, 74 applied, 3 pending**, which closes and matches the
hosted assertion's own message.

**What makes it worth a decision is which half rotted.** The sentence was true
when written. Then three migrations arrived, and 74 stayed 74 for an entirely
different reason: it had been everything that reaches a deployment, and became
everything that has been applied, three short of it. The figure never moved, so
nothing could notice. A reader of that page today concludes the hosted ledger
is complete — which is the single most load-bearing fact about the current red
being expected rather than new drift (D93) — and concludes it from a file whose
job is telling a new session how this repository works.

**The general shape.** A number is a result; the sentence beside it is usually
a derivation stated as one. When the inputs move, only the derivation is wrong,
and a derivation has nothing to fail. So write what the figure is computed FROM
and where each input is read, not what it came out as. Where three related
counts sit near each other — committed, reaching a deployment, applied — say
that each is derived and give the command, because the temptation is always to
read one off another, and that is the arithmetic that silently stops holding.

**What was done.** The claim is now the derivation: the pin is described by the
two functions that answer it and the test that compares them, and the three
counts are named with what each is computed from. The figure 78 is deliberately
not written in its place — replacing a stale explanation with a fresh result
would reproduce this entry's defect at the next merge that adds a migration.

**Scope left open.** Other derivations on that page may be stated as results the
same way. Not surveyed here on purpose: a hunt run mid-batch would be a reading
of a tree that is moving. It is worth one pass when the contract batches are in.

## D108 — A write may not name a chart this store does not hold

*2026-09-25.*

`contract_clinical_library_template_write` refuses a create whose `patient_id`
names no `patient` row in the agency the request names. That is a **narrowing**
of the capability #295 shipped, taken deliberately, and it is recorded here
rather than left to be found in a diff.

The defect it closes is the one worth carrying. D24 asks two questions —
whether the caller opens every chart in an agency, or is assigned this one in
that agency — and **neither half asks which agency the chart is actually in**.
`clinical_library_template_insert` asks the first question of the ROW's own
`agency_id`, so a caller holding two agencies satisfied it with the other
agency's chart id: the row landed in agency A, tenanted to A, carrying a
`patient_id` that is a fact about B, having passed every chart check and every
tenancy assertion. `patient_education_assignment` already resolved the chart's
own agency, because that table carries no `agency_id` at all and the missing
term was visible. **The table that HAS a tenancy column is where the predicate
looks complete**, which is why this one shipped and its sibling did not.

The shape of the check is load-bearing and is not the obvious one. A guard
written as `not exists (a chart proving this row foreign)` does nothing: inside
a SECURITY DEFINER under forced RLS, with the record owner holding no
`BYPASSRLS`, the foreign chart is invisible to exactly the caller who needs
protecting. `library_chart` asks the opposite, positive question — the chart
must be PRESENT in the named agency — so an invisible chart is an absent chart
and the write fails closed. Proved rather than argued: with the check replaced
by a no-op, the same crossed create succeeds for a caller holding one agency
and for a caller holding both, and the suite runs that measurement.

The narrowing itself is the second-order effect. Only the
`caller_assigned_patients` half of that policy ever looks an id up; the
`caller_opens_every_chart` half does not. So before this, an `agency_admin`
could file a template against an id naming nothing at all, and the row read as
chart-bound while pointing at no chart. A store that cannot tell a dangling
reference from a chart is a store that cannot answer who may see the row, so
the refusal is kept. Rows already carrying such an id are unaffected: this
decides what may be written, not what may be read.

One case is deliberately NOT a narrowing and is recorded so nobody reads it as
one. A chart in the caller's own agency that they are not assigned to was
already refused, by the policy, as `_FORBIDDEN`; it now arrives as
`_NOT_FOUND`. The refusal is not new — its name is — and `_NOT_FOUND` is what
D24 asks for, because an id must not be testable for existence by somebody who
does not open the chart.

Two notes that belong with this rather than with a number of their own.

**A field may be in `required` AND carry a default.** `ClinicalLibraryTemplate`
declares `template_type` in both, and Base44 accepts a create that omits it. So
a contract's defaults are applied BEFORE its required check, never after, or
the check is itself a narrowing — which #295's was, for that one field. The
mirror rule matters as much: defaults are applied on a create ONLY. A field a
caller omits from an UPDATE is one they are leaving alone, and a fill placed in
a shared write helper without the action test would reset every defaulted
column on every partial update, with the required check seeing a complete
payload and saying nothing.

**D102's closing paragraph is superseded in its framing.** It called the
generated store's universal nullability a consequence to fix. It is not: the
generator's own header records nullability as deliberate, so a legacy row
predating a requirement can migrate rather than be refused at load. The missing
column DEFAULTS are the real gap, and they are separate — a default fires only
where a column is omitted, so it costs the import path nothing and costs every
create everything. That entry is left as written, being a dated record.
## D109 — A `pennsync_private` table created from the record directory is outside three ratchets

2026-09-26. The rule: **a `pennsync_private` TABLE belongs in
`services/authority-store/supabase/migrations/` unless it depends on something
in `pennsync_records`. The test is not tidiness. It is whether the three checks
that measure that schema can see the table at all**, because each of them builds
from that directory and from nothing else:

- `tests/restore-schema-fixture.mjs` pins every table and column the store is
  proved to survive a `pg_dump` and `pg_restore` with.
- `tests/authority.test.mjs` pins the `pennsync_private` table list, and with it
  asserts that EVERY table there has row security both enabled and forced.
- `tests/app-namespace-containment.test.mjs` pins that every app-scoped column
  carries the `deployment_app` domain, with the count pinned so adding one is a
  deliberate act.

`20260920110000_claim_new_chart.sql` is the exception on the other side and
states its own reason: it asks `pennsync_records.caller_tenant_role`, so it
cannot apply before the record store exists. It creates a FUNCTION, not a table.

**The instance.** `pennsync_private.staff_name` — the staff display name the
owner chose over showing a work email — was created by
`record-migrations/20260920630000_roster_display_name.sql`, beside the
`caller_roster` bridge and the two roster contracts that read it. Nothing was
wrong with the table. It was simply invisible to all three checks, and it stayed
invisible until the fixture was edited to name it, at which point the backup
rehearsal failed because the table did not exist in its lab.

**What makes it worth a number is the one-line fix that was not taken.**
Deleting that fixture entry would also have gone green, and would have left the
table permanently outside the backup rehearsal with three ratchets reporting
nothing — a guard that reads correctly and does nothing, which is the worst
outcome this project keeps rediscovering. Moving the table instead made all
three fire, which is the coverage argument as a measurement rather than as a
claim: the RLS assertion in particular is one the table passes on the substance
and was simply never being asked.

**The ordering is by construction, not by timestamp.**
`tools-pennsync-migrate.mjs` walks `[MIGRATION_DIRECTORY,
RECORD_MIGRATION_DIRECTORY]` in that order, and every harness does the same, so
an authority migration always applies before any record migration whatever the
two file names say. That is what makes splitting one change across the two
directories safe, and it is worth stating because the timestamps invite the
opposite conclusion.

**How it was found.** On CI, and not by either red that had been predicted for
that pull request. The failing job was `restore-postgres`, which needs
PostgreSQL 17 with real `pg_dump` and `pg_restore` and therefore runs in neither
`pnpm test` nor a local PostgreSQL 16 cluster. Its proximate fault was smaller
and separate: that fixture compares the catalogue POSITIONALLY against an
object's insertion order, and the new entry was placed where a reading of the
names suggested rather than where the collation sorts it. The position is
verified against a real cluster now. Both halves are the same lesson from
different ends — a check is only as good as what it is given to look at.

**There is a second instance, and the pin does not report it.**
`pennsync_private.file_object`, created by
`record-migrations/20260920520000_file_locator_map.sql` for D77's locator map,
carries `app_id pennsync_private.deployment_app` and is absent from all three
checks — measured, not inferred: it appears in neither
`restore-schema-fixture.mjs` nor `authority.test.mjs`, and
`app-namespace-containment.test.mjs` builds from `../supabase/migrations/` at
its line 60 and nowhere else.

Read carefully what that does to the domain count, because the obvious reading
is wrong in a way worth stating. The pin is not merely stale by one: it is
CORRECT for the tree it measures and silent about the store. Raising it to 22
for a table the build cannot create would fail the assertion, so a reader who
"fixes" the number breaks the check, and a reader who leaves it is pinning a
count that omits a real app-scoped table. That is the pin's SCOPE rather than
its value, which is the same substitution as the ruling above — a figure read
off a build and believed of a deployment. This change leaves the count at 21,
which is what this build holds, and names the gap here rather than moving a
number it cannot measure.

Moving `file_object` is not taken here. It is D77's table, its move changes
what a fresh store gets and therefore owes the same forward reasoning D88
requires, and the survey below is already under way in another thread; a second
hand editing those three pins concurrently is how one of them ends up describing
neither tree. What this entry fixes is the belief that the instance was
singular.

**A caveat for whoever runs the survey, measured rather than reasoned.** A
fourth check looks at these files and is scoped differently from the three
above: `services/authority-store/tests/http-boundary.test.mjs:115` reads
`record-migrations/` and nothing else, cross-checking every code those
migrations raise against the classifier's allowlist so a redacted CI log still
names what refused. It is run by CI at
`.github/workflows/pennsync-authority.yml:158`; what it sits outside is
`pnpm test`.

Its scope is narrower than the directory, and the narrowing is the whole of the
caveat: it consumes only `do $$ … $$` blocks, because its own comment draws the
line at a `CREATE FUNCTION` body — a code raised there is a refusal answered to
a caller, not a migration failure, and the suite asserts that in the other
direction too. So relocating a FILE moves its `do $$` precondition out of the
scan, while relocating an OBJECT and leaving the precondition where it is
costs nothing.

That distinction is not hypothetical for the survey, and the first reading of it
was wrong in both directions before it was measured. This change is the safe
shape: `migrations/20260920605000_staff_name.sql` carries no `do $$` block and
raises no code at all, its only `PENNSYNC_` string being a comment naming
another function's refusal, and the two halves that do raise codes stayed in
`record-migrations/` and are still scanned. But
`record-migrations/20260920520000_file_locator_map.sql` — the file holding the
other instance — DOES carry a precondition raising
`PENNSYNC_RECORD_STORE_REQUIRED`, so moving that file whole would lose
coverage of it, while `PENNSYNC_FILE_OBJECT_IMMUTABLE` beside it is outside the
scan either way, being raised in a trigger body. Move the table and leave the
precondition. Anyone applying this paragraph should re-measure the file in front
of them: every claim in it was read out of the two files and the test, and an
earlier reading of the same question taken from the shape of the rule reached
the opposite conclusion twice.

**Scope left open.** The full survey of `pennsync_private` is not run here and
belongs to one hand rather than several, since its output is edits to the same
three pins. What is settled is that the instance is not singular — `file_object`
is named above — and that the three checks above cannot be the instrument for
the survey, because an object they are blind to is exactly what is being looked
for. The survey reads the two migration directories against each other on a
FIXED head.
**Added 2026-09-26, after D110 merged.** The caveat above is now closed and its
advice is spent: `http-boundary.test.mjs` scans BOTH migration directories, so a
`do $$` precondition no longer loses the classifier's coverage by changing
directory, and the "move the table, not the file" workaround is no longer needed
for that reason. The paragraph is left as written because it is the record of
what was true when the table moved, and because its reasoning still holds for
any check that reads one directory. Read it with this pointer, not instead of it.

## D110 — A guard follows the code, not the directory it was born in

**The rule.** When a check's subject is a *kind of thing* — a raised code, a
disposition, a call site — it enumerates every place that thing can occur, and
the enumeration is asserted per place rather than over the union. A check that
reads one directory because that is where its first instances happened to live
is not measuring its subject; it is measuring a location, and it keeps passing
while the subject moves.

**The instance.** `services/authority-store/tests/http-boundary.test.mjs`
reads the `do $$ … $$` preconditions of the store's migrations and fails when a
`PENNSYNC_*` code they raise is missing from `MIGRATION_CODES` in
`http-local-stack.mjs`. That allowlist is what lets a redacted CI log name which
migration refused: `classifyToolFailure` emits a literal from the list and never
the CLI's own output, because that output carries credentials. A code outside
the list falls back to the generic verdict, which is precisely the diagnosis the
scan exists to prevent — the scan was itself added after the broker and contract
migrations raised two codes nobody had allowlisted.

It read `supabase/record-migrations/` alone. The authority migrations under
`supabase/migrations/` raise three codes of their own, and one of them,
`PENNSYNC_UNKNOWN_DEPLOYMENT_APP`, had never been in the allowlist. It is raised
by `20260919090000_deployment_app_pin.sql` when the app id in
`pennsync.deployment_app_id` is not one `known_app` carries — that is, exactly
when an operator mistypes the pin while standing a new deployment up, which is
the failure whose diagnosis matters most and the one whose log is most redacted.
The migration's own comment says an unrecognised value "fails the migration
outright, so a typo cannot produce an uncontained store"; the operator reading
that failure got `LOCAL_CLI_START_SQL_REJECTED`.

**What changed.** The scan takes a frozen list of directories and asserts each
one raised something before taking the union, because a renamed or moved
directory would otherwise contribute nothing and pass on the other's codes —
this guard's own defect arriving a second time, which is what D107 asks a
refusal test to rule out. `PENNSYNC_UNKNOWN_DEPLOYMENT_APP` is allowlisted with
its reason.

**The widening is proved to bite, three ways**, because a guard that reads
correctly and does nothing is the outcome this project keeps finding:

- Running the widened scan before allowlisting reports
  `PENNSYNC_UNKNOWN_DEPLOYMENT_APP` as unnamed. The gap was real, not a
  hypothesis about future migrations.
- Narrowing the list back to `record-migrations/` with the code left in the
  allowlist passes everything. That is the measurement that matters: the old
  scan could not have found this code under any circumstances, so nothing short
  of widening would have surfaced it.
- A planted case writes two files into a temporary directory — one raising a
  code inside a `do $$` precondition, one raising a different code inside a
  `create function` body — and asserts the first is seen and reported unnamed
  while the second is invisible. Breaking the block pattern fails both that case
  and the real one; pointing a scanned directory at one holding no `.sql` fails
  the per-directory assertion by name.

The second bullet is the general form worth carrying: **to show that widening a
check found something, run the narrow version with the fix already in place.**
If it passes, the narrow check could never have reported the defect, and the
widening is the whole finding rather than a tidy-up that happened to coincide
with one.

**Also fixed here, as the same class in a second habitat.** The comment above
`PENNSYNC_RECORD_STORE_REQUIRED` credited the scan to
`record-migration-codes.test.mjs`, a file that does not exist; the assertion is
in `http-boundary.test.mjs`. A pointer that reads perfectly and resolves to
nothing costs the next reader a session, which is the `staging_app` →
`deployment_app` lesson arriving in a comment rather than in SQL.

**Scope left open.** This says nothing about codes raised outside a migration,
and deliberately: a code inside a `create function` body is a refusal answered to
a caller at runtime, not a migration failure, and naming one in this list would
be wrong in the other direction. The planted case holds that line.

## D112 — A diagnostic is captured at the moment of failure, not after recovery

**The rule.** A diagnostic that describes a moment other than the failure is
worse than no diagnostic. It looks like evidence, it reads as a cause, and it
makes an unmade decision look ready to make. So capture it at the failure — and
where a check retries, capture it on every attempt and report the series, so a
condition that changed across the window reads as a change rather than as its
last state.

**The instance.** `unusedPort` in
`services/authority-store/tests/http-local-stack.mjs` refuses to start the local
stack when one of its ports is taken, retrying `PORT_ATTEMPTS` times a second
apart. It called `describePortHolder` once, after the last attempt, so the
refusal printed whatever held the port about five and a half seconds after the
bind that failed.

That diagnostic was added precisely so an occurrence would name its holder, and
the first occurrence under it printed `Port 54322: TIME_WAIT` — while this
suite's own measurement says TIME_WAIT cannot refuse a bind at all, because Node
sets `SO_REUSEADDR`. Both readings were right about different moments: something
live held the port through the retries and had closed into TIME_WAIT by the time
it was described. The plan "when it next fires it will name the holder" had
failed while looking like it worked.

The holder is now described inside the catch, one line per failed attempt, and
the series printed on refusal. The bind's own `errno` is carried too, allowlisted
to `E`-prefixed letters: it was discarded entirely before, so nothing could
distinguish `EADDRINUSE` from an `EACCES` or `EADDRNOTAVAIL` that would make the
whole ephemeral-range hypothesis misdirected. Only `error.message` ever reaches
an operator and it stays the bare code and port, so `emittable` is untouched and
the redaction discipline is unchanged — the holder is still read from
`/proc/net/tcp` and `comm`, never `cmdline`, because an argument vector can carry
a credential.

**Ordering, which is the decision rather than the change.** The reserve-the-ports
question stays open and unproved. The diagnostic is fixed FIRST, because a
diagnostic that looks like evidence and is not cannot support that decision.

**Proved by sabotage, in both directions.** With the one-shot diagnostic
restored, the two new tests fail — one on `1 !== 6`, the other on "the live
connection was not captured at the failure" — while all seven pre-existing tests
stay green, so none of them could ever have found this. The second fixture is the
real occurrence's shape: the port is held throughout by a listener, so every
attempt refuses, while a client connection live at the first failure is gone by
the last. It asserts that the fixture CHANGED, so a fixture that silently stopped
changing fails rather than passing quietly.

## D113 — A guard must build the population its assertion names

*2026-09-26.*

Two of the authority store's ratchets assert something about the whole store —
every `pennsync_private` table has row security enabled and forced, every
app-scoped column carries the `deployment_app` domain — while building a
database from `supabase/migrations/` only. The assertion and the population
disagreed, so both guards passed while measuring a store no deployment runs.

That is D109 arriving from the side that can be fixed. D109 records that a
`pennsync_private` object created from `record-migrations/` is invisible to the
authority-directory suites; this entry is what the invisibility cost. One object
is in that state today — `pennsync_private.file_object`, D77's locator mapping —
and it is correct in every respect: row security enabled and forced, `app_id`
typed by the domain. Nothing was wrong. What was wrong is that nothing could
have told us if something were.

Both guards now build both directories, in the order a deployment applies them,
and their pins are the true sets. Measured on this branch's merged tree, the
widened build holds **24** private tables and **22** app-scoped columns; the
authority-only build holds **23** and **21**. The difference in each case is the
one object the record directory creates: the table `pennsync_private.file_object`
and its own `app_id` column. State the pair, because **a pin's value is a
property of which directories the test BUILDS** and a bare number is what makes
this a trap: 21 was the right app-scoped count for the build that existed
before this change and is the wrong one for the build after it, with neither
reading a mistake. Both figures will move again — D109 landed `staff_name` in the
authority directory on the same day — so re-derive them rather than quoting
them. What does not move is the derivation, and it is worth writing down
because a grep that gets it wrong reads as a disagreement rather than a
mistake: the domain was RENAMED from `staging_app` in
`20260919090000_deployment_app_pin.sql:140`, so an authority-directory count is
the columns declared `pennsync_private.staging_app` plus those declared
`pennsync_private.deployment_app`, and the record directory contributes exactly
one, `file_object.app_id` in
`record-migrations/20260920520000_file_locator_map.sql:60`.

**A pin counts what the test BUILDS.** That is the rule this leaves behind, and
it cuts in the direction nobody expects. Before the widening, the pin was not stale
and not short — it was exactly right for the population that suite built, and
`file_object` could not have entered it. D109's `staff_name` is the worked
example: a table added to the AUTHORITY directory moves that pin by exactly
one, and moving it by two "to account for `file_object`" would have failed the
suite on a tree where `file_object` was still invisible. **A coverage gap is not a containment escape, and
it is never closed by inflating a number the guard already gets right.**

D121 asks for the siblings to be enumerated rather than left to a reviewer, so
here they are for the "pin the SET, never membership" rule this change applies.
`authority.test.mjs`'s private-table list: converted, a `deepEqual` over the
two directory halves. `app-namespace-containment.test.mjs`'s app-scoped
columns: converted, every `(table, column)` pair named and deep-compared —
though not in the first draft, which is D121's worked example.
`restore-schema-fixture.mjs`: already compliant, since it compares the whole
relation-and-column map rather than a count. There is no fourth.

Each widening ships with a sabotage, and each sabotage has two halves, because
only the second is the finding. A migration in the record tier is planted — for
one guard a `pennsync_private` table with row security enabled but not FORCED,
for the other a table whose `app_id` is plain `text` — and the widened build
must refuse it. Then the same assertion is raised against a build made from
`supabase/migrations/` only, where the plant is never applied at all, and it
must PASS at the count the old scope used to see. Showing the new scope catches
something says nothing on its own; showing the old scope could not is the whole
claim. Both plants are written to a directory of their own rather than into
`record-migrations/`, because fifty-four suites walk that directory and a file
dropped in it reaches all of them.

**The third ratchet is deliberately not changed, and the reason is not that it
is hard.** `restore-schema-fixture.mjs` pins the relation inventory of the
restore rehearsal's lab, which `applyAuthority` builds from the authority
directory. Its assertion is complete over the database it builds, so unlike the
other two it is not asserting something its build contradicts — what it is
missing is a *scope* decision: the rehearsal proves that a backup round-trips
the authority store and the integration runtime, and proves nothing about the
record store, where every contract and every clinical row lives. Extending it
means seeding record rows and proving they survive the dump, not adding thirty
names to a map — a guard that listed the tables without round-tripping their
data would read as coverage and be none. It also has a side effect the other
two do not: `record_store.sql` creates the `pennsync_records_owner` role, and
that harness is built to contain no role DDL. And it could not be measured
here: `withRestoreLab` (`restore-rehearsal.mjs:89`) requires PostgreSQL **17**
tooling and this container has 16, so the suite refuses with
`LOCAL_POSTGRES_TOOL_VERSION_MISMATCH` before any database work. Note what that
constraint is and is not, because the obvious reading would misdirect whoever
takes the commission: the CI runner has PostgreSQL 17.10, so CI can run this
suite perfectly well. What is missing is a LOCAL 17 cluster to prove a change
against before pushing it, and "push it and see what CI says" on a credentialed
postgres suite is the speculative push the drive-to-green rules forbid. So the
commission needs a session with 17 tooling of its own, not a change to CI. It
is recorded as open rather than half-done.

## D114 — What a migration can reach, rather than what it appears to invoke

D110 left one thing standing on an unchecked premise. `MIGRATION_CODES` names
the `PENNSYNC_*` codes a failing migration can print, and it deliberately
excludes a code raised inside a `create function` body: that is a refusal
answered to a caller at runtime, not a migration failure. The exclusion is
right. What it rests on is the claim that no such body can *run* while a
migration is applying — which held by observation, and whose failure mode is
silent. A constraint added in a later migration is validated against the rows
already present, so a `check` calling one of this store's own functions executes
that function at migration time, and its refusal prints with no name: exactly
the diagnosis D110 exists to prevent, arriving through the door D110 left open.

**The decision is that the reachable set is asserted, not the invoked set.** The
first form of this was "no migration invokes a `pennsync_*` function at
migration time", and it is false. The deployment pin adds
`deployment_matches_pin` and `deployment_app_is_pinned`, and both really do call
`pennsync_private.deployment_app_id()` and `pennsync_private.app_admitted()` on
apply. Neither raises. That — not absence — is the claim, and it is the claim
because it is the one that is true.

`services/authority-store/tests/migration-time-reachability.test.mjs` asserts
the exact set of migration-time calls, walks what each of those bodies itself
calls, and requires the codes reachable through that closure to be empty. Three
properties are load-bearing rather than stylistic.

- **The exact set, never membership.** "No raiser appears among the invoked" is
  satisfied by a correct answer *and* by a parser that found nothing; an
  equality over the invoked set is satisfied only by the first.
- **Whatever the parser cannot place is a failure somebody resolves.** An
  unclassified statement reds the test and names itself. Tolerating one would
  make this vacuous by the shortest available route: an unreadable shape is how
  a real call would arrive.
- **The closure, because the answer is otherwise a coincidence.** Both pinned
  functions are named by a constraint of their own, so a depth-one reading finds
  the pair and proves nothing about the link between them — and
  `app_admitted` does call `deployment_app_id`.

**The over-approximation that looks safe and is not.** The tempting shape is to
count every `pennsync_*` token outside a function body as a reference and refuse
if any of them raises. That fails on arrival: the do-block preconditions hold
162 `to_regprocedure`/`to_regclass` existence lookups naming contract functions,
most of which do raise. **Over-approximating a reference set does not make a
ratchet safely stricter when the references are mostly not calls** — it makes it
red on the day it lands and deleted the day after. So every occurrence is placed
in a named statement kind, and a name in a trigger definition, a grant, a
comment or a policy is a reference rather than a call. Inside a *body* the
direction of safety reverses and the over-approximation is taken, because there
being wrong can only widen the closure and a wider closure can only red.

**A gap the closure found in the parser, worth recording for its shape.** Both
pinned functions are written by `execute format($fn$ create function … $fn$)`
inside a do-block, and the first segmenter stripped nested dollar-quoted regions
wholesale. So the one function a migration-time constraint actually calls had no
readable body, and the tool answered "nothing reachable raises" — correctly, and
for no reason it had established. It is the house defect in its quietest form:
not a wrong answer, a right answer nothing was standing behind. The segmenter
now recurses, and the test fails on a reached name it cannot read rather than
treating the absence as empty.

**Proved by sabotage, not by reading.** Counting `alter table` as non-executing,
stripping generated SQL again, blinding the body walk, dropping quoted-identifier
declarations, discarding unclassified occurrences and counting trigger DDL as
executing each red a different assertion; a raising function planted behind a
`check` constraint in a real migration directory reds the exact-set assertion by
name. The registration in `test:authority-store` was proved the same way, by
removing it and watching `testRegistryContract` name the file.


## D115 — A derived population fails closed on empty, or it is the vacuous case with a new cause

2026-09-26. Decided while converting `contract-roster.test.mjs` off its
hand-kept apply list.

**The rule.** When a check stops naming its population and starts DERIVING it —
from a directory, a glob, a schema query, a manifest — the derivation must raise
on an empty result rather than returning nothing. A population of zero satisfies
every assertion over it, so a derivation that can quietly come back empty has
replaced one silent wrongness with another.

**Why it needs saying next to D113.** D113 is the rule that a guard must BUILD
the population its assertion names; this is what that fix costs if it is taken
carelessly. The hand-kept list's failure was that it named too few files. A
directory walk cannot name too few — and can name NONE, if the path is wrong,
the filter is wrong, or the directory moves. The suite that then builds a store
with no contracts in it still passes every refusal it asserts, because a
function that does not exist refuses everybody. The two failures are the same
vacuous pass arriving through opposite mistakes, and only one of them has a
list to inspect.

**The instance.** `services/authority-store/tests/record-migrations.mjs` reads
the record migration directory for every suite that adopts it. It raises
`PENNSYNC_TEST_RECORD_MIGRATIONS_EMPTY` on an empty listing, and separately on a
directory holding files but no `.sql` — "has files" and "has migrations" are
different questions, and a walk can pass the first while failing its caller.

**Two properties that make the refusal provable rather than promised.** The
module takes the directory as a PARAMETER with the real one as its default, so
its own suite drives the empty case, the no-SQL case and a dropped-file case
through the same code path the suites use, rather than through a second copy of
the walk that could agree with itself while disagreeing with this one. And the
suite pins the RELATION to the directory — the names equal an independently read
listing, sorted — and deliberately not a COUNT, which moves on somebody else's
merge and would fail while saying nothing about this module. Three anchors stand
in for the count: the generated store, the generated broker family, and one
hand-written forward migration, which are the three shapes the hand-kept lists
named separately.

**Proved by sabotage, both halves.** Returning `[]` instead of raising fails two
of the six tests. Executing in `readdir` order while answering sorted fails
three — the applier's test asserts that the SQL reached the database in order,
not only that the answer was sorted, because a walk could sort its return value
and execute in any order. Dropping a forward file from the roster build fails
all sixteen of that suite's tests and the first message names the file.

**The worked example is D113's, not this entry's.** Converting that one suite
failed immediately: its assertion that only two contracts reach the roster was
true of the fixture and false of the store, which holds three — D69's
`contract_roster_report`, whose file the hand-kept build never applied, green
since D69 shipped. That belongs in D113 as its example and is not restated here.
What this entry adds is the other direction: the fix for it must not be able to
derive nothing.

**Scope.** One suite is converted. That is deliberate rather than partial: four
pull requests were open on these files the night this landed, and a sweep would
have collided with all of them. The remaining conversions go one suite per
change, and the one data point says to expect a finding in each rather than a
green re-run — it says nothing about how many there are.

## D116 — A count you cannot reproduce with the instrument's own key is re-read, never predicted or audited

**The rule.** A count is a predicate over a population. Where you cannot
reproduce it using the same key the instrument uses, re-read it from the
instrument on each head: never predict it, and never audit it finding by
finding. Hold the instrument instead to the figures it states in words.

**Two worked instances, both from the hosted store comparison.**

`hosted-store.test.mjs` asserts `faults.slice(0, 10)` and puts the count in the
assertion message — by design, and its own comment says why: a store that
diverged wholesale would otherwise print thousands of lines, and the count in
the message is what stops a capped list reading as the whole of it. So at 166
differences it prints ten findings, none of them a function. An instruction to
"check that every printed finding names those files' objects" cannot be
satisfied, and following it produces false confidence rather than a false alarm.

And the key differs from any a text scan can apply. `store-inventory.mjs` keys a
function on `schema.name(identity_arguments)`, where a scan of the migrations
keys on name: `pennsync_records.roster_entry` is declared twice with two
different signatures and counts twice, while eight other names are
`create or replace` of one signature and count once. Reaching 162 of 166 from the
files is therefore structural rather than a matter of effort — identity arguments
are not recoverable from source text, since defaults are stripped, declarations
span lines, and `returns table` shapes differ.

**What the instrument can be held to** is the pair it states in words — "the
ledger holds N rows for M committed migrations" — which with
`LOCAL_ONLY_MIGRATIONS` derives everything an operator needs.

**A related trap, same shape.** The ledger is not a PREFIX of the migration
order, so pending migrations may not be named by taking the last N: a file added
under `supabase/migrations/` sorts before the boundary and shifts the slice.
Derive the names by set difference.

## D117 — Classify an open enum by naming the values you mean, never by negating the ones you don't

**The rule.** A negative predicate over an open enumeration inherits every value
the API later adds and every value the author forgot. Name the values you mean.
Where a direction must be chosen anyway, choose the one that fails loud.

**The instance.** A poll watching a pull request's check runs classified a
conclusion as bad when it was `not in (None, 'success', 'neutral', 'skipped')`.
GitHub also returns `cancelled`, `timed_out`, `action_required` and
`startup_failure`, so a run cancelled because a later push superseded its head
read as a failure — and "cancelled is not failed" was already a rule this project
carried. A red was reported that never existed.

**Both halves matter.** That one failed LOUD, which cost four minutes and a
correction. It did so by luck rather than design: the mirror version, treating
`in ('success',)` as green, would have failed SILENT and reported a genuinely red
check as passing. The direction is not a detail to leave to chance, which is the
same discipline as D107's refusal to accept a repair that restores green and
records nothing.

## D118 — An instrument that covered less than you assumed reports about itself, not about the thing

An instrument whose coverage is narrower than the question it was pointed at
still exits in the shape of a result, and that shape is the whole danger: it
answers about *itself* — about its pattern, its working directory, the branch it
loaded rather than measured — while reading as an answer about the tree, the
file, or the store. Nothing fails, so nothing surfaces it.

Three instances arrived in one night, on one watch, and they are unlike enough
that the shared shape is the useful part rather than any one of them:

- **A grep whose pattern missed a name.** Checking that a sibling thread's two
  new `MIGRATION_CODES` entries had survived a base merge, a grep matched one and
  not the other. That is a reading about the PATTERN. The diff is the reading
  about the FILE, and it showed both entries present. A colleague's change was
  one report away from being called lost.
- **A validation step that declined to run.** `pnpm run lint` from a drifted
  working directory printed `script matched with lint is present in the root of
  the workspace` and exited zero. A validation that declines to run and a
  validation that passes are indistinguishable from the exit code alone.
- **A job that stood down.** `Verify the committed store on hosted staging` is
  green on a pull request by LOADING rather than measuring; only on `main`, with
  `skipped 0`, is its green a measurement. A PR-side green says nothing about
  what is pending.

The rule: before treating an instrument's quiet exit as an answer, establish
what it actually covered. Where a narrower and a wider reading both exist, the
wider one is the reading about the thing — prefer it, and where only the
narrower is available, say which one you have. This is D116's sibling from the
other side: D116 is about a count whose key you cannot reproduce, and this is
about an instrument whose population is smaller than the one you meant.

The near-miss is recorded rather than the catch, because going and looking is
what closed all three and no check did.

## D120 — A sabotage raises the production assertion, not a re-implementation of it

*2026-09-26.*

A sabotage exists to show that a guard bites. A sabotage that recomputes the
guard's predicate for itself shows only that its own arithmetic is right, and
the pair then reads as proof while establishing nothing.

The worked example is D113's own first draft, caught in review rather than by
us. `authority.test.mjs` asserts that every `pennsync_private` table has row
security enabled AND forced. The sabotage planted a table with it enabled and
not forced, and checked
`rows.every(x => x.relrowsecurity && x.relforcerowsecurity) === false` — its own
copy of the predicate. So if the real guard were weakened to ask only
`relrowsecurity`, the normal tree would pass, **and the sabotage would pass
too**, and the regression the sabotage exists to catch would ship under two
green tests.

The rule: the scenario and the sabotage call ONE function, and the sabotage
varies only the planted input. `assertPrivateTablesSecured(rows, expected)`
carries both halves; the sabotage names the planted table in its expected set,
so the set half passes and the forced half is the only thing left to fail on,
and it asserts the throw. Weaken the helper now and the sabotage goes red,
which is the property that was missing.

Proving it is the same discipline D113's sabotages already owe: run the exact
change the sabotage is supposed to catch and watch it fail. "It passes" is not
evidence about a test whose job is to fail.

## D121 — Taking a rule for one site is not adopting it

*2026-09-26.*

When a change applies a rule to one guard, it enumerates that guard's siblings
in the same change and says which were converted and which were left, with the
reason. Otherwise the rule is recorded as taken while the instance a reviewer
will actually find is still there.

The example is D113 again, and it is uncomfortable precisely because the rule
was fresh: "pin the SET, never membership" was applied to the private-table
guard, and the app-scoped-column guard in the SAME pull request, on the same
day, kept a count plus a hand-picked subset of table names. That shape is
satisfied by a change that drops one unlisted column and adds another — the
total holds, the one-per-table check holds, the `loose` query stays empty, and
a column that left the containment is never reported.

Why it survived is the general part. Nobody re-reads the part of a change that
was already correct before the change. The column guard was not new work, so it
was not re-read as the new rule was being applied twenty lines away. A rule
adopted at one site and skipped at its sibling is the normal failure, not a
careless one, and the remedy is mechanical: list the siblings, state the
disposition of each, and put the list in the change rather than in your head.

## D122 — A composite figure is not partially readable

Where a figure is a difference over populations read by different instruments,
and one term needs a credential this session does not hold, report the terms you
did read — each named with its instrument and the head it was read on — and
**refuse the figure itself**. A session that supplies two of three terms and
lets the reader close the gap has produced an inference wearing a
measurement's clothes: the arithmetic is the reader's, the authority is the
measurer's, and nothing in the sentence says so.

The pending-migration count is the worked example. It is

    committed (pinned) − LOCAL_ONLY_MIGRATIONS − what the hosted ledger has run

and the first two terms are two different predicates over the same directory
while the third is a row count in a hosted database behind a credential. Ladder,
working from a checkout at `00ae087`, read the first two — the pin holds 85 keys
and 85 `.sql` files sit in the two migration directories at that same head — and
**declined the third and therefore the figure**, because it holds no hosted
credential. That refusal is the decision. The alternative, publishing 85 and 1
and letting a reader subtract a remembered 74, is how three derivations came to
disagree on one night while each stayed internally consistent: a carried term is
not a read term, and a figure assembled across two heads is a figure about
neither.

The cost of refusing is small and the cost of not refusing is invisible, which is
why the rule is worth having rather than merely being right: the version that
published 10 on two terms **would have been right, and would have been right by
luck, and the reader could not have told which.** At `00ae087b` the missing term
was one finished job away — about two minutes.

Closing it is cheap when the instrument is available, and that is the other half
of the rule: at `00ae087` the hosted job's own failure message reads "the ledger
holds 74 rows for 84 committed migrations", which supplies the third term AND an
independent reading of the first, at that head, from one instrument. Pending is
10. Prefer that to a subtraction every time, and where it is not available, say
which term you are missing rather than which number you expect.

This is D106's rule (state the derivation, not the result) sharpened to the case
where the derivation cannot be completed, and it is the companion of D116: D116
is about a figure you cannot reproduce with the instrument's own key, and this is
about a figure one of whose terms you cannot read at all.

## D123 — A classifier's fall-through must not also be its empty case

When a classifier's default bucket receives both "the input matched none of the
categories above" and "there was no input to match", the two readings become one
code, and the one that disappears is the one that says the instrument had
nothing to work with. That is the worse loss of the two: an unrecognised input
is a category to add to the classifier, while an absent one usually means the
thing being classified never got as far as producing it, and points outside the
classifier entirely.

**The example, and it cost a night's diagnosis.** `classifyToolFailure` in
`services/authority-store/tests/http-local-stack.mjs` defaulted to
`FAILED_OUTPUT_REDACTED`, and on 2026-09-26 `Verify independent Auth and API`
failed on `main` at `00ae087b` with `LOCAL_CLI_START_FAILED_OUTPUT_REDACTED`
after 62 seconds of a twelve-minute budget. By the classifier's own named
categories that ruled out a SQL fault, our own migration codes, the Docker
daemon, a config or flag fault and a timeout kill — a genuinely useful negative
result — and then said nothing about the one remaining question, because
"unrecognised" and "silent" were the same answer. The failure did not reproduce
on a re-run, so that code is all the evidence there will ever be, and it cannot
distinguish a CLI diagnostic this module has no pattern for from a child that
died before printing a byte.

The rule is to give the empty case its own name. `FAILED_NO_OUTPUT` now answers
where the joined output trims to nothing, and `FAILED_OUTPUT_REDACTED` keeps its
original meaning. Neither carries a byte of what the child said, so the
no-forwarding discipline this module exists for is unchanged, and the added code
is admitted by `emittable` — which a test asserts, because a new reading that
the emit filter replaces with the generic verdict on its way out has been lost
in a second place rather than saved.

**Two properties of the split are load-bearing.** The check is on the TRIMMED
text, because the module joins stdout and stderr with a newline, so a child that
printed nothing still yields `"\n"` and a literal emptiness test would never
fire. And the new default is assigned before the named branches rather than
after, so `ENOENT` and a timeout kill — both of which usually arrive silent —
still answer `EXECUTABLE_NOT_FOUND` and `TIMED_OUT`; splitting a fall-through
must not let it overtake a better reading.

**Sabotaged in both directions, because they prove different things.**
Restoring the single default fails the three new assertions, which proves the
empty case is reachable at all. Inverting the predicate to always-silent fails
the pre-existing unrecognised-output assertion, which proves the set
discriminates rather than merely accepting the new code. The four
override assertions pass under both, and that is stated in the test rather than
discovered later: an assertion satisfied by the wrong answer as well as the
right one is documentation, not a control. This is D120's rule about sabotage
and D107's about a repair that records nothing, arriving together.

## D127 — An idempotent catch-up is undetectable by its own effect

**Added 2026-09-26.** A forward migration written so that a fresh build and a
caught-up build are field-for-field equal **cannot be shown to have run by any
assertion over the resulting state.** That equality is the property its own suite
exists to prove — `20260920530000_profile_self_write.sql` is the worked example
under D88, and `tools-pennsync-record-catchup.mjs` derives such a file from the
generated migration precisely so the two builds cannot diverge. The consequence
runs the other way and had not been written down: a test asking "did the walk
reach this file" by looking at the store is green whether it did or not.

So the only thing that can answer it is the applied **SET** against the
directory. A conversion that relies on a state assertion for that question
proves nothing, and reads exactly like one that works.

**The example, and it is this entry's evidence.** Converting
`contract-notification.test.mjs` off its hand-kept list of eight record files
onto the directory walk, the new test asserted the six column defaults
`20260920590000_column_defaults.sql` sets on `pennsync_records.notification` —
the very table that suite inserts into — reasoning that the old build, which
never named that file, could not have had them. Omitting the file from the walk
left the test **green**. The file is derived from the generated store, so a build
from nothing already carries every default it would add. The assertion is now
`applied` deep-equalled against `recordMigrationNames()`, which fails under the
same sabotage; the two migrations that arrived on `main` during the work are
named in it rather than counted, because a count moves on somebody else's merge.

**The taxonomy this produces, and knowing which case you are in BEFORE the swap
is the discipline.** Converting a suite from a hand-kept record list to the
directory has three post-swap shapes, and they are told apart by measuring the
forward migrations over that suite's contracts first:

- **Strong** — no forward migration over them. The derived list equals the
  hand-kept one and the reachable set does not move at all. An unmoved set is
  the pass, and any movement means the derivation is wrong or a forward existed
  that nobody listed.
- **Absorbing** — forwards exist over them. The set moves by exactly those
  files, and the suite proves it absorbed them.
- **Neither** — the only forwards reaching the store are unrelated to the
  contracts, or are catch-ups this entry makes invisible. Then the only honest
  check is over names, and a state assertion will pass for the wrong reason.

Measure the case first, because a forward arriving mid-derivation silently turns
the strong form into the absorbing one while the reader still believes they are
in the strong one.

**Both halves of a sabotage go in the record.** The assertion that bites and the
assertion that did not are both findings, and reporting only the first leaves the
next reader with a shape that reads as proved. The replaced assertion is quoted
in the suite's own comment for the same reason.

## D131 — D88's silence is a property of the apply, not of the pull request

**The belief this corrects, which was written down and acted on.** "A modified
already-committed migration is the shape nothing reports" — the apparent
corollary of D88, and false as stated. D88 says that `planMigration` matches on a
migration's NAME and the ledger holds no content hash, so a store that already
ran a file never sees an edit to it. That is a statement about the APPLY. It says
nothing about whether the edit is visible at review time, and reasoning from it
to "nothing reports this" conflates the two.

**What actually reports it.** `applySignal` in
`tools-pennsync-apply-signal.mjs` computes an `editing` set beside `arriving` —
`key in base && base[key] !== head[key]`, over the pins at the two heads — and it
reaches the operator-facing output, not just the returned object. #312
regenerated `record-migrations/20260919170000_record_store.sql`, moving its
pinned fingerprint from `aa381137…` to `8f1ff975…`, and its own
`Say what merging this asks an operator to apply` job printed:

    ##[warning]1 committed migration change text. A store that already ran the
    file will never see the edit; ship a forward migration in the same change
    (D88).

by name, with the remedy, alongside the arriving-migration warning. #312 then did
exactly what the warning asks: `20260920590000_column_defaults.sql` is the
forward, derived rather than typed, and `record-store-catchup.test.mjs` proves an
existing store converges on a fresh build's 425 defaults by rendered expression,
idempotently in both orders, backfilling nothing.

**The reusable rule.** A decision states a property of one mechanism, and the
next reader is one step away from applying it to a neighbouring mechanism where
it does not hold. So when a decision is invoked to explain why something is
invisible, name WHICH mechanism is blind and check the others yourself: here the
apply is silent, the pull request is loud, the ledger row count cannot see it
because it counts rows rather than content, and the hosted comparison sees it
plainly because it compares the schema a fresh build produces against the store.
Four mechanisms, one edit, and only one of them silent.

**And the half worth keeping.** This was measured because it was asked for, not
because it was doubted — the answer expected on both sides was that nothing
reports it, and reading the job log is what contradicted it. A conclusion drawn
from a decision's text is a prediction about an instrument, which is D116's
distinction and the reason the log is quoted above rather than summarised.
