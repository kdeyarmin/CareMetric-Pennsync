import assert from 'node:assert/strict';
import { readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import JSON5 from 'json5';
import { transpileTs } from '../../tools-transpile-ts.mjs';

const brokerUrl = new URL('../functions/createAuthorizedVisit/entry.ts', import.meta.url);
const triggerUrl = new URL('../functions/autoAssignNurseToPatient/entry.ts', import.meta.url);
const visitEntityUrl = new URL('../entities/Visit.jsonc', import.meta.url);
const wrapperUrl = new URL('../../src/functions/createAuthorizedVisit.js', import.meta.url);
const sourceRootUrl = new URL('../../src/', import.meta.url);

const USER = {
  id: 'user-1',
  email: 'Clinician@Agency.test',
  role: 'user',
  is_active: true,
  is_verified: true,
};

const patient = (overrides = {}) => ({
  id: 'patient-a',
  agency_id: 'agency-a',
  status: 'active',
  assigned_nurses: ['clinician@agency.test'],
  ...overrides,
});

const agency = (overrides = {}) => ({
  id: 'agency-a',
  agency_name: 'Agency A',
  status: 'active',
  ...overrides,
});

const membership = (overrides = {}) => ({
  id: 'membership-a',
  membership_key: 'agency-a:user-1',
  agency_id: 'agency-a',
  user_id: 'user-1',
  user_email_normalized: 'clinician@agency.test',
  tenant_role: 'clinician',
  status: 'active',
  created_by_user_id: 'owner-1',
  last_transition_by_user_id: 'owner-1',
  last_transition_by_email_normalized: 'owner@platform.test',
  last_transition_at: '2026-09-03T12:00:00.000Z',
  last_transition_reason: 'Approved clinician membership',
  activated_at: '2026-09-03T12:00:00.000Z',
  version: 2,
  ...overrides,
});

const visitInput = (overrides = {}) => ({
  patient_id: 'patient-a',
  visit_date: '2026-09-03',
  visit_type: 'routine_visit',
  status: 'scheduled',
  ...overrides,
});

async function importHandler(sourceUrl, globalName, makeClient) {
  let source = await readFile(sourceUrl, 'utf8');
  source = source.replace(
    /import\s+\{\s*createClientFromRequest\s*\}\s+from\s+'npm:[^']+';/,
    `const createClientFromRequest = globalThis.${globalName};`,
  );
  const temporaryModule = join(
    tmpdir(),
    `visit_authority_${Date.now()}_${Math.random().toString(36).slice(2)}.mjs`,
  );
  await writeFile(temporaryModule, transpileTs(source).outputText);

  let handler;
  globalThis[globalName] = makeClient;
  globalThis.Deno = { serve: (candidate) => { handler = candidate; } };
  try {
    await import(pathToFileURL(temporaryModule).href);
  } finally {
    await unlink(temporaryModule).catch(() => {});
    delete globalThis[globalName];
  }
  assert.equal(typeof handler, 'function');
  return handler;
}

