import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { transpileTs } from '../../tools-transpile-ts.mjs';

const functionUrl = new URL('../functions/getPublishedOutcomeMeasures/entry.ts', import.meta.url);
const wrapperUrl = new URL('../../src/functions/getPublishedOutcomeMeasures.js', import.meta.url);
const writerUrl = new URL('../functions/computeOutcomeMeasures/entry.ts', import.meta.url);

const REQUEST = {
  agency_id: 'agency-a',
  period_type: 'custom',
  period_start: '2026-01-01',
  period_end: '2026-01-31',
};
const RUN_ID = 'run-1';
const ATTEMPT_ID = 'attempt-1';
const FINGERPRINT = 'f'.repeat(64);
const RUN_KEY = 'a'.repeat(64);
const WINDOW_KEY = createHash('sha256')
  .update(JSON.stringify([
    REQUEST.agency_id,
    REQUEST.period_type,
    REQUEST.period_start,
    REQUEST.period_end,
  ]))
  .digest('hex');
const CALCULATION_VERSION = 'pennsync-internal-oasis-change-v4';
const METRIC_CONTENT_FIELDS = [
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
];
const KPI_CONTENT_FIELDS = [
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
];

function canonicalValue(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('non-finite fixture value');
    return value;
  }
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value).sort()
        .filter((key) => value[key] !== undefined)
        .map((key) => [key, canonicalValue(value[key])]),
    );
  }
  throw new Error('unsupported fixture value');
}

function contentHash(row, fields) {
  const payload = Object.fromEntries(
    fields
      .filter((field) => Object.hasOwn(row, field) && row[field] !== undefined)
      .map((field) => [field, row[field]]),
  );
  return createHash('sha256').update(JSON.stringify(canonicalValue(payload))).digest('hex');
}

const membership = (overrides = {}) => ({
  id: 'membership-a',
  membership_key: 'agency-a:user-1',
  agency_id: 'agency-a',
  user_id: 'user-1',
  user_email_normalized: 'member@example.com',
  tenant_role: 'manager',
  status: 'active',
  created_by_user_id: 'owner-1',
  last_transition_by_user_id: 'owner-1',
  last_transition_by_email_normalized: 'owner@example.test',
  last_transition_at: '2026-01-01T00:00:00.000Z',
  last_transition_reason: 'Activated after identity verification',
  activated_at: '2026-01-01T00:00:00.000Z',
  version: 1,
  ...overrides,
});

const agency = (overrides = {}) => ({
  id: 'agency-a',
  agency_name: 'Agency A',
  status: 'active',
  ...overrides,
});

function metric(overrides = {}) {
  const row = {
    id: 'metric-1',
    agency_id: 'agency-a',
    outcome_computation_run_id: RUN_ID,
    outcome_computation_attempt_id: ATTEMPT_ID,
    generation_fingerprint: FINGERPRINT,
    patient_id: 'patient-1',
    episode_start: '2025-12-15',
    episode_end: '2026-01-15',
    optional_fields_present: ['discharge_disposition'],
    discharge_disposition: 'remained_home',
    functional_improvement: {
      ambulation_improved: true,
      overall_improvement_score: 100,
    },
    measure_results: [{
      measure: 'ambulation',
      status: 'improved',
      start_value: '03',
      discharge_value: '05',
      reason: 'numeric_score_increased',
    }],
    input_response_schema_ids: [
      'pennsync-oasis-response-v2-cms-e2',
      'pennsync-oasis-response-v2-cms-e2',
    ],
    calculation_version: CALCULATION_VERSION,
    outcome_measure_source: 'outcome_run_staged',
    ...overrides,
  };
  if (!Object.hasOwn(overrides, 'row_content_hash')) {
    row.row_content_hash = contentHash(row, METRIC_CONTENT_FIELDS);
  }
  return row;
}

function kpi(overrides = {}) {
  const row = {
    id: 'kpi-1',
    agency_id: 'agency-a',
    outcome_computation_run_id: RUN_ID,
    outcome_computation_attempt_id: ATTEMPT_ID,
    generation_fingerprint: FINGERPRINT,
    is_current: false,
    metric_name: 'Ambulation improvement',
    metric_category: 'quality',
    period_type: 'custom',
    period_start: '2026-01-01',
    period_end: '2026-01-31',
    metric_value: 100,
    benchmark_value: 75,
    unit: '%',
    status: 'on_target',
    input_response_schema_ids: ['pennsync-oasis-response-v2-cms-e2'],
    calculation_version: CALCULATION_VERSION,
    excluded_episode_count: 0,
    contributing_factors: ['1 of 1 eligible episodes improved'],
    ...overrides,
  };
  if (!Object.hasOwn(overrides, 'row_content_hash')) {
    row.row_content_hash = contentHash(row, KPI_CONTENT_FIELDS);
  }
  return row;
}

