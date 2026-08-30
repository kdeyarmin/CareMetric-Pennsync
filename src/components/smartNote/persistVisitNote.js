import { base44 } from "@/api/base44Client";
import { logActivity, ActivityActions } from "@/components/utils/activityLogger";
import { toNoteConversionFields, deriveStructuredVisitFields } from "@/components/smartNote/compliance/coverageScore";
import { buildVisitReportingFields, buildAuditFields } from "@/components/smartNote/compliance/reportingFields";
import { toast } from "sonner";

/**
 * Thrown when a save is attempted with no network. Its own type (rather than a
 * bare Error) so callers can tell "you are offline" apart from a server refusal
 * and keep the composed note on screen instead of reporting it as failed.
 */
export class OfflineSaveError extends Error {
  constructor(message = "You're offline. Reconnect to save this note to the chart — your text is still here.") {
    super(message);
    this.name = "OfflineSaveError";
    this.code = "OFFLINE_SAVE_BLOCKED";
  }
}

/**
 * persistVisitNote — create-or-update the chart records from a ConstrainedNoteReviewer
 * save-ready result, with a deterministic coverage score and structured vitals.
 *
 * Extracted from SmartNoteAssistant so both visit-documentation methods — the
 * Smart Note flow and the Visit Scribe (audio) flow — share one identical chart
 * write path (Visit + Patient history + NoteConversion + ComplianceAudit).
 * Keeping it in one place means the two flows can't drift on compliance fields
 * or audit creation.
 *
 * Side effects are limited to base44 writes + a success toast + an activity log.
 * Host-specific follow-up (state updates, follow-up-task / supply analysis) is
 * driven by the returned value so each caller keeps its own UI concerns.
 *
 * Requires a connection: the app no longer queues clinical writes locally, so a
 * save attempted with no network throws `OfflineSaveError` and the caller keeps
 * the nurse's text on screen to retry. Never silently discards a note.
 *
 * @returns {Promise<null | {
 *   mode: 'update' | 'create',
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
  // Optional facility-doc override trail (critical unmet FacilityDocumentationRule
  // acknowledged by the nurse). Merged into ComplianceAudit.acknowledgment with
  // namespaced facility:<rule> finding ids, same shape as chart/denial acks.
  facilityAcknowledgment = null,
}) {
  if (!result || !patientId || !currentUser?.email) return null;
  const {
    finalNote: finalText, coverageScore, draftScore, presence,
    answeredIds, confirmedNegativeIds, answers, chartFindings = [], sustainedTrends = [],
    appliedRules = [], denialGuardrail = null,
  } = result;
  const denialFindings = denialGuardrail?.findings || [];
  // The guardrail findings make homebound_status_verified /
  // skilled_intervention_documented quality-aware: a narrative the guardrail
  // failed no longer persists as "verified" to the compliance dashboards.
  const structured = deriveStructuredVisitFields(presence, {
    answeredIds, confirmedNegativeIds, textById: answers, denialFindings,
  });
  // Surface the deterministic chart conflicts + trends + denial-guardrail
  // findings in the saved records so they reach the compliance dashboards, not
  // just the live review UI.
  const reportingFields = buildVisitReportingFields({ chartFindings, sustainedTrends, denialFindings });
  // When a critical chart conflict — or a blocking denial-guardrail finding —
  // was knowingly accepted, stamp who/when onto the override trail. Gate on
  // `acknowledged` (not the object's mere presence): the reviewer builds these
  // whenever critical findings exist, even before the nurse checks the box, so
  // persisting them unconditionally could stamp a false ack trail. Both trails
  // share the ComplianceAudit.acknowledgment field (denial findings carry
  // namespaced `denial:<cluster>` ids, so the sources stay distinguishable).
  // Facility critical-doc overrides use the same field with `facility:<rule>` ids.
  const facilityAckSource = facilityAcknowledgment?.acknowledged
    ? {
        acknowledged: true,
        justification: facilityAcknowledgment.justification
          || (Array.isArray(facilityAcknowledgment.unmet_requirements) && facilityAcknowledgment.unmet_requirements.length
            ? `Facility documentation override: ${facilityAcknowledgment.unmet_requirements.join(", ")}`
            : "Facility documentation requirement acknowledged as unmet"),
        finding_ids: (facilityAcknowledgment.unmet_requirements || []).map((r) => `facility:${r}`),
      }
    : null;
  const ackSources = [result.acknowledgment, result.denialAcknowledgment, facilityAckSource].filter((a) => a?.acknowledged);
  const acknowledgment = ackSources.length
    ? {
        acknowledged_by: currentUser.email,
        acknowledged_at: new Date().toISOString(),
        justification: ackSources.map((a) => a.justification).filter(Boolean).join(" | "),
        finding_ids: ackSources.flatMap((a) => a.finding_ids || []),
      }
    : null;
  const auditFields = buildAuditFields({ coverageScore, chartFindings, acknowledgment, appliedRules, denialFindings });
  const noteConversionFields = toNoteConversionFields({
    coverageScore, draftPresenceScore: draftScore,
    roughLen: roughNote.length, enhancedLen: finalText.length,
    visitType, diagnosis: patientDiagnosis || "",
    nurseEmail: currentUser.email, patientId,
  });

  // Offline mode was removed: there is no local queue to fall back on. Refuse
  // BEFORE any write so a half-saved chart can't result, and let the caller keep
  // the composed note on screen for the nurse to retry once reconnected.
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    throw new OfflineSaveError();
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
    // Grounding ran and passed (save is gated on a passing recheck).
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
    base44.entities.NoteConversion.create(noteConversionFields),
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
