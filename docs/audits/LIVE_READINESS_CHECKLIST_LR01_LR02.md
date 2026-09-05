# Live-Readiness Checklist — LR-01 & LR-02

_Created 2026-07-30. Operational sequence after repository-side Phase 0–11 closeout._

**Purpose:** turn the gated live-readiness matrix into concrete hosted work that
can be evidenced, reviewed, and reported via `pnpm run readiness:report`.

**Scope:** only the two critical blockers. LR-03–LR-09 stay deferred until these pass.

**Companion files:**

| File | Role |
|---|---|
| `docs/SECURITY-RLS-CHECKLIST.md` | Per-entity RLS matrix + multi-role verification |
| `docs/HOSTED-RLS-PROOF.md` | Manual hosted proof worksheet (raw-response / cross-tenant) |
| `docs/PLATFORM-CAS.md` | Platform If-Match / versioned-update ask (not fakeable in-repo) |
| `docs/RLS-REMEDIATION-SPEC-2026-06-19.md` | Relation-based rules (dashboard) |
| `docs/RLS-LAUNCH-RUNBOOK.md` | RLS apply/verify runbook |
| `docs/audits/live-readiness-fixture-manifest.template.json` | Canonical non-PHI two-agency fixture plan (local validation only) |
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

## Canonical fixture preflight (local, no hosted writes)

Run before provisioning:

```bash
pnpm run readiness:fixture:validate -- docs/audits/live-readiness-fixture-manifest.template.json
```

The validator pins the plan to isolated staging app
`6a9881683dc68a0bd54f1ef7`, rejects production/unreviewed targets and
credential/PHI-shaped fields, and requires exactly this authority graph. It
also computes `source_contract.source_authority_contract_sha256` over a fixed,
sorted set of readiness, authority-schema, broker, and local contract-test
sources. The same run statically checks the server-owned RLS posture, canonical
fixture enum/default support, required broker markers, and the hard-disabled
care-team assignment mutation gate. It performs no network access or hosted
writes.

| Actor | Expected roster | Why it is diagnostic |
|---|---|---|
| Platform-Owner | Excluded | Setup/recovery only; never a tenant assertion |
| Admin-A | A1, A2 | Agency A administrative scope |
| Clinician-A | A1 | Positive care-team assignment |
| Clinician-A-empty | Empty | Negative same-agency assignment proof |
| Admin-B | B1 | Cross-tenant administrative proof |

A1/A2 must be created by Admin-A and B1 by Admin-B. Only A1 is assigned, to
Clinician-A. That separation ensures creator access cannot hide a broken
assignment check. The committed manifest contains aliases and environment
variable names only; it contains no email, password, token, patient name, or
clinical value.

An exit code `0` validates the local plan and pinned static source contract; it
does not mean LR-01 or LR-02 passed. The output deliberately remains
`blocked_until_authenticated_hosted_evidence_and_reviews_exist`, reports that
no authenticated hosted probe ran, and lists every source limitation. Preserve
the emitted source-contract digest for the evidence packet; the report command
recomputes it from the exact clean checkout and rejects drift.

The manifest does not encode or provision the Referral action required by S3
or the Visit action required by S4. It does not provision anything or count as
hosted evidence. At the 2026-09-04 staging checkpoint the reviewed
`managePatientCareTeamAssignment` broker is withheld, so the final assignment
cannot yet be provisioned through an approved path. The source contract also
records that S3 lacks a reviewed immutable-tenant Referral broker and the S4
Visit-create broker still uses legacy Patient assignment fields rather than
`PatientCareTeamAssignment`. These are stop conditions, not locally satisfiable
evidence. Do not use direct entity CRUD or legacy assignment fields to
manufacture a passing matrix. Create Referral/Visit during S3/S4 only after
reviewed canonical authority paths exist.

Run the static and executable source contracts before any hosted work:

```bash
pnpm run test:contracts
pnpm run test:security
```

Passing source tests proves only the checked-in contracts under their local
mocks. It cannot prove deployed bytes, platform RLS behavior, datastore
atomicity, authenticated sessions, or hosted outcomes.

---

## LR-01 — Hosted tenant / RLS verification

**Risk:** critical (PHI isolation).  
**Repo status:** gated / packetized; the reporting CLI is implemented, while
external evidence, receipt, and inventory attestations remain outstanding.
**Live status:** blocked until evidence below is real.

### Preconditions

- [ ] The exact isolated staging Base44 app pinned by the canonical fixture manifest exists and is distinct from every production tenant; a pilot cannot substitute for this PR's evidence packet
- [ ] Protected **Platform-Owner** exists only for setup/recovery (`User.role=admin` and exact `SUPER_ADMIN_EMAIL`) and is excluded from tenant assertions
- [ ] Four tenant users exist with built-in `User.role=user`: **Admin-A**, **Clinician-A**, **Clinician-A-empty**, and **Admin-B**
- [ ] Admin-A/Admin-B have active server-owned `AgencyMembership.tenant_role=agency_admin` in Agencies A/B; both clinicians have active Agency A `clinician` memberships
- [ ] Fictional patients A1/A2 belong to Agency A and B1 belongs to Agency B; only Clinician-A has an active server-owned `PatientCareTeamAssignment` to A1
- [ ] The committed canonical fixture plan passes `pnpm run readiness:fixture:validate -- docs/audits/live-readiness-fixture-manifest.template.json`; separately verify every planned actor/row exists in hosted staging
- [ ] Record the emitted `source_authority_contract_sha256` from the exact clean candidate checkout; do not hand-enter a digest from another worktree
- [ ] `INTERNAL_FN_SECRET`, `SIGNATURE_HMAC_SECRET` set in the platform (never `VITE_*`)

