# App Audit & Enhancement Recommendations — PennSync2

**Date:** 2026-06-27
**Scope:** Whole-app audit across four lenses — code-level correctness, security & compliance,
architecture & maintainability, and UX & performance.
**Type:** Recommendations only (no code changes in this pass). Each item is structured so it can
be picked up as an independent follow-up.

---

## 1. Executive summary

PennSync2 is a large home-health / hospice operations SPA (Vite + React 19) on the hosted Base44
platform — **82 routed pages, ~117 entities, ~214 backend Deno functions**, covering OASIS/PDGM
clinical logic, SmartNote, fax/voice/SMS (Telnyx), telehealth, training, and compliance.

**The code is in good shape.** It builds clean, lints with 0 errors, and the pure clinical/util
logic is well covered by ~130 automated tests. A large body of recent reviews (see §2) has already
fixed the headline bugs: IDOR gaps, signature forgery on the external signer portal, React Query v5
breakage, offline-sync data loss, and fabricated AI metrics. **The remaining work is not "the code
is broken" — it is three narrower buckets:**

1. **Operational configuration** that only exists in the Base44 dashboard / platform (RLS relation
   rules, backend secrets, webhook setup, scheduled-function dispatch). This is the **#1 go-live
   blocker** and is *not* fixable in this repo.
2. **Entity-contract drift** — code that writes record shapes the entity schemas don't define, so
   the platform silently drops or rejects them. This is the #1 *systemic code* risk.
3. **Architecture & UX debt** — a handful of 2,000–2,800 LOC "god" components, an AI-call
   abstraction that exists but isn't adopted, thin integration-test coverage, and consistency
   rollouts (PageHeader, logging) that are partly done.

### Top 5 highest-leverage recommendations

| # | Recommendation | Why it's top-5 | Area |
|---|---|---|---|
| 1 | **Complete RLS relation rules + run the §7 raw-response verification** (RLS-LAUNCH-RUNBOOK) | Single largest go-live blocker; without it, PHI access relies on cosmetic client-side checks | Security |
| 2 | **Add a schema-contract test** that asserts code-written record shapes match `base44/entities/*` | Converts the recurring "contract drift" class of bug into a CI gate — net-new, durable | Correctness |
| 3 | **Wrap async writes (approve/reject, LLM calls) in a shared mutation helper** with toast + telemetry | Eliminates the silent-failure class across patient/referral/training/care-plan flows | Correctness |
| 4 | **Decompose the OASIS god components** (`OASISScrubber` ~2.8k LOC, `OASISAnalyzer` ~2.6k LOC) | These are the maintenance and bundle-size hotspots; everything else in OASIS depends on them | Architecture |
| 5 | **Decide PDGM rate sourcing** — wire the safe grouper or keep the labeled estimate, gate billing | Payment/compliance risk; currently the live path uses hardcoded weights | Correctness |

---

## 2. How to read this — relationship to existing docs

This document **consolidates and de-duplicates** against the existing reviews. It does not repeat
their detail; it points to them and adds net-new findings (§9). Existing docs and their standing:

| Existing doc | Status | What this doc adds |
|---|---|---|
| `GO_LIVE_READINESS_2026-06-26.md` | **Authoritative** for launch blockers | Folds its P0 list into the §7 roadmap |
| `DOMAIN_REVIEW_2026-06-20.md` | **Authoritative** for entity-contract drift | Promotes "add a contract test" to a top-5 item |
| `CODE_REVIEW_2026-06-19.md` (8 sweeps) | **Mostly resolved** — historical record of fixed bugs | No new action; cited as evidence the bug-classes are handled |
| `APP_IMPROVEMENT_ROADMAP_2026-06.md` | **Live roadmap** — overlaps §C here | Re-prioritizes E1 (useAICall) / E2 (decomposition) |
| `SECURITY-RLS-CHECKLIST.md`, `RLS-LAUNCH-RUNBOOK.md` | **Authoritative** for RLS/secrets | Referenced as the execution path for §B |
| `AI_TRUSTWORTHINESS_AUDIT.md`, `FUNCTION_AUDIT_2026-06-19.md` | **Resolved** | Used to confirm AI-persistence gates are in place |
| `UI_UX_REVIEW.md`, `MOBILE_RESPONSIVENESS_REVIEW.md` | **Partly rolled out** | PageHeader/mobile items referenced, not repeated |

