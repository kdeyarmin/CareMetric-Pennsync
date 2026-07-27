// OASIS Outcome-Measure Engine — the keystone deterministic quality engine.
//
// Pairs a Discharge OASIS with the matching SOC/ROC assessment and computes the
// CMS home-health OUTCOME (change) measures that feed the Quality-of-Patient-Care
// (QoPC) star ratings and the Home Health Value-Based Purchasing (HHVBP) score:
//
//   • Improvement in Ambulation/Locomotion        (M1860)
//   • Improvement in Bed Transferring              (M1850)
//   • Improvement in Bathing                       (M1830)
//   • Improvement in Dyspnea / Shortness of Breath (M1400)
//   • Improvement in Management of Oral Medications(M2020)
//   • GG Discharge Function Score                  (GG0130 self-care + GG0170 mobility)
//
// These are "improvement" measures: on every OASIS functional/symptom scale a
// LOWER numeric code means MORE independent / less impaired, so a patient
// "improved" when the discharge value is strictly LESS than the SOC/ROC value.
//
// The engine applies CMS-style denominators/exclusions (no room to improve,
// unratable codes, episodes ending in death, missing data) so the rates it emits
// mirror the CMS Home Health OASIS-Based Quality Measures specification. It is
// pure and dependency-free (no Base44/Deno APIs) so it is unit-tested with
// `node --test` and inlined by the computeOutcomeMeasures edge function.
//
// Design deliberately mirrors oasisScoringEngine.js: a declarative table of
// measures + a small deterministic evaluator, no I/O, string answers coerced.

// ── Measure table ────────────────────────────────────────────────────────────
// startMax        — highest ASSESSABLE numeric code for the item (values above
//                   it are "unable to rate" style codes, excluded).
// excludeStart    — SOC/ROC values that remove the episode from this measure's
//                   denominator (0 == already fully independent == "no room to
//                   improve"; item-specific unratable codes).
// excludeEither   — values that, at EITHER SOC or discharge, make the change
//                   unassessable (e.g. bathing "artificial opening").
// metricField     — key on PatientOutcomeMetric.functional_improvement this
//                   measure maps onto (null == not stored as a discrete flag).
export const IMPROVEMENT_MEASURES = [
  {
    key: "ambulation",
    item: "m1860",
    // M1860 Ambulation/Locomotion is a 0–6 scale (see oasisScales.js); 6 = bedfast,
    // unable to ambulate. All 0–6 are real functional levels (no unratable code),
    // so a documented 6 must stay in the denominator (e.g. 6→3 improves) — mirroring
    // the m1850 treatment below.
    label: "Improvement in Ambulation/Locomotion",
    startMax: 6,
    excludeStart: [0],
    excludeEither: [],
    metricField: "ambulation_improved",
  },
  {
    key: "bed_transfer",
    item: "m1850",
    label: "Improvement in Bed Transferring",
    // M1850 Transferring is a 0–5 scale (see oasisScales.js); 5 = bedfast,
    // unable to transfer/turn. All 0–5 are real functional levels (no unratable
    // code), so a documented 5 must stay in the denominator (e.g. 5→3 improves).
    startMax: 5,
    excludeStart: [0],
    excludeEither: [],
    metricField: "transferring_improved",
  },
  {
    key: "bathing",
    item: "m1830",
    label: "Improvement in Bathing",
    startMax: 6,
    excludeStart: [0],
    // 6 = "Unable to rate — patient has artificial opening": unassessable at
    // either end, so the change cannot be scored.
    excludeEither: [6],
    metricField: "bathing_improved",
  },
  {
    key: "dyspnea",
    item: "m1400",
    label: "Improvement in Dyspnea",
    startMax: 4,
    excludeStart: [0],
    excludeEither: [],
    metricField: "dyspnea_improved",
  },
  {
    key: "oral_meds",
    item: "m2020",
    label: "Improvement in Management of Oral Medications",
    startMax: 3,
    excludeStart: [0],
    excludeEither: [],
    metricField: "medication_management_improved",
  },
];

// Per-measure result status.
export const MEASURE_STATUS = {
  IMPROVED: "improved",
  NOT_IMPROVED: "not_improved",
  EXCLUDED: "excluded",
};

// CMS star eligibility: a measure needs at least this many eligible (in-
// denominator) episodes to receive a star, and an agency needs at least 5 of the
// reported measures to receive an overall QoPC star rating.
export const STAR_MIN_EPISODES = 20;
export const STAR_MIN_MEASURES = 5;

