import { createClientFromRequest } from 'npm:@base44/sdk@0.8.46';

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
// episode, and rolls the results up into AgencyKPI rows. Each attempt is
// append-only and a single OutcomeComputationRun status transition gates the
// complete generation. These values are not official CMS rates, eligibility
// determinations, star inputs, or HHVBP results.
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
const MAX_UNEXPECTED_STAGED_ROWS = 5_000;
const MAX_MATCHING_RUN_ROWS = 100;
const OUTCOME_RUN_PUBLICATION_MODE = 'single_run_record_gate_v1';
const IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{15,127}$/;
const OUTCOME_RUN_SNAPSHOT_FIELDS = Object.freeze([
  'id',
  'agency_id',
  'run_key',
  'window_key',
  'attempt_id',
  'status',
  'transition_version',
  'publication_mode',
  'period_type',
  'period_start',
  'period_end',
  'calculation_version',
  'benchmark_value',
  'started_at',
  'published_at',
  'failed_at',
  'failure_stage',
  'patient_outcome_metric_count',
  'agency_kpi_count',
  'generation_fingerprint',
  'result_summary',
  'result_summary_hash',
]);
const OUTCOME_RUN_TERMINAL_FIELDS = Object.freeze([
  'published_at',
  'failed_at',
  'failure_stage',
  'patient_outcome_metric_count',
  'agency_kpi_count',
  'generation_fingerprint',
  'result_summary',
  'result_summary_hash',
]);
const OUTCOME_RUN_TRANSITION_FIELDS = Object.freeze({
  failed: Object.freeze(['failed_at', 'failure_stage', 'status']),
  superseded: Object.freeze(['failure_stage', 'status']),
  published: Object.freeze([
    'agency_kpi_count',
    'generation_fingerprint',
    'patient_outcome_metric_count',
    'published_at',
    'result_summary',
    'result_summary_hash',
    'status',
  ]),
});
const GG_FUNCTION_ITEMS = [
  'gg0130a', 'gg0130b', 'gg0130c', 'gg0130e', 'gg0130f', 'gg0130g', 'gg0130h',
  'gg0170a', 'gg0170b', 'gg0170c', 'gg0170d', 'gg0170e', 'gg0170f',
  'gg0170i', 'gg0170j', 'gg0170k', 'gg0170l', 'gg0170m',
];
const GG_NOT_ATTEMPTED = new Set([7, 9, 10, 88]);
const DECEASED_DISPOSITIONS = new Set(['deceased', 'died', 'death', 'expired']);

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(String(value)),
  );
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

// <<<BEGIN OUTCOME ROW CONTENT HASH V1>>>
const PATIENT_OUTCOME_METRIC_CONTENT_FIELDS = Object.freeze([
  'agency_id',
  'outcome_computation_run_id',
  'outcome_computation_attempt_id',
  'generation_fingerprint',
  'optional_fields_present',
  'patient_id',
  'episode_start',
  'episode_end',
  'discharge_disposition',
  'primary_diagnosis',
  'functional_improvement',
  'internal_gg_18_item_raw_sum',
  'measure_results',
  'outcome_measure_source',
  'input_response_schema_ids',
  'source_assessment_ids',
  'instrument_versions',
  'calculation_version',
]);
const AGENCY_KPI_CONTENT_FIELDS = Object.freeze([
  'agency_id',
  'outcome_computation_run_id',
  'outcome_computation_attempt_id',
  'generation_fingerprint',
  'is_current',
  'metric_name',
  'metric_category',
  'period_type',
  'period_start',
  'period_end',
  'metric_value',
  'benchmark_value',
  'unit',
  'status',
  'input_response_schema_ids',
  'calculation_version',
  'excluded_episode_count',
  'contributing_factors',
]);

function canonicalOutcomeJsonValue(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Outcome row content contains a non-finite number');
    return value;
  }
  if (Array.isArray(value)) return value.map((item) => canonicalOutcomeJsonValue(item));
  if (value && typeof value === 'object') {
    const result = {};
    for (const key of Object.keys(value).sort()) {
      if (value[key] !== undefined) result[key] = canonicalOutcomeJsonValue(value[key]);
    }
    return result;
  }
  throw new Error('Outcome row content contains an unsupported value');
}

function canonicalOutcomeRowPayload(row, fields) {
  const payload = {};
  for (const field of fields) {
    if (Object.hasOwn(row, field) && row[field] !== undefined) payload[field] = row[field];
  }
  return canonicalOutcomeJsonValue(payload);
}

async function outcomeRowContentHash(row, fields) {
  return sha256Hex(JSON.stringify(canonicalOutcomeRowPayload(row, fields)));
}
// <<<END OUTCOME ROW CONTENT HASH V1>>>

function outcomeRunSnapshot(row) {
  return Object.fromEntries(OUTCOME_RUN_SNAPSHOT_FIELDS.map((field) => [field, row?.[field]]));
}

function sameOutcomeRunValue(left, right) {
  if (left === undefined || right === undefined) return left === right;
  return JSON.stringify(canonicalOutcomeJsonValue(left)) ===
    JSON.stringify(canonicalOutcomeJsonValue(right));
}

