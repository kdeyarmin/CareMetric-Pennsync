# Base44 exit plan: finishing the move to Railway and Supabase

Date: 2026-09-19
Status: review of completed work plus a completion plan. The decisions it names
were accepted on 2026-09-19 (see the decision record); this document still
authorizes nothing on its own. Every hosted change it describes still requires its own
review, cost approval, evidence, and release-owner sign-off under the existing
gates in `docs/REPOSITORY_CONSOLIDATION_2026-09-02.md` and
`docs/PENNSYNC_EXTERNAL_CUTOVER_EVIDENCE.md`.

## 0. Implementation status on this branch

Source work completed here, all validated by the repository's own checks:

| Plan item | Delivered |
| --- | --- |
| Phase 0 — decisions | [Exit decisions](BASE44_EXIT_DECISIONS_2026-09-19.md) recording D1 to D12, accepted 2026-09-19 with all five owner roles named |
| Phase 0 — disposition manifest | `tools-transition-disposition.json` plus a coverage gate; all 549 capabilities classified, none undecided, `census_ready: true` |
| Phase 0 — retention schedule | Every retired entity carries a retention basis (D10): six years in the encrypted export archive for the seven that hold an identifier, the named external system for the two mirrors, none for the three operational rows. The gate fails a retirement with nowhere for its rows |
| Phase 0 — disposition evidence | The gate also refuses a `port`, `broker` or `hub` disposition on a function whose module can perform no work; eight such claims were corrected |
| Phase 0 — documentation | `README.md`, `AGENTS.md`, `CONTRIBUTING.md` and `.env.example` describe both backends and every service setting |
| Phase 1 — runtime authority | `INTEGRATIONS_AUTHORITY_MODE=independent` removes the Base44 `getMyTenantContext` call; readiness derives `base44ExecutionDependency` |
| Phase 2 — document ports | All three rendered documents (`generateBagTechniquePDF`, `generateSmartNoteGuide`, `generateUserManual`) are written and parity-proved on their drawing calls rather than on PDF bytes, each answering the way its original did. The checklist drops the Base44 storage fetch its original made on every request: the logo is configured inline, and with none set the document takes the original's own fallback branch |
| Phase 2 — port queue | The same gate reports what blocks each carried function rather than leaving the queue as "86 awaiting review": records_schema=68, ported_function=1, core_integration=12, pdf_rendering=0, external_secret=1, none=4. The twelve `core_integration` ports were counted against the record store until the functions were read: every one calls a Core integration and touches no entity row, so what they wait on is the integration runtime's brokered path — deployed, and paused — rather than a store that does not exist. What counts as written is read from the ported service's own registry, so a port moves a count here by existing. A test pins the distribution and names those twelve, so neither the counts nor the correction can quietly revert |
| Phase 1 — enrollment tool | `tools-pennsync-enroll.mjs` writes identity, agency and membership rows from a digest-addressed plan whose evidence it hashes itself, under the RPC write lock, recorded in an append-only `enrollment_receipt`. It cannot create a native Auth account, cannot enroll into another deployment, and cannot restate an identity already recorded |
| Phase 1 — authority store app namespace | `20260919090000_deployment_app_pin.sql` replaces both app-id literals with one immutable per-deployment pin. The domain across 18 columns and the gate inside `actor()` now read the same row, so they cannot drift; production is admitted only in a database pinned to it, and an unset pin still defaults to staging. `app-namespace-containment.test.mjs` proves it against two databases built from the same migrations |
| Phase 2 — API service | `services/pennsync-api` with health, readiness, release-gated dispatch and the first ported handler |
| Phase 2 — candidate schema | `tools-entity-schema-plan.mjs` generates PostgreSQL for the 156 carried entities (2,404 columns, 287 enum constraints); a test applies the whole plan to a real database |
| Phase 2 — tenant paths | `tools-tenant-path.mjs` resolves how each carried entity reaches its agency: 69 have a usable key from the schema alone |
| Phase 1 — provisioning | `tools-pennsync-provision.mjs` turns the one irreversible manual step into a checked sequence: it refuses an app no deployment may serve, refuses a database that already holds the store, sets the pin, **reads it back from a new session** and stops if it did not stick, applies the migrations in order, and proves the result was chosen rather than defaulted. A test pins that an unconfirmed read-back lets no migration run, and another fails if the tool's app list drifts from the store's `known_app` |
| Phase 2 — record store policies | D14. The generator writes 596 policies across the 156 tables, each derived from the resolved path or the recorded decision: EXISTS through the referenced entity for a reference path, the account for `self`, agency plus platform rows for `shared`, read-only for `global`. `record-tenant-isolation.test.mjs` proves the denials against a real database — two agencies see only their own rows, a cross-tenant write is refused, and two accounts in the same agency cannot see each other's `self` rows |
| Phase 2 — tenant decisions | D13 decides the other 87. `tools-tenant-decision.json` records one kind per entity with a stated reason — `agency` 66, `self` 10, `shared` 2, `global` 8 — and `check:tenant-decisions` re-checks each against its schema, rejecting a `global` that carries an actor column, references a carried entity or can hold a file. `agency_id text not null` is now emitted on all 68 `agency` and `shared` tables, so the generated schema is 2,404 columns and 83 tenant-scoped rather than 2,336 and 15 |
| Phase 2 — record store migration | D15. `20260919170000_record_store.sql`, generated and committed in its own `supabase/record-migrations/` directory (the authority harnesses apply their directory wholesale and exercise no record table; the provisioner applies both, records last), creates the store under `pennsync_records_owner` — a role with neither `SUPERUSER` nor `BYPASSRLS`, so `force row level security` actually binds the tables' owner — and grants no caller role anything, on any table or helper. A caller reaches a row only through a broker owned by that role. `record-store-migration.test.mjs` applies the committed file and proves the ownership, the empty grant set, that the owner is filtered by its own policies, that a broker serves a caller holding nothing while a cross-tenant write stays refused, and that the migration refuses a bypassing owner role or a database with no authority store |
| Phase 3 — file prerequisite | `tools-file-reference-census.mjs` and its committed census of every schema field that can hold a file |
| Guardrail | `tools-base44-surface.mjs` ratchets remaining frontend coupling |

Not done here, and each blocked on something this branch cannot supply:

