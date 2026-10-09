// Pure field-level merge planning, shared by the merge UI and pinned against
// the deduplicatePatients server broker (which carries a Deno copy because a
// Base44 function cannot import src/). No React, no network.

// Scalar chart fields the survivor inherits when ITS OWN value is empty. The
// winner's populated values are never overwritten.
const FILL_EMPTY_FIELDS = [
  "date_of_birth", "medical_record_number", "phone", "email", "address",
  "primary_diagnosis", "allergies", "physician_name", "physician_phone",
  "emergency_contact_name", "emergency_contact_phone", "emergency_contact_relationship",
  "insurance_primary", "insurance_secondary", "care_type", "admission_date",
  "advance_directives", "baseline_vitals", "functional_status",
];
// Array fields that are UNIONED (dedupe by JSON identity).
const UNION_ARRAY_FIELDS = ["secondary_diagnoses", "current_medications", "past_medical_history", "wounds"];

/** Every field a merge may write onto the survivor (the broker's allowlist). */
export const MERGE_PATCH_FIELDS = Object.freeze([...FILL_EMPTY_FIELDS, ...UNION_ARRAY_FIELDS]);

const isEmpty = (v) =>
  v === undefined || v === null || (typeof v === "string" && v.trim() === "") ||
  (Array.isArray(v) && v.length === 0) ||
  (typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === 0);

/**
 * Pure: compute the patch of loser fields the winner should inherit.
 *
 * The legacy embedded `enhanced_notes_history` array is NOT merged: its schema
 * makes it read-only ("never update this whole array"). Note revisions now live
 * in PatientNoteHistoryEntry rows, which the broker copies onto the survivor.
 */
export function buildFieldMergePatch(winner, loser) {
  const patch = {};
  if (!winner || !loser) return patch;
  for (const field of FILL_EMPTY_FIELDS) {
    if (isEmpty(winner[field]) && !isEmpty(loser[field])) patch[field] = loser[field];
  }
  for (const field of UNION_ARRAY_FIELDS) {
    const w = Array.isArray(winner[field]) ? winner[field] : [];
    const l = Array.isArray(loser[field]) ? loser[field] : [];
    if (!l.length) continue;
    const seen = new Set(w.map((x) => JSON.stringify(x)));
    const merged = [...w];
    for (const item of l) {
      const key = JSON.stringify(item);
      if (!seen.has(key)) {
        seen.add(key);
        merged.push(item);
      }
    }
    if (merged.length > w.length) patch[field] = merged;
  }
  return patch;
}
