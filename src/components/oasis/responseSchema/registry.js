// Append-only registry of PennSync OASIS RESPONSE SCHEMAS.
//
// WHY THIS IS SEPARATE FROM specs/registry.js
// `specs/registry.js` answers "which CMS INSTRUMENT was in effect" —
// OASIS-E, E1, E2. That is a fact about CMS. It says nothing about what
// PennSync's own answer choices MEANT when a clinician picked one, and
// conflating the two is how a legacy answer could be read under new labels:
// `item_spec_version: "oasis-e2"` was true of a row whose response options were
// PennSync's own abbreviated list.
//
// This registry answers the second question. A saved row states which response
// schema it was written under; a reader that does not recognise that schema, or
// finds none at all, must refuse — never assume the current one.
//
// APPEND-ONLY. A published schema id is immutable: its definitions are frozen at
// introduction and never edited, because editing one silently rewrites the
// meaning of every row already saved under it.
//
// Pure data + pure functions. No React, no SDK.

import { V1_LEGACY_DEFINITIONS, V1_FROZEN_IDS, V1_LEGACY_WARNING, v1Definition } from "./v1Legacy.js";
import { V2_DEFINITIONS, V2_CMS_DEFINITION_IDS, V2_SCREENING_DEFINITION_IDS } from "./v2CmsE2.js";
import { validateResponseValue } from "./shapes.js";
import { CMS_SOURCES, V2_DERIVATION } from "./sources.js";

export const RESPONSE_SCHEMA_V1_LEGACY = "pennsync-oasis-response-v1-legacy";
export const RESPONSE_SCHEMA_V2_CMS_E2 = "pennsync-oasis-response-v2-cms-e2";

/**
 * Every response schema PennSync has ever published, oldest first.
 * Adding an entry is allowed; changing or removing one is not.
 */
export const RESPONSE_SCHEMAS = Object.freeze([
  Object.freeze({
    id: RESPONSE_SCHEMA_V1_LEGACY,
    label: "PennSync legacy response set (pre-CMS alignment)",
    status: "frozen",
    introduced: "2026-09-01",
    // Read-only history. Never writable again, at any flag state.
    writable: false,
    definitions: V1_LEGACY_DEFINITIONS,
    warning: V1_LEGACY_WARNING,
    note:
      "A snapshot of the response sets in use before the CMS-aligned cutover. Kept so a stored "
      + "answer can be displayed with the label it was actually answered under. Not carryable, "
      + "not exportable with a code, not CMS-scorable.",
  }),
  Object.freeze({
    id: RESPONSE_SCHEMA_V2_CMS_E2,
    label: "CMS-aligned response sets for PennSync's supported OASIS-E2 item subset",
    status: "active",
    introduced: "2026-09-01",
    // Writable only when the agency feature flag is on — see featureFlag.js.
    writable: true,
    definitions: V2_DEFINITIONS,
    warning: "",
    note: V2_DERIVATION.method,
  }),
]);

/** Ids only, for contract tests and stale-client checks. */
export const RESPONSE_SCHEMA_IDS = Object.freeze(RESPONSE_SCHEMAS.map((s) => s.id));

/** The schema new official responses are written under after cutover. */
export const CURRENT_RESPONSE_SCHEMA_ID = RESPONSE_SCHEMA_V2_CMS_E2;

/**
 * CMS items PennSync deliberately does NOT implement.
 *
 * Recorded rather than omitted, so a consumer that wants a facility destination
 * gets a named "not implemented" instead of quietly reaching for M2420.
 */
export const UNIMPLEMENTED_ITEMS = Object.freeze({
  M2410: Object.freeze({
    item_number: "M2410",
    title: "To which Inpatient Facility has the patient been admitted?",
    timepoints: Object.freeze(["TRN", "DC"]),
    reason:
      "Inpatient-facility transfer destination is M2410. PennSync has not implemented it from a "
      + "verified source, and M2420 (Discharge Disposition) must never be repurposed to stand in "
      + "for it: under OASIS-E2, M2420 codes 2–4 name community and hospice destinations, not "
      + "hospital, rehab or SNF.",
  }),
  M2003: Object.freeze({
    item_number: "M2003",
    title: "Medication Follow-up",
    timepoints: Object.freeze(["SOC", "ROC"]),
    reason:
      "The legacy M2001 merged this follow-up question into itself. M2003 is a separate CMS item "
      + "and is not implemented; it must not be folded back into M2001.",
  }),
});

/**
 * The five abbreviated items that are explicitly OUT of this cutover.
 *
 * They stay fail-closed and non-carryable until separately reviewed. Listed so
 * a reader can prove they were not silently promoted.
 */
export const NOT_PROMOTED_ABBREVIATED_ITEMS = Object.freeze(["m1700", "m1810", "m1820", "m1845", "m1850"]);

/** @param {string} schemaId */
export function getResponseSchema(schemaId) {
  return RESPONSE_SCHEMAS.find((s) => s.id === schemaId) || null;
}

