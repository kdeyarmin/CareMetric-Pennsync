// CMS Medicare Beneficiary Identifier (MBI) format validation.
//
// An MBI is 11 characters in the pattern C A AN N A AN N A A N N:
//   C  = digit 1-9 (never 0)
//   A  = uppercase letter EXCLUDING S, L, O, I, B, Z
//   N  = digit 0-9
//   AN = either A or N
// CMS defines NO check digit / checksum for the MBI, so this is format-only
// validation: a value that passes is "MBI-shaped", not verified eligible.
// Dashes, whitespace, and case are cosmetic (cards print e.g. 1EG4-TE5-MK73).
//
// Pure + offline (unit-tested with `node --test`).

// Letters CMS allows in an MBI (A-Z minus S, L, O, I, B, Z).
export const MBI_ALLOWED_LETTERS = "ACDEFGHJKMNPQRTUVWXY";

const EXCLUDED_LETTERS = new Set(["S", "L", "O", "I", "B", "Z"]);

const isC = (ch) => ch >= "1" && ch <= "9";
const isN = (ch) => ch >= "0" && ch <= "9";
const isA = (ch) => MBI_ALLOWED_LETTERS.includes(ch);
const isAN = (ch) => isA(ch) || isN(ch);

// Per-position spec, index 0 = MBI position 1.
const POSITIONS = [
  { check: isC, expected: "a digit 1-9" },
  { check: isA, expected: "a letter" },
  { check: isAN, expected: "a letter or digit" },
  { check: isN, expected: "a digit" },
  { check: isA, expected: "a letter" },
  { check: isAN, expected: "a letter or digit" },
  { check: isN, expected: "a digit" },
  { check: isA, expected: "a letter" },
  { check: isA, expected: "a letter" },
  { check: isN, expected: "a digit" },
  { check: isN, expected: "a digit" },
];

/** Strip dashes/whitespace and uppercase — the canonical 11-char form. */
export function normalizeMbi(value) {
  return String(value ?? "").replace(/[\s-]+/g, "").toUpperCase();
}

/**
 * Validate a candidate MBI (format only — there is no MBI checksum).
 * @param {*} value  raw value; dashes/whitespace/case are normalized away
 * @returns {{ valid: boolean, normalized: string, errors: string[] }}
 */
export function validateMbi(value) {
  const normalized = normalizeMbi(value);
  const errors = [];

  if (!normalized) {
    return { valid: false, normalized, errors: ["No MBI value provided."] };
  }

  if (normalized.length !== 11) {
    errors.push(`MBI must be 11 characters after removing dashes/spaces (got ${normalized.length}).`);
    return { valid: false, normalized, errors };
  }

  POSITIONS.forEach((spec, i) => {
    const ch = normalized[i];
    if (spec.check(ch)) return;
    if (EXCLUDED_LETTERS.has(ch)) {
      errors.push(`Position ${i + 1} uses "${ch}" — the letters S, L, O, I, B, Z never appear in an MBI.`);
    } else {
      errors.push(`Position ${i + 1} must be ${spec.expected} (got "${ch}").`);
    }
  });

  return { valid: errors.length === 0, normalized, errors };
}

/**
 * Pull MBI-shaped candidates out of free text (e.g. an extracted
 * "policy_numbers" string that may mix several payers' IDs). A candidate is a
 * token that normalizes to exactly 11 characters, starts with a digit, and
 * mixes letters and digits — deliberately loose so near-miss MBIs (excluded
 * letters, digit/letter position swaps) surface for validateMbi to flag,
 * while pure-digit member IDs from other payers are ignored.
 * @param {*} text
 * @returns {string[]} candidate tokens as they appeared in the text
 */
export function findMbiCandidates(text) {
  const tokens = String(text ?? "").split(/[^A-Za-z0-9-]+/).filter(Boolean);
  const out = [];
  const isMbiShaped = (normalized) =>
    normalized.length === 11 &&
    isN(normalized[0]) && // MBIs always start with a digit
    /[A-Z]/.test(normalized) && /[0-9]/.test(normalized);
  for (const token of tokens) {
    if (isMbiShaped(normalizeMbi(token)) && !out.includes(token)) out.push(token);
  }
  // OCR pass: an MBI wrapped across a line break or printed with spaced groups
  // ("1EG4-\nTE5-MK73", "1EG4 TE5 MK73") never survives whitespace
  // tokenization. Join short consecutive token runs and keep any whose
  // concatenation is MBI-shaped — validateMbi still does the strict per-position
  // check, so a coincidental join can only surface as a flagged near-miss.
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].length > 8) continue;
    let joined = tokens[i];
    for (let k = 1; k <= 3 && i + k < tokens.length; k++) {
      if (tokens[i + k].length > 8) break;
      joined += tokens[i + k];
      const normalized = normalizeMbi(joined);
      if (normalized.length > 11) break;
      if (isMbiShaped(normalized) && !out.includes(normalized)) out.push(normalized);
    }
  }
  return out;
}

/** True when insurance text names traditional Medicare (or an MA variant). */
export function looksLikeMedicare(text) {
  return /medicare/i.test(String(text ?? ""));
}

/**
 * True when insurance text indicates a Medicare Advantage-type plan —
 * "medicare" alongside advantage/HMO/PPO wording. Deterministic keyword
 * match only; used for an advisory hint, never a coverage verdict.
 */
export function looksLikeMedicareAdvantage(text) {
  const s = String(text ?? "");
  return looksLikeMedicare(s) && /(advantage|\bhmo\b|\bppo\b)/i.test(s);
}
