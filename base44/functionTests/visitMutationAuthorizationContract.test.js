import assert from 'node:assert/strict';
import { readFile, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { transpileTs } from '../../tools-transpile-ts.mjs';

const brokerUrl = new URL('../functions/updateAuthorizedVisit/entry.ts', import.meta.url);

const USER = {
  id: 'user-1',
  email: 'Clinician@Agency.test',
  role: 'user',
  is_active: true,
  is_verified: true,
};

const visit = (overrides = {}) => ({
  id: 'visit-a',
  patient_id: 'patient-a',
  agency_id: 'agency-a',
  created_by_user_id: 'user-1',
  created_by_user_email_normalized: 'clinician@agency.test',
  created_by: 'clinician@agency.test',
  visit_date: '2026-09-03',
  visit_type: 'routine_visit',
  status: 'scheduled',
  is_sample: false,
  nurse_notes: 'Assessment: Patient stable.',
  ...overrides,
});

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

async function importHandler(makeClient, superAdminEmail) {
  let source = await readFile(brokerUrl, 'utf8');
  source = source.replace(
    /import\s+\{\s*createClientFromRequest\s*\}\s+from\s+'npm:[^']+';/,
    'const createClientFromRequest = globalThis.__visitMutationMakeClient;',
  );
  const temporaryModule = join(
    tmpdir(),
    `visit_mutation_${Date.now()}_${Math.random().toString(36).slice(2)}.mjs`,
  );
  await writeFile(temporaryModule, transpileTs(source).outputText);

  let handler;
  globalThis.__visitMutationMakeClient = makeClient;
  globalThis.Deno = {
    env: { get: (name) => (name === 'SUPER_ADMIN_EMAIL' ? superAdminEmail : undefined) },
    serve: (candidate) => { handler = candidate; },
  };
  try {
    await import(pathToFileURL(temporaryModule).href);
  } finally {
    await unlink(temporaryModule).catch(() => {});
    delete globalThis.__visitMutationMakeClient;
  }
  assert.equal(typeof handler, 'function');
  return handler;
}

async function loadBroker({
  caller = USER,
  visits = [visit()],
  patients = [patient()],
  agencies = [agency()],
  memberships = [membership()],
  visitResponses = null,
  patientResponses = null,
  agencyResponses = null,
  membershipResponses = null,
  ignoreFilters = false,
  updateMutation = null,
  updateNoop = false,
  updateError = null,
  superAdminEmail = 'owner@platform.test',
} = {}) {
  const state = {
    visits: visits.map((row) => ({ ...row })),
    patients: patients.map((row) => ({ ...row })),
    agencies: agencies.map((row) => ({ ...row })),
    memberships: memberships.map((row) => ({ ...row })),
  };
  const calls = {
    visitFilters: [],
    patientFilters: [],
    agencyFilters: [],
    membershipFilters: [],
    updates: [],
  };
  const indexes = { visit: 0, patient: 0, agency: 0, membership: 0 };
  const filtered = (rows, query, limit) => {
    const matches = ignoreFilters
      ? rows
      : rows.filter((row) => Object.entries(query || {}).every(([key, value]) => row?.[key] === value));
    return Number.isFinite(limit) ? matches.slice(0, limit) : matches;
  };
  const responseRows = (kind, defaults, responses) => {
    if (!responses) return defaults;
    const index = Math.min(indexes[kind]++, responses.length - 1);
    return responses[index];
  };
  const entities = {
    Visit: {
      filter: async (query, sort, limit) => {
        calls.visitFilters.push({ query, sort, limit });
        const rows = responseRows('visit', state.visits, visitResponses);
        return filtered(rows, query, limit);
      },
      update: async (id, payload) => {
        calls.updates.push({ id, payload: structuredClone(payload) });
        if (updateError) throw updateError;
        const index = state.visits.findIndex((row) => row.id === id);
        if (index !== -1 && !updateNoop) {
          state.visits[index] = {
            ...state.visits[index],
            ...structuredClone(payload),
            ...(updateMutation || {}),
          };
        }
        return state.visits[index];
      },
    },
    Patient: {
      filter: async (query, sort, limit) => {
        calls.patientFilters.push({ query, sort, limit });
        const rows = responseRows('patient', state.patients, patientResponses);
        return filtered(rows, query, limit);
      },
    },
    Agency: {
      filter: async (query, sort, limit) => {
        calls.agencyFilters.push({ query, sort, limit });
        const rows = responseRows('agency', state.agencies, agencyResponses);
        return filtered(rows, query, limit);
      },
    },
    AgencyMembership: {
      filter: async (query, sort, limit) => {
        calls.membershipFilters.push({ query, sort, limit });
        const rows = responseRows('membership', state.memberships, membershipResponses);
        return filtered(rows, query, limit);
      },
    },
  };
  const client = {
    auth: {
      me: async () => {
        if (caller instanceof Error) throw caller;
        return caller;
      },
    },
    asServiceRole: { entities },
  };
  const handler = await importHandler(() => client, superAdminEmail);
  return { handler, calls, state };
}

