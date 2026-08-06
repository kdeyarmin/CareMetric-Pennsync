# Live-Readiness Checklist — LR-01 & LR-02

_Created 2026-07-30. Operational sequence after repository-side Phase 0–11 closeout._

**Purpose:** turn the gated live-readiness matrix into concrete hosted work that
can be evidenced, reviewed, and reported via `pnpm run readiness:report`.

**Scope:** only the two critical blockers. LR-03–LR-09 stay deferred until these pass.

**Companion files:**

| File | Role |
|---|---|
| `docs/SECURITY-RLS-CHECKLIST.md` | Per-entity RLS matrix + multi-role verification |
| `docs/HOSTED-RLS-PROOF.md` | Executable hosted proof worksheet (curl / cross-tenant) |
| `docs/PLATFORM-CAS.md` | Platform If-Match / versioned-update ask (not fakeable in-repo) |
| `docs/RLS-REMEDIATION-SPEC-2026-06-19.md` | Relation-based rules (dashboard) |
| `docs/RLS-LAUNCH-RUNBOOK.md` | RLS apply/verify runbook |
| `docs/audits/live-readiness-evidence.template.json` | Fillable evidence JSON for the CLI |
| `docs/audits/PHASED_ROLLOUT_FINAL_REPORT.md` | Stop/go statement |

**Do not claim hosted-production readiness until both packets below are complete
with real references and reviewer approvals.**

---

## Owners (assign before starting)

| Role | Name | Date assigned |
|---|---|---|
| Product | _TBD_ | |
| Security | _TBD_ | |
| QA | _TBD_ | |
| Release | _TBD_ | |
| Engineering (hosting) | _TBD_ | |

---

## LR-01 — Hosted tenant / RLS verification

**Risk:** critical (PHI isolation).  
**Repo status:** gated / packetized / CLI-ready.  
**Live status:** blocked until evidence below is real.

### Preconditions

- [ ] Staging (or pilot) Base44 app exists and is distinct from any production tenant
- [ ] At least two test users: **Admin** and **Nurse** (non-admin)
- [ ] Nurse is assigned to **Patient A only** (email in `Patient.assigned_nurses`)
- [ ] Patient B exists and is **not** assigned to the nurse
- [ ] `INTERNAL_FN_SECRET`, `SIGNATURE_HMAC_SECRET` set in the platform (never `VITE_*`)

### Configuration steps

1. [ ] Apply entity RLS matrix from `docs/SECURITY-RLS-CHECKLIST.md` §2
2. [ ] Apply relation-based “by patient access” rules from `docs/RLS-REMEDIATION-SPEC-2026-06-19.md` for entities without in-repo RLS blocks (e.g. `DocumentSignature`, `FaxLog`, `Referral`, `PatientAlert`, …)
3. [ ] Lock training attestation writes to **service-role only** (`TrainingCertificate`, `TrainingCompletion`, attempt score/status) so clients cannot forge completions
4. [ ] Confirm scheduled/internal functions require admin session **or** `x-internal-secret: <INTERNAL_FN_SECRET>` (fail-closed if secret unset)
5. [ ] Enable **exactly one** scheduled-fax processor and **exactly one** `dispatchScheduledSms` schedule

### Verification (must pass on **raw network responses**, not only UI)

| # | Test | Pass criteria | Evidence ref |
|---|---|---|---|
| V1 | Nurse, no assigned patients | Dashboard / alerts / SMS / call history return empty lists; no other patients’ PHI in response bodies | |
| V2 | Nurse assigned to A only | Sees A; does **not** see B in UI **or** network payloads | |
| V3 | Admin | Agency-wide reads still work for expected admin surfaces | |
| V4 | IDOR probe | `getScopedPatientAlerts` / chart / risk / PDF helpers with B’s id → 403/404/empty | |
| V5 | Training forge | Direct non-admin `issueCertificate` / completion write without passing attempt → rejected | |
| V6 | Audit hygiene | `UserActivity` / `SecurityLog` samples contain no message bodies or full phone numbers | |

### Rollback plan (document concrete steps)

