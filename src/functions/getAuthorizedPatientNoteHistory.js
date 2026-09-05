import { base44 } from '@/api/base44Client';

/**
 * Read the server-authorized append-only note projection. Direct reads of the
 * service-only PatientNoteHistoryEntry entity are intentionally impossible.
 * This bounded helper returns one page; full-history exports must paginate and
 * reconcile revisions across every page on the server.
 */
export async function getAuthorizedPatientNoteHistory({
  patientId,
  eventLimit = 200,
  offset = 0,
} = {}) {
  if (typeof patientId !== 'string' || !patientId.trim()) {
    throw new Error('patientId is required');
  }
  if (!Number.isSafeInteger(eventLimit) || eventLimit < 1 || eventLimit > 500) {
    throw new Error('eventLimit must be an integer between 1 and 500');
  }
  if (!Number.isSafeInteger(offset) || offset < 0) {
    throw new Error('offset must be a non-negative integer');
  }
  const response = await base44.functions.invoke('getAuthorizedPatientNoteHistory', {
    patient_id: patientId,
    event_limit: eventLimit,
    offset,
  });
  const result = response?.data ?? response;
  if (
    result?.success !== true
    || result.patient_id !== patientId
    || !Array.isArray(result.entries)
  ) {
    throw new Error(result?.error || 'Patient note history lookup failed');
  }
  return result;
}