// GG Discharge Function Score item set (CMS "Discharge Function Score" measure,
// HH QRP FY2025). Self-care GG0130 + mobility GG0170. Each item is coded 01–06
// on the 6-point GG scale (06 = independent). "Activity not attempted" codes
// (07/09/10/88) are imputed to the most-dependent assessable value (01) per the
// CMS imputation convention.
export const GG_FUNCTION_ITEMS = [
  "gg0130a", "gg0130b", "gg0130c", "gg0130e", "gg0130f", "gg0130g", "gg0130h",
  "gg0170a", "gg0170b", "gg0170c", "gg0170d", "gg0170e", "gg0170f",
  "gg0170i", "gg0170j", "gg0170k", "gg0170l", "gg0170m",
];
const GG_NOT_ATTEMPTED = new Set([7, 9, 10, 88]);
const GG_MIN_DEPENDENT = 1;
const GG_MAX_INDEPENDENT = 6;

// ── coercion ────────────────────────────────────────────────────────────────
function toNum(v) {
  if (v === undefined || v === null || v === "") return null;
  const n = typeof v === "number" ? v : parseInt(String(v).trim(), 10);
  return Number.isNaN(n) ? null : n;
}

/**
 * Normalize an OASISAssessment.oasis_items array into a flat answers map keyed by
 * lower-cased M-item id (e.g. { m1860: 2, m1400: 3 }). Non-numeric responses are
 * dropped so downstream coercion stays clean. Also accepts an already-flat map.
 * @param {Array<{item_number?: string, response?: string}>|Object} items
 * @returns {Object<string, number>}
 */
export function answersFromOasisItems(items) {
  if (!items) return {};
  if (!Array.isArray(items)) {
    // Already a flat map — normalize keys to lower case.
    const out = {};
    for (const [k, v] of Object.entries(items)) {
      const n = toNum(v);
      if (n !== null) out[String(k).toLowerCase()] = n;
    }
    return out;
  }
  const out = {};
  for (const it of items) {
    if (!it || it.item_number == null) continue;
    const key = String(it.item_number).toLowerCase().replace(/[^a-z0-9]/g, "");
    const n = toNum(it.response);
    if (n !== null) out[key] = n;
  }
  return out;
}

/**
 * Evaluate a single improvement measure for one episode.
 * @returns {{key,label,item,status,start_value,discharge_value,reason}}
 */
function evaluateMeasure(measure, startAns, dcAns) {
  const s = toNum(startAns[measure.item]);
  const d = toNum(dcAns[measure.item]);
  const base = {
    key: measure.key,
    label: measure.label,
    item: measure.item,
    start_value: s,
    discharge_value: d,
  };

  if (s === null || d === null) {
    return { ...base, status: MEASURE_STATUS.EXCLUDED, reason: "missing_data" };
  }
  if (s < 0 || s > measure.startMax || d < 0 || d > measure.startMax) {
    return { ...base, status: MEASURE_STATUS.EXCLUDED, reason: "unratable_code" };
  }
  if (measure.excludeEither.includes(s) || measure.excludeEither.includes(d)) {
    return { ...base, status: MEASURE_STATUS.EXCLUDED, reason: "unratable_code" };
  }
  if (measure.excludeStart.includes(s)) {
    // Already at the most-independent level at SOC/ROC → no room to improve.
    return { ...base, status: MEASURE_STATUS.EXCLUDED, reason: "no_room_to_improve" };
  }
  // Lower discharge code == more independent == improvement.
  const improved = d < s;
  return {
    ...base,
    status: improved ? MEASURE_STATUS.IMPROVED : MEASURE_STATUS.NOT_IMPROVED,
    reason: improved ? "improved" : "no_improvement",
  };
}

/**
 * Compute the GG Discharge Function Score from a discharge answers map.
 * Returns { applicable, score, items_scored } where score is the raw summed
 * function total (higher = more independent). Not applicable when fewer than
 * half of the standard function items were coded (CMS requires the item set to
 * be substantially complete before the raw score is meaningful).
 * @param {Object<string, number>} dcAns
 */
export function computeGGDischargeFunctionScore(dcAns) {
  let score = 0;
  let scored = 0;
  for (const item of GG_FUNCTION_ITEMS) {
    let v = toNum(dcAns[item]);
    if (v === null) continue;
    if (GG_NOT_ATTEMPTED.has(v)) v = GG_MIN_DEPENDENT; // impute most-dependent
    if (v < GG_MIN_DEPENDENT || v > GG_MAX_INDEPENDENT) continue; // out of range
    score += v;
    scored += 1;
  }
  const applicable = scored >= Math.ceil(GG_FUNCTION_ITEMS.length / 2);
  return {
    applicable,
    score: applicable ? score : null,
    items_scored: scored,
    items_possible: GG_FUNCTION_ITEMS.length,
    max_possible: applicable ? GG_FUNCTION_ITEMS.length * GG_MAX_INDEPENDENT : null,
  };
}

