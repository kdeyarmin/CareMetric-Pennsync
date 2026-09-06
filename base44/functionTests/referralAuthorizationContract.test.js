import assert from 'node:assert/strict';
import { readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import JSON5 from 'json5';
import { transpileTs } from '../../tools-transpile-ts.mjs';

const brokerUrl = new URL('../functions/manageAuthorizedReferral/entry.ts', import.meta.url);
const entityUrl = new URL('../entities/Referral.jsonc', import.meta.url);
const wrapperUrl = new URL('../../src/functions/manageAuthorizedReferral.js', import.meta.url);

async function browserSourceFiles(directoryUrl) {
  const files = [];
  for (const entry of await readdir(directoryUrl, { withFileTypes: true })) {
    const child = new URL(entry.isDirectory() ? `${entry.name}/` : entry.name, directoryUrl);
    if (entry.isDirectory()) files.push(...await browserSourceFiles(child));
    else if (/\.(?:js|jsx|ts|tsx)$/.test(entry.name) && !/\.(?:test|spec)\./.test(entry.name)) {
      files.push(child);
    }
  }
  return files;
}

const USER = {
  id: 'office-1',
  email: 'Office@Agency.test',
  role: 'user',
  is_active: true,
  is_verified: true,
};
const T1 = '2026-09-06T12:00:00.000Z';
const T2 = '2026-09-06T12:01:00.000Z';

const agency = (overrides = {}) => ({ id: 'agency-a', status: 'active', ...overrides });
const membership = (overrides = {}) => ({
  id: 'membership-office',
  membership_key: 'agency-a:office-1',
  agency_id: 'agency-a',
  user_id: 'office-1',
  user_email_normalized: 'office@agency.test',
  tenant_role: 'office_staff',
  status: 'active',
  created_by_user_id: 'owner-1',
  activated_at: T1,
  last_transition_by_user_id: 'owner-1',
  last_transition_by_email_normalized: 'owner@platform.test',
  last_transition_at: T1,
  last_transition_reason: 'Approved intake membership',
  version: 3,
  ...overrides,
});
const patient = (overrides = {}) => ({
  id: 'patient-a',
  agency_id: 'agency-a',
  is_sample: false,
  is_archived: false,
  status: 'active',
  ...overrides,
});
const referral = (overrides = {}) => ({
  id: 'referral-a',
  agency_id: 'agency-a',
  created_by_user_id: 'office-1',
  created_by_user_email_normalized: 'office@agency.test',
  created_by: 'office@agency.test',
  client_request_id: 'request-a',
  referral_creation_key: 'agency-a:office-1:request-a',
  version: 1,
  created_date: T1,
  updated_date: T1,
  patient_name: 'Fictional Patient',
  referral_source: 'Test Hospital',
  referral_date: '2026-09-06',
  document_type: 'manual',
  priority: 'normal',
  status: 'new',
  ...overrides,
});

async function loadHandler({
  caller = USER,
  agencies = [agency()],
  memberships = [membership()],
  patients = [patient()],
  referrals = [],
  ignoreFilters = false,
  updateNoop = false,
  createTransform = (row) => row,
  authorityResponses = null,
} = {}) {
  let source = await readFile(brokerUrl, 'utf8');
  source = source.replace(
    /import\s+\{\s*createClientFromRequest\s*\}\s+from\s+'npm:[^']+';/,
    'const createClientFromRequest = globalThis.__referralBrokerMakeClient;',
  );
  source = source.replace(
    /const now = new Date\(\)\.toISOString\(\);/,
    `const now = '${T2}';`,
  );
  const temporaryModule = join(
    tmpdir(),
    `referral_authority_${Date.now()}_${Math.random().toString(36).slice(2)}.mjs`,
  );
  await writeFile(temporaryModule, transpileTs(source).outputText);

  const state = {
    agencies: agencies.map((row) => ({ ...row })),
    memberships: memberships.map((row) => ({ ...row })),
    patients: patients.map((row) => ({ ...row })),
    referrals: referrals.map((row) => ({ ...row })),
  };
  const calls = { auth: 0, filters: [], creates: [], updateMany: [], deletes: [] };
  let authIndex = 0;
  const matches = (row, query) => Object.entries(query || {}).every(
    ([key, value]) => row?.[key] === value,
  );
  const filtered = (entity, rows, query, limit) => {
    calls.filters.push({ entity, query: structuredClone(query || {}), limit });
    const selected = ignoreFilters ? rows : rows.filter((row) => matches(row, query));
    return Number.isFinite(limit) ? selected.slice(0, limit) : selected;
  };
  const client = {
    auth: {
      me: async () => {
        calls.auth += 1;
        const selected = authorityResponses
          ? authorityResponses[Math.min(authIndex++, authorityResponses.length - 1)]
          : caller;
        if (selected instanceof Error) throw selected;
        return selected;
      },
    },
    asServiceRole: {
      entities: {
        Agency: {
          filter: async (query, sort, limit) => filtered('Agency', state.agencies, query, limit),
        },
        AgencyMembership: {
          filter: async (query, sort, limit) => (
            filtered('AgencyMembership', state.memberships, query, limit)
          ),
        },
        Patient: {
          filter: async (query, sort, limit) => filtered('Patient', state.patients, query, limit),
        },
        Referral: {
          filter: async (query, sort, limit) => filtered('Referral', state.referrals, query, limit),
          create: async (payload) => {
            calls.creates.push(structuredClone(payload));
            const row = {
              id: `referral-${state.referrals.length + 1}`,
              created_date: T1,
              updated_date: T1,
              ...payload,
            };
            const stored = createTransform(row);
            state.referrals.push(stored);
            return stored;
          },
          updateMany: async (query, operations) => {
            calls.updateMany.push({
              query: structuredClone(query),
              operations: structuredClone(operations),
            });
            const indexes = state.referrals
              .map((row, index) => ({ row, index }))
              .filter(({ row }) => matches(row, query))
              .map(({ index }) => index);
            if (!updateNoop) {
              for (const index of indexes) {
                const row = state.referrals[index];
                state.referrals[index] = {
                  ...row,
                  ...(operations.$set || {}),
                  ...Object.fromEntries(Object.entries(operations.$inc || {}).map(
                    ([key, value]) => [key, Number(row[key]) + Number(value)],
                  )),
                  updated_date: T2,
                };
              }
            }
            return { success: true, updated: updateNoop ? 0 : indexes.length, has_more: false };
          },
          delete: async (id) => {
            calls.deletes.push(id);
            state.referrals = state.referrals.filter((row) => row.id !== id);
            return { success: true };
          },
        },
      },
    },
  };

  let handler;
  globalThis.__referralBrokerMakeClient = () => client;
  globalThis.Deno = { serve: (candidate) => { handler = candidate; } };
  try {
    await import(pathToFileURL(temporaryModule).href);
  } finally {
    await unlink(temporaryModule).catch(() => {});
    delete globalThis.__referralBrokerMakeClient;
  }
  assert.equal(typeof handler, 'function');
  return { handler, calls, state };
}

