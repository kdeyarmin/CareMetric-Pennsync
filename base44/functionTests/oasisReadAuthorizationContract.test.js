import assert from 'node:assert/strict';
import { readdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import JSON5 from 'json5';
import { transpileTs } from '../../tools-transpile-ts.mjs';

const brokerUrl = new URL('../functions/readAuthorizedOASISAssessments/entry.ts', import.meta.url);
const wrapperUrl = new URL('../../src/functions/readAuthorizedOASISAssessments.js', import.meta.url);
const entityUrl = new URL('../entities/OASISAssessment.jsonc', import.meta.url);
const sourceRootUrl = new URL('../../src/', import.meta.url);

const NOW = '2026-09-04T12:00:00.000Z';
const USER = {
  id: 'user-a',
  email: 'Clinician@Agency.test',
  role: 'user',
  is_active: true,
  is_verified: true,
  // Deliberately mutable legacy claims; the broker must never authorize them.
  agency_id: 'agency-claim',
  tenant_role: 'agency_admin',
};

const membership = (overrides = {}) => ({
  id: 'membership-a',
  membership_key: 'agency-a:user-a',
  agency_id: 'agency-a',
  user_id: 'user-a',
  user_email_normalized: 'clinician@agency.test',
  tenant_role: 'clinician',
  status: 'active',
  created_by_user_id: 'owner-a',
  activated_at: '2026-09-04T10:00:00.000Z',
  last_transition_by_user_id: 'owner-a',
  last_transition_by_email_normalized: 'owner@platform.test',
  last_transition_at: '2026-09-04T10:00:00.000Z',
  last_transition_reason: 'Approved tenant membership',
  version: 2,
  ...overrides,
});

const agency = (overrides = {}) => ({
  id: 'agency-a',
  status: 'active',
  ...overrides,
});

const patient = (overrides = {}) => {
  const row = {
    id: 'patient-a',
    agency_id: 'agency-a',
    created_by_user_id: 'user-a',
    created_by_user_email_normalized: 'clinician@agency.test',
    created_by: 'clinician@agency.test',
    client_request_id: 'patient-create-a',
    patient_creation_key: 'agency-a:user-a:patient-create-a',
    is_sample: false,
    is_archived: false,
    status: 'active',
    updated_date: NOW,
    ...overrides,
  };
  return row;
};

const assignment = (overrides = {}) => {
  const row = {
    id: 'assignment-a',
    assignment_key: 'agency-a:patient-a:user-a',
    agency_id: 'agency-a',
    patient_id: 'patient-a',
    user_id: 'user-a',
    user_email_normalized: 'clinician@agency.test',
    assignee_membership_id: 'membership-a',
    assignee_membership_version_at_enablement: 2,
    status: 'active',
    source: 'manual',
    created_by_user_id: 'manager-a',
    created_by_user_email_normalized: 'manager@agency.test',
    activated_at: '2026-09-04T10:30:00.000Z',
    last_transition_by_user_id: 'manager-a',
    last_transition_by_email_normalized: 'manager@agency.test',
    last_transition_at: '2026-09-04T10:30:00.000Z',
    last_transition_reason: 'Assigned for direct care',
    last_transition_action: 'grant',
    last_transition_request_id: 'assignment-request-a',
    last_transition_request_key: 'agency-a:patient-a:user-a:assignment-request-a',
    version: 1,
    ...overrides,
  };
  if (row.status === 'suspended') {
    row.suspended_at ??= '2026-09-04T11:00:00.000Z';
    row.last_transition_action = overrides.last_transition_action ?? 'suspend';
  }
  if (row.status === 'revoked') {
    row.revoked_at ??= '2026-09-04T11:00:00.000Z';
    row.revocation_reason ??= 'Removed from care team';
    row.last_transition_action = overrides.last_transition_action ?? 'revoke';
  }
  return row;
};

const verifiedItem = (overrides = {}) => ({
  definition_id: 'm1830_cms_e2',
  item_number: 'M1830',
  item_name: 'Bathing',
  item_source: 'cms_item',
  item_spec_version: 'oasis-e2',
  response_schema_id: 'pennsync-oasis-response-v2-cms-e2',
  response_shape: 'single',
  response_value: { code: '01' },
  response_origin: 'clinician_selected',
  selected_by: 'clinician@agency.test',
  selected_at: '2026-09-04T11:30:00.000Z',
  ai_suggested: false,
  ...overrides,
});

const assessment = (overrides = {}) => ({
  id: 'assessment-a',
  agency_id: 'agency-a',
  patient_id: 'patient-a',
  visit_id: 'visit-a',
  visit_type: 'Start of Care',
  assessment_date: '2026-09-04',
  status: 'in_progress',
  completion_percentage: 25,
  response_schema_id: 'pennsync-oasis-response-v2-cms-e2',
  instrument_version: 'oasis-e2',
  response_schema_source: 'final-oasis-e2-all-item-04-01-2026',
  migration_status: 'native_v2',
  last_written_by: 'clinician@agency.test',
  last_written_at: NOW,
  oasis_items: [verifiedItem()],
  clinical_summary: 'must never leave the broker',
  estimated_pdgm_group: 'must never leave the broker',
  created_by: 'clinician@agency.test',
  created_date: '2026-09-04T11:00:00.000Z',
  updated_date: NOW,
  ...overrides,
});

function matches(row, query) {
  return Object.entries(query || {}).every(([field, value]) => row?.[field] === value);
}

function sortRows(rows, sort) {
  if (sort !== '-assessment_date') return rows;
  return [...rows].sort((left, right) => (
    String(right?.assessment_date || '').localeCompare(String(left?.assessment_date || ''))
  ));
}

async function importHandler(makeClient, superAdminEmail = null) {
  let source = await readFile(brokerUrl, 'utf8');
  const globalName = `__oasisReadClient_${Math.random().toString(36).slice(2)}`;
  source = source.replace(
    /import\s+\{\s*createClientFromRequest\s*\}\s+from\s+'npm:[^']+';/,
    `const createClientFromRequest = globalThis.${globalName};`,
  );
  const temporaryModule = join(
    tmpdir(),
    `oasis_read_${Date.now()}_${Math.random().toString(36).slice(2)}.mjs`,
  );
  await writeFile(temporaryModule, transpileTs(source).outputText);

  let handler;
  globalThis[globalName] = makeClient;
  globalThis.Deno = {
    serve: (candidate) => { handler = candidate; },
    env: { get: (name) => name === 'SUPER_ADMIN_EMAIL' ? superAdminEmail : null },
  };
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
  callers = null,
  memberships = [membership()],
  membershipResponses = null,
  agencies = [agency()],
  agencyResponses = null,
  patients = [patient()],
  patientResponses = null,
  assignments = [],
  assignmentResponses = null,
  assessments = [assessment()],
  assessmentResponses = null,
  ignoreFilters = false,
  ignoreSort = false,
  superAdminEmail = null,
  assessmentError = null,
} = {}) {
  const clone = (value) => structuredClone(value);
  const calls = {
    auth: 0,
    serviceRole: 0,
    memberships: [],
    agencies: [],
    patients: [],
    assignments: [],
    assessments: [],
  };
  let membershipIndex = 0;
  let agencyIndex = 0;
  let patientIndex = 0;
  let assignmentIndex = 0;
  let assessmentIndex = 0;
  const selected = (responses, index, fallback) => (
    responses ? responses[Math.min(index, responses.length - 1)] : fallback
  );
  const filtered = (rows, query, sort, limit) => {
    if (!Array.isArray(rows)) return rows;
    const matching = ignoreFilters ? rows : rows.filter((row) => matches(row, query));
    const ordered = ignoreSort ? matching : sortRows(matching, sort);
    return Number.isFinite(limit) ? ordered.slice(0, limit) : ordered;
  };

  const serviceRole = {
    entities: {
      AgencyMembership: {
        filter: async (query, sort, limit, offset, fields) => {
          calls.memberships.push({ query: clone(query), sort, limit, offset, fields: clone(fields) });
          const rows = selected(membershipResponses, membershipIndex++, memberships);
          return filtered(clone(rows), query, sort, limit);
        },
      },
      Agency: {
        filter: async (query, sort, limit, offset, fields) => {
          calls.agencies.push({ query: clone(query), sort, limit, offset, fields: clone(fields) });
          const rows = selected(agencyResponses, agencyIndex++, agencies);
          return filtered(clone(rows), query, sort, limit);
        },
      },
      Patient: {
        filter: async (query, sort, limit, offset, fields) => {
          calls.patients.push({ query: clone(query), sort, limit, offset, fields: clone(fields) });
          const rows = selected(patientResponses, patientIndex++, patients);
          return filtered(clone(rows), query, sort, limit);
        },
      },
      PatientCareTeamAssignment: {
        filter: async (query, sort, limit, offset, fields) => {
          calls.assignments.push({ query: clone(query), sort, limit, offset, fields: clone(fields) });
          const rows = selected(assignmentResponses, assignmentIndex++, assignments);
          return filtered(clone(rows), query, sort, limit);
        },
      },
      OASISAssessment: {
        filter: async (query, sort, limit, offset, fields) => {
          calls.assessments.push({ query: clone(query), sort, limit, offset, fields: clone(fields) });
          if (assessmentError) throw assessmentError;
          const rows = selected(assessmentResponses, assessmentIndex++, assessments);
          return filtered(clone(rows), query, sort, limit);
        },
      },
    },
  };
  const client = {
    auth: {
      me: async () => {
        const value = callers
          ? callers[Math.min(calls.auth, callers.length - 1)]
          : caller;
        calls.auth += 1;
        if (value instanceof Error) throw value;
        return clone(value);
      },
    },
    get asServiceRole() {
      calls.serviceRole += 1;
      return serviceRole;
    },
  };
  const handler = await importHandler(() => client, superAdminEmail);
  return { handler, calls };
}

