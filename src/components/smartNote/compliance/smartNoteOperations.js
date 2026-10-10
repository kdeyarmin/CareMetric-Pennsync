import { base44 } from '@/api/base44Client';

// Each operation names its backend function as a string literal so the route is
// statically reviewable; the client-boundary scan in
// base44/functionTests/patientCareTeamAssignmentContract.test.js refuses a
// computed function target anywhere in production source.
async function requestNoteOperation(invoke) {
  try {
    const response = await invoke();
    return response.data;
  } catch (error) {
    // A failed response can follow a billed request. Never automatically replay it.
    error.retryable = false;
    throw error;
  }
}
export const requestSmartNoteDraft = payload =>
  requestNoteOperation(() => base44.functions.invoke('draftSmartNote', payload));
export const requestSmartNoteGrounding = payload =>
  requestNoteOperation(() => base44.functions.invoke('checkSmartNoteGrounding', payload));
export const requestSmartNoteCoverage = payload =>
  requestNoteOperation(() => base44.functions.invoke('checkSmartNoteCoverage', payload));
