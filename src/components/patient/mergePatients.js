// Shared patient-merge boundary. Every surface that merges duplicates (the
// Duplicate Patients page, the scanner, the merge dialog) goes through the
// deduplicatePatients server broker, which authorizes the caller, re-points
// every record that references a duplicate (including the service-only
// care-team, note-history, document-binding and OASIS rows a browser cannot
// write), fills the survivor's empty fields, and archives each duplicate LAST.
// The browser never reads or writes a Patient or a linked record itself.
import { base44 } from "@/api/base44Client";

export const PATIENT_MERGES_PAUSED = false;
export const PATIENT_MERGE_PAUSED_MESSAGE =
  "Patient duplicate scanning and merging are temporarily unavailable.";

const MAX_MERGE_DUPLICATES = 25;

/** Error raised when the broker moved some records but could not finish. */
export class PatientMergeIncompleteError extends Error {
  constructor(result) {
    super(
      "The merge did not finish. Some linked records could not be moved yet, so the " +
        "duplicate was left active. Run the merge again to finish it.",
    );
    this.name = "PatientMergeIncompleteError";
    this.result = result;
  }
}

async function invokeDeduplicatePatients(payload) {
  const response = await base44.functions.invoke("deduplicatePatients", payload);
  return response?.data ?? response;
}

/**
 * Server dry-run scan for high-confidence duplicates (nothing is changed).
 * @returns {Promise<object>} the broker's preview report
 */
export async function scanDuplicatePatients() {
  return invokeDeduplicatePatients({ action: "scan" });
}

/**
 * Merge several duplicates into one surviving record through the server
 * broker. Resolves only when every duplicate was archived; a partial merge
 * rejects with PatientMergeIncompleteError (retrying the same call resumes it).
 *
 * @param {string} keepId          surviving patient id
 * @param {string[]} duplicateIds  ids to merge into the survivor
 * @param {{ agencyId?: string|null, fieldPatch?: object|null }} [opts]
 * @returns {Promise<{ patientsMerged: number, reassigned: Record<string, number>, fieldsMerged: string[], result: object }>}
 */
export async function mergePatientGroup(keepId, duplicateIds = [], { agencyId = null, fieldPatch = null } = {}) {
  if (!keepId) throw new Error("mergePatientGroup requires a survivor id");
  const ids = [...new Set((duplicateIds || []).filter((id) => id && id !== keepId))];
  if (ids.length === 0) return { patientsMerged: 0, reassigned: {}, fieldsMerged: [], result: null };
  if (ids.length > MAX_MERGE_DUPLICATES) {
    throw new Error(`A merge may include at most ${MAX_MERGE_DUPLICATES} duplicates at a time`);
  }

  const result = await invokeDeduplicatePatients({
    action: "merge",
    keep_id: keepId,
    duplicate_ids: ids,
    ...(agencyId ? { agency_id: agencyId } : {}),
    ...(fieldPatch && Object.keys(fieldPatch).length > 0 ? { field_patch: fieldPatch } : {}),
  });
  if (!result || result.complete !== true) throw new PatientMergeIncompleteError(result);
  const reassigned = {};
  for (const [field, count] of Object.entries(result.reassigned || {})) {
    const entity = field.split(".")[0];
    reassigned[entity] = (reassigned[entity] || 0) + count;
  }
  return {
    patientsMerged: Array.isArray(result.merged_ids) ? result.merged_ids.length : 0,
    reassigned,
    fieldsMerged: Array.isArray(result.fields_merged) ? result.fields_merged : [],
    result,
  };
}

/**
 * Merge one duplicate patient into a surviving (primary) record.
 *
 * @param {string} primaryId    surviving patient id
 * @param {string} duplicateId  patient id to merge in and archive
 * @param {{ agencyId?: string|null, fieldPatch?: object|null }} [opts]
 */
export async function mergePatientInto(primaryId, duplicateId, opts = {}) {
  if (!primaryId || !duplicateId) {
    throw new Error("mergePatientInto requires a primary and a duplicate id");
  }
  if (primaryId === duplicateId) {
    throw new Error("Cannot merge a patient into itself");
  }
  return mergePatientGroup(primaryId, [duplicateId], opts);
}

export { buildFieldMergePatch, MERGE_PATCH_FIELDS } from "./patientMergePlan";
