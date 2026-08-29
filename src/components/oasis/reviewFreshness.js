// Freshness fingerprint for the Comprehensive OASIS Review.
//
// A review is only trustworthy for the exact inputs it ran against. Comparing
// object identity works while the card stays mounted, but it cannot survive
// persistence: a review saved on the OASISUpload record and rehydrated later
// gets a brand-new object to compare against, so findings computed BEFORE a
// correction would be presented as current. It also missed a whole class of
// staleness — the patient context often arrives after the first render (patient
// matching resolves later, and the clinician can change the match), leaving the
// review based on missing or previous-patient medications, allergies and
// diagnoses with no warning.
//
// A fingerprint of the actual review inputs fixes both: it is stable across
// reloads and covers every input the review depended on.
//
// Pure — unit-tested in reviewFreshness.spec.js.

/**
 * Deterministic JSON: object keys are emitted in sorted order at every depth,
 * so two structurally equal inputs always produce the same string regardless of
 * key insertion order (extraction and rehydration order differ in practice).
 */
export function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(",")}}`;
}

/** FNV-1a 32-bit — small, dependency-free, and adequate for change detection. */
function hash32(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/**
 * Fingerprint the inputs a comprehensive review ran against.
 *
 * @param {Object} oasisData        The assessment data (pdgmData).
 * @param {Object} [patientContext] The clinical patient context sent with it.
 * @returns {string|null} null when there is nothing to review yet.
 */
export function reviewFingerprint(oasisData, patientContext) {
  if (!oasisData) return null;
  const payload = stableStringify({
    oasis: oasisData,
    patient: patientContext || {},
  });
  // Length is mixed in so two inputs colliding on the hash still differ here.
  return `${hash32(payload)}-${payload.length.toString(36)}`;
}
