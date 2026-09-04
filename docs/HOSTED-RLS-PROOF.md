# Hosted RLS proof worksheet (executable)

> **This document does not prove tenant isolation by itself.** Repository
> `rls` blocks in `base44/entities/*.jsonc` are declarations for the Base44
> dashboard. Client filters and role checks are UX only. Proof requires raw
> network evidence against a **hosted** staging (or pilot) app.
>
> Do **not** mark LR-01 complete, claim “HIPAA-ready isolation,” or ship
> multi-tenant production traffic until every gate below has real evidence
> (no placeholders, no PHI in committed files).

**Companions:** `docs/SECURITY-RLS-CHECKLIST.md` §7, `docs/RLS-LAUNCH-RUNBOOK.md` §5,
`docs/audits/LIVE_READINESS_CHECKLIST_LR01_LR02.md`, evidence template
`docs/audits/live-readiness-evidence.template.json`.

---

## 0. What “proof” means

| Artifact | Counts as proof? |
|---|---|
| Entity `.jsonc` `rls` blocks + `phase0Contract` / `securityGuardrails` tests | **No** — schema contract only |
| UI screenshots showing empty lists | **No** — UI filters client-side |
| Raw HTTP responses (devtools / curl / HAR) showing empty or 403 for denied ids | **Yes** |
| Two-agency cross-tenant probe (Agency A token cannot read Agency B rows) | **Yes** (required when multi-tenant) |
| Filled LR-01 evidence packet + reviewer approvals via `pnpm run readiness:report` | **Yes** (release gate) |

---

## 1. Seed matrix (staging only)

Provision **non-production** users and patients. Never use real PHI.

**Authority invariant:** the sole platform owner has Base44 built-in
`User.role === "admin"` and an exact match to backend `SUPER_ADMIN_EMAIL`.
The platform owner is setup/recovery authority only and is excluded from every
tenant-isolation assertion. Every tenant actor has built-in `User.role ===
"user"` plus one valid, active, server-owned `AgencyMembership` bound to the
immutable Base44 `user_id`; tenant authorization never comes from mutable User
profile fields, `account_type`, `agency_*`, `staff_role`,
`Patient.assigned_nurses`, or built-in role alone.

| Actor | Agency | Built-in role | Authoritative membership | Patient scope |
|---|---|---|---|---|
| Platform-Owner | none | `admin` | exact `SUPER_ADMIN_EMAIL`; no tenant membership used | excluded from tenant assertions |
| Admin-A | Agency A | `user` | active `agency_admin` | agency-wide through reviewed brokers |
| Clinician-A | Agency A | `user` | active `clinician` | A1 through one active, server-owned `PatientCareTeamAssignment` |
| Clinician-A-empty | Agency A | `user` | active `clinician` | none |
| Admin-B | Agency B | `user` | active `agency_admin` | agency-wide through reviewed brokers |

| Patient | Server-owned agency | Assignment |
|---|---|---|
| A1 | Agency A | assigned only to Clinician-A |
| A2 | Agency A | unassigned; no active care-team assignment |
| B1 | Agency B | foreign to every Agency A actor |

Record app id, backend origin, and user emails in the **private** evidence file
(`tmp/live-readiness-evidence.json` — gitignored). Do not commit tokens.

---

## 2. Capture tokens (browser or API)

After each actor signs in, copy the bearer token from Application → Local Storage
`base44_access_token`, or from the login response `access_token`.

```bash
# Example env for curl probes (export locally; never commit)
export B44_ORIGIN="https://<backend-host>"   # VITE_BASE44_BACKEND_URL origin
export B44_APP_ID="<app-id>"
export TOKEN_CLINICIAN_A="<clinician-a-access-token>"
export TOKEN_CLINICIAN_EMPTY="<clinician-empty-access-token>"
export TOKEN_ADMIN_A="<admin-a-access-token>"
export TOKEN_ADMIN_B="<admin-b-access-token>"   # multi-tenant only
export PATIENT_A1_ID="<id>"
export PATIENT_A2_ID="<id>"
export PATIENT_B1_ID="<id>"
```

Positive LR-01 reads must use only reviewed authenticated brokers:
`getMyTenantContext`, `listAuthorizedPatients`, `getAuthorizedPatient`, and
reviewed patient-child brokers. Capture their raw network requests and
responses. Never use a direct entity list/get response as positive tenant
evidence. A tenant actor receiving PHI or authority rows directly from an
entity endpoint is an LR-01 failure.

---

## 3. Intra-agency gates (must pass)

Run against **response bodies**, not the UI.

| # | Probe | Expect |
|---|---|---|
| P1 | Clinician-A-empty: `getMyTenantContext`, then `listAuthorizedPatients` | context is built-in `user` + active Agency A `clinician`; roster is empty |
| P2 | Clinician-A: `getAuthorizedPatient` for A1, A2, and B1 | A1 succeeds; A2 and B1 return `403` / `404` / empty |
| P3 | Admin-A: `listAuthorizedPatients` | contains A1 and A2; excludes B1 |
| P4 | Clinician-A: reviewed Visit / OASIS / Document child brokers | expose A1 only; if any broker is unavailable, LR-01 remains blocked |
| P5 | Clinician-A: spoof Agency B or B1 identifiers across reviewed brokers | `403` / `404` / empty |
| P6 | Direct non-admin forge of `TrainingCompletion` / `issueCertificate` | rejected when lockdown active |