async function invoke(handler, body, { method = 'POST', invalidJson = false } = {}) {
  const response = await handler(new Request('http://local/updateAuthorizedVisit', {
    method,
    headers: { 'content-type': 'application/json' },
    ...(method === 'GET' || method === 'HEAD'
      ? {}
      : { body: invalidJson ? '{' : JSON.stringify(body) }),
  }));
  return { response, json: await response.json() };
}

test('broker is POST-only and authentication fails closed without entity reads', async () => {
  const wrongMethod = await loadBroker();
  const get = await invoke(wrongMethod.handler, null, { method: 'GET' });
  assert.equal(get.response.status, 405);
  assert.equal(get.response.headers.get('allow'), 'POST');

  for (const caller of [null, new Error('expired')]) {
    const loaded = await loadBroker({ caller });
    const result = await invoke(loaded.handler, {
      visit_id: 'visit-a', action: 'reschedule', visit_time: '09:30',
    });
    assert.equal(result.response.status, 401);
    assert.equal(loaded.calls.visitFilters.length, 0);
    assert.equal(loaded.calls.updates.length, 0);
  }
});

test('deactivated, disabled, service, and unverified callers cannot mutate a Visit', async () => {
  for (const caller of [
    { ...USER, is_active: false },
    { ...USER, disabled: true },
    { ...USER, is_service: true },
    { ...USER, is_verified: false },
  ]) {
    const loaded = await loadBroker({ caller });
    const result = await invoke(loaded.handler, {
      visit_id: 'visit-a', action: 'reschedule', visit_time: '09:30',
    });
    assert.equal(result.response.status, 403);
    assert.equal(loaded.calls.updates.length, 0);
  }
});

test('request parser rejects malformed JSON, invalid identifiers, actions, and action-field smuggling', async () => {
  const invalidJson = await loadBroker();
  assert.equal((await invoke(invalidJson.handler, {}, { invalidJson: true })).response.status, 400);

  const cases = [
    [{ visit_id: '$where', action: 'reschedule', visit_time: '09:30' }, 400],
    [{ visit_id: 'visit-a', action: 'unknown', nurse_notes: 'x' }, 400],
    [{ visit_id: 'visit-a', action: 'toString', nurse_notes: 'x' }, 400],
    [{ visit_id: 'visit-a', action: '__proto__', nurse_notes: 'x' }, 400],
    [{ visit_id: 'visit-a', action: 'reschedule', visit_time: '09:30', agency_id: 'agency-b' }, 400],
    [{ visit_id: 'visit-a', action: 'save_documentation', created_by_user_id: 'attacker' }, 400],
    [{ visit_id: 'visit-a', action: 'set_review_ack', acknowledged: true, acknowledged_at: 'forged' }, 400],
    [{ visit_id: 'visit-a', action: 'set_review_ack', acknowledged: true }, 400],
    [{ visit_id: 'visit-a', action: 'set_review_ack', acknowledged: false, expected_note_hash: 'a'.repeat(64) }, 400],
    [{ visit_id: 'visit-a', action: 'advance_handoff', next_status: 'copied_to_emr', emr_handoff_history: [] }, 400],
  ];
  for (const [body, expected] of cases) {
    const loaded = await loadBroker();
    const result = await invoke(loaded.handler, body);
    assert.equal(result.response.status, expected, JSON.stringify(body));
    assert.equal(loaded.calls.visitFilters.length, 0);
    assert.equal(loaded.calls.updates.length, 0);
  }
});

