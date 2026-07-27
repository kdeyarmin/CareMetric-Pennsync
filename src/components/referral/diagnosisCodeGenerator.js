// Deterministic diagnosis-code generator for the referral analyzer.
//
// ── Codes are NEVER invented ──────────────────────────────────────────────────
// The only candidate ICD-10 codes are ones literally present in the extracted
// referral data (dedicated code fields or diagnosis text). A diagnosis that is
// documented WITHOUT a code is surfaced in `uncoded` for a human coder — this
// module never maps a description to a code, because that mapping is exactly
// where fabrication happens.
//
// ── Sequencing follows the app's canonical PDGM model ─────────────────────────
// The verified codes are sequenced claim-style (M1021 principal first, then
// M1023 secondaries) using the same tables the live `calculatePDGM` backend
// uses: the admin-editable ICD-10 prefix → clinical-group map and case-mix
// weights from pdgmRates.js (agency overrides via PDGMRateConfig merge over the
// defaults). The principal slot goes to the RTP-acceptable code whose clinical
// group carries the highest case-mix weight for this referral's admission
// source/timing bucket; remaining codes are ordered by descending weight.
//
// Pure + offline (unit-tested with `node --test`); no React, no Base44 SDK,
// no `@/` imports so the colocated Node test resolves without Vite.

import {
  DEFAULT_PDGM_RATES,
  mergePdgmRates,
  effectiveIcdGroups,
} from "../pdgm/pdgmRates.js";
import { normalizeIcd, validatePrimaryDiagnosis } from "./intakeDiagnosisValidator.js";

// Dotted ICD-10 (e.g. I50.9, C4A.10, U07.1) — safe to harvest from free text.
const ICD_DOTTED = /\b([A-Z][0-9][0-9A-Z])\.([0-9A-Z]{1,4})\b/g;
// Bare ICD-10 (e.g. I10, J449) harvested from free text. Stricter than the
// dotted/dedicated-field shapes: positions 2-3 must be DIGITS, so clinical
// abbreviations shaped like codes (T2DM, D5W, L4L5) are never mistaken for
// one. The trade-off: alpha-category codes (C4A, M1A, Z3A) are only harvested
// from prose in dotted form or from dedicated code fields.
const ICD_BARE = /\b([A-Z][0-9]{2}[0-9A-Z]{0,4})\b/g;
// Full-string validity check for dedicated code fields (dot optional).
const ICD_EXACT = /^[A-Z][0-9][0-9A-Z](?:\.?[0-9A-Z]{1,4})?$/;

/** True when `text`, as a whole trimmed field, is a single ICD-10 code. */
export function isIcdCode(text) {
  return ICD_EXACT.test(String(text || "").trim().toUpperCase());
}

// Words that precede a code-shaped token when it is NOT a diagnosis code.
// Includes med-administration context so "amp of D50" / "bolus of D25" (IV
// dextrose) isn't harvested as an anemia code (D50 = iron-deficiency anemia).
const NON_CODE_PRECEDING = /(?:vitamin|vit\.?|room|rm\.?|apt\.?|unit|iv|amp(?:ule)?s?(?:\s+of)?|bolus(?:\s+of)?|push(?:ed)?|gave|administered)\s*$/i;
// Code-shaped tokens that are never diagnosis codes. B12 is not assigned in
// ICD-10-CM (the B11–B14 block is unused), so a bare "B12" in referral prose is
// always the vitamin ("B12 deficiency anemia") — harvesting it fabricated an
// infectious-disease principal that outweighed the real documented primary.
const NON_CODE_TOKENS = new Set(["D5W", "D10W", "D25W", "D50W", "D5NS", "D5LR", "B12"]);