// Discharge dispositions (M2420 / PatientOutcomeMetric.discharge_disposition)
// that remove an episode from the improvement-measure denominators. Death is
// always excluded; the numeric M2420 codes are 2=hospital, 3=rehab, 4=NH.
const DECEASED_DISPOSITIONS = new Set(["deceased", "died", "death", "expired"]);

function isDeceasedEpisode({ dischargeDisposition }) {
  // M2420 has no explicit "deceased" code in this app's question set, so death
  // is signalled only via the explicit disposition string.
  return !!dischargeDisposition && DECEASED_DISPOSITIONS.has(String(dischargeDisposition).toLowerCase());
}

/**
 * Compute all outcome measures for one paired episode (SOC/ROC + Discharge).
 *
 * @param {Object} opts
 * @param {Object} opts.start       SOC/ROC answers map OR oasis_items array
 * @param {Object} opts.discharge   Discharge answers map OR oasis_items array
 * @param {string} [opts.dischargeDisposition]  e.g. "remained_home" | "deceased"
 * @returns {{
 *   eligible: boolean,
 *   episode_excluded_reason: (string|null),
 *   measures: Array,
 *   improved_count: number,
 *   eligible_measure_count: number,
 *   overall_improvement_score: (number|null),
 *   gg_discharge_function: object,
 * }}
 */
export function computeEpisodeOutcome({ start, discharge, dischargeDisposition } = {}) {
  const startAns = answersFromOasisItems(start);
  const dcAns = answersFromOasisItems(discharge);

  const deceased = isDeceasedEpisode({ dischargeDisposition });

  const measures = IMPROVEMENT_MEASURES.map((m) => {
    if (deceased) {
      const s = toNum(startAns[m.item]);
      const d = toNum(dcAns[m.item]);
      return {
        key: m.key, label: m.label, item: m.item,
        start_value: s, discharge_value: d,
        status: MEASURE_STATUS.EXCLUDED, reason: "episode_ended_in_death",
      };
    }
    return evaluateMeasure(m, startAns, dcAns);
  });

  const eligibleMeasures = measures.filter((r) => r.status !== MEASURE_STATUS.EXCLUDED);
  const improved = eligibleMeasures.filter((r) => r.status === MEASURE_STATUS.IMPROVED);
  const overall = eligibleMeasures.length
    ? Math.round((improved.length / eligibleMeasures.length) * 100)
    : null;

  return {
    eligible: !deceased && eligibleMeasures.length > 0,
    episode_excluded_reason: deceased ? "episode_ended_in_death" : null,
    measures,
    improved_count: improved.length,
    eligible_measure_count: eligibleMeasures.length,
    overall_improvement_score: overall,
    gg_discharge_function: computeGGDischargeFunctionScore(dcAns),
  };
}

/**
 * Build a PatientOutcomeMetric-shaped record from an episode outcome. Only maps
 * onto fields the PatientOutcomeMetric entity defines (extra keys would be
 * dropped by the Base44 platform).
 *
 * @param {Object} opts
 * @param {string} opts.patientId
 * @param {string} [opts.episodeStart]  ISO date (SOC assessment date)
 * @param {string} [opts.episodeEnd]    ISO date (discharge assessment date)
 * @param {string} [opts.dischargeDisposition]
 * @param {string} [opts.primaryDiagnosis]
 * @param {object} outcome              result of computeEpisodeOutcome
 * @returns {object} PatientOutcomeMetric create payload
 */
