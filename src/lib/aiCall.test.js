import { test } from "node:test";
import assert from "node:assert/strict";
import { withTimeout, runWithRetry, defaultShouldRetry } from "./aiCall.js";

test("withTimeout resolves when the promise settles in time", async () => {
  const result = await withTimeout(Promise.resolve("ok"), 1000);
  assert.equal(result, "ok");
});

test("withTimeout rejects with AI_TIMEOUT when too slow", async () => {
  const never = new Promise(() => {});
  await assert.rejects(() => withTimeout(never, 10), (err) => err.code === "AI_TIMEOUT");
});

test("withTimeout with non-positive ms disables the timeout", async () => {
  const result = await withTimeout(Promise.resolve(42), 0);
  assert.equal(result, 42);
});

test("runWithRetry returns on first success without retrying", async () => {
  let calls = 0;
  const out = await runWithRetry(() => { calls += 1; return Promise.resolve("v"); }, { backoffMs: 0 });
  assert.equal(out, "v");
  assert.equal(calls, 1);
});

test("runWithRetry retries transient failures then succeeds", async () => {
  let calls = 0;
  const out = await runWithRetry(() => {
    calls += 1;
    if (calls < 3) return Promise.reject(new Error("blip"));
    return Promise.resolve("done");
  }, { retries: 2, backoffMs: 0 });
  assert.equal(out, "done");
  assert.equal(calls, 3);
});

test("runWithRetry throws after exhausting retries", async () => {
  let calls = 0;
  await assert.rejects(
    () => runWithRetry(() => { calls += 1; return Promise.reject(new Error("always")); }, { retries: 1, backoffMs: 0 }),
    /always/
  );
  assert.equal(calls, 2); // initial + 1 retry
});

test("runWithRetry does not retry non-retryable errors (e.g. 403)", async () => {
  let calls = 0;
  const err = Object.assign(new Error("forbidden"), { status: 403 });
  await assert.rejects(
    () => runWithRetry(() => { calls += 1; return Promise.reject(err); }, { retries: 3, backoffMs: 0 }),
    /forbidden/
  );
  assert.equal(calls, 1);
});

test("runWithRetry surfaces a timeout when an attempt is too slow", async () => {
  await assert.rejects(
    () => runWithRetry(() => new Promise(() => {}), { retries: 0, timeoutMs: 10, backoffMs: 0 }),
    (e) => e.code === "AI_TIMEOUT"
  );
});

test("defaultShouldRetry classifies errors correctly", () => {
  assert.equal(defaultShouldRetry({ status: 500 }), true);
  assert.equal(defaultShouldRetry({ status: 429 }), true);
  assert.equal(defaultShouldRetry({ code: "AI_TIMEOUT" }), true);
  assert.equal(defaultShouldRetry({ status: 401 }), false);
  assert.equal(defaultShouldRetry({ status: 402 }), false);
  assert.equal(defaultShouldRetry({ status: 422 }), false);
  assert.equal(defaultShouldRetry({ data: { extra_data: { reason: "integration_credits_limit_reached" } } }), false);
});
