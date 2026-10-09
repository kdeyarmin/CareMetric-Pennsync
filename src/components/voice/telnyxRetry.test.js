import { test } from "node:test";
import assert from "node:assert/strict";
import {
  RETRYABLE_STATUSES,
  isRetryableStatus,
  isRetryableError,
  connectionNeverOpened,
  parseRetryAfter,
  backoffDelayMs,
  nextRetryDelayMs,
  sendWithRetry,
} from "./telnyxRetry.js";

test("isRetryableStatus retries only the statuses that prove the request was not processed", () => {
  // 408 (request never complete), 425 (refused as replayable), 429 (rate
  // limited before handling), 503 (server unable to handle it).
  for (const s of [408, 425, 429, 503]) {
    assert.equal(isRetryableStatus(s), true, `expected ${s} retryable`);
  }
  assert.deepEqual([...RETRYABLE_STATUSES].sort(), [408, 425, 429, 503]);
  // String form (headers/JSON can arrive as strings) still resolves.
  assert.equal(isRetryableStatus("503"), true);
});

test("an outcome-unknown 5xx is never retried: POST /v2/messages has no idempotency key", () => {
  // A gateway can fail or time out after the upstream accepted the message,
  // so a retry of 500/502/504 can text the patient twice.
  for (const s of [500, 502, 504]) {
    assert.equal(isRetryableStatus(s), false, `expected ${s} non-retryable`);
  }
});

test("isRetryableStatus never retries permanent client/success statuses", () => {
  for (const s of [200, 201, 202, 400, 401, 403, 404, 409, 422]) {
    assert.equal(isRetryableStatus(s), false, `expected ${s} non-retryable`);
  }
  assert.equal(RETRYABLE_STATUSES.has(400), false);
});

test("isRetryableError admits only a connection that never opened", () => {
  // Connect-phase failures: nothing reached Telnyx.
  assert.equal(isRetryableError(new Error("getaddrinfo EAI_AGAIN api.telnyx.com")), true);
  assert.equal(isRetryableError(Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } })), true);
  assert.equal(isRetryableError(Object.assign(new TypeError("fetch failed"), { cause: { code: "ENOTFOUND" } })), true);
  assert.equal(isRetryableError(new TypeError(
    "error sending request for url (https://api.telnyx.com/v2/messages): client error (Connect): tcp connect error: Connection refused (os error 111)",
  )), true);
  assert.equal(connectionNeverOpened(new TypeError("error sending request: client error (Connect): dns error: failed to lookup address")), true);

  // A timeout or abort fired while the request was in flight: outcome unknown.
  assert.equal(isRetryableError({ name: "AbortError", message: "The signal has been aborted" }), false);
  assert.equal(isRetryableError({ name: "TimeoutError", message: "getaddrinfo timed out" }), false);
  // A reset or hang-up can follow a request the server received.
  assert.equal(isRetryableError(Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNRESET" } })), false);
  assert.equal(isRetryableError(new TypeError("error sending request: connection closed before message completed")), false);
  assert.equal(isRetryableError(new TypeError("fetch failed")), false);
  assert.equal(isRetryableError(new Error("network error reaching host")), false);
  assert.equal(isRetryableError(new Error("socket hang up")), false);
  // A plain application error is not a transport failure.
  assert.equal(isRetryableError(new Error("invalid destination")), false);
  assert.equal(isRetryableError(null), false);
  assert.equal(isRetryableError(undefined), false);
});

test("parseRetryAfter understands both header forms", () => {
  assert.equal(parseRetryAfter("120"), 120000);
  assert.equal(parseRetryAfter("0"), 0);
  // HTTP-date form, relative to an injected "now".
  const now = Date.parse("Wed, 21 Oct 2026 07:28:00 GMT");
  assert.equal(parseRetryAfter("Wed, 21 Oct 2026 07:28:30 GMT", now), 30000);
  // A past date never goes negative.
  assert.equal(parseRetryAfter("Wed, 21 Oct 2026 07:27:00 GMT", now), 0);
});

test("parseRetryAfter returns null when absent or unparseable", () => {
  assert.equal(parseRetryAfter(null), null);
  assert.equal(parseRetryAfter(undefined), null);
  assert.equal(parseRetryAfter(""), null);
  assert.equal(parseRetryAfter("   "), null);
  assert.equal(parseRetryAfter("soon"), null);
});

