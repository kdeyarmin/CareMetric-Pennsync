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
the thirty-one dispositions D9 closes and the retention schedule D10 sets. Adopting a decision here
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