/** @param {string} schemaId @param {string} definitionId */
export function getDefinition(schemaId, definitionId) {
  const schema = getResponseSchema(schemaId);
  if (!schema) return null;
  const key = String(definitionId || "").toLowerCase();
  return schema.definitions[key] || schema.definitions[definitionId] || null;
}

/** Every v2 definition, official and screening. */
export function v2Definition(definitionId) {
  return getDefinition(RESPONSE_SCHEMA_V2_CMS_E2, definitionId);
}

export { V1_FROZEN_IDS, V2_CMS_DEFINITION_IDS, V2_SCREENING_DEFINITION_IDS, v1Definition, V1_LEGACY_WARNING };

// ---------------------------------------------------------------------------
// Timepoints
// ---------------------------------------------------------------------------

/** CMS OASIS time points. */
export const CMS_TIMEPOINTS = Object.freeze(["SOC", "ROC", "FU", "TRN", "DC", "DAH"]);

/**
 * Map PennSync's `visit_type` onto a CMS time point.
 *
 * Returns null for anything unrecognised — a caller must then treat the
 * assessment as timepoint-unresolved, not guess SOC.
 *
 * @param {string} visitType
 */
export function visitTypeToTimepoint(visitType) {
  switch (String(visitType || "").trim()) {
    case "Start of Care": return "SOC";
    case "Resumption of Care": return "ROC";
    // A recertification is collected on the CMS Follow-up instrument.
    case "Recertification": return "FU";
    case "Transfer": return "TRN";
    case "Discharge": return "DC";
    case "Death at Home": return "DAH";
    default: return null;
  }
}

/**
 * Whether a definition may be answered at a time point.
 * Unknown definition or unknown time point => false (fail closed).
 */
export function isApplicableAtTimepoint(definition, timepoint) {
  if (!definition || !timepoint) return false;
  if (!CMS_TIMEPOINTS.includes(timepoint)) return false;
  return Array.isArray(definition.timepoints) && definition.timepoints.includes(timepoint);
}

/** Codes valid at a time point, honouring per-code omissions (M1620 UK on DC). */
export function codesForTimepoint(definition, timepoint) {
  if (!definition) return [];
  return (definition.codes || []).filter(
    (c) => !Array.isArray(c.omitted_at_timepoints) || !c.omitted_at_timepoints.includes(timepoint),
  );
}

// ---------------------------------------------------------------------------
// Instrument resolution — fail closed on a missing or invalid date
// ---------------------------------------------------------------------------

/** OASIS-E2's effective window. */
const E2_EFFECTIVE_FROM = Date.parse("2026-04-01");

/**
 * Resolve the instrument version for an assessment.
 *
 * The previous `resolveSpecForDate()` returned the ACTIVE spec when the date was
 * missing or unparseable, which retrospectively stamped OASIS-E2 onto rows whose
 * instrument nobody knew. This returns an explicit unresolved state instead.
 *
 * @param {{ assessment_date?: string, instrument_version?: string }} assessment
 * @returns {{ resolved: boolean, instrument: string|null, reason?: string }}
 */
export function resolveInstrumentForAssessment(assessment) {
  const raw = assessment?.assessment_date;
  if (raw === null || raw === undefined || String(raw).trim() === "") {
    return { resolved: false, instrument: null, reason: "missing_assessment_date" };
  }
  const t = raw instanceof Date ? raw.getTime() : Date.parse(String(raw));
  if (!Number.isFinite(t)) {
    return { resolved: false, instrument: null, reason: "invalid_assessment_date" };
  }
  if (t < E2_EFFECTIVE_FROM) {
    // A real date, but before OASIS-E2. PennSync holds no verified response set
    // for the earlier instrument, so there is nothing to resolve TO.
    return { resolved: false, instrument: null, reason: "assessment_predates_oasis_e2" };
  }
  return { resolved: true, instrument: "oasis-e2" };
}

// ---------------------------------------------------------------------------
// Row eligibility — the single fail-closed gate
// ---------------------------------------------------------------------------

/** Named, user-visible exclusion reasons. Never collapse these to a boolean. */
export const EXCLUSION_REASONS = Object.freeze({
  missing_response_schema: "Row has no response_schema_id — its response meanings are unknown.",
  unknown_response_schema: "Row was written under a response schema this build does not recognise.",
  legacy_response_schema: "Row was answered under the frozen PennSync legacy response set.",
  unknown_definition: "Row's definition_id is not in its declared response schema.",
  screening_item: "PennSync screening prompt — not an OASIS item.",
  not_cms_item: "Row is not a CMS item response.",
  invalid_response_shape: "Row's stored response does not match the shape its item declares.",
  invalid_timepoint: "Item is not collected at this assessment's time point.",
  unresolved_timepoint: "Assessment visit type does not map to a CMS time point.",
  unresolved_instrument: "Assessment date is missing or invalid, so no instrument applies.",
  instrument_mismatch: "Row's instrument version does not match the assessment's.",
  not_clinician_selected: "Response was not explicitly selected by a clinician.",
  ai_originated: "Response originated from AI rather than a clinician selection.",
  screening_wearing_m_number: "Screening row is carrying a CMS M-number.",
  source_not_verified: "Item's response set is not verified against a final CMS source.",
});

