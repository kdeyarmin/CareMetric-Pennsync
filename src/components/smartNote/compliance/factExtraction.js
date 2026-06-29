// Deterministic clinical-fact extraction. Pure functions only — no React, no
// network — so this module is unit-testable under `node --test` and runs
// offline. Several helpers are lifted verbatim from existing components
// (OASISScrubber, VitalSignValidator) so there is a single source of truth.
//
// IMPORTANT: this file is loaded by the node test runner, so it may only import
// other plain `.js` modules with explicit extensions (never `.jsx`).
import { MEDICAL_TERMS } from "../../utils/medicalDictionary.js";

// ── Sentence / phrase helpers (lifted from OASISScrubber.jsx) ──────────────

/** Split free text into trimmed sentences, also breaking on newlines/bullets. */
export function splitSentences(text) {
  if (!text) return [];
  return text
    .split(/[.!?\n]+/)
    .map((s) => s.replace(/^[\s•\-*–·]+/, "").trim())
    .filter((s) => s.length > 0);
}

/** Return phrases matching `pattern` (length > 5), trimmed. */
export function extractPhrases(text, pattern) {
  if (!text) return [];
  const matches = text.match(pattern) || [];
  return matches.map((m) => m.trim()).filter((m) => m.length > 5);
}

/** Return up to 5 full sentences that match `pattern`. */
export function getSentencesContaining(text, pattern) {
  if (!text) return [];
  const sentences = text.split(/[.!?]+/).filter((s) => s.trim().length > 0);
  return sentences
    .filter((s) => { pattern.lastIndex = 0; return pattern.test(s); })
    .map((s) => s.trim() + ".")
    .slice(0, 5);
}

// ── Vital signs (moved from VitalSignValidator.jsx; re-imported there) ──────

/** Extract vitals (bp_sys/bp_dia/hr/o2/temp/rr/weight) from free text. */
export function extractVitals(text) {
  const vitals = {};
  if (!text) return vitals;

  // Anchor the systolic/diastolic groups with digit lookarounds so a typo like
  // "1148/90" can't be silently read as 148/90 (dropping the leading digit).
  const bpMatch = text.match(/bp\s*(?<!\d)(\d{2,3})\/(\d{2,3})(?!\d)/i) || text.match(/(?<!\d)(\d{2,3})\/(\d{2,3})(?!\d)/);
  if (bpMatch) {
    const sys = parseInt(bpMatch[1]);
    const dia = parseInt(bpMatch[2]);
    // Guard the unlabeled "nn/nn" fallback against dates ("11/20") and other
    // ratios: only accept physiologically plausible systolic/diastolic values.
    if (sys >= 60 && sys <= 300 && dia >= 30 && dia <= 200 && sys > dia) {
      vitals.bp_sys = sys;
      vitals.bp_dia = dia;
    }
  }

  // Anchor the trailing edge like BP above so a typo like "hr 1100" can't be
  // silently truncated to a plausible-looking 110 (dropping the extra digit).
  // Tolerate a colon separator ("HR: 82") like the BP/O2 patterns — a very common
  // EMR/dictation style that otherwise dropped the value entirely.
  const hrMatch = text.match(/(?:hr|heart\s*rate)\s*:?\s*(\d{2,3})(?!\d)/i);
  if (hrMatch) vitals.hr = parseInt(hrMatch[1]);

  // Allow the filler words nurses routinely write between the keyword and the
  // value ("O2 sat 85%", "SpO2 of 86%", "pulse ox 88%", "O2 sat: 90%").
  // Without this only the bare "O2 85%" form matched, so the severe-hypoxia
  // escalation was silently missed for the most common SpO2 phrasings.
  const o2Match =
    text.match(/(?:o2|spo2|oxygen|pulse\s*ox)\s*(?:sat(?:uration)?)?\s*(?:of)?\s*:?\s*(\d{2,3})\s*%/i) ||
    text.match(/(\d{2,3})\s*%\s*(?:on\s+)?(?:ra\b|o2\b|room\s*air)/i);
  if (o2Match) vitals.o2 = parseInt(o2Match[1]);

  // Anchor the "t" shorthand with word boundaries so it can't match the
  // trailing "t" of unrelated words ("weight 150" must NOT read as temp 150).
  // Full spellings ("Temp:", "Temperature:") support a colon; the bare single-letter
  // "t" shorthand only matches its space-adjacent numeric form ("T 98.6") — allowing
  // a colon on bare "t" would misread generic "T:" list labels as a temperature.
  const tempMatch = text.match(/(?:\btemp\b|temperature)\s*:?\s*(\d{2,3}(?:\.\d)?)|\bt\b\s+(\d{2,3}(?:\.\d)?)/i);
  if (tempMatch) {
    const t = parseFloat(tempMatch[1] ?? tempMatch[2]);
    if (t > 90) vitals.temp = t;
  }

  // \brr\b is word-anchored so a word ending in "rr" before a colon ("corr: 5")
  // can't be misread as a respiratory rate.
  const rrMatch = text.match(/(?:\brr\b|resp(?:iratory)?\s*rate)\s*:?\s*(\d{1,2})/i);
  if (rrMatch) vitals.rr = parseInt(rrMatch[1]);

  const wtMatch = text.match(/(?:wt|weight)\s*:?\s*(\d{2,3}(?:\.\d)?)\s*(?:lbs?|kg)?/i);
  if (wtMatch) vitals.weight = parseFloat(wtMatch[1]);

  return vitals;
}