| Remaining | Blocked on |
| --- | --- |
| Deploying either Railway service; creating the production Supabase project | Creating the hosted project itself. The sequence that pins and migrates it is written and tested (`tools-pennsync-provision.mjs`), so what remains is the project existing |
| Enabling independent authority on the running runtime | A reviewed deployment plus preflight and two-agency acceptance with enrolled actors |
| Generalizing the authority store past four synthetic actors | The app-id pins and the enrollment tool are both done (above), so the mechanism exists and has nobody to run it on: enrolling anyone needs the ten people to accept their Supabase Auth invitations first, and an operator to verify each one out of band. What remains in source: the four actor IDs still pinned in `services/authority-client/client.mjs`, roster behaviour for the four tenant roles that can hold context but not use it, and the synthetic-name constraints, which still refuse a real agency or patient name in every deployment. The last of those is a compliance decision about whether this store ever holds real names, not a refactor |
| Reconciling the duplicated `validateMembershipRows` | Nothing external, and less than it looked. `validateAssignmentIntegrity` is settled: all twelve copies enforce the same authorization, and the five that bound in the caller now share one generated helper. `validateMembershipRows` genuinely diverged — 13 copies across 10 variants differing in signature, return type and checks — but the destination makes it largely moot, because `services/pennsync-api` holds no row-validation predicate at all: the owned store answers the same question transactionally inside `pennsync_private.context`. What is left is deciding, per ported broker, that the store's answer replaces the copy rather than joining it |
| Porting the remaining 82 handlers | **Not review — the data layer, for most of them.** `check:transition-disposition` classifies each `port` function by what actually blocks it: **68** read or write entity rows and need the record store with a tenant predicate for the entities they touch; **12** call a Core integration and touch no entity row at all, so they wait on the integration runtime's brokered path rather than the store; 1 calls another Base44 function and waits on that port; 1 calls a third-party API with an environment key that belongs to the runtime's brokered path. Those twelve sat in the records bucket until the functions were read — a reminder that the category has to be measured from the module, not inferred from the feature. The four written so far — `validatePatientData` and the three documents — were the ones needing nothing but authority and a decision this branch could make |
| Applying the record store to a real deployment | D15 commits the migration that creates it, under an owner row level security binds; what remains is the production Supabase project for it to be applied to |
| Any customer data, file or identity migration | Base44 credentials, named owners, and a maintenance window |
| Frontend hosting, domain move, native rebuild | Approvals and physical devices |

The rest of this document is the plan those items follow.

## 1. What "Railway" means for this app

The work merged so far does not move the app to Railway alone. It replaces the
Base44 platform with two providers, following the design already in the repo:

| Base44 responsibility today | Target | Repository component | State |
| --- | --- | --- | --- |
| Deno backend functions (282) | Railway service(s) running Node 24 | `services/integration-runtime` (6 adapters only) | Partial |
| Authentication and sessions | Supabase Auth in a dedicated project | `services/authority-client`, `services/authority-store` | Staging only, synthetic |
| Entity storage and RLS (253 schemas) | PostgreSQL with forced RLS and RPC brokers | `services/authority-store/supabase/migrations` (10 files) | Five thin slices |
| Uploaded files | Supabase Storage private bucket, `cmfile:` handles | Integration runtime `UploadPrivateFile` / `CreateFileSignedUrl` | Adapter only |
| AI, email | Anthropic and SendGrid through the Railway runtime | Integration runtime `InvokeLLM`, `ExtractDataFromUploadedFile`, `SendEmail` | Deployed, paused |
| Static site hosting | Not started (Base44 site hosting remains) | `.github/workflows/publish-production-frontend.yml` | Not started |
| Scheduled workflows (7) | Not started | `base44/workflows` | All inactive in production |
| Learning, help, central admin | Support Hub, already on Railway (`kdeyarmin/caremetric-support-hub`) | `centralAdminRead`, `centralLearningGrade`, `centralHelp` | Adapters exist, flags off |

Fixed identities that must not change during the transition:

- Production Base44 app `694ec16e72e01b60d22f7cbf`; origins
  `https://caremetricai.base44.app/` and `https://app.caremetricai.com/`.
- Legacy PennSync Base44 app `68ee80d98929370f9e8f2932`;
  `https://pennsync.base44.app`, `pennsync.com`, `app.pennsync.com`.
- Staging Base44 app `6a9881683dc68a0bd54f1ef7`.
- Railway project "CareMetric Train", service `pennsync-integrations`
  (`ce6259a3-b1b7-46e5-8cbf-253f66d39d5d`), origin
  `https://pennsync-integrations-production.up.railway.app`.
- Supabase projects: `caremetric-pennsync-staging` (`xxtyweswohkvgkprimwa`,
  us-east-1, created 2026-09-18) for the independent authority; `CM Train`
  (`xsqobvvreaovwibxwyvv`, us-west-2) for integration-runtime state and the
  private bucket.
- Apple bundle `com.caremetric.ai`, App Store ID `6757097720`; Google package
  `com.caremetic.ai` (intentional spelling).

## 2. What has been done, with evidence

### 2.1 Railway integration runtime (PR #186, #206 to #216)

