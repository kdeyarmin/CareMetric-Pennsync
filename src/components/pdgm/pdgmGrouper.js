// Deterministic PDGM grouping engine.
//
// Under PDGM, each 30-day period is assigned a case-mix group (and HIPPS code +
// case-mix weight) from FIVE variables: timing, admission source, clinical
// group, functional-impairment level, and comorbidity adjustment.
//
// ── IMPORTANT: this engine embeds NO CMS data ─────────────────────────────────
// The variable→group and group→weight mappings are official CMS data that change
// at least annually and span thousands of ICD-10 codes. The small, source-pinned
// CY 2026 functional response table lives in cmsPdgmFunctionalDataCy2026.js;
// diagnosis, comorbidity, timing, version-selection, and case-mix data are not
// embedded here.
//
// So every CMS table is SUPPLIED by the caller (`cmsTables`), loaded from the
// agency's official CMS PDGM grouper / case-mix weight files. The engine
// computes only the table-independent logic and performs lookups. It NEVER
// guesses: if a code or combination isn't in the supplied tables, the result is
// returned as incomplete (with `missing`), not fabricated.
//
// This replaces the previous approach of asking an LLM to guess
// `estimated_pdgm_group` — once the agency loads current CMS tables, grouping
// becomes deterministic and reproducible.
//
// ── WIRING STATUS / canonical path ────────────────────────────────────────────
// This client-side grouper is currently UNWIRED. The app's live, canonical PDGM
// calculation runs in the backend function `base44/functions/calculatePDGM`
// (admin-configurable ICD10_CLINICAL_GROUPS + case-mix multipliers + base rate;
// see also `pdgmRates.js`). That is the single source of truth shown to staff.
// Do NOT surface this engine's output as a SECOND reimbursement figure — two
// independent methodologies would produce inconsistent billing numbers. If it is
// ever wired it must (a) be supplied with the agency's current CMS case-mix,
// diagnosis, comorbidity, and functional-threshold tables, and
// (b) reconcile against `calculatePDGM` rather than compete with it. Until then
// it stays a tested, table-driven reference for that future, reconciled work.

import { CMS_PDGM_FUNCTIONAL_ITEM_IDS_CY2026 } from "./cmsPdgmFunctionalDataCy2026.js";

/** The 12 PDGM clinical groups (stable public reference; the ICD-10→group
 *  mapping that selects among them is CMS data supplied via cmsTables). */
export const CLINICAL_GROUPS = [
  "Behavioral Health",
  "Complex Nursing Interventions",
  "Musculoskeletal Rehabilitation",
  "Neuro Rehabilitation",
  "Wound",
  "MMTA - Surgical Aftercare",
  "MMTA - Cardiac and Circulatory",
  "MMTA - Endocrine",
  "MMTA - Gastrointestinal tract and Genitourinary system",
  "MMTA - Infectious Disease, Neoplasms, and Blood-Forming Diseases",
  "MMTA - Respiratory",
  "MMTA - Other",
];

const norm = (code) => String(code).toUpperCase().replace(/\./g, "").trim();

/** Provisional timing helper only. Official HHGS timing additionally depends on
 *  sequence and the greater-than-60-day gap rule; groupPeriod therefore treats
 *  timing as unsupported and never completes from this helper alone. */
export function computeTiming(periodNumber) {
  const n = Number(periodNumber);
  if (!Number.isInteger(n) || n < 1) return null;
  return n === 1 ? "early" : "late";
}

/** Admission source from whether the patient had a qualifying acute/post-acute
 *  (institutional) stay before the period.
 *  @param {{ hadInstitutionalStay?: boolean }} [opts] */
export function computeAdmissionSource(opts = {}) {
  if (typeof opts.hadInstitutionalStay !== "boolean") return null;
  return opts.hadInstitutionalStay ? "institutional" : "community";
}

const missingResponse = (value) => value === undefined || value === null || value === "";

function readAnswer(answers, itemId) {
  if (!answers || typeof answers !== "object") return undefined;
  if (Object.hasOwn(answers, itemId)) return answers[itemId];
  const lower = itemId.toLowerCase();
  if (Object.hasOwn(answers, lower)) return answers[lower];
  return undefined;
}

/** Score and validate the ten official M1033 HHGS input flags.
 *  All flags must be present and binary. "None of the above" is mutually
 *  exclusive; when it is 0, at least one of the other nine flags must be 1.
 *  CMS ignores current exhaustion and other risk when counting the four
 *  qualifying risks, but still requires and validates both inputs.
 *
 * @returns {{points:number|null, missing:Array<string>, unmapped:Array<string>, inconsistent:Array<string>}|null}
 */
