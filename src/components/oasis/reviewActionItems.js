// Build OASISActionItem payloads from Comprehensive OASIS Review output.
//
// The review surfaces findings; this turns the correctable ones — AI compliance
// risks, AI documentation inconsistencies, and deterministic check failures —
// into OASISActionItem records so they enter the existing action workflow
// (OASISActionWorkflow lists items by analysis_id) instead of dying with the
// review card. Pure — no React, no SDK; the caller creates the records.

/**
 * Stable identity for an action item, used to skip findings that are already
 * filed for this analysis. Category + M-item + the rationale text is what makes
 * two items "the same finding"; severity and status deliberately are not, so a
 * re-run that re-scores a finding doesn't create a duplicate.
 */
export function actionItemKey(item) {
  return [
    item?.category || "",
    (item?.oasis_item || "").trim().toLowerCase(),
    (item?.rationale || "").trim().toLowerCase().slice(0, 200),
  ].join("|");
}

const VALID_SEVERITIES = new Set(["critical", "high", "medium", "low"]);
const severityOf = (s) => (VALID_SEVERITIES.has(s) ? s : "medium");

// OASISActionItem.rationale is a text field, not a document — keep records lean.
const clip = (text, max = 900) => {
  const s = String(text || "").trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
};

const joinParts = (...parts) => parts.filter(Boolean).join(" ");

/** Deterministic check id → OASISActionItem.category enum value. */
function deterministicCategory(check) {
  if (/primary-dx/.test(check)) return "diagnosis";
  if (/episode-timing/.test(check)) return "episode_timing";
  if (/^m18|bedfast/.test(check)) return "functional_status";
  return "documentation";
}

/**
 * @param {Object} input
 * @param {Object} input.reviewResults          The review's results object (may be null)
 * @param {Array}  [input.deterministicFindings] Findings from runOasisDeterministicChecks
 * @param {string} input.analysisId             The analysis session id (OASISActionItem.analysis_id)
 * @param {string} [input.patientName]
 * @returns {Array<Object>} OASISActionItem create payloads (possibly empty)
 */
export function buildActionItemsFromReview({
  reviewResults,
  deterministicFindings = [],
  analysisId,
  patientName,
}) {
  if (!analysisId) return [];
  const base = {
    analysis_id: analysisId,
    ...(patientName ? { patient_name: patientName } : {}),
    status: "pending_review",
  };
  const items = [];

  for (const f of deterministicFindings) {
    if (!f?.message) continue;
    items.push({
      ...base,
      action_type: "correction",
      category: deterministicCategory(f.check || ""),
      ...(f.m_items?.length ? { oasis_item: f.m_items.join(", ") } : {}),
      ...(f.current_value ? { current_value: clip(f.current_value, 120) } : {}),
      rationale: clip(f.message),
      severity: severityOf(f.severity),
      // Deterministic rule hits are data discrepancies, not model output.
      source: "discrepancy",
    });
  }

  for (const risk of reviewResults?.compliance_risks || []) {
    const rationale = clip(joinParts(
      risk.risk_title && `${risk.risk_title}:`,
      risk.description,
      risk.corrective_action && `Corrective action: ${risk.corrective_action}`
    ));
    if (!rationale) continue;
    items.push({
      ...base,
      action_type: "correction",
      category: "compliance",
      ...(risk.affected_m_items?.length ? { oasis_item: risk.affected_m_items.join(", ") } : {}),
      rationale,
      severity: severityOf(risk.severity),
      source: "ai_recommendation",
    });
  }

  for (const inc of reviewResults?.documentation_inconsistencies || []) {
    const rationale = clip(joinParts(
      inc.inconsistency_title && `${inc.inconsistency_title}:`,
      inc.description,
      inc.how_to_reconcile && `How to reconcile: ${inc.how_to_reconcile}`
    ));
    if (!rationale) continue;
    items.push({
      ...base,
      action_type: "correction",
      category: "documentation",
      ...(inc.data_points_involved?.length ? { oasis_item: inc.data_points_involved.join(", ") } : {}),
      ...(inc.likely_incorrect_value ? { current_value: clip(inc.likely_incorrect_value, 120) } : {}),
      rationale,
      severity: severityOf(inc.severity),
      source: "ai_recommendation",
    });
  }

  return items;
}
