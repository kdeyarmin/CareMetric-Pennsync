import assert from 'node:assert/strict';
import { extname, join } from 'node:path';
import { readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { transpileTs } from '../../tools-transpile-ts.mjs';

const brokerUrl = new URL('../functions/updateAuthorizedPatient/entry.ts', import.meta.url);
const sourceRootUrl = new URL('../../src/', import.meta.url);

const USER = {
  id: 'user-1',
  email: 'Clinician@Agency.test',
  role: 'user',
  is_active: true,
  is_verified: true,
};

const UPDATED_AT = '2026-09-03T12:00:00.000Z';

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
  last_transition_at: '2026-09-03T11:00:00.000Z',
  last_transition_reason: 'Approved tenant membership',
  activated_at: '2026-09-03T11:00:00.000Z',
  version: 2,
  ...overrides,
});

const agency = (overrides = {}) => ({
  id: 'agency-a',
  agency_name: 'Agency A',
  status: 'active',
  ...overrides,
});

const patient = (overrides = {}) => ({
  id: 'patient-a',
  agency_id: 'agency-a',
  created_by_user_id: 'creator-1',
  created_by_user_email_normalized: 'creator@agency.test',
  created_by: 'creator@agency.test',
  client_request_id: 'create-request-a',
  patient_creation_key: 'agency-a:creator-1:create-request-a',
  first_name: 'Ada',
  middle_name: '',
  last_name: 'Lovelace',
  email: 'ada@example.test',
  status: 'active',
  care_type: 'home_health',
  clinical_notes: 'Existing chart note',
  assigned_nurses: ['clinician@agency.test'],
  is_sample: false,
  is_archived: false,
  updated_date: UPDATED_AT,
  ...overrides,
});

const requestBody = (overrides = {}) => {
  const {
    action = 'edit_demographics',
    changes = { first_name: 'Grace' },
    actions = null,
    ...rest
  } = overrides;
  return {
    patient_id: 'patient-a',
    expected_updated_date: UPDATED_AT,
    ...rest,
    actions: actions || [{ action, changes }],
  };
};

async function importHandler(makeClient) {
  let source = await readFile(brokerUrl, 'utf8');
  source = source.replace(
    /import\s+\{\s*createClientFromRequest\s*\}\s+from\s+'npm:[^']+';/,
    'const createClientFromRequest = globalThis.__patientMutationMakeClient;',
  );
  const temporaryModule = join(
    tmpdir(),
    `patient_mutation_${Date.now()}_${Math.random().toString(36).slice(2)}.mjs`,
  );
  await writeFile(temporaryModule, transpileTs(source).outputText);

  let handler;
  globalThis.__patientMutationMakeClient = makeClient;
  globalThis.Deno = { serve: (candidate) => { handler = candidate; } };
  try {
    await import(pathToFileURL(temporaryModule).href);
  } finally {
    await unlink(temporaryModule).catch(() => {});
    delete globalThis.__patientMutationMakeClient;
  }
  assert.equal(typeof handler, 'function');
  return handler;
}