export function computeM1033Points(answers, config) {
  if (!answers || !config || !Array.isArray(config.itemIds)
    || !Array.isArray(config.scoringItemIds) || !config.noneAboveItemId
    || typeof config.responseLimit !== "number" || typeof config.categoryPoints !== "number") {
    return null;
  }

  const missing = [];
  const unmapped = [];
  const inconsistent = [];
  const values = {};

  for (const itemId of config.itemIds) {
    const response = readAnswer(answers, itemId);
    if (missingResponse(response)) {
      missing.push(itemId);
      continue;
    }
    const code = String(response);
    if (code !== "0" && code !== "1") {
      unmapped.push(`${itemId}=${response}`);
      continue;
    }
    values[itemId] = Number(code);
  }

  if (missing.length === 0 && unmapped.length === 0) {
    const noneAbove = values[config.noneAboveItemId];
    const otherRiskCount = config.itemIds
      .filter((itemId) => itemId !== config.noneAboveItemId)
      .reduce((sum, itemId) => sum + values[itemId], 0);

    if (noneAbove === 1 && otherRiskCount > 0) {
      inconsistent.push("M1033 none-above is mutually exclusive with the other risk flags");
    }
    if (noneAbove === 0 && otherRiskCount === 0) {
      inconsistent.push("M1033 requires none-above or at least one other risk flag");
    }
  }

  if (missing.length || unmapped.length || inconsistent.length) {
    return { points: null, missing, unmapped, inconsistent };
  }

  const qualifyingRiskCount = config.scoringItemIds.reduce(
    (sum, itemId) => sum + values[itemId],
    0,
  );
  return {
    points: qualifyingRiskCount >= config.responseLimit ? config.categoryPoints : 0,
    missing,
    unmapped,
    inconsistent,
  };
}

/**
 * Functional-impairment points, summed from the SUPPLIED CMS response→points
 * table. The set of scored items is defined by the table's keys (so it tracks
 * the official CMS spec, not a hardcoded list).
 *
 * No guessing: a present answer whose response code is NOT in the supplied
 * table is recorded in `unmapped` (rather than silently scored as zero), so
 * callers can report it as missing instead of under-counting functional points.
 * @param {object} answers { itemId: response, ... }
 * @param {object} itemPoints { itemId: { [response]: points }, ... } (CMS data)
 * Missing items are returned explicitly and never treated as zero.
 * @param {object|null} [m1033Config] CMS M1033 ten-flag scoring configuration
 * @returns {{points:number|null, items:object, missing:Array<string>, unmapped:Array<string>, inconsistent:Array<string>}|null}
 */
export function computeFunctionalPoints(answers, itemPoints, m1033Config = null) {
  if (!itemPoints || !answers) return null;
  let points = 0;
  const items = {};
  const missing = [];
  const unmapped = [];
  const inconsistent = [];

  if (m1033Config) {
    const m1033 = computeM1033Points(answers, m1033Config);
    if (!m1033) return null;
    missing.push(...m1033.missing);
    unmapped.push(...m1033.unmapped);
    inconsistent.push(...m1033.inconsistent);
    if (typeof m1033.points === "number") {
      points += m1033.points;
      items.M1033 = m1033.points;
    }
  }

  for (const id of Object.keys(itemPoints)) {
    const resp = readAnswer(answers, id);
    if (missingResponse(resp)) {
      missing.push(id);
      continue;
    }
    const table = itemPoints[id];
    if (!table) continue;
    let p = table[String(resp)];
    if (p === undefined) p = table[Number(resp)];
    if (typeof p === "number") {
      points += p;
      items[id] = p;
    } else {
      // Present response absent from the CMS table → table miss: reported, not
      // treated as zero (which would understate points and fabricate a level).
      unmapped.push(`${id}=${resp}`);
    }
  }
  return {
    points: missing.length || unmapped.length || inconsistent.length ? null : points,
    items,
    missing,
    unmapped,
    inconsistent,
  };
}

/** Functional level from points + a SUPPLIED CMS threshold set
 *  ({ low: maximum low score, high: minimum high score }). Scores strictly
 *  between the two boundaries are medium. Returns null (NOT a guess) when the
 *  set is missing or malformed — otherwise an
 *  incomplete table would fall through to "high" and fabricate a level. */
export function computeFunctionalLevel(points, thresholds) {
  if (!thresholds || typeof points !== "number" || !Number.isFinite(points)) return null;
  if (typeof thresholds.low !== "number" || !Number.isFinite(thresholds.low)
    || typeof thresholds.high !== "number" || !Number.isFinite(thresholds.high)) return null;
  if (thresholds.low >= thresholds.high) return null;
  if (points <= thresholds.low) return "low";
  if (points >= thresholds.high) return "high";
  return "medium";
}

