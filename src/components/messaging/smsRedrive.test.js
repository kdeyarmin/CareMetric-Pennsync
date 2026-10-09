import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isTransientFailureReason, shouldRedriveSms, telnyxApiFailureReason, telnyxTransportFailureReason,
  telnyxDeliveryFailureReason, telnyxErrorCode, telnyxErrorsInclude, telnyxSendStatus, REDRIVABLE_HTTP_STATUSES,
} from "./smsRedrive.js";
import { RETRYABLE_STATUSES } from "../voice/telnyxRetry.js";

test("an API failure reason leads with the HTTP status and Telnyx's error code", () => {
  assert.equal(
    telnyxApiFailureReason(429, [{ code: "10011", title: "Too many requests", detail: "Too many requests" }]),
    "Telnyx API error: HTTP 429, code 10011: Too many requests",
  );
  assert.equal(telnyxApiFailureReason(503, []), "Telnyx API error: HTTP 503, code none");
  assert.equal(telnyxApiFailureReason(400, [{ code: 40300, title: "Blocked due to STOP message" }]),
    "Telnyx API error: HTTP 400, code 40300: Blocked due to STOP message");
  // A non-numeric code or status is never trusted into the prefix.
  assert.equal(telnyxApiFailureReason("x", [{ code: "10011; drop", detail: "a\n b" }]), "Telnyx API error: HTTP 0, code none: a b");
  assert.equal(telnyxErrorCode([{ code: " 40300 " }]), "40300");
  assert.equal(telnyxErrorCode(null), null);
  assert.equal(telnyxErrorsInclude([{ code: "10001" }, { code: 40300 }], "40300"), true);
  assert.equal(telnyxErrorsInclude([{ code: "403001" }], "40300"), false);
  assert.equal(telnyxDeliveryFailureReason([{ code: "40008", detail: "Undeliverable" }]), "Telnyx delivery failed: code 40008: Undeliverable");
});

test("a transport failure is redrivable only when the connection never opened", () => {
  const abort = Object.assign(new Error("aborted"), { name: "AbortError" });
  assert.match(telnyxTransportFailureReason(abort, 15000), /^Outcome unknown: Telnyx did not answer within 15000 ms/);
  assert.match(telnyxTransportFailureReason(new TypeError("fetch failed"), 15000), /^Outcome unknown: the connection/);
  const refused = Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } });
  assert.match(telnyxTransportFailureReason(refused, 15000), /^Connection never opened/);
  assert.equal(isTransientFailureReason(telnyxTransportFailureReason(refused, 15000)), true);
  assert.equal(isTransientFailureReason(telnyxTransportFailureReason(abort, 15000)), false);
  assert.equal(isTransientFailureReason(telnyxTransportFailureReason(new TypeError("fetch failed"), 15000)), false);
});

test("the redrive set is the in-request retry set: failures that prove nothing was processed", () => {
  assert.deepEqual([...REDRIVABLE_HTTP_STATUSES].sort(), [...RETRYABLE_STATUSES].sort());
  for (const status of [408, 425, 429, 503]) {
    assert.equal(isTransientFailureReason(telnyxApiFailureReason(status, [{ code: "10011", detail: "Too many requests" }])), true, String(status));
    assert.equal(isTransientFailureReason(`Telnyx API error (${status})`), true, `legacy ${status}`);
  }
});

test("an outcome-unknown 5xx is never redriven, whatever its prose says", () => {
  // A gateway can fail after Telnyx accepted the message; POST /v2/messages
  // has no idempotency key, so a re-send could text the patient twice.
  for (const status of [500, 502, 504]) {
    assert.equal(isTransientFailureReason(telnyxApiFailureReason(status, [{ code: "10007", detail: "Temporary network timeout" }])), false, String(status));
    assert.equal(isTransientFailureReason(`Telnyx API error (${status})`), false, `legacy ${status}`);
  }
  assert.equal(isTransientFailureReason("Invalid response from Telnyx API (502)"), false);
  assert.equal(isTransientFailureReason("Telnyx API error (504): gateway timeout"), false);
});

test("prose alone never admits a row: the status prefix does", () => {
  // These used to match /network|rate.?limit|timeout/ and were redriven.
  for (const reason of [
    "Too many requests", "rate limit exceeded", "Network error reaching Telnyx: dns error",
    "Network error reaching Telnyx: fetch failed", "Got an invalid/garbled reply, timed out",
    "Telnyx delivery failed: code 40006: Carrier temporarily unavailable",
  ]) {
    assert.equal(isTransientFailureReason(reason), false, reason);
  }
});

test("isTransientFailureReason refuses permanent reasons", () => {
  assert.equal(isTransientFailureReason("This patient has opted out of text messages (replied STOP)."), false);
  assert.equal(isTransientFailureReason("Invalid destination phone number"), false);
  assert.equal(isTransientFailureReason("Telnyx API error (403)"), false);
  assert.equal(isTransientFailureReason("Telnyx API error: HTTP 403, code 10010"), false);
  assert.equal(isTransientFailureReason("SMS messaging disabled for the agency"), false);
  // Telnyx's opt-out code is permanent even on a redrivable status.
  assert.equal(isTransientFailureReason("Telnyx API error: HTTP 429, code 40300"), false);
  // Prose can still veto a redrivable status.
  assert.equal(isTransientFailureReason("Telnyx API error: HTTP 503, code none: recipient opted out"), false);
  assert.equal(isTransientFailureReason("Invalid 'To' number (503 while validating)"), false);
  // Unknown/empty → not retried.
  assert.equal(isTransientFailureReason(""), false);
  assert.equal(isTransientFailureReason(null), false);
});

test("an accepted send is stored as queued until the receipt says more", () => {
  assert.equal(telnyxSendStatus({ data: { to: [{ status: "queued" }] } }), "queued");
  assert.equal(telnyxSendStatus({ data: { to: [{ status: "Sending" }] } }), "queued");
  assert.equal(telnyxSendStatus({ data: { id: "m1" } }), "queued");
  assert.equal(telnyxSendStatus({ data: { to: [{ status: "sent" }] } }), "sent");
  assert.equal(telnyxSendStatus(null), "queued");
});

const baseRow = {
  status: "failed",
  direction: "outbound",
  failure_reason: "Telnyx API error: HTTP 429, code 10011: Too many requests",
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

test("a timed-out send is outcome-unknown and never redriven (no double text)", () => {
  // The request reached Telnyx and got no answer, so it may have been accepted.
  for (const reason of [
    "Outcome unknown: Telnyx did not answer within 15000 ms, so the text may have been sent. Not retried automatically.",
    "Outcome unknown: Telnyx did not answer the redrive in time, so the text may have been sent. Not retried automatically.",
    // Rows written before the reason said so explicitly.
    "Timed out after 15000 ms reaching Telnyx",
    "Timed out reaching Telnyx (redrive)",
  ]) {
    assert.equal(isTransientFailureReason(reason), false, reason);
    assert.equal(shouldRedriveSms({ ...baseRow, failure_reason: reason }, NOW), false, reason);
  }
});