- Deployed and healthy. Probe on 2026-09-19 of `/healthz` returned
  `status: alive`, `release: paused`, revision
  `570aee948ef1e5c498b7ca8f1c0eb2285c409bd2` (main at PR #216).
- `/readyz` returned HTTP 503 with `released: false`, `operations: []`,
  `missingProviders: []`, `base44ExecutionDependency: true`,
  `trafficCutoverVerified: false`, `browserReleased: false`.
- Real provider acceptance with synthetic data passed on 2026-09-16
  (Anthropic text and structured output, private CSV upload, extraction, signed
  download, SendGrid sandbox). See PR #186 and
  `docs/audits/EXTERNAL_RUNTIME_REVIEW_CLOSEOUT_2026-09-16.md`.
- Dedicated state tables, five service-only RPCs, private bucket, retention
  cron, and safe pre-execution retry are installed in `CM Train`; the migration
  chain is recovered and replayable (`services/integration-runtime/migrations`).
- Browser transport `cm.integrations.v2` exists in
  `src/lib/externalIntegrationTransport.js`, default off, revision-bound.
- Mobile asset preservation guard: `tools-app-store-migration.test.mjs`.

Still true: the runtime obtains caller authority by calling Base44
`getMyTenantContext` (`services/integration-runtime/runtime.mjs`). That is the
single remaining Base44 execution dependency inside the runtime.

### 2.2 Independent authority store (PR #206 to #226)

- Ten SQL migrations under `services/authority-store/supabase/migrations`.
  Nine are applied to the hosted staging project (verified 2026-09-19 through
  the Supabase migration list); `synthetic_archive_patient_import` is
  deliberately not installed hosted.
- Hosted staging tables hold the fixture: 4 identity mappings, 2 agencies,
  4 memberships, 3 patients, 1 assignment, 1 S4 visit bundle, 4 S3 referrals,
  and disclosure audit rows from real reads.
- Contract: `pennsync_private` schema, forced RLS, no allowing policies,
  `SECURITY INVOKER` public wrappers over private `SECURITY DEFINER` entries,
  12-hour session bound, advisory-lock transactions, exact replay receipts,
  deterministic `PT409` conflicts.
- Supported operations: context, memberships, patient roster and detail,
  explicit patient context (`display`, `smart_note_context`), S4 create and
  own-receipt read, current-authority visit documentation read, saved visit
  list, S3 manual referral create/confirm/read/list, referral patient
  selection, assignment grant/revoke, clinician membership revoke.
- Evidence: PGlite and PostgreSQL suites (`pennsync-authority.yml`), real
  local Auth plus PostgREST HTTP acceptance, Chromium acceptance
  (`pennsync-browser.yml`), and the compiled real app against a fresh local
  stack (`pennsync-app.yml`). Local backup and restore rehearsal with
  `pg_dump`/`pg_restore` (`services/authority-store/LOCAL_DATABASE_RESTORE.md`).

### 2.3 Independent staging build of the real app (PR #217 to #226)

- `VITE_PENNSYNC_BACKEND=independent-staging` builds the actual `App`,
  `AuthProvider`, sign-in, agency selector, Patients, Clinical Notes
  (read-only), and Referral Intake (manual existing-patient) against Supabase
  through `src/lib/independentStagingAdapter.js`. Every other operation fails
  closed with `STAGING_OPERATION_UNAVAILABLE`; there is no Base44 fallback.
- The adapter pins the four `info+pennsync-*` test aliases and exactly two
  targets (local loopback, dedicated hosted project).
- Documented in `docs/INDEPENDENT_STAGING_APP.md` and
  `services/authority-client/MANUAL_REFERRAL_UI.md`.

### 2.4 Migration tooling (offline, synthetic-proven)

| Tool | Purpose | Limit today |
| --- | --- | --- |
| `tools-pennsync-acquire.mjs` | Signed-permit capture of enumerated staging records through the Base44 CLI | Staging app only, four users pinned, no files |
| `tools-pennsync-archive.mjs` | Encrypted, integrity-checked offline archive of supplied exports | No Base44 client; consumer must supply exports |
| `tools-pennsync-archive-import.mjs` | Import verified archive into the synthetic patient schema | Names-only patients, local databases only |
| `tools-pennsync-enroll.mjs` | Operator-run, evidence-hashed creation of identity, agency and membership rows in the owned store | Cannot create a native Auth account; every enrollee must already have accepted their invitation |
| `tools-pennsync-cutover.mjs` | Offline checker for the 15-gate cutover evidence packet | No packet exists yet |
| `tools-base44-candidate-manifest.mjs` | Deterministic local inventory of the Base44 candidate | Not hosted parity |
| `tools-live-frontend-sync.mjs` | SHA-256 verification of a published static site | Allowlists Base44 origins only |

### 2.5 Production containment already in place

- All seven production workflows are inactive (2026-09-10 investigation).
- Messaging, e-signature, fax workflows, OASIS v2, PDGM payment, outcome
  computation, patient merge, and telehealth are paused by literal gates.
- Frontend publication is a manual, main-only, workspace-key workflow with
  post-publish hash verification.

## 3. What remains: the gap inventory

Counts measured on this branch on 2026-09-19.

| Surface | Count | Note |
| --- | ---: | --- |
| Frontend files importing the Base44 client | 455 | `src/api/base44Client.js` consumers |
| Direct entity call sites in `src/` | 470 | across 77 entity types |
| Backend function invocation sites in `src/` | 204 | through 83 wrappers in `src/functions` |
| Core integration call sites in `src/` | 41 | UploadFile 31, InvokeLLM 5, ExtractDataFromUploadedFile 4, GenerateImage 1 |
| Backend function directories | 282 | `base44/functions` |
| Entity schemas | 253 | 119 service-only (all CRUD false), 132 with some browser access |
| Native workflows | 7 | plus 1 quarantined |
| Operations ported to the independent store | 8 wrapper contracts | see 2.2 |
| Legacy PennSync app data | 8,672 rows, 387 patients, 8 users | 2026-09-03 read-only inventory |
| CareMetric production data | 3,190 rows, 1 patient, 2 users | same inventory |

Gaps by area:

1. **Authority.** The runtime still calls Base44 for tenant context. The store
   is synthetic-only: four pinned actors, names must start `Synthetic `, only
   `agency_admin` and `clinician` have roster behavior, no enrollment path for
   real users, no MFA or recovery, 12-hour hard session bound.
2. **Data model.** Five narrow slices exist. The other 240-plus entity types,
   including full patient charts, documents, OASIS, care plans, notifications,
   training, and configuration, have no independent schema.
3. **Business logic.** Railway hosts six integration adapters. The 282 Deno
   functions have no Railway home; the platform's authorization, idempotency,
   and CAS semantics are re-implemented per slice in SQL.
4. **Files.** No inventory or copy of existing uploaded files. Base44 backups
   exclude users and files. The `file_url` to `cmfile:` compatibility layer
   does not exist; 31 `UploadFile` call sites still return permanent URLs.
5. **Frontend hosting.** No Railway static service, no publish workflow for a
   non-Base44 origin, `tools-live-frontend-sync.mjs` allowlists only Base44
   origins. The iOS wrapper hard-binds `https://caremetricai.base44.app/` and
   App-Bound Domains `base44.app`/`base44.com`.
6. **Schedules and providers.** No replacement scheduler. Telnyx webhooks,
   OpenAI Whisper, HeyGen retirement, HHGS grouper host (JDK 17), and any
   subscription or purchase entitlement checks are not on Railway.
7. **Customer data migration.** Only synthetic staging capture is supported.
   Production and legacy exports, identity mapping, rehearsal, restore proof,
   and reconciliation manifests do not exist.
8. **Evidence and governance.** None of the 15 cutover gates has a receipt;
   LR-01/LR-02 owners are still TBD; store privacy declarations, signing
   project recovery, and physical-device tests remain open blockers 5 to 7.
9. **Documentation drift.** `README.md`, `AGENTS.md`, `CONTRIBUTING.md`, and
   `.env.example` describe a Base44-only app; the `VITE_PENNSYNC_*` and
   `VITE_EXTERNAL_INTEGRATION_*` settings are documented only in feature docs.

## 4. Decisions needed before the next phase

Each item names a recommendation. None is decided by this document.

| # | Decision | Recommendation | Why |
| --- | --- | --- | --- |
| D1 | Where ported business logic runs | A new Railway service `services/pennsync-api` (Node 24, same Docker and hardening pattern as the integration runtime), with authorization-critical writes as PostgreSQL RPCs | Functions are TypeScript on the Base44 SDK; the esbuild transpile pipeline exists; the team already operates Railway; keeps Supabase as data and auth only |
| D2 | Porting strategy | Hybrid: strict per-contract transfer for authority-bearing workflows (patients, visits, referrals, documents, memberships, notifications); one reviewed tenant-scoped entity broker for low-risk configuration and reference entities; retire or preserve-paused the rest | 282 functions at the current one-slice-per-PR pace will not finish; a generic proxy is forbidden by the existing membrane design, but a reviewed broker for non-PHI tables is not |
| D3 | Cutover shape | Two steps: `business_backend_exit` first (Base44 keeps serving the static shell and custom domain), then `complete_hosting_exit` after the native wrapper ships | The iOS wrapper and App-Bound Domains depend on `caremetricai.base44.app`; a domain move before a new native build breaks installed apps |
| D4 | Production Supabase project | New dedicated project in us-east-1; keep `caremetric-pennsync-staging` as staging; do not reuse `CM Train` | `CM Train` carries Hub Auth triggers and a different access boundary (see `services/authority-store/README.md`) |
| D5 | Data scope | Migrate CareMetric production and legacy PennSync into one store with distinct source namespaces; quarantine ambiguous rows; decide disposition of log tables (UserActivity, SystemLog, SecurityLog) separately | Zero ID overlap between the apps; logs are large and have no tenant provenance |
| D6 | Identity migration | Re-enrollment through Supabase Auth invitations with an operator-verified identity map; no password or session copy | Base44 does not export credentials; the user population is ten accounts |
| D7 | Feature retirement | Carry paused domains (fax workflows, SMS, e-signature, messaging, OASIS v2, PDGM payment, outcome computation, telehealth) as `preserved_paused` in the cutover packet; port each only after its own gate passes | The cutover contract permits paused capabilities only with baseline and target pause receipts |
| D8 | Learning | Complete the Support Hub cutover (`docs/CENTRAL_LEARNING_CUTOVER.md`) and retire the PennSync learning functions instead of porting them | Already the recorded direction; removes HeyGen |
| D9 | The 31 open dispositions | Resolve them by group: retire the provenance-free logs in favour of the store's own tenant-bound disclosure audit, send learning content and telemetry to the Hub, port patient-linked content, broker agency configuration, and carry paused-domain custody | Leaving them open blocked the census on judgments the repository's own evidence already answers; see D9 in the decision record |
| D10 | What happens to a retired table's rows | Six years in the encrypted export archive for anything holding an identifier, with the export receipt in the cutover packet; the named external system for mirrors; nothing for operational rows | D9 retires eight log tables, and "retire" must never be read as "delete"; the migration runbook already requires an approved retention policy for every old-only entity |
| D11 | How one authority store serves more than one app | Each deployment pins one app id, once, in an immutable `pennsync_private.deployment` row that both the storage domain and `actor()` read; the pin must name a row in `known_app`, defaults to staging when unset, and the retired legacy app is not registrable at all | Phase 1 cannot enroll anyone for production while both pins are staging literals, and widening them into a set would let the hosted staging project hold production PHI; a pin keeps the migration text identical everywhere and moves the difference into one row that cannot be edited |
| D12 | How a rendered document is ported | Parity on drawing calls rather than PDF bytes; `jspdf` adopted at the frontend's version and loaded on first use; the logo supplied inline instead of fetched from Base44 storage; the date supplied by the caller | jsPDF stamps a creation time and document id, so byte comparison is impossible and every normalisation weakens the guard; and porting the logo fetch verbatim would have carried a Base44 dependency into the service the exit exists to remove |

## 5. Phased completion plan

Each phase lists deliverables, the CI gate that must exist, the hosted evidence
that closes it, and an indicative size. Sizes assume the current cadence of one
maintainer with agent support; they are estimates, not commitments.

### Phase 0: freeze scope and provision (size S, 1 to 2 weeks)

Deliverables:

- Record decisions D1 to D8 in `docs/ARCHITECTURE_DECISIONS_2026-09-07.md` or
  a successor record.
- Capability disposition manifest: every function, entity, workflow, and
  Core integration classified as `port`, `broker`, `hub`, `retire`, or
  `preserved_paused`. The cutover census requires a disposition for each id.
  Appendix A is the starting classification.
- Documentation: `README.md`, `AGENTS.md`, `CONTRIBUTING.md`, and
  `.env.example` describe both build modes and every Railway and Supabase
  setting (Appendix B).
- Provision, after cost approval: production Supabase project (D4),
  `services/pennsync-api` Railway service skeleton (paused, `/healthz` and
  `/readyz` only), and a Railway static-site service placeholder.
- Base44 credit ledger baseline captured for the zero-credit comparison.
- Named owners for Product, Security, QA, Release, and Hosting in
  `docs/audits/LIVE_READINESS_CHECKLIST_LR01_LR02.md`.

Exit: disposition manifest merged; owners named; both new services deployed
paused; no traffic change.

### Phase 1: independent authority for real users (size M, 2 to 4 weeks)

Deliverables:

- Integration runtime obtains authority from a Supabase JWT plus the store's
  context RPC instead of Base44 `getMyTenantContext`. Readiness reports
  `base44ExecutionDependency: false`. Tests in `caller-binding.test.mjs` and
  `runtime.test.mjs` updated.
- Authority store app namespace. **Done on this branch.** The store used to pin
  one app id in two independent places: the domain `pennsync_private.staging_app`,
  whose CHECK admitted exactly `6a9881683dc68a0bd54f1ef7` and which types 18
  columns across 18 tables, and a literal comparison inside
  `pennsync_private.actor()`, which every read path calls. Calling that a
  "configurable app namespace" understated it; nothing could be enrolled for
  production without a schema migration across the tenancy spine.

  Widening the literal into a *set* was the wrong shape, because together those
  two pins are what stop the hosted staging project from holding production or
  legacy PHI, and a set would let one database hold both. Of the three shapes
  considered — a `deployment` table plus a trigger on each app-scoped table,
  separate domains applied per environment, or an assertion inside the RPC
  entries — the third was rejected outright (it moves containment from the store
  to its callers, which is what the store exists not to rely on) and the second
  was rejected because per-environment migration text makes drift invisible.

  `20260919090000_deployment_app_pin.sql` takes the first, without the triggers
  and — after the restore rehearsal failed on the first attempt — without the
  row. The pin holding a table row is what broke it: a domain CHECK that reads a
  table cannot survive `pg_restore`, which loads data after the schema but in its
  own order, so `COPY pennsync_private.agency` was checked against a `deployment`
  table that had not loaded yet and every row was refused. The migration now
  reads `pennsync.deployment_app_id` once and generates
  `pennsync_private.deployment_app_id()`, an IMMUTABLE function returning that
  single constant, which the domain's CHECK and `actor()` both ask. The pin is
  part of the schema, restored before any data, and there is one source of truth
  for both layers. `pennsync_private.known_app` lists the app ids this codebase
  admits at all — staging and production; the retired `68ee80d98929370f9e8f2932`
  is absent, so no deployment can be pointed at it. An unknown setting fails the
  migration rather than producing an uncontained store, and an unset one defaults
  to staging, the restrictive outcome. `pennsync_private.deployment` survives as
  the dated record — the app, whether it was chosen or defaulted, and when —
  constrained to equal the function so it cannot drift from what it records, and
  closed to update, delete and truncate. The domain is renamed `deployment_app`,
  since `staging_app` stops being true the moment a production deployment
  exists.

  `services/authority-store/tests/app-namespace-containment.test.mjs` proves this
  against two databases built from the same migrations, one defaulted to staging
  and one pinned to production: each admits its own app and refuses the other's,
  at both layers, and only the production-pinned one can write a production
  identity row. It still fails the moment a new table carries an app id outside
  the domain or the pin becomes editable.

  This opened enrollment, not PHI, and storage, not the surface. The
  synthetic-shape constraints — agency and patient names must begin `Synthetic `,
  and `patient.synthetic` must hold — are untouched, and the test asserts that a
  production-pinned database still refuses a real agency or patient name. Every
  response this store builds also states `staging: true` and `synthetic: true`,
  so `actor()` refuses any non-staging deployment outright
  (`PENNSYNC_STAGING_RPC_SURFACE_ONLY`) rather than relabel eighteen response
  builders and claim a port that has not happened. A production deployment is
  writable by the migration administrator — which is how the enrollment tool in
  the next bullet creates its rows — and serves no RPC. Both limits are pinned by
  tests, including one that fails if a response contract stops saying `staging`,
  so the guard cannot outlive its reason unnoticed.
- All six tenant roles, real names permitted through an explicit production
  migration, actor registry moved from code pins to verified identity-map rows,
  session policy reviewed (refresh, idle, MFA decision).
- Enrollment tool. **Done on this branch.** `tools-pennsync-enroll.mjs` takes a
  plan addressed by its own SHA-256, reads and hashes each enrollee's
  corroborating document rather than accepting a declared digest, and writes the
  `identity_map`, `agency` and `membership` rows in one transaction under the
  same advisory lock the authority RPCs take for writes. There is no public
  provisioning API and no CLI path that creates a native account: every enrollee
  must already exist in `auth.users`, confirmed, not banned, not deleted, with
  the address on that row matching the plan exactly, so an operator cannot
  accept an invitation on someone's behalf. The plan names an app id and the
  database names the one it serves; a mismatch is refused before anything is
  written. An identity already recorded must match the plan exactly — provenance
  is immutable by trigger, so a differing plan is a contradiction rather than an
  update — and a plan already applied is refused on its receipt. Every run is
  recorded in the append-only `pennsync_private.enrollment_receipt` with the plan
  digest, a digest of what was written, the counts, the database and the operator
  role. 22 tests cover it: the plan boundary offline, and the rest against
  PGlite, including a production-pinned database enrolling a production identity
  that the staging one refuses.
- Hosted-target CI job: the existing browser and compiled-app acceptance run
  against the dedicated hosted staging project using the four enrolled actors
  (secrets: publishable key and actor UUID map). Today both jobs run only
  against a fresh local stack.

Exit: two-agency positive and negative matrix from
`docs/PENNSYNC_EXTERNAL_CUTOVER_EVIDENCE.md` passes hosted with real Auth;
`identities`, `isolation`, and `revocation` rehearsal receipts can be produced.

### Phase 2: data model and API service (size XL, 8 to 14 weeks)

**What actually gates this phase, measured rather than estimated.** The census
says 86 functions are carried as `port`; it does not say any of them can be
written. `pnpm run check:transition-disposition` now classifies each one by its
blocker, read from the module:

| Blocker | Functions | What has to exist first |
| --- | ---: | --- |
| `records_schema` | 80 | The ported record store, plus a tenant predicate for every entity each one touches — which is why the 87 unresolved tenant paths below are this phase's real critical path |
| `ported_function` | 1 | `extractReferralDataForSmartNote` waits on the referral broker it calls |
| `pdf_rendering` | 0 | Emptied by D12. All four document functions are written |
| `external_secret` | 1 | `transcribeAndGenerateSOAPNote` takes recorded patient audio, transcribes it with OpenAI and reasons over it with Anthropic, using keys from the environment. It belongs to the integration runtime's brokered path rather than to a handler — and that path does not yet reach it: the runtime brokers a closed set of seven operations (`InvokeLLM`, `ExtractDataFromUploadedFile`, `GenerateImage`, `SendEmail`, `UploadFile`, `UploadPrivateFile`, `CreateFileSignedUrl`), enforced by a CHECK on `cm_integration_jobs.operation`, and audio transcription is not among them. Carrying it means a new brokered operation with the same reservation, daily quota, encrypted result and audit the others have, for a payload that is PHI. That is a capability to design, not a key to move |
| `none` | 4 | `validatePatientData` and the three documents, all written |

Read that as the schedule: nothing in the port queue starts before the record
store does, so the tiers below are ordered by what unblocks the most handlers,
not by what is easiest to write.

Deliverables, in tiers that can merge independently:

- Schema: **generated and proven to apply** by `tools-entity-schema-plan.mjs`.
  156 carried entities become tables in `pennsync_records` with 2,336 columns,
  287 enum CHECK constraints and a `(source_app_id, id)` primary key that keeps
  the two source apps' colliding ids apart. Every table forces RLS with no
  policy and no grant. Emit it with `pnpm run emit:entity-schema`.
  Still to decide per entity: indexes, foreign keys, retention, and which
  columns become NOT NULL once legacy rows are reconciled.
- Tenant paths: **resolved or named** by `tools-tenant-path.mjs`. Forced RLS
  with no policy is safe but not usable; each table needs one predicate that
  proves a row belongs to the agency asking for it. Only 15 of the 156 entities
  declare `agency_id`, so the rest are resolved by following references:

  | How the agency is reached | Entities | Meaning |
  | --- | ---: | --- |
  | `root` | 1 | `Agency` is the tenant |
  | `direct` | 14 | The row carries `agency_id` |
  | `reference` | 54 | Reached through another resolved entity, at most three hops, mostly via `patient_id` |
  | `actor` | 34 | Only an acting-account column (`created_by`, `user_email`) |
  | `profile_claim` | 1 | `User.agency_id`, which the account can rewrite about itself |
  | `unresolved` | 52 | Nothing in the schema names a tenant |

  So 69 tables can have a predicate written from the schema as it stands and 87
  cannot. **Those 87 are decided by D13** and recorded in
  `tools-tenant-decision.json`; `node tools-tenant-path.mjs --blocking` still
  lists them and `pnpm run check:tenant-decisions` checks the answers. The three
  questions they needed, and what was answered:

  1. May a row whose only tenancy signal is the acting account (`actor`, 34 of
     them, keyed by `created_by`, `updated_by_email`, `user_email` and the like)
     be scoped by that account's *current* membership? A person's agency changes
     over time while the row does not, so this is a policy choice, not a lookup.
     `AgencySettings`, `PayerRateConfig` and `TerminologyGlossary` are here.
  2. Which of the 52 `unresolved` tables are platform reference data that is
     legitimately global — `MedicareGuideline` and `ServiceCode` read that way —
     and which are agency data missing a key? `AgencyComplianceRule`,
     `AgencyFeatureAccess`, `AgencyInvoice` and `VisitPointConfig` are named for
     an agency and carry no way to name one.
  3. For every table in the second group, `agency_id` is added before load, not
     backfilled after, because a row loaded without a tenant cannot be assigned
     one later without guessing.

  Answered: (1) **no** — an acting account is never a tenant, because scoping by
  current membership moves a row to a new agency the moment a person transfers,
  in both directions and silently; an actor column either names the row's own
  subject (`self`, 11) or is provenance and the row takes a real key. (2) eight
  are genuinely global, and the gate re-checks each against its schema rather
  than trusting the list; reading the schemas moved `Physician`, `SupplyItem`
  and `CareSetting` out of that group, the first of which carries
  `referral_count` and would have shown one agency's referral volume to its
  competitors. (3) done — `agency_id text not null` is emitted on all 67
  `agency` and `shared` tables by the schema generator.

  `User.agency_id` is excluded from authorization by construction: a signed-in
  account can edit its own profile, and treating that claim as authority is the
  defect that paused `analyzeClinicalData`.
  Authority-bearing tables follow the existing `pennsync_private` pattern
  (forced RLS, RPC entries, receipts). Broker tables get one reviewed
  tenant-scoped RPC family with agency binding from the membership row.
- `services/pennsync-api`: bearer Supabase JWT verification, request admission
  and body bounds copied from the integration runtime, no-store errors, per
  function release gates, `/v1/functions/<name>` mirroring the
  `functions.invoke(name, payload)` shape so `src/functions/*` wrappers keep
  their call signatures.
- Tier A (port): the 24 authority brokers in Appendix A, plus Notification
  authority-v1 and the care-team assignment mutation. These have designed
  contracts and hosted-proof requirements already written.
  **Prerequisite, measured on this branch:** the two predicates these brokers
  authorize with are hand-duplicated rather than shared. `validateMembershipRows`
  has 13 copies in 10 distinct variants and `validateAssignmentIntegrity` has 12
  copies in 11, across `getAuthorizedPatient`, `getAuthorizedVisit`,
  `listAuthorizedPatients`, `listAuthorizedVisits`, `createAuthorizedPatient`,
  `createAuthorizedVisit`, `updateAuthorizedPatient`, `updateAuthorizedVisit`,
  `getAuthorizedDocument`, `listAuthorizedDocuments`, `createAuthorizedDocument`,
  `manageAuthorizedReferral`, `readAuthorizedOASISAssessments`,
  `saveOasisResponses`, `generateFaxCoverPage` and `listMyTenantMemberships`.
  The repository's shared-helper generator (`base44/_shared/backendHelpers.mjs`,
  enforced across 225 consumers by `pnpm run check:shared-helpers`) does not
  cover this family — it is the one security-critical family still copied by
  hand.

  **The twelve `validateAssignmentIntegrity` copies have since been diffed, and
  the divergence is smaller and sharper than "eleven variants" suggests.** Most
  of it is cosmetic: some copies take one `authority` object and others take
  `agencyId`, `userId`, `normalizedEmail` and `membership` as separate
  parameters, and `generateFaxCoverPage` calls the same field `authority.email`
  rather than `normalizedEmail`. Every copy agrees that the row must name this
  caller, this agency and this patient, must carry a known status, action and
  source, a valid `activated_at` and a sane `version`, and must refuse by
  throwing `PublicError(409)`.

  Reading the predicate alone suggests a strictness split: seven copies compare
  the row against `membership.id` and `membership.version` inside the guard and
  compare the assignment's email to the caller's, and five do not. **That
  reading is wrong, and an earlier revision of this document asserted it.** The
  other five performed the same comparisons in the caller, on the line after the
  predicate returns — each carrying its own hand-written copy of this, since
  replaced by the generated helper described below:

  ```js
  const assignment = await loadExactAssignment(...);
  if (
    !authority.membership
    || assignment.user_email_normalized !== authority.normalizedEmail
    || assignment.assignee_membership_id !== authority.membership.id
    || assignment.assignee_membership_version_at_enablement !== authority.membership.version
  ) throw new PublicError(409, 'Care-team assignment binding is invalid');
  ```

  All twelve therefore enforce the same authorization. There is no weaker tier,
  and no security finding here: `getAuthorizedPatient` and
  `readAuthorizedOASISAssessments` bind exactly as strictly as the Visit
  brokers. What differs is only where the binding is written — inside the
  predicate for seven, in the caller for five.

  That placement is still a real hazard for the port. A reviewer who reads only
  the predicate concludes five PHI paths are weaker than they are; more
  importantly, anyone porting `validateAssignmentIntegrity` without also porting
  its caller would carry the half that omits the binding and silently drop the
  revocation check.

  **Half of the consolidation has landed.** The five hand-written call-site
  copies are now one generated `requireAssignmentBinding` in
  `base44/_shared/backendHelpers.mjs`, inlined into each consumer and held
  identical by `pnpm run check:shared-helpers` (227 consumers). That is a pure
  deduplication: same four conditions, same `409 'Care-team assignment binding
  is invalid'`, same position relative to each caller's other guards.
  `createAuthorizedDocument` gains two conditions it did not previously state —
  the null-membership check and the caller-email comparison — and both are
  provable no-ops there, because it dereferences `membership.tenant_role`
  earlier on the same path and its predicate already forces
  `row.user_email_normalized === actor.normalizedEmail`.

  **The binding was deliberately not folded into the predicate**, which is what
  an earlier revision of this document proposed. Every caller runs it *after* its
  own "assignment missing or not active" guard, which answers
  `404 'Patient unavailable'`. Moving the binding inside `validateAssignmentIntegrity`
  would run it first and answer 409 for a row the caller should not learn exists
  — a small disclosure regression traded for tidiness. The 404-then-409 order
  reads as deliberate, so it was kept.

  What remains is the other seven, whose binding sits inside the larger
  integrity guard and so throws `'Care-team assignment integrity check failed'`
  rather than the binding message. Extracting those would change that message on
  seven production paths, and contract tests assert it, so it is a separate
  reviewed change rather than part of this deduplication.
  `base44/functionTests/assignmentBindingConvention.test.js` holds the line: it
  fails if any copy loses the binding from both places, if a copy changes which
  half holds it, if one of the five re-inlines a hand-written copy instead of
  the helper, if a binding is dereferenced without establishing the membership
  exists, or if a copy drops a condition all twelve share.
