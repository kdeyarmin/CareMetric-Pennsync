# Secrets & Webhooks Launch Runbook (executable)

> Step-by-step companion to `telnyx-setup.md` (reference) and
> `SECURITY-RLS-CHECKLIST.md` §3–§5. Work top to bottom; each step says **where** to set
> it and **how to verify**. All backend secrets are Deno-function secrets — **never**
> prefix any of these with `VITE_` (that ships them to the browser). The two `VITE_*`
> frontend vars are the only public ones.

---

## 1. Frontend runtime config (required for the app to render)

| Var | Where | Value |
|---|---|---|
| `VITE_BASE44_APP_ID` | build/host env | the Base44 app id |
| `VITE_BASE44_BACKEND_URL` | build/host env | the Base44 backend origin |

**Verify:** app loads past the blocking config screen and does not redirect to a blank
`/login`. (Can also be passed as `?app_id=…&server_url=…` and is persisted to
localStorage.)

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
| `SIGNATURE_HMAC_SECRET` | **Yes** | Signature integrity MAC falls back to **unkeyed sha256** — detects corruption, **not** forgery. Set it so e-signature tamper-evidence is forgery-resistant. |
| `INTERNAL_FN_SECRET` | **Yes** | Every scheduled/internal function (the ~30-function cron family: fax queues, SMS dispatch, renewal reminders, outcome measures, …) authorizes with `x-internal-secret: <INTERNAL_FN_SECRET>` OR an admin session, and **fails closed with a 500 when the secret is unset** and the caller isn't an admin — so unattended cron firings all fail until it is set. See `docs/LEARNING_CENTER_SCHEDULED_JOBS.md` for the registration steps (the platform trigger must send the header). |

**Verify scheduled-function auth:** an unauthenticated POST to a cron function
(e.g. `processScheduledFaxes`) without the header → `401/500`; with
`x-internal-secret` set correctly → `200`.

**Verify certificate issuance:** a direct `issueCertificate` call from a non-admin
with no passing attempt is rejected; a legitimate completion via
`gradeTrainingAttempt` still issues a certificate.

---

## 4. AI / media keys — feature gates, not launch blockers

Each feature shows a clear "not configured" admin notice until its key is set; the rest
of the app is unaffected.

| Secret | Powers |
|---|---|
| `OPENAI_API_KEY` | Whisper/audio transcription, SOAP-note-from-audio, AI training-course generation, training-attempt grading, corrective-action-plan generation, in-service rebuild |
| `ANTHROPIC_API_KEY` | AI fax cover-page generation |
| `HEYGEN_API_KEY` | AI training-video generation |

(Telehealth video tokens and outbound fax use the Telnyx config from §2, not these.)

These three plus the §3 `SIGNATURE_HMAC_SECRET` are the **complete** backend
secret list (four total) — nothing else is read from the dashboard env.

**Verify:** with a key set, the corresponding feature runs; with it unset, it shows the
not-configured notice rather than erroring.

---

## 5. Scheduled functions (crons) — enable exactly one of each duplicated pair

These run privileged `asServiceRole` work with no `auth.me()` — correct only if the
platform restricts who can invoke function endpoints (**confirm that**).

| Function | Schedule | Notes |
|---|---|---|
| `processScheduledFaxes` **XOR** `processScheduledFaxesByPriority` | one of them, e.g. every 5 min | **Enable only ONE** — both running double-sends faxes. |
| `dispatchScheduledSms` | one schedule, e.g. every 5 min | `pending→sending` claim is best-effort, not atomic — overlapping runs double-send a queued text. One schedule only. |
| `sendAutomatedSignatureReminders` | per your reminder policy | Idempotency now guards on `last_reminder_sent_at` (schema field exists), so a tick won't re-email every run. |
| `dispatchScheduledSignatureReminders` | one schedule, e.g. every 15 min | Delivers `ScheduledSignatureReminder` rows queued by `scheduleSignatureReminders` (which is caller-invoked, not a cron). Claim + re-read guards overlapping runs; recipients are re-derived from the document's pending signers at send time. |
| `sendExpirationNotifications` | daily | Document/credential expirations. |
| `sendPersonnelExpirationNotifications` | daily | Personnel credential expirations. |
| `monitorComplianceRisks` | daily/periodic | Compliance risk monitor. |
| `scheduledGuidelineSync` | periodic | Medicare guideline sync. |
| `deduplicatePatients` | periodic | Patient dedupe. |
| `autoApproveInvitedUser` | per platform trigger | Confirm cron-only / trigger-only invocation. |

**Verify:** exactly one fax processor and one `dispatchScheduledSms` are enabled; send a
test scheduled fax and a scheduled SMS and confirm a **single** delivery each.

---

## 6. End-to-end channel smoke tests (do before go-live)

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
