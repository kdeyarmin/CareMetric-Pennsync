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

| Actor | Agency | Role | Assigned patients |
|---|---|---|---|
| Admin-A | Agency A | admin / agency_admin | all A |
| Nurse-A | Agency A | nurse (non-admin) | Patient A1 only |
| Nurse-A-empty | Agency A | nurse | none |
| Admin-B | Agency B (if multi-tenant) | admin | all B |
| Patient B1 | Agency A | n/a | not assigned to Nurse-A |

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
export TOKEN_NURSE_A="<nurse-a-access-token>"
export TOKEN_NURSE_EMPTY="<nurse-empty-access-token>"
export TOKEN_ADMIN_A="<admin-a-access-token>"
export TOKEN_ADMIN_B="<admin-b-access-token>"   # multi-tenant only
export PATIENT_A1_ID="<id>"
export PATIENT_B1_ID="<id>"
export PATIENT_AGENCY_B_ID="<id>"               # multi-tenant only
```

Entity list shape (adjust path if the SDK uses a different prefix):

```bash
api_list () {
  local token="$1" entity="$2"
  curl -sS -o /tmp/rls-body.json -w "%{http_code}" \
    -H "Authorization: Bearer ${token}" \
    -H "X-App-Id: ${B44_APP_ID}" \
    "${B44_ORIGIN}/api/apps/${B44_APP_ID}/entities/${entity}"
  echo
  head -c 2000 /tmp/rls-body.json; echo
}
```

---

## 3. Intra-agency gates (must pass)

Run against **response bodies**, not the UI.

| # | Probe | Expect |
|---|---|---|
| P1 | `api_list "$TOKEN_NURSE_EMPTY" Patient` | `[]` or no foreign patients |
| P2 | `api_list "$TOKEN_NURSE_A" Patient` | includes A1; **excludes** B1 |
| P3 | `api_list "$TOKEN_ADMIN_A" Patient` | agency-wide A as designed |
| P4 | Nurse-A `GET` Visit / OASIS / Document filtered or listed — bodies must not contain B1 `patient_id` | |
| P5 | Invoke `getScopedPatientAlerts` / chart PDF / risk helpers with **B1** id as Nurse-A | `403` / `404` / empty |
| P6 | Direct non-admin forge of `TrainingCompletion` / `issueCertificate` | rejected when lockdown active |

Save redacted HAR or status+body snippets under private storage; put **references
only** in the LR-01 `test_evidence.references` array.

---

## 4. Cross-tenant gates (multi-agency apps)

| # | Probe | Expect |
|---|---|---|
| T1 | `api_list "$TOKEN_ADMIN_A" Patient` | no Agency B patients |
| T2 | `api_list "$TOKEN_ADMIN_B" Patient` | no Agency A patients |
| T3 | Admin-A `GET` entity by Agency-B id | `403`/`404`/empty — never 200 with B PHI |
| T4 | Service-role / scheduled jobs only touch intended agency scope (spot-check logs) | |

If the product is single-agency per Base44 app, document that architecture in
LR-01 `hosted_environment.summary` and mark T1–T4 N/A with rationale — still
complete P1–P6.

---

## 5. Relation / byPatient rules

Field-owner RLS alone is **not** enough for shared clinical charts. Confirm
dashboard relation rules (or server-scoped functions) from
`docs/RLS-REMEDIATION-SPEC-2026-06-19.md`:

- Nurse on a shared patient sees colleague rows for that patient.
- Nurse does **not** see other patients via those entities.

---

## 5b. Residual: bare `role:admin` is platform-wide in-repo

The entity DSL in `base44/entities/*.jsonc` can match `user_condition.role`,
`user_condition.account_type`, and row fields to `{{user.*}}` templates. It
**cannot** express “facility admin for this agency only”
(`role:admin` ∧ `agency_name === {{user.agency_name}}`) or patient access via
care-team membership (cross-entity join).

Consequences that remain until the **hosted** Base44 dashboard gains richer
rules (or each app is single-tenant):

| Pattern in `.jsonc` | Effective scope today |
|---|---|
| `user_condition: { role: "admin" }` | **Every** user with `role:admin`, including agency-scoped facility admins — platform-wide read/write for that entity |
| `data.agency_id: "{{user.agency_id}}"` (etc.) | Tenant-scoped **only after** both sides are server-owned and backfilled; current custom User tenant fields are self-editable and are not authority |
| `account_type: "super_admin"` / `"agency_admin"` arms | Prohibited by the repository contract because these custom User fields are mutable |

**Do not** “fix” this by scoping admin-only entities with a lone
`agency_name: "{{user.agency_name}}"` arm — that would let any nurse in the
agency through RLS. Keep service-role + function gates
(`assertPatientAccess`, agency email sets) as the real multi-tenant boundary
until hosted relation/`$and` rules exist. `User.agency_name` is declared in
schema for honesty with runtime fields; it is not a substitute for hosted RLS.

Probe T1–T3 specifically with a **facility admin who has `role:admin` and a
non-empty `agency_name`** — if they can list another agency’s PHI via the
entity API, LR-01 fails regardless of function-layer gates.

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

Shaped anonymous POST probes recorded:

| Function | Hosted result |
| --- | --- |
| `getAuthorizedPatient` | HTTP 401 with `{"error":"Unauthorized"}` |
| `listAuthorizedPatients` | HTTP 401 with `{"error":"Unauthorized"}` |

Post-probe privileged connector queries again reported zero Agency,
AgencyMembership, Patient, Visit, Document, PatientNoteHistoryEntry,
OutcomeComputationRun, PatientOutcomeMetric, and AgencyKPI rows.

The source checkpoint passes 3,511 package checks: 2,065 core, 34
schema/contracts, 379 security, 47 deduplication, and 986 component checks.
ESLint, `typecheck:signal`, transpilation of all 258 backend functions, all 244
shared-helper consumers, the staging-bound build, dependency audit with one low
and no high-severity finding, and `git diff --check` also pass.

This does not close the Patient read boundary. The brokers are deliberately
unwired, direct `Patient.rls.read` remains broad rather than false, and current
SPA consumers still use direct reads plus client-side filtering. Production
cutover remains blocked until every Patient read is migrated, bounded/offset
paging is proved, care-team assignment uses immutable user ids, tenant and
provenance backfill is complete, and the authenticated two-agency matrix passes.
Direct Document entity RLS and the previously recorded outcome, official PDGM,
OASIS, physical-device, signing, privacy/store, and rollback gates also remain
open. No production app, data/schema, domain, native binary, or app-store record
was changed.

---

## 6. Sign-off

1. Fill `tmp/live-readiness-evidence.json` from the template (LR-01 keys).
2. `pnpm run readiness:report -- tmp/live-readiness-evidence.json`
3. Reviewers set product/security/qa/release to `approved` only with real refs.
4. Any failure on P1–P5 or T1–T3 is a **launch blocker**.

**Repo CI cannot greenlight this worksheet.** `phase0Contract` only asserts that
this proof path exists and is not silently marked complete in-repo.
