// HIPPS / case-mix RECONCILIATION helpers — reference display only.
//
// Bridges the two PDGM models in this repo WITHOUT letting them compete (see the
// pdgmGrouper.js header): the admin-uploaded official CMS case-mix weight table
// (parsed by caseMixWeightsLoader.js, persisted on PDGMRateConfig.case_mix_weight_table)
// is looked up per scenario so an administrator can see the official HIPPS code,
// case-mix weight, and per-group LUPA threshold BESIDE the canonical
// calculatePDGM-based dollar estimate.
//
// HARD CONSTRAINTS (from pdgmGrouper.js / docs/PDGM_CASE_MIX_WEIGHTS.md):
//   - Reference table for analysis — payment estimates remain from the PDGM
//     engine (calculatePDGM). Nothing here converts a weight to dollars.
//   - LUPA thresholds are informational display only: this companion EMR does
//     NOT count visits and must not raise LUPA alerts.
//   - Never guess: an unknown group / combination is reported unavailable.
//   - Financials remain admin-only — callers must keep this behind the existing
//     FinancialGate / canViewFinancials gating.

import { caseMixKey, lookupCaseMix } from "./pdgmGrouper.js";

/**
 * pdgmRates.js clinical-group key → official CMS clinical-group name (the 12
 * groups in pdgmGrouper.CLINICAL_GROUPS, which key the uploaded weight table).
 *
 * The legacy rate model has 14 buckets; two have no clean CMS counterpart:
 *   - MMTA_Skin_Non_Surgical maps to "Wound" — the official CMS label is
 *     "Wounds (Post-Op & Skin/Non-Surgical)" (same alias caseMixWeightsLoader uses).
 *   - MMTA_Medication_Management has NO CMS group of its own; it resolves to
 *     null and the reconciliation reports "no CMS counterpart" (never guessed).
 */
export const RATES_KEY_TO_CMS_GROUP = {
  MMTA_Surgical_Aftercare: "MMTA - Surgical Aftercare",
  MMTA_Cardiac_Circulatory: "MMTA - Cardiac and Circulatory",
  MMTA_Endocrine: "MMTA - Endocrine",
  MMTA_GI_GU: "MMTA - Gastrointestinal tract and Genitourinary system",
  MMTA_Infectious_Disease: "MMTA - Infectious Disease, Neoplasms, and Blood-Forming Diseases",
  MMTA_Other: "MMTA - Other",
  MMTA_Respiratory: "MMTA - Respiratory",
  MMTA_Neuro_Rehab: "Neuro Rehabilitation",
  MMTA_Wounds: "Wound",
  MMTA_Skin_Non_Surgical: "Wound",
  MMTA_Complex_Nursing: "Complex Nursing Interventions",
  MMTA_Behavioral_Health: "Behavioral Health",
  MMTA_Musculoskeletal: "Musculoskeletal Rehabilitation",
  // MMTA_Medication_Management: intentionally absent — no CMS counterpart.
  // (caseMixReconciliation.spec.js asserts every value above is one of the 12
  // official pdgmGrouper.CLINICAL_GROUPS, so a typo here can't silently produce
  // permanent "combination not found" results.)
};

/**
 * Build the object persisted at PDGMRateConfig.case_mix_weight_table from a
 * successful parseCaseMixWeightsCsv result. Returns null unless the parse is
 * ok (an incomplete/unmappable table is never stored — see the loader header).
 *
 * @param {ReturnType<import('./caseMixWeightsLoader.js').parseCaseMixWeightsCsv>} parseResult
 * @param {{ year?: string|number|null, source?: string|null, uploadedBy?: string|null }} [meta]
 */
export function buildStoredWeightTable(parseResult, { year = null, source = null, uploadedBy = null } = {}) {
  if (!parseResult || parseResult.ok !== true) return null;
  return {
    payment_year: year != null && String(year).trim() !== "" ? String(year).trim() : null,
    source: source || null,
    uploaded_at: new Date().toISOString(),
    // Cosmetic convenience only — the authoritative editor identity is
    // updated_by_email, stamped server-side by savePDGMRateConfig.
    uploaded_by_email: uploadedBy || null,
    groups: parseResult.meta?.groups ?? Object.keys(parseResult.caseMixTable).length,
    rows: parseResult.caseMixTable,
  };
}

/**
 * The { [caseMixKey]: { weight, hipps?, lupaThreshold? } } rows of a stored
 * table, or null when no usable table is stored (never a guess).
 */
export function storedWeightTableRows(stored) {
  const rows = stored?.rows;
  if (!rows || typeof rows !== "object" || Array.isArray(rows)) return null;
  return Object.keys(rows).length > 0 ? rows : null;
}

/**
 * Look up the official HIPPS code / case-mix weight / LUPA threshold for a
 * simulator scenario (pdgmRates-keyed clinicalGroup + admissionSource/timing/
 * functionalLevel/comorbidityLevel) in the stored CMS table.
 *
 * Returns { available:false, reason } whenever anything is missing — no stored
 * table, no CMS counterpart for the group, or the combination isn't in the
 * table. Never fabricates a HIPPS, weight, or threshold.
 */
export function reconcileScenario(scenario, stored) {
  const rows = storedWeightTableRows(stored);
  if (!rows) return { available: false, reason: "no stored CMS case-mix weight table" };

  const { clinicalGroup, admissionSource, timing, functionalLevel, comorbidityLevel } = scenario || {};
  const cmsGroup = RATES_KEY_TO_CMS_GROUP[clinicalGroup] || null;
  if (!cmsGroup) {
    return {
      available: false,
      reason: `"${clinicalGroup}" has no CMS clinical-group counterpart in the official 12-group table`,
    };
  }

  const entry = lookupCaseMix(
    { timing, admissionSource, clinicalGroup: cmsGroup, functionalLevel, comorbidityLevel },
    rows,
  );
  if (!entry) {
    return {
      available: false,
      cmsGroup,
      reason: `combination not found in the stored table (${caseMixKey({ timing, admissionSource, clinicalGroup: cmsGroup, functionalLevel, comorbidityLevel })})`,
    };
  }

  return {
    available: true,
    cmsGroup,
    hipps: entry.hipps || null,
    weight: entry.weight,
    lupaThreshold: Number.isFinite(entry.lupaThreshold) ? entry.lupaThreshold : null,
  };
}
