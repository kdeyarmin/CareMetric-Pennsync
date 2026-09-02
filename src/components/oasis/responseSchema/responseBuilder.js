// The ONE pure, version-aware builder for an OASIS response row.
//
// Every writer goes through this. Before it, five surfaces each assembled their
// own `oasis_items[]` row, so provenance was whatever that surface happened to
// set — which is how AI-originated values and screening answers reached the same
// array shape as a clinician-selected CMS response.
//
// This function does not write anything. It returns either a complete, valid row
// or a named refusal, and the backend validator re-checks the same rules so a
// caller cannot skip it.
//
// Pure. No React, no SDK, no I/O.

import {
  getDefinition,
  RESPONSE_SCHEMA_V2_CMS_E2,
  visitTypeToTimepoint,
  isApplicableAtTimepoint,
  resolveInstrumentForAssessment,
  codesForTimepoint,
} from "./registry.js";
import { validateResponseValue } from "./shapes.js";

/**
 * Build one v2 response row.
 *
 * @param {object} args
 * @param {string} args.definitionId
 * @param {unknown} args.responseValue   Structured value: {code} | {codes} | {rows}
 * @param {object} args.assessment       Needs assessment_date + visit_type.
 * @param {string} args.clinicianEmail   Who explicitly selected this response.
 * @param {string} [args.selectedAt]     ISO timestamp; defaults to now.
 * @returns {{ ok: true, row: object } | { ok: false, reason: string, detail: string }}
 */
export function buildOfficialResponseRow({
  definitionId,
  responseValue,
  assessment,
  clinicianEmail,
  selectedAt,
}) {
  const definition = getDefinition(RESPONSE_SCHEMA_V2_CMS_E2, definitionId);
  if (!definition) {
    return { ok: false, reason: "unknown_definition", detail: `No v2 definition "${definitionId}".` };
  }

  const instrument = resolveInstrumentForAssessment(assessment);
  if (!instrument.resolved) {
    return {
      ok: false,
      reason: "unresolved_instrument",
      detail: `Assessment date is ${instrument.reason.replace(/_/g, " ")} — no instrument applies.`,
    };
  }

  const timepoint = visitTypeToTimepoint(assessment?.visit_type);
  if (!timepoint) {
    return { ok: false, reason: "unresolved_timepoint", detail: `Visit type "${assessment?.visit_type}" is not a CMS time point.` };
  }
  if (!isApplicableAtTimepoint(definition, timepoint)) {
    return {
      ok: false,
      reason: "invalid_timepoint",
      detail: `${definition.item_number || definition.title} is not collected at ${timepoint}.`,
    };
  }

  const shape = validateResponseValue(definition, responseValue);
  if (!shape.ok) return { ok: false, reason: shape.reason, detail: shape.detail };

  // Per-code time point omissions (M1620's UK is omitted on DC).
  const allowed = new Set(codesForTimepoint(definition, timepoint).map((c) => c.code));
  const used = collectCodes(definition, responseValue);
  for (const c of used) {
    if (!allowed.has(c)) {
      return { ok: false, reason: "invalid_code", detail: `Code "${c}" is not offered at ${timepoint}.` };
    }
  }

  const email = String(clinicianEmail || "").trim();
  if (!email) {
    return { ok: false, reason: "not_clinician_selected", detail: "An official response requires the selecting clinician." };
  }

  const isScreening = definition.item_source === "pennsync_screening";
  const row = {
    definition_id: definition.definition_id,
    // A screening prompt never carries an M-number.
    item_number: isScreening ? null : definition.item_number,
    item_name: definition.title,
    item_source: definition.item_source,
    item_spec_version: isScreening ? null : instrument.instrument,
    response_schema_id: RESPONSE_SCHEMA_V2_CMS_E2,
    response_shape: definition.response_shape,
    response_value: freezeValue(responseValue),
    response_origin: "clinician_selected",
    selected_by: email,
    selected_at: selectedAt || new Date().toISOString(),
    // Never true on a builder-produced row: AI cannot select a response.
    ai_suggested: false,
  };
  return { ok: true, row };
}

/** Every code referenced by a structured value, as strings. */
export function collectCodes(definition, value) {
  if (!value || typeof value !== "object") return [];
  if (definition.response_shape === "multi_select") return Array.isArray(value.codes) ? [...value.codes] : [];
  if (definition.response_shape === "grid") {
    return Array.isArray(value.rows) ? value.rows.map((r) => r?.code).filter((c) => typeof c === "string") : [];
  }
  return typeof value.code === "string" ? [value.code] : [];
}

/** Defensive copy so a caller cannot mutate the value after validation. */
function freezeValue(value) {
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value.codes)) return Object.freeze({ codes: Object.freeze([...value.codes]) });
  if (Array.isArray(value.rows)) {
    return Object.freeze({
      rows: Object.freeze(value.rows.map((r) => Object.freeze({ row_id: r.row_id, code: r.code }))),
    });
  }
  return Object.freeze({ code: value.code });
}

/**
 * Assessment-level provenance stamped alongside the rows.
 * Kept here so writer and validator cannot disagree about the shape.
 */
export function buildAssessmentProvenance(assessment) {
  const instrument = resolveInstrumentForAssessment(assessment);
  return {
    response_schema_id: RESPONSE_SCHEMA_V2_CMS_E2,
    instrument_version: instrument.resolved ? instrument.instrument : null,
    response_schema_cutover_at: new Date().toISOString(),
    migration_status: "native_v2",
  };
}
