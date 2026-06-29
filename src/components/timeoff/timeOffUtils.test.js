import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseISODate,
  toISODate,
  businessDaysBetween,
  calendarDaysBetween,
  totalRequestedDays,
  requestCoversDate,
  rangesOverlap,
  isUpcoming,
  isActiveOnDate,
  approvedDaysInYear,
  validateRequestDates,
  getRequestValidationError,
  requestsCoveringDate,
  availableYears,
  buildTimeOffCSV,
  typeLabel,
  statusLabel,
} from "./timeOffUtils.js";

test("parseISODate builds a local midnight date from YYYY-MM-DD", () => {
  const d = parseISODate("2026-03-04");
  assert.equal(d.getFullYear(), 2026);
  assert.equal(d.getMonth(), 2); // March is index 2
  assert.equal(d.getDate(), 4);
  assert.equal(d.getHours(), 0);
});

test("parseISODate accepts full ISO timestamps and rejects junk", () => {
  assert.equal(toISODate(parseISODate("2026-03-04T18:30:00.000Z")), "2026-03-04");
  assert.equal(parseISODate(""), null);
  assert.equal(parseISODate(null), null);
  assert.equal(parseISODate("not-a-date"), null);
  assert.equal(parseISODate("2026-13"), null);
});

test("parseISODate rejects impossible calendar dates instead of rolling them over", () => {
  assert.equal(parseISODate("2026-02-31"), null); // Feb has no 31st
  assert.equal(parseISODate("2026-04-31"), null); // April has 30 days
  assert.equal(parseISODate("2026-13-01"), null); // no 13th month
  assert.equal(parseISODate("2025-02-29"), null); // 2025 is not a leap year
  assert.equal(toISODate(parseISODate("2024-02-29")), "2024-02-29"); // valid leap day
});

test("toISODate round-trips and pads single digits", () => {
  assert.equal(toISODate("2026-03-04"), "2026-03-04");
  assert.equal(toISODate(new Date(2026, 0, 9)), "2026-01-09");
  assert.equal(toISODate(null), "");
});

test("businessDaysBetween counts Mon-Fri inclusively", () => {
  // Mon 2026-03-02 .. Fri 2026-03-06 => 5 business days
  assert.equal(businessDaysBetween("2026-03-02", "2026-03-06"), 5);
  // Spanning a weekend: Fri 03-06 .. Mon 03-09 => Fri + Mon = 2
  assert.equal(businessDaysBetween("2026-03-06", "2026-03-09"), 2);
  // A weekend only (Sat-Sun) => 0
  assert.equal(businessDaysBetween("2026-03-07", "2026-03-08"), 0);
  // Single weekday => 1
  assert.equal(businessDaysBetween("2026-03-04", "2026-03-04"), 1);
});

test("businessDaysBetween guards against bad/reversed ranges", () => {
  assert.equal(businessDaysBetween("2026-03-10", "2026-03-02"), 0);
  assert.equal(businessDaysBetween(null, "2026-03-02"), 0);
});

test("calendarDaysBetween counts every day inclusively", () => {
  assert.equal(calendarDaysBetween("2026-03-02", "2026-03-06"), 5);
  assert.equal(calendarDaysBetween("2026-03-07", "2026-03-08"), 2);
  assert.equal(calendarDaysBetween("2026-03-04", "2026-03-04"), 1);
});

test("totalRequestedDays applies the half-day reduction", () => {
  assert.equal(totalRequestedDays("2026-03-02", "2026-03-06"), 5);
  assert.equal(totalRequestedDays("2026-03-02", "2026-03-06", true), 4.5);
  // A single half day still counts as 0.5, never negative.
  assert.equal(totalRequestedDays("2026-03-04", "2026-03-04", true), 0.5);
  assert.equal(totalRequestedDays("2026-03-07", "2026-03-08"), 0);
});

test("requestCoversDate checks inclusive containment", () => {
  const req = { start_date: "2026-03-02", end_date: "2026-03-06" };
  assert.equal(requestCoversDate(req, "2026-03-02"), true);
  assert.equal(requestCoversDate(req, "2026-03-04"), true);
  assert.equal(requestCoversDate(req, "2026-03-06"), true);
  assert.equal(requestCoversDate(req, "2026-03-07"), false);
  assert.equal(requestCoversDate(req, "2026-03-01"), false);
});

test("rangesOverlap detects any intersection", () => {
  assert.equal(rangesOverlap("2026-03-02", "2026-03-06", "2026-03-05", "2026-03-10"), true);
  assert.equal(rangesOverlap("2026-03-02", "2026-03-06", "2026-03-06", "2026-03-10"), true); // touching
  assert.equal(rangesOverlap("2026-03-02", "2026-03-06", "2026-03-09", "2026-03-10"), false);
});

test("isUpcoming is true while the request has not fully ended", () => {
  const today = new Date(2026, 2, 5); // 2026-03-05
  assert.equal(isUpcoming({ end_date: "2026-03-10" }, today), true);
  assert.equal(isUpcoming({ end_date: "2026-03-05" }, today), true); // ends today
  assert.equal(isUpcoming({ end_date: "2026-03-04" }, today), false);
});