async function invoke(handler, body, method = 'POST') {
  const request = new Request('http://local/readAuthorizedOASISAssessments', {
    method,
    headers: { 'content-type': 'application/json' },
    ...(method === 'GET' ? {} : { body: JSON.stringify(body) }),
  });
  const response = await handler(request);
  return { response, json: await response.json() };
}

const exactBody = (overrides = {}) => ({
  operation: 'get',
  agency_id: 'agency-a',
  patient_id: 'patient-a',
  assessment_id: 'assessment-a',
  purpose: 'verified_responses',
  ...overrides,
});

const listBody = (overrides = {}) => ({
  operation: 'list',
  agency_id: 'agency-a',
  patient_id: 'patient-a',
  purpose: 'summary',
  limit: 2,
  ...overrides,
});

test('exact read returns only the verified finite projection after a full preimage recheck', async () => {
  const { handler, calls } = await loadBroker();
  const { response, json } = await invoke(handler, exactBody());
  assert.equal(response.status, 200);
  assert.deepEqual(Object.keys(json).sort(), [
    'assessment', 'operation', 'purpose', 'scope', 'success',
  ]);
  assert.equal(json.operation, 'get');
  assert.equal(json.purpose, 'verified_responses');
  assert.equal(json.assessment.id, 'assessment-a');
  assert.equal(json.assessment.oasis_items[0].response_value.code, '01');
  assert.equal(json.assessment.clinical_summary, undefined);
  assert.equal(json.assessment.estimated_pdgm_group, undefined);
  assert.deepEqual(json.scope, {
    agency_id: 'agency-a',
    patient_id: 'patient-a',
    membership_id: 'membership-a',
    membership_version: 2,
    tenant_role: 'clinician',
    chart_access_basis: 'patient_creator',
  });
  assert.equal(calls.auth, 3);
  assert.equal(calls.memberships.length, 3);
  assert.equal(calls.agencies.length, 3);
  assert.equal(calls.patients.length, 3);
  assert.equal(calls.assessments.length, 2);
  assert.deepEqual(calls.assessments[0].query, {
    id: 'assessment-a',
    agency_id: 'agency-a',
    patient_id: 'patient-a',
  });
  assert.ok(calls.assessments[0].fields.includes('oasis_items'));
  assert.ok(!calls.assessments[0].fields.includes('clinical_summary'));
});

