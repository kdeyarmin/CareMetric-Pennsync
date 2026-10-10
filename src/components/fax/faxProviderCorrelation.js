/**
 * faxProviderCorrelation — pure helpers that tie a Telnyx Programmable Fax
 * resource back to the PennSync row that created it.
 *
 * This module is the single source of truth for the `faxProviderCorrelation`
 * shared helper: base44/_shared/backendHelpers.mjs generates the inlined copy in
 * every Base44 fax function from these functions' own source (toString), so the
 * senders that WRITE a client_state and the webhook that READS it cannot drift.
 *
 * Grounded in Telnyx's OpenAPI spec (read 2026-10-09):
 * - POST /v2/faxes accepts `client_state`, "a valid Base-64 encoded string" that
 *   Telnyx adds "to every subsequent webhook" for that fax, and `webhook_url`,
 *   which only OVERRIDES the Fax Application's `webhook_event_url`.
 * - Every fax.* webhook payload (fax.queued, fax.media.processed,
 *   fax.sending.started, fax.delivered, fax.failed) names the fax as
 *   `payload.fax_id`; the Fax resource itself uses `id`.
 */

// Versioned so a client_state written by a future format is refused rather
// than half-understood.
export const FAX_CLIENT_STATE_VERSION = "pennsync.fax.v1";
// outbound       — a FaxLog row written by sendFax / sendBatchFax /
//                  sendAuthorizedReferralFax before its POST /v2/faxes.
// office_forward — the IncomingFax row the webhook forwarded to the office fax.
export const FAX_CLIENT_STATE_KINDS = ["outbound", "office_forward"];

/** A row id fit to carry through a provider round trip, or null. */
export function exactFaxCorrelationId(value) {
  if (typeof value !== "string" || !value || value.length > 200
    || value.trim() !== value || value.startsWith("$")) return null;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 32 || code === 127) return null;
  }
  return value;
}

/** base64(JSON) client_state naming the row a fax belongs to; null when unencodable. */
export function encodeFaxClientState(kind, id) {
  const exact = exactFaxCorrelationId(id);
  if (!FAX_CLIENT_STATE_KINDS.includes(kind) || !exact) return null;
  const bytes = new TextEncoder().encode(JSON.stringify({ v: FAX_CLIENT_STATE_VERSION, k: kind, id: exact }));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/**
 * Decode a fax client_state this app wrote. Anything else — another feature's
 * client_state, a different version, malformed base64 — is null, never a guess.
 */
export function decodeFaxClientState(value) {
  if (typeof value !== "string" || !value || value.length > 2048) return null;
  let parsed;
  try {
    const binary = atob(value.trim());
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)
    || parsed.v !== FAX_CLIENT_STATE_VERSION || !FAX_CLIENT_STATE_KINDS.includes(parsed.k)) return null;
  const id = exactFaxCorrelationId(parsed.id);
  return id ? { kind: parsed.k, id } : null;
}

/**
 * The provider fax id a fax.* webhook names. Telnyx's documented field is
 * `fax_id`; `id` is still read because earlier code (and fixtures) used it. When
 * both are present they must agree. `present: false` means the event names no
 * fax at all; `id: null` with `present: true` means it names one malformedly.
 */
export function faxEventProviderId(payload) {
  const faxId = payload && typeof payload === "object" ? payload.fax_id : undefined;
  const legacyId = payload && typeof payload === "object" ? payload.id : undefined;
  if (faxId == null && legacyId == null) return { present: false, id: null };
  if (faxId != null && legacyId != null && faxId !== legacyId) return { present: true, id: null };
  return { present: true, id: exactFaxCorrelationId(faxId != null ? faxId : legacyId) };
}

/**
 * The per-fax `webhook_url` for a sender, derived from the sender's OWN request
 * URL — or null, in which case Telnyx falls back to the Fax Application's
 * `webhook_event_url` (which the setup runbook points at the same function).
 *
 * A URL is derived only when the request demonstrably reached this function by
 * its own name as the final path segment, over https. The previous derivation
 * stripped "the last segment" of whatever URL arrived, so a request that reached
 * the function at a bare origin produced `https://handleTelnyxStatusWebhook`-
 * style garbage instead of omitting the override.
 */
export function faxStatusWebhookUrl(requestUrl, selfName) {
  if (typeof selfName !== "string" || !/^[A-Za-z][A-Za-z0-9]*$/.test(selfName)) return null;
  let url;
  try {
    url = new URL(String(requestUrl));
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password) return null;
  const segments = url.pathname.replace(/\/+$/, "").split("/");
  if (segments.length < 2 || segments[segments.length - 1] !== selfName) return null;
  segments[segments.length - 1] = "handleTelnyxStatusWebhook";
  return `${url.origin}${segments.join("/")}`;
}
