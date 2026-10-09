import { base44 } from '@/api/base44Client';
import protectedAiRequest from '@/lib/protectedAiRequest';

// The server owns the visit-type templates and names the clinician from the
// authenticated caller; the browser sends only the transcript and visit type.
export const structureDictatedVisit = payload =>
  protectedAiRequest(() => base44.functions.invoke('structureDictatedVisit', payload), 45000)
    .then(data => data.note);
