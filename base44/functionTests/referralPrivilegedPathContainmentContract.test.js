import assert from 'node:assert/strict';
import { readFile, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { transpileTs } from '../../tools-transpile-ts.mjs';

test('inbound Referral fax worker is tenant-bound and conditionally mutates protected rows', async () => {
  const source = await readFile(
    new URL('../functions/processInboundFaxes/entry.ts', import.meta.url),
    'utf8',
  );
  assert.doesNotMatch(source, /\bReferral\.list\s*\(/);
  assert.doesNotMatch(source, /\bReferral\.update\s*\(/);
  assert.doesNotMatch(source, /fax_back\s*:\s*\{[\s\S]{0,300}document_url/);
  assert.match(source, /Referral\.filter\([\s\S]{0,180}agency_id:\s*agencyId/);
  assert.match(source, /IncomingFax\.filter\([\s\S]{0,180}agency_id:\s*agencyId/);
  assert.match(source, /TelecomDestinationBinding\.filter/);
  assert.match(source, /IncomingFax\.updateMany/);
  assert.match(source, /Referral\.updateMany/);
  assert.match(source, /dedupe_key:\s*dedupeKey/);
  assert.match(source, /claimed_by:\s*runId/);
});

async function loadStaleFollowUpHandler(makeClient, env = new Map()) {
  let source = await readFile(
    new URL('../functions/checkStaleFollowUpRequests/entry.ts', import.meta.url),
    'utf8',
  );
  source = source.replace(
    /import\s+\{[^}]*\}\s+from\s+'npm:[^']*';?/,
    'const createClientFromRequest = globalThis.__staleFollowUpCreateClient;',
  );
  const target = join(
    tmpdir(),
    `referral_stale_follow_up_${Date.now()}_${Math.random().toString(36).slice(2)}.mjs`,
  );
  await writeFile(target, transpileTs(source).outputText);
  let handler;
  globalThis.__staleFollowUpCreateClient = makeClient;
  globalThis.Deno = {
    serve: (candidate) => { handler = candidate; },
    env: { get: (name) => env.get(name) },
  };
  try {
    await import(`${pathToFileURL(target).href}?case=${Math.random()}`);
  } finally {
    await unlink(target).catch(() => {});
    delete globalThis.__staleFollowUpCreateClient;
  }
  return handler;
}

function createStaleFollowUpRuntime({ referralOverrides = {}, agencyOverrides = {} } = {}) {
  const clone = (value) => structuredClone(value);
  const agency = {
    id: 'agency-a',
    status: 'active',
    ...agencyOverrides,
  };
  const membership = {
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
  };
  const referral = {
    id: 'referral-a',
    agency_id: 'agency-a',
    created_by_user_id: 'user-a',
    created_by_user_email_normalized: 'intake@example.test',
    created_by: 'intake@example.test',
    client_request_id: 'request-a',
    referral_creation_key: 'agency-a:user-a:request-a',
    version: 1,
    created_date: '2026-08-01T00:00:00.000Z',
    updated_date: '2026-08-01T00:00:00.000Z',
    follow_up_requests: {
      status: 'sent',
      generated_at: '2026-08-01T00:00:00.000Z',
      items: [{ item_id: 'item-a', item_status: 'open' }],
    },
    ...referralOverrides,
  };
  const state = {
    agency,
    membership,
    referrals: [referral],
    notifications: [],
    filters: [],
    updates: [],
    creates: [],
    updateClock: Date.parse('2026-08-01T00:01:00.000Z'),
  };

  const matches = (row, query) => Object.entries(query || {}).every(([key, expected]) => {
    if (expected && typeof expected === 'object' && !Array.isArray(expected)) {
      if ('$exists' in expected) return (row[key] !== undefined) === expected.$exists;
    }
    return row[key] === expected;
  });
  const filterRows = (entity, rows, query) => {
    state.filters.push({ entity, query: clone(query) });
    return clone(rows.filter((row) => matches(row, query)));
  };
  const client = {
    auth: { me: async () => null },
    asServiceRole: {
      entities: {
        Agency: {
          filter: async (query) => filterRows('Agency', [state.agency], query),
        },
        AgencyMembership: {
          filter: async (query) => filterRows(
            'AgencyMembership',
            [state.membership],
            query,
          ),
        },
        Referral: {
          filter: async (query) => filterRows('Referral', state.referrals, query),
          updateMany: async (query, operations) => {
            state.updates.push({ query: clone(query), operations: clone(operations) });
            let updated = 0;
            for (const row of state.referrals) {
              if (!matches(row, query)) continue;
              if (operations.$set) Object.assign(row, clone(operations.$set));
              if (operations.$inc) {
                for (const [key, increment] of Object.entries(operations.$inc)) {
                  row[key] = Number(row[key] || 0) + increment;
                }
              }
              state.updateClock += 1000;
              row.updated_date = new Date(state.updateClock).toISOString();
              updated += 1;
            }
            return { success: true, updated, has_more: false };
          },
        },
        Notification: {
          filter: async (query) => filterRows('Notification', state.notifications, query),
          create: async (payload) => {
            state.creates.push(clone(payload));
            const created = {
              id: `notification-${state.notifications.length + 1}`,
              created_date: new Date().toISOString(),
              ...clone(payload),
            };
            state.notifications.push(created);
            return clone(created);
          },
        },
      },
    },
  };
  return { client, state };
}

function staleFollowUpRequest(body = { agency_id: 'agency-a', stale_days: 4 }) {
  return new Request('http://local/checkStaleFollowUpRequests', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-internal-secret': 'test-scheduler-secret',
    },
    body: JSON.stringify(body),
  });
}

test('stale follow-up worker is tenant-bound, conditional, and duplicate-safe', async () => {
  const runtime = createStaleFollowUpRuntime();
  const handler = await loadStaleFollowUpHandler(
    () => runtime.client,
    new Map([['INTERNAL_FN_SECRET', 'test-scheduler-secret']]),
  );

  const firstResponse = await handler(staleFollowUpRequest());
  assert.equal(firstResponse.status, 200);
  assert.equal(firstResponse.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await firstResponse.json(), {
    success: true,
    agency_id: 'agency-a',
    agencies_processed: 1,
    stale_days: 4,
    scanned: 1,
    escalated: 1,
    skipped_without_active_recipient: 0,
    failed: 0,
  });
  assert.equal(runtime.state.creates.length, 1);
  assert.equal(runtime.state.creates[0].agency_id, 'agency-a');
  assert.equal(runtime.state.creates[0].user_email, 'intake@example.test');
  assert.match(runtime.state.creates[0].dedupe_key, /^referral-stale:agency-a:referral-a:/);
  assert.doesNotMatch(runtime.state.creates[0].message, /patient|intake@example\.test/i);
  assert.equal(runtime.state.updates.length, 2);
  assert.deepEqual(runtime.state.updates[0].query, {
    id: 'referral-a',
    agency_id: 'agency-a',
    version: 1,
    updated_date: '2026-08-01T00:00:00.000Z',
  });
  assert.deepEqual(runtime.state.updates[0].operations.$inc, { version: 1 });
  assert.equal(runtime.state.referrals[0].version, 3);
  assert.equal(
    runtime.state.referrals[0].follow_up_requests.stale_notification_claimed_by,
    undefined,
  );
  assert.equal(
    typeof runtime.state.referrals[0].follow_up_requests.stale_notified_at,
    'string',
  );
  assert.ok(runtime.state.filters.some(({ entity, query }) => (
    entity === 'Notification'
    && query.agency_id === 'agency-a'
    && query.user_email === 'intake@example.test'
  )));

  const secondResponse = await handler(staleFollowUpRequest());
  assert.equal(secondResponse.status, 200);
  assert.equal((await secondResponse.json()).escalated, 0);
  assert.equal(runtime.state.creates.length, 1);
  assert.equal(runtime.state.updates.length, 2);
});

test('stale follow-up worker supports the migrated empty-args scheduler contract', async () => {
  const runtime = createStaleFollowUpRuntime();
  const handler = await loadStaleFollowUpHandler(
    () => runtime.client,
    new Map([['INTERNAL_FN_SECRET', 'test-scheduler-secret']]),
  );
  const response = await handler(staleFollowUpRequest({ stale_days: 4 }));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const body = await response.json();
  assert.equal(body.agency_id, null);
  assert.equal(body.agencies_processed, 1);
  assert.equal(body.escalated, 1);
  assert.ok(runtime.state.filters.some(({ entity, query }) => (
    entity === 'Agency' && query.status === 'active'
  )));
  assert.ok(runtime.state.filters.some(({ entity, query }) => (
    entity === 'Agency' && query.status === 'trial'
  )));
  assert.equal(runtime.state.creates.length, 1);
});

test('unscoped stale scheduler work is rejected before entity access without scheduler authority', async () => {
  const runtime = createStaleFollowUpRuntime();
  const handler = await loadStaleFollowUpHandler(() => runtime.client);
  const request = new Request('http://local/checkStaleFollowUpRequests', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({}),
  });
  const response = await handler(request);
  assert.equal(response.status, 500);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.match((await response.json()).error, /INTERNAL_FN_SECRET/);
  assert.equal(runtime.state.filters.length, 0);
  assert.equal(runtime.state.updates.length, 0);
  assert.equal(runtime.state.creates.length, 0);
});

test('stale follow-up worker rejects false-success Referral tenant drift', async () => {
  const runtime = createStaleFollowUpRuntime({
    referralOverrides: { agency_id: 'agency-b' },
  });
  const handler = await loadStaleFollowUpHandler(
    () => runtime.client,
    new Map([['INTERNAL_FN_SECRET', 'test-scheduler-secret']]),
  );
  const originalFilter = runtime.client.asServiceRole.entities.Referral.filter;
  runtime.client.asServiceRole.entities.Referral.filter = async (query, ...rest) => {
    if (query.agency_id === 'agency-a' && !query.id) {
      runtime.state.filters.push({ entity: 'Referral', query: structuredClone(query) });
      return structuredClone(runtime.state.referrals);
    }
    return originalFilter(query, ...rest);
  };
  const response = await handler(staleFollowUpRequest());
  assert.equal(response.status, 409);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), { error: 'Referral scan scope could not be verified' });
  assert.equal(runtime.state.updates.length, 0);
  assert.equal(runtime.state.creates.length, 0);
});

