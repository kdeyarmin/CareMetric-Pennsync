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

`src/lib/liveReadinessFixtureManifest.js` remains the canonical, deeply frozen
topology source. `src/lib/tenantArchitecture.js` derives (rather than
redeclares) its four distinct non-owner identity bindings, two agencies, three
synthetic patients, and sole
A1-to-Clinician-A assignment from that canonical model. Passwords, tokens,
provider secrets, and production PHI are not part of the fixture plan.
`StagingReadinessFixture` is a service-only metadata registry for a future
one-time bootstrap and teardown. Its present shape records actor, Agency,
Patient, and assignment ids but not the Referral and Visit ids produced by S3
and S4; deterministic teardown is therefore still blocked.

The source now also contains `preflightStagingReadinessFixture`, a default-off,
protected-platform-owner, read-only preflight. It validates the exact staging
app/origin/release sentinel and production data partition, strips caller-supplied
SDK routing/state headers, checks the four immutable User id/email bindings and
approval state, checks canonical Agency-code collisions, and detects an existing
registry row or immutable-ID-linked membership, patient, and care-team-assignment
rows using bounded projections. It performs a terminal owner/target check after
the final inspection. Its response is explicitly a
`point_in_time_read_only_preflight_passed` result and contains fixed aliases,
states, counts, and false side-effect flags. It does not reserve Agency codes,
inspect legacy email/profile links, or prove login credentials, datastore
uniqueness, transactionality, or authorization for a later write. The function
may be present in a staging deployment, but its release sentinel stays disabled;
it must not be invoked or counted as LR-01/LR-02 evidence without approval.

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
No runtime content broker currently enforces these bindings; source-contract v4
reports `content_scope_runtime_enforcement_present: false` explicitly.

Direct CRUD on the binding is denied. Existing content is not automatically
classified: every legacy row must be reviewed, bound, or quarantined before a
positive read/write broker replaces current direct browser access. This avoids
guessing tenant ownership from mutable profile data or creator email. Embedded
`TrainingModule.content.quiz_questions[].correct_answer` and the answer-bearing
`TrainingCourse.pre_assessment_json` / `brain_sparks_json` payloads are now
field-level read/write denied. Hosted nested field-RLS effectiveness is not yet
proved, and generic `TrainingModule.content` / `content_json` can still carry
untyped answer material. Learner delivery therefore remains blocked on a
purpose-bound sanitized server projection and hosted proof.

This is source direction, not a CRUD decision. Human approvers still need to
decide create/read/update/delete separately, reconcile and migrate every direct
consumer, and classify legacy rows. `LearningPlanCourse.plan_id` is the exact
parent link; `TrainingModule.course_id` is the exact parent link but is not yet
schema-required, so orphan handling remains unresolved. `PDFTemplate` version
families, packet references, and parent-template scope compatibility also remain
unresolved. `TrainingCourse` is companion scope debt outside the eight-schema
no-RLS queue: 15 user-scope and 14 service-role source files access it, while its
published global read is incompatible with agency-private bindings.

## 3. Physician directory: shared master plus agency-private overlay

The existing Physician record is the future shared identity/master layer for
public professional and practice facts. `PhysicianAgencyProfile` is the private
tenant overlay for agency preferences, relationship notes, tags, active state,
and referral metrics. Direct overlay CRUD is denied.

The exact field split is encoded in `src/lib/tenantArchitecture.js`. Legacy
`Physician.is_active` is translated explicitly into the overlay's service-owned
`status` (`active` or `inactive`); when that legacy flag is absent, the overlay
remains fail-closed as `quarantined`. `is_active` is not a persisted
`PhysicianAgencyProfile` field. The 420 legacy Physician rows are not migrated
by this decision because their tenant provenance is not established. Before
activation, a reviewed broker must:

1. resolve or create a canonical shared master without duplicate-NPI races;
2. authorize the caller from immutable AgencyMembership state;
3. create/update one exact agency overlay with conditional-write guarantees;
4. return a projection that combines only the caller's overlay with the master;
5. increment referral metrics atomically; and
6. quarantine ambiguous legacy rows rather than assigning them heuristically.

## Release boundary

Auxiliary tenant analytics also remain deliberately unavailable where the UI
would otherwise need raw `ComplianceAudit`, `NoteConversion`, or
`TrainingAssignment` rows; tenant-authorized aggregate brokers do not yet exist.
Browser filtering of `Incident` and `User` after a trusted-context match is an
interim boundary, not the final server-side aggregate/read design.

These schemas, the default-off read-only preflight, and readiness
source-contract v4 form a source-only fail-closed foundation. v4 is the true
union of the readiness and tenant-architecture artifact families and pins the
canonical topology, architecture contracts, new authority schemas, and all
content schemas. Its source-marker and regex checks are regression tripwires,
not formal interprocedural containment proofs. None of this claims hosted
parity, migration completion, atomicity, authenticated RLS proof, or production
readiness. The existing PR #143 release blockers and all
application/workflow/outbound gates remain in force.
