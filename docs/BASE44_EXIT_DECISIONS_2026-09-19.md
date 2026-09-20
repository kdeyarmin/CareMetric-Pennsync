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
