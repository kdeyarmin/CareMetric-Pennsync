import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// <<<BEGIN SHARED HELPER: schedulerAuth — generated, edit base44/_shared/backendHelpers.mjs>>>
const SCHEDULER_SECRET_HEADER = 'x-internal-secret';
function isSchedulerAdmin(user) {
  return !!user && user.role === 'admin';
}
// Constant-time string compare for the shared-secret check (mirrors
// createTelehealthToken's timingSafeEqual). A plain === short-circuits on the
// first differing character, so response timing could leak how much of the
// secret matched. Dependency-free char-code XOR so the identical source runs
// under Deno (consumers) and Node (tests).
function timingSafeEqualStr(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}
function getSchedulerAuthError(req, user) {
  if (isSchedulerAdmin(user)) return null;
  const expectedSecret = String(Deno.env.get('INTERNAL_FN_SECRET') || '').trim();
  if (!expectedSecret) {
    return Response.json(
      { error: 'Server misconfigured: INTERNAL_FN_SECRET is required for scheduled/internal functions' },
      { status: 500 },
    );
  }
  const providedSecret = String(req.headers.get(SCHEDULER_SECRET_HEADER) || '').trim();
  if (timingSafeEqualStr(providedSecret, expectedSecret)) return null;
  return Response.json(
    { error: user ? 'Forbidden: admin or scheduler secret required' : 'Unauthorized: scheduler secret required' },
    { status: user ? 403 : 401 },
  );
}
// <<<END SHARED HELPER: schedulerAuth>>>

// This job uses service-role reads and writes. It therefore accepts ONLY the
// server-held internal secret and every invocation must name exactly ONE
// agency. Browser sessions and mutable User/Agency membership fields are never
// authorization inputs. There is no platform-wide mode.
function hasValidInternalSecret(req) {
  const expectedSecret = String(Deno.env.get('INTERNAL_FN_SECRET') || '').trim();
  if (!expectedSecret) return false;
  const providedSecret = String(req.headers.get(SCHEDULER_SECRET_HEADER) || '').trim();
  return timingSafeEqualStr(providedSecret, expectedSecret);
}

function getOutcomeInitialAuthError(req) {
  const expectedSecret = String(Deno.env.get('INTERNAL_FN_SECRET') || '').trim();
  if (!expectedSecret) {
    return Response.json(
      { error: 'Server misconfigured: INTERNAL_FN_SECRET is required for scheduled/internal functions' },
      { status: 500 },
    );
  }
  if (hasValidInternalSecret(req)) return null;
  return Response.json(
    { error: 'Unauthorized: internal scheduler secret required' },
    { status: 401 },
  );
}

// computeOutcomeMeasures — internal outcome-proxy computation.
//
// Pairs in-app Discharge OASIS rows with matching SOC/ROC assessments, computes
// unadjusted internal improvement proxies, writes a PatientOutcomeMetric per
// episode, and rolls the results up into AgencyKPI rows. These values are not
// official CMS rates, eligibility determinations, star inputs, or HHVBP results.
//
// The scoring below is a verbatim mirror of the unit-tested pure engine in
// src/components/oasis/outcomeMeasureEngine.js. The edge function runs on Deno
// and cannot import from src/, so the deterministic core is inlined here. Keep
// the two in step: any change to a measure/exclusion rule must be made in both.

// <<<BEGIN SHARED HELPER: isAdminLike — generated, edit base44/_shared/backendHelpers.mjs>>>
const isAdminLike = (u) => !!u && u.role === 'admin';
// <<<END SHARED HELPER: isAdminLike>>>

// <<<BEGIN SHARED HELPER: requireActiveUser — generated, edit base44/_shared/backendHelpers.mjs>>>
const isDeactivatedUser = (u) => !!u && u.is_active === false;
const DEACTIVATED_USER_RESPONSE = () => Response.json(
  { error: 'Unauthorized - account is deactivated' },
  { status: 403 },
);
// <<<END SHARED HELPER: requireActiveUser>>>


// ── inlined outcome-measure engine (mirror of outcomeMeasureEngine.js) ────────
// Ranked by POSITION in the CMS response order — never by parsing a code as a
// number. Mirror of src/components/oasis/outcomeMeasureEngine.js; parity is
// asserted by base44/functionTests/computeOutcomeMeasuresContract.test.js.
const OASIS_RESPONSE_SCHEMA_V2_CMS_E2 = 'pennsync-oasis-response-v2-cms-e2';
const OUTCOME_CALCULATION_VERSION = '2026-09-02.v3-internal-proxy';
const IMPROVEMENT_MEASURES = [
  { key: 'ambulation', item: 'm1860', label: 'Improvement in Ambulation/Locomotion', definitionId: 'm1860_cms_e2', ordinalCodes: ['0', '1', '2', '3', '4', '5', '6'], excludeStartCodes: ['0'], excludeEitherCodes: [], metricField: 'ambulation_improved' },
  // M1850 was left out of the CMS-alignment cutover, so PennSync holds no
  // verified response set for it and it can never be scored.
  { key: 'bed_transfer', item: 'm1850', label: 'Improvement in Bed Transferring', definitionId: null, ordinalCodes: [], excludeStartCodes: [], excludeEitherCodes: [], metricField: 'transferring_improved' },
  // CMS M1830 code 6 is "bathed totally by another person" — a real, most-
  // dependent level that stays in the denominator. It was excluded because the
  // LEGACY 6 meant "unable to rate — artificial opening"; legacy rows are now
  // excluded wholesale by the schema gate, so no legacy 6 reaches this scale.
  { key: 'bathing', item: 'm1830', label: 'Improvement in Bathing', definitionId: 'm1830_cms_e2', ordinalCodes: ['0', '1', '2', '3', '4', '5', '6'], excludeStartCodes: ['0'], excludeEitherCodes: [], metricField: 'bathing_improved' },
  { key: 'dyspnea', item: 'm1400', label: 'Improvement in Dyspnea', definitionId: 'm1400_cms_e2', ordinalCodes: ['0', '1', '2', '3', '4'], excludeStartCodes: ['0'], excludeEitherCodes: [], metricField: 'dyspnea_improved' },
  // "NA" is deliberately absent from the ordinal list: it is not a point on the
  // ability scale, so an episode carrying it is excluded rather than ranked.
  { key: 'oral_meds', item: 'm2020', label: 'Improvement in Management of Oral Medications', definitionId: 'm2020_cms_e2', ordinalCodes: ['0', '1', '2', '3'], excludeStartCodes: ['0'], excludeEitherCodes: [], metricField: 'medication_management_improved' },
];
const EXPECTED_DEFINITION_BY_ITEM = new Map([
  ...IMPROVEMENT_MEASURES
    .filter((measure) => measure.definitionId)
    .map((measure) => [measure.item, measure.definitionId]),
  ['m2420', 'm2420_cms_e2'],
]);
const OUTCOME_PROVENANCE_ITEMS = new Set(EXPECTED_DEFINITION_BY_ITEM.keys());
const INTERNAL_SAMPLE_MIN_PAIRS = 20;
const INTERNAL_SAMPLE_MEASURE_TARGET = 5;
const ENTITY_PAGE_SIZE = 500;
const MAX_DISCHARGE_ROWS = 50_000;
const MAX_PRIOR_ROWS_PER_PATIENT = 10_000;
const MAX_MATCHING_DERIVED_ROWS = 5_000;
const GG_FUNCTION_ITEMS = [
  'gg0130a', 'gg0130b', 'gg0130c', 'gg0130e', 'gg0130f', 'gg0130g', 'gg0130h',
  'gg0170a', 'gg0170b', 'gg0170c', 'gg0170d', 'gg0170e', 'gg0170f',
  'gg0170i', 'gg0170j', 'gg0170k', 'gg0170l', 'gg0170m',
];
const GG_NOT_ATTEMPTED = new Set([7, 9, 10, 88]);
const DECEASED_DISPOSITIONS = new Set(['deceased', 'died', 'death', 'expired']);