test('bounded summary read enforces the cap, newest-first order, and no response payload', async () => {
  const rows = [
    assessment({ id: 'assessment-old', assessment_date: '2026-09-01' }),
    assessment({ id: 'assessment-new', assessment_date: '2026-09-04' }),
    assessment({ id: 'assessment-middle', assessment_date: '2026-09-03' }),
  ];
  const { handler, calls } = await loadBroker({ assessments: rows });
  const { response, json } = await invoke(handler, listBody());
  assert.equal(response.status, 200);
  assert.deepEqual(json.assessments.map((row) => row.id), [
    'assessment-new', 'assessment-middle',
  ]);
  assert.deepEqual(json.page, { limit: 2, returned: 2, has_more: true });
  assert.equal(json.assessments[0].oasis_items, undefined);
  assert.equal(json.assessments[0].response_schema_source, undefined);
  assert.equal(calls.assessments[0].limit, 3);
  assert.equal(calls.assessments[0].sort, '-assessment_date');
  assert.ok(!calls.assessments[0].fields.includes('oasis_items'));
});

test('chart access is granted only by agency-wide role, creator, or an exact active assignment', async () => {
  const managerMembership = membership({ tenant_role: 'manager' });
  const manager = await loadBroker({
    memberships: [managerMembership],
    patients: [patient({
      created_by_user_id: 'other-user',
      created_by_user_email_normalized: 'other@agency.test',
      created_by: 'other@agency.test',
      patient_creation_key: 'agency-a:other-user:patient-create-a',
    })],
  });
  const managerResult = await invoke(manager.handler, exactBody({ purpose: 'summary' }));
  assert.equal(managerResult.response.status, 200);
  assert.equal(managerResult.json.scope.chart_access_basis, 'agency_wide');
  assert.equal(manager.calls.assignments.length, 0);

  const assignedPatient = patient({
    created_by_user_id: 'other-user',
    created_by_user_email_normalized: 'other@agency.test',
    created_by: 'other@agency.test',
    patient_creation_key: 'agency-a:other-user:patient-create-a',
  });
  const assigned = await loadBroker({ patients: [assignedPatient], assignments: [assignment()] });
  const assignedResult = await invoke(assigned.handler, exactBody({ purpose: 'summary' }));
  assert.equal(assignedResult.response.status, 200);
  assert.equal(assignedResult.json.scope.chart_access_basis, 'care_team_assignment');
  assert.equal(assigned.calls.assignments.length, 3);

  const owner = await loadBroker({
    caller: { ...USER, role: 'admin', email: 'Owner@Platform.test' },
    memberships: [],
    patients: [assignedPatient],
    superAdminEmail: 'owner@platform.test',
  });
  const ownerResult = await invoke(owner.handler, exactBody({ purpose: 'summary' }));
  assert.equal(ownerResult.response.status, 200);
  assert.deepEqual(ownerResult.json.scope, {
    agency_id: 'agency-a',
    patient_id: 'patient-a',
    membership_id: null,
    membership_version: null,
    tenant_role: 'platform_owner',
    chart_access_basis: 'agency_wide',
  });
});

