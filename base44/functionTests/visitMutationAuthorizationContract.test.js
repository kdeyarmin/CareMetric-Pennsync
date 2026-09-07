import assert from 'node:assert/strict';
import { readFile, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { transpileTs } from '../../tools-transpile-ts.mjs';

const brokerUrl = new URL('../functions/updateAuthorizedVisit/entry.ts', import.meta.url);
const processorUrl = new URL('../functions/processCompletedVisit/entry.ts', import.meta.url);
const INTERNAL_SECRET = 'internal-visit-test-secret-0123456789abcdef';
const UPDATED_AT = '2026-09-03T12:00:00.000Z';

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
  updated_date: UPDATED_AT,
  ...overrides,
});

const patient = (overrides = {}) => ({
  id: 'patient-a',
  agency_id: 'agency-a',
  status: 'active',
  assigned_nurses: ['clinician@agency.test'],
  first_name: 'Pat',
  last_name: 'Example',
  primary_diagnosis: 'Heart failure',
  updated_date: UPDATED_AT,
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

const assignment = (overrides = {}) => ({
  id: 'assignment-a',
  assignment_key: 'agency-a:patient-a:user-1',
  agency_id: 'agency-a',
  patient_id: 'patient-a',
  user_id: 'user-1',
  user_email_normalized: 'clinician@agency.test',
  assignee_membership_id: 'membership-a',
  assignee_membership_version_at_enablement: 2,
  status: 'active',
  source: 'manual',
  created_by_user_id: 'owner-1',
  created_by_user_email_normalized: 'owner@platform.test',
  activated_at: '2026-09-03T12:00:00.000Z',
  last_transition_by_user_id: 'owner-1',
  last_transition_by_email_normalized: 'owner@platform.test',
  last_transition_at: '2026-09-03T12:00:00.000Z',
  last_transition_reason: 'Assigned for direct care',
  last_transition_action: 'grant',
  last_transition_request_id: 'assignment-request-a',
  last_transition_request_key: 'agency-a:patient-a:user-1:assignment-request-a',
  version: 1,
  updated_date: '2026-09-03T12:00:00.000Z',
  ...overrides,
});

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
}

async function completedVisitSourceSha256(visitRow, patientRow) {
  const source = canonicalize({
    protocol: 'completed_visit_ai_source_v1',
    agency_id: visitRow.agency_id,
    visit: {
      id: visitRow.id,
      patient_id: visitRow.patient_id,
      visit_date: visitRow.visit_date ?? null,
      visit_type: visitRow.visit_type ?? null,
      status: visitRow.status ?? null,
      nurse_notes: typeof visitRow.nurse_notes === 'string' ? visitRow.nurse_notes : '',
      raw_transcription:
        typeof visitRow.raw_transcription === 'string' ? visitRow.raw_transcription : '',
      vital_signs: visitRow.vital_signs && typeof visitRow.vital_signs === 'object'
        && !Array.isArray(visitRow.vital_signs) ? visitRow.vital_signs : {},
      documentation_review_ack:
        visitRow.documentation_review_ack && typeof visitRow.documentation_review_ack === 'object'
          && !Array.isArray(visitRow.documentation_review_ack)
          ? visitRow.documentation_review_ack
          : null,
    },
    patient: {
      id: patientRow.id,
      agency_id: patientRow.agency_id,
      first_name: typeof patientRow.first_name === 'string' ? patientRow.first_name : '',
      last_name: typeof patientRow.last_name === 'string' ? patientRow.last_name : '',
      primary_diagnosis:
        typeof patientRow.primary_diagnosis === 'string' ? patientRow.primary_diagnosis : '',
      updated_date: patientRow.updated_date,
    },
  });
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(JSON.stringify(source)),
  );
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function aiClaim(visitRow = visit({ status: 'completed' }), patientRow = patient()) {
  const sourceSha256 = await completedVisitSourceSha256(visitRow, patientRow);
  return {
    sourceSha256,
    claimToken: `visit-ai-v1:${sourceSha256}:0123456789abcdef`,
  };
}

async function importHandler(makeClient, superAdminEmail, internalSecret) {
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
    env: {
      get: (name) => {
        if (name === 'SUPER_ADMIN_EMAIL') return superAdminEmail;
        if (name === 'INTERNAL_FN_SECRET') return internalSecret;
        return undefined;
      },
    },
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
  assignments = [assignment()],
  visitResponses = null,
  patientResponses = null,
  agencyResponses = null,
  membershipResponses = null,
  assignmentResponses = null,
  ignoreFilters = false,
  updateMutation = null,
  updateNoop = false,
  updateError = null,
  updateOutcome = null,
  superAdminEmail = 'owner@platform.test',
  internalSecret = INTERNAL_SECRET,
} = {}) {
  const state = {
    visits: visits.map((row) => ({ ...row })),
    patients: patients.map((row) => ({ ...row })),
    agencies: agencies.map((row) => ({ ...row })),
    memberships: memberships.map((row) => ({ ...row })),
    assignments: assignments.map((row) => ({ ...row })),
  };
  const calls = {
    visitFilters: [],
    patientFilters: [],
    agencyFilters: [],
    membershipFilters: [],
    assignmentFilters: [],
    updates: [],
  };
  const indexes = {
    visit: 0,
    patient: 0,
    agency: 0,
    membership: 0,
    assignment: 0,
  };
  const sameValue = (left, right) => JSON.stringify(canonicalize(left)) === JSON.stringify(canonicalize(right));
  const queryMatches = (row, query) => Object.entries(query || {}).every(([key, value]) => {
    if (value && typeof value === 'object' && !Array.isArray(value) && value.$exists === false) {
      return !Object.hasOwn(row, key);
    }
    return sameValue(row?.[key], value);
  });
  const filtered = (rows, query, limit) => {
    const matches = ignoreFilters
      ? rows
      : rows.filter((row) => queryMatches(row, query));
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
      updateMany: async (query, update) => {
        const payload = structuredClone(update?.$set || {});
        calls.updates.push({ id: query?.id, query: structuredClone(query), payload });
        if (updateError) throw updateError;
        if (updateOutcome) return structuredClone(updateOutcome);
        const matchingIndexes = state.visits
          .map((row, index) => (queryMatches(row, query) ? index : -1))
          .filter((index) => index !== -1);
        if (matchingIndexes.length === 1 && !updateNoop) {
          const index = matchingIndexes[0];
          state.visits[index] = {
            ...state.visits[index],
            ...structuredClone(payload),
            ...(updateMutation || {}),
          };
        }
        return {
          success: true,
          updated: matchingIndexes.length === 1 && !updateNoop ? 1 : 0,
          has_more: false,
        };
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
    PatientCareTeamAssignment: {
      filter: async (query, sort, limit) => {
        calls.assignmentFilters.push({ query, sort, limit });
        const rows = responseRows('assignment', state.assignments, assignmentResponses);
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
  const handler = await importHandler(() => client, superAdminEmail, internalSecret);
  return { handler, calls, state };
}

async function invoke(handler, body, {
  method = 'POST',
  invalidJson = false,
  headers = {},
} = {}) {
  const response = await handler(new Request('http://local/updateAuthorizedVisit', {
    method,
    headers: { 'content-type': 'application/json', ...headers },
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
  assert.equal(result.response.headers.get('cache-control'), 'no-store');
  assert.equal(result.response.headers.get('pragma'), 'no-cache');
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
  assert.equal(loaded.calls.assignmentFilters.length, 3);
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
    { memberships: [membership({ revoked_at: '2026-09-04T00:00:00.000Z', revocation_reason: 'Polluted terminal metadata' })], expected: 409 },
    { memberships: [membership(), membership({ id: 'membership-b' })], expected: 409 },
    { memberships: [membership({ membership_key: 'agency-b:user-1' })], expected: 409 },
    { memberships: [membership({ user_email_normalized: 'other@agency.test' })], expected: 409 },
    { assignments: [], expected: 403 },
    { assignments: [assignment({ assignment_key: 'forged' })], expected: 403 },
    { assignments: [assignment({ assignee_membership_version_at_enablement: 1 })], expected: 409 },
    { assignments: [assignment({ version: 2 })], expected: 409 },
    { assignments: [assignment({ revoked_at: '2026-09-04T00:00:00.000Z', revocation_reason: 'Polluted terminal metadata' })], expected: 409 },
    { assignments: [assignment({
      status: 'suspended',
      suspended_at: '2026-09-04T00:00:00.000Z',
      last_transition_at: '2026-09-04T00:00:00.000Z',
      last_transition_action: 'suspend',
      version: 2,
    })], expected: 403 },
    { assignments: [assignment(), assignment({ id: 'assignment-b' })], expected: 409 },
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

test('only canonically assigned clinicians can mutate, while tenant managers remain agency-wide', async () => {
  const unrelated = await loadBroker({
    assignments: [],
  });
  assert.equal((await invoke(unrelated.handler, {
    visit_id: 'visit-a', action: 'reschedule', visit_time: '09:30',
  })).response.status, 403);

  const manager = await loadBroker({
    visits: [visit({ created_by_user_id: 'owner-2', created_by_user_email_normalized: 'owner2@agency.test', created_by: 'owner2@agency.test' })],
    memberships: [membership({ tenant_role: 'manager' })],
    assignments: [],
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
  const revokedAssignment = assignment({
    status: 'revoked',
    revoked_at: '2026-09-04T12:00:00.000Z',
    revocation_reason: 'Revoked during request',
    last_transition_at: '2026-09-04T12:00:00.000Z',
    last_transition_reason: 'Revoked during request',
    last_transition_action: 'revoke',
    version: 2,
    updated_date: '2026-09-04T12:00:00.000Z',
  });
  const accessDrift = await loadBroker({
    visits: [foreignOwnedVisit],
    assignmentResponses: [
      [assignment()],
      [assignment()],
      [revokedAssignment],
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

test('completed-visit AI actions require the server-only secret before entity access', async () => {
  const sourceSha256 = 'a'.repeat(64);
  const claimToken = `visit-ai-v1:${sourceSha256}:0123456789abcdef`;
  for (const [internalSecret, providedSecret, expectedStatus] of [
    [null, INTERNAL_SECRET, 500],
    [INTERNAL_SECRET, 'wrong-internal-secret-0123456789abcdef', 403],
    [INTERNAL_SECRET, undefined, 403],
  ]) {
    const loaded = await loadBroker({
      internalSecret,
      visits: [visit({ status: 'completed' })],
    });
    const result = await invoke(loaded.handler, {
      visit_id: 'visit-a',
      action: 'claim_ai_processing',
      claim_token: claimToken,
      expected_source_sha256: sourceSha256,
    }, {
      headers: providedSecret ? { 'x-internal-secret': providedSecret } : {},
    });
    assert.equal(result.response.status, expectedStatus);
    assert.equal(loaded.calls.visitFilters.length, 0);
    assert.equal(loaded.calls.updates.length, 0);
  }
});

test('completed-visit AI source read is finite, server-derived, and reauthorized', async () => {
  const completedVisit = visit({ status: 'completed', vital_signs: { heart_rate: 72 } });
  const completedPatient = patient();
  const expectedSha256 = await completedVisitSourceSha256(completedVisit, completedPatient);
  const loaded = await loadBroker({ visits: [completedVisit], patients: [completedPatient] });
  const result = await invoke(loaded.handler, {
    visit_id: 'visit-a', action: 'read_ai_processing_source',
  }, { headers: { 'x-internal-secret': INTERNAL_SECRET } });

  assert.equal(result.response.status, 200);
  assert.equal(result.response.headers.get('cache-control'), 'no-store');
  assert.equal(result.response.headers.get('pragma'), 'no-cache');
  assert.equal(result.json.updated, false);
  assert.equal(result.json.source_sha256, expectedSha256);
  assert.deepEqual(result.json.processing, { claimed_by: null, processed_at: null });
  assert.deepEqual(Object.keys(result.json.source), ['agency_id', 'patient', 'protocol', 'visit']);
  assert.equal(result.json.source.patient.assigned_nurses, undefined);
  assert.equal(loaded.calls.visitFilters.length, 3);
  assert.equal(loaded.calls.assignmentFilters.length, 3);
  assert.equal(loaded.calls.updates.length, 0);
});

test('completed-visit AI claim and publication use narrow authorized broker actions', async () => {
  const completedVisit = visit({ status: 'completed' });
  const completedPatient = patient();
  const { sourceSha256, claimToken } = await aiClaim(completedVisit, completedPatient);
  const claim = await loadBroker({ visits: [completedVisit], patients: [completedPatient] });
  const claimed = await invoke(claim.handler, {
    visit_id: 'visit-a',
    action: 'claim_ai_processing',
    claim_token: claimToken,
    expected_source_sha256: sourceSha256,
  }, { headers: { 'x-internal-secret': INTERNAL_SECRET } });
  assert.equal(claimed.response.status, 200);
  assert.equal(claimed.json.visit.ai_process_claimed_by, claimToken);
  assert.equal(claimed.json.visit.ai_processed_at, null);
  assert.deepEqual(claim.calls.updates[0].payload, {
    ai_process_claimed_by: claimToken,
  });
  assert.equal(claim.calls.updates[0].query.updated_date, UPDATED_AT);

  const processedAt = '2026-09-07T12:34:56.000Z';
  const publish = await loadBroker({
    visits: [visit({ status: 'completed', ai_process_claimed_by: claimToken })],
  });
  const published = await invoke(publish.handler, {
    visit_id: 'visit-a',
    action: 'publish_ai_processing',
    claim_token: claimToken,
    expected_source_sha256: sourceSha256,
    nurse_notes: 'Generated Medicare-compliant narrative.',
    raw_transcription: 'Original dictated note.',
    ai_tags: ['stable', 'teaching'],
    ai_processed_at: processedAt,
  }, { headers: { 'x-internal-secret': INTERNAL_SECRET } });
  assert.equal(published.response.status, 200);
  assert.equal(published.json.visit.ai_process_claimed_by, claimToken);
  assert.equal(published.json.visit.ai_processed_at, processedAt);
  assert.deepEqual(publish.calls.updates[0].payload, {
    nurse_notes: 'Generated Medicare-compliant narrative.',
    ai_tags: ['stable', 'teaching'],
    ai_processed_at: processedAt,
    documentation_review_ack: null,
    raw_transcription: 'Original dictated note.',
  });
});

test('completed-visit AI publication rejects a mismatched claim or unapproved tag', async () => {
  const completedVisit = visit({ status: 'completed' });
  const { sourceSha256, claimToken } = await aiClaim(completedVisit, patient());
  const mismatched = await loadBroker({
    visits: [visit({ status: 'completed', ai_process_claimed_by: 'claim-other' })],
  });
  const body = {
    visit_id: 'visit-a',
    action: 'publish_ai_processing',
    claim_token: claimToken,
    expected_source_sha256: sourceSha256,
    nurse_notes: 'Generated narrative.',
    ai_tags: ['stable'],
    ai_processed_at: '2026-09-07T12:34:56.000Z',
  };
  assert.equal((await invoke(mismatched.handler, body, {
    headers: { 'x-internal-secret': INTERNAL_SECRET },
  })).response.status, 409);
  assert.equal(mismatched.calls.updates.length, 0);

  const invalidTag = await loadBroker({
    visits: [visit({ status: 'completed', ai_process_claimed_by: claimToken })],
  });
  assert.equal((await invoke(invalidTag.handler, {
    ...body,
    ai_tags: ['model-invented-tag'],
  }, {
    headers: { 'x-internal-secret': INTERNAL_SECRET },
  })).response.status, 400);
  assert.equal(invalidTag.calls.visitFilters.length, 0);
  assert.equal(invalidTag.calls.updates.length, 0);
});

test('completed-visit AI claim is single-winner and publication rejects source drift', async () => {
  const originalVisit = visit({ status: 'completed', nurse_notes: 'Original source note.' });
  const { sourceSha256, claimToken } = await aiClaim(originalVisit, patient());
  const alreadyClaimed = await loadBroker({
    visits: [visit({
      status: 'completed',
      nurse_notes: 'Original source note.',
      ai_process_claimed_by: claimToken,
    })],
  });
  const contenderToken = `visit-ai-v1:${sourceSha256}:fedcba9876543210`;
  const contender = await invoke(alreadyClaimed.handler, {
    visit_id: 'visit-a',
    action: 'claim_ai_processing',
    claim_token: contenderToken,
    expected_source_sha256: sourceSha256,
  }, { headers: { 'x-internal-secret': INTERNAL_SECRET } });
  assert.equal(contender.response.status, 409);
  assert.equal(alreadyClaimed.calls.updates.length, 0);

  const changedVisit = visit({
    status: 'completed',
    nurse_notes: 'Concurrent clinician edit.',
    ai_process_claimed_by: claimToken,
  });
  const drifted = await loadBroker({ visits: [changedVisit] });
  const publish = await invoke(drifted.handler, {
    visit_id: 'visit-a',
    action: 'publish_ai_processing',
    claim_token: claimToken,
    expected_source_sha256: sourceSha256,
    nurse_notes: 'Stale generated narrative.',
    ai_tags: ['stable'],
    ai_processed_at: '2026-09-07T12:34:56.000Z',
  }, { headers: { 'x-internal-secret': INTERNAL_SECRET } });
  assert.equal(publish.response.status, 409);
  assert.equal(drifted.calls.updates.length, 0);
  assert.equal(drifted.state.visits[0].nurse_notes, 'Concurrent clinician edit.');
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
  assert.equal(noOpResult.response.status, 409);

  const corrupt = await loadBroker({ updateMutation: { agency_id: 'agency-b' } });
  const corruptResult = await invoke(corrupt.handler, {
    visit_id: 'visit-a', action: 'reschedule', visit_time: '09:30',
  });
  assert.equal(corruptResult.response.status, 403);
});

test('source pins service-role exact filters, two-phase authorization, server-derived workflow audit, and immutable exclusions', async () => {
  const source = await readFile(brokerUrl, 'utf8');
  assert.match(source, /base44\.asServiceRole\.entities/);
  assert.match(source, /Visit\.updateMany\(/);
  assert.doesNotMatch(source, /Visit\.update\(/);
  assert.match(source, /VISIT_MUTATION_PREIMAGE_FIELDS/);
  assert.match(source, /visitMutationPreimage\(before\)/);
  assert.match(source, /visitMutationQuery\(preimage\)/);
  assert.match(source, /value\.updated === 1/);
  assert.match(source, /value\.has_more === false/);
  assert.match(source, /documentation_review_ack: null/);
  assert.match(source, /completed_visit_ai_source_v1/);
  assert.match(source, /read_ai_processing_source/);
  assert.match(source, /expected_source_sha256/);
  assert.match(source, /Visit\.filter\(\{ id: visitId \}/);
  assert.match(source, /Patient\.filter\(\{ id: patientId \}/);
  assert.match(source, /Agency\.filter\(\{ id: agencyId \}/);
  assert.match(source, /AgencyMembership\.filter\([\s\S]*\{ user_id: userId, agency_id: agencyId \}/);
  assert.match(source, /PatientCareTeamAssignment\.filter\([\s\S]*assignment_key: key/);
  assert.doesNotMatch(source, /(?:patient|bundle\.patient)\.assigned_nurses/);
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

test('processCompletedVisit remains paused and delegates both Visit writes to the broker', async () => {
  const source = await readFile(processorUrl, 'utf8');
  assert.match(source, /const PROCESS_COMPLETED_VISIT_PAUSED = true/);
  assert.match(source, /functions\.fetch\('\/updateAuthorizedVisit'/);
  assert.match(source, /action:\s*'claim_ai_processing'/);
  assert.match(source, /action:\s*'publish_ai_processing'/);
  assert.match(source, /action:\s*'read_ai_processing_source'/);
  assert.match(source, /expected_source_sha256:\s*sourceSha256/);
  assert.match(source, /'x-internal-secret': internalSecret/);
  assert.doesNotMatch(source, /entities\.Visit\.update\(/);
  assert.doesNotMatch(source, /entities\.Visit\.(?:get|filter)\(/);
  assert.doesNotMatch(source, /entities\.Patient\.(?:get|filter)\(/);
  assert.match(source, /console\.error\('processCompletedVisit failed'\)/);
  assert.doesNotMatch(
    source,
    /console\.error\([^\n]*(?:error|err)\b/,
    'provider and SDK errors can retain PHI-bearing LLM prompts and must not enter logs',
  );
});
