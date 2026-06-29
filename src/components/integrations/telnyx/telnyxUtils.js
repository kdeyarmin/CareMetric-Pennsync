/**
 * telnyxUtils — pure, dependency-free helpers shared by the Telnyx integration
 * (text / voice / video / fax). This is the unit-tested source of truth for the
 * value-mapping logic that the backend Deno functions inline (single-file deploy
 * model), mirroring how the Twilio helpers in src/components/voice/* are the
 * source of truth for their inlined copies.
 *
 * Nothing here touches the network or any framework — it can be exercised in
 * isolation with `node --test`. Drift between this file and the inlined copies in
 * the Telnyx backend functions is guarded by base44/functions/telnyxInlineParity.test.js.
 */

/**
 * Normalize a free-form phone number to E.164. US-centric (assumes +1 for bare
 * 10/11-digit numbers) but accepts any already-+-prefixed international number of
 * a plausible length. Returns null when it can't produce a valid E.164 number.
 * Mirrors normalizeE164() used across the Twilio handlers so a number stored by
 * one provider resolves identically under the other.
 */
export function normalizeE164(raw) {
  if (!raw) return null;
  const digits = String(raw).replace(/[^\d]/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (String(raw).trim().startsWith("+") && digits.length >= 8 && digits.length <= 15 && digits[0] !== "0") {
    return `+${digits}`;
  }
  return null;
}

/**
 * Stable, order-independent conversation key for a pair of numbers, so an
 * inbound and outbound message between the same two parties share one thread.
 * Mirrors getThreadId() in sendSms so SMS sent through Telnyx threads with SMS
 * sent through Twilio for the same patient.
 */
export function getThreadId(a, b) {
  const na = normalizeE164(a) || a;
  const nb = normalizeE164(b) || b;
  return [na, nb].sort().join("|");
}

/**
 * Map a Telnyx messaging delivery status to the internal SmsMessage status
 * vocabulary ('queued' | 'sent' | 'delivered' | 'failed'). Telnyx reports a
 * per-recipient status inside `data.payload.to[].status` on `message.*` webhooks.
 * Unknown statuses return null so callers can ack-without-write (never regress a
 * terminal row to a non-terminal state). Matches the conservative mapping the
 * Twilio SMS path uses.
 */
export function mapMessageStatus(status) {
  switch (String(status || "").toLowerCase()) {
    case "queued":
    case "sending":
      return "queued";
    case "sent":
      return "sent";
    case "delivered":
    case "webhook_delivered":
      return "delivered";
    case "sending_failed":
    case "delivery_failed":
    case "expired":
    case "failed":
      return "failed";
    default:
      return null;
  }
}

/**
 * Map a Telnyx Programmable Fax status to the internal FaxLog status vocabulary
 * ('queued' | 'sending' | 'sent' | 'delivered' | 'failed'). Telnyx fax webhooks
 * carry `data.payload.status` plus an event type like `fax.delivered`. Unknown
 * statuses return null (ack without write). Mirrors mapTwilioStatus so both fax
 * webhook handlers compute the same terminal/non-terminal transitions.
 */
export function mapFaxStatus(status) {
  switch (String(status || "").toLowerCase()) {
    case "queued":
      return "queued";
    case "media.processed":
    case "originated":
    case "sending":
      return "sending";
    case "sent":
      return "sent";
    case "delivered":
      return "delivered";
    case "failed":
    case "cancelled":
    case "canceled":
      return "failed";
    default:
      return null;
  }
}

/**
 * Map a Telnyx Call Control event type to a coarse CallLog status. Telnyx voice
 * uses event types (`call.initiated`, `call.answered`, `call.bridged`,
 * `call.hangup`) rather than a single status field. Unknown events return null.
 */
export function mapCallStatus(eventType) {
  switch (String(eventType || "").toLowerCase()) {
    case "call.initiated":
      return "ringing";
    case "call.answered":
    case "call.bridged":
      return "in_progress";
    case "call.hangup":
      return "completed";
    default:
      return null;
  }
}

/**
 * Build the exact byte string Telnyx signs for webhook verification:
 * `${telnyx-timestamp}|${rawRequestBody}`, signed with Ed25519 and delivered in
 * the `telnyx-signature-ed25519` header (base64). Keeping this construction in
 * one tested place means the verifier in handleTelnyxStatusWebhook can't drift.
 */
export function buildSignedPayload(timestamp, rawBody) {
  return `${String(timestamp ?? "")}|${String(rawBody ?? "")}`;
}

/**
 * Replay-window guard for a Telnyx webhook timestamp (unix seconds). Returns true
 * only when the timestamp is within `toleranceSeconds` of `nowMs`. A captured,
 * validly-signed webhook can't be replayed indefinitely. Fails closed on a
 * non-numeric/blank timestamp.
 */
export function isFreshTimestamp(timestamp, nowMs = Date.now(), toleranceSeconds = 300) {
  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return false;
  const skew = Math.abs(nowMs / 1000 - ts);
  return skew <= toleranceSeconds;
}

/**
 * Pull the event type and inner payload out of a Telnyx webhook envelope, which
 * is always `{ data: { event_type, payload, ... } }`. Returns a flat object with
 * the fields the status handler needs, tolerating both the v2 envelope and a
 * flattened test payload. Never throws.
 */
export function extractTelnyxEvent(body) {
  const b = body || {};
  const data = b.data || b;
  const payload = data.payload || {};
  return {
    eventType: data.event_type || b.event_type || null,
    id: payload.id || data.id || null,
    payload,
  };
}

/**
 * Telnyx API base. Centralized so callers don't hardcode the host and so tests
 * can reason about the single value used for every request.
 */
export const TELNYX_API_BASE = "https://api.telnyx.com/v2";