Save redacted HAR or status+body snippets under private storage; put **references
only** in the LR-01 `test_evidence.references` array.

---

## 4. Cross-tenant gates (multi-agency apps)

| # | Probe | Expect |
|---|---|---|
| T1 | Admin-A `listAuthorizedPatients` | A1 and A2 only; no Agency B patients |
| T2 | Admin-B `listAuthorizedPatients` | B1 only; no Agency A patients |
| T3 | Admin-A `getAuthorizedPatient` with B1 | `403`/`404`/empty — never 200 with B PHI |
| T4 | Service-role / scheduled jobs only touch intended agency scope (spot-check logs) | |

If the product is single-agency per Base44 app, document that architecture in
LR-01 `hosted_environment.summary` and mark T1–T4 N/A with rationale — still
complete P1–P6.

---

## 5. Relation / byPatient rules

Field-owner RLS alone is **not** enough for shared clinical charts. Confirm
dashboard relation rules (or server-scoped functions) from
`docs/RLS-REMEDIATION-SPEC-2026-06-19.md`:

- Clinician with an active immutable assignment sees colleague rows for that patient.
- Clinician without that assignment sees none.
- Tenant admin sees only the intended agency-wide scope through reviewed brokers.

---

## 5b. Bare `role:admin` is platform-owner-only, never tenant authority

The entity DSL in `base44/entities/*.jsonc` cannot prove immutable
`AgencyMembership` or care-team authority across entities. The built-in
`role:admin` is reserved for the exact protected platform owner. Any tenant
fixture carrying built-in `admin` is a configuration failure, not an agency
administrator.

Consequences that remain until the **hosted** Base44 dashboard gains richer
rules (or each app is single-tenant):

| Pattern in `.jsonc` | Effective scope today |
|---|---|
| `user_condition: { role: "admin" }` | Protected platform-owner path only; tenant actors must never receive this role |
| `data.agency_id: "{{user.agency_id}}"` (etc.) | Tenant-scoped **only after** both sides are server-owned and backfilled; current custom User tenant fields are self-editable and are not authority |
| `account_type: "super_admin"` / `"agency_admin"` arms | Prohibited by the repository contract because these custom User fields are mutable |

**Do not** “fix” this by scoping admin-only entities with a lone
`agency_name: "{{user.agency_name}}"` arm — that would let any nurse in the
agency through RLS. Keep service-role + function gates
(`assertPatientAccess`, agency email sets) as the real multi-tenant boundary
until hosted relation/`$and` rules exist. `User.agency_name` is declared in
schema for honesty with runtime fields; it is not a substitute for hosted RLS.

Probe T1–T3 with Admin-A and Admin-B as built-in `user` identities carrying
active, server-owned `agency_admin` memberships. Every positive PHI read must
flow through a reviewed broker; any tenant actor reading PHI or authority rows
directly from an entity endpoint fails LR-01.

---

## 5c. What the client-side scope helpers do and do not guarantee

`src/lib/agencyScope.js` narrows rosters in the SPA. It is **defense in depth,
not the boundary** — the rows have already reached the browser by the time it
runs. Everything in §5b about service-role + function gates still stands.

`User` carries custom `agency_id` / `agency_name` fields, but they are not an
authorization source. `Patient` now carries an optional `agency_id` for the
future server-stamped tenant model; legacy rows are deliberately unbackfilled
and unscoped until an audited migration can assign them without guessing. The
interim browser helper resolves display scope from explicit chart fields or the
`created_by` / `assigned_nurses` roster only as defense in depth.

**Unattributable charts remain visible.** Absence of attribution is not
evidence of another tenant, and hiding a chart from the clinician who needs it
is the worse failure in a clinical record system. Any rule that hides them is
destructive on a deployment whose charts predate agency tagging: an importer or
service account leaves every row unattributable, so a strict rule empties the
roster the instant the first `agency_name` is assigned.

Before enabling multi-tenancy, in this order:

1. Make `Patient.agency_id` server-owned at every creation/import boundary.
2. Backfill it on existing charts. `describePatientAgencyScope` reports the
   outstanding count, surfaced on the admin Data Quality dashboard.
3. Only then populate `User.agency_name` / `agency_id`. Doing this before the
   backfill is the outage.

Staff-keyed rows — timesheets, payroll profiles, anything carrying an employee
email — go through `filterRowsByStaffAgency()`. It shares the fail-closed rules
above by construction, which is why it exists: three payroll queries previously
re-derived the scoped check inline and returned the **unfiltered** rows whenever
it came out false. That is correct for a platform admin, but the same branch
catches an `agency_admin` whose `agency_name` is blank — the one caller that has
to fail closed. Those saw every agency's timesheets and pay rates.

Read the roster through `useScopedPatients()` (`src/hooks/useScopedPatients.js`),
or `scopePatientsToCallerAgency()` / `scopePatientsForCurrentCaller()` when the
read is imperative. Contract tests in `src/queryKeyContract.test.js` enforce it:

