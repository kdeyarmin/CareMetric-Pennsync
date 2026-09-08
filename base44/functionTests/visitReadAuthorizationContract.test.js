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
const canonicalAssignmentLifecycleSources = [
  new URL('../functions/listAuthorizedPatients/entry.ts', import.meta.url),
  new URL('../functions/managePatientCareTeamAssignment/entry.ts', import.meta.url),
];

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
    start_time: '09:30',
    end_time: '10:30',
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
    emr_handoff_history: [{
      status: 'copied_to_emr',
      reported_by: 'clinician@agency.test',
      reported_at: '2026-09-03T12:25:00.000Z',
      self_reported: true,
      note: 'Copied by the assigned clinician.',
    }],
    documentation_review_ack: { acknowledged: false, is_clinical_signature: false },
    secret_claim: 'must never cross the projection boundary',
    created_date: '2026-09-03T09:00:00.000Z',
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
    version: 1,
    ...overrides,
  };
  if (row.status === 'suspended') {
    if (row.suspended_at === undefined) row.suspended_at = '2026-09-03T12:40:00.000Z';
    if (!Object.hasOwn(overrides, 'version')) row.version = 2;
    if (!Object.hasOwn(overrides, 'last_transition_at')) row.last_transition_at = row.suspended_at;
    if (overrides.last_transition_action === undefined) row.last_transition_action = 'suspend';
  }
  if (row.status === 'revoked') {
    if (row.revoked_at === undefined) row.revoked_at = '2026-09-03T12:40:00.000Z';
    if (row.revocation_reason === undefined) row.revocation_reason = 'Removed from care team';
    if (!Object.hasOwn(overrides, 'version')) row.version = 2;
    if (!Object.hasOwn(overrides, 'last_transition_at')) row.last_transition_at = row.revoked_at;
    if (!Object.hasOwn(overrides, 'last_transition_reason')) {
      row.last_transition_reason = row.revocation_reason;
    }
    if (overrides.last_transition_action === undefined) row.last_transition_action = 'revoke';
  }
  if (row.status === 'active' && row.last_transition_action === 'activate') {
    if (!Object.hasOwn(overrides, 'version')) row.version = 3;
    if (!Object.hasOwn(overrides, 'suspended_at')) {
      row.suspended_at = '2026-09-03T10:30:00.000Z';
    }
    if (!Object.hasOwn(overrides, 'activated_at')) row.activated_at = row.last_transition_at;
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
  onAssignmentFilter = null,
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
  let effectiveMemberships = memberships;
  const indexes = { membership: 0, agency: 0, patient: 0, visit: 0, assignment: 0 };
  const selected = (responses, key, fallback) => {
    const index = indexes[key];
    indexes[key] += 1;
    const resolvedFallback = typeof fallback === 'function' ? fallback() : fallback;
    return responses ? responses[Math.min(index, responses.length - 1)] : resolvedFallback;
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
        filter: entityFilter('memberships', 'membership', membershipResponses, () => effectiveMemberships),
      },
      Agency: { filter: entityFilter('agencies', 'agency', agencyResponses, agencies) },
      Patient: { filter: entityFilter('patients', 'patient', patientResponses, patients) },
      Visit: { filter: entityFilter('visits', 'visit', visitResponses, visits) },
      PatientCareTeamAssignment: {
        filter: async (...args) => {
          const result = await entityFilter(
            'assignments',
            'assignment',
            assignmentResponses,
            assignments,
          )(...args);
          const replacement = onAssignmentFilter?.({
            callNumber: calls.assignments.length,
            memberships: clone(effectiveMemberships),
          });
          if (replacement) effectiveMemberships = replacement;
          return result;
        },
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
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('pragma'), 'no-cache');
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

const EXACT_PURPOSE_FIELDS = {
  schedule: [
    'id', 'patient_id', 'visit_date', 'visit_time', 'visit_type', 'status',
    'start_time', 'end_time', 'updated_date',
  ],
  documentation: [
    'id', 'patient_id', 'visit_date', 'visit_time', 'visit_type', 'status',
    'nurse_notes', 'raw_transcription', 'vital_signs', 'documentation_source',
    'grounding_pending', 'emr_handoff_status', 'emr_handoff_history',
    'documentation_review_ack', 'updated_date',
  ],
  compliance_review: [
    'id', 'patient_id', 'visit_date', 'visit_type', 'status', 'compliance_score',
    'compliance_issues', 'homebound_status_verified', 'skilled_intervention_documented',
    'homebound_justification', 'ai_tags', 'emr_handoff_status',
    'documentation_review_ack', 'updated_date',
  ],
};
const EXACT_PURPOSE_ROLES = {
  schedule: ['platform_owner', 'agency_admin', 'manager', 'clinician'],
  documentation: ['platform_owner', 'agency_admin', 'manager', 'clinician'],
  compliance_review: ['platform_owner', 'agency_admin', 'manager', 'clinician'],
};
const LIST_PURPOSE_FIELDS = {
  schedule: [
    'id', 'patient_id', 'visit_date', 'visit_time', 'visit_type', 'status',
    'start_time', 'end_time', 'updated_date',
  ],
  compliance_review: [
    'id', 'patient_id', 'visit_date', 'visit_type', 'status', 'compliance_score',
    'grounding_pending', 'updated_date',
  ],
  activity: [
    'id', 'patient_id', 'visit_date', 'visit_type', 'status', 'created_date',
    'updated_date',
  ],
  documentation: [
    'id', 'patient_id', 'visit_date', 'visit_time', 'visit_type', 'status',
    'nurse_notes', 'raw_transcription', 'vital_signs', 'documentation_source',
    'grounding_pending', 'updated_date',
  ],
  vitals_trend: [
    'id', 'patient_id', 'visit_date', 'visit_type', 'status', 'vital_signs',
    'updated_date',
  ],
  operations_analytics: [
    'id', 'patient_id', 'visit_date', 'visit_type', 'status', 'start_time',
    'end_time', 'created_by', 'created_date', 'updated_date',
  ],
  reporting: [
    'id', 'patient_id', 'visit_date', 'visit_type', 'status', 'start_time',
    'end_time', 'nurse_notes', 'vital_signs', 'created_by', 'created_date',
    'updated_date',
  ],
  data_quality: [
    'id', 'patient_id', 'visit_date', 'visit_type', 'status', 'nurse_notes',
    'vital_signs', 'homebound_justification', 'updated_date',
  ],
  compliance_monitoring: [
    'id', 'patient_id', 'visit_date', 'visit_type', 'status', 'nurse_notes',
    'compliance_score', 'compliance_issues', 'homebound_status_verified',
    'skilled_intervention_documented', 'homebound_justification',
    'grounding_pending', 'created_by', 'updated_date',
  ],
  ai_tagging: [
    'id', 'patient_id', 'visit_date', 'visit_type', 'status', 'nurse_notes',
    'ai_tags', 'updated_date',
  ],
  hospitalization_risk: [
    'id', 'patient_id', 'visit_date', 'visit_type', 'status', 'nurse_notes',
    'vital_signs', 'updated_date',
  ],
  clinical_insights: [
    'id', 'patient_id', 'visit_date', 'visit_type', 'status', 'vital_signs',
    'created_by', 'updated_date',
  ],
  deduplication: [
    'id', 'patient_id', 'visit_date', 'visit_type', 'status', 'created_by',
    'created_date', 'updated_date',
  ],
};
const LIST_PURPOSE_ROLES = Object.fromEntries(
  Object.keys(LIST_PURPOSE_FIELDS).map((purpose) => [
    purpose,
    ['platform_owner', 'agency_admin', 'manager', 'clinician'],
  ]),
);
const LIST_PURPOSE_MAX_PAGE_SIZE = {
  schedule: 50,
  compliance_review: 25,
  activity: 50,
  documentation: 25,
  vitals_trend: 50,
  operations_analytics: 50,
  reporting: 25,
  data_quality: 25,
  compliance_monitoring: 25,
  ai_tagging: 25,
  hospitalization_risk: 25,
  clinical_insights: 50,
  deduplication: 25,
};

function markedSection(source, start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from);
  assert.notEqual(from, -1, `${start} is required`);
  assert.notEqual(to, -1, `${end} is required`);
  return source.slice(from, to);
}

