// Shared patient-merge boundary. Patient merges are intentionally paused until
// a protected server broker can move every linked clinical record atomically.
// A browser must not archive a duplicate while service-only OASIS/outcome rows
// still point to it.

// A future broker must move every entity that references a patient via
// `patient_id`; otherwise records stay attached to an archived duplicate and
// disappear from the survivor's chart. Keep the two lists pinned against entity
// schemas so the broker's required scope stays explicit while browser execution
// remains disabled.
/**
 * Entities whose writes are service-role-only and therefore cannot be
 * reassigned with a direct browser entity update.
 */
export const SERVER_MERGE_REQUIRED_ENTITIES = [
  "OASISAssessment",
  "PatientNoteHistoryEntry",
  "PatientOutcomeMetric",
];

export const PATIENT_MERGES_PAUSED = true;
export const PATIENT_MERGE_PAUSED_MESSAGE =
  "Patient duplicate scanning and merging are temporarily unavailable pending an authorized, atomic server broker.";

export const PATIENT_RELATED_ENTITIES = [
  "AdrAuditCase", "AppliedDataLog", "AppointmentForm", "Billing", "CallLog",
  "CareCoordinationAlert", "CarePlan", "CarePlanProposal", "ClinicalEvent",
  "ClinicalLibraryTemplate", "ComplianceAudit", "DigitalSignature",
  "DischargeSummary", "Document", "DocumentAnalysisHistory", "DocumentPackage",
  "DocumentRecord", "DocumentSignature", "FaceToFaceEncounter", "FaxDraft",
  "FaxHistory", "FaxLog", "GeneratedDocument", "HealthRecord", "Immunization",
  "Incident", "InterventionLog", "Invoice", "MaterialInteraction", "MedicalCode",
  "Medication", "MedicationReconciliation", "Message", "NoteConversion",
  "NoteFeedback", "OASISAudit", "OASISFeedback",
  "OASISScenario", "OASISUpload", "OASISWorkflowExecution", "PDFIndex",
  "PDGMCaseMix", "PatientAlert", "PatientBillingInfo", "PatientDocument",
  "PatientEducationAssignment", "PatientEducationDelivery",
  "PatientEducationDraft", "PatientEducationEngagement", "PatientMessage",
  "PatientOutcome", "PatientPathwayAssignment",
  "PatientRecommendation", "PatientRiskAssessment", "Payment", "PaymentRecord",
  "PendingPatientUpdate", "ProviderPatientAssignment", "Referral", "RiskAlert",
  "RiskAnalysis", "ScheduledFax", "ScheduledSms", "SentEducationMaterial",
  "SmsConsent", "SmsMessage", "SuggestedIntervention", "SupplyPrediction",
  "SupplyUsageLog", "Task", "TeamMessage", "TeamNote", "TelehealthSession",
  "TimeSavings", "TrainingRecommendation", "Visit",
];

/**
 * Fail-closed browser boundary for merging one duplicate patient.
 *
 * OASISAssessment and PatientOutcomeMetric are service-write-only. The browser
 * cannot prove that a duplicate has no such rows and cannot reassign them in the
 * same transaction as all other chart data. Archiving anyway would strand
 * clinical history and break later tenant-scoped episode computations. Keep
 * this operation unavailable until a server-owned tenant/patient authorization
 * source and transactional merge broker exist.
 *
 * @param {string} primaryId    surviving patient id
 * @param {string} duplicateId  patient id that would be merged
 * @returns {Promise<never>}
 */
export async function mergePatientInto(primaryId, duplicateId) {
  if (!primaryId || !duplicateId) {
    throw new Error("mergePatientInto requires a primary and a duplicate id");
  }
  if (primaryId === duplicateId) {
    throw new Error("Cannot merge a patient into itself");
  }
  throw new Error(PATIENT_MERGE_PAUSED_MESSAGE);
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
 * Fail-closed group boundary. The first real duplicate reaches
 * mergePatientInto and is rejected before any client data access or mutation.
 *
 * @param {string} keepId          surviving patient id
 * @param {string[]} duplicateIds  ids to merge into the survivor
 * @returns {Promise<{ patientsMerged: number, reassigned: Record<string, number> }>}
 */
export async function mergePatientGroup(keepId, duplicateIds = []) {
  if (!keepId) throw new Error("mergePatientGroup requires a survivor id");

  let patientsMerged = 0;
  const reassigned = {};
  for (const dupId of duplicateIds) {
    if (!dupId || dupId === keepId) continue;
    const { reassigned: moved } = await mergePatientInto(keepId, dupId);
    patientsMerged += 1;
    for (const [entity, count] of Object.entries(moved)) {
      reassigned[entity] = (reassigned[entity] || 0) + count;
    }
  }
  return { patientsMerged, reassigned };
}
