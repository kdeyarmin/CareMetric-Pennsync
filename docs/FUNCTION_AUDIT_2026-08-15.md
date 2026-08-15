# Backend Function Audit — Release Pass (2026-08-15)

**Scope:** All 236 Base44 Deno functions under `base44/functions/*/entry.ts`, audited for
release readiness — auth bypass, cross-tenant PHI exposure, privilege escalation,
fail-open error handling, queue durability, SSRF, secret/PHI-in-logs, and correctness
on critical paths.

**Method:** Eight parallel readers each took ~30 functions and read every `entry.ts`
in full against a shared checklist and the settled invariants in
`base44/securityGuardrails.test.js` and `docs/HOSTED-RLS-PROOF.md` §5b. Every reported
finding was re-verified against the live code before any change. Baseline validation was
green before the audit (lint 0/0, `typecheck:signal` clean, 613 component + 47 node
tests, shared helpers in sync, all functions transpiling, production build) and again
after every change.

The codebase was already heavily hardened by prior security passes: every function
authenticates, applies the deactivated-user guard, re-authorizes service-role patient
reads, and fails closed for `agency_admin` without `agency_name`; the scheduler-auth,
signer-token, SSRF, Telnyx-credential, and idempotency patterns are consistently applied.
No P0s and no auth-bypass paths were found. The fixes below are the exceptions to that
otherwise-consistent discipline.

---

## Fixed in this pass

### AI integration (2 functions returning nothing useful)
- **transcribeAndGenerateSOAPNote**, **generateFaxCoverPage** — both POST directly to
  `api.anthropic.com/v1/messages` with `model: 'automatic'`. `'automatic'` is the Base44
  `InvokeLLM` convention; the Anthropic Messages API 404s on it, so every SOAP-note draft
  and AI fax cover sheet silently failed even with a valid `ANTHROPIC_API_KEY`. Now send
  `claude-opus-4-8` (runs without thinking when the field is omitted, so the small
  `max_tokens` budget goes entirely to the JSON answer).

### Training competency & certificate integrity
- **gradeTrainingAttempt** — pass mark, attempt cap, and retake cooldown were read off
  the learner-writable `TrainingAssignment` row, so a learner could POST
  `{ passing_score_required: 1 }` to their own assignment, answer one question, and have
  the passing attempt drive `issueCertificate` into minting a compliance certificate.
  Gates now derive from the admin-owned `TrainingCourse`; the assignment value may only
  make a gate stricter.
- **generateTrainingCertificate** — refused a certificate only when an unmatched record
  id was supplied; a caller passing just a module *name* that matched no owned record
  fell through to body values, letting a nurse print a certificate for a module they
  never completed. Now refuses whenever any supplied identifier matches no owned record.

### Cross-tenant PHI / access
- **sendSms** — linked an outbound message to a phone-resolved patient with no access
  check; now gated by `canAccessPatient` like `scheduleSms`.
- **submitPersonnelCredential** — `ownsRecord` accepted any `isAdminLike` caller with no
  agency comparison; now scoped to the caller's agency (platform admins keep cross-agency
  reach).
- **getTeamTrainingReadiness** — only admin account types were scoped, so a non-admin
  educator/supervisor received every tenant's staff training roster; now scopes every
  non-platform-admin.
- **handleTelnyxStatusWebhook** — the find-me-follow-me ringdown listed all on-duty
  users, so a patient could be bridged to another agency's nurse's cell; now filtered to
  the primary nurse's agency.
- **retryFailedFax** — failed open when a `FaxLog` had no `sent_by` (legacy rows); a
  non-admin caller must now be the known sender.
- **sendFaxStatusNotification** — agency-scoped like retryFailedFax (was bare
  `isAdminLike`).
- **retrainOCRModel** — trained on and marked-applied every tenant's `OCRFeedback` (PHI);
  scoped to the caller's agency for non-platform admins.