test("backoffDelayMs grows exponentially and caps at maxMs (no jitter)", () => {
  const opts = { baseMs: 300, maxMs: 4000, jitter: false };
  assert.equal(backoffDelayMs(1, opts), 300);
  assert.equal(backoffDelayMs(2, opts), 600);
  assert.equal(backoffDelayMs(3, opts), 1200);
  assert.equal(backoffDelayMs(4, opts), 2400);
  assert.equal(backoffDelayMs(5, opts), 4000); // 4800 capped
  assert.equal(backoffDelayMs(9, opts), 4000); // still capped
});

test("backoffDelayMs full-jitter stays within [exp/2, exp]", () => {
  // rand=0 → floor (exp/2); rand≈1 → ceiling (exp).
  assert.equal(backoffDelayMs(2, { baseMs: 300, maxMs: 4000, rand: () => 0 }), 300);
  assert.equal(backoffDelayMs(2, { baseMs: 300, maxMs: 4000, rand: () => 0.999999 }), 600);
});

test("nextRetryDelayMs prefers Retry-After but clamps it to maxMs", () => {
  // Header present → used (clamped). 120s would exceed a 4s cap.
  assert.equal(nextRetryDelayMs(1, { retryAfter: "120", maxMs: 4000 }), 4000);
  assert.equal(nextRetryDelayMs(1, { retryAfter: "2", maxMs: 4000 }), 2000);
  // No header → falls back to deterministic backoff.
  assert.equal(
    nextRetryDelayMs(2, { baseMs: 300, maxMs: 4000, jitter: false }),
    600,
  );
});

// ---- sendWithRetry orchestration ------------------------------------------

function recorder() {
  const delays = [];
  return {
    delays,
    sleep: async (ms) => {
      delays.push(ms);
    },
  };
}

test("sendWithRetry returns immediately on first success", async () => {
  const { delays, sleep } = recorder();
  let calls = 0;
  const result = await sendWithRetry(
    async (attempt) => {
      calls++;
      assert.equal(attempt, 1);
      return { ok: true, status: 200, data: { umid: "abc" } };
    },
    { sleep },
  );
  assert.equal(result.ok, true);
  assert.equal(result.attempts, 1);
  assert.equal(result.data.umid, "abc");
  assert.equal(calls, 1);
  assert.deepEqual(delays, []); // never slept
});

test("sendWithRetry retries a transient status then succeeds", async () => {
  const { delays, sleep } = recorder();
  const statuses = [503, 429, 200];
  let i = 0;
  const result = await sendWithRetry(
    async () => {
      const status = statuses[i++];
      return { ok: status === 200, status };
    },
    { sleep, jitter: false, baseMs: 300, maxMs: 4000, maxAttempts: 3 },
  );
  assert.equal(result.ok, true);
  assert.equal(result.attempts, 3);
  // Slept before attempt 2 (300ms) and attempt 3 (600ms).
  assert.deepEqual(delays, [300, 600]);
});

test("sendWithRetry honors a Retry-After header on a 429", async () => {
  const { delays, sleep } = recorder();
  const responses = [
    { ok: false, status: 429, retryAfter: "2" },
    { ok: true, status: 200 },
  ];
  let i = 0;
  const result = await sendWithRetry(async () => responses[i++], {
    sleep,
    maxMs: 4000,
  });
  assert.equal(result.ok, true);
  assert.deepEqual(delays, [2000]); // used Retry-After, not backoff
});

test("sendWithRetry stops at maxAttempts and returns the last failure", async () => {
  const { delays, sleep } = recorder();
  let calls = 0;
  const result = await sendWithRetry(
    async () => {
      calls++;
      return { ok: false, status: 503, data: { message: "unavailable" } };
    },
    { sleep, jitter: false, baseMs: 300, maxAttempts: 3 },
  );
  assert.equal(result.ok, false);
  assert.equal(result.status, 503);
  assert.equal(result.attempts, 3);
  assert.equal(result.data.message, "unavailable");
  assert.equal(calls, 3); // tried exactly maxAttempts times
  assert.equal(delays.length, 2); // slept between the 3 attempts
});

test("sendWithRetry never retries a permanent status", async () => {
  const { delays, sleep } = recorder();
  let calls = 0;
  const result = await sendWithRetry(
    async () => {
      calls++;
      return { ok: false, status: 400, data: { error: "bad number" } };
    },
    { sleep, maxAttempts: 3 },
  );
  assert.equal(result.attempts, 1);
  assert.equal(calls, 1);
  assert.deepEqual(delays, []);
});