function toNum(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = typeof v === 'number' ? v : parseInt(String(v).trim(), 10);
  return Number.isNaN(n) ? null : n;
}
// Only a v2, CMS-sourced, clinician-selected response is CMS-scorable. A row
// that states no response schema, or the frozen legacy one, means whatever
// PennSync's old option list meant and yields NOTHING — it is never coerced to
// zero or to a low functional level.
function scorableCodesFromAssessment(assessment) {
  const out = {};
  const excluded = [];
  const items = Array.isArray(assessment?.oasis_items) ? assessment.oasis_items : [];
  const normalizedItem = (row) => String(row?.item_number || '')
    .toLowerCase().replace(/[^a-z0-9]/g, '');
  const normalizedDefinition = (row) => String(row?.definition_id || '')
    .toLowerCase().replace(/[^a-z0-9]/g, '');
  const itemCounts = new Map();
  const definitionCounts = new Map();
  for (const row of items) {
    const key = normalizedItem(row);
    if (key) itemCounts.set(key, (itemCounts.get(key) || 0) + 1);
    const definitionKey = normalizedDefinition(row);
    if (definitionKey) {
      definitionCounts.set(definitionKey, (definitionCounts.get(definitionKey) || 0) + 1);
    }
  }
  for (const it of items) {
    if (!it || it.item_number == null) { excluded.push({ item: 'unknown', reason: 'missing_item_number' }); continue; }
    const key = normalizedItem(it);
    if ((itemCounts.get(key) || 0) > 1) {
      excluded.push({ item: it.item_number, reason: 'duplicate_item_response' });
      continue;
    }
    const definitionKey = normalizedDefinition(it);
    if (definitionKey && (definitionCounts.get(definitionKey) || 0) > 1) {
      excluded.push({ item: it.item_number, reason: 'duplicate_definition_response' });
      continue;
    }
    if (it.response_schema_id !== OASIS_RESPONSE_SCHEMA_V2_CMS_E2) {
      excluded.push({ item: it.item_number, reason: it.response_schema_id ? 'legacy_response_schema' : 'missing_response_schema' });
      continue;
    }
    const expectedDefinition = EXPECTED_DEFINITION_BY_ITEM.get(key);
    // Ignore unrelated OASIS/GG rows here; only the explicit improvement and
    // disposition items can feed this computation.
    if (!expectedDefinition) continue;
    if (it.definition_id !== expectedDefinition) {
      excluded.push({ item: it.item_number, reason: 'unknown_or_mismatched_definition' });
      continue;
    }
    if (!it.item_spec_version || it.item_spec_version !== 'oasis-e2') {
      excluded.push({
        item: it.item_number,
        reason: it.item_spec_version ? 'instrument_mismatch' : 'missing_item_spec_version',
      });
      continue;
    }
    if (it.item_source !== 'cms_item') { excluded.push({ item: it.item_number, reason: 'not_cms_item' }); continue; }
    if (it.response_origin !== 'clinician_selected') { excluded.push({ item: it.item_number, reason: 'not_clinician_selected' }); continue; }
    if (it.ai_suggested === true) { excluded.push({ item: it.item_number, reason: 'ai_originated' }); continue; }
    const code = it.response_value && typeof it.response_value === 'object' ? it.response_value.code : undefined;
    if (typeof code !== 'string') { excluded.push({ item: it.item_number, reason: 'invalid_response_shape' }); continue; }
    out[key] = code;
  }
  return { codes: out, excluded };
}

