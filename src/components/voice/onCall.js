/**
 * onCall — find-me-follow-me ringdown ordering for inbound patient calls.
 *
 * When a patient calls a nurse's work number, we ring that nurse first; if they
 * don't pick up we roll to the next on-duty nurse, and finally to the office, so
 * a patient call is never silently missed. Pure + dependency-free (unit-tested
 * source of truth; inlined into the Call Control webhook).
 */

/**
 * Build the ordered ringdown list of destinations for an inbound call:
 *   primary nurse → other on-duty nurses (backup) → office.
 * De-duplicates, drops blanks, and caps the length. Returns
 * [{ to, kind: 'primary' | 'backup' | 'office' }].
 *
 * @param {{ primary?: string|null, others?: string[], office?: string|null, maxTargets?: number }} opts
 */
// Dedupe key for a destination. Two spellings of the same phone number
// (e.g. "+12155550100" and "2155550100") must count as ONE target, otherwise a
// nurse's cell and a same-number "office" both ring — or worse, the same
// handset rings twice while a real backup nurse is pushed past the cap. Uses
// the last 10 digits (NANP) when the value looks like a phone number; falls
// back to the trimmed/lowercased literal for anything non-numeric.
function ringdownDedupeKey(n) {
  const digits = String(n).replace(/\D/g, "");
  return digits.length >= 10 ? digits.slice(-10) : String(n).trim().toLowerCase();
}

export function buildRingdown({ primary = null, others = [], office = null, maxTargets = 4 } = {}) {
  const seen = new Set();
  const out = [];
  const push = (num, kind) => {
    const n = String(num || "").trim();
    if (!n) return;
    const key = ringdownDedupeKey(n);
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ to: n, kind });
  };
  push(primary, "primary");
  for (const o of Array.isArray(others) ? others : []) push(o, "backup");
  push(office, "office");
  const cap = Number.isFinite(maxTargets) && maxTargets > 0 ? maxTargets : 4;
  return out.slice(0, cap);
}

/** The next destination after `idx`, or null when the ringdown is exhausted. */
export function nextRingdownTarget(targets, idx) {
  const list = Array.isArray(targets) ? targets : [];
  const i = Number(idx);
  if (!Number.isInteger(i) || i < 0 || i >= list.length) return null;
  return list[i];
}

// Telnyx Call Control hangup_cause values that mean the DIALED party didn't
// pick up (so we should roll to the next ringdown target). Official enum from
// Telnyx call.hangup webhook docs / SDK HangupCause:
//   call_rejected | no_answer | normal_clearing | originator_cancel |
//   timeout | time_limit | user_busy | not_found | unspecified
// Only the "didn't answer / unreachable / we cancelled the dial" causes advance
// ringdown. normal_clearing / time_limit / unspecified do not.
export const UNANSWERED_HANGUP_CAUSES = Object.freeze([
  "no_answer",
  "user_busy",
  "call_rejected",
  "timeout",
  "not_found", // formerly FreeSWITCH-style "unallocated_number"
  // Dial timeout / transfer cancel of the B-leg (client_state.t === 'ringdown'
  // already scopes this so a caller A-leg hangup does not keep ringing).
  "originator_cancel",
]);

const UNANSWERED_CAUSES = new Set(UNANSWERED_HANGUP_CAUSES);

/**
 * True when a hangup means "the person we dialed didn't answer", so the ringdown
 * should advance to the next target. A plain caller hangup (normal_clearing with
 * no dialed-leg context) returns false so we don't keep ringing a dead call.
 */
export function isUnansweredHangup(hangupCause) {
  return UNANSWERED_CAUSES.has(String(hangupCause || "").toLowerCase());
}