/**
 * Format the canonical structured `vital_signs` object (the shape produced by
 * VitalSignsForm: blood_pressure_systolic/diastolic, heart_rate, respiratory_rate,
 * oxygen_saturation, temperature, pain_level) into ONE factual sentence.
 *
 * The token spellings here are deliberately chosen to match the patterns
 * extractNumbersAndMeasurements / extractVitals already recognize ("BP 148/90",
 * "HR 82 bpm", "O2 95%", "Temp 98.6°F", "RR 16 breaths/min", "pain 3/10") so the
 * sentence survives the value-guard when it is whitelisted as source material —
 * exactly like the deterministic trend summary. Emits only fields that are
 * present; returns "" when nothing was captured.
 */
export function formatVitalsSentence(vitals) {
  if (!vitals || typeof vitals !== "object") return "";
  const num = (v) => {
    if (v === null || v === undefined || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const sys = num(vitals.blood_pressure_systolic);
  const dia = num(vitals.blood_pressure_diastolic);
  const hr = num(vitals.heart_rate);
  const rr = num(vitals.respiratory_rate);
  const o2 = num(vitals.oxygen_saturation);
  const temp = num(vitals.temperature);
  const pain = num(vitals.pain_level);
  const parts = [];
  if (sys !== null && dia !== null) parts.push(`BP ${sys}/${dia} mmHg`);
  if (hr !== null) parts.push(`HR ${hr} bpm`);
  if (rr !== null) parts.push(`RR ${rr} breaths/min`);
  if (o2 !== null) parts.push(`O2 ${o2}%`);
  if (temp !== null) parts.push(`Temp ${temp}°F`);
  if (pain !== null) parts.push(`pain ${pain}/10`);
  if (!parts.length) return "";
  return `Vital signs: ${parts.join(", ")}.`;
}

/**
 * Map the legacy StructuredNoteDrafter vitals shape (bp_systolic, bp_diastolic,
 * heart_rate, resp_rate, o2_sat, temperature, pain_level — `weight` is not part of
 * the canonical vital_signs shape and is intentionally dropped) to the canonical
 * `vital_signs` shape that VitalSignsForm + formatVitalsSentence use. String inputs
 * are parsed to numbers; blanks become null. Returns null when no canonical vital
 * is set, so callers can skip threading an empty object.
 */
/**
 * Canonical vital_signs shape (all fields optional/finite numbers). Declared so
 * checkJs infers a concrete return type for the vitals helpers below instead of
 * the empty `{}` an inline object literal would widen to — otherwise callers that
 * read a field off the merged result fail typecheck (TS2339).
 * @typedef {Object} CanonicalVitals
 * @property {number} [blood_pressure_systolic]
 * @property {number} [blood_pressure_diastolic]
 * @property {number} [heart_rate]
 * @property {number} [respiratory_rate]
 * @property {number} [oxygen_saturation]
 * @property {number} [temperature]
 * @property {number} [pain_level]
 */

// Keep only finite numeric fields; return null if nothing usable remains. Omitting
// (rather than nulling) absent fields lets callers merge two sources per-key with a
// plain spread.
/**
 * @param {Record<string, number|null|undefined>} obj
 * @returns {CanonicalVitals | null}
 */
function compactVitals(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== null && v !== undefined && Number.isFinite(v)) out[k] = v;
  }
  return Object.keys(out).length ? out : null;
}

