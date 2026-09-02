// Care-suggestion engine: takes an answers map { questionId: value } from
// PennSync's OWN assessment form and returns suggestion objects sorted by
// severity.
//
// WHAT THE IDS IN HERE ARE, AND ARE NOT
// The question ids below (m1910, m1730, m1020, m0069, …) are PennSync FORM ids
// from oasisQuestions.jsx. Several are NOT current CMS item numbers — a source
// check on 2026-09-01 against the published OASIS-E/E1/E2 manuals found m1730
// and m1910 retired, and m1020, m1300, m1350 and m1900 present in no manual at
// all (see specs/verification.js). They are kept because this form and its
// stored answers key off them; the ids are internal identifiers, not claims
// about the CMS instrument.
//
// The response VALUES are equally PennSync's own: m1020 = 1 means "Diabetes
// Mellitus" in this form's picklist, not an ICD-10 code. So this engine must
// only ever be fed answers from PennSync's form.
//
// It is therefore NOT safe to feed it CMS-shaped assessment data. Doing so
// would silently under-trigger — the retired ids would simply be absent, and
// m1021 (the real Primary Diagnosis item) carries an ICD-10 string that matches
// none of the numeric picklist values here. `evaluateOASIS` guards against that
// (see below) rather than returning a confidently empty result.
//
// NO PAYMENT PATH: this engine feeds care suggestions in SmartOASISAssessment
// only. PDGM functional scoring lives in pdgm/pdgmGrouper.js, which derives its
// scored item set from the supplied CMS table's keys and reports unmapped
// responses instead of scoring them as zero. Nothing here reaches a rate.

export const SEVERITY_ORDER = { high: 0, medium: 1, low: 2 };

const RULES = [
  // ── Fall Risk ──────────────────────────────────────────────────────────────
  {
    domain: "Fall Prevention",
    triggers: [
      // PennSync's fall-risk screening question. M1910 is a RETIRED CMS item
      // (the OASIS-E manual lists "Falls Risk Assessment" as Removed); falls are
      // now J1800/J1900 on the official assessment.
      { questionId: "m1910", values: [1, 2], severity: "high" },
      // M1860 runs 0–6 (see oasisScales.js); 6 = "Bedfast, unable to ambulate or
      // be up in a chair". Stopping at 5 meant the most impaired patients — the
      // ones already at highest fall risk during transfers — produced no
      // fall-prevention suggestion at all, while chairfast (5) did.
      { questionId: "m1860", values: [2, 3, 4, 5, 6], severity: "high" },  // ambulation impairment
      // PennSync's prior-functioning question: 1–3 are impairment levels, 4 =
      // "Unknown" and must not trigger. M1900 is not a CMS item number in any
      // published manual; the official item is GG0100.
      { questionId: "m1900", values: [1, 2, 3], severity: "medium" },
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
      // PennSync's skin-lesion question. M1350 appears in no CMS manual.
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
      // M2010 High-Risk Drug Education: 1 = education COMPLETED (fine);
      // only 2 = "Education not completed" is a medication-management gap.
      { questionId: "m2010", values: [2], severity: "high" },
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
      // PennSync's therapies-at-home question (M1030 is retired from the
      // current instrument) and its primary-diagnosis PICKLIST, where 2 =
      // Heart Failure / CHF. M1020 is not a CMS item number — the official
      // Primary Diagnosis item is M1021 and records an ICD-10 code.
      { questionId: "m1030", values: [1, 2], severity: "medium" },
      { questionId: "m1020", values: [2], severity: "high" },
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
      // m1020 is this form's primary-diagnosis SELECT (not CMS M1021): 1 = Diabetes Mellitus.
      // It previously also matched 2, but 2 = Heart Failure/CHF (see
      // oasisQuestions.jsx), so a CHF patient was wrongly flagged for diabetes
      // management. CHF now routes to Cardiovascular Monitoring instead.
      { questionId: "m1020", values: [1], severity: "high" },  // primary diagnosis = Diabetes Mellitus
      // NOTE: do NOT trigger on M2020 (oral-med management). M2020=3 ("unable to
      // take oral medications") is a medication-adherence signal — already covered
      // by the Medication Management rule above — and has no bearing on a diabetes
      // diagnosis, so keying diabetes care off it flagged non-diabetic patients.
    ],
    reason: () => "Diabetes diagnosis requires structured glucose monitoring, foot care, and diet education.",
    interventionIds: ["dm-1", "dm-2", "dm-3", "dm-4"],
  },
  // ── Psychosocial ──────────────────────────────────────────────────────────
  {
    domain: "Psychosocial Assessment",
    triggers: [
      // PennSync's depression-screening question. M1730 is a RETIRED CMS item
      // ("Depression Screening — Removed"); depression is now D0150/D0160 (PHQ).
      { questionId: "m1730", values: [1, 2], severity: "high" },
      { questionId: "m1740", values: [1, 2, 3, 4], severity: "medium" },  // anxiety (4 = physical aggression, most severe)
      { questionId: "m1700", values: [1, 2, 3, 4], severity: "medium" },  // cognitive function (4 = totally dependent, most severe)
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
      { questionId: "m1100", values: [0, 1, 2], severity: "medium" },  // living situation (0 = lives alone, no assistance, highest risk)
      { questionId: "m1800", values: [1, 2, 3], severity: "low" },  // grooming (max stored value is 3)
    ],
    reason: () => "Patient and caregiver education on disease management and safety protocols is indicated.",
    interventionIds: ["pe-1", "pe-2", "pe-3"],
  },
];

