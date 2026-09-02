// Shared fixture builders for tests that need realistic saved rows.
//
// Kept OUT of the golden-fixture path on purpose: `cmsGoldenFixtures.js` is
// transcribed independently from the CMS instrument and must never be built from
// the registry. This file is the opposite — a convenience for assembling
// well-formed rows so a test can focus on the behaviour under test rather than
// on row plumbing.

import { RESPONSE_SCHEMA_V2_CMS_E2, RESPONSE_SCHEMA_V1_LEGACY } from "./registry.js";

/** A clinician-selected v2 row. */
export function v2Row(definitionId, itemNumber, code, overrides = {}) {
  return {
    definition_id: definitionId,
    item_number: itemNumber,
    item_source: "cms_item",
    item_spec_version: "oasis-e2",
    response_schema_id: RESPONSE_SCHEMA_V2_CMS_E2,
    response_shape: "single",
    response_value: { code },
    response_origin: "clinician_selected",
    selected_by: "rn@example.com",
    selected_at: "2026-05-01T12:00:00.000Z",
    ai_suggested: false,
    ...overrides,
  };
}

/** A pre-cutover row exactly as the legacy writer persisted it. */
export function legacyRow(definitionId, itemNumber, response) {
  return {
    definition_id: definitionId,
    item_number: itemNumber,
    item_source: "cms_item",
    item_spec_version: "oasis-e2",
    response_schema_id: RESPONSE_SCHEMA_V1_LEGACY,
    response,
  };
}

/** A row from before any provenance marker existed. */
export function unversionedRow(itemNumber, response) {
  return { item_number: itemNumber, response };
}

/** A v2 assessment wrapper. */
export function v2Assessment({ visitType, date, rows, patientId = "p1" }) {
  return {
    patient_id: patientId,
    visit_type: visitType,
    assessment_date: date,
    response_schema_id: RESPONSE_SCHEMA_V2_CMS_E2,
    instrument_version: "oasis-e2",
    migration_status: "native_v2",
    oasis_items: rows,
  };
}

/** A legacy assessment wrapper. */
export function legacyAssessment({ visitType, date, rows, patientId = "p1" }) {
  return {
    patient_id: patientId,
    visit_type: visitType,
    assessment_date: date,
    response_schema_id: RESPONSE_SCHEMA_V1_LEGACY,
    migration_status: "legacy_unconverted",
    oasis_items: rows,
  };
}
