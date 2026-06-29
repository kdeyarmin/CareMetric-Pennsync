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
export function buildRingdown({ primary = null, others = [], office = null, maxTargets = 4 } = {}) {
  const seen = new Set();
  const out = [];
  const push = (num, kind) => {
    const n = String(num || "").trim();
    if (!n || seen.has(n)) return;
    seen.add(n);
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

// Telnyx Call Control hangup causes that mean the DIALED party didn't pick up
// (so we should roll to the next target), as opposed to the caller hanging up.
// TODO(verify): confirm the exact hangup_cause vocabulary against a live account.
const UNANSWERED_CAUSES = new Set([
  "no_answer",
  "no_user_response",
  "user_busy",
  "call_rejected",
  "timeout",
  "normal_temporary_failure",
  "unallocated_number",
  "recovery_on_timer_expire",
  "originator_cancel", // ringing leg cancelled because the timeout fired
]);

/**
 * True when a hangup means "the person we dialed didn't answer", so the ringdown
 * should advance to the next target. A plain caller hangup (normal_clearing with
 * no dialed-leg context) returns false so we don't keep ringing a dead call.
 */
export function isUnansweredHangup(hangupCause) {
  return UNANSWERED_CAUSES.has(String(hangupCause || "").toLowerCase());
}
