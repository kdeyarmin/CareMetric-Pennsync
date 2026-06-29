import { escapeCsvField } from "@/components/admin/csvExport";

/**
 * Build the PDGM Navigator "discrepancies & opportunities" CSV.
 *
 * Extracted from the AutomatedPDGMNavigator mega-component (the page now only
 * builds the Blob + triggers the download) so the row layout and escaping are
 * reusable and unit-tested. Every cell is run through `escapeCsvField`, which —
 * unlike the previous inline `"..."` RFC-quoting — also NEUTRALIZES spreadsheet
 * formula injection. That matters here because the findings/recommendations/
 * opportunities are AI-generated, user-influenced text that could begin with
 * `=`, `+`, `-`, or `@`.
 *
 * @param {object} navigation  the navigation analysis ({ discrepancies, optimization_opportunities })
 * @param {Date} now
 * @returns {string} CSV text (CRLF-joined)
 */
export function buildPdgmNavigatorCsv(navigation, now = new Date()) {
  const nav = navigation || {};
  const rows = [
    ["PDGM Navigator Analysis - Discrepancies & Opportunities"],
    ["Generated:", now.toISOString()],
    [""],
    ["DISCREPANCIES"],
    ["Type", "Severity", "Finding", "Expected", "Actual", "Revenue Impact", "Recommendation"],
  ];

  for (const d of nav.discrepancies || []) {
    rows.push([
      d.type || "",
      d.severity || "",
      d.finding || "",
      d.expected || "",
      d.actual || "",
      d.revenue_impact || "",
      d.recommendation || "",
    ]);
  }

  rows.push([""]);
  rows.push(["OPTIMIZATION OPPORTUNITIES"]);
  rows.push(["Area", "Current State", "Opportunity", "Potential Impact", "Action Required", "Clinical Justification"]);

  for (const o of nav.optimization_opportunities || []) {
    rows.push([
      o.area || "",
      o.current_state || "",
      o.opportunity || "",
      o.potential_impact || "",
      o.action_required || "",
      o.clinical_justification_needed || "",
    ]);
  }

  return rows.map((row) => row.map(escapeCsvField).join(",")).join("\r\n");
}