- Tier B (port through the runtime): the 43 AI-assist functions become thin
  server handlers that call the runtime's `InvokeLLM` and
  `ExtractDataFromUploadedFile` adapters; Base44 `Core.*` calls in `src/` go
  through the v2 browser transport once released.
- Tier C (broker): configuration and operations entities (payer, payroll,
  visit points, incidents, timesheets, time off, vehicles, credentials) through
  the generic tenant-scoped broker; user administration moves to Supabase Auth
  admin operations behind the platform-owner gate.
- Tier D (hub): learning functions retired per D8.
- Tier E (preserved_paused): per D7, with pause receipts.
- Frontend: replace `src/api/base44Client.js` with a backend-neutral client;
  the independent adapter becomes the default when
  `VITE_PENNSYNC_BACKEND=independent`; remove `@base44/sdk`,
  `@base44/vite-plugin`, and `BASE44_LEGACY_SDK_IMPORTS` in the final PR of the
  phase. Entity call sites (470) are replaced tier by tier; a lint rule blocks
  new direct entity calls.
- CI: each tier extends `pennsync-authority.yml`, `pennsync-browser.yml`, and
  `pennsync-app.yml`; the existing `check:backend-transpile` gate is retargeted
  from Deno entries to the new service.

Exit: `clinical` and `concurrency` rehearsal gates producible; every
`src/functions` wrapper resolves to the new service or is retired; no
`base44.entities` reference remains in production-mode code.