export function toPatientOutcomeMetric({ patientId, episodeStart, episodeEnd, dischargeDisposition, primaryDiagnosis }, outcome) {
  const byKey = Object.fromEntries(outcome.measures.map((m) => [m.key, m]));
  const flag = (key) => byKey[key]?.status === MEASURE_STATUS.IMPROVED;

  return {
    patient_id: patientId,
    ...(episodeStart ? { episode_start: episodeStart } : {}),
    ...(episodeEnd ? { episode_end: episodeEnd } : {}),
    ...(dischargeDisposition ? { discharge_disposition: dischargeDisposition } : {}),
    ...(primaryDiagnosis ? { primary_diagnosis: primaryDiagnosis } : {}),
    functional_improvement: {
      ambulation_improved: flag("ambulation"),
      bathing_improved: flag("bathing"),
      transferring_improved: flag("bed_transfer"),
      medication_management_improved: flag("oral_meds"),
      dyspnea_improved: flag("dyspnea"),
      // null (every measure excluded) means "not measurable" — recording 0
      // would fabricate a measured 0% improvement, so omit the field instead.
      ...(outcome.overall_improvement_score != null
        ? { overall_improvement_score: outcome.overall_improvement_score }
        : {}),
    },
    gg_discharge_function_score: outcome.gg_discharge_function.score ?? undefined,
    measure_results: outcome.measures.map((m) => ({
      measure: m.key,
      status: m.status,
      start_value: m.start_value,
      discharge_value: m.discharge_value,
      reason: m.reason,
    })),
    outcome_measure_source: "oasis_change_score",
  };
}

/**
 * Roll a set of episode outcomes up into agency-level measure rates.
 *
 * @param {Array} outcomes  computeEpisodeOutcome results
 * @returns {{measures: Array, star_eligible_measure_count: number, star_eligible: boolean, total_episodes: number}}
 */
export function rollupMeasures(outcomes = []) {
  const acc = new Map(); // key -> { numerator, denominator }
  for (const m of IMPROVEMENT_MEASURES) acc.set(m.key, { numerator: 0, denominator: 0 });

  for (const outcome of outcomes) {
    for (const r of outcome.measures || []) {
      const bucket = acc.get(r.key);
      if (!bucket) continue;
      if (r.status === MEASURE_STATUS.EXCLUDED) continue;
      bucket.denominator += 1;
      if (r.status === MEASURE_STATUS.IMPROVED) bucket.numerator += 1;
    }
  }

  const measures = IMPROVEMENT_MEASURES.map((m) => {
    const { numerator, denominator } = acc.get(m.key);
    const rate = denominator > 0 ? Math.round((numerator / denominator) * 1000) / 10 : null;
    const starEligible = denominator >= STAR_MIN_EPISODES;
    return {
      key: m.key,
      label: m.label,
      item: m.item,
      numerator,
      denominator,
      rate, // percentage, one decimal
      star_eligible: starEligible,
    };
  });

  const starEligibleCount = measures.filter((m) => m.star_eligible).length;
  return {
    measures,
    total_episodes: outcomes.length,
    star_eligible_measure_count: starEligibleCount,
    star_eligible: starEligibleCount >= STAR_MIN_MEASURES,
  };
}

/**
 * Convert a rollup into AgencyKPI create payloads (one per measure with a
 * computable rate). Matches the AgencyKPI entity contract.
 *
 * @param {object} rollup     result of rollupMeasures
 * @param {Object} opts
 * @param {string} opts.periodStart  ISO date
 * @param {string} opts.periodEnd    ISO date
 * @param {string} [opts.periodType] daily|weekly|monthly|quarterly|yearly
 * @param {string} [opts.agencyId]
 * @param {number} [opts.benchmark]  national benchmark rate (%) applied to all
 * @returns {Array<object>} AgencyKPI create payloads
 */
export function toAgencyKPIs(rollup, { periodStart, periodEnd, periodType = "quarterly", agencyId, benchmark } = {}) {
  return (rollup?.measures || [])
    .filter((m) => m.rate !== null)
    .map((m) => {
      // Without a configured benchmark there is no performance signal —
      // "on_target" earned by episode volume alone is a false quality claim.
      const status = benchmark == null
        ? "warning"
        : (m.rate >= benchmark ? "on_target" : m.rate >= benchmark - 10 ? "warning" : "critical");
      return {
        ...(agencyId ? { agency_id: agencyId } : {}),
        metric_name: m.label,
        metric_category: "quality",
        period_type: periodType,
        period_start: periodStart,
        period_end: periodEnd,
        metric_value: m.rate,
        ...(benchmark != null ? { benchmark_value: benchmark } : {}),
        unit: "%",
        status,
        contributing_factors: [
          `${m.numerator} of ${m.denominator} eligible episodes improved`,
          m.star_eligible
            ? `Meets the ${STAR_MIN_EPISODES}-episode star-rating threshold`
            : `Below the ${STAR_MIN_EPISODES}-episode star-rating threshold (${m.denominator})`,
          ...(benchmark == null
            ? ["No national benchmark configured — performance not rated against a target"]
            : []),
        ],
      };
    });
}