/** Every PennSync form id this engine reads. Exported so a caller can check
 *  that the answers it holds are actually from PennSync's form. */
export const SCORED_QUESTION_IDS = Object.freeze(
  [...new Set(RULES.flatMap((r) => r.triggers.map((t) => t.questionId)))].sort(),
);

/**
 * True when `answers` looks like PennSync form data rather than CMS-shaped
 * assessment responses. Used to refuse a confidently-empty result on input this
 * engine cannot interpret.
 * @param {Object} answers
 */
export function isPennSyncFormAnswers(answers) {
  if (!answers || typeof answers !== "object") return false;
  const keys = Object.keys(answers);
  if (!keys.length) return false;
  return keys.some((k) => SCORED_QUESTION_IDS.includes(String(k).toLowerCase()));
}

/**
 * Evaluate PennSync form answers and return sorted suggestions.
 *
 * @param {Object} answers — { questionId: numericValue } from PennSync's form
 * @param {{ strict?: boolean }} [options] when `strict`, throws on input that
 *        matches none of this engine's question ids instead of returning [] —
 *        an empty array from CMS-shaped data would read as "no concerns found"
 *        when the truth is "these answers could not be interpreted".
 * @returns Array of suggestion objects
 */
export function evaluateOASIS(answers, { strict = false } = {}) {
  if (strict && !isPennSyncFormAnswers(answers)) {
    throw new Error(
      "evaluateOASIS received answers that match none of PennSync's form question ids. "
      + "This engine reads PennSync's own form, not CMS-shaped assessment data.",
    );
  }
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
  // PennSync's terminal-prognosis question. NOTE: M0069 was "Gender" in the CMS
  // instrument (replaced by A0810 Sex in OASIS-E2) and was never a prognosis
  // item — the id is PennSync's own and is kept only because stored answers use
  // it. The QUESTION this form asks is a prognosis question, so the logic below
  // is correct for PennSync data and must not be fed CMS responses.
  const prognosis = num(answers["m0069"]);
  const adlDeficit = num(answers["m1800"]) + num(answers["m1810"]) + num(answers["m1820"]);
  if (prognosis === 1) return "hospice";
  if (adlDeficit >= 6) return "both";
  return "home_health";
}