async function loadBroker({
  caller = USER,
  memberships = [membership()],
  agencies = [agency()],
  patients = [patient()],
  ignoreFilters = false,
  membershipResponses = null,
  agencyResponses = null,
  patientResponses = null,
  updateMutation = null,
} = {}) {
  const clone = (rows) => Array.isArray(rows) ? rows.map((row) => structuredClone(row)) : rows;
  const state = {
    memberships: clone(memberships),
    agencies: clone(agencies),
    patients: clone(patients),
  };
  const calls = {
    membershipFilters: [],
    agencyFilters: [],
    patientFilters: [],
    updates: [],
  };
  let membershipIndex = 0;
  let agencyIndex = 0;
  let patientIndex = 0;

  const selectedResponse = (responses, index, fallback) => {
    if (!responses) return fallback;
    return responses[Math.min(index, responses.length - 1)];
  };
  const filter = (rows, query, limit) => {
    if (!Array.isArray(rows)) return rows;
    const matches = ignoreFilters
      ? rows
      : rows.filter((row) => Object.entries(query || {}).every(
        ([field, value]) => row?.[field] === value,
      ));
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
        AgencyMembership: {
          filter: async (query, sort, limit) => {
            calls.membershipFilters.push({ query, sort, limit });
            const rows = selectedResponse(
              membershipResponses,
              membershipIndex++,
              state.memberships,
            );
            return filter(clone(rows), query, limit);
          },
        },
        Agency: {
          filter: async (query, sort, limit) => {
            calls.agencyFilters.push({ query, sort, limit });
            const rows = selectedResponse(agencyResponses, agencyIndex++, state.agencies);
            return filter(clone(rows), query, limit);
          },
        },
        Patient: {
          filter: async (query, sort, limit) => {
            calls.patientFilters.push({ query, sort, limit });
            const rows = selectedResponse(patientResponses, patientIndex++, state.patients);
            return filter(clone(rows), query, limit);
          },
          update: async (id, payload) => {
            calls.updates.push({ id, payload: structuredClone(payload) });
            const row = state.patients.find((candidate) => candidate.id === id);
            if (!row) throw new Error('Patient not found in test state');
            Object.assign(row, structuredClone(payload));
            row.updated_date = `2026-09-03T12:00:0${calls.updates.length}.000Z`;
            if (typeof updateMutation === 'function') updateMutation(row, payload);
            else if (updateMutation) Object.assign(row, structuredClone(updateMutation));
            return structuredClone(row);
          },
        },
      },
    },
  };

  const handler = await importHandler(() => client);
  return { handler, calls, state };
}

async function invoke(handler, body = requestBody(), { method = 'POST', invalidJson = false } = {}) {
  const request = new Request('http://local/updateAuthorizedPatient', {
    method,
    headers: { 'content-type': 'application/json' },
    ...(method === 'GET' || method === 'HEAD'
      ? {}
      : { body: invalidJson ? '{' : JSON.stringify(body) }),
  });
  const response = await handler(request);
  return { response, json: await response.json() };
}

async function sourceFiles(directoryUrl) {
  const output = [];
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (
        ['.js', '.jsx', '.ts', '.tsx'].includes(extname(entry.name))
        && !/\.(?:test|spec)\.[jt]sx?$/.test(entry.name)
      ) {
        output.push(path);
      }
    }
  }
  await walk(directoryUrl.pathname);
  return output;
}

function section(source, start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from);
  assert.notEqual(from, -1, `${start} marker is required`);
  assert.notEqual(to, -1, `${end} marker is required`);
  return source.slice(from, to);
}