test('mutable user claims, weak roles, and deactivated identities never grant OASIS access', async () => {
  const noMembership = await loadBroker({ memberships: [] });
  assert.equal((await invoke(noMembership.handler, exactBody())).response.status, 403);

  for (const options of [
    { memberships: [membership({ tenant_role: 'office_staff' })] },
    { caller: { ...USER, is_verified: false } },
    { caller: { ...USER, is_active: false } },
    { caller: { ...USER, disabled: true } },
    { caller: { ...USER, is_service: true } },
    { caller: { ...USER, role: 'admin' }, memberships: [membership()] },
  ]) {
    const { handler } = await loadBroker(options);
    const result = await invoke(handler, exactBody());
    assert.equal(result.response.status, 403);
  }

  const wrongBuiltInRole = await loadBroker({
    caller: { ...USER, role: 'admin' },
    memberships: [membership()],
  });
  assert.equal((await invoke(wrongBuiltInRole.handler, exactBody())).response.status, 403);
  assert.equal(wrongBuiltInRole.calls.memberships.length, 0);
});

test('protected owner rejects preexisting and duplicate tenant memberships', async () => {
  const owner = {
    ...USER,
    id: 'owner-user',
    email: 'Owner@Platform.test',
    role: 'admin',
  };
  const assignedPatient = patient({
    created_by_user_id: 'other-user',
    created_by_user_email_normalized: 'other@agency.test',
    created_by: 'other@agency.test',
    patient_creation_key: 'agency-a:other-user:patient-create-a',
  });
  const ownerMembership = membership({
    id: 'membership-owner',
    membership_key: 'agency-a:owner-user',
    user_id: 'owner-user',
    user_email_normalized: 'owner@platform.test',
  });

  for (const body of [exactBody({ purpose: 'summary' }), listBody()]) {
    for (const memberships of [
      [ownerMembership],
      [ownerMembership, { ...ownerMembership, id: 'membership-owner-duplicate' }],
    ]) {
      const fixture = await loadBroker({
        caller: owner,
        memberships,
        patients: [assignedPatient],
        superAdminEmail: 'owner@platform.test',
      });
      const result = await invoke(fixture.handler, body);
      assert.equal(result.response.status, 409);
      assert.equal(result.json.error, 'Platform owner tenant membership must not exist');
      assert.equal(fixture.calls.memberships.length, 1);
      assert.deepEqual(fixture.calls.patients, []);
    }
  }
});

