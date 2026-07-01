/**
 * Pure payroll-report builders shared by the CSV export and the PDF export.
 *
 * The output mirrors the two accountant spreadsheets this feature replaces:
 *   • Home Health — "Penn Home Health": Last/First, Regular Points, Emerg Visit
 *     Pts, then hours (Regular, OT, PTO, Holiday, On Call), Miles, Reimb.
 *     Home health nurses are paid by the point AND by the hour, so points and
 *     hours both appear.
 *   • Hospice — "Payroll Report": a single Employee column then hours (Regular,
 *     Holiday, OT, PTO, On Call), Visits, Mileage, Reimb. Hospice nurses
 *     are paid by the hour only — there is no points column.
 *
 * Kept free of React/SDK imports and unit-tested with `node --test`
 * (payrollExport.test.js).
 */

import { escapeCsvField } from "../admin/csvExport.js";
import {
  splitName,
  effectiveVacationHours,
  effectiveReimbursement,
  toNumber,
  payPeriodLabel,
  REPORT_METRICS,
  aggregateTotals,
} from "./timesheetUtils.js";

/**
 * Column specs per service line. `numeric` columns are summed into the totals
 * row; `value` overrides the default `toNumber(ts[key])` accessor.
 */
export const PAYROLL_COLUMNS = {
  home_health: [
    { key: "last", label: "Last Name", numeric: false, value: (ts) => splitName(ts.employee_name || ts.employee_email).last },
    { key: "first", label: "First Name", numeric: false, value: (ts) => splitName(ts.employee_name || ts.employee_email).first },
    { key: "regular_points", label: "Regular Points", numeric: true },
    { key: "emergency_visit_points", label: "Emerg Visit Pts", numeric: true },
    { key: "regular_hours", label: "Regular", numeric: true },
    { key: "overtime_hours", label: "OT", numeric: true },
    { key: "vacation", label: "PTO", numeric: true, value: effectiveVacationHours },
    { key: "holiday_hours", label: "Holiday", numeric: true },
    { key: "on_call_hours", label: "On Call", numeric: true },
    { key: "miles", label: "Miles", numeric: true },
    { key: "reimbursement", label: "Reimb", numeric: true, value: effectiveReimbursement },
  ],
  hospice: [
    { key: "employee", label: "Employee", numeric: false, value: (ts) => ts.employee_name || ts.employee_email || "" },
    { key: "regular_hours", label: "Regular", numeric: true },
    { key: "holiday_hours", label: "Holiday", numeric: true },
    { key: "overtime_hours", label: "OT", numeric: true },
    { key: "vacation", label: "PTO", numeric: true, value: effectiveVacationHours },
    { key: "on_call_hours", label: "On Call", numeric: true },
    { key: "on_call_visits", label: "Visits", numeric: true },
    { key: "miles", label: "Mileage", numeric: true },
    { key: "reimbursement", label: "Reimb.", numeric: true, value: effectiveReimbursement },
  ],
};

export const PAYROLL_TITLES = {
  home_health: "Penn Home Health",
  hospice: "Payroll Report",
};

export const PAYROLL_NOTES = {
  home_health: ["Mileage reimbursed at $0.45/mile."],
  hospice: ["On-call pay is $5.00 per hour.", "On-call visits are $50.00 per visit."],
};

/** Round to 2 decimals; render 0 as blank for row cells, "0" for totals. */
export function formatNum(value, { blankZero = true } = {}) {
  const n = Math.round(toNumber(value) * 100) / 100;
  if (n === 0 && blankZero) return "";
  return String(n);
}

function sortKey(ts, serviceType) {
  if (serviceType === "home_health") {
    const { last, first } = splitName(ts.employee_name || ts.employee_email || "");
    return `${last} ${first}`.trim().toLowerCase();
  }
  return String(ts.employee_name || ts.employee_email || "").toLowerCase();
}

/**
 * Build a single payroll table (title, columns, rows, totals, notes) for one
 * service line from a set of timesheets. Only timesheets whose `service_type`
 * matches are included; rows are sorted by name.
 *
 * @param {Array} timesheets
 * @param {"home_health"|"hospice"} serviceType
 * @param {{ periodStart?: string, periodEnd?: string }} [period]
 */
