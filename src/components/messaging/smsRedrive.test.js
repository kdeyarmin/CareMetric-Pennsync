import { test } from "node:test";
import assert from "node:assert/strict";
import { isTransientFailureReason, shouldRedriveSms } from "./smsRedrive.js";

test("isTransientFailureReason flags retryable reasons", () => {
  assert.equal(isTransientFailureReason("Timed out after 15000 ms reaching Twilio"), true);
  assert.equal(isTransientFailureReason("Network error reaching Twilio: fetch failed"), true);
  assert.equal(isTransientFailureReason("Twilio API error (503)"), true);
  assert.equal(isTransientFailureReason("rate limit exceeded"), true);
});

test("isTransientFailureReason refuses permanent reasons", () => {
  assert.equal(isTransientFailureReason("This patient has opted out of text messages (replied STOP)."), false);
  assert.equal(isTransientFailureReason("Invalid destination phone number"), false);
  assert.equal(isTransientFailureReason("Twilio API error (403)"), false);
  assert.equal(isTransientFailureReason("SMS messaging disabled for the agency"), false);
  // A permanent signal wins even if a transient word is also present.
  assert.equal(isTransientFailureReason("invalid number, connection refused"), false);
  // Unknown/empty → not retried.
  assert.equal(isTransientFailureReason(""), false);
  assert.equal(isTransientFailureReason(null), false);
});

const baseRow = {
  status: "failed",
  direction: "outbound",
  failure_reason: "Timed out reaching Twilio",
  retry_count: 0,
  created_date: new Date("2026-06-04T12:00:00Z").toISOString(),
  last_retry_at: null,
};
const NOW = new Date("2026-06-04T12:05:00Z").getTime(); // 5 min after creation

test("shouldRedriveSms re-drives a fresh transient failure", () => {
  assert.equal(shouldRedriveSms(baseRow, NOW), true);
});

test("shouldRedriveSms skips non-failed / inbound rows", () => {
  assert.equal(shouldRedriveSms({ ...baseRow, status: "sent" }, NOW), false);
  assert.equal(shouldRedriveSms({ ...baseRow, direction: "inbound" }, NOW), false);
});

test("shouldRedriveSms respects the attempt cap", () => {
  assert.equal(shouldRedriveSms({ ...baseRow, retry_count: 4 }, NOW), false);
  assert.equal(shouldRedriveSms({ ...baseRow, retry_count: 3 }, NOW + 60 * 60 * 1000), true);
});

test("shouldRedriveSms will not retry a permanent failure", () => {
  assert.equal(shouldRedriveSms({ ...baseRow, failure_reason: "Recipient opted out" }, NOW), false);
});

test("shouldRedriveSms enforces an escalating backoff gap", () => {
  // attempt 1 already done 30s ago → need 2× base (120s) since last try.
  const justTried = { ...baseRow, retry_count: 1, last_retry_at: new Date(NOW - 30_000).toISOString() };
  assert.equal(shouldRedriveSms(justTried, NOW), false);
  // 3 minutes later it's eligible again.
  assert.equal(shouldRedriveSms(justTried, NOW + 3 * 60_000), true);
});

test("shouldRedriveSms gives up on rows past the age ceiling", () => {
  const old = { ...baseRow, created_date: new Date(NOW - 48 * 60 * 60 * 1000).toISOString(), last_retry_at: null };
  assert.equal(shouldRedriveSms(old, NOW), false);
});

test("shouldRedriveSms refuses rows with missing or invalid creation timestamps", () => {
  assert.equal(shouldRedriveSms({ ...baseRow, created_date: "not-a-date" }, NOW), false);
  assert.equal(shouldRedriveSms({ ...baseRow, created_date: null }, NOW), false);
});