test('membership and agency authority rejects malformed, duplicate, cross-user, inactive, and changing rows', async () => {
  const invalidCases = [
    { memberships: [membership(), membership({ id: 'membership-duplicate' })] },
    { memberships: [membership({ membership_key: 'agency-a:someone-else' })] },
    { memberships: [membership({ user_email_normalized: 'other@agency.test' })] },
    { memberships: [membership({ user_id: 'other-user' })], ignoreFilters: true },
    { memberships: [membership({ status: 'suspended' })] },
    { agencies: [agency({ status: 'trial' })] },
    { agencies: [agency(), agency({ id: 'agency-b' })], ignoreFilters: true },
  ];
  for (const options of invalidCases) {
    const { handler } = await loadBroker(options);
    const result = await invoke(handler, exactBody());
    assert.ok([403, 409].includes(result.response.status));
  }

  const changed = await loadBroker({
    membershipResponses: [
      [membership()],
      [membership({ version: 3, last_transition_at: '2026-09-04T11:45:00.000Z' })],
    ],
  });
  const changedResult = await invoke(changed.handler, exactBody());
  assert.equal(changedResult.response.status, 409);
  assert.match(changedResult.json.error, /authority changed/);
});

test('patient authority rejects wrong-tenant, legacy-unstamped, duplicate, and changing rows', async () => {
  const badPatients = [
    patient({ agency_id: 'agency-b', patient_creation_key: 'agency-b:user-a:patient-create-a' }),
    patient({ agency_id: undefined }),
    patient({ created_by_user_id: undefined }),
    patient({ patient_creation_key: 'forged' }),
    patient({ is_archived: true }),
    patient({ is_sample: true }),
  ];
  for (const row of badPatients) {
    const { handler } = await loadBroker({ patients: [row], ignoreFilters: true });
    const result = await invoke(handler, exactBody());
    assert.ok([404, 409].includes(result.response.status));
  }

  const duplicate = await loadBroker({
    patients: [patient(), patient({ updated_date: '2026-09-04T11:59:00.000Z' })],
  });
  assert.equal((await invoke(duplicate.handler, exactBody())).response.status, 409);

  const changed = await loadBroker({
    patientResponses: [[patient()], [patient({ status: 'hospitalized' })]],
  });
  assert.equal((await invoke(changed.handler, exactBody())).response.status, 409);
});