async function loadSmartNoteHandler(makeClient) {
  let source = await readFile(
    new URL('../functions/extractReferralDataForSmartNote/entry.ts', import.meta.url),
    'utf8',
  );
  source = source.replace(
    /import\s+\{[^}]*\}\s+from\s+'npm:[^']*';?/,
    'const createClientFromRequest = globalThis.__smartNoteReferralCreateClient;',
  );
  const target = join(
    tmpdir(),
    `referral_smart_note_${Date.now()}_${Math.random().toString(36).slice(2)}.mjs`,
  );
  await writeFile(target, transpileTs(source).outputText);
  let handler;
  globalThis.__smartNoteReferralCreateClient = makeClient;
  globalThis.Deno = { serve: (candidate) => { handler = candidate; } };
  try {
    await import(`${pathToFileURL(target).href}?case=${Math.random()}`);
  } finally {
    await unlink(target).catch(() => {});
    delete globalThis.__smartNoteReferralCreateClient;
  }
  return handler;
}

const authorizedReferralEnvelope = (overrides = {}) => ({
  success: true,
  action: 'get',
  referral: {
    id: 'referral-a',
    agency_id: 'agency-a',
    version: 4,
    created_date: '2026-09-06T12:00:00.000Z',
    updated_date: '2026-09-06T12:01:00.000Z',
    patient_id: 'patient-a',
    extracted_data: {
      demographics: {
        full_name: 'Fictional Patient',
        date_of_birth: '1950-01-01',
        phone: '555-0100',
      },
      diagnoses: {
        primary_diagnosis: 'Test diagnosis',
        primary_icd10: 'Z00.00',
        allergies: 'NKDA',
      },
      admission_details: { admission_date: '2026-09-07', referral_reason: 'Test admission' },
      skilled_needs: { services_ordered: ['Skilled nursing'] },
    },
    ...overrides,
  },
  scope: {
    agency_id: 'agency-a',
    membership_id: 'membership-a',
    membership_version: 3,
    tenant_role: 'office_staff',
  },
});