test('save_documentation updates bounded clinical fields, treats patient_id only as an assertion, and narrows PHI response', async () => {
  const loaded = await loadBroker({ visits: [visit({ status: 'in_progress' })] });
  const result = await invoke(loaded.handler, {
    visit_id: 'visit-a',
    action: 'save_documentation',
    patient_id: 'patient-a',
    status: 'completed',
    grounding_pending: false,
    nurse_notes: 'Updated clinical note',
    vital_signs: { heart_rate: 78, oxygen_saturation: 97 },
    compliance_score: 92,
    compliance_issues: [],
    ai_tags: ['trend:heart_rate:stable'],
  });
  assert.equal(result.response.status, 200);
  assert.equal(result.json.updated, true);
  assert.equal(result.json.action, 'save_documentation');
  assert.equal(result.json.visit.patient_id, 'patient-a');
  assert.equal(result.json.visit.status, 'completed');
  assert.equal(result.json.visit.nurse_notes, undefined);
  assert.equal(loaded.calls.updates.length, 1);
  assert.equal(loaded.calls.updates[0].payload.patient_id, undefined);
  assert.equal(loaded.state.visits[0].agency_id, 'agency-a');
  assert.equal(loaded.state.visits[0].created_by_user_id, 'user-1');
  assert.equal(loaded.calls.visitFilters.length, 3);
  assert.equal(loaded.calls.patientFilters.length, 3);
  assert.equal(loaded.calls.agencyFilters.length, 3);
  assert.equal(loaded.calls.membershipFilters.length, 3);
  assert.equal(loaded.calls.updates[0].payload.documentation_review_ack, null);
});

test('save_documentation rejects foreign patient assertion and unsafe status/grounding transitions', async () => {
  const cases = [
    [visit(), { patient_id: 'patient-b', nurse_notes: 'x' }, 403],
    [visit(), { status: 'pending_review', grounding_pending: false }, 400],
    [visit({ status: 'pending_review', grounding_pending: true }), { status: 'completed' }, 400],
    [visit({ status: 'completed' }), { status: 'pending_review', grounding_pending: true }, 409],
    [visit({ status: 'cancelled' }), { nurse_notes: 'x' }, 409],
    [visit(), { compliance_score: 101 }, 400],
    [visit(), { vital_signs: { heart_rate: '78' } }, 400],
    [visit(), { ai_tags: ['duplicate', 'duplicate'] }, 400],
    [visit(), { ai_tags: ['semantic_tag'] }, 400],
  ];
  for (const [visitRow, fields, expected] of cases) {
    const loaded = await loadBroker({ visits: [visitRow] });
    const result = await invoke(loaded.handler, {
      visit_id: 'visit-a', action: 'save_documentation', ...fields,
    });
    assert.equal(result.response.status, expected, JSON.stringify(fields));
    assert.equal(loaded.calls.updates.length, 0);
  }
});

