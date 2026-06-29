/**
 * pdgmRates — the editable PDGM rate numbers (case-mix weights, functional
 * thresholds/multipliers, comorbidity multipliers, and the base payment rate)
 * plus the deterministic merge used to apply an agency's saved overrides on top
 * of the built-in defaults.
 *
 * WHY this exists: the legacy `calculatePDGM` backend hardcoded these numbers
 * "from memory", which the table-driven `pdgmGrouper` explicitly warns is
 * fabrication. CMS publishes the official case-mix weights and base rate and
 * they change every rate year. This module lets an admin enter their OWN
 * current numbers (via the PDGMRateSettings page → the PDGMRateConfig entity),
 * and `calculatePDGM` merges those over the defaults — so the estimate becomes
 * accurate (and can be marked non-estimate) once the agency loads official rates.
 *
 * DEFAULT_PDGM_RATES MIRRORS the constants in
 * base44/functions/calculatePDGM/entry.ts. Keep the two in sync (the backend is
 * the engine; this copy drives the admin editor + preview). The shape is also
 * the contract for the saved `PDGMRateConfig.rates` object.
 */

// The 13 clinical-group buckets the legacy engine scores, each with a weight per
// admission-source + episode-timing combination. (These default numbers are
// APPROXIMATE — replace them with your official CMS case-mix weights.)
export const DEFAULT_PDGM_RATES = {
  // CY2026 national standardized 30-day period payment amount, quality submitters
  // (CMS-1828-F, eff. 2026-01-01). Verify against your agency's official rate sheet.
  basePaymentRate: 2038.22,
  // CY2026 national labor-related share. The wage index adjusts ONLY this portion
  // of the base payment; the non-labor remainder is unadjusted (mirrors the backend
  // PDGM_LABOR_SHARE_2026 — kept in sync by pdgmRatesParity.test.js).
  laborShare: 0.7676,
  clinicalGroupWeights: {
    MMTA_Surgical_Aftercare:  { community_early: 0.9234, community_late: 0.8512, institutional_early: 1.1456, institutional_late: 1.0534 },
    MMTA_Cardiac_Circulatory: { community_early: 0.9456, community_late: 0.8698, institutional_early: 1.0876, institutional_late: 1.0006 },
    MMTA_Endocrine:           { community_early: 0.8234, community_late: 0.7575, institutional_early: 0.9934, institutional_late: 0.9139 },
    MMTA_GI_GU:               { community_early: 0.8823, community_late: 0.8117, institutional_early: 1.0123, institutional_late: 0.9313 },
    MMTA_Infectious_Disease:  { community_early: 1.0534, community_late: 0.9691, institutional_early: 1.2234, institutional_late: 1.1255 },
    MMTA_Other:               { community_early: 0.8756, community_late: 0.8055, institutional_early: 1.0456, institutional_late: 0.9619 },
    MMTA_Respiratory:         { community_early: 1.0067, community_late: 0.9262, institutional_early: 1.1567, institutional_late: 1.0641 },
    MMTA_Neuro_Rehab:         { community_early: 1.1290, community_late: 1.0387, institutional_early: 1.2890, institutional_late: 1.1859 },
    MMTA_Wounds:              { community_early: 1.1845, community_late: 1.0897, institutional_early: 1.3345, institutional_late: 1.2277 },
    MMTA_Complex_Nursing:     { community_early: 1.2956, community_late: 1.1919, institutional_early: 1.4456, institutional_late: 1.3299 },
    MMTA_Behavioral_Health:   { community_early: 0.8165, community_late: 0.7512, institutional_early: 0.9665, institutional_late: 0.8892 },
    MMTA_Medication_Management:{ community_early: 0.7834, community_late: 0.7207, institutional_early: 0.9234, institutional_late: 0.8495 },
    MMTA_Musculoskeletal:     { community_early: 0.9678, community_late: 0.8904, institutional_early: 1.1178, institutional_late: 1.0284 },
    // Present so the FE defaults match the backend table exactly (drift guard).
    // Currently unreachable from the ICD/text mapping, but the admin can map a
    // prefix to it if they choose.
    MMTA_Skin_Non_Surgical:   { community_early: 1.0123, community_late: 0.9313, institutional_early: 1.1623, institutional_late: 1.0693 },
  },
  // Functional-impairment point thresholds (Low ≤ low; Medium < high; else High).
  functionalThresholds: {
    community_early:     { low: 9,  high: 18 },
    community_late:      { low: 8,  high: 16 },
    institutional_early: { low: 10, high: 20 },
    institutional_late:  { low: 9,  high: 18 },
  },
  functionalMultipliers: {
    community_early:     { low: 0.82, medium: 1.0,  high: 1.28 },
    community_late:      { low: 0.80, medium: 0.96, high: 1.22 },
    institutional_early: { low: 0.88, medium: 1.04, high: 1.32 },
    institutional_late:  { low: 0.85, medium: 1.0,  high: 1.26 },
  },
  comorbidityMultipliers: {
    community_early:     { none: 1.0, low: 1.025, high: 1.065 },
    community_late:      { none: 1.0, low: 1.02,  high: 1.055 },
    institutional_early: { none: 1.0, low: 1.035, high: 1.085 },
    institutional_late:  { none: 1.0, low: 1.03,  high: 1.075 },
  },
};

