# Telnyx Integration — Text, Voice, Video & Fax

Telnyx is the sole telephony/communications provider for the app. It powers all
four channels:

| Channel | Telnyx product | Backend function (provider-neutral name) |
|---|---|---|
| **Text** (SMS/MMS) | Messaging API | `sendSms`, `sendTestSms`, `dispatchScheduledSms`, `redriveFailedSms` |
| **Voice** (masked click-to-call + inbound IVR) | Call Control v2 | `startMaskedCall` (outbound), inbound handled in the webhook |
| **Video** (telehealth) | Telnyx Video (Rooms) + `@telnyx/video` client | `createTelehealthToken` |
| **Fax** | Programmable Fax | `sendFax`, `retryFailedFax`, `autoRetryFailedFaxes`, `sendBatchFax`, `pollFaxStatuses` (`syncFaxStatuses` is retired in source and answers 410) |

> The user-facing function names are provider-neutral (`sendSms`, `sendFax`,
> `startMaskedCall`, `createTelehealthToken`) and run on Telnyx internally. The
> former Twilio functions, the `twilio-video` client SDK, and the Twilio
> credential model have been removed.

Every inbound and status event — messaging, fax, and voice (Call Control) —
is delivered to a **single signed webhook**, `handleTelnyxStatusWebhook`.

## 1. Prerequisites in Telnyx

1. A Telnyx account with a **Mission Control v2 API key** (starts with `KEY`).
2. A purchased number (or numbers) with the relevant capabilities (SMS, voice, fax).
3. A signed **BAA with Telnyx** for HIPAA-eligible traffic.
4. The resources each channel needs:
   - **Text** — a *Messaging Profile* (recommended for opt-out/routing).
   - **Voice** — a *Call Control Application* (gives you a `connection_id`).
   - **Fax** — a *FAX / Programmable Fax Application* (gives you a `connection_id`)
     and a fax-capable number.
   - **Video** — no extra setup; rooms are created on demand by `unique_name`.
5. For A2P 10DLC, register a Brand + Campaign in the Telnyx portal and attach your
   numbers. Unregistered US 10DLC traffic is heavily filtered.

## 2. Configuration

### Option A — in-app (recommended)

**Administration → Super Admin** → the **Telnyx Credentials** panel. Save your
API key plus the optional resource ids. They are stored backend-only
(`IntegrationSecret`, provider `telnyx`) and are never returned to the browser —
only presence + the last 4 characters are shown. Functions:

- `saveTelnyxSecret` — store the API key / public key / connection ids (super-admin only).
- `getTelnyxSecretStatus` — read whether each value is configured (no secrets returned).
- `testTelnyxConnection` — read-only readiness report + a live `/v2/balance` probe.

### Dashboard-env overrides — retired

The `TELNYX_*` dashboard-env vars (`TELNYX_API_KEY`, `TELNYX_PUBLIC_KEY`,
`TELNYX_MESSAGING_PROFILE_ID`, `TELNYX_VOICE_CONNECTION_ID` /
`TELNYX_CONNECTION_ID`, `TELNYX_FAX_CONNECTION_ID`, `TELNYX_FAX_NUMBER`) are no
longer read. The in-app `IntegrationSecret` row (plus `AgencySettings` for the
office fax/main numbers) is the single source of Telnyx config.

## 3. Webhooks

Point the webhook URL of **each** connection (Messaging Profile, Call Control
connection, Programmable Fax connection) at the single function:

```
https://<your-functions-base>/handleTelnyxStatusWebhook
```

