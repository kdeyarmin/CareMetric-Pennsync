import { test } from "node:test";
import assert from "node:assert/strict";
import {
  serviceTypeLabel,
  timesheetStatusLabel,
  paysByPoints,
  toNumber,
  splitName,
  computePtoHoursForPeriod,
  effectiveVacationHours,
  effectiveReimbursement,
  totalPaidHours,
  getTimesheetValidationError,
  defaultPayPeriod,
  submissionCoverage,
  aggregateTimesheets,
  aggregateTotals,
  HOURS_PER_DAY,
} from "./timesheetUtils.js";

test("serviceTypeLabel / timesheetStatusLabel / paysByPoints", () => {
  assert.equal(serviceTypeLabel("home_health"), "Home Health");
  assert.equal(serviceTypeLabel("hospice"), "Hospice");
  assert.equal(serviceTypeLabel("mystery"), "mystery");
  assert.equal(timesheetStatusLabel("submitted"), "Submitted");
  assert.equal(paysByPoints("home_health"), true);
  assert.equal(paysByPoints("hospice"), false);
});

test("toNumber coerces safely", () => {
  assert.equal(toNumber("80"), 80);
  assert.equal(toNumber(""), 0);
  assert.equal(toNumber(null), 0);
  assert.equal(toNumber("abc"), 0);
  assert.equal(toNumber(74.25), 74.25);
});

test("splitName separates last (surname) from given names", () => {
  assert.deepEqual(splitName("Rebecca Contrael"), { first: "Rebecca", last: "Contrael" });
  assert.deepEqual(splitName("Mary Jo Watkins"), { first: "Mary Jo", last: "Watkins" });
  assert.deepEqual(splitName("Cher"), { first: "Cher", last: "" });
  assert.deepEqual(splitName("  "), { first: "", last: "" });
});

const PERIOD = { start: "2026-06-16", end: "2026-06-29" }; // Mon..Mon, 2 weeks

test("computePtoHoursForPeriod: approved paid PTO inside the period", () => {
  const requests = [
    { status: "approved", request_type: "vacation", start_date: "2026-06-22", end_date: "2026-06-24" }, // Mon-Wed = 3 biz days
  ];
  assert.equal(computePtoHoursForPeriod(requests, PERIOD.start, PERIOD.end), 3 * HOURS_PER_DAY);
});

test("computePtoHoursForPeriod: ignores non-approved and unpaid leave", () => {
  const requests = [
    { status: "pending", request_type: "vacation", start_date: "2026-06-22", end_date: "2026-06-24" },
    { status: "approved", request_type: "unpaid", start_date: "2026-06-22", end_date: "2026-06-24" },
  ];
  assert.equal(computePtoHoursForPeriod(requests, PERIOD.start, PERIOD.end), 0);
});

test("computePtoHoursForPeriod: clips to the pay period (partial overlap)", () => {
  const requests = [
    // Fri 06-26 .. Thu 07-02, but period ends Mon 06-29 → biz days 26(Fri),29(Mon) = 2
    { status: "approved", request_type: "personal", start_date: "2026-06-26", end_date: "2026-07-02" },
  ];
  assert.equal(computePtoHoursForPeriod(requests, PERIOD.start, PERIOD.end), 2 * HOURS_PER_DAY);
});

test("computePtoHoursForPeriod: half day fully inside subtracts a half day", () => {
  const requests = [
    { status: "approved", request_type: "vacation", start_date: "2026-06-23", end_date: "2026-06-23", half_day: true },
  ];
  assert.equal(computePtoHoursForPeriod(requests, PERIOD.start, PERIOD.end), 0.5 * HOURS_PER_DAY);
});

test("computePtoHoursForPeriod: invalid period yields 0", () => {
  assert.equal(computePtoHoursForPeriod([], "", ""), 0);
});

test("effectiveVacationHours adds manual + auto-carried PTO", () => {
  assert.equal(effectiveVacationHours({ vacation_hours: 4, auto_pto_hours: 24 }), 28);
  assert.equal(effectiveVacationHours({}), 0);
});

test("totalPaidHours sums the paid hour buckets", () => {
  const ts = {
    regular_hours: 72,
    overtime_hours: 4,
    vacation_hours: 0,
    auto_pto_hours: 8,
    holiday_hours: 8,
    on_call_hours: 16,
  };
  assert.equal(totalPaidHours(ts), 72 + 4 + 8 + 8 + 16);
});

