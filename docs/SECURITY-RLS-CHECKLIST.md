# Security & RLS Launch Checklist

> **The single most important pre-launch fact:** in this app, client-side role
> checks and query filtering are **cosmetic** (UX only). The real access-control
> boundary is **Base44 row-level security (RLS)** configured per-entity in the
> Base44 dashboard, plus a handful of backend env secrets. The code in this repo
> assumes RLS is enforced; **none of it is a substitute for RLS.** This document
> consolidates everything the pre-launch review surfaced so it can be configured
> and verified.

## 1. Access model (derived from the codebase)

| Principal | Rule |
|---|---|
| **Admin** | `User.role === 'admin'` → may read/write across the agency. |
| **Nurse / clinician** | May access a patient only when `Patient.assigned_nurses` (array of emails) includes their email. Used by `SmsConversationList`, `ClinicalChart`, and the new `getScopedPatientAlerts` / `getDashboardData`. |
| **Record owner** | For per-user records, ownership is by `sent_by` / `nurse_email` (faxes, SMS, calls) or `user_id` (certificates). |
| `favorited_patients` | A **UX favorites** list only — never an authorization boundary. |

## 2. Entity RLS matrix (configure in the Base44 dashboard)

Lock **read** and **write** as below. Where it says "service-role only," clients
must not be able to write directly; writes go through backend functions.

| Entity | Read | Write | Notes |
|---|---|---|---|
| `Patient` | assigned nurse + admin | admin / intake fns | Drives all patient-scoped data. |
| `Visit`, `CarePlan`, `Incident`, `OASISUpload` | by patient access | clinician on own patients + admin | Feed the dashboard + clinical views. |
| `PatientAlert` | by patient access | service-role / fns | `getScopedPatientAlerts` enforces this server-side too. |
| `Medication`, `MedicationReconciliation` | by patient access | clinician + admin | |
| `User.personal_cell_e164` | **service-role + admin only** | admin/provision fn | Private masked-bridge target — never patient-facing. |
| `CallLog` | owning `nurse_email` + admin | service-role | Real call legs incl. cell. |
| `SmsMessage` (`body` = PHI) | owning `nurse_email` + admin | service-role / `sendSms` | |
| `ScheduledSms` (`body` = PHI) | owning `nurse_email` + admin | owner / `scheduleSms` + service-role | Queued future sends; `dispatchScheduledSms` writes via service-role. |
| `SmsConsent` | admin + service-role | service-role | TCPA opt-in/out ledger. |
| `FaxLog` | owning `sent_by` + admin | owner + service-role | Contains recipient + document URL (PHI). |
| `TelehealthSession` | host/participant + admin | host + admin | `createTelehealthToken` authorizes against it. |
| **`TrainingCertificate`, `TrainingCompletion`, `MicroLearningProgress`, `TrainingAssignment.status/score/completion_date`** | self + admin | **service-role only** | ⚠️ Clients currently write completion/score directly — without this lock, mandatory-education attestation is **forgeable**. Route writes through `gradeTrainingAttempt`. |
| `UserActivity`, `SecurityLog`, `AuditLog` | admin (+ self where applicable) | service-role | Audit trail; verify not broadly readable. |

## 3. Backend env secrets to set

Text/voice/video/fax credentials are configured in-app (IntegrationSecret via
Administration → Super Admin), the server-side file-fetch SSRF allowlist is
hardcoded in code (always-on), and the `onUserSignup` re-fetch/email-match guard
is always active. The dashboard-env secret list is therefore just:

