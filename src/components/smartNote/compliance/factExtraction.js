// Deterministic clinical-fact extraction. Pure functions only — no React, no
// network — so this module is unit-testable under `node --test` and runs
// offline. Several helpers are lifted verbatim from existing components
// (OASISScrubber, VitalSignValidator) so there is a single source of truth.
//
// IMPORTANT: this file is loaded by the node test runner, so it may only import
// other plain `.js` modules with explicit extensions (never `.jsx`).
import { MEDICAL_TERMS } from "../../utils/medicalDictionary.js";

// ── Sentence / phrase helpers (lifted from OASISScrubber.jsx) ──────────────

/** Split free text into trimmed sentences, also breaking on newlines/bullets.
 * A period FOLLOWED BY A DIGIT is a decimal point ("Temp 98.6"), not a sentence
 * boundary — splitting there truncated evidence lines and made provenance /
 * grounding fragment decimal vitals into nonsense ("Temp 98" / "6°F").
 * Lookahead only (lookbehind throws in Safari < 16.4; see MEASUREMENT_PATTERNS). */
export function splitSentences(text) {
  if (!text) return [];
  return text
    .split(/[!?\n]+|\.(?!\d)/)
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
  // Decimal-safe like splitSentences: "98.6" is one value, not two sentences.
  const sentences = text.split(/[!?]+|\.(?!\d)/).filter((s) => s.trim().length > 0);
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

  // Anchor the systolic/diastolic groups with digit boundaries so a typo like
  // "1148/90" can't be silently read as 148/90 (dropping the leading digit). The
  // leading boundary is expressed by CONSUMING an optional non-digit (or start of
  // string) rather than a lookbehind — lookbehind throws a SyntaxError in Safari
  // < 16.4 (see MEASUREMENT_PATTERNS below), which would fail this whole module at
  // parse time. Group 1 = systolic, group 2 = diastolic in both patterns.
  const labeledBp = text.match(/bp\s*:?\s*(\d{2,3})\/(\d{2,3})(?!\d)/i);
  if (labeledBp) {
    const sys = parseInt(labeledBp[1]);
    const dia = parseInt(labeledBp[2]);
    // A LABELED reading gets only a sanity window — a nurse writing "BP 55/30,
    // patient unresponsive" documented a real (agonal) pressure, and dropping it
    // loses chart data and the hypotension escalation. ("BP 90/90" is also real.)
    if (sys >= 30 && sys <= 300 && dia >= 10 && dia <= 250) {
      vitals.bp_sys = sys;
      vitals.bp_dia = dia;
    }
  } else {
    // Unlabeled "nn/nn" fallback. Strip insulin mix-ratio phrases first
    // ("Novolin 70/30", "insulin aspart 70/30") — 70/30 sits inside the
    // plausibility window and was read as a phantom hypotensive BP that could
    // reach the saved vital_signs and trigger a false escalation.
    const bpSource = text.replace(/\b(?:novolin|humulin|novolog|humalog|insulin(?:\s+[a-z]+)?|mix(?:tard)?)\s*\d{2,3}\/\d{2,3}\b/gi, " ");
    const bpMatch = bpSource.match(/(?:^|\D)(\d{2,3})\/(\d{2,3})(?!\d)/);
    if (bpMatch) {
      const sys = parseInt(bpMatch[1]);
      const dia = parseInt(bpMatch[2]);
      // Guard the unlabeled fallback against dates ("11/20") and other ratios:
      // only accept physiologically plausible systolic/diastolic values.
      if (sys >= 60 && sys <= 300 && dia >= 30 && dia <= 200 && sys > dia) {
        vitals.bp_sys = sys;
        vitals.bp_dia = dia;
      }
    }
  }

  // Anchor the trailing edge like BP above so a typo like "hr 1100" can't be
  // silently truncated to a plausible-looking 110 (dropping the extra digit).
  // Tolerate a colon separator ("HR: 82") like the BP/O2 patterns — a very common
  // EMR/dictation style that otherwise dropped the value entirely.
  // Left word boundary so a frequency like "q4hr 150" or "24hr 125" can't have
  // its embedded "hr" read as a heart rate (phantom HR that would then whitelist
  // a hallucinated value in the guard).
  const hrMatch = text.match(/\b(?:hr|heart\s*rate)\s*:?\s*(\d{2,3})(?!\d)/i);
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
  // Trailing (?!\d) mirrors the BP/HR anchors: a typo like "temperature 1013"
  // must be dropped, not silently truncated to a plausible-looking 101.
  const tempMatch = text.match(/(?:\btemp\b|temperature)\s*:?\s*(\d{2,3}(?:\.\d)?)(?!\d)|\bt\b\s+(\d{2,3}(?:\.\d)?)(?!\d)/i);
  if (tempMatch) {
    const t = parseFloat(tempMatch[1] ?? tempMatch[2]);
    if (t > 90) vitals.temp = t;
  }

  // \brr\b is word-anchored so a word ending in "rr" before a colon ("corr: 5")
  // can't be misread as a respiratory rate; trailing (?!\d) so "rr 210" is
  // dropped rather than truncated to 21.
  const rrMatch = text.match(/(?:\brr\b|resp(?:iratory)?\s*rate)\s*:?\s*(\d{1,2})(?!\d)/i);
  if (rrMatch) vitals.rr = parseInt(rrMatch[1]);

  // Left \b so "underweight 15%" can't read as weight 15; trailing (?!\d) so
  // "weight 1800" is dropped rather than truncated to 180. Accepts the kg
  // spelling variants nurses actually write (kg/kgs/kilograms/lbs/pounds).
  const wtMatch = text.match(/\b(?:wt|weight)\s*:?\s*(\d{2,3}(?:\.\d)?)(?!\d)\s*(?:lbs?|pounds?|kgs?|kilograms?)?\b/i);
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
  // 3-D wound dimensions FIRST (L x W x D — the standard wound-care form). Without
  // this the guard tokenized "4 x 5 x 2 cm" as only "5x2cm", so a hallucinated
  // first dimension ("9 x 5 x 2 cm") passed the value-guard clean.
  /\b\d{1,3}(?:\.\d+)?\s?x\s?\d{1,3}(?:\.\d+)?\s?x\s?\d{1,3}(?:\.\d+)?\s?(?:cm|mm)\b/gi,
  /\b\d{1,3}(?:\.\d+)?\s?x\s?\d{1,3}(?:\.\d+)?\s?(?:cm|mm)\b/gi, // wound dimensions 2x3 cm / 2.5 x 3 cm
  // Single measurement, but NOT the second operand of an "NxM cm" dimension: a
  // faithful rewrite that normalizes spacing ("4x5 cm" -> "4 x 5 cm") must not
  // make the guard extract a spurious "5cm" token that the source lacks and then
  // flag the correct note as a hallucinated value. We *consume* an optional
  // leading "<digit> x " (possibly chained for 3-D forms) instead of using a
  // lookbehind — String.match returns the whole match, so "4 x 5 cm" normalizes
  // to the same "4x5cm" token the dimension pattern already emits (no spurious
  // "5cm"), while a standalone "5 cm" still matches with an empty prefix.
  // (Lookbehind is avoided because it throws a SyntaxError in Safari < 16.4.)
  /(?:\b\d{1,3}(?:\.\d+)?\s?x\s?(?:\d{1,3}(?:\.\d+)?\s?x\s?)?)?\b\d+(?:\.\d+)?\s?(?:cm|mm)\b/gi, // single measurement (whole first operand consumed, so "12 x 5 cm" never emits a spurious "2x5cm")
  /\b\d+(?:\.\d+)?\s?(?:mg|mcg|g|ml|units?|iu|u|tab(?:lets?)?|cc)\b/gi, // doses (incl. bare "u" insulin shorthand)
  /\b\d+(?:\.\d+)?\s?(?:l\/min|lpm)\b/gi, // O2 flow rate (2 L/min)
  /\b\d{1,2}\/10\b/g, // pain / rating scales
  /\b\d{2,3}\s?(?:bpm|beats)/gi, // heart rate
  /\b\d{1,2}\s?(?:breaths|rpm)/gi, // resp rate
  /\b\d{2,3}(?:\.\d)?\s?(?:lbs?|pounds?|kgs?|kilograms?)\b/gi, // weight (all common unit spellings)
  /\b\d{2,3}(?:\.\d)?\s?°?\s?f\b/gi, // temperature in F
];

