import assert from 'node:assert/strict';
import { readFile, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { transpileTs } from '../../tools-transpile-ts.mjs';
import JSON5 from 'json5';

const ENTRY_URL = new URL('../functions/processInboundFaxes/entry.ts', import.meta.url);

async function loadHandler(makeClient, { releaseEnabled = true } = {}) {
  let source = await readFile(ENTRY_URL, 'utf8');
  source = source.replace(
    /import\s+\{[^}]*\}\s+from\s+'npm:[^']*';?/,
    'const createClientFromRequest = globalThis.__inboundReferralFaxCreateClient;',
  );
  const target = join(
    tmpdir(),
    `inbound_referral_fax_${Date.now()}_${Math.random().toString(36).slice(2)}.mjs`,
  );
  await writeFile(target, transpileTs(source).outputText);
  let handler;
  globalThis.__inboundReferralFaxCreateClient = makeClient;
  globalThis.Deno = {
    serve: (candidate) => { handler = candidate; },
    env: {
      get: (name) => (
        releaseEnabled && name === 'WORKFLOW_RELEASE_PROCESS_INBOUND_FAXES'
          ? 'enabled-v1'
          : null
      ),
    },
  };
  try {
    await import(`${pathToFileURL(target).href}?case=${Math.random()}`);
  } finally {
    await unlink(target).catch(() => {});
    delete globalThis.__inboundReferralFaxCreateClient;
  }
  return handler;
}

const clone = (value) => structuredClone(value);

function matches(row, query = {}) {
  return Object.entries(query).every(([key, expected]) => {
    if (key === '$and') return expected.every((part) => matches(row, part));
    if (key === '$or') return expected.some((part) => matches(row, part));
    if (expected && typeof expected === 'object' && !Array.isArray(expected)) {
      return Object.entries(expected).every(([operator, value]) => {
        if (operator === '$exists') return value === Object.hasOwn(row, key);
        if (operator === '$lte') return row[key] != null && row[key] <= value;
        if (operator === '$ne') return row[key] !== value;
        throw new Error(`Unsupported test query operator ${operator}`);
      });
    }
    return expected === null ? row[key] == null : row[key] === expected;
  });
}

