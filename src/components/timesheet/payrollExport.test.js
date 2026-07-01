import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildPayrollTable,
  buildPayrollCSV,
  totalsRow,
  formatNum,
  payrollFilename,
} from "./payrollExport.js";

const HH = [
  { employee_name: "Rebecca Contrael", service_type: "home_health", regular_hours: 80, reimbursement: 20 },
  { employee_name: "Margaret Fuller", service_type: "home_health", regular_points: 6.5, regular_hours: 74.25, vacation_hours: 4, reimbursement: 20 },
  // Hospice sheet must NOT appear in the home-health table.
  { employee_name: "Brandon Laney", service_type: "hospice", regular_hours: 80 },
];

test("formatNum: blanks zeros for rows, shows 0 for totals", () => {
  assert.equal(formatNum(0), "");
  assert.equal(formatNum(0, { blankZero: false }), "0");
  assert.equal(formatNum(74.25), "74.25");
  assert.equal(formatNum("80"), "80");
});

test("buildPayrollTable home_health: points + hours columns, filtered, sorted, summed", () => {
  const table = buildPayrollTable(HH, "home_health");
  assert.equal(table.title, "Penn Home Health");
  const labels = table.columns.map((c) => c.label);
  assert.deepEqual(labels, [
    "Last Name", "First Name", "Regular Points", "Emerg Visit Pts",
    "Regular", "OT", "Vacation", "Holiday", "On Call", "Miles", "Reimb",
  ]);
  // Only the two home-health nurses, sorted by surname (Contrael before Fuller).
  assert.equal(table.rows.length, 2);
  assert.equal(table.rows[0].cells[0].display, "Contrael");
  assert.equal(table.rows[0].cells[1].display, "Rebecca");
  // Regular Points total = 6.5 (only Fuller). Regular hours total = 80 + 74.25.
  const total = (label) => table.totals[labels.indexOf(label)];
  assert.equal(total("Regular Points"), 6.5);
  assert.equal(total("Regular"), 154.25);
  assert.equal(total("Reimb"), 40);
});

test("buildPayrollTable: vacation column carries manual + approved PTO", () => {
  const table = buildPayrollTable(
    [{ employee_name: "Sue Frye", service_type: "home_health", vacation_hours: 4, auto_pto_hours: 24 }],
    "home_health"
  );
  const vac = table.columns.findIndex((c) => c.label === "Vacation");
  assert.equal(table.rows[0].cells[vac].display, "28");
  assert.equal(table.totals[vac], 28);
});

test("buildPayrollTable hospice: no points, has Visits, hour-only", () => {
  const table = buildPayrollTable(
    [
      { employee_name: "Celesta Barnhart", service_type: "hospice", regular_hours: 76, vacation_hours: 4, on_call_hours: 32, on_call_visits: 1, reimbursement: 20 },
    ],
    "hospice"
  );
  assert.equal(table.title, "Payroll Report");
  const labels = table.columns.map((c) => c.label);
  assert.deepEqual(labels, ["Employee", "Regular", "Holiday", "OT", "Vacation", "On Call", "Visits", "Mileage", "Reimb."]);
  assert.ok(!labels.includes("Regular Points"), "hospice has no points column");
  assert.equal(table.rows[0].cells[0].display, "Celesta Barnhart");
  assert.equal(table.totals[labels.indexOf("Visits")], 1);
});

test("totalsRow places the Total label before the first numeric column", () => {
  const hh = buildPayrollTable(HH, "home_health");
  const hhRow = totalsRow(hh);
  assert.equal(hhRow[0], ""); // Last Name blank
  assert.equal(hhRow[1], "Total"); // under First Name
  const hos = buildPayrollTable([{ employee_name: "X Y", service_type: "hospice", regular_hours: 8 }], "hospice");
  assert.equal(totalsRow(hos)[0], "Total"); // under Employee
});

test("buildPayrollCSV: header, rows, totals, notes, and formula-injection guard", () => {
  const table = buildPayrollTable(
    [{ employee_name: "=cmd Contrael", service_type: "home_health", regular_hours: 80 }],
    "home_health",
    { periodStart: "2026-06-16", periodEnd: "2026-06-29" }
  );
  const csv = buildPayrollCSV(table);
  assert.match(csv, /^Penn Home Health/);
  assert.match(csv, /Pay period:/);
  assert.match(csv, /Last Name,First Name,Regular Points/);
  assert.match(csv, /Mileage reimbursed at \$0\.45\/mile\./);
  // The "=cmd" surname must be neutralized (prefixed with a quote) by escapeCsvField.
  assert.match(csv, /'=cmd/);
});

test("payrollFilename builds a dated, service-scoped name", () => {
  assert.equal(payrollFilename("home_health", "2026-06-29"), "home_health_payroll_2026-06-29.csv");
  assert.equal(payrollFilename("hospice", "2026-06-29", "pdf"), "hospice_payroll_2026-06-29.pdf");
});
