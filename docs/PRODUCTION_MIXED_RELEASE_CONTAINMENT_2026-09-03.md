# CareMetric production mixed-release containment runbook

Date: 2026-09-03  
Status: **P0 containment prepared; no live action authorized or performed**

## Purpose

PR #142 fast-forwarded the CareMetric Base44 production source workspace and
hosted entity-schema metadata to `67d9d5ee66aad222a712e6ba49d00461d0a68337`,
while the published site continued to serve the older frontend bundle. This
runbook contains that split safely without rolling back hardened PHI controls or
deploying unrelated backend resources.

Production identity must remain:

- Base44 app: `694ec16e72e01b60d22f7cbf`
- Permanent origin: `https://caremetricai.base44.app/`
- CareMetric custom domain: `https://app.caremetricai.com/`
- Apple: ID `6757097720`, bundle `com.caremetric.ai`
- Google Play: package `com.caremetic.ai`
- Business time zone: `America/New_York`
- PWA: relative `id`, `start_url`, and `scope`; four icons

Do not move `pennsync.com`, alter a store record, upload a native binary,
enable OASIS v2, enable PDGM reimbursement, run outcome computation, or modify
production records as part of containment.

## Immediate operational hold

Until the matching frontend is published and validated, do not use:

- Patient duplicate scanning or merge;
- OASIS save, upload, analyzer-review, comparison, or approval;
- PDGM rate settings or any rate-dependent clinical/financial decision;
- outcome or KPI surfaces as evidence that data is absent.

The old Patient merge can swallow denied OASIS/outcome reassignments and still
archive the duplicate Patient. Old OASIS workflows can perform another action
before the denied entity write. Old PDGMRateConfig reads can silently fall back
to defaults.

## Confirmed current state

- Production source worktree: clean at `67d9d5e`.
- Production hosted metadata exposes fields/RLS added by that merge across 14
  changed entity schemas.
- Published CareMetric origins: HTTP 200, title `CareMetric AI`, entry asset
  `index-BQUjg8kG.js`.
- `pennsync.com`: HTTP 200, title `PENNSync`, entry asset
  `index--wkWNhXC.js`; no domain cutover occurred.
- Production manifest: `PennSync by CareMetric`, a pre-existing branding blob
  last changed before consolidation; relative PWA identity remains intact.
- Production backend-function revision and post-sync error history: **unverified
  until authenticated read-only CLI checks complete**.

## Prepared forward artifact

Exact source: `67d9d5ee66aad222a712e6ba49d00461d0a68337`  
Build result: success, production app ID injected, staging app ID absent  
Files: 507  
Bytes: 18,160,451  
Entry asset: `assets/index-egZIJufH.js`  
Entry asset SHA-256:
`145532107c092fa272821a6c215b886f3188d71091682d02af6ca529675928f7`  
Sorted-file aggregate SHA-256:
`e014a239fb3a0bb0a34949e2e8360c3570debdc106b253aef0d6db949958e2f3`

The source contains:

- `PATIENT_MERGES_PAUSED = true`;
- OASIS browser-save blocks and the server hard pause;
- `PDGM_REIMBURSEMENT_ENABLED = false`;
- reporting/outcome fail-closed states.

This artifact has not been published.

## Prepared catastrophic site fallback

Exact source: `c5457299630b02aea790a97e5bb2353011ad0d69`  
Build result: success, production app ID injected, staging app ID absent  
Files: 509  
Bytes: 19,405,902  
Entry asset: `assets/index-DWsFR8QL.js`  
Entry asset SHA-256:
`bc21cc5fd840c4b63a484a3035da3d3427739f496a0b76796d46f53515a3f79d`  
Sorted-file aggregate SHA-256:
`e07e4b3ee846f84cb7ed5b141e28ad8e7bd46f159fd87938764be1a18089dbf1`