**Rule of thumb:** if an item below already has a home in one of these docs, this doc only
re-prioritizes it. Items marked **(net-new)** were surfaced during this audit and are not in the
existing docs — they are collected in §9.

---

## 3. Section A — Code-level correctness (highest functional impact)

### A1. Entity-contract drift — make it a CI gate
**Severity: P1 (High). Source: `DOMAIN_REVIEW_2026-06-20.md` + net-new guardrail.**

The recurring failure mode is code writing fields/enum values the entity schema doesn't define, so
Base44 silently drops or rejects the write. Known instances from the domain review still open:

- **Communications:** `Notification` `type` enum is missing values the functions emit
  (`sms_failed`, `fax_delivered`, …) → notifications dropped. `FaxLog` lacks the
  `retrying`/`retried` statuses and `retry_claimed_by/at` fields the retry path writes → retries
  return 409.
- **Signatures:** `DocumentSignature` code writes `status:'signed'` (enum expects `'completed'`)
  plus flat fields (`signer_name`, `package_id`) that aren't in the schema.
- **Patient/Referral:** `ReferralIntake` writes ~5 non-existent `Referral` fields; `ReferralTriage`
  omits required `Patient` fields (phone, address, emergency contact).
- **Training:** `AutoAssignTraining` stores a title string in an id field and writes `due_date`
  (not in schema).

**Recommendation:** Beyond fixing each instance, add a **schema-contract test (net-new)** under
`base44/` that loads each `base44/entities/*.jsonc` schema and asserts that the literal object
shapes created/updated in the corresponding functions only use defined fields and enum values.
This is the same spirit as the existing parity tests (`telnyxInlineParity.test.js`,
`faxRetryInlineParity.test.js`) and the `tools-sync-*.mjs` guards — it turns a whole bug-class into
a build failure. Start with the four entities above, then extend.

### A2. Missing error handling on async writes
**Severity: P1 (High). Source: `DOMAIN_REVIEW_2026-06-20.md`.**

Approve/reject mutations (`PendingPatientUpdates`, `CarePlanProposalReviewer`) and LLM-driven
create-loops frequently lack `try/catch` and a user-facing result, so a failed write looks like a
no-op to the nurse. **Recommendation:** a single shared mutation helper (building on the existing
`src/lib/query-client.js` deduped-toast infrastructure) that every approve/reject/LLM write routes
through — guaranteeing an error toast and an error-telemetry emit on failure. This also sets up the
logging work in §C4.

### A3. PDGM rate sourcing decision
**Severity: P1 (payment/compliance). Source: `DOMAIN_REVIEW_2026-06-20.md`, `GO_LIVE_READINESS`.**

The safe grouper (`groupPeriod` in `src/components/pdgm/pdgmGrouper.js`) is well tested but
orphaned; the live path uses hardcoded weights disclosed as an estimate. **Recommendation:** either
wire the safe grouper into the live path or delete it to remove the ambiguity, and **gate any
billing-facing output on official CMS 2026 tables** (`docs/pdgm-cy2026.md`). Keep the "estimate"
labeling until real tables are loaded.

### A4. Numeric guards and duplicated rules
**Severity: P2 (Medium). Source: `DOMAIN_REVIEW_2026-06-20.md`.**

`MicroLearning`/`InteractiveQuiz` compute `0/0 = NaN` with no length guard, and pass thresholds
differ (70 vs 80) between modules. Drug-interaction rules are hand-duplicated between JS and TS
(parity risk). **Recommendation:** add length guards + a single source-of-truth pass threshold;
fold drug-interaction rules into the existing `tools-sync-*.mjs` parity mechanism so they can't
drift.

---

## 4. Section B — Security & compliance

### B1. RLS relation rules + verification (the #1 go-live blocker)
**Severity: P0. Source: `RLS-LAUNCH-RUNBOOK.md`, `SECURITY-RLS-CHECKLIST.md`.**

Client-side role checks in this app are **cosmetic**; the real boundary is Base44 RLS. ~47 entities
have in-repo RLS blocks, but ~70 patient-clinical PHI entities (e.g. `DocumentSignature`, `FaxLog`,
`OASISUpload/Assessment`, `DischargeSummary`, `Referral`, `ClinicalEvent`, `PatientAlert`) need
"by patient access" relation rules authored **in the dashboard** — the repo DSL can't express the
cross-entity join. **Recommendation:** execute the runbook top-to-bottom, then run the §7
multi-role raw-response verification (non-admin with no patients sees empty; nurse assigned to A
cannot see B; IDOR probe returns 403/404/empty) as a hard launch gate. This is not a repo change —
track it as an operational checklist item.

