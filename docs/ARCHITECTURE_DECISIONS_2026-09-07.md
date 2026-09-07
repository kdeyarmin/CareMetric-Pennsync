# Staging fixture, content scope, and physician ownership decisions

Date: 2026-09-07
Status: accepted source direction; migration and hosted activation remain blocked

This record resolves three ownership choices needed by draft PR #143. It does
not authorize production changes, workflow activation, outbound delivery, a
domain move, or loading PHI.

## 1. LR-01/LR-02 fixture: synthetic-only staging bootstrap

The only approved fixture topology is
`lr01-lr02-two-agency-v1` in Base44 app
`6a9881683dc68a0bd54f1ef7` at the origin pinned by
`docs/audits/live-readiness-fixture-manifest.template.json`.

The source contract in `src/lib/tenantArchitecture.js` requires four distinct
non-owner test identities, two agencies, three synthetic patients, and only the
A1-to-Clinician-A assignment. Passwords, tokens, provider secrets, and
production PHI are not part of the fixture plan. `StagingReadinessFixture` is a
service-only metadata registry for a future one-time bootstrap and teardown.

The registry does not make provisioning safe by itself. Base44 still lacks a
documented unique/create-if-absent or cross-entity transaction for membership,
patient, and assignment creation. Test users also cannot be created as verified
password users through a reviewed no-email SDK path. Consequently:

- no bootstrap function is enabled or deployed by this decision;
- `managePatientCareTeamAssignment` remains literally paused;
- fixture creation must not use direct entity CRUD as a substitute for the
  reviewed brokers; and
- LR-01/LR-02 remain incomplete until the exact authenticated hosted evidence
  matrix and teardown evidence exist.

## 2. Reusable content: hybrid global and agency ownership

Reusable content uses one of two immutable scopes:

- `global`: platform-curated content shared across tenants; or
- `agency`: private content belonging to exactly one Agency.

`ContentScopeBinding` holds service-owned provenance for the six legacy scope
roots: CustomValidationRule, EducationMaterial, LearningPlan, LibraryDocument,
PDFTemplate, and TrainingCourse. LearningPlanCourse inherits only from its exact
LearningPlan parent, and TrainingModule inherits only from its exact
TrainingCourse parent. Child records never choose an independent tenant.

Direct CRUD on the binding is denied. Existing content is not automatically
classified: every legacy row must be reviewed, bound, or quarantined before a
positive read/write broker replaces current direct browser access. This avoids
guessing tenant ownership from mutable profile data or creator email. Embedded
TrainingModule answer keys are now field-level read/write denied; learner review
must use a purpose-bound server projection.

## 3. Physician directory: shared master plus agency-private overlay

The existing Physician record is the future shared identity/master layer for
public professional and practice facts. `PhysicianAgencyProfile` is the private
tenant overlay for agency preferences, relationship notes, tags, active state,
and referral metrics. Direct overlay CRUD is denied.

The exact field split is encoded in `src/lib/tenantArchitecture.js`. The 420
legacy Physician rows are not migrated by this decision because their tenant
provenance is not established. Before activation, a reviewed broker must:

1. resolve or create a canonical shared master without duplicate-NPI races;
2. authorize the caller from immutable AgencyMembership state;
3. create/update one exact agency overlay with conditional-write guarantees;
4. return a projection that combines only the caller's overlay with the master;
5. increment referral metrics atomically; and
6. quarantine ambiguous legacy rows rather than assigning them heuristically.

## Release boundary

These schemas and contracts are a fail-closed foundation. They intentionally do
not claim hosted parity, migration completion, atomicity, authenticated RLS
proof, or production readiness. The existing PR #143 release blockers and all
application/workflow/outbound gates remain in force.