1. **Every cross-chart patient read is scoped.** Covers `Patient.list(…)` and
   `Patient.filter({ … })` alike. A read pinned to specific ids, or to the
   caller via `assigned_nurses`, is already narrow and exempt.
2. **Every agency-scoped query carries `agencyQueryKey(currentUser)`** in its
   cache key. React Query keys on the value, so a scoped result set keyed
   without the agency lets two admins in different agencies share one entry.
3. **Every patient roster query is rooted at `['patients', …]`**, the key that
   patient create / merge / delete invalidate. Prefix matching is per array
   element, so `['allPatients', …]` was never reached.
4. **The agency-scoped check has exactly one implementation.** Any file
   re-deriving `account_type !== 'super_admin' && agency && (agency_admin ||
   role === 'admin')` inline fails the build; call `isCallerAgencyScoped()`.
   Every copy has to remember the fail-closed case independently, and the ones
   that forgot leaked payroll data.
5. **Roster selectors are stable references.** React Query memoizes `select` by
   identity, so an inline arrow re-filters the whole roster on every render
   (up to 10,000 rows here). Use a shared selector from the hook module, or
   `useCallback`/`useMemo` when it closes over props or state.

Note that `src/components/offline/OfflineManager.jsx` mirrors the roster into
IndexedDB. That read must stay scoped: it is the roster every offline fallback
in the app serves when the network is gone, and an unscoped mirror would persist
another tenant's charts to disk past the end of the session.

### Clinical records: `filterRecordsByAuthorAgency`, not the staff rule

`Visit`, `Incident`, `PatientAlert`, `Document`, `OASISAssessment` and
`CarePlan` all declare the same bare `user_condition: { role: "admin" }` read
arm, platform-wide per §5b — so a facility admin listing `Visit` gets other
tenants' nurse notes, vitals and homebound justifications. They are read through
`useAgencyScopedQuery()` (`src/hooks/useAgencyScopedQuery.js`), which applies
`filterRecordsByAuthorAgency()`.

That is a **different rule from `filterRowsByStaffAgency()`**, and the
difference matters. The staff rule drops any row whose owner is not a current
staff member — right for a timesheet, which must belong to a current employee.
Clinical records get the patient rule instead: only a record positively
attributed to another agency is hidden, and one whose author has left stays
visible. On live data 17 of 198 visits were authored by a nurse no longer on the
roster; the strict rule would delete their charting from every clinical view.

Two mechanical hazards, both now covered by contract tests:

- `useAgencyScopedQuery` **appends** the agency to the key it is given, so an
  optimistic `setQueryData(['x'], …)` written against the bare key lands on an
  entry nothing reads. `invalidateQueries` is fine — it prefix-matches.
- A read already pinned to one chart, one record, or the caller is narrower than
  agency and is exempt; scoping it again only risks hiding rows.

#### Two limits of filtering on the client, which only server-side tenancy fixes

**1. The row limit is applied before the filter.** `fetch()` asks the server for
the newest N rows and the agency filter runs on what comes back, so a scoped
caller can get a short page — or an empty one. `Incidents.jsx` reads 10 rows: if
another tenant owns the newest 10, that caller sees no incidents even though
their agency has older ones. The 50–1000 row reporting queries truncate the same
way, just less visibly. There is no client-side fix; paginating until N scoped
rows accumulate is unbounded work against an unknown foreign:local ratio. The
fix is to put the tenant predicate in the query, which needs the agency
attribute below.

**2. Service-created records stay visible to every agency.** Backend functions
create clinical rows through `asServiceRole` with a `patient_id` but no
resolvable author — `generateCarePlansFromReferral` (CarePlan) and
`predictPatientRisks` (PatientAlert) both do. Those land in *unattributable* and
are therefore kept, by design, so they cannot vanish from the chart they belong
to. The stronger rule is to derive tenancy from the record's chart
(`patient_id` → patient → agency) rather than its author, since a care plan
belongs to the chart it hangs off. That is worth doing **with** the schema work,
not before it: today it would make every clinical query fetch the whole patient
roster to resolve ids, and still resolve to *unattributable*, because no patient
carries agency attribution either.

Both are properties of filtering after the fact, which is why §5b's position
stands: this layer is defense in depth, and the boundary is server-side.

**`Message` is deliberately participant-scoped.** Its read policy uses
`created_by` ∨ `data.sender_email` ∨ `data.recipients.$in` with no global admin
arm. Direct create/update/delete are denied. New sends and atomic mark-read
updates go through authenticated service functions that derive sender identity,
validate the exact patient/referral/document/thread participants, and never use
custom agency or account claims as authority. Hosted two-user and two-agency
negative proofs are still required before production.

## 5d. Isolated anonymous-policy proof (updated 2026-09-03)

Against nonproduction app `6a9881683dc68a0bd54f1ef7`, after the complete
236-schema push:

- all 58 shaped anonymous POST probes returned HTTP 403, including the prior
  51-entity cohort and newly fail-closed CertificatePacketCache, PDGMCaseMix,
  SkillBadge, SupplyItem, SupplyLowStockAlert, SupplyPrediction, and
  SupplyUsageLog;
- all 58 anonymous list requests returned HTTP 200 with an empty array; and
- privileged connector queries reported `count: 0` for all 58 entities, so no
  probe row was created.