- **auditDataQuality** — dropped the super_admin arm from the agency email set (it leaked
  super_admin-created patients and profiles into every agency's report).
- **startTrainingAssignment** — agency-scoped (was bare `isAdminUser`).
- **searchPurchaseTelnyxNumbers** — added the `agency_admin`-without-agency fail-closed
  gate before writing `AgencySettings`.
- **generatePatientHandout** — HTML-escaped caller-controlled agency name / phone /
  patient name in the emailed handout body (was only non-ASCII-stripped — a phishing
  primitive); and a failed email no longer returns `success:true` via the fallback-PDF
  path.

### Queue durability / fail-open error handling
- **dispatchScheduledSms** — resolved agency config once with no hint, so multi-tenant
  `getAgencyConfig` returned `smsEnabled:false` and every due reminder was failed each
  tick; config is now resolved per row from the sending nurse, and an unresolvable agency
  releases the claim to pending.
- **autoRetryFailedFaxes** — terminal-failed queued faxes and fired "all retries
  exhausted" emails on the first non-OK Telnyx response; non-OK responses are now
  classified (401/403/429/5xx transient) and rescheduled within budget. The retry also
  re-gates the stored destination through the shared `isAllowedDestination` allowlist
  (a sender could edit their `FaxLog.to_number` and have the cron fax PHI anywhere), and
  uses the shared `telnyxCredsMessage`.
- **processFaxOCR** — a transient OCR failure set `ocr_processed:true` with an
  `[OCR FAILED]` marker that the already-processed guard then returned as the document
  text forever; now records only a failure reason and leaves the row retriable.
- **processInboundFaxes** — a transient OCR error flipped an inbound fax to terminal
  `failed` (the cron only re-scans `pending`), dropping provider fax-backs; added a
  bounded `ocr_attempts` retry (new `IncomingFax` field).
- **dispatchScheduledSignatureReminders** — terminal-failed a reminder when every
  notification-create threw (infra); now bounded-retries to pending.
- **triggerCorrectiveActionPlan** — set its idempotency claim before the long build and
  never cleared it on failure, permanently stranding the employee's mandatory
  remediation; the claim is now released on the 404 path and in the outer catch.
- **sendFax** — 500'd for a fax Telnyx had already accepted when post-2xx bookkeeping
  threw; now logged and treated as sent.
- **saveVisitPointConfig** — an extra branch let a platform admin overwrite a lone
  tenant's point config; dropped it.
- **sendExpirationNotifications** — training-expiration items were built with no
  `agency_name` and fanned out to every tenant's admins; now attributed via the owner's
  agency, with unattributable items routed to super_admins only.

### Robustness / hygiene
- Notification-roster caps raised to 5000 (was 300/400/500) so the oldest accounts
  (typically agency owners) don't fall off the page:
  `sendPersonnelExpirationNotifications`, `sendTrainingCertificateEmail`,
  `submitTimeOffRequest`, `submitTimesheet`, `triggerCorrectiveActionPlan`.
- **sendTrainingNotifications** — certificates sorted ascending by `expiration_date`
  (soonest-expiring were falling off the newest-issued tail).
- **checkExpiredInvitations** — reports emails actually sent, not the admin count.
- **generateTrainingCertificatePDF** — uploads via `asServiceRole` (the internal
  issueCertificate path has no user identity).
- **sendAutomatedSignatureReminders** — skips signatures with no `patient_id`.
- **discoverTelnyxResources** — uses shared `resolveTelnyxCreds` for deterministic row
  selection.
- PHI/identifier removed from `console.*` in `autoAssignNurseToPatient`, `assignInService`.
- New `securityGuardrails.test.js` assertions pin the model-id, competency, certificate,
  sendSms, credential-scope, team-readiness, ringdown, dispatchScheduledSms, and
  autoRetryFailedFaxes fixes.

### Deploy checklist correction
- `INTERNAL_FN_SECRET` was listed as *retired* in the launch runbook but is required by
  the shared scheduler-auth helper (the ~30-function cron family fails closed with a 500
  when it is unset). Documented in `docs/SECRETS-WEBHOOKS-LAUNCH-RUNBOOK.md` §3 and
  `.env.example`, with a verify step.

---

## Deferred (documented, not fixed here)

These were assessed and intentionally left, with reasons:

- **§5b bare-`role:admin` RLS residual** — several AI/report generators
  (`generateDischargeSummary`, `generateMessageSuggestions`, `generatePatientEducation`)
  read a patient via RLS rather than the `assertPatientAccess` gate. This is the
  documented, accepted server-side-tenancy residual in `docs/HOSTED-RLS-PROOF.md` §5b:
  the incremental exposure over what bare `role:admin` RLS already permits is bounded,
  and the real fix is the schema-level tenancy work tracked there, not a per-function
  patch.
- **Entities with no `rls` block** (`CertificatePacketCache`, `FaxLog`, `FaxContact`,
  `AgencyKPI`) — the same net-new-entity gap already tracked in
  `docs/APP_AUDIT_RECOMMENDATIONS_2026-06-27.md`. The functions' own authorization is
  correct; the entity read policies are a separate schema task.
- **`computeOutcomeMeasures` / `calculateDataQualityScores`** platform-global rollup and
  cohort caps — aggregate rates only (no patient identifiers), pending a product decision
  on per-agency KPI separation.
- **`assignAnnualLearningPlan`** O(users×courses) serial writes — a performance/timeout
  refactor (prefetch to Sets, as `autoEnrollAnnualPlans` already does), not a
  correctness bug; deferred as a larger change.
- **`autoEndDutyDay` / `autoAssignWorkNumbers` multi-agency edge behavior**,
  **`updateIncident` patch audit trail**, **`rebuildExistingInServices` backlog
  re-selection**, and assorted idempotency-without-`visitId` and counter-accuracy
  honorable mentions — low-confidence or judgment-dependent; listed in the PR discussion
  for follow-up.
