// Scoring engine: takes an answers map { questionId: value } and returns
// an array of suggestion objects sorted by severity.

export const SEVERITY_ORDER = { high: 0, medium: 1, low: 2 };

const RULES = [
  // ── Fall Risk ──────────────────────────────────────────────────────────────
  {
    domain: "Fall Prevention",
    triggers: [
      { questionId: "m1910", values: [1, 2], severity: "high" },
      { questionId: "m1860", values: [2, 3, 4, 5], severity: "high" },  // ambulation impairment
      { questionId: "m1900", values: [1, 2, 3, 4], severity: "medium" }, // current medication effect
    ],
    reason: (ans) => {
      const risk = ans["m1910"];
      const amb = ans["m1860"];
      if (risk >= 2 || amb >= 3) return "High fall risk score and/or significant ambulation impairment detected.";
      return "Moderate fall risk identified based on ambulation and assessment scores.";
    },
    interventionIds: ["fp-1", "fp-2", "fp-3", "fp-4"],
  },
  // ── Wound Care ────────────────────────────────────────────────────────────
  {
    domain: "Wound Care",
    triggers: [
      { questionId: "m1340", values: [1, 2], severity: "high" },
      { questionId: "m1306", values: [1, 2], severity: "high" },
      { questionId: "m1350", values: [1, 2], severity: "medium" },
    ],
    reason: () => "Pressure ulcer or surgical wound identified. Skilled wound care documentation required.",
    interventionIds: ["wc-1", "wc-2", "wc-3"],
  },
  // ── Medication Management ─────────────────────────────────────────────────
  {
    domain: "Medication Management",
    triggers: [
      { questionId: "m2001", values: [1, 2], severity: "high" },
      { questionId: "m2010", values: [1, 2], severity: "high" },
      { questionId: "m2020", values: [1, 2, 3], severity: "medium" },
    ],
    reason: (ans) => {
      if (ans["m2001"] >= 1) return "Medication management issues identified — high-risk medications require structured education.";
      return "Patient requires medication management support to ensure adherence and safety.";
    },
    interventionIds: ["mm-1", "mm-2", "mm-4"],
  },
  // ── Cardiovascular ────────────────────────────────────────────────────────
  {
    domain: "Cardiovascular Monitoring",
    triggers: [
      { questionId: "m1400", values: [3, 4], severity: "high" },  // dyspnea
      { questionId: "m1030", values: [1, 2], severity: "medium" },  // therapy at home
      { questionId: "m1020", values: [2], severity: "high" },  // primary dx = Heart Failure / CHF
    ],
    reason: () => "Dyspnea or cardiovascular instability noted. Blood pressure and fluid monitoring indicated.",
    interventionIds: ["cv-1", "cv-2", "cv-3"],
  },
  // ── Respiratory ───────────────────────────────────────────────────────────
  {
    domain: "Respiratory Management",
    triggers: [
      // Mild–moderate dyspnea (2) routes to respiratory education; severe
      // dyspnea (3–4) is handled by Cardiovascular Monitoring so a single
      // finding never emits two high-severity suggestions.
      { questionId: "m1400", values: [2], severity: "high" },  // shortness of breath
    ],
    reason: () => "Significant dyspnea rating requires respiratory assessment and breathing technique education.",
    interventionIds: ["resp-1", "resp-2", "resp-3"],
  },
  // ── Diabetes ──────────────────────────────────────────────────────────────
  {
    domain: "Diabetes Management",
    triggers: [
      // m1020 is this form's primary-diagnosis SELECT: 1 = Diabetes Mellitus.
      // It previously also matched 2, but 2 = Heart Failure/CHF (see
      // oasisQuestions.jsx), so a CHF patient was wrongly flagged for diabetes
      // management. CHF now routes to Cardiovascular Monitoring instead.
      { questionId: "m1020", values: [1], severity: "high" },  // primary diagnosis = Diabetes Mellitus
      { questionId: "m2020", values: [3], severity: "medium" },
    ],
    reason: () => "Diabetes diagnosis requires structured glucose monitoring, foot care, and diet education.",
    interventionIds: ["dm-1", "dm-2", "dm-3", "dm-4"],
  },
  // ── Psychosocial ──────────────────────────────────────────────────────────
  {
    domain: "Psychosocial Assessment",
    triggers: [
      { questionId: "m1730", values: [1, 2], severity: "high" },  // depression
      { questionId: "m1740", values: [1, 2, 3], severity: "medium" },  // anxiety
      { questionId: "m1700", values: [1, 2, 3], severity: "medium" },  // cognitive function
    ],
    reason: (ans) => {
      if (ans["m1730"] >= 1) return "Positive depression screening. Mental health follow-up and caregiver assessment required.";
      return "Cognitive or behavioral concerns detected. Standardized psychosocial assessment indicated.";
    },
    interventionIds: ["ps-1", "ps-2", "ps-3"],
  },
  // ── Patient Education ─────────────────────────────────────────────────────
  {
    domain: "Patient Education",
    triggers: [
      { questionId: "m1100", values: [1, 2, 3], severity: "medium" },  // living situation
      { questionId: "m1800", values: [1, 2, 3, 4], severity: "low" },  // grooming
    ],
    reason: () => "Patient and caregiver education on disease management and safety protocols is indicated.",
    interventionIds: ["pe-1", "pe-2", "pe-3"],
  },
];

/**
 * Evaluate OASIS answers and return sorted suggestions.
 * @param {Object} answers — { questionId: numericValue }
 * @returns Array of suggestion objects
 */
export function evaluateOASIS(answers) {
  const results = [];

  for (const rule of RULES) {
    let highestSeverity = null;
    let triggered = false;

    for (const trigger of rule.triggers) {
      const val = answers[trigger.questionId];
      if (val === undefined || val === null || val === "") continue;
      const numVal = typeof val === "number" ? val : parseInt(val, 10);
      if (isNaN(numVal)) continue;
      if (trigger.values.includes(numVal)) {
        triggered = true;
        if (highestSeverity === null || SEVERITY_ORDER[trigger.severity] < SEVERITY_ORDER[highestSeverity]) {
          highestSeverity = trigger.severity;
        }
      }
    }

    if (triggered) {
      results.push({
        domain: rule.domain,
        severity: highestSeverity,
        reason: rule.reason(answers),
        interventionIds: rule.interventionIds,
      });
    }
  }

  // Sort by severity
  return results.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}

/**
 * Compute the overall care scope based on answers.
 * Returns: "home_health" | "hospice" | "both"
 */
export function computeCareScope(answers) {
  // Coerce to numbers: OASIS answers often arrive as strings, and "3" + 0
  // string-concatenates to "30" (>= 6) — producing a wrong care-scope result.
  const num = (v) => Number(v) || 0;
  const prognosis = num(answers["m0069"]);  // prognosis
  const adlDeficit = num(answers["m1800"]) + num(answers["m1810"]) + num(answers["m1820"]);
  if (prognosis === 1) return "hospice";
  if (adlDeficit >= 6) return "both";
  return "home_health";
}