/**
 * smsRedrive — eligibility logic for the failed-SMS "outbox" re-drive, and the
 * one failure_reason format every SMS writer uses so that logic can read it.
 *
 * POST /v2/messages takes no idempotency key, so a re-send of a text Telnyx
 * already accepted is a second text to the patient. A failed send is re-driven
 * only when its failure PROVES Telnyx did not process it: an HTTP status of 408,
 * 425, 429 or 503 (the in-request retry set, see voice/telnyxRetry.js), or a
 * connection that never opened. A 500/502/504, a timeout, or a connection that
 * failed after the request was written is "outcome unknown" and is never
 * re-driven; neither is a permanent failure (opt-out, invalid number, auth, kill
 * switch). The `redriveFailedSms` cron re-sends eligible rows with an attempt
 * cap, an escalating gap between attempts, and an age ceiling so a stuck
 * message eventually lands in a terminal failed state instead of looping.
 *
 * The policy decides on the HTTP status and Telnyx error code that lead every
 * reason written by telnyxApiFailureReason — never on the prose detail after
 * them, which used to be all a row carried ("Too many requests"), so a 429 was
 * almost never recognised.
 *
 * Pure + unit-tested. The cron keeps an inline copy of the policy
 * (smsRedriveInlineParity.test.js); the reason formatters are generated into
 * every writer from this file (base44/_shared/backendHelpers.mjs,
 * telnyxSmsOutcome).
 */
import { RETRYABLE_STATUSES, connectionNeverOpened } from "../voice/telnyxRetry.js";

// Telnyx's messaging error code for a send blocked because the recipient
// texted STOP ("Blocked due to STOP message"). The code is Telnyx's published
// messaging error list; the downloaded OpenAPI spec types `errors[].code` as a
// numeric string but does not enumerate the values.
export const TELNYX_OPT_OUT_ERROR_CODE = "40300";

/** The statuses whose failure proves Telnyx did not process the send. */
export const REDRIVABLE_HTTP_STATUSES = RETRYABLE_STATUSES;

/** The code of the first Telnyx error object, when it is a plain numeric code. */
export function telnyxErrorCode(errors) {
  const first = Array.isArray(errors) ? errors[0] : null;
  const raw = first && (typeof first.code === "string" || typeof first.code === "number")
    ? String(first.code).trim() : "";
  return /^\d{1,10}$/.test(raw) ? raw : null;
}

/** True when any Telnyx error object carries exactly this code. */
export function telnyxErrorsInclude(errors, code) {
  return Array.isArray(errors) && errors.some((error) => !!error
    && (typeof error.code === "string" || typeof error.code === "number")
    && String(error.code).trim() === code);
}

/**
 * The failure_reason for a send Telnyx answered with an error status: the HTTP
 * status and Telnyx's error code first, then its detail.
 * e.g. "Telnyx API error: HTTP 429, code 10011: Too many requests"
 */
export function telnyxApiFailureReason(httpStatus, errors) {
  const status = Number(httpStatus);
  const shown = Number.isInteger(status) && status >= 100 && status <= 599 ? status : 0;
  const first = Array.isArray(errors) ? errors[0] : null;
  const detail = String((first && (first.detail || first.title)) || "")
    .replace(/\s+/g, " ").trim().slice(0, 300);
  return `Telnyx API error: HTTP ${shown}, code ${telnyxErrorCode(errors) || "none"}${detail ? `: ${detail}` : ""}`;
}

/**
 * The failure_reason for a send that threw. Only a connection that never opened
 * proves nothing was sent; a timeout or a failure after the request was written
 * may have been accepted, so it says "Outcome unknown" (never re-driven).
 */
export function telnyxTransportFailureReason(err, timeoutMs) {
  if (err && (err.name === "AbortError" || err.name === "TimeoutError")) {
    return `Outcome unknown: Telnyx did not answer within ${timeoutMs} ms, so the text may have been sent. Not retried automatically.`;
  }
  if (connectionNeverOpened(err)) {
    return "Connection never opened: Telnyx could not be reached, so the text was not sent.";
  }
  return "Outcome unknown: the connection to Telnyx failed after the request may have been sent. Not retried automatically.";
}