### B2. "Security theater" cleanup
**Severity: P1 (High). Source: `DOMAIN_REVIEW_2026-06-20.md`.**

Some controls present as enforcement but don't enforce: `MandatoryComplianceGate` never blocks,
`SecureDocumentShare` validates its token only client-side, and a few compliance banners are
hardcoded rather than computed. **Recommendation:** either implement the real check (server-side
token validation already exists for the signer portal via `submitSignerSignature` — mirror that
pattern) or remove the control so it doesn't create false assurance. Never let AI auto-mutate a
compliance status.

### B3. Backend hardening (net-new)
**Severity: P1–P2. Source: this audit.**

- **`FaxLog` has no RLS block (net-new).** Currently safe because only service-role backend
  functions write/read it, but any future direct client query would expose every agency's faxes.
  Add an owner/by-patient rule alongside the others in B1.
- **Hardcoded super-admin email is duplicated as a literal in ~22 backend functions (net-new).**
  `const SUPER_ADMIN_EMAIL = 'kdeyarmin@comcast.net'` appears inline in `getDashboardData`,
  `saveTelnyxSecret`, `calculatePDGM`, `ensureSuperAdmin`, and ~18 others, plus the
  `backendHelpers.mjs` `isAdminLike` sync source and frontend `src/lib/superAdmin.js`. This is a
  single-person operational dependency and a drift hazard. **Recommendation:** drive all backend
  uses from the `backendHelpers.mjs` synced helper (so the literal lives in exactly one synced
  block), and make the identity configurable via env (`SUPER_ADMIN_EMAIL`) so it isn't a code edit
  to change.
- **Entity text fields lack `maxLength`/`format` constraints (net-new).** Open-text PHI fields
  (`clinical_notes`, `address`, `allergies`) and contact fields (`Physician.email` as plain string)
  have no bounds. Add `maxLength` and `format: email`/phone where applicable for defense-in-depth.
- **`IntegrationSecret` has no rotation/versioning (net-new).** Rotating a Telnyx/AI key requires a
  function edit + redeploy. Add `is_active` + `version` fields to support clean rotation.
- **Generic 500 responses (net-new, low).** All function failures return the same
  `{ error: 'Failed to process…' }`, which hampers triage. Differentiate config-missing vs.
  upstream vs. logic errors (without leaking PHI).

### B4. Secrets / webhook / scheduler config (P0 operational)
**Source: `GO_LIVE_READINESS`, `SECURITY-RLS-CHECKLIST`.**

Set at launch: `INTERNAL_FN_SECRET` (otherwise certificate issuance is forgeable),
`FILE_URL_ALLOWED_HOSTS` (SSRF closure), Telnyx keys, AI keys (feature-gating). Configure Telnyx
webhooks and smoke-test signature verification (good/bad signature). Enable **exactly one** of each
scheduled dispatcher (`processScheduledFaxes` vs `…ByPriority`; one `dispatchScheduledSms`) to
avoid double-send.

---

## 5. Section C — Architecture & maintainability

### C1. Decompose god components
**Severity: P2 (High value). Source: `APP_IMPROVEMENT_ROADMAP_2026-06.md` E2 + this audit.**

Largest files (verified): `src/components/visit/OASISScrubber.jsx` (~2,800 LOC),
`src/components/hub-tabs/OASISAnalyzer.jsx` (~2,600 LOC, 31 hooks, ~96 imports),
`src/components/.../AutomatedPDGMNavigator.jsx` (~1,800), `src/pages/DocumentVisit.jsx` (~1,700),
`src/pages/ReferralIntake.jsx` (~1,670). **Recommendation:** extract pure clinical/data logic into
sibling modules (testable without rendering — the pattern already used for `oasisScoringEngine.js`
and `pdgmGrouper.js`), then split the UI into per-section components. Start with `OASISScrubber`
(also resolves the `OASISScrubber`/`EnhancedOASISScrubber` duplication) since it's the biggest and
most depended-on.

### C2. Adopt the existing AI-call abstraction
**Severity: P1. Source: `APP_IMPROVEMENT_ROADMAP_2026-06.md` E1.**

