# Production release recovery — 2026-09-09, 09:33 UTC task

Status: **backend recovery changes deployed; new static frontend NOT published; full production readiness NOT established.**

## Exact verified source

Production app: `694ec16e72e01b60d22f7cbf`.
Tested and built source: `791974360da2b4ff30f0b0de219f313376f03016`.
Pre-repair rollback checkpoint: `6aa1291eafd8b5cb4d0ea11b`, source `369d21b94a96b494c6584090243283f50ff92599`. A code checkpoint is not a database backup.

## Repairs performed in this pass

The production recovery routes had been copied from pre-recovery handlers rather than the tested staging implementation. Reconciled their HTTP-method guards and userManagement SDK/error boundary with staging. Updated both canonical and V2 copies, without changing account authority or delivery release gates.

Registered all three V2 routes in the outbound-delivery security inventory. Added executable parity tests proving the recovery handlers are the same implementation as their canonical counterparts, and method/authentication rejection tests for all six routes. Restored the compiler-failure regression suite to the default core-test command and removed the remaining nested npx TypeScript call. Added coverage rejecting preview/PREVIEW floating function revisions.

## Automated verification

| Suite | Passed |
| --- | ---: |
| Core/backend utilities | 2202 |
| Contracts | 256 |
| Security | 750 |
| Duplicate patients | 47 |
| Components/pages, 204 files | 1565 |

Total across these suites: **4820 passed**. The 21 compiler regression checks are included in core/backend utilities and are not double-counted.

Lint exited 0. The real compiler executed and reported 0 high-signal findings, with 15,673 informational/test diagnostics. Shared helpers were synchronized across 220 consumers. All 278 backend functions transpiled; client invocation targets exist in source. Production build exited 0. This does not establish that every source function is deployed or that authenticated hosted workflows pass.

## Live production observations

At 2026-09-09T09:42:46.689Z, each V2 account route returned GET 405 METHOD_NOT_ALLOWED with Allow: POST and Cache-Control: no-store, and unsigned POST 401 AUTHENTICATION_REQUIRED with no-store. Both tenant-context endpoints also returned controlled 405/401 responses. These prove the tested rejection boundaries, not successful authenticated account operations.

Twelve additional production read brokers rejected empty unsigned requests with 400 or 401. No response records were logged. Ten queried additive authority schemas were present with direct browser CRUD denied. No synthetic or legacy patient data was created, reassigned, exported, or deleted in this pass.

## Static-site publication remains unperformed

At 2026-09-09T09:54:37.905Z, both app.caremetricai.com and caremetricai.base44.app returned HTTP 200 but served `index-B6MQIGw5.js`, SHA-256 `8ce86376581a031d37fefbfca410aa925cec8a645fcb81b56f9a6622984f874e`.

The newly built entry is `./assets/index-CZ88BGjF-791974360da2.js`, SHA-256 `1f2929e17d6eafb63b702db8bdf4440e4d9d53f665ca00c04d7ac68137677f7f`. It contains the production app binding and V2 account callers; no generated JavaScript asset contains the staging app ID. **The live entry hashes do not match this build.**

The available 19 Base44 connector actions contain no static-site Publish operation. Read-only credential-presence checks found no CLI session or supplied Base44 publishing key/token. The repository has four existing verification workflows and no publish workflow. Plugin discovery found no additional Base44 publishing connector. No new device login was initiated in this pass.

Do not repeat device-code logins or call resource synchronization a static-site deployment. An authorized Base44 site-publish action and a subsequent exact artifact comparison are required to establish frontend publication. No deployment receipt exists for this candidate.

## Remaining release qualifications

Authenticated hosted tenant isolation, end-to-end integration checks, legacy ownership reconciliation, and the separately gated clinical/outbound workflows are not validated by this record. Preserve the existing fail-closed gates and do not invent legacy ownership or use the platform owner as a substitute for tenant-security proof. Publication alone would not make those checks pass.

Machine-readable evidence is stored beside this note in PRODUCTION_RELEASE_RECOVERY_2026-09-09_0933Z.json.
