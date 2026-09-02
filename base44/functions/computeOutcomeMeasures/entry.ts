import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// <<<BEGIN SHARED HELPER: schedulerAuth — generated, edit base44/_shared/backendHelpers.mjs>>>
const SCHEDULER_SECRET_HEADER = 'x-internal-secret';
function isSchedulerAdmin(user) {
  return !!user && (
    user.role === 'admin' || user.account_type === 'agency_admin' ||
    user.account_type === 'super_admin'
  );
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

// computeOutcomeMeasures — the keystone quality cron.
//
// Pairs every Discharge OASIS with its matching SOC/ROC assessment, computes the
// CMS home-health OUTCOME (change) measures, writes a PatientOutcomeMetric per
// episode, and rolls the results up into AgencyKPI rows (one per measure). These
// rows feed ~5 of the 7 Quality-of-Patient-Care star inputs and ~40% of HHVBP.
//
// The scoring below is a verbatim mirror of the unit-tested pure engine in
// src/components/oasis/outcomeMeasureEngine.js. The edge function runs on Deno
// and cannot import from src/, so the deterministic core is inlined here. Keep
// the two in step: any change to a measure/exclusion rule must be made in both.

// <<<BEGIN SHARED HELPER: isAdminLike — generated, edit base44/_shared/backendHelpers.mjs>>>
const isAdminLike = (u) => !!u && (
  u.role === 'admin' || u.account_type === 'agency_admin' ||
  u.account_type === 'super_admin'
);
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
const OUTCOME_CALCULATION_VERSION = '2026-09-01.v2-cms-e2';
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
const STAR_MIN_EPISODES = 20;
const STAR_MIN_MEASURES = 5;
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
  for (const it of items) {
    if (!it || it.item_number == null) { excluded.push({ item: 'unknown', reason: 'missing_item_number' }); continue; }
    const key = String(it.item_number).toLowerCase().replace(/[^a-z0-9]/g, '');
    if (it.response_schema_id !== OASIS_RESPONSE_SCHEMA_V2_CMS_E2) {
      excluded.push({ item: it.item_number, reason: it.response_schema_id ? 'legacy_response_schema' : 'missing_response_schema' });
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
  const items = Array.isArray(assessment?.oasis_items) ? assessment.oasis_items : [];
  for (const it of items) {
    if (!it || it.item_number == null) continue;
    const key = String(it.item_number).toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!GG_FUNCTION_ITEMS.includes(key)) continue;
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
function computeGGDischargeFunctionScore(dcAns) {
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
  return Number.isFinite(t) && t >= Date.parse('2026-04-01');
}

function computeEpisodeOutcome({ start, discharge, dischargeDisposition }) {
  const startX = scorableCodesFromAssessment(start);
  const dcX = scorableCodesFromAssessment(discharge);
  const startAns = startX.codes;
  const dcAns = dcX.codes;

  // Episode-level fail-closed gates. A CMS-labeled rate may only be computed
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
    gg_discharge_function: episodeExclusions.length
      ? { applicable: false, score: null, items_scored: 0 }
      : computeGGDischargeFunctionScore(ggAnswersFrom(discharge)),
  };
}
function toPatientOutcomeMetric(meta, outcome) {
  const byKey = Object.fromEntries(outcome.measures.map((m) => [m.key, m]));
  const flag = (key) => byKey[key]?.status === 'improved';
  return {
    patient_id: meta.patientId,
    ...(meta.episodeStart ? { episode_start: meta.episodeStart } : {}),
    ...(meta.episodeEnd ? { episode_end: meta.episodeEnd } : {}),
    ...(meta.dischargeDisposition ? { discharge_disposition: meta.dischargeDisposition } : {}),
    ...(meta.primaryDiagnosis ? { primary_diagnosis: meta.primaryDiagnosis } : {}),
    functional_improvement: {
      ambulation_improved: flag('ambulation'),
      bathing_improved: flag('bathing'),
      transferring_improved: flag('bed_transfer'),
      medication_management_improved: flag('oral_meds'),
      dyspnea_improved: flag('dyspnea'),
      // null (every measure excluded) means "not measurable" — recording 0
      // would fabricate a measured 0% improvement, so omit the field instead.
      ...(outcome.overall_improvement_score != null
        ? { overall_improvement_score: outcome.overall_improvement_score }
        : {}),
    },
    ...(outcome.gg_discharge_function.score != null ? { gg_discharge_function_score: outcome.gg_discharge_function.score } : {}),
    measure_results: outcome.measures.map((m) => ({ measure: m.key, status: m.status, start_value: m.start_value, discharge_value: m.discharge_value, reason: m.reason })),
    outcome_measure_source: 'oasis_change_score',
    // Provenance travels with the derived record so a reviewer can tell which
    // response meanings produced it, and so records without verified v2 inputs
    // can be retired from CMS-labeled views instead of silently re-read.
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
    return { key: m.key, label: m.label, item: m.item, numerator, denominator, rate, star_eligible: denominator >= STAR_MIN_EPISODES };
  });
  const starEligibleCount = measures.filter((m) => m.star_eligible).length;
  return { measures, total_episodes: outcomes.length, star_eligible_measure_count: starEligibleCount, star_eligible: starEligibleCount >= STAR_MIN_MEASURES };
}
function toAgencyKPIs(rollup, opts) {
  const { periodStart, periodEnd, periodType = 'quarterly', agencyId, benchmark, excludedEpisodeCount = 0 } = opts;
  return (rollup?.measures || [])
    .filter((m) => m.rate !== null)
    .map((m) => {
      // Without a configured benchmark there is no performance signal —
      // "on_target" earned by episode volume alone is a false quality claim.
      const status = benchmark == null
        ? 'warning'
        : (m.rate >= benchmark ? 'on_target' : m.rate >= benchmark - 10 ? 'warning' : 'critical');
      return {
        ...(agencyId ? { agency_id: agencyId } : {}),
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
          m.star_eligible
            ? `Meets the ${STAR_MIN_EPISODES}-episode star-rating threshold`
            : `Below the ${STAR_MIN_EPISODES}-episode star-rating threshold (${m.denominator})`,
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

    // Auth gate (mirrors monitorComplianceRisks): reads every patient's OASIS
    // PHI and writes quality metrics. Admins can run it with session auth; scheduled/internal callers must send `x-internal-secret`; every other caller is rejected.
    const me = await base44.auth.me().catch(() => null);
    const authError = getSchedulerAuthError(req, me);
    if (authError) return authError;
    if (isDeactivatedUser(me)) return DEACTIVATED_USER_RESPONSE();

    let body = {};
    try { body = await req.json(); } catch { /* GET / cron invocation */ }
    const periodStart = body.period_start || null;
    const periodEnd = body.period_end || null;
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

    // All Discharge OASIS assessments; each is paired with the latest SOC/ROC
    // before it for the same patient.
    const discharges = await base44.asServiceRole.entities.OASISAssessment.filter(
      { visit_type: 'Discharge' }, '-assessment_date', 5000,
    );

    const outcomes = [];
    const episodeEndDates = [];
    let metricsWritten = 0;
    let skippedNoDate = 0;
    let skippedNotScorable = 0;
    let metricsRetired = 0;
    const skipReasons = [];

    for (const dc of discharges) {
      if (!inPeriod(dc.assessment_date)) continue;
      if (!dc.patient_id) continue;

      // Latest SOC/ROC on or before the discharge date.
      const priors = await base44.asServiceRole.entities.OASISAssessment.filter(
        { patient_id: dc.patient_id }, '-assessment_date', 50,
      );
      const start = priors.find((a) =>
        (a.visit_type === 'Start of Care' || a.visit_type === 'Resumption of Care') &&
        (!dc.assessment_date || !a.assessment_date || new Date(a.assessment_date) <= new Date(dc.assessment_date)));
      if (!start) continue; // no SOC/ROC to pair → cannot compute a change score
      // PatientOutcomeMetric requires episode_start (and we key the upsert on
      // both episode dates): skip pairs missing either assessment_date rather
      // than let a required-field create() throw and abort the whole cron.
      if (!start.assessment_date || !dc.assessment_date) { skippedNoDate += 1; continue; }
      episodeEndDates.push(dc.assessment_date);

      const dcAns = scorableCodesFromAssessment(dc).codes;
      const patient = await base44.asServiceRole.entities.Patient.filter({ id: dc.patient_id }, '-created_date', 1)
        .then((rows) => rows[0]).catch(() => null);
      const dischargeDisposition = dispositionFromAnswers(dcAns, patient);

      // WHOLE assessments, not bare item arrays: eligibility depends on the
      // response schema, instrument and dates the array does not carry.
      const outcome = computeEpisodeOutcome({
        start,
        discharge: dc,
        dischargeDisposition,
      });
      outcomes.push(outcome);

      // A pair that is not CMS-scorable writes NO metric. Recording an excluded
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
        // auditable while taking it out of current CMS-labeled views.
        const stale = await base44.asServiceRole.entities.PatientOutcomeMetric.filter({
          patient_id: dc.patient_id,
          episode_start: start.assessment_date,
          episode_end: dc.assessment_date,
        }, '-created_date', 1).catch(() => []);
        if (stale && stale[0] && stale[0].outcome_measure_source !== 'retired_unverified_schema') {
          await base44.asServiceRole.entities.PatientOutcomeMetric.update(stale[0].id, {
            outcome_measure_source: 'retired_unverified_schema',
            retired_reason: reasons.join(', ') || 'not_cms_scorable',
            retired_at: new Date().toISOString(),
            calculation_version: OUTCOME_CALCULATION_VERSION,
          }).catch(() => {});
          metricsRetired += 1;
        }
        continue;
      }

      const payload = toPatientOutcomeMetric({
        patientId: dc.patient_id,
        episodeStart: start.assessment_date,
        episodeEnd: dc.assessment_date,
        dischargeDisposition,
        primaryDiagnosis: patient?.primary_diagnosis,
      }, outcome);

      // Idempotent upsert keyed on patient + episode window.
      const existing = await base44.asServiceRole.entities.PatientOutcomeMetric.filter({
        patient_id: dc.patient_id,
        episode_start: start.assessment_date,
        episode_end: dc.assessment_date,
      }, '-created_date', 1).catch(() => []);
      if (existing && existing[0]) {
        await base44.asServiceRole.entities.PatientOutcomeMetric.update(existing[0].id, payload);
      } else {
        await base44.asServiceRole.entities.PatientOutcomeMetric.create(payload);
      }
      metricsWritten += 1;
    }

    // Roll up to agency KPIs (one row per measure). Default the period to the
    // ACTUAL span of the evaluated discharges (ISO dates sort lexically), not
    // discharges[0] (the newest) → today, which would label all-time rates as a
    // single latest-date-to-today period and corrupt the KPI time series.
    const today = new Date().toISOString().slice(0, 10);
    const defaultStart = episodeEndDates.length ? episodeEndDates.reduce((a, b) => (a < b ? a : b)) : today;
    const defaultEnd = episodeEndDates.length ? episodeEndDates.reduce((a, b) => (a > b ? a : b)) : today;
    const rollup = rollupMeasures(outcomes);
    const kpis = toAgencyKPIs(rollup, {
      periodStart: periodStart || defaultStart,
      periodEnd: periodEnd || defaultEnd,
      benchmark,
      excludedEpisodeCount: skippedNotScorable,
    });
    let kpisWritten = 0;
    for (const kpi of kpis) {
      // Idempotent upsert so a retry / scheduled rerun for the same period does
      // not create duplicate AgencyKPI rows (dashboards would double-count).
      const kpiFilter = {
        metric_name: kpi.metric_name,
        metric_category: kpi.metric_category,
        period_start: kpi.period_start,
        period_end: kpi.period_end,
      };
      if (kpi.agency_id) kpiFilter.agency_id = kpi.agency_id;
      const existingKpi = await base44.asServiceRole.entities.AgencyKPI.filter(kpiFilter, '-created_date', 1).catch(() => []);
      if (existingKpi && existingKpi[0]) {
        await base44.asServiceRole.entities.AgencyKPI.update(existingKpi[0].id, kpi);
      } else {
        await base44.asServiceRole.entities.AgencyKPI.create(kpi);
      }
      kpisWritten += 1;
    }

    return Response.json({
      success: true,
      discharges_evaluated: outcomes.length,
      patient_outcome_metrics_written: metricsWritten,
      skipped_missing_episode_date: skippedNoDate,
      // Excluded episodes are REPORTED, never silently dropped: a rate that
      // covers fewer episodes than the reader assumes is a false quality claim.
      skipped_not_cms_scorable: skippedNotScorable,
      metrics_retired_unverified: metricsRetired,
      skip_reasons: skipReasons,
      calculation_version: OUTCOME_CALCULATION_VERSION,
      agency_kpis_written: kpisWritten,
      star_eligible_measure_count: rollup.star_eligible_measure_count,
      star_eligible: rollup.star_eligible,
      measures: rollup.measures,
    });
  } catch (error) {
    console.error('Error computing outcome measures:', error);
    return Response.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
});
