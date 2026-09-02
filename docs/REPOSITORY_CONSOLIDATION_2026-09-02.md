# PennSync repository consolidation

Status: **source candidate only — not approved for production deployment**.

## Canonical destination

- GitHub repository: `kdeyarmin/CareMetric-Pennsync`
- Protected preparation branch: `consolidation/pennsync-unified-2026-09-02`
- Initial destination baseline: `b95b567ea9487e2841e438777b12d65796c34f69`
- Current `main` safety baseline: `c5457299630b02aea790a97e5bb2353011ad0d69`
  (`Repair lockfile after Base44 package update`); the draft branch must retain
  this commit as a merge parent before CI can be evaluated.
- Feature source: `kdeyarmin/pennsync2` at `3e73ea75bd37ef2819dad952cbd5343c179bccb1`
- `kdeyarmin/pennsync` is already an ancestor of the PennSync2 feature history;
  it does not require a second code merge.

The PennSync2 feature tree was squash-integrated so its current functionality is
retained without attaching its 2,579-commit experimental history or 35,062
accidentally tracked `.pnpm-store` cache files. The original repositories and
remote `archive/pre-consolidation-2026-09-02` branches preserve their exact
pre-consolidation histories.

## Production identity anchors

These identifiers must not be renamed or moved during source consolidation:

| Surface | Required identity |
| --- | --- |
| Base44 app | CareMetric AI, `694ec16e72e01b60d22f7cbf` |
| Permanent app origin | `https://caremetricai.base44.app/` |
| Current CareMetric custom app domain | `app.caremetricai.com` |
| Apple App Store | Apple ID `6757097720`, bundle `com.caremetric.ai` |
| Google Play | Existing package `com.caremetic.ai` (spelling is intentional) |
| PWA | Relative `id`, `start_url`, and `scope`; all four icons retained |

The installed mobile apps continue to use their existing store records. Adding
PennSync domains later must point those domains at the same CareMetric Base44
app; it must not change the permanent origin embedded in the iOS shell.

## Nonproduction hosted-validation evidence (2026-09-02)

The first release gate is now in progress in a separate Base44 application;
none of these operations targeted the CareMetric production app above:

| Surface | Hosted staging evidence |
| --- | --- |
| Base44 app | `caremetric-pennsync-staging-2026-09-02`, `6a9881683dc68a0bd54f1ef7` |
| Staging URL | `https://caremetric-pennsync-staging-2026-09-d54f1ef7.base44.app/` |
| Source baseline | merged canonical `main` at `67d9d5ee66aad222a712e6ba49d00461d0a68337` plus draft staging PR `#143` |
| Frontend | built with the staging app id and `https://base44.app` backend origin; real-browser boot reaches the PennSync sign-in screen |
| Entities | hosted deployment accepted the candidate entity schemas, including the service-role-only OASIS/outcome/PDGM contracts |
| Data | only the staging owner account exists; Patient, OASISAssessment, OASISUpload, PatientOutcomeMetric, AgencyKPI, PDGMRateConfig, and Agency all have zero rows |
| Functions | `139 / 240` deployed; the interrupted bulk job's server lock cleared and subsequent controlled batches completed without function errors |
| Feature gates | no AgencySettings row exists; `oasis_response_schema_v2_enabled` therefore remains absent/default-off, the writer remains hard-paused, PDGM reimbursement remains source-disabled, and no outcome schedule was added |

The initial entity deployment exposed unsupported `$contains` array-membership
RLS in Message and SharedDocument. Draft PR `#143` replaces it with Base44's
accepted `data.<array>.$in` form and adds a repository-wide operator contract.
Both PR workflows pass. The remaining function source upload requires explicit
authorization for the staging destination before the hosted batch can resume.

## Deliberate merge decisions

- Kept the newest Smart Note, visit preparation, medication reconciliation,
  referral upload, documentation review, OASIS safety, security, and responsive
  navigation work from PennSync2.
- Preserved CareMetric's entire `ios/` directory and full PWA manifest, then
  corrected the checked-in Xcode bundle identifier to the existing App Store
  bundle.
- Excluded `.base44/environment.json`, `.pnpm-store/`, and post-feature sandbox
  Docker configuration.
- Regenerated `pnpm-lock.yaml` with pnpm 11.9.0 and made both CI and Base44 use a
  frozen lockfile.
- Fixed the imported invitation lifecycle regression: invitations remain
  pending until a matching user is updated and approved.
- Kept the new OASIS v2 feature default OFF.

## Release blockers

Do not deploy this branch, move domains, enable OASIS v2, register new scheduled
functions, or upload a native binary until all of these are complete:

1. Create a separate nonproduction Base44 app and prove the changed entity RLS,
   functions, authentication, uploads, and shared-patient workflows there.
2. Keep `oasis_response_schema_v2_enabled` false. Complete named clinical SME
   review, patient-access enforcement, remaining consumer wiring, and hosted RLS
   proof before any agency activation. Source now locks `OASISAssessment` and
   PHI-bearing `OASISUpload` writes to service role, hard-pauses
   `saveOasisResponses` with HTTP 503 before client creation/data access, and
   disables both browser legacy/v2 save adapters. The quick-upload widget is
   static so a PHI PDF cannot be stored before entity creation fails; dormant
   analyzer-update and supervisor-approval writers fail closed under the RLS
   rule and must not be restored directly. First build and stage a server-owned
   tenant + patient/chart authorization broker, including duplicate response
   rejection and upload/update/approval operations. Browser
   patient merge controls are now hard-paused before browser data access or
   mutation, and `deduplicatePatients` rejects every preview/apply request with
   HTTP 503 before client creation, authentication, or service-role patient
   reads. The old "dry-run" also depended on mutable claims and could expose
   cross-tenant PHI. A tenant-authoritative transactional server broker must
   atomically identify and move OASIS/outcome and every other linked row before
   either scanning or merging can return.