/** The failure_reason for a delivery receipt that reports a failure. */
export function telnyxDeliveryFailureReason(errors) {
  const first = Array.isArray(errors) ? errors[0] : null;
  const detail = String((first && (first.detail || first.title)) || "")
    .replace(/\s+/g, " ").trim().slice(0, 300);
  return `Telnyx delivery failed: code ${telnyxErrorCode(errors) || "none"}${detail ? `: ${detail}` : ""}`;
}

/**
 * The SmsMessage status for a send Telnyx accepted, from the recipient's status
 * in the response (`data.to[0].status`): queued/sending (or none) is 'queued',
 * anything later is 'sent'. Accepted is not delivered — the receipt says that.
 */
export function telnyxSendStatus(responseBody) {
  const to = responseBody && responseBody.data && Array.isArray(responseBody.data.to)
    ? responseBody.data.to[0] : null;
  const status = String((to && to.status) || "").toLowerCase();
  return status === "queued" || status === "sending" || status === "" ? "queued" : "sent";
}

// A reason in telnyxApiFailureReason's format, and the format writers used
// before it ("Telnyx API error (503)", only ever written with the status).
const API_FAILURE = /^Telnyx API error: HTTP (\d{3}), code (\d{1,10}|none)\b/;
const LEGACY_API_FAILURE = /^Telnyx API error \((\d{3})\)/;
const NEVER_CONNECTED = /^Connection never opened\b/;

// Reasons that are permanent — never auto-retry these. They veto even a
// redrivable status, so they can only ever make the policy more conservative.
export const PERMANENT_FAILURE_PATTERNS = [
  // A send that TIMED OUT reached Telnyx and got no answer, so it may well have
  // been accepted: re-sending risks texting the patient twice. The second
  // pattern covers rows written before the reason said so explicitly.
  /outcome unknown/i, /timed out (after \d+ ms )?reaching telnyx/i,
  /opted out/i, /opt.?out/i, /unsubscrib/i,
  /invalid\W*(to\b|number|destination|phone|recipient|address|msisdn)/i,
  /\b(400|401|403|404|422)\b/,
  /blocked/i, /blacklist/i, /not configured/i, /disabled/i, /too long/i, /consent/i,
];

/** True when a failure_reason proves Telnyx did not process the send. */
export function isTransientFailureReason(reason) {
  const s = String(reason || "");
  if (!s.trim()) return false; // unknown reason → don't blindly retry
  if (PERMANENT_FAILURE_PATTERNS.some((re) => re.test(s))) return false;
  const api = API_FAILURE.exec(s);
  if (api) {
    return api[2] !== TELNYX_OPT_OUT_ERROR_CODE && REDRIVABLE_HTTP_STATUSES.has(Number(api[1]));
  }
  const legacy = LEGACY_API_FAILURE.exec(s);
  if (legacy) return REDRIVABLE_HTTP_STATUSES.has(Number(legacy[1]));
  return NEVER_CONNECTED.test(s);
}

/**
 * Should this SmsMessage row be re-driven now?
 *
 * @param {Record<string, any>} row  an SmsMessage ({ status, direction, failure_reason,
 *   retry_count, created_date, last_retry_at })
 * @param {number} now  epoch ms
 * @param {{maxAttempts?:number, baseGapMs?:number, maxAgeMs?:number}} [opts]
 */
export function shouldRedriveSms(row, now = Date.now(), { maxAttempts = 4, baseGapMs = 60_000, maxAgeMs = 24 * 60 * 60 * 1000 } = {}) {
  if (!row || row.status !== "failed" || row.direction !== "outbound") return false;
  // A nurse resent it by hand (sendSms resend_of): re-sending it too would text
  // the patient twice.
  if (row.superseded_by) return false;
  // An MMS: the redrive re-sends text only, and the sender's media URLs may not
  // serve the same bytes later, so an MMS is never re-sent automatically.
  if (Array.isArray(row.media) && row.media.length > 0) return false;
  const attempts = Number(row.retry_count) || 0;
  if (attempts >= maxAttempts) return false;
  if (!isTransientFailureReason(row.failure_reason)) return false;

  const created = new Date(row.created_date).getTime();
  if (!Number.isFinite(created)) return false;
  if (now - created > maxAgeMs) return false; // too old; give up

  // Escalating backoff between attempts: baseGap, 2×, 4×, …
  const last = row.last_retry_at ? new Date(row.last_retry_at).getTime() : created;
  const requiredGap = baseGapMs * 2 ** attempts;
  if (Number.isFinite(last) && now - last < requiredGap) return false;
  return true;
}
