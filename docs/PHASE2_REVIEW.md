# Phase 2 Review: Cross-Domain Assessment

Date: 2026-03-16

## Scope

This phase-2 pass reviewed all major product domains present in the repository using:

- automated static checks (`eslint`, `vite build`, `tsc` timeout probe),
- architecture and routing analysis,
- cross-domain sampling of representative modules,
- package/security baseline probe (`npm audit`, environment-limited).

Repository scale observed:

- ~1161 JS/TS source files total
- 128 pages
- 858 components
- 159 backend functions

## Verified defects and high-confidence risks

### 1) Build-breaking import path in Help domain

- `vite build` fails resolving `@/functions/generateUserManual` imported in `src/pages/Help.jsx`.
- Root cause: alias `@/*` maps to `./src/*`, but backend functions are in repo root `/functions`, not `/src/functions`.

Impact:

- blocks production builds
- likely affects any route/component that directly imports `@/functions/*` when included in the build graph

### 2) Typecheck coverage gaps hide runtime defects

`jsconfig.json` include/exclude patterns currently skip key runtime modules such as:

- `src/api`
- `src/lib`
- `src/components/ui`

Impact:

- static analysis misses shared infra code where defects are expensive

### 3) Browser global access bug in app params (SSR/tests)

In `src/lib/app-params.js`, `getAppParams()` computes:

- `fromUrl: getAppParamValue("from_url", { defaultValue: window.location.href })`

This references `window` while constructing defaults, even though the file attempts node-safe behavior via `isNode`.

Impact:

- can throw in SSR/non-browser test contexts on module import

### 4) Route-system drift (dual routing source of truth)

- `src/pages.config.js` auto-registers many pages.
- `src/App.jsx` manually declares a much smaller, custom route set.

Observed mismatch from scripted diff:

- app routes: 34
- auto-config pages: 112
- only in config (not in app): 86
- only in app (not in config): 8

Impact:

- hidden/unreachable pages
- role/navigation regressions
- maintainability burden when adding features

### 5) Lint debt is high enough to mask defects

`eslint` reports:

- 631 total issues
- 80 errors
- 551 warnings

Top issue concentrations:

- pages (171)
- smartNote components (78)
- oasis components (48)
- training components (37)
- compliance components (34)

Impact:

- real defects become hard to distinguish from noise
- slower code reviews and poorer reliability

## Domain-by-domain review and recommendations

### Admin domain

Findings:

- concentrated lint errors/warnings indicate stale imports/state and potential dead UI logic.

Recommendations:

1. enforce strict cleanup in admin pages (unused imports/vars as errors)
2. add smoke tests for user management and report export flows
3. centralize permission checks in one reusable guard layer

### SmartNote / Clinical Documentation domain

Findings:

- largest component surface area; high lint volume suggests iteration churn and risk of regression.

Recommendations:

1. split long components into container + pure presentational parts
2. create shared hooks for AI-call lifecycle (loading/error/retry) to reduce divergence
3. add schema validation (`zod`) at AI response boundaries before rendering

### OASIS / PDGM domain

Findings:

- large, complex calculators and report generation paths with significant UI logic.

Recommendations:

1. extract pure calculation utilities and unit test deterministic cases
2. enforce domain-level typing for assessment payloads and revenue outputs
3. add snapshot/invariant checks for exported report structures

### Training / Learning domain

Findings:

- significant number of components and several PDF/report workflows, plus assignment/analytics features.

Recommendations:

1. standardize function return handling (`response.data || response`) behind one helper
2. add contract tests for certificate/report generation paths
3. define explicit retry and timeout policy for long-running AI/report calls

### Fax domain

Findings:

- multiple sender/history/editor components imply repeated integration patterns and potential drift.

Recommendations:

1. consolidate fax send/retry/status hooks
2. add idempotency guardrails around retry flows
3. add end-to-end test for send -> status update -> retry path

### Documents/PDF domain

Findings:

- many components manipulate PDFs (sign, merge, reorder, annotate); this is a high-risk path.

Recommendations:

1. enforce common error model and UX for all PDF operations
2. add file-size/type preflight checks in one shared validator
3. add regression tests for output URL contract fields (`signed_pdf_url`, etc.)

### Compliance / Regulatory / Security domain

Findings:

- functionality spread across many pages; route drift increases risk of inaccessible controls.

Recommendations:

1. map all compliance/security routes to explicit role matrix tests
2. add audit log coverage for policy-impacting actions
3. move critical compliance state transitions behind backend-only enforcement

### Patient / CarePlan / Referral domain

Findings:

- broad CRUD + AI-assist workflow surface area with many integrations.

Recommendations:

1. define canonical patient identity resolution utility to avoid duplicate matching logic
2. add optimistic-update rollback handlers for critical patient mutations
3. add workflow integration tests: referral intake -> admission note -> care plan

### Telehealth / Messaging / Offline domain

Findings:

- specialized domains likely sensitive to network/device state, but minimal central resilience patterns visible at top level.

Recommendations:

1. implement shared network-state hook and uniform reconnect UX
2. add explicit timeouts/cancellation for media and token calls
3. add offline queue replay tests for key data-capture actions

## Prioritized implementation plan

### P0 (this sprint)

1. Fix function import/build strategy so frontend can invoke backend functions without alias mismatch.
2. Fix `window.location.href` non-browser bug in `src/lib/app-params.js`.
3. Add CI gate for `npm run build` + lint errors.

### P1 (next sprint)

1. Eliminate top 200 lint issues (start with errors, then high-churn domains).
2. Expand typecheck include scope to `src/lib` and `src/api` first.
3. Unify routing source of truth to prevent config/app drift.

### P2 (following sprint)

1. Add domain contract tests for AI function responses.
2. Add E2E smoke suite for 6 critical user journeys (patient, docs, fax, oasis, training, compliance).
3. Add observability dashboards for function failure rates by domain.

## Commands executed

- `rg --files | head -n 200`
- `npm run lint`
- `npm run build`
- `timeout 90s npm run typecheck; echo EXIT:$?`
- `npx eslint . -f json -o /tmp/eslint.json || true`
- Python route-diff script between `src/App.jsx` and `src/pages.config.js`
- `npm audit --omit=dev --json > /tmp/audit.json || true`

## Summary

The codebase is feature-rich and domain-deep, but reliability is currently constrained by a build-breaking function import path, route drift, partial static analysis scope, and high lint noise. Addressing those four items first will substantially reduce defect rate across all domains.