/** Resolve the threshold set that applies to a period. CMS functional
 *  thresholds vary by clinical group, so `functionalThresholds` may be either a
 *  flat { low, high } (one set for all groups) or a table keyed by clinical
 *  group { [group]: { low, high } }. Returns null when no set applies, so the
 *  period is reported incomplete rather than scored against absent thresholds.
 *
 *  NOTE: this is NOT the same shape as DEFAULT_PDGM_RATES.functionalThresholds in
 *  pdgmRates.js, which is timing-bucket-keyed for a separate backend-mirrored
 *  revenue estimator. Do not pass DEFAULT_PDGM_RATES here: these thresholds
 *  must be keyed by the CMS clinical group, not by timing bucket. */
function resolveThresholds(functionalThresholds, clinicalGroup) {
  if (!functionalThresholds) return null;
  if (typeof functionalThresholds.low === "number" || typeof functionalThresholds.high === "number") {
    return functionalThresholds; // flat shape: one set for all groups
  }
  if (clinicalGroup && functionalThresholds[clinicalGroup]) {
    return functionalThresholds[clinicalGroup]; // keyed by clinical group
  }
  return null;
}

/** Clinical group from the principal diagnosis using the SUPPLIED CMS map.
 *  Returns null (NOT a guess) when the code isn't in the official table. */
export function assignClinicalGroup(principalDiagnosis, dxToGroup) {
  if (!principalDiagnosis || !dxToGroup) return null;
  return dxToGroup[norm(principalDiagnosis)] || null;
}

/** Comorbidity adjustment (none/low/high) from secondary diagnoses using the
 *  SUPPLIED CMS subgroup map + interaction list. */
export function assignComorbidityAdjustment(secondaryDiagnoses, comorbidity) {
  if (!comorbidity || !comorbidity.subgroups || !Array.isArray(comorbidity.interactions)
    || !comorbidity.lowSubgroups) return null;
  const subgroups = new Set();
  for (const dx of secondaryDiagnoses || []) {
    const sg = comorbidity.subgroups[norm(dx)];
    if (sg) subgroups.add(sg);
  }
  for (const pair of comorbidity.interactions || []) {
    if (subgroups.has(pair[0]) && subgroups.has(pair[1])) return "high";
  }
  const lowSubgroups = new Set(
    Array.isArray(comorbidity.lowSubgroups)
      ? comorbidity.lowSubgroups
      : Object.keys(comorbidity.lowSubgroups).filter((key) => comorbidity.lowSubgroups[key]),
  );
  return [...subgroups].some((subgroup) => lowSubgroups.has(subgroup)) ? "low" : "none";
}

/** Behaviors this bounded client reference does not implement. Keeping them
 *  explicit and unconditional prevents a table lookup from being mistaken for
 *  a CMS-valid, billable group. */
export const UNSUPPORTED_CMS_GROUPING_BEHAVIORS = Object.freeze([
  "CMS date-effective grouper version selection is not wired into groupPeriod",
  "CMS diagnosis validity, code-first, manifestation, and SDX1 promotion rules are not implemented",
  "CMS comorbidity diagnosis and same-subchapter exclusion rules are not implemented",
  "CMS timing and admission-source sequence validation are not implemented",
]);

/** Composite key into the CMS case-mix table. */
export function caseMixKey({ timing, admissionSource, clinicalGroup, functionalLevel, comorbidityLevel }) {
  return [timing, admissionSource, clinicalGroup, functionalLevel, comorbidityLevel].join("|");
}

/** HIPPS code + case-mix weight from the SUPPLIED CMS case-mix table.
 *  Returns null if the combination isn't present (never fabricated). */
export function lookupCaseMix(variables, caseMixTable) {
  if (!caseMixTable) return null;
  return caseMixTable[caseMixKey(variables)] || null;
}

/**
 * Group a 30-day period. Returns a complete result only when all required CMS
 * tables are supplied AND every lookup resolves; otherwise `complete:false` with
 * a `missing` list. Never fabricates a group, level, HIPPS, or weight.
 *
 * @param {Record<string, any>} [input] { periodNumber, hadInstitutionalStay, principalDiagnosis,
 *                         secondaryDiagnoses, answers, responseSchemaId }
 *                 `responseSchemaId` must be "pennsync-oasis-response-v2-cms-e2";
 *                 anything else (including absent) is reported in `missing`.
 * @param {Record<string, any>} [cmsTables] { itemPoints, m1033, functionalThresholds,
 *                             dxToGroup, comorbidity, caseMixTable } (from official CMS files).
 *                 `functionalThresholds` may be flat ({ low, high }) or keyed
 *                 by clinical group ({ [group]: { low, high } }).
 */