test("sendWithRetry never retries an outcome-unknown 5xx", async () => {
  const { delays, sleep } = recorder();
  for (const status of [500, 502, 504]) {
    let calls = 0;
    const result = await sendWithRetry(
      async () => {
        calls++;
        return { ok: false, status };
      },
      { sleep, maxAttempts: 3 },
    );
    assert.equal(result.attempts, 1, `${status} is final`);
    assert.equal(calls, 1, `${status} is sent once`);
  }
  assert.deepEqual(delays, []);
});

test("sendWithRetry retries a never-opened connection only when the caller opts in", async () => {
  const { delays, sleep } = recorder();
  let i = 0;
  const result = await sendWithRetry(
    async () => {
      if (i++ === 0) throw new Error("getaddrinfo EAI_AGAIN api.telnyx.com");
      return { ok: true, status: 200 };
    },
    { sleep, jitter: false, baseMs: 300, retryNetworkErrors: true },
  );
  assert.equal(result.ok, true);
  assert.equal(result.attempts, 2);
  assert.deepEqual(delays, [300]);
});

test("sendWithRetry never retries a timeout, even with network retries enabled", async () => {
  const { delays, sleep } = recorder();
  let calls = 0;
  await assert.rejects(
    () =>
      sendWithRetry(
        async () => {
          calls++;
          throw Object.assign(new Error("The signal has been aborted"), { name: "AbortError" });
        },
        { sleep, retryNetworkErrors: true, maxAttempts: 3 },
      ),
    /aborted/,
  );
  assert.equal(calls, 1, "a timed-out request may have been accepted");
  assert.deepEqual(delays, []);
});

test("sendWithRetry does not retry thrown errors by default", async () => {
  const { delays, sleep } = recorder();
  let calls = 0;
  await assert.rejects(
    () =>
      sendWithRetry(
        async () => {
          calls++;
          throw new Error("getaddrinfo EAI_AGAIN api.telnyx.com");
        },
        { sleep, maxAttempts: 3 },
      ),
    /EAI_AGAIN/,
  );
  assert.equal(calls, 1);
  assert.deepEqual(delays, []);
});

test("sendWithRetry re-throws a non-retryable error without sleeping", async () => {
  const { delays, sleep } = recorder();
  await assert.rejects(
    () =>
      sendWithRetry(
        async () => {
          throw new Error("invalid destination phone number");
        },
        { sleep },
      ),
    /invalid destination/,
  );
  assert.deepEqual(delays, []);
});

test("sendWithRetry with retryNetworkErrors=false never retries a thrown error", async () => {
  // Models a non-idempotent op (voice origination): a dropped connection might
  // mean the call already went through, so we must not blindly re-dial.
  const { delays, sleep } = recorder();
  let calls = 0;
  await assert.rejects(
    () =>
      sendWithRetry(
        async () => {
          calls++;
          throw new Error("network error reaching Telnyx");
        },
        { sleep, retryNetworkErrors: false, maxAttempts: 3 },
      ),
    /network error reaching Telnyx/,
  );
  assert.equal(calls, 1); // only one attempt — never retried
  assert.deepEqual(delays, []);
});

test("sendWithRetry with retryNetworkErrors=false still retries transient statuses", async () => {
  // A 503 is a definitive server rejection, so retrying it is safe even for a
  // non-idempotent op — the request provably never took effect.
  const { delays, sleep } = recorder();
  const statuses = [503, 200];
  let i = 0;
  const result = await sendWithRetry(
    async () => {
      const status = statuses[i++];
      return { ok: status === 200, status };
    },
    { sleep, jitter: false, baseMs: 300, retryNetworkErrors: false },
  );
  assert.equal(result.ok, true);
  assert.equal(result.attempts, 2);
  assert.deepEqual(delays, [300]);
});

test("sendWithRetry re-throws a transient error once attempts are exhausted", async () => {
  const { delays, sleep } = recorder();
  let calls = 0;
  await assert.rejects(
    () =>
      sendWithRetry(
        async () => {
          calls++;
          throw new Error("tcp connect error: Connection refused (os error 111)");
        },
        { sleep, jitter: false, baseMs: 300, maxAttempts: 2, retryNetworkErrors: true },
      ),
    /Connection refused/,
  );
  assert.equal(calls, 2);
  assert.deepEqual(delays, [300]); // slept once between the two tries
});
