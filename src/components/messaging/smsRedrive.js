/**
 * smsRedrive — eligibility logic for the failed-SMS "outbox" re-drive.
 *
 * A send that fails for a TRANSIENT reason (timeout / network / 429 / 5xx) is
 * worth retrying later; a PERMANENT failure (opt-out, invalid number, auth,
 * kill switch) must never be retried. The `redriveFailedSms` cron re-sends
 * eligible rows that Telnyx reported as failed, with an attempt cap, an
 * escalating gap between attempts, and an age ceiling so a stuck message
 * eventually lands in a terminal failed state instead of looping.
 *
 * Pure + unit-tested; the cron keeps an inline copy of this policy.
 */

// Reasons that indicate a transient/retryable failure.
export const TRANSIENT_FAILURE_PATTERNS = [
  /timed out/i, /timeout/i, /network/i, /unreachable/i, /temporar/i,
  /\b(429|500|502|503|504)\b/, /rate.?limit/i, /failed to reach/i,
  /connection/i, /EAI_AGAIN/i, /ECONN/i, /ETIMEDOUT/i, /socket/i,
];

// Reasons that are permanent — never auto-retry these (and they win over a
// coincidental transient-looking substring).
export const PERMANENT_FAILURE_PATTERNS = [
  /opted out/i, /opt.?out/i, /unsubscrib/i, /invalid/i, /\b(400|401|403|404|422)\b/,
  /blocked/i, /blacklist/i, /not configured/i, /disabled/i, /too long/i, /consent/i,
];

/** True when a failure_reason string looks transient (and not permanent). */
export function isTransientFailureReason(reason) {
  const s = String(reason || "");
  if (!s.trim()) return false; // unknown reason → don't blindly retry
  if (PERMANENT_FAILURE_PATTERNS.some((re) => re.test(s))) return false;
  return TRANSIENT_FAILURE_PATTERNS.some((re) => re.test(s));
}

/**
 * Should this SmsMessage row be re-driven now?
 *
 * @param {object} row  an SmsMessage ({ status, direction, failure_reason,
 *   retry_count, created_date, last_retry_at })
 * @param {number} now  epoch ms
 * @param {{maxAttempts?:number, baseGapMs?:number, maxAgeMs?:number}} [opts]
 */
export function shouldRedriveSms(row, now = Date.now(), { maxAttempts = 4, baseGapMs = 60_000, maxAgeMs = 24 * 60 * 60 * 1000 } = {}) {
  if (!row || row.status !== "failed" || row.direction !== "outbound") return false;
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
