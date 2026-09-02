// noteSimilarity — deterministic copy-forward / repetitive-documentation review.
//
// WHY THIS EXISTS
// Cloned notes are one of the top ADR and denial triggers in home health: an
// episode where every visit reads identically cannot show visit-specific skilled
// need, and reviewers treat it as unsupported care. `visitComparison.js` already
// compares VITALS across visits; nothing compared the TEXT.
//
// TONE IS A REQUIREMENT, NOT A PREFERENCE
// This engine is ADVISORY and must never accuse anyone of fraud or cloning. Home
// health notes on a stable patient are legitimately similar — the same wound,
// the same teaching topic, the same homebound rationale. The finding is always
// "high similarity to prior documentation — review for visit-specific detail",
// never a misconduct claim, and it NEVER blocks a save.
//
// DETERMINISTIC BY DESIGN
// No LLM. Shingled Jaccard similarity plus exact repeated-sentence detection,
// both reproducible from the same inputs, so a nurse who asks "why was I
// flagged?" gets the same answer every time and can see the exact repeated text.
//
// Pure + offline so it runs under `node --test`. It may only import other plain
// `.js` modules with explicit extensions (never `.jsx`).
import { splitSentences } from "./factExtraction.js";
import { thresholdValue } from "./thresholds.js";

/**
 * Similarity bands. Advisory copy only — no accusation, no misconduct language.
 *
 * The band boundaries are read from thresholds.js at call time (not frozen in
 * here) so an agency can calibrate them on its own notes; they are PennSync
 * defaults, not standards. `bandFor` builds the list per call.
 */
function bands() {
  return [
    { id: "low", min: 0, label: "Visit-specific", tone: "green", advisory: "This note reads as visit-specific compared with prior documentation." },
    { id: "moderate", min: thresholdValue("similarity_moderate"), label: "Some repeated wording", tone: "slate", advisory: "Some wording repeats prior documentation. Expected for a stable patient — confirm today's findings are described." },
    { id: "high", min: thresholdValue("similarity_high"), label: "High similarity to prior documentation", tone: "amber", advisory: "High similarity to prior documentation — review for visit-specific detail." },
    { id: "very_high", min: thresholdValue("similarity_very_high"), label: "Very high similarity to prior documentation", tone: "red", advisory: "Very high similarity to prior documentation — review for visit-specific detail before entering this in the EMR." },
  ];
}

/** The bands at their current (default or calibrated) boundaries. */
export const SIMILARITY_BANDS = Object.freeze(bands());

/** Shingle width. 5 words is long enough that ordinary clinical phrasing
 *  ("patient tolerated the procedure well") does not by itself register as a
 *  copied passage, and short enough to catch a copied sentence. */
const SHINGLE_SIZE = 5;

/** A repeated sentence must be substantial before it is worth surfacing — a
 *  short shared line ("Vitals stable.") is normal documentation, not cloning.
 *  Tunable: see thresholds.js. */
const minRepeatedSentenceWords = () => thresholdValue("similarity_min_repeated_words");

// Category-level repeats: the parts of a note that MUST change visit to visit.
//
// ORDER IS THE PRIORITY ORDER. Each sentence is assigned to AT MOST ONE
// category, first match wins. Without that, "Patient tolerated the dressing
// change without complaint" counted as BOTH response and intervention wording,
// which polluted the intervention comparison with response sentences and made
// the "identical wording" signal impossible to trigger. Response and education
// are checked before intervention because those sentences routinely name the
// intervention they are responding to.
const CATEGORIES = [
  { id: "homebound", label: "Homebound rationale", pattern: /homebound|confined to (?:home|residence)|taxing effort|unable to leave/i },
  { id: "education", label: "Education wording", pattern: /\b(?:educat|taught|teach[- ]?back|instruct|reinforc|verbali[sz]ed understanding|return demonstration)\b/i },
  { id: "response", label: "Patient-response wording", pattern: /\b(?:tolerated|no adverse|without (?:complaint|difficulty|incident)|responded|denied pain|remained comfortable)\b/i },
  { id: "intervention", label: "Intervention wording", pattern: /\b(?:administered|performed|applied|dressing change|packed|irrigat|debride|flushed|instilled|catheter|injection|repositioned|ambulated|transferred)\b/i },
  { id: "function", label: "Functional-status wording", pattern: /\b(?:ambulat|gait|transfer|adl|iadl|independent with|assist with|bathing|dressing|toileting|wheelchair|walker)\b/i },
];