function makeRuntime({
  attached = false,
  foreignIncoming = false,
} = {}) {
  const now = '2026-09-06T12:00:00.000Z';
  const oldClaim = '2026-09-06T10:00:00.000Z';
  const agency = { id: 'agency-a', agency_code: 'AGENCY-A', status: 'active' };
  const binding = {
    id: 'binding-a',
    binding_key: 'telnyx:integration-a:+12155550190',
    provider: 'telnyx',
    integration_secret_id: 'integration-a',
    destination_e164: '+12155550190',
    provider_number_id: 'provider-number-a',
    phone_number_id: 'phone-number-a',
    agency_id: 'agency-a',
    messaging_profile_id: 'profile-a',
    fax_connection_id: 'fax-connection-a',
    sms_inbound_enabled: false,
    sms_outbound_enabled: false,
    voice_inbound_enabled: false,
    fax_inbound_enabled: true,
    status: 'active',
    source: 'manual',
    created_by_user_id: 'admin-a',
    created_by_user_email_normalized: 'admin@example.test',
    created_at: '2026-08-01T00:00:00.000Z',
    activated_at: '2026-08-01T00:00:00.000Z',
    last_transition_by_user_id: 'admin-a',
    last_transition_by_email_normalized: 'admin@example.test',
    last_transition_at: '2026-08-01T00:00:00.000Z',
    last_transition_reason: 'Reviewed inbound fax binding',
    last_transition_action: 'bind',
    last_transition_request_id: 'request-a',
    last_transition_request_key: 'telnyx:integration-a:+12155550190:request-a',
    version: 1,
  };
  const baseFollowUp = {
    status: attached ? 'received' : 'sent',
    generated_at: '2026-09-05T12:00:00.000Z',
    sent_via: 'fax',
    fax_log_id: 'fax-log-a',
    portal_link_active: !attached,
    items: [{
      id: 'item-a',
      title: 'Face-to-face encounter',
      needed: 'Provide the signed encounter note',
      provider_request: { question: 'Please provide the signed encounter note.' },
      item_status: attached ? 'answered' : 'open',
      response: attached ? { text: 'Attached', source: 'fax' } : null,
    }],
    ...(attached ? {
      received_at: now,
      fax_back: {
        incoming_fax_id: 'incoming-a',
        matched_signals: ['form_marker', 'patient_name', 'patient_dob'],
        auto_answered_count: 1,
      },
    } : {}),
  };
  const referral = {
    id: 'referral-a',
    agency_id: 'agency-a',
    created_by_user_id: 'user-a',
    created_by_user_email_normalized: 'intake@example.test',
    created_by: 'intake@example.test',
    client_request_id: 'create-a',
    referral_creation_key: 'agency-a:user-a:create-a',
    version: 1,
    created_date: '2026-09-01T00:00:00.000Z',
    updated_date: '2026-09-05T12:00:00.000Z',
    patient_name: 'Jane Patient',
    patient_dob: '1950-01-05',
    referral_source: 'Example Medical Group',
    patient_id: 'patient-a',
    follow_up_requests: baseFollowUp,
  };
  const incoming = {
    id: 'incoming-a',
    agency_id: foreignIncoming ? 'agency-b' : 'agency-a',
    ingress_binding_id: 'binding-a',
    ingress_binding_key: 'telnyx:integration-a:+12155550190',
    ingress_binding_version: 1,
    integration_secret_id: 'integration-a',
    received_to_number: '+12155550190',
    user_email: 'admin@example.test',
    sender_fax_number: '+13125550182',
    received_at: '2026-09-06T11:30:00.000Z',
    document_url: 'https://media.telnyx.test/incoming-a.pdf',
    telnyx_fax_id: 'provider-fax-a',
    processing_status: attached ? 'processing' : 'pending',
    processing_notification_state: 'ready',
    status: 'unread',
    claimed_by: attached ? 'interrupted-run' : null,
    claimed_at: attached ? oldClaim : null,
    ocr_attempts: 0,
    version: 1,
    created_date: '2026-09-06T11:30:00.000Z',
    updated_date: attached ? oldClaim : '2026-09-06T11:30:00.000Z',
  };
  const data = {
    Agency: [agency],
    Referral: [referral],
    IncomingFax: [incoming],
    TelecomDestinationBinding: [binding],
    IntegrationSecret: [{
      id: 'integration-a',
      provider: 'telnyx',
      is_active: true,
      fax_connection_id: 'fax-connection-a',
    }],
    FaxLog: [{
      id: 'fax-log-a',
      agency_id: 'agency-a',
      referral_id: 'referral-a',
      document_id: 'document-a',
      sent_by_user_id: 'user-a',
      sent_by_membership_id: 'membership-a',
      sent_by_membership_version: 1,
      to_number: '+13125550182',
      status: 'delivered',
    }],
    AgencyMembership: [{
      id: 'membership-a',
      agency_id: 'agency-a',
      user_id: 'user-a',
      membership_key: 'agency-a:user-a',
      user_email_normalized: 'intake@example.test',
      tenant_role: 'office_staff',
      status: 'active',
      created_by_user_id: 'admin-a',
      last_transition_by_user_id: 'admin-a',
      last_transition_by_email_normalized: 'admin@example.test',
      last_transition_at: '2026-08-01T00:00:00.000Z',
      last_transition_reason: 'Activated for referral intake',
      activated_at: '2026-08-01T00:00:00.000Z',
      version: 1,
    }],
    Notification: [],
  };
  const calls = [];
  const hooks = {};
  let tick = Date.parse('2026-09-06T12:00:00.000Z');
  const entities = new Proxy({}, {
    get: (_target, entityName) => {
      const name = String(entityName);
      return {
        filter: async (query = {}, sort, limit) => {
          calls.push({ entity: name, operation: 'filter', query: clone(query), sort, limit });
          const injected = await hooks.filter?.(name, query, sort, limit);
          if (injected !== undefined) return clone(injected);
          const rows = (data[name] || []).filter((row) => matches(row, query));
          if (foreignIncoming && name === 'IncomingFax'
            && query.agency_id === 'agency-a' && query.processing_status === 'pending') {
            return [clone(incoming)];
          }
          return clone(rows.slice(0, limit));
        },
        updateMany: async (query = {}, patch = {}) => {
          calls.push({ entity: name, operation: 'updateMany', query: clone(query), patch: clone(patch) });
          const injected = await hooks.updateMany?.(name, query, patch);
          if (injected !== undefined) return clone(injected);
          const rows = data[name] || [];
          const indexes = rows
            .map((row, index) => (matches(row, query) ? index : -1))
            .filter((index) => index >= 0);
          for (const index of indexes) {
            const next = { ...rows[index], ...(patch.$set || {}) };
            for (const [key, amount] of Object.entries(patch.$inc || {})) {
              next[key] = (Number(next[key]) || 0) + Number(amount);
            }
            tick += 1;
            next.updated_date = new Date(tick).toISOString();
            rows[index] = next;
          }
          return { success: true, updated: indexes.length, has_more: false };
        },
        create: async (row) => {
          calls.push({ entity: name, operation: 'create', row: clone(row) });
          const injected = await hooks.create?.(name, row);
          if (injected !== undefined) return clone(injected);
          tick += 1;
          const created = {
            id: `${name.toLowerCase()}-${(data[name] || []).length + 1}`,
            created_date: new Date(tick).toISOString(),
            updated_date: new Date(tick).toISOString(),
            ...clone(row),
          };
          if (!data[name]) data[name] = [];
          data[name].push(created);
          return clone(created);
        },
      };
    },
  });
  let llmCalls = 0;
  const client = {
    auth: { me: async () => ({ id: 'scheduler-admin', role: 'admin', is_active: true }) },
    asServiceRole: {
      entities,
      integrations: {
        Core: {
          InvokeLLM: async () => {
            llmCalls += 1;
            const injected = await hooks.ocr?.();
            if (injected !== undefined) return clone(injected);
            if (llmCalls === 1) {
              return {
                full_text: 'Home Health Referral Additional Information Request Jane Patient DOB 01/05/1950 signed encounter note attached',
                patient_name: 'Jane Patient',
                patient_dob: '1950-01-05',
                provider_name: 'Example Medical Group',
                summary: 'Completed provider response',
              };
            }
            return { answers: [{ id: 'item-a', answered: true, response_text: 'Signed note attached' }] };
          },
        },
      },
    },
  };
  return {
    client,
    data,
    calls,
    hooks,
    getLlmCalls: () => llmCalls,
  };
}