// GG0130/GG0170 are NOT among the 18 items whose response sets conflicted, so
// they are outside this cutover and keep their existing extraction.
function ggAnswersFrom(assessment) {
  const out = {};
  const counts = new Map();
  const items = Array.isArray(assessment?.oasis_items) ? assessment.oasis_items : [];
  for (const it of items) {
    if (!it || it.item_number == null) continue;
    const key = String(it.item_number).toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!GG_FUNCTION_ITEMS.includes(key)) continue;
    counts.set(key, (counts.get(key) || 0) + 1);
    if (counts.get(key) > 1) {
      delete out[key];
      continue;
    }
    const n = toNum(it.response_value?.code ?? it.response);
    if (n !== null) out[key] = n;
  }
  return out;
}
function evaluateMeasure(measure, startAns, dcAns) {
  const sCode = startAns[measure.item];
  const dCode = dcAns[measure.item];
  const base = { key: measure.key, label: measure.label, item: measure.item, start_value: sCode ?? null, discharge_value: dCode ?? null };
  if (!measure.definitionId || measure.ordinalCodes.length === 0) {
    return { ...base, status: 'excluded', reason: 'no_verified_response_set' };
  }
  if (sCode === undefined || dCode === undefined) return { ...base, status: 'excluded', reason: 'missing_data' };
  const s = measure.ordinalCodes.indexOf(sCode);
  const d = measure.ordinalCodes.indexOf(dCode);
  if (s === -1 || d === -1) return { ...base, status: 'excluded', reason: 'unratable_code' };
  if (measure.excludeStartCodes.includes(sCode)) return { ...base, status: 'excluded', reason: 'already_independent_at_start' };
  if (measure.excludeEitherCodes.includes(sCode) || measure.excludeEitherCodes.includes(dCode)) {
    return { ...base, status: 'excluded', reason: 'unratable_code' };
  }
  const improved = d < s;
  return { ...base, status: improved ? 'improved' : 'not_improved', reason: improved ? 'improved' : 'no_improvement' };
}
function computeInternalGg18ItemRawSum(dcAns) {
  let score = 0, scored = 0;
  for (const item of GG_FUNCTION_ITEMS) {
    let v = toNum(dcAns[item]);
    if (v === null) continue;
    if (GG_NOT_ATTEMPTED.has(v)) v = 1;
    if (v < 1 || v > 6) continue;
    score += v; scored += 1;
  }
  const applicable = scored >= Math.ceil(GG_FUNCTION_ITEMS.length / 2);
  return { applicable, score: applicable ? score : null, items_scored: scored };
}
function oasisResolveInstrumentOk(assessment) {
  const raw = assessment?.assessment_date;
  if (raw === null || raw === undefined || String(raw).trim() === '') return false;
  const t = Date.parse(String(raw));
  return Number.isFinite(t) &&
    t >= Date.parse('2026-04-01') &&
    assessment?.instrument_version === 'oasis-e2';
}