const run = ({ metricCount = 1, kpiCount = 1, ...overrides } = {}) => ({
  id: RUN_ID,
  agency_id: 'agency-a',
  run_key: RUN_KEY,
  window_key: WINDOW_KEY,
  attempt_id: ATTEMPT_ID,
  status: 'published',
  publication_mode: 'single_run_record_gate_v1',
  period_type: 'custom',
  period_start: '2026-01-01',
  period_end: '2026-01-31',
  calculation_version: CALCULATION_VERSION,
  started_at: '2026-02-01T00:00:00.000Z',
  published_at: '2026-02-01T00:01:00.000Z',
  patient_outcome_metric_count: metricCount,
  agency_kpi_count: kpiCount,
  generation_fingerprint: FINGERPRINT,
  result_summary: {
    success: true,
    agency_id: 'agency-a',
    period_type: 'custom',
    period_start: '2026-01-01',
    period_end: '2026-01-31',
    calculation_version: CALCULATION_VERSION,
    generation_fingerprint: FINGERPRINT,
    patient_outcome_metrics_written: metricCount,
    agency_kpis_written: kpiCount,
  },
  ...overrides,
});

function matchesQuery(row, query) {
  return Object.entries(query).every(([field, value]) => row?.[field] === value);
}

async function loadHandler({
  user = { id: 'user-1', email: 'Member@Example.com', role: 'user' },
  superAdminEmail = '',
  membershipRows = [membership()],
  agencyRows = [agency()],
  runRows = [run()],
  metricRows = [metric()],
  kpiRows = [kpi()],
  ignoreFilters = [],
  ignoreSkip = [],
  nonArrayEntity = null,
  entityHooks = {},
} = {}) {
  let source = await readFile(functionUrl, 'utf8');
  source = source.replace(
    /import\s+\{\s*createClientFromRequest\s*\}\s+from\s+'npm:[^']+';/,
    'const createClientFromRequest = globalThis.__publishedOutcomeMakeClient;',
  );
  const temporaryModule = join(
    tmpdir(),
    `published_outcome_${Date.now()}_${Math.random().toString(36).slice(2)}.mjs`,
  );
  await writeFile(temporaryModule, transpileTs(source).outputText);

  const calls = {
    AgencyMembership: [],
    Agency: [],
    OutcomeComputationRun: [],
    PatientOutcomeMetric: [],
    AgencyKPI: [],
  };
  const writes = [];
  const sourceRows = {
    AgencyMembership: membershipRows,
    Agency: agencyRows,
    OutcomeComputationRun: runRows,
    PatientOutcomeMetric: metricRows,
    AgencyKPI: kpiRows,
  };
  const makeEntity = (name) => ({
    filter: async (query, sort, limit, skip) => {
      const call = { query, sort, limit, skip };
      calls[name].push(call);
      if (nonArrayEntity === name) return null;
      if (entityHooks[name]) {
        return entityHooks[name]({
          query,
          sort,
          limit,
          skip,
          callNumber: calls[name].length,
          rows: sourceRows[name],
        });
      }
      const filtered = ignoreFilters.includes(name)
        ? sourceRows[name]
        : sourceRows[name].filter((row) => matchesQuery(row, query));
      const offset = ignoreSkip.includes(name) ? 0 : skip;
      return filtered.slice(offset, offset + limit);
    },
    create: async (...args) => { writes.push([name, 'create', args]); },
    update: async (...args) => { writes.push([name, 'update', args]); },
    delete: async (...args) => { writes.push([name, 'delete', args]); },
    bulkCreate: async (...args) => { writes.push([name, 'bulkCreate', args]); },
  });
  const client = {
    auth: { me: async () => user },
    functions: {
      invoke: async (...args) => { writes.push(['functions', 'invoke', args]); },
    },
    asServiceRole: {
      functions: {
        invoke: async (...args) => { writes.push(['serviceFunctions', 'invoke', args]); },
      },
      entities: Object.fromEntries(
        Object.keys(calls).map((name) => [name, makeEntity(name)]),
      ),
    },
  };

  let handler;
  globalThis.__publishedOutcomeMakeClient = () => client;
  globalThis.Deno = {
    serve: (candidate) => { handler = candidate; },
    env: { get: (name) => (name === 'SUPER_ADMIN_EMAIL' ? superAdminEmail : undefined) },
  };
  try {
    await import(pathToFileURL(temporaryModule).href);
  } finally {
    await unlink(temporaryModule).catch(() => {});
  }
  assert.equal(typeof handler, 'function');
  return { handler, calls, writes };
}

