import { base44 } from "@/api/base44Client";
import { logActivity, ActivityActions } from "@/components/utils/activityLogger";
import { toNoteConversionFields, deriveStructuredVisitFields } from "@/components/smartNote/compliance/coverageScore";
import { buildVisitReportingFields, buildAuditFields } from "@/components/smartNote/compliance/reportingFields";
import { toast } from "sonner";

/**
 * persistVisitNote — create-or-update the chart records from a ConstrainedNoteReviewer
 * save-ready result, with a deterministic coverage score and structured vitals.
 *
 * Extracted from SmartNoteAssistant so both visit-documentation methods — the
 * Smart Note flow and the Visit Scribe (audio) flow — share one identical chart
 * write path (Visit + Patient history + NoteConversion + ComplianceAudit, with an
 * offline-queue fallback). Keeping it in one place means the two flows can't drift
 * on compliance fields, audit creation, or the offline payload shape.
 *
 * Side effects are limited to base44 writes + a success toast + an activity log.
 * Host-specific follow-up (state updates, follow-up-task / supply analysis) is
 * driven by the returned value so each caller keeps its own UI concerns.
 *
 * @returns {Promise<null | {
 *   mode: 'offline' | 'update' | 'create',
 *   visitId: string | null,
 *   auditId: string | null,
 *   finalText: string,
 *   coverageScore: number,
 * }>} null when the inputs are insufficient to save.
 */
export async function persistVisitNote({
  result,
  patientId,
  visitDate,
  visitType,
  roughNote = "",
  vitals = {},
  currentUser,
  patientDiagnosis = "",
  savedVisitId = null,
  savedAuditId = null,
  existingVisitId = null,
}) {
  if (!result || !patientId || !currentUser?.email) return null;
  const {
    finalNote: finalText, coverageScore, draftScore, presence,
    answeredIds, confirmedNegativeIds, answers, chartFindings = [], sustainedTrends = [],
  } = result;
  const structured = deriveStructuredVisitFields(presence, { answeredIds, confirmedNegativeIds, textById: answers });
  // Surface the deterministic chart conflicts + trends in the saved records so
  // they reach the compliance dashboards, not just the live review UI.
  const reportingFields = buildVisitReportingFields({ chartFindings, sustainedTrends });
  // When a critical chart conflict was knowingly accepted, stamp who/when onto the
  // override trail. Gate on `acknowledged` (not the object's mere presence): the
  // reviewer builds it whenever critical findings exist, even before the nurse
  // checks the box, so persisting it unconditionally could stamp a false ack trail.
  const acknowledgment = result.acknowledgment?.acknowledged
    ? { acknowledged_by: currentUser.email, acknowledged_at: new Date().toISOString(), justification: result.acknowledgment.justification, finding_ids: result.acknowledgment.finding_ids }
    : null;
  const auditFields = buildAuditFields({ coverageScore, chartFindings, acknowledgment });

  if (!navigator.onLine) {
    const { addToSyncQueue } = await import('@/lib/indexedDB');
    // Stable client-generated idempotency key so the offline-sync drain can dedupe.
    // crypto.randomUUID is only defined in secure contexts; fall back so the offline
    // save (the whole point of this branch) never throws in the field.
    const clientRequestId = (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    await addToSyncQueue('CREATE_VISIT', { client_request_id: clientRequestId, patient_id: patientId, visit_date: visitDate, visit_type: visitType, status: "completed", nurse_notes: finalText, raw_transcription: roughNote, compliance_score: coverageScore, vital_signs: vitals, ...structured, ...reportingFields, __audit: { nurse_email: currentUser.email, ...auditFields } });
    toast.success("Saved offline. Will sync when reconnected.");
    logActivity(ActivityActions.NOTE_ENHANCED, { patient_id: patientId, visit_type: visitType, overall_score: coverageScore });
    return { mode: 'offline', visitId: null, auditId: null, finalText, coverageScore };
  }

  // Re-save after an edit → update the same visit, never duplicate. Also keep the
  // appended enhanced_notes_history entry in sync, since getPriorNote() prefers it
  // for the next note's carry-forward pre-fill.
  if (savedVisitId) {
    const currentPatient = await base44.entities.Patient.get(patientId);
    const history = currentPatient.enhanced_notes_history || [];
    if (history.length) {
      history[history.length - 1] = { ...history[history.length - 1], note: finalText, compliance_score: coverageScore };
    }
    await Promise.all([
      base44.entities.Visit.update(savedVisitId, { nurse_notes: finalText, compliance_score: coverageScore, vital_signs: vitals, ...structured, ...reportingFields }),
      base44.entities.Patient.update(patientId, { clinical_notes: finalText, enhanced_notes_history: history }),
      // Keep the audit in step with the edit — a re-save that resolves a conflict
      // must clear the stale `critical` status/issues, not leave them behind.
      ...(savedAuditId ? [base44.entities.ComplianceAudit.update(savedAuditId, auditFields)] : []),
    ]);
    toast.success("Chart updated.");
    return { mode: 'update', visitId: savedVisitId, auditId: savedAuditId, finalText, coverageScore };
  }

  // First documentation of this visit. When an existingVisitId was provided (e.g.
  // documenting a scheduled/overdue visit deep-linked from a compliance alert or
  // the patient's visit list), COMPLETE that visit in place instead of creating a
  // duplicate — so the original visit closes and stops triggering overdue alerts.
  // A brand-new visit is created only when no existing one was given.
  const visitFields = {
    patient_id: patientId, visit_date: visitDate, visit_type: visitType,
    status: "completed", nurse_notes: finalText, raw_transcription: roughNote,
    compliance_score: coverageScore, vital_signs: vitals, ...structured, ...reportingFields,
  };
  const visit = existingVisitId
    ? (await base44.entities.Visit.update(existingVisitId, visitFields), { id: existingVisitId })
    : await base44.entities.Visit.create(visitFields);

  const currentPatient = await base44.entities.Patient.get(patientId);
  const enhancedHistory = currentPatient.enhanced_notes_history || [];
  enhancedHistory.push({
    date: visitDate, visit_type: visitType, note: finalText,
    compliance_score: coverageScore, created_by: currentUser.email,
    created_at: new Date().toISOString(),
  });

  const [, , audit] = await Promise.all([
    base44.entities.Patient.update(patientId, { enhanced_notes_history: enhancedHistory, clinical_notes: finalText }),
    base44.entities.NoteConversion.create(toNoteConversionFields({
      coverageScore, draftPresenceScore: draftScore,
      roughLen: roughNote.length, enhancedLen: finalText.length,
      visitType, diagnosis: patientDiagnosis || "",
      nurseEmail: currentUser.email, patientId,
    })),
    base44.entities.ComplianceAudit.create({
      visit_id: visit.id, nurse_email: currentUser.email, patient_id: patientId,
      audit_date: new Date().toISOString(), audit_type: "automated",
      ...auditFields,
    }),
  ]);
  toast.success("Saved to the patient's chart.");
  logActivity(ActivityActions.NOTE_ENHANCED, { patient_id: patientId, visit_type: visitType, overall_score: coverageScore });
  return { mode: 'create', visitId: visit.id, auditId: audit?.id || null, finalText, coverageScore };
}