// Bare letter+digits tokens that are VERTEBRAL LEVELS, not codes, when the
// number is within the anatomic range for that spine segment ("T12 compression
// fracture", "fracture at T10-T11"). Dotted forms and dedicated code fields
// are unaffected; a bare token past the anatomic max (e.g. C50, S72) still
// harvests. (Single-digit levels like L4/T9 never matched the bare-code shape.)
const VERTEBRAL_MAX = { C: 7, T: 12, L: 5, S: 5 };
function looksLikeVertebralLevel(token) {
  const m = /^([CTLS])(\d{2})$/i.exec(token);
  if (!m) return false;
  const n = parseInt(m[2], 10);
  return n >= 1 && n <= (VERTEBRAL_MAX[m[1].toUpperCase()] || 0);
}

/**
 * Extract ICD-10 codes from a free-text field. Dotted codes are always taken;
 * bare (dot-less) codes are taken unless the token or its preceding words mark
 * it as a non-code (vitamin B12, room B12, IV D5W...).
 * @returns {Array<{code:string, raw:string}>} deduped normalized codes —
 *   dotted matches first (in text order), then bare matches (in text order)
 */
export function extractIcdCodesFromText(text) {
  const s = String(text || "");
  const out = [];
  const seen = new Set();
  const push = (raw) => {
    const code = normalizeIcd(raw);
    if (!seen.has(code)) {
      seen.add(code);
      out.push({ code, raw });
    }
  };
  for (const m of s.matchAll(ICD_DOTTED)) push(m[0]);
  for (const m of s.matchAll(ICD_BARE)) {
    // Skip the stem of a dotted code (the "I50" inside "I50.9") — but only when
    // the dotted pass ACTUALLY matched here. A sentence period with no space
    // ("Primary dx I10.Ambulates…", common OCR artifact) is not a dotted code,
    // and skipping on the bare period discarded the genuine I10.
    if (/^[A-Z][0-9][0-9A-Z]\.[0-9A-Z]{1,4}\b/.test(s.slice(m.index))) continue;
    if (NON_CODE_TOKENS.has(m[0].toUpperCase())) continue;
    if (looksLikeVertebralLevel(m[0])) continue;
    if (NON_CODE_PRECEDING.test(s.slice(0, m.index))) continue;
    push(m[0]);
  }
  return out;
}

/** Human-readable description left over once codes/punctuation are stripped. */
function stripCodes(text) {
  return String(text || "")
    .replace(ICD_DOTTED, " ")
    .replace(/\bICD[- ]?10(?:[- ]?CM)?:?\s*/gi, " ")
    .replace(/[()[\]]/g, " ")
    .replace(/\s{2,}/g, " ")
    .replace(/^[\s\-–—:,;.]+|[\s\-–—:,;.]+$/g, "")
    .trim();
}

// The referral fields the harvester reads, as [path, isPrimaryContext,
// isDedicatedCodeField]. Scoped to diagnosis-bearing fields on purpose — a
// whole-document scan would misread dosages, room numbers, etc. as codes.
// Covers both extraction shapes from referralExtraction.js (full clinical
// extraction and the quick categorization scan).
const HARVEST_FIELDS = [
  ["diagnoses.primary_icd10", true, true],
  ["diagnoses.primary_diagnosis", true, false],
  ["diagnoses.secondary_diagnoses[]", false, false],
  ["diagnoses.comorbidity_adjustments[]", false, false],
  ["oasis_assessment.m1021_primary_diagnosis", true, false],
  ["oasis_assessment.m1023_other_diagnoses[]", false, false],
  ["psychosocial.mental_health_assessment.psychiatric_diagnoses[]", false, false],
  // Quick-scan shape: raw scan output (top-level fields) AND the persisted
  // Referral.extracted_data shape ReferralIntake.handleCreateReferral writes
  // (codes nested under diagnoses.icd10_codes).
  ["primary_diagnosis", true, false],
  ["secondary_diagnoses[]", false, false],
  ["icd10_codes[]", false, true],
  ["diagnoses.icd10_codes[]", false, true],
];