async function resultSummaryHash(summary) {
  return sha256Hex(JSON.stringify(canonicalOutcomeJsonValue(summary)));
}

function requireCleanBuildingOutcomeRun(preimage) {
  if (preimage.status !== 'building' || preimage.transition_version !== 1) {
    throw new Error('OutcomeComputationRun transition requires an exact building@v1 preimage');
  }
  if (OUTCOME_RUN_TERMINAL_FIELDS.some((field) => preimage[field] !== undefined)) {
    throw new Error('OutcomeComputationRun building preimage contains terminal metadata');
  }
}

function requireExactOutcomeRunTransition(setFields) {
  const status = setFields?.status;
  const allowedFields = OUTCOME_RUN_TRANSITION_FIELDS[status];
  if (!allowedFields || !setFields || typeof setFields !== 'object' || Array.isArray(setFields)) {
    throw new Error('OutcomeComputationRun transition target is invalid');
  }
  const actualFields = Object.keys(setFields).sort();
  if (JSON.stringify(actualFields) !== JSON.stringify(allowedFields)) {
    throw new Error('OutcomeComputationRun transition fields are incomplete or unexpected');
  }
  if (status === 'published') {
    if (!Number.isFinite(Date.parse(String(setFields.published_at || ''))) ||
        !Number.isSafeInteger(setFields.patient_outcome_metric_count) ||
        setFields.patient_outcome_metric_count < 0 ||
        !Number.isSafeInteger(setFields.agency_kpi_count) || setFields.agency_kpi_count < 0 ||
        !/^[a-f0-9]{64}$/.test(String(setFields.generation_fingerprint || '')) ||
        !setFields.result_summary || typeof setFields.result_summary !== 'object' ||
        Array.isArray(setFields.result_summary) ||
        !/^[a-f0-9]{64}$/.test(String(setFields.result_summary_hash || ''))) {
      throw new Error('OutcomeComputationRun published transition metadata is invalid');
    }
    if (setFields.result_summary.patient_outcome_metrics_written !==
          setFields.patient_outcome_metric_count ||
        setFields.result_summary.agency_kpis_written !== setFields.agency_kpi_count) {
      throw new Error('OutcomeComputationRun published summary counts do not reconcile');
    }
  } else if (typeof setFields.failure_stage !== 'string' || !setFields.failure_stage.trim()) {
    throw new Error('OutcomeComputationRun unpublished terminal metadata is invalid');
  } else if (status === 'failed' &&
      !Number.isFinite(Date.parse(String(setFields.failed_at || '')))) {
    throw new Error('OutcomeComputationRun failed transition timestamp is invalid');
  }
}

function requireExactCreatedBuildingRun(created, expected) {
  const actual = outcomeRunSnapshot(created);
  const intended = outcomeRunSnapshot(expected);
  requireCleanBuildingOutcomeRun(actual);
  if (Object.entries(intended).some(([field, value]) =>
    !sameOutcomeRunValue(actual[field], value))) {
    throw new Error('OutcomeComputationRun create response changed its immutable preimage');
  }
  return actual;
}

