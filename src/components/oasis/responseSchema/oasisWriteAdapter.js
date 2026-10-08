// The ONE client-side adapter for saving OASIS responses.
//
// Released by the owner on 2026-10-08 ("turn everything on"). Every save goes
// through the protected backend broker `saveOasisResponses`, which:
//   * decides authority from the protected admin role or the caller's exact
//     active AgencyMembership — never a self-editable User field;
//   * applies the chart rule (agency-wide role, recorded creator, or an exact
//     active care-team assignment) before the write;
//   * derives every row's schema, item metadata and clinician provenance itself
//     and re-validates each against the CMS-aligned (v2) definitions; and
//   * rechecks authority after the write, removing a write that lost it, and
//     returns the first record for a retried save instead of a twin.
//
// What this module adds is the client half of the same rule: every selection is
// built by `buildOfficialResponseRow()` first, so a value the server would refuse
// is reported to the clinician by item before anything is sent. Only the
// definition id and the structured value travel; nothing a browser could use to
// claim provenance, tenancy or a schema does.
//
// The legacy (v1) PennSync screening form is permanently read-only: its answer
// choices do not reproduce the CMS response sets, so it is never written as a
// response. `saveLegacyScreeningDraft` says so by name rather than writing.
//
// A direct `OASISAssessment.create/update` outside the broker is a contract
// violation; `base44/oasisWriterContract.test.js` fails the build on one.

import { base44 } from "@/api/base44Client";
import { visitTypeToTimepoint, resolveInstrumentForAssessment } from "./registry.js";
import { buildOfficialResponseRow } from "./responseBuilder.js";

const SAVE_STATUSES = new Set(["draft", "completed"]);

/**
 * Save clinician-selected CMS-aligned (v2) responses as a new dated record.
 *
 * @param {object} args
 * @param {string} args.agencyId           The caller's selected agency (tenant context).
 * @param {object} args.assessment         { patient_id, visit_id?, visit_type, assessment_date, status? }
 * @param {Array<{definitionId: string, responseValue: object}>} args.selections
 * @param {string} args.clinicianEmail     The signed-in clinician (row pre-check only;
 *   the server stamps provenance from the session, never from this value).
 * @param {string} [args.clinicalSummary]
 * @returns {Promise<{ok: true, created: boolean, assessment: object, completion_percentage?: number}
 *   | {ok: false, reason: string, detail: string, errors?: Array}>}
 */
export async function saveOfficialResponses({ agencyId, assessment, selections, clinicianEmail, clinicalSummary }) {
  const status = assessment?.status || "draft";
  if (!SAVE_STATUSES.has(status)) {
    return { ok: false, reason: "invalid_status", detail: "An assessment is saved as a draft or as completed." };
  }
  if (!agencyId) {
    return { ok: false, reason: "agency_required", detail: "Select your agency before saving an assessment." };
  }
  if (!assessment?.patient_id) {
    return { ok: false, reason: "patient_required", detail: "Select a patient before saving." };
  }
  const instrument = resolveInstrumentForAssessment(assessment);
  if (!instrument.resolved) {
    return { ok: false, reason: "unresolved_instrument", detail: `Assessment date is ${instrument.reason.replace(/_/g, " ")}.` };
  }
  if (!visitTypeToTimepoint(assessment?.visit_type)) {
    return { ok: false, reason: "unresolved_timepoint", detail: `Visit type "${assessment?.visit_type}" is not a CMS time point.` };
  }

  const list = Array.isArray(selections) ? selections : [];
  if (list.length === 0) {
    return { ok: false, reason: "no_responses", detail: "Select at least one CMS-aligned response before saving." };
  }
  // Build every row first. One invalid selection fails the whole save rather
  // than persisting a partially-valid assessment.
  const items = [];
  for (const sel of list) {
    const built = buildOfficialResponseRow({
      definitionId: sel.definitionId,
      responseValue: sel.responseValue,
      assessment,
      clinicianEmail,
    });
    if (!built.ok) return { ok: false, reason: built.reason, detail: `${sel.definitionId}: ${built.detail}` };
    items.push({ definition_id: built.row.definition_id, response_value: sel.responseValue });
  }

  const body = {
    operation: "create_draft",
    agency_id: agencyId,
    patient_id: assessment.patient_id,
    visit_type: assessment.visit_type,
    assessment_date: assessment.assessment_date,
    status,
    oasis_items: items,
  };
  if (assessment.visit_id) body.visit_id = assessment.visit_id;
  const summary = typeof clinicalSummary === "string" ? clinicalSummary.trim() : "";
  if (summary) body.clinical_summary = summary.slice(0, 2000);

  let data;
  try {
    const response = await base44.functions.invoke("saveOasisResponses", body);
    data = response?.data ?? response;
  } catch (error) {
    data = error?.response?.data || null;
    if (!data) {
      return { ok: false, reason: "save_failed", detail: error?.message || "The assessment was not saved." };
    }
  }
  if (!data || data.ok !== true) {
    return {
      ok: false,
      reason: data?.reason || "save_failed",
      detail: data?.error || "The assessment was not saved.",
      errors: data?.errors,
    };
  }
  return {
    ok: true,
    created: data.created !== false,
    assessment: data.assessment,
    completion_percentage: data.completion_percentage,
  };
}

/**
 * Legacy (v1) PennSync screening answers are never written as OASIS responses:
 * their answer choices do not reproduce the CMS response sets. The answers stay
 * in the clinician's local draft and the printed companion guide.
 */
export async function saveLegacyScreeningDraft() {
  return {
    ok: false,
    reason: "legacy_schema_read_only",
    detail: "PennSync's legacy screening answers are kept as a local draft and printed guide; they are not saved as OASIS responses.",
  };
}
