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
| **Platform owner** | Sole exact `SUPER_ADMIN_EMAIL` identity with built-in `User.role === 'admin'`; setup/recovery only and excluded from tenant-isolation assertions. |
| **Tenant admin** | Built-in `User.role === 'user'` plus one active, server-owned `AgencyMembership.tenant_role === 'agency_admin'`; agency-wide access only inside reviewed brokers. |
| **Clinician** | Built-in `User.role === 'user'` plus one active immutable membership and, for patient-scoped access, an active server-owned `PatientCareTeamAssignment`. |
| **Record owner** | A narrowing condition such as immutable actor id/email; never a substitute for tenant membership and patient authority. |
| `favorited_patients` | A **UX favorites** list only — never an authorization boundary. |

## 2. Entity RLS matrix (configure in the Base44 dashboard)

In this document, tenant-admin access always means an active
`AgencyMembership.tenant_role === "agency_admin"` evaluated inside a
reviewed server broker. It never means Base44 built-in `role:admin`.
Sensitive direct entity reads remain denied.

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

## 4. Scheduled / internal functions — require shared scheduler auth

Base44's backend-function model answers the old open question here: deployed
`Deno.serve` functions get plain HTTP endpoints for webhooks/external
integrations, and the platform does **not** automatically block unauthenticated
POSTs. A cron/internal function must therefore NOT rely on a gate like
`if (user && !isAdmin) return 403`, because an unauthenticated caller can reach
the endpoint and fall through to privileged `asServiceRole` work.

The repo's scheduled/internal function family now uses one shared fail-closed
gate:

- **Protected platform-owner session** may invoke the function manually.
- **Unattended scheduler/internal caller** must send
  `x-internal-secret: <INTERNAL_FN_SECRET>`.
- If `INTERNAL_FN_SECRET` is unset, the function returns **500** rather than
  running open.

Apply that shared gate to the whole cron family, including:
`autoApproveInvitedUser`, `autoEndDutyDay`, `autoEnrollAnnualPlans`,
`autoRetryFailedFaxes`, `checkAdrDeadlines`, `checkExpiredInvitations`,
`checkPendingSignatureRequests`, `checkStaleFollowUpRequests`,
`computeOutcomeMeasures`, `dispatchScheduledSignatureReminders`,
`dispatchScheduledSms`, `monitorComplianceRisks`, `pollFaxStatuses`,
`processAnnualEducationRenewals`, `processInboundFaxes`,
`processScheduledFaxes`, `processScheduledFaxesByPriority`,
`processTrainingRenewals`, `redriveFailedSms`, `scheduledGuidelineSync`,
`sendAutomatedSignatureReminders`, `sendCredentialRenewalReminders`,
`sendDocumentReminderEmails`, `sendExpirationNotifications`,
`sendPersonnelExpirationNotifications`, `sendRenewalReminders`,
`sendTrainingNotifications`, `syncFaxStatuses`, `syncTrainingVideoStatuses`,
`triggerCorrectiveActionPlan`.

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

1. As **Clinician-A-empty** (built-in `user`, active Agency A `clinician`
   membership): `getMyTenantContext` succeeds and `listAuthorizedPatients` is empty.
2. As **Clinician-A** with one active immutable A1 assignment:
   `getAuthorizedPatient(A1)` succeeds while A2 and foreign B1 return
   `403`/`404`/empty in raw broker responses.
3. As **Admin-A** and **Admin-B** (built-in `user`, active tenant
   `agency_admin` memberships): brokered rosters contain only A1/A2 and B1,
   respectively. Platform-owner results do not count.
4. Attempt IDOR and foreign-agency spoofing through every reviewed
   patient/Visit/OASIS/Document broker; expect `403`/`404`/empty. Direct entity
   reads by tenant actors must not return PHI or authority rows.
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

## 9. Residual risks that cannot be closed in this repo alone

### Hosted RLS / tenant isolation
Entity `rls` blocks in `base44/entities/*.jsonc` are **declarations** for the
Base44 dashboard. Client role checks and query filters are UX only. Prove
enforcement with the executable worksheet `docs/HOSTED-RLS-PROOF.md` (and
checklist §7 / `docs/RLS-LAUNCH-RUNBOOK.md` §5) against the **hosted** app —
raw network responses, including cross-tenant probes when multi-agency, and
relation-based "by patient access" rules the repo DSL cannot express
(`docs/RLS-REMEDIATION-SPEC-2026-06-19.md`). LR-01 evidence packets remain the
release gate; CI cannot mark isolation proven.

### True compare-and-swap (CAS)
Reminder/fax/SMS/badge claim tokens (`claimed_by` / `*_claim_token` + re-read)
are best-effort. The entity store has no atomic conditional update / version
column, so overlapping writes can still lose. Platform ask and acceptance
criteria: `docs/PLATFORM-CAS.md`. In-repo merge-retry
(`submitSignerSignature`, `appendPatientNoteHistory`) remains required for
array fields.

### Login CSRF nonce (platform remainder)
In-app hardening (`src/lib/accessTokenTrust.js`, `src/lib/app-params.js`,
`SignInScreen`): planted `auth_state` on hosted-login return; never overwrite
an existing session from an empty/untrusted referrer; **logged-out**
empty/untrusted `?access_token=` handoffs are stashed as
`base44_pending_access_token` until the user explicitly Continues or Declines
(closes silent logged-out login CSRF). **Still open for zero-click email
handoffs:** Base44 must issue a state/nonce on every return URL so legitimate
magic links can auto-accept without a confirm click.

### SMS consent
Outbound patient texts (`sendSms` / `scheduleSms` / dispatcher / redrive) now
**require `consent_status === 'opted_in'`**. `unknown` is no longer sufficient.
Admin `sendTestSms` still only blocks `opted_out` so provisioned-line smoke
tests work.
