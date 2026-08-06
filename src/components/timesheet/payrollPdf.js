/**
 * Client-side payroll PDF generation with jsPDF.
 *
 * Renders a payroll table (from payrollExport.buildPayrollTable) as a clean grid
 * matching the accountant's spreadsheet layout — "Penn Home Health" (points +
 * hours) or "Payroll Report" (hospice, hours only) — with a bold totals row and
 * the rate footnotes. Mirrors the manual-drawing convention used by
 * FaxCoverSheetGenerator (no jspdf-autotable dependency in this repo).
 *
 * Not unit-tested (DOM/jsPDF); the pure row/total/format logic it draws lives in
 * payrollExport.js, which is covered by payrollExport.test.js.
 */

import jsPDF from "jspdf";
import { totalsRow } from "./payrollExport.js";

const NAVY = [33, 58, 118];
const INK = [17, 26, 43];
const LINE = [210, 218, 230];
const HEADER_FILL = [238, 243, 252];
const TOTAL_FILL = [245, 248, 253];

/**
 * Build a jsPDF document for one payroll table.
 * @param {object} table  the structure returned by buildPayrollTable
 * @param {{ generatedOn?: Date }} [opts]
 * @returns {jsPDF}
 */
export function generatePayrollPDF(table, { generatedOn = new Date() } = {}) {
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "letter" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 12;
  const tableW = pageW - margin * 2;

  // Column widths: text columns get more room than the numeric buckets.
  const weights = table.columns.map((c) => (c.numeric ? 1 : 2.4));
  const weightSum = weights.reduce((a, b) => a + b, 0);
  const widths = weights.map((w) => (w / weightSum) * tableW);

  const rowH = 7;

  // ── Title block ──────────────────────────────────────────────────────────
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.setTextColor(NAVY[0], NAVY[1], NAVY[2]);
  doc.text(table.title, margin, margin + 2);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(90, 106, 127);
  let subY = margin + 8;
  if (table.subtitle) {
    doc.text(`Pay period: ${table.subtitle}`, margin, subY);
    subY += 5;
  }
  doc.text(`Generated ${generatedOn.toLocaleDateString()}`, margin, subY);

  let y = subY + 5;

  const drawHeader = () => {
    doc.setFillColor(HEADER_FILL[0], HEADER_FILL[1], HEADER_FILL[2]);
    doc.setDrawColor(LINE[0], LINE[1], LINE[2]);
    doc.rect(margin, y, tableW, rowH, "FD");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.5);
    doc.setTextColor(INK[0], INK[1], INK[2]);
    let x = margin;
    table.columns.forEach((col, i) => {
      const w = widths[i];
      if (col.numeric) {
        doc.text(String(col.label), x + w - 2, y + rowH - 2.4, { align: "right", maxWidth: w - 3 });
      } else {
        doc.text(String(col.label), x + 2, y + rowH - 2.4, { maxWidth: w - 3 });
      }
      x += w;
    });
    y += rowH;
  };

  const drawRow = (cells, { bold = false, fill = null } = {}) => {
    if (y + rowH > pageH - margin - 14) {
      doc.addPage();
      y = margin;
      drawHeader();
    }
    if (fill) {
      doc.setFillColor(fill[0], fill[1], fill[2]);
      doc.rect(margin, y, tableW, rowH, "F");
    }
    doc.setDrawColor(LINE[0], LINE[1], LINE[2]);
    doc.line(margin, y + rowH, margin + tableW, y + rowH);
    doc.setFont("helvetica", bold ? "bold" : "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(INK[0], INK[1], INK[2]);
    let x = margin;
    table.columns.forEach((col, i) => {
      const w = widths[i];
      const text = String(cells[i] ?? "");
      if (col.numeric) {
        doc.text(text, x + w - 2, y + rowH - 2.4, { align: "right", maxWidth: w - 3 });
      } else {
        doc.text(text, x + 2, y + rowH - 2.4, { maxWidth: w - 3 });
      }
      x += w;
    });
    y += rowH;
  };

  drawHeader();

  if (table.rows.length === 0) {
    drawRow(table.columns.map(() => ""));
    doc.setFont("helvetica", "italic");
    doc.setFontSize(9);
    doc.setTextColor(120, 132, 150);
    doc.text("No approved timesheets for this service line and pay period.", margin + 2, y - 2.4);
  } else {
    for (const r of table.rows) drawRow(r.cells.map((c) => c.display));
  }

  // Totals row (bold, shaded).
  drawRow(totalsRow(table), { bold: true, fill: TOTAL_FILL });

  // Left/right table borders for the whole block would require tracking the top;
  // the header/row fills + bottom lines already read as a grid, matching the
  // source spreadsheets. Notes footer:
  y += 4;
  doc.setFont("helvetica", "italic");
  doc.setFontSize(8);
  doc.setTextColor(110, 122, 140);
  for (const note of table.notes || []) {
    if (y > pageH - margin) {
      doc.addPage();
      y = margin;
    }
    doc.text(note, margin, y);
    y += 4;
  }

  return doc;
}

/** Build and trigger a browser download of a payroll PDF. */
export function downloadPayrollPDF(table, filename, opts = {}) {
  const doc = generatePayrollPDF(table, opts);
  doc.save(filename);
}