// Default ICD-10 (prefix) → clinical-group mapping. Longest-prefix wins (a
// specific code like "I63" beats the chapter letter "I"). MIRRORS
// ICD10_CLINICAL_GROUPS in base44/functions/calculatePDGM/entry.ts. Note there is
// intentionally NO "S" entry — ICD chapter S is Injury, not skin. An admin can
// edit/add/remove any of these on the PDGM Rate Settings page.
export const DEFAULT_ICD10_CLINICAL_GROUPS = {
  G: "MMTA_Neuro_Rehab",
  I63: "MMTA_Neuro_Rehab",
  I64: "MMTA_Neuro_Rehab",
  I: "MMTA_Cardiac_Circulatory",
  I50: "MMTA_Cardiac_Circulatory",
  I10: "MMTA_Cardiac_Circulatory",
  I25: "MMTA_Cardiac_Circulatory",
  J: "MMTA_Respiratory",
  J44: "MMTA_Respiratory",
  J18: "MMTA_Respiratory",
  E: "MMTA_Endocrine",
  E11: "MMTA_Endocrine",
  E10: "MMTA_Endocrine",
  K: "MMTA_GI_GU",
  N: "MMTA_GI_GU",
  N18: "MMTA_GI_GU",
  L: "MMTA_Wounds",
  L89: "MMTA_Wounds",
  M: "MMTA_Musculoskeletal",
  M79: "MMTA_Musculoskeletal",
  A: "MMTA_Infectious_Disease",
  B: "MMTA_Infectious_Disease",
  Z96: "MMTA_Surgical_Aftercare",
  Z47: "MMTA_Surgical_Aftercare",
  Z48: "MMTA_Surgical_Aftercare",
  F: "MMTA_Behavioral_Health",
};

/**
 * Effective ICD-10 → clinical-group map. Unlike the numeric rate tables (which
 * merge value-by-value), this is REPLACE-when-present so an admin can add, edit,
 * AND remove prefixes: once a custom map is saved it's used verbatim; an empty/
 * unset map falls back to the built-in defaults.
 */
export function effectiveIcdGroups(savedMap) {
  return savedMap && typeof savedMap === "object" && Object.keys(savedMap).length > 0
    ? savedMap
    : DEFAULT_ICD10_CLINICAL_GROUPS;
}

/**
 * Recursively overlay the finite NUMBERS in `over` onto `base`, preserving any
 * base value the override omits or sets to a non-number. This is what lets an
 * admin change just a few weights without having to re-enter the whole table,
 * and guarantees a malformed/partial override can never blank out a rate.
 */
export function deepMergeNumbers(base, over) {
  const out = { ...(base || {}) };
  if (!over || typeof over !== "object") return out;
  for (const key of Object.keys(over)) {
    const ov = over[key];
    if (ov && typeof ov === "object" && !Array.isArray(ov)) {
      out[key] = deepMergeNumbers(base?.[key] || {}, ov);
    } else if (typeof ov === "number" && Number.isFinite(ov)) {
      out[key] = ov;
    }
  }
  return out;
}

/**
 * Effective PDGM rates = the admin's saved overrides merged over the defaults.
 * `override` is the `PDGMRateConfig.rates` object (same shape as
 * DEFAULT_PDGM_RATES); any missing piece falls back to the default.
 */
export function mergePdgmRates(override, defaults = DEFAULT_PDGM_RATES) {
  return deepMergeNumbers(defaults, override);
}