test('care-team authority rejects missing, duplicate, malformed, inactive, cross-scope, and changing assignments', async () => {
  const assignedPatient = patient({
    created_by_user_id: 'other-user',
    created_by_user_email_normalized: 'other@agency.test',
    created_by: 'other@agency.test',
    patient_creation_key: 'agency-a:other-user:patient-create-a',
  });
  for (const rows of [
    [],
    [assignment({ status: 'suspended' })],
    [assignment({ assignee_membership_id: 'other-membership' })],
    [assignment({ assignee_membership_version_at_enablement: 1 })],
    [assignment({ assignee_membership_version_at_enablement: 3 })],
    [assignment({ assignment_key: 'forged' })],
    [assignment(), assignment({ id: 'assignment-duplicate' })],
  ]) {
    const { handler } = await loadBroker({
      patients: [assignedPatient],
      assignments: rows,
      ignoreFilters: rows.some((row) => row.assignment_key === 'forged'),
    });
    const result = await invoke(handler, exactBody({ purpose: 'summary' }));
    assert.ok([404, 409].includes(result.response.status));
  }

  const changed = await loadBroker({
    patients: [assignedPatient],
    assignmentResponses: [
      [assignment()],
      [assignment({ version: 2, last_transition_at: '2026-09-04T11:45:00.000Z' })],
    ],
  });
  assert.equal((await invoke(changed.handler, exactBody({ purpose: 'summary' }))).response.status, 409);
});

test('exact and list reads catch revocation during the final assessment provider read', async () => {
  const revokedMembership = membership({
    status: 'revoked',
    revoked_at: '2026-09-04T11:59:59.000Z',
    revocation_reason: 'Access revoked during read',
    last_transition_at: '2026-09-04T11:59:59.000Z',
    last_transition_reason: 'Access revoked during read',
    version: 3,
  });

  for (const body of [exactBody(), listBody()]) {
    let fixture = await loadBroker({
      membershipResponses: [
        [membership()],
        [membership()],
        [revokedMembership],
      ],
    });
    let result = await invoke(fixture.handler, body);
    assert.equal(result.response.status, 403);
    assert.equal(Object.hasOwn(result.json, 'assessment'), false);
    assert.equal(Object.hasOwn(result.json, 'assessments'), false);
    assert.equal(fixture.calls.assessments.length, 2);
    assert.equal(fixture.calls.auth, 3);
    assert.equal(fixture.calls.memberships.length, 3);

    const assignedPatient = patient({
      created_by_user_id: 'other-user',
      created_by_user_email_normalized: 'other@agency.test',
      created_by: 'other@agency.test',
      patient_creation_key: 'agency-a:other-user:patient-create-a',
    });
    fixture = await loadBroker({
      patients: [assignedPatient],
      assignmentResponses: [
        [assignment()],
        [assignment()],
        [assignment({
          status: 'revoked',
          version: 2,
          last_transition_at: '2026-09-04T11:59:59.000Z',
          last_transition_reason: 'Access revoked during read',
        })],
      ],
    });
    result = await invoke(fixture.handler, body);
    assert.equal(result.response.status, 409);
    assert.equal(Object.hasOwn(result.json, 'assessment'), false);
    assert.equal(Object.hasOwn(result.json, 'assessments'), false);
    assert.equal(fixture.calls.assessments.length, 2);
    assert.equal(fixture.calls.assignments.length, 3);
  }
});

test('assessment reads reject wrong agency, legacy unscoped rows, duplicates, invalid metadata, and drift', async () => {
  const badAssessments = [
    assessment({ agency_id: undefined }),
    assessment({ agency_id: 'agency-b' }),
    assessment({ patient_id: 'patient-b' }),
    assessment({ assessment_date: '2026-02-30' }),
    assessment({ visit_type: 'Follow Up' }),
    assessment({ status: 'approved' }),
    assessment({ completion_percentage: 101 }),
    assessment({ created_by: ' Not-Canonical@Agency.test ' }),
  ];
  for (const row of badAssessments) {
    const { handler } = await loadBroker({ assessments: [row], ignoreFilters: true });
    const result = await invoke(handler, exactBody({ purpose: 'summary' }));
    assert.equal(result.response.status, 409);
  }

  const duplicate = await loadBroker({
    assessments: [assessment(), assessment({ updated_date: '2026-09-04T11:59:00.000Z' })],
  });
  assert.equal((await invoke(duplicate.handler, exactBody({ purpose: 'summary' }))).response.status, 409);

  const changed = await loadBroker({
    assessmentResponses: [[assessment()], [assessment({ status: 'completed' })]],
  });
  const changedResult = await invoke(changed.handler, exactBody({ purpose: 'summary' }));
  assert.equal(changedResult.response.status, 409);
  assert.match(changedResult.json.error, /assessment changed/);
});

