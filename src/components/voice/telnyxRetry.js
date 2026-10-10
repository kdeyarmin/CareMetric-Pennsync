/**
 * telnyxRetry — retry/backoff policy for outbound Telnyx API calls.
 *
 * Every outbound Telnyx path (sendSms, startMaskedCall, dispatchScheduledSms,
 * sendTestSms) makes a single bounded request to Telnyx. A rate limit or an
 * edge that is shedding load would otherwise fail the whole send and strand the
 * patient, when a second attempt a fraction of a second later would have gone
 * through. This module is the unit-tested source of truth for *whether* to
 * retry and *how long* to wait between attempts; the single-file backend
 * functions keep an inline copy of this policy (the Base44 deploy model forbids
 * cross-file imports), held to it by
 * base44/functionTests/telnyxRetryInlineParity.test.js.
 *
 * None of these requests is idempotent. POST /v2/messages and POST /v2/calls
 * take no idempotency key (Telnyx OpenAPI spec, read 2026-10-09), so a request
 * Telnyx processed and a retry of it are two texts, or two calls. A retry is
 * therefore safe ONLY when the failure proves the request was not processed:
 *   - 408 Request Timeout: the server did not receive a complete request
 *     message (RFC 9110 §15.5.9), so there was nothing to process;
 *   - 425 Too Early: the server declined to process a request that might be
 *     replayed (RFC 8470 §5.2);
 *   - 429 Too Many Requests: refused by rate limiting before it was handled
 *     (RFC 6585 §4);
 *   - 503 Service Unavailable: the server was unable to handle the request
 *     (RFC 9110 §15.6.4).
 * 500, 502 and 504 prove nothing of the kind: a gateway can fail or time out
 * AFTER the upstream accepted the message, so their outcome is unknown and a
 * retry can text the patient twice. They are not retried.
 *
 * A *thrown* error is the same question. A timeout/abort fires while the
 * request is in flight, and a reset can follow a request the server received,
 * so neither is ever retried. Only a failure in the connect phase — DNS could
 * not resolve, the TCP connection was refused, the TLS handshake failed —
 * proves no byte of the request reached Telnyx (connectionNeverOpened), and
 * even that is retried only when a caller opts in (`retryNetworkErrors`, off by
 * default; every production path leaves it off).
 *
 * What is NOT retried: permanent client errors (400/401/403/404/422). Those
 * mean the request itself is wrong (bad number, bad credentials, opted-out) and
 * will fail identically on every attempt — retrying only wastes time and money.
 */

// HTTP statuses that prove Telnyx did not process the request (see above).
// Everything else — 500, 502 and 504 included — is final for this request.
export const RETRYABLE_STATUSES = new Set([408, 425, 429, 503]);

/** True when an HTTP status is a transient failure worth retrying. */
export function isRetryableStatus(status) {
  return RETRYABLE_STATUSES.has(Number(status));
}

// Signatures of a failure in the CONNECT phase, before any byte of the request
// was written: Node's fetch carries the errno on err.cause.code, and Deno's
// message names hyper's Connect error kind, the refused TCP connection or the
// failed DNS lookup.
export const CONNECT_PHASE_FAILURE =
  /\b(?:ECONNREFUSED|ENOTFOUND|EAI_AGAIN|EHOSTUNREACH|ENETUNREACH)\b|getaddrinfo|dns error|failed to lookup address|tcp connect error|client error \(Connect\)|connection refused/i;

/**
 * True when a thrown fetch error proves the connection to the provider never
 * opened, so the request cannot have been received. A timeout or abort is never
 * such a proof (the request was in flight when it fired), and neither is a
 * reset, a hang-up or a bare "fetch failed".
 */
export function connectionNeverOpened(err) {
  if (!err || err.name === "AbortError" || err.name === "TimeoutError") return false;
  const cause = err.cause && typeof err.cause === "object" ? err.cause : {};
  return [err.code, err.message, cause.code, cause.message]
    .some((part) => typeof part === "string" && CONNECT_PHASE_FAILURE.test(part));
}

/**
 * True when a thrown fetch error may be retried: only a connection that never
 * opened. (This used to retry every timeout and transport TypeError on the
 * belief that retries were deduplicated by a clientMessageId. They are not —
 * Telnyx takes no idempotency key and none is sent — so that rule could
 * double-text.)
 */
export function isRetryableError(err) {
  return connectionNeverOpened(err);
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
 * `retryNetworkErrors` (default false) controls whether a *thrown* transport
 * failure is retried at all, and even when it is enabled only a connection that
 * never opened is retried (isRetryableError). Every Telnyx request is
 * non-idempotent, so the production paths leave it off. The retryable HTTP
 * *statuses* are retried because each of them proves the request was not
 * processed.
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
    retryNetworkErrors = false,
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