function request(body = { agency_id: 'agency-a' }) {
  return new Request('https://app.test/functions/processInboundFaxes', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

test('inbound fax workflow is disabled before SDK construction by default', async () => {
  let constructed = false;
  const handler = await loadHandler(() => {
    constructed = true;
    throw new Error('SDK must not be constructed');
  }, { releaseEnabled: false });
  const response = await handler(request());
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal((await response.json()).code, 'inbound_fax_workflow_disabled');
  assert.equal(constructed, false);
});

test('inbound queue is bounded oldest-first and poison rows are durably quarantined', async () => {
  const source = await readFile(ENTRY_URL, 'utf8');
  assert.doesNotMatch(source, /Inbound fax scan is incomplete/);
  assert.match(source, /loadIncomingFaxQueue\(entities, agencyId, 'pending', scanAt\)/);
  assert.match(source, /loadIncomingFaxQueue\(entities, agencyId, 'processing', scanAt\)/);
  assert.match(source, /processing_next_attempt_at: \{ \$exists: false \}/);
  assert.match(source, /processing_next_attempt_at: \{ \$lte: now, \$ne: null \}/);
  assert.match(source, /deferIncomingFax/);
  assert.match(source, /quarantineIncomingFax/);
  assert.match(source, /inbound_fax_authority_changed/);
  assert.match(source, /Inbound fax agency batch failed/);
  const schema = JSON5.parse(await readFile(
    new URL('../entities/IncomingFax.jsonc', import.meta.url),
    'utf8',
  ));
  assert.ok(schema.properties.processing_quarantined_at);
  assert.ok(schema.properties.processing_last_error_code);
  assert.ok(schema.properties.processing_next_attempt_at);
  assert.ok(schema.properties.processing_attempt_count);
});

test('heuristic inbound fax matches remain suggestions and never mutate Referral answers', async () => {
  const runtime = makeRuntime();
  const handler = await loadHandler(() => runtime.client);
  const response = await handler(request());
  assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), {
    success: true,
    agency_id: 'agency-a',
    agencies_processed: 1,
    scanned: 1,
    processed: 1,
    matched: 0,
    suggested: 1,
    failed: 0,
  });
  assert.equal(runtime.getLlmCalls(), 1);
  const followUp = runtime.data.Referral[0].follow_up_requests;
  assert.equal(followUp.status, 'sent');
  assert.equal(followUp.portal_link_active, true);
  assert.equal(followUp.fax_back, undefined);
  assert.equal(followUp.items[0].item_status, 'open');
  assert.equal(followUp.items[0].response, null);
  assert.equal(
    runtime.calls.some((call) => call.entity === 'Referral' && call.operation === 'updateMany'),
    false,
  );
  assert.equal(runtime.data.IncomingFax[0].processing_status, 'completed');
  assert.equal(runtime.data.IncomingFax[0].status, 'unread');
  assert.equal(runtime.data.IncomingFax[0].suggested_referral_id, 'referral-a');
  assert.equal(runtime.data.Notification.length, 1);
  assert.equal(runtime.data.Notification[0].agency_id, 'agency-a');
  assert.match(runtime.data.Notification[0].dedupe_key, /^referral-fax-suggested:agency-a:/);
  assert.doesNotMatch(runtime.data.Notification[0].message, /Jane|1950|Patient/);
  for (const call of runtime.calls.filter((item) => (
    item.operation === 'filter' && ['Referral', 'IncomingFax', 'FaxLog'].includes(item.entity)
  ))) {
    if (call.entity === 'IncomingFax' && call.query.telnyx_fax_id) continue; // global provider-id collision check
    assert.equal(call.query.agency_id, 'agency-a', `${call.entity} read remains tenant scoped`);
  }
});