test('the broker exposes only reviewed finite actions and never applies a broad caller patch', async () => {
  const source = await readFile(brokerUrl, 'utf8');
  const policy = section(
    source,
    '// <<<BEGIN PATIENT MUTATION ACTION POLICY>>>',
    '// <<<END PATIENT MUTATION ACTION POLICY>>>',
  );
  const fieldPolicy = section(
    policy,
    'const ACTION_FIELD_NAMES',
    'const ACTION_ROLE_NAMES',
  );
  const actionNames = [...fieldPolicy.matchAll(/^\s{2}([a-z_]+):\s*\[/gm)]
    .map((match) => match[1]);
  assert.deepEqual(actionNames, [
    'edit_demographics',
    'edit_clinical_profile',
    'edit_care_episode',
    'edit_insurance',
    'set_primary_diagnosis',
    'change_status',
  ]);

  for (const forbidden of [
    'agency_id',
    'created_by_user_id',
    'created_by_user_email_normalized',
    'created_by',
    'client_request_id',
    'patient_creation_key',
    'is_sample',
    'is_archived',
    'assigned_nurses',
    'merged_into_id',
    'merged_at',
    'merged_by',
    'risk_predict_claimed_by',
    'care_plans_gen_claimed_by',
    'care_plan_monitor_claimed_by',
    'compliance_monitor_claimed_by',
    'active_alerts',
    'enhanced_notes_history',
    'risk_assessment',
    'validation_overrides',
    'data_completeness_score',
    'missing_critical_fields',
    'clinical_notes',
    'clinical_note',
    'backfill_from_duplicate',
    'append_clinical_note',
    'archive',
    'chronic_conditions',
    'past_surgeries',
    'current_medications',
    'past_hospitalizations',
    'family_medical_history',
    'social_determinants',
    'baseline_vitals',
    'functional_status',
    'social_history',
    'mental_health',
    'pain_management',
    'wounds',
    'advance_directives',
    'insurance_primary',
    'insurance_secondary',
  ]) {
    assert.doesNotMatch(fieldPolicy, new RegExp(`['"]${forbidden}['"]`), forbidden);
  }

  assert.match(source, /Object\.hasOwn\(ACTION_FIELD_NAMES, action\)/);
  assert.match(source, /keys\.some\(\(key\) => !allowedFields\.has\(key\)\)/);
  assert.match(source, /record\.actions\.length > ACTIONS\.size/);
  assert.match(source, /seenActions\.has\(action\)/);
  assert.match(source, /buildBatchMutation/);
  assert.match(source, /entities\.Patient\.update\(input\.patientId, mutation\)/);
  assert.doesNotMatch(source, /Patient\.update\([^,]+,\s*(?:input|record|body|payload|changes)(?:\.|\)|,)/);
  assert.doesNotMatch(source, /Object\.assign\(mutation,\s*(?:input\.)?changes\)/);
  assert.doesNotMatch(source, /\.\.\.(?:input\.)?changes/);
  const clinicalFields = fieldPolicy.match(/edit_clinical_profile:\s*\[([\s\S]*?)\],/);
  assert.ok(clinicalFields);
  assert.doesNotMatch(clinicalFields[1], /primary_diagnosis/);
  assert.match(source, /Date\.parse\(String\(after\.updated_date/);
  assert.match(source, /medical_record_number already belongs to another Patient/);
});

test('production browser source contains no direct Patient.update bypass', async () => {
  const root = sourceRootUrl.pathname;
  const direct = [];
  for (const path of await sourceFiles(sourceRootUrl)) {
    const source = await readFile(path, 'utf8');
    if (/\b(?:base44\.)?entities\.Patient\.update\s*\(/.test(source)) {
      direct.push(path.slice(root.length).replace(/\\/g, '/'));
    }
  }
  assert.deepEqual(direct, [], `direct Patient.update bypasses: ${direct.join(', ')}`);
});

test('POST and an authenticated active verified non-service identity are required before reads', async () => {
  const methodLoad = await loadBroker();
  const methodResult = await invoke(methodLoad.handler, null, { method: 'GET' });
  assert.equal(methodResult.response.status, 405);
  assert.equal(methodResult.response.headers.get('allow'), 'POST');
  assert.deepEqual(methodLoad.calls.membershipFilters, []);

  for (const caller of [
    { ...USER, is_active: false },
    { ...USER, disabled: true },
    { ...USER, is_service: true },
    { ...USER, is_verified: false },
    { email: USER.email, is_verified: true },
  ]) {
    const loaded = await loadBroker({ caller });
    const result = await invoke(loaded.handler);
    assert.equal(result.response.status, 403);
    assert.deepEqual(loaded.calls.membershipFilters, []);
    assert.deepEqual(loaded.calls.updates, []);
  }
});

test('a related clinician can update only action-allowlisted demographics', async () => {
  const { handler, calls } = await loadBroker();
  const { response, json } = await invoke(handler, requestBody({
    changes: { first_name: 'Grace', email: 'Grace@Example.test' },
  }));

  assert.equal(response.status, 200);
  assert.equal(json.success, true);
  assert.deepEqual(json.changed_fields, ['email', 'first_name']);
  assert.deepEqual(calls.updates, [{
    id: 'patient-a',
    payload: { first_name: 'Grace', email: 'grace@example.test' },
  }]);
  assert.equal(json.patient.first_name, 'Grace');
  assert.equal(json.patient.assigned_nurses, undefined);
  assert.equal(json.patient.clinical_notes, undefined);
  assert.ok(calls.membershipFilters.length >= 3, 'authority must be checked initially, pre-write, and post-write');
  assert.ok(calls.agencyFilters.length >= 3, 'Agency must be checked initially, pre-write, and post-write');
  for (const call of calls.membershipFilters) {
    assert.deepEqual(call.query, { user_id: 'user-1' });
    assert.equal(Object.hasOwn(call.query, 'status'), false);
  }
  for (const call of calls.patientFilters) {
    assert.deepEqual(call.query, { id: 'patient-a', agency_id: 'agency-a' });
  }
});

test('a finite action batch is canonicalized, authorized in full, and written once', async () => {
  const loaded = await loadBroker();
  const result = await invoke(loaded.handler, requestBody({
    actions: [
      { action: 'edit_care_episode', changes: { admission_date: '2026-09-02' } },
      { action: 'edit_clinical_profile', changes: { allergies: 'Penicillin' } },
      { action: 'edit_demographics', changes: { first_name: 'Grace' } },
    ],
  }));

  assert.equal(result.response.status, 200);
  assert.equal(result.json.action, 'batch');
  assert.deepEqual(result.json.actions, [
    'edit_demographics',
    'edit_clinical_profile',
    'edit_care_episode',
  ]);
  assert.deepEqual(loaded.calls.updates, [{
    id: 'patient-a',
    payload: {
      first_name: 'Grace',
      allergies: 'Penicillin',
      admission_date: '2026-09-02',
    },
  }]);
});

test('the complete batch is rejected before mutation when one action or final lifecycle is invalid', async () => {
  const invalidShapes = [
    requestBody({ actions: [] }),
    requestBody({ actions: [
      { action: 'edit_demographics', changes: { first_name: 'Grace' } },
      { action: 'edit_demographics', changes: { last_name: 'Hopper' } },
    ] }),
    requestBody({ actions: [
      { action: 'unreviewed_action', changes: { first_name: 'Grace' } },
    ] }),
    requestBody({ actions: [
      { action: 'edit_demographics', changes: { first_name: 'Grace' }, extra: true },
    ] }),
  ];
  for (const body of invalidShapes) {
    const loaded = await loadBroker();
    const result = await invoke(loaded.handler, body);
    assert.equal(result.response.status, 400);
    assert.deepEqual(loaded.calls.membershipFilters, []);
    assert.deepEqual(loaded.calls.updates, []);
  }

  const office = await loadBroker({
    memberships: [membership({ tenant_role: 'office_staff' })],
  });
  const officeResult = await invoke(office.handler, requestBody({ actions: [
    { action: 'edit_demographics', changes: { first_name: 'Grace' } },
    { action: 'edit_clinical_profile', changes: { allergies: 'Penicillin' } },
  ] }));
  assert.equal(officeResult.response.status, 403);
  assert.deepEqual(office.calls.updates, []);

  const invalidFinalLifecycle = await loadBroker();
  const lifecycleResult = await invoke(invalidFinalLifecycle.handler, requestBody({ actions: [
    { action: 'edit_care_episode', changes: { admission_date: '2026-09-05' } },
    {
      action: 'change_status',
      changes: {
        status: 'discharged',
        discharge_date: '2026-09-04',
        discharge_disposition: 'home',
      },
    },
  ] }));
  assert.equal(lifecycleResult.response.status, 409);
  assert.deepEqual(invalidFinalLifecycle.calls.updates, []);
});

test('protected fields and broad payload aliases are rejected before entity reads', async () => {
  const cases = [
    requestBody({ changes: { first_name: 'Grace', agency_id: 'agency-b' } }),
    requestBody({ changes: { assigned_nurses: ['attacker@example.test'] } }),
    requestBody({ changes: { risk_predict_claimed_by: 'attacker' } }),
    requestBody({
      action: 'edit_clinical_profile',
      changes: { primary_diagnosis: 'Bypass dedicated action' },
    }),
    requestBody({
      action: 'set_primary_diagnosis',
      changes: { primary_diagnosis: 'I10', clinical_note: 'Unsafe append' },
    }),
    requestBody({
      action: 'edit_clinical_profile',
      changes: { baseline_vitals: { blood_pressure: '120/80' } },
    }),
    { ...requestBody(), data: { first_name: 'Mallory' } },
    { ...requestBody(), payload: { first_name: 'Mallory' } },
  ];
  for (const body of cases) {
    const loaded = await loadBroker();
    const result = await invoke(loaded.handler, body);
    assert.equal(result.response.status, 400);
    assert.deepEqual(loaded.calls.membershipFilters, []);
    assert.deepEqual(loaded.calls.updates, []);
  }
});

test('paused append, archive, and duplicate workflows are not live actions', async () => {
  for (const body of [
    {
      action: 'backfill_from_duplicate',
      patient_id: 'patient-a',
      expected_updated_date: UPDATED_AT,
      changes: { first_name: 'Copied' },
    },
    {
      action: 'append_clinical_note',
      patient_id: 'patient-a',
      expected_updated_date: UPDATED_AT,
      changes: { note: 'Unsafe append' },
    },
    {
      action: 'archive',
      patient_id: 'patient-a',
      expected_updated_date: UPDATED_AT,
      changes: { status: 'archived' },
    },
  ]) {
    const loaded = await loadBroker();
    const result = await invoke(loaded.handler, body);
    assert.equal(result.response.status, 400);
    assert.deepEqual(loaded.calls.membershipFilters, []);
    assert.deepEqual(loaded.calls.patientFilters, []);
    assert.deepEqual(loaded.calls.updates, []);
  }
});

test('all membership lifecycle states are inspected and ambiguity fails closed', async () => {
  const revokedDuplicate = membership({
    id: 'membership-revoked',
    status: 'revoked',
    revoked_at: '2026-09-03T11:30:00.000Z',
    revocation_reason: 'Revoked duplicate',
  });
  const duplicateLoad = await loadBroker({
    memberships: [membership(), revokedDuplicate],
  });
  const duplicateResult = await invoke(duplicateLoad.handler);
  assert.equal(duplicateResult.response.status, 409);
  assert.deepEqual(duplicateLoad.calls.updates, []);

  const secondActive = membership({
    id: 'membership-b',
    membership_key: 'agency-b:user-1',
    agency_id: 'agency-b',
  });
  const multiLoad = await loadBroker({ memberships: [membership(), secondActive] });
  const multiResult = await invoke(multiLoad.handler);
  assert.equal(multiResult.response.status, 409);
  assert.deepEqual(multiLoad.calls.updates, []);

  const selectedLoad = await loadBroker({ memberships: [membership(), secondActive] });
  const selectedResult = await invoke(selectedLoad.handler, requestBody({ agency_id: 'agency-a' }));
  assert.equal(selectedResult.response.status, 200);
  assert.equal(selectedLoad.calls.updates.length, 1);
});

test('foreign Patient rows remain unavailable even if service filters regress', async () => {
  const loaded = await loadBroker({
    patients: [patient({ agency_id: 'agency-b' })],
    ignoreFilters: true,
  });
  const result = await invoke(loaded.handler, requestBody({ agency_id: 'agency-a' }));

  assert.equal(result.response.status, 403);
  assert.deepEqual(loaded.calls.updates, []);
});

test('role and care-team access are action-specific and office staff stay nonclinical', async () => {
  const unassigned = await loadBroker({
    patients: [patient({ assigned_nurses: [] })],
  });
  const unassignedResult = await invoke(unassigned.handler);
  assert.equal(unassignedResult.response.status, 403);
  assert.deepEqual(unassigned.calls.updates, []);

  const officeClinical = await loadBroker({
    memberships: [membership({ tenant_role: 'office_staff' })],
  });
  const officeResult = await invoke(officeClinical.handler, requestBody({
    action: 'edit_clinical_profile',
    changes: { allergies: 'penicillin' },
  }));
  assert.equal(officeResult.response.status, 403);
  assert.deepEqual(officeClinical.calls.updates, []);

  const manager = await loadBroker({
    memberships: [membership({ tenant_role: 'manager' })],
    patients: [patient({ assigned_nurses: [] })],
  });
  const managerResult = await invoke(manager.handler);
  assert.equal(managerResult.response.status, 200);
  assert.equal(manager.calls.updates.length, 1);

  const officeStatus = await loadBroker({
    memberships: [membership({ tenant_role: 'office_staff' })],
  });
  const officeStatusResult = await invoke(officeStatus.handler, requestBody({
    action: 'change_status',
    changes: { status: 'hospitalized' },
  }));
  assert.equal(officeStatusResult.response.status, 403);
  assert.deepEqual(officeStatus.calls.updates, []);
});

test('sample, archived, and clinically inactive Patient records fail closed', async () => {
  const cases = [
    { row: patient({ is_sample: true }), body: requestBody(), status: 409 },
    {
      row: patient({ is_archived: true, status: 'archived' }),
      body: requestBody(),
      status: 403,
    },
    {
      row: patient({
        status: 'discharged',
        discharge_date: '2026-09-03',
        discharge_disposition: 'home',
      }),
      body: requestBody({
        action: 'edit_clinical_profile',
        changes: { allergies: 'none known' },
      }),
      status: 409,
    },
  ];
  for (const { row, body, status } of cases) {
    const loaded = await loadBroker({ patients: [row] });
    const result = await invoke(loaded.handler, body);
    assert.equal(result.response.status, status);
    assert.deepEqual(loaded.calls.updates, []);
  }
});

test('status transitions and discharge fields follow explicit lifecycle rules', async () => {
  const statusLoad = await loadBroker();
  const statusResult = await invoke(statusLoad.handler, requestBody({
    action: 'change_status',
    changes: { status: 'hospitalized' },
  }));
  assert.equal(statusResult.response.status, 200);
  assert.deepEqual(statusLoad.calls.updates[0].payload, { status: 'hospitalized' });

  const incompleteDischarge = await loadBroker();
  const incompleteResult = await invoke(incompleteDischarge.handler, requestBody({
    action: 'change_status',
    changes: { status: 'discharged' },
  }));
  assert.equal(incompleteResult.response.status, 400);
  assert.deepEqual(incompleteDischarge.calls.updates, []);

  const dischargeLoad = await loadBroker({
    patients: [patient({ admission_date: '2026-09-01' })],
  });
  const dischargeResult = await invoke(dischargeLoad.handler, requestBody({
    action: 'change_status',
    changes: {
      status: 'discharged',
      discharge_date: '2026-09-03',
      discharge_disposition: 'home',
    },
  }));
  assert.equal(dischargeResult.response.status, 200);
  assert.deepEqual(dischargeLoad.calls.updates[0].payload, {
    status: 'discharged',
    discharge_date: '2026-09-03',
    discharge_disposition: 'home',
  });

  const terminalLoad = await loadBroker({
    patients: [patient({
      status: 'discharged',
      discharge_date: '2026-09-03',
      discharge_disposition: 'home',
    })],
  });
  const terminalResult = await invoke(terminalLoad.handler, requestBody({
    action: 'change_status',
    changes: { status: 'active' },
  }));
  assert.equal(terminalResult.response.status, 409);
  assert.deepEqual(terminalLoad.calls.updates, []);

  const hospitalizedCareType = await loadBroker({
    patients: [patient({ status: 'hospitalized' })],
  });
  const careTypeResult = await invoke(hospitalizedCareType.handler, requestBody({
    action: 'edit_care_episode',
    changes: { care_type: 'hospice' },
  }));
  assert.equal(careTypeResult.response.status, 409);
  assert.deepEqual(hospitalizedCareType.calls.updates, []);

  const invalidAdmissionSource = await loadBroker();
  const invalidAdmissionResult = await invoke(invalidAdmissionSource.handler, requestBody({
    action: 'edit_care_episode',
    changes: { admission_source: 'unreviewed_source' },
  }));
  assert.equal(invalidAdmissionResult.response.status, 400);
  assert.deepEqual(invalidAdmissionSource.calls.updates, []);

  const inconsistentLifecycle = await loadBroker({
    patients: [patient({ discharge_date: '2026-09-03' })],
  });
  const inconsistentResult = await invoke(inconsistentLifecycle.handler);
  assert.equal(inconsistentResult.response.status, 409);
  assert.deepEqual(inconsistentLifecycle.calls.updates, []);
});

test('stale Patient versions and pre-write membership revocation block mutation', async () => {
  const staleLoad = await loadBroker();
  const staleResult = await invoke(staleLoad.handler, requestBody({
    expected_updated_date: '2026-09-03T10:00:00.000Z',
  }));
  assert.equal(staleResult.response.status, 409);
  assert.deepEqual(staleLoad.calls.updates, []);

  const revoked = membership({
    status: 'revoked',
    revoked_at: '2026-09-03T11:30:00.000Z',
    revocation_reason: 'Access revoked during request',
    version: 3,
  });
  const revokedLoad = await loadBroker({
    membershipResponses: [[membership()], [revoked]],
  });
  const revokedResult = await invoke(revokedLoad.handler);
  assert.equal(revokedResult.response.status, 403);
  assert.deepEqual(revokedLoad.calls.updates, []);
});

test('medical record number changes perform an agency-scoped collision check', async () => {
  const collisionLoad = await loadBroker({
    patients: [
      patient({ medical_record_number: 'MRN-OLD' }),
      patient({
        id: 'patient-b',
        medical_record_number: 'MRN-NEW',
        assigned_nurses: [],
      }),
    ],
  });
  const collisionResult = await invoke(collisionLoad.handler, requestBody({
    changes: { medical_record_number: 'MRN-NEW' },
  }));
  assert.equal(collisionResult.response.status, 409);
  assert.deepEqual(collisionLoad.calls.updates, []);
  assert.ok(collisionLoad.calls.patientFilters.some((call) => (
    call.query.agency_id === 'agency-a'
    && call.query.medical_record_number === 'MRN-NEW'
  )));

  const foreignLoad = await loadBroker({
    patients: [
      patient({ medical_record_number: 'MRN-OLD' }),
      patient({
        id: 'patient-foreign',
        agency_id: 'agency-b',
        medical_record_number: 'MRN-NEW',
        assigned_nurses: [],
      }),
    ],
  });
  const foreignResult = await invoke(foreignLoad.handler, requestBody({
    changes: { medical_record_number: 'MRN-NEW' },
  }));
  assert.equal(foreignResult.response.status, 200);
  assert.equal(foreignLoad.calls.updates.length, 1);
});

test('post-write authority and exact readback are verified before success', async () => {
  const revoked = membership({
    status: 'revoked',
    revoked_at: '2026-09-03T11:30:00.000Z',
    revocation_reason: 'Access revoked during request',
    version: 3,
  });
  const revokedAfterWrite = await loadBroker({
    membershipResponses: [[membership()], [membership()], [revoked]],
  });
  const revokedResult = await invoke(revokedAfterWrite.handler);
  assert.equal(revokedResult.response.status, 403);
  assert.equal(revokedAfterWrite.calls.updates.length, 1);

  const protectedMutation = await loadBroker({ updateMutation: { agency_id: 'agency-b' } });
  const protectedResult = await invoke(protectedMutation.handler);
  assert.equal(protectedResult.response.status, 403);
  assert.equal(protectedMutation.calls.updates.length, 1);

  const wrongField = await loadBroker({ updateMutation: { first_name: 'Tampered' } });
  const originalError = console.error;
  console.error = () => {};
  try {
    const wrongResult = await invoke(wrongField.handler);
    assert.equal(wrongResult.response.status, 500);
    assert.equal(wrongField.calls.updates.length, 1);
  } finally {
    console.error = originalError;
  }

  const staleReadback = await loadBroker({
    updateMutation: (row) => { row.updated_date = UPDATED_AT; },
  });
  console.error = () => {};
  try {
    const staleReadbackResult = await invoke(staleReadback.handler);
    assert.equal(staleReadbackResult.response.status, 500);
    assert.equal(staleReadback.calls.updates.length, 1);
  } finally {
    console.error = originalError;
  }
});