export function toCanonicalVitalSigns(legacy) {
  if (!legacy || typeof legacy !== "object") return null;
  const num = (v) => (v !== null && v !== undefined && String(v).trim() !== "" ? parseFloat(v) : null);
  return compactVitals({
    blood_pressure_systolic: num(legacy.bp_systolic),
    blood_pressure_diastolic: num(legacy.bp_diastolic),
    heart_rate: num(legacy.heart_rate),
    respiratory_rate: num(legacy.resp_rate),
    oxygen_saturation: num(legacy.o2_sat),
    temperature: num(legacy.temperature),
    pain_level: num(legacy.pain_level),
  });
}

/**
 * Extract canonical vital_signs from FREE TEXT (e.g. a nurse-edited draft line),
 * reusing extractVitals plus an explicit pain parse. The point is that when a draft
 * is hand-edited, the text — not a separate form-state object — is the source of
 * truth, so the saved vital_signs can never diverge from what the note actually says.
 * Returns null when no vital is found.
 */
export function extractCanonicalVitalsFromText(text) {
  if (!text) return null;
  const v = extractVitals(text);
  const pain = text.match(/\bpain\b\s*:?\s*(\d{1,2})\s*\/\s*10/i);
  return compactVitals({
    blood_pressure_systolic: v.bp_sys ?? null,
    blood_pressure_diastolic: v.bp_dia ?? null,
    heart_rate: v.hr ?? null,
    respiratory_rate: v.rr ?? null,
    oxygen_saturation: v.o2 ?? null,
    temperature: v.temp ?? null,
    pain_level: pain ? parseInt(pain[1], 10) : null,
  });
}

// ── Value extraction for the hallucination value-guard ─────────────────────
// We intentionally extract only UNIT-BEARING / clinically-significant values
// (vitals, doses, measurements, scores) rather than every bare integer, so the
// guard does not false-positive on prose counts like "2 times daily".

const MEASUREMENT_PATTERNS = [
  /\b\d{2,3}\/\d{2,3}\b/g, // blood pressure
  /\b\d{1,3}\s?%/g, // percentages (O2 sat, etc.)
  /\b\d{1,3}\s?x\s?\d{1,3}(?:\.\d+)?\s?(?:cm|mm)\b/gi, // wound dimensions 2x3 cm
  // Single measurement, but NOT the second operand of an "NxM cm" dimension: a
  // faithful rewrite that normalizes spacing ("4x5 cm" -> "4 x 5 cm") must not
  // make the guard extract a spurious "5cm" token that the source lacks and then
  // flag the correct note as a hallucinated value. We *consume* an optional
  // leading "<digit> x " instead of using a lookbehind — String.match returns the
  // whole match, so "4 x 5 cm" normalizes to the same "4x5cm" token the dimension
  // pattern already emits (no spurious "5cm"), while a standalone "5 cm" still
  // matches with an empty prefix. (Lookbehind is avoided because it throws a
  // SyntaxError in Safari < 16.4.)
  /(?:\d\s?x\s?)?\b\d+(?:\.\d+)?\s?(?:cm|mm)\b/gi, // single measurement
  /\b\d+(?:\.\d+)?\s?(?:mg|mcg|g|ml|units?|iu|tab(?:lets?)?|cc)\b/gi, // doses
  /\b\d{1,2}\/10\b/g, // pain / rating scales
  /\b\d{2,3}\s?(?:bpm|beats)/gi, // heart rate
  /\b\d{1,2}\s?(?:breaths|rpm)/gi, // resp rate
  /\b\d{2,3}(?:\.\d)?\s?(?:lbs?|kg)\b/gi, // weight
  /\b\d{2,3}(?:\.\d)?\s?°?\s?f\b/gi, // temperature in F
];

