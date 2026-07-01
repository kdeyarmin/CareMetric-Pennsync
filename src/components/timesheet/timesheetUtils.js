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

/**
 * Home-health visit types. Each carries a facility-configured point value
 * (stored on VisitPointConfig as `${key}_points`); the nurse enters a count per
 * type and total points = Σ count × point value.
 */
export const VISIT_TYPES = [
  { key: "soc", label: "SOC", full: "Start of Care" },
  { key: "roc", label: "ROC", full: "Resumption of Care" },
  { key: "recert", label: "Recert", full: "Recertification" },
  { key: "routine", label: "Routine Visit", full: "Routine visit" },
  { key: "discharge", label: "Discharge", full: "Discharge" },
];

/** The VisitPointConfig field name that holds a visit type's point value. */
export function pointFieldFor(visitTypeKey) {
  return `${visitTypeKey}_points`;
}

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

/**
 * The company/service line an employee is paid under, resolved from their
 * admin-set payroll profile (preferred) and falling back to their user record.
 * Defaults to home_health.
 */
export function resolvedServiceType(profile, user) {
  const st = profile?.service_type || user?.service_type;
  return st === "hospice" ? "hospice" : "home_health";
}

/**
 * Whether an employee is paid by visit points: only home-health field/clinical
 * staff flagged `earns_points`. Office staff (home health or hospice) and all
 * hospice staff are hourly — this returns false for them.
 */
export function employeeEarnsPoints(profile, serviceType) {
  const st = serviceType || profile?.service_type;
  return st === "home_health" && profile?.earns_points === true;
}