### Configuration steps

1. [ ] Apply the deny-by-default entity RLS matrix from `docs/SECURITY-RLS-CHECKLIST.md` §2
2. [ ] Route positive tenant reads through reviewed brokers that validate immutable membership and care-team assignment; direct PHI/authority entity reads are not positive evidence
3. [ ] Lock training attestation writes to **service-role only** (`TrainingCertificate`, `TrainingCompletion`, attempt score/status) so clients cannot forge completions
4. [ ] Confirm scheduled/internal functions require admin session **or** `x-internal-secret: <INTERNAL_FN_SECRET>` (fail-closed if secret unset)
5. [ ] Keep every fax/SMS/telehealth migration pause and related schedule disabled until immutable provider bindings and compliant STOP/START capture pass the authenticated two-agency matrix; a later reviewed activation may enable **exactly one** processor per approved queue

### Verification (must pass on **raw network responses**, not only UI)

| # | Test | Pass criteria | Evidence ref |
|---|---|---|---|
| V1 | Clinician-A-empty | `getMyTenantContext` proves active Agency A clinician membership; brokered roster is empty | |
| V2 | Clinician-A | Brokered exact Patient plus reviewed Visit/OASIS/Document child reads permit A1 and deny A2/B1 in raw network responses | |
| V3 | Admin-A and Admin-B | Brokered rosters are agency-wide only: Admin-A sees A1/A2, Admin-B sees B1 | |
| V4 | IDOR probe | Reviewed brokers reject spoofed foreign-agency and B1 ids with 403/404/empty | |
| V5 | Training forge | Direct non-admin `issueCertificate` / completion write without passing attempt → rejected | |
| V6 | Audit hygiene | Base44 platform-log samples contain no message bodies, full phone/provider endpoints, MRNs, clinical narratives/search text, or storage-capability URLs; `UserActivity` / `SecurityLog` samples count only after their hosted append/read boundary and tenant exposure are separately proved | |

### Rollback plan (document concrete steps)

- [ ] How to revert a bad RLS rule without locking out admins
- [ ] Who can apply the revert and within what SLA
- [ ] Whether the staging tenant can be wiped and re-seeded

### Monitoring plan

- [ ] Where denied/unauthorized requests are visible in Base44 platform logs; do not rely on `SecurityLog` until its append/read boundary and tenant isolation are hosted-proved
- [ ] Alert owner if cross-tenant or cross-patient leakage is suspected

### Evidence packet fields (map into the JSON template)

| Field | What to record |
|---|---|
| `owner` | Engineering + security owners |
| `product_approval` | Product sign-off that immutable membership/care-team authority matches the intended agency model |
| `security_approval` | Security sign-off on secure-broker V1–V6 and cross-tenant T1–T4 evidence |
| `hosted_environment` | References corroborating the exact app/frontend/backend target, fixture set, candidate commit/tree, hosted runtime commit/tree, complete immutable deployment receipt, and equal externally reviewed candidate/hosted inventory-attestation hashes with the same explicit scope/exclusions (no secrets) |
| `credentials_or_sandbox` | Confirmation the canonical five actors and A1/A2/B1 fixtures exist (no passwords in the packet) |
| `test_evidence` | A run-index reference plus a complete `authenticated_hosted` attestation under every required `probes.V1`–`V6` and `probes.T1`–`T4`: `result`, canonical UTC `captured_at`, SHA-256 of the retained probe bundle, and at least one artifact reference |
| `rollback_plan` | Summary + link to runbook section |
| `monitoring_plan` | Summary + log/alert destinations |
| `reviewers` | `product` / `security` / `qa` / `release` → `approved` when done |

---

## LR-02 — Seeded authenticated staging E2E

**Risk:** critical (workflow correctness under real auth).  
**Repo status:** gated / packetized; the reporting CLI is implemented, while
external evidence, receipt, and inventory attestations remain outstanding.
**Live status:** blocked until staging tenant, fixtures, and smoke evidence exist.

### Preconditions

- [ ] LR-01 V1–V6 and T1–T4 all passed, with no unresolved isolation failure (isolation before deep workflow smoke)
- [ ] Staging app URL known; test accounts not shared with production
- [ ] Shared actors/patients exist; the fixture manifest does not provide the Referral/Visit results, so S3 must create/accept the Referral and S4 must create the Visit and compliance artifacts; ≥1 training module is optional

### Smoke flows (authenticated)