Anonymous hosted calls to `generateAndCacheCertificatePacket` and
`cleanupExpiredCertificateCache` return HTTP 401 and 403. Private cached-file
references are therefore available only after the function's server-side
authorization; self-editable `account_type` and agency profile fields cannot
grant cross-user packet access or a platform-wide cleanup sweep.

This is real hosted negative evidence for anonymous access. It is not LR-01:
the authenticated multi-user/multi-agency matrix in sections 1–4 still needs
separate test identities and tokens.

## 5e. Isolated service-role bypass proof (updated 2026-09-03)

The application also relies on authenticated backend functions using
`base44.asServiceRole.entities` to broker entities whose four direct RLS rules
are `false`. That positive path was tested in the same nonproduction app with a
temporary function using the repository's deployed SDK version (`0.8.31`) and
a random, staging-only secret.

Against `SupplyPrediction` (direct create/read/update/delete all denied), the
hosted function successfully performed an exact create, read, update, and
delete through `asServiceRole`. Its final response was:

```json
{"success":true,"entity":"SupplyPrediction","rls":"all operations false","operations":["create","read","update","delete"],"residue":0}
```

The transient record was deleted, then the temporary function and secret were
removed. A subsequent hosted function inventory contained no verification
function, `secrets list` reported no configured secret, and a privileged entity
query found no residue. This is positive evidence that the exact hosted SDK can
broker an all-false entity in this staging app; it does not prove that any
particular broker has correct tenant authorization. Those brokers still require
the authenticated actor matrix in sections 1–4.

## 5f. Tenant/outcome/training staging checkpoint (updated 2026-09-03)

Before the second schema push, an exact local/hosted name comparison reported
236 hosted schemas, 238 local schemas, no hosted-only schema, and exactly two
local additions: `AgencyMembership` and `OutcomeComputationRun`. The push
therefore had no schema deletion target. The hosted inventory afterward reports
238 schemas and 249 functions.

The new authority, outcome-publication, training-evidence, and reference-catalog
surfaces were checked against the hosted staging app:

- anonymous calls to `getMyTenantContext`, `getMyTrainingGamification`,
  `listCompetencies`, `listPolicyLibrary`,
  `listTenantTrainingIntegrityRecords`, `recordTrainingAuditEvent`, and
  `submitScenarioAttempt` returned HTTP 401;
- a validly shaped `computeOutcomeMeasures` request returned HTTP 500 because
  `INTERNAL_FN_SECRET` is deliberately not configured, before any service-role
  data access;
- anonymous lists for `AgencyMembership`, `OutcomeComputationRun`,
  `Competency`, `PolicyLibrary`, `ScenarioAttempt`, and `TrainingAuditLog`
  returned HTTP 200 with `[]`, while direct creates returned HTTP 403; and
- privileged post-probe queries found zero rows in every changed
  authority/outcome/training evidence entity.

`SUPER_ADMIN_EMAIL` is the only current staging secret. It binds the protected
platform-owner fallback to the exact built-in admin identity and does not grant
anonymous access or enable any scheduler. No Agency or AgencyMembership row has
been provisioned, so this checkpoint does not satisfy the authenticated
two-agency actor matrix in sections 1–4. It proves the new surfaces fail closed
on an empty isolated staging app; operational membership provisioning,
revocation, agency stamping/backfill, and cross-tenant tests remain required.

## 5g. Membership, outcome-reader, and Visit-create checkpoint (updated 2026-09-03)

The next reviewed batch was deployed only to nonproduction app
`6a9881683dc68a0bd54f1ef7`. Immediately before the schema push, exact local and
hosted inventories both contained 238 names with no difference. Privileged
queries found zero rows in every changed clinical, authority, outcome, and
dormant entity. The full schema push therefore had no entity deletion or rename
target and no changed-row migration target in this isolated app.

Hosted inventory after deployment reports 238 schemas and 252 functions.
`SUPER_ADMIN_EMAIL` remains the sole secret; `INTERNAL_FN_SECRET` remains absent.
The following anonymous function probes were recorded:

| Function | Hosted result |
| --- | --- |
| `manageAgencyMembership` | HTTP 401 before service-role reads |
| `getPublishedOutcomeMeasures` | HTTP 401 before service-role reads |
| `createAuthorizedVisit` | HTTP 401 before service-role reads or writes |
| `getMyTenantContext` | HTTP 401 before service-role reads |
| `offboardUser` | HTTP 401 before service-role reads or writes |
| `computeOutcomeMeasures` | HTTP 500, expected missing `INTERNAL_FN_SECRET`, before privileged data access |
| `autoAssignNurseToPatient` | HTTP 200 static `skipped` response; unconditional no-op |

The first hosted `offboardUser` probe returned a generic HTTP 500 because an
anonymous `auth.me()` rejection was not normalized. The function was changed to
catch that rejection, a runtime regression contract proved zero service-role
activity, only that function was redeployed, and the repeated hosted probe
returned HTTP 401 with `{"error":"Unauthorized"}`.

Anonymous GET requests returned HTTP 200 with `[]`, and shaped anonymous POST
requests returned HTTP 403, for all of these 17 entities:

