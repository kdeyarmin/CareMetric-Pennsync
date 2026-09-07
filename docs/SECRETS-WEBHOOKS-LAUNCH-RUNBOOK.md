# Secrets & Webhooks Launch Runbook (executable)

> Step-by-step companion to `telnyx-setup.md` (reference) and
> `SECURITY-RLS-CHECKLIST.md` §3–§5. Work top to bottom; each step says **where** to set
> it and **how to verify**. All backend secrets are Deno-function secrets — **never**
> prefix any of these with `VITE_` (that ships them to the browser). The `VITE_*`
> frontend vars listed below are the only public ones.

---

## 1. Frontend runtime config (required for the app to render)

| Var | Where | Value |
|---|---|---|
| `VITE_BASE44_APP_ID` | build/host env | the Base44 app id |
| `VITE_BASE44_BACKEND_URL` | build/host env | the Base44 backend origin |
| `VITE_DEPLOY_ENV` | build/host env | `production` for the production deploy; use `staging` or `development` elsewhere |
| `VITE_CENTRAL_HELP_ENABLED` | build/host env | optional; omit or set exactly `true` to enable central help only after the production app-id/environment gates pass; any other value disables it |

Configure `VITE_DEPLOY_ENV` separately in each build/host environment. Never add a
production fallback to the shared build command: an unlabeled build must remain
fail-closed, and staging deployments must explicitly use `staging`.

**Verify:** app loads past the blocking config screen and does not redirect to a blank
`/login`. In the production bundle, verify the CareMetric Help Center launcher appears
on `/Help`; in staging/development, verify it does not. (The app id and backend URL can
also be passed as `?app_id=…&server_url=…` and are persisted to localStorage.)

---

## 2. Telnyx — text / voice / video / fax

All Telnyx config is set **in-app** — the `TELNYX_*` / `FUNCTIONS_BASE_URL`
dashboard-env override path was retired.

### Step 2a — set the credentials
Administration → Super Admin → Telnyx (`TelnyxSecretPanel`). Stored backend-only
as an `IntegrationSecret` (provider `telnyx`). Set: API key (`KEY…`), Ed25519
**public** key, Messaging Profile id, Voice (Call Control) connection id, Fax
connection id. The office fax number and main office number live on
`AgencySettings` (Admin → Super Admin). Outbound sends/calls derive the status
webhook URL from their own request URL — no `FUNCTIONS_BASE_URL` needed.

**Verify (read-only, no traffic):** run `testTelnyxConnection` (live `/v2/whoami`
probe + readiness report) and/or `getTelnyxSecretStatus`. Both should report the keys
present and the whoami probe OK.

### Step 2b — point the webhooks
There is **one** inbound webhook for the entire integration:
```
https://<your-functions-base>/handleTelnyxStatusWebhook
```
In the Telnyx portal, set this as the webhook URL on **each** of: the **Messaging
Profile**, the **Call Control application** (voice), and the **Fax application**. If the
app sits behind a proxy, the public URL must match exactly (signature is computed over
the URL+body).

### Step 2c — confirm signature verification (fail-closed)
`handleTelnyxStatusWebhook` verifies the `telnyx-signature-ed25519` header against
the in-app Ed25519 public key and enforces a fresh-timestamp window. **The public key
MUST be set or all inbound webhooks are rejected 401.**

**Verify:**
- Valid Telnyx-signed event → `200`.
- Tampered body / bad signature → `401`.
- Stale timestamp → `401`.
- Idempotency: re-deliver the same event (Telnyx retries are at-least-once) → no
  double-processing (de-dups on provider message/call id).

---

## 3. Backend security secrets