3. Keep `computeOutcomeMeasures` paused in production. The candidate source is
   internal-secret-only; it requires one explicit `agency_id`, stable
   `period_start`/`period_end`, and explicit supported `period_type` (including
   `custom` for non-calendar windows), scopes every service-role query, write, and
   retirement to that agency, and rejects foreign rows returned by the backend.
   Browser outcome reads/recompute and the Reports outcome summary are disabled
   meanwhile. The emitted rates are unadjusted internal proxies, not official
   CMS results. Deployment is still blocked until all of the following are
   proved in the nonproduction Base44 app:
   - hosted schemas accept the new optional tenant keys on `Patient`,
     `OASISAssessment`, `OASISUpload`, and `PatientOutcomeMetric`, the AgencyKPI
     lifecycle fields, and `internal_gg_18_item_raw_sum` (an explicitly non-CMS
     context value); stage and validate compatibility/migration for the existing
     `measure_results[].start_value`/`discharge_value` number-to-string change;
   - every Patient/OASIS assessment/upload create path stamps a server-verified
     agency id, and an audited backup + backfill assigns existing rows without
     guessing (legacy unscoped rows deliberately remain excluded and untouched);
   - every assessment writer rejects duplicate normalized item/definition rows,
     stamps verified definition/instrument provenance, and cannot be bypassed by
     a direct owner/admin entity update;
   - source read/write RLS for `PatientOutcomeMetric` and `AgencyKPI` is now
     service-role-only; prove it is enforced when hosted, then add an authorized
     server broker before restoring any tenant outcome UI;
   - replace self-mutable User `agency_id`/`account_type` and globally
     admin-writable Agency membership with a server-owned tenant authority;
     Patient/OASIS admin-like RLS must also become tenant-bound;
   - replace the old global nightly invocation (`{}`) with secret-authenticated,
     one-agency requests carrying `{ agency_id, period_start, period_end, period_type }` for
     stable windows, including a defined rerun/retirement policy for windows
     whose discharges were removed or reassigned;
   - add pagination/checkpoint/time-budget handling for the serial N+1 sweep.
     Source now fails closed with HTTP 409 if the 5,000-discharge cap is reached
     and reports a 50-prior-row pairing-cap skip, but it cannot complete those
     cohorts until paging/checkpointing exists;
   - add datastore-enforced uniqueness or an atomic idempotency/lease strategy
     for patient-episode metrics and agency/measure/period KPIs. The source
     reconciles already-visible duplicates but concurrent query-then-create
     invocations can still race. Add run-level atomicity/reconciliation as well:
     a later read/write failure can leave earlier idempotent episode writes in
     place even though the run returns 500;
   - define explicit unset/retirement semantics for reruns whose partial source
     episode no longer supplies optional `discharge_disposition`,
     `primary_diagnosis`, or `internal_gg_18_item_raw_sum`. A partial merge must
     not silently retain a stale value from an earlier calculation; and
   - restore the OASIS Quality section and Reports outcome summary only through
     the proved tenant authorization boundary, with current calculation-version
     and lifecycle filters. They intentionally perform no direct entity reads now.
4. Keep all PennSync PDGM reimbursement amounts disabled. The candidate now
   fails closed with `paymentAvailable:false`, `totalPayment:null`,
   `caseMixWeight:null`, and an actionable **Unavailable — not $0** result in
   every active UI/export consumer. A stored `is_official` flag cannot re-enable
   the legacy estimator, and rate-config writes cannot set it. Payment may be
   enabled only after all of the following are complete:
   - replace the factorized clinical × functional × comorbidity estimator with
     the source-verified CMS HHGS assignment into one of the official 432 groups
     and that group's official case-mix weight;
   - add CMS golden-case tests that prove grouping and payment parity for the
     applicable payment year, including wage-index and adjustment behavior;
   - add source-verified v2 definitions and scoring treatment for M1800, M1810,
     M1820, and M1850 (do not infer them from legacy numeric labels);
   - resolve clinician-selected responses server-side from an authorized,
     tenant-scoped v2 OASIS assessment with protected provenance rather than
     trusting caller-supplied `response_schema_id` / `response_origin`; and
   - establish immutable hosted tenant authority for PDGM rate configuration.
     `PDGMRateConfig` is source-locked to service-role reads and platform-owner
     writes meanwhile; hosted Agency membership/RLS still requires proof before
     facility-admin rate editing can be restored.
5. Reconcile Apple/Google privacy disclosures with the clinical data actually
   handled by the app.
6. Recover and verify the original iOS and Android signing/build projects,
   in-app-purchase behavior, and store credentials before any native upload.
7. Run physical-device tests on the currently installed App Store and Play Store
   apps against the staged web release: cold launch, login, Smart Note,
   camera/microphone, uploads, downloads, telehealth, session persistence, and
   subscriptions.
8. Back up production data, document rollback, deploy frontend/functions/schema
   in a coordinated window, and smoke-test both permanent and custom origins.

Only after those gates pass should `pennsync.com` and `app.pennsync.com` be moved
from the old Base44 app to the CareMetric app. Keep the old repositories and old
Base44 app read-only until both domains and installed mobile apps have been
observed healthy through the rollback window.
