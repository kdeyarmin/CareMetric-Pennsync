import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classifyFaxFailure,
  faxRetryConfig,
  nextRetryDelayMinutes,
  planFaxRetry,
  isFaxRetryDue,
} from "./faxRetry.js";

test("classifyFaxFailure flags permanent failures", () => {
  assert.equal(classifyFaxFailure("7211", "The remote number is not a fax machine"), "permanent");
  assert.equal(classifyFaxFailure(null, "Invalid 'To' phone number"), "permanent");
  assert.equal(classifyFaxFailure("", "Number not in service"), "permanent");
});

test("isFaxRetryDue stops at retry_count === maxRetries (no extra send/charge)", () => {
  const now = Date.now();
  const fax = (retry_count) => ({
    status: "failed",
    document_url: "u",
    next_retry_at: new Date(now - 1000).toISOString(),
    retry_count,
  });
  const cfg = { max_retries: 3 };
  assert.equal(isFaxRetryDue(fax(2), now, cfg), true);  // budget remains
  assert.equal(isFaxRetryDue(fax(3), now, cfg), false); // budget spent at == max
  assert.equal(isFaxRetryDue(fax(4), now, cfg), false);
});

test("classifyFaxFailure treats busy/no-answer/unknown as transient", () => {
  assert.equal(classifyFaxFailure("7207", "The receiving machine was busy"), "transient");
  assert.equal(classifyFaxFailure("7208", "No answer from remote"), "transient");
  assert.equal(classifyFaxFailure(null, "Temporary network error"), "transient");
  assert.equal(classifyFaxFailure("", ""), "transient");
});

test("faxRetryConfig applies safe defaults and honors overrides", () => {
  const d = faxRetryConfig(undefined);
  assert.equal(d.enabled, true);
  assert.equal(d.maxRetries, 3);
  assert.equal(d.baseDelayMinutes, 15);
  assert.equal(d.notifyOnFinalFailure, true);

  const c = faxRetryConfig({ auto_retry_enabled: false, max_retries: 5, retry_delay_minutes: 10, notify_on_final_failure: false });
  assert.equal(c.enabled, false);
  assert.equal(c.maxRetries, 5);
  assert.equal(c.baseDelayMinutes, 10);
  assert.equal(c.notifyOnFinalFailure, false);
});

test("nextRetryDelayMinutes grows exponentially from the configured base", () => {
  const config = { retry_delay_minutes: 15 };
  assert.equal(nextRetryDelayMinutes(0, config), 15);
  assert.equal(nextRetryDelayMinutes(1, config), 30);
  assert.equal(nextRetryDelayMinutes(2, config), 60);
  // Capped.
  assert.equal(nextRetryDelayMinutes(20, config), 360);
});

test("nextRetryDelayMinutes scales by the priority multiplier", () => {
  const config = { retry_delay_minutes: 20, priority_multiplier: { urgent: 0.5, low: 2 } };
  assert.equal(nextRetryDelayMinutes(0, config, "urgent"), 10); // half
  assert.equal(nextRetryDelayMinutes(0, config, "low"), 40); // double
  assert.equal(nextRetryDelayMinutes(0, config, "normal"), 20); // default 1
});

test("planFaxRetry schedules a transient failure within the budget", () => {
  const now = Date.parse("2026-06-04T12:00:00Z");
  const p = planFaxRetry({ retryCount: 0, errorMessage: "busy", config: { retry_delay_minutes: 15 }, now });
  assert.equal(p.willRetry, true);
  assert.equal(p.exhausted, false);
  assert.equal(p.nextRetryCount, 1);
  assert.equal(p.delayMinutes, 15);
  assert.equal(p.nextRetryAt, new Date(now + 15 * 60_000).toISOString());
});

test("planFaxRetry gives up immediately on a permanent failure", () => {
  const p = planFaxRetry({ retryCount: 0, errorMessage: "not a fax machine", config: {} });
  assert.equal(p.willRetry, false);
  assert.equal(p.exhausted, true);
  assert.equal(p.classification, "permanent");
  assert.equal(p.nextRetryAt, null);
});

test("planFaxRetry stops once the attempt budget is spent", () => {
  const p = planFaxRetry({ retryCount: 3, errorMessage: "busy", config: { max_retries: 3 } });
  assert.equal(p.willRetry, false);
  assert.equal(p.exhausted, true);
});

test("planFaxRetry honors the auto-retry kill switch", () => {
  const p = planFaxRetry({ retryCount: 0, errorMessage: "busy", config: { auto_retry_enabled: false } });
  assert.equal(p.willRetry, false);
  assert.equal(p.exhausted, true);
});

const dueFax = {
  status: "failed",
  document_url: "https://example.com/doc.pdf",
  retry_count: 1,
  next_retry_at: "2026-06-04T12:00:00Z",
};
const NOW = Date.parse("2026-06-04T12:05:00Z");

test("isFaxRetryDue accepts a due, retryable fax", () => {
  assert.equal(isFaxRetryDue(dueFax, NOW), true);
});

test("isFaxRetryDue rejects not-yet-due, non-failed, or undocumented faxes", () => {
  assert.equal(isFaxRetryDue({ ...dueFax, next_retry_at: "2026-06-04T13:00:00Z" }, NOW), false); // future
  assert.equal(isFaxRetryDue({ ...dueFax, status: "delivered" }, NOW), false);
  assert.equal(isFaxRetryDue({ ...dueFax, next_retry_at: null }, NOW), false);
  assert.equal(isFaxRetryDue({ ...dueFax, document_url: "" }, NOW), false);
});

test("isFaxRetryDue respects the max-retries ceiling and kill switch", () => {
  assert.equal(isFaxRetryDue({ ...dueFax, retry_count: 4 }, NOW, { max_retries: 3 }), false);
  assert.equal(isFaxRetryDue(dueFax, NOW, { auto_retry_enabled: false }), false);
});

test("faxRetryConfig coerces numeric-string config values", () => {
  const c = faxRetryConfig({ max_retries: "5", retry_delay_minutes: "10" });
  assert.equal(c.maxRetries, 5);
  assert.equal(c.baseDelayMinutes, 10);
});