Set in the dashboard env (function secrets). There are two. The rest of the old
secret surface is structural now: the file-fetch SSRF allowlist is hardcoded in
code (always-on, fail-closed on the app's own storage hosts), the `onUserSignup`
re-fetch/email-match guard is always active (`SIGNUP_WEBHOOK_SECRET` retired),
debug logging is compiled out (`FUNCTIONS_DEBUG` retired), and certificate
issuance is protected structurally: `issueCertificate` only trusts a passing
`TrainingAttempt` row, which is written exclusively server-side by
`gradeTrainingAttempt` (entity RLS allows admin writes only).

| Secret | Set at launch? | Effect if unset |
|---|---|---|
| `SIGNATURE_HMAC_SECRET` | **Yes** | Signature token issuance and verification fail closed when the secret is missing or too short. |
| `INTERNAL_FN_SECRET` | **Required for external/header-based schedulers; recommended otherwise** | Native Base44 workflows run as the user who created them, so a workflow created by an active protected admin authorizes through `auth.me()` without this header. External/no-session scheduler calls must send `x-internal-secret: <INTERNAL_FN_SECRET>` and fail closed with `500` when it is unset; authenticated non-admin callers fail with `403`. Never place the secret in browser code or workflow `args`. See `docs/LEARNING_CENTER_SCHEDULED_JOBS.md`. |

`APP_PUBLIC_URL` is required non-secret backend configuration. Set it separately
in every environment to that environment's exact HTTPS origin. Account,
invitation, and notification email paths reject a missing or malformed value;
they do not fall back to `APP_URL` or a production hostname.

`OUTBOUND_DELIVERY_RELEASE` is an application-wide release gate, not a provider
credential. Leave it absent or blank in staging: email, SMS, fax, and voice
delivery then remain fail-closed even when provider credentials are present.
Only the exact value `enabled-v1`, set after a separate environment-specific
approval, releases delivery. Never use a `VITE_` variable for this gate.

**Verify scheduled-function auth:** deploy/create checked-in native workflows
only as the intended protected platform admin. In isolated staging, list the deployed
workflow, run one canary, and verify that its creator-backed `auth.me()` identity
is the expected active admin and the response is successful. Also verify an
unauthenticated POST to a cron function (e.g. `processScheduledFaxes`) without
the header → `401/500`, with the correct `x-internal-secret` → `200`, and an
authenticated non-admin call → `403`. If the workflow creator is deactivated
or demoted, recreate the workflow under the approved owner before releasing its
handler gate. Do not create dashboard or function-level duplicate schedules for
targets already defined under `base44/workflows/`.

**Verify certificate issuance:** a direct `issueCertificate` call from a non-admin
with no passing attempt is rejected; a legitimate completion via
`gradeTrainingAttempt` still issues a certificate.

---

## 4. AI / media keys — feature gates, not launch blockers

Each feature shows a clear "not configured" admin notice until its key is set; the rest
of the app is unaffected.

| Secret | Powers |
|---|---|
| `OPENAI_API_KEY` | Direct Whisper/audio transcription, including the transcription stage of SOAP-note-from-audio |
| `ANTHROPIC_API_KEY` | Direct SOAP-note-from-audio structuring |
| `HEYGEN_API_KEY` | AI training-video generation |

(Telehealth video tokens and outbound fax use the Telnyx config from §2, not these.)

Most application AI uses platform-managed `Core.InvokeLLM`, and transactional
email uses platform-managed `Core.SendEmail`; neither consumes an app-managed
provider key. Fax-cover formatting is deterministic and sends no patient data
to an AI provider. Gemini, Deepgram, Resend, Notifyre, and Twilio environment
keys are not runtime requirements in the current source tree and must not be
treated as launch blockers.

The integration-health report exposes release state separately from credential
state. A successful read-only provider probe never authorizes traffic.
`OUTBOUND_DELIVERY_RELEASE` is the application-wide delivery switch and is
fail-closed unless its value is exactly `enabled-v1`. Provider/workflow-specific
pauses (including `OUTCOME_PIPELINE_RELEASE` for the outcome worker) remain
independent defense-in-depth gates; keep all of them paused in staging except
for an explicitly approved controlled-destination test.

The fax/follow-up workflows have independent default-false gates, all of which
must remain unset in staging until their individual hosted proof is approved:
`WORKFLOW_RELEASE_AUTO_RETRY_FAILED_FAXES`,
`WORKFLOW_RELEASE_CHECK_STALE_FOLLOW_UP_REQUESTS`,
`WORKFLOW_RELEASE_POLL_FAX_STATUSES`,
`WORKFLOW_RELEASE_PROCESS_INBOUND_FAXES`, and
`WORKFLOW_RELEASE_PROCESS_SCHEDULED_FAXES`. Only the exact value `enabled-v1`
releases the corresponding handler, and workflow activation remains a separate
decision.

These three plus the §3 `SIGNATURE_HMAC_SECRET` are the AI/media and signature
secrets. Scheduler and Telnyx secrets are documented separately above.

**Verify:** with a key set, the corresponding feature runs; with it unset, it shows the
not-configured notice rather than erroring.

---

## 5. Scheduled functions (crons) — preserve one authoritative schedule

These run privileged `asServiceRole` work after the shared authorization gate.
Native Base44 runs inherit the workflow creator's identity; external schedulers
must use the shared-secret header. The seven checked-in definitions under
`base44/workflows/` are authoritative for their targets. Their legacy
function-level configs must remain absent, and no dashboard duplicate may be
created. Workflow presence never releases a handler's default-closed source gate.

### Mandatory backlog census before any delivery release

Copying entities or secrets into an environment does **not** make its queued
work safe to deliver. A copied production recipient, old retry row, or overdue
schedule can become live as soon as the global and worker gates are opened.
While every delivery gate is still closed, complete and retain this review:

1. Census, by tenant and age, all `ScheduledSms` and `ScheduledFax` rows that
   could dispatch; failed outbound `SmsMessage` rows eligible for redrive;
   failed `FaxLog` rows eligible for retry; pending signature reminders; and
   invitation, credential-renewal, personnel-expiration, or other reminder
   digest work. Record counts plus the oldest/newest due timestamps without
   exporting message bodies, documents, secret values, or full destinations.
2. Quarantine or cancel stale, production-copied, ambiguous, and real-recipient
   work. Do not mark it sent and do not advance a reminder-offset/digest stamp
   for delivery that did not occur. Resolve duplicate schedules before release.
3. Create one fresh, explicitly approved canary for a controlled destination in
   one test tenant. Confirm there is exactly one eligible row and that all other
   outbound backlogs remain empty or quarantined.
4. Open `OUTBOUND_DELIVERY_RELEASE` and only the single required worker/channel
   gate for the bounded canary window. Verify exactly one provider attempt and
   reconcile the local delivery/audit record with the provider result. Close
   the gates again before reviewing any additional queue.

Neither `OUTBOUND_DELIVERY_RELEASE` nor any worker-specific gate may be released
for general staging traffic until this census, quarantine, and one-row canary
have passed. A read-only provider health check is not a substitute.

| Function | Schedule | Notes |
|---|---|---|
| `processScheduledFaxes` | Native workflow every 10 minutes | Sole scheduled-fax target. Keep `processScheduledFaxesByPriority` unregistered; the handler still requires `WORKFLOW_RELEASE_PROCESS_SCHEDULED_FAXES=enabled-v1`. |
| `dispatchScheduledSms` | one schedule, e.g. every 5 min | `pending→sending` claim is best-effort, not atomic — overlapping runs double-send a queued text. One schedule only. |
| `sendAutomatedSignatureReminders` | Unregistered | Legacy alternate path remains quarantined; do not schedule it. |
| `dispatchScheduledSignatureReminders` | Native workflow every 15 minutes | Sole signature-reminder target. Its literal release and atomic-uniqueness gates remain false pending hosted proof. |
| `sendExpirationNotifications` | daily | Document/credential expirations. |
| `sendPersonnelExpirationNotifications` | daily | Personnel credential expirations. |
| `monitorComplianceRisks` | daily/periodic | Compliance risk monitor. |
| `scheduledGuidelineSync` | periodic | Medicare guideline sync. |
| `deduplicatePatients` | periodic | Patient dedupe. |
| `autoApproveInvitedUser` | per platform trigger | Confirm cron-only / trigger-only invocation. |

**Verify:** read back exactly one native `Process Scheduled Faxes` workflow and
no legacy/dashboard duplicate, while its handler gate remains closed. Release
and controlled delivery tests require their own explicit approval.

---

## 6. End-to-end channel smoke tests (do before go-live)

Do not run these while `OUTBOUND_DELIVERY_RELEASE` is absent or blank. Release
the gate only in the specifically approved environment and only for the bounded
test window and destinations.

1. **SMS out/in:** send an SMS to a test handset (`sendSms`) → delivered; reply
   `STOP` → opt-out recorded (`SmsConsent`), `START` → re-opt-in. Inbound text appears
   in the right nurse's inbox.
2. **Voice (masked):** click-to-call a test number → your phone rings showing the
   **work** number, answering bridges the patient. Inbound to a work number routes per
   on-call/duty.
3. **Fax:** send a one-page fax (`sendFax`) → delivered; status flows back via the
   webhook to `FaxLog`.
4. **Telehealth:** create a session, join via `/join` with a valid token → video
   connects.
5. **E-signature:** sign a test document → record completes (`status: completed`),
   PDF is stamped, and the audit trail verifies as **Verified** (confirms
   `SIGNATURE_HMAC_SECRET` is set and the integrity stamp ran).
6. **Webhook security:** repeat the §2c good/bad/stale signature checks against the
   live URL.

**Sign-off:** §2c + all of §6 pass, and §5 has exactly one of each duplicated cron →
secrets & webhooks gate cleared. Combine with the RLS gate (`RLS-LAUNCH-RUNBOOK.md` §5)
for full pre-launch sign-off.
