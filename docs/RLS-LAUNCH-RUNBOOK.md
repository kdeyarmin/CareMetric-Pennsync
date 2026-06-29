# RLS Launch Runbook (executable)

> Turns `SECURITY-RLS-CHECKLIST.md` §2 and `RLS-REMEDIATION-SPEC-2026-06-19.md` into a
> **do-this-in-order** checklist for the Base44 dashboard. This is the **#1 go-live
> blocker**: in this app client-side role checks are cosmetic, so RLS is the only real
> access boundary for PHI. Work top to bottom, then run §5 verification before launch.

## 0. Before you start

- **Where:** Base44 dashboard → each entity → Security / Row-Level Security. The repo
  `.jsonc` RLS DSL can only match a field on the row to `{{user.email}}` or a role; it
  has **no cross-entity join**, so the patient-scoped rules below must be authored in
  the dashboard (relation rules) or enforced by a server-scoped function. Do **not**
  try to express the `byPatient` rule as a `created_by` field rule — that hides a
  colleague's entries from an assigned nurse and breaks shared clinical views.
- **Two rule primitives used below:**
  - `owner(field)` = `{ $or: [ { field: "{{user.email}}" }, { user_condition: { role: "admin" } } ] }`
  - `byPatient` = caller is admin **OR** caller's email ∈ the referenced patient's
    `Patient.assigned_nurses`. Author as a dashboard relation rule; where a shared view
    needs it server-side, the app already does this in `getScopedPatientAlerts` /
    `getDashboardData`.
- **service-role** = clients cannot write directly; the write happens only inside a
  backend function running `asServiceRole`.
- **Default deny:** if an entity is not listed here and holds anything non-public, lock
  read+write to `owner(created_by)` + admin until reviewed. Never leave PHI open.

---

## 1. Already enforced in-repo — VERIFY only (do not re-author)

These ship with an `rls` block in `base44/entities/*.jsonc`. Confirm the dashboard
reflects them; no new work unless the dashboard disagrees.

`Patient`, `Visit`, `CarePlan`, `Incident`, `CallLog`, `SmsMessage`, `SmsConsent`,
`ScheduledSms`, `ScheduledFax`, `SecurityLog`, `UserActivity`, `Notification`, `Task`,
`TeamNote` (write), `Message` (write), `TelehealthSession`, `DocumentPackageToken`,
`PhoneNumber`, `IntegrationSecret`, `OfflineDataCache`, `SystemLog`, `PDGMRateConfig`,
`AgencySettings`, `OnCallShift`, `TimeOffRequest`, `PersonnelCredential`,
`TrainingAttempt`, `TrainingAttestation`, `TrainingCertificate`, `TrainingAssignment`,
`TrainingCourse`, `TrainingTemplate`, `DocumentTemplate`, `DocumentVersion`,
`CorrectiveActionPlan`, `OASISAudit`, `OASISAutomationRule`, `AutomaticCarePlanTrigger`,
`ClinicalPathway`, `MedicareGuideline`, `RegulatoryUpdate`, `ReminderLog`,
`NurseGoal`, `Announcement`, `AIConfiguration`, `PendingPatientUpdate`, `UserInvitation`.

**Spot-check these high-sensitivity ones explicitly:**
- `CallLog` / `SmsMessage` — read limited to owning `nurse_email` + admin (bodies/legs
  are PHI).
- `SmsConsent` — admin + service-role only (TCPA ledger).
- `SecurityLog` / `UserActivity` — admin (+ self where applicable); confirm **not**
  broadly readable and carries no PHI.
- `IntegrationSecret` — service-role + admin only (holds Telnyx creds).

---

## 2. Patient-clinical entities — author `byPatient` (the bulk of the work)

For every entity below: **Read = `byPatient`**, **Write = clinician-on-own-patient +
admin** (or service-role where noted). These currently have **no in-repo block** and
are the largest body of outstanding work.

| Entity | Link field | Write |
|---|---|---|
| `OASISUpload` | `patient_id` | byPatient + admin |
| `OASISAssessment` | `patient_id` | owner(`completed_by`) + admin |
| `DischargeSummary` | `patient_id` | owner(`generated_by`) + admin |
| `Document` | `patient_id` | owner(`uploaded_by`) + admin |
| `Referral` | `patient_id` | owner(`created_by`/`assigned_to`) + admin |
| `ClinicalEvent` | `patient_id` | service-role / clinician + admin |
| `PatientAlert` | `patient_id` | service-role / fns |
| `PatientRiskAssessment` | `patient_id` | service-role / clinician + admin |
| `CareCoordinationAlert` | `patient_id` | service-role / fns |
| `CarePlanProposal` | `patient_id` | owner(`assigned_nurse`/`created_by`) + admin |
| `PatientRecommendation` | `patient_id` | service-role / fns |
| `OASISActionItem` | `patient_id` | service-role / admin |
| `OASISWorkflowExecution` | `patient_id` | service-role / admin |
| `OASISFeedback` | `patient_id`/`patient_name` | service-role / admin |
| `NoteConversion` | `patient_id` (owner `nurse_email`) | owner(`nurse_email`) + admin |
| `SentEducationMaterial` | `patient_id` | owner(`sent_by`) + admin |
| `PatientEducationAssignment` | `patient_id` | owner(`assigned_by`) + admin |
| `PatientEducationDelivery` | `patient_id` | owner(`delivered_by`) + admin |
| `FaxDraft` | `patient_id` | owner(`created_by`) + admin |
| `DocumentPackage` | `patient_id` (+ signer) | owner(`created_by`) + admin |
| `TeamNote` (read) | `patient_id` | (write already owner+admin in-repo) |
| `ComplianceAudit` | `patient_id` where present | service-role / admin |

