// Front-end (intake) diagnosis validation.
//
// CMS "unacceptable" principal diagnosis codes cause zero-pay Returned-to-
// Provider (RTP) claims under PDGM. Catching them at intake — before the claim
// is built — protects revenue. This is a deterministic PRE-CHECK for the common
// RTP causes (symptom R-codes, status/factor Z-codes, and a curated explicit
// list), plus a lightweight PDGM clinical-group PREVIEW so intake sees the
// grouping a primary code will drive. It is NOT the authoritative CMS grouper
// (see pdgm/pdgmGrouper.js) — it is the fast front-door guard.
//
// Pure + offline (unit-tested with `node --test`).

import { CLINICAL_GROUPS } from "../pdgm/pdgmGrouper.js";

/** Normalize an ICD-10 code: uppercase, strip dots/spaces. */
export function normalizeIcd(code) {
  return String(code || "").toUpperCase().replace(/[.\s]/g, "").trim();
}

// Explicit codes that are unacceptable as a PDGM principal diagnosis and would
// RTP. Extend as CMS updates the edit list. (A representative curated set — the
// R/Z category rules below catch the broad, high-volume RTP causes.)
export const UNACCEPTABLE_PRIMARY_CODES = new Set([
  "I10",    // essential (primary) hypertension — questionable encounter as HH principal
  "E785",   // hyperlipidemia, unspecified
  "F0390",  // unspecified dementia without behavioral disturbance (manifestation-style)
  "M810",   // age-related osteoporosis w/o current fracture
]);

// Z-code families that ARE acceptable as a PDGM principal and map to
// MMTA - Surgical Aftercare (see pdgmRates.js ICD→group table). Other Z codes
// (status/factor, long-term drug use, etc.) still RTP as principal.
export const ACCEPTABLE_Z_PREFIXES = ["Z47", "Z48", "Z96"];

/**
 * Validate a single principal diagnosis code.
 * @param {string} icd10
 * @returns {{ code, acceptable, reason, category, severity }}
 */
export function validatePrimaryDiagnosis(icd10) {
  const code = normalizeIcd(icd10);
  if (!code) {
    return { code: "", acceptable: false, reason: "No primary diagnosis provided.", category: "missing", severity: "critical" };
  }
  const letter = code[0];

  // Symptom / sign codes (R00–R99) — unacceptable principal.
  if (letter === "R") {
    return { code, acceptable: false, reason: "Symptom/sign code (R-chapter) is unacceptable as a PDGM principal diagnosis and will RTP.", category: "symptom_code", severity: "high" };
  }
  // Status / factor codes (Z00–Z99) — unacceptable principal unless whitelisted.
  if (letter === "Z") {
    const whitelisted = ACCEPTABLE_Z_PREFIXES.some((p) => code.startsWith(normalizeIcd(p)));
    if (!whitelisted) {
      return { code, acceptable: false, reason: "Status/factor code (Z-chapter) is unacceptable as a PDGM principal diagnosis and will RTP.", category: "status_code", severity: "high" };
    }
  }
  if (UNACCEPTABLE_PRIMARY_CODES.has(code)) {
    return { code, acceptable: false, reason: "Code is on the CMS unacceptable-principal-diagnosis edit list and will RTP.", category: "unacceptable_list", severity: "high" };
  }
  return { code, acceptable: true, reason: "Acceptable as a PDGM principal diagnosis.", category: "acceptable", severity: "info" };
}

// ICD-10 first-letter / prefix → PDGM clinical group (preview only).
const GROUP_BY_PREFIX = [
  { test: (c) => c.startsWith("I6"), group: "Neuro Rehabilitation" }, // stroke/CVA
  { test: (c) => c[0] === "I", group: "MMTA - Cardiac and Circulatory" },
  { test: (c) => c[0] === "J", group: "MMTA - Respiratory" },
  { test: (c) => c[0] === "E", group: "MMTA - Endocrine" },
  { test: (c) => c[0] === "K" || c[0] === "N", group: "MMTA - Gastrointestinal tract and Genitourinary system" },
  { test: (c) => c[0] === "M", group: "Musculoskeletal Rehabilitation" },
  { test: (c) => c[0] === "F", group: "Behavioral Health" },
  { test: (c) => c[0] === "G", group: "Neuro Rehabilitation" },
  { test: (c) => c[0] === "L", group: "Wound" },
  { test: (c) => c.startsWith("T81"), group: "Wound" },
  { test: (c) => c[0] === "S", group: "Musculoskeletal Rehabilitation" },
  { test: (c) => c[0] === "A" || c[0] === "B" || c[0] === "C" || c[0] === "D", group: "MMTA - Infectious Disease, Neoplasms, and Blood-Forming Diseases" },
  { test: (c) => c.startsWith("Z47") || c.startsWith("Z48") || c.startsWith("Z96"), group: "MMTA - Surgical Aftercare" },
];

/**
 * Preview the PDGM clinical group a primary code would drive (heuristic).
 * @returns {{ clinical_group: string, confidence: 'high'|'low' }}
 */
export function previewClinicalGroup(icd10) {
  const code = normalizeIcd(icd10);
  // An RTP-unacceptable principal (Z/R chapter, edit list) can't confidently
  // drive ANY group — previewing "Surgical Aftercare (high)" for a code the
  // validator simultaneously calls a guaranteed RTP was contradictory advice.
  const rtp = code ? validatePrimaryDiagnosis(code) : null;
  for (const rule of GROUP_BY_PREFIX) {
    if (code && rule.test(code)) {
      return { clinical_group: rule.group, confidence: rtp && !rtp.acceptable ? "low" : "high" };
    }
  }
  return { clinical_group: "MMTA - Other", confidence: "low" };
}

/**
 * Validate an intake diagnosis set. Validates the PRINCIPAL diagnosis (RTP
 * acceptability) and previews the PDGM clinical group it drives; the secondaries
 * are only counted (secondary_count), not individually validated here.
 *
 * @param {Object} input { primary, secondaries }
 * @returns {{
 *   primary: object, clinical_group_preview: object,
 *   acceptable: boolean, rtp_risk: boolean, findings: Array,
 *   all_clinical_groups: Array, secondary_count: number,
 * }}
 */
export function validateIntakeDiagnoses({ primary, secondaries = [] } = {}) {
  const primaryResult = validatePrimaryDiagnosis(primary);
  const preview = previewClinicalGroup(primary);
  const findings = [];
  if (!primaryResult.acceptable) {
    findings.push({
      code: primaryResult.code,
      role: "primary",
      severity: primaryResult.severity,
      message: primaryResult.reason,
      remediation:
        primaryResult.category === "missing"
          ? "Enter a specific, PDGM-acceptable principal diagnosis."
          : "Re-sequence to a PDGM-acceptable principal diagnosis; move this code to a secondary position if clinically appropriate.",
    });
  }
  return {
    primary: primaryResult,
    clinical_group_preview: preview,
    acceptable: primaryResult.acceptable,
    rtp_risk: !primaryResult.acceptable,
    findings,
    // Expose the canonical group list so a UI can offer the full picker.
    all_clinical_groups: CLINICAL_GROUPS,
    secondary_count: Array.isArray(secondaries) ? secondaries.length : 0,
  };
}