`AIKnowledgeBase`, `AIModelConfiguration`, `AgencyComplianceRule`, `CareSetting`,
`DocumentationTemplate`, `FeaturePackage`, `InvitationSettings`, `NewFeature`,
`NoteTemplate`, `ProviderSettings`, `SharedPhraseLibrary`,
`SubscriptionSettings`, `AgencyMembership`, `Visit`, `PatientOutcomeMetric`,
`AgencyKPI`, and `OutcomeComputationRun`.

Privileged post-probe connector queries reported `count: 0` for all 17, and also
for `Patient` and `Agency`. The hosted staging root, `/privacy`,
`/privacypolicy`, relative manifest, and all four manifest icons return HTTP 200.
The manifest retains relative `id`, `start_url`, and `scope`. The fresh bundle
contains the staging app id, not the CareMetric production app id, and uses
`America/New_York`.

This proves anonymous denial and zero probe residue on the empty isolated app.
It does not prove the authenticated matrix: no Agency, Patient, or membership
rows and no second-agency identities exist in staging. It also does not provide
datastore transactions/CAS, protect direct Visit updates/deletes, backfill
clinical tenant provenance, make outcome rows immutable, complete the CMS PDGM
grouper, or validate native devices/stores. No production app, production data,
domain, scheduler, OASIS-v2 flag, native binary, or app-store record was changed.

## 5h. Patient-create and hard-delete checkpoint (updated 2026-09-03)

The next reviewed batch was deployed only to nonproduction app
`6a9881683dc68a0bd54f1ef7`. Pre-deployment connector queries returned zero
Patient, Agency, and AgencyMembership rows. The schema push retained the exact
238-entity inventory, `createAuthorizedPatient` was added, and only the
tenant-unsafe `processPatientFileUpdate` function was updated. Hosted function
inventory is now 253.

The hosted Patient schema exposes the four new provenance/idempotency fields
`created_by_user_id`, `created_by_user_email_normalized`, `client_request_id`,
and `patient_creation_key`. Direct Patient create and delete are both false.
All eight production browser creates use the broker, and the sole hard-delete
UI path is gone. The bulk-import apply path returns HTTP 503 before file or
Patient access; protected-owner preview remains available.

Hosted negative probes recorded:

| Probe | Hosted result |
| --- | --- |
| anonymous `createAuthorizedPatient` | HTTP 401 `Unauthorized` before service-role access |
| anonymous `processPatientFileUpdate` | HTTP 401 before input/data access |
| anonymous Patient list | HTTP 200 with `[]` |
| anonymous direct Patient create | HTTP 403 permission denied |

Post-probe connector queries again returned zero Patient, Agency, and
AgencyMembership rows. Root, `/privacy`, `/privacypolicy`, `manifest.json`, and
all four manifest icons return HTTP 200; the manifest retains relative `id`,
`start_url`, and `scope`. The staging-bound bundle contains no production app
id and uses `America/New_York`.

This proves the empty-staging anonymous boundary and zero residue. It does not
prove an authorized happy path or two-agency isolation because staging still
has no Agency/membership/test-user matrix. Direct Patient update and broad read
RLS, legacy provenance and care-team assignment backfill, service-role Patient
maintenance paths, datastore uniqueness/CAS, native-device/store checks, and
the previously recorded outcome/PDGM/OASIS blockers remain open. No production
app, data, domain, scheduled job, feature flag, native binary, or app-store
record was changed.

## 5i. Patient mutation, append-only note, and Document checkpoint (updated 2026-09-03)

The latest reviewed batch was deployed only to nonproduction app
`6a9881683dc68a0bd54f1ef7` at
`https://caremetric-pennsync-staging-2026-09-d54f1ef7.base44.app/`.
Immediately before the schema push, hosted staging contained 238 schemas and
the only local-only addition was `PatientNoteHistoryEntry`; there was no
hosted-only schema and therefore no schema deletion or rename target. Hosted
inventory after deployment contains 239 schemas and 256 functions.

`Patient` and `Visit` now deny direct create, update, and delete. Patient
updates are brokered by `updateAuthorizedPatient`; note history is written to
the all-operation-denied append-only `PatientNoteHistoryEntry` entity by
`appendPatientNoteHistory` and read through
`getAuthorizedPatientNoteHistory`. Existing embedded Patient note history is
retained and merged into the authorized projection; this checkpoint did not
rewrite existing Patient rows.

Eight legacy Patient writers return static HTTP 503 before parsing caller data,
creating a client, authenticating, invoking AI, or touching an entity:

`calculateDataQualityScores`, `deletePatientsMissingFirstName`,
`enforceDataCompleteness`, `migrateExistingData`,
`monitorClinicalDataForCarePlanUpdates`, `predictPatientRisks`,
`predictiveRiskAnalysis`, and `processDischargeReport`.

`analyzeDocument`, `generateFaxCoverPage`, and `sendMessage` were redeployed
with exact Document, Patient, membership, Agency, and immutable-actor boundary
checks. The initial anonymous `sendMessage` probe returned HTTP 500 because its
auth rejection was not normalized. The defect was caught, fixed, covered, and
only that function was redeployed before the probe was repeated successfully.

Hosted negative probes recorded:

