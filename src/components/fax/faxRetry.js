/**
 * faxRetry — retry policy for outbound faxes (Twilio Programmable Fax), the fax
 * analogue of messaging/smsRedrive. The Twilio Fax API has no idempotency key,
 * so the cron protects against double-sends with a claim token; this module is
 * the pure, unit-tested source of truth for the *decisions*:
 *
 *   - classifyFaxFailure   — transient (retry) vs permanent (give up now)
 *   - faxRetryConfig       — normalize the admin-editable FaxRetryConfig entity
 *   - nextRetryDelayMinutes— config-aware exponential backoff, priority-scaled
 *   - planFaxRetry         — what the status webhook should do on a failure
 *   - isFaxRetryDue        — whether the cron should re-dispatch a failed fax now
 *
 * The single-file Deno functions keep inline copies of these; a drift guard
 * (base44/functions/faxRetryInlineParity.test.js) asserts they stay identical.
 */

// Failure reasons/codes that won't succeed on retry — give up immediately
// instead of burning the whole backoff schedule. Validate against your Twilio
// account's fax error codes; matched against "code + message".
export const PERMANENT_FAILURE_PATTERNS = [
  /invalid/i, /not a fax/i, /no fax machine/i, /incompatible/i, /unsupported/i,
  /rejected/i, /blocked/i, /do not call/i, /unallocated/i, /disconnected/i,
  /forbidden/i, /not in service/i, /no such number/i, /malformed/i,
];

/** 'permanent' when the failure clearly won't recover; 'transient' otherwise. */
export function classifyFaxFailure(errorCode, errorMessage) {
  const s = `${errorCode ?? ""} ${errorMessage ?? ""}`.trim();
  if (!s) return "transient"; // unknown → treat as retryable (prior behavior)
  return PERMANENT_FAILURE_PATTERNS.some((re) => re.test(s)) ? "permanent" : "transient";
}

/** Normalize the FaxRetryConfig entity (or undefined) to safe defaults. */
export function faxRetryConfig(config) {
  const c = config || {};
  // Coerce first: entity fields can arrive as numeric strings ("5") from a JSON/form
  // round-trip, and Number.isFinite("5") is false — which would silently drop the
  // admin's configured value in favor of the default.
  const maxRetriesNum = Number(c.max_retries);
  const baseDelayNum = Number(c.retry_delay_minutes);
  return {
    enabled: c.auto_retry_enabled !== false,
    maxRetries: Number.isFinite(maxRetriesNum) ? Math.max(0, maxRetriesNum) : 3,
    baseDelayMinutes: Number.isFinite(baseDelayNum) && baseDelayNum > 0 ? baseDelayNum : 15,
    notifyOnFinalFailure: c.notify_on_final_failure !== false,
    priorityMultiplier: c.priority_multiplier && typeof c.priority_multiplier === "object" ? c.priority_multiplier : {},
  };
}

/**
 * Backoff (in minutes) before the retry that follows `attempt` failures so far:
 * base · factor^attempt, scaled by the per-priority multiplier, capped. With the
 * default base 15 / factor 2: 15, 30, 60, … (urgent halves it, low doubles it).
 */
export function nextRetryDelayMinutes(attempt, config, priority = "normal", { factor = 2, maxMinutes = 360 } = {}) {
  const c = faxRetryConfig(config);
  const a = Math.max(0, Number(attempt) || 0);
  const mult = Number.isFinite(c.priorityMultiplier[priority]) ? c.priorityMultiplier[priority] : 1;
  const minutes = c.baseDelayMinutes * factor ** a * mult;
  return Math.max(1, Math.min(maxMinutes, Math.round(minutes)));
}

/**
 * Decide what the status webhook should do when a fax reports failed.
 * Returns { willRetry, classification, exhausted, nextRetryAt, nextRetryCount,
 * delayMinutes }. Retries are skipped when auto-retry is off, the failure is
 * permanent, or the attempt budget is spent.
 *
 * @param {{ retryCount?: number, errorCode?: any, errorMessage?: any,
 *   priority?: string, config?: any, now?: number }} [opts]
 */
export function planFaxRetry({ retryCount = 0, errorCode, errorMessage, priority = "normal", config, now = Date.now() } = {}) {
  const c = faxRetryConfig(config);
  const classification = classifyFaxFailure(errorCode, errorMessage);
  const attempts = Number(retryCount) || 0;
  if (!c.enabled || classification === "permanent" || attempts >= c.maxRetries) {
    return { willRetry: false, classification, exhausted: true, nextRetryAt: null, nextRetryCount: attempts, delayMinutes: 0 };
  }
  const delayMinutes = nextRetryDelayMinutes(attempts, config, priority);
  return {
    willRetry: true,
    classification,
    exhausted: false,
    nextRetryAt: new Date(now + delayMinutes * 60_000).toISOString(),
    nextRetryCount: attempts + 1,
    delayMinutes,
  };
}

/** Whether the cron should re-dispatch this failed fax right now. */
export function isFaxRetryDue(fax, now = Date.now(), config) {
  const c = faxRetryConfig(config);
  if (!c.enabled) return false;
  if (!fax || fax.status !== "failed") return false;
  if (!fax.next_retry_at) return false;
  if (!fax.document_url) return false; // nothing to re-send
  // Use >= so the budget is spent at retry_count === maxRetries, matching
  // planFaxRetry's `attempts >= maxRetries` cap. With `>`, a fax sitting at
  // exactly maxRetries (with next_retry_at still set from the prior attempt)
  // would get one extra send/charge beyond the configured budget.
  if ((Number(fax.retry_count) || 0) >= c.maxRetries) return false;
  const t = new Date(fax.next_retry_at).getTime();
  return Number.isFinite(t) && now >= t;
}