| # | Flow | Pass criteria | Evidence ref |
|---|---|---|---|
| S1 | Login | Tenant admin and clinician can sign in; wrong password fails cleanly | |
| S2 | Patient list / chart | Clinician sees only actively assigned patients through reviewed brokers; chart opens | |
| S3 | Referral intake (or triage) | Create/accept path completes without client error; record visible | |
| S4 | Smart Note or Visit Scribe | Save online path creates Visit + compliance artifacts | |
| S5 | Offline note (optional but recommended) | Save offline → reconnect → single visit (no duplicate CREATE) | |
| S6 | OASIS path (if in scope) | Assessment open/save does not crash; estimate labeling intact if rates unofficial | |
| S7 | Training (if in scope) | Complete attempt via intended path; certificate only after grade | |
| S8 | Signature / document (if in scope) | Package request or portal open does not 500 | |
| S9 | Communications mock/sandbox (if in scope) | SMS/fax **sandbox** send or dry-run does not expose real PHI to production carriers | |

### Fixture / secrets hygiene

- [ ] No production PHI in staging seeds
- [ ] CI secrets (if any) scoped to staging only
- [ ] Document how to re-seed after a wipe

### Evidence packet fields

Same eight evidence keys as LR-01. `test_evidence.references` identifies the run
index, and every required `test_evidence.probes.S1`–`S4` entry needs a complete
`authenticated_hosted` attestation: `result`, canonical UTC `captured_at`,
SHA-256 of the retained probe bundle, and at least one artifact reference.
Attach S5–S9 evidence only for optional/in-scope flows actually exercised;
identify unexercised optional flows explicitly. A supplied optional probe that
is failed, blocked, or structurally incomplete blocks the packet.

---

## Report generation

1. Validate the no-write fixture plan and pinned static source contract with `pnpm run readiness:fixture:validate -- docs/audits/live-readiness-fixture-manifest.template.json`; retain the emitted `source_authority_contract_sha256`
2. Provision and verify the canonical hosted fixture through reviewed paths; a local validator pass is not provisioning evidence
3. Copy `docs/audits/live-readiness-evidence.template.json` → a local (non-committed) file, e.g. `tmp/live-readiness-evidence.json`
4. Keep the canonical fixture set, staging app id, and frontend origin
   unchanged; replace every `FILL_ME`, including backend origin, candidate
   commit/tree, locally emitted source-authority-contract digest, hosted runtime commit/tree, a complete immutable deployment
   receipt, and equal hashes of externally reviewed candidate/hosted resource
   inventories with the same explicit scope and exclusions. A functions version
   is partial corroboration only; it cannot replace the whole-deployment receipt.
   This repository does not generate either inventory or retrieve hosted state.
   Fill summaries and **references**, including every required per-probe map,
   with actual supporting artifacts stored outside the repo if they contain
   PHI. Each supplied probe must say `execution_context: authenticated_hosted`,
   record `result: pass|fail|blocked`, use a canonical UTC millisecond timestamp,
   and bind its retained probe bundle by lowercase SHA-256. Links alone are not
   a complete probe attestation
5. Set each reviewer to `"approved"` only after human review
6. Run:

```bash
export READINESS_STAGING_BACKEND_ORIGIN="https://<exact-staging-backend-host>" # origin only; no path/query/trailing slash
export READINESS_HOSTED_RUNTIME_COMMIT_SHA="<trusted-deployment-output>"
export READINESS_HOSTED_RUNTIME_TREE_SHA="<trusted-deployment-output>"
export READINESS_HOSTED_DEPLOYMENT_ID="<complete-immutable-deployment-receipt-id>"
export READINESS_CANDIDATE_DEPLOYABLE_MANIFEST_SHA256="<externally-reviewed-candidate-inventory-sha256>"
export READINESS_HOSTED_RESOURCE_MANIFEST_SHA256="<externally-reviewed-hosted-inventory-sha256>"
pnpm run readiness:report -- tmp/live-readiness-evidence.json
```

7. Exit code `0` = the exact LR-01/LR-02 packet is structurally complete, every
   required hosted probe is explicitly attested as authenticated and passing,
   and the packet is bound to the clean checkout, its locally recomputed source
   authority contract, plus independently supplied deployment context;
   `1` = blocked; `2` = invalid input. It is not proof without the retained raw
   artifacts and human review
8. Attach the JSON report to the release candidate notes and retain the private
   evidence packet by the report's `evidencePacketSha256`. The report's
   `assurance` object intentionally says that artifact bytes were not fetched
   and reviewer identities were not cryptographically verified; those remain
   external release-review responsibilities

**Do not commit real evidence JSON with credentials, tokens, or PHI.**

---

## Stop / go

| Condition | Decision |
|---|---|
| LR-01 V1–V6 **and T1–T4** pass + reviewers approved | Isolation gate cleared; LR-02 may begin |
| LR-02 S1–S4 pass (minimum) + reviewers approved | Core clinical path cleared for pilot |
| Either packet incomplete | **No** hosted-production readiness claim |
| Production PHI without LR-01 | **Hard stop** |

After both pass, design and review a separate schema/tooling expansion for
LR-08 (provider sandbox) and LR-09 (legacy cleanup). The current template and
validator intentionally accept only the exact LR-01/LR-02 matrix.
