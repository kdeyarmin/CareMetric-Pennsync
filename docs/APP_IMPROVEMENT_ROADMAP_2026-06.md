# App Improvement Roadmap — PennSync2

**Date:** 2026-06-03
**Status:** Authoritative, consolidated roadmap. Supersedes the scattered findings in the
prior review docs (see [§7](#7-relationship-to-prior-docs)).

**Implementation progress (this PR):** the safe, build-verified items have started landing:
- ✅ **A1** — removed the GitHub developer functions (`createGitHubPR`, `fetchPullRequests`,
  `fetchLatestRepo`) + the `PullRequests` page/wrapper/nav entry.
- ✅ **A2** — stopped returning `error.stack` to clients in the 7 functions that did so
  (server-side `SystemLog` logging preserved).
- ✅ **E4 (moment)** — removed the unused `moment` dependency.
- ✅ **D2 (partial)** — `manualChunks` splits the heaviest vendor libs into cacheable chunks.
- ✅ **F1 (partial)** — added a per-route error boundary so one page crash no longer unmounts the app.
- ✅ **C1 (foundation)** — Vitest + React Testing Library harness alongside the node:test util
  suites; `npm test` runs both; wired into CI and `verify:workflow-quality`.
- ✅ **B1** — offline notes auto-re-run grounding on reconnect (non-blocking; does not block the save).
- ✅ **B4** — critical-vital escalation via a tested detector (both vitals key conventions) raising a
  non-blocking `PatientAlert`, deduped per (patient, breach) with retry-on-failure.
- ✅ **E2 (start)** — extracted `OASISAnalyzer`'s analytics into a tested `oasisAnalytics.js`
  (the pattern for decomposing the mega-components); this also surfaced + fixed a real gender-miscount bug.

Remaining items below are recommendations with verified code references; several (B2/B5)
are **deliberate designs or clinical-policy decisions** and some (E1, the rest of E2, F2, G) are
**large refactors** to do incrementally on the new test foundation — called out inline and not to be applied blindly.

---

## 1. Executive summary

PennSync2 is a large home-health / Medicare (OASIS-PDGM) clinical platform: **~286k LOC, 1016
JS/JSX files, 124 routed pages, 111 Base44 entities, ~190 backend functions** (React 19 + Vite 8
+ Tailwind 4 + Base44 SDK; Radix/shadcn UI; React Query).

**The codebase is in materially better shape than the older review docs imply.** During this
review the following were verified as already-good or already-fixed and should **not** be
re-litigated:

- **Backend security fundamentals are strong** — inbound webhooks are signature-verified
  (`X-Twilio-Signature`, HMAC-SHA1) with timing-safe comparison and idempotent de-dup on the
  Twilio `MessageSid`/`CallSid`, TCPA opt-out is enforced before auto-replies,
  temp passwords use a CSPRNG, patient data is scoped server-side to `assigned_nurses`,
  user-management functions gate on `role === 'admin'`, PHI is cleared from React Query +
  IndexedDB on logout, and the service worker refuses to cache `/api/` responses.
- **Routing is clean and manifest-driven** (`src/routes.jsx` + `src/lib/nav.manifest.js` via
  `import.meta.glob`). All 124 pages are routed; no orphans. The old "dual route source of
  truth" drift is effectively resolved.
- **`npm run lint` and `npm run typecheck` both pass with 0 errors.** The large lint/type debt
  described in `PHASE2_REVIEW.md` has been paid down.
- **AI output is not force-persisted** to clinical records — flows route AI text through a human
  review step before save.
- **Supabase is not a backend dependency** — it appears only as static asset URLs; all data and
  AI calls go through Base44.
- **Already fixed (still listed as "open" in `NURSE_APP_IMPROVEMENTS.md`):** the readmission
  `ReferenceError` (`HospitalReadmissionRisk.jsx:134/149` are now consistent) and the
  `functional_baseline` carry-forward cloning risk (`functional_baseline` is **not** in the
  `CARRY_FORWARD` set — `requiredElements.js:299`).

The real, current opportunities cluster into six themes. The **highest-leverage** are:

1. **Remove leftover developer tooling from the production backend** (GitHub PR functions). *(P0, security)*
2. **Build a UI/integration test safety net** — today's 26 tests are all pure-logic unit tests. *(P1, foundational)*
3. **Standardize the ~213 direct `InvokeLLM` calls** onto the existing `useAICall` retry/timeout wrapper. *(P2, reliability/maintainability)*
4. **Decompose the four 2k–4k-LOC mega-components** once tests exist. *(P2, maintainability)*

---

## 2. Verified status of prior findings (de-stale)

The prior docs are a mix of done, partially-done, and stale. This table is the corrected
current state (verified against code on 2026-06-03).

| Prior item (source) | Claimed | Verified status |
|---|---|---|
| Dual route definitions (`COMPREHENSIVE_APP_REVIEW`, `PHASE2`) | Open | ✅ Resolved — manifest-driven single source (`routes.jsx`) |
| Lint/type debt (`PHASE2`) | Open | ✅ Resolved — `lint` + `typecheck` pass 0 errors |
| Dark-mode forced render (`UI_UX_REVIEW`) | Open | ✅ Resolved |
| Readmission `ReferenceError` (`NURSE_APP_IMPROVEMENTS` P0-1) | Open | ✅ Resolved — `HospitalReadmissionRisk.jsx:134/149` consistent |
| `functional_baseline` carry-forward cloning (`NURSE_APP_IMPROVEMENTS` P0-3) | Open | ✅ Resolved — excluded from `CARRY_FORWARD` (`requiredElements.js:299`) |
| Major dep upgrades + dead-dep removal (`DEPENDENCY-UPDATE`) | In progress | ✅ Resolved — React 19 / Vite 8 / Tailwind 4 / date-fns 4 etc. |
| Webhook signature verification (`SECURITY-RLS-CHECKLIST`) | Concern | ✅ Implemented (Twilio X-Twilio-Signature + fax) |
| Offline note saved as "verified" w/o grounding (`NURSE_APP_IMPROVEMENTS` P0-2) | Open | ⚠️ **Open** — see [B1](#b-clinical-safety--ai-trustworthiness) |
| "…was not documented" auto-append (`NURSE_APP_IMPROVEMENTS` P0-4) | Open | ⚠️ **Open** — see [B2](#b-clinical-safety--ai-trustworthiness) |
| Critical-vital escalation (`NURSE_APP_IMPROVEMENTS` P0-5) | Partial | ⚠️ **Open** — plausibility added; escalation missing |
| Consistent AI "verify-before-use" gating (`AI_TRUSTWORTHINESS_AUDIT`) | Partial | ⚠️ **Open** — inconsistent across surfaces |
| `useAICall` adoption (`COMPREHENSIVE_APP_REVIEW`) | Started | ⚠️ **Open** — only 2 of ~213 call sites migrated |
| Mega-components (`COMPREHENSIVE_APP_REVIEW` #3) | Open | ⚠️ **Open** — 4 files 2k–4k LOC |
| `INTERNAL_FN_SECRET` / `FILE_URL_ALLOWED_HOSTS` set (`SECURITY-RLS-CHECKLIST`) | Deploy task | ⚠️ **Verify at deploy** — config, not code |

---

## 3. Findings & recommendations by theme

Severity reflects impact × likelihood for a PHI-handling clinical app. Effort/Risk are rough
implementation estimates.

### A. Security & HIPAA

**A1 — Remove leftover GitHub developer tooling from the production backend. — High**
`base44/functions/createGitHubPR/entry.ts`, `fetchPullRequests/entry.ts`, `fetchLatestRepo/entry.ts`.
These are dev-automation artifacts, not product features. `createGitHubPR/entry.ts:8` hardcodes
a PR title and `owner='kdeyarmin', repo='pennsync'` defaults, uses a server-side `GITHUB_TOKEN`
(`:3`), and has **no `auth.me()` / role check** — likewise `fetchPullRequests` (`:7,:12`) and
`fetchLatestRepo` (`:8`). A confused-deputy endpoint that spends the server's GitHub token does
not belong in a HIPAA backend.
→ **Delete all three functions** (and any UI/scheduled callers). *(Effort: Low · Risk: Low)*

**A2 — Stop returning `error.stack` to clients (7 functions). — Med-High — ✅ DONE (this PR)**
Verified the genuinely client-facing leaks were 7 functions returning
`{ error: error.message, stack: error.stack }` from `Response.json`: `generateAIReport`,
`analyzeNursePerformance`, `analyzeOASISNarrativeMatch`, `generateComprehensiveReport`,
`generatePersonalizedTraining`, `generateSmartNoteGuide`, `generateUserGuidePDF`. The `stack`
field was removed from those responses; `console.error` + server-side `SystemLog` logging is
preserved. (The other `error_stack:` occurrences — `generatePatientHandout`, `scheduledGuidelineSync`,
`transcribeAndExtractClinicalData` — only write to a server-side `SystemLog` entity and are fine;
`onUserSignup` only `console.error`s the stack. No client-facing change needed there.)
Follow-up (optional): a shared `jsonError()` helper that returns a generic message + correlation id.

**A3 — Bound unbounded `.list()` reads. — Med**
Report/aggregate functions (`generateAIReport`, `processDischargeReport`, `predictSupplyNeeds`,
and similar) call `entities.*.list()` with no `limit`. RLS still applies (no exfiltration), but a
large agency will hit memory/timeout. → Add explicit `limit` + pagination; prefer
`filter(query, sort, limit)`. *(Med · Low)*

**A4 — Make SSRF allowlist + required secrets fail-safe by default. — Med**
`processPatientFileUpdate` blocks private ranges but only fully restricts when
`FILE_URL_ALLOWED_HOSTS` is set; if unset, any public host is fetchable. Likewise
`TWILIO_AUTH_TOKEN` and `INTERNAL_FN_SECRET` are required for safety but unverified at
runtime. → Treat the allowlist as mandatory, and add a startup/health-check that asserts required
secrets are present (fail loud, not silent). *(Med · Low)*

**A5 — Move hardcoded operational values to config. — Low-Med**
`onUserSignup` hardcodes a single admin notification email; the GitHub functions hardcode
owner/repo. → Source admin recipients from `AgencySettings`; remove GitHub config entirely with A1.

### B. Clinical safety & AI trustworthiness

**B1 — Offline notes skip AI grounding. — Med — ⚠️ NEEDS PRODUCT DECISION (deliberate design)**
`src/components/smartNote/ConstrainedNoteReviewer.jsx:107-113`: when `!navigator.onLine`,
`verifyNote()` returns `{ ok: true, offline: true }`. On closer review this is **not** simply a
bug: the component already reports `verified: false` and shows a "Verification pending" banner
(`fixRequired.offlinePending` is truthy), and the value-guard (deterministic, offline) still runs —
only the *LLM grounding* pass is deferred. Both hosts then **intentionally allow the save**:
`MedicalScribe.jsx:258` and `SmartNoteAssistant.jsx:572` keep "Save to Chart" enabled when
`offlinePending`, and `SmartNoteAssistant.persistNote` has an explicit offline branch ("Saved
offline. Will sync when reconnected."). This is a deliberate offline-first tradeoff for field
nurses without connectivity. The genuinely missing piece is that the banner promises grounding
"will run when you reconnect" but **nothing actually re-runs it on reconnect** (it only re-checks
if the nurse edits the note). → Recommended (non-breaking): auto re-run `groundNote()` on the
`online` event for offline-pending notes and surface the result, rather than blocking the save.
Whether to additionally *block* offline chart submission is a clinical-policy call. *(Med · Med)*

**B2 — Don't auto-append "…was not documented" sentences. — Med**
`ConstrainedNoteReviewer.jsx:145-146` appends `computeNotDocumented()` phrases to the generated
note. Asserting a negative as note text fabricates documentation. → Require the nurse to answer
the missing critical element before generation rather than auto-writing a negative. *(Low · Low — but needs a clinical-product decision)*

**B3 — Make "AI-generated — verify before use" gating consistent. — Med**
OASIS suggestions (`AIGeneratedOASISAssessment.jsx` sets `ai_suggested: true` but never surfaces
it), care plans (`AICarePlanGenerator.jsx`), and LLM drug-interaction output
(`MedicationInteractionChecker.jsx`) present AI text without a uniform badge/attestation.
→ Add a shared `<AIGeneratedBadge>` + "reviewed by nurse" checkbox logged to the audit trail;
enforce the policy named in `AI_TRUSTWORTHINESS_AUDIT.md`. *(Med · Low)*

**B4 — Add critical-vital escalation. — Med**
`src/components/visit/VitalSignsForm.jsx` now validates plausibility (good) but still silently
saves dangerous-but-plausible values. → On thresholds (e.g. BP >180/120, SpO2 <88%, pain 10/10)
trigger a supervisor/physician alert; gate the "same as last visit" path so vitals must be
re-measured, not cloned. *(Med · Med)*

**B5 — Harden the medication-interaction safety net. — Med**
`src/components/medication/drugInteractions.js` (deterministic backstop) matches drug names by
exact substring and covers a limited pair set. → Expand high-severity pairs, add fuzzy/RxNorm
normalization and drug–condition contraindications (NSAID+CKD, β-blocker+asthma), and keep the
"verify against an authoritative source" disclaimer on LLM output. *(Med · Med)*

### C. Testing & quality gates

**C1 — Add the first UI / integration / e2e tests. — High**
26 test files exist and are **all pure-logic unit tests** — but they cover the highest-risk
engines well (`oasisScoringEngine`, `pdgmGrouper`, `drugInteractions`, `smartNote/compliance/*`,
dedup, `aiCall`). The gap is everything above the util layer: zero component, integration, or e2e
tests for 124 pages / ~850 components.
→ Introduce **Vitest + React Testing Library**; cover the critical journeys first
(referral intake → visit documentation → OASIS scrub/score → document sign → fax). Add a thin
**Playwright** smoke suite for login + those journeys. Add a top-level `npm test`. *(High · Med)*
This is the prerequisite that de-risks themes D and E.

**C2 — Broaden ESLint scope and rules. — Med**
`eslint.config.js` lints only `src/components` + `src/pages`. `src/lib`, `src/api`, `src/hooks`,
`src/utils`, and `base44/functions` are unlinted; `react-hooks/exhaustive-deps` is not enabled
and there is **no `eslint-plugin-jsx-a11y`**. → Extend `files` globs to all source, enable
`exhaustive-deps` (warn), and add `jsx-a11y` (see F2). *(Low · Low-Med — expect a one-time cleanup)*

**C3 — De-hardcode CI targets and tighten gates. — Med**
`.github/workflows/workflow-quality.yml` only triggers on a narrow path set and runs
`lint:workflow-targets` / `typecheck:utils`, which are **hand-maintained 33-file lists**
(`package.json:11,15`); full typecheck and `audit:prod` are `continue-on-error`. New util files
are silently excluded. → Replace the hardcoded lists with directory globs, broaden the trigger
paths, and make typecheck **blocking for `src/lib` + `src/api`** first, expanding outward. *(Low · Low)*

### D. Performance & bundle

**D1 — Lazy-load sub-sections inside hub pages and defer heavy deps. — Med-High**
Routes are lazy-loaded, but hub pages eagerly import dozens of large sub-components
(`DocumentVisit.jsx`, `OASISAnalyzer.jsx` import 30–48 modules, several 800–4000 LOC). Heavy libs
(`pdfjs-dist`, `jspdf`, `html2canvas`, `twilio-video`, `recharts`) load even when unused on a
view. → `React.lazy` the per-tab/section sub-components and dynamically import heavy libs at point
of use. *(Med · Med)*

**D2 — Add bundle visibility + chunking. — Med**
`vite.config.js` has no `manualChunks` or size reporting (it does correctly drop `console`/
`debugger` in prod). The routing comment notes a prior ~7.8 MB initial chunk. → Add
`rollup-plugin-visualizer`, define `manualChunks` for big vendors, and add a CI bundle-size guard. *(Low · Low)*

**D3 — Virtualize large lists; memoize hot pages. — Low-Med**
Long `.map()` lists (document/guideline/patient tables) render without virtualization and pages
aren't `React.memo`'d. → Add `@tanstack/react-virtual` to the largest lists; memoize chart-heavy
subtrees. *(Med · Low)*

### E. Maintainability & architecture

**E1 — Standardize AI calls on `useAICall`. — High (leverage)**
A mature wrapper exists — `src/lib/aiCall.js` + `src/hooks/useAICall.js` — with 30s timeout,
exponential backoff, and non-retryable-status handling, and it's unit-tested (`aiCall.test.js`).
But only **2 of ~213** `InvokeLLM` files use it (`AICarePlanGenerator`, `MedicationInteractionChecker`);
the rest call `base44.integrations.Core.InvokeLLM` inline with no timeout/retry. → Migrate call
sites (mostly 1-line changes); consider a `useLLMQuery` that memoizes by `[prompt, schema]` to cut
duplicate spend. *(Med-High total · Low per site)*

**E2 — Decompose the four mega-components. — High (do after C1)**
`src/components/visit/OASISScrubber.jsx` (4146), `src/pages/OASISAnalyzer.jsx` (3168),
`src/components/oasis/AutomatedPDGMNavigator.jsx` (2278), `src/components/visit/QuickTemplatesLibrary.jsx`
(1969) mix data formatting, LLM calls, and 500+ lines of JSX. → Extract pure logic into tested
utils/hooks (`oasisFormatter`, `oasisAnalyticsUtils`, `useOASISAnalysis`) and split rendering into
<1000-LOC domain components. **Gate this behind C1** so refactors have a safety net. *(High · Med-High)*

**E3 — Resolve duplicate-named components. — Med**
Pairs like `visit/AIDocumentationAssistant.jsx` vs `oasis/AIDocumentationAssistant.jsx`, and
`visit/ClinicalDecisionSupport.jsx` (386) vs `smartNote/ClinicalDecisionSupport.jsx` (1465) have
drifted. → Diff each pair; merge when >80% overlap (domain prop) or rename for clarity. *(Med · Med)*

**E4 — Small, safe hygiene wins. — Low-Med**
Remove unused `moment` (0 imports; ~30 KB); inline the single `lodash/debounce` use and drop
`lodash`; extract the repeated `{loading,error,data}` `useState` triad into a `useAsyncState`
hook; centralize the duplicated chart `COLORS` palette into `src/constants/chartColors.js`; adopt
a tiny logger abstraction for the 611 `console.*` sites (already stripped in prod builds, but a
logger gives intent + future redaction). *(Low · Low)*

### F. Resilience UX & accessibility

**F1 — Add granular error boundaries + telemetry. — Med**
`src/components/utils/ErrorBoundary.jsx` is a single app-root boundary whose `componentDidCatch`
only `console.error`s; any render error drops the whole app to a "Reload Page" screen and is
invisible to the team in production. → Add route-/section-level boundaries so one widget failure
doesn't unmount the app, and report caught errors to a telemetry sink. ~~Replace toast-only fax/SMS
failures with a persisted retry queue + backoff.~~ — ✅ Done. **SMS:** send-time retry/backoff plus a
`redriveFailedSms` outbox cron (transient-only, attempt-capped, idempotent) and a nurse notification
on delivery failure. **Fax:** `autoRetryFailedFaxes` + `handleTwilioFaxWebhook` now honor the
`FaxRetryConfig` entity, classify transient vs permanent failures (permanent gives up immediately),
claim each fax with a per-run token before re-sending (no double-send), and notify the sender on
permanent failure. Logic is the unit-tested `fax/faxRetry.js` with an inline-copy drift guard.
*(Med · Low-Med)*

**F2 — Accessibility audit + remediation. — Med**
No `eslint-plugin-jsx-a11y`; `role`/`alt`/label coverage is sparse across ~850 components; the
signature canvas (`react-signature-canvas`) is mouse-only with no `aria`/keyboard path. For
clinical staff this is a usability and potential-compliance gap. → Add the lint plugin (with C2),
fix the flagged issues, and provide a keyboard/typed-name alternative for signature capture. *(Med · Med)*

### G. Offline / PWA

**G1 — Harden offline sync. — Med**
`src/components/offline/OfflineSyncService.jsx` queues mutations in `localStorage` with no
backoff/max-retry (retry-forever risk), and `saveConflict()` records conflicts with no review UI,
so stale/conflicting PHI can accumulate. The service worker (`public/sw.js`) caches only static
assets. → Add bounded retry/backoff, a conflict-resolution UI, and offline tests (none today).
Pairs with B1. *(Med · Med)*

---

## 4. Recommended sequencing

**P0 — now (low-risk, high-value):**
- A1 remove GitHub dev functions · A2 strip `error.stack` · A3 bound `.list()` reads ·
  A4 mandatory SSRF allowlist + secret startup check · B1 offline-note grounding gate ·
  §5 deployment-config checklist.

**P1 — next:**
- C1 first RTL/integration + Playwright smoke tests · C2/C3 broaden ESLint/CI + globs + jsx-a11y ·
  B3 AI verify-before-use gating · B4 vital escalation · E4 hygiene (remove `moment`, etc.) ·
  E3 dedupe components · F1 error boundaries + telemetry.

**P2 — later (after the test net exists):**
- E1 `InvokeLLM` → `useAICall` migration · E2 mega-component decomposition · D1/D2/D3 bundle &
  perf · B2/B5 note-append + drug-interaction depth · F2 a11y remediation · G1 offline hardening.

---

## 5. Deployment / configuration checklist (no code)

Confirm in the Base44 dashboard / environment — these are operational, not code:

- [ ] `INTERNAL_FN_SECRET` set (locks down `issueCertificate`; otherwise certificate issuance is forgeable).
- [ ] `FILE_URL_ALLOWED_HOSTS` set (otherwise A4 SSRF surface stays open).
- [ ] `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` and all Twilio secrets present
      (webhooks fail-closed without them — inbound SMS/voice/fax silently dropped).
- [ ] RLS policies in the dashboard match `docs/SECURITY-RLS-CHECKLIST.md` (verify client-writable
      entities like `TrainingCertificate` are gated).
- [ ] Prefer one scheduler instance for `dispatchScheduledSms` / `redriveFailedSms`. (Double-send risk
      is mitigated by a per-run claim token plus a re-read to confirm ownership before sending —
      Twilio has no client idempotency key, so claim-and-verify is what guarantees single delivery;
      a single schedule is still recommended.)

---

## 6. Appendix — key file references

| Area | Path |
|---|---|
| AI retry wrapper (target pattern) | `src/lib/aiCall.js`, `src/hooks/useAICall.js` |
| Routing source of truth | `src/routes.jsx`, `src/lib/nav.manifest.js` |
| PHI cache lifecycle | `src/lib/phiStorage.js`, `src/lib/AuthContext.jsx` |
| Error boundary | `src/components/utils/ErrorBoundary.jsx` |
| Offline sync | `src/components/offline/OfflineSyncService.jsx`, `public/sw.js` |
| Constrained note / grounding | `src/components/smartNote/ConstrainedNoteReviewer.jsx`, `.../compliance/requiredElements.js` |
| Mega-components | `src/components/visit/OASISScrubber.jsx`, `src/pages/OASISAnalyzer.jsx`, `src/components/oasis/AutomatedPDGMNavigator.jsx`, `src/components/visit/QuickTemplatesLibrary.jsx` |
| Dev-tooling to remove | `base44/functions/{createGitHubPR,fetchPullRequests,fetchLatestRepo}/entry.ts` |
| CI + scripts | `.github/workflows/workflow-quality.yml`, `package.json` (scripts) |

---

## 7. Relationship to prior docs

This roadmap consolidates and updates: `COMPREHENSIVE_APP_REVIEW.md`, `AI_TRUSTWORTHINESS_AUDIT.md`,
`OASIS_REVIEW.md`, `SMARTNOTE_REVIEW.md`, `UI_UX_REVIEW.md`, `PHASE2_REVIEW.md`,
`NURSE_APP_IMPROVEMENTS.md`, `ROUTE_CONSOLIDATION.md`, `SECURITY-RLS-CHECKLIST.md`,
`DEPENDENCY-UPDATE-2026-06.md`. Where this document and an older one disagree, **this one reflects
the verified 2026-06-03 code state** (see [§2](#2-verified-status-of-prior-findings-de-stale)).
The `SECURITY-RLS-CHECKLIST.md` remains the source of truth for dashboard-side RLS configuration.
