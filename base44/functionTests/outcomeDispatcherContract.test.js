import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFile, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { transpileTs } from '../../tools-transpile-ts.mjs';

const SOURCE_URL = new URL('../functions/dispatchNightlyOutcomeMeasures/entry.ts', import.meta.url);
const WORKFLOW_URL = new URL('../workflows/Nightly Outcome Measure Computation.jsonc', import.meta.url);

async function loadHandler({
  enabled = true,
  secret = 'scheduler-secret',
  user = { id: 'admin-1', role: 'admin', is_active: true },
  filterAgency,
  invokeOutcome,
} = {}) {
  let source = await readFile(SOURCE_URL, 'utf8');
  source = source.replace(
    /import\s+\{[^}]*\}\s+from\s+'npm:[^']*';?/,
    'const createClientFromRequest = globalThis.__outcomeDispatchClient;',
  );
  const output = transpileTs(source).outputText;
  const temporary = join(
    tmpdir(),
    `outcome_dispatch_${Date.now()}_${Math.random().toString(36).slice(2)}.mjs`,
  );
  await writeFile(temporary, output);

  const calls = { clients: 0, agencyFilters: [], invocations: [] };
  let handler;
  globalThis.Deno = {
    serve: (candidate) => { handler = candidate; },
    env: {
      get: (key) => {
        if (key === 'OUTCOME_PIPELINE_RELEASE') return enabled ? 'enabled-v1' : undefined;
        if (key === 'INTERNAL_FN_SECRET') return secret;
        return undefined;
      },
    },
  };
  globalThis.__outcomeDispatchClient = () => {
    calls.clients += 1;
    return {
      auth: { me: async () => user },
      asServiceRole: {
        entities: {
          Agency: {
            filter: async (query, sort, limit) => {
              calls.agencyFilters.push({ query: structuredClone(query), sort, limit });
              if (filterAgency) return filterAgency(query, sort, limit, calls);
              return [];
            },
          },
        },
        functions: {
          invoke: async (name, payload) => {
            calls.invocations.push({ name, payload: structuredClone(payload) });
            if (invokeOutcome) return invokeOutcome(name, payload, calls);
            return { data: publishedResult(payload) };
          },
        },
      },
    };
  };
  try {
    await import(`${pathToFileURL(temporary).href}?v=${Math.random()}`);
  } finally {
    await unlink(temporary).catch(() => {});
  }
  return { handler, calls };
}

function publishedResult(payload, extra = {}) {
  return {
    success: true,
    agency_id: payload.agency_id,
    period_type: payload.period_type,
    period_start: payload.period_start,
    period_end: payload.period_end,
    publication_status: 'published',
    publication_mode: 'single_run_record_gate_v1',
    outcome_computation_run_id: `run-${payload.agency_id}`,
    outcome_computation_attempt_id: `attempt-${payload.agency_id}`,
    ...extra,
  };
}

function schedulerRequest(body = {}, {
  headers = {},
  method = 'POST',
} = {}) {
  return new Request('http://local/dispatchNightlyOutcomeMeasures', {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    ...(method === 'POST' ? { body: JSON.stringify(body) } : {}),
  });
}

function agencyFilter(agencies) {
  return (query) => {
    if (query.status) return agencies.filter((agency) => agency.status === query.status);
    if (query.id) return agencies.filter((agency) => agency.id === query.id);
    return [];
  };
}

function expectedProofSignature(payload) {
  const proof = payload.dispatch_proof;
  const message = JSON.stringify([
    proof.version,
    payload.agency_id,
    payload.period_type,
    payload.period_start,
    payload.period_end,
    payload.benchmark ?? null,
    payload.idempotency_key,
    proof.issued_at,
    proof.nonce,
  ]);
  return createHmac('sha256', 'scheduler-secret').update(message).digest('hex');
}

test('outcome dispatcher is disabled before SDK construction by default', async () => {
  const fixture = await loadHandler({ enabled: false });
  const response = await fixture.handler(schedulerRequest());
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    error: 'Nightly outcome dispatch is disabled pending hosted validation',
  });
  assert.equal(fixture.calls.clients, 0);
  assert.deepEqual(fixture.calls.agencyFilters, []);
  assert.deepEqual(fixture.calls.invocations, []);
});

test('the native nightly workflow is exact, empty-payload, and has no legacy function automation', async () => {
  const workflow = JSON.parse(await readFile(WORKFLOW_URL, 'utf8'));
  assert.equal(workflow.name, 'Nightly Outcome Measure Computation');
  assert.deepEqual(workflow.trigger?.config, {
    trigger_type: 'scheduled',
    events: [],
    schedule_mode: 'recurring',
    cron_expression: '0 6 * * *',
    one_time_date: null,
    timezone: 'UTC',
    interval_value: null,
    interval_unit: null,
    interval_anchor: null,
    ends_type: 'never',
    ends_on_date: null,
    ends_after_count: null,
  });
  assert.equal(
    workflow.definition?.do?.[0]?.run_function?.with?.function_name,
    'dispatchNightlyOutcomeMeasures',
  );
  assert.deepEqual(workflow.definition?.do?.[0]?.run_function?.with?.args, {});
  await assert.rejects(
    readFile(new URL('../functions/dispatchNightlyOutcomeMeasures/function.jsonc', import.meta.url), 'utf8'),
    (error) => error?.code === 'ENOENT',
  );
});