test('exact Visit, Patient, Agency, and membership authority fails closed', async () => {
  const cases = [
    { visits: [visit({ agency_id: null })], expected: 409 },
    { visits: [visit({ created_by: 'other@agency.test' })], expected: 409 },
    { visits: [visit({ is_sample: true })], expected: 409 },
    { patients: [patient({ agency_id: 'agency-b' })], expected: 403 },
    { patients: [patient({ status: 'inactive' })], expected: 403 },
    { agencies: [agency({ status: 'suspended' })], expected: 403 },
    { memberships: [membership({ status: 'revoked', revoked_at: '2026-09-04T00:00:00.000Z', revocation_reason: 'Offboarded' })], expected: 403 },
    { memberships: [membership(), membership({ id: 'membership-b' })], expected: 409 },
    { memberships: [membership({ membership_key: 'agency-b:user-1' })], expected: 409 },
    { memberships: [membership({ user_email_normalized: 'other@agency.test' })], expected: 409 },
  ];
  for (const options of cases) {
    const loaded = await loadBroker(options);
    const result = await invoke(loaded.handler, {
      visit_id: 'visit-a', action: 'reschedule', visit_time: '09:30',
    });
    assert.equal(result.response.status, options.expected, JSON.stringify(options));
    assert.equal(loaded.calls.updates.length, 0);
  }
});

test('foreign rows returned by a faulty filter do not become authority', async () => {
  const loaded = await loadBroker({
    visits: [visit({ id: 'visit-foreign', agency_id: 'agency-b' })],
    ignoreFilters: true,
  });
  const result = await invoke(loaded.handler, {
    visit_id: 'visit-a', action: 'reschedule', visit_time: '09:30',
  });
  assert.equal(result.response.status, 403);
  assert.equal(loaded.calls.updates.length, 0);
});

test('owner or assigned clinician can mutate, while unrelated clinicians cannot and tenant managers are agency-wide', async () => {
  const unrelated = await loadBroker({
    visits: [visit({ created_by_user_id: 'owner-2', created_by_user_email_normalized: 'owner2@agency.test', created_by: 'owner2@agency.test' })],
    patients: [patient({ assigned_nurses: [] })],
  });
  assert.equal((await invoke(unrelated.handler, {
    visit_id: 'visit-a', action: 'reschedule', visit_time: '09:30',
  })).response.status, 403);

  const manager = await loadBroker({
    visits: [visit({ created_by_user_id: 'owner-2', created_by_user_email_normalized: 'owner2@agency.test', created_by: 'owner2@agency.test' })],
    patients: [patient({ assigned_nurses: [] })],
    memberships: [membership({ tenant_role: 'manager' })],
  });
  assert.equal((await invoke(manager.handler, {
    visit_id: 'visit-a', action: 'reschedule', visit_time: '09:30',
  })).response.status, 200);

  const managerClinical = await loadBroker({
    memberships: [membership({ tenant_role: 'manager' })],
    visits: [visit({ status: 'completed' })],
  });
  assert.equal((await invoke(managerClinical.handler, {
    visit_id: 'visit-a', action: 'save_documentation', nurse_notes: 'Manager edit',
  })).response.status, 403);

  const officeClinical = await loadBroker({
    memberships: [membership({ tenant_role: 'office_staff' })],
    visits: [visit({ status: 'completed' })],
  });
  assert.equal((await invoke(officeClinical.handler, {
    visit_id: 'visit-a', action: 'set_review_ack', acknowledged: false,
  })).response.status, 403);
});

test('authorization is rechecked immediately before write and revoked or changed authority wins the race', async () => {
  const revoked = membership({
    status: 'revoked',
    revoked_at: '2026-09-04T00:00:00.000Z',
    revocation_reason: 'Offboarded during request',
  });
  const membershipRace = await loadBroker({ membershipResponses: [[membership()], [revoked]] });
  assert.equal((await invoke(membershipRace.handler, {
    visit_id: 'visit-a', action: 'reschedule', visit_time: '09:30',
  })).response.status, 403);
  assert.equal(membershipRace.calls.updates.length, 0);

  const changedOwner = visit({
    created_by_user_id: 'owner-2',
    created_by_user_email_normalized: 'owner2@agency.test',
    created_by: 'owner2@agency.test',
  });
  const identityRace = await loadBroker({
    visitResponses: [[visit()], [changedOwner]],
    patients: [patient({ assigned_nurses: ['clinician@agency.test'] })],
  });
  assert.equal((await invoke(identityRace.handler, {
    visit_id: 'visit-a', action: 'reschedule', visit_time: '09:30',
  })).response.status, 409);
  assert.equal(identityRace.calls.updates.length, 0);
});

