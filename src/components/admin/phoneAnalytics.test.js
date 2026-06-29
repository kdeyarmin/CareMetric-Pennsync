import { test } from "node:test";
import assert from "node:assert/strict";
import { summarizePhoneActivity, formatDuration } from "./phoneAnalytics.js";

const iso = (daysAgo) => new Date(Date.now() - daysAgo * 86400000).toISOString();

test("empty input yields zeroed stats without dividing by zero", () => {
  const r = summarizePhoneActivity({});
  assert.equal(r.sms.total, 0);
  assert.equal(r.sms.deliveryRate, 0);
  assert.equal(r.calls.missedRate, 0);
  assert.equal(r.consent.tracked, 0);
  assert.equal(r.provisioning.coverageRate, 0);
});

test("SMS delivery and failure rates are computed over outbound only", () => {
  const r = summarizePhoneActivity({
    smsMessages: [
      { direction: "outbound", status: "delivered", created_date: iso(1) },
      { direction: "outbound", status: "delivered", created_date: iso(1) },
      { direction: "outbound", status: "failed", created_date: iso(1) },
      { direction: "outbound", status: "sent", created_date: iso(1) },
      { direction: "inbound", status: "received", created_date: iso(1) },
    ],
  });
  assert.equal(r.sms.total, 5);
  assert.equal(r.sms.outbound, 4);
  assert.equal(r.sms.inbound, 1);
  assert.equal(r.sms.delivered, 2);
  assert.equal(r.sms.failed, 1);
  assert.equal(r.sms.deliveryRate, 50); // 2/4
  assert.equal(r.sms.failureRate, 25); // 1/4
});

test("call stats count missed, completed, and average duration of real calls", () => {
  const r = summarizePhoneActivity({
    callLogs: [
      { direction: "inbound", status: "completed", duration_seconds: 60, created_date: iso(1) },
      { direction: "inbound", status: "no_answer", duration_seconds: 0, created_date: iso(1) },
      { direction: "outbound", status: "bridged", duration_seconds: 120, created_date: iso(1) },
      { direction: "inbound", status: "failed", created_date: iso(1) },
    ],
  });
  assert.equal(r.calls.total, 4);
  assert.equal(r.calls.inbound, 3);
  assert.equal(r.calls.outbound, 1);
  assert.equal(r.calls.missed, 2); // no_answer + failed
  assert.equal(r.calls.completed, 2); // completed + bridged
  assert.equal(r.calls.missedRate, 50);
  assert.equal(r.calls.avgDurationSec, 90); // (60+120)/2, zero/absent excluded
});

test("call stats count after-hours and off-duty auto-transfers", () => {
  const r = summarizePhoneActivity({
    callLogs: [
      { direction: "inbound", status: "forwarded_office", call_mode: "after_hours_transfer", created_date: iso(1) },
      { direction: "inbound", status: "forwarded_office", call_mode: "after_hours_transfer", created_date: iso(1) },
      { direction: "inbound", status: "forwarded_office", call_mode: "off_duty_transfer", created_date: iso(1) },
      { direction: "inbound", status: "bridged", call_mode: "masked_bridge", created_date: iso(1) },
    ],
  });
  assert.equal(r.calls.afterHoursTransfers, 2);
  assert.equal(r.calls.offDutyTransfers, 1);
  assert.equal(r.calls.autoTransferRate, 75); // 3 of 4 inbound auto-handled
});

test("consent tracks recent opt-in/opt-out events within the window", () => {
  const r = summarizePhoneActivity({
    consents: [
      { phone_e164: "+12155550100", consent_status: "opted_out", created_date: iso(1) },
      { phone_e164: "+12155550111", consent_status: "opted_out", created_date: iso(2) },
      { phone_e164: "+12155550122", consent_status: "opted_in", created_date: iso(3) },
      { phone_e164: "+12155550133", consent_status: "opted_out", created_date: iso(40) }, // out of window
    ],
    sinceDays: 7,
  });
  assert.equal(r.consent.recentOptOuts, 2);
  assert.equal(r.consent.recentOptIns, 1);
});

test("consent uses the latest status per phone (ledger newest-first)", () => {
  const r = summarizePhoneActivity({
    consents: [
      { phone_e164: "+12155550100", consent_status: "opted_out" }, // newest for 0100
      { phone_e164: "+12155550100", consent_status: "opted_in" },
      { phone_e164: "+12155550111", consent_status: "opted_in" },
    ],
  });
  assert.equal(r.consent.tracked, 2);
  assert.equal(r.consent.optedOut, 1);
  assert.equal(r.consent.optedIn, 1);
});

test("provisioning coverage counts work numbers and full provisioning", () => {
  const r = summarizePhoneActivity({
    users: [
      { work_phone_number: "+12155550100", personal_cell_e164: "+12155550111" },
      { work_phone_number: "+12155550101" }, // no cell
      {}, // unprovisioned
      {},
    ],
  });
  assert.equal(r.provisioning.totalUsers, 4);
  assert.equal(r.provisioning.withWorkNumber, 2);
  assert.equal(r.provisioning.fullyProvisioned, 1);
  assert.equal(r.provisioning.coverageRate, 50);
});

test("sinceDays filters out rows older than the window", () => {
  const r = summarizePhoneActivity({
    smsMessages: [
      { direction: "outbound", status: "delivered", created_date: iso(2) },
      { direction: "outbound", status: "delivered", created_date: iso(40) },
    ],
    sinceDays: 7,
  });
  assert.equal(r.sms.outbound, 1);
});

test("formatDuration renders m:ss and guards non-positive input", () => {
  assert.equal(formatDuration(0), "0:00");
  assert.equal(formatDuration(5), "0:05");
  assert.equal(formatDuration(65), "1:05");
  assert.equal(formatDuration(undefined), "0:00");
  assert.equal(formatDuration(-3), "0:00");
});

test("formatDuration floors fractional seconds instead of emitting a decimal", () => {
  assert.equal(formatDuration(125.7), "2:05");
  assert.equal(formatDuration(59.9), "0:59");
});
