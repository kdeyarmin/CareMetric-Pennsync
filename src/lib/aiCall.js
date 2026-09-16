/** Shared timeout/retry policy. An uncertain paid operation must not replay. */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Stop waiting after ms, without pretending the SDK request was cancelled.
 * A timed-out request may still complete and be billed; never retry it blindly.
 */
export function withTimeout(promise, ms, message = "AI request timed out") {
  if (!ms || ms <= 0) return Promise.resolve(promise);
  let timer;
  const timeout = new Promise((_resolve, reject) => {
    timer = setTimeout(() => {
      const err = new Error(message);
      err.code = "AI_TIMEOUT";
      err.retryable = false;
      err.operationMayHaveExecuted = true;
      reject(err);
    }, ms);
  });
  return Promise.race([Promise.resolve(promise), timeout]).finally(() => clearTimeout(timer));
}

/** Authentication, credit exhaustion and explicit uncertain outcomes cannot retry. */
export function defaultShouldRetry(err) {
  if (err?.retryable === false || err?.operationMayHaveExecuted === true || err?.code === "AI_TIMEOUT") return false;
  const status = err?.status ?? err?.response?.status;
  if ([400, 401, 402, 403, 422].includes(status)) return false;
  if ([err?.data?.extra_data?.reason, err?.response?.data?.extra_data?.reason].includes("integration_credits_limit_reached")) return false;
  return true;
}

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
      if (attempt === retries || err?.retryable === false || err?.operationMayHaveExecuted === true || !shouldRetry(err)) break;
      if (backoffMs > 0) await sleep(backoffMs * 2 ** attempt);
    }
  }
  throw lastErr;
}