| Probe | Hosted result |
| --- | --- |
| anonymous `updateAuthorizedPatient` | HTTP 401 before service-role access |
| anonymous `appendPatientNoteHistory` | HTTP 401 before service-role access |
| anonymous `getAuthorizedPatientNoteHistory` | HTTP 401 before service-role access |
| anonymous `analyzeDocument` | HTTP 401 before Document or Patient access |
| anonymous `generateFaxCoverPage` | HTTP 401 before Document or Patient access |
| anonymous `sendMessage` after the fix | HTTP 401 before service-role access |
| anonymous direct Patient create | HTTP 403 permission denied |
| anonymous direct PatientNoteHistoryEntry create | HTTP 403 permission denied |
| anonymous Patient list | HTTP 200 with `[]` |
| anonymous PatientNoteHistoryEntry list | HTTP 200 with `[]` |

Privileged connector queries before and after the probes reported zero Agency,
AgencyMembership, Patient, Visit, Document, PatientNoteHistoryEntry,
OutcomeComputationRun, PatientOutcomeMetric, and AgencyKPI rows. The staging
root, both privacy routes, relative manifest, and icons return HTTP 200. The
manifest retains relative `id`, `start_url`, and `scope`, and the staging build
uses `America/New_York` as the default business clock.

This is hosted anonymous-denial and zero-residue evidence on an empty isolated
app. It is not authenticated tenant-isolation proof. Direct Document entity RLS
remains open, Patient reads have not been migrated to an authorized server
boundary, no two-agency users or data exist, and tenant/provenance backfill plus
datastore uniqueness/CAS are unproved. Outcome computation, official PDGM,
OASIS, physical-device, signing, privacy/store, and rollback gates remain open.
The CareMetric production app, production data/schema, domains, schedules,
secrets, OASIS-v2 and PDGM gates, native binaries, and app-store records were
unchanged.

## 5j. Patient read-broker checkpoint (updated 2026-09-03)

Two reviewed read-only Patient brokers were explicitly deployed to the same
isolated staging app: `getAuthorizedPatient` for one exact chart and
`listAuthorizedPatients` for a bounded authorized roster. No schema was pushed;
hosted schema inventory remains 239 and hosted function inventory increased
from 256 to 258.

The list broker was later redeployed in place after replacing offset and
mutable-field ordering with a single context-bound `id` keyset. It sends
`{ id: { $gt: after_id } }`, actual Base44 sort `"id"`, and `page_size + 1`,
and it re-resolves exact tenant authority on every continuation request. The
cursor's `id_asc` value is only an internal finite-mode label, not a Base44 sort
field. A privileged empty-entity probe accepted this exact query shape. Because
the app has no Patient rows, that result does not prove hosted collation,
strictly increasing multi-row traversal, absence of gaps/duplicates, concurrent
insert behavior, or cross-agency isolation.

Shaped anonymous POST probes recorded:

| Function | Hosted result |
| --- | --- |
| `getAuthorizedPatient` | HTTP 401 with `{"error":"Unauthorized"}` |
| `listAuthorizedPatients` | HTTP 401 with `{"error":"Unauthorized"}` |

Post-probe privileged connector queries again reported zero Agency,
AgencyMembership, Patient, Visit, Document, PatientNoteHistoryEntry,
OutcomeComputationRun, PatientOutcomeMetric, and AgencyKPI rows.

The source checkpoint passes 3,530 package checks: 2,065 core, 34
schema/contracts, 392 security, 47 deduplication, and 992 component checks.
ESLint, `typecheck:signal`, transpilation of all 259 local backend functions,
all 244 shared-helper consumers, the staging-bound build, dependency audit with
one low and no high-severity finding, and `git diff --check` also pass. Hosted
inventory remains 239 schemas and 258 functions because the Patient redeploy
replaced an existing function and the later Document work was not deployed.

This does not close the Patient read boundary. The brokers are deliberately
unwired, direct `Patient.rls.read` remains broad rather than false, and current
SPA consumers still use direct reads plus client-side filtering. Production
cutover remains blocked until every Patient read is migrated, authenticated
multi-row hosted keyset paging is proved without gaps or duplicates, care-team
assignment uses immutable user ids, tenant and provenance backfill is complete,
and the authenticated two-agency matrix passes. Direct Document entity RLS and
the previously recorded outcome, official PDGM, OASIS, physical-device,
signing, privacy/store, and rollback gates also remain open. No production app,
data/schema, domain, native binary, or app-store record was changed.

## 5k. Document authority foundation (source-only, updated 2026-09-03)

The source tree now contains an additive `DocumentTenantBinding` schema with all
four direct RLS operations false and an unwired `createAuthorizedDocument`
broker. The broker accepts only reviewed patient-document or referral purposes,
validates finite PDF/JPEG/PNG multipart input up to 25 MiB, resolves exact
immutable actor/membership/Agency and optional Patient authority, binds replay
to that authority and content hash, and exact-reads both created rows before
returning a finite projection. On failure it attempts to compensate only the
Document created by that request and logs no PHI-bearing details.

The new schema and function were deliberately **not** deployed. This foundation
still lacks datastore-enforced uniqueness or a transaction, orphan-object and
binding reconciliation, private/signed file delivery and a storage-host
allowlist, full file parsing plus malware/CDR scanning, existing Document
backfill, and migration of every legacy Document writer/reader. Direct legacy
Document RLS remains unchanged. Patient merges now explicitly classify
`DocumentTenantBinding` as server-broker-only so an archived duplicate cannot
silently strand a binding.

