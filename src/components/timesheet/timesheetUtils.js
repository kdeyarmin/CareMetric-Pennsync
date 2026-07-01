/**
 * Pure helpers for the timesheet / payroll system.
 *
 * Free of React and SDK imports so the logic stays unit-testable with
 * `node --test` (see timesheetUtils.test.js), matching the convention used by
 * timeOffUtils, phoneUtils, smsUtils, etc. Date helpers are reused from the
 * time-off module rather than re-implemented.
 */

import {
  parseISODate,
  toISODate,
  businessDaysBetween,
  formatDateRange,
} from "../timeoff/timeOffUtils.js";

/** Hours credited per full PTO business day when carrying approved leave in. */
export const HOURS_PER_DAY = 8;

export const SERVICE_TYPES = [
  // Home health nurses are paid by the point AND by the hour; hospice nurses
  // are paid by the hour only. `paysPoints` drives which fields the form and
  // the payroll report show.
  { value: "home_health", label: "Home Health", paysPoints: true },
  { value: "hospice", label: "Hospice", paysPoints: false },
];

export const TIMESHEET_STATUSES = [
  { value: "draft", label: "Draft", color: "slate" },
  { value: "submitted", label: "Submitted", color: "amber" },
  { value: "approved", label: "Approved", color: "emerald" },
  { value: "rejected", label: "Rejected", color: "red" },
];

/**
 * Time-off request types that are PAID and therefore carry into the timesheet's
 * vacation bucket when approved. `unpaid` is intentionally excluded — it adds no
 * paid hours to payroll.
 */
export const PAID_PTO_TYPES = [
  "vacation",
  "sick",
  "personal",
  "bereavement",
  "jury_duty",
  "parental",
  "other",
];

/** The numeric payroll fields, in the order they appear on a timesheet. */
export const NUMERIC_FIELDS = [
  "regular_points",
  "emergency_visit_points",
  "regular_hours",
  "overtime_hours",
  "vacation_hours",
  "holiday_hours",
  "on_call_hours",
  "on_call_visits",
  "miles",
  "reimbursement",
];

export function serviceTypeLabel(value) {
  return SERVICE_TYPES.find((s) => s.value === value)?.label || value || "—";
}

export function timesheetStatusLabel(value) {
  return TIMESHEET_STATUSES.find((s) => s.value === value)?.label || value || "—";
}

/** Home health is the only point-paid service line. */
export function paysByPoints(serviceType) {
  return serviceType === "home_health";
}

/** Coerce any value to a finite number, defaulting to 0. */
export function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Split a display name into { first, last } for the home-health payroll report,
 * which lists Last / First in separate columns. The last whitespace-delimited
 * token is the surname; everything before it is the given name(s).
 */
export function splitName(fullName) {
  const s = String(fullName || "").trim();
  if (!s) return { first: "", last: "" };
  const parts = s.split(/\s+/);
  if (parts.length === 1) return { first: parts[0], last: "" };
  return { first: parts.slice(0, -1).join(" "), last: parts[parts.length - 1] };
}

/** Business days of the inclusive intersection of two `YYYY-MM-DD` ranges. */
function intersectionBusinessDays(aStart, aEnd, bStart, bEnd) {
  const as = parseISODate(aStart);
  const ae = parseISODate(aEnd);
  const bs = parseISODate(bStart);
  const be = parseISODate(bEnd);
  if (!as || !ae || !bs || !be) return 0;
  const start = as > bs ? as : bs;
  const end = ae < be ? ae : be;
  if (end < start) return 0;
  return businessDaysBetween(toISODate(start), toISODate(end));
}

/**
 * Total paid PTO hours to carry into a timesheet: the sum, across the
 * employee's APPROVED, PAID time-off requests, of the business days that fall
 * inside the pay period times `hoursPerDay`. A single half-day flag subtracts
 * a half-day when the whole request sits inside the period (mirrors the
 * time-off module's half-day accounting).
 *
 * @param {Array} requests  the employee's time-off requests
 * @param {string} periodStart  YYYY-MM-DD (inclusive)
 * @param {string} periodEnd    YYYY-MM-DD (inclusive)
 * @param {number} [hoursPerDay]
 * @returns {number} rounded to 2 decimals
 */
export function computePtoHoursForPeriod(
  requests = [],
  periodStart,
  periodEnd,
  hoursPerDay = HOURS_PER_DAY
) {
  if (!parseISODate(periodStart) || !parseISODate(periodEnd)) return 0;
  let totalDays = 0;
  for (const r of Array.isArray(requests) ? requests : []) {
    if (!r || r.status !== "approved") continue;
    if (!PAID_PTO_TYPES.includes(r.request_type)) continue;
    let days = intersectionBusinessDays(r.start_date, r.end_date, periodStart, periodEnd);
    if (days <= 0) continue;
    const start = parseISODate(r.start_date);
    const end = parseISODate(r.end_date);
    const ps = parseISODate(periodStart);
    const pe = parseISODate(periodEnd);
    const fullyInside = start && end && ps && pe && start >= ps && end <= pe;
    if (r.half_day && fullyInside) days = Math.max(0.5, days - 0.5);
    totalDays += days;
  }
  return Math.round(totalDays * hoursPerDay * 100) / 100;
}

/**
 * The vacation hours that land on the payroll report: what the employee entered
 * plus the auto-carried approved-PTO hours. Keeping the two separate on the
 * record avoids double-counting while still auto-populating vacation from
 * approved time off.
 */
export function effectiveVacationHours(ts) {
  return toNumber(ts?.vacation_hours) + toNumber(ts?.auto_pto_hours);
}

/** Sum of the paid hour buckets on a timesheet (for the employee summary line). */
export function totalPaidHours(ts) {
  return (
    toNumber(ts?.regular_hours) +
    toNumber(ts?.overtime_hours) +
    effectiveVacationHours(ts) +
    toNumber(ts?.holiday_hours) +
    toNumber(ts?.on_call_hours)
  );
}

/** Validate a timesheet before submission. Returns an error string or null. */
export function getTimesheetValidationError(ts) {
  const t = ts || {};
  const s = parseISODate(t.pay_period_start);
  const e = parseISODate(t.pay_period_end);
  if (!s || !e) return "Choose a valid pay period.";
  if (e < s) return "The pay period end can't be before the start.";
  for (const f of NUMERIC_FIELDS) {
    if (toNumber(t[f]) < 0) return "Values can't be negative.";
  }
  const anyEntered =
    NUMERIC_FIELDS.some((f) => toNumber(t[f]) > 0) || toNumber(t.auto_pto_hours) > 0;
  if (!anyEntered) {
    return "Enter at least one hour, point, or reimbursement value before submitting.";
  }
  return null;
}

/**
 * Default pay period: the two-week (14-day inclusive) window ending today.
 * Employees can adjust the dates on the form.
 */
export function defaultPayPeriod(today = new Date()) {
  const end = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const start = new Date(end);
  start.setDate(start.getDate() - 13);
  return { start: toISODate(start), end: toISODate(end) };
}

/** Human-friendly pay-period label, e.g. "Jun 16 – Jun 29, 2026". */
export function payPeriodLabel(start, end) {
  return formatDateRange(start, end);
}