### Phase 3: files (size M, 3 to 5 weeks; can overlap Phase 2)

- Read-only inventory tool for uploaded files in both production apps
  (count, size, owner, agency, referencing records) using a supported listing.
- Copy into the production project's private bucket with a SHA-256 manifest;
  originals untouched.
- Compatibility layer: `file_url` consumers resolve `cmfile:` handles to
  60-second signed URLs at use time; fax and document flows bind to stable
  artifact ids, never to signed URLs.
- Migrate the 31 `UploadFile` call sites to `UploadPrivateFile`.

Exit: `private_files` rehearsal receipt (source hash equals download hash,
foreign and revoked denial, expiry and renewal).

### Phase 4: customer data migration (size L, 4 to 8 weeks; after Phase 2 schema)

- Extend `tools-pennsync-acquire.mjs` with owner-signed permits for the
  production and legacy apps and a supported all-entity export; keep the
  encrypted archive format.
- Mapping tables: users, agencies, entity ids, file locators, and the six
  differing schema definitions, per
  `docs/PENNSYNC_DATA_MIGRATION_RUNBOOK_2026-09-03.md`.
- Importer targets the production-shape schema with an immutable manifest
  (source id, target id, checksum, transform version, result).
- Rehearsal into a disposable project, restore rehearsal, reconciliation of
  counts, edges, and file hashes; Notification producer cutover before any
  Notification backfill; learning content classified before import.