- [ ] How to revert a bad RLS rule without locking out admins
- [ ] Who can apply the revert and within what SLA
- [ ] Whether the staging tenant can be wiped and re-seeded

### Monitoring plan

- [ ] Where denied/unauthorized requests are visible (Base44 logs / SecurityLog)
- [ ] Alert owner if cross-tenant or cross-patient leakage is suspected

### Evidence packet fields (map into the JSON template)

| Field | What to record |
|---|---|
| `owner` | Engineering + security owners |
| `product_approval` | Product sign-off that staging isolation matches intended agency model |
| `security_approval` | Security sign-off on RLS matrix + V1–V6 |
| `hosted_environment` | Base44 app id / staging URL (no secrets) |
| `credentials_or_sandbox` | Confirmation test users exist (no passwords in the packet) |
| `test_evidence` | Links/IDs for V1–V6 artifacts (screenshots of network panels, ticket IDs) |
| `rollback_plan` | Summary + link to runbook section |
| `monitoring_plan` | Summary + log/alert destinations |
| `reviewers` | `product` / `security` / `qa` / `release` → `approved` when done |

---

## LR-02 — Seeded authenticated staging E2E

**Risk:** critical (workflow correctness under real auth).  
**Repo status:** gated / packetized / CLI-ready.  
**Live status:** blocked until staging tenant, fixtures, and smoke evidence exist.

### Preconditions

- [ ] LR-01 V1–V4 at least attempted (isolation before deep workflow smoke)
- [ ] Staging app URL known; test accounts not shared with production
- [ ] Seed data: ≥1 active patient, ≥1 referral, ≥1 visit (or ability to create them), ≥1 training module optional

### Smoke flows (authenticated)

| # | Flow | Pass criteria | Evidence ref |
|---|---|---|---|
| S1 | Login | Admin and nurse can sign in; wrong password fails cleanly | |
| S2 | Patient list / chart | Nurse sees only assigned patients; chart opens | |
| S3 | Referral intake (or triage) | Create/accept path completes without client error; record visible | |
| S4 | Smart Note or Visit Scribe | Save online path creates Visit + compliance artifacts | |
| S5 | Offline note (optional but recommended) | Save offline → reconnect → single visit (no duplicate CREATE) | |
| S6 | OASIS path (if in scope) | Assessment open/save does not crash; estimate labeling intact if rates unofficial | |
| S7 | Training (if in scope) | Complete attempt via intended path; certificate only after grade | |
| S8 | Signature / document (if in scope) | Package request or portal open does not 500 | |
| S9 | Communications mock/sandbox | SMS/fax **sandbox** send or dry-run does not expose real PHI to production carriers | |

### Fixture / secrets hygiene

- [ ] No production PHI in staging seeds
- [ ] CI secrets (if any) scoped to staging only
- [ ] Document how to re-seed after a wipe

### Evidence packet fields

Same eight evidence keys as LR-01, with `test_evidence` pointing at S1–S9 artifacts.

---

## Report generation

1. Copy `docs/audits/live-readiness-evidence.template.json` → a local (non-committed) file, e.g. `tmp/live-readiness-evidence.json`
2. Fill summaries and **references** (ticket URLs, doc links, screenshot paths stored outside the repo if they contain PHI)
3. Set each reviewer to `"approved"` only after human review
4. Run:

```bash
pnpm run readiness:report -- tmp/live-readiness-evidence.json
```

5. Exit code `0` = pass; `1` = blocked; `2` = invalid input
6. Attach the JSON report to the release candidate notes (PHI-minimized; no secrets)

**Do not commit real evidence JSON with credentials, tokens, or PHI.**

---

## Stop / go

| Condition | Decision |
|---|---|
| LR-01 V1–V6 pass + reviewers approved | Isolation gate cleared |
| LR-02 S1–S4 pass (minimum) + reviewers approved | Core clinical path cleared for pilot |
| Either packet incomplete | **No** hosted-production readiness claim |
| Production PHI without LR-01 | **Hard stop** |

After both pass, optionally expand evidence for LR-08 (provider sandbox) and LR-09 (legacy cleanup) using the same template shape.
