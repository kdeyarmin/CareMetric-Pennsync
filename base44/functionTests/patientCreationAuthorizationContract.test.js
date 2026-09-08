import assert from 'node:assert/strict';
import { readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import JSON5 from 'json5';
import { transpileTs } from '../../tools-transpile-ts.mjs';

const brokerUrl = new URL('../functions/createAuthorizedPatient/entry.ts', import.meta.url);
const patientEntityUrl = new URL('../entities/Patient.jsonc', import.meta.url);
const wrapperUrl = new URL('../../src/functions/createAuthorizedPatient.js', import.meta.url);
const importUrl = new URL('../functions/processPatientFileUpdate/entry.ts', import.meta.url);
const sourceRootUrl = new URL('../../src/', import.meta.url);

const MIGRATED_CREATE_CALLSITES = new Map([
  ['pages/ReferralIntake.jsx', 2],
  ['pages/ReferralTriage.jsx', 1],
  ['components/hub-tabs/ReferralProcessor.jsx', 1],
  ['components/patient/PatientForm.jsx', 1],
  ['components/ui/SearchablePatientSelect.jsx', 1],
  ['components/dashboard/PatientQuickActions.jsx', 1],
  ['components/referral/DocumentToTriageMapper.jsx', 1],
]);

const USER = {
  id: 'user-1',
  email: 'Clinician@Agency.test',
  role: 'user',
  is_active: true,
  is_verified: true,
};

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

const patientInput = (overrides = {}) => ({
  first_name: 'Ada',
  middle_name: 'M',
  last_name: 'Lovelace',
  date_of_birth: '1980-12-10',
  medical_record_number: 'MRN-100',
  phone: '555-0100',
  email: 'ada@example.test',
  primary_diagnosis: 'I10',
  secondary_diagnoses: ['E11.9'],
  allergies: ['penicillin'],
  current_medications: [{ name: 'Example', dosage: '5 mg' }],
  care_type: 'home_health',
  clinical_notes: 'Referral reviewed before chart creation.',
  client_request_id: 'request-a',
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
    `patient_authority_${Date.now()}_${Math.random().toString(36).slice(2)}.mjs`,
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

async function importWrapper(base44Client) {
  let source = await readFile(wrapperUrl, 'utf8');
  source = source.replace(
    /import\s+\{\s*base44\s*\}\s+from\s+['"]@\/api\/base44Client['"];?/,
    'const base44 = globalThis.__patientWrapperBase44;',
  );
  const temporaryModule = join(
    tmpdir(),
    `patient_wrapper_${Date.now()}_${Math.random().toString(36).slice(2)}.mjs`,
  );
  await writeFile(temporaryModule, source);
  globalThis.__patientWrapperBase44 = base44Client;
  try {
    return await import(pathToFileURL(temporaryModule).href);
  } finally {
    await unlink(temporaryModule).catch(() => {});
    delete globalThis.__patientWrapperBase44;
  }
}

async function loadBroker({
  caller = USER,
  agencies = [agency()],
  memberships = [membership()],
  patients = [],
  ignoreFilters = false,
  createdMutation = null,
  agencyResponses = null,
  membershipResponses = null,
  patientResponses = null,
} = {}) {
  const state = {
    agencies: agencies.map((row) => ({ ...row })),
    memberships: memberships.map((row) => ({ ...row })),
    patients: patients.map((row) => ({ ...row })),
  };
  const calls = {
    agencyFilters: [], membershipFilters: [], patientFilters: [], creates: [], deletes: [],
  };
  let agencyFilterIndex = 0;
  let membershipFilterIndex = 0;
  let patientFilterIndex = 0;
  const filtered = (rows, query, limit) => {
    const source = Array.isArray(rows) ? rows : [];
    const matches = ignoreFilters
      ? source
      : source.filter((row) => Object.entries(query || {}).every(([key, value]) => row?.[key] === value));
    return Number.isFinite(limit) ? matches.slice(0, limit) : matches;
  };
  const responseRows = (responses, index, fallback) => (
    responses ? responses[Math.min(index, responses.length - 1)] : fallback
  );
  const client = {
    auth: {
      me: async () => {
        if (caller instanceof Error) throw caller;
        return caller;
      },
    },
    asServiceRole: {
      entities: {
        Agency: {
          filter: async (query, sort, limit) => {
            calls.agencyFilters.push({ query, sort, limit });
            const rows = responseRows(agencyResponses, agencyFilterIndex++, state.agencies);
            return filtered(rows, query, limit);
          },
        },
        AgencyMembership: {
          filter: async (query, sort, limit) => {
            calls.membershipFilters.push({ query, sort, limit });
            const rows = responseRows(
              membershipResponses,
              membershipFilterIndex++,
              state.memberships,
            );
            return filtered(rows, query, limit);
          },
        },
        Patient: {
          filter: async (query, sort, limit) => {
            calls.patientFilters.push({ query, sort, limit });
            const rows = responseRows(patientResponses, patientFilterIndex++, state.patients);
            return filtered(rows, query, limit);
          },
          create: async (payload) => {
            calls.creates.push({ ...payload });
            const row = { id: `patient-${state.patients.length + 1}`, ...payload };
            if (createdMutation) Object.assign(row, createdMutation);
            state.patients.push(row);
            return row;
          },
          delete: async (id) => {
            calls.deletes.push(id);
            state.patients = state.patients.filter((row) => row.id !== id);
          },
        },
      },
    },
  };
  const handler = await importHandler(
    brokerUrl,
    '__patientBrokerMakeClient',
    () => client,
  );
  return { handler, calls, state };
}

async function invokeBroker(handler, body = patientInput(), options = {}) {
  const method = options.method || 'POST';
  const request = new Request('http://local/createAuthorizedPatient', {
    method,
    headers: { 'content-type': 'application/json' },
    ...(method === 'GET' || method === 'HEAD'
      ? {}
      : { body: options.invalidJson ? '{' : JSON.stringify(body) }),
  });
  const response = await handler(request);
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

test('Patient provenance and idempotency fields exist and direct browser mutations are disabled', async () => {
  const schema = JSON5.parse(await readFile(patientEntityUrl, 'utf8'));
  assert.equal(schema.properties.agency_id.type, 'string');
  assert.equal(schema.properties.created_by_user_id.type, 'string');
  assert.equal(schema.properties.created_by_user_email_normalized.format, 'email');
  assert.equal(schema.properties.client_request_id.type, 'string');
  assert.equal(schema.properties.patient_creation_key.type, 'string');
  assert.equal(schema.rls.create, false);
  assert.equal(schema.rls.update, false);
  assert.equal(schema.rls.delete, false);

  const wrapper = await readFile(wrapperUrl, 'utf8');
  assert.match(wrapper, /base44\.functions\.invoke\(['"]createAuthorizedPatient['"]/);
  assert.doesNotMatch(wrapper, /entities\.Patient\.(?:create|delete)/);

  const offenders = [];
  for (const path of await sourceFiles(sourceRootUrl)) {
    const source = await readFile(path, 'utf8');
    if (/(?:base44\.)?entities\.Patient\.(?:create|delete)\s*\(/.test(source)) offenders.push(path);
  }
  assert.deepEqual(offenders, [], `direct production Patient create/delete paths: ${offenders.join(', ')}`);

  for (const [relative, expectedCalls] of MIGRATED_CREATE_CALLSITES) {
    const source = await readFile(new URL(`../../src/${relative}`, import.meta.url), 'utf8');
    const calls = source.match(/\bcreateAuthorizedPatient\s*\(/g) || [];
    assert.equal(calls.length, expectedCalls, relative);
  }
});

test('the wrapper generates a required client_request_id without mutating caller input', async () => {
  const calls = [];
  const base44Client = {
    functions: {
      invoke: async (name, payload) => {
        calls.push({ name, payload });
        return { data: { created: true, patient: { id: 'patient-a' } } };
      },
    },
  };
  const { createAuthorizedPatient } = await importWrapper(base44Client);
  assert.equal(typeof createAuthorizedPatient, 'function');

  const withoutKey = { first_name: 'Ada', last_name: 'Lovelace' };
  const created = await createAuthorizedPatient(withoutKey);
  assert.deepEqual(created, { id: 'patient-a' });
  assert.equal(calls[0].name, 'createAuthorizedPatient');
  assert.equal(typeof calls[0].payload.client_request_id, 'string');
  assert.ok(calls[0].payload.client_request_id.length > 0);
  assert.equal(Object.hasOwn(withoutKey, 'client_request_id'), false);

  await createAuthorizedPatient(
    { first_name: 'Grace', last_name: 'Hopper' },
    { agencyId: 'agency-b', clientRequestId: 'caller-key' },
  );
  assert.equal(calls[1].payload.client_request_id, 'caller-key');
  assert.equal(calls[1].payload.agency_id, 'agency-b');
});

test('authorized creation preserves allowed clinical fields and stamps immutable authority', async () => {
  const { handler, calls } = await loadBroker();
  const input = patientInput();
  const { response, json } = await invokeBroker(handler, input);

  assert.equal(response.status, 200);
  assert.equal(json.created, true);
  assert.equal(json.patient.id, 'patient-1');
  assert.equal(json.patient.agency_id, 'agency-a');
  assert.equal(json.patient.created_by_user_id, 'user-1');
  assert.equal(json.patient.created_by_user_email_normalized, 'clinician@agency.test');
  assert.equal(json.patient.client_request_id, 'request-a');
  assert.equal(json.patient.primary_diagnosis, undefined);
  assert.equal(json.patient.clinical_notes, undefined);

  assert.equal(calls.creates.length, 1);
  const created = calls.creates[0];
  for (const field of [
    'first_name',
    'middle_name',
    'last_name',
    'date_of_birth',
    'medical_record_number',
    'phone',
    'email',
    'primary_diagnosis',
    'secondary_diagnoses',
    'allergies',
    'current_medications',
    'care_type',
    'clinical_notes',
  ]) {
    assert.deepEqual(created[field], input[field], field);
  }
  assert.equal(created.agency_id, 'agency-a');
  assert.equal(created.created_by_user_id, 'user-1');
  assert.equal(created.created_by_user_email_normalized, 'clinician@agency.test');
  assert.equal(created.created_by, 'clinician@agency.test');
  assert.equal(created.client_request_id, 'request-a');
  assert.equal(created.patient_creation_key, 'agency-a:user-1:request-a');
  assert.equal(created.is_sample, false);
  assert.equal(created.is_archived, false);
  assert.equal(created.status, 'active');

  assert.equal(calls.membershipFilters.length, 3);
  assert.deepEqual(calls.membershipFilters[0].query, { user_id: 'user-1' });
  for (const call of calls.membershipFilters) assert.equal('status' in call.query, false);
  assert.equal(calls.agencyFilters.length, 3);
  assert.deepEqual(calls.agencyFilters[0].query, { id: 'agency-a' });
  assert.equal(calls.patientFilters.length, 3);
  assert.deepEqual(calls.patientFilters[0].query, {
    patient_creation_key: created.patient_creation_key,
  });
  assert.deepEqual(calls.patientFilters[1].query, { id: 'patient-1' });
  assert.deepEqual(calls.patientFilters[2].query, {
    patient_creation_key: created.patient_creation_key,
  });
});

test('anonymous, deactivated, service, unverified, malformed, and non-POST calls never create', async () => {
  const cases = [
    { caller: new Error('login required'), status: 401 },
    { caller: null, status: 401 },
    { caller: { ...USER, is_active: false }, status: 403 },
    { caller: { ...USER, disabled: true }, status: 403 },
    { caller: { ...USER, is_service: true }, status: 403 },
    { caller: { ...USER, is_verified: false }, status: 403 },
    { caller: { ...USER, id: { $ne: null } }, status: 403 },
    { caller: { ...USER, email: 'not-an-email' }, status: 403 },
  ];
  for (const scenario of cases) {
    const { handler, calls } = await loadBroker({ caller: scenario.caller });
    const { response } = await invokeBroker(handler);
    assert.equal(response.status, scenario.status);
    assert.equal(calls.creates.length, 0);
  }

  const get = await loadBroker();
  const getResult = await invokeBroker(get.handler, patientInput(), { method: 'GET' });
  assert.equal(getResult.response.status, 405);
  assert.equal(get.calls.membershipFilters.length, 0);

  const invalidJson = await loadBroker();
  const invalidResult = await invokeBroker(invalidJson.handler, patientInput(), { invalidJson: true });
  assert.equal(invalidResult.response.status, 400);
  assert.equal(invalidJson.calls.creates.length, 0);
});

test('client_request_id is required and selectors, operators, and protected fields are rejected', async () => {
  const invalidBodies = [
    { body: patientInput({ client_request_id: undefined }), label: 'missing request id' },
    { body: patientInput({ client_request_id: '' }), label: 'empty request id' },
    { body: patientInput({ client_request_id: ' request-a ' }), label: 'non-exact request id' },
    { body: patientInput({ client_request_id: { $ne: null } }), label: 'request operator' },
    { body: patientInput({ agency_id: { $ne: null } }), label: 'agency operator' },
    { body: patientInput({ first_name: { $ne: null } }), label: 'clinical operator' },
    { body: patientInput({ first_name: '' }), label: 'missing first name' },
    { body: patientInput({ last_name: '' }), label: 'missing last name' },
    { body: patientInput({ status: 'discharged' }), label: 'non-active status' },
  ];
  const protectedFields = [
    ['id', 'guessed-id'],
    ['created_by', 'attacker@example.test'],
    ['created_by_user_id', 'attacker'],
    ['created_by_user_email_normalized', 'attacker@example.test'],
    ['patient_creation_key', 'forged'],
    ['is_sample', true],
    ['is_archived', true],
    ['assigned_nurses', ['attacker@example.test']],
    ['risk_predict_claimed_by', 'attacker'],
  ];
  for (const [field, value] of protectedFields) {
    invalidBodies.push({ body: patientInput({ [field]: value }), label: field });
  }

  for (const scenario of invalidBodies) {
    const { handler, calls } = await loadBroker();
    const { response } = await invokeBroker(handler, scenario.body);
    assert.equal(response.status, 400, scenario.label);
    assert.equal(calls.creates.length, 0, scenario.label);
  }
});

test('implicit membership resolution requires one eligible active tenant and an explicit selector disambiguates', async () => {
  const secondActive = membership({
    id: 'membership-b',
    membership_key: 'agency-b:user-1',
    agency_id: 'agency-b',
  });
  const ambiguous = await loadBroker({
    agencies: [agency(), agency({ id: 'agency-b', agency_name: 'Agency B' })],
    memberships: [membership(), secondActive],
  });
  const ambiguousResult = await invokeBroker(ambiguous.handler);
  assert.equal(ambiguousResult.response.status, 409);
  assert.equal(ambiguous.calls.creates.length, 0);

  const selected = await loadBroker({
    agencies: [agency(), agency({ id: 'agency-b', agency_name: 'Agency B' })],
    memberships: [membership(), secondActive],
  });
  const selectedResult = await invokeBroker(selected.handler, patientInput({ agency_id: 'agency-b' }));
  assert.equal(selectedResult.response.status, 200);
  assert.equal(selected.calls.creates[0].agency_id, 'agency-b');
  assert.equal(selected.calls.creates[0].patient_creation_key, 'agency-b:user-1:request-a');
  assert.deepEqual(selected.calls.membershipFilters[0].query, { user_id: 'user-1' });
  assert.equal('status' in selected.calls.membershipFilters[0].query, false);

  const unownedSelector = await loadBroker();
  const unownedResult = await invokeBroker(
    unownedSelector.handler,
    patientInput({ agency_id: 'agency-b' }),
  );
  assert.equal(unownedResult.response.status, 403);
  assert.equal(unownedSelector.calls.creates.length, 0);

  const foreignFilterResult = await loadBroker({
    memberships: [membership({
      id: 'membership-attacker',
      membership_key: 'agency-a:attacker',
      user_id: 'attacker',
      user_email_normalized: 'attacker@example.test',
    })],
    ignoreFilters: true,
  });
  assert.equal((await invokeBroker(foreignFilterResult.handler)).response.status, 403);
  assert.equal(foreignFilterResult.calls.creates.length, 0);

  const revokedOtherAgency = membership({
    id: 'membership-b',
    membership_key: 'agency-b:user-1',
    agency_id: 'agency-b',
    status: 'revoked',
    revoked_at: '2026-09-03T13:00:00.000Z',
    revocation_reason: 'Access removed',
  });
  const oneActive = await loadBroker({ memberships: [membership(), revokedOtherAgency] });
  assert.equal((await invokeBroker(oneActive.handler)).response.status, 200);
});

test('only agency_admin, manager, and clinician memberships may create a Patient', async () => {
  for (const tenantRole of ['agency_admin', 'manager', 'clinician']) {
    const runtime = await loadBroker({ memberships: [membership({ tenant_role: tenantRole })] });
    assert.equal((await invokeBroker(runtime.handler)).response.status, 200, tenantRole);
    assert.equal(runtime.calls.creates.length, 1, tenantRole);
  }

  for (const tenantRole of ['office_staff', 'social_worker', 'spiritual_care']) {
    const runtime = await loadBroker({ memberships: [membership({ tenant_role: tenantRole })] });
    assert.equal((await invokeBroker(runtime.handler)).response.status, 403, tenantRole);
    assert.equal(runtime.calls.creates.length, 0, tenantRole);
  }
});

test('all-status duplicates, inactive states, and lifecycle-integrity corruption fail closed', async () => {
  const revokedDuplicate = membership({
    id: 'membership-revoked',
    status: 'revoked',
    revoked_at: '2026-09-03T13:00:00.000Z',
    revocation_reason: 'Terminated duplicate',
  });
  for (const [rows, expectedStatus, label] of [
    [[], 403, 'missing'],
    [[membership(), revokedDuplicate], 409, 'duplicate pair across lifecycle states'],
    [[membership({ status: 'suspended' })], 403, 'suspended'],
    [[membership({ status: 'revoked', revoked_at: '2026-09-03T13:00:00.000Z', revocation_reason: 'Revoked' })], 403, 'revoked'],
    [[membership({ membership_key: 'agency-a:attacker' })], 409, 'forged membership key'],
    [[membership({ user_email_normalized: 'other@agency.test' })], 409, 'wrong member email'],
    [[membership({ version: 0 })], 409, 'invalid version'],
    [[membership({ version: 1.5 })], 409, 'fractional version'],
    [[membership({ created_by_user_id: '' })], 409, 'missing creator provenance'],
    [[membership({ last_transition_by_user_id: 'owner-1 ' })], 409, 'non-exact transition actor'],
    [[membership({ last_transition_by_email_normalized: 'Owner@Platform.test' })], 409, 'non-normalized transition email'],
    [[membership({ last_transition_at: 'not-a-timestamp' })], 409, 'invalid transition timestamp'],
    [[membership({ last_transition_reason: '   ' })], 409, 'missing transition reason'],
    [[membership({ activated_at: undefined })], 409, 'missing activation timestamp'],
    [[membership({ tenant_role: 'owner' })], 409, 'unknown role'],
    [[membership({ status: 'unknown' })], 409, 'unknown status'],
  ]) {
    const runtime = await loadBroker({ memberships: rows });
    const result = await invokeBroker(runtime.handler);
    assert.equal(result.response.status, expectedStatus, label);
    assert.equal(runtime.calls.creates.length, 0, label);
  }
});

test('the exact Agency must be active or trial and filter regressions cannot substitute another tenant', async () => {
  for (const scenario of [
    { agencies: [], expectedStatus: 403, label: 'missing' },
    { agencies: [agency({ status: 'suspended' })], expectedStatus: 403, label: 'suspended' },
    { agencies: [agency({ status: 'cancelled' })], expectedStatus: 403, label: 'cancelled' },
    { agencies: [agency(), agency({ agency_name: 'Duplicate' })], expectedStatus: 409, label: 'duplicate' },
    {
      agencies: [agency({ id: 'agency-b' })],
      ignoreFilters: true,
      expectedStatus: 403,
      label: 'filter regression',
    },
  ]) {
    const runtime = await loadBroker(scenario);
    const result = await invokeBroker(runtime.handler);
    assert.equal(result.response.status, scenario.expectedStatus, scenario.label);
    assert.equal(runtime.calls.creates.length, 0, scenario.label);
  }

  const trial = await loadBroker({ agencies: [agency({ status: 'trial' })] });
  assert.equal((await invokeBroker(trial.handler)).response.status, 200);
  assert.equal(trial.calls.creates.length, 1);
});

test('membership and Agency authority are rechecked immediately before Patient.create', async () => {
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

  const agencySuspended = await loadBroker({
    agencyResponses: [[agency()], [agency({ status: 'suspended' })]],
  });
  const agencyResult = await invokeBroker(agencySuspended.handler);
  assert.equal(agencyResult.response.status, 403);
  assert.equal(agencySuspended.calls.creates.length, 0);
});

test('idempotent replay is authority-bound, detects payload conflicts, and rechecks authority', async () => {
  const replay = await loadBroker();
  const first = await invokeBroker(replay.handler);
  assert.equal(first.response.status, 200);
  assert.equal(first.json.created, true);
  const key = replay.calls.creates[0].patient_creation_key;

  const second = await invokeBroker(replay.handler);
  assert.equal(second.response.status, 200);
  assert.equal(second.json.created, false);
  assert.equal(second.json.patient.id, 'patient-1');
  assert.equal(replay.calls.creates.length, 1);
  assert.ok(replay.calls.patientFilters.some((call) => call.query?.patient_creation_key === key));

  const payloadConflict = await loadBroker();
  assert.equal((await invokeBroker(payloadConflict.handler)).response.status, 200);
  const conflictingResult = await invokeBroker(
    payloadConflict.handler,
    patientInput({ last_name: 'Byron' }),
  );
  assert.equal(conflictingResult.response.status, 409);
  assert.equal(payloadConflict.calls.creates.length, 1);

  const authorityConflict = await loadBroker();
  assert.equal((await invokeBroker(authorityConflict.handler)).response.status, 200);
  authorityConflict.state.patients[0].created_by_user_id = 'attacker';
  const authorityResult = await invokeBroker(authorityConflict.handler);
  assert.equal(authorityResult.response.status, 409);
  assert.equal(authorityConflict.calls.creates.length, 1);

  const revoked = membership({
    status: 'revoked',
    revoked_at: '2026-09-03T13:00:00.000Z',
    revocation_reason: 'Revoked during replay',
  });
  const revokedReplay = await loadBroker({
    membershipResponses: [[membership()], [membership()], [membership()], [revoked]],
  });
  assert.equal((await invokeBroker(revokedReplay.handler)).response.status, 200);
  const revokedReplayResult = await invokeBroker(revokedReplay.handler);
  assert.equal(revokedReplayResult.response.status, 403);
  assert.equal(revokedReplayResult.json.patient, undefined);
  assert.equal(revokedReplay.calls.creates.length, 1);
});

test('ambiguous replays fail closed and post-create stamp mismatches are removed', async () => {
  const ambiguous = await loadBroker();
  assert.equal((await invokeBroker(ambiguous.handler)).response.status, 200);
  ambiguous.state.patients.push({
    ...ambiguous.state.patients[0],
    id: 'patient-duplicate',
  });
  const ambiguousResult = await invokeBroker(ambiguous.handler);
  assert.equal(ambiguousResult.response.status, 409);
  assert.equal(ambiguous.calls.creates.length, 1);

  const mismatch = await loadBroker({ createdMutation: { agency_id: 'agency-b' } });
  const originalError = console.error;
  console.error = () => {};
  let mismatchResult;
  try {
    mismatchResult = await invokeBroker(mismatch.handler);
  } finally {
    console.error = originalError;
  }
  assert.equal(mismatchResult.response.status, 500);
  assert.deepEqual(mismatch.calls.deletes, ['patient-1']);
  assert.equal(mismatch.state.patients.length, 0);
});

test('bulk Patient import commit is hard-paused before file or Patient reads and writes', async () => {
  const source = await readFile(importUrl, 'utf8');
  const handlerStart = source.indexOf('Deno.serve');
  assert.notEqual(handlerStart, -1);
  const handler = source.slice(handlerStart);
  const dryRunIndex = handler.indexOf('const dryRun');
  const inlineFileReadIndex = handler.indexOf('cleanValue(body.file_content)');
  const patientAccessIndex = handler.search(/(?:asServiceRole\.)?entities\.Patient\.(?:list|filter|get|create|update|delete)\s*\(/);
  assert.ok(dryRunIndex >= 0, 'the handler must resolve preview versus commit mode');
  assert.ok(inlineFileReadIndex > dryRunIndex, 'inline file content must be read after mode resolution');
  assert.ok(patientAccessIndex > inlineFileReadIndex, 'Patient access must remain after the file-input boundary');

  const guardRegion = handler.slice(dryRunIndex, Math.min(inlineFileReadIndex, patientAccessIndex));
  assert.match(guardRegion, /if\s*\(\s*!dryRun\s*\)/);
  assert.match(guardRegion, /status\s*:\s*503/);
  assert.match(guardRegion, /(?:disabled|paused)/i);
});
