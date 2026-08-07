# Platform compare-and-swap (CAS) request

## Why this exists

PennSync reminder, SMS/fax dispatch, badge award, and multi-signer flows use
**claim-then-re-read** (write a unique `claimed_by` / `*_claim_token`, re-fetch,
proceed only if the token still matches). That shrinks races but is **not**
true compare-and-swap: Base44 entity updates are unconditional last-write-wins.

Overlapping writers can still lose updates on non-claim fields (for example
array merges) unless the function also merge-retries (`submitSignerSignature`,
`appendPatientNoteHistory`).

## What we need from Base44

One of:

1. **HTTP conditional update** — `If-Match: <etag>` or `If-Match: <updated_date>`
   on `PATCH`/`PUT` entity rows; respond `412 Precondition Failed` when stale.
2. **Version column** — integer `row_version` (or opaque `etag`) auto-incremented
   on every write; update API accepts `expected_version` and rejects mismatches
   atomically.
3. **Transactional claim RPC** — e.g. `claimEntity({ id, field, token, onlyIfEmpty })`
   that returns success only when the row transitioned under a single lock.

Until then, in-repo code must keep claim+re-read / merge-retry and treat
double-send or lost merges as residual platform risk
(`docs/SECURITY-RLS-CHECKLIST.md` §9).

## Acceptance criteria for “true CAS”

- Two concurrent updates with the same expected version: exactly one succeeds.
- The loser receives a deterministic conflict status (412/409), not a silent
  overwrite.
- Claim fields used by crons (`claimed_by`, `badges_claim_token`, etc.) can be
  set atomically with `only_if_null` or equivalent.

## Current in-repo pattern (best-effort)

```text
token = randomUUID()
update(id, { claim_field: token, ... })
row = re-read(id)
if row.claim_field !== token: abort (lost race)
else: side effects (send email / award badges / …)
```

Do **not** add decorative `row_version` fields that are never checked by the
platform API — that fakes CAS and misleads reviewers.

### In-repo claim fields (Visit / fax / reminders)

| Flow | Claim field | Notes |
|---|---|---|
| `processCompletedVisit` | `Visit.ai_process_claimed_by` | Claim before LLM; skip if lost |
| `analyzeVisitForSupplyUsage` | `Visit.supply_usage_claimed_by` | Claim before LLM + stock writes |
| `extractClinicalEvents` | `Visit.events_extract_claimed_by` (+ `events_extracted_at`) | Claim before LLM; skip if events already exist; re-check before stamp |
| `generateFollowUpTasks` | `Visit.followup_tasks_claimed_by` | Claim before LLM; skip if ai_generated tasks exist |
| `predictPatientRisks` / `predictiveRiskAnalysis` | `Patient.risk_predict_claimed_by` | Claim before LLM + PatientAlert creates |
| `generateCarePlansFromReferral` | `Patient.care_plans_gen_claimed_by` | Claim before LLM; skip if active CarePlans exist |
| `monitorClinicalDataForCarePlanUpdates` | `Patient.care_plan_monitor_claimed_by` | Per-patient claim before LLM + proposal/alert creates |
| `monitorComplianceRisks` | `Patient.compliance_monitor_claimed_by` | Claim before PatientAlert batch create |
| `processInboundFaxes` | `IncomingFax.claimed_by` | Claim pending→processing; **re-check after OCR** before attach/write |
| `retryFailedFax` / `autoRetryFailedFaxes` | `FaxLog.retry_claimed_by` | Claim + pre-send re-check |

True atomic CAS still requires the platform APIs listed above.