async function loadBroker({
  caller = USER,
  patients = [patient()],
  agencies = [agency()],
  memberships = [membership()],
  visits = [],
  ignoreFilters = false,
  createdMutation = null,
  membershipResponses = null,
  patientResponses = null,
  agencyResponses = null,
} = {}) {
  const state = {
    patients: patients.map((row) => ({ ...row })),
    agencies: agencies.map((row) => ({ ...row })),
    memberships: memberships.map((row) => ({ ...row })),
    visits: visits.map((row) => ({ ...row })),
  };
  const calls = {
    patientFilters: [], agencyFilters: [], membershipFilters: [], visitFilters: [], creates: [], deletes: [],
  };
  let patientFilterIndex = 0;
  let agencyFilterIndex = 0;
  let membershipFilterIndex = 0;
  const filtered = (rows, query, limit) => {
    const matches = ignoreFilters
      ? rows
      : rows.filter((row) => Object.entries(query || {}).every(([key, value]) => row?.[key] === value));
    return Number.isFinite(limit) ? matches.slice(0, limit) : matches;
  };
  const client = {
    auth: {
      me: async () => {
        if (caller instanceof Error) throw caller;
        return caller;
      },
    },
    asServiceRole: {
      entities: {
        Patient: {
          filter: async (query, sort, limit) => {
            calls.patientFilters.push({ query, sort, limit });
            const rows = patientResponses
              ? patientResponses[Math.min(patientFilterIndex++, patientResponses.length - 1)]
              : state.patients;
            return filtered(rows, query, limit);
          },
        },
        Agency: {
          filter: async (query, sort, limit) => {
            calls.agencyFilters.push({ query, sort, limit });
            const rows = agencyResponses
              ? agencyResponses[Math.min(agencyFilterIndex++, agencyResponses.length - 1)]
              : state.agencies;
            return filtered(rows, query, limit);
          },
        },
        AgencyMembership: {
          filter: async (query, sort, limit) => {
            calls.membershipFilters.push({ query, sort, limit });
            const rows = membershipResponses
              ? membershipResponses[Math.min(membershipFilterIndex++, membershipResponses.length - 1)]
              : state.memberships;
            return filtered(rows, query, limit);
          },
        },
        Visit: {
          filter: async (query, sort, limit) => {
            calls.visitFilters.push({ query, sort, limit });
            return filtered(state.visits, query, limit);
          },
          create: async (payload) => {
            calls.creates.push({ ...payload });
            const row = { id: `visit-${state.visits.length + 1}`, ...payload };
            if (createdMutation) Object.assign(row, createdMutation);
            state.visits.push(row);
            return row;
          },
          delete: async (id) => {
            calls.deletes.push(id);
            state.visits = state.visits.filter((row) => row.id !== id);
          },
        },
      },
    },
  };
  const handler = await importHandler(
    brokerUrl,
    '__visitBrokerMakeClient',
    () => client,
  );
  return { handler, calls, state };
}

async function invokeBroker(handler, body = visitInput(), options = {}) {
  const method = options.method || 'POST';
  const request = new Request('http://local/createAuthorizedVisit', {
    method,
    headers: { 'content-type': 'application/json' },
    ...(method === 'GET' || method === 'HEAD'
      ? {}
      : { body: options.invalidJson ? '{' : JSON.stringify(body) }),
  });
  const response = await handler(request);
  return { response, json: await response.json() };
}

async function loadTrigger({
  visit = {
    id: 'visit-a',
    patient_id: 'patient-a',
    agency_id: 'agency-a',
    created_by_user_id: 'user-1',
    created_by: 'clinician@agency.test',
  },
  patientRow = patient(),
  users = [USER],
  memberships = [membership()],
  ignoreFilters = false,
} = {}) {
  const calls = { userFilters: [], membershipFilters: [], updates: [] };
  const filter = (rows, query, limit) => {
    const matches = ignoreFilters
      ? rows
      : rows.filter((row) => Object.entries(query || {}).every(([key, value]) => row?.[key] === value));
    return Number.isFinite(limit) ? matches.slice(0, limit) : matches;
  };
  const client = {
    asServiceRole: {
      entities: {
        Visit: { get: async () => visit },
        Patient: {
          get: async () => patientRow,
          update: async (id, payload) => {
            calls.updates.push({ id, payload });
            return { ...patientRow, ...payload };
          },
        },
        User: {
          filter: async (query, sort, limit) => {
            calls.userFilters.push({ query, sort, limit });
            return filter(users, query, limit);
          },
        },
        AgencyMembership: {
          filter: async (query, sort, limit) => {
            calls.membershipFilters.push({ query, sort, limit });
            return filter(memberships, query, limit);
          },
        },
      },
    },
  };
  const handler = await importHandler(
    triggerUrl,
    '__visitTriggerMakeClient',
    () => client,
  );
  return { handler, calls };
}

async function invokeTrigger(handler, id = 'visit-a') {
  const response = await handler(new Request('http://local/autoAssignNurseToPatient', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ data: { id, patient_id: 'attacker-chosen-patient' } }),
  }));
  return { response, json: await response.json() };
}

async function sourceFiles(directoryUrl) {
  const root = directoryUrl.pathname;
  const output = [];
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (['.js', '.jsx', '.ts', '.tsx'].includes(extname(entry.name))) output.push(path);
    }
  }
  await walk(root);
  return output;
}