test('interrupted attachment is reconciled once without re-mutating the Referral', async () => {
  const runtime = makeRuntime({ attached: true });
  const handler = await loadHandler(() => runtime.client);
  const response = await handler(request());
  assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
  const body = await response.json();
  assert.equal(body.matched, 1);
  assert.equal(body.failed, 0);
  assert.equal(runtime.getLlmCalls(), 1);
  assert.equal(
    runtime.calls.some((call) => call.entity === 'Referral' && call.operation === 'updateMany'),
    false,
  );
  assert.equal(runtime.data.IncomingFax[0].processing_status, 'completed');
  assert.equal(runtime.data.IncomingFax[0].status, 'routed');
  assert.equal(runtime.data.Notification.length, 1);
});

test('false-success foreign IncomingFax rows fail before OCR or protected writes', async () => {
  const runtime = makeRuntime({ foreignIncoming: true });
  const handler = await loadHandler(() => runtime.client);
  const response = await handler(request());
  assert.equal(response.status, 409);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(runtime.getLlmCalls(), 0);
  assert.equal(runtime.calls.some((call) => call.operation === 'updateMany'), false);
  assert.equal(runtime.calls.some((call) => call.operation === 'create'), false);
});

test('ambiguous integration authority and corrupt binding lifecycle quarantine one row before OCR', async () => {
  const scenarios = [
    (runtime) => runtime.data.IntegrationSecret.push({
      id: 'integration-b',
      provider: 'telnyx',
      is_active: true,
      fax_connection_id: 'fax-connection-b',
    }),
    (runtime) => {
      runtime.data.TelecomDestinationBinding[0].last_transition_action = 'activate';
    },
  ];
  for (const arrange of scenarios) {
    const runtime = makeRuntime();
    arrange(runtime);
    const handler = await loadHandler(() => runtime.client);
    const response = await handler(request());
    assert.equal(response.status, 500);
    assert.equal(runtime.getLlmCalls(), 0);
    const quarantine = runtime.calls.find((call) => (
      call.entity === 'IncomingFax'
      && call.operation === 'updateMany'
      && call.patch?.$set?.processing_last_error_code === 'invalid_inbound_fax_authority'
    ));
    assert.ok(quarantine);
    assert.equal(runtime.data.IncomingFax[0].processing_status, 'failed');
    assert.equal(runtime.calls.some((call) => call.operation === 'create'), false);
  }
});

