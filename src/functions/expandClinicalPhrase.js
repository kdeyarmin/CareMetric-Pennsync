import { base44 } from '@/api/base44Client';

// Expand a clinical quick-phrase into compliant narrative text. Prefers an
// agency ClinicalLibraryTemplate; otherwise AI-generates the expansion. Used by
// the note editor's quick-phrase menu (src/components/smartNote/quickPhrase.js)
// for tokens not covered by the offline default set.
export const expandClinicalPhrase = (payload = {}) =>
  base44.functions.invoke('expandClinicalPhrase', payload);