test("getTimesheetValidationError: dates, negatives, and empty sheets", () => {
  assert.match(getTimesheetValidationError({}), /valid pay period/i);
  assert.match(
    getTimesheetValidationError({ pay_period_start: "2026-06-29", pay_period_end: "2026-06-16" }),
    /before the start/i
  );
  assert.match(
    getTimesheetValidationError({ pay_period_start: "2026-06-16", pay_period_end: "2026-06-29", regular_hours: -5 }),
    /negative/i
  );
  assert.match(
    getTimesheetValidationError({ pay_period_start: "2026-06-16", pay_period_end: "2026-06-29" }),
    /at least one/i
  );
  assert.equal(
    getTimesheetValidationError({ pay_period_start: "2026-06-16", pay_period_end: "2026-06-29", regular_hours: 80 }),
    null
  );
  // Approved-PTO-only timesheet is valid (auto hours count as entered).
  assert.equal(
    getTimesheetValidationError({ pay_period_start: "2026-06-16", pay_period_end: "2026-06-29", auto_pto_hours: 16 }),
    null
  );
});

test("defaultPayPeriod returns a 14-day inclusive window ending today", () => {
  const { start, end } = defaultPayPeriod(new Date(2026, 5, 29)); // Jun 29 2026
  assert.equal(end, "2026-06-29");
  assert.equal(start, "2026-06-16");
});

test("effectiveReimbursement adds entered + standing phone reimbursement", () => {
  assert.equal(effectiveReimbursement({ reimbursement: 20, phone_reimbursement: 25 }), 45);
  assert.equal(effectiveReimbursement({ reimbursement: 20 }), 20);
  assert.equal(effectiveReimbursement({}), 0);
});

const EMPLOYEES = [
  { email: "a@x", name: "A", service_type: "home_health", is_active: true },
  { email: "b@x", name: "B", service_type: "home_health", is_active: true },
  { email: "c@x", name: "C", service_type: "home_health", is_active: true },
  { email: "d@x", name: "D", service_type: "hospice", is_active: true },
  { email: "e@x", name: "E", service_type: "home_health", is_active: false }, // inactive → excluded
];

test("submissionCoverage buckets expected employees into approved / awaiting / missing", () => {
  const timesheets = [
    { employee_email: "a@x", service_type: "home_health", pay_period_start: "2026-06-16", pay_period_end: "2026-06-29", status: "approved" },
    { employee_email: "b@x", service_type: "home_health", pay_period_start: "2026-06-16", pay_period_end: "2026-06-29", status: "submitted" },
    // c@x has nothing; d@x is hospice; e@x is inactive.
  ];
  const cov = submissionCoverage(EMPLOYEES, timesheets, {
    serviceType: "home_health",
    periodStart: "2026-06-16",
    periodEnd: "2026-06-29",
  });
  assert.equal(cov.expected.length, 3);
  assert.deepEqual(cov.approved.map((e) => e.email), ["a@x"]);
  assert.deepEqual(cov.awaiting.map((e) => e.email), ["b@x"]);
  assert.deepEqual(cov.missing.map((e) => e.email), ["c@x"]);
});

const REPORT_SHEETS = [
  { employee_email: "a@x", employee_name: "A", service_type: "home_health", pay_period_start: "2026-06-16", pay_period_end: "2026-06-29", regular_hours: 80, reimbursement: 20, phone_reimbursement: 5 },
  { employee_email: "b@x", employee_name: "B", service_type: "home_health", pay_period_start: "2026-06-16", pay_period_end: "2026-06-29", regular_hours: 40, vacation_hours: 8, auto_pto_hours: 8 },
  { employee_email: "a@x", employee_name: "A", service_type: "home_health", pay_period_start: "2026-06-02", pay_period_end: "2026-06-15", regular_hours: 72 },
];

test("aggregateTimesheets groups by pay period and sums metrics (effective reimb + vacation)", () => {
  const rows = aggregateTimesheets(REPORT_SHEETS, "period");
  assert.equal(rows.length, 2);
  // Newest period first (2026-06-16 window).
  const recent = rows[0];
  assert.equal(recent.count, 2);
  assert.equal(recent.metrics.regular_hours, 120);
  assert.equal(recent.metrics.vacation, 16); // 8 manual + 8 auto PTO
  assert.equal(recent.metrics.reimbursement, 25); // 20 + 5 phone
});

test("aggregateTimesheets groups by employee", () => {
  const rows = aggregateTimesheets(REPORT_SHEETS, "employee");
  const a = rows.find((r) => r.key === "a@x");
  assert.equal(a.count, 2);
  assert.equal(a.metrics.regular_hours, 152); // 80 + 72
});

test("aggregateTotals sums across report rows", () => {
  const rows = aggregateTimesheets(REPORT_SHEETS, "period");
  const totals = aggregateTotals(rows);
  assert.equal(totals.count, 3);
  assert.equal(totals.metrics.regular_hours, 192);
  assert.equal(totals.metrics.vacation, 16);
  assert.equal(totals.metrics.reimbursement, 25);
});