test('heuristic processing never invokes a second LLM answer-extraction boundary', async () => {
  const runtime = makeRuntime();
  const handler = await loadHandler(() => runtime.client);
  const response = await handler(request());
  assert.equal(response.status, 200);
  assert.equal(runtime.getLlmCalls(), 1);
  assert.equal(runtime.data.Referral[0].follow_up_requests.status, 'sent');
  assert.equal(runtime.data.Notification.length, 1);
  assert.equal(
    runtime.calls.some((call) => call.entity === 'Referral' && call.operation === 'updateMany'),
    false,
  );
  assert.equal(runtime.data.IncomingFax[0].processing_status, 'completed');
  assert.equal(runtime.data.IncomingFax[0].claimed_by, null);
});

test('legacy same-tenant rows stay quarantined without poisoning newer fax work', async () => {
  const runtime = makeRuntime();
  runtime.data.Referral.unshift({
    id: 'legacy-referral',
    agency_id: 'agency-a',
    created_date: '2026-08-01T00:00:00.000Z',
    updated_date: '2026-08-01T00:00:00.000Z',
    follow_up_requests: { status: 'sent', sent_via: 'fax', items: [] },
  });
  runtime.data.IncomingFax.unshift({
    id: 'legacy-incoming',
    agency_id: 'agency-a',
    received_at: '2026-08-01T00:00:00.000Z',
    created_date: '2026-08-01T00:00:00.000Z',
    updated_date: '2026-08-01T00:00:00.000Z',
    processing_status: 'pending',
    status: 'unread',
    version: 1,
  });
  const handler = await loadHandler(() => runtime.client);
  const response = await handler(request());
  assert.equal(response.status, 500, JSON.stringify(await response.clone().json()));
  assert.deepEqual(await response.json(), {
    success: false,
    agency_id: 'agency-a',
    agencies_processed: 1,
    scanned: 2,
    processed: 1,
    matched: 0,
    suggested: 1,
    failed: 1,
    error: 'One or more inbound faxes could not be processed safely',
  });
  assert.equal(runtime.getLlmCalls(), 1);
  assert.equal(runtime.data.IncomingFax[0].processing_status, 'failed');
  assert.equal(runtime.data.IncomingFax[0].processing_last_error_code, 'invalid_inbound_fax_provenance');
  assert.equal(runtime.data.IncomingFax[1].processing_status, 'completed');
  assert.equal(runtime.data.Referral[0].follow_up_requests.status, 'sent');
  assert.equal(runtime.data.Referral[1].follow_up_requests.status, 'sent');
});


test('hosted null and missing queue fields both receive processing', async () => {
  for (const fields of [{}, { processing_quarantined_at: null, processing_next_attempt_at: null }]) {
    const runtime = makeRuntime();
    Object.assign(runtime.data.IncomingFax[0], fields);
    const handler = await loadHandler(() => runtime.client);
    const response = await handler(request());
    assert.equal(response.status, 200);
    assert.equal((await response.json()).processed, 1);
  }
});

test('future retries and quarantined rows never enter OCR', async () => {
  for (const fields of [
    { processing_next_attempt_at: new Date(Date.now() + 60_000).toISOString() },
    { processing_quarantined_at: new Date().toISOString() },
  ]) {
    const runtime = makeRuntime();
    Object.assign(runtime.data.IncomingFax[0], fields);
    const handler = await loadHandler(() => runtime.client);
    assert.equal((await handler(request())).status, 200);
    assert.equal(runtime.getLlmCalls(), 0);
  }
});