/** Normalize a measurement token for set comparison (lowercase, no spaces). */
function normalizeToken(t) {
  // Drop the degree symbol too so "98.6 F" and "98.6°F" reduce to the same
  // token — otherwise the value-guard flags a faithful °-adding rewrite as a
  // hallucinated value.
  return t.toLowerCase().replace(/[\s°]+/g, "");
}

/** Extract normalized measurement/value tokens from text. */
export function extractNumbersAndMeasurements(text) {
  if (!text) return [];
  const found = [];
  const add = (t) => {
    const n = normalizeToken(t);
    if (!found.includes(n)) found.push(n);
  };
  for (const pat of MEASUREMENT_PATTERNS) {
    const matches = text.match(pat) || [];
    matches.forEach(add);
  }
  // Also fold in labeled vitals so "BP 148/90" and "blood pressure of 148/90"
  // both reduce to comparable component numbers.
  const v = extractVitals(text);
  if (v.bp_sys && v.bp_dia) add(`${v.bp_sys}/${v.bp_dia}`);
  if (v.o2) add(`${v.o2}%`);
  return found;
}

// ── Medication extraction (uses the shared medical dictionary) ──────────────

// `common_mishears` is a mishear→correction map whose values include diagnoses and
// symptoms (Hypertension, Pneumonia, Nausea, Fever, …), not just drugs. Fold in only
// the entries that correct to an actual medication, so symptom words aren't reported
// as medications by extractMedications (which would corrupt valueGuard / chartCrossCheck).
const MED_SET = new Set(MEDICAL_TERMS.medications.map((m) => m.toLowerCase()));
const MED_NAMES = [
  ...MEDICAL_TERMS.medications,
  ...Object.values(MEDICAL_TERMS.common_mishears).filter((v) => MED_SET.has(v.toLowerCase())),
];
// De-dupe canonical names case-insensitively (so "Atorvastatin" and the
// "statin"→"atorvastatin" mishear entry don't both survive), longest first so
// "atorvastatin" wins over "statin".
const UNIQUE_MEDS = (() => {
  const seen = new Set();
  const out = [];
  for (const m of MED_NAMES) {
    const key = m.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(m);
  }
  return out.sort((a, b) => b.length - a.length);
})();

/** Return the list of known medication names mentioned in `text` (canonical). */
export function extractMedications(text) {
  if (!text) return [];
  const found = [];
  for (const med of UNIQUE_MEDS) {
    const re = new RegExp(`\\b${med.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    if (re.test(text) && !found.includes(med)) found.push(med);
  }
  return found;
}

// ── Reusable clinical presence patterns (consumed by presenceDetection) ─────
export const CLINICAL_PATTERNS = {
  homebound: /homebound|unable to leave|leaving home requires|considerable (?:and )?taxing effort|confined to (?:home|residence)|without assistance.*leave|taxing effort/i,
  skilledNeed: /skilled (?:need|nursing|assessment|service|intervention)|requires the skill|wound care|medication management|teaching|assessment of|observation and assessment|skilled observation/i,
  teachBack: /verbali[sz]ed understanding|teach[- ]?back|demonstrated understanding|able to (?:repeat|state|demonstrate)|return demonstration/i,
  patientResponse: /tolerated|responded|patient (?:reports?|states?|denies|verbali|able to)|no adverse|improvement noted|response to/i,
  education: /educat|taught|instruct|reviewed with|reinforced|provided teaching/i,
  safety: /fall|safety|hazard|clutter|throw rug|grab bar|environment/i,
  pain: /pain|discomfort|ache|tender|\d\/10/i,
  medication: /medication|med (?:list|reconcil)|drug|dose|prescrib/i,
  plan: /plan|next visit|follow[- ]?up|return|notify physician|continue|will (?:re)?assess/i,
  vitals: /\bbp\b|blood pressure|\bhr\b|heart rate|\bo2\b|oxygen|spo2|\btemp\b|temperature|respir|\brr\b|weight/i,
};