> If authoring a true relation rule per entity is too slow for launch, the safe interim
> is to route the **reads** through a server-scoped function (like `getDashboardData`)
> and lock the entity's direct client read to admin-only — never leave it open.

---

## 3. Owner-scoped entities — author `owner(field)` (no patient join needed)

| Entity | Field | Read | Write |
|---|---|---|---|
| `FaxLog` | `sent_by` | owner(`sent_by`) | owner(`sent_by`) + service-role |
| `DocumentSignature` | `created_by_email` | owner(`created_by_email`) + signer | owner + admin; external signers write via token-scoped service-role fns |
| `User` | self | self + admin | admin / provision fn; **`personal_cell_e164` = service-role + admin only** |
| `NotificationPreference` | `user_email` | owner(`user_email`) | owner(`user_email`) |

> `FaxLog`/`DocumentSignature` are flagged in the spec as **unsafe to owner-scope via a
> bare `created_by` field rule** because of shared per-patient views and the external
> signer portal. Author them in the dashboard with the relation/token exceptions, and
> confirm the fax dashboard and the reachable signature surfaces (the
> **DocumentSignatures** hub tab / **SignatureTracking**, both patient-scoped) plus the
> external `/signer` portal flow still work in §5.5.

---

## 4. Training attestation — read self + admin, write service-role only

Without this lock, mandatory-education completions/scores are **forgeable** (clients
write them directly today). Route writes through `gradeTrainingAttempt` /
`issueCertificate` (set `INTERNAL_FN_SECRET` so the lockdown activates).

| Entity | Field | Read | Write |
|---|---|---|---|
| `TrainingCompletion` | `nurse_email` | owner(`nurse_email`) + admin | service-role only |
| `MicroLearningProgress` | `nurse_email` | owner(`nurse_email`) + admin | service-role only |

> Spec caveat: there is currently **no** service-role writer for these two, and ~16
> client write sites include self-completion — so a service-role-only write rule must be
> paired with routing those writes through a function, or it will break self-completion.
> If that routing isn't ready for launch, the workable interim is **write
> owner(`nurse_email`) + admin** (still blocks forging *another* user's completion) and
> schedule the service-role migration as fast-follow. Decide explicitly; don't ship the
> default-open state.

---

## 5. Verification — the launch gate (checklist §7, run after applying)

Run against **raw network responses** (browser devtools / API), not just the rendered
UI — the UI filters client-side and will look correct even when RLS is open.

1. **Non-admin, no assigned patients:** Dashboard, Patient Alerts, SMS inbox, fax
   history, signatures all return **empty** — and the raw responses contain no other
   patients' rows.
2. **Non-admin assigned to patient A only:** sees A's rows, **not** B's, in raw
   responses (Visit, OASIS, alerts, faxes, signatures).
3. **Admin:** agency-wide data unchanged.
4. **IDOR probe:** call `predictPatientRisks`, `analyzeClinicalRisks`,
   `generatePatientChartPDF`, `getScopedPatientAlerts`, `enhanceNoteOptimized`,
   `searchPDFs`, `extractReferralDataForSmartNote` with **another** patient's id →
   expect `403`/`404`/empty.
5. **Don't-break checks:** a Message recipient can still mark it read (`read_by`
   update); a signer can still sign via the `/signer` portal; the admin fax dashboard
   and the **DocumentSignatures** hub tab / **SignatureTracking** (the reachable,
   patient-scoped signature views) still load; a nurse can still see a colleague's
   entry on a **shared** patient (confirms you used `byPatient`, not `created_by`).
6. **Attestation:** with `INTERNAL_FN_SECRET` set, a direct `issueCertificate` from a
   non-admin is rejected; legitimate completion via `gradeTrainingAttempt` still issues.
7. **Audit cleanliness:** `UserActivity`/`SecurityLog` rows carry no PHI (no bodies, no
   full phone numbers).

**Sign-off:** all 7 pass → RLS gate cleared. Any failure on 1–4 is a **launch
blocker**; failures on 5 mean a rule is too tight (fix before launch but not a security
hole).
