import { base44 } from '@/api/base44Client';

// Post-visit AI processing for one completed visit. The server reads and writes
// the Visit only through updateAuthorizedVisit, which admits the visit's own
// clinician with chart access; it answers already_processed on a repeat.
export const processCompletedVisit = (payload = {}) =>
  base44.functions.invoke('processCompletedVisit', payload);
