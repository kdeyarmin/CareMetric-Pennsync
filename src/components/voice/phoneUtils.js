/**
 * phoneUtils — shared phone-number helpers for the Twilio phone integration.
 *
 * These mirror the inline helpers in the Deno backend functions (which must
 * stay single-file for the Base44 deploy model). Keeping the algorithm here —
 * and unit-tested — is the source of truth; the backend copies follow it.
 */

/** Normalize a free-form phone string to E.164 (US-centric), or null if invalid. */
export function normalizeE164(raw) {
  if (!raw) return null;
  const digits = String(raw).replace(/[^\d]/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  // Already-+ international: bound to a valid E.164 length (8–15 digits) and
  // reject a leading 0 (no country code starts with 0) so malformed values like
  // "+1234567890123456789" or "+02155550100" aren't emitted as if valid.
  if (String(raw).trim().startsWith("+") && digits.length >= 8 && digits.length <= 15 && digits[0] !== "0") return `+${digits}`;
  return null;
}

/** Last 10 digits of any phone string (for loose matching against free-form data). */
export function last10(raw) {
  return (raw || "").replace(/[^\d]/g, "").slice(-10);
}

/**
 * Candidate stored formats for a number, used to match an inbound E.164 number
 * against the free-form `Patient.phone` field.
 */
export function phoneVariants(value) {
  const d = (value || "").replace(/[^\d]/g, "");
  const ten = d.slice(-10);
  if (ten.length !== 10) return value ? [value] : [];
  const a = ten.slice(0, 3);
  const b = ten.slice(3, 6);
  const c = ten.slice(6);
  // De-dupe: when `value` is already one of the normalized forms (e.g. an
  // E.164 `+1XXXXXXXXXX`), it collides with a generated variant. Removing the
  // duplicate avoids a redundant Patient.filter() lookup per variant.
  const variants = [value, `+1${ten}`, `1${ten}`, ten, `(${a}) ${b}-${c}`, `${a}-${b}-${c}`, `${a}.${b}.${c}`];
  return variants.filter((v, i) => variants.indexOf(v) === i);
}

/**
 * Deterministic conversation key for a pair of numbers, independent of order/
 * direction, so a nurse↔patient thread groups consistently.
 */
export function getThreadId(a, b) {
  const na = normalizeE164(a) || a;
  const nb = normalizeE164(b) || b;
  return [na, nb].sort().join("|");
}

/**
 * Mask a phone number for display, revealing only the last 4 digits. This is
 * the number-masking helper for the nurse's PRIVATE personal cell — it must
 * never be shown in full in the UI or written to audit logs. The backend
 * functions keep an inline copy (single-file deploy model).
 * Returns "unknown" for empty input and "••••" when fewer than 4 digits.
 */
export function maskPhone(raw) {
  if (!raw) return "unknown";
  const d = String(raw).replace(/[^\d]/g, "");
  if (d.length < 4) return "••••";
  return `(•••) •••-${d.slice(-4)}`;
}

/**
 * Pretty-print a phone number for display, e.g. "+12155550100" -> "(215)
 * 555-0100". Used for masked call history and SMS threads where the patient's
 * number is shown to their own nurse. Falls back to E.164 (or the raw input)
 * for non-US / unparseable numbers so nothing is ever dropped.
 */
export function formatPhoneDisplay(raw) {
  const e164 = normalizeE164(raw);
  // Only NANP (+1) numbers get the pretty (xxx) xxx-xxxx US format; anything
  // else keeps its E.164 form so we never mangle an international number.
  if (e164 && /^\+1\d{10}$/.test(e164)) {
    const ten = e164.slice(2);
    return `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}`;
  }
  return e164 || (raw ? String(raw) : "");
}