test('post-write role or assignment drift cannot receive a successful mutation response', async () => {
  const changedRole = membership({
    tenant_role: 'manager',
    version: 3,
    last_transition_at: '2026-09-04T12:00:00.000Z',
    last_transition_reason: 'Role changed during request',
  });
  const roleDrift = await loadBroker({
    visits: [visit({ status: 'completed' })],
    membershipResponses: [[membership()], [membership()], [changedRole]],
  });
  const roleResult = await invoke(roleDrift.handler, {
    visit_id: 'visit-a', action: 'save_documentation', nurse_notes: 'Updated note',
  });
  assert.equal(roleResult.response.status, 403);
  assert.equal(roleDrift.calls.updates.length, 1);

  const foreignOwnedVisit = visit({
    created_by_user_id: 'owner-2',
    created_by_user_email_normalized: 'owner2@agency.test',
    created_by: 'owner2@agency.test',
  });
  const accessDrift = await loadBroker({
    visits: [foreignOwnedVisit],
    patientResponses: [
      [patient()],
      [patient()],
      [patient({ assigned_nurses: [] })],
    ],
  });
  const accessResult = await invoke(accessDrift.handler, {
    visit_id: 'visit-a', action: 'reschedule', visit_time: '09:30',
  });
  assert.equal(accessResult.response.status, 403);
  assert.equal(accessDrift.calls.updates.length, 1);
});

test('reschedule accepts only exact 24-hour time and only while stored status is scheduled', async () => {
  const valid = await loadBroker();
  const result = await invoke(valid.handler, {
    visit_id: 'visit-a', action: 'reschedule', visit_time: '09:45',
  });
  assert.equal(result.response.status, 200);
  assert.deepEqual(valid.calls.updates[0].payload, { visit_time: '09:45' });
  assert.equal(valid.state.visits[0].status, 'scheduled');

  for (const [row, visitTime, expected] of [
    [visit(), '9:45 AM', 400],
    [visit(), '24:00', 400],
    [visit({ status: 'completed' }), '09:45', 409],
  ]) {
    const loaded = await loadBroker({ visits: [row] });
    assert.equal((await invoke(loaded.handler, {
      visit_id: 'visit-a', action: 'reschedule', visit_time: visitTime,
    })).response.status, expected);
    assert.equal(loaded.calls.updates.length, 0);
  }
});

test('set_ai_tags additionally requires exact configured protected built-in admin identity', async () => {
  const ordinary = await loadBroker();
  assert.equal((await invoke(ordinary.handler, {
    visit_id: 'visit-a', action: 'set_ai_tags', ai_tags: ['wound_care'],
  })).response.status, 403);

  const owner = {
    id: 'owner-1', email: 'Owner@Platform.test', role: 'admin', is_active: true, is_verified: true,
  };
  const ownerMembership = membership({
    id: 'membership-owner',
    membership_key: 'agency-a:owner-1',
    user_id: 'owner-1',
    user_email_normalized: 'owner@platform.test',
    tenant_role: 'agency_admin',
  });
  const protectedOwner = await loadBroker({ caller: owner, memberships: [ownerMembership] });
  const result = await invoke(protectedOwner.handler, {
    visit_id: 'visit-a', action: 'set_ai_tags', ai_tags: ['wound_care', 'trend:pain:down'],
  });
  assert.equal(result.response.status, 200);
  assert.deepEqual(protectedOwner.calls.updates[0].payload.ai_tags, ['wound_care', 'trend:pain:down']);

  const missingConfig = await loadBroker({
    caller: owner, memberships: [ownerMembership], superAdminEmail: null,
  });
  assert.equal((await invoke(missingConfig.handler, {
    visit_id: 'visit-a', action: 'set_ai_tags', ai_tags: ['wound_care'],
  })).response.status, 403);
});

