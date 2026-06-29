// Shared patient-merge logic, so every surface that merges duplicates
// (the Duplicate Patients admin page, the merge dialogs) reassigns clinical
// history the same way instead of each re-implementing it slightly differently.
import { base44 } from "@/api/base44Client";

// Every entity that references a patient via `patient_id` must follow the patient
// when duplicates are merged — otherwise those records stay attached to the
// now-archived duplicate and disappear from the survivor's chart (the dialog
// promises the full clinical history is transferred). This is the complete set of
// patient_id-linked entities so nothing is orphaned on the archived record.
// Reassignment is best-effort per entity/record (see mergePatientInto): an entity
// the caller can't write (RLS) is skipped and logged, and the soft-archive +
// merged_into_id pointer keeps anything left behind recoverable.
export const PATIENT_RELATED_ENTITIES = [
  // Visits / care plans / alerts / pending updates
  "Visit", "CarePlan", "CarePlanProposal", "PatientAlert", "PendingPatientUpdate",
  "CareCoordinationAlert", "PatientRecommendation", "PatientRiskAssessment",
  // OASIS
  "OASISAssessment", "OASISUpload", "OASISAudit", "OASISFeedback", "OASISScenario",
  "OASISWorkflowExecution",
  // Clinical events / documents / referrals / discharge
  "ClinicalEvent", "Incident", "DischargeSummary", "Document", "DocumentSignature",
  "DocumentPackage", "Referral", "NoteConversion", "ComplianceAudit", "Task", "TeamNote",
  // Medications
  "Medication", "MedicationReconciliation",
  // Education
  "PatientEducationAssignment", "PatientEducationDelivery", "SentEducationMaterial",
  "TrainingRecommendation",
  // Telehealth / supplies
  "TelehealthSession", "SupplyUsageLog", "SupplyPrediction", "PDFIndex",
  // Communications history
  "CallLog", "SmsMessage", "SmsConsent", "ScheduledSms", "FaxLog", "ScheduledFax",
  "FaxDraft", "Message",
];

/**
 * Merge one duplicate patient into a surviving (primary) record:
 *   1. Reassign every related record (visits, care plans, alerts, pending
 *      updates) from the duplicate to the primary, so clinical history moves to
 *      the chart that's being kept.
 *   2. Soft-delete the duplicate — `is_archived: true`, `status: 'merged'`, and a
 *      pointer back to the survivor — mirroring the deduplicatePatients backend
 *      so a merge done in the UI looks identical to one done server-side and is
 *      fully recoverable (clear is_archived to restore). Nothing is hard-deleted.
 *
 * @param {string} primaryId    surviving patient id
 * @param {string} duplicateId  patient id to merge in and archive
 * @param {{ mergedBy?: string|null }} [opts]
 * @returns {Promise<{ reassigned: Record<string, number> }>} counts moved per entity
 */
export async function mergePatientInto(primaryId, duplicateId, { mergedBy = null } = {}) {
  if (!primaryId || !duplicateId) {
    throw new Error("mergePatientInto requires a primary and a duplicate id");
  }
  if (primaryId === duplicateId) {
    throw new Error("Cannot merge a patient into itself");
  }

  const reassigned = {};
  for (const entityName of PATIENT_RELATED_ENTITIES) {
    const api = base44.entities[entityName];
    if (!api?.filter || !api?.update) continue;
    let moved = 0;
    try {
      const records = (await api.filter({ patient_id: duplicateId })) || [];
      for (const record of records) {
        try {
          await api.update(record.id, { patient_id: primaryId });
          moved += 1;
        } catch (err) {
          // Best-effort: a single record the caller can't write (RLS) is left on the
          // archived duplicate (recoverable via merged_into_id) rather than aborting
          // the whole merge.
          console.error(`mergePatientInto: could not reassign ${entityName} ${record.id}:`, err?.message);
        }
      }
    } catch (err) {
      // Entity not readable for this caller (RLS) — skip; the merged_into_id pointer
      // still ties its records to the survivor.
      console.error(`mergePatientInto: could not read ${entityName} for reassignment:`, err?.message);
    }
    reassigned[entityName] = moved;
  }

  await base44.entities.Patient.update(duplicateId, {
    status: "merged",
    is_archived: true,
    merged_into_id: primaryId,
    merged_at: new Date().toISOString(),
    ...(mergedBy ? { merged_by: mergedBy } : {}),
  });

  return { reassigned };
}

/**
 * Merge several duplicates into one surviving record, sequentially.
 *
 * @param {string} keepId          surviving patient id
 * @param {string[]} duplicateIds  ids to merge into the survivor
 * @param {{ mergedBy?: string|null }} [opts]
 * @returns {Promise<{ patientsMerged: number, reassigned: Record<string, number> }>}
 */
export async function mergePatientGroup(keepId, duplicateIds = [], opts = {}) {
  if (!keepId) throw new Error("mergePatientGroup requires a survivor id");

  let patientsMerged = 0;
  const reassigned = {};
  for (const dupId of duplicateIds) {
    if (!dupId || dupId === keepId) continue;
    const { reassigned: moved } = await mergePatientInto(keepId, dupId, opts);
    patientsMerged += 1;
    for (const [entity, count] of Object.entries(moved)) {
      reassigned[entity] = (reassigned[entity] || 0) + count;
    }
  }
  return { patientsMerged, reassigned };
}