test('one empty scheduler tick signs an exact prior-UTC-day request for each verified agency', async () => {
  const agencies = [
    { id: 'agency-z', status: 'trial' },
    { id: 'agency-a', status: 'active' },
  ];
  const fixture = await loadHandler({ filterAgency: agencyFilter(agencies) });
  const response = await fixture.handler(schedulerRequest());
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(body, {
    success: true,
    period_type: 'daily',
    period_start: body.period_start,
    period_end: body.period_end,
    agencies_discovered: 2,
    agencies_succeeded: 2,
    idempotent_replays: 0,
    agencies_failed: 0,
  });
  assert.match(body.period_start, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(body.period_end, body.period_start);
  assert.deepEqual(
    fixture.calls.invocations.map(({ name, payload }) => [name, payload.agency_id]),
    [
      ['computeOutcomeMeasures', 'agency-a'],
      ['computeOutcomeMeasures', 'agency-z'],
    ],
  );
  for (const { payload } of fixture.calls.invocations) {
    assert.deepEqual(
      Object.keys(payload).sort(),
      [
        'agency_id',
        'dispatch_proof',
        'idempotency_key',
        'period_end',
        'period_start',
        'period_type',
      ],
    );
    assert.equal(payload.period_type, 'daily');
    assert.equal(payload.period_start, body.period_start);
    assert.equal(payload.period_end, body.period_end);
    assert.equal(payload.idempotency_key, `nightly-outcome-daily:${body.period_end}`);
    assert.equal(payload.dispatch_proof.version, 'outcome-dispatch-v1');
    assert.match(payload.dispatch_proof.nonce, /^[0-9a-f-]{36}$/);
    assert.equal(payload.dispatch_proof.signature, expectedProofSignature(payload));
  }
  assert.deepEqual(
    fixture.calls.agencyFilters.map(({ query }) => query),
    [
      { status: 'active' },
      { status: 'trial' },
      { id: 'agency-a' },
      { id: 'agency-z' },
    ],
  );
});

test('browser-selected scope and non-admin callers are rejected before agency reads', async () => {
  const selected = await loadHandler();
  const selectedResponse = await selected.handler(schedulerRequest({ agency_id: 'agency-a' }));
  assert.equal(selectedResponse.status, 400);
  assert.match((await selectedResponse.json()).error, /does not accept caller-selected scope/i);
  assert.deepEqual(selected.calls.agencyFilters, []);

  const unprivileged = await loadHandler({
    user: { id: 'user-1', role: 'user', is_active: true },
  });
  const denied = await unprivileged.handler(schedulerRequest());
  assert.equal(denied.status, 403);
  assert.deepEqual(unprivileged.calls.agencyFilters, []);
  assert.deepEqual(unprivileged.calls.invocations, []);
});

test('agency enumeration and exact revalidation fail closed on ambiguous scope', async () => {
  const scanRegression = await loadHandler({
    filterAgency: (query) => query.status === 'active'
      ? [{ id: 'agency-a', status: 'trial' }]
      : [],
  });
  const scanResponse = await scanRegression.handler(schedulerRequest());
  assert.equal(scanResponse.status, 409);
  assert.deepEqual(scanRegression.calls.invocations, []);

  const statusChanged = await loadHandler({
    filterAgency: (query) => {
      if (query.status === 'active') return [{ id: 'agency-a', status: 'active' }];
      if (query.status === 'trial') return [];
      if (query.id === 'agency-a') return [{ id: 'agency-a', status: 'suspended' }];
      return [];
    },
  });
  const changedResponse = await statusChanged.handler(schedulerRequest());
  const changedBody = await changedResponse.json();
  assert.equal(changedResponse.status, 502);
  assert.equal(changedBody.success, false);
  assert.equal(changedBody.agencies_discovered, 1);
  assert.equal(changedBody.agencies_succeeded, 0);
  assert.equal(changedBody.agencies_failed, 1);
  assert.deepEqual(statusChanged.calls.invocations, []);
});

test('an oversized tenant set is rejected before any worker invocation', async () => {
  const agencies = Array.from({ length: 101 }, (_, index) => ({
    id: `agency-${String(index).padStart(3, '0')}`,
    status: 'active',
  }));
  const fixture = await loadHandler({ filterAgency: agencyFilter(agencies) });
  const response = await fixture.handler(schedulerRequest());
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /safety cap/i);
  assert.deepEqual(fixture.calls.invocations, []);
});

test('partial failure is reported without leaking tenant ids and retries are bounded', async () => {
  const agencies = [
    { id: 'agency-a', status: 'active' },
    { id: 'agency-b', status: 'trial' },
  ];
  const fixture = await loadHandler({
    filterAgency: agencyFilter(agencies),
    invokeOutcome: (_name, payload) => {
      if (payload.agency_id === 'agency-a') {
        const error = new Error('upstream unavailable');
        error.response = { status: 503, data: { error: 'unavailable' } };
        throw error;
      }
      return { data: publishedResult(payload, { idempotent_replay: true }) };
    },
  });
  const response = await fixture.handler(schedulerRequest());
  const body = await response.json();
  assert.equal(response.status, 502);
  assert.equal(body.success, false);
  assert.equal(body.agencies_discovered, 2);
  assert.equal(body.agencies_succeeded, 1);
  assert.equal(body.idempotent_replays, 1);
  assert.equal(body.agencies_failed, 1);
  assert.equal(JSON.stringify(body).includes('agency-a'), false);
  assert.equal(JSON.stringify(body).includes('agency-b'), false);
  assert.deepEqual(
    fixture.calls.invocations.map(({ payload }) => payload.agency_id),
    ['agency-a', 'agency-a', 'agency-b'],
  );
});