The app already has `src/hooks/useAICall.js` + `src/lib/aiCall.js` + `src/lib/invokeLLM.js`, but
**no component currently imports `useAICall`** — AI call sites still use ad-hoc `InvokeLLM` /
`functions.invoke`. **Recommendation:** migrate component AI calls onto `useAICall` for consistent
error handling and graceful degradation when keys are unset (the `aiFeatureError` path is already
tested). Do it incrementally, highest-traffic call sites first.

### C3. Expand test coverage to flows
**Severity: P1. Source: this audit + roadmap C1.**

Coverage is strong on pure utils (~79 test files, deterministic clinical logic well covered) but
there are **0 page-level / integration tests** for the 82 pages. **Recommendation:** add RTL
integration tests for the top flows (Patients/PatientDetails, Dashboard, DocumentVisit, signature
submit) and the schema-contract test from A1. These guard the exact classes of bug the 2026-06-19
sweep fixed (render crashes on undefined fields, mutation result-shape).

### C4. Centralized logging + telemetry
**Severity: P2. Source: this audit.**

~572 raw `console.*` calls, no log levels, errors surface only as transient toasts.
**Recommendation:** a thin logger abstraction with levels, and route mutation/query errors to a
backend telemetry sink (pairs with A2's shared mutation helper) so production failures are visible.

### C5. Remove orphans / consolidate storage
**Severity: P2 (Medium). Source: `DOMAIN_REVIEW_2026-06-20.md`.**

Delete orphaned duplicates (`AdminUserSetup` orphan invoking the wrong flow, `GamificationDashboard`
running a dead parallel localStorage system). Consolidate the offline-sync data spread across 3
storage backends with no id-map into one keyed store (the PHI-purge key registry already exists as a
foundation).

---

## 6. Section D — UX & performance

### D1. PageHeader rollout
**Severity: P2 (mechanical). Source: `UI_UX_REVIEW.md`.**

`PageHeader` is standardized and adopted by ~13 pages; roll it out to the remaining ~100 standard
pages for header consistency and breadcrumb/title alignment. Low-risk, high-visibility.

### D2. Query consolidation / N+1
**Severity: P2. Source: this audit.**

`src/pages/PatientDetails.jsx` fires ~6 independent entity queries (patients, visits, carePlans,
incidents, tasks, alerts) per patient. **Recommendation:** add a `getPatientContext` backend
function that returns the bundle server-side, mirroring the existing `getDashboardData` pattern —
fewer round-trips and a single RLS-scoped read.

### D3. Bundle optimization
**Severity: P2. Source: this audit.**

`OASISAnalyzer` statically imports ~96 components (audit for tree-shaking / lazy sub-tabs); the
visit quick-template data is split across `quickTemplates.js` (~64 KB) + `quickTemplatesPart2.jsx`
and could be lazy-loaded per category; admin-only routes can be code-split into their own chunk.
Pairs naturally with the C1 decomposition.

### D4. Accessibility
**Severity: P2. Source: `APP_IMPROVEMENT_ROADMAP_2026-06.md` C2 + this audit.**

Add a keyboard alternative for the signature canvas, ARIA live regions for alert/notification
updates, and broaden ESLint with `jsx-a11y` to catch regressions. `prefers-reduced-motion` is
already respected in `Layout.jsx`.

### D5. Mobile polish
**Severity: P3. Source: `MOBILE_RESPONSIVENESS_REVIEW.md` (reference only).**

The systemic mobile fixes (tab wrapping, safe-area insets, responsive vitals grid) already landed.
Remaining polish — large-stat `sm:` downscaling, dense stat-grid responsive bases, real-device QA —
is itemized in that doc; no new analysis needed.

---

## 7. Prioritized roadmap

Priority key: **P0** = go-live blocker · **P1** = fix-forward, high impact · **P2/P3** = debt/polish.
Effort: **S** ≤ ½ day · **M** ≈ 1–3 days · **L** > 3 days. Kind: **Config** = platform/dashboard,
no repo change · **Code** = repo change.

| ID | Recommendation | Area | Priority | Effort | Kind | Source |
|----|----|----|----|----|----|----|
| B1 | RLS relation rules + §7 verification | Security | **P0** | L | Config | RLS runbook |
| B4 | Secrets / webhooks / one scheduled dispatcher | Security | **P0** | M | Config | Go-live |
| A3 | PDGM rate sourcing decision (CMS tables) | Correctness | **P0–P1** | M | Both | Domain/Go-live |
| A1 | Fix contract drift + add schema-contract test | Correctness | **P1** | M | Code | Domain + net-new |
| A2 | Shared mutation helper (toast + telemetry) | Correctness | **P1** | M | Code | Domain |
| B2 | Security-theater: enforce or remove | Security | **P1** | M | Code | Domain |
| B3 | FaxLog RLS, super-admin email config, field bounds | Security | **P1** | M | Both | net-new |
| C2 | Adopt `useAICall` at call sites | Architecture | **P1** | M | Code | Roadmap E1 |
| C3 | Page/flow integration tests | Architecture | **P1** | M | Code | net-new |
| A4 | Numeric guards + dedupe drug rules | Correctness | **P2** | S | Code | Domain |
| C1 | Decompose OASIS god components | Architecture | **P2** | L | Code | Roadmap E2 |
| C4 | Centralized logging + telemetry | Architecture | **P2** | M | Code | net-new |
| C5 | Remove orphans, unify offline storage | Architecture | **P2** | M | Code | Domain |
| D1 | PageHeader rollout (~100 pages) | UX | **P2** | M | Code | UI/UX |
| D2 | `getPatientContext` query consolidation | Performance | **P2** | M | Code | net-new |
| D3 | Bundle optimization (imports / lazy data) | Performance | **P2** | M | Code | net-new |
| D4 | Accessibility (signature, ARIA, jsx-a11y) | UX | **P2** | M | Code | Roadmap C2 |
| B3 | IntegrationSecret rotation/versioning | Security | **P2** | M | Code | net-new |
| D5 | Mobile polish (residual) | UX | **P3** | S | Code | Mobile review |

**Suggested sequence:** clear the P0 operational gates (B1, B4, A3) → land the P1 code guardrails
that prevent regressions (A1 schema test, A2 mutation helper, C3 flow tests) → then the P1 hardening
and standardization (B2, B3, C2) → then chip away at P2 debt (C1 decomposition first, since D3 and
C5 ride on it).

---

## 8. What's already well-covered (don't re-audit)

These were verified strong during this audit and need no further work beyond spot-checks:

- **Build/lint/test basics** — clean build, 0 lint errors, ~130 passing tests.
- **Routing/nav** — single `NAV_MANIFEST` source feeding sidebar, command palette, breadcrumbs; no
  drift; all pages lazy-loaded.
- **Webhook signature verification** — Telnyx Ed25519 + timestamp freshness, fails closed.
- **Idempotency** — SMS/call/fax de-dup on provider ids; offline-sync id-maps.
- **SSRF** — shared `isSafeFetchUrl()` blocks metadata IP, private ranges, `.internal`/`.local`,
  re-validates redirects; honored by 7+ functions.
- **Backend IDOR / access control** — the 2026-06-19 sweep added assignment-nurse-or-admin gates to
  15+ functions and locked internal/scheduled functions behind `INTERNAL_FN_SECRET`.
- **AI trustworthiness** — no fabricated scores persist; clinical AI output is review-gated before
  save.
- **PHI cache lifecycle** — cleared on logout; service worker refuses `/api/` caching.
- **Front/back parity** — `tools-sync-*.mjs` + parity tests keep inlined backend helpers byte-aligned
  with their frontend sources.

---

## 9. Net-new findings (not in existing docs)

Collected for quick reference — surfaced by this audit, not present in the prior reviews:

1. **`FaxLog` entity has no RLS block** — safe only because access is service-role-only today.
2. **Super-admin email hardcoded as a literal in ~22 backend functions** — operational
   single-point-of-failure and drift hazard; should be env-configurable + single synced source.
3. **Entity open-text/contact fields lack `maxLength`/`format` constraints** — defense-in-depth gap.
4. **`IntegrationSecret` has no rotation/versioning** — key rotation requires code + redeploy.
5. **Generic 500 error responses** across functions — hampers production triage.
6. **`PatientDetails` N+1** — ~6 independent entity queries per patient; consolidate server-side.
7. **Schema-contract test** — proposed durable guardrail to make entity-contract drift a CI failure.
8. **`useAICall` adopted by 0 component call sites** — the abstraction exists but is unused.

---

*Prepared as a consolidated, prioritized companion to the existing `docs/` reviews. Implementation
of any item is intentionally deferred; pick up rows from §7 individually.*