test('verified response purpose rejects legacy, AI, unverified, malformed, duplicate, and oversized content', async () => {
  const malformed = [
    assessment({ response_schema_id: 'pennsync-oasis-response-v1-legacy' }),
    assessment({ migration_status: 'legacy_provenance_annotated' }),
    assessment({ response_schema_source: null }),
    assessment({ last_written_by: 'different@agency.test' }),
    assessment({ oasis_items: [verifiedItem({ ai_suggested: true })] }),
    assessment({ oasis_items: [verifiedItem({ response_origin: 'ai_generated' })] }),
    assessment({ oasis_items: [verifiedItem({ selected_by: 'different@agency.test' })] }),
    assessment({ oasis_items: [verifiedItem({ response: 'legacy-scalar' })] }),
    assessment({ oasis_items: [verifiedItem({ response_value: { code: 1 } })] }),
    assessment({ oasis_items: [verifiedItem({ item_source: 'unknown' })] }),
    assessment({ oasis_items: [
      verifiedItem(),
      verifiedItem({ item_number: 'M1831' }),
    ] }),
    assessment({ oasis_items: Array.from(
      { length: 501 },
      (_, index) => verifiedItem({ definition_id: `definition-${index}`, item_number: `M${index}` }),
    ) }),
  ];
  for (const row of malformed) {
    const { handler } = await loadBroker({ assessments: [row] });
    const result = await invoke(handler, exactBody());
    assert.equal(result.response.status, 409);
    assert.match(result.json.error, /provenance/);
  }

  const legacy = assessment({
    response_schema_id: 'pennsync-oasis-response-v1-legacy',
    instrument_version: null,
    response_schema_source: null,
    migration_status: 'legacy_unconverted',
    last_written_by: null,
    last_written_at: null,
    oasis_items: [{ item_number: 'M1830', response: '6', ai_suggested: true }],
  });
  const summary = await loadBroker({ assessments: [legacy] });
  const summaryResult = await invoke(summary.handler, exactBody({ purpose: 'summary' }));
  assert.equal(summaryResult.response.status, 200);
  assert.equal(summaryResult.json.assessment.oasis_items, undefined);
  assert.equal(summaryResult.json.assessment.response_schema_id, 'pennsync-oasis-response-v1-legacy');
});

test('bounded reads reject unstable windows, duplicates, wrong ordering, and invalid limits', async () => {
  const duplicate = await loadBroker({
    assessments: [assessment(), assessment()],
  });
  assert.equal((await invoke(duplicate.handler, listBody())).response.status, 409);

  const unsorted = await loadBroker({
    assessments: [
      assessment({ id: 'old', assessment_date: '2026-09-01' }),
      assessment({ id: 'new', assessment_date: '2026-09-04' }),
    ],
    ignoreSort: true,
  });
  assert.equal((await invoke(unsorted.handler, listBody())).response.status, 409);

  const changed = await loadBroker({
    assessmentResponses: [
      [assessment({ id: 'assessment-a' })],
      [assessment({ id: 'assessment-b' })],
    ],
  });
  assert.equal((await invoke(changed.handler, listBody())).response.status, 409);

  for (const limit of [0, 26, 1.5, '$gt']) {
    const { handler } = await loadBroker();
    assert.equal((await invoke(handler, listBody({ limit }))).response.status, 400);
  }
});

test('request surface rejects operator-shaped identifiers, unsupported fields, unsafe modes, methods, and bodies', async () => {
  const { handler } = await loadBroker();
  const cases = [
    exactBody({ agency_id: '$agency' }),
    exactBody({ patient_id: ' patient-a' }),
    exactBody({ assessment_id: '$assessment' }),
    exactBody({ purpose: 'all_fields' }),
    { ...exactBody(), fields: ['clinical_summary'] },
    listBody({ purpose: 'verified_responses' }),
    { ...listBody(), assessment_id: 'assessment-a' },
    { ...listBody(), operation: 'delete' },
  ];
  for (const body of cases) {
    const result = await invoke(handler, body);
    assert.equal(result.response.status, 400);
  }
  const get = await invoke(handler, {}, 'GET');
  assert.equal(get.response.status, 405);
  assert.equal(get.response.headers.get('allow'), 'POST');

  const invalidRequest = new Request('http://local/readAuthorizedOASISAssessments', {
    method: 'POST',
    body: '{bad json',
  });
  assert.equal((await handler(invalidRequest)).status, 400);
  const largeRequest = new Request('http://local/readAuthorizedOASISAssessments', {
    method: 'POST',
    body: JSON.stringify({ value: 'x'.repeat(20_001) }),
  });
  assert.equal((await handler(largeRequest)).status, 413);
});