function namedFunction(source, name) {
  const start = source.indexOf(`function ${name}`);
  assert.notEqual(start, -1, `${name} is required`);
  const open = source.indexOf('{', start);
  assert.notEqual(open, -1, `${name} body is required`);
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    else if (source[index] === '}' && --depth === 0) return source.slice(start, index + 1);
  }
  assert.fail(`${name} body is incomplete`);
}

function quotedValues(body) {
  return [...body.matchAll(/'([^']+)'/g)].map((match) => match[1]);
}

function fieldsFor(policy, purpose, usesSet = false) {
  const prefix = usesSet ? 'new\\s+Set\\s*\\(\\s*\\[' : '\\[';
  const suffix = usesSet ? '\\]\\s*\\)' : '\\]';
  const match = policy.match(new RegExp(
    `(?:^|\\n)\\s*${purpose}:\\s*${prefix}([\\s\\S]*?)${suffix}\\s*,`,
  ));
  assert.ok(match, `${purpose} policy is required`);
  const nonLiteralRemainder = match[1]
    .replace(/'[^']*'/g, '')
    .replace(/[\s,]/g, '');
  assert.equal(
    nonLiteralRemainder,
    '',
    `${purpose} policy must contain only literal field names (no spread/computed additions)`,
  );
  return quotedValues(match[1]);
}

