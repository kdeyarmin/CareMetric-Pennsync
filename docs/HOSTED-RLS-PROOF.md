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

## 6. Sign-off

1. Fill `tmp/live-readiness-evidence.json` from the template (LR-01 keys).
2. `pnpm run readiness:report -- tmp/live-readiness-evidence.json`
3. Reviewers set product/security/qa/release to `approved` only with real refs.
4. Any failure on P1–P5 or T1–T3 is a **launch blocker**.

**Repo CI cannot greenlight this worksheet.** `phase0Contract` only asserts that
this proof path exists and is not silently marked complete in-repo.