test('advance_handoff is immediate and forward-only and server appends actor/time history', async () => {
  const loaded = await loadBroker();
  const result = await invoke(loaded.handler, {
    visit_id: 'visit-a', action: 'advance_handoff', next_status: 'copied_to_emr',
  });
  assert.equal(result.response.status, 200);
  const payload = loaded.calls.updates[0].payload;
  assert.equal(payload.emr_handoff_status, 'copied_to_emr');
  assert.equal(payload.emr_handoff_history.length, 1);
  assert.equal(payload.emr_handoff_history[0].reported_by, 'clinician@agency.test');
  assert.equal(payload.emr_handoff_history[0].self_reported, true);
  assert.ok(Number.isFinite(Date.parse(payload.emr_handoff_history[0].reported_at)));

  const jump = await loadBroker();
  assert.equal((await invoke(jump.handler, {
    visit_id: 'visit-a', action: 'advance_handoff', next_status: 'signed_in_emr',
  })).response.status, 409);

  const corrupt = await loadBroker({
    visits: [visit({ emr_handoff_status: 'reviewed_in_emr', emr_handoff_history: [] })],
  });
  assert.equal((await invoke(corrupt.handler, {
    visit_id: 'visit-a', action: 'advance_handoff', next_status: 'signed_in_emr',
  })).response.status, 409);
  assert.equal(corrupt.calls.updates.length, 0);

  const skippedHistory = await loadBroker({
    visits: [visit({
      emr_handoff_status: 'reviewed_in_emr',
      emr_handoff_history: [{
        status: 'reviewed_in_emr',
        reported_by: 'clinician@agency.test',
        reported_at: '2026-09-03T12:00:00.000Z',
        self_reported: true,
        note: '',
      }],
    })],
  });
  assert.equal((await invoke(skippedHistory.handler, {
    visit_id: 'visit-a', action: 'advance_handoff', next_status: 'signed_in_emr',
  })).response.status, 409);
});

test('set_review_ack derives hash, length, actor, and time from stored note and withdrawal clears it', async () => {
  const helloSha256 = '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824';
  const acknowledge = await loadBroker({ visits: [visit({ status: 'completed', nurse_notes: 'hello' })] });
  const result = await invoke(acknowledge.handler, {
    visit_id: 'visit-a',
    action: 'set_review_ack',
    acknowledged: true,
    nurse_edited: true,
    expected_note_hash: helloSha256,
  });
  assert.equal(result.response.status, 200);
  const ack = acknowledge.calls.updates[0].payload.documentation_review_ack;
  assert.equal(ack.acknowledged, true);
  assert.equal(ack.acknowledged_by, 'clinician@agency.test');
  assert.equal(ack.note_hash, '4f9f2cab');
  assert.equal(ack.note_sha256, helloSha256);
  assert.equal(ack.note_length, 5);
  assert.equal(ack.ai_assisted, true);
  assert.equal(ack.nurse_edited, true);
  assert.equal(ack.is_clinical_signature, false);
  assert.ok(Number.isFinite(Date.parse(ack.acknowledged_at)));
  assert.match(ack.statement, /reviewed this suggested documentation/i);
  assert.equal(result.json.visit.review_acknowledged, true);

  const withdraw = await loadBroker({
    visits: [visit({ status: 'completed', documentation_review_ack: ack })],
  });
  const withdrawn = await invoke(withdraw.handler, {
    visit_id: 'visit-a', action: 'set_review_ack', acknowledged: false,
  });
  assert.equal(withdrawn.response.status, 200);
  assert.deepEqual(withdraw.calls.updates[0].payload, { documentation_review_ack: null });
  assert.equal(withdrawn.json.visit.review_acknowledged, false);

  const blank = await loadBroker({ visits: [visit({ status: 'completed', nurse_notes: '' })] });
  assert.equal((await invoke(blank.handler, {
    visit_id: 'visit-a', action: 'set_review_ack', acknowledged: true,
    expected_note_hash: helloSha256,
  })).response.status, 409);

  const stale = await loadBroker({ visits: [visit({ status: 'completed', nurse_notes: 'changed' })] });
  assert.equal((await invoke(stale.handler, {
    visit_id: 'visit-a', action: 'set_review_ack', acknowledged: true,
    expected_note_hash: helloSha256,
  })).response.status, 409);
  assert.equal(stale.calls.updates.length, 0);

  const changedDuringWrite = await loadBroker({
    visits: [visit({ status: 'completed', nurse_notes: 'hello' })],
    updateMutation: { nurse_notes: 'concurrent edit' },
  });
  assert.equal((await invoke(changedDuringWrite.handler, {
    visit_id: 'visit-a', action: 'set_review_ack', acknowledged: true,
    expected_note_hash: helloSha256,
  })).response.status, 409);
  assert.equal(changedDuringWrite.calls.updates.length, 2);
  assert.deepEqual(changedDuringWrite.calls.updates[1].payload, { documentation_review_ack: null });
});