function arrayPurposeKeys(policy, usesSet = false) {
  const prefix = usesSet ? 'new\\s+Set\\s*\\(\\s*\\[' : '\\[';
  return [...policy.matchAll(new RegExp(
    `^\\s{2}([a-z_]+):\\s*${prefix}`,
    'gm',
  ))].map((match) => match[1]);
}

function numericPurposeMap(policy) {
  return Object.fromEntries(
    [...policy.matchAll(/^\s{2}([a-z_]+):\s*(\d+),/gm)]
      .map((match) => [match[1], Number(match[2])]),
  );
}

test('Visit read brokers and wrappers expose an exhaustive finite purpose policy without read bypasses', async () => {
  const getSource = await readFile(brokers.get, 'utf8');
  const listSource = await readFile(brokers.list, 'utf8');
  const getWrapper = await readFile(wrappers.get, 'utf8');
  const listWrapper = await readFile(wrappers.list, 'utf8');
  const canonicalLifecycleSources = await Promise.all(
    canonicalAssignmentLifecycleSources.map((url) => readFile(url, 'utf8')),
  );

  assert.match(getSource, /BEGIN AUTHORIZED VISIT EXACT PURPOSE POLICY/);
  assert.match(listSource, /BEGIN AUTHORIZED VISIT LIST PURPOSE POLICY/);
  for (const source of [getSource, listSource]) {
    assert.doesNotMatch(source, /entities\.Visit\.(?:list|get|create|bulkCreate|update|updateMany|delete)\s*\(/);
    assert.doesNotMatch(source, /assigned_nurses\s*\.(?:includes|some)/);
    assert.match(source, /entities\.Visit\.filter\(/);
    assert.match(source, /entities\.PatientCareTeamAssignment\.filter\(/);
    assert.match(source, /assignee_membership_version_at_enablement !== authority\.membership\.version/);
    assert.ok((source.match(/await loadAuthority\s*\(/g) || []).length >= 4);
    assert.match(source, /await loadAuthority\s*\([\s\S]*?disclosureAuthority\.snapshot[\s\S]*?requirePurposeRole\(auditAuthority/);
    assert.doesNotMatch(source, /console\.error\([^)]*,\s*error\b/);
  }
  const canonicalLifecycle = namedFunction(
    canonicalLifecycleSources[0],
    'assignmentLifecycleIsCoherent',
  );
  assert.equal(
    namedFunction(canonicalLifecycleSources[1], 'assignmentLifecycleIsCoherent'),
    canonicalLifecycle,
  );
  assert.equal(namedFunction(getSource, 'assignmentLifecycleIsCoherent'), canonicalLifecycle);
  assert.equal(namedFunction(listSource, 'assignmentLifecycleIsCoherent'), canonicalLifecycle);
  assert.match(listSource, /query\.id\s*=\s*\{\s*\$gt:\s*input\.cursor\.after_id\s*\}/);
  assert.match(listSource, /'id',\s*\n\s*input\.pageSize \+ 1,/);
  assert.doesNotMatch(listSource, /offset|next_offset|created_desc|visit_date_desc/);
  assert.match(getWrapper, /functions\.invoke\('getAuthorizedVisit'/);
  assert.match(listWrapper, /functions\.invoke\('listAuthorizedVisits'/);
  assert.doesNotMatch(getWrapper, /\.entities\./);
  assert.doesNotMatch(listWrapper, /\.entities\./);

  const getPolicy = markedSection(
    getSource,
    '// <<<BEGIN AUTHORIZED VISIT EXACT PURPOSE POLICY>>>',
    '// <<<END AUTHORIZED VISIT EXACT PURPOSE POLICY>>>',
  );
  const listPolicy = markedSection(
    listSource,
    '// <<<BEGIN AUTHORIZED VISIT LIST PURPOSE POLICY>>>',
    '// <<<END AUTHORIZED VISIT LIST PURPOSE POLICY>>>',
  );
  const getFieldPolicy = getPolicy.slice(0, getPolicy.indexOf('const PURPOSE_ROLES'));
  const getRolePolicy = getPolicy.slice(getPolicy.indexOf('const PURPOSE_ROLES'));
  const listFieldPolicy = listPolicy.slice(0, listPolicy.indexOf('const PURPOSE_ROLES'));
  const listRolePolicy = listPolicy.slice(
    listPolicy.indexOf('const PURPOSE_ROLES'),
    listPolicy.indexOf('const PURPOSE_MAX_PAGE_SIZE'),
  );
  const listPagePolicy = listPolicy.slice(listPolicy.indexOf('const PURPOSE_MAX_PAGE_SIZE'));
  const getWrapperFields = getWrapper.slice(
    getWrapper.indexOf('const PURPOSE_FIELDS'),
    getWrapper.indexOf('const PURPOSE_ROLES'),
  );
  const getWrapperRoles = getWrapper.slice(getWrapper.indexOf('const PURPOSE_ROLES'));
  const listWrapperFields = listWrapper.slice(
    listWrapper.indexOf('const PURPOSE_FIELDS'),
    listWrapper.indexOf('export const AUTHORIZED_VISIT_LIST_PURPOSES'),
  );
  const listWrapperPages = listWrapper.slice(
    listWrapper.indexOf('const PURPOSE_MAX_PAGE_SIZE'),
    listWrapper.indexOf('const PURPOSE_ROLES'),
  );
  const listWrapperRoles = listWrapper.slice(listWrapper.indexOf('const PURPOSE_ROLES'));

  assert.deepEqual(arrayPurposeKeys(getFieldPolicy), Object.keys(EXACT_PURPOSE_FIELDS));
  assert.deepEqual(arrayPurposeKeys(getRolePolicy, true), Object.keys(EXACT_PURPOSE_ROLES));
  assert.deepEqual(arrayPurposeKeys(getWrapperFields, true), Object.keys(EXACT_PURPOSE_FIELDS));
  assert.deepEqual(arrayPurposeKeys(getWrapperRoles, true), Object.keys(EXACT_PURPOSE_ROLES));
  assert.deepEqual(arrayPurposeKeys(listFieldPolicy), Object.keys(LIST_PURPOSE_FIELDS));
  assert.deepEqual(arrayPurposeKeys(listRolePolicy, true), Object.keys(LIST_PURPOSE_ROLES));
  assert.deepEqual(arrayPurposeKeys(listWrapperFields, true), Object.keys(LIST_PURPOSE_FIELDS));
  assert.deepEqual(arrayPurposeKeys(listWrapperRoles, true), Object.keys(LIST_PURPOSE_ROLES));
  assert.deepEqual(numericPurposeMap(listPagePolicy), LIST_PURPOSE_MAX_PAGE_SIZE);
  assert.deepEqual(numericPurposeMap(listWrapperPages), LIST_PURPOSE_MAX_PAGE_SIZE);
  for (const [purpose, fields] of Object.entries(EXACT_PURPOSE_FIELDS)) {
    assert.deepEqual(fieldsFor(getPolicy, purpose), fields);
    assert.deepEqual(fieldsFor(getWrapper, purpose, true), fields);
    assert.deepEqual(fieldsFor(getRolePolicy, purpose, true), EXACT_PURPOSE_ROLES[purpose]);
  }
  for (const [purpose, fields] of Object.entries(LIST_PURPOSE_FIELDS)) {
    assert.deepEqual(fieldsFor(listPolicy, purpose), fields);
    assert.deepEqual(fieldsFor(listWrapper, purpose, true), fields);
    assert.deepEqual(fieldsFor(listRolePolicy, purpose, true), LIST_PURPOSE_ROLES[purpose]);
  }

  const appSources = await Promise.all([
    new URL('../../src/App.jsx', import.meta.url),
    new URL('../../src/routes.jsx', import.meta.url),
  ].map((url) => readFile(url, 'utf8')));
  for (const source of appSources) {
    assert.doesNotMatch(source, /getAuthorizedVisit|listAuthorizedVisits/);
  }
});

test('unknown purposes, arbitrary filters, bad sorts, operators, and unsupported methods fail before privileged reads', async () => {
  for (const kind of ['get', 'list']) {
    const methodFixture = await loadBroker(kind);
    const methodResult = await invoke(methodFixture.handler, kind, {}, 'GET');
    assert.equal(methodResult.response.status, 405);
    assert.equal(methodResult.response.headers.get('allow'), 'POST');

    const bodies = kind === 'get'
      ? [
        getBody({ visit_id: { $in: ['visit-a'] } }),
        getBody({ agency_id: { $eq: 'agency-a' } }),
        getBody({ purpose: 'unreviewed_export' }),
        getBody({ filter: { patient_id: 'patient-a' } }),
      ]
      : [
        listBody({ where: { agency_id: 'agency-b' } }),
        listBody({ filter: { patient_id: 'patient-a' } }),
        listBody({ purpose: 'unreviewed_export' }),
        listBody({ agency_id: { $eq: 'agency-a' } }),
        listBody({ patient_id: { $in: ['patient-a'] } }),
        listBody({ status: { $in: ['completed'] } }),
        listBody({ sort: { $ne: 'id_asc' } }),
        listBody({ purpose: 'documentation', page_size: 26 }),
        listBody({ purpose: 'schedule', page_size: 51 }),
        listBody({ page_size: 1.5 }),
      ];
    for (const body of bodies) {
      const fixture = await loadBroker(kind);
      const invalid = await invoke(fixture.handler, kind, body);
      assert.equal(invalid.response.status, 400);
      assert.equal(fixture.calls.auth, 0);
      assert.deepEqual(fixture.calls.visits, []);
    }
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
    start_time: '09:30',
    end_time: '10:30',
    updated_date: '2026-09-03T12:30:00.000Z',
  });
  assert.equal(result.json.scope.access_basis, 'care_team_assignment');
  assert.equal(result.json.scope.assignment_id, 'assignment-a');
  assert.equal(success.calls.auth, 4);
  assert.equal(success.calls.visits.length, 2);
  assert.equal(success.calls.assignments.length, 3);
  assert.equal(success.calls.securityLogs.length, 1);
  assert.deepEqual(success.calls.securityLogs[0], {
    timestamp: success.calls.securityLogs[0].timestamp,
    user_email: 'clinician@agency.test',
    user_role: 'clinician',
    action: 'VISIT_READ_AUTHORIZED',
    details: {
      broker: 'getAuthorizedVisit',
      resource_type: 'Visit',
      agency_id: 'agency-a',
      purpose: 'schedule',
      subject_user_id: 'user-1',
      membership_id: 'membership-a',
      membership_version: 2,
      returned_count: 1,
    },
    ip_address: 'server-side',
    user_agent: 'server-side',
  });
  assert.equal(Number.isFinite(Date.parse(success.calls.securityLogs[0].timestamp)), true);

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

test('exact and list Visit reads reject incoherent assignment lifecycle histories', async () => {
  const malformed = [
    ['grant at version 3', { version: 3 }],
    ['grant with suspension history', { suspended_at: '2026-09-03T10:30:00.000Z' }],
    ['activate at even version 2', { last_transition_action: 'activate', version: 2 }],
    ['activate at version 1 without a prior suspension', {
      last_transition_action: 'activate',
      version: 1,
      suspended_at: null,
    }],
  ];

  for (const kind of ['get', 'list']) {
    const validActivation = await loadBroker(kind, {
      assignments: [assignment({ last_transition_action: 'activate' })],
    });
    const validResult = await invoke(
      validActivation.handler,
      kind === 'get' ? 'getAuthorizedVisit' : 'listAuthorizedVisits',
      kind === 'get' ? getBody() : listBody(),
    );
    assert.equal(validResult.response.status, 200, `${kind} coherent activation`);

    for (const [label, overrides] of malformed) {
      const fixture = await loadBroker(kind, {
        assignments: [assignment(overrides)],
      });
      const result = await invoke(
        fixture.handler,
        kind === 'get' ? 'getAuthorizedVisit' : 'listAuthorizedVisits',
        kind === 'get' ? getBody() : listBody(),
      );
      assert.equal(result.response.status, 409, `${kind}: ${label}`);
      assert.equal(
        result.json.error,
        'Care-team assignment integrity check failed',
        `${kind}: ${label}`,
      );
      assert.equal(result.json.visit, undefined, `${kind}: ${label}`);
      assert.equal(result.json.visits, undefined, `${kind}: ${label}`);
      assert.equal(fixture.calls.securityLogs.length, 0, `${kind}: ${label}`);
    }
  }
});

test('exact documentation returns the reviewed handoff fields and no unreviewed Visit data', async () => {
  const fixture = await loadBroker('get');
  const result = await invoke(
    fixture.handler,
    'getAuthorizedVisit',
    getBody({ purpose: 'documentation' }),
  );

  assert.equal(result.response.status, 200);
  assert.deepEqual(
    Object.keys(result.json.visit).sort(),
    [...EXACT_PURPOSE_FIELDS.documentation].sort(),
  );
  assert.deepEqual(result.json.visit.emr_handoff_history, [{
    status: 'copied_to_emr',
    reported_by: 'clinician@agency.test',
    reported_at: '2026-09-03T12:25:00.000Z',
    self_reported: true,
    note: 'Copied by the assigned clinician.',
  }]);
  assert.deepEqual(result.json.visit.documentation_review_ack, {
    acknowledged: false,
    is_clinical_signature: false,
  });
  assert.equal(result.json.visit.secret_claim, undefined);
  assert.ok(fixture.calls.visits[0].fields.includes('emr_handoff_status'));
  assert.ok(fixture.calls.visits[0].fields.includes('emr_handoff_history'));
  assert.ok(fixture.calls.visits[0].fields.includes('documentation_review_ack'));
  assert.equal(fixture.calls.visits[0].fields.includes('secret_claim'), false);
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
      resource_type: 'Visit',
      agency_id: 'agency-a',
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

test('exact Visit disclosure fails closed when the privileged audit write fails', async () => {
  const { handler, calls } = await loadBroker('get', {
    auditError: new Error('audit unavailable'),
  });
  const result = await invoke(handler, 'getAuthorizedVisit', getBody());
  assert.equal(result.response.status, 500);
  assert.equal(result.json.visit, undefined);
  assert.equal(result.json.error, 'Internal server error');
  assert.equal(calls.securityLogs.length, 1);
});

test('every Visit list purpose returns only its reviewed projection and enforces its own page cap', async () => {
  for (const [purpose, fields] of Object.entries(LIST_PURPOSE_FIELDS)) {
    const pageSize = LIST_PURPOSE_MAX_PAGE_SIZE[purpose];
    const permitted = await loadBroker('list', {
      memberships: [membership({ tenant_role: 'manager' })],
      assignments: [],
    });
    const result = await invoke(
      permitted.handler,
      'listAuthorizedVisits',
      listBody({ purpose, page_size: pageSize }),
    );
    assert.equal(result.response.status, 200, purpose);
    assert.deepEqual(Object.keys(result.json.visits[0]).sort(), [...fields].sort(), purpose);
    assert.equal(result.json.visits[0].agency_id, undefined, purpose);
    assert.equal(result.json.visits[0].secret_claim, undefined, purpose);

    const overCap = await loadBroker('list', {
      memberships: [membership({ tenant_role: 'manager' })],
      assignments: [],
    });
    const denied = await invoke(
      overCap.handler,
      'listAuthorizedVisits',
      listBody({ purpose, page_size: pageSize + 1 }),
    );
    assert.equal(denied.response.status, 400, purpose);
    assert.equal(overCap.calls.auth, 0, purpose);
    assert.deepEqual(overCap.calls.visits, [], purpose);
  }

  const officeStaff = await loadBroker('list', {
    memberships: [membership({ tenant_role: 'office_staff' })],
    assignments: [],
  });
  const roleDenied = await invoke(
    officeStaff.handler,
    'listAuthorizedVisits',
    listBody({ purpose: 'activity', page_size: 50 }),
  );
  assert.equal(roleDenied.response.status, 403);
  assert.deepEqual(officeStaff.calls.visits, []);
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
  assert.equal(result.json.scope.assignment_version, 1);
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
    {
      kind: 'get',
      purpose: 'documentation',
      overrides: {
        emr_handoff_history: [{
          status: 'copied_to_emr',
          reported_by: 'clinician@agency.test',
          reported_at: '2026-09-03T12:25:00.000Z',
          self_reported: true,
          hidden_phi: 'leak',
        }],
      },
    },
    {
      kind: 'get',
      purpose: 'documentation',
      overrides: {
        emr_handoff_history: [{
          status: 'copied_to_emr',
          reported_by: 'clinician@agency.test',
          reported_at: 'not-an-instant',
          self_reported: true,
        }],
      },
    },
    {
      kind: 'get',
      purpose: 'documentation',
      overrides: {
        emr_handoff_history: Array.from({ length: 101 }, () => ({
          status: 'copied_to_emr',
          reported_by: 'clinician@agency.test',
          reported_at: '2026-09-03T12:25:00.000Z',
          self_reported: true,
        })),
      },
    },
    {
      kind: 'get',
      purpose: 'documentation',
      overrides: {
        documentation_review_ack: { acknowledged: true, is_clinical_signature: true },
      },
    },
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

test('terminal authority fences catch membership revocation during the final assignment read', async () => {
  const revoked = membership({
    status: 'revoked',
    revoked_at: '2026-09-03T12:45:00.000Z',
    revocation_reason: 'Revoked during final assignment verification',
    last_transition_at: '2026-09-03T12:45:00.000Z',
    last_transition_reason: 'Revoked during final assignment verification',
    version: 3,
  });
  for (const kind of ['get', 'list']) {
    const fixture = await loadBroker(kind, {
      onAssignmentFilter: ({ callNumber }) => callNumber === 3 ? [revoked] : null,
    });
    const result = await invoke(
      fixture.handler,
      kind === 'get' ? 'getAuthorizedVisit' : 'listAuthorizedVisits',
      kind === 'get' ? getBody() : listBody(),
    );
    assert.equal(result.response.status, 403, kind);
    assert.equal(result.json.visit, undefined, kind);
    assert.equal(result.json.visits, undefined, kind);
    assert.equal(fixture.calls.assignments.length, 3, kind);
    assert.equal(fixture.calls.auth, 4, kind);
    assert.equal(fixture.calls.securityLogs.length, 0, kind);
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
  assert.equal(permitted.calls.memberships.length, 4);
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