async function applyConditionalOutcomeRunTransition(entity, before, setFields) {
  const preimage = outcomeRunSnapshot(before);
  if (!preimage.id || !preimage.agency_id) {
    throw new Error('OutcomeComputationRun transition requires an exact scoped preimage');
  }
  requireCleanBuildingOutcomeRun(preimage);
  requireExactOutcomeRunTransition(setFields);
  if (setFields.status === 'published' &&
      setFields.result_summary_hash !== await resultSummaryHash(setFields.result_summary)) {
    throw new Error('OutcomeComputationRun published summary hash is invalid');
  }
  const query = Object.fromEntries(
    Object.entries(preimage).map(([field, value]) => [
      field,
      value === undefined ? { $exists: false } : value,
    ]),
  );
  const outcome = await entity.updateMany(query, {
    $set: setFields,
    $inc: { transition_version: 1 },
  });
  if (!outcome || outcome.success !== true || outcome.updated !== 1 || outcome.has_more !== false) {
    throw new Error('OutcomeComputationRun changed before its conditional transition');
  }

  const readback = await entity.filter(
    { agency_id: preimage.agency_id, id: preimage.id },
    '-created_date',
    2,
  );
  if (!Array.isArray(readback)) {
    throw new Error('OutcomeComputationRun transition readback returned a non-array result');
  }
  const exactRows = readback.filter((row) =>
    row?.id === preimage.id && row?.agency_id === preimage.agency_id);
  if (exactRows.length !== 1) {
    throw new Error('OutcomeComputationRun transition readback was missing or ambiguous');
  }
  const expected = {
    ...preimage,
    ...setFields,
    transition_version: preimage.transition_version + 1,
  };
  const after = exactRows[0];
  if (Object.entries(expected).some(([field, value]) =>
    !sameOutcomeRunValue(after?.[field], value))) {
    throw new Error('OutcomeComputationRun conditional transition could not be reconciled');
  }
  return after;
}

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
  let activeRunClient = null;
  let activeRunId = null;
  let activeRunSnapshot = null;
  let failureStage = 'request_validation';
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
    const benchmarkProvided = body.benchmark !== undefined && body.benchmark !== null;
    if (benchmarkProvided && (
      typeof body.benchmark !== 'number' ||
      !Number.isFinite(body.benchmark) ||
      body.benchmark < 0 ||
      body.benchmark > 100
    )) {
      return Response.json(
        { error: 'benchmark must be a finite percentage from 0 through 100 when provided' },
        { status: 400 },
      );
    }
    const benchmark = benchmarkProvided ? body.benchmark : undefined;
    const idempotencyKey = String(body.idempotency_key || '').trim();
    if (!IDEMPOTENCY_KEY_RE.test(idempotencyKey)) {
      return Response.json(
        {
          error: 'idempotency_key is required and must be 16-128 characters using letters, numbers, dot, underscore, colon, or hyphen',
        },
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
    // The raw idempotency key is caller-controlled and never stored. Its hash
    // is scoped to one tenant/window/version, so a retry can safely replay only
    // the exact logical computation it named.
    const windowKey = await sha256Hex(JSON.stringify([
      agencyId,
      periodType,
      periodStart,
      periodEnd,
    ]));
    const runKey = await sha256Hex(JSON.stringify([
      agencyId,
      periodType,
      periodStart,
      periodEnd,
      OUTCOME_CALCULATION_VERSION,
      benchmark ?? null,
      idempotencyKey,
    ]));
    failureStage = 'run_claim';
    const existingRunPage = await fetchAllPages(
      base44.asServiceRole.entities.OutcomeComputationRun,
      { agency_id: agencyId, run_key: runKey },
      '-created_date',
      { maxRows: MAX_MATCHING_RUN_ROWS },
    );
    if (existingRunPage.truncated) {
      throw new Error('OutcomeComputationRun idempotency query exceeded the safety cap');
    }
    const matchingRuns = existingRunPage.rows.filter((row) =>
      belongsToAgency(row) &&
      row.run_key === runKey &&
      row.period_type === periodType &&
      row.period_start === periodStart &&
      row.period_end === periodEnd &&
      row.calculation_version === OUTCOME_CALCULATION_VERSION);
    const publishedRunValidationError = async (row) => {
      const summary = row?.result_summary;
      if (row?.status !== 'published' ||
          row?.transition_version !== 2 ||
          row?.failed_at !== undefined || row?.failure_stage !== undefined ||
          row?.agency_id !== agencyId ||
          row?.run_key !== runKey ||
          row?.publication_mode !== OUTCOME_RUN_PUBLICATION_MODE ||
          typeof row?.attempt_id !== 'string' || !row.attempt_id.trim() ||
          row?.window_key !== windowKey ||
          !/^[a-f0-9]{64}$/.test(String(row?.generation_fingerprint || '')) ||
          !Number.isFinite(Date.parse(String(row?.published_at || ''))) ||
          !Number.isInteger(row?.patient_outcome_metric_count) || row.patient_outcome_metric_count < 0 ||
          !Number.isInteger(row?.agency_kpi_count) || row.agency_kpi_count < 0 ||
          !/^[a-f0-9]{64}$/.test(String(row?.result_summary_hash || '')) ||
          !summary || typeof summary !== 'object' || Array.isArray(summary) || summary.success !== true ||
          summary.agency_id !== agencyId ||
          summary.period_type !== periodType ||
          summary.period_start !== periodStart ||
          summary.period_end !== periodEnd ||
          summary.calculation_version !== OUTCOME_CALCULATION_VERSION ||
          summary.generation_fingerprint !== row.generation_fingerprint ||
          summary.patient_outcome_metrics_written !== row.patient_outcome_metric_count ||
          summary.agency_kpis_written !== row.agency_kpi_count) {
        return 'published run metadata is incomplete or inconsistent';
      }
      let recomputedSummaryHash;
      try {
        recomputedSummaryHash = await resultSummaryHash(summary);
      } catch {
        return 'published run summary is not canonically hashable';
      }
      if (row.result_summary_hash !== recomputedSummaryHash) {
        return 'published run summary hash does not match its content';
      }
      const cohorts = [
        {
          entity: base44.asServiceRole.entities.PatientOutcomeMetric,
          count: row.patient_outcome_metric_count,
          label: 'PatientOutcomeMetric',
          contentFields: PATIENT_OUTCOME_METRIC_CONTENT_FIELDS,
          keyOf: (item) => JSON.stringify([
            item.agency_id, item.patient_id, item.episode_start, item.episode_end,
          ]),
        },
        {
          entity: base44.asServiceRole.entities.AgencyKPI,
          count: row.agency_kpi_count,
          label: 'AgencyKPI',
          contentFields: AGENCY_KPI_CONTENT_FIELDS,
          keyOf: (item) => JSON.stringify([
            item.agency_id,
            item.metric_name,
            item.metric_category,
            item.period_start,
            item.period_end,
          ]),
        },
      ];
      for (const cohort of cohorts) {
        const page = await fetchAllPages(cohort.entity, {
          agency_id: agencyId,
          outcome_computation_run_id: row.id,
          outcome_computation_attempt_id: row.attempt_id,
        }, '-created_date', {
          maxRows: Math.max(cohort.count + MAX_UNEXPECTED_STAGED_ROWS, 1),
        });
        if (page.truncated) return `${cohort.label} published cohort exceeded its recorded count`;
        const scopedRows = page.rows.filter((item) =>
          belongsToAgency(item) &&
          item.outcome_computation_run_id === row.id &&
          item.outcome_computation_attempt_id === row.attempt_id);
        if (scopedRows.some((item) =>
          item.generation_fingerprint !== row.generation_fingerprint)) {
          return `${cohort.label} published cohort contains a mismatched fingerprint`;
        }
        for (const item of scopedRows) {
          if (!/^[a-f0-9]{64}$/.test(String(item.row_content_hash || ''))) {
            return `${cohort.label} published cohort contains a missing or invalid row content hash`;
          }
          let recomputedHash;
          try {
            recomputedHash = await outcomeRowContentHash(item, cohort.contentFields);
          } catch {
            return `${cohort.label} published cohort contains unhashable row content`;
          }
          if (item.row_content_hash !== recomputedHash) {
            return `${cohort.label} published cohort contains mutated row content`;
          }
        }
        const keys = scopedRows.map(cohort.keyOf);
        if (scopedRows.length !== cohort.count || new Set(keys).size !== keys.length) {
          return `${cohort.label} published cohort failed reconciliation`;
        }
      }
      return null;
    };
    const windowRunPage = await fetchAllPages(
      base44.asServiceRole.entities.OutcomeComputationRun,
      { agency_id: agencyId, window_key: windowKey },
      '-created_date',
      { maxRows: MAX_MATCHING_RUN_ROWS },
    );
    if (windowRunPage.truncated) {
      throw new Error('OutcomeComputationRun window query exceeded the safety cap');
    }
    const liveWindowRuns = windowRunPage.rows.filter((row) =>
      belongsToAgency(row) &&
      row.window_key === windowKey &&
      (row.status === 'published' || row.status === 'building'));

    const publishedRuns = matchingRuns.filter((row) => row.status === 'published');
    if (publishedRuns.length > 1) {
      return Response.json({
        success: false,
        error: 'Multiple published runs exist for this idempotency key; operator review is required',
      }, { status: 409 });
    }
    const publishedRun = publishedRuns[0];
    if (publishedRun) {
      const publishedWindowRuns = liveWindowRuns.filter((row) => row.status === 'published');
      if (publishedWindowRuns.length !== 1 || publishedWindowRuns[0].id !== publishedRun.id) {
        return Response.json({
          success: false,
          error: 'Multiple or conflicting published runs exist for this reporting window',
          requires_operator_review: true,
        }, { status: 409 });
      }
      const validationError = await publishedRunValidationError(publishedRun);
      if (validationError) {
        return Response.json({
          success: false,
          error: `Published outcome run is not replayable: ${validationError}`,
          requires_operator_review: true,
        }, { status: 409 });
      }
      const savedSummary = publishedRun.result_summary && typeof publishedRun.result_summary === 'object'
        ? publishedRun.result_summary
        : {};
      return Response.json({
        ...savedSummary,
        success: true,
        idempotent_replay: true,
        outcome_computation_run_id: publishedRun.id,
        outcome_computation_attempt_id: publishedRun.attempt_id,
        publication_status: 'published',
        publication_mode: OUTCOME_RUN_PUBLICATION_MODE,
      });
    }
    if (matchingRuns.some((row) => row.status === 'building')) {
      return Response.json({
        success: false,
        error: 'An unpublished attempt already holds this idempotency key',
        retry_with_same_key_after_operator_review: true,
      }, { status: 409 });
    }

    if (liveWindowRuns.length > 0) {
      return Response.json({
        success: false,
        error: 'This reporting window already has a live publication; atomic supersession is not available',
        requires_operator_review: true,
      }, { status: 409 });
    }

    const attemptId = crypto.randomUUID();
    const startedAt = new Date().toISOString();
    const runCreatePayload = {
      agency_id: agencyId,
      run_key: runKey,
      window_key: windowKey,
      attempt_id: attemptId,
      status: 'building',
      transition_version: 1,
      publication_mode: OUTCOME_RUN_PUBLICATION_MODE,
      period_type: periodType,
      period_start: periodStart,
      period_end: periodEnd,
      calculation_version: OUTCOME_CALCULATION_VERSION,
      ...(benchmark != null ? { benchmark_value: benchmark } : {}),
      started_at: startedAt,
    };
    const createdRun = await base44.asServiceRole.entities.OutcomeComputationRun.create(runCreatePayload);
    const runId = String(createdRun?.id || '').trim();
    if (!runId) throw new Error('OutcomeComputationRun create did not return an id');
    activeRunSnapshot = requireExactCreatedBuildingRun(createdRun, {
      id: runId,
      ...runCreatePayload,
    });
    activeRunClient = base44;
    activeRunId = runId;

    // Best-effort duplicate-claim election. Base44 does not expose a datastore
    // uniqueness constraint or atomic create-if-absent/cross-record claim. The
    // full-preimage updateMany transition below protects this existing row only,
    // so the strict production gate remains blocked. This check still catches
    // overlapping claims visible after creation and lets only the lexically
    // first run id continue.
    const contenderPage = await fetchAllPages(
      base44.asServiceRole.entities.OutcomeComputationRun,
      { agency_id: agencyId, run_key: runKey },
      '-created_date',
      { maxRows: MAX_MATCHING_RUN_ROWS },
    );
    if (contenderPage.truncated) {
      throw new Error('OutcomeComputationRun contender query exceeded the safety cap');
    }
    const buildingContenders = contenderPage.rows
      .filter((row) => belongsToAgency(row) && row.run_key === runKey && row.status === 'building')
      .sort((a, b) => String(a.id).localeCompare(String(b.id)));
    if (buildingContenders[0] && buildingContenders[0].id !== runId) {
      await applyConditionalOutcomeRunTransition(
        base44.asServiceRole.entities.OutcomeComputationRun,
        activeRunSnapshot,
        {
          status: 'superseded',
          failure_stage: 'duplicate_run_claim',
        },
      );
      activeRunId = null;
      activeRunSnapshot = null;
      return Response.json({
        success: false,
        error: 'A concurrent attempt won this idempotency-key claim',
        retry_with_same_key: true,
      }, { status: 409 });
    }
    failureStage = 'source_read';
    const periodStartMs = Date.parse(`${periodStart}T00:00:00.000Z`);
    const periodEndExclusiveMs = Date.parse(`${periodEnd}T00:00:00.000Z`) + 86_400_000;
    const inPeriod = (dateStr) => {
      if (!dateStr) return false;
      const t = new Date(dateStr).getTime();
      if (Number.isNaN(t)) return false;
      return t >= periodStartMs && t < periodEndExclusiveMs;
    };

    // Discharges for ONE explicit agency; each is paired with the latest
    // same-agency SOC/ROC before it for the same patient. The stable date range
    // must be part of the provider query: fetching 50,000 lifetime rows and
    // filtering locally would make the documented "split the period" recovery
    // ineffective for a large tenant.
    const dischargeQuery = {
      agency_id: agencyId,
      visit_type: 'Discharge',
      assessment_date: {
        $gte: periodStart,
        $lte: `${periodEnd}T23:59:59.999`,
      },
    };
    const dischargePage = await fetchAllPages(
      base44.asServiceRole.entities.OASISAssessment,
      dischargeQuery,
      '-assessment_date',
      { maxRows: MAX_DISCHARGE_ROWS },
    );
    if (dischargePage.truncated) {
      await applyConditionalOutcomeRunTransition(
        base44.asServiceRole.entities.OutcomeComputationRun,
        activeRunSnapshot,
        {
          status: 'failed',
          failed_at: new Date().toISOString(),
          failure_stage: 'source_discharge_cap',
        },
      );
      activeRunId = null;
      activeRunSnapshot = null;
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
    let skippedAmbiguousStartAssessment = 0;
    let skippedPriorQueryCap = 0;
    let skippedNotScorable = 0;
    let skippedDuplicateEpisodeRows = 0;
    const metricPayloads = [];
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
        await applyConditionalOutcomeRunTransition(
          base44.asServiceRole.entities.OutcomeComputationRun,
          activeRunSnapshot,
          {
            status: 'failed',
            failed_at: new Date().toISOString(),
            failure_stage: 'source_patient_history_cap',
          },
        );
        activeRunId = null;
        activeRunSnapshot = null;
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
      const dischargeTime = Date.parse(String(dc.assessment_date));
      const qualifyingStarts = priors.filter((a) => {
        if (a.visit_type !== 'Start of Care' && a.visit_type !== 'Resumption of Care') return false;
        const startTime = Date.parse(String(a.assessment_date || ''));
        return Number.isFinite(startTime) && startTime <= dischargeTime;
      });
      const latestStartTime = qualifyingStarts.reduce(
        (latest, row) => Math.max(latest, Date.parse(String(row.assessment_date))),
        Number.NEGATIVE_INFINITY,
      );
      const latestStarts = qualifyingStarts.filter((row) =>
        Date.parse(String(row.assessment_date)) === latestStartTime);
      if (latestStarts.length > 1) {
        skippedAmbiguousStartAssessment += 1;
        skipReasons.push({
          patient_id: dc.patient_id,
          episode_end: dc.assessment_date,
          reasons: ['ambiguous_latest_start_assessment'],
        });
        continue;
      }
      const start = latestStarts[0];
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
          // The published run is a complete generation. Omitting this
          // ambiguous episode from the generation supersedes any prior result
          // without mutating previously published audit history.
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

        // No mutation of an older generation is needed. A consumer must read
        // only rows belonging to one published OutcomeComputationRun, so an
        // omitted episode is absent atomically when this run is published.
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

      const optionalFieldsPresent = [
        'discharge_disposition',
        'primary_diagnosis',
        'internal_gg_18_item_raw_sum',
      ].filter((field) => Object.hasOwn(payload, field));
      metricPayloads.push({
        ...payload,
        // This value intentionally never becomes `oasis_change_score` on the
        // row itself. Publication is the one status transition on the run;
        // legacy consumers cannot accidentally treat a partially staged row
        // as current.
        outcome_measure_source: 'outcome_run_staged',
        outcome_computation_run_id: runId,
        outcome_computation_attempt_id: attemptId,
        optional_fields_present: optionalFieldsPresent,
      });
    }

    // Stable, explicit windows are mandatory. They are part of the publication
    // key, so a deleted, reassigned, or newly excluded discharge produces a
    // complete replacement generation for the same named window.
    const targetPeriodStart = periodStart;
    const targetPeriodEnd = periodEnd;
    // Count excluded EPISODES in the requested period exactly once. A missing
    // or invalid discharge date is reported separately because the job cannot
    // prove whether that row belongs inside this stable window. prior-cap is a
    // reason for missing-start and is not added a second time.
    const excludedEpisodeCount =
      skippedMissingPatientId +
      skippedMissingStartAssessment +
      skippedAmbiguousStartAssessment +
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
    const metricPlanKey = (payload) => JSON.stringify([
      payload.agency_id,
      payload.patient_id,
      payload.episode_start,
      payload.episode_end,
    ]);
    metricPayloads.sort((a, b) => metricPlanKey(a).localeCompare(metricPlanKey(b)));
    const metricKeys = metricPayloads.map(metricPlanKey);
    if (new Set(metricKeys).size !== metricKeys.length) {
      throw new Error('Outcome plan contains duplicate patient episode keys');
    }
    const stagedKpis = kpis.map((kpi) => ({
      ...kpi,
      // `is_current` is a legacy publication hint. Run-scoped output stays
      // false forever; only the referenced run's status can publish it.
      is_current: false,
      outcome_computation_run_id: runId,
      outcome_computation_attempt_id: attemptId,
    }));
    const kpiPlanKey = (payload) => JSON.stringify([
      payload.agency_id,
      payload.metric_name,
      payload.metric_category,
      payload.period_start,
      payload.period_end,
    ]);
    stagedKpis.sort((a, b) => kpiPlanKey(a).localeCompare(kpiPlanKey(b)));
    const kpiKeys = stagedKpis.map(kpiPlanKey);
    if (new Set(kpiKeys).size !== kpiKeys.length) {
      throw new Error('Outcome plan contains duplicate agency KPI keys');
    }
    const withoutExecutionIdentity = (payload) => {
      const stablePayload = { ...payload };
      delete stablePayload.outcome_computation_run_id;
      delete stablePayload.outcome_computation_attempt_id;
      return stablePayload;
    };
    const generationFingerprint = await sha256Hex(JSON.stringify({
      metrics: metricPayloads.map(withoutExecutionIdentity),
      kpis: stagedKpis.map(withoutExecutionIdentity),
      excluded_episode_count: excludedEpisodeCount,
      measures: rollup.measures,
    }));
    for (const payload of metricPayloads) payload.generation_fingerprint = generationFingerprint;
    for (const payload of stagedKpis) payload.generation_fingerprint = generationFingerprint;
    // Bind every writer-owned domain/result/provenance value to this exact
    // attempt. Base44-injected id/date/owner metadata is deliberately absent.
    // The generation fingerprint is assigned first because it is itself
    // provenance committed by each row hash.
    for (const payload of metricPayloads) {
      payload.row_content_hash = await outcomeRowContentHash(
        payload,
        PATIENT_OUTCOME_METRIC_CONTENT_FIELDS,
      );
    }
    for (const payload of stagedKpis) {
      payload.row_content_hash = await outcomeRowContentHash(payload, AGENCY_KPI_CONTENT_FIELDS);
    }

    // All source reads and calculations finish before any derived row is
    // written. Rows are append-only and permanently staged; a failure halfway
    // through cannot mix them into a prior published generation.
    failureStage = 'stage_patient_outcome_metrics';
    for (const payload of metricPayloads) {
      const created = await base44.asServiceRole.entities.PatientOutcomeMetric.create(payload);
      if (!created?.id) throw new Error('PatientOutcomeMetric create did not return an id');
      metricsWritten += 1;
    }
    let kpisWritten = 0;
    failureStage = 'stage_agency_kpis';
    for (const payload of stagedKpis) {
      const created = await base44.asServiceRole.entities.AgencyKPI.create(payload);
      if (!created?.id) throw new Error('AgencyKPI create did not return an id');
      kpisWritten += 1;
    }

    // Read back the exact staged cohort before publishing. A create response is
    // not enough evidence that every row was durably stored under the intended
    // tenant/run/attempt. The generation tag plus exact logical-key set makes a
    // missing, duplicated, or cross-run row fail closed.
    failureStage = 'reconcile_staged_generation';
    const reconcileStagedRows = async (entity, expectedPayloads, keyOf, contentFields, label) => {
      const page = await fetchAllPages(entity, {
        agency_id: agencyId,
        outcome_computation_run_id: runId,
        outcome_computation_attempt_id: attemptId,
      }, '-created_date', {
        maxRows: Math.max(expectedPayloads.length + MAX_UNEXPECTED_STAGED_ROWS, 1),
      });
      if (page.truncated) throw new Error(`${label} staged-row readback exceeded the expected count`);
      const rows = page.rows.filter((row) =>
        belongsToAgency(row) &&
        row.outcome_computation_run_id === runId &&
        row.outcome_computation_attempt_id === attemptId);
      if (rows.length !== expectedPayloads.length) {
        throw new Error(`${label} staged-row count did not match the outcome plan`);
      }
      if (rows.some((row) => row.generation_fingerprint !== generationFingerprint)) {
        throw new Error(`${label} staged-row fingerprint did not match the outcome plan`);
      }
      const expectedHashes = new Map(expectedPayloads.map((payload) => [
        keyOf(payload),
        payload.row_content_hash,
      ]));
      for (const row of rows) {
        const storedHash = String(row?.row_content_hash || '');
        if (!/^[a-f0-9]{64}$/.test(storedHash)) {
          throw new Error(`${label} staged row has a missing or invalid content hash`);
        }
        const recomputedHash = await outcomeRowContentHash(row, contentFields);
        if (storedHash !== recomputedHash || storedHash !== expectedHashes.get(keyOf(row))) {
          throw new Error(`${label} staged-row content did not match the outcome plan`);
        }
      }
      const expectedKeys = expectedPayloads.map(keyOf).sort();
      const actualKeys = rows.map(keyOf).sort();
      if (new Set(actualKeys).size !== actualKeys.length ||
          JSON.stringify(actualKeys) !== JSON.stringify(expectedKeys)) {
        throw new Error(`${label} staged-row logical keys did not match the outcome plan`);
      }
    };
    await Promise.all([
      reconcileStagedRows(
        base44.asServiceRole.entities.PatientOutcomeMetric,
        metricPayloads,
        metricPlanKey,
        PATIENT_OUTCOME_METRIC_CONTENT_FIELDS,
        'PatientOutcomeMetric',
      ),
      reconcileStagedRows(
        base44.asServiceRole.entities.AgencyKPI,
        stagedKpis,
        kpiPlanKey,
        AGENCY_KPI_CONTENT_FIELDS,
        'AgencyKPI',
      ),
    ]);

    // Keep this saved replay summary free of patient identifiers. The live
    // first-attempt response may include skip_reasons for operator diagnosis;
    // an idempotent replay returns only this non-PHI summary.
    const resultSummary = {
      success: true,
      agency_id: agencyId,
      discharge_rows_returned: discharges.length,
      discharges_in_period: dischargesInPeriod,
      discharge_query_may_be_truncated: false,
      discharge_provider_period_scoped: true,
      unscoped_discharge_date_quality_not_scanned: true,
      discharges_evaluated: outcomes.length,
      patient_outcome_metrics_written: metricsWritten,
      skipped_missing_episode_date: skippedNoDate,
      skipped_missing_discharge_date: skippedMissingDischargeDate,
      skipped_invalid_discharge_date: skippedInvalidDischargeDate,
      skipped_missing_start_date: skippedMissingStartDate,
      skipped_invalid_start_date: skippedInvalidStartDate,
      skipped_missing_patient_id: skippedMissingPatientId,
      skipped_missing_start_assessment: skippedMissingStartAssessment,
      skipped_ambiguous_start_assessment: skippedAmbiguousStartAssessment,
      skipped_prior_query_cap: skippedPriorQueryCap,
      skipped_duplicate_episode_rows: skippedDuplicateEpisodeRows,
      // Excluded episodes are REPORTED, never silently dropped: a rate that
      // covers fewer episodes than the reader assumes is a false quality claim.
      skipped_not_proxy_scorable: skippedNotScorable,
      patient_outcome_metrics_retired: 0,
      calculation_version: OUTCOME_CALCULATION_VERSION,
      period_type: periodType,
      period_start: periodStart,
      period_end: periodEnd,
      excluded_episode_count: excludedEpisodeCount,
      agency_kpis_written: kpisWritten,
      agency_kpis_retired: 0,
      internal_sample_ready_measure_count: rollup.internal_sample_ready_measure_count,
      internal_sample_ready: rollup.internal_sample_ready,
      measures: rollup.measures,
      generation_fingerprint: generationFingerprint,
    };
    const canonicalResultSummaryHash = await resultSummaryHash(resultSummary);
    // Re-elect immediately before publication. This catches a contender that
    // became visible while source reads or staged writes were in progress.
    // A uniqueness/CAS guarantee is still required before production because
    // no application-level recheck can close every datastore race window.
    failureStage = 'publish_claim_recheck';
    const finalClaimPage = await fetchAllPages(
      base44.asServiceRole.entities.OutcomeComputationRun,
      { agency_id: agencyId, window_key: windowKey },
      '-created_date',
      { maxRows: MAX_MATCHING_RUN_ROWS },
    );
    if (finalClaimPage.truncated) {
      throw new Error('OutcomeComputationRun final claim query exceeded the safety cap');
    }
    const finalClaims = finalClaimPage.rows.filter((row) =>
      belongsToAgency(row) && row.window_key === windowKey);
    const competingPublishedRuns = finalClaims.filter((row) =>
      row.status === 'published' && row.id !== runId);
    const finalBuildingWinner = finalClaims
      .filter((row) => row.status === 'building')
      .sort((a, b) => String(a.id).localeCompare(String(b.id)))[0];
    if (competingPublishedRuns.length > 0 ||
        (finalBuildingWinner && finalBuildingWinner.id !== runId)) {
      await applyConditionalOutcomeRunTransition(
        base44.asServiceRole.entities.OutcomeComputationRun,
        activeRunSnapshot,
        {
          status: 'superseded',
          failure_stage: 'lost_final_publication_claim',
        },
      );
      activeRunId = null;
      activeRunSnapshot = null;
      if (competingPublishedRuns.length > 1) {
        return Response.json({
          success: false,
          error: 'Multiple published runs exist for this reporting window',
          requires_operator_review: true,
        }, { status: 409 });
      }
      const competingPublished = competingPublishedRuns[0];
      if (competingPublished) {
        if (competingPublished.run_key !== runKey) {
          return Response.json({
            success: false,
            error: 'A different idempotency key published this reporting window',
            requires_operator_review: true,
          }, { status: 409 });
        }
        const validationError = await publishedRunValidationError(competingPublished);
        if (validationError) {
          return Response.json({
            success: false,
            error: `Competing published outcome run is not replayable: ${validationError}`,
            requires_operator_review: true,
          }, { status: 409 });
        }
        const savedSummary = competingPublished.result_summary &&
          typeof competingPublished.result_summary === 'object'
          ? competingPublished.result_summary
          : {};
        return Response.json({
          ...savedSummary,
          success: true,
          idempotent_replay: true,
          outcome_computation_run_id: competingPublished.id,
          outcome_computation_attempt_id: competingPublished.attempt_id,
          publication_status: 'published',
          publication_mode: OUTCOME_RUN_PUBLICATION_MODE,
        });
      }
      return Response.json({
        success: false,
        error: 'A concurrent attempt won the final publication claim',
        retry_with_same_key: true,
      }, { status: 409 });
    }

    failureStage = 'publish_run';
    const publishedRunRow = await applyConditionalOutcomeRunTransition(
      base44.asServiceRole.entities.OutcomeComputationRun,
      activeRunSnapshot,
      {
        status: 'published',
        published_at: new Date().toISOString(),
        patient_outcome_metric_count: metricsWritten,
        agency_kpi_count: kpisWritten,
        generation_fingerprint: generationFingerprint,
        result_summary: resultSummary,
        result_summary_hash: canonicalResultSummaryHash,
      },
    );
    const publicationValidationError = await publishedRunValidationError(publishedRunRow);
    if (publicationValidationError) {
      throw new Error(`OutcomeComputationRun publication readback failed: ${publicationValidationError}`);
    }

    // Defense in depth only: this catches a contender that became visible after
    // the pre-publication election but before this read. It cannot close the
    // final phantom window after this query; datastore uniqueness or a proved
    // single-record lease is still required before production.
    const postPublicationWindowPage = await fetchAllPages(
      base44.asServiceRole.entities.OutcomeComputationRun,
      { agency_id: agencyId, window_key: windowKey },
      '-created_date',
      { maxRows: MAX_MATCHING_RUN_ROWS },
    );
    if (postPublicationWindowPage.truncated) {
      throw new Error('OutcomeComputationRun post-publication window readback exceeded the safety cap');
    }
    const publishedWindowRows = postPublicationWindowPage.rows.filter((row) =>
      belongsToAgency(row) && row.window_key === windowKey && row.status === 'published');
    if (publishedWindowRows.length !== 1 || publishedWindowRows[0].id !== runId) {
      activeRunId = null;
      activeRunSnapshot = null;
      return Response.json({
        success: false,
        error: 'Publication conflict appeared during the final outcome window transition',
        requires_operator_review: true,
      }, { status: 409 });
    }
    activeRunId = null;
    activeRunSnapshot = null;

    return Response.json({
      ...resultSummary,
      idempotent_replay: false,
      outcome_computation_run_id: runId,
      outcome_computation_attempt_id: attemptId,
      publication_status: 'published',
      publication_mode: OUTCOME_RUN_PUBLICATION_MODE,
      skip_reasons: skipReasons,
    });
  } catch (error) {
    console.error('Error computing outcome measures:', error);
    // Do not perform a second status write when the publish response itself is
    // ambiguous: the first update may have committed even if its response was
    // lost. Every earlier failure is safely marked failed; its staged rows stay
    // invisible because no published run references them.
    if (activeRunClient && activeRunId && activeRunSnapshot && failureStage !== 'publish_run') {
      try {
        await applyConditionalOutcomeRunTransition(
          activeRunClient.asServiceRole.entities.OutcomeComputationRun,
          activeRunSnapshot,
          {
            status: 'failed',
            failed_at: new Date().toISOString(),
            failure_stage: failureStage,
          },
        );
      } catch (runError) {
        console.error('Failed to mark outcome computation run failed:', runError);
      }
    }
    return Response.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
});
