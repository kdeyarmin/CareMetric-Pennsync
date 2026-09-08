# RLS policy-decision worksheet — 2026-09-07

## Scope and guardrail

The eight entities below currently have no entity-level RLS. This worksheet records an accepted **source-direction model** and the decisions required before any policy is implemented; it does **not** approve CRUD authority, a policy, a migration, or continued open access. Every create/read/update/delete cell and every approver/date remains pending human review.

- Reviewed entity count: **8**
- Reviewed sorted-name SHA-256: `752d715c7ed58c0d0ed2250350e440adb8ff1a60f07ec88f9ddd9f4e112f8bd0`
- Enforced by: `base44/schemaContract.test.js`
- Contract behavior: a new undecided entity, a renamed/removed entity, or a new direct consumer file/authority/member fails the targeted schema contract until reviewed.

None of these schemas currently defines an immutable `agency_id` or membership-authority field. Some have creator or parent-record fields, but those are not, by themselves, an approved tenant boundary. Legacy-row ownership and backfill must therefore be decided before a tenant-bound rule is written.

The accepted source direction is hybrid content ownership: the six roots
`CustomValidationRule`, `EducationMaterial`, `LearningPlan`, `LibraryDocument`,
`PDFTemplate`, and `TrainingCourse` are either platform-curated `global` or
private to exactly one Agency via service-owned `ContentScopeBinding` provenance.
`LearningPlanCourse` may inherit only from its exact `LearningPlan.plan_id`;
`TrainingModule` may inherit only from its exact `TrainingCourse.course_id`.
That model does not authorize current direct access, classify legacy rows, or
prove hosted cross-entity enforcement.

## Current access surface and open decisions

“User scope” means direct `base44.entities.*` access. “Service role” means a backend `base44.asServiceRole.entities` access, including a local alias. Exact reviewed paths and SDK members are locked in the contract test.

| Entity | Reviewed direct consumers | Current operations observed | Ownership inputs present | Decisions that must be recorded |
| --- | ---: | --- | --- | --- |
| `CustomValidationRule` | 1 user-scope; 0 service-role | list, create, update, delete | No creator, tenant, or parent authority field | Global vs agency-owned rules; who administers them; whether all browser writes move behind a broker |
| `EducationMaterial` | 4 user-scope; 0 service-role | filter, create, update, delete | `created_by`; publication/template flags | Global catalog vs agency/user ownership; who may publish, duplicate, edit, and delete; legacy creator reliability |
| `LearningPlan` | 5 user-scope; 6 service-role | list, filter, create, update, delete | `created_by`; `business_line_scope`; year/type | Global vs agency-owned plans; admin/educator authority; auto-enrollment service-role boundary; legacy-plan ownership |
| `LearningPlanCourse` | 3 user-scope; 5 service-role | filter, create, update, delete | `plan_id` parent only | Whether authority must inherit from `LearningPlan`; safe parent lookup/atomicity; orphan and legacy-row handling |
| `LibraryDocument` | 1 user-scope; 0 service-role | list, create, update, delete | Category and active flag only | Global vs agency library; file visibility; uploader/editor/deleter authority; existing-file ownership |
| `PDFTemplate` | 4 user-scope; 0 service-role | list, filter, create, update, delete | `parent_template_id`; category/version flags | Global vs agency templates; version-family authority; signature/field-mapping sensitivity; browser mutation boundary |
| `Physician` | 4 user-scope; 1 service-role | list, filter, create, update, delete | Directory hierarchy fields, but no tenant authority | Shared master directory vs agency-specific records; contact/notes visibility; import/upsert collision rules; delete semantics |
| `TrainingModule` | 12 user-scope; 10 service-role | list, filter, create, update, delete, entity-handle pass-through | `course_id` parent; onboarding/active flags | Whether authority inherits from a course; learner read vs educator mutation; generation/video service roles; orphan and legacy rows |

### Companion scope debt outside the eight-schema queue

`TrainingCourse` already has entity-level RLS, so it is intentionally not added
to the fingerprinted no-RLS queue. It is nevertheless part of the same content
scope decision: the scanner currently finds **15 user-scope source files** and
**14 service-role source files**, and its published-record global read is
incompatible with agency-private `ContentScopeBinding` rows. Before the hybrid
model can activate, reviewers must inventory those consumers, replace direct
learner reads with a sanitized broker projection, and decide draft/publish CRUD
separately. Its `pre_assessment_json` and `brain_sparks_json` fields are
field-level read/write denied in source, but hosted nested-field enforcement is
still unproved.

`TrainingModule` remains a P0 blocker: it has no entity RLS, `course_id` is not
required, browser and service callers directly create/update/read it, and its
generic `content` / `content_json` shapes may carry answer material outside the
typed `correct_answer` field. `getCoursePlayerQuestions` and URL-driven course
loading require an exact bound-parent check in a purpose-bound sanitized broker.

`PDFTemplate` remains unresolved at the version family and packet level:
`parent_template_id`, packet document references, and version chains need exact
scope-compatibility rules before any inherited authority is accepted.

## Decision record

Complete one row per entity. The source direction above is not a substitute for
these human decisions. Do not infer an answer from the current UI or from
existing open access.

| Entity | Data owner/classification | Read authority | Create authority | Update authority | Delete authority | Broker required? | Legacy rows/backfill or quarantine | Approver and date | Evidence link |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `CustomValidationRule` | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending |
| `EducationMaterial` | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending |
| `LearningPlan` | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending |
| `LearningPlanCourse` | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending |
| `LibraryDocument` | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending |
| `PDFTemplate` | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending |
| `Physician` | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending |
| `TrainingModule` | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending |

## Required evidence before implementation

1. Identify the authoritative owner for both new and legacy rows, including how tenant membership is proven and revoked.
2. Decide `create`, `read`, `update`, and `delete` separately; choose whether each operation is direct, brokered, or denied.
3. Prove exact parent-derived authority for `LearningPlanCourse` and `TrainingModule`; resolve `PDFTemplate` version/packet families without assuming unsupported cross-entity RLS behavior.
4. Define a reversible backfill/quarantine plan and record counts before changing hosted schemas or policies.
5. Exercise an authenticated two-agency matrix for allowed access, cross-tenant denial, stale/revoked membership, forged ownership fields, and service-role callers.
6. Reconcile every direct consumer reported by the contract with the approved boundary. Only then implement RLS and deliberately remove the entity from the pending list, update its fingerprint, and attach the approval/evidence reference.
7. Retain a sanitized learner projection and hosted proof that no answer-bearing material escapes through `TrainingModule.content`, `content_json`, or TrainingCourse assessment payloads.