export function buildPayrollTable(timesheets, serviceType, { periodStart, periodEnd } = {}) {
  const columns = PAYROLL_COLUMNS[serviceType] || PAYROLL_COLUMNS.home_health;
  const sheets = (Array.isArray(timesheets) ? timesheets : []).filter(
    (t) => (t?.service_type || "home_health") === serviceType
  );
  const sorted = [...sheets].sort((a, b) => sortKey(a, serviceType).localeCompare(sortKey(b, serviceType)));

  const rows = sorted.map((ts) => ({
    ts,
    cells: columns.map((col) => {
      const raw = col.value ? col.value(ts) : toNumber(ts[col.key]);
      return {
        numeric: col.numeric,
        raw,
        display: col.numeric ? formatNum(raw) : String(raw ?? ""),
      };
    }),
  }));

  const totals = columns.map((col, i) =>
    col.numeric ? Math.round(rows.reduce((sum, r) => sum + toNumber(r.cells[i].raw), 0) * 100) / 100 : null
  );

  return {
    serviceType,
    title: PAYROLL_TITLES[serviceType] || "Payroll Report",
    subtitle: periodStart && periodEnd ? payPeriodLabel(periodStart, periodEnd) : "",
    columns,
    rows,
    totals,
    notes: PAYROLL_NOTES[serviceType] || [],
  };
}

/** Index of the first numeric column — where the "Total" label sits. */
function firstNumericIndex(columns) {
  const i = columns.findIndex((c) => c.numeric);
  return i === -1 ? 0 : i;
}

/** Build the totals row cells (display strings) aligned to the columns. */
export function totalsRow(table) {
  const labelAt = Math.max(0, firstNumericIndex(table.columns) - 1);
  return table.columns.map((col, i) => {
    if (i === labelAt) return "Total";
    if (col.numeric) return formatNum(table.totals[i], { blankZero: false });
    return "";
  });
}

/**
 * Serialize a payroll table to a spreadsheet-safe CSV (Excel-openable). Every
 * cell is run through escapeCsvField, which neutralizes formula injection on
 * free-text name fields.
 */
export function buildPayrollCSV(table) {
  const rows = [];
  rows.push([table.title]);
  if (table.subtitle) rows.push([`Pay period: ${table.subtitle}`]);
  rows.push([]);
  rows.push(table.columns.map((c) => c.label));
  for (const r of table.rows) rows.push(r.cells.map((c) => c.display));
  rows.push(totalsRow(table));
  for (const note of table.notes) {
    rows.push([]);
    rows.push([note]);
  }
  return rows
    .map((row) => (Array.isArray(row) ? row : [row]).map(escapeCsvField).join(","))
    .join("\r\n");
}

/** Download filename for a payroll export, e.g. home_health_payroll_2026-06-29.csv. */
export function payrollFilename(serviceType, periodEnd, ext = "csv") {
  const date = String(periodEnd || "").slice(0, 10) || "period";
  return `${serviceType}_payroll_${date}.${ext}`;
}

/**
 * Serialize an aggregated timesheet report (rows from aggregateTimesheets) to a
 * spreadsheet-safe CSV. `groupHeader` labels the first column (e.g. "Pay period",
 * "Employee"). A totals row is appended. Values are hours/points/visits/miles and
 * the tracked reimbursement total — no pay rates.
 */
export function buildReportCSV(rows, groupHeader = "Group") {
  const header = [groupHeader, "Timesheets", ...REPORT_METRICS.map((m) => m.label)];
  const body = (Array.isArray(rows) ? rows : []).map((r) => [
    r.label,
    r.count,
    ...REPORT_METRICS.map((m) => formatNum(r.metrics?.[m.key], { blankZero: false })),
  ]);
  const totals = aggregateTotals(rows);
  const totalRow = [
    "Total",
    totals.count,
    ...REPORT_METRICS.map((m) => formatNum(totals.metrics?.[m.key], { blankZero: false })),
  ];
  return [header, ...body, totalRow]
    .map((row) => row.map(escapeCsvField).join(","))
    .join("\r\n");
}