async function invoke(handler, body = REQUEST, { method = 'POST', invalidJson = false } = {}) {
  const response = await handler({
    method,
    json: invalidJson
      ? async () => { throw new SyntaxError('invalid'); }
      : async () => body,
  });
  return { response, json: await response.json() };
}

test('broker and wrapper expose only the read path', async () => {
  const [source, wrapper, writer] = await Promise.all([
    readFile(functionUrl, 'utf8'),
    readFile(wrapperUrl, 'utf8'),
    readFile(writerUrl, 'utf8'),
  ]);
  assert.match(wrapper, /base44\.functions\.invoke\('getPublishedOutcomeMeasures', payload\)/);
  assert.doesNotMatch(wrapper, /entities\.|computeOutcomeMeasures/);
  assert.doesNotMatch(source, /\.create\s*\(|\.update\s*\(|\.delete\s*\(|\.bulkCreate\s*\(/);
  assert.doesNotMatch(source, /functions\.invoke\s*\(/);
  assert.doesNotMatch(source, /entities\.OASISAssessment|entities\.Patient\b/);

  const hashBlock = (text) => text.match(
    /\/\/ <<<BEGIN OUTCOME ROW CONTENT HASH V1>>>[\s\S]*?\/\/ <<<END OUTCOME ROW CONTENT HASH V1>>>/,
  )?.[0];
  assert.ok(hashBlock(source));
  assert.equal(hashBlock(source), hashBlock(writer));
});

test('canonical row hashes ignore object-key insertion order but preserve the same domain content', async () => {
  const row = metric();
  row.functional_improvement = {
    overall_improvement_score: 100,
    ambulation_improved: true,
  };
  row.measure_results = [{
    reason: 'numeric_score_increased',
    discharge_value: '05',
    start_value: '03',
    status: 'improved',
    measure: 'ambulation',
  }];
  const { handler } = await loadHandler({ metricRows: [row] });
  assert.equal((await invoke(handler)).response.status, 200);
});

test('reader rejects diagnosis, measure, and KPI tampering under a copied generation fingerprint', async () => {
  const diagnosisRow = metric({
    optional_fields_present: ['discharge_disposition', 'primary_diagnosis'],
    primary_diagnosis: 'I10',
  });
  diagnosisRow.primary_diagnosis = 'E11.9';

  const measureRow = metric();
  measureRow.measure_results[0].discharge_value = '01';

  const kpiRow = kpi();
  kpiRow.metric_value = 25;

  for (const options of [
    { metricRows: [diagnosisRow] },
    { metricRows: [measureRow] },
    { kpiRows: [kpiRow] },
  ]) {
    const row = options.metricRows?.[0] || options.kpiRows[0];
    assert.equal(row.generation_fingerprint, FINGERPRINT);
    const { handler, writes } = await loadHandler(options);
    const result = await invoke(handler);
    assert.equal(result.response.status, 409);
    assert.match(result.json.error, /content changed after hashing/i);
    assert.deepEqual(writes, []);
  }
});

test('an exact active membership returns one reconciled, narrowly projected publication', async () => {
  const privateMetric = metric({
    source_assessment_ids: ['assessment-secret'],
    created_by: 'writer@example.com',
    functional_improvement: {
      ambulation_improved: true,
      overall_improvement_score: 100,
      private_nested_field: 'not returned',
    },
  });
  const privateKpi = kpi({
    created_by: 'writer@example.com',
    improvement_actions: ['not returned'],
  });
  const { handler, calls, writes } = await loadHandler({
    metricRows: [privateMetric],
    kpiRows: [privateKpi],
  });
  const { response, json } = await invoke(handler);

  assert.equal(response.status, 200);
  assert.equal(json.success, true);
  assert.deepEqual(json.scope, {
    agency_id: 'agency-a',
    period_type: 'custom',
    period_start: '2026-01-01',
    period_end: '2026-01-31',
    authorization_source: 'agency_membership',
    is_platform_owner: false,
  });
  assert.equal(json.publication.outcome_computation_run_id, RUN_ID);
  assert.equal(json.publication.generation_fingerprint, FINGERPRINT);
  assert.equal(json.patient_outcome_metrics.length, 1);
  assert.equal(json.agency_kpis.length, 1);
  assert.equal(json.patient_outcome_metrics[0].source_assessment_ids, undefined);
  assert.equal(json.patient_outcome_metrics[0].created_by, undefined);
  assert.equal(json.patient_outcome_metrics[0].functional_improvement.private_nested_field, undefined);
  assert.equal(json.agency_kpis[0].created_by, undefined);
  assert.equal(json.agency_kpis[0].improvement_actions, undefined);
  assert.equal(calls.OutcomeComputationRun.length, 2);
  assert.deepEqual(writes, []);
});

test('authentication and deactivation guards run before service-role reads', async () => {
  for (const { user, status } of [
    { user: null, status: 401 },
    { user: { id: 'user-1', email: 'member@example.com', is_active: false }, status: 403 },
  ]) {
    const { handler, calls, writes } = await loadHandler({ user });
    const result = await invoke(handler);
    assert.equal(result.response.status, status);
    assert.deepEqual(Object.values(calls).map((rows) => rows.length), [0, 0, 0, 0, 0]);
    assert.deepEqual(writes, []);
  }
});

test('explicit disabled, service, and unverified identities are denied before every service read', async () => {
  for (const unsafeFlag of [
    { disabled: true },
    { is_service: true },
    { is_verified: false },
  ]) {
    const { handler, calls, writes } = await loadHandler({
      user: {
        id: 'owner-1',
        email: 'owner@example.test',
        role: 'admin',
        ...unsafeFlag,
      },
      membershipRows: [],
      superAdminEmail: 'owner@example.test',
    });
    const result = await invoke(handler);
    assert.equal(result.response.status, 403);
    assert.deepEqual(Object.values(calls).map((rows) => rows.length), [0, 0, 0, 0, 0]);
    assert.deepEqual(writes, []);
  }
});

test('requests require POST and one exact, explicit tenant window', async () => {
  const cases = [
    { body: REQUEST, options: { method: 'GET' } },
    { body: REQUEST, options: { invalidJson: true } },
    { body: null },
    { body: [] },
    { body: { ...REQUEST, unexpected: true } },
    { body: { ...REQUEST, agency_id: undefined } },
    { body: { ...REQUEST, agency_id: ' agency-a' } },
    { body: { ...REQUEST, period_type: 'month' } },
    { body: { ...REQUEST, period_start: '2026-02-30' } },
    { body: { ...REQUEST, period_start: '2026-02-01', period_end: '2026-01-31' } },
  ];
  for (const { body, options } of cases) {
    const { handler, calls } = await loadHandler();
    const result = await invoke(handler, body, options);
    assert.equal([400, 405].includes(result.response.status), true, JSON.stringify(body));
    assert.equal(calls.AgencyMembership.length, 0);
  }
});

test('mutable custom User claims cannot authorize and immutable identity is required', async () => {
  for (const user of [
    {
      id: 'attacker',
      email: 'attacker@example.com',
      role: 'user',
      account_type: 'super_admin',
      agency_id: 'agency-a',
      agency_name: 'Agency A',
      is_manager: true,
    },
    { email: 'member@example.com', role: 'admin' },
    { id: 'user-1', role: 'admin' },
  ]) {
    const { handler, calls } = await loadHandler({ user, membershipRows: [] });
    const result = await invoke(handler);
    assert.equal(result.response.status, 403);
    assert.equal(calls.OutcomeComputationRun.length, 0);
  }
});

test('membership integrity mismatches and duplicate memberships fail closed', async () => {
  const cases = [
    [membership({ user_email_normalized: 'other@example.com' })],
    [membership({ user_email_normalized: 'Member@Example.com' })],
    [membership({ membership_key: 'forged' })],
    [membership(), membership({ id: 'membership-b' })],
  ];
  for (const membershipRows of cases) {
    const { handler, calls } = await loadHandler({ membershipRows });
    const result = await invoke(handler);
    assert.equal(result.response.status, 409);
    assert.equal(calls.Agency.length, 0);
    assert.equal(calls.OutcomeComputationRun.length, 0);
  }
});

test('an active and revoked duplicate for the same agency and user fails closed globally', async () => {
  const revokedDuplicate = membership({
    id: 'membership-revoked-duplicate',
    status: 'revoked',
    version: 2,
    last_transition_at: '2026-01-02T00:00:00.000Z',
    last_transition_reason: 'Access revoked',
    revoked_at: '2026-01-02T00:00:00.000Z',
    revocation_reason: 'Access revoked',
  });
  const { handler, calls, writes } = await loadHandler({
    membershipRows: [membership(), revokedDuplicate],
  });
  const result = await invoke(handler);
  assert.equal(result.response.status, 409);
  assert.equal(calls.Agency.length, 0);
  assert.equal(calls.OutcomeComputationRun.length, 0);
  assert.deepEqual(writes, []);
});

test('only active agency_admin and manager memberships may read agency-wide outcomes', async () => {
  for (const role of ['agency_admin', 'manager']) {
    const { handler } = await loadHandler({ membershipRows: [membership({ tenant_role: role })] });
    assert.equal((await invoke(handler)).response.status, 200, role);
  }
  for (const role of ['clinician', 'office_staff', 'social_worker', 'spiritual_care']) {
    const { handler, calls, writes } = await loadHandler({
      membershipRows: [membership({ tenant_role: role })],
    });
    const result = await invoke(handler);
    assert.equal(result.response.status, 403, role);
    assert.equal(calls.Agency.length, 0, role);
    assert.equal(calls.OutcomeComputationRun.length, 0, role);
    assert.deepEqual(writes, [], role);
  }
});

test('membership version and lifecycle provenance must satisfy the canonical lifecycle contract', async () => {
  const cases = [
    { version: 0 },
    { version: 1.5 },
    { version: Number.MAX_SAFE_INTEGER + 1 },
    { version: '1' },
    { created_by_user_id: '' },
    { created_by_user_id: ' owner-1' },
    { last_transition_by_user_id: '' },
    { last_transition_by_user_id: 'owner-1 ' },
    { last_transition_by_email_normalized: '' },
    { last_transition_by_email_normalized: 'Owner@Example.test' },
    { last_transition_by_email_normalized: 'not-an-email' },
    { last_transition_at: '' },
    { last_transition_at: 'not-a-timestamp' },
    { last_transition_reason: '' },
    { last_transition_reason: '   ' },
    { last_transition_reason: 'x'.repeat(501) },
    { activated_at: undefined },
    { status: 'suspended', activated_at: undefined },
    { status: 'revoked', revoked_at: undefined, revocation_reason: undefined },
    { status: 'revoked', revoked_at: 'not-a-timestamp', revocation_reason: 'Revoked' },
    { status: 'revoked', revoked_at: '2026-01-02T00:00:00.000Z', revocation_reason: '   ' },
    {
      status: 'revoked',
      revoked_at: '2026-01-02T00:00:00.000Z',
      revocation_reason: 'x'.repeat(501),
    },
  ];
  for (const overrides of cases) {
    const { handler, calls, writes } = await loadHandler({
      membershipRows: [membership(overrides)],
    });
    const result = await invoke(handler);
    assert.equal(result.response.status, 409, JSON.stringify(overrides));
    assert.equal(calls.Agency.length, 0);
    assert.equal(calls.OutcomeComputationRun.length, 0);
    assert.deepEqual(writes, []);
  }
});

test('the exact configured built-in admin is the only membership-free owner fallback', async () => {
  for (const user of [
    { id: 'owner', email: 'owner@example.com', role: 'user', account_type: 'super_admin' },
    { id: 'owner', email: 'other@example.com', role: 'admin', account_type: 'super_admin' },
  ]) {
    const { handler } = await loadHandler({
      user,
      membershipRows: [],
      superAdminEmail: 'owner@example.com',
    });
    assert.equal((await invoke(handler)).response.status, 403);
  }

  const { handler, writes } = await loadHandler({
    user: { id: 'owner', email: ' Owner@Example.com ', role: 'admin' },
    membershipRows: [],
    superAdminEmail: 'owner@example.com',
  });
  const { response, json } = await invoke(handler);
  assert.equal(response.status, 200);
  assert.equal(json.scope.authorization_source, 'protected_platform_owner');
  assert.equal(json.scope.is_platform_owner, true);
  assert.deepEqual(writes, []);
});

test('agency selection is exact, active, and unambiguous', async () => {
  for (const { rows, status } of [
    { rows: [], status: 403 },
    { rows: [agency({ status: 'suspended' })], status: 403 },
    { rows: [agency(), agency()], status: 409 },
  ]) {
    const { handler, calls } = await loadHandler({ agencyRows: rows });
    const result = await invoke(handler);
    assert.equal(result.response.status, status);
    assert.equal(calls.OutcomeComputationRun.length, 0);
  }
});

test('missing, foreign, duplicate, and over-cap published run sets fail closed', async () => {
  const duplicate = run({ id: 'run-2', run_key: 'b'.repeat(64), attempt_id: 'attempt-2' });
  for (const { rows, status } of [
    { rows: [], status: 404 },
    { rows: [run({ agency_id: 'agency-b' })], status: 404 },
    { rows: [run(), duplicate], status: 409 },
    {
      rows: Array.from({ length: 26 }, (_, index) => run({
        id: `run-${index}`,
        run_key: String(index).padStart(64, '0'),
        attempt_id: `attempt-${index}`,
      })),
      status: 409,
    },
  ]) {
    const { handler, calls } = await loadHandler({ runRows: rows, ignoreFilters: ['OutcomeComputationRun'] });
    const result = await invoke(handler);
    assert.equal(result.response.status, status);
    assert.equal(calls.PatientOutcomeMetric.length, 0);
  }
});

test('published run metadata and saved summary must be complete and consistent', async () => {
  const cases = [
    { attempt_id: '' },
    { run_key: 'not-a-hash' },
    { window_key: 'b'.repeat(64) },
    { generation_fingerprint: 'bad' },
    { publication_mode: 'legacy-row-flags' },
    { calculation_version: '' },
    { started_at: 'not-a-date' },
    { published_at: '2026-01-01T00:00:00.000Z' },
    { patient_outcome_metric_count: -1 },
    { agency_kpi_count: 101 },
    { result_summary: null },
    { result_summary: { ...run().result_summary, agency_id: 'agency-b' } },
    { result_summary: { ...run().result_summary, patient_outcome_metrics_written: 2 } },
  ];
  for (const overrides of cases) {
    const { handler, calls } = await loadHandler({ runRows: [run(overrides)] });
    const result = await invoke(handler);
    assert.equal(result.response.status, 409, JSON.stringify(overrides));
    assert.equal(calls.PatientOutcomeMetric.length, 0);
  }
});

test('a rich patient cohort above the 500-row response cap is unavailable, never truncated', async () => {
  const { handler, calls, writes } = await loadHandler({
    runRows: [run({ metricCount: 501 })],
    metricRows: [],
  });
  const { response, json } = await invoke(handler);
  assert.equal(response.status, 409);
  assert.match(json.error, /exceeds the 500-row response safety cap/i);
  assert.equal(calls.PatientOutcomeMetric.length, 0);
  assert.equal(calls.AgencyKPI.length, 0);
  assert.deepEqual(writes, []);
});

test('unsafe publication counts are rejected before cap arithmetic or cohort reads', async () => {
  for (const runRow of [
    run({ metricCount: 2 ** 53 }),
    run({ kpiCount: 2 ** 53 }),
  ]) {
    const { handler, calls, writes } = await loadHandler({ runRows: [runRow] });
    const result = await invoke(handler);
    assert.equal(result.response.status, 409);
    assert.equal(calls.PatientOutcomeMetric.length, 0);
    assert.equal(calls.AgencyKPI.length, 0);
    assert.deepEqual(writes, []);
  }
});

test('metric cohort rejects count drift and every publication-identity mismatch', async () => {
  const badRows = [
    metric({ agency_id: 'agency-b' }),
    metric({ outcome_computation_run_id: 'run-other' }),
    metric({ outcome_computation_attempt_id: 'attempt-other' }),
    metric({ generation_fingerprint: 'e'.repeat(64) }),
    metric({ calculation_version: 'old-version' }),
    metric({ outcome_measure_source: 'oasis_change_score' }),
    metric({ episode_end: '2026-02-01' }),
  ];
  for (const row of badRows) {
    const { handler } = await loadHandler({ metricRows: [row], ignoreFilters: ['PatientOutcomeMetric'] });
    assert.equal((await invoke(handler)).response.status, 409);
  }

  for (const rows of [[], [metric(), metric({ id: 'metric-2', patient_id: 'patient-2' })]]) {
    const { handler } = await loadHandler({ metricRows: rows });
    assert.equal((await invoke(handler)).response.status, 409);
  }
});

test('optional metric presence metadata prevents stale-field inheritance', async () => {
  const cases = [
    metric({ optional_fields_present: [], discharge_disposition: 'remained_home' }),
    metric({ optional_fields_present: ['discharge_disposition', 'discharge_disposition'] }),
    metric({ optional_fields_present: ['unknown_field'] }),
    metric({ optional_fields_present: ['primary_diagnosis'], discharge_disposition: undefined }),
    metric({
      optional_fields_present: ['internal_gg_18_item_raw_sum'],
      discharge_disposition: undefined,
      internal_gg_18_item_raw_sum: 109,
    }),
  ];
  for (const row of cases) {
    // Object spread with `undefined` still creates a property, which must also
    // fail the authoritative Object.hasOwn presence check.
    const { handler } = await loadHandler({ metricRows: [row] });
    assert.equal((await invoke(handler)).response.status, 409);
  }
});

test('metric projections require bounded, well-formed nested outcome values', async () => {
  const cases = [
    metric({ functional_improvement: null }),
    metric({ functional_improvement: { ambulation_improved: 'yes' } }),
    metric({ functional_improvement: { overall_improvement_score: 101 } }),
    metric({ measure_results: [] }),
    metric({ measure_results: [{ measure: 'ambulation', status: 'unknown', reason: 'x' }] }),
    metric({
      measure_results: [
        { measure: 'ambulation', status: 'improved', reason: 'x' },
        { measure: 'ambulation', status: 'not_improved', reason: 'y' },
      ],
    }),
    metric({ input_response_schema_ids: ['one-only'] }),
  ];
  for (const row of cases) {
    const { handler } = await loadHandler({ metricRows: [row] });
    assert.equal((await invoke(handler)).response.status, 409);
  }
});

test('metric ids and logical episode keys must be unique', async () => {
  const rowsByCase = [
    [metric(), metric({ patient_id: 'patient-2' })],
    [metric(), metric({ id: 'metric-2' })],
  ];
  for (const metricRows of rowsByCase) {
    const { handler } = await loadHandler({
      runRows: [run({ metricCount: 2 })],
      metricRows,
    });
    assert.equal((await invoke(handler)).response.status, 409);
  }
});

test('KPI cohort rejects count drift and every publication/window mismatch', async () => {
  const badRows = [
    kpi({ agency_id: 'agency-b' }),
    kpi({ outcome_computation_run_id: 'run-other' }),
    kpi({ outcome_computation_attempt_id: 'attempt-other' }),
    kpi({ generation_fingerprint: 'e'.repeat(64) }),
    kpi({ calculation_version: 'old-version' }),
    kpi({ is_current: true }),
    kpi({ metric_category: 'operational' }),
    kpi({ period_start: '2026-01-02' }),
    kpi({ period_end: '2026-01-30' }),
    kpi({ metric_value: 101 }),
    kpi({ benchmark_value: -1 }),
    kpi({ input_response_schema_ids: [] }),
  ];
  for (const row of badRows) {
    const { handler } = await loadHandler({ kpiRows: [row], ignoreFilters: ['AgencyKPI'] });
    assert.equal((await invoke(handler)).response.status, 409);
  }

  for (const rows of [[], [kpi(), kpi({ id: 'kpi-2', metric_name: 'Bathing improvement' })]]) {
    const { handler } = await loadHandler({ kpiRows: rows });
    assert.equal((await invoke(handler)).response.status, 409);
  }
});

test('KPI ids and logical metric keys must be unique', async () => {
  const rowsByCase = [
    [kpi(), kpi({ metric_name: 'Bathing improvement' })],
    [kpi(), kpi({ id: 'kpi-2' })],
  ];
  for (const kpiRows of rowsByCase) {
    const { handler } = await loadHandler({
      runRows: [run({ kpiCount: 2 })],
      kpiRows,
    });
    assert.equal((await invoke(handler)).response.status, 409);
  }
});

test('cohorts paginate to their recorded counts without silently truncating', async () => {
  const metricRows = Array.from({ length: 205 }, (_, index) => metric({
    id: `metric-${index}`,
    patient_id: `patient-${String(index).padStart(4, '0')}`,
  }));
  const { handler, calls } = await loadHandler({
    runRows: [run({ metricCount: metricRows.length })],
    metricRows,
  });
  const { response, json } = await invoke(handler);

  assert.equal(response.status, 200);
  assert.equal(json.patient_outcome_metrics.length, 205);
  assert.deepEqual(
    calls.PatientOutcomeMetric.map(({ limit, skip }) => [limit, skip]),
    [[100, 0], [100, 100], [6, 200]],
  );
});

test('an ignored pagination offset fails closed instead of repeating the first page', async () => {
  const metricRows = Array.from({ length: 101 }, (_, index) => metric({
    id: `metric-${index}`,
    patient_id: `patient-${String(index).padStart(4, '0')}`,
  }));
  const { handler } = await loadHandler({
    runRows: [run({ metricCount: metricRows.length })],
    metricRows,
    ignoreSkip: ['PatientOutcomeMetric'],
  });
  assert.equal((await invoke(handler)).response.status, 409);
});

test('zero-row published cohorts are valid and still perform an overflow check', async () => {
  const { handler, calls } = await loadHandler({
    runRows: [run({ metricCount: 0, kpiCount: 0 })],
    metricRows: [],
    kpiRows: [],
  });
  const { response, json } = await invoke(handler);
  assert.equal(response.status, 200);
  assert.deepEqual(json.patient_outcome_metrics, []);
  assert.deepEqual(json.agency_kpis, []);
  assert.equal(calls.PatientOutcomeMetric.length, 1);
  assert.equal(calls.AgencyKPI.length, 1);
});

test('a duplicate or changed publication appearing during the read fails the final recheck', async () => {
  const initial = run();
  const duplicate = run({ id: 'run-2', run_key: 'b'.repeat(64), attempt_id: 'attempt-2' });
  for (const finalRows of [
    [initial, duplicate],
    [run({ published_at: '2026-02-01T00:02:00.000Z' })],
  ]) {
    const { handler } = await loadHandler({
      entityHooks: {
        OutcomeComputationRun: ({ query, limit, skip, callNumber }) => {
          const rows = callNumber === 1 ? [initial] : finalRows;
          return rows.filter((row) => matchesQuery(row, query)).slice(skip, skip + limit);
        },
      },
    });
    assert.equal((await invoke(handler)).response.status, 409);
  }
});

test('a membership revoked during cohort paging blocks the final response', async () => {
  const { handler, calls, writes } = await loadHandler({
    entityHooks: {
      AgencyMembership: ({ query, limit, skip, callNumber }) => {
        const rows = callNumber === 1
          ? [membership()]
          : [membership({
            status: 'revoked',
            version: 2,
            last_transition_at: '2026-01-02T00:00:00.000Z',
            last_transition_reason: 'Access revoked during read',
            revoked_at: '2026-01-02T00:00:00.000Z',
            revocation_reason: 'Access revoked during read',
          })];
        return rows.filter((row) => matchesQuery(row, query)).slice(skip, skip + limit);
      },
    },
  });
  const result = await invoke(handler);
  assert.equal(result.response.status, 403);
  assert.equal(calls.AgencyMembership.length, 2);
  assert.equal(calls.Agency.length, 1);
  assert.equal(calls.OutcomeComputationRun.length, 2);
  assert.deepEqual(writes, []);
});

test('an Agency suspended during cohort paging blocks the final response', async () => {
  const { handler, calls, writes } = await loadHandler({
    entityHooks: {
      Agency: ({ query, limit, skip, callNumber }) => {
        const rows = [agency({ status: callNumber === 1 ? 'active' : 'suspended' })];
        return rows.filter((row) => matchesQuery(row, query)).slice(skip, skip + limit);
      },
    },
  });
  const result = await invoke(handler);
  assert.equal(result.response.status, 403);
  assert.equal(calls.AgencyMembership.length, 2);
  assert.equal(calls.Agency.length, 2);
  assert.equal(calls.OutcomeComputationRun.length, 2);
  assert.deepEqual(writes, []);
});

test('non-array provider results fail with a generic server error and no writes', async () => {
  const originalError = console.error;
  console.error = () => {};
  try {
    for (const entity of [
      'AgencyMembership',
      'Agency',
      'OutcomeComputationRun',
      'PatientOutcomeMetric',
      'AgencyKPI',
    ]) {
      const { handler, writes } = await loadHandler({ nonArrayEntity: entity });
      const result = await invoke(handler);
      assert.equal(result.response.status, 500, entity);
      assert.deepEqual(result.json, { error: 'Internal server error' });
      assert.deepEqual(writes, []);
    }
  } finally {
    console.error = originalError;
  }
});

test('service queries carry exact immutable scope and never rely on client-side filtering alone', async () => {
  const { handler, calls } = await loadHandler();
  assert.equal((await invoke(handler)).response.status, 200);
  assert.equal(calls.AgencyMembership.length, 2);
  assert.equal(calls.Agency.length, 2);
  assert.deepEqual(calls.AgencyMembership[0].query, { user_id: 'user-1' });
  assert.deepEqual(calls.AgencyMembership[1].query, { user_id: 'user-1' });
  assert.deepEqual(calls.Agency[0].query, { id: 'agency-a' });
  assert.deepEqual(calls.Agency[1].query, { id: 'agency-a' });
  assert.deepEqual(calls.OutcomeComputationRun[0].query, {
    agency_id: 'agency-a',
    status: 'published',
    period_type: 'custom',
    period_start: '2026-01-01',
    period_end: '2026-01-31',
  });
  const cohortScope = {
    agency_id: 'agency-a',
    outcome_computation_run_id: RUN_ID,
    outcome_computation_attempt_id: ATTEMPT_ID,
  };
  assert.deepEqual(calls.PatientOutcomeMetric[0].query, cohortScope);
  assert.deepEqual(calls.AgencyKPI[0].query, cohortScope);
});