test('Visit provenance fields exist, direct create is disabled, and the wrapper owns browser creation', async () => {
  const schema = JSON5.parse(await readFile(visitEntityUrl, 'utf8'));
  assert.equal(schema.properties.agency_id.type, 'string');
  assert.equal(schema.properties.created_by_user_id.type, 'string');
  assert.equal(schema.properties.created_by_user_email_normalized.format, 'email');
  assert.equal(schema.rls.create, false);
  assert.deepEqual(schema.rls.read.$or[0], {
    'data.created_by_user_email_normalized': '{{user.email}}',
  });
  assert.equal(schema.rls.update, false);
  assert.equal(schema.rls.delete, false);

  const wrapper = await readFile(wrapperUrl, 'utf8');
  assert.match(wrapper, /base44\.functions\.invoke\('createAuthorizedVisit', payload\)/);
  assert.doesNotMatch(wrapper, /entities\.Visit\.create/);

  const offenders = [];
  for (const path of await sourceFiles(sourceRootUrl)) {
    const source = await readFile(path, 'utf8');
    if (/(?:base44\.)?entities\.Visit\.create\s*\(/.test(source)) offenders.push(path);
  }
  assert.deepEqual(offenders, [], `direct production Visit.create paths: ${offenders.join(', ')}`);

  for (const relative of [
    'components/dashboard/PatientQuickActions.jsx',
    'pages/PatientDetails.jsx',
    'components/smartNote/persistVisitNote.js',
    'components/telehealth/PatientTelehealthPanel.jsx',
    'lib/retiredOfflineQueue.js',
  ]) {
    const source = await readFile(new URL(`../../src/${relative}`, import.meta.url), 'utf8');
    assert.match(source, /createAuthorizedVisit\(/, relative);
  }
});

test('authorized creation stamps immutable tenant identity and returns a narrow row', async () => {
  const { handler, calls } = await loadBroker();
  const { response, json } = await invokeBroker(handler, visitInput({ nurse_notes: 'Clinical note' }));

  assert.equal(response.status, 200);
  assert.equal(json.created, true);
  assert.equal(json.visit.id, 'visit-1');
  assert.equal(json.visit.agency_id, 'agency-a');
  assert.equal(json.visit.created_by_user_id, 'user-1');
  assert.equal(json.visit.created_by_user_email_normalized, 'clinician@agency.test');
  assert.equal(json.visit.nurse_notes, undefined);
  assert.deepEqual(calls.membershipFilters[0].query, { user_id: 'user-1', agency_id: 'agency-a' });
  assert.equal('status' in calls.membershipFilters[0].query, false);
  assert.equal(calls.patientFilters.length, 2);
  assert.equal(calls.agencyFilters.length, 2);
  assert.equal(calls.membershipFilters.length, 2);
  assert.deepEqual(calls.agencyFilters[0].query, { id: 'agency-a' });
  assert.deepEqual(calls.creates[0], {
    ...visitInput({ nurse_notes: 'Clinical note' }),
    agency_id: 'agency-a',
    created_by_user_id: 'user-1',
    created_by_user_email_normalized: 'clinician@agency.test',
    created_by: 'clinician@agency.test',
  });
});

test('anonymous, deactivated, service, unverified, malformed, and spoofed calls never create', async () => {
  const cases = [
    { caller: new Error('login required'), status: 401 },
    { caller: { ...USER, is_active: false }, status: 403 },
    { caller: { ...USER, disabled: true }, status: 403 },
    { caller: { ...USER, is_service: true }, status: 403 },
    { caller: { ...USER, is_verified: false }, status: 403 },
    { caller: USER, body: { ...visitInput(), created_by: 'attacker@example.test' }, status: 400 },
    { caller: USER, body: { ...visitInput(), created_by_user_id: 'attacker' }, status: 400 },
    { caller: USER, body: { ...visitInput(), created_by_user_email_normalized: 'attacker@example.test' }, status: 400 },
    { caller: USER, body: { ...visitInput(), is_sample: true }, status: 400 },
    { caller: USER, body: { ...visitInput(), ai_process_claimed_by: 'attacker' }, status: 400 },
    { caller: USER, body: { ...visitInput(), patient_id: { $ne: null } }, status: 400 },
  ];
  for (const scenario of cases) {
    const { handler, calls } = await loadBroker({ caller: scenario.caller });
    const { response } = await invokeBroker(handler, scenario.body || visitInput());
    assert.equal(response.status, scenario.status);
    assert.equal(calls.creates.length, 0);
  }

  const { handler, calls } = await loadBroker();
  const { response } = await invokeBroker(handler, visitInput(), { method: 'GET' });
  assert.equal(response.status, 405);
  assert.equal(calls.patientFilters.length, 0);
});

test('guessed foreign, inactive, ambiguous, or filter-regression Patient ids cannot create', async () => {
  for (const scenario of [
    { patients: [], body: visitInput({ patient_id: 'foreign-patient' }), status: 403 },
    { patients: [patient({ status: 'discharged' })], body: visitInput(), status: 403 },
    { patients: [patient(), patient({ first_name: 'duplicate' })], body: visitInput(), status: 409 },
    {
      patients: [patient({ id: 'foreign-patient', agency_id: 'agency-b' })],
      body: visitInput(),
      status: 403,
      ignoreFilters: true,
    },
    { patients: [patient({ agency_id: 'agency-b' })], body: visitInput({ agency_id: 'agency-a' }), status: 403 },
  ]) {
    const { handler, calls } = await loadBroker(scenario);
    const { response } = await invokeBroker(handler, scenario.body);
    assert.equal(response.status, scenario.status);
    assert.equal(calls.creates.length, 0);
  }
});

test('the exact Agency must be active or trial and cannot be supplied by a filter regression', async () => {
  for (const scenario of [
    { agencies: [], status: 403 },
    { agencies: [agency({ status: 'suspended' })], status: 403 },
    { agencies: [agency({ status: 'cancelled' })], status: 403 },
    { agencies: [agency(), agency({ agency_name: 'Duplicate' })], status: 403 },
    { agencies: [agency({ id: 'agency-b' })], ignoreFilters: true, status: 403 },
  ]) {
    const { handler, calls } = await loadBroker(scenario);
    const { response } = await invokeBroker(handler);
    assert.equal(response.status, scenario.status);
    assert.equal(calls.creates.length, 0);
  }

  const trial = await loadBroker({ agencies: [agency({ status: 'trial' })] });
  const trialResult = await invokeBroker(trial.handler);
  assert.equal(trialResult.response.status, 200);
  assert.equal(trial.calls.creates.length, 1);
});

test('non-manager members need pre-existing Patient access; managers cannot grant it via Visit creation', async () => {
  for (const tenantRole of ['clinician', 'office_staff', 'social_worker', 'spiritual_care']) {
    const denied = await loadBroker({
      patients: [patient({ assigned_nurses: [], created_by: 'someone-else@agency.test' })],
      memberships: [membership({ tenant_role: tenantRole })],
    });
    const deniedResult = await invokeBroker(denied.handler);
    assert.equal(deniedResult.response.status, 403, tenantRole);
    assert.equal(denied.calls.creates.length, 0, tenantRole);
  }

  const owner = await loadBroker({
    patients: [patient({ assigned_nurses: [], created_by: 'Clinician@Agency.test' })],
  });
  assert.equal((await invokeBroker(owner.handler)).response.status, 200);

  for (const tenantRole of ['manager', 'agency_admin']) {
    const authorized = await loadBroker({
      patients: [patient({ assigned_nurses: [], created_by: 'someone-else@agency.test' })],
      memberships: [membership({ tenant_role: tenantRole })],
    });
    assert.equal((await invokeBroker(authorized.handler)).response.status, 200, tenantRole);
  }
});

test('all-status membership duplicates, lifecycle corruption, and inactive states fail closed', async () => {
  const revokedDuplicate = membership({
    id: 'membership-revoked',
    status: 'revoked',
    revoked_at: '2026-09-03T13:00:00.000Z',
    revocation_reason: 'Terminated duplicate',
  });
  for (const [rows, expectedStatus] of [
    [[], 403],
    [[membership(), revokedDuplicate], 409],
    [[membership({ status: 'suspended' })], 403],
    [[membership({ activated_at: undefined })], 409],
    [[membership({ user_email_normalized: 'other@agency.test' })], 409],
    [[membership({ version: 0 })], 409],
    [[membership({ membership_key: 'agency-a:attacker' })], 409],
  ]) {
    const { handler, calls } = await loadBroker({ memberships: rows });
    const { response } = await invokeBroker(handler);
    assert.equal(response.status, expectedStatus);
    assert.equal(calls.creates.length, 0);
  }
});

test('Patient access and membership are rechecked immediately before create', async () => {
  const revoked = membership({
    status: 'revoked',
    revoked_at: '2026-09-03T13:00:00.000Z',
    revocation_reason: 'Revoked during request',
  });
  const revokedDuringRequest = await loadBroker({
    membershipResponses: [[membership()], [revoked]],
  });
  const revokedResult = await invokeBroker(revokedDuringRequest.handler);
  assert.equal(revokedResult.response.status, 403);
  assert.equal(revokedDuringRequest.calls.creates.length, 0);

  const accessRemoved = await loadBroker({
    patientResponses: [
      [patient()],
      [patient({ assigned_nurses: [], created_by: 'someone-else@agency.test' })],
    ],
  });
  const accessResult = await invokeBroker(accessRemoved.handler);
  assert.equal(accessResult.response.status, 403);
  assert.equal(accessRemoved.calls.creates.length, 0);

  const agencySuspended = await loadBroker({
    agencyResponses: [[agency()], [agency({ status: 'suspended' })]],
  });
  const agencyResult = await invokeBroker(agencySuspended.handler);
  assert.equal(agencyResult.response.status, 403);
  assert.equal(agencySuspended.calls.creates.length, 0);
});

test('idempotent replay is authority-bound and a post-create stamp mismatch is removed', async () => {
  const existing = {
    id: 'visit-existing',
    ...visitInput({ client_request_id: 'request-a' }),
    agency_id: 'agency-a',
    created_by_user_id: 'user-1',
    created_by_user_email_normalized: 'clinician@agency.test',
    created_by: 'clinician@agency.test',
  };
  const replay = await loadBroker({ visits: [existing] });
  const replayResult = await invokeBroker(replay.handler, visitInput({ client_request_id: 'request-a' }));
  assert.equal(replayResult.response.status, 200);
  assert.equal(replayResult.json.created, false);
  assert.equal(replay.calls.creates.length, 0);

  const revoked = membership({
    status: 'revoked',
    revoked_at: '2026-09-03T13:00:00.000Z',
    revocation_reason: 'Revoked during replay',
  });
  const revokedReplay = await loadBroker({
    visits: [existing],
    membershipResponses: [[membership()], [revoked]],
  });
  const revokedReplayResult = await invokeBroker(
    revokedReplay.handler,
    visitInput({ client_request_id: 'request-a' }),
  );
  assert.equal(revokedReplayResult.response.status, 403);
  assert.equal(revokedReplayResult.json.visit, undefined);

  const conflict = await loadBroker({ visits: [{ ...existing, created_by_user_id: 'attacker' }] });
  const conflictResult = await invokeBroker(conflict.handler, visitInput({ client_request_id: 'request-a' }));
  assert.equal(conflictResult.response.status, 409);
  assert.equal(conflict.calls.creates.length, 0);

  const mismatch = await loadBroker({ createdMutation: { agency_id: 'agency-b' } });
  const errorLog = console.error;
  console.error = () => {};
  const mismatchResult = await invokeBroker(mismatch.handler);
  console.error = errorLog;
  assert.equal(mismatchResult.response.status, 500);
  assert.deepEqual(mismatch.calls.deletes, ['visit-1']);
});

test('the legacy auto-assignment trigger is an unconditional no-op before privileged reads or writes', async () => {
  const source = await readFile(triggerUrl, 'utf8');
  assert.doesNotMatch(source, /createClientFromRequest|asServiceRole|\.entities\.|Patient\.(?:get|filter|update)/);

  for (const id of ['visit-a', 'guessed-foreign-id', '', { $ne: null }]) {
    const { handler, calls } = await loadTrigger();
    const { response, json } = await invokeTrigger(handler, id);
    assert.equal(response.status, 200);
    assert.deepEqual(json, {
      success: true,
      skipped: 'automatic patient assignment disabled',
    });
    assert.deepEqual(calls, { userFilters: [], membershipFilters: [], updates: [] });
  }
});