export function groupPeriod(input = {}, cmsTables = {}) {
  const { periodNumber, hadInstitutionalStay, principalDiagnosis, secondaryDiagnoses, answers } = input || {};
  const { itemPoints, m1033, functionalThresholds, dxToGroup, comorbidity, caseMixTable } = cmsTables;

  const timing = computeTiming(periodNumber);
  const admissionSource = computeAdmissionSource({ hadInstitutionalStay });
  const clinicalGroup = assignClinicalGroup(principalDiagnosis, dxToGroup);
  const fp = computeFunctionalPoints(answers, itemPoints, m1033);
  const thresholds = resolveThresholds(functionalThresholds, clinicalGroup);
  const functionalLevel = fp && typeof fp.points === "number"
    ? computeFunctionalLevel(fp.points, thresholds)
    : null;
  const comorbidityLevel = assignComorbidityAdjustment(secondaryDiagnoses, comorbidity);

  const missing = [];
  const unsupported = [...UNSUPPORTED_CMS_GROUPING_BEHAVIORS];
  // Provenance gate. The functional points below are computed from response
  // CODES, and a code only means something once you know which response set it
  // came from. Without `responseSchemaId` the answers are legacy or unknown, so
  // there is no CMS functional level to report — and a payment grouping built
  // on one would be a number nobody can defend.
  if (input.responseSchemaId !== "pennsync-oasis-response-v2-cms-e2") {
    missing.push(
      input.responseSchemaId
        ? `functional answers use response schema "${input.responseSchemaId}", not the CMS-aligned v2 set`
        : "response schema for the functional answers (legacy or unversioned input)",
    );
  }
  if (!timing) missing.push("timing (valid periodNumber)");
  if (!admissionSource) missing.push("admission source (explicit institutional-stay determination)");
  if (!Array.isArray(secondaryDiagnoses)) missing.push("explicit secondary diagnosis list");
  if (!dxToGroup) missing.push("CMS diagnosis→clinical-group table");
  else if (!clinicalGroup) missing.push(`clinical group for principal Dx "${principalDiagnosis || ""}"`);

  const missingPointTables = itemPoints
    ? CMS_PDGM_FUNCTIONAL_ITEM_IDS_CY2026.filter((itemId) => !itemPoints[itemId])
    : CMS_PDGM_FUNCTIONAL_ITEM_IDS_CY2026;
  if (!itemPoints || !functionalThresholds) missing.push("CMS functional points/thresholds");
  if (missingPointTables.length) {
    missing.push(`CMS functional point table(s): ${missingPointTables.join(", ")}`);
  }
  if (!m1033) missing.push("CMS M1033 ten-flag scoring configuration");
  if (!fp) missing.push("all CMS functional responses (M1033 and M1800-M1860)");
  if (fp && fp.missing.length) missing.push(`missing functional response(s): ${fp.missing.join(", ")}`);
  if (fp && fp.unmapped.length) missing.push(`unmapped functional response(s): ${fp.unmapped.join(", ")}`);
  if (fp && fp.inconsistent.length) {
    missing.push(`inconsistent functional response(s): ${fp.inconsistent.join("; ")}`);
  }
  if (itemPoints && functionalThresholds && !missingPointTables.length && m1033
    && fp && fp.missing.length === 0 && fp.unmapped.length === 0 && fp.inconsistent.length === 0
    && !functionalLevel) {
    missing.push("functional level (no valid thresholds for this clinical group)");
  }

  if (!comorbidity || !comorbidity.subgroups || !Array.isArray(comorbidity.interactions)
    || !comorbidity.lowSubgroups) {
    missing.push("CMS comorbidity subgroup/low-flag/interaction tables");
  }
  if (!caseMixTable) missing.push("CMS case-mix weight/HIPPS table");

  // These gaps are intentionally unconditional. Direct table lookups are
  // useful for deterministic test work but are not equivalent to the full
  // HHGS validity rules, so no input may currently produce a billable result.
  missing.push(...unsupported);

  let caseMix = null;
  if (missing.length === 0) {
    caseMix = lookupCaseMix({ timing, admissionSource, clinicalGroup, functionalLevel, comorbidityLevel }, caseMixTable);
    if (!caseMix || typeof caseMix.hipps !== "string" || !/^[A-Z0-9]{5}$/.test(caseMix.hipps)
      || typeof caseMix.weight !== "number" || !Number.isFinite(caseMix.weight) || caseMix.weight <= 0) {
      missing.push("valid CMS case-mix weight/HIPPS entry for this combination");
      caseMix = null;
    }
  }

  return {
    complete: missing.length === 0,
    missing,
    unsupported,
    timing,
    admissionSource,
    clinicalGroup,
    functionalPoints: fp && typeof fp.points === "number" ? fp.points : null,
    functionalLevel,
    comorbidityLevel,
    hipps: caseMix ? caseMix.hipps : null,
    caseMixWeight: caseMix ? caseMix.weight : null,
  };
}
