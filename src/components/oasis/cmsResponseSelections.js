// Which CMS-aligned (v2) OASIS items a clinician records for an assessment, and
// what of their selections may be saved.
//
// The legacy PennSync screening form (oasisQuestions.jsx) is a companion aid:
// its answer choices do not reproduce the CMS response sets, so none of its
// answers is ever saved as an OASIS response. What IS saved is what the
// clinician selects here, from the CMS-aligned definitions, item by item, at the
// time point the assessment's own reason names. Nothing is pre-selected and
// nothing is carried over from the screening form or from an AI suggestion.
//
// Pure. No React, no SDK.

import { V2_DEFINITIONS } from "./responseSchema/v2CmsE2.js";
import { visitTypeToTimepoint, isApplicableAtTimepoint } from "./responseSchema/registry.js";

// The hospitalization-risk screening tier stays in the frozen schema (a stored
// row must keep its meaning) but is not offered for entry: the owner removed
// clinical risk-prediction features on 2026-10-08, and a "risk tier" prompt
// sits on that line.
export const CMS_ENTRY_EXCLUDED_DEFINITIONS = Object.freeze(["ps_hospitalization_risk_tier"]);

/** The definitions offered for entry at this assessment reason, CMS items first. */
export function cmsEntryDefinitions(visitType) {
  const timepoint = visitTypeToTimepoint(visitType);
  if (!timepoint) return [];
  return Object.values(V2_DEFINITIONS)
    .filter((definition) => !CMS_ENTRY_EXCLUDED_DEFINITIONS.includes(definition.definition_id))
    .filter((definition) => isApplicableAtTimepoint(definition, timepoint))
    .sort((a, b) => {
      const aScreen = a.item_source === "pennsync_screening" ? 1 : 0;
      const bScreen = b.item_source === "pennsync_screening" ? 1 : 0;
      if (aScreen !== bScreen) return aScreen - bScreen;
      return String(a.item_number || a.title).localeCompare(String(b.item_number || b.title));
    });
}

/** Whether a structured value is a complete answer for its definition. */
export function isResponseAnswered(definition, value) {
  if (!definition || !value || typeof value !== "object") return false;
  if (definition.response_shape === "multi_select") {
    return Array.isArray(value.codes) && value.codes.length > 0;
  }
  if (definition.response_shape === "grid") {
    return Array.isArray(value.rows) && value.rows.length === (definition.rows || []).length;
  }
  return typeof value.code === "string" && value.code.length > 0;
}

/**
 * Keep only selections still collected at the (possibly changed) reason, so a
 * Discharge-only answer never rides along on a Start of Care save.
 */
export function pruneToVisitType(visitType, responses) {
  const allowed = new Set(cmsEntryDefinitions(visitType).map((definition) => definition.definition_id));
  const kept = {};
  for (const [id, value] of Object.entries(responses || {})) {
    if (allowed.has(id)) kept[id] = value;
  }
  return kept;
}

/** The complete answers, in the adapter's `{definitionId, responseValue}` shape. */
export function selectionsForSave(visitType, responses) {
  const selections = [];
  for (const definition of cmsEntryDefinitions(visitType)) {
    const value = responses?.[definition.definition_id];
    if (isResponseAnswered(definition, value)) {
      selections.push({ definitionId: definition.definition_id, responseValue: value });
    }
  }
  return selections;
}

/** Answered / offered, for the progress line. */
export function cmsEntryProgress(visitType, responses) {
  const definitions = cmsEntryDefinitions(visitType);
  const answered = definitions.filter((definition) => isResponseAnswered(definition, responses?.[definition.definition_id])).length;
  return { answered, total: definitions.length };
}