This checkpoint made no production, domain, data, native-binary, scheduler,
OASIS-v2, PDGM, or app-store change.

## 5l. Care-team assignment authority foundation (source-only, updated 2026-09-03)

The source tree now contains an additive `PatientCareTeamAssignment` schema
whose create/read/update/delete RLS operations are all false, plus one finite
broker and a fail-closed client wrapper. A repository-wide source scan proves
there is no SPA callsite. The schema and function were deliberately **not**
deployed to staging.

All mutation actions (`grant`, `activate`, `suspend`, and `revoke`) are guarded
by a literal `CARE_TEAM_ASSIGNMENT_MUTATIONS_ENABLED = false` and return HTTP
503 before creating a Base44 client, authenticating, reading with service role,
or writing. The gate cannot be changed through an environment variable. The
dormant implementation pins Base44 SDK 0.8.46 and replaces unconditional
existing-row writes with a full-assignment-preimage `updateMany` predicate,
`$inc: { version: 1 }`, exact result checks, and full snapshot readback. Local
failure injection proves that a concurrent terminal revocation or membership
binding change wins and the stale transition returns 409. Replay is bound to
the exact action, actor, request id, reason, and expected result version.
Restrictive suspension/revocation preserves the stored identity evidence and
does not require a still-existing target User, target membership, or Patient.

This is not a deployable grant system. The documented Base44 entity API has no
transaction, unique schema constraint, upsert, or atomic create-if-absent.
Concurrent grants and cross-entity Agency/membership/Patient authorization
therefore cannot be proved atomic in repository code. Before this gate can ever
be reviewed for opening, provision a hosted uniqueness/transaction strategy,
run simultaneous authenticated two-agency requests against nonproduction,
design resumable legacy assignment backfill with quarantine, and resolve
patient-merge rekey/collision behavior.

The current source checkpoint passes 3,552 package checks: 2,065 core, 34
schema/contracts, 407 security, 47 deduplication, and 999 component checks. All
260 local backend functions transpile and all 244 shared-helper consumers match.
ESLint, `typecheck:signal`, the staging-bound build, dependency audit with one
low and no high-severity finding, and `git diff --check` pass. Hosted inventory
remains 239 schemas and 258 functions because this source-only addition was not
deployed.

No production app, production data/schema, domain, scheduler, secret,
OASIS-v2/PDGM gate, native binary, or app-store record was changed.

## 5m. Outcome transition and assigned-patient exact-read checkpoint (source-only, updated 2026-09-03)

The next source-only checkpoint strengthens outcome publication without
changing the hosted app. `OutcomeComputationRun` now requires
`transition_version`, initializes a run at `building@v1`, and permits only one
full-writer-preimage conditional transition to an exact terminal `@v2` state.
The predicate includes every writer-owned schema field, with `$exists: false`
for absent optional fields; the update must report `success: true`, `updated:
1`, and `has_more: false`; and exact readback must reconcile. Published rows
also require mutually exclusive terminal metadata, a canonical
`result_summary_hash`, count reconciliation, exact derived-row cohort
validation, and pre/post-publication window checks. This closes stale same-row
transitions in source, but distinct-row phantom publication, datastore
uniqueness, hosted `updateMany`/`$inc`/`$exists` atomicity, stable source
snapshots, and runtime-budget work remain unproved.

The same source-only checkpoint makes `getAuthorizedPatient` assignment-aware
for one exact chart id. Existing agency-wide and immutable Patient-creator
access is preserved; the additional path requires one exact active
`PatientCareTeamAssignment` bound to the agency, patient, immutable user id and
email, current membership id and enablement version, and validated lifecycle,
source, transition, and version evidence. Tenant, Patient, and assignment
preimages are re-read before returning a finite purpose projection.
`getMyTenantContext` returns the validated `membership_version`;
active/suspended memberships carrying revocation metadata fail closed; logs no
longer retain provider error objects; and the wrappers reject sparse, extra, or
ill-typed results. No SPA callsite was added, and `listAuthorizedPatients`
remains creator-only for nonmanagers; its only source change is shared
membership-integrity and safe-logging parity.

Fresh read-only staging queries found zero Agency, AgencyMembership, Patient,
OutcomeComputationRun, PatientOutcomeMetric, and AgencyKPI rows.
`PatientCareTeamAssignment` returned upstream not found because the source-only
schema has not been pushed; this is not evidence of a deployed zero-row entity.
Recheck the run count immediately before any staging schema push. If an
`OutcomeComputationRun` row then exists, stop and use a reviewed two-phase
optional-field backfill and verification before requiring
`transition_version`. No schema or function was pushed, and no staging or
production data, production app, domain, scheduler, secret, OASIS-v2/PDGM
gate, native binary, or app-store record changed.

