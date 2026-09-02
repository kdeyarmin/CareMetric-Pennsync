// The single fail-closed output policy for anything that leaves PennSync
// carrying an OASIS response: print, copy, PDF, CSV, JSON, referral packets,
// EMR handoff, comparison downloads, clipboard.
//
// WHY ONE MODULE
// Before this, each output path decided for itself. The item panel warned that a
// response set conflicted with CMS, and then `handleExportPDF()` printed the same
// answer under its M-number and told the nurse to transcribe it. A warning that
// downstream paths bypass is not a control.
//
// The rule: a CMS-labeled section may show a CODE only for a v2, applicable,
// source-verified row that a clinician explicitly selected. Everything else is
// either refused or visibly quarantined WITH its item and reason — never
// silently dropped, because a missing row reads as "not applicable" to whoever
// gets the document.
//
// Pure functions. No React, no SDK.

import {
  evaluateRow,
  describeExclusions,
  RESPONSE_SCHEMA_V1_LEGACY,
  v1Definition,
  V1_LEGACY_WARNING,
} from "./registry.js";
import { describeResponseValue } from "./shapes.js";

/** What PennSync is, stated on every allowed guide. Never varies. */
export const COMPANION_DISCLAIMER =
  "PennSync is a companion reference used alongside your EMR. PennSync did not submit this "
  + "assessment and does not certify any response. Enter and verify every official OASIS "
  + "response in your EMR.";

/** Phrases that must never appear in an OASIS output. */
export const BANNED_OUTPUT_PHRASES = Object.freeze([
  "Transcribe each OASIS item",
  "transcribe each OASIS item",
  "CMS compliant",
  "CMS approved",
  "CMS certified",
]);

/**
 * Classify one saved row for output.
 *
 * @param {object} row
 * @param {object} assessment
 * @returns {{
 *   disposition: "cms_reference"|"internal_screening"|"quarantined",
 *   itemLabel: string,
 *   code: string,
 *   display: string,
 *   reason: string,
 *   warning: string,
 * }}
 */
export function classifyRowForOutput(row, assessment) {
  const verdict = evaluateRow(row, assessment);
  const def = verdict.definition;

  // Allowed: a genuine v2 CMS response a clinician selected.
  if (verdict.cmsOutputAllowed && def) {
    return {
      disposition: "cms_reference",
      itemLabel: `${def.item_number} — ${def.title}`,
      code: codeOf(def, row.response_value),
      display: describeResponseValue(def, row.response_value),
      reason: "",
      warning: "",
    };
  }

  // PennSync screening: allowed, but only in its own labeled section and never
  // with an M-number.
  if (verdict.reasons.includes("screening_item") && def && !verdict.reasons.includes("screening_wearing_m_number")) {
    return {
      disposition: "internal_screening",
      itemLabel: def.title,
      code: "",
      display: describeResponseValue(def, row.response_value),
      reason: "",
      warning: "",
    };
  }

  // Everything else is quarantined — named, not dropped.
  const legacyDef = row?.response_schema_id === RESPONSE_SCHEMA_V1_LEGACY
    ? v1Definition(row.definition_id || row.item_number)
    : null;
  return {
    disposition: "quarantined",
    itemLabel: legacyDef?.label || def?.title || row?.item_name || row?.item_number || row?.definition_id || "Unidentified item",
    code: "",
    display: "",
    reason: describeExclusions(verdict.reasons),
    warning: legacyDef ? V1_LEGACY_WARNING : "",
  };
}

function codeOf(definition, value) {
  if (!value || typeof value !== "object") return "";
  if (definition.response_shape === "multi_select") {
    return Array.isArray(value.codes) ? value.codes.join(", ") : "";
  }
  if (definition.response_shape === "grid") {
    return Array.isArray(value.rows) ? value.rows.map((r) => `${r.row_id}=${r.code}`).join(", ") : "";
  }
  return typeof value.code === "string" ? value.code : "";
}

/**
 * Build the whole output payload for an assessment: the CMS-reference section,
 * the separately labeled internal-screening section, and the quarantine list.
 *
 * Callers render these three; they do not re-decide eligibility.
 *
 * @param {object} assessment
 */
export function buildOasisOutput(assessment) {
  const rows = Array.isArray(assessment?.oasis_items) ? assessment.oasis_items : [];
  const cms = [];
  const screening = [];
  const quarantined = [];
  for (const row of rows) {
    const c = classifyRowForOutput(row, assessment);
    if (c.disposition === "cms_reference") cms.push(c);
    else if (c.disposition === "internal_screening") screening.push(c);
    else quarantined.push(c);
  }
  return {
    disclaimer: COMPANION_DISCLAIMER,
    cmsSection: {
      title: "CMS-aligned responses for PennSync's supported OASIS-E2 item subset",
      rows: cms,
    },
    screeningSection: {
      title: "PennSync screening — not an OASIS item",
      rows: screening,
    },
    quarantineSection: {
      title: "Not included — answer these from the wording in your EMR",
      rows: quarantined,
    },
    counts: { cms: cms.length, screening: screening.length, quarantined: quarantined.length },
  };
}

/**
 * Whether a whole assessment may be exported into a CMS-labeled document at all.
 *
 * An assessment with no eligible row still exports — as a quarantine notice, so
 * the reader learns why it is empty instead of receiving a blank form.
 */
export function outputSummaryLine(output) {
  const { cms, screening, quarantined } = output.counts;
  const parts = [`${cms} CMS-aligned response${cms === 1 ? "" : "s"}`];
  if (screening) parts.push(`${screening} internal screening answer${screening === 1 ? "" : "s"}`);
  if (quarantined) parts.push(`${quarantined} not included`);
  return parts.join(" · ");
}

/** Guard for tests and for any string headed into an OASIS document. */
export function containsBannedOutputPhrase(text) {
  const s = String(text || "");
  return BANNED_OUTPUT_PHRASES.filter((p) => s.includes(p));
}