async function invoke(handler, body, { method = 'POST', invalidJson = false } = {}) {
  const response = await handler(new Request('http://local/manageAuthorizedReferral', {
    method,
    headers: { 'content-type': 'application/json' },
    ...(method === 'GET' ? {} : { body: invalidJson ? '{' : JSON.stringify(body) }),
  }));
  return { response, json: await response.json() };
}

test('Referral is immutable-tenant broker-owned and the browser wrapper invokes only that broker', async () => {
  const schema = JSON5.parse(await readFile(entityUrl, 'utf8'));
  for (const field of [
    'agency_id', 'created_by_user_id', 'created_by_user_email_normalized',
    'client_request_id', 'referral_creation_key', 'version',
  ]) assert.ok(schema.properties[field], field);
  assert.deepEqual(schema.rls, { read: false, create: false, update: false, delete: false });

  const wrapper = await readFile(wrapperUrl, 'utf8');
  assert.match(wrapper, /functions\.invoke\('manageAuthorizedReferral', payload\)/);
  assert.doesNotMatch(wrapper, /entities\.Referral/);

  const broker = await readFile(brokerUrl, 'utf8');
  assert.match(broker, /AgencyMembership\.filter\(/);
  assert.match(broker, /Referral\.updateMany\(/);
  assert.doesNotMatch(broker, /Referral\.update\(/);
  assert.match(broker, /console\.error\('manageAuthorizedReferral failed'\)/);
  assert.doesNotMatch(
    broker,
    /console\.error\([^)]*,\s*(?:error|body|input|referral)/i,
  );
});

test('reachable browser source contains no direct Referral entity read or mutation', async () => {
  for (const file of await browserSourceFiles(new URL('../../src/', import.meta.url))) {
    const source = await readFile(file, 'utf8');
    assert.doesNotMatch(
      source,
      /\b(?:base44\.)?entities\.Referral\.(?:list|filter|get|create|update|delete|bulkCreate|updateMany)\b/,
      file.pathname,
    );
  }
});

test('Referral broker failures cannot masquerade as verified empty queues, documents, or reports', async () => {
  const expectedFailureStates = new Map([
    ['../../src/pages/ReferralIntake.jsx', /isError: referralsUnavailable[\s\S]*No empty queue is being inferred/],
    ['../../src/pages/ReferralFollowUp.jsx', /isError: referralsUnavailable[\s\S]*No follow-up queue is being shown/],
    ['../../src/components/documents/ReferralDocumentViewer.jsx', /isError: referralsUnavailable[\s\S]*No referral documents are being shown/],
    ['../../src/components/hub-tabs/ReferralAdmissionNote.jsx', /isError: referralUnavailable[\s\S]*No referral data is being shown/],
    ['../../src/components/reports/FollowUpAnalytics.jsx', /isError: referralsUnavailable[\s\S]*No zero-value metrics are being inferred/],
    ['../../src/components/reports/ReferralVolumeReport.jsx', /isError: referralsUnavailable[\s\S]*No zero-value report is being shown or exported/],
    ['../../src/components/dashboard/OverdueFollowUpsWidget.jsx', /isError: referralsUnavailable[\s\S]*No empty queue is being inferred/],
    ['../../src/components/referral/PendingReferralsWidget.jsx', /isError: referralsUnavailable[\s\S]*No empty queue is being inferred/],
  ]);
  for (const [relativePath, marker] of expectedFailureStates) {
    assert.match(await readFile(new URL(relativePath, import.meta.url), 'utf8'), marker, relativePath);
  }
});

test('create stamps immutable tenant provenance and supports an exact replay', async () => {
  const runtime = await loadHandler();
  const body = {
    action: 'create',
    agency_id: 'agency-a',
    client_request_id: 'request-new',
    referral: {
      patient_id: 'patient-a',
      patient_name: 'Fictional Patient',
      referral_date: '2026-09-06',
      document_type: 'manual',
      status: 'ready_for_admission',
      priority: 'normal',
    },
  };
  const created = await invoke(runtime.handler, body);
  assert.equal(created.response.status, 201);
  assert.equal(created.json.created, true);
  assert.equal(created.json.referral.agency_id, 'agency-a');
  assert.equal(created.json.referral.version, 1);
  assert.deepEqual(runtime.calls.creates[0], {
    ...body.referral,
    agency_id: 'agency-a',
    created_by_user_id: 'office-1',
    created_by_user_email_normalized: 'office@agency.test',
    created_by: 'office@agency.test',
    client_request_id: 'request-new',
    referral_creation_key: 'agency-a:office-1:request-new',
    version: 1,
  });

  const replay = await invoke(runtime.handler, body);
  assert.equal(replay.response.status, 200);
  assert.equal(replay.json.created, false);
  assert.equal(runtime.calls.creates.length, 1);

  const declinedRuntime = await loadHandler();
  const declinedBody = {
    action: 'create',
    agency_id: 'agency-a',
    client_request_id: 'request-declined',
    referral: { patient_name: 'Fictional Patient', status: 'declined' },
  };
  const declinedCreate = await invoke(declinedRuntime.handler, declinedBody);
  assert.equal(declinedCreate.response.status, 201);
  assert.equal(declinedCreate.json.referral.rejection_date, T2);
  assert.equal(declinedCreate.json.referral.rejected_by, 'office@agency.test');
  const declinedReplay = await invoke(declinedRuntime.handler, declinedBody);
  assert.equal(declinedReplay.response.status, 200);
  assert.equal(declinedReplay.json.created, false);
  assert.equal(declinedRuntime.calls.creates.length, 1);

  const changedRuntime = await loadHandler({ referrals: [referral({ version: 2 })] });
  const changedReplay = await invoke(changedRuntime.handler, {
    action: 'create',
    agency_id: 'agency-a',
    client_request_id: 'request-a',
    referral: {
      patient_name: 'Fictional Patient',
      referral_source: 'Test Hospital',
      referral_date: '2026-09-06',
      document_type: 'manual',
      priority: 'normal',
      status: 'new',
    },
  });
  assert.equal(changedReplay.response.status, 409);
  assert.equal(changedRuntime.calls.creates.length, 0);
});

test('post-create field or authority drift removes the request-created Referral', async () => {
  const body = {
    action: 'create',
    agency_id: 'agency-a',
    client_request_id: 'request-drift',
    referral: { patient_name: 'Fictional Patient', status: 'new' },
  };
  const fieldDrift = await loadHandler({
    createTransform: (row) => ({ ...row, patient_name: 'Provider-mutated value' }),
  });
  const fieldResult = await invoke(fieldDrift.handler, body);
  assert.equal(fieldResult.response.status, 500);
  assert.deepEqual(fieldDrift.calls.deletes, ['referral-1']);
  assert.equal(fieldDrift.state.referrals.length, 0);

  const authorityDrift = await loadHandler({
    authorityResponses: [USER, USER, { ...USER, is_active: false }],
  });
  const authorityResult = await invoke(authorityDrift.handler, body);
  assert.equal(authorityResult.response.status, 403);
  assert.deepEqual(authorityDrift.calls.deletes, ['referral-1']);
  assert.equal(authorityDrift.state.referrals.length, 0);
});

test('list is tenant-scoped, reauthorizes before disclosure, and rejects filter regressions', async () => {
  const runtime = await loadHandler({
    referrals: [referral({ patient_id: 'patient-a', assigned_to: 'office@agency.test' })],
  });
  const result = await invoke(runtime.handler, {
    action: 'list', agency_id: 'agency-a', limit: 20, patient_id: 'patient-a',
    status: 'new', assigned_to: 'OFFICE@AGENCY.TEST',
  });
  assert.equal(result.response.status, 200);
  assert.deepEqual(result.json.referrals.map((row) => row.id), ['referral-a']);
  assert.equal(runtime.calls.auth, 2);
  assert.ok(runtime.calls.filters.some(({ entity, query }) => (
    entity === 'Referral'
    && query.agency_id === 'agency-a'
    && query.patient_id === 'patient-a'
    && query.status === 'new'
    && query.assigned_to === 'office@agency.test'
  )));

  const regressed = await loadHandler({
    referrals: [referral({ id: 'foreign', agency_id: 'agency-b' })],
    ignoreFilters: true,
  });
  const denied = await invoke(regressed.handler, {
    action: 'list', agency_id: 'agency-a', limit: 20,
  });
  assert.equal(denied.response.status, 409);
  assert.equal(denied.json.referrals, undefined);

  const wrongPatient = await loadHandler({
    referrals: [referral({ patient_id: 'patient-b' })],
    ignoreFilters: true,
  });
  const wrongPatientResult = await invoke(wrongPatient.handler, {
    action: 'list', agency_id: 'agency-a', limit: 20, patient_id: 'patient-a',
  });
  assert.equal(wrongPatientResult.response.status, 409);
  assert.equal(wrongPatientResult.json.referrals, undefined);
});

test('idempotency lookup rejects a provider that ignores the creation-key predicate', async () => {
  const runtime = await loadHandler({
    referrals: [referral()],
    ignoreFilters: true,
  });
  const result = await invoke(runtime.handler, {
    action: 'create',
    agency_id: 'agency-a',
    client_request_id: 'different-request',
    referral: { patient_name: 'Fictional Patient', status: 'new' },
  });
  assert.equal(result.response.status, 409);
  assert.equal(result.json.referral, undefined);
  assert.equal(runtime.calls.creates.length, 0);
});

test('update uses a version-and-revision conditional write and server-stamps workflow actors', async () => {
  const runtime = await loadHandler({ referrals: [referral()] });
  const result = await invoke(runtime.handler, {
    action: 'update',
    agency_id: 'agency-a',
    referral_id: 'referral-a',
    changes: { status: 'declined' },
  });
  assert.equal(result.response.status, 200);
  assert.equal(result.json.referral.version, 2);
  assert.equal(result.json.referral.status, 'declined');
  assert.equal(result.json.referral.rejected_by, 'office@agency.test');
  assert.deepEqual(runtime.calls.updateMany[0].query, {
    id: 'referral-a',
    agency_id: 'agency-a',
    version: 1,
    updated_date: T1,
  });
  assert.deepEqual(runtime.calls.updateMany[0].operations, {
    $set: {
      status: 'declined',
      rejection_date: T2,
      rejected_by: 'office@agency.test',
    },
    $inc: { version: 1 },
  });

  const conflict = await loadHandler({ referrals: [referral()], updateNoop: true });
  const denied = await invoke(conflict.handler, {
    action: 'update', agency_id: 'agency-a', referral_id: 'referral-a',
    changes: { status: 'ready_for_admission' },
  });
  assert.equal(denied.response.status, 409);
});

test('cross-tenant Patient links, immutable-field spoofing, assignment changes, and weak callers fail closed', async () => {
  const scenarios = [
    {
      options: { patients: [patient({ agency_id: 'agency-b' })], ignoreFilters: true },
      body: {
        action: 'create', agency_id: 'agency-a', client_request_id: 'request-x',
        referral: { patient_id: 'patient-a', status: 'new' },
      },
      status: 409,
    },
    {
      options: {},
      body: {
        action: 'create', agency_id: 'agency-a', client_request_id: 'request-x',
        referral: { agency_id: 'agency-b' },
      },
      status: 400,
    },
    {
      options: { referrals: [referral()] },
      body: {
        action: 'update', agency_id: 'agency-a', referral_id: 'referral-a',
        changes: { assigned_to: 'other@agency.test' },
      },
      status: 503,
      code: 'referral_assignment_mutations_paused',
    },
    {
      options: { caller: { ...USER, role: 'admin' } },
      body: { action: 'list', agency_id: 'agency-a' },
      status: 403,
    },
    {
      options: { memberships: [membership({ tenant_role: 'clinician' })] },
      body: { action: 'list', agency_id: 'agency-a' },
      status: 403,
    },
    {
      options: {},
      body: {
        action: 'list', agency_id: 'agency-a', assigned_to: 'other@agency.test',
      },
      status: 403,
    },
    {
      options: { caller: new Error('login required') },
      body: { action: 'list', agency_id: 'agency-a' },
      status: 401,
    },
  ];
  for (const scenario of scenarios) {
    const runtime = await loadHandler(scenario.options);
    const result = await invoke(runtime.handler, scenario.body);
    assert.equal(result.response.status, scenario.status);
    if (scenario.code) assert.equal(result.json.code, scenario.code);
    assert.equal(runtime.calls.creates.length, 0);
    assert.equal(runtime.calls.updateMany.length, 0);
  }
});

test('Referral deletion stays fail-closed without atomic compare-and-delete', async () => {
  const office = await loadHandler({ referrals: [referral()] });
  const result = await invoke(office.handler, {
    action: 'delete', agency_id: 'agency-a', referral_id: 'referral-a',
  });
  assert.equal(result.response.status, 503);
  assert.equal(result.json.code, 'referral_delete_requires_atomic_compare_and_delete');
  assert.equal(office.calls.deletes.length, 0);
});
