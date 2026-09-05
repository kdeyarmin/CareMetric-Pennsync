import assert from 'node:assert/strict';
import { join } from 'node:path';
import { readFile, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { transpileTs } from '../../tools-transpile-ts.mjs';

const brokers = {
  get: new URL('../functions/getAuthorizedVisit/entry.ts', import.meta.url),
  list: new URL('../functions/listAuthorizedVisits/entry.ts', import.meta.url),
};
const wrappers = {
  get: new URL('../../src/functions/getAuthorizedVisit.js', import.meta.url),
  list: new URL('../../src/functions/listAuthorizedVisits.js', import.meta.url),
};

const USER = {
  id: 'user-1',
  email: 'Clinician@Agency.test',
  role: 'user',
  is_active: true,
  is_verified: true,
};

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

const agency = (overrides = {}) => ({ id: 'agency-a', status: 'active', ...overrides });

function patient(overrides = {}) {
  const row = {
    id: 'patient-a',
    agency_id: 'agency-a',
    created_by_user_id: 'creator-1',
    created_by_user_email_normalized: 'creator@agency.test',
    created_by: 'creator@agency.test',
    client_request_id: 'patient-request-a',
    is_sample: false,
    is_archived: false,
    status: 'active',
    updated_date: '2026-09-03T12:00:00.000Z',
    ...overrides,
  };
  row.patient_creation_key = overrides.patient_creation_key
    ?? `${row.agency_id}:${row.created_by_user_id}:${row.client_request_id}`;
  return row;
}

function visit(overrides = {}) {
  return {
    id: 'visit-a',
    agency_id: 'agency-a',
    patient_id: 'patient-a',
    created_by_user_id: 'user-1',
    created_by_user_email_normalized: 'clinician@agency.test',
    created_by: 'clinician@agency.test',
    client_request_id: 'visit-request-a',
    is_sample: false,
    visit_date: '2026-09-03',
    visit_time: '09:30',
    visit_type: 'skilled_nursing',
    status: 'completed',
    nurse_notes: 'Bounded clinical note',
    raw_transcription: 'Bounded source transcription',
    vital_signs: { heart_rate: 72 },
    documentation_source: 'smart_note',
    grounding_pending: false,
    compliance_score: 92,
    compliance_issues: [],
    homebound_status_verified: true,
    skilled_intervention_documented: true,
    homebound_justification: 'Requires assistance to leave home.',
    ai_tags: ['trend:stable'],
    emr_handoff_status: 'not_started',
    documentation_review_ack: { acknowledged: false, is_clinical_signature: false },
    secret_claim: 'must never cross the projection boundary',
    updated_date: '2026-09-03T12:30:00.000Z',
    ...overrides,
  };
}

function assignment(overrides = {}) {
  const row = {
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
    created_by_user_id: 'manager-1',
    created_by_user_email_normalized: 'manager@agency.test',
    activated_at: '2026-09-03T11:30:00.000Z',
    last_transition_by_user_id: 'manager-1',
    last_transition_by_email_normalized: 'manager@agency.test',
    last_transition_at: '2026-09-03T11:30:00.000Z',
    last_transition_reason: 'Assigned for direct care',
    last_transition_action: 'grant',
    last_transition_request_id: 'assignment-request-a',
    last_transition_request_key: 'agency-a:patient-a:user-1:assignment-request-a',
    version: 3,
    ...overrides,
  };
  if (row.status === 'suspended') {
    row.suspended_at ??= '2026-09-03T12:40:00.000Z';
    if (overrides.last_transition_action === undefined) row.last_transition_action = 'suspend';
  }
  if (row.status === 'revoked') {
    row.revoked_at ??= '2026-09-03T12:40:00.000Z';
    row.revocation_reason ??= 'Removed from care team';
    if (overrides.last_transition_action === undefined) row.last_transition_action = 'revoke';
  }
  return row;
}

async function importHandler(kind, makeClient, superAdminEmail = null) {
  let source = await readFile(brokers[kind], 'utf8');
  const globalName = `__visitReadClient_${kind}_${Math.random().toString(36).slice(2)}`;
  source = source.replace(
    /import\s+\{\s*createClientFromRequest\s*\}\s+from\s+'npm:[^']+';/,
    `const createClientFromRequest = globalThis.${globalName};`,
  );
  const temporaryModule = join(
    tmpdir(),
    `visit_read_${kind}_${Date.now()}_${Math.random().toString(36).slice(2)}.mjs`,
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

async function loadBroker(kind, {
  caller = USER,
  callers = null,
  memberships = [membership()],
  membershipResponses = null,
  agencies = [agency()],
  agencyResponses = null,
  patients = [patient()],
  patientResponses = null,
  visits = [visit()],
  visitResponses = null,
  assignments = [assignment()],
  assignmentResponses = null,
  auditError = null,
  ignoreFilters = false,
  superAdminEmail = null,
} = {}) {
  const clone = (value) => structuredClone(value);
  const calls = {
    auth: 0,
    serviceRole: 0,
    memberships: [],
    agencies: [],
    patients: [],
    visits: [],
    assignments: [],
    securityLogs: [],
  };
  const indexes = { membership: 0, agency: 0, patient: 0, visit: 0, assignment: 0 };
  const selected = (responses, key, fallback) => {
    const index = indexes[key];
    indexes[key] += 1;
    return responses ? responses[Math.min(index, responses.length - 1)] : fallback;
  };
  const matches = (row, query) => Object.entries(query || {}).every(([field, value]) => {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      if (Array.isArray(value.$in)) return value.$in.includes(row?.[field]);
      if (typeof value.$gt === 'string') return row?.[field] > value.$gt;
      return false;
    }
    return row?.[field] === value;
  });
  const filterRows = (rows, query, sort, limit, offset = 0) => {
    if (!Array.isArray(rows)) return rows;
    const matched = ignoreFilters ? rows : rows.filter((row) => matches(row, query));
    const ordered = sort === 'id'
      ? [...matched].sort((left, right) => String(left?.id).localeCompare(String(right?.id)))
      : matched;
    return ordered.slice(offset, Number.isFinite(limit) ? offset + limit : undefined);
  };
  const entityFilter = (name, key, responses, fallback) => async (
    query,
    sort,
    limit,
    offset,
    fields,
  ) => {
    calls[name].push({ query: clone(query), sort, limit, offset, fields: clone(fields) });
    return filterRows(clone(selected(responses, key, fallback)), query, sort, limit, offset);
  };
  const serviceRole = {
    entities: {
      AgencyMembership: {
        filter: entityFilter('memberships', 'membership', membershipResponses, memberships),
      },
      Agency: { filter: entityFilter('agencies', 'agency', agencyResponses, agencies) },
      Patient: { filter: entityFilter('patients', 'patient', patientResponses, patients) },
      Visit: { filter: entityFilter('visits', 'visit', visitResponses, visits) },
      PatientCareTeamAssignment: {
        filter: entityFilter('assignments', 'assignment', assignmentResponses, assignments),
      },
      SecurityLog: {
        create: async (payload) => {
          calls.securityLogs.push(clone(payload));
          if (auditError) throw auditError;
          return { id: 'security-log-a' };
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
  const handler = await importHandler(kind, () => client, superAdminEmail);
  return { handler, calls };
}

async function invoke(handler, path, body, method = 'POST') {
  const request = new Request(`http://local/${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    ...(method === 'GET' ? {} : { body: JSON.stringify(body) }),
  });
  const response = await handler(request);
  return { response, json: await response.json() };
}

const getBody = (overrides = {}) => ({
  agency_id: 'agency-a',
  visit_id: 'visit-a',
  purpose: 'schedule',
  ...overrides,
});

const listBody = (overrides = {}) => ({
  agency_id: 'agency-a',
  patient_id: 'patient-a',
  purpose: 'schedule',
  page_size: 25,
  sort: 'id_asc',
  ...overrides,
});

test('Visit read brokers and wrappers are finite, broker-only, and deliberately unwired', async () => {
  const getSource = await readFile(brokers.get, 'utf8');
  const listSource = await readFile(brokers.list, 'utf8');
  const getWrapper = await readFile(wrappers.get, 'utf8');
  const listWrapper = await readFile(wrappers.list, 'utf8');

  assert.match(getSource, /BEGIN AUTHORIZED VISIT EXACT PURPOSE POLICY/);
  assert.match(listSource, /BEGIN AUTHORIZED VISIT LIST PURPOSE POLICY/);
  for (const source of [getSource, listSource]) {
    assert.doesNotMatch(source, /entities\.Visit\.(?:list|get|create|bulkCreate|update|updateMany|delete)\s*\(/);
    assert.doesNotMatch(source, /assigned_nurses\s*\.(?:includes|some)/);
    assert.match(source, /entities\.Visit\.filter\(/);
    assert.match(source, /entities\.PatientCareTeamAssignment\.filter\(/);
    assert.match(source, /assignee_membership_version_at_enablement !== authority\.membership\.version/);
    assert.ok((source.match(/await loadAuthority\s*\(/g) || []).length >= 2);
    assert.doesNotMatch(source, /console\.error\([^)]*,\s*error\b/);
  }
  assert.match(listSource, /query\.id\s*=\s*\{\s*\$gt:\s*input\.cursor\.after_id\s*\}/);
  assert.match(listSource, /'id',\s*\n\s*input\.pageSize \+ 1,/);
  assert.doesNotMatch(listSource, /offset|next_offset|created_desc|visit_date_desc/);
  assert.match(getWrapper, /functions\.invoke\('getAuthorizedVisit'/);
  assert.match(listWrapper, /functions\.invoke\('listAuthorizedVisits'/);
  assert.doesNotMatch(getWrapper, /\.entities\./);
  assert.doesNotMatch(listWrapper, /\.entities\./);

  const appSources = await Promise.all([
    new URL('../../src/App.jsx', import.meta.url),
    new URL('../../src/routes.jsx', import.meta.url),
  ].map((url) => readFile(url, 'utf8')));
  for (const source of appSources) {
    assert.doesNotMatch(source, /getAuthorizedVisit|listAuthorizedVisits/);
  }
});

test('operator-shaped input and unsupported methods fail before privileged reads', async () => {
  for (const kind of ['get', 'list']) {
    const { handler, calls } = await loadBroker(kind);
    const methodResult = await invoke(handler, kind, {}, 'GET');
    assert.equal(methodResult.response.status, 405);
    assert.equal(methodResult.response.headers.get('allow'), 'POST');

    const body = kind === 'get'
      ? getBody({ visit_id: { $in: ['visit-a'] } })
      : listBody({ where: { agency_id: 'agency-b' } });
    const invalid = await invoke(handler, kind, body);
    assert.equal(invalid.response.status, 400);
    assert.equal(calls.auth, 0);
    assert.deepEqual(calls.visits, []);
  }
});

test('anonymous, disabled, service, and unverified callers fail before service-role reads', async () => {
  const denied = [
    { caller: null, status: 401 },
    { caller: { ...USER, is_active: false }, status: 403 },
    { caller: { ...USER, disabled: true }, status: 403 },
    { caller: { ...USER, is_service: true }, status: 403 },
    { caller: { ...USER, is_verified: false }, status: 403 },
  ];
  for (const kind of ['get', 'list']) {
    for (const scenario of denied) {
      const { handler, calls } = await loadBroker(kind, { caller: scenario.caller });
      const result = await invoke(
        handler,
        kind,
        kind === 'get' ? getBody() : listBody(),
      );
      assert.equal(result.response.status, scenario.status);
      assert.equal(calls.serviceRole, 0);
      assert.deepEqual(calls.visits, []);
    }
  }
});

test('a clinician exact read requires an active assignment bound to the current membership version', async () => {
  const success = await loadBroker('get');
  const result = await invoke(success.handler, 'getAuthorizedVisit', getBody());
  assert.equal(result.response.status, 200);
  assert.deepEqual(result.json.visit, {
    id: 'visit-a',
    patient_id: 'patient-a',
    visit_date: '2026-09-03',
    visit_time: '09:30',
    visit_type: 'skilled_nursing',
    status: 'completed',
    updated_date: '2026-09-03T12:30:00.000Z',
  });
  assert.equal(result.json.scope.access_basis, 'care_team_assignment');
  assert.equal(result.json.scope.assignment_id, 'assignment-a');
  assert.equal(success.calls.auth, 3);
  assert.equal(success.calls.visits.length, 2);
  assert.equal(success.calls.assignments.length, 3);

  const missing = await loadBroker('get', { assignments: [] });
  const missingResult = await invoke(missing.handler, 'getAuthorizedVisit', getBody());
  assert.equal(missingResult.response.status, 404);

  const stale = await loadBroker('get', {
    assignments: [assignment({ assignee_membership_version_at_enablement: 1 })],
  });
  const staleResult = await invoke(stale.handler, 'getAuthorizedVisit', getBody());
  assert.equal(staleResult.response.status, 409);

  const suspended = await loadBroker('get', {
    assignments: [assignment({ status: 'suspended' })],
  });
  const suspendedResult = await invoke(suspended.handler, 'getAuthorizedVisit', getBody());
  assert.equal(suspendedResult.response.status, 404);
});

test('tenant administrators list agency Visits with bounded id-keyset paging', async () => {
  const visits = [
    visit({ id: 'visit-a', patient_id: 'patient-a' }),
    visit({ id: 'visit-b', patient_id: 'patient-b', client_request_id: 'visit-request-b' }),
    visit({ id: 'visit-c', patient_id: 'patient-b', client_request_id: 'visit-request-c' }),
  ];
  const patients = [
    patient(),
    patient({ id: 'patient-b', client_request_id: 'patient-request-b' }),
  ];
  const { handler, calls } = await loadBroker('list', {
    memberships: [membership({ tenant_role: 'agency_admin' })],
    visits,
    patients,
    assignments: [],
  });
  const result = await invoke(handler, 'listAuthorizedVisits', {
    agency_id: 'agency-a',
    purpose: 'schedule',
    page_size: 2,
    sort: 'id_asc',
  });
  assert.equal(result.response.status, 200);
  assert.deepEqual(result.json.visits.map((row) => row.id), ['visit-a', 'visit-b']);
  assert.equal(result.json.page.has_more, true);
  assert.equal(result.json.page.next_cursor.after_id, 'visit-b');
  assert.equal(result.json.scope.access_basis, 'agency_wide');
  assert.deepEqual(calls.assignments, []);
  assert.deepEqual(calls.visits[0].query, { agency_id: 'agency-a', is_sample: false });
  assert.equal(calls.visits[0].sort, 'id');
  assert.equal(calls.visits[0].limit, 3);
  assert.deepEqual(calls.patients[0].query.id, { $in: ['patient-a', 'patient-b'] });
  assert.equal(calls.securityLogs.length, 1);
  assert.deepEqual(calls.securityLogs[0], {
    timestamp: calls.securityLogs[0].timestamp,
    user_email: 'clinician@agency.test',
    user_role: 'agency_admin',
    action: 'VISIT_LIST_READ_AUTHORIZED',
    details: {
      broker: 'listAuthorizedVisits',
      agency_id: 'agency-a',
      patient_id: null,
      purpose: 'schedule',
      subject_user_id: 'user-1',
      membership_id: 'membership-a',
      membership_version: 2,
      returned_count: 2,
      has_more: true,
    },
    ip_address: 'server-side',
    user_agent: 'server-side',
  });
  assert.equal(Number.isFinite(Date.parse(calls.securityLogs[0].timestamp)), true);
});

test('Visit-list disclosure fails closed when the privileged audit write fails', async () => {
  const { handler, calls } = await loadBroker('list', {
    auditError: new Error('audit unavailable'),
  });
  const result = await invoke(handler, 'listAuthorizedVisits', listBody());
  assert.equal(result.response.status, 500);
  assert.equal(result.json.visits, undefined);
  assert.equal(result.json.error, 'Internal server error');
  assert.equal(calls.securityLogs.length, 1);
});

test('Visit list continuation is complete for a stable result set and binds current caller authority', async () => {
  const visits = [
    visit({ id: 'visit-a', patient_id: 'patient-a' }),
    visit({ id: 'visit-b', patient_id: 'patient-b', client_request_id: 'visit-request-b' }),
    visit({ id: 'visit-c', patient_id: 'patient-b', client_request_id: 'visit-request-c' }),
  ];
  const patients = [
    patient(),
    patient({ id: 'patient-b', client_request_id: 'patient-request-b' }),
  ];
  const request = {
    agency_id: 'agency-a', purpose: 'schedule', page_size: 2, sort: 'id_asc',
  };
  const options = {
    memberships: [membership({ tenant_role: 'agency_admin' })],
    visits,
    patients,
    assignments: [],
  };
  const paged = await loadBroker('list', options);
  const first = await invoke(paged.handler, 'listAuthorizedVisits', request);
  assert.equal(first.response.status, 200);
  assert.deepEqual(first.json.visits.map((row) => row.id), ['visit-a', 'visit-b']);
  const second = await invoke(paged.handler, 'listAuthorizedVisits', {
    ...request,
    cursor: first.json.page.next_cursor,
  });
  assert.equal(second.response.status, 200);
  assert.deepEqual(second.json.visits.map((row) => row.id), ['visit-c']);
  assert.equal(second.json.page.has_more, false);
  assert.equal(second.json.page.next_cursor, null);
  assert.deepEqual(paged.calls.visits[2].query.id, { $gt: 'visit-b' });

  const forgedCursor = structuredClone(first.json.page.next_cursor);
  forgedCursor.subject_user_id = 'user-2';
  const forged = await loadBroker('list', options);
  const forgedResult = await invoke(forged.handler, 'listAuthorizedVisits', {
    ...request,
    cursor: forgedCursor,
  });
  assert.equal(forgedResult.response.status, 409);
  assert.deepEqual(forged.calls.visits, []);

  const changedMembership = await loadBroker('list', {
    ...options,
    memberships: [membership({ tenant_role: 'agency_admin', version: 3 })],
  });
  const changedResult = await invoke(changedMembership.handler, 'listAuthorizedVisits', {
    ...request,
    cursor: first.json.page.next_cursor,
  });
  assert.equal(changedResult.response.status, 409);
  assert.deepEqual(changedMembership.calls.visits, []);
});

test('clinician lists are patient-bound and never fall back to Visit creator provenance', async () => {
  const withoutPatient = await loadBroker('list');
  const denied = await invoke(withoutPatient.handler, 'listAuthorizedVisits', {
    agency_id: 'agency-a', purpose: 'schedule', page_size: 25, sort: 'id_asc',
  });
  assert.equal(denied.response.status, 403);
  assert.deepEqual(withoutPatient.calls.visits, []);

  const noAssignment = await loadBroker('list', { assignments: [] });
  const creatorDenied = await invoke(noAssignment.handler, 'listAuthorizedVisits', listBody());
  assert.equal(creatorDenied.response.status, 404);
  assert.deepEqual(noAssignment.calls.visits, []);

  const allowed = await loadBroker('list');
  const result = await invoke(allowed.handler, 'listAuthorizedVisits', listBody());
  assert.equal(result.response.status, 200);
  assert.deepEqual(result.json.visits.map((row) => row.id), ['visit-a']);
  assert.equal(result.json.scope.patient_id, 'patient-a');
  assert.equal(result.json.scope.assignment_version, 3);
});

test('wrong-scope provider results and duplicate rows fail closed', async () => {
  const foreign = visit({
    id: 'visit-foreign',
    agency_id: 'agency-b',
    patient_id: 'patient-b',
  });
  for (const kind of ['get', 'list']) {
    const { handler } = await loadBroker(kind, {
      visits: [foreign],
      ignoreFilters: true,
    });
    const result = await invoke(
      handler,
      kind,
      kind === 'get' ? getBody() : listBody(),
    );
    assert.equal(result.response.status, 409);
  }

  const duplicate = await loadBroker('get', { visits: [visit(), visit()] });
  const duplicateResult = await invoke(duplicate.handler, 'getAuthorizedVisit', getBody());
  assert.equal(duplicateResult.response.status, 409);
});

test('nested purpose projections reject unexpected keys before disclosure', async () => {
  const malformed = await loadBroker('get', {
    visits: [visit({ vital_signs: { heart_rate: 72, hidden_phi: 1 } })],
  });
  const result = await invoke(
    malformed.handler,
    'getAuthorizedVisit',
    getBody({ purpose: 'documentation' }),
  );
  assert.equal(result.response.status, 409);
  assert.deepEqual(result.json, { error: 'Visit purpose projection integrity check failed' });
});

test('backend purpose projections reject malformed scalar, enum, boolean, time, and object values', async () => {
  const scenarios = [
    { kind: 'get', purpose: 'schedule', overrides: { visit_time: { hidden_phi: 'leak' } } },
    { kind: 'get', purpose: 'schedule', overrides: { start_time: 930 } },
    { kind: 'get', purpose: 'documentation', overrides: { documentation_source: 'unknown' } },
    { kind: 'get', purpose: 'documentation', overrides: { grounding_pending: 'false' } },
    { kind: 'get', purpose: 'compliance_review', overrides: { compliance_score: 101 } },
    {
      kind: 'get',
      purpose: 'compliance_review',
      overrides: { homebound_status_verified: { hidden_phi: 'leak' } },
    },
    { kind: 'get', purpose: 'compliance_review', overrides: { emr_handoff_status: 'unknown' } },
    { kind: 'list', purpose: 'schedule', overrides: { end_time: ['09:30'] } },
    {
      kind: 'list',
      purpose: 'compliance_review',
      overrides: { compliance_score: { hidden_phi: 'leak' } },
    },
    { kind: 'list', purpose: 'compliance_review', overrides: { grounding_pending: null } },
  ];
  for (const scenario of scenarios) {
    const { handler } = await loadBroker(scenario.kind, {
      visits: [visit(scenario.overrides)],
    });
    const result = await invoke(
      handler,
      scenario.kind === 'get' ? 'getAuthorizedVisit' : 'listAuthorizedVisits',
      scenario.kind === 'get'
        ? getBody({ purpose: scenario.purpose })
        : listBody({ purpose: scenario.purpose }),
    );
    assert.equal(result.response.status, 409);
    assert.deepEqual(result.json, { error: 'Visit purpose projection integrity check failed' });
  }
});

test('authority, assignment, patient, and Visit preimages are rechecked before disclosure', async () => {
  const scenarios = [
    {
      memberships: null,
      assignments: null,
      patients: null,
      visits: [
        [visit()],
        [visit({ nurse_notes: 'Changed concurrently', updated_date: '2026-09-03T12:31:00.000Z' })],
      ],
      purpose: 'documentation',
    },
    {
      memberships: [[membership()], [membership({ version: 3 })]],
      assignments: null,
      patients: null,
      visits: null,
      purpose: 'schedule',
    },
    {
      memberships: null,
      assignments: [[assignment()], [assignment({ version: 4 })]],
      patients: null,
      visits: null,
      purpose: 'schedule',
    },
    {
      memberships: null,
      assignments: null,
      patients: [[patient()], [patient({ updated_date: '2026-09-03T12:01:00.000Z' })]],
      visits: null,
      purpose: 'schedule',
    },
  ];
  for (const scenario of scenarios) {
    const { handler } = await loadBroker('get', {
      ...(scenario.memberships ? { membershipResponses: scenario.memberships } : {}),
      ...(scenario.assignments ? { assignmentResponses: scenario.assignments } : {}),
      ...(scenario.patients ? { patientResponses: scenario.patients } : {}),
      ...(scenario.visits ? { visitResponses: scenario.visits } : {}),
    });
    const result = await invoke(
      handler,
      'getAuthorizedVisit',
      getBody({ purpose: scenario.purpose }),
    );
    assert.equal(result.response.status, 409);
  }
});

test('Visit list rechecks both the selected chart and the page preimage', async () => {
  const pageChanged = await loadBroker('list', {
    visitResponses: [
      [visit()],
      [visit({ status: 'pending_review', updated_date: '2026-09-03T12:31:00.000Z' })],
    ],
  });
  const pageResult = await invoke(
    pageChanged.handler,
    'listAuthorizedVisits',
    listBody(),
  );
  assert.equal(pageResult.response.status, 409);

  const chartChanged = await loadBroker('list', {
    patientResponses: [
      [patient()],
      [patient({ status: 'hospitalized', updated_date: '2026-09-03T12:01:00.000Z' })],
    ],
  });
  const chartResult = await invoke(
    chartChanged.handler,
    'listAuthorizedVisits',
    listBody(),
  );
  assert.equal(chartResult.response.status, 409);
});

test('a final assignment suspension blocks disclosure after the final provider read', async () => {
  for (const kind of ['get', 'list']) {
    const { handler, calls } = await loadBroker(kind, {
      assignmentResponses: [
        [assignment()],
        [assignment()],
        [assignment({ status: 'suspended' })],
      ],
    });
    const result = await invoke(
      handler,
      kind === 'get' ? 'getAuthorizedVisit' : 'listAuthorizedVisits',
      kind === 'get' ? getBody() : listBody(),
    );
    assert.equal(result.response.status, 409);
    assert.equal(calls.visits.length, 2);
    assert.equal(calls.assignments.length, 3);
  }
});

test('only the exact configured built-in platform owner bypasses membership', async () => {
  const owner = { ...USER, role: 'admin', email: 'Owner@Platform.test' };
  const permitted = await loadBroker('list', {
    caller: owner,
    memberships: [],
    assignments: [],
    superAdminEmail: 'owner@platform.test',
  });
  const result = await invoke(permitted.handler, 'listAuthorizedVisits', {
    agency_id: 'agency-a', purpose: 'schedule', page_size: 25, sort: 'id_asc',
  });
  assert.equal(result.response.status, 200);
  assert.equal(result.json.scope.tenant_role, 'platform_owner');
  assert.equal(permitted.calls.memberships.length, 3);
  assert.equal(
    permitted.calls.memberships.every((call) => call.query.user_id === 'user-1'),
    true,
  );

  const impostor = await loadBroker('get', {
    caller: owner,
    memberships: [],
    superAdminEmail: 'different@platform.test',
  });
  const denied = await invoke(impostor.handler, 'getAuthorizedVisit', getBody());
  assert.equal(denied.response.status, 403);
  assert.deepEqual(impostor.calls.memberships, []);
});

test('platform owner Visit reads reject preexisting or duplicate owner memberships', async () => {
  const owner = { ...USER, role: 'admin', email: 'Owner@Platform.test' };
  const ownerMembership = membership({ user_email_normalized: 'owner@platform.test' });
  for (const kind of ['get', 'list']) {
    for (const memberships of [
      [ownerMembership],
      [ownerMembership, { ...ownerMembership, id: 'membership-owner-duplicate' }],
    ]) {
      const fixture = await loadBroker(kind, {
        caller: owner,
        memberships,
        superAdminEmail: 'owner@platform.test',
      });
      const result = await invoke(
        fixture.handler,
        kind === 'get' ? 'getAuthorizedVisit' : 'listAuthorizedVisits',
        kind === 'get' ? getBody() : listBody(),
      );

      assert.equal(result.response.status, 409);
      assert.equal(result.json.error, 'Platform owner tenant membership must not exist');
      assert.equal(fixture.calls.memberships.length, 1);
      assert.deepEqual(fixture.calls.visits, []);
    }
  }
});