/** Coerce any value to a finite number, defaulting to 0. */
export function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Total home-health points from visit counts and the facility's per-type point
 * values: Σ (count of a visit type) × (that type's configured point value).
 *
 * @param {object} visitCounts  { soc, roc, recert, routine, discharge }
 * @param {object} pointConfig  VisitPointConfig ({ soc_points, roc_points, … })
 * @returns {number} rounded to 2 decimals
 */
export function computeVisitPoints(visitCounts = {}, pointConfig = {}) {
  let total = 0;
  for (const vt of VISIT_TYPES) {
    total += toNumber(visitCounts?.[vt.key]) * toNumber(pointConfig?.[pointFieldFor(vt.key)]);
  }
  return Math.round(total * 100) / 100;
}

/** Total number of visits across all types. */
export function totalVisits(visitCounts = {}) {
  return VISIT_TYPES.reduce((sum, vt) => sum + toNumber(visitCounts?.[vt.key]), 0);
}

/** Normalize a visit-counts object to plain non-negative numbers. */
export function normalizeVisitCounts(visitCounts = {}) {
  const out = {};
  for (const vt of VISIT_TYPES) out[vt.key] = Math.max(0, toNumber(visitCounts?.[vt.key]));
  return out;
}

/**
 * Per-day hour buckets a nurse can log in daily-entry mode. Vacation, mileage,
 * emergency points, and other reimbursement stay period-level (entered once).
 */
export const DAILY_HOUR_FIELDS = [
  { key: "regular_hours", label: "Reg" },
  { key: "overtime_hours", label: "OT" },
  { key: "holiday_hours", label: "Hol" },
  { key: "on_call_hours", label: "On-Call" },
];

/** Numeric fields summed from daily entries into the period totals. */
export const DAILY_SUM_FIELDS = [
  "regular_hours",
  "overtime_hours",
  "holiday_hours",
  "on_call_hours",
  "on_call_visits",
];

/** All calendar days (inclusive) in a pay period as `YYYY-MM-DD` strings. */
export function payPeriodDays(start, end) {
  const s = parseISODate(start);
  const e = parseISODate(end);
  if (!s || !e || e < s) return [];
  const out = [];
  const cur = new Date(s);
  while (cur <= e) {
    out.push(toISODate(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

/**
 * Sum an array of daily entries into period totals + visit_counts. Each entry
 * carries the DAILY_SUM_FIELDS plus a nested visit_counts object.
 */
export function sumDailyEntries(entries = []) {
  const totals = {};
  for (const f of DAILY_SUM_FIELDS) totals[f] = 0;
  const visit_counts = {};
  for (const vt of VISIT_TYPES) visit_counts[vt.key] = 0;
  for (const e of Array.isArray(entries) ? entries : []) {
    for (const f of DAILY_SUM_FIELDS) totals[f] += toNumber(e?.[f]);
    for (const vt of VISIT_TYPES) visit_counts[vt.key] += toNumber(e?.visit_counts?.[vt.key]);
  }
  for (const f of DAILY_SUM_FIELDS) totals[f] = Math.round(totals[f] * 100) / 100;
  for (const vt of VISIT_TYPES) visit_counts[vt.key] = Math.round(visit_counts[vt.key] * 100) / 100;
  return { ...totals, visit_counts };
}

/**
 * Convert the form's per-day state ({ [date]: { regular_hours, soc, … } }, with
 * visit types as flat keys) into a normalized daily_entries array, dropping days
 * with nothing entered and nesting visit counts under visit_counts.
 */
export function dailyStateToEntries(dailyState = {}) {
  const out = [];
  for (const [date, cell] of Object.entries(dailyState || {})) {
    const c = cell || {};
    let any = false;
    const entry = { date };
    for (const f of DAILY_SUM_FIELDS) {
      const v = Math.max(0, toNumber(c[f]));
      entry[f] = v;
      if (v > 0) any = true;
    }
    const visit_counts = {};
    for (const vt of VISIT_TYPES) {
      const v = Math.max(0, toNumber(c[vt.key]));
      visit_counts[vt.key] = v;
      if (v > 0) any = true;
    }
    entry.visit_counts = visit_counts;
    if (any) out.push(entry);
  }
  out.sort((a, b) => (a.date || "").localeCompare(b.date || ""));
  return out;
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
    NUMERIC_FIELDS.some((f) => toNumber(t[f]) > 0) ||
    toNumber(t.auto_pto_hours) > 0 ||
    totalVisits(t.visit_counts) > 0;
  if (!anyEntered) {
    return "Enter at least one visit, hour, or reimbursement value before submitting.";
  }
  return null;
}

/** Human-friendly pay-period label, e.g. "Jun 16 – Jun 29, 2026". */
export function payPeriodLabel(start, end) {
  return formatDateRange(start, end);
}

/**
 * The reimbursement that lands on the payroll report: what the employee entered
 * plus the admin-configured standing phone reimbursement auto-applied on submit.
 * Both are expense reimbursements — the system holds no pay rates.
 */
export function effectiveReimbursement(ts) {
  return toNumber(ts?.reimbursement) + toNumber(ts?.phone_reimbursement);
}

/** Rank a timesheet status so "most complete" wins when an employee has several. */
function statusRank(status) {
  return { approved: 3, submitted: 2, rejected: 1, draft: 0 }[status] ?? 0;
}

/**
 * Per-service-line submission coverage for a pay period: which expected
 * employees are approved, awaiting approval, or missing (no submitted/approved
 * timesheet). Lets the payroll export flag anyone who'd be silently left off.
 *
 * @param {Array} employees  [{ email, name, service_type, is_active }]
 * @param {Array} timesheets
 * @param {{ serviceType?: string, periodStart?: string, periodEnd?: string }} opts
 */
export function submissionCoverage(employees = [], timesheets = [], { serviceType, periodStart, periodEnd } = {}) {
  const expected = (Array.isArray(employees) ? employees : []).filter(
    (e) => e && e.is_active !== false && e.service_type === serviceType
  );
  const inPeriod = (Array.isArray(timesheets) ? timesheets : []).filter(
    (t) => t && t.service_type === serviceType && t.pay_period_start === periodStart && t.pay_period_end === periodEnd
  );
  const byEmail = new Map();
  for (const t of inPeriod) {
    const prev = byEmail.get(t.employee_email);
    if (!prev || statusRank(t.status) > statusRank(prev.status)) byEmail.set(t.employee_email, t);
  }
  const approved = [];
  const awaiting = [];
  const missing = [];
  for (const e of expected) {
    const t = byEmail.get(e.email);
    if (t && t.status === "approved") approved.push(e);
    else if (t && t.status === "submitted") awaiting.push(e);
    else missing.push(e);
  }
  return { expected, approved, awaiting, missing };
}

/**
 * Metrics the payroll report tracks — hours, points, visits, miles, and the
 * (already-tracked) reimbursement total. No pay rates or computed wages.
 */
export const REPORT_METRICS = [
  { key: "regular_hours", label: "Regular" },
  { key: "overtime_hours", label: "OT" },
  { key: "vacation", label: "PTO", value: effectiveVacationHours },
  { key: "holiday_hours", label: "Holiday" },
  { key: "on_call_hours", label: "On Call" },
  { key: "regular_points", label: "Reg Pts" },
  { key: "emergency_visit_points", label: "Emerg Pts" },
  { key: "on_call_visits", label: "Visits" },
  { key: "miles", label: "Miles" },
  { key: "reimbursement", label: "Reimb", value: effectiveReimbursement },
];

export const REPORT_GROUPINGS = [
  { value: "period", label: "Pay period" },
  { value: "employee", label: "Employee" },
  { value: "service_type", label: "Service line" },
];

function groupInfo(ts, groupBy) {
  if (groupBy === "employee") {
    const label = ts.employee_name || ts.employee_email || "—";
    return { key: ts.employee_email || label, label, sort: label.toLowerCase() };
  }
  if (groupBy === "service_type") {
    return { key: ts.service_type || "home_health", label: serviceTypeLabel(ts.service_type), sort: ts.service_type || "" };
  }
  // default: pay period
  return {
    key: `${ts.pay_period_start}__${ts.pay_period_end}`,
    label: payPeriodLabel(ts.pay_period_start, ts.pay_period_end),
    sort: ts.pay_period_start || "",
  };
}

function zeroMetrics() {
  const m = {};
  for (const metric of REPORT_METRICS) m[metric.key] = 0;
  return m;
}

/**
 * Aggregate timesheets into report rows grouped by pay period, employee, or
 * service line. Each row carries the summed metrics and a timesheet count.
 * Rows sort newest/first descending by their group sort key.
 */
export function aggregateTimesheets(timesheets = [], groupBy = "period") {
  const groups = new Map();
  for (const t of Array.isArray(timesheets) ? timesheets : []) {
    if (!t) continue;
    const info = groupInfo(t, groupBy);
    if (!groups.has(info.key)) {
      groups.set(info.key, { key: info.key, label: info.label, sort: info.sort, count: 0, metrics: zeroMetrics() });
    }
    const g = groups.get(info.key);
    g.count += 1;
    for (const metric of REPORT_METRICS) {
      g.metrics[metric.key] += toNumber(metric.value ? metric.value(t) : t[metric.key]);
    }
  }
  const rows = [...groups.values()];
  for (const r of rows) {
    for (const metric of REPORT_METRICS) r.metrics[metric.key] = Math.round(r.metrics[metric.key] * 100) / 100;
  }
  const dir = groupBy === "employee" || groupBy === "service_type" ? 1 : -1;
  return rows.sort((a, b) => dir * String(a.sort).localeCompare(String(b.sort)));
}

/** Column-wise totals across aggregated report rows. */
export function aggregateTotals(rows = []) {
  const totals = zeroMetrics();
  let count = 0;
  for (const r of Array.isArray(rows) ? rows : []) {
    count += r.count || 0;
    for (const metric of REPORT_METRICS) totals[metric.key] += toNumber(r.metrics?.[metric.key]);
  }
  for (const metric of REPORT_METRICS) totals[metric.key] = Math.round(totals[metric.key] * 100) / 100;
  return { count, metrics: totals };
}
