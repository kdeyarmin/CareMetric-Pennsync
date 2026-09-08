import { base44 } from "@/api/base44Client";
import { logActivity, ActivityActions } from "@/components/utils/activityLogger";
import { toNoteConversionFields, deriveStructuredVisitFields } from "@/components/smartNote/compliance/coverageScore";
import { buildVisitReportingFields, buildAuditFields } from "@/components/smartNote/compliance/reportingFields";
import { toast } from "sonner";
import { createAuthorizedVisit } from '@/functions/createAuthorizedVisit';
import { saveVisitDocumentation } from '@/functions/updateAuthorizedVisit';

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

/** A component-owned save receipt. It is never persisted to browser storage. */
export function createVisitSaveProgress() {
  return { clientRequestId: crypto.randomUUID() };
}

export class PartialVisitSaveError extends Error {
  constructor(progress, pendingRecords) {
    super(pendingRecords.includes('documentation')
      ? "The visit exists, but your latest changes could not be confirmed. Your draft is still here. Retry to finish saving the same visit."
      : "The visit is saved, but some supporting records could not be confirmed. Your draft is still here. Retry to check their status; unconfirmed records will not be created again.");
    this.name = "PartialVisitSaveError";
    this.code = "VISIT_SUPPORTING_RECORDS_UNCONFIRMED";
    this.visitId = progress.visitId;
    this.auditId = progress.auditId || null;
    this.pendingRecords = pendingRecords;
  }
}

const SUPPORTING_RECOVERY_ROW_LIMIT = 2;

function sameSupportingValue(actual, expected) {
  if (actual === expected) return true;
  if (!actual || !expected || typeof actual !== 'object' || typeof expected !== 'object') return false;
  if (Array.isArray(actual) !== Array.isArray(expected)) return false;
  const keys = Object.keys(expected);
  return Object.keys(actual).length === keys.length
    && keys.every((key) => Object.hasOwn(actual, key) && sameSupportingValue(actual[key], expected[key]));
}

function supportingCreateReceipt(fields, creatorEmail, key = null) {
  // Retain the exact JSON body even if the nurse edits the draft during recovery.
  return { fields: JSON.parse(JSON.stringify(fields)), creatorEmail, key, attempted: false };
}

function requireMatchingSupportingRecord(row, receipt) {
  if (
    !row || typeof row !== 'object' || Array.isArray(row)
    || typeof row.id !== 'string' || !row.id || row.id.length > 200
    || row.id.trim() !== row.id || row.id.startsWith('$')
    || row.created_by !== receipt.creatorEmail
    || !Object.entries(receipt.fields).every(([key, value]) => sameSupportingValue(row[key], value))
  ) {
    throw new Error('Supporting record confirmation did not match this save');
  }
  return row;
}