test('Smart Note referral bridge delegates disclosure to the tenant broker', async () => {
  const calls = [];
  const handler = await loadSmartNoteHandler(() => ({
    functions: {
      invoke: async (...args) => {
        calls.push(args);
        return { data: authorizedReferralEnvelope() };
      },
    },
  }));
  const response = await handler(new Request('http://local/extractReferralDataForSmartNote', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ agency_id: 'agency-a', referral_id: 'referral-a' }),
  }));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const body = await response.json();
  assert.equal(body.success, true);
  assert.equal(body.smartNoteData.patient_id, 'patient-a');
  assert.equal(body.smartNoteData.diagnosis, 'Test diagnosis');
  assert.deepEqual(calls, [[
    'manageAuthorizedReferral',
    { action: 'get', agency_id: 'agency-a', referral_id: 'referral-a' },
  ]]);

  const source = await readFile(
    new URL('../functions/extractReferralDataForSmartNote/entry.ts', import.meta.url),
    'utf8',
  );
  assert.doesNotMatch(source, /(?:asServiceRole\.)?entities\.Referral/);
  assert.match(source, /functions\.invoke\('manageAuthorizedReferral'/);
});

test('Smart Note referral bridge rejects false-success tenant and identity drift', async () => {
  for (const envelope of [
    authorizedReferralEnvelope({ id: 'referral-b' }),
    authorizedReferralEnvelope({ agency_id: 'agency-b' }),
    authorizedReferralEnvelope({ version: null }),
  ]) {
    const handler = await loadSmartNoteHandler(() => ({
      functions: { invoke: async () => ({ data: envelope }) },
    }));
    const response = await handler(new Request('http://local/extractReferralDataForSmartNote', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ agency_id: 'agency-a', referral_id: 'referral-a' }),
    }));
    assert.equal(response.status, 502);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  }
});
