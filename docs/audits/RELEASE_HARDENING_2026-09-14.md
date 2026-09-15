# Release hardening — September 14, 2026 (America/New_York)

## Scope and result

App: CareMetric AI, `694ec16e72e01b60d22f7cbf`.
Repository: `kdeyarmin/CareMetric-Pennsync`, `main`.
Verified functional commit: `fa46d96c780276e52ac88ed3e8e87cd783f5bdd3`.
Full GitHub CI: run `34914368674`, job `104208667909`, completed successfully.

This is a verified source/build repair, not a claim of complete production, clinical, or app-store release readiness. No production Publish operation was performed. Existing patient data, backend functions/entities, authorization boundaries, clinical/outbound/cutover gates, production domains, visibility, and native app identities were not changed.

## Repairs completed

### 1. Restore reproducible installations after Base44's package update

Base44 commit `f479a0c4c5b6653cada5426e3cee03b4822ef70a` changed `@base44/vite-plugin` from `^1.0.36` to `^1.0.37` without changing `pnpm-lock.yaml`. GitHub component run `34909706476`, job `104194242154`, failed before tests with `ERR_PNPM_OUTDATED_LOCKFILE`. This was independently reproduced in an isolated source snapshot.

The lockfile now matches the platform-imposed 1.0.37 release, including the package-manager-resolved integrity hash. A subsequent fresh policy check also rejected that recently published package because of the minimum release age. The existing exact-version exception list was extended only to `@base44/vite-plugin@1.0.37`; the global release-age policy and other package checks remain unchanged. Frozen installation then passed in a fresh Node 24.18.0/pnpm 11.9.0 installation and on GitHub. GitHub's separate Base44 Node 20.20.2/npm compatibility check passed too.

### 2. Restore production diagnostic removal and enforce it on built assets

The previous Vite configuration relied on `esbuild.drop`, although the active Vite 8/Oxc path did not reliably apply it. A fresh production build contained 243 direct diagnostic-call matches across 70 JavaScript assets. These were source/build findings, not evidence that actual patient data had been disclosed.

The configuration now uses active Rolldown minifier options and an explicit build-only esbuild transform. The extra transform is necessary: the first minifier-only attempt still left vendor `console.*.apply` calls and conditional debugger statements. A structural JavaScript inspection exposed those residual cases rather than treating a successful build as sufficient.

The build-only plugin removes diagnostic calls and their argument evaluation, strips debugger statements, and fails closed if unsupported diagnostic forms remain. Development diagnostics are unchanged. The final artifact check parses every emitted JavaScript file, distinguishes executable code from strings/comments, rejects missing or malformed artifacts, and reports only filenames/positions/error codes rather than source text or diagnostic arguments. Babel's parser is declared directly instead of relying on an undeclared transitive dependency.

Final fresh build: **497 JavaScript files inspected; zero detected console calls, zero debugger statements, zero inspection errors.** Eighteen inspector/transform regression tests passed, including optional/computed/global-console forms, chained calls, argument-removal behavior, and fail-closed errors. The inspector is a guard for these defined diagnostic forms, not a proof that every possible indirect logging mechanism is absent.

### 3. Repair CSV import races and stale-preview handling

Wage-index and payer-rate imports could change the displayed filename while retaining an older valid parsed table; file-read failures were not handled consistently. Case-mix imports also retained previous previews on failed or superseded reads. This created a path for stale content or mismatched provenance to remain available to save.

The three screens now share `useCsvImportPreview`: filename and parsed data update atomically; a new selection immediately clears the old savable preview; only the latest read may publish results; bundled data supersedes pending reads; unmount invalidates outstanding reads; validation/read/parser failures return safe messages. CSV extension/type and a 10 MB size ceiling are checked before reading. Pending reads are visibly indicated, and save actions are blocked while reading. Canceling a file picker preserves the existing preview.

Fourteen shared-hook regression tests passed, alongside the existing wage-index, payer-rate and case-mix component tests. The wage-index stored-table summary also no longer nests block-level badges inside a paragraph, removing its invalid HTML nesting warning. No payer rates, CMS data, calculations, stored configuration, or backend write authorization were altered.

### 4. Keep incompatible major upgrades out of routine dependency batches

The existing ESLint 9.39.5 and Vitest 4.1.11 compatibility pins remain. Dependabot groups now combine minor/patch updates rather than mixing major migrations into the same routine batch. Major version updates for ESLint, @eslint/js and Vitest are excluded until a coordinated compatibility migration is tested. Other update/security reporting remains in place. The incompatible grouped Dependabot PR was not merged.

## Verification completed

| Verification | Outcome |
| --- | --- |
| GitHub exact-head full CI, including complete `pnpm test` | Passed |
| GitHub clean frozen install and Base44 npm compatibility | Passed |
| GitHub workflow lint, source lint, high-signal typecheck and build | Passed |
| Isolated diagnostic inspector/transform tests | 18 passed |
| Focused CSV, preview, hosted-path and mobile-identity tests, retries disabled | 57 passed across 7 files |
| Chromium browser tests against the final production build | 10 passed |
| Final emitted JavaScript diagnostic inspection | 497 files, zero findings/errors |
| Shared helper parity | 225 consumer functions passed |
| Backend syntax and client function-target checks | 281 functions passed |
| OASIS review worksheet consistency | Passed, 36 items |
| Production dependency advisory audit | 0 critical, 0 high, 0 moderate, 1 low in the returned audit |

The fresh browser environment initially lacked Chromium system libraries. Installing Playwright's documented Chromium dependencies resolved that environment failure; all ten tests then passed. These browser tests cover public pages, isolated preview launch, and fail-closed startup behavior, not authenticated clinical transactions.

The broader checkJs/type baseline still reports 15,699 diagnostics that the repository's existing high-signal gate classifies as low-signal or test-fixture diagnostics. Passing that gate does not mean the entire application has zero type findings.

## Explicitly unresolved / not claimed

1. **Production publication:** unsigned reads at `2026-09-15T00:49:02Z` (September 14, approximately 8:49 PM Eastern) returned HTTP 200 from both production origins, but both still referenced `assets/index-PiVJYBEQ-34bc0d3bb4ea2c7db941416733ad8d12f19ead1f.js`. The new repair is not live on production merely because main and CI are updated.
2. **Base44 editor/provider failures:** read-only browser diagnosis run `e17d11dc-f8fd-4798-aa62-c4b969fe9c62` timed out without a usable result. Therefore the provider's context-limit request `417559a7-920b-4b26-b868-84b9be7f5123`, publication/backend error, and status of existing support case `#6aa84d1f` have not been verified resolved. No duplicate support case was submitted.
3. **Quill advisory:** the audit still flags Quill 2.0.3, GHSA-v3m3-f69x-jf25. The current advisory does not identify a patched release. The app's sole ReactQuill integration already sanitizes initial and exported HTML with DOMPurify before state/storage in `VisualPDFTemplateEditor.jsx`; that pre-existing mitigation is retained, not claimed as a new upstream patch or comprehensive exploit validation. The advisory was not hidden, downgraded away, or ignored in the audit output.
4. **Clinical/tenant/device acceptance:** authenticated tenant-isolation tests, real clinical workflows, signing/billing continuity, integration delivery, and physical iOS/Android acceptance are not established by these source tests. The draft live-readiness evidence still contains unresolved fixtures/deployment bindings and reviewer attestations. No such evidence was invented or marked passed.

Upstream advisory: https://github.com/advisories/GHSA-v3m3-f69x-jf25
Vite migration guidance: https://vite.dev/guide/migration
