import { base44 } from '@/api/base44Client';

// Thin client wrapper around the hosted `expandClinicalPhrase` Deno function
// (base44/functions/expandClinicalPhrase/entry.ts). Given a phrase trigger and an
// optional patient, it returns the full Medicare-compliant expansion:
//   { expandedText, source: 'template' | 'patient_specific_template' | 'ai_generated', template }
// The backend also increments the template's usage_count.
export const expandClinicalPhrase = (payload = {}) =>
  base44.functions.invoke('expandClinicalPhrase', payload);