async function confirmSupportingCreate(receipt, create, find) {
  if (!receipt.attempted) {
    // The entity API has no documented unique constraint. Mark BEFORE dispatch:
    // a rejected or malformed response never permits a second create attempt.
    receipt.attempted = true;
    return requireMatchingSupportingRecord(await create(receipt.fields), receipt);
  }
  const rows = await find({
    recovery_request_id: receipt.fields.recovery_request_id,
    created_by: receipt.creatorEmail,
    nurse_email: receipt.fields.nurse_email,
    patient_id: receipt.fields.patient_id,
    ...(receipt.fields.visit_id ? { visit_id: receipt.fields.visit_id } : {}),
  });
  // An empty/eventually-consistent result is not proof that the write failed.
  // Keep the draft partial until exactly one original row can be confirmed.
  if (!Array.isArray(rows) || rows.length !== 1) {
    throw new Error('Supporting record creation remains unconfirmed');
  }
  return requireMatchingSupportingRecord(rows[0], receipt);
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
export async function persistVisitNote(args) {
  const progress = args.saveProgress || createVisitSaveProgress();
  // Validate the receipt before the partial-save catch. A caller in another
  // context must never receive an old Visit id or advice to retry that Visit.
  const binding = JSON.stringify([
    args.currentUser?.id || null, args.currentUser?.email, args.patientId, args.source || 'smart_note',
  ]);
  if (progress.binding && progress.binding !== binding) {
    throw Object.assign(new Error("This save belongs to another patient or account. Reopen the note."), { code: 'VISIT_SAVE_CONTEXT_CHANGED' });
  }
  const knownVisitId = args.savedVisitId || args.existingVisitId;
  if (knownVisitId && progress.visitId && knownVisitId !== progress.visitId) {
    throw Object.assign(new Error("This save belongs to another visit. Reopen the note."), { code: 'VISIT_SAVE_CONTEXT_CHANGED' });
  }
  if (progress.inFlight) throw new Error("This note is already being saved.");
  progress.binding = binding;
  progress.inFlight = true;
  try {
    return await persistVisitNoteWithProgress(args, progress);
  } catch (error) {
    if (progress.visitId && !(error instanceof PartialVisitSaveError) && !(error instanceof OfflineSaveError)) {
      throw new PartialVisitSaveError(progress, ['documentation']);
    }
    throw error;
  } finally {
    progress.inFlight = false;
  }
}

async function persistVisitNoteWithProgress({
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
}, progress) {
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

  // A rejected response is not proof the create failed. Retain its exact body
  // and request id until the broker returns the canonical Visit. A nurse may
  // edit the draft during recovery; apply those edits only after reconciling
  // the original create, never by submitting a second creation identity.
  progress.mode ||= savedVisitId ? 'update' : 'create';
  // Preserve the initial completion intent until the mutation is confirmed,
  // including retries that already know the newly created Visit identity.
  progress.completionPending ??= progress.mode === 'create' && !progress.completed;
  const mode = progress.completed ? 'update' : progress.mode;
  progress.visitId ||= savedVisitId || null;
  progress.auditId ||= savedAuditId || null;
  const documentationFields = {
    nurse_notes: finalText,
    raw_transcription: roughNote,
    documentation_source: source,
    compliance_score: coverageScore,
    vital_signs: vitals,
    grounding_pending: false,
    ...structured,
    ...reportingFields,
  };
  const documentationKey = JSON.stringify(documentationFields);

  if (!progress.visitId) {
    if (existingVisitId) {
      progress.visitId = existingVisitId;
      progress.visitDate = visitDate;
      progress.visitType = visitType;
    } else {
      if (!progress.pendingCreate) {
        progress.pendingCreate = structuredClone({
          fields: {
            patient_id: patientId,
            visit_date: visitDate,
            visit_type: visitType,
            status: 'scheduled',
            client_request_id: progress.clientRequestId,
          },
        });
      }
      const { visit } = await createAuthorizedVisit(progress.pendingCreate.fields);
      // Record the confirmed identity before any subsequent asynchronous write.
      progress.visitId = visit.id;
      // Creation is scheduling-only. The mutation below writes the note and
      // completes the Visit; its pending flag survives a rejected response.
      progress.documentationKey = null;
      progress.visitDate = progress.pendingCreate.fields.visit_date;
      progress.visitType = progress.pendingCreate.fields.visit_type;
      progress.pendingCreate = null;
    }
  }

  // Skip an already confirmed revision on an unchanged retry. Changed note
  // content is saved to the same Visit before history and audit are refreshed.
  if (progress.completionPending || progress.documentationKey !== documentationKey) {
    await saveVisitDocumentation({
      visitId: progress.visitId,
      patientId,
      fields: {
        ...documentationFields,
        ...(progress.completionPending ? { status: 'completed' } : {}),
      },
    });
    progress.completionPending = false;
    progress.documentationKey = documentationKey;
  }

  const followUps = [];
  if (progress.historyKey !== documentationKey) {
    followUps.push({
      name: 'history',
      run: async () => {
        await base44.functions.invoke('appendPatientNoteHistory', {
          patient_id: patientId,
          mode: mode === 'create' ? 'append' : 'update',
          clinical_notes: finalText,
          entry: {
            visit_id: progress.visitId,
            ...(mode === 'create' ? {
              date: progress.visitDate || visitDate,
              visit_type: progress.visitType || visitType,
            } : {}),
            note: finalText,
            compliance_score: coverageScore,
          },
        });
        progress.historyKey = documentationKey;
      },
    });
  }
  if (progress.mode === 'create' && !progress.noteConversionSaved) {
    followUps.push({
      name: 'conversion',
      run: async () => {
        progress.pendingNoteConversion ||= supportingCreateReceipt({
          ...noteConversionFields,
          nurse_email: currentUser.email,
          patient_id: patientId,
          recovery_request_id: JSON.stringify([
            'visit-note-conversion-v1', progress.clientRequestId,
            currentUser.id || null, currentUser.email, patientId, progress.visitId,
          ]),
        }, currentUser.email);
        await confirmSupportingCreate(
          progress.pendingNoteConversion,
          (fields) => base44.entities.NoteConversion.create(fields),
          (query) => base44.entities.NoteConversion.filter(query, '-created_date', SUPPORTING_RECOVERY_ROW_LIMIT),
        );
        progress.noteConversionSaved = true;
        progress.pendingNoteConversion = null;
      },
    });
  }
  const auditKey = JSON.stringify(auditFields);
  if (progress.auditKey !== auditKey) {
    followUps.push({
      name: 'audit',
      run: async () => {
        if (!progress.auditId) {
          progress.pendingAudit ||= supportingCreateReceipt({
            visit_id: progress.visitId, nurse_email: currentUser.email, patient_id: patientId,
            audit_date: new Date().toISOString(), audit_type: "automated",
            ...auditFields,
            recovery_request_id: JSON.stringify([
              'visit-compliance-audit-v1', progress.clientRequestId,
              currentUser.id || null, currentUser.email, patientId, progress.visitId,
            ]),
          }, currentUser.email, auditKey);
          const audit = await confirmSupportingCreate(
            progress.pendingAudit,
            (fields) => base44.entities.ComplianceAudit.create(fields),
            (query) => base44.entities.ComplianceAudit.filter(query, '-created_date', SUPPORTING_RECOVERY_ROW_LIMIT),
          );
          progress.auditId = audit.id;
          progress.auditKey = progress.pendingAudit.key;
          progress.pendingAudit = null;
        }
        if (progress.auditKey !== auditKey) {
          await base44.entities.ComplianceAudit.update(progress.auditId, auditFields);
        }
        progress.auditKey = auditKey;
      },
    });
  }

  // Wait for every outcome before offering Retry. Promise.all would reject as
  // soon as one operation failed and lose confirmations still in flight.
  const outcomes = await Promise.allSettled(followUps.map(({ run }) => run()));
  const pendingRecords = followUps
    .filter((_, index) => outcomes[index].status === 'rejected')
    .map(({ name }) => name);
  if (pendingRecords.length) throw new PartialVisitSaveError(progress, pendingRecords);

  progress.completed = true;
  toast.success(mode === 'create' ? "Saved to the patient's chart." : "Chart updated.");
  if (mode === 'create') {
    logActivity(ActivityActions.NOTE_ENHANCED, { patient_id: patientId, visit_type: visitType, overall_score: coverageScore });
  }
  return {
    mode, visitId: progress.visitId, auditId: progress.auditId,
    finalText, coverageScore,
  };
}