Exit: `archive_restore`, `sessions`, and `rollback` rehearsal receipts;
zero unexplained conflicts.

### Phase 5: frontend hosting and native wrapper (size M, 3 to 6 weeks; parallel to Phase 4)

- Railway static-site service for the SPA: SPA fallback, immutable asset
  caching, the existing CSP, health endpoint.
- New publish workflow replacing `publish-production-frontend.yml`: builds
  with `VITE_PENNSYNC_BACKEND=independent` and the external-integration
  settings, deploys to Railway, verifies with `tools-live-frontend-sync.mjs`
  after extending its origin allowlist.
- Step one (`business_backend_exit`): the Base44 site continues to serve the
  build; the build talks only to Railway and Supabase. Base44 becomes a static
  shell with no business role.
- Step two (`complete_hosting_exit`): move `app.caremetricai.com` to Railway;
  keep `caremetricai.base44.app` reachable until a new iOS build with the new
  `appURL` and App-Bound Domains is approved; recover the Android project
  (blocker 6), correct store privacy declarations (blocker 5), run
  physical-device tests (blocker 7).

Exit: `endpoints` and `native` production receipts.

### Phase 6: schedules and providers (size M, 2 to 4 weeks; after Phase 2)

- Scheduler: Railway cron service or `pg_cron` invoking the API with the
  internal secret; each of the seven workflows stays behind its
  `WORKFLOW_RELEASE_*` gate until its hosted proof exists.
