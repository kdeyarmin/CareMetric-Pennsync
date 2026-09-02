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
import {
  partitionRowsForCms,
  RESPONSE_SCHEMA_V2_CMS_E2,
  resolveInstrumentForAssessment,
} from "./responseSchema/registry.js";

export const IMPROVEMENT_MEASURES = [
  {
    key: "ambulation",
    item: "m1860",
    // Scored ONLY from a v2 CMS-aligned response. The legacy M1860 scale inserted
    // an "uneven surfaces" level CMS does not have, so every legacy code from 1
    // upward names a different functional level than the same CMS code.
    definitionId: "m1860_cms_e2",
    // CMS response order, least to most dependent. Rank is the INDEX here — no
    // code is ever parsed as a number.
    ordinalCodes: ["0", "1", "2", "3", "4", "5", "6"],
    label: "Improvement in Ambulation/Locomotion",
    excludeStartCodes: ["0"],
    excludeEitherCodes: [],
    metricField: "ambulation_improved",
  },
  {
    key: "bed_transfer",
    item: "m1850",
    label: "Improvement in Bed Transferring",
    // M1850 is one of the five ABBREVIATED items deliberately left out of the
    // CMS-alignment cutover, so PennSync holds no verified response set for it.
    // With no v2 definition it can never be scored — excluded with a named
    // reason rather than scored from a response set nobody has verified.
    definitionId: null,
    ordinalCodes: [],
    excludeStartCodes: [],
    excludeEitherCodes: [],
    metricField: "transferring_improved",
  },
  {
    key: "bathing",
    item: "m1830",
    label: "Improvement in Bathing",
    definitionId: "m1830_cms_e2",
    ordinalCodes: ["0", "1", "2", "3", "4", "5", "6"],
    excludeStartCodes: ["0"],
    // CMS 6 is "Unable to participate effectively in bathing and is bathed
    // totally by another person" — a real, most-dependent functional level, so
    // it stays in the denominator (6→3 improves). It was previously excluded
    // because the LEGACY 6 meant "unable to rate — artificial opening". Legacy
    // rows are excluded wholesale by the schema gate, so no legacy 6 reaches
    // this list.
    excludeEitherCodes: [],
    metricField: "bathing_improved",
  },
  {
    key: "dyspnea",
    item: "m1400",
    label: "Improvement in Dyspnea",
    definitionId: "m1400_cms_e2",
    ordinalCodes: ["0", "1", "2", "3", "4"],
    excludeStartCodes: ["0"],
    excludeEitherCodes: [],
    metricField: "dyspnea_improved",
  },
  {
    key: "oral_meds",
    item: "m2020",
    label: "Improvement in Management of Oral Medications",
    definitionId: "m2020_cms_e2",
    // "NA" (no oral medications prescribed) is deliberately NOT in the ordinal
    // list: it is not a point on the ability scale, so an episode carrying it is
    // excluded rather than ranked.
    ordinalCodes: ["0", "1", "2", "3"],
    excludeStartCodes: ["0"],
    excludeEitherCodes: [],
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
/**
 * Bumped whenever the deterministic outcome core changes meaning, so a stored
 * metric records which rules produced it and stale records can be retired
 * rather than silently re-read under new rules.
 */
export const OUTCOME_CALCULATION_VERSION = "2026-09-01.v2-cms-e2";

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
 * Extract CMS-scorable responses from a WHOLE assessment.
 *
 * Takes the assessment, not a bare response map, because eligibility depends on
 * provenance the map does not carry: which response schema the answer was picked
 * from, whether the instrument resolved, whether the item is collected at this
 * time point, and whether a clinician actually selected it. A bare map cannot
 * answer any of those, which is how a legacy `6` was scored as if it were the
 * CMS one.
 *
 * Returns OPAQUE STRING codes. Nothing here parses a code as a number.
 *
 * @param {object} assessment Full OASISAssessment row.
 * @returns {{ codes: Object<string,string>, excluded: Array<{item: string, reasons: string[]}>, schemaId: string|null }}
 */
export function scorableCodesFromAssessment(assessment) {
  const { included, excluded } = partitionRowsForCms(assessment);
  const codes = {};
  for (const { row, verdict } of included) {
    const def = verdict.definition;
    // Only single-valued scales feed the improvement measures.
    if (def.response_shape !== "single") continue;
    codes[String(def.item_number).toLowerCase()] = row.response_value.code;
  }
  return {
    codes,
    excluded: excluded.map(({ row, reasons }) => ({
      item: row?.item_number || row?.definition_id || "unknown",
      reasons,
    })),
    schemaId: assessment?.response_schema_id || null,
  };
}

/**
 * Flat answers for the GG Discharge Function Score ONLY.
 *
 * GG0130/GG0170 are NOT among the 18 items whose PennSync response sets were
 * found to conflict with CMS, so they are outside this cutover and keep their
 * existing extraction. Gating them on a v2 definition that does not exist would
 * silently switch the GG measure off, which is a different regression from the
 * one this change is fixing. Their response sets have not been independently
 * verified here and are recorded as out of scope in the migration document.
 *
 * @param {Array|Object} source oasis_items array, assessment, or flat map
 */
function ggAnswersFrom(source) {
  const out = {};
  const take = (key, raw) => {
    const k = String(key).toLowerCase().replace(/[^a-z0-9]/g, "");
    if (!GG_FUNCTION_ITEMS.includes(k)) return;
    const n = toNum(raw);
    if (n !== null) out[k] = n;
  };
  if (!source) return out;
  const items = Array.isArray(source) ? source : source.oasis_items;
  if (Array.isArray(items)) {
    for (const it of items) {
      if (!it || it.item_number == null) continue;
      take(it.item_number, it.response_value?.code ?? it.response);
    }
    return out;
  }
  if (!Array.isArray(source) && typeof source === "object" && !source.oasis_items) {
    for (const [k, v] of Object.entries(source)) take(k, v);
  }
  return out;
}

/**
 * LEGACY shape adapter, kept so pre-cutover callers do not silently change
 * meaning. It no longer produces scorable values: a row that does not state the
 * v2 response schema yields nothing, because its codes mean whatever PennSync's
 * old option list meant.
 *
 * @param {Array|Object} items
 * @returns {Object<string, string>} opaque codes, never numbers
 */
export function answersFromOasisItems(items) {
  if (!Array.isArray(items)) return {};
  const out = {};
  for (const it of items) {
    if (!it || it.item_number == null) continue;
    if (it.response_schema_id !== RESPONSE_SCHEMA_V2_CMS_E2) continue;
    if (it.item_source !== "cms_item") continue;
    if (it.response_origin !== "clinician_selected") continue;
    const v = it.response_value;
    if (!v || typeof v !== "object" || typeof v.code !== "string") continue;
    out[String(it.item_number).toLowerCase().replace(/[^a-z0-9]/g, "")] = v.code;
  }
  return out;
}

/**
 * Evaluate a single improvement measure for one episode.
 * @returns {{key,label,item,status,start_value,discharge_value,reason}}
 */
function evaluateMeasure(measure, startAns, dcAns) {
  const sCode = startAns[measure.item];
  const dCode = dcAns[measure.item];
  const base = {
    key: measure.key,
    label: measure.label,
    item: measure.item,
    start_value: sCode ?? null,
    discharge_value: dCode ?? null,
  };

  // No verified v2 response set for this item — it can never be scored.
  if (!measure.definitionId || measure.ordinalCodes.length === 0) {
    return { ...base, status: MEASURE_STATUS.EXCLUDED, reason: "no_verified_response_set" };
  }
  if (sCode === undefined || dCode === undefined) {
    return { ...base, status: MEASURE_STATUS.EXCLUDED, reason: "missing_data" };
  }

  // Rank = position in the CMS response order. A code that is not a point on
  // that ordinal scale (for example M2020 "NA") is unratable, not zero.
  const s = measure.ordinalCodes.indexOf(sCode);
  const d = measure.ordinalCodes.indexOf(dCode);
  if (s === -1 || d === -1) {
    return { ...base, status: MEASURE_STATUS.EXCLUDED, reason: "unratable_code" };
  }
  if (measure.excludeStartCodes.includes(sCode)) {
    return { ...base, status: MEASURE_STATUS.EXCLUDED, reason: "already_independent_at_start" };
  }
  if (measure.excludeEitherCodes.includes(sCode) || measure.excludeEitherCodes.includes(dCode)) {
    return { ...base, status: MEASURE_STATUS.EXCLUDED, reason: "unratable_code" };
  }
  return {
    ...base,
    status: d < s ? MEASURE_STATUS.IMPROVED : MEASURE_STATUS.NOT_IMPROVED,
    reason: null,
  };
}

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
export function computeEpisodeOutcome({ start, discharge, dischargeDisposition, startAssessment, dischargeAssessment } = {}) {
  // Prefer whole assessments; fall back to bare item arrays for callers not yet
  // migrated. Either way, only v2 clinician-selected rows become scorable.
  const startSrc = startAssessment || (Array.isArray(start) ? { oasis_items: start } : start);
  const dcSrc = dischargeAssessment || (Array.isArray(discharge) ? { oasis_items: discharge } : discharge);

  const startX = startAssessment
    ? scorableCodesFromAssessment(startAssessment)
    : { codes: answersFromOasisItems(startSrc?.oasis_items || start), excluded: [], schemaId: startSrc?.response_schema_id ?? null };
  const dcX = dischargeAssessment
    ? scorableCodesFromAssessment(dischargeAssessment)
    : { codes: answersFromOasisItems(dcSrc?.oasis_items || discharge), excluded: [], schemaId: dcSrc?.response_schema_id ?? null };

  const startAns = startX.codes;
  const dcAns = dcX.codes;

  // Episode-level fail-closed gates. A CMS-labeled rate may only be computed
  // when BOTH endpoints are trustworthy and carry compatible schemas; a mixed
  // pair is excluded with a visible reason and contributes ZERO denominator —
  // never coerced to "no improvement".
  const episodeExclusions = [];
  const startSchema = startAssessment ? startAssessment.response_schema_id : startX.schemaId;
  const dcSchema = dischargeAssessment ? dischargeAssessment.response_schema_id : dcX.schemaId;
  if (startAssessment && !resolveInstrumentForAssessment(startAssessment).resolved) {
    episodeExclusions.push("start_instrument_unresolved");
  }
  if (dischargeAssessment && !resolveInstrumentForAssessment(dischargeAssessment).resolved) {
    episodeExclusions.push("discharge_instrument_unresolved");
  }
  if (startAssessment || dischargeAssessment) {
    if (startSchema !== RESPONSE_SCHEMA_V2_CMS_E2) episodeExclusions.push("start_schema_not_v2");
    if (dcSchema !== RESPONSE_SCHEMA_V2_CMS_E2) episodeExclusions.push("discharge_schema_not_v2");
    if (startSchema && dcSchema && startSchema !== dcSchema) episodeExclusions.push("mixed_schema_episode");
  }

  const deceased = isDeceasedEpisode({ dischargeDisposition });

  const measures = IMPROVEMENT_MEASURES.map((m) => {
    if (episodeExclusions.length) {
      return {
        key: m.key, label: m.label, item: m.item,
        start_value: startAns[m.item] ?? null, discharge_value: dcAns[m.item] ?? null,
        status: MEASURE_STATUS.EXCLUDED, reason: episodeExclusions[0],
      };
    }
    if (deceased) {
      return {
        key: m.key, label: m.label, item: m.item,
        start_value: startAns[m.item] ?? null, discharge_value: dcAns[m.item] ?? null,
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
    eligible: !deceased && episodeExclusions.length === 0 && eligibleMeasures.length > 0,
    episode_excluded_reason: episodeExclusions[0] || (deceased ? "episode_ended_in_death" : null),
    // Every reason, and the per-row exclusions, stay visible. A consumer that
    // shows a rate must be able to show what it left out and why.
    episode_excluded_reasons: episodeExclusions,
    excluded_row_count: startX.excluded.length + dcX.excluded.length,
    excluded_rows: [...startX.excluded, ...dcX.excluded],
    measures,
    improved_count: improved.length,
    eligible_measure_count: eligibleMeasures.length,
    overall_improvement_score: overall,
    // Schema provenance travels with the result so a derived record can record
    // exactly which inputs produced it.
    input_response_schema_ids: [startSchema || null, dcSchema || null],
    calculation_version: OUTCOME_CALCULATION_VERSION,
    gg_discharge_function: episodeExclusions.length
      ? { applicable: false, score: null, excluded_reason: episodeExclusions[0], items_scored: 0 }
      : computeGGDischargeFunctionScore(ggAnswersFrom(dcSrc ?? discharge)),
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