| Secret | Purpose | If unset |
|---|---|---|
| **`SIGNATURE_HMAC_SECRET`** | Keys the e-signature integrity MAC (forgery-resistant tamper-evidence) | unkeyed sha256 — detects corruption, not forgery — **set it at launch** |
| `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `HEYGEN_API_KEY` | AI feature gates (transcription / SOAP notes / fax cover pages / training videos) | those features show a "not configured" notice |

All `VITE_*` vars are public by design — never put secrets there.

## 4. Scheduled / internal functions — scheduler authentication

**Resolved (2026-07): the platform does NOT restrict who can invoke function
endpoints.** Per the Base44 docs, every backend function "gets its own HTTP
endpoint for webhooks and external integrations" and authentication is enforced
only by code inside the function (the documented pattern is an in-function
`auth.me()` check) — there is no platform-level gate, so an arbitrary external
POST can reach any function URL. The earlier assumption that "the platform
restricts who can invoke function endpoints" is therefore **wrong**, and the
cron family now carries its own network-auth signal.

**The uniform gate (shared helper `requireSchedulerAuth`, generated into every
cron-family function):**

1. An authenticated **admin** may always invoke (manual "run now").
2. An authenticated **non-admin** is rejected `403`.
3. A **no-identity** caller (the scheduler path) is allowed **only if**
   `INTERNAL_FN_SECRET` is unset (pre-provisioning window) **or** the request
   carries a matching `x-internal-secret` header (constant-time compare).

**Set `INTERNAL_FN_SECRET` at launch** and configure every scheduled trigger to
send `x-internal-secret: <INTERNAL_FN_SECRET>`; until it is set, the anonymous
path is open and these endpoints can be triggered externally (sweeps are
idempotent and responses on that path must not echo PHI-adjacent data — e.g.
`sendDocumentReminderEmails` returns counts only, no package ids / signer
emails, to a no-identity caller).

The cron family (all gated identically — do not hand-roll per-function drift):
`processScheduledFaxes`, `processScheduledFaxesByPriority`,
`sendExpirationNotifications`, `sendPersonnelExpirationNotifications`,
`monitorComplianceRisks`, `scheduledGuidelineSync`, `autoApproveInvitedUser`,
`dispatchScheduledSms`, `dispatchScheduledSignatureReminders`,
`checkExpiredInvitations`, `checkPendingSignatureRequests`,
`sendAutomatedSignatureReminders`, `sendCredentialRenewalReminders`,
`sendDocumentReminderEmails`, `autoEndDutyDay`, `autoRetryFailedFaxes`,
`pollFaxStatuses`, `syncFaxStatuses`, `redriveFailedSms`,
`computeOutcomeMeasures`, `sendTrainingNotifications`, `sendRenewalReminders`,
`autoEnrollAnnualPlans`, `processTrainingRenewals`,
`processAnnualEducationRenewals`, `syncTrainingVideoStatuses`.

**Exceptions:** entity-trigger functions (`triggerCorrectiveActionPlan`,
`onDocumentSigned`, `notifyAdminOfSignedDocument`, `notifySignerOfPackage`,
`autoAssignNurseToPatient`) must **not** use the secret gate — platform triggers
cannot carry a custom header — and are hardened by canonical re-fetch instead.
`deduplicatePatients` is not a cron: it keeps a hard admin gate (destructive
merge, dry-run by default) and cannot run unattended.

- Enable **only one** scheduled-fax processor (`processScheduledFaxes` **or**
  `processScheduledFaxesByPriority`) — both running double-sends.
- Likewise enable **only one** schedule for `dispatchScheduledSms` (e.g. every
  5 min). Its `pending → sending` claim is best-effort, not atomic, so two
  overlapping runs could double-send a queued text.

## 5. Webhooks

- Point Twilio (inbound SMS, delivery status callbacks, inbound voice call, call
  status callbacks, and — if voicemail is enabled — the `handleTwilioVoicemail`
  recording callback) webhooks at the deployed function URLs, configured on each
  Twilio phone number's Voice and Messaging settings in the Twilio Console.
- Confirm `X-Twilio-Signature` validation (`verifyTwilioSignature`) — HMAC-SHA1
  over the full URL + sorted POST params keyed with the Auth Token. Test good
  signature → 200, bad → 401. If the app is behind a proxy set `TWILIO_WEBHOOK_URL`
  to the exact public URL so signatures compute correctly.
- Confirm webhook **idempotency**: inbound SMS de-dups on `provider_message_id`
  (Twilio `MessageSid`) and the call/voicemail handlers on `provider_call_id`
  (`CallSid`), so Twilio's automatic webhook retries can't double-process.
  (There is no body-timestamp replay guard — signature + idempotency are the
  defenses.)

## 6. New entity fields to create

- `User.scheduled_off_duty_start`, `scheduled_off_duty_end` (ISO strings),
  `scheduled_off_duty_recurring` (boolean)
- `AgencySettings.sms_quick_replies` (string array), `sms_templates` (object
  array), `voicemail_enabled` (boolean), `voicemail_greeting` (text)
- `CallLog.note`, `disposition`, `has_voicemail`, `voicemail_url`,
  `voicemail_duration_seconds`
- New `ScheduledSms` entity
- Twilio phone fields per `docs/twilio-entities.md`.

## 7. Verification (do before go-live)

1. As a **non-admin** with no assigned patients: the Dashboard, Patient Alerts,
   SMS inbox, and call history show **nothing** (and the network responses
   contain no other patients' data).
2. As a non-admin assigned to patient A only: you see A's data and **not** B's,
   including in raw network responses (not just the rendered UI).
3. As an **admin**: agency-wide data is unchanged.
4. Attempt an IDOR by calling `predictPatientRisks`/`analyzeClinicalRisks`/
   `generatePatientChartPDF`/`getScopedPatientAlerts` with another patient's id
   → expect `403`/`404`/empty.
5. Webhook smoke tests (good/bad signatures) per §5.
6. Confirm audit rows (`UserActivity`/`SecurityLog`) carry **no PHI** (bodies,
   full numbers).
7. A direct `issueCertificate` call from a non-admin with no passing
   `TrainingAttempt` is rejected (attempts are admin/service-role-write only);
   legitimate completion via `gradeTrainingAttempt` still issues a certificate.

## 8. Tracked follow-ups (code, post-launch)

- Complete the IDOR audit across the remaining `asServiceRole` single-patient
  reads once §1 is confirmed.
- Deterministic drug-interaction table is a **non-exhaustive backstop**
  (`src/components/medication/drugInteractions.js`) — expand over time; it does
  not replace a full interaction database.
- Medication reconciliation: consider a richer per-decision reconciled-med model.
