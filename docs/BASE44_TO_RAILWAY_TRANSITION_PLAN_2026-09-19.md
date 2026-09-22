# Base44 exit plan: finishing the move to Railway and Supabase

Date: 2026-09-19
Status: review of completed work plus a completion plan. The decisions it names
were accepted on 2026-09-19 (see the decision record, which now runs to D25;
Section 4 below tabulates D1 to D12 and the rest are recorded there as they were
taken); this document still authorizes nothing on its own. Every hosted change it describes still requires its own
review, cost approval, evidence, and release-owner sign-off under the existing
gates in `docs/REPOSITORY_CONSOLIDATION_2026-09-02.md` and
`docs/PENNSYNC_EXTERNAL_CUTOVER_EVIDENCE.md`.

## 0. Implementation status on this branch

Source work completed here, all validated by the repository's own checks:

| Plan item | Delivered |
| --- | --- |
| Phase 0 — decisions | [Exit decisions](BASE44_EXIT_DECISIONS_2026-09-19.md) recording D1 to D25, accepted 2026-09-19 with all five owner roles named |
| Phase 0 — disposition manifest | `tools-transition-disposition.json` plus a coverage gate; all 549 capabilities classified, none undecided, `census_ready: true` |
| Phase 0 — retention schedule | Every retired entity carries a retention basis (D10): six years in the encrypted export archive for the seven that hold an identifier, the named external system for the two mirrors, none for the three operational rows. The gate fails a retirement with nowhere for its rows |
| Phase 0 — disposition evidence | The gate also refuses a `port`, `broker` or `hub` disposition on a function whose module can perform no work; eight such claims were corrected |
| Phase 0 — documentation | `README.md`, `AGENTS.md`, `CONTRIBUTING.md` and `.env.example` describe both backends and every service setting |
| Phase 1 — runtime authority | `INTEGRATIONS_AUTHORITY_MODE=independent` removes the Base44 `getMyTenantContext` call; readiness derives `base44ExecutionDependency` |
| Phase 2 — document ports | All three rendered documents (`generateBagTechniquePDF`, `generateSmartNoteGuide`, `generateUserManual`) are written and parity-proved on their drawing calls rather than on PDF bytes, each answering the way its original did. The checklist drops the Base44 storage fetch its original made on every request: the logo is configured inline, and with none set the document takes the original's own fallback branch |
| Phase 2 — port queue | The same gate reports what blocks each carried function rather than leaving the queue as "86 awaiting review". It currently reads entity_not_carried=7, entity_authorization=8, patient_access_model=0, records_schema=0, files=12, ported_function=0, core_integration=2, pdf_rendering=0, external_secret=2, none=73, and every one of those numbers is a correction of a coarser one — `core_integration` last moved when D81 ported `generatePatientHandout`, whose send was one action of two and behind the module's own release gate. It began as records_schema=94, files=4, ported_function=1, core_integration=1, pdf_rendering=0, external_secret=1, none=10. The twelve `core_integration` ports were counted against the record store until the functions were read: every one calls a Core integration and touches no entity row, so what they waited on was the integration runtime’s brokered path — deployed, and paused — rather than a store that does not exist. All twelve left it: five by being written, two by being reclassified paused, four by being file-bound, and `generateUserGuidePDF` — the only capability that both asks a model and renders a document — by being ported once the service had a brokered integration client and a PDF library. The one counted there now arrived from the opposite direction, under D18. What counts as written is read from the ported service's own registry, so a port moves a count here by existing. A second correction followed: nine capabilities were paused at source by a module-level flag pinned `false`, so their handlers refuse before reaching anything worth porting. They are carried `preserved_paused` now, as D7 already said paused domains should be, and a gate contradicts any future `port`, `broker` or `hub` on a paused handler. A fourth followed D23's roster policy and is the largest movement of all: `entity_authorization` meant "reads `User`, which has forced RLS and no policy", and with a read policy it should have emptied — except 8 of the 43 UPDATE a profile, and the classifier could not tell reading a table from writing one. It records writes now, and what blocks is read from the policies the store emits rather than inferred from a tenant path, which also caught two capabilities nothing had ever reported: `fetchMedicareGuideline` and `scheduledGuidelineSync` write `MedicareGuideline`, a `global` reference table no tenant surface may write. 43 → 10. A third, under D25, was the largest single movement in the queue before that: 27 of the 34 capabilities counted `entity_not_carried` were held by one of the three retired log tables and nothing else, and `retire` had decided where those rows GO rather than whether the product keeps auditing. With the activity trail committed they redistribute across the three buckets behind them — which is why those grew while the total did not move — and the seven that remain each read a table from a domain that is genuinely going away. The tool answers this by looking for the migration rather than by asserting it: delete `20260920010000_activity_audit.sql` and all 27 are blocked again, which is the right answer in a tree with no audit sink. A test pins the distribution and the named lists, so neither the counts nor any of the three corrections can quietly revert |
| Phase 1 — enrollment tool | `tools-pennsync-enroll.mjs` writes identity, agency and membership rows from a digest-addressed plan whose evidence it hashes itself, under the RPC write lock, recorded in an append-only `enrollment_receipt`. It cannot create a native Auth account, cannot enroll into another deployment, and cannot restate an identity already recorded |
| Phase 1 — authority store app namespace | `20260919090000_deployment_app_pin.sql` replaces both app-id literals with one immutable per-deployment pin. The domain across 18 columns and the gate inside `actor()` now read the same row, so they cannot drift; production is admitted only in a database pinned to it, and an unset pin still defaults to staging. `app-namespace-containment.test.mjs` proves it against two databases built from the same migrations |
| Phase 2 — API service | `services/pennsync-api` with health, readiness, release-gated dispatch and the first ported handler |
| Phase 2 — candidate schema | `tools-entity-schema-plan.mjs` generates PostgreSQL for the 156 carried entities (2,404 columns, 287 enum constraints); a test applies the whole plan to a real database |
| Phase 2 — tenant paths | `tools-tenant-path.mjs` resolves how each carried entity reaches its agency: 69 have a usable key from the schema alone |
| Phase 1 — provisioning | `tools-pennsync-provision.mjs` turns the one irreversible manual step into a checked sequence: it refuses an app no deployment may serve, refuses a database that already holds the store, sets the pin, **reads it back from a new session** and stops if it did not stick, applies the migrations in order, and proves the result was chosen rather than defaulted. A test pins that an unconfirmed read-back lets no migration run, and another fails if the tool's app list drifts from the store's `known_app` |
| Phase 2 — record store policies | D14. The generator writes 589 policies across the 156 tables, each derived from the resolved path or the recorded decision: EXISTS through the referenced entity for a reference path, the account for `self`, agency plus platform rows for `shared`, read-only for `global`. `record-tenant-isolation.test.mjs` proves the denials against a real database — two agencies see only their own rows, a cross-tenant write is refused, and two accounts in the same agency cannot see each other's `self` rows |
| Phase 2 — tenant decisions | D13 decides the other 87. `tools-tenant-decision.json` records one kind per entity with a stated reason — `agency` 66, `self` 10, `shared` 2, `global` 8 — and `check:tenant-decisions` re-checks each against its schema, rejecting a `global` that carries an actor column, references a carried entity or can hold a file. `agency_id text not null` is now emitted on all 68 `agency` and `shared` tables, so the generated schema is 2,404 columns and 83 tenant-scoped rather than 2,336 and 15 |
| Phase 2 — record store migration | D15. `20260919170000_record_store.sql`, generated and committed in its own `supabase/record-migrations/` directory (the authority harnesses apply their directory wholesale and exercise no record table; the provisioner applies both, records last), creates the store under `pennsync_records_owner` — a role with neither `SUPERUSER` nor `BYPASSRLS`, so `force row level security` actually binds the tables' owner — and grants no caller role anything, on any table or helper. A caller reaches a row only through a broker owned by that role. `record-store-migration.test.mjs` applies the committed file and proves the ownership, the empty grant set, that the owner is filtered by its own policies, that a broker serves a caller holding nothing while a cross-tenant write stays refused, and that the migration refuses a bypassing owner role or a database with no authority store |
| Phase 2 — record broker family | D17, narrowed by D22. `20260919180000_record_brokers.sql`, generated by `tools-record-brokers.mjs`, is the only bridge across the empty grant set D15 left: five operations (`list`, `get`, `insert`, `update`, `delete`) over a generated allowlist, owned by `pennsync_records_owner` and SECURITY DEFINER, so the policies bind inside them. It grants a caller role USAGE on the schema and EXECUTE on those five and nothing else — never a table — and SECURITY INVOKER wrappers in `public` keep it reachable without a Supabase project setting. A broker stamps tenancy from the caller's verified identity and REFUSES a payload that names it; the agency is checked against the membership roster rather than the request. `record-brokers.test.mjs` applies the real migration and holds eighteen cases, including one caller with two real memberships — with one each, RLS alone gives the right answer and a broker that dropped the narrowing would pass. `services/pennsync-api/records.mjs` reaches it with the caller's own bearer and no new credential: the record store is the same database as the authority store |
| Phase 0 — the entity-side ceiling, re-measured | D22. The allowlist was 31 until the ceiling was taught to read each schema's own `rls` block, which is the platform's own statement of what a client may do to a table. Twenty-eight of the 31 declare an authority decision the generic family cannot evaluate — a `false` in that block means no client may perform the operation at all — so the family serves three entities and all three are read-only. The generator refuses to run while any allowlisted entity fails the ceiling, so this cannot be restored by editing SQL; it takes a disposition change and a schema that permits the read. The twenty-eight join the 125 that need a reviewed contract under D19, which was always the safer path and is now very nearly the only one. A regression this caught in passing: renaming the broker modes stopped the agency narrowing, because the SQL compared `mode = 'tenant'` literally — visible only in the two-membership case |
| Phase 2 — the care team | D24, built, both halves. `caller_opens_every_chart(agency)` is a boolean and `caller_assigned_patients(agency)` a set, because the answer is not one set: an administrator's charts live in the record store, a clinician's assignments in the authority store. Which tables carry the narrowing is derived — any carried entity with tenancy of its own and a top-level patient column, plus `Patient` — and the rest inherit it because `chartPredicate` is carried in at every hop of `tenantPredicate`. That last part is the defect this nearly shipped with: a reference predicate inlines the target's *tenant* check, so narrowing `Patient` alone left fifty-four tables agency-wide, every row of a chart the caller was never assigned to. The backfill (`tools-pennsync-assignment-backfill.mjs`) carries `assigned_nurses` across, and every judgement in it resolves ambiguity by dropping the row and naming it: an address resolves exactly or not at all, the membership must be in the patient's agency, and an assignment already recorded is never re-granted — including a revoked one, because `assigned_nurses` cannot tell "never assigned" from "access withdrawn". It could not have written a single row into `pennsync_private.assignment`: that table keys to `pennsync_private.patient`, which refuses a real name and refuses `synthetic = false`, so an assignment over it can only ever name a synthetic patient. The first fix dropped that key and was wrong — the key is one of four inbound RESTRICT keys `tools-pennsync-archive-import.mjs` pins by name so a rollback refuses while something clinical still references the patient, and all sixteen of its cases failed `IMPORT_SCHEMA_UNSAFE`. One table cannot key to two patient populations, so production gets a sibling: `20260920040000_chart_assignment.sql`, same shape and same provenance trigger, unkeyed on patient because a chart of record lives in a schema owned by another role. That failure passed lint, the whole suite, the build, the typecheck gate and all seven gates locally, because `test:pennsync-import:postgres` needs a real PostgreSQL and is not in `pnpm test`; `record-store-migration.test.mjs` now carries a PGlite equivalent of that guard, and reintroducing the bug fails it. The two halves are proved to meet against a real database rather than separately |
| Phase 2 — the roster | D23, built. `User` gets a `roster` tenant decision, a kind whose predicate does not read the row's tenant column at all: `caller_roster_ids()` asks the authority store's membership who the caller shares an active agency with, and the policy admits the row if it names one of those people. One select policy and no write policy, so forced RLS refuses every write from everyone including the record owner — D23 leaves the profile-write path open and a write policy would have settled it by accident. `20260920030000_contract_roster.sql` is the reviewed contract over it: the authority store's membership leads the join and the carried row contributes only what that store has no column for, so `agency_id`, `agency_name`, `role` and `account_type` are never projected from the row under any name, and `is_manager` and `is_approved` are derived from the authoritative tenant role. Personnel detail widens for an `agency_admin` or `manager` and is null, not absent, for everyone else. Every test row is seeded with a LYING label — each person's row claims the other agency — so a predicate or projection that consulted the carried copy would come out exactly backwards. Three defects were found by testing it: a revoked colleague stayed on the roster while the policy hid their profile row, producing a phantom with every field empty; a cursor naming somebody no longer on the roster silently truncated the walk, which is what a mid-walk revocation produces; and `caller_roster_ids()` was missing from the owner's `grant execute`, so every read through a broker would have failed with `permission denied for function` rather than returning no rows. The last is now checked by reading both sides out of the migration — which helpers the policies call, and which the grant names |
| Phase 2 — the general activity trail | D25. `20260920010000_activity_audit.sql` gives the record store the audit sink neither store had: append-only by absence — an insert policy and a read policy and no update or delete policy at all, so forced RLS refuses a rewrite from anyone, the record owner included. The actor is stamped from the caller helpers rather than supplied, so a capability cannot attribute an action to somebody else; appending needs only membership because every capability audits as it works, and reading requires `agency_admin`; the detail column is capped and an oversized payload is refused rather than truncated. `services/pennsync-api/audit.mjs` binds it as a fourth per-request capability alongside integrations, records and contracts — a facility rather than an endpoint, so it has no handler and is deliberately outside `record-contracts.mjs`, whose "every contract has a handler" invariant would otherwise become false. `activity-audit.test.mjs` proves the append-only property against the real migration including for the owner, and `audit.test.mjs` reads the codes and subject kinds out of the SQL so the module cannot drift from it |
| Phase 0 — the function-side broker ceiling | D18. D16 checked the `broker` disposition on entities against their schemas; the same disposition on a *function* claims more — that the capability can be retired and served by the generic family — and had never been checked. Now that D17 makes the family concrete, it is checkable, and all 33 fail: 32 reach an entity the family does not serve (`getDashboardData` reads every active patient and today's visits) and the 33rd touches no entity at all. All 33 move to `port`, the strictest disposition. Two access forms nearly defeated the check — namespace aliasing (`const sr = base44.asServiceRole.entities`) and destructuring — and a first pass without them reported six functions as staying inside the family when the real number is zero. The port queue grows 78 → 111, which is work that was already there counted under a disposition that said someone else would handle it generically |
| Phase 2 — the first reviewed contract | D19. `20260920000000_contract_policy_library.sql` is hand-written, unlike the two migrations before it: a contract exists because a capability's authorization is its own, so there is nothing to generate from. It is owned by `pennsync_records_owner` and SECURITY DEFINER, so the policies bind it exactly as they bind a broker, and it does the two things the generic family may not — returns `doc_url`, the locator that keeps `PolicyLibrary` out of the family, and decides about the CALLER (drafts and archived go only to an administrator), which no policy can express. It needed a new helper, `caller_tenant_role(agency)`, granted to the record owner alone. The service carries no authorization logic for it at all. The divergence is a narrowing and is recorded: Base44's platform admin saw every agency's drafts, an `agency_admin` sees only their own. Eight cases prove the refusals against the real migration, and two mutations confirm they are load-bearing. The records bucket moves by work for the first time: 94 → 93 |
| Phase 2 — the first clinical read | D26, built. `listAuthorizedPatients` and `getAuthorizedPatient` are the first ported capabilities that read clinical rows, and the first whose authorization has two independent halves: which ROWS, which the policies already decide (tenancy plus D24's chart narrowing), and which FIELDS and to whom, which no policy can express because it is a property of the request's stated purpose. The originals carry that second half as fenced blocks of declarations — sixteen field lists between them — so it is extracted rather than retyped: `tools-read-purpose-policy.mjs` evaluates the blocks and writes both `services/pennsync-api/read-purpose-policy.mjs` and `20260920050000_patient_purpose_policy.sql`, which carries no authorization at all. `20260920060000_contract_patient_read.sql` is hand-written as usual and is the only thing that decides. The two capabilities' purposes are deliberately kept apart, so a list caller cannot reach a single-chart projection by naming `smart_note_context`. Four divergences, all narrowings, all recorded: `platform_owner` is admitted by every purpose in the originals and by none here; creator provenance is not a basis, because D24 put the care team in one place and a creator predicate would have to be repeated in fifty-six reference policies; the continuation is an id re-checked against the current filter rather than a context echo; and a merged duplicate is skipped rather than failing the page. The original is 1,404 lines and the port is 278, because Base44 had no row-level security and had to re-resolve the caller's membership four times and run the whole read twice to catch an authority change in between — inside one statement in one snapshot there is no such window. Twelve cases prove it against the real migration. The records bucket moves by work again: 76 → 74 |
| Phase 2 — the visit read, and what documents need | D26's machinery generalised: `tools-read-purpose-policy.mjs` now carries six fenced policies across three domains, and `20260920070000_visit_purpose_policy.sql` plus `20260920080000_contract_visit_read.sql` port `listAuthorizedVisits` and `getAuthorizedVisit`. The visit pair is where D24's decision to narrow the chart ON the table rather than only through a reference shows: `visit` carries its own `agency_id` and a `patient_id`, and a visit whose subject is null stays agency-scoped, which a narrowing written only for the reference path would get wrong. The two visit capabilities also share three purpose NAMES — `schedule`, `documentation`, `compliance_review` — and mean different projections: one visit under `compliance_review` discloses fourteen fields, a row of a list eight, so each contract asks its own `_known` and a test fails if a list ever widens under a shared name. The document pair needed D27 first: `document` has no `agency_id`, so its tenancy reached through `patient_id` and a document bound to an agency and no patient was invisible to everyone, an agency administrator included. `BINDING_TENANCY` gives it a declared tenant kind that asks `document_tenant_binding` — checked against the schemas rather than trusted, and throwing rather than falling back — after which the pair ports on the same machinery. The records bucket moves by work again: 74 → 70 |
| Phase 2 — the document read, and what the `files` blocker was hiding | D27. Twelve policies change: `document`'s four now ask the binding and carry its D24 narrowing, including the null-patient branch, and the two tables that reference `Document` follow automatically because a reference predicate inlines its target's. A document with no binding is now in no tenant and belongs to nobody, which is what both originals already do — every document they serve is joined to one — so a write creates the binding first. `20260920100000_contract_document_read.sql` then ports `listAuthorizedDocuments` and `getAuthorizedDocument`. The finding worth carrying forward: **no document purpose discloses a file locator**, not even `download`, and the original refuses a document whose `file_url` is still set. This family was never behind the file layer; the `files` blocker would have said otherwise, and only reading the projections showed it |
| Phase 2 — what the first write turned up | D28. Starting the patient write family found a defect six ported reads could not show: `patient_insert` carried D24's chart predicate, and for the chart ROOT that predicate asks whether the row's own id is already in the caller's assignments — which it cannot be, because the row being inserted is the chart. Measured, not reasoned about: an `agency_admin` inserted and a `clinician` did not, while the Base44 original admits both. Exactly one policy changes; every other table keeps the narrowing on its write, because there the subject names a chart that already exists. `insert … returning` is where the remaining gap shows — it is a read of the row just written, so a clinician who creates a patient cannot read it back, and PostgreSQL reports that as a WITH CHECK violation even though the insert itself succeeded. Closing it means granting the care-team assignment as well, which is a write to `pennsync_private` rather than to the record store: grant first, then insert, because an assignment naming a patient that does not exist is inert while a chart its creator cannot open is not. The bridge is built: `20260920110000_claim_new_chart.sql` mints a chart identity and takes the caller's own care-team seat, taking an agency and nothing else — a caller who could name the id would name a chart that already exists. Minting also makes the collision check exact rather than probabilistic, because the function can read `pennsync_records.patient` to confirm the id is free. It is the first migration in the record directory that is a bridge rather than a record-store object, placed there by dependency order: it asks `caller_tenant_role`, and every authority migration applies first. Six cases prove it, including the loop a caller sees — claim, insert, and the creator opens the chart through `pennsync_contract_patient_get` while a colleague does not — and the half that makes the ordering safe, a grant with no patient behind it opening nothing. `20260920120000_contract_patient_create.sql` is its caller, and writing it corrected the design: the two ownership domains are two schemas in ONE database, so the claim and the insert are **one transaction** rather than two ordered writes. The bridge's public wrapper and `authenticated` grant went with that correction — a client that could claim without creating could only leave grants behind. A blanket revoke written to tidy up what `usage` exposes would have taken the entire staging surface with it, and was removed before it reached a commit. The 43 client-supplied fields are extracted from `CLIENT_PATIENT_FIELDS` by NAME, and the payload becomes a row through `jsonb_populate_record` rather than a column list to keep in step. Ten cases, including the atomicity one. Records bucket: 70 → 69 |
| Phase 3 — file prerequisite | `tools-file-reference-census.mjs` and its committed census of every schema field that can hold a file |
| Guardrail | `tools-base44-surface.mjs` ratchets remaining frontend coupling |

Not done here, and each blocked on something this branch cannot supply:

| Remaining | Blocked on |
| --- | --- |
| Deploying either Railway service; creating the production Supabase project | Creating the hosted project itself. The sequence that pins and migrates it is written and tested (`tools-pennsync-provision.mjs`), so what remains is the project existing |
| Enabling independent authority on the running runtime | A reviewed deployment plus preflight and two-agency acceptance with enrolled actors |
| Generalizing the authority store past four synthetic actors | The app-id pins and the enrollment tool are both done (above), so the mechanism exists and has nobody to run it on: enrolling anyone needs the ten people to accept their Supabase Auth invitations first, and an operator to verify each one out of band. What remains in source: the four actor IDs still pinned in `services/authority-client/client.mjs`, roster behaviour for the four tenant roles that can hold context but not use it, and the synthetic-name constraints, which still refuse a real agency or patient name in every deployment. The last of those is a compliance decision about whether this store ever holds real names, not a refactor |
| Reconciling the duplicated `validateMembershipRows` | Nothing external, and less than it looked. `validateAssignmentIntegrity` is settled: all twelve copies enforce the same authorization, and the five that bound in the caller now share one generated helper. `validateMembershipRows` genuinely diverged — 13 copies across 10 variants differing in signature, return type and checks — but the destination makes it largely moot, because `services/pennsync-api` holds no row-validation predicate at all: the owned store answers the same question transactionally inside `pennsync_private.context`. What is left is deciding, per ported broker, that the store's answer replaces the copy rather than joining it |
| Porting the remaining 100 handlers | **Nothing is left waiting on the record store, and nothing in the queue waits on a decision or a shared prerequisite.** D20 and D21 split the old `records_schema` bucket by what each module reads; D23, D24 and D25 answered all three questions that split produced, and all three are now built. What is left is one hundred ports and their reviews: **0** wait on the record store — D19's contract pattern, with `listPolicyLibrary` as the worked example, `listAgencyRoster` as the second, the authorized patient read as the first that moves clinical rows, `updateAuthorizedPatient` as the first that CHANGES one and `createAuthorizedVisit` as the first write to a second entity family; **8** need something a read policy cannot give them (6 write a profile, which D23 leaves open deliberately; 2 write a `global` reference table and need a platform ingestion path rather than a caller-facing handler); **7** read a table from a domain that is actually going away and need a disposition conversation; 12 wait on the file layer, 2 on a third-party key and 3 on `Core.SendEmail`, and **none on another port**. Seventy-two are written, five of them in part (`updateAuthorizedVisit`, `manageAgencyMembership` and `policyAcknowledgment`): D31 ports four of its nine actions and refuses the other five by name and reason, because one has no performer left after D14 and D22, three are server-to-server, and one is paused at source. The twenty-sixth is the odd one: `managePatientCareTeamAssignment`'s four mutations are themselves paused at source, and D33 RE-ENABLES them because the owned store meets the three conditions that pause names — a create-if-absent unique constraint, one transaction spanning membership, agency, chart and assignment, and an authenticated concurrency matrix proved with two real connections rather than asserted. It is also what makes D24 operable: until it, nothing could take a clinician off a care team. The twenty-seventh and twenty-eighth are the tenant-context pair, and they are the counter-example to the bucket's own name (D34): `records_schema` had come to mean "touches an entity", and these two touch only `AgencyMembership` and `Agency` — entities the AUTHORITY store has modelled natively since its first migration, so nothing in the record store was ever going to serve them. The twenty-ninth is `manageAgencyMembership` (D35), the write half of that same model and the second partial port: five of its six actions, with `provision` refused by name because its own guard reserves it to the platform owner D14 and D22 removed. The thirtieth is `policyAcknowledgment` (D36), whose `list` action is refused for the same reason and whose `acknowledge` action shows that tenancy is not ownership: the policies say a row is in the caller's agency, and only the contract says it is theirs. The thirty-first and thirty-second are the AI content agreement pair (D37), the FIRST port that audits anything: D25 built the activity trail and thirty ported capabilities went by without a caller for it, and this one writes the trail entry and the attestation that references it in ONE transaction — which is what replaces the original's four identity rechecks and two full readbacks. The next four are the whole time-off domain in one change (D38), ported together because they are one bug: each of the four answers the same authorization question by reading a different self-editable field of the carried `User` row, and membership answers all of it — so `getApprovedTimeOff`'s address-collection step disappears rather than being reimplemented. `submitPersonnelCredential` follows and is the thirty-seventh; its sibling `reviewPersonnelCredential` is the FIRST WHOLE capability with no performer left (D39) — its only gate is the built-in `role === 'admin'` — so it stays in the queue until somebody decides who may approve a credential, which the owner then answered: **D40** makes an `agency_admin`, scoped to their own agency, the successor to the built-in admin, unblocking five capabilities and standing as the FIRST deliberate widening in the migration. `reviewPersonnelCredential` is the first port made under it, and it carries the check the widening made necessary — the original's reviewer held no credentials in any agency, so self-approval was impossible by construction and now has to be refused explicitly. `auditDataQuality` is the second (D41), and it deletes its whole agency-scoping block rather than reimplementing it: the original rebuilt "which of these are mine" from `agency_name` strings, `created_by` addresses and `assigned_nurses` arrays, and its own comment records that the first version of that filter leaked one tenant's patient names into every other tenant's report. The invitation pair is the third and fourth (D42), served by ONE contract because the two originals are byte-identical apart from a comment naming the second the production replacement — and their send is not a paused delivery but a platform service with no successor, so the audit entry itself records `delivery_paused` rather than reading as though a message went out. The two agency configuration upserts follow (D43), and with them the pattern is named: THREE separate originals now carry, in their own comments, a bug that a derived scope caused and a policy cannot — the audit's cross-tenant leak, the invitation's inviter lookup, and a point config a platform admin silently overwrote. It is the most common defect this migration finds, and the fix is always to delete the reconstruction rather than port it. The incident pair is the forty-fourth and forty-fifth (D44), and it is where D40's widening first puts a REPORTER and a REVIEWER in the same person: the original's reviewer-only field set is a security control whose second leg was that a platform owner never reports an agency's incidents, so the contract adds the self-review refusal that leg used to make unnecessary. Its urgent-alert fan-out is ported rather than paused — the recipients are records, not a message, and they are the agency's `agency_admin` memberships rather than a five-thousand-row `User` scan over two self-editable labels, which is the fifth original whose comments document a derived-scope bug — and the alert names no patient, because `notification_read` is agency-wide while D24 narrows a chart to its care team. `manageMyNotifications` follows immediately (D45) and is the capability that PROVED the previous one wrong: its reader filters on six authority columns, the incident fan-out stamped three, and every urgent alert it wrote was therefore addressed to nobody — while both contracts' own suites passed. The guard is a cross-contract test, and the rule it establishes is that a capability which writes a row another capability reads is not proved by either suite alone. Its authority envelope also draws the line the derived-scope pattern needs: a derived scope asks a self-editable field who the caller is, while an envelope records which membership, at which version, a row was minted for — so that one is kept while the revalidation machinery built around it goes. `manageVehicleMaintenance` is the forty-seventh (D46) and the first port where part of the capability needed no SQL at all: two of its eight actions are the tenant-context and roster contracts already, which generalises D34's rule into an instruction — check which store already models what the original reads. It is also the first port over a D32 append-only entity, and the place where the original's creation-claim reservation protocol becomes the row lock it was emulating. Then a CORRECTION rather than a port (D47): the paused-at-source check looked for a `const FLAG = false` and nine handlers pause with no flag at all — the refusal is the first statement of the handler, with the real body unreachable below it — so six capabilities carried `port` were counted as writable work while refusing every caller. That is the same failure the flag check was written to fix, in a shape nobody re-measured, and it is why the number falls by four here without a line of the product moving. `createNotification` is the forty-eighth (D48) and closes the notification pair: the authority envelope moves into a FACILITY both it and the incident fan-out call, so there is one place left to get it wrong rather than two, and the recipient's in-app preference moves to the reader because `notification_preference_read` is `user_email = caller_email()` and the sender cannot ask at all — where a check belongs is decided by which session can evaluate it. `checkExpiredInvitations` is the forty-ninth (D49) and is the first to reach a gate D40 cannot answer: its human path is the built-in admin, but its MACHINE path is a shared secret over every tenant, and nothing in this store is cross-tenant because nothing holds BYPASSRLS. The per-agency half is ported; who runs it unattended is an open decision naming three shapes, of which only a real per-agency identity contradicts nothing already settled. It governs four capabilities. Two of them follow immediately (D50) — the credential expiration and renewal sweeps — and they stay TWO contracts over one shared body because the renewal original records why: three crons once shared a marker column with different tier sets, and whichever fired a shared tier first consumed it for the others. Both delete a row limit that existed only to survive a paged client, which is the second time in two ports. `checkAdrDeadlines` is the last of D49's four (D51) and the only one with nothing paused, because its reminder is a row rather than an email — which also makes it the evidence for the notification facility: the original stamps none of the six authority columns its own reader filters on, so an ADR deadline reminder is shown to nobody in Base44 today. Of D49's four, three are now ported and only the unattended run remains open. The timesheet pair follows (D52) and is the largest port so far, though mostly a matter of KEEPING what its originals already got right — the pay line, the points, the carried PTO and the reimbursement are all server-authoritative there too. Its one real deletion is D43's bug from the other side: the original adopts the newest point config in the deployment when the caller's agency has none, which is one agency's schedule paying another's nurses. `triageReferralWithAI` is the fifty-fifth (D53) and answers the last open question about the remaining queue: eleven of the capabilities left call a brokered model AND touch records, and the worry was that they needed an orchestration nothing had built. They do not — `InvokeLLM` is already brokered and the handler already receives `integration` and `audit`, so what was missing was a worked example rather than a mechanism. It also settles where `audit_recorded` belongs: wherever a transaction does not. `syncCMSRegulations` follows it (D54) and is the first whose write is a RECORD contract rather than a trail append, which is where that pattern meets a real table: the columns constrain what a model may supply, so an unrecognised answer is treated as an absent one and the substitution is counted, rather than raising a check violation the original swallows row by row. Then a SECOND correction (D55): four capabilities whose only entity is one of D25's three retired log tables were counted against the record store, when the trail IS their record half and what they wait on is the file layer, a send or a third-party key. That is D47's rule from the other side — a bucket keeps its name after the reason for it has gone. D56 applies the same rule to the two blockers that name the most capabilities: the file adapter is BUILT and acceptance-tested, so the fifteen file-bound capabilities wait on Phase 3's data migration and compatibility layer rather than on a path to write; and the service's `BROKERED_OPERATIONS` is a per-port ratchet rather than an inventory, so the paused email halves wait on an owner's decision to broker `SendEmail` — which the runtime already implements — rather than on a capability to build. `predictSupplyNeeds` is the fifty-seventh (D57) and is a port whose interesting half is the TEST: almost the whole capability is arithmetic, so its suite lifts the block out of the original's own handler and runs it rather than asserting numbers somebody retyped — the general form of D38's business-day parity, for a handler that keeps every line inline in `Deno.serve`. It also carries the counterpart to D36: the original's comment says "Need at least 2 data points" and its code counts LOG ROWS while the `data_points` it reports counts distinct MONTHS, so porting the comment would have silently stopped producing predictions the product produces today. `analyzeVisitForSupplyUsage` closes the supply domain (D58) and is the FOURTH capability caught writing a row nobody can read: its reorder task names no patient, and both that task and the low-stock alert pointing at it reach tenancy only through a chart, so the pair lands in no tenant — including for the clinician the original assigns it to. It also deletes three compensations for having no transaction in one port, and it is the counter-case to D57's request-shape rename, because this one has a live call site in the SPA that both backends share. `importProvidersCsv` is the fifty-ninth (D59) and the fourth PARTIAL port, the first to split on an input source rather than an action: only its legacy `file_url` branch reaches the file layer, so the branch the SPA actually calls ships now and the other is refused by name. Its duplicate map is the derived scan D41 and D43 delete, in its writing form — built from every provider in the deployment and then used to update whatever it matched, across tenants. Then a third CORRECTION, and the widest (D61): thirteen carried entities reached tenancy only through a column their own schema does not REQUIRE, so any row with a null there was in no tenant and readable by nobody — not the care team, not the agency's administrator. Three had already produced real defects found one at a time. The derivation now resolves a reference only through a required column, the twelve that stopped resolving are decided `agency`, and D24 gives the eleven with a `patient_id` the predicate `Referral` already had. `expandClinicalPhrase` is the sixtieth (D62) and the port that correction was written for: its template library was unreadable, and with the tenancy fixed both of its five-thousand-row agency scans delete. It also adds a disclosure rule — a template row may not put a patient field in front of a caller that no read purpose would give them, so its `patient_data_fields` selects from `smart_note_context`'s own projection and an outside field is refused by name. `generateFollowUpTasks` is the sixty-first (D63) and the second capability D61 unblocked. It deletes a `SUPER_ADMIN_EMAIL` environment read — the only reason it was ever near a secret — and refines D54: where a model supplies a constrained column, the row's date must follow the value that is stored, because the original's case-sensitive lookup writes a task that says "today" and is due in three days. `analyzeClinicalEvents` and `analyzeClinicalTrends` are the sixty-second and sixty-third (D64) and the first ports with no write behind the model call at all — the third step of D53's sequence absent rather than paused, which is the reading three earlier corrections each had to fix once. Their rule is that every column reaching a prompt is NAMED, because `clinical_event` carries the raw note text an event was extracted from. Then a FOURTH correction (D65), found by starting a port that could not be written: the classifier returned `records_schema` for a module that touches entities and also reaches the file layer, and its own comment said the order was right because such a capability "waits on the chart first" — true when it was written, false once the store was built and a chart read became a repeatable shape. Six capabilities move to `files`, which is now the largest blocker in the queue by a wide margin and says plainly what the next piece of infrastructure is. `analyzeAndGenerateClinicalTasks` is the sixty-fourth (D66) and the case D64 was written for: its name says generate and it creates no task. It also deletes two honest defences against a service-role filter that is not proof — a patient lookup asking for two rows so it can refuse ambiguity, and a re-check that the rows it loaded name the patient it asked for — neither of which a primary key and the contract's own predicate leave anything to do. `extractClinicalEvents` is the sixty-fifth (D67) and finds a defect in one line: the original spreads every key a MODEL returned into its `ClinicalEvent.create`, so an answer carrying `verified: true` sets the field a nurse's fact-check is supposed to set. The ten fields its own response schema declares are stored and the rest ignored. `manageAuthorizedReferral` is the sixty-sixth (D68) and the largest capability in the migration, ported as one contract where roughly two thirds of its 1,275 lines are compensations the owned store removes — the membership lifecycle re-validation for the fourth time, the two-to-four authority snapshots per request, the double-read-and-compare disclosure checks and the compensating DELETE after a failed create, the N+1 scan limits, and the per-row re-derivation of the creation key. One of those deletions needs reading twice and is the rule worth carrying: the original's `where version = <what I just read>` LOOKS like optimistic concurrency and is not, because the client sends no version — while `updateFleetVehicle` and `contract_patient_update` take an expectation FROM THE CALLER and both ports keep it. Its `list_assignees` needed no SQL beyond a filter over D48's roster facility, its two role gates are deliberately different sets, and D24 narrows it in a way recorded rather than worked around: `office_staff` is the role whose job this is and opens no chart, so it sees a referral until the referral names a patient. The port also INTRODUCED a defect and the finding is the general one: `manageAuthorizedReferral` is the only Base44 name in the tree carrying two capabilities — the real broker and the synthetic `staging_*` flow — and the staging adapter routes to the ported service by NAME, so adding it shadowed every staging action. The action decides now, and the regression test asserts the refusal CODE because the broken path also made no request. `generateUserRosterPDF` is the sixty-seventh (D69) and reverses D36's polarity: its gate reads three ways in and has one, because the shared `withTrustedClaims` strips a claimed `agency_admin` or `super_admin` back to `'user'` unless a canonical active membership says otherwise — so the `super_admin` branch is dead code, the `role === 'admin'` branch is the removed platform tier, and what is left is an `agency_admin`, which is not one of D40's widenings. Its contract is the first that DELEGATES rather than copies, inheriting two refusal codes from the roster it calls, and its document drops the original's Name column because the carried `user` table has no name field and an Email column sits right beside it. `generatePatientChartPDF` is the sixty-eighth (D70) and the clearest case of a rule the migration keeps meeting: its ENTIRE gate is made of things earlier decisions removed — `patient.created_by`, an `assigned_nurses` entry and the `SUPER_ADMIN_EMAIL` owner — so the port adds no gate and the chart policies answer, which is narrower where it matters because a revoked nurse's address no longer qualifies. Its projection is the widest in the application, so D64's naming rule earns its keep; and three things about the original are recorded rather than fixed, including that it renders no PDF despite its name and has no caller in `src/` at all. `searchPDFs` is the sixty-ninth (D71) and the case that makes D67's split concrete: the corpus a caller may read is decided in SQL and BM25 over their query is arithmetic in the service. It deletes a scope whose own comment explains it away — the original restricts an unscoped search to rows the caller CREATED because it "cannot safely infer PDFIndex ownership from the mutable patient_id relationship", and D61 plus D24 make that relationship trustworthy, so a clinician gains their team's charts' documents and loses rows they created for a chart they have been taken off. Its two remaining bounds are disclosure controls rather than paging, and its scorer's parity imports the original's own block and runs both over one corpus. `getDashboardData` is the seventieth (D72) and the port that had been PARKED: its five collections come back as whole entity rows and two of those entities have no extracted read purpose to name columns from, so a projection looked like an invention. It is not one when it is MEASURED — the dashboard's four consuming widgets name every field they read, and the test re-derives the projection from their source so a widget reading a new column fails the build. That derivation found three defects live in the product: `patient.risk_level`, `patient.hospitalization_risk` and `visit.note_id` exist nowhere, so one dashboard priority can never fire and another counts every completed visit rather than the undocumented ones. `submitStateReportableIncident` is the seventy-first (D73), the fifth PARTIAL port and a SIBLING of the ordinary incident submit rather than an argument to it: D44 keeps `severity` and `state_reportable` off a submit because they are the inputs to the resolve gate, so this endpoint sets both itself — a field a reviewer decides is not made a caller's by adding an endpoint that wants it set. Its PDF retention waits on the file layer and its email on D56, and both are REPORTED as paused in the answer and in the incident's own details so the compliance record cannot read as though either happened; the notification fan-out ships because a notification is a row, and it names no patient — which matters most here, since the original's message carries the patient's name into an agency-wide reader. Then a FIFTH correction (D74), the shortest of the five: a capability whose entire entity reach is the generated `trustedCallerClaims` helper reads AUTHORIZATION rather than records — those two entities answer what tenant role a caller holds, and D34 settled that they are the authority store's native model — so the record store has nothing to give it. It fires on one queue entry, `sendAccountReadyEmail`, whose whole body is a single `Core.SendEmail`, so "startable today" had been counting a capability with no record work at all. The classifier had already computed the right answer and was discarding it. And a SIXTH (D75) takes the record-store bucket to ZERO. The paused-at-source check knew two shapes and the tree uses three: `const X_PAUSED = true` with `if (X_PAUSED) return refusal` is the same pause written the other way round, thirteen modules use it, and the check detected none. Twelve already carried `preserved_paused` because somebody had read them; the thirteenth, `processCompletedVisit`, carried `port` and was the LAST entry reported as startable against the record store while refusing every caller. So the number reached zero on a correction rather than a port — three shapes now, and three times the same lesson. Then D77 builds the two halves of D56's file work this repository can hold — the `file_url` -> `cmfile:` mapping with its resolver, and the copy PLANNER — and its measurement changes the scope: the census lists 66 locator fields across 58 entities and only 34 across 27 are on entities with a table here, because the rest are `preserved_paused`, `hub` or `retire` and have no row to re-point. An inventory is complete and a rewrite is not, so the planner reports both and refuses to merge them. The mapping fails closed, is immutable, and is reached only by a definer the record owner may call, because a locator is projected by the contract that authorizes the row holding it. What the twelve file-bound capabilities wait on now is DATA — a live app and a live bucket — rather than design. Then a SEVENTH (D76), and the first that ends a WAIT rather than renaming one: `ported_function` means "calls another Base44 function, so it waits on that one", and the queue reported that wait for sixty-eight ports after D68 wrote the thing being waited for, because the rule is one unconditional return on the SHAPE of the call and nothing asked who the callee was. The discovery it needed fails closed — every reach is counted, two shapes are parsed, and an unparsed one leaves the set unenumerable and the capability waiting. The capability it was holding, `extractReferralDataForSmartNote`, turned out to be written already apart from its registry entry: its transform was parity-pinned long ago and a test asserted the handler's ABSENCE with the reason in its own words, so the guard outlived its reason exactly as the bucket did. Porting it deleted the CROSS-CALL form of D68's compensations and found a hole in D68's own suite — a refusal this handler depends on had no test on the side that raises it. The queue checks for D23's and D24's prerequisites by looking at the files, so deleting either puts its capabilities back |
| Applying the record store to a real deployment | D15 commits the migration that creates it, under an owner row level security binds; what remains is the production Supabase project for it to be applied to |
| Migrating the existing call sites to the ported handlers | **The caller is built and inert until this is done, which review caught and is worth stating plainly.** `createStagingAuthorityClient` exposes `callFunction`, pinned to the ported API's origin and fenced by the same lease as `rpc`, and the staging adapter routes the eleven ported names through both `invoke` and `fetch` when `VITE_PENNSYNC_API_URL` is set. It lives on the authority client because the access token never leaves that closure. What remains is per call site and is a review rather than a swap: the ported service requires an `agency_id` its Base44 original did not, and **no existing call site sends one** — `ReferralIntake.jsx`, `src/functions/listPolicyLibrary.js`, `UserGuides.jsx` and `Help.jsx` all invoke without a tenant, so setting the variable today makes those flows refuse rather than work. The adapter refuses rather than choosing a tenant on the caller's behalf, which is the point. Also still needed: a deployed service to point it at |
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
says 111 functions are carried as `port`; it does not say any of them can be
written. `pnpm run check:transition-disposition` classifies each one by its
blocker, read from the module rather than guessed from the feature:

| Blocker | Functions | What has to exist first |
| --- | ---: | --- |
| `entity_authorization` | 10 | Built for 33 of the original 43; these are what a read policy does not help. Eight UPDATE a profile, which D23 deliberately leaves open. Two write `MedicareGuideline`, a `global` reference table no tenant surface may write — they need a platform ingestion path, not a caller-facing handler |
| `patient_access_model` | 0 | Emptied by D24 being built, not by the dependency going away. These capabilities still authorize on care-team membership; the store can answer them now. Previously: both halves of D24 — a caller helper the record policies can ask, granted to the record owner alone exactly as `caller_tenant_role` is, **and** a reviewed backfill from `Patient.assigned_nurses` into `pennsync_private.assignment`. Porting one of these on the helper alone means every clinician loses access to their own patients at cutover |
| `records_schema` | 0 | Emptied by D75. Nothing that is not committed. The store migration and the broker family exist; each of these needs its own reviewed contract on D19's pattern. This is the tier to start |
| `entity_not_carried` | 7 | Nothing — these read training records, paused comms logs and real-time metrics, from domains that are going away. Each needs a disposition conversation, not a schema |
| `files` | 12 | The COPY, after D77. The mapping, its resolver and the planner are built; copying the bytes needs a live app and a live bucket. Porting one verbatim carries Base44's storage host into the service |
| `ported_function` | 0 | Emptied by D76. `extractReferralDataForSmartNote` waited on `manageAuthorizedReferral`, D68 wrote it, and the queue went on reporting the wait because the rule asked the shape of the call rather than who the callee was |
| `core_integration` | 1 | `sendWelcomeEmail` sends through `Core.SendEmail`, which is not in the runtime's brokered set |
| `pdf_rendering` | 0 | Emptied by D12. All four document functions are written |
| `external_secret` | 1 | `transcribeAndGenerateSOAPNote` takes recorded patient audio, transcribes it with OpenAI and reasons over it with Anthropic, using keys from the environment. It belongs to the integration runtime's brokered path rather than to a handler — and that path does not yet reach it: the runtime brokers a closed set of seven operations (`InvokeLLM`, `ExtractDataFromUploadedFile`, `GenerateImage`, `SendEmail`, `UploadFile`, `UploadPrivateFile`, `CreateFileSignedUrl`), enforced by a CHECK on `cm_integration_jobs.operation`, and audio transcription is not among them. Carrying it means a new brokered operation with the same reservation, daily quota, encrypted result and audit the others have, for a payload that is PHI. That is a capability to design, not a key to move |
| `none` | 11 | Written |

Read that as the schedule. The earlier reading of this table — "nothing in the
port queue starts before the record store does" — was true of a queue that said
`records_schema=80`, and that number was an artefact of counting any entity
access as waiting on the store. Two pieces of shared source now stand in front
of two thirds of the queue, and both are ordinary work with a test rather than a
decision: the roster RPC unblocks 43 and the assignment helper plus its backfill
unblock 23. The 20 in `records_schema` are behind neither and should be written
while those are built.

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
