// Printable ADR checklist — builds the standalone HTML document staff print
// and work from while pulling the requested records. Rendered into a new
// window via document.write (the app's education-handout print pattern), so
// every interpolated value is HTML-escaped here; nothing raw ever reaches the
// print window.
//
// Pure + offline (unit-tested with `node --test`); no React, no SDK, no `@/`
// imports.

import { escapeHtml } from "../../lib/escapeHtml.js";
import { CATEGORY_LABELS, AUDIT_TYPES } from "./adrRequirements.js";

const SEVERITY_STYLES = {
  critical: "background:#fef2f2;color:#b91c1c;border:1px solid #fca5a5;",
  high: "background:#fff8ec;color:#b45309;border:1px solid #fcd68a;",
  medium: "background:#eef3fc;color:#213a76;border:1px solid #88a5e0;",
};

const auditTypeLabel = (id) => AUDIT_TYPES.find((t) => t.id === id)?.label || "Documentation request";

const metaRow = (label, value) =>
  value
    ? `<tr><td style="padding:3px 14px 3px 0;color:#5b6a7f;white-space:nowrap;">${escapeHtml(label)}</td><td style="padding:3px 0;font-weight:600;color:#111a2b;">${escapeHtml(value)}</td></tr>`
    : "";

function itemHtml(item, index) {
  const severity = SEVERITY_STYLES[item.severity] ? item.severity : "medium";
  const sourceNote =
    item.source === "cms_baseline"
      ? "CMS baseline — not named in the letter but required to support payment"
      : item.source === "letter"
        ? "Requested by the letter (no standard CMS catalog match)"
        : "Requested by the letter";
  const points = (item.verification_points || [])
    .map((p) => `<li style="margin:0 0 3px;">${escapeHtml(p)}</li>`)
    .join("");
  return `
    <div style="border:1px solid #e4e9f1;border-radius:8px;padding:10px 12px;margin:0 0 10px;page-break-inside:avoid;">
      <div style="display:flex;align-items:baseline;gap:8px;">
        <span style="width:16px;height:16px;border:2px solid #94a3b8;border-radius:3px;display:inline-block;flex-shrink:0;position:relative;top:2px;"></span>
        <div style="flex:1;">
          <div style="font-weight:700;font-size:13px;color:#111a2b;">${index}. ${escapeHtml(item.title)}
            <span style="font-size:10px;font-weight:700;padding:1px 7px;border-radius:9px;margin-left:6px;${SEVERITY_STYLES[severity]}">${escapeHtml(severity.toUpperCase())}</span>
          </div>
          <div style="font-size:10.5px;color:#5b6a7f;margin:2px 0 4px;">${escapeHtml(item.citation || "")} · ${escapeHtml(sourceNote)}${item.when && item.when !== "always" ? ` · Applies: ${escapeHtml(item.when)}` : ""}</div>
          ${item.letter_text ? `<div style="font-size:11px;color:#334155;margin:0 0 4px;"><em>Letter wording:</em> &ldquo;${escapeHtml(item.letter_text)}&rdquo;${item.letter_details ? ` — ${escapeHtml(item.letter_details)}` : ""}</div>` : ""}
          <div style="font-size:11.5px;color:#334155;margin:0 0 4px;">${escapeHtml(item.what_to_include || "")}</div>
          ${points ? `<div style="font-size:10.5px;color:#5b6a7f;"><strong>Reviewer will check:</strong><ul style="margin:2px 0 0;padding-left:18px;">${points}</ul></div>` : ""}
        </div>
      </div>
    </div>`;
}

/**
 * Build the full printable HTML for a case's requirement checklist.
 *
 * @param {{ caseMeta?: object, checklist?: Array<object>, groups?: Array<{label: string, items: Array<object>}> }} opts
 *   Pass `groups` from groupChecklistByCategory; caseMeta is the AdrAuditCase
 *   record (only display fields are read).
 * @returns {string} complete HTML document
 */
export function buildChecklistPrintHtml({ caseMeta = {}, groups = [] } = {}) {
  let counter = 0;
  const sections = groups
    .map((group) => {
      const items = group.items.map((it) => itemHtml(it, ++counter)).join("");
      return `
        <h2 style="font-size:14px;color:#213a76;border-bottom:2px solid #213a76;padding-bottom:3px;margin:18px 0 10px;">${escapeHtml(group.label || CATEGORY_LABELS[group.category] || group.category || "")}</h2>
        ${items}`;
    })
    .join("");

  const total = counter;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<title>ADR Documentation Checklist</title>
<style>@media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }</style>
</head>
<body style="font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#111a2b;margin:24px;">
  <div style="border-bottom:3px solid #c7901f;padding-bottom:10px;margin-bottom:14px;">
    <div style="font-size:20px;font-weight:800;color:#213a76;">ADR Documentation Checklist</div>
    <div style="font-size:11px;color:#5b6a7f;">Pull every item below, assemble the packet in this order, then upload the full packet for verification before sending.</div>
  </div>
  <table style="font-size:12px;border-collapse:collapse;margin:0 0 8px;">
    ${metaRow("Review program", auditTypeLabel(caseMeta.audit_type))}
    ${metaRow("Contractor", caseMeta.contractor_name)}
    ${metaRow("Beneficiary", caseMeta.patient_name)}
    ${metaRow("Medicare number", caseMeta.medicare_number)}
    ${metaRow("Claim / DCN", caseMeta.claim_number)}
    ${metaRow("Dates of service", caseMeta.dates_of_service)}
    ${metaRow("Response due", caseMeta.response_due_date)}
    ${metaRow("Items to collect", String(total))}
  </table>
  ${caseMeta.response_due_date ? `<div style="font-size:12px;font-weight:700;color:#b91c1c;margin:0 0 10px;">Deadline: the response must reach the contractor by ${escapeHtml(caseMeta.response_due_date)} — late or missing documentation is denied.</div>` : ""}
  ${sections}
  <div style="margin-top:16px;font-size:10px;color:#5b6a7f;border-top:1px solid #e4e9f1;padding-top:6px;">
    Generated by PennSync ADR Center. AI-assisted — verify every item against the actual ADR letter before submission.
  </div>
</body></html>`;
}