The complete local checkpoint passes 3,577 package checks: 2,077 core, 34
schema/contracts, 414 security, 47 deduplication, and 1,005 component checks.
All 260 backend functions transpile and all 244 shared-helper consumers match;
ESLint and `typecheck:signal` pass. This remains source-only and undeployed.
Deployment and UI cutover are blocked by hosted service-role/RLS and two-agency
proof, assignment uniqueness and cross-entity atomicity, assignment-aware
roster discovery, an assignment-revocation cache strategy, hosted multi-row id
collation, the conditional required-field migration above, outcome
cross-record uniqueness, stable snapshots, and hosted CAS semantics.

## 5n. PR #143 reviewed staging synchronization checkpoint (updated 2026-09-04)

The approved deployment targeted only the isolated staging application
`caremetric-pennsync-staging-2026-09-02`
(`6a9881683dc68a0bd54f1ef7`) at
`https://caremetric-pennsync-staging-2026-09-d54f1ef7.base44.app/`. A
recoverable checkpoint named
`Pre-PR143 reviewed staging deployment — 2026-09-04` was created first. The
deployed runtime candidate is commit
`f4e41dc2d5481c7e23dd84e6e70464691bfdabd8`, tree
`94888934ebf417071b286e3a74904c872bd70777`.

The source and hosted application each expose the same 241 entity names, with
no name diff. Canonical source-to-host comparisons match for `Document`,
`OutcomeComputationRun`, `PDGMRateConfig`, and `PatientPathwayAssignment`,
including the required `OutcomeComputationRun.lease_expires_at` date-time field
and reviewed per-operation access rules.

The hosted inventory has 263 functions and equals the PR's 265-function set
minus the two deliberately withheld functions, `computeOutcomeMeasures` and
`managePatientCareTeamAssignment`. Both are absent and the inventory contains
zero automation entries. The reviewed staging deployment/probe set is:

- `getMyTenantContext`
- `manageAgencyMembership`
- `offboardUser`
- `getAuthorizedPatient`
- `listAuthorizedPatients`
- `getAuthorizedVisit`
- `listAuthorizedVisits`
- `readAuthorizedOASISAssessments`
- `getAuthorizedDocument`
- `listAuthorizedDocuments`
- `batchAIAnalysis`
- `calculatePDGM`
- `generateComprehensiveOASISReport`
- `generatePDGMComparisonPDF`
- `generatePDGMNavigatorPDF`
- `rankDiagnosesByPDGM`
- `getPublishedOutcomeMeasures`
- `getPatientContext`

Anonymous probes of those 18 endpoints returned eleven HTTP 401 authorization
denials, six HTTP 409 safe-pauses with their expected reason codes, and one
HTTP 410 `legacy_patient_context_retired` tombstone. None returned 2xx or 5xx.
Anonymous lists of `OutcomeComputationRun`, `PDGMRateConfig`,
`PatientPathwayAssignment`, and `Document` returned empty arrays; anonymous
creates against the first three returned HTTP 403.

Post-deployment privileged counts were zero for `OutcomeComputationRun`,
`AgencyMembership`, `Agency`, `Patient`, `Visit`, `Document`,
`PatientCareTeamAssignment`, `OASISAssessment`, `OASISUpload`,
`PatientOutcomeMetric`, `AgencyKPI`, `PDGMRateConfig`, and
`PatientPathwayAssignment`; the pre-existing staging `User` count remained one.
No probe residue or data migration was found.

The corrected clean-path, frozen-lockfile build serves
`assets/index-D2D5VcVB.js` (450,726 bytes), SHA-256
`a27bd29cc0f1797e4769ec6b873248ae3c12d952f7547ce4a6f402a9a1955c13`.
All 505 local build files matched their hosted byte streams with zero errors.
The root, both privacy routes, manifest, and four PWA icons returned HTTP 200;
the manifest retained relative `id`, `start_url`, and `scope` values of `.` and
all four icons. Complete-build scans found the staging app id once, the
production app id zero times, and `America/New_York` nine times.

Production was not targeted. Its inventory remained 236 schemas and 240
functions; both CareMetric origins continued to serve unchanged
`index-egZIJufH.js` bytes with SHA-256
`145532107c092fa272821a6c215b886f3188d71091682d02af6ca529675928f7`, and
`pennsync.com` continued to serve its separate `index--wkWNhXC.js` bundle. No
production data/schema, additional function, secret, domain, native, or store
mutation was performed.

This proves the 241-name schema inventory, canonical parity for the four
reviewed schemas, the 263-function name inventory, byte-for-byte frontend
parity, the recorded anonymous denials and safe-pauses, and zero checked-row
residue for the isolated staging candidate only. It does not complete
LR-01/LR-02: the canonical two-agency actor/fixture matrix does not exist, no
authenticated positive/cross-tenant workflow proof was run, and datastore
uniqueness/CAS/transactions, legacy backfill, private Document delivery,
official PDGM/OASIS approvals, device/store, migration/restore, and production
cutover gates remain open.

---

## 6. Sign-off

1. Fill `tmp/live-readiness-evidence.json` from the template (LR-01 keys).
2. `pnpm run readiness:report -- tmp/live-readiness-evidence.json`
3. Reviewers set product/security/qa/release to `approved` only with real refs.
4. Any failure on P1–P5 or T1–T3 is a **launch blocker**.

**Repo CI cannot greenlight this worksheet.** `phase0Contract` only asserts that
this proof path exists and is not silently marked complete in-repo.