- Telnyx status webhook re-pointed to the API; Whisper and Anthropic keys as
  Railway references; HeyGen removed after the Hub cutover; HHGS adapter as a
  JDK 17 service only when PDGM payment is released.

Exit: `release_controls` receipt shows exactly the intended released set.

### Phase 7: rehearsal, cutover, decommission (size M, 2 to 4 weeks)

- Assemble the evidence packet and run `node tools-pennsync-cutover.mjs --check`
  until it reports `evidence_coverage_complete`.
- Full rehearsal in staging with the four actors and the minimum observation
  window from the release plan.
- Production: write freeze on Base44 (all direct RLS false, function gates
  closed), final delta export and import, canary, observation window, rollback
  plan that leaves Base44 intact, then the domain step from Phase 5.
- After the retention window: Base44 apps read-only, credit ledger compared
  with the Phase 0 baseline, hosting retired.

Exit: `cutover` and `independence` production receipts; release-owner sign-off.

### Dependency order

Phase 0 gates everything. Phase 1 gates Phases 2 and 4. Phase 2 gates Phases 4
and 6. Phase 3 can start once the production bucket exists. Phase 5 step one
can start when Phase 2 tier A is on the hosted staging project; step two waits
for the native wrapper. Phase 7 waits for all others.

## 6. Risks and mitigations