Outbound sends/calls also pass a per-request `webhook_url` pointing at the same
function (derived automatically from each function's own request URL), so
delivery/status updates flow back even before you finish the portal-level
webhook configuration. The fax senders derive it only when the request
demonstrably reached them by their own name over https; otherwise they omit it
and Telnyx uses the Fax Application's webhook URL, so **the portal-level Fax
Application webhook is required**, not optional — the office forward of a stray
inbound fax never carries a per-request URL at all.

Every outbound fax also carries a `client_state` naming the `FaxLog` row that
sent it (the office forward names its `IncomingFax`), which Telnyx echoes on
each `fax.*` webhook. The webhook uses it only to identify a row — the office
forward's events and legacy `sendFax` rows are acknowledged without a write, an
accepted fax whose provider id is not recorded yet is redelivered — never to
authorize a status write.

### Signature verification (fail-closed)

`handleTelnyxStatusWebhook` verifies Telnyx's **Ed25519** signature:

- signed message = `` `${telnyx-timestamp}|${rawBody}` ``
- header `telnyx-signature-ed25519` (base64) verified against the in-app Ed25519 public key
- the `telnyx-timestamp` must be within a 5-minute replay window

A webhook without a valid signature, or with a stale timestamp, is rejected `401`.
The public key **must** be configured for inbound webhooks to be accepted.

## 4. Voice flows (Call Control)

Both inbound and outbound voice run on a Call Control Application, so all call
events arrive at `handleTelnyxStatusWebhook` and are driven there as a small state
machine via `client_state`.

- **Outbound masked click-to-call** (`startMaskedCall`): rings the nurse's cell
  first (caller id = work number); on `call.answered` the webhook issues a Call
  Control `transfer` to bridge the patient, presenting the work number.
- **Inbound** (patient → work number): on `call.initiated` the webhook resolves
  the nurse, applies the agency-hours → off-duty → masked-bridge routing, and
  **answers first** (consistent with the outbound path), carrying the decision in
  `client_state`. On `call.answered` it `speak`s the greeting (if any) then
  `transfer`s / `hangup`s / starts voicemail. If `call.initiated` is ever dropped
  (webhooks are at-least-once), `call.answered` re-derives the route so the call
  is never stranded on a silent leg.

Resilience built in:
- `callCommand` returns `{ ok, status }`; a **failed transfer falls back** to a
  spoken apology + `hangup` (and, for the outbound bridge, marks the `CallLog`
  failed) rather than leaving the caller/nurse on dead air.
- Voicemail recording is bounded (`max_length`), plays a beep (`play_beep`)
  and is **transcribed** (`transcription_start` with the `Google` engine —
  the current name of the legacy `A` alias — and
  `transcription_engine_config.language` → `call.transcription` events append
  to the `CallLog`, setting `has_voicemail` and surfacing a transcript preview
  in the notification). The voicemail duration is derived from the
  recording's `recording_started_at`/`recording_ended_at`.
- **Known gap:** `call.recording.saved`'s `recording_urls` are valid for 10
  minutes (Telnyx API reference), and that link is what is stored as
  `CallLog.voicemail_url`, so a voicemail link opened later has expired.
  Fixing it means either copying the audio into private storage or enabling
  Telnyx's non-expiring `public_recording_urls` — a PHI decision, not a code
  default.
- A call leg that hangs up before it is answered (`no_answer`, `user_busy`,
  `call_rejected`, `timeout`, `not_found`, `originator_cancel`) is logged
  `failed` ("Not answered"), not `completed`.
- Ringdown advances on Telnyx `hangup_cause` values verified against the Call
  Control HangupCause enum: `no_answer`, `user_busy`, `call_rejected`,
  `timeout`, `not_found`, `originator_cancel` (see `src/components/voice/onCall.js`).

> Call Control *action path* URLs should still be smoke-tested against your live
> Telnyx account during rollout; hangup_cause / record_start / transcription_start
> field names are pinned to the published Telnyx v2 docs/SDK.

**MMS:** `sendSms` accepts an optional `media_urls` array (up to 10 `https` URLs);
when present, Telnyx sends an MMS. Non-https or oversized payloads are rejected
before any send.

## 5. Inbound SMS

`message.received` events are handled in the webhook: STOP/START/HELP keyword
handling (TCPA), inbound message storage + threading, automatic after-hours /
off-duty auto-replies, urgent-keyword escalation, and in-app nurse notification.

## 6. Telehealth video

`createTelehealthToken` finds-or-creates a Telnyx Video room by `unique_name`
(the session `room_name`) and mints a per-session join client token (1-hour TTL)
using the same guest-token / staff authorization model as before. The client
(`src/components/telehealth/VideoRoom.jsx`) uses the `@telnyx/video` SDK.

> The `@telnyx/video` Room API method/event names used in `VideoRoom.jsx` are
> annotated with `TODO(verify)` and should be confirmed against the SDK version
> pinned in `package.json` during rollout.

## 7. Duty model & easy provisioning

**Each user gets their own number for voice + SMS.** Provision in one click from
**Administration → Super Admin → Nurse Work Numbers → "Auto-assign N numbers"**
(`autoAssignWorkNumbers`), which hands every user without a work number the next
available number from the pool. (Or set them individually.) Add numbers to the
pool with the in-app search/buy (`searchPurchaseTelnyxNumbers`).

**Fax: sent from the office number; the app receives no faxes.** Every return
fax should reach the physical office machine (`AgencySettings.office_fax_number_e164`,
e.g. `+17244650444`). A receiving machine redials the calling NUMBER, not the
caller-id name, so outbound faxes are sent **from** the office number whenever
Telnyx allows it:

- **Verify the office fax number in Telnyx** — Telnyx Portal › Numbers ›
  Verified Numbers, verification method **Call** (a fax line takes no SMS).
  Per the API reference Telnyx places a brief call to the number with the code
  in the caller ID, so the code is read from the office line's caller-ID
  display; the `extension` field accepts DTMF digits and `w`/`W` pauses when
  the line sits behind an IVR. Once `GET /v2/verified_numbers/{office number}`
  reports a `verified_at`, `sendFax`, `sendBatchFax` (including automatic
  retries) and `sendAuthorizedReferralFax` (including manual retries) send
  `from` the office number. Each send checks, read-only, with a 5-second
  bound and once per request.
- **Until it is verified** (or if Telnyx cannot be asked), faxes keep the
  previous behaviour exactly: they TRANSMIT from the single Telnyx fax line
  (`AgencySettings.outbound_fax_number_e164`, the "blind" line) and present
  the office number only as the `from_display_name` caller-id name and on the
  cover sheet. The send answer then carries a non-PHI `origination_warning`
  (`office_fax_number_unverified` or `office_fax_verification_unavailable`).
  If a verification is revoked between the check and the send, Telnyx fails
  the fax `unverified_origination_number`, which is classified permanent (no
  automatic resend); the next send falls back to the blind line.
- **Inbound faxes are always forwarded to the office machine.** Any fax dialed
  to the Telnyx line is passed straight through to the office fax number by
  `handleTelnyxStatusWebhook`, with an at-most-once `IncomingFax` record as the
  idempotency anchor. There is no in-app fax inbox: `AgencySettings.fax_receiving_enabled`
  is no longer honoured and its admin switch was removed (2026-10-09). The
  Telnyx Fax Application may also email inbound faxes (a portal setting,
  outside this app).
- Legacy fallback: with no outbound line configured, faxes transmit from the
  office fax number itself (which must then be a Telnyx number), and no
  verification lookup is made.

**Provisioning the outbound fax line** (requires the Programmable Fax
connection id in the Telnyx Credentials panel):
- *Buy it in-app:* Number Pool → **Find & buy numbers** → choose **Outbound fax
  line**. The search filters fax-capable numbers; buying attaches the number to
  your Programmable Fax connection and stores it as the outbound fax line.
- *Already own the number?* Enter it as the outbound fax line and click
  **Provision fax** — the app looks the number up in your Telnyx account,
  re-points its connection at the Programmable Fax connection, and saves it.
  (Backed by `searchPurchaseTelnyxNumbers` `purpose: 'fax'` / `provision_fax`.)
- The office fax, outbound fax, and main office numbers are **reserved**:
  assignment (manual, pool, or auto-assign) refuses to hand them out as
  personal work numbers.

**The duty toggle (default OFF).** A user is reachable on their work number ONLY
while they've toggled **On Duty** (DutyStatusCard). They flip it on in the morning;
calls ring their cell (masked) and texts reach them.

**Auto end-of-day at 5pm + nightly reset (no cron required).** A user is treated
as off duty when they toggle off, once the clock passes the auto-off hour, or the
next calendar day — whichever comes first:
- Real-time: the inbound webhook checks the cutoff live, so at 5pm calls/texts
  route to the office even before any sweep runs.
- Self-expiring: toggling on stamps `duty_on_since`. The on-duty state is honored
  only on that same calendar day (in the duty timezone), so a forgotten toggle is
  automatically off the next morning until they toggle on again — **no cron
  needed**. (Legacy rows without `duty_on_since` keep the prior behavior.)
- Optional: schedule `autoEndDutyDay` daily at the cutoff to also flip the stored
  toggle off so the UI matches reality; it's a convenience, not a dependency.

Configurable on `AgencySettings`: `auto_off_duty_hour` (default `17`),
`duty_timezone` (default `America/New_York`), `auto_off_duty_enabled` (set `false`
to disable). The cutoff logic is the unit-tested `isOffDutyNow` / `isPastAutoOffHour`
in `src/components/voice/dutyUtils.js`.

**Off-duty auto-replies** (office number = `AgencySettings.main_office_number_e164`):
- SMS: *"Thank you for your text, but I am currently not working. Please contact the office at {office}."*
- Voice: *"Thank you for your call, I am not working right now. Please hold while I connect you to Penn Home Health."* — then connects the caller to the office.

Both default to the office number `724-465-0440` until one is configured, and a
user can override their own message (`off_duty_message`).

## 7b. On-call rotation, cost controls, compliance & dashboard

**Find-me-follow-me (on-call rotation).** An inbound call to an on-duty nurse now
rings a **ringdown** in order: the nurse's cell → any other on-duty nurse → the
office. If a leg goes unanswered, the webhook rolls the original caller to the
next target (carried in `client_state`), so a patient call is never silently
missed. Ordering logic is the unit-tested `src/components/voice/onCall.js`; the
ring timeout is ~20s. (`AgencySettings.ringdown_max` caps the number of targets.)

**Cost controls** (set in Super Admin → Nurse Work Numbers → Cost controls):
- `allow_international` (default off) — only US/Canada (+1) destinations are
  allowed; premium 900/976 are always blocked. `blocked_area_codes` (array) can
  block specific NANP area codes.
- `monthly_sms_cap` — blocks new outbound texts once the cap is hit for the
  calendar month. Enforced in `sendSms`; destination rules in `sendSms` /
  `startMaskedCall` / `sendFax`. Logic: `src/components/voice/costControls.js`.

**A2P 10DLC + consent ledger** (Super Admin): the A2P panel records your
registration status/brand/campaign (`a2p_10dlc_status`, `a2p_brand_id`,
`a2p_campaign_id`) — US 10DLC registration is required or carriers filter texts.
With `a2p_campaign_id` saved, every SMS-capable number bought in-app is
**automatically enrolled in that campaign** at purchase time (Telnyx
`POST /10dlc/phone_number_campaigns`); an enrollment failure surfaces as a
warning toast, never a failed purchase. Numbers added manually (bought in the
portal) must be enrolled in the portal — the in-app auto-enroll only runs on
in-app purchases. Fax lines don't text and are never enrolled.
The consent ledger (`manageSmsConsent`) browses `SmsConsent`, shows opted-in/out
counts, supports a manual opt-out / opt-back-in, and CSV export.

**Communications dashboard** (`Communications` nav, admin-only): SMS/call/fax
volume (7-day chart), delivery rates, recent failures, voicemail backlog, and
per-number activity, from `getCommsDashboard` (no message bodies / PHI). Summary
logic is the unit-tested `src/components/admin/commsDashboard.js`.

## 8. Go-live verification (live smoke test)

Before launch, validate a real Telnyx account end-to-end.

> These `TELNYX_*` variables configure the **local `tools-telnyx-live-smoke.mjs`
> Node CLI only** — they are how you hand credentials to a script on your own
> machine. They are **not** app configuration: no deployed Base44 function reads
> a `TELNYX_*` environment variable, and setting them in the Base44 dashboard
> does nothing. The app reads Admin → Telnyx.

```
TELNYX_API_KEY=KEY... TELNYX_PUBLIC_KEY=... \
TELNYX_MESSAGING_PROFILE_ID=... TELNYX_VOICE_CONNECTION_ID=... TELNYX_FAX_CONNECTION_ID=... \
node tools-telnyx-live-smoke.mjs            # read-only: auth + resource existence
node tools-telnyx-live-smoke.mjs --send-to +1215... --confirm   # also sends one real test SMS
```

It checks that the API key authenticates, the webhook public key is set, and the
messaging profile / Call Control app / Fax app ids resolve. It then prints the
exact Call Control event types the webhook state machine expects
(`call.answered`, `call.speak.ended`, `call.recording.saved`, `call.transcription`,
`message.received`, …) — place one test call and confirm those arrive at
`handleTelnyxStatusWebhook` in Telnyx's webhook debugger to close the remaining
`TODO(verify)` items. The tool's logic is unit-tested in
`tools-telnyx-live-smoke.test.js` (mocked fetch), so it runs in CI without a key.

## 9. Status mapping

The provider→internal status mapping is the unit-tested source of truth in
`src/components/integrations/telnyx/telnyxUtils.js` and is inlined into the webhook
handler (drift-guarded by `base44/functions/telnyxInlineParity.test.js`):

- **Messages** → `queued` / `sent` / `delivered` / `failed`
- **Fax** → `queued` / `sending` / `sent` / `delivered` / `failed`
- **Calls** → `ringing` / `in_progress` / `completed`

Unknown statuses are acknowledged without writing, so a terminal row is never
regressed to a non-terminal state.