/**
 * Evaluate ONE saved row in its assessment context.
 *
 * This is the function every carry/export/score path must call. It deliberately
 * takes the whole row and the assessment — not an `itemId` — because item
 * identity was never sufficient: `M1830` is a real CMS number under both
 * schemas, and only the row's schema says which meaning its `6` carries.
 *
 * @param {object} row        A saved `oasis_items[]` row.
 * @param {object} assessment The owning assessment (for date + visit_type).
 */
export function evaluateRow(row, assessment) {
  const out = {
    definition: null,
    schemaId: null,
    timepoint: null,
    /** May the clinician carry this code into the EMR / may it print as a code? */
    carryable: false,
    /** May it appear in a CMS-labeled output section with its code? */
    cmsOutputAllowed: false,
    /** May it feed a CMS-labeled calculation (outcomes, PDGM, quality)? */
    cmsScorable: false,
    reasons: [],
  };
  const deny = (key) => {
    if (!out.reasons.includes(key)) out.reasons.push(key);
    return out;
  };

  if (!row || typeof row !== "object") return deny("missing_response_schema");

  const schemaId = row.response_schema_id;
  if (!schemaId) return deny("missing_response_schema");
  const schema = getResponseSchema(schemaId);
  if (!schema) return deny("unknown_response_schema");
  out.schemaId = schemaId;

  if (schemaId === RESPONSE_SCHEMA_V1_LEGACY) {
    // Legacy rows resolve for DISPLAY only. Everything else stays false.
    out.definition = v1Definition(row.definition_id || row.item_number);
    return deny("legacy_response_schema");
  }

  const definition = getDefinition(schemaId, row.definition_id);
  if (!definition) return deny("unknown_definition");
  out.definition = definition;

  // A screening prompt must never wear an M-number.
  if (definition.item_source === "pennsync_screening") {
    if (row.item_number) deny("screening_wearing_m_number");
    return deny("screening_item");
  }
  if (definition.item_source !== "cms_item") return deny("not_cms_item");
  if (row.item_source && row.item_source !== "cms_item") deny("not_cms_item");
  if (row.item_number && row.item_number !== definition.item_number) deny("unknown_definition");

  if (definition.source_verification !== "verified_against_final_cms_source") {
    deny("source_not_verified");
  }

  // Instrument must resolve, and must agree with the row.
  const instr = resolveInstrumentForAssessment(assessment);
  if (!instr.resolved) deny("unresolved_instrument");
  else if (row.item_spec_version && row.item_spec_version !== instr.instrument) deny("instrument_mismatch");

  // Time point must resolve and the item must be collected there.
  const tp = visitTypeToTimepoint(assessment?.visit_type);
  out.timepoint = tp;
  if (!tp) deny("unresolved_timepoint");
  else if (!isApplicableAtTimepoint(definition, tp)) deny("invalid_timepoint");

  // Shape must validate against the definition.
  const shapeCheck = validateResponseValue(definition, row.response_value);
  if (!shapeCheck.ok) {
    deny("invalid_response_shape");
    out.shapeDetail = shapeCheck.detail;
  }

  // Provenance: an official response exists only because a clinician picked it.
  if (row.response_origin !== "clinician_selected") deny("not_clinician_selected");
  if (row.ai_suggested === true) deny("ai_originated");

  if (out.reasons.length === 0) {
    out.carryable = true;
    out.cmsOutputAllowed = true;
    out.cmsScorable = true;
  }
  return out;
}

/** Human-readable exclusion text for a reasons array. */
export function describeExclusions(reasons) {
  return (Array.isArray(reasons) ? reasons : [])
    .map((r) => EXCLUSION_REASONS[r] || r)
    .join(" ");
}

/**
 * Keep only rows that may feed a CMS-labeled calculation, with the excluded
 * ones and their named reasons kept alongside — never silently dropped.
 *
 * @param {object} assessment
 * @returns {{ included: Array, excluded: Array<{row: object, reasons: string[]}> }}
 */
export function partitionRowsForCms(assessment) {
  const rows = Array.isArray(assessment?.oasis_items) ? assessment.oasis_items : [];
  const included = [];
  const excluded = [];
  for (const row of rows) {
    const verdict = evaluateRow(row, assessment);
    if (verdict.cmsScorable) included.push({ row, verdict });
    else excluded.push({ row, reasons: verdict.reasons, verdict });
  }
  return { included, excluded };
}

/** Every code of a v2 definition, as opaque strings. */
export function validCodes(definitionId) {
  const d = v2Definition(definitionId);
  return d ? d.codes.map((c) => c.code) : [];
}

/** The source record a v2 definition cites. */
export function sourceForDefinition(definitionId) {
  const d = v2Definition(definitionId);
  return d && d.source_id ? CMS_SOURCES[d.source_id] || null : null;
}