This fallback recreates the old source behavior but does not match the hardened
schemas. Use it only if the roll-forward causes a broader login/navigation
outage, keep the operational hold above in force, and immediately plan a
corrected fail-closed roll-forward. Do not treat it as a security rollback and
do not roll back all 14 schemas.

## Authorization and preflight gate

All items are mandatory:

1. Obtain explicit approval for a production **site-only** roll-forward.
2. From the exact project directory, verify:
   - `base44/config.jsonc` exists;
   - `git status --short` is empty;
   - `git rev-parse HEAD` is exactly `67d9d5e...`.
3. Authenticate with `npx base44 login`, then verify the expected owner with
   `npx base44 whoami`.
4. Capture read-only production errors since
   `2026-09-02T19:58:30Z` and list deployed functions:
   - `npx base44 --app-id 694ec16e72e01b60d22f7cbf logs --env prod --level error --since 2026-09-02T19:58:30Z -n 500`
   - `npx base44 --app-id 694ec16e72e01b60d22f7cbf functions list`
5. Determine whether the hardened `deduplicatePatients`,
   `saveOasisResponses`, `calculatePDGM`, and related broker revisions are
   deployed. Stop on ambiguity.
6. Obtain and verify a production backup/restore point without changing data.
7. Rebuild and reproduce the forward artifact hashes above. Stop on mismatch.
8. Record current origin status, HTML entry asset, manifest, service worker,
   and icon responses.

## Site-only roll-forward

Do not use `base44 deploy`; that command deploys all resources.

Only after every preflight and approval gate passes, use the frontend-only
command from the verified `67d9d5e` project directory:

```bash
npx base44 --app-id 694ec16e72e01b60d22f7cbf site deploy --no-build -y
```

The command must consume the already verified `dist/` artifact. Do not push
entities, functions, agents, connectors, auth configuration, secrets, or
schedules during this action.

## Immediate verification

Check both production origins and the currently installed native apps:

1. `caremetricai.base44.app` and `app.caremetricai.com` return HTTP 200.
2. Both origins reference `index-egZIJufH.js`, not the old bundle.
3. Manifest, service worker, four icons, privacy routes, and EULA route resolve.
4. Login, logout, session restoration, navigation, ordinary Patient read, and
   ordinary Visit read work with a designated nonproduction/test chart.
5. Patient merge controls are visibly unavailable and cannot invoke a mutation.
6. OASIS save/upload/review controls fail closed before upload, LLM, Patient,
   audit, or OASIS mutation.
7. PDGM reimbursement and rate-edit paths remain unavailable.
8. KPI/outcome surfaces show an honest unavailable/error state.
9. The Apple-installed and Google-installed shells cold-launch, authenticate,
   and load the permanent origin without a native update.
10. Production error logs show no new systemic authentication, routing, SDK, or
    function failures.

Never inspect or paste PHI into the deployment record.

## Stop and rollback criteria

Stop immediately for widespread login failure, blank shell, routing loop,
missing assets, invalid app identity, service-worker corruption, or a new
systemic error pattern.

Prefer correcting or redeploying the verified fail-closed artifact. If a
catastrophic site rollback is explicitly approved, redeploy only the prepared
`c545729` site artifact with the same `site deploy --no-build` command from
its isolated directory. Keep all high-risk workflows suspended because the old
frontend remains incompatible with the hardened schemas.

Do not roll back entity schemas without a separate reviewed migration,
production-data impact analysis, backup, and authorization.

## Success criteria

Containment is complete only when:

- both CareMetric origins and installed native shells remain healthy;
- the live frontend matches the hardened schema boundary;
- all high-risk workflows are visibly and technically fail-closed;
- production function inventory and logs are captured;
- no domain, store record, bundle identifier, package name, PWA identity,
  schedule, secret, or production record changed unexpectedly; and
- rollback monitoring has completed without a material regression.

The broader PR #143 tenant, outcome, PDGM, clinical, two-agency, and physical
device gates remain separate production-release blockers after containment.
