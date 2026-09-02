// The ONE client-side adapter for saving an OASIS assessment.
//
// Two paths, deliberately named apart so a reader can tell at the call site
// which one is happening:
//
//   saveOfficialResponses()  — v2, CMS-aligned, clinician-selected. Goes through
//                              the protected backend function, which re-validates
//                              every row. Requires the agency flag.
//
//   saveLegacyScreeningDraft() — the pre-cutover PennSync form. This is what the
//                              app does while the flag is OFF, and it is the
//                              product's existing behaviour, unchanged in what it
//                              stores. What IS new: every row it writes is now
//                              explicitly stamped `pennsync-oasis-response-v1-legacy`
//                              and `migration_status: "legacy_unconverted"`.
//
// That stamp is the point. Before it, a row written by this form was
// indistinguishable from a CMS response, so downstream paths read it as one.
// Now it is self-describing, and every CMS-labeled consumer refuses it by name
// rather than by guesswork. It is not carryable, not exportable with a code, and
// not CMS-scorable — and no amount of flag state makes it so.
//
// A direct `OASISAssessment.create/update` outside this module is a contract
// violation; `base44/oasisWriterContract.test.js` fails the build on one.

import { base44 } from "@/api/base44Client";
import {
  RESPONSE_SCHEMA_V1_LEGACY,
  RESPONSE_SCHEMA_V2_CMS_E2,
  resolveInstrumentForAssessment,
  visitTypeToTimepoint,
} from "./registry.js";
import { buildOfficialResponseRow } from "./responseBuilder.js";
import { canWriteV2Responses, writesAreKilled } from "./featureFlag.js";

/**
 * Save CMS-aligned v2 responses through the protected backend path.
 *
 * @param {object} args
 * @param {object} args.assessment  { patient_id, visit_id, visit_type, assessment_date, status }
 * @param {Array<{definitionId: string, responseValue: object}>} args.selections
 * @param {string} args.clinicianEmail
 * @param {object} [args.agencySettings]  the caller's AgencySettings row, from
 *   `fetchCallerAgencySettings()` in `@/lib/agencySettings` — NOT an `Agency`
 *   record, which carries neither flag. Omitting it fails closed.
 * @returns {Promise<{ok: true, assessment: object} | {ok: false, reason: string, detail: string, errors?: Array}>}
 */
export async function saveOfficialResponses({ assessment, selections, clinicianEmail, agencySettings }) {
  // Both checks are courtesy copies of the server's. `saveOasisResponses`
  // re-reads the same two fields for the caller's own agency and refuses on its
  // own authority, so a stale or absent settings row here costs a round trip,
  // never a write that should have been blocked.
  if (writesAreKilled(agencySettings)) {
    return { ok: false, reason: "write_kill_switch", detail: "OASIS response writes are temporarily disabled for this agency." };
  }
  if (!canWriteV2Responses(agencySettings)) {
    return {
      ok: false,
      reason: "feature_disabled",
      detail: "CMS-aligned OASIS response entry is not enabled for this agency.",
    };
  }

  const instrument = resolveInstrumentForAssessment(assessment);
  if (!instrument.resolved) {
    return { ok: false, reason: "unresolved_instrument", detail: `Assessment date is ${instrument.reason.replace(/_/g, " ")}.` };
  }
  if (!visitTypeToTimepoint(assessment?.visit_type)) {
    return { ok: false, reason: "unresolved_timepoint", detail: `Visit type "${assessment?.visit_type}" is not a CMS time point.` };
  }

  // Build every row first. One invalid selection fails the whole save rather
  // than persisting a partially-valid assessment.
  const rows = [];
  for (const sel of Array.isArray(selections) ? selections : []) {
    const built = buildOfficialResponseRow({
      definitionId: sel.definitionId,
      responseValue: sel.responseValue,
      assessment,
      clinicianEmail,
    });
    if (!built.ok) return { ok: false, reason: built.reason, detail: `${sel.definitionId}: ${built.detail}` };
    rows.push(built.row);
  }

  const { data } = await base44.functions.invoke("saveOasisResponses", {
    assessment_id: assessment?.id || null,
    patient_id: assessment?.patient_id,
    visit_id: assessment?.visit_id || null,
    visit_type: assessment?.visit_type,
    assessment_date: assessment?.assessment_date,
    status: assessment?.status,
    response_schema_id: RESPONSE_SCHEMA_V2_CMS_E2,
    oasis_items: rows,
  });

  if (!data || data.ok !== true) {
    return {
      ok: false,
      reason: data?.reason || "save_failed",
      detail: data?.error || "The assessment was not saved.",
      errors: data?.errors,
    };
  }
  return { ok: true, assessment: data.assessment };
}

/**
 * Save the pre-cutover PennSync screening form.
 *
 * Stores exactly what it always stored — the legacy scalar `response` — plus the
 * schema stamp that makes it self-describing. Nothing here is a CMS response.
 *
 * @param {object} args
 * @param {object} args.assessment
 * @param {Array<{id: string, itemNumber: string|null, itemSource: string, response: unknown, itemName?: string}>} args.answers
 */
export async function saveLegacyScreeningDraft({ assessment, answers }) {
  const rows = (Array.isArray(answers) ? answers : []).map((a) => ({
    item_number: a.itemNumber ?? a.id,
    item_name: a.itemName ?? "",
    item_source: a.itemSource,
    item_spec_version: "oasis-e2",
    // The stamp. Written by construction so it cannot be forgotten.
    response_schema_id: RESPONSE_SCHEMA_V1_LEGACY,
    // Byte-for-byte what the legacy writer always wrote.
    response: String(a.response),
  }));

  const payload = {
    ...assessment,
    oasis_items: rows,
    response_schema_id: RESPONSE_SCHEMA_V1_LEGACY,
    migration_status: "legacy_unconverted",
  };

  const saved = assessment?.id
    ? await base44.entities.OASISAssessment.update(assessment.id, payload)
    : await base44.entities.OASISAssessment.create(payload);
  return { ok: true, assessment: saved };
}