test('missing or inactive recipients finish the document once without publishing an alert', async () => {
  for (const state of ['missing', 'suspended', 'revoked']) {
    const runtime = makeRuntime();
    if (state === 'missing') runtime.data.AgencyMembership = [];
    else Object.assign(runtime.data.AgencyMembership[0], { status: state, ...(state === 'revoked' ? { revoked_at: new Date().toISOString(), revocation_reason: 'Test revocation' } : {}) });
    const handler = await loadHandler(() => runtime.client);
    assert.equal((await handler(request())).status, 200, state);
    assert.equal(runtime.data.IncomingFax[0].processing_status, 'completed');
    assert.equal(runtime.data.IncomingFax[0].processing_notification_state, 'skipped_no_recipient');
    assert.equal(runtime.data.IncomingFax[0].processing_next_attempt_at, null);
    assert.equal(runtime.data.Notification.length, 0);
    assert.equal((await handler(request())).status, 200);
    assert.equal(runtime.getLlmCalls(), 1, 'replay never repeats billable OCR');
  }
});

test('uncertain notification creates reconcile once without repeating OCR or publishing again', async () => {
  const runtime = makeRuntime();
  let pending;
  runtime.hooks.create = async (name, row) => {
    if (name === 'Notification') {
      pending = { ...clone(row), id: 'late-notification' };
      throw new Error('Create timed out after acceptance');
    }
  };
  const handler = await loadHandler(() => runtime.client);
  assert.equal((await handler(request())).status, 500);
  assert.equal(runtime.data.IncomingFax[0].processing_notification_state, 'started');
  assert.equal(runtime.data.IncomingFax[0].processing_status, 'pending');
  runtime.data.IncomingFax[0].processing_next_attempt_at = null;
  assert.equal((await handler(request())).status, 500);
  assert.equal(runtime.getLlmCalls(), 1);
  assert.equal(runtime.calls.filter((call) => call.entity === 'Notification' && call.operation === 'create').length, 1);
  runtime.data.Notification.push(pending);
  runtime.data.IncomingFax[0].processing_next_attempt_at = null;
  assert.equal((await handler(request())).status, 200);
  assert.equal(runtime.data.IncomingFax[0].processing_status, 'completed');
  assert.equal(runtime.data.Notification.length, 1);
  assert.equal(runtime.getLlmCalls(), 1);
});

test('legacy absence cannot authorize another notification create', async () => {
  const runtime = makeRuntime();
  delete runtime.data.IncomingFax[0].processing_notification_state;
  const handler = await loadHandler(() => runtime.client);
  assert.equal((await handler(request())).status, 500);
  assert.equal(runtime.data.Notification.length, 0);
  assert.notEqual(runtime.data.IncomingFax[0].processing_status, 'completed');
});

test('overlapping workers publish only once', async () => {
  const runtime = makeRuntime();
  const handler = await loadHandler(() => runtime.client);
  const responses = await Promise.all([handler(request()), handler(request())]);
  assert.ok(responses.every((response) => response.status === 200));
  assert.equal(runtime.getLlmCalls(), 1);
  assert.equal(runtime.data.Notification.length, 1);
});

test('failed and incomplete claim acknowledgements are not successful skips', async () => {
  for (const result of [null, { updated: 1 }, { success: false, updated: 0, has_more: false }, { success: true, updated: 1, has_more: true }]) {
    const runtime = makeRuntime();
    runtime.hooks.updateMany = async (_name, _query, patch) => (
      patch.$set?.processing_status === 'processing' ? result : undefined
    );
    const handler = await loadHandler(() => runtime.client);
    assert.equal((await handler(request())).status, 500);
    assert.equal(runtime.getLlmCalls(), 0);
  }
});

test('duplicate provider fax identities fail before OCR and notification', async () => {
  const runtime = makeRuntime();
  runtime.data.IncomingFax.push({ ...clone(runtime.data.IncomingFax[0]), id: 'incoming-duplicate' });
  const handler = await loadHandler(() => runtime.client);
  assert.equal((await handler(request())).status, 500);
  assert.equal(runtime.getLlmCalls(), 0);
  assert.equal(runtime.data.Notification.length, 0);
});

