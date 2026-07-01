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
  totalPaidHours,
  getTimesheetValidationError,
  defaultPayPeriod,
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