test('legacy_recovery remains default-off before every entity call so queued clinical work is retained', async () => {
  const loaded = await loadBroker();
  const result = await invoke(loaded.handler, {
    visit_id: 'visit-a',
    action: 'legacy_recovery',
    visit_date: '2026-09-04',
    visit_type: 'prn',
    status: 'pending_review',
    grounding_pending: true,
    nurse_notes: 'Recovered offline note',
    vital_signs: { temperature: 98.6 },
  });
  assert.equal(result.response.status, 503);
  assert.match(result.json.error, /paused/i);
  assert.equal(loaded.calls.visitFilters.length, 0);
  assert.equal(loaded.calls.patientFilters.length, 0);
  assert.equal(loaded.calls.agencyFilters.length, 0);
  assert.equal(loaded.calls.membershipFilters.length, 0);
  assert.equal(loaded.calls.updates.length, 0);
});

test('exact post-update readback rejects no-op or mutated writes instead of claiming success', async () => {
  const noOp = await loadBroker({ updateNoop: true });
  const noOpResult = await invoke(noOp.handler, {
    visit_id: 'visit-a', action: 'reschedule', visit_time: '09:30',
  });
  assert.equal(noOpResult.response.status, 500);

  const corrupt = await loadBroker({ updateMutation: { agency_id: 'agency-b' } });
  const corruptResult = await invoke(corrupt.handler, {
    visit_id: 'visit-a', action: 'reschedule', visit_time: '09:30',
  });
  assert.equal(corruptResult.response.status, 403);
});

test('source pins service-role exact filters, two-phase authorization, server-derived workflow audit, and immutable exclusions', async () => {
  const source = await readFile(brokerUrl, 'utf8');
  assert.match(source, /base44\.asServiceRole\.entities/);
  assert.match(source, /Visit\.filter\(\{ id: visitId \}/);
  assert.match(source, /Patient\.filter\(\{ id: patientId \}/);
  assert.match(source, /Agency\.filter\(\{ id: agencyId \}/);
  assert.match(source, /AgencyMembership\.filter\([\s\S]*\{ user_id: userId, agency_id: agencyId \}/);
  assert.equal((source.match(/loadAuthorizedBundle\(/g) || []).length >= 3, true);
  assert.match(source, /new Date\(\)\.toISOString\(\)/);
  assert.match(source, /note_hash: fnv1a\(note\)/, 'legacy UI stale detection remains compatible');
  assert.match(source, /note_sha256: noteSha256/, 'ack evidence must use collision-resistant binding');
  assert.match(source, /Object\.hasOwn\(ACTION_FIELDS, body\.action\)/);
  assert.match(source, /if \(action === 'legacy_recovery'\) \{[\s\S]*?503/);
  assert.match(source, /legacy_recovery:\s*new Set\(\)/);
  assert.doesNotMatch(source, /LEGACY_RECOVERY_FIELDS/);
  assert.match(source, /requireActionPolicy\(input\.action, rechecked/);
  assert.match(source, /requireActionPolicy\(input\.action, updated/);
  assert.equal((source.match(/authoritySignature\(/g) || []).length >= 5, true);
});
