/**
 * costControls — destination allow-listing and send caps for the phone
 * integration. Stops a misconfiguration or a compromised account from running up
 * a bill (or texting/dialing premium or unexpected international destinations).
 *
 * Pure + dependency-free so it can be unit-tested and inlined into the single-file
 * Deno send functions (sendSms / startMaskedCall / sendFax).
 */

// NANP premium/disallowed area codes: 900 = premium-rate, 976 = legacy premium.
const PREMIUM_AREA_CODES = new Set(["900", "976"]);

/**
 * Decide whether an E.164 destination is allowed to be contacted.
 *   - US/Canada (NANP, +1) is allowed by default.
 *   - Premium NANP area codes (900/976) are always blocked.
 *   - International (non-+1) is blocked UNLESS settings.allow_international === true.
 *   - settings.blocked_area_codes (array of 3-digit strings) blocks specific NANP
 *     area codes.
 * `e164` should already be normalized (e.g. "+12155550100"). Returns
 * { allowed: boolean, reason: string }.
 */
export function isAllowedDestination(e164, settings = {}) {
  const s = settings || {};
  const e = String(e164 || "").trim();
  const isNanp = /^\+1\d{10}$/.test(e);

  if (isNanp) {
    const areaCode = e.slice(2, 5);
    if (PREMIUM_AREA_CODES.has(areaCode)) return { allowed: false, reason: "premium_number_blocked" };
    const blocked = Array.isArray(s.blocked_area_codes) ? s.blocked_area_codes.map((a) => String(a).replace(/[^\d]/g, "")) : [];
    if (blocked.includes(areaCode)) return { allowed: false, reason: "blocked_area_code" };
    return { allowed: true, reason: "allowed" };
  }

  // A +1-prefixed number that isn't exactly 10 NANP digits is malformed, not
  // international — never let the international toggle dial/text a broken US number.
  if (/^\+1/.test(e)) return { allowed: false, reason: "invalid_destination" };

  // Not a +1 NANP number → treat as international.
  if (!/^\+\d{8,15}$/.test(e)) return { allowed: false, reason: "invalid_destination" };
  if (s.allow_international === true) return { allowed: true, reason: "international_allowed" };
  return { allowed: false, reason: "international_blocked" };
}

/** Friendly, client-safe message for a blocked destination (no PHI). */
export function blockedReasonMessage(reason) {
  switch (reason) {
    case "premium_number_blocked": return "Premium-rate numbers (900/976) are blocked.";
    case "blocked_area_code": return "That area code is blocked by your agency's policy.";
    case "international_blocked": return "International destinations are blocked. Ask an admin to enable international sending.";
    case "invalid_destination": return "That doesn't look like a valid phone number.";
    default: return "That destination isn't allowed.";
  }
}

/**
 * True when another send is within the agency's cap. `sentSoFar` is the count
 * already sent in the current period; `cap` is settings.monthly_sms_cap (or
 * similar). A non-positive/absent cap means "no cap" (always allowed).
 */
export function withinSendCap(sentSoFar, cap) {
  const n = Number(cap);
  if (!Number.isFinite(n) || n <= 0) return true;
  return Number(sentSoFar || 0) < n;
}

/** First instant of the current month in UTC, as an ISO string (for cap queries). */
export function monthStartISO(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}