/** Normalize a measurement token for set comparison (lowercase, no spaces).
 * Unit spellings collapse to one canonical form ("80 kgs"/"80 kilograms" →
 * "80kg", "180 pounds" → "180lbs") so a faithful unit respelling never flags —
 * while a kg→lb UNIT CHANGE still does (different canonical unit). */
function normalizeToken(t) {
  // Drop the degree symbol too so "98.6 F" and "98.6°F" reduce to the same
  // token — otherwise the value-guard flags a faithful °-adding rewrite as a
  // hallucinated value.
  return t
    .toLowerCase()
    .replace(/[\s°]+/g, "")
    .replace(/(kilograms?|kgs)$/, "kg")
    .replace(/(pounds?|lb)$/, "lbs")
    .replace(/units?$/, "u")
    .replace(/lpm$/, "l/min");
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
  // both reduce to comparable component numbers. Synthesize the unit-bearing form
  // for HR/RR/temp/weight too: a nurse commonly documents these WITHOUT a unit
  // ("HR 82", "T 98.6", "wt 180"), which the MEASUREMENT_PATTERNS above (which
  // require the unit) don't capture — but the constrained scribe faithfully
  // restates them WITH units ("HR 82 bpm", "98.6°F"). Without folding these in,
  // the value-guard would flag those faithful outputs as hallucinated values and
  // block the nurse from saving a note they actually wrote. normalizeToken strips
  // spaces/° so "82bpm"/"98.6f" here match "82 bpm"/"98.6°F" in the output.
  const v = extractVitals(text);
  if (v.bp_sys && v.bp_dia) add(`${v.bp_sys}/${v.bp_dia}`);
  if (v.o2) add(`${v.o2}%`);
  if (v.hr) add(`${v.hr}bpm`);
  if (v.rr) add(`${v.rr}breaths`);
  if (v.temp) add(`${v.temp}f`);
  // extractVitals returns only the FIRST reading of each vital, but a nurse
  // legitimately documents repeats ("HR 88 initially, HR 92 after ambulation") —
  // without folding every labeled occurrence, the guard flagged the faithful
  // restatement of the second reading as a hallucinated value.
  for (const m of text.matchAll(/\bbp\s*:?\s*(\d{2,3})\/(\d{2,3})(?!\d)/gi)) add(`${parseInt(m[1])}/${parseInt(m[2])}`);
  for (const m of text.matchAll(/\b(?:hr|heart\s*rate)\s*:?\s*(\d{2,3})(?!\d)/gi)) add(`${parseInt(m[1])}bpm`);
  for (const m of text.matchAll(/\b(?:rr|resp(?:iratory)?\s*rate)\s*:?\s*(\d{1,2})(?!\d)/gi)) add(`${parseInt(m[1])}breaths`);
  for (const m of text.matchAll(/\b(?:temp|temperature)\s*:?\s*(\d{2,3}(?:\.\d)?)(?!\d)/gi)) {
    const t = parseFloat(m[1]);
    if (t > 90) add(`${t}f`);
  }
  // Weight is the one vital with a unit ambiguity: extractVitals drops the unit, so
  // synthesizing an "lbs" token for a source documented in kg would let a real unit
  // error slip the value-guard ("80 kg" -> allowing "80 lbs", ~96 lb off). Only
  // synthesize the lbs token when the source weight is UNITLESS ("wt 180"); an
  // explicit lbs/kg weight is already emitted verbatim by MEASUREMENT_PATTERNS.
  // All the kg/lb unit spellings count as "has a unit" — "80 kgs"/"80 kilograms"
  // previously slipped this check and synthesized the very 80lbs token the
  // suppression exists to prevent.
  if (v.weight && !/\b(?:wt|weight)\s*:?\s*\d{2,3}(?:\.\d)?\s*(?:lbs?|pounds?|kgs?|kilograms?)\b/i.test(text)) {
    add(`${v.weight}lbs`);
  }
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
  // The mishear KEYS whose correction is a medication are the BRAND names nurses
  // actually write (Lasix, Zithromax, Coumadin, …) — without them the value-guard
  // and chart cross-check were blind to brand-name meds ("continue Lasix 40 mg"
  // extracted nothing).
  ...Object.keys(MEDICAL_TERMS.common_mishears).filter((k) => {
    const corrected = MEDICAL_TERMS.common_mishears[k];
    return typeof corrected === "string" && MED_SET.has(corrected.toLowerCase());
  }),
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

// Matched name (brand/mishear) → canonical medication, so "Lasix" in the note
// and "furosemide"-family entries reduce to ONE name on both sides of the
// value-guard and in the chart cross-check.
const CANONICAL_MED = (() => {
  const map = new Map();
  for (const [k, vv] of Object.entries(MEDICAL_TERMS.common_mishears)) {
    if (typeof vv === "string" && MED_SET.has(vv.toLowerCase())) map.set(k.toLowerCase(), vv);
  }
  return map;
})();

/** Return the list of known medication names mentioned in `text` (canonical). */
export function extractMedications(text) {
  if (!text) return [];
  const found = [];
  for (const med of UNIQUE_MEDS) {
    const re = new RegExp(`\\b${med.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    if (!re.test(text)) continue;
    const canonical = CANONICAL_MED.get(med.toLowerCase()) || med;
    if (!found.includes(canonical)) found.push(canonical);
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
