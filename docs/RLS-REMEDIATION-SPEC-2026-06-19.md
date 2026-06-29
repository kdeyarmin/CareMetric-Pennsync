# Entity RLS Remediation Spec — 2026-06-19

Per-entity row-level-security recommendations for the PHI/private entities that currently ship
with **no `rls` block** (or an open one). This complements `docs/SECURITY-RLS-CHECKLIST.md` §2
and the audit in `docs/CODE_REVIEW_2026-06-19.md`.

**Why this is a spec, not a code change.** The repo RLS DSL only matches a field on the row to
`{{user.email}}` (or `user_condition.role`); it has no cross-entity join. The documented model for
patient-clinical data is *"by patient access"* (`Patient.assigned_nurses` includes the caller),
but these rows carry only `patient_id` — so a pure-repo rule can only owner-scope by `created_by`,
which would hide a colleague's entries from an assigned nurse and break shared clinical views
(e.g. the medication list). Apply these in the **Base44 dashboard** (where richer relation-based
rules and the service-role principal are available) and verify with checklist §7 (multi-role test
of raw network responses) before launch.

**Already applied in-repo (safe subset):** `OfflineDataCache` (read+write `user_email` +
admin), `SystemLog` (write → admin), `Message` (write → sender ∨ recipient ∨ admin),
`TeamNote` (write → `created_by` + admin; read still needs the patient-access rule below),
**`ScheduledFax`** (read+write → `created_by` + admin — verified no client path exists; dispatch
crons use service-role), and **`DocumentPackageToken`** (read → `signer_email` + admin since the
only in-app reader `DocumentAuditLogs` is `adminOnly`; write → `signer_email` ∨ `created_by` ∨ admin
to cover the in-app token creator; external signers reach it via service-role backend functions).

**Verified UNSAFE to owner-scope in-repo (need the dashboard relation rule, NOT a `created_by`/`sent_by`
field rule):** `FaxLog` (nurses share a per-patient fax history across senders, and `OCRReviewPanel`
updates a fax it didn't send) and `DocumentSignature` (shared per-patient signature views, the public
`/signer` portal does a client `.get`, and several creates omit `created_by_email`/set `'system'`).
`TrainingCompletion` / `MicroLearningProgress` likewise stay a dashboard task: there is **no**
service-role writer to route through (so a service-role-only write rule would break ~16 client write
sites including self-completion); the workable rule is **write `owner(nurse_email)` + admin, read open**
(or read `owner(nurse_email)`+admin only after confirming every staff-overview/assignment component —
`AgencyTrainingManager`, `TrainingCompletionTracker`, `StaffTrainingOverview`, … — is admin-gated via §7).

Notation: `byPatient` = caller is admin OR is in the referenced patient's `assigned_nurses`
(implement as a relation rule in the dashboard, or a server-scoped function for the shared view —
the app already does this in `getScopedPatientAlerts`/`getDashboardData`). `owner(field)` =
`{ $or: [ {field: "{{user.email}}"}, {user_condition:{role:"admin"}} ] }`.

## A. Patient-clinical — read `byPatient`, write clinician-on-own-patient + admin

| Entity | Owner/link field(s) | Read | Write |
|---|---|---|---|
| `Medication` | `patient_id`, `created_by` | byPatient | byPatient (clinician) + admin |
| `MedicationReconciliation` | `patient_id`, `reconciled_by` | byPatient | service-role / clinician + admin |
| `OASISUpload` | `patient_id`, `created_by` | byPatient | byPatient + admin |
| `OASISAssessment` | `patient_id`, `completed_by` | byPatient | owner(`completed_by`) + admin |
| `DischargeSummary` | `patient_id`, `generated_by`/`reviewed_by` | byPatient | owner(`generated_by`) + admin |
| `Document` | `patient_id`, `uploaded_by` | byPatient | owner(`uploaded_by`) + admin |
| `Referral` | `patient_id`, `created_by`/`assigned_to` | byPatient (or owner where pre-patient) | owner + admin |
| `ClinicalEvent` | `patient_id`, `verified_by` | byPatient | service-role / clinician + admin |
| `PatientAlert` | `patient_id`, `assigned_to` | byPatient | service-role / fns |
| `PatientRiskAssessment` | `patient_id`, `reviewed_by` | byPatient | service-role / clinician + admin |
| `CareCoordinationAlert` | `patient_id`, `assigned_to` | byPatient | service-role / fns |
| `CarePlanProposal` | `patient_id`, `assigned_nurse`/`created_by` | byPatient | owner + admin (mirror `CarePlan`) |
| `PatientRecommendation` | `patient_id`, `reviewed_by` | byPatient | service-role / fns |
| `OASISActionItem` / `OASISWorkflowExecution` / `OASISFeedback` | `patient_id`/`patient_name` | byPatient (or admin-only like `OASISAudit`) | service-role / admin |
| `SentEducationMaterial` / `PatientEducationAssignment` / `PatientEducationDelivery` | `patient_id`, `sent_by`/`assigned_by`/`delivered_by` | byPatient | owner + admin |
| `FaxDraft` | `patient_id`, `created_by` | byPatient (or owner) | owner + admin |
| `DocumentPackage` | `patient_id`, `signer_email`/`created_by` | byPatient + signer | owner + admin |
| `NoteConversion` | `patient_id`, `nurse_email` | byPatient (or owner) | owner(`nurse_email`) + admin |
| `TeamNote` (read) | `patient_id`, `created_by` | byPatient | (write already `owner(created_by)`+admin in-repo) |

## B. Owner-scoped — read+write `owner(field)`

| Entity | Field | Rule | Note |
|---|---|---|---|
| `FaxLog` | `sent_by` | owner(`sent_by`) | Checklist §2 mandates "owning sent_by + admin" read; faxes are per-sender. Confirm `ComprehensiveFaxDashboard` is admin-only (it does a global `.list()`). |
| `ScheduledFax` | `created_by` (no domain owner) | owner(`created_by`) | Sibling `ScheduledSms` scopes by `nurse_email`; dispatch crons use service-role (RLS-bypassing) so they're unaffected. |
| `DocumentSignature` | `created_by_email` | owner(`created_by_email`) | External signers reach it via token-scoped backend functions (service-role), not direct RLS — verify those still work. |
| `DocumentPackageToken` | `signer_email` | owner(`signer_email`) + admin | Token grants package access. |

## C. Training attestation — read self + admin, write service-role only

| Entity | Field | Read | Write |
|---|---|---|---|
| `TrainingCompletion` | `nurse_email` | owner(`nurse_email`) | service-role only (route through `gradeTrainingAttempt`) |
| `MicroLearningProgress` | `nurse_email` | owner(`nurse_email`) | service-role only |

(Their siblings `TrainingAttempt`/`TrainingCertificate`/`TrainingAttestation` are already scoped —
mirror them. Checklist §2 already flags these as forgeable attestation.)

## Verification (checklist §7, run after applying)

1. Non-admin with no assigned patients → Dashboard / Patient Alerts / SMS / fax history return
   **nothing** (check raw network responses, not just the rendered UI).
2. Non-admin assigned to patient A only → sees A's rows, **not** B's, in raw responses.
3. Admin → agency-wide unchanged.
4. IDOR probe (`enhanceNoteOptimized`, `searchPDFs`, `extractReferralDataForSmartNote`, etc.) with
   another patient's id → `403`/`404`/empty (the code-layer gates added this PR already enforce this).
5. Recipient can still mark a `Message` read (`read_by` update) and a signer can still sign a
   `DocumentSignature` via the portal — confirm the owner-scoping didn't break those flows.