/**
 * The single category a sentence belongs to, or null. First match in CATEGORIES
 * order wins, so a sentence is never double-counted across categories.
 */
function primaryCategory(sentence) {
  return CATEGORIES.find((c) => c.pattern.test(sentence)) || null;
}

/** Lowercase, strip punctuation, collapse whitespace. Numbers are KEPT: a
 *  repeated measurement is exactly the signal we want to notice. */
export function normalizeForSimilarity(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s./-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function words(text) {
  const n = normalizeForSimilarity(text);
  return n ? n.split(" ") : [];
}

/** Word n-grams as a Set. */
function shingles(text, size = SHINGLE_SIZE) {
  const w = words(text);
  const out = new Set();
  if (w.length < size) {
    if (w.length) out.add(w.join(" "));
    return out;
  }
  for (let i = 0; i + size <= w.length; i++) out.add(w.slice(i, i + size).join(" "));
  return out;
}

/**
 * Jaccard similarity of two texts' shingle sets: |A∩B| / |A∪B|.
 * 0 = nothing in common, 1 = identical wording.
 * @returns {number} 0..1, rounded to 4 decimals for stable comparisons
 */
export function shingleSimilarity(a, b) {
  const A = shingles(a);
  const B = shingles(b);
  if (!A.size || !B.size) return 0;
  let intersection = 0;
  for (const s of A) if (B.has(s)) intersection++;
  const union = A.size + B.size - intersection;
  return union === 0 ? 0 : Number((intersection / union).toFixed(4));
}

/** @param {number} score */
export function bandFor(score) {
  const list = bands();
  let band = list[0];
  for (const b of list) if (score >= b.min) band = b;
  return band;
}

/**
 * Sentences that appear (normalized) in BOTH texts and are long enough to be
 * worth reviewing.
 * @returns {Array<{ text: string, words: number, categories: string[] }>}
 */
export function repeatedSentences(currentText, priorText) {
  const priorSet = new Set(splitSentences(priorText).map(normalizeForSimilarity).filter(Boolean));
  const seen = new Set();
  const out = [];
  for (const sentence of splitSentences(currentText)) {
    const normalized = normalizeForSimilarity(sentence);
    if (!normalized || seen.has(normalized)) continue;
    const count = normalized.split(" ").length;
    if (count < minRepeatedSentenceWords()) continue;
    if (!priorSet.has(normalized)) continue;
    seen.add(normalized);
    out.push({
      text: sentence.trim(),
      words: count,
      categories: primaryCategory(sentence) ? [primaryCategory(sentence).id] : [],
    });
  }
  return out;
}

/** Concatenate a text's sentences whose PRIMARY category is `id`. */
function categoryText(text, id) {
  return splitSentences(text).filter((s) => primaryCategory(s)?.id === id).join(" ");
}

/**
 * Per-category similarity. Only reported for categories present in BOTH notes —
 * a category the prior note did not contain cannot have been copied forward.
 * @returns {Array<{ id: string, label: string, score: number, band: string, identical: boolean }>}
 */
export function categorySimilarity(currentText, priorText) {
  const out = [];
  for (const category of CATEGORIES) {
    const cur = categoryText(currentText, category.id);
    const prev = categoryText(priorText, category.id);
    if (!cur.trim() || !prev.trim()) continue;
    const score = shingleSimilarity(cur, prev);
    out.push({
      id: category.id,
      label: category.label,
      score,
      band: bandFor(score).id,
      identical: normalizeForSimilarity(cur) === normalizeForSimilarity(prev),
    });
  }
  return out;
}

/**
 * Vital-sign values repeated EXACTLY across visits.
 *
 * Deliberately conservative: one repeated reading is unremarkable (a stable
 * patient really can be 98.6 °F twice). This only reports when a whole SET of
 * readings is byte-identical across notes, which is the pattern that reads as
 * carried-forward rather than re-measured. Never an accusation — the advisory
 * asks the nurse to confirm the values were taken today.
 *
 * @param {object} current canonical vitals from factExtraction.extractVitals
 * @param {object[]} priors one per prior note
 * @returns {{ repeated: boolean, matchedCount: number, keys: string[] }}
 */
export function identicalVitals(current, priors) {
  const keys = ["bp_sys", "bp_dia", "hr", "o2", "temp", "weight"];
  const present = keys.filter((k) => current?.[k] != null);
  // Fewer than a full set of recorded values is not meaningful (see thresholds.js).
  if (present.length < thresholdValue("similarity_identical_vitals_min_readings")) {
    return { repeated: false, matchedCount: 0, keys: [] };
  }
  let matchedCount = 0;
  for (const prior of priors || []) {
    if (!prior) continue;
    if (present.every((k) => prior[k] != null && prior[k] === current[k])) matchedCount++;
  }
  return { repeated: matchedCount > 0, matchedCount, keys: present };
}

/**
 * Full copy-forward review of the current draft against prior notes.
 *
 * @param {string} currentText the draft (or polished note) being reviewed
 * @param {Array<string|{ note?: string, text?: string, date?: string, visit_id?: string }>} priorNotes
 *        most recent first; strings or note-history rows both accepted
 * @param {{ currentVitals?: object|null, priorVitals?: object[] }} [options]
 * @returns {{
 *   score: number, band: object, comparedCount: number, advisory: boolean,
 *   closest: { index: number, score: number, date: string|null, visitId: string|null }|null,
 *   repeatedSentences: Array<object>, categories: Array<object>,
 *   identicalVitals: { repeated: boolean, matchedCount: number, keys: string[] },
 *   reviewPrompts: string[]
 * }}
 */
export function reviewCopyForward(currentText, priorNotes, { currentVitals = null, priorVitals = [] } = {}) {
  const rows = (Array.isArray(priorNotes) ? priorNotes : [])
    .map((p) => (typeof p === "string"
      ? { text: p, date: null, visitId: null }
      : { text: p?.note || p?.text || "", date: p?.date || null, visitId: p?.visit_id || null }))
    .filter((p) => p.text && p.text.trim());

  const empty = {
    score: 0,
    band: SIMILARITY_BANDS[0],
    comparedCount: 0,
    advisory: true,
    closest: null,
    repeatedSentences: [],
    categories: [],
    identicalVitals: { repeated: false, matchedCount: 0, keys: [] },
    reviewPrompts: [],
  };
  if (!currentText || !currentText.trim() || !rows.length) return empty;

  let best = { index: -1, score: 0 };
  rows.forEach((row, index) => {
    const score = shingleSimilarity(currentText, row.text);
    if (score > best.score) best = { index, score };
  });

  const closestRow = best.index >= 0 ? rows[best.index] : null;
  const repeats = closestRow ? repeatedSentences(currentText, closestRow.text) : [];
  const categories = closestRow ? categorySimilarity(currentText, closestRow.text) : [];
  const vitals = identicalVitals(currentVitals, priorVitals);
  const band = bandFor(best.score);

  const reviewPrompts = [];
  if (band.id === "high" || band.id === "very_high") {
    reviewPrompts.push(`${band.label} \u2014 review for visit-specific detail.`);
  }
  for (const c of categories) {
    if (c.identical) {
      reviewPrompts.push(`${c.label} is word-for-word identical to the prior note — confirm it reflects today's visit.`);
    }
  }
  if (repeats.length >= 3 && !reviewPrompts.length) {
    reviewPrompts.push(`${repeats.length} sentences repeat the prior note verbatim — review for visit-specific detail.`);
  }
  if (vitals.repeated) {
    reviewPrompts.push("The recorded vital signs match a prior visit exactly — confirm these readings were taken today.");
  }

  return {
    score: best.score,
    band,
    comparedCount: rows.length,
    // Always advisory. This never blocks a save and never alleges misconduct.
    advisory: true,
    closest: closestRow
      ? { index: best.index, score: best.score, date: closestRow.date, visitId: closestRow.visitId }
      : null,
    repeatedSentences: repeats,
    categories,
    identicalVitals: vitals,
    reviewPrompts,
  };
}
