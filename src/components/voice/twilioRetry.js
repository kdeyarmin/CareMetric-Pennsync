/**
 * twilioRetry — retry/backoff policy for outbound Twilio API calls.
 *
 * Every outbound Twilio path (sendSms, startMaskedCall, dispatchScheduledSms,
 * sendTestSms) makes a single bounded fetch to Twilio. A transient hiccup — a
 * 429 rate-limit, a 502/503/504 from a Twilio edge, or a dropped connection —
 * would otherwise fail the whole send and strand the patient, when a second
 * attempt a fraction of a second later would have gone through. This module is
 * the unit-tested source of truth for *whether* to retry and *how long* to wait
 * between attempts; the single-file backend functions keep an inline copy of
 * this policy (the Base44 deploy model forbids cross-file imports).
 *
 * Why retries are safe (no double-send): an explicit retryable HTTP status
 * (429/5xx) means Twilio told us the request failed, so re-sending cannot
 * deliver twice. A *thrown* network error is ambiguous (the request may have
 * landed). Because Twilio's REST API has no client idempotency key, the
 * non-idempotent send paths set `retryNetworkErrors: false` so an ambiguous
 * transport failure is surfaced rather than blindly re-sent — a later redrive
 * pass handles anything Twilio actually reported as failed.
 *
 * What is NOT retried: permanent client errors (400/401/403/404/422). Those
 * mean the request itself is wrong (bad number, bad credentials, opted-out) and
 * will fail identically on every attempt — retrying only wastes time and money.
 */

// HTTP statuses worth retrying: an explicit rate-limit, plus transient
// gateway/server errors that commonly clear on their own. Everything else
// (including all other 4xx) is treated as permanent.
export const RETRYABLE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

/** True when an HTTP status is a transient failure worth retrying. */
export function isRetryableStatus(status) {
  return RETRYABLE_STATUSES.has(Number(status));
}

/**
 * True when a thrown fetch error is transient (a timeout abort or a transport
 * failure) and therefore worth retrying. A programming error (e.g. a TypeError
 * from bad code rather than a dropped connection) is hard to tell apart from a
 * transport TypeError, so we lean on the message as well — but because retries
 * are idempotent (same clientMessageId) a false-positive retry is harmless.
 */
export function isRetryableError(err) {
  if (!err) return false;
  const name = err.name || "";
  if (name === "AbortError" || name === "TimeoutError" || name === "TypeError") return true;
  return /network|timeout|timed out|fetch failed|socket|ECONN|ETIMEDOUT|EAI_AGAIN|dns/i.test(
    err.message || "",
  );
}

/**
 * Parse a `Retry-After` header into milliseconds from now, or null when absent
 * or unparseable. Supports both header forms: delta-seconds ("120") and an
 * HTTP-date ("Wed, 21 Oct 2026 07:28:00 GMT"). Never returns a negative value.
 */
export function parseRetryAfter(headerValue, nowMs = Date.now()) {
  if (headerValue == null) return null;
  const raw = String(headerValue).trim();
  if (raw === "") return null;
  if (/^\d+$/.test(raw)) return Number(raw) * 1000;
  const dateMs = Date.parse(raw);
  if (!Number.isNaN(dateMs)) return Math.max(0, dateMs - nowMs);
  return null;
}

/**
 * Exponential backoff for a given (1-based) attempt number: the delay to wait
 * BEFORE making retry #attempt. `attempt` 1 → ~baseMs, 2 → ~2·baseMs, etc.,
 * capped at `maxMs`. With jitter (default), returns "full jitter" — a random
 * value in [exp/2, exp] — so many retriers don't re-collide in lock-step.
 */
export function backoffDelayMs(
  attempt,
  { baseMs = 300, maxMs = 4000, jitter = true, rand = Math.random } = {},
) {
  const n = Math.max(1, Number(attempt) || 1);
  const exp = Math.min(maxMs, baseMs * 2 ** (n - 1));
  if (!jitter) return exp;
  return Math.round(exp / 2 + rand() * (exp / 2));
}

/**
 * The delay before the next retry: honor a server-provided `Retry-After` when
 * present (clamped to `maxMs` so a hostile/huge value can't hang the function),
 * otherwise fall back to jittered exponential backoff.
 *
 * @param {number} attempt 1-based attempt number just completed.
 * @param {{ retryAfter?: string|number|null, baseMs?: number, maxMs?: number,
 *   jitter?: boolean, rand?: () => number, nowMs?: number }} [options]
 * @returns {number} milliseconds to wait before the next attempt.
 */
export function nextRetryDelayMs(
  attempt,
  { retryAfter, baseMs = 300, maxMs = 4000, jitter = true, rand = Math.random, nowMs } = {},
) {
  const fromHeader = parseRetryAfter(retryAfter, nowMs);
  if (fromHeader != null) return Math.min(fromHeader, maxMs);
  return backoffDelayMs(attempt, { baseMs, maxMs, jitter, rand });
}

/**
 * Run `attemptFn` with bounded retries and backoff. `attemptFn(attempt)` is
 * called with the 1-based attempt number and must return a result shaped like a
 * fetch outcome: `{ ok, status, retryAfter? , ... }`. It may throw for a
 * transport-level failure (network/timeout); a thrown error is retried when
 * `isRetryableError` says so.
 *
 * Returns the final result with an added `attempts` count. A retryable failure
 * that exhausts the budget returns the last failing result (so the caller still
 * sees the real status/body); a non-retryable thrown error is re-thrown.
 *
 * `retryNetworkErrors` (default true) controls whether a *thrown* transport
 * failure is retried. Set it false for a non-idempotent operation such as voice
 * call origination — there a dropped connection might mean the call was already
 * placed, so a blind retry could double-dial. Retryable HTTP *statuses*
 * (where the server explicitly told us it failed) are always safe to retry.
 *
 * `sleep`/`now`/`rand` are injectable so the policy is fully unit-testable
 * without real timers or randomness.
 */
export async function sendWithRetry(
  attemptFn,
  {
    maxAttempts = 3,
    baseMs = 300,
    maxMs = 4000,
    jitter = true,
    retryNetworkErrors = true,
    rand = Math.random,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now = () => Date.now(),
  } = {},
) {
  const total = Math.max(1, Number(maxAttempts) || 1);
  let lastError;
  for (let attempt = 1; attempt <= total; attempt++) {
    let result;
    try {
      result = await attemptFn(attempt);
    } catch (err) {
      const isLast = attempt === total;
      if (isLast || !retryNetworkErrors || !isRetryableError(err)) throw err;
      lastError = err;
      await sleep(backoffDelayMs(attempt, { baseMs, maxMs, jitter, rand }));
      continue;
    }

    const ok = result && result.ok;
    const retryable = result && isRetryableStatus(result.status);
    if (ok || !retryable || attempt === total) {
      return { ...result, attempts: attempt };
    }
    await sleep(
      nextRetryDelayMs(attempt, {
        retryAfter: result.retryAfter,
        baseMs,
        maxMs,
        jitter,
        rand,
        nowMs: now(),
      }),
    );
  }
  // Unreachable when maxAttempts >= 1 (the loop returns or throws), but keep a
  // defensive throw so a misconfigured maxAttempts can never silently return.
  throw lastError || new Error("sendWithRetry exhausted attempts without a result");
}
