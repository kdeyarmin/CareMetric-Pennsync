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
| `owner_agency_code: "{{user.agency_code}}"` (etc.) | Tenant-scoped **only if** the caller has that template field populated; does not replace the bare `role:admin` arm when both are `$or`’d |
| `account_type: "super_admin"` / `"agency_admin"` arms | Additive clarity; still does not constrain bare `role:admin` |

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

`User` carries `agency_id` / `agency_name`, so staff scoping is a direct
comparison. **`Patient` carries no agency field**, so a chart's tenancy is
resolved in priority order: an explicit `agency_id` / `agency_name` on the
chart, else the agency of a `created_by` / `assigned_nurses` address that
resolves to a known user, else *unattributable*.

**Unattributable charts remain visible.** Absence of attribution is not
evidence of another tenant, and hiding a chart from the clinician who needs it
is the worse failure in a clinical record system. Any rule that hides them is
destructive on a deployment whose charts predate agency tagging: an importer or
service account leaves every row unattributable, so a strict rule empties the
roster the instant the first `agency_name` is assigned.

Before enabling multi-tenancy, in this order:

1. Add an agency attribute to `Patient` (prefer `agency_id`; it survives a
   rename, and the helper compares ids ahead of names).
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

**`Message` is deliberately excluded.** A message belongs to its *participants*,
not its author, so the author rule would hide a message addressed to this user
by someone outside their agency. `Message` RLS is `created_by` ∨ `recipients
$contains` ∨ bare `role:admin`, so non-admins are already narrowed correctly and
only the admin arm over-reads. Closing that needs participant-based narrowing on
`Message.list()` — a different filter, not this one.

---

## 6. Sign-off

1. Fill `tmp/live-readiness-evidence.json` from the template (LR-01 keys).
2. `pnpm run readiness:report -- tmp/live-readiness-evidence.json`
3. Reviewers set product/security/qa/release to `approved` only with real refs.
4. Any failure on P1–P5 or T1–T3 is a **launch blocker**.

**Repo CI cannot greenlight this worksheet.** `phase0Contract` only asserts that
this proof path exists and is not silently marked complete in-repo.