- **Forced re-enrollment.** No credential export exists. Mitigation: D6, a
  communicated enrollment window, the identity map verified before cutover.
- **File completeness.** Base44 backups exclude files and a supported complete
  listing may not exist. Mitigation: build the inventory first (Phase 3) and
  treat unreferenced objects as blockers, not omissions.
- **Hidden hosted-only capabilities.** Dashboard automations, connectors, and
  secrets are not in the repository. Mitigation: the `hosted_capabilities`
  census entries and an authenticated read-only inventory before Phase 7.
- **Native wrapper origin.** Installed apps break if `caremetricai.base44.app`
  disappears before the new build is approved. Mitigation: D3 two-step cutover.
- **Concurrency semantics change.** Ported handlers written for last-write-wins
  claim-then-reread must become transactions. Mitigation: port through RPCs
  with the existing receipt and `PT409` pattern; keep `docs/PLATFORM-CAS.md`
  as the list of flows to rewrite.
- **Scope.** Strict per-function transfer across 282 functions is the main
  schedule risk. Mitigation: D2 and D7; Appendix A proposes retiring or
  pausing more than half.
- **PHI handling during migration.** Mitigation: encrypted archives only,
  restricted operator environments, no plaintext extraction paths, as the
  tooling already enforces.
- **Cost.** Two Supabase projects and three Railway services. Mitigation:
  explicit approval per resource in Phase 0, as was done for the staging
  project.

## 7. Immediate next pull requests

1. Decision record for D1 to D8 and the capability disposition manifest.
2. Documentation and `.env.example` update for both build modes.
3. Integration runtime: authority through Supabase JWT and RPC;
   `base44ExecutionDependency` becomes false with tests.
4. Authority store: configurable namespace, six roles, production naming
   migration, identity-map enrollment tool.
5. Hosted-target CI job against `caremetric-pennsync-staging`.
6. `services/pennsync-api` skeleton on Railway with `/healthz`, `/readyz`,
   release gates, and the first Tier A handler.
7. Read-only file inventory tool for both production apps.
8. Provisioning record for the production Supabase project and Railway
   services after cost approval.

## Appendix A: backend function families and proposed disposition

Classification by name pattern on 2026-09-19, kept for the record. It is
**superseded**: `tools-transition-disposition.json` now carries a reviewed
disposition for every function individually, and where the two disagree the
manifest is right. Read this table as the starting guess it was.

| Family | Count | Proposed disposition |
| --- | ---: | --- |
| Tenant and authority brokers (`getMyTenantContext`, `listAuthorized*`, `createAuthorized*`, `manageAuthorizedReferral`, `manageAgencyMembership`, ...) | 24 | port (Tier A) |
| AI clinical assist (`analyze*`, `generate*`, `predict*`, `extract*`, `transcribe*`, `triage*`) | 43 | port through the runtime adapters (Tier B) |
| User, admin, security, operations (`userManagement*`, `offboardUser`, timesheets, time off, vehicles, credentials, incidents, dashboards) | 42 | broker (Tier C) or Supabase Auth admin |
| Notifications, email, reminders | 13 | port authority-v1 producer; retire legacy producers |
| E-signature, documents, PDF | 50 | documents and PDF generation port; signing preserved_paused |
| Fax, Telnyx, SMS, voice, telehealth | 39 | preserved_paused; port after each gate |
| Training, learning, policy, central hub adapters | 38 | hub (retire in PennSync) |
| OASIS, PDGM, outcomes, KPI | 20 | preserved_paused; reads port when tenant proof exists |
| Follow-up, messaging, AI agreement, data quality, other | 13 | messaging preserved_paused; follow-up and agreement port |

Entity schemas: 119 are already service-only (all four direct operations
false) and can move behind RPCs without changing browser behavior; 132 still
allow some direct browser access and need a broker or a port decision each.

## Appendix B: settings that must be documented and provisioned

| Setting | Where | Purpose |
| --- | --- | --- |
| `VITE_PENNSYNC_BACKEND` | build | `base44` (default) or `independent-staging`; a future `independent` value for production |
| `VITE_PENNSYNC_STAGING_PROJECT_REF`, `VITE_PENNSYNC_STAGING_PROJECT_URL`, `VITE_PENNSYNC_STAGING_PUBLISHABLE_KEY`, `VITE_PENNSYNC_STAGING_ACTORS` | build | Pinned Supabase target and actor map (`docs/INDEPENDENT_STAGING_APP.md`) |
| `VITE_EXTERNAL_INTEGRATIONS`, `VITE_EXTERNAL_INTEGRATION_ORIGIN`, `VITE_EXTERNAL_INTEGRATION_OPERATIONS`, `VITE_EXTERNAL_INTEGRATION_REVISION` | build | Browser transport to the Railway runtime (`docs/EXTERNAL_INTEGRATION_BROWSER_TRANSPORT.md`) |
| `INTEGRATIONS_RELEASE`, `INTEGRATIONS_ALLOWED_OPERATIONS`, `INTEGRATIONS_BROWSER_RELEASE`, `INTEGRATIONS_BROWSER_OPERATIONS` | Railway runtime | Release controls, all off today |
| Provider references (Anthropic, SendGrid, Supabase service credentials, encryption and hash keys) | Railway runtime | Private references, never in the repository |
| `PENNSYNC_TEST_PG_URL`, `PENNSYNC_TEST_PG_BIN`, `PENNSYNC_SUPABASE_CLI` | CI | Existing local acceptance inputs |
| Hosted-target CI secrets (publishable key, actor UUID map) | CI | Phase 1 deliverable |

## Appendix C: CI and evidence matrix

| Workflow | Proves today | Needed for the exit |
| --- | --- | --- |
| `ci.yml` | Lint, unit and contract suites, Base44 transpile, build | Retarget transpile to the API service; drop Base44 npm compatibility check at the end |
| `pennsync-authority.yml` | PostgreSQL authority, S3, S4, disclosure, restore suites | Grows with every ported tier |
| `pennsync-browser.yml` | Chromium against local Auth and PostgREST | Add the hosted-target variant |
| `pennsync-app.yml` | Compiled real app against local stack | Add the hosted-target variant |
| `external-integrations.yml` | Runtime, retry, scheduler tests | Add the API service |
| `publish-production-frontend.yml` | Base44 site publication | Replace with the Railway publish workflow |
| `hhgs-adapter.yml` | Offline CMS grouper parity | Unchanged until PDGM release |
| `base44-publishing-access.yml` | Credential availability diagnostic | Retire after the hosting exit |
