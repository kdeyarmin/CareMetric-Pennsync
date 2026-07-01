import { base44 } from '@/api/base44Client';

// Map a clinical note to verbatim-evidenced, confidence-scored OASIS M-item
// suggestions. Consumed by the OASIS form's "Pre-fill OASIS from this note"
// action (src/components/oasis/noteToOasisAutofill.js + NoteToOasisPrefill.jsx).
export const mapNoteToOASIS = (payload = {}) =>
  base44.functions.invoke('mapNoteToOASIS', payload);