function getPath(obj, dotted) {
  let cur = obj;
  for (const key of dotted.split(".")) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = cur[key];
  }
  return cur;
}

/**
 * Harvest every documented diagnosis from the extracted referral data.
 *
 * @returns {{
 *   candidates: Array<{code:string, description:string, documentedAsPrimary:boolean,
 *                      evidence:Array<{path:string, text:string}>}>,
 *   uncoded: Array<{description:string, path:string, documentedAsPrimary:boolean}>,
 * }} candidates carry only codes found verbatim in the referral; `uncoded` are
 *    diagnosis texts documented without any ICD-10 code (coder work, never
 *    auto-coded here).
 */
export function harvestDiagnosisCandidates(referralData) {
  const byCode = new Map();
  const uncoded = [];
  const uncodedSeen = new Set();
  if (!referralData || typeof referralData !== "object") {
    return { candidates: [], uncoded };
  }

  const record = (text, path, isPrimary, isCodeField) => {
    const raw = String(text ?? "").trim();
    if (!raw) return;
    // Dedicated code fields accept bare 3-char codes as the whole value
    // (e.g. primary_icd10: "I10"); free text goes through the guarded scan.
    const found = isCodeField && isIcdCode(raw)
      ? [{ code: normalizeIcd(raw), raw }]
      : extractIcdCodesFromText(raw);

    if (found.length === 0) {
      // A named diagnosis with no code anywhere in the field → coder queue.
      const desc = stripCodes(raw);
      const key = desc.toLowerCase();
      if (desc && !uncodedSeen.has(key)) {
        uncodedSeen.add(key);
        uncoded.push({ description: desc, path, documentedAsPrimary: isPrimary });
      }
      return;
    }
    const description = stripCodes(raw.replace(new RegExp(found.map((f) => f.raw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "g"), " "));
    for (const { code } of found) {
      const existing = byCode.get(code);
      if (existing) {
        existing.documentedAsPrimary = existing.documentedAsPrimary || isPrimary;
        existing.evidence.push({ path, text: raw });
        if (description.length > existing.description.length) existing.description = description;
      } else {
        byCode.set(code, {
          code,
          description,
          documentedAsPrimary: isPrimary,
          evidence: [{ path, text: raw }],
        });
      }
    }
  };

  for (const [spec, isPrimary, isCodeField] of HARVEST_FIELDS) {
    const isArray = spec.endsWith("[]");
    const path = isArray ? spec.slice(0, -2) : spec;
    const value = getPath(referralData, path);
    if (value === undefined || value === null) continue;
    if (isArray && Array.isArray(value)) {
      value.forEach((item, i) => record(item, `${path}[${i}]`, isPrimary, isCodeField));
    } else if (!isArray) {
      record(value, path, isPrimary, isCodeField);
    }
  }

  // A description already covered by a coded candidate shouldn't sit in the
  // coder queue too (e.g. m1021 text "CHF" when primary_icd10 carried I50.9's
  // paired description elsewhere is still ambiguous — only drop exact matches).
  const codedDescriptions = new Set(
    [...byCode.values()].map((c) => c.description.toLowerCase()).filter(Boolean)
  );
  const filteredUncoded = uncoded.filter((u) => !codedDescriptions.has(u.description.toLowerCase()));

  return { candidates: [...byCode.values()], uncoded: filteredUncoded };
}

/** Longest-prefix lookup into the ICD-10 → clinical-group map (same rule the
 *  calculatePDGM backend applies). Returns the group KEY or null. */
export function lookupClinicalGroup(code, icdGroups) {
  const norm = normalizeIcd(code);
  if (!norm || !icdGroups) return null;
  let bestKey = null;
  let bestLen = -1;
  for (const key of Object.keys(icdGroups)) {
    const p = normalizeIcd(key);
    if (p && norm.startsWith(p) && p.length > bestLen) {
      bestLen = p.length;
      bestKey = key;
    }
  }
  return bestKey ? icdGroups[bestKey] || null : null;
}

/** Pretty label for a clinical-group key (MMTA_Cardiac_Circulatory → "Cardiac Circulatory"). */
export function formatClinicalGroup(groupKey) {
  if (!groupKey) return "Unmapped";
  return String(groupKey).replace(/^MMTA_/, "").replace(/_/g, " ");
}

const INSTITUTIONAL_SOURCE = /hospital|inpatient|acute|snf|skilled\s*nursing|nursing\s*facility|rehab|ltach|ltch|irf|institution/i;

/**
 * PDGM scenario for a referral: a referral drives the FIRST 30-day period, so
 * timing is "early"; admission source is read off the extracted
 * admission_details (institutional stays vs community).
 */
export function resolveScenario(referralData) {
  const source = String(referralData?.admission_details?.admission_source || referralData?.referral_source || "");
  const admissionSource = INSTITUTIONAL_SOURCE.test(source) ? "institutional" : "community";
  return {
    timing: "early",
    admissionSource,
    bucket: `${admissionSource}_early`,
    sourceText: source || null,
  };
}

/**
 * Generate the PDGM-sequenced diagnosis code list for a referral.
 *
 * @param {object} referralData extracted referral data (referralExtraction.js shape)
 * @param {object} [opts]
 * @param {object} [opts.rates] saved PDGMRateConfig.rates (merged over defaults)
 * @param {object} [opts.icdGroups] saved PDGMRateConfig.icd10_clinical_groups
 * @returns {{
 *   sequenced: Array<{position:number, role:'primary'|'secondary', code:string,
 *     displayCode:string, description:string, clinicalGroupKey:string|null,
 *     clinicalGroup:string, caseMixWeight:number|null, acceptablePrimary:boolean,
 *     rtpReason:string|null, documentedAsPrimary:boolean, evidence:Array}>,
 *   primary: object|null, secondaries: Array, uncoded: Array,
 *   scenario: object, warnings: Array<string>, hasCodes: boolean,
 * }}
 */
export function generateDiagnosisCodes(referralData, opts = {}) {
  const rates = mergePdgmRates(opts.rates, opts.defaults || DEFAULT_PDGM_RATES);
  const icdGroups = effectiveIcdGroups(opts.icdGroups);
  const scenario = resolveScenario(referralData);
  const { candidates, uncoded } = harvestDiagnosisCandidates(referralData);
  const warnings = [];

  const annotated = candidates.map((c) => {
    const rtp = validatePrimaryDiagnosis(c.code);
    const clinicalGroupKey = lookupClinicalGroup(c.code, icdGroups);
    const weight = clinicalGroupKey
      ? rates.clinicalGroupWeights?.[clinicalGroupKey]?.[scenario.bucket]
      : undefined;
    return {
      ...c,
      displayCode: formatIcd(c.code),
      acceptablePrimary: rtp.acceptable,
      rtpReason: rtp.acceptable ? null : rtp.reason,
      clinicalGroupKey,
      clinicalGroup: formatClinicalGroup(clinicalGroupKey),
      caseMixWeight: typeof weight === "number" && Number.isFinite(weight) ? weight : null,
    };
  });

  // Principal: RTP-acceptable + grouped + weighted, highest weight first.
  // Deterministic tie-breaks: documented-as-primary, more specific (longer)
  // code, then code order.
  const byPrimaryFitness = (a, b) =>
    (b.caseMixWeight ?? -1) - (a.caseMixWeight ?? -1) ||
    Number(b.documentedAsPrimary) - Number(a.documentedAsPrimary) ||
    b.code.length - a.code.length ||
    a.code.localeCompare(b.code);

  const eligible = annotated
    .filter((c) => c.acceptablePrimary && c.clinicalGroupKey && c.caseMixWeight !== null)
    .sort(byPrimaryFitness);
  const primary = eligible[0] || null;

  const secondaries = annotated
    .filter((c) => c !== primary)
    .sort(
      (a, b) =>
        (b.caseMixWeight ?? -1) - (a.caseMixWeight ?? -1) ||
        a.code.localeCompare(b.code)
    );

  const sequenced = (primary ? [primary, ...secondaries] : secondaries).map((c, i) => ({
    ...c,
    position: i + 1,
    role: primary && i === 0 ? "primary" : "secondary",
  }));

  if (annotated.length === 0) {
    warnings.push(
      "No ICD-10 codes are documented in this referral. Codes are never auto-generated — obtain coded diagnoses from the referral source or a certified coder."
    );
  } else if (!primary) {
    warnings.push(
      "None of the documented codes is acceptable as a PDGM principal diagnosis (RTP risk). A compliant principal diagnosis is needed before billing."
    );
  }
  const documentedPrimary = annotated.find((c) => c.documentedAsPrimary);
  if (primary && documentedPrimary && documentedPrimary.code !== primary.code) {
    warnings.push(
      `Referral documents ${documentedPrimary.displayCode} as primary, but ${primary.displayCode} sequences first under the PDGM model (higher case-mix weight, ${scenario.bucket.replace("_", "/")} period). Verify clinical appropriateness before re-sequencing.`
    );
  }
  for (const c of annotated) {
    if (!c.clinicalGroupKey) {
      warnings.push(
        `${c.displayCode} is not in the agency's ICD-10 → clinical-group map, so it cannot be weighted. An admin can map it on the PDGM Rate Settings page.`
      );
    }
  }
  if (uncoded.length > 0) {
    warnings.push(
      `${uncoded.length} diagnosis${uncoded.length === 1 ? " is" : "es are"} documented without an ICD-10 code and need${uncoded.length === 1 ? "s" : ""} coder assignment.`
    );
  }

  return {
    sequenced,
    primary,
    secondaries,
    uncoded,
    scenario,
    warnings,
    hasCodes: annotated.length > 0,
  };
}

/** Re-dot a normalized ICD-10 code for display (I509 → I50.9). */
export function formatIcd(code) {
  const norm = normalizeIcd(code);
  return norm.length > 3 ? `${norm.slice(0, 3)}.${norm.slice(3)}` : norm;
}

/** "I50.9 — Heart failure" label for chart/report text fields. */
export function codeLabel(dx) {
  if (!dx) return "";
  return dx.description ? `${dx.displayCode} — ${dx.description}` : dx.displayCode;
}

/**
 * Lean, persistence-ready shape of a generateDiagnosisCodes result for the
 * top-level `Referral.diagnosis_coding` field. Kept OFF `extracted_data` on
 * purpose: the referral→admission-note bridges prompt on the full
 * extracted_data object, and coding/reimbursement mechanics must not leak
 * into generated clinical notes. Evidence is reduced to field paths; the full
 * quotes stay in the interactive UI only.
 */
export function toPersistedCoding(result) {
  if (!result) return null;
  return {
    sequenced: result.sequenced.map((dx) => ({
      position: dx.position,
      role: dx.role,
      code: dx.displayCode,
      description: dx.description,
      clinical_group: dx.clinicalGroupKey,
      case_mix_weight: dx.caseMixWeight,
      acceptable_primary: dx.acceptablePrimary,
      evidence_paths: dx.evidence.map((e) => e.path),
    })),
    uncoded: result.uncoded.map((u) => ({ description: u.description, path: u.path })),
    warnings: result.warnings,
    scenario: { timing: result.scenario.timing, admission_source: result.scenario.admissionSource },
    // Two distinct facts, kept separate: an RTP-acceptable principal CANDIDATE
    // exists vs the sequencer actually CHOSE a weighted PDGM primary (a
    // candidate can exist yet be unmapped/unweighted in the agency tables).
    has_acceptable_primary: result.sequenced.some((d) => d.acceptablePrimary),
    has_pdgm_primary: !!result.primary,
  };
}
