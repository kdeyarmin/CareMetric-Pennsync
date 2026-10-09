import { base44 } from '@/api/base44Client';

async function requestNoteOperation(name, payload) {
  try {
    const response = await base44.functions.invoke(name, payload);
    return response.data;
  } catch (error) {
    // A failed response can follow a billed request. Never automatically replay it.
    error.retryable = false;
    throw error;
  }
}
export const requestSmartNoteDraft = payload => requestNoteOperation('draftSmartNote', payload);
export const requestSmartNoteGrounding = payload => requestNoteOperation('checkSmartNoteGrounding', payload);
export const requestSmartNoteCoverage = payload => requestNoteOperation('checkSmartNoteCoverage', payload);