test('provider failures are generic and never echo PHI or predicates', async () => {
  const originalError = console.error;
  console.error = () => {};
  try {
    const { handler } = await loadBroker({
      assessmentError: new Error('secret patient-a agency-a clinical answer'),
    });
    const result = await invoke(handler, exactBody());
    assert.equal(result.response.status, 500);
    assert.deepEqual(result.json, { error: 'Internal server error' });
    assert.doesNotMatch(JSON.stringify(result.json), /secret|patient-a|agency-a/);
  } finally {
    console.error = originalError;
  }
});

async function collectFiles(root, relative = '') {
  const output = [];
  for (const entry of await readdir(new URL(relative || '.', root), { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    const next = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isDirectory()) output.push(...await collectFiles(root, next));
    else output.push(next);
  }
  return output;
}

test('static contract keeps the broker service-role-only, read-only, finite, and unwired', async () => {
  const [broker, wrapper, entityText] = await Promise.all([
    readFile(brokerUrl, 'utf8'),
    readFile(wrapperUrl, 'utf8'),
    readFile(entityUrl, 'utf8'),
  ]);
  assert.match(broker, /base44\.asServiceRole\.entities/);
  assert.match(broker, /MAX_LIST_LIMIT = 25/);
  assert.match(broker, /MAX_OASIS_ITEMS = 500/);
  assert.match(broker, /response_origin !== 'clinician_selected'/);
  assert.match(broker, /item\.ai_suggested !== false/);
  assert.match(
    broker,
    /assignment\.assignee_membership_version_at_enablement !== authority\.membership\.version/,
  );
  assert.match(broker, /if \(user\.role !== 'user'\) throw new PublicError\(403, 'Forbidden'\)/);
  assert.doesNotMatch(broker, /\.create\s*\(|\.update\s*\(|\.delete\s*\(/);
  assert.doesNotMatch(broker, /base44\.entities\./);
  assert.doesNotMatch(wrapper, /\.entities\./);
  assert.equal(
    (wrapper.match(/functions\.invoke\('readAuthorizedOASISAssessments'/g) || []).length,
    1,
  );

  const entity = JSON5.parse(entityText);
  assert.equal(entity.rls.read, false);
  assert.equal(entity.rls.create, false);
  assert.equal(entity.rls.update, false);
  assert.equal(entity.rls.delete, false);

  const files = await collectFiles(sourceRootUrl);
  const consumers = [];
  const directEntityReaders = [];
  for (const file of files.filter((name) => /\.[jt]sx?$/.test(name))) {
    if (file === 'functions/readAuthorizedOASISAssessments.js'
      || file === 'functions/readAuthorizedOASISAssessments.spec.js') continue;
    const text = await readFile(new URL(file, sourceRootUrl), 'utf8');
    if (text.includes('readAuthorizedOASISAssessments')
      || text.includes('getAuthorizedOASISAssessment')
      || text.includes('listAuthorizedOASISAssessments')) {
      consumers.push(file);
    }
    if (
      !/\.(?:spec|test)\.[jt]sx?$/.test(file)
      && /base44\.entities\.OASISAssessment\.(?:get|list|filter)\s*\(/.test(text)
    ) {
      directEntityReaders.push(file);
    }
  }
  assert.deepEqual(consumers, [], 'OASIS read wrapper must remain unwired pending hosted proof');
  assert.deepEqual(directEntityReaders.sort(), [
    'components/clinical/OASISQuickUpdate.jsx',
    'components/reports/OASISComplianceReport.jsx',
    'components/reports/PDGMReimbursementReport.jsx',
  ], 'every remaining direct OASIS browser reader must stay in the reviewed hard-paused set');
});
