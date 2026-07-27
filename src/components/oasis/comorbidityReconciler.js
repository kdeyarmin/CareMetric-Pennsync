// Comorbidity capture assistant.
//
// PDGM raises the case-mix weight when a secondary diagnosis falls in a
// comorbidity subgroup (low) or two interact (high). Agencies typically MISS
// ~40% of eligible comorbidity adjustments because a condition documented in the
// OASIS / assessment never makes it onto the coded secondary-diagnosis list.
// This reconciles OASIS-documented conditions against the coded secondaries and
// surfaces the un-captured, adjustment-eligible gaps.
//
// Pure + offline (unit-tested with `node --test`).

// OASIS M1020 primary-diagnosis select value → condition label (mirrors
// oasisQuestions.jsx). Kept local so this module has no JSX import.
const M1020_CONDITION = {
  1: "Diabetes Mellitus",
  2: "Heart Failure",
  3: "COPD",
  4: "Hypertension",
  5: "Pressure Ulcer",
  6: "Orthopedic",
  7: "Stroke",
};

// Keyword → PDGM comorbidity subgroup (representative; extend as CMS updates the
// interaction table). Used to flag which documented gaps are adjustment-eligible.
export const COMORBIDITY_SUBGROUPS = [
  { re: /heart failure|chf|cardiomyopathy|\bhfref\b|\bhfpef\b/i, subgroup: "Circulatory" },
  { re: /copd|emphysema|chronic bronchitis|asthma|respiratory failure/i, subgroup: "Respiratory" },
  { re: /diabet|\bdm2?\b|hyperglycem/i, subgroup: "Endocrine" },
  { re: /ckd|chronic kidney|renal (?:insufficiency|failure)|esrd/i, subgroup: "Genitourinary/Renal" },
  { re: /depress|anxiety|bipolar|schizophren|ptsd/i, subgroup: "Behavioral" },
  { re: /pressure (?:ulcer|injury)|stasis ulcer|surgical wound|dehisc|cellulitis/i, subgroup: "Skin/Wound" },
  { re: /stroke|cva|hemiplegia|hemiparesis|parkinson|neuropath|dementia|alzheimer/i, subgroup: "Neuro" },
  { re: /obes|morbid obesity|bmi/i, subgroup: "Endocrine" },
  { re: /atrial fibrillation|\bafib\b|arrhythmia|coronary|\bcad\b/i, subgroup: "Circulatory" },
];

const STOPWORDS = new Set(["the", "and", "with", "without", "of", "type", "chronic", "acute", "unspecified", "disease", "disorder", "other", "left", "right", "primary", "secondary"]);

function tokens(str) {
  return String(str || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 4 && !STOPWORDS.has(t));
}

function toNum(v) {
  if (v === undefined || v === null || v === "") return null;
  const n = typeof v === "number" ? v : parseInt(String(v).trim(), 10);
  return Number.isNaN(n) ? null : n;
}

/** Map a condition label to its PDGM comorbidity subgroup (or null). */
export function comorbiditySubgroup(condition) {
  const hit = COMORBIDITY_SUBGROUPS.find((s) => s.re.test(String(condition || "")));
  return hit ? hit.subgroup : null;
}

/**
 * Derive condition labels documented in an OASIS answers map. Deliberately
 * conservative — only diagnosis-bearing items (not functional scores).
 * @param {Object} answers  flat OASIS answers map (m-item → value)
 * @returns {Array<{condition: string, source: string}>}
 */
export function deriveOasisConditions(answers = {}) {
  const out = [];
  const add = (condition, source) => {
    if (condition && !out.some((c) => c.condition.toLowerCase() === condition.toLowerCase())) {
      out.push({ condition, source });
    }
  };
  const primary = M1020_CONDITION[toNum(answers.m1020)];
  if (primary) add(primary, "M1020");
  if (toNum(answers.m1730) >= 1) add("Depression", "M1730");
  if (toNum(answers.m1306) >= 1) add("Pressure Ulcer", "M1306");
  if (toNum(answers.m1340) >= 1) add("Surgical Wound", "M1340");
  return out;
}

function isCaptured(condition, codedTokenSets, codedRaw) {
  // Whole-token overlap with ONE coded secondary. A single shared generic
  // word must NOT mark a distinct condition captured — "Heart Failure" vs
  // coded "renal failure", or "Pressure Ulcer" vs coded "diabetic foot
  // ulcer", would silently swallow an adjustment-eligible gap. Multi-token
  // conditions need at least 2 whole-token hits in the same coded diagnosis;
  // single-token conditions ("COPD") need their exact token.
  const condTokens = tokens(condition);
  if (condTokens.length) {
    const need = condTokens.length === 1 ? 1 : Math.max(2, Math.ceil(condTokens.length / 2));
    for (const set of codedTokenSets) {
      const hits = condTokens.filter((t) => set.has(t)).length;
      if (hits >= need) return true;
    }
  }
  // Same comorbidity subgroup already coded (e.g. "CHF" documented, "Heart failure" coded).
  const sub = comorbiditySubgroup(condition);
  if (sub && codedRaw.some((c) => comorbiditySubgroup(c) === sub)) return true;
  return false;
}

/**
 * Reconcile documented conditions against coded secondary diagnoses.
 *
 * @param {Object} input
 * @param {Array<string|{condition:string,source?:string}>} input.documentedConditions
 * @param {Array<string>} input.codedSecondaries
 * @returns {{
 *   captured: Array, gaps: Array, comorbidity_opportunities: Array,
 *   potential_adjustment_count: number,
 * }}
 */
export function reconcileComorbidities({ documentedConditions = [], codedSecondaries = [] } = {}) {
  const documented = documentedConditions.map((c) => (typeof c === "string" ? { condition: c } : c)).filter((c) => c && c.condition);
  const codedRaw = (codedSecondaries || []).map((c) => String(c || "")).filter(Boolean);
  const codedTokenSets = codedRaw.map((c) => new Set(tokens(c)));

  const captured = [];
  const gaps = [];
  for (const doc of documented) {
    const subgroup = comorbiditySubgroup(doc.condition);
    const entry = { condition: doc.condition, source: doc.source || null, subgroup };
    if (isCaptured(doc.condition, codedTokenSets, codedRaw)) captured.push(entry);
    else gaps.push(entry);
  }

  // Gaps that map to a PDGM comorbidity subgroup are the revenue opportunities.
  const opportunities = gaps.filter((g) => g.subgroup);

  return {
    captured,
    gaps,
    comorbidity_opportunities: opportunities.map((o) => ({
      condition: o.condition,
      source: o.source,
      subgroup: o.subgroup,
      message: `${o.condition} is documented (${o.source || "assessment"}) but not on the coded secondary list — add it to capture the ${o.subgroup} comorbidity adjustment.`,
    })),
    potential_adjustment_count: opportunities.length,
  };
}

/**
 * Convenience: reconcile straight from an OASIS answers map + coded secondaries.
 */
export function reconcileFromOasis(answers, codedSecondaries) {
  return reconcileComorbidities({
    documentedConditions: deriveOasisConditions(answers),
    codedSecondaries,
  });
}
