/**
 * Shared timeout + retry policy for AI (LLM) calls.
 *
 * These helpers are intentionally free of React and the Base44 SDK so they can be
 * unit-tested in isolation. The `useAICall` hook (src/hooks/useAICall.js) wires them
 * to `base44.integrations.Core.InvokeLLM`. There are ~200 LLM call sites in the app,
 * none of which currently share a timeout/retry policy — this is the foundation for
 * standardizing them.
 */

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Reject if `promise` has not settled within `ms`. A non-positive `ms` disables the
 * timeout. The underlying work is not aborted (the SDK has no abort hook) — we simply
 * stop waiting and surface a clear, retryable error.
 */
export function withTimeout(promise, ms, message = "AI request timed out") {
  if (!ms || ms <= 0) return Promise.resolve(promise);
  let timer;
  const timeout = new Promise((_resolve, reject) => {
    timer = setTimeout(() => {
      const err = new Error(message);
      err.code = "AI_TIMEOUT";
      reject(err);
    }, ms);
  });
  return Promise.race([Promise.resolve(promise), timeout]).finally(() => clearTimeout(timer));
}

/**
 * Errors that will never succeed on retry: auth, payment/credit limits, and
 * client-side (4xx) validation. Everything else (network blips, timeouts, 5xx,
 * rate limits) is considered transient and worth retrying.
 */
export function defaultShouldRetry(err) {
  if (err?.code === "AI_TIMEOUT") return true;
  const status = err?.status ?? err?.response?.status;
  if (status === 401 || status === 403 || status === 402 || status === 422 || status === 400) {
    return false;
  }
  if (err?.data?.extra_data?.reason === "integration_credits_limit_reached") return false;
  return true;
}

/**
 * Run `fn` with a per-attempt timeout and exponential backoff between retries.
 * `fn` receives the zero-based attempt index. Resolves with `fn`'s result, or
 * rejects with the last error once retries are exhausted or `shouldRetry` is false.
 */
export async function runWithRetry(
  fn,
  { retries = 2, timeoutMs = 30000, backoffMs = 500, shouldRetry = defaultShouldRetry } = {}
) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await withTimeout(fn(attempt), timeoutMs);
    } catch (err) {
      lastErr = err;
      if (attempt === retries || !shouldRetry(err)) break;
      if (backoffMs > 0) await sleep(backoffMs * 2 ** attempt);
    }
  }
  throw lastErr;
}