test("isActiveOnDate only counts approved requests", () => {
  const base = { start_date: "2026-03-02", end_date: "2026-03-06" };
  assert.equal(isActiveOnDate({ ...base, status: "approved" }, "2026-03-04"), true);
  assert.equal(isActiveOnDate({ ...base, status: "pending" }, "2026-03-04"), false);
  assert.equal(isActiveOnDate({ ...base, status: "approved" }, "2026-03-09"), false);
});

test("approvedDaysInYear sums approved days, filtered by year", () => {
  const requests = [
    { status: "approved", start_date: "2026-03-02", end_date: "2026-03-06", total_days: 5 },
    { status: "approved", start_date: "2026-07-01", end_date: "2026-07-01", total_days: 1 },
    { status: "pending", start_date: "2026-08-01", end_date: "2026-08-05", total_days: 5 },
    { status: "approved", start_date: "2025-12-29", end_date: "2025-12-31", total_days: 3 },
  ];
  assert.equal(approvedDaysInYear(requests, 2026), 6);
  assert.equal(approvedDaysInYear(requests, 2025), 3);
  assert.equal(approvedDaysInYear(requests), 9); // all approved, any year
});

test("approvedDaysInYear falls back to computing days when total_days is missing", () => {
  const requests = [
    { status: "approved", start_date: "2026-03-02", end_date: "2026-03-06" }, // 5 business days
  ];
  assert.equal(approvedDaysInYear(requests, 2026), 5);
});

test("validateRequestDates returns a message for invalid ranges", () => {
  assert.equal(validateRequestDates("2026-03-02", "2026-03-06"), null);
  assert.match(validateRequestDates("", "2026-03-06"), /start date/i);
  assert.match(validateRequestDates("2026-03-02", ""), /end date/i);
  assert.match(validateRequestDates("2026-03-10", "2026-03-02"), /before/i);
});

test("getRequestValidationError rejects weekend-only (zero working day) ranges", () => {
  assert.equal(getRequestValidationError("2026-03-02", "2026-03-06"), null); // Mon-Fri
  assert.equal(getRequestValidationError("2026-03-04", "2026-03-04", true), null); // valid half day
  assert.match(getRequestValidationError("2026-03-07", "2026-03-08"), /no working days/i); // Sat-Sun
  assert.match(getRequestValidationError("2026-03-10", "2026-03-02"), /before/i); // reversed
  assert.match(getRequestValidationError("", "2026-03-06"), /start date/i);
});

test("typeLabel and statusLabel resolve known values with safe fallbacks", () => {
  assert.equal(typeLabel("vacation"), "Vacation / PTO");
  assert.equal(typeLabel("unknown_type"), "unknown_type");
  assert.equal(statusLabel("approved"), "Approved");
  assert.equal(statusLabel(undefined), "—");
});

test("requestsCoveringDate honors the includePending flag", () => {
  const requests = [
    { id: "a", status: "approved", start_date: "2026-03-02", end_date: "2026-03-06" },
    { id: "b", status: "pending", start_date: "2026-03-02", end_date: "2026-03-06" },
    { id: "c", status: "denied", start_date: "2026-03-02", end_date: "2026-03-06" },
  ];
  assert.deepEqual(requestsCoveringDate(requests, "2026-03-04").map((r) => r.id), ["a"]);
  assert.deepEqual(
    requestsCoveringDate(requests, "2026-03-04", { includePending: true }).map((r) => r.id),
    ["a", "b"]
  );
});

test("availableYears returns distinct start years newest-first", () => {
  const requests = [
    { start_date: "2026-03-02" },
    { start_date: "2024-11-01" },
    { start_date: "2026-07-09" },
    { start_date: "bad" },
  ];
  assert.deepEqual(availableYears(requests), [2026, 2024]);
});

test("buildTimeOffCSV emits a header row and escapes special characters", () => {
  const csv = buildTimeOffCSV([
    {
      employee_name: "Jane Doe",
      employee_email: "jane@x.com",
      request_type: "vacation",
      start_date: "2026-03-02",
      end_date: "2026-03-06",
      total_days: 5,
      status: "approved",
      manager_name: "Boss",
      reviewer_name: "Boss",
      reason: 'Family trip, "the big one"',
    },
  ]);
  const lines = csv.split("\n");
  assert.equal(lines[0], "Employee,Email,Type,Start,End,Business Days,Status,Manager,Reviewed By,Reason");
  assert.match(lines[1], /^Jane Doe,jane@x\.com,Vacation \/ PTO,2026-03-02,2026-03-06,5,Approved,Boss,Boss,/);
  assert.match(lines[1], /"Family trip, ""the big one"""$/); // quotes + comma escaped
});

test("buildTimeOffCSV neutralizes formula injection and quotes a lone CR", () => {
  const csv = buildTimeOffCSV([{ employee_name: "=cmd|calc", reason: "line1\rline2" }]);
  const lines = csv.split("\n");
  // employee_name (first column): a leading = is prefixed with a quote -> text.
  assert.ok(lines[1].startsWith("'=cmd|calc"));
  // A lone CR must force quoting (it was previously missing from the escape class).
  assert.match(csv, /"line1\rline2"/);
});
