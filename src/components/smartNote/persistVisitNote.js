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
  source = "smart_note",
}) {
  if (!result || !patientId || !currentUser?.email) return null;
  const {
    finalNote: finalText, coverageScore, draftScore, presence,
    answeredIds, confirmedNegativeIds, answers, chartFindings = [], sustainedTrends = [],
    appliedRules = [],
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
  const auditFields = buildAuditFields({ coverageScore, chartFindings, acknowledgment, appliedRules });

  if (!navigator.onLine) {
    const { addToSyncQueue } = await import('@/lib/indexedDB');
    // Offline save → the AI grounding pass was deferred. Mark the queued visit so
    // the record shows live grounding hadn't run yet, and surface the audit as
    // "pending_review" (rather than the coverage-derived passed/flagged) so a
    // deferred-grounding note isn't read as fully verified in compliance reporting.
    const visitFields = {
      patient_id: patientId, visit_date: visitDate, visit_type: visitType,
      status: "completed", nurse_notes: finalText, raw_transcription: roughNote,
      compliance_score: coverageScore, vital_signs: vitals, documentation_source: source,
      grounding_pending: true, ...structured, ...reportingFields,
    };
    const audit = { nurse_email: currentUser.email, ...auditFields, status: "pending_review" };

    // A visit that already exists server-side (a same-session online save, or a
    // deep-linked scheduled visit) must be UPDATED on reconnect, not re-created —
    // otherwise the drain creates a duplicate and (for a scheduled visit) leaves
    // the original open/overdue.
    const targetVisitId = savedVisitId || existingVisitId;
    if (targetVisitId) {
      await addToSyncQueue('UPDATE_VISIT', { visit_id: targetVisitId, ...visitFields, __audit: audit });
      toast.success("Saved offline. Will sync when reconnected.");
      logActivity(ActivityActions.NOTE_ENHANCED, { patient_id: patientId, visit_type: visitType, overall_score: coverageScore });
      return { mode: 'offline', visitId: targetVisitId, auditId: savedAuditId || null, finalText, coverageScore };
    }

    // First save of a brand-new visit while offline. Each offline save is queued
    // independently — we deliberately do NOT drop prior queued CREATE_VISITs for the
    // same patient+date: two genuinely distinct same-day visits share that key, and
    // dropping one would lose a clinical note. A re-save while still offline can thus
    // create a duplicate visit on drain, which is recoverable (merge) — the safer
    // trade than unrecoverable data loss. A precise re-save collapse would need a
    // stable per-edit id threaded from the caller.
    // Stable client-generated idempotency key so a retried DRAIN stays idempotent.
    // crypto.randomUUID is only defined in secure contexts; fall back so the offline
    // save (the whole point of this branch) never throws in the field.
    const clientRequestId = (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    await addToSyncQueue('CREATE_VISIT', { client_request_id: clientRequestId, ...visitFields, __audit: audit });
    toast.success("Saved offline. Will sync when reconnected.");
    logActivity(ActivityActions.NOTE_ENHANCED, { patient_id: patientId, visit_type: visitType, overall_score: coverageScore });
    return { mode: 'offline', visitId: null, auditId: null, finalText, coverageScore };
  }

  // Re-save after an edit → update the same visit, never duplicate. Also keep the
  // appended enhanced_notes_history entry in sync, since getPriorNote() prefers it
  // for the next note's carry-forward pre-fill. History writes go through the
  // appendPatientNoteHistory backend function: a browser-side read-modify-write
  // of the array lost entries when two saves for the same patient raced, and it
  // targeted "the last entry" — which may meanwhile be a COLLEAGUE's newer note.
  // The function serializes the write server-side (verify-and-retry) and targets
  // this visit's entry by visit_id.
  if (savedVisitId) {
    await Promise.all([
      base44.entities.Visit.update(savedVisitId, { nurse_notes: finalText, compliance_score: coverageScore, vital_signs: vitals, grounding_pending: false, ...structured, ...reportingFields }),
      base44.functions.invoke('appendPatientNoteHistory', {
        patient_id: patientId, mode: 'update', clinical_notes: finalText,
        entry: { visit_id: savedVisitId, note: finalText, compliance_score: coverageScore },
      }),
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
    compliance_score: coverageScore, vital_signs: vitals, documentation_source: source,
    // Online save → grounding ran and passed (save is gated on a passing recheck).
    grounding_pending: false,
    ...structured, ...reportingFields,
  };
  const visit = existingVisitId
    ? (await base44.entities.Visit.update(existingVisitId, visitFields), { id: existingVisitId })
    : await base44.entities.Visit.create(visitFields);

  // Atomic-append the history entry server-side (see the re-save comment above);
  // created_by/created_at are stamped by the function from the caller's session.
  const [, , audit] = await Promise.all([
    base44.functions.invoke('appendPatientNoteHistory', {
      patient_id: patientId, mode: 'append', clinical_notes: finalText,
      entry: { visit_id: visit.id, date: visitDate, visit_type: visitType, note: finalText, compliance_score: coverageScore },
    }),
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
