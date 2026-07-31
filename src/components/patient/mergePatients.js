// Shared patient-merge logic, so every surface that merges duplicates
// (the Duplicate Patients admin page, the merge dialogs) reassigns clinical
// history the same way instead of each re-implementing it slightly differently.
import { base44 } from "@/api/base44Client";
import { reassignIncidentPatient } from '@/functions/updateIncident';

// Every entity that references a patient via `patient_id` must follow the patient
// when duplicates are merged — otherwise those records stay attached to the
// now-archived duplicate and disappear from the survivor's chart (the dialog
// promises the full clinical history is transferred). This is the complete set of
// patient_id-linked entities so nothing is orphaned on the archived record.
// Reassignment is best-effort per entity/record (see mergePatientInto): an entity
// the caller can't write (RLS) is skipped and logged, and the soft-archive +
// merged_into_id pointer keeps anything left behind recoverable.
// The list is pinned against the entity schemas by mergePatients.entityList.test.js
// (it scans base44/entities/*.jsonc for patient_id) — a new patient-linked entity
// that isn't added here fails the test instead of silently orphaning records.
/**
 * Entities whose writes are service-role-only and therefore cannot be
 * reassigned with a direct entity update. Incident moved behind the
 * updateIncident function when its write RLS was locked down; without this
 * indirection every incident update here would throw, get swallowed by the
 * best-effort catch below, and leave the incidents stranded on the archived
 * duplicate chart.
 */
const FUNCTION_BACKED_REASSIGN = {
  Incident: (recordId, patientId) => reassignIncidentPatient({ incidentId: recordId, patientId }),
};

function reassignRecordToPatient(entityName, api, recordId, primaryId) {
  const viaFunction = FUNCTION_BACKED_REASSIGN[entityName];
  if (viaFunction) return viaFunction(recordId, primaryId);
  return api.update(recordId, { patient_id: primaryId });
}

export const PATIENT_RELATED_ENTITIES = [
  "AdrAuditCase", "AppliedDataLog", "AppointmentForm", "Billing", "CallLog",
  "CareCoordinationAlert", "CarePlan", "CarePlanProposal", "ClinicalEvent",
  "ClinicalLibraryTemplate", "ComplianceAudit", "DigitalSignature",
  "DischargeSummary", "Document", "DocumentAnalysisHistory", "DocumentPackage",
  "DocumentRecord", "DocumentSignature", "FaceToFaceEncounter", "FaxDraft",
  "FaxHistory", "FaxLog", "GeneratedDocument", "HealthRecord", "Immunization",
  "Incident", "InterventionLog", "Invoice", "MaterialInteraction", "MedicalCode",
  "Medication", "MedicationReconciliation", "Message", "NoteConversion",
  "NoteFeedback", "OASISAssessment", "OASISAudit", "OASISFeedback",
  "OASISScenario", "OASISUpload", "OASISWorkflowExecution", "PDFIndex",
  "PDGMCaseMix", "PatientAlert", "PatientBillingInfo", "PatientDocument",
  "PatientEducationAssignment", "PatientEducationDelivery",
  "PatientEducationDraft", "PatientEducationEngagement", "PatientMessage",
  "PatientOutcome", "PatientOutcomeMetric", "PatientPathwayAssignment",
  "PatientRecommendation", "PatientRiskAssessment", "Payment", "PaymentRecord",
  "PendingPatientUpdate", "ProviderPatientAssignment", "Referral", "RiskAlert",
  "RiskAnalysis", "ScheduledFax", "ScheduledSms", "SentEducationMaterial",
  "SmsConsent", "SmsMessage", "SuggestedIntervention", "SupplyPrediction",
  "SupplyUsageLog", "Task", "TeamMessage", "TeamNote", "TelehealthSession",
  "TimeSavings", "TrainingRecommendation", "Visit",
];

// Page size for reassigning related records. `filter` with no explicit limit
// silently caps at the SDK default of 50, so a long-tenured patient's 51st+
// visit/OASIS/etc. would be stranded on the archived duplicate. Page at the
// SDK's documented 5000/request maximum so the full clinical history follows
// the patient.
const REASSIGN_PAGE_SIZE = 5000;

