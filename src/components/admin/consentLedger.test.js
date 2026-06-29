import { test } from "node:test";
import assert from "node:assert/strict";
import {
  summarizeConsent,
  consentStatusLabel,
  formatConsentDate,
  formatConsentCsv,
} from "./consentLedger.js";

test("summarizeConsent counts each status and total", () => {
  const rows = [
    { consent_status: "opted_in" },
    { consent_status: "opted_in" },
    { consent_status: "opted_out" },
    { consent_status: "unknown" },
  ];
  assert.deepEqual(summarizeConsent(rows), {
    opted_in: 2,
    opted_out: 1,
    unknown: 1,
    total: 4,
  });
});

test("summarizeConsent treats missing/odd statuses as unknown", () => {
  const rows = [
    {},
    { consent_status: null },
    { consent_status: "garbage" },
    null,
  ];
  assert.deepEqual(summarizeConsent(rows), {
    opted_in: 0,
    opted_out: 0,
    unknown: 4,
    total: 4,
  });
});

test("summarizeConsent handles empty / non-array input", () => {
  const empty = { opted_in: 0, opted_out: 0, unknown: 0, total: 0 };
  assert.deepEqual(summarizeConsent([]), empty);
  assert.deepEqual(summarizeConsent(null), empty);
  assert.deepEqual(summarizeConsent(undefined), empty);
});

test("consentStatusLabel maps known and unknown statuses", () => {
  assert.equal(consentStatusLabel("opted_in"), "Opted in");
  assert.equal(consentStatusLabel("opted_out"), "Opted out");
  assert.equal(consentStatusLabel("unknown"), "Unknown");
  assert.equal(consentStatusLabel("whatever"), "Unknown");
  assert.equal(consentStatusLabel(undefined), "Unknown");
});

test("formatConsentDate normalizes ISO and passes through bad input", () => {
  assert.equal(formatConsentDate("2026-06-19T12:00:00.000Z"), "2026-06-19T12:00:00.000Z");
  assert.equal(formatConsentDate(""), "");
  assert.equal(formatConsentDate(null), "");
  assert.equal(formatConsentDate("not-a-date"), "not-a-date");
});

test("formatConsentCsv emits header + escaped rows", () => {
  const csv = formatConsentCsv([
    {
      phone_e164: "+12155550100",
      consent_status: "opted_out",
      consent_source: "keyword_stop",
      captured_at: "2026-06-19T12:00:00.000Z",
      patient_id: "p1",
      notes: "has, comma",
    },
  ]);
  const lines = csv.split("\r\n");
  assert.equal(lines[0], "Phone,Consent Status,Source,Captured At,Patient ID,Notes");
  // Phone is formula-prefixed ('+...) and the comma-bearing note is quoted.
  assert.equal(
    lines[1],
    "'+12155550100,Opted out,keyword_stop,2026-06-19T12:00:00.000Z,p1,\"has, comma\"",
  );
});

test("formatConsentCsv tolerates empty/non-array input (header only)", () => {
  assert.equal(
    formatConsentCsv(null),
    "Phone,Consent Status,Source,Captured At,Patient ID,Notes",
  );
});