function computeEpisodeOutcome({ start, discharge, dischargeDisposition }) {
  const startX = scorableCodesFromAssessment(start);
  const dcX = scorableCodesFromAssessment(discharge);
  const startAns = startX.codes;
  const dcAns = dcX.codes;

  // Episode-level fail-closed gates. An internal proxy may only be computed
  // when BOTH endpoints carry the v2 schema and a resolvable instrument. A
  // legacy or mixed pair is excluded with a visible reason and contributes ZERO
  // denominator — never "no improvement".
  const episodeExclusions = [];
  const startSchema = start?.response_schema_id ?? null;
  const dcSchema = discharge?.response_schema_id ?? null;
  if (!oasisResolveInstrumentOk(start)) episodeExclusions.push('start_instrument_unresolved');
  if (!oasisResolveInstrumentOk(discharge)) episodeExclusions.push('discharge_instrument_unresolved');
  if (startSchema !== OASIS_RESPONSE_SCHEMA_V2_CMS_E2) episodeExclusions.push('start_schema_not_v2');
  if (dcSchema !== OASIS_RESPONSE_SCHEMA_V2_CMS_E2) episodeExclusions.push('discharge_schema_not_v2');
  if (startSchema && dcSchema && startSchema !== dcSchema) episodeExclusions.push('mixed_schema_episode');
  if (startX.excluded.some((row) => row.reason === 'duplicate_item_response')) {
    episodeExclusions.push('start_duplicate_item_response');
  }
  if (dcX.excluded.some((row) => row.reason === 'duplicate_item_response')) {
    episodeExclusions.push('discharge_duplicate_item_response');
  }
  if (startX.excluded.some((row) => row.reason === 'duplicate_definition_response')) {
    episodeExclusions.push('start_duplicate_definition_response');
  }
  if (dcX.excluded.some((row) => row.reason === 'duplicate_definition_response')) {
    episodeExclusions.push('discharge_duplicate_definition_response');
  }
  const invalidIdentityReasons = new Set([
    'unknown_or_mismatched_definition',
    'missing_item_spec_version',
    'instrument_mismatch',
  ]);
  const hasInvalidOutcomeIdentity = (exclusions) => exclusions.some((row) => {
    const key = String(row?.item || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    return OUTCOME_PROVENANCE_ITEMS.has(key) && invalidIdentityReasons.has(row.reason);
  });
  if (hasInvalidOutcomeIdentity(startX.excluded)) {
    episodeExclusions.push('start_unverified_item_provenance');
  }
  if (hasInvalidOutcomeIdentity(dcX.excluded)) {
    episodeExclusions.push('discharge_unverified_item_provenance');
  }

  const deceased = dischargeDisposition && DECEASED_DISPOSITIONS.has(String(dischargeDisposition).toLowerCase());
  const measures = IMPROVEMENT_MEASURES.map((m) => {
    if (episodeExclusions.length) {
      return { key: m.key, label: m.label, item: m.item, start_value: startAns[m.item] ?? null, discharge_value: dcAns[m.item] ?? null, status: 'excluded', reason: episodeExclusions[0] };
    }
    if (deceased) {
      return { key: m.key, label: m.label, item: m.item, start_value: startAns[m.item] ?? null, discharge_value: dcAns[m.item] ?? null, status: 'excluded', reason: 'episode_ended_in_death' };
    }
    return evaluateMeasure(m, startAns, dcAns);
  });
  const eligibleMeasures = measures.filter((r) => r.status !== 'excluded');
  const improved = eligibleMeasures.filter((r) => r.status === 'improved');
  const overall = eligibleMeasures.length ? Math.round((improved.length / eligibleMeasures.length) * 100) : null;
  return {
    eligible: !deceased && episodeExclusions.length === 0 && eligibleMeasures.length > 0,
    episode_excluded_reason: episodeExclusions[0] || (deceased ? 'episode_ended_in_death' : null),
    episode_excluded_reasons: episodeExclusions,
    excluded_row_count: startX.excluded.length + dcX.excluded.length,
    excluded_rows: [...startX.excluded, ...dcX.excluded],
    measures,
    improved_count: improved.length,
    eligible_measure_count: eligibleMeasures.length,
    overall_improvement_score: overall,
    input_response_schema_ids: [startSchema, dcSchema],
    source_assessment_ids: [start?.id ?? null, discharge?.id ?? null],
    instrument_versions: [start?.instrument_version ?? null, discharge?.instrument_version ?? null],
    calculation_version: OUTCOME_CALCULATION_VERSION,
    internal_gg_18_item_raw_sum: episodeExclusions.length
      ? { applicable: false, score: null, items_scored: 0 }
      : computeInternalGg18ItemRawSum(ggAnswersFrom(discharge)),
  };
}
function toPatientOutcomeMetric(meta, outcome) {
  const byKey = Object.fromEntries(outcome.measures.map((m) => [m.key, m]));
  const flag = (key) => {
    const status = byKey[key]?.status;
    if (status === 'improved') return true;
    if (status === 'not_improved') return false;
    return undefined;
  };
  const maybeFlag = (key, field) => {
    const value = flag(key);
    return value === undefined ? {} : { [field]: value };
  };
  return {
    agency_id: meta.agencyId,
    patient_id: meta.patientId,
    ...(meta.episodeStart ? { episode_start: meta.episodeStart } : {}),
    ...(meta.episodeEnd ? { episode_end: meta.episodeEnd } : {}),
    ...(meta.dischargeDisposition ? { discharge_disposition: meta.dischargeDisposition } : {}),
    ...(meta.primaryDiagnosis ? { primary_diagnosis: meta.primaryDiagnosis } : {}),
    functional_improvement: {
      ...maybeFlag('ambulation', 'ambulation_improved'),
      ...maybeFlag('bathing', 'bathing_improved'),
      ...maybeFlag('bed_transfer', 'transferring_improved'),
      ...maybeFlag('oral_meds', 'medication_management_improved'),
      ...maybeFlag('dyspnea', 'dyspnea_improved'),
      // null (every measure excluded) means "not measurable" — recording 0
      // would fabricate a measured 0% improvement, so omit the field instead.
      ...(outcome.overall_improvement_score != null
        ? { overall_improvement_score: outcome.overall_improvement_score }
        : {}),
    },
    ...(outcome.internal_gg_18_item_raw_sum.score != null
      ? { internal_gg_18_item_raw_sum: outcome.internal_gg_18_item_raw_sum.score }
      : {}),
    // Persist CMS response codes as opaque strings. Missing endpoints are
    // omitted instead of asking hosted validation to persist null.
    measure_results: outcome.measures.map((m) => ({
      measure: m.key,
      status: m.status,
      ...(m.start_value != null ? { start_value: m.start_value } : {}),
      ...(m.discharge_value != null ? { discharge_value: m.discharge_value } : {}),
      reason: m.reason,
    })),
    outcome_measure_source: 'oasis_change_score',
    // Provenance travels with the derived record so a reviewer can tell which
    // response meanings produced it, and so records without verified v2 inputs
    // can be retired from current internal proxy views instead of silently re-read.
    input_response_schema_ids: outcome.input_response_schema_ids.map((x) => x || 'unknown'),
    source_assessment_ids: (outcome.source_assessment_ids || []).map((x) => x || 'unknown'),
    instrument_versions: (outcome.instrument_versions || []).map((x) => x || 'unknown'),
    calculation_version: outcome.calculation_version,
  };
}
function rollupMeasures(outcomes) {
  const acc = new Map();
  for (const m of IMPROVEMENT_MEASURES) acc.set(m.key, { numerator: 0, denominator: 0 });
  for (const outcome of outcomes) {
    for (const r of outcome.measures || []) {
      const bucket = acc.get(r.key);
      if (!bucket || r.status === 'excluded') continue;
      bucket.denominator += 1;
      if (r.status === 'improved') bucket.numerator += 1;
    }
  }
  const measures = IMPROVEMENT_MEASURES.map((m) => {
    const { numerator, denominator } = acc.get(m.key);
    const rate = denominator > 0 ? Math.round((numerator / denominator) * 1000) / 10 : null;
    return {
      key: m.key,
      label: m.label,
      item: m.item,
      numerator,
      denominator,
      rate,
      internal_sample_ready: denominator >= INTERNAL_SAMPLE_MIN_PAIRS,
    };
  });
  const internalSampleReadyCount = measures.filter((m) => m.internal_sample_ready).length;
  return {
    measures,
    total_episodes: outcomes.length,
    internal_sample_ready_measure_count: internalSampleReadyCount,
    internal_sample_ready: internalSampleReadyCount >= INTERNAL_SAMPLE_MEASURE_TARGET,
  };
}
function toAgencyKPIs(rollup, opts) {
  const { periodStart, periodEnd, periodType, agencyId, benchmark, excludedEpisodeCount = 0 } = opts;
  if (!agencyId) throw new Error('agencyId is required for AgencyKPI writes');
  if (!['daily', 'weekly', 'monthly', 'quarterly', 'yearly', 'custom'].includes(periodType)) {
    throw new Error('an explicit supported periodType is required for AgencyKPI writes');
  }
  return (rollup?.measures || [])
    .filter((m) => m.rate !== null)
    .map((m) => {
      // Without a configured benchmark there is no performance signal —
      // "on_target" earned by episode volume alone is a false quality claim.
      const status = benchmark == null
        ? 'warning'
        : (m.rate >= benchmark ? 'on_target' : m.rate >= benchmark - 10 ? 'warning' : 'critical');
      return {
        agency_id: agencyId,
        is_current: true,
        metric_name: m.label,
        metric_category: 'quality',
        period_type: periodType,
        period_start: periodStart,
        period_end: periodEnd,
        metric_value: m.rate,
        ...(benchmark != null ? { benchmark_value: benchmark } : {}),
        unit: '%',
        status,
        input_response_schema_ids: [OASIS_RESPONSE_SCHEMA_V2_CMS_E2],
        calculation_version: OUTCOME_CALCULATION_VERSION,
        excluded_episode_count: excludedEpisodeCount,
        contributing_factors: [
          `${m.numerator} of ${m.denominator} eligible episodes improved`,
          ...(excludedEpisodeCount
            ? [`${excludedEpisodeCount} episode(s) excluded: response meanings could not be verified`]
            : []),
          m.internal_sample_ready
            ? `Meets the ${INTERNAL_SAMPLE_MIN_PAIRS}-pair internal sample marker (not official CMS eligibility)`
            : `Below the ${INTERNAL_SAMPLE_MIN_PAIRS}-pair internal sample marker (${m.denominator})`,
          ...(benchmark == null
            ? ['No national benchmark configured — performance not rated against a target']
            : []),
        ],
      };
    });
}

// M2420 discharge-disposition code → PatientOutcomeMetric.discharge_disposition enum.
/**
 * Discharge disposition from M2420 — community and hospice only.
 *
 * This used to read `2 → hospital` and `3|4 → snf`, which is the PRE-OASIS-D
 * response list. Under the instrument in effect, M2420 code 2 is "remained in
 * the community (with skilled services from a Medicare Certified HHA)", 3 is
 * "transferred to a non-institutional hospice" and 4 is "moved to a geographic
 * location not served by this agency". M2420 NEVER represents an
 * inpatient-facility transfer — that is M2410, which PennSync does not
 * implement, so no facility disposition can be derived here at all.
 *
 * The code is compared as an opaque STRING; `toNum` would turn "UK" into null
 * and could not distinguish a leading-zero code.
 */
function dispositionFromAnswers(dcAns, patient) {
  const code = dcAns['m2420'];
  if (code === '1') return 'remained_home';
  if (code === '2') return 'remained_community_with_hha';
  if (code === '3') return 'non_institutional_hospice';
  if (code === '4') return 'moved_out_of_service_area';
  // 'UK' (other unknown) and an absent answer both leave the disposition
  // unknown rather than inventing one.
  if (String(patient?.status || '').toLowerCase() === 'deceased') return 'deceased';
  return undefined;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    let body = {};
    try { body = await req.json(); } catch { /* GET / cron invocation */ }
    const agencyId = String(body.agency_id || '').trim();
    if (!agencyId) {
      return Response.json(
        { error: 'agency_id is required; platform-wide outcome computation is not supported' },
        { status: 400 },
      );
    }
    const periodStart = String(body.period_start || '').trim();
    const periodEnd = String(body.period_end || '').trim();
    const isIsoDate = (value) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
      const parsed = new Date(`${value}T00:00:00.000Z`);
      return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
    };
    if (!isIsoDate(periodStart) || !isIsoDate(periodEnd) || periodStart > periodEnd) {
      return Response.json(
        { error: 'valid period_start and period_end (YYYY-MM-DD) are required and start must not exceed end' },
        { status: 400 },
      );
    }
    const periodType = String(body.period_type || '').trim();
    const allowedPeriodTypes = new Set(['daily', 'weekly', 'monthly', 'quarterly', 'yearly', 'custom']);
    if (!allowedPeriodTypes.has(periodType)) {
      return Response.json(
        { error: 'period_type is required and must be daily, weekly, monthly, quarterly, yearly, or custom' },
        { status: 400 },
      );
    }
    // A valid browser session is intentionally insufficient: this function
    // performs service-role writes and tenant membership fields are not yet a
    // protected authorization source. Only a server-held secret may continue.
    const authError = getOutcomeInitialAuthError(req);
    if (authError) return authError;

    // Verify the requested tenant exists without listing or guessing. This is
    // also a fail-closed guard against a scheduler typo creating orphaned KPI
    // rows under an arbitrary tenant key.
    const agencyRows = await base44.asServiceRole.entities.Agency
      .filter({ id: agencyId }, '-created_date', 1);
    const agency = (agencyRows || []).find((row) => String(row?.id || '').trim() === agencyId);
    if (!agency) return Response.json({ error: 'Agency not found' }, { status: 404 });

    // Do not trust a service response merely because the query included a
    // tenant filter. Every row is re-checked before it can participate in a
    // score or become the target of a service-role mutation. Legacy unscoped
    // rows therefore remain untouched until an audited backfill assigns them.
    const belongsToAgency = (row) => String(row?.agency_id || '').trim() === agencyId;
    const fetchAllPages = async (
      entity,
      query,
      sort,
      { maxRows, pageSize = ENTITY_PAGE_SIZE },
    ) => {
      const rows = [];
      const seenIds = new Set();
      let skip = 0;
      while (rows.length < maxRows) {
        const limit = Math.min(pageSize, maxRows - rows.length);
        const page = await entity.filter(query, sort, limit, skip);
        if (!Array.isArray(page)) throw new Error('Base44 entity filter returned a non-array page');
        const rowsBeforePage = rows.length;
        for (const row of page) {
          const id = String(row?.id || '').trim();
          if (id && seenIds.has(id)) continue;
          if (id) seenIds.add(id);
          rows.push(row);
        }
        skip += page.length;
        if (page.length < limit) return { rows, truncated: false };
        // A broken/ignored skip must fail closed instead of spinning or
        // silently scoring the first page repeatedly.
        if (page.length > 0 && rows.length === rowsBeforePage) {
          return { rows, truncated: true };
        }
      }
      const overflow = await entity.filter(query, sort, 1, skip);
      if (!Array.isArray(overflow)) throw new Error('Base44 entity overflow check returned a non-array page');
      return { rows, truncated: overflow.length > 0 };
    };
    const findScopedMetrics = async (patientId, episodeStart, episodeEnd) => {
      const page = await fetchAllPages(base44.asServiceRole.entities.PatientOutcomeMetric, {
        agency_id: agencyId,
        patient_id: patientId,
        episode_start: episodeStart,
        episode_end: episodeEnd,
      }, '-created_date', { maxRows: MAX_MATCHING_DERIVED_ROWS });
      if (page.truncated) throw new Error('PatientOutcomeMetric exact-key query exceeded the safety cap');
      return page.rows.filter((row) =>
        belongsToAgency(row) &&
        row.patient_id === patientId &&
        row.episode_start === episodeStart &&
        row.episode_end === episodeEnd);
    };
    const retireScopedMetrics = async (
      patientId,
      episodeStart,
      episodeEnd,
      outcomeMeasureSource,
      retiredReason,
    ) => {
      const metrics = await findScopedMetrics(patientId, episodeStart, episodeEnd);
      let retired = 0;
      for (const metric of metrics) {
        if (metric.outcome_measure_source === outcomeMeasureSource) continue;
        await base44.asServiceRole.entities.PatientOutcomeMetric.update(metric.id, {
          agency_id: agencyId,
          outcome_measure_source: outcomeMeasureSource,
          retired_reason: retiredReason,
          retired_at: new Date().toISOString(),
          calculation_version: OUTCOME_CALCULATION_VERSION,
        });
        retired += 1;
      }
      return retired;
    };
    const benchmark = typeof body.benchmark === 'number' ? body.benchmark : undefined;

    const inPeriod = (dateStr) => {
      if (!periodStart && !periodEnd) return true;
      if (!dateStr) return false;
      const t = new Date(dateStr).getTime();
      if (Number.isNaN(t)) return false;
      if (periodStart && t < new Date(periodStart).getTime()) return false;
      if (periodEnd && t > new Date(periodEnd).getTime()) return false;
      return true;
    };

    // Discharges for ONE explicit agency; each is paired with the latest
    // same-agency SOC/ROC before it for the same patient. Never list the entity.
    const dischargePage = await fetchAllPages(
      base44.asServiceRole.entities.OASISAssessment,
      { agency_id: agencyId, visit_type: 'Discharge' },
      '-assessment_date',
      { maxRows: MAX_DISCHARGE_ROWS },
    );
    if (dischargePage.truncated) {
      return Response.json({
        success: false,
        error: 'Discharge query exceeded the 50,000-row safety cap; split the requested period before computing a rollup',
        agency_id: agencyId,
        discharge_query_may_be_truncated: true,
      }, { status: 409 });
    }
    const discharges = dischargePage.rows.filter((row) =>
      belongsToAgency(row) && row.visit_type === 'Discharge');

    const outcomes = [];
    let dischargesInPeriod = 0;
    let metricsWritten = 0;
    let skippedNoDate = 0;
    let skippedMissingDischargeDate = 0;
    let skippedInvalidDischargeDate = 0;
    let skippedMissingStartDate = 0;
    let skippedInvalidStartDate = 0;
    let skippedMissingPatientId = 0;
    let skippedMissingStartAssessment = 0;
    let skippedPriorQueryCap = 0;
    let skippedNotScorable = 0;
    let skippedDuplicateEpisodeRows = 0;
    let metricsRetired = 0;
    const skipReasons = [];
    const candidates = [];
    const candidateCounts = new Map();

    for (const dc of discharges) {
      if (!dc.assessment_date) {
        skippedNoDate += 1;
        skippedMissingDischargeDate += 1;
        skipReasons.push({
          assessment_id: dc.id,
          reasons: ['missing_discharge_assessment_date'],
        });
        continue;
      }
      if (!Number.isFinite(Date.parse(String(dc.assessment_date)))) {
        skippedInvalidDischargeDate += 1;
        skipReasons.push({
          assessment_id: dc.id,
          reasons: ['invalid_discharge_assessment_date'],
        });
        continue;
      }
      if (!inPeriod(dc.assessment_date)) continue;
      dischargesInPeriod += 1;
      if (!dc.patient_id) {
        skippedMissingPatientId += 1;
        skipReasons.push({
          assessment_id: dc.id,
          episode_end: dc.assessment_date,
          reasons: ['missing_patient_id'],
        });
        continue;
      }

      // Latest SOC/ROC on or before the discharge date.
      const priorPage = await fetchAllPages(
        base44.asServiceRole.entities.OASISAssessment,
        { agency_id: agencyId, patient_id: dc.patient_id },
        '-assessment_date',
        { maxRows: MAX_PRIOR_ROWS_PER_PATIENT },
      );
      if (priorPage.truncated) {
        return Response.json({
          success: false,
          error: 'Patient assessment history exceeded the 10,000-row safety cap; no derived writes were attempted',
          agency_id: agencyId,
          patient_id: dc.patient_id,
          prior_query_may_be_truncated: true,
        }, { status: 409 });
      }
      const priors = priorPage.rows.filter((row) =>
        belongsToAgency(row) && row.patient_id === dc.patient_id);
      const start = priors.find((a) =>
        (a.visit_type === 'Start of Care' || a.visit_type === 'Resumption of Care') &&
        a.assessment_date &&
        new Date(a.assessment_date) <= new Date(dc.assessment_date));
      if (!start) {
        const hasInvalidStart = priors.some((a) =>
          (a.visit_type === 'Start of Care' || a.visit_type === 'Resumption of Care') &&
          a.assessment_date &&
          !Number.isFinite(Date.parse(String(a.assessment_date))));
        if (hasInvalidStart) {
          skippedInvalidStartDate += 1;
          skipReasons.push({
            patient_id: dc.patient_id,
            episode_end: dc.assessment_date,
            reasons: ['invalid_start_assessment_date'],
          });
          continue;
        }
        const hasUndatedStart = priors.some((a) =>
          (a.visit_type === 'Start of Care' || a.visit_type === 'Resumption of Care') &&
          !a.assessment_date);
        if (hasUndatedStart) {
          skippedNoDate += 1;
          skippedMissingStartDate += 1;
          skipReasons.push({
            patient_id: dc.patient_id,
            episode_end: dc.assessment_date,
            reasons: ['missing_start_assessment_date'],
          });
          continue;
        }
        skippedMissingStartAssessment += 1;
        skipReasons.push({
          patient_id: dc.patient_id,
          episode_end: dc.assessment_date,
          reasons: ['missing_start_assessment'],
        });
        continue;
      }
      const episodeKey = JSON.stringify([
        agencyId, dc.patient_id, start.assessment_date, dc.assessment_date,
      ]);
      candidates.push({ dc, start, episodeKey });
      candidateCounts.set(episodeKey, (candidateCounts.get(episodeKey) || 0) + 1);
    }

    const duplicateKeysHandled = new Set();
    for (const { dc, start, episodeKey } of candidates) {
      if ((candidateCounts.get(episodeKey) || 0) > 1) {
        skippedDuplicateEpisodeRows += 1;
        if (!duplicateKeysHandled.has(episodeKey)) {
          duplicateKeysHandled.add(episodeKey);
          skipReasons.push({
            patient_id: dc.patient_id,
            episode_end: dc.assessment_date,
            reasons: ['duplicate_discharge_assessments'],
          });
          // A duplicate discharge makes the episode ambiguous. Retire only an
          // exactly matching, same-agency metric; never pick one discharge and
          // silently preserve a previously calculated result.
          metricsRetired += await retireScopedMetrics(
            dc.patient_id,
            start.assessment_date,
            dc.assessment_date,
            'retired_ambiguous_duplicate_discharge',
            'duplicate_discharge_assessments',
          );
        }
        continue;
      }

      const dcAns = scorableCodesFromAssessment(dc).codes;
      const patient = await base44.asServiceRole.entities.Patient
        .filter({ agency_id: agencyId, id: dc.patient_id }, '-created_date', 1)
        .then((rows) => (rows || []).find((row) =>
          belongsToAgency(row) && row.id === dc.patient_id));
      if (!patient) {
        skippedNotScorable += 1;
        skipReasons.push({
          patient_id: dc.patient_id,
          episode_end: dc.assessment_date,
          reasons: ['patient_not_found_in_agency_scope'],
        });
        metricsRetired += await retireScopedMetrics(
          dc.patient_id,
          start.assessment_date,
          dc.assessment_date,
          'retired_missing_scoped_patient',
          'patient_not_found_in_agency_scope',
        );
        continue;
      }
      const dischargeDisposition = dispositionFromAnswers(dcAns, patient);

      // WHOLE assessments, not bare item arrays: eligibility depends on the
      // response schema, instrument and dates the array does not carry.
      const outcome = computeEpisodeOutcome({
        start,
        discharge: dc,
        dischargeDisposition,
      });
      outcomes.push(outcome);

      // A pair that is not safely proxy-scorable writes NO metric. Recording an excluded
      // episode as a metric row is how a legacy pair became a quality number.
      if (!outcome.eligible) {
        skippedNotScorable += 1;
        const reasons = outcome.episode_excluded_reasons.length
          ? outcome.episode_excluded_reasons
          : [outcome.episode_excluded_reason].filter(Boolean);
        skipReasons.push({ patient_id: dc.patient_id, episode_end: dc.assessment_date, reasons });

        // Skipping is not enough. An episode that was scored under the old
        // rules already HAS a PatientOutcomeMetric, and consumers query all
        // `oasis_change_score` rows without filtering on the new provenance
        // fields — so a silent skip leaves the stale, unverified quality result
        // visible and counted. Mark it retired instead, which keeps it
        // auditable while taking it out of current internal proxy views.
        metricsRetired += await retireScopedMetrics(
          dc.patient_id,
          start.assessment_date,
          dc.assessment_date,
          'retired_unverified_schema',
          reasons.join(', ') || 'not_proxy_scorable',
        );
        continue;
      }

      const payload = toPatientOutcomeMetric({
        agencyId,
        patientId: dc.patient_id,
        episodeStart: start.assessment_date,
        episodeEnd: dc.assessment_date,
        dischargeDisposition,
        primaryDiagnosis: patient?.primary_diagnosis,
      }, outcome);

      // Idempotent upsert keyed on patient + episode window.
      const existingMetrics = await findScopedMetrics(
        dc.patient_id,
        start.assessment_date,
        dc.assessment_date,
      );
      // Base44 entity updates are partial merges. Never reactivate a retired
      // row by overwriting only outcome_measure_source: its retired_reason /
      // retired_at would remain attached to a seemingly current metric. Reuse
      // only a pristine current row; otherwise create a new current row and
      // leave already-retired audit history untouched.
      const existingMetric = existingMetrics.find((metric) =>
        metric.outcome_measure_source === 'oasis_change_score' &&
        !metric.retired_reason &&
        !metric.retired_at);
      if (existingMetric) {
        await base44.asServiceRole.entities.PatientOutcomeMetric.update(existingMetric.id, payload);
      } else {
        await base44.asServiceRole.entities.PatientOutcomeMetric.create(payload);
      }
      const duplicateMetrics = existingMetrics.filter((metric) =>
        metric.id !== existingMetric?.id &&
        metric.outcome_measure_source === 'oasis_change_score');
      for (const duplicateMetric of duplicateMetrics) {
        await base44.asServiceRole.entities.PatientOutcomeMetric.update(duplicateMetric.id, {
          agency_id: agencyId,
          outcome_measure_source: 'retired_duplicate_metric',
          retired_reason: 'duplicate_patient_episode_metric',
          retired_at: new Date().toISOString(),
          calculation_version: OUTCOME_CALCULATION_VERSION,
        });
        metricsRetired += 1;
      }
      metricsWritten += 1;
    }

    // Stable, explicit windows are mandatory. Deriving a period from whatever
    // discharges happen to be returned would strand prior current KPI rows when
    // a discharge is deleted, reassigned, or falls outside a capped query.
    const targetPeriodStart = periodStart;
    const targetPeriodEnd = periodEnd;
    // Count excluded EPISODES in the requested period exactly once. A missing
    // or invalid discharge date is reported separately because the job cannot
    // prove whether that row belongs inside this stable window. prior-cap is a
    // reason for missing-start and is not added a second time.
    const excludedEpisodeCount =
      skippedMissingPatientId +
      skippedMissingStartAssessment +
      skippedMissingStartDate +
      skippedInvalidStartDate +
      skippedNotScorable +
      duplicateKeysHandled.size;
    const rollup = rollupMeasures(outcomes);
    const kpis = toAgencyKPIs(rollup, {
      periodStart: targetPeriodStart,
      periodEnd: targetPeriodEnd,
      periodType,
      benchmark,
      agencyId,
      excludedEpisodeCount,
    });
    let kpisWritten = 0;
    let kpisRetired = 0;
    for (const kpi of kpis) {
      // Idempotent upsert so a retry / scheduled rerun for the same period does
      // not create duplicate AgencyKPI rows (dashboards would double-count).
      const kpiFilter = {
        agency_id: agencyId,
        metric_name: kpi.metric_name,
        metric_category: kpi.metric_category,
        period_start: kpi.period_start,
        period_end: kpi.period_end,
      };
      const existingKpiPage = await fetchAllPages(
        base44.asServiceRole.entities.AgencyKPI,
        kpiFilter,
        '-created_date',
        { maxRows: MAX_MATCHING_DERIVED_ROWS },
      );
      if (existingKpiPage.truncated) throw new Error('AgencyKPI exact-key query exceeded the safety cap');
      const matchingKpis = existingKpiPage.rows.filter((row) =>
        belongsToAgency(row) &&
        row.metric_name === kpi.metric_name &&
        row.metric_category === kpi.metric_category &&
        row.period_start === kpi.period_start &&
        row.period_end === kpi.period_end);
      // As above, do not merge an active payload into retired audit history.
      // A retired KPI gets a new current successor because optional retirement
      // fields have no source-proved hosted "unset" operation yet.
      const matchingKpi = matchingKpis.find((row) =>
        row.is_current !== false && !row.retired_reason && !row.retired_at);
      if (matchingKpi) {
        await base44.asServiceRole.entities.AgencyKPI.update(matchingKpi.id, kpi);
      } else {
        await base44.asServiceRole.entities.AgencyKPI.create(kpi);
      }
      const duplicateKpis = matchingKpis.filter((row) =>
        row.id !== matchingKpi?.id && row.is_current !== false);
      for (const duplicateKpi of duplicateKpis) {
        await base44.asServiceRole.entities.AgencyKPI.update(duplicateKpi.id, {
          agency_id: agencyId,
          is_current: false,
          retired_reason: 'duplicate_agency_period_kpi',
          retired_at: new Date().toISOString(),
          calculation_version: OUTCOME_CALCULATION_VERSION,
        });
        kpisRetired += 1;
      }
      kpisWritten += 1;
    }

    // A rerun can legitimately yield no denominator (for example after legacy
    // or duplicate episodes are retired). Mark same-agency, same-period KPI
    // rows non-current so an older positive value cannot remain visible. The
    // numeric value is retained for audit history; no row is deleted.
    const emptyMeasures = rollup.measures.filter((measure) => measure.rate === null);
    for (const measure of emptyMeasures) {
      const stalePage = await fetchAllPages(base44.asServiceRole.entities.AgencyKPI, {
        agency_id: agencyId,
        metric_name: measure.label,
        metric_category: 'quality',
        period_start: targetPeriodStart,
        period_end: targetPeriodEnd,
      }, '-created_date', { maxRows: MAX_MATCHING_DERIVED_ROWS });
      if (stalePage.truncated) throw new Error('AgencyKPI stale-row query exceeded the safety cap');
      const scopedStaleRows = stalePage.rows.filter((row) =>
        belongsToAgency(row) &&
        row.metric_name === measure.label &&
        row.metric_category === 'quality' &&
        row.period_start === targetPeriodStart &&
        row.period_end === targetPeriodEnd &&
        row.is_current !== false);
      for (const staleKpi of scopedStaleRows) {
        await base44.asServiceRole.entities.AgencyKPI.update(staleKpi.id, {
          agency_id: agencyId,
          is_current: false,
          retired_reason: 'no_current_eligible_episodes',
          retired_at: new Date().toISOString(),
          calculation_version: OUTCOME_CALCULATION_VERSION,
          excluded_episode_count: excludedEpisodeCount,
        });
        kpisRetired += 1;
      }
    }

    return Response.json({
      success: true,
      agency_id: agencyId,
      discharge_rows_returned: discharges.length,
      discharges_in_period: dischargesInPeriod,
      discharge_query_may_be_truncated: false,
      discharges_evaluated: outcomes.length,
      patient_outcome_metrics_written: metricsWritten,
      skipped_missing_episode_date: skippedNoDate,
      skipped_missing_discharge_date: skippedMissingDischargeDate,
      skipped_invalid_discharge_date: skippedInvalidDischargeDate,
      skipped_missing_start_date: skippedMissingStartDate,
      skipped_invalid_start_date: skippedInvalidStartDate,
      skipped_missing_patient_id: skippedMissingPatientId,
      skipped_missing_start_assessment: skippedMissingStartAssessment,
      skipped_prior_query_cap: skippedPriorQueryCap,
      skipped_duplicate_episode_rows: skippedDuplicateEpisodeRows,
      // Excluded episodes are REPORTED, never silently dropped: a rate that
      // covers fewer episodes than the reader assumes is a false quality claim.
      skipped_not_proxy_scorable: skippedNotScorable,
      patient_outcome_metrics_retired: metricsRetired,
      skip_reasons: skipReasons,
      calculation_version: OUTCOME_CALCULATION_VERSION,
      period_type: periodType,
      excluded_episode_count: excludedEpisodeCount,
      agency_kpis_written: kpisWritten,
      agency_kpis_retired: kpisRetired,
      internal_sample_ready_measure_count: rollup.internal_sample_ready_measure_count,
      internal_sample_ready: rollup.internal_sample_ready,
      measures: rollup.measures,
    });
  } catch (error) {
    console.error('Error computing outcome measures:', error);
    return Response.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
});