/**
 * Merge one duplicate patient into a surviving (primary) record:
 *   1. Reassign every related record (visits, alerts, pending updates) from the
 *      duplicate to the primary, so clinical history moves to the chart that's
 *      being kept.
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

  // The survivor must be a real, live chart. A typo'd/ghost id would re-point
  // the entire clinical history to a chart that doesn't exist; an archived or
  // already-merged survivor would chain live records onto an invisible record.
  const [primary] = await base44.entities.Patient.filter({ id: primaryId }, undefined, 1);
  if (!primary) {
    throw new Error("The surviving patient record was not found — refusing to merge into a nonexistent chart.");
  }
  if (primary.is_archived || primary.status === "merged") {
    throw new Error("The surviving patient record is archived/merged — restore it (or pick its survivor) before merging into it.");
  }
  const [duplicate] = await base44.entities.Patient.filter({ id: duplicateId }, undefined, 1);

  const reassigned = {};
  for (const entityName of PATIENT_RELATED_ENTITIES) {
    const api = base44.entities[entityName];
    if (!api?.filter || !api?.update) continue;
    let moved = 0;
    try {
      // Reassign in pages until every related record has followed the patient.
      // Each successful update moves the record OFF `duplicateId`, so reassigned
      // rows drop out of the next filter — re-querying from the top walks the
      // whole set without an explicit skip offset. Stop on a short (final) page,
      // or when a page yields no writable record (e.g. all RLS-blocked) so a
      // permanently-failing row can't loop forever.
      let fetched = REASSIGN_PAGE_SIZE;
      while (fetched === REASSIGN_PAGE_SIZE) {
        const records = (await api.filter({ patient_id: duplicateId }, undefined, REASSIGN_PAGE_SIZE)) || [];
        fetched = records.length;
        let movedThisPage = 0;
        for (const record of records) {
          try {
            await reassignRecordToPatient(entityName, api, record.id, primaryId);
            moved += 1;
            movedThisPage += 1;
          } catch (err) {
            // Best-effort: a single record the caller can't write (RLS) is left on the
            // archived duplicate (recoverable via merged_into_id) rather than aborting
            // the whole merge.
            console.error(`mergePatientInto: could not reassign ${entityName} ${record.id}:`, err?.message);
          }
        }
        // No record in this page was writable — stop rather than re-querying the
        // same stuck rows forever.
        if (movedThisPage === 0) break;
      }
    } catch (err) {
      // Entity not readable for this caller (RLS) — skip; the merged_into_id pointer
      // still ties its records to the survivor.
      console.error(`mergePatientInto: could not read ${entityName} for reassignment:`, err?.message);
    }
    reassigned[entityName] = moved;
  }

  // Field-level merge: the winner keeps everything it has, and inherits what
  // it LACKS from the loser — before this, the loser's allergies, meds, DOB,
  // MRN, and notes history survived only on the invisible archived record
  // while the active chart showed blanks.
  const fieldPatch = buildFieldMergePatch(primary, duplicate);
  if (Object.keys(fieldPatch).length > 0) {
    try {
      await base44.entities.Patient.update(primaryId, fieldPatch);
    } catch (err) {
      console.error("mergePatientInto: field merge onto survivor failed:", err?.message);
    }
  }

  await base44.entities.Patient.update(duplicateId, {
    status: "merged",
    is_archived: true,
    merged_into_id: primaryId,
    merged_at: new Date().toISOString(),
    ...(mergedBy ? { merged_by: mergedBy } : {}),
  });

  return { reassigned, fieldsMerged: Object.keys(fieldPatch) };
}

// Scalar chart fields the survivor inherits when ITS OWN value is empty. The
// winner's populated values are never overwritten.
const FILL_EMPTY_FIELDS = [
  "date_of_birth", "medical_record_number", "phone", "email", "address",
  "primary_diagnosis", "allergies", "physician_name", "physician_phone",
  "emergency_contact_name", "emergency_contact_phone", "emergency_contact_relationship",
  "insurance_primary", "insurance_secondary", "care_type", "admission_date",
  "advance_directives", "baseline_vitals", "functional_status",
];
// Array fields that are UNIONED (dedupe by JSON identity).
const UNION_ARRAY_FIELDS = ["secondary_diagnoses", "current_medications", "past_medical_history", "wounds"];

const isEmpty = (v) =>
  v === undefined || v === null || (typeof v === "string" && v.trim() === "") ||
  (Array.isArray(v) && v.length === 0) ||
  (typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === 0);

/**
 * Pure: compute the patch of loser fields the winner should inherit.
 * Exported for unit tests.
 */
export function buildFieldMergePatch(winner, loser) {
  const patch = {};
  if (!winner || !loser) return patch;
  for (const field of FILL_EMPTY_FIELDS) {
    if (isEmpty(winner[field]) && !isEmpty(loser[field])) patch[field] = loser[field];
  }
  for (const field of UNION_ARRAY_FIELDS) {
    const w = Array.isArray(winner[field]) ? winner[field] : [];
    const l = Array.isArray(loser[field]) ? loser[field] : [];
    if (!l.length) continue;
    const seen = new Set(w.map((x) => JSON.stringify(x)));
    const merged = [...w];
    for (const item of l) {
      const key = JSON.stringify(item);
      if (!seen.has(key)) {
        seen.add(key);
        merged.push(item);
      }
    }
    if (merged.length > w.length) patch[field] = merged;
  }
  // Notes history: concatenate, deduped by entry_id, ordered oldest→newest.
  const wHist = Array.isArray(winner.enhanced_notes_history) ? winner.enhanced_notes_history : [];
  const lHist = Array.isArray(loser.enhanced_notes_history) ? loser.enhanced_notes_history : [];
  if (lHist.length) {
    const seenIds = new Set(wHist.map((e) => e?.entry_id).filter(Boolean));
    const additions = lHist.filter((e) => !e?.entry_id || !seenIds.has(e.entry_id));
    if (additions.length) {
      patch.enhanced_notes_history = [...wHist, ...additions].sort((a, b) =>
        String(a?.timestamp || a?.date || "").localeCompare(String(b?.timestamp || b?.date || "")),
      );
    }
  }
  return patch;
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