test('empty OCR results defer without declaring the fax processed', async () => {
  const runtime = makeRuntime();
  runtime.hooks.ocr = async () => ({ full_text: '' });
  const handler = await loadHandler(() => runtime.client);
  assert.equal((await handler(request())).status, 500);
  assert.equal(runtime.data.IncomingFax[0].processing_status, 'pending');
  assert.equal(runtime.data.IncomingFax[0].ocr_attempts, 1);
});


test('started inbound publication reconciles its original recipient after membership revocation or revision', async () => {
  for (const revoked of [false, true]) {
    const runtime = makeRuntime();
    let committed;
    runtime.hooks.create = async (name, row) => {
      if (name === 'Notification') { committed = { ...clone(row), id: 'late-notice' }; throw new Error('Lost response'); }
    };
    const handler = await loadHandler(() => runtime.client);
    assert.equal((await handler(request())).status, 500);
    Object.assign(runtime.data.AgencyMembership[0], { version: 2, ...(revoked ? {
      status: 'revoked', revoked_at: new Date().toISOString(), revocation_reason: 'Test revocation',
    } : {}) });
    runtime.data.Notification.push(committed);
    runtime.data.IncomingFax[0].processing_next_attempt_at = null;
    assert.equal((await handler(request())).status, 200);
    assert.equal(runtime.data.IncomingFax[0].processing_status, 'completed');
    assert.equal(runtime.data.Notification.length, 1);
    assert.equal(runtime.getLlmCalls(), 1);
    assert.equal(runtime.calls.filter(call => call.entity === 'Notification' && call.operation === 'create').length, 1);
  }
});

test('persisted completion cannot overwrite tenant, notification, or processing authority', async () => {
  for (const corrupt of [{ agency_id: 'agency-b' }, { processing_status: 'pending' },
    { claimed_by: 'other-claim' }, { processing_notification_state: 'ready' }, { telnyx_fax_id: 'other-provider' }]) {
    const runtime = makeRuntime();
    let committed;
    runtime.hooks.create = async (name, row) => {
      if (name === 'Notification') { committed = { ...clone(row), id: 'late-notice' }; throw new Error('Lost response'); }
    };
    const handler = await loadHandler(() => runtime.client);
    assert.equal((await handler(request())).status, 500);
    runtime.data.Notification.push(committed);
    Object.assign(runtime.data.IncomingFax[0].processing_completion, corrupt);
    runtime.data.IncomingFax[0].processing_next_attempt_at = null;
    assert.equal((await handler(request())).status, 500);
    assert.equal(runtime.data.IncomingFax[0].agency_id, 'agency-a');
    assert.equal(runtime.data.IncomingFax[0].telnyx_fax_id, 'provider-fax-a');
    assert.equal(runtime.data.IncomingFax[0].processing_notification_state, 'started');
    assert.notEqual(runtime.data.IncomingFax[0].processing_status, 'completed');
    assert.equal(runtime.getLlmCalls(), 1);
    assert.equal(runtime.data.Notification.length, 1);
  }
});


test('hosted null archive fields do not hide a current referral from fax matching', async () => {
  const runtime = makeRuntime();
  runtime.data.Referral[0].archived_at = null;
  const handler = await loadHandler(() => runtime.client);
  const response = await handler(request());
  assert.equal(response.status, 200);
  assert.equal((await response.json()).suggested, 1);
  assert.equal(runtime.data.Notification.length, 1);
});


test('current hosted creator ids authorize referral matching while conflicting provenance fails closed', async () => {
  for (const creator of ['user-a', 'foreign-user', null]) {
    const runtime = makeRuntime();
    delete runtime.data.Referral[0].created_by;
    runtime.data.Referral[0].created_by_id = creator;
    runtime.data.Referral[0].archived_at = null;
    const handler = await loadHandler(() => runtime.client);
    const response = await handler(request());
    assert.equal(response.status, 200);
    assert.equal((await response.json()).suggested, creator === 'user-a' ? 1 : 0);
    assert.equal(runtime.data.Notification.length, creator === 'user-a' ? 1 : 0);
  }
});
