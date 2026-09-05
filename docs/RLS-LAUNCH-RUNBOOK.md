# RLS Launch Runbook (executable)

> Turns `SECURITY-RLS-CHECKLIST.md` §2 and `RLS-REMEDIATION-SPEC-2026-06-19.md` into a
> **do-this-in-order** checklist for the Base44 dashboard. This is the **#1 go-live
> blocker**: in this app client-side role checks are cosmetic, so RLS is the only real
> access boundary for PHI. Work top to bottom, then run §5 verification before launch.

## 0. Before you start

- **Where:** Base44 dashboard → each entity → Security / Row-Level Security. The repo
  `.jsonc` RLS DSL cannot prove immutable membership or care-team authority across
  entities. Sensitive positive reads must use reviewed server brokers; direct entity
  access remains denied unless a narrower rule is separately proved.
- **Authority primitives used below:**
  - `platformOwner` = built-in `User.role === "admin"` **and** exact backend
    `SUPER_ADMIN_EMAIL`; setup/recovery only, excluded from tenant assertions.
  - `tenantMember(role)` = built-in `User.role === "user"` plus one active,
    server-owned `AgencyMembership` bound to immutable `user_id` and the requested
    tenant role.
  - `byPatient` = valid tenant membership plus an active, server-owned
    `PatientCareTeamAssignment` (or reviewed agency-wide tenant-admin policy),
    evaluated inside a broker. `Patient.assigned_nurses` and mutable User claims are
    defense-in-depth only.
  - `owner(field)` is only an additional narrowing check; it is never tenant authority.
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

## 2. Patient-clinical entities — broker `byPatient`; deny direct client access

For every entity below, positive tenant reads must be served by a reviewed broker
that resolves `tenantMember` and `byPatient`; direct client reads stay denied.
Table references to “admin” mean tenant `agency_admin` authority inside that broker,
never Base44 built-in `role:admin`. Writes remain service-role/brokered as noted.

> **2026-07-02 update — interim in-repo read floor.** Seven of these now ship an
> in-repo `rls.read` owner rule (+ admin): `OASISUpload`, `OASISAssessment`,
> `OASISAudit`, `Referral` (created_by **and** `assigned_to`), `NoteConversion`,
> `Document` (uploaded_by + created_by), `DischargeSummary`. This was a deliberate
> accepted tradeoff (see `base44/securityGuardrails.test.js` §7): it closes the
> open bulk-read of PHI now, at the cost that non-admin staff see only their own
> rows on shared views — consistent with the app's actual role model, where
> `Patient`/`Visit` themselves are already `created_by`-scoped. A dashboard
> `byPatient` relation rule remains the richer end-state and may REPLACE these
> field rules; do not simply delete them (the guardrail test pins their presence).
> Mutation rules on this cohort were mechanically migrated from the ignored
> legacy `write` key to hosted `create`/`update`/`delete` keys. Several remain
> deliberately permissive pending the dashboard pass because their workflows
> are legitimately cross-user; this is tracked release-blocking debt, not a
> statement that the old key was enforced.
> `ClinicalEvent` was **excluded on purpose**: its rows are created only by the
> service role (no per-user owner field), so an owner rule would zero out every
> non-admin's clinical timeline — it still needs the dashboard relation rule.

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

> `User.staff_role` remains writable through the Base44 self-service `/entities/User/me`
> path, so `UserInvitation.staff_role` is the authoritative admin-written copy. Register
> the scheduled `enforceStaffRoleIntegrity` function in the Base44 dashboard (same
> `x-internal-secret: <INTERNAL_FN_SECRET>` convention as `docs/LEARNING_CENTER_SCHEDULED_JOBS.md`)
> to revert any non-admin self-write drift back to the invitation value.

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

1. **Clinician-A-empty:** built-in `user` + active Agency A `clinician` context;
   brokered roster and child-record reads are empty.
2. **Clinician-A:** one active immutable assignment permits A1 and denies unassigned
   A2 and foreign B1 in raw Patient/Visit/OASIS/Document broker responses.
3. **Admin-A/Admin-B:** built-in `user` + active tenant `agency_admin`; brokered
   rosters contain only Agency A's A1/A2 and Agency B's B1, respectively. The
   protected platform owner is excluded from this evidence.
4. **IDOR/cross-tenant probe:** spoof B1 and Agency B identifiers through every
   reviewed broker; expect `403`/`404`/empty. Direct entity reads by tenant actors
   must not return PHI or authority rows.
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

---

## 6. Hosted proof worksheet (LR-01)

Executable curl/seed matrix, cross-tenant probes, and evidence capture rules
live in **`docs/HOSTED-RLS-PROOF.md`**. This runbook applies policies; that
worksheet is what you fill when collecting LR-01 artifacts. Repository tests
never mark hosted isolation complete.
