import assert from 'node:assert/strict';
import { join } from 'node:path';
import { readFile, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import JSON5 from 'json5';
import { transpileTs } from '../../tools-transpile-ts.mjs';
const brokers = {
  get: new URL('../functions/getAuthorizedPatient/entry.ts', import.meta.url),
  list: new URL('../functions/listAuthorizedPatients/entry.ts', import.meta.url),
};
const wrappers = {
  get: new URL('../../src/functions/getAuthorizedPatient.js', import.meta.url),
  list: new URL('../../src/functions/listAuthorizedPatients.js', import.meta.url),
};
const patientEntity = new URL('../entities/Patient.jsonc', import.meta.url);

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

const agency = (overrides = {}) => ({
  id: 'agency-a',
  status: 'active',
  ...overrides,
});

function patient(overrides = {}) {
  const row = {
    id: 'patient-a',
    agency_id: 'agency-a',
    created_by_user_id: 'user-1',
    created_by_user_email_normalized: 'clinician@agency.test',
    created_by: 'clinician@agency.test',
    client_request_id: 'create-request-a',
    first_name: 'Ada',
    middle_name: '',
    last_name: 'Lovelace',
    medical_record_number: 'MRN-1',
    date_of_birth: '1815-12-10',
    phone: '555-0100',
    email: 'ada@example.test',
    address: '1 Computing Way',
    emergency_contact_name: 'Charles Babbage',
    emergency_contact_phone: '555-0101',
    emergency_contact_relationship: 'colleague',
    physician_name: 'Dr. Hopper',
    physician_phone: '555-0102',
    physician_email: 'hopper@example.test',
    caregiver_name: 'Mary Somerville',
    caregiver_email: 'somerville@example.test',
    caregiver_phone: '555-0103',
    primary_diagnosis: 'I10',
    secondary_diagnoses: ['E11.9'],
    allergies: ['none known'],
    past_hospitalizations: ['2025-01-10'],
    status: 'active',
    care_type: 'home_health',
    admission_date: '2026-09-01',
    assigned_nurses: ['clinician@agency.test'],
    active_alerts: [{ id: 'hidden' }],
    clinical_notes: 'hidden',
    is_sample: false,
    is_archived: false,
    created_date: '2026-09-01T12:00:00.000Z',
    updated_date: '2026-09-03T12:00:00.000Z',
    ...overrides,
  };
  row.patient_creation_key = overrides.patient_creation_key
    ?? `${row.agency_id}:${row.created_by_user_id}:${row.client_request_id}`;
  return row;
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
    if (row.suspended_at === undefined) row.suspended_at = '2026-09-03T12:30:00.000Z';
    if (!Object.hasOwn(overrides, 'version')) row.version = 2;
    if (!Object.hasOwn(overrides, 'last_transition_at')) row.last_transition_at = row.suspended_at;
    if (overrides.last_transition_action === undefined) row.last_transition_action = 'suspend';
  }
  if (row.status === 'revoked') {
    if (row.revoked_at === undefined) row.revoked_at = '2026-09-03T12:30:00.000Z';
    if (row.revocation_reason === undefined) row.revocation_reason = 'Removed from care team';
    if (!Object.hasOwn(overrides, 'version')) row.version = 2;
    if (!Object.hasOwn(overrides, 'last_transition_at')) row.last_transition_at = row.revoked_at;
    if (!Object.hasOwn(overrides, 'last_transition_reason')) {
      row.last_transition_reason = row.revocation_reason;
    }
    if (overrides.last_transition_action === undefined) row.last_transition_action = 'revoke';
  }
  return row;
}

function assignmentFor(patientId, overrides = {}) {
  const agencyId = overrides.agency_id ?? 'agency-a';
  const userId = overrides.user_id ?? 'user-1';
  const requestId = overrides.last_transition_request_id ?? `assignment-request-${patientId}`;
  const key = overrides.assignment_key ?? `${agencyId}:${patientId}:${userId}`;
  return assignment({
    id: overrides.id ?? `assignment-${patientId}`,
    patient_id: patientId,
    assignment_key: key,
    last_transition_request_id: requestId,
    last_transition_request_key: overrides.last_transition_request_key ?? `${key}:${requestId}`,
    ...overrides,
  });
}

function nonCreatorPatient(id, overrides = {}) {
  return patient({
    id,
    created_by_user_id: 'user-2',
    created_by_user_email_normalized: 'other@agency.test',
    created_by: 'other@agency.test',
    client_request_id: `other-create-${id}`,
    ...overrides,
  });
}

async function importHandler(kind, makeClient, superAdminEmail = null) {
  let source = await readFile(brokers[kind], 'utf8');
  const globalName = `__patientReadMakeClient_${kind}_${Math.random().toString(36).slice(2)}`;
  source = source.replace(
    /import\s+\{\s*createClientFromRequest\s*\}\s+from\s+'npm:[^']+';/,
    `const createClientFromRequest = globalThis.${globalName};`,
  );
  const temporaryModule = join(
    tmpdir(),
    `patient_read_${kind}_${Date.now()}_${Math.random().toString(36).slice(2)}.mjs`,
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
  assignments = [],
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
    assignments: [],
    securityLogs: [],
  };
  let membershipIndex = 0;
  let agencyIndex = 0;
  let patientIndex = 0;
  let assignmentIndex = 0;
  let effectiveMemberships = memberships;

  const selected = (responses, index, fallback) => (
    responses ? responses[Math.min(index, responses.length - 1)] : fallback
  );
  const matches = (row, query) => Object.entries(query || {}).every(([field, value]) => {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      if (Array.isArray(value.$in)) return value.$in.includes(row?.[field]);
      if (typeof value.$gt === 'string') return row?.[field] > value.$gt;
      return false;
    }
    return row?.[field] === value;
  });
  const filterRows = (rows, query, limit, offset = 0, sort = undefined) => {
    if (!Array.isArray(rows)) return rows;
    const matching = ignoreFilters ? rows : rows.filter((row) => matches(row, query));
    const ascendingField = typeof sort === 'string' && !sort.startsWith('-') ? sort : null;
    const ordered = ascendingField
      ? [...matching].sort((left, right) => (
        String(left?.[ascendingField]).localeCompare(String(right?.[ascendingField]))
      ))
      : matching;
    return ordered.slice(offset, Number.isFinite(limit) ? offset + limit : undefined);
  };

  const serviceRole = {
    entities: {
      AgencyMembership: {
        filter: async (query, sort, limit) => {
          calls.memberships.push({ query: clone(query), sort, limit });
          const rows = selected(membershipResponses, membershipIndex++, effectiveMemberships);
          return filterRows(clone(rows), query, limit);
        },
      },
      Agency: {
        filter: async (query, sort, limit) => {
          calls.agencies.push({ query: clone(query), sort, limit });
          const rows = selected(agencyResponses, agencyIndex++, agencies);
          return filterRows(clone(rows), query, limit);
        },
      },
      Patient: {
        filter: async (query, sort, limit, offset, fields) => {
          calls.patients.push({ query: clone(query), sort, limit, offset, fields: clone(fields) });
          const rows = selected(patientResponses, patientIndex++, patients);
          return filterRows(clone(rows), query, limit, offset, sort);
        },
      },
      PatientCareTeamAssignment: {
        filter: async (query, sort, limit, offset, fields) => {
          calls.assignments.push({ query: clone(query), sort, limit, offset, fields: clone(fields) });
          const rows = selected(assignmentResponses, assignmentIndex++, assignments);
          const result = filterRows(clone(rows), query, limit, offset, sort);
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
    ...(method === 'GET' || method === 'HEAD' ? {} : { body: JSON.stringify(body) }),
  });
  const response = await handler(request);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('pragma'), 'no-cache');
  return { response, json: await response.json() };
}

const getBody = (overrides = {}) => ({
  agency_id: 'agency-a',
  patient_id: 'patient-a',
  purpose: 'display',
  ...overrides,
});

const pageBody = (overrides = {}) => ({
  agency_id: 'agency-a',
  mode: 'page',
  purpose: 'roster',
  page_size: 25,
  sort: 'id_asc',
  ...overrides,
});

const pageCursor = (overrides = {}) => ({
  version: 1,
  after_id: 'patient-a',
  agency_id: 'agency-a',
  purpose: 'roster',
  status: null,
  sort: 'id_asc',
  page_size: 25,
  subject_user_id: 'user-1',
  membership_id: 'membership-a',
  membership_version: 2,
  tenant_role: 'clinician',
  ...overrides,
});

const EXACT_PURPOSE_FIELDS = {
  display: ['id', 'first_name', 'middle_name', 'last_name'],
  selector: [
    'id', 'first_name', 'middle_name', 'last_name', 'medical_record_number',
    'status', 'care_type', 'primary_diagnosis', 'updated_date',
  ],
  alert_analysis: [
    'id', 'first_name', 'middle_name', 'last_name', 'primary_diagnosis',
    'secondary_diagnoses', 'care_type', 'status', 'allergies',
  ],
  education_context: [
    'id', 'first_name', 'middle_name', 'last_name', 'primary_diagnosis',
    'physician_name', 'allergies',
  ],
  visit_summary: [
    'id', 'first_name', 'middle_name', 'last_name', 'date_of_birth',
    'primary_diagnosis',
  ],
  health_history_write_base: [
    'id', 'past_medical_history', 'past_hospitalizations', 'updated_date',
  ],
  smart_note_context: [
    'id', 'first_name', 'middle_name', 'last_name', 'date_of_birth',
    'medical_record_number', 'status', 'care_type', 'primary_diagnosis',
    'secondary_diagnoses', 'chronic_conditions', 'past_medical_history',
    'current_medications', 'allergies', 'functional_status', 'wounds',
    'enhanced_notes_history', 'clinical_notes', 'updated_date',
  ],
  oasis_analysis_context: [
    'id', 'first_name', 'middle_name', 'last_name', 'date_of_birth',
    'admission_date', 'admission_source', 'primary_diagnosis',
    'secondary_diagnoses', 'allergies', 'current_medications',
    'functional_status', 'baseline_vitals', 'social_history',
    'advance_directives', 'past_hospitalizations', 'updated_date',
  ],
};
const EXACT_PURPOSE_ROLES = {
  display: ['platform_owner', 'agency_admin', 'manager', 'clinician', 'social_worker', 'spiritual_care'],
  selector: ['platform_owner', 'agency_admin', 'manager', 'clinician', 'social_worker', 'spiritual_care'],
  alert_analysis: ['platform_owner', 'agency_admin', 'manager', 'clinician'],
  education_context: ['platform_owner', 'agency_admin', 'manager', 'clinician', 'social_worker', 'spiritual_care'],
  visit_summary: ['platform_owner', 'agency_admin', 'manager', 'clinician', 'social_worker', 'spiritual_care'],
  health_history_write_base: ['platform_owner', 'agency_admin', 'manager', 'clinician'],
  smart_note_context: ['platform_owner', 'agency_admin', 'manager', 'clinician'],
  oasis_analysis_context: ['platform_owner', 'agency_admin', 'manager', 'clinician'],
};
const LIST_PURPOSE_FIELDS = {
  roster: [
    'id', 'first_name', 'middle_name', 'last_name', 'medical_record_number',
    'status', 'care_type', 'admission_date', 'primary_diagnosis', 'updated_date',
  ],
  contact: [
    'id', 'first_name', 'middle_name', 'last_name', 'phone', 'email',
    'emergency_contact_name', 'emergency_contact_phone',
    'emergency_contact_relationship', 'physician_name', 'physician_phone',
    'physician_email', 'caregiver_name', 'caregiver_email', 'caregiver_phone',
  ],
  identity_match: [
    'id', 'first_name', 'middle_name', 'last_name', 'date_of_birth',
    'medical_record_number', 'phone', 'address',
  ],
  patient_management: [
    'id', 'first_name', 'middle_name', 'last_name', 'date_of_birth',
    'medical_record_number', 'address', 'phone', 'email', 'status', 'care_type',
    'admission_date', 'primary_diagnosis', 'secondary_diagnoses', 'allergies',
    'created_date', 'updated_date',
  ],
  data_quality: [
    'id', 'first_name', 'middle_name', 'last_name', 'status', 'phone',
    'emergency_contact_name', 'emergency_contact_phone', 'physician_name',
    'updated_date',
  ],
  risk_analysis: [
    'id', 'first_name', 'middle_name', 'last_name', 'date_of_birth', 'status',
    'care_type', 'admission_date', 'primary_diagnosis', 'secondary_diagnoses',
    'past_hospitalizations', 'updated_date',
  ],
  deduplication: [
    'id', 'first_name', 'middle_name', 'last_name', 'date_of_birth',
    'medical_record_number', 'address', 'phone', 'email',
    'emergency_contact_phone', 'caregiver_email', 'caregiver_phone',
    'physician_email', 'status', 'created_date', 'updated_date',
  ],
  education_delivery: [
    'id', 'first_name', 'middle_name', 'last_name', 'medical_record_number',
    'status', 'care_type', 'primary_diagnosis', 'email', 'updated_date',
  ],
};
const LIST_PURPOSE_ROLES = {
  roster: ['platform_owner', 'agency_admin', 'manager', 'clinician', 'social_worker', 'spiritual_care'],
  contact: ['platform_owner', 'agency_admin', 'manager', 'clinician'],
  identity_match: ['platform_owner', 'agency_admin', 'manager'],
  patient_management: [
    'platform_owner', 'agency_admin', 'manager', 'office_staff', 'clinician',
    'social_worker', 'spiritual_care',
  ],
  data_quality: ['platform_owner', 'agency_admin', 'manager'],
  risk_analysis: ['platform_owner', 'agency_admin', 'manager', 'clinician'],
  deduplication: ['platform_owner', 'agency_admin', 'manager', 'office_staff', 'clinician'],
  education_delivery: [
    'platform_owner', 'agency_admin', 'manager', 'office_staff', 'clinician',
    'social_worker', 'spiritual_care',
  ],
};
const LIST_PURPOSE_MAX_PAGE_SIZE = {
  roster: 50,
  contact: 25,
  identity_match: 25,
  patient_management: 50,
  data_quality: 50,
  risk_analysis: 50,
  deduplication: 25,
  education_delivery: 50,
};

function markedSection(source, start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from);
  assert.notEqual(from, -1, `${start} is required`);
  assert.notEqual(to, -1, `${end} is required`);
  return source.slice(from, to);
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

test('read brokers expose finite projections and contain no read bypass or Patient write', async () => {
  const getSource = await readFile(brokers.get, 'utf8');
  const listSource = await readFile(brokers.list, 'utf8');
  const getWrapper = await readFile(wrappers.get, 'utf8');
  const listWrapper = await readFile(wrappers.list, 'utf8');
  const schema = JSON5.parse(await readFile(patientEntity, 'utf8'));

  assert.equal(schema.rls.read, false);

  assert.match(getSource, /BEGIN AUTHORIZED PATIENT EXACT PURPOSE POLICY/);
  assert.match(listSource, /BEGIN AUTHORIZED PATIENT LIST PURPOSE POLICY/);
  for (const source of [getSource, listSource]) {
    assert.doesNotMatch(source, /entities\.Patient\.(?:list|get|create|bulkCreate|update|updateMany|delete)\s*\(/);
    assert.doesNotMatch(source, /assigned_nurses\s*\.(?:includes|some)/);
    assert.match(source, /created_by_user_id/);
    assert.match(source, /patient_creation_key/);
    assert.ok((source.match(/await loadAuthority\s*\(/g) || []).length >= 2);
  }
  assert.ok((listSource.match(/await loadAuthority\s*\(/g) || []).length >= 4);
  assert.match(
    listSource,
    /await loadAuthority\s*\([\s\S]*?disclosureAuthority\.snapshot[\s\S]*?requirePurposeRole\(auditAuthority/,
  );
  assert.match(getSource, /patientReadFields\(purpose\)/);
  assert.match(
    getSource,
    /MEMBERSHIP_AUTHORITY_FIELDS[\s\S]*?'revoked_at'[\s\S]*?'revocation_reason'/,
  );
  assert.match(getSource, /entities\.PatientCareTeamAssignment\.filter\(/);
  assert.doesNotMatch(
    getSource,
    /entities\.PatientCareTeamAssignment\.(?:create|bulkCreate|update|updateMany|delete)\s*\(/,
  );
  assert.match(listSource, /patientReadFields\(input\.purpose\)/);
  assert.match(listSource, /entities\.PatientCareTeamAssignment\.filter\(/);
  assert.doesNotMatch(
    listSource,
    /entities\.PatientCareTeamAssignment\.(?:create|bulkCreate|update|updateMany|delete)\s*\(/,
  );
  assert.match(listSource, /ASSIGNMENT_AUTHORITY_FIELDS/);
  assert.match(listSource, /query\.patient_id\s*=\s*\{\s*\$gt:\s*scanAfter\s*\}/);
  assert.match(listSource, /'patient_id',\s*\n\s*limit,\s*\n\s*undefined,\s*\n\s*ASSIGNMENT_AUTHORITY_FIELDS/);
  assert.match(listSource, /entities\.Patient\.filter\(/);
  assert.match(listSource, /query\.id\s*=\s*\{\s*\$gt:\s*input\.cursor\.after_id\s*\}/);
  assert.match(listSource, /['"]id['"],\s*\n\s*input\.pageSize \+ 1,\s*\n\s*undefined,/);
  assert.doesNotMatch(listSource, /MAX_PAGE_OFFSET|next_offset|updated_desc|name_asc/);
  assert.doesNotMatch(getWrapper, /\.entities\./);
  assert.doesNotMatch(listWrapper, /\.entities\./);
  assert.doesNotMatch(listWrapper, /MAX_PAGE_OFFSET|next_offset|updated_desc|name_asc/);
  assert.match(getWrapper, /functions\.invoke\('getAuthorizedPatient'/);
  assert.match(listWrapper, /functions\.invoke\('listAuthorizedPatients'/);
  assert.match(getSource, /console\.error\('getAuthorizedPatient failed'\)/);
  assert.match(listSource, /console\.error\('listAuthorizedPatients failed'\)/);
  assert.doesNotMatch(getSource, /console\.error\([^)]*,\s*error\b/);
  assert.doesNotMatch(listSource, /console\.error\([^)]*,\s*error\b/);

  const getPolicy = markedSection(
    getSource,
    '// <<<BEGIN AUTHORIZED PATIENT EXACT PURPOSE POLICY>>>',
    '// <<<END AUTHORIZED PATIENT EXACT PURPOSE POLICY>>>',
  );
  const listPolicy = markedSection(
    listSource,
    '// <<<BEGIN AUTHORIZED PATIENT LIST PURPOSE POLICY>>>',
    '// <<<END AUTHORIZED PATIENT LIST PURPOSE POLICY>>>',
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
    listWrapper.indexOf('export const AUTHORIZED_PATIENT_LIST_PURPOSES'),
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
    assert.deepEqual(fieldsFor(getPolicy.slice(getPolicy.indexOf('const PURPOSE_ROLES')), purpose, true), EXACT_PURPOSE_ROLES[purpose]);
  }
  for (const [purpose, fields] of Object.entries(LIST_PURPOSE_FIELDS)) {
    assert.deepEqual(fieldsFor(listPolicy, purpose), fields);
    assert.deepEqual(fieldsFor(listWrapper, purpose, true), fields);
    assert.deepEqual(fieldsFor(listPolicy.slice(listPolicy.indexOf('const PURPOSE_ROLES')), purpose, true), LIST_PURPOSE_ROLES[purpose]);
  }

  const getAuthority = markedSection(
    getSource,
    '// <<<BEGIN SHARED PATIENT READ TENANT AUTHORITY>>>',
    '// <<<END SHARED PATIENT READ TENANT AUTHORITY>>>',
  );
  const listAuthority = markedSection(
    listSource,
    '// <<<BEGIN SHARED PATIENT READ TENANT AUTHORITY>>>',
    '// <<<END SHARED PATIENT READ TENANT AUTHORITY>>>',
  );
  assert.equal(listAuthority, getAuthority, 'tenant authority core must remain identical');
});

test('both brokers reject unknown purposes, arbitrary filters, bad sorts, and operator-shaped input before privileged reads', async () => {
  for (const kind of ['get', 'list']) {
    const methodFixture = await loadBroker(kind);
    const getResult = await invoke(methodFixture.handler, kind, {}, 'GET');
    assert.equal(getResult.response.status, 405);
    assert.equal(getResult.response.headers.get('allow'), 'POST');

    const bodies = kind === 'get'
      ? [
        getBody({ patient_id: { $in: ['patient-a'] } }),
        getBody({ agency_id: { $eq: 'agency-a' } }),
        getBody({ purpose: 'unreviewed_export' }),
        getBody({ filter: { status: 'active' } }),
      ]
      : [
        pageBody({ where: { agency_id: 'agency-b' } }),
        pageBody({ filter: { status: 'active' } }),
        pageBody({ purpose: 'unreviewed_export' }),
        pageBody({ agency_id: { $eq: 'agency-a' } }),
        pageBody({ status: { $in: ['active'] } }),
        pageBody({ sort: { $ne: 'id_asc' } }),
        pageBody({ purpose: 'contact', page_size: 26 }),
        pageBody({ purpose: 'roster', page_size: 51 }),
        {
          agency_id: 'agency-a', mode: 'ids', purpose: 'roster',
          patient_ids: [{ $in: ['patient-a'] }],
        },
      ];
    for (const body of bodies) {
      const fixture = await loadBroker(kind);
      const invalid = await invoke(fixture.handler, kind, body);
      assert.equal(invalid.response.status, 400);
      assert.equal(fixture.calls.auth, 0);
      assert.deepEqual(fixture.calls.memberships, []);
      assert.deepEqual(fixture.calls.patients, []);
    }
  }
});

test('anonymous, disabled, service, and unverified callers fail before service-role reads', async () => {
  const deniedCallers = [
    { caller: null, status: 401 },
    { caller: { ...USER, disabled: true }, status: 403 },
    { caller: { ...USER, is_service: true }, status: 403 },
    { caller: { ...USER, is_verified: false }, status: 403 },
  ];
  for (const kind of ['get', 'list']) {
    for (const scenario of deniedCallers) {
      const { handler, calls } = await loadBroker(kind, { caller: scenario.caller });
      const result = await invoke(
        handler,
        kind,
        kind === 'get' ? getBody() : pageBody(),
      );
      assert.equal(result.response.status, scenario.status);
      assert.equal(calls.serviceRole, 0);
      assert.deepEqual(calls.memberships, []);
      assert.deepEqual(calls.agencies, []);
      assert.deepEqual(calls.patients, []);
    }
  }
});

test('active or suspended membership rows polluted with revocation fields fail closed', async () => {
  const polluted = [
    membership({
      status: 'active',
      revoked_at: '2026-09-03T12:30:00.000Z',
      revocation_reason: 'Invalid active-row revocation metadata',
    }),
    membership({
      status: 'suspended',
      revoked_at: '2026-09-03T12:30:00.000Z',
      revocation_reason: 'Invalid suspended-row revocation metadata',
    }),
  ];
  for (const kind of ['get', 'list']) {
    for (const row of polluted) {
      const { handler, calls } = await loadBroker(kind, { memberships: [row] });
      const result = await invoke(
        handler,
        kind,
        kind === 'get' ? getBody() : pageBody(),
      );
      assert.equal(result.response.status, 409);
      assert.deepEqual(calls.patients, []);
    }
  }
});

test('exact display creator read rechecks authority and projects no protected fields', async () => {
  const { handler, calls } = await loadBroker('get');
  const { response, json } = await invoke(handler, 'getAuthorizedPatient', getBody());
  assert.equal(response.status, 200);
  assert.deepEqual(Object.keys(json.patient).sort(), [
    'first_name', 'id', 'last_name', 'middle_name',
  ]);
  assert.equal(json.patient.active_alerts, undefined);
  assert.equal(json.patient.created_by_user_id, undefined);
  assert.equal(calls.auth, 2);
  assert.equal(calls.memberships.length, 2);
  assert.equal(calls.agencies.length, 2);
  assert.equal(calls.patients.length, 2);
  assert.deepEqual(calls.patients[0], {
    query: {
      id: 'patient-a',
      agency_id: 'agency-a',
      is_sample: false,
      is_archived: false,
    },
    sort: undefined,
    limit: 10,
    offset: undefined,
    fields: [
      'id', 'agency_id', 'created_by_user_id', 'created_by_user_email_normalized',
      'created_by', 'client_request_id', 'patient_creation_key', 'is_sample',
      'is_archived', 'status', 'updated_date', 'first_name', 'middle_name', 'last_name',
    ],
  });
  assert.deepEqual(calls.assignments, []);
  assert.equal(calls.securityLogs.length, 1);
  assert.deepEqual(calls.securityLogs[0], {
    timestamp: calls.securityLogs[0].timestamp,
    user_email: 'clinician@agency.test',
    user_role: 'clinician',
    action: 'PATIENT_READ_AUTHORIZED',
    details: {
      broker: 'getAuthorizedPatient',
      agency_id: 'agency-a',
      patient_id: 'patient-a',
      purpose: 'display',
      subject_user_id: 'user-1',
      membership_id: 'membership-a',
      membership_version: 2,
    },
    ip_address: 'server-side',
    user_agent: 'server-side',
  });
  assert.equal(Number.isFinite(Date.parse(calls.securityLogs[0].timestamp)), true);
});

test('exact Patient disclosure fails closed when the privileged audit write fails', async () => {
  const { handler, calls } = await loadBroker('get', {
    auditError: new Error('audit unavailable'),
  });
  const { response, json } = await invoke(handler, 'getAuthorizedPatient', getBody());
  assert.equal(response.status, 500);
  assert.equal(json.patient, undefined);
  assert.equal(json.error, 'Internal server error');
  assert.equal(calls.securityLogs.length, 1);
});

test('an exact active care-team assignment authorizes a non-creator narrow read and is rechecked', async () => {
  const nonCreator = patient({
    created_by_user_id: 'user-2',
    created_by_user_email_normalized: 'other@agency.test',
    created_by: 'other@agency.test',
    client_request_id: 'other-create-request',
  });
  const { handler, calls } = await loadBroker('get', {
    patients: [nonCreator],
    assignments: [assignment()],
  });
  const { response, json } = await invoke(
    handler,
    'getAuthorizedPatient',
    getBody({ purpose: 'visit_summary' }),
  );
  assert.equal(response.status, 200);
  assert.deepEqual(Object.keys(json.patient).sort(), [
    'date_of_birth', 'first_name', 'id', 'last_name', 'middle_name', 'primary_diagnosis',
  ]);
  assert.equal(json.patient.created_by_user_id, undefined);
  assert.equal(calls.assignments.length, 2);
  for (const call of calls.assignments) {
    assert.deepEqual(call.query, {
      assignment_key: 'agency-a:patient-a:user-1',
      agency_id: 'agency-a',
      patient_id: 'patient-a',
      user_id: 'user-1',
    });
    assert.equal(call.limit, 10);
    assert.equal(call.sort, '-updated_date');
    assert.equal(call.fields.includes('assigned_nurses'), false);
  }
});

test('agency-wide exact readers remain independent of care-team assignment rows', async () => {
  const nonCreator = patient({
    created_by_user_id: 'user-2',
    created_by_user_email_normalized: 'other@agency.test',
    created_by: 'other@agency.test',
    client_request_id: 'manager-read-target',
  });
  const { handler, calls } = await loadBroker('get', {
    memberships: [membership({ tenant_role: 'manager' })],
    patients: [nonCreator],
  });
  const result = await invoke(handler, 'getAuthorizedPatient', getBody());
  assert.equal(result.response.status, 200);
  assert.deepEqual(calls.assignments, []);
});

test('inactive, absent, and foreign care-team evidence cannot authorize a non-creator', async () => {
  const nonCreator = patient({
    created_by_user_id: 'user-2',
    created_by_user_email_normalized: 'other@agency.test',
    created_by: 'other@agency.test',
    client_request_id: 'other-create-request',
  });
  const cases = [
    [],
    [assignment({ status: 'suspended' })],
    [assignment({ status: 'revoked' })],
    [assignment({
      agency_id: 'agency-b',
      assignment_key: 'agency-b:patient-a:user-1',
      last_transition_request_key: 'agency-b:patient-a:user-1:assignment-request-a',
    })],
  ];
  for (const assignments of cases) {
    const { handler } = await loadBroker('get', { patients: [nonCreator], assignments });
    const result = await invoke(handler, 'getAuthorizedPatient', getBody());
    assert.equal(result.response.status, 404);
    assert.equal(result.json.error, 'Patient unavailable');
  }
});

test('malformed, duplicate, or mismatched assignment bindings fail closed', async () => {
  const nonCreator = patient({
    created_by_user_id: 'user-2',
    created_by_user_email_normalized: 'other@agency.test',
    created_by: 'other@agency.test',
    client_request_id: 'other-create-request',
  });
  const cases = [
    [assignment({ last_transition_at: 'not-an-instant' })],
    [assignment(), assignment({ id: 'assignment-b' })],
    [assignment({ assignee_membership_id: 'membership-b' })],
    [assignment({ assignee_membership_version_at_enablement: 3 })],
    [assignment({ user_email_normalized: 'other@agency.test' })],
    [assignment({ version: 2 })],
    [assignment({
      status: 'active',
      version: 4,
      suspended_at: '2026-09-03T12:00:00.000Z',
      activated_at: '2026-09-03T12:30:00.000Z',
      last_transition_at: '2026-09-03T12:30:00.000Z',
      last_transition_action: 'activate',
    })],
    [assignment({
      status: 'suspended',
      version: 1,
      suspended_at: '2026-09-03T12:30:00.000Z',
      last_transition_at: '2026-09-03T12:30:00.000Z',
      last_transition_action: 'suspend',
    })],
    [assignment({
      status: 'revoked',
      version: 2,
      revoked_at: '2026-09-03T12:30:00.000Z',
      revocation_reason: 'Removed from care team',
      last_transition_at: '2026-09-03T12:00:00.000Z',
      last_transition_reason: 'Removed from care team',
      last_transition_action: 'revoke',
    })],
  ];
  for (const assignments of cases) {
    const { handler } = await loadBroker('get', { patients: [nonCreator], assignments });
    const result = await invoke(handler, 'getAuthorizedPatient', getBody());
    assert.equal(result.response.status, 409);
    assert.equal(result.json.patient, undefined);
  }

  const leakedForeign = await loadBroker('get', {
    patients: [nonCreator],
    assignments: [assignment({
      agency_id: 'agency-b',
      assignment_key: 'agency-b:patient-a:user-1',
      last_transition_request_key: 'agency-b:patient-a:user-1:assignment-request-a',
    })],
    ignoreFilters: true,
  });
  const leakedResult = await invoke(leakedForeign.handler, 'getAuthorizedPatient', getBody());
  assert.equal(leakedResult.response.status, 409);
  assert.equal(leakedResult.json.patient, undefined);
});

test('care-team assignments require the exact current membership version for every patient read', async () => {
  const target = nonCreatorPatient('patient-a');
  const staleAssignment = assignmentFor('patient-a', {
    assignee_membership_version_at_enablement: 1,
  });

  const exact = await loadBroker('get', {
    patients: [target],
    assignments: [staleAssignment],
  });
  const exactResult = await invoke(exact.handler, 'getAuthorizedPatient', getBody());
  assert.equal(exactResult.response.status, 409);
  assert.equal(exactResult.json.patient, undefined);

  const roster = await loadBroker('list', {
    patients: [target],
    assignments: [staleAssignment],
  });
  const rosterResult = await invoke(
    roster.handler,
    'listAuthorizedPatients',
    pageBody(),
  );
  assert.equal(rosterResult.response.status, 409);
  assert.equal(rosterResult.json.patients, undefined);
});

test('assignment suspension or version drift during an exact read returns no PHI', async () => {
  const nonCreator = patient({
    created_by_user_id: 'user-2',
    created_by_user_email_normalized: 'other@agency.test',
    created_by: 'other@agency.test',
    client_request_id: 'other-create-request',
  });
  const driftCases = [
    assignment({
      status: 'suspended',
      version: 2,
      last_transition_at: '2026-09-03T12:30:00.000Z',
      suspended_at: '2026-09-03T12:30:00.000Z',
      last_transition_action: 'suspend',
      last_transition_request_id: 'suspend-request-a',
      last_transition_request_key: 'agency-a:patient-a:user-1:suspend-request-a',
    }),
    assignment({
      version: 3,
      suspended_at: '2026-09-03T12:00:00.000Z',
      activated_at: '2026-09-03T12:30:00.000Z',
      last_transition_at: '2026-09-03T12:30:00.000Z',
      last_transition_action: 'activate',
      last_transition_request_id: 'activate-request-a',
      last_transition_request_key: 'agency-a:patient-a:user-1:activate-request-a',
    }),
  ];
  for (const changed of driftCases) {
    const { handler } = await loadBroker('get', {
      patients: [nonCreator],
      assignmentResponses: [[assignment()], [changed]],
    });
    const result = await invoke(handler, 'getAuthorizedPatient', getBody());
    assert.equal(result.response.status, 409);
    assert.match(result.json.error, /authority changed/);
    assert.equal(result.json.patient, undefined);
  }
});

test('missing, foreign, and mutable-email-only assigned exact charts are indistinguishable', async () => {
  const missingBroker = await loadBroker('get', { patients: [] });
  const missing = await invoke(missingBroker.handler, 'getAuthorizedPatient', getBody());

  const foreignBroker = await loadBroker('get', {
    patients: [patient({ agency_id: 'agency-b' })],
    ignoreFilters: true,
  });
  const foreign = await invoke(foreignBroker.handler, 'getAuthorizedPatient', getBody());

  const assignedOnlyBroker = await loadBroker('get', {
    patients: [patient({
      created_by_user_id: 'user-2',
      created_by_user_email_normalized: 'other@agency.test',
      created_by: 'other@agency.test',
      client_request_id: 'create-request-other',
      assigned_nurses: ['clinician@agency.test'],
    })],
  });
  const assignedOnly = await invoke(assignedOnlyBroker.handler, 'getAuthorizedPatient', getBody());

  assert.equal(missing.response.status, 404);
  assert.equal(foreign.response.status, 404);
  assert.equal(assignedOnly.response.status, 404);
  assert.equal(missing.json.error, 'Patient unavailable');
  assert.equal(foreign.json.error, missing.json.error);
  assert.equal(assignedOnly.json.error, missing.json.error);
});

test('exact read fails closed when membership authority changes during the request', async () => {
  const { handler } = await loadBroker('get', {
    membershipResponses: [
      [membership()],
      [membership({ tenant_role: 'manager', version: 3 })],
    ],
  });
  const { response, json } = await invoke(handler, 'getAuthorizedPatient', getBody());
  assert.equal(response.status, 409);
  assert.match(json.error, /authority changed/);
});

test('exact read returns no PHI when revocation pollution appears mid-request', async () => {
  const { handler } = await loadBroker('get', {
    membershipResponses: [
      [membership()],
      [membership({
        revoked_at: '2026-09-03T12:30:00.000Z',
        revocation_reason: 'Concurrent polluted revocation metadata',
      })],
    ],
  });
  const { response, json } = await invoke(handler, 'getAuthorizedPatient', getBody());
  assert.equal(response.status, 409);
  assert.equal(json.patient, undefined);
});

test('list page applies tenant and creator scope before paging and returns a finite roster', async () => {
  const ownRows = [
    patient({ id: 'patient-a', client_request_id: 'request-a' }),
    patient({ id: 'patient-b', client_request_id: 'request-b', first_name: 'Grace' }),
  ];
  const { handler, calls } = await loadBroker('list', { patients: ownRows });
  const { response, json } = await invoke(
    handler,
    'listAuthorizedPatients',
    pageBody({ page_size: 1 }),
  );
  assert.equal(response.status, 200);
  assert.equal(json.patients.length, 1);
  assert.deepEqual(Object.keys(json.patients[0]).sort(), [
    'admission_date', 'care_type', 'first_name', 'id', 'last_name',
    'medical_record_number', 'middle_name', 'primary_diagnosis', 'status',
    'updated_date',
  ]);
  assert.deepEqual(json.page, {
    page_size: 1,
    sort: 'id_asc',
    after_id: null,
    has_more: true,
    next_cursor: pageCursor({ page_size: 1 }),
  });
  assert.equal(calls.patients.length, 2);
  for (const call of calls.patients) {
    assert.equal(call.query.agency_id, 'agency-a');
    assert.equal(call.query.created_by_user_id, 'user-1');
    assert.equal(call.query.created_by_user_email_normalized, 'clinician@agency.test');
    assert.equal(call.limit, 2);
    assert.equal(call.sort, 'id');
    assert.equal(call.offset, undefined);
    assert.equal(call.fields.includes('clinical_notes'), false);
    assert.equal(call.fields.includes('active_alerts'), false);
  }
  assert.equal(calls.auth, 4);
  assert.equal(calls.securityLogs.length, 1);
  assert.deepEqual(calls.securityLogs[0], {
    timestamp: calls.securityLogs[0].timestamp,
    user_email: 'clinician@agency.test',
    user_role: 'clinician',
    action: 'PATIENT_LIST_READ_AUTHORIZED',
    details: {
      broker: 'listAuthorizedPatients',
      resource_type: 'Patient',
      agency_id: 'agency-a',
      purpose: 'roster',
      mode: 'page',
      subject_user_id: 'user-1',
      membership_id: 'membership-a',
      membership_version: 2,
      returned_count: 1,
      has_more: true,
    },
    ip_address: 'server-side',
    user_agent: 'server-side',
  });
  assert.equal(Number.isFinite(Date.parse(calls.securityLogs[0].timestamp)), true);
});

test('Patient-list disclosure fails closed when the final caller recheck or audit fails', async () => {
  const revoked = await loadBroker('list', {
    callers: [USER, USER, USER, { ...USER, is_active: false }],
  });
  const revokedResult = await invoke(
    revoked.handler,
    'listAuthorizedPatients',
    pageBody(),
  );
  assert.equal(revokedResult.response.status, 403);
  assert.equal(revokedResult.json.patients, undefined);
  assert.equal(revoked.calls.auth, 4);
  assert.equal(revoked.calls.securityLogs.length, 0);

  const auditFailure = await loadBroker('list', {
    auditError: new Error('audit unavailable'),
  });
  const auditResult = await invoke(
    auditFailure.handler,
    'listAuthorizedPatients',
    pageBody(),
  );
  assert.equal(auditResult.response.status, 500);
  assert.equal(auditResult.json.patients, undefined);
  assert.equal(auditResult.json.error, 'Internal server error');
  assert.equal(auditFailure.calls.securityLogs.length, 1);
});

test('every Patient list purpose returns only its reviewed projection and enforces its own page cap', async () => {
  for (const [purpose, fields] of Object.entries(LIST_PURPOSE_FIELDS)) {
    const pageSize = LIST_PURPOSE_MAX_PAGE_SIZE[purpose];
    const permitted = await loadBroker('list', {
      memberships: [membership({ tenant_role: 'manager' })],
    });
    const result = await invoke(
      permitted.handler,
      'listAuthorizedPatients',
      pageBody({ purpose, page_size: pageSize }),
    );
    assert.equal(result.response.status, 200, purpose);
    assert.deepEqual(Object.keys(result.json.patients[0]).sort(), [...fields].sort(), purpose);
    assert.equal(result.json.patients[0].agency_id, undefined, purpose);
    assert.equal(result.json.patients[0].clinical_notes, undefined, purpose);
    assert.equal(result.json.patients[0].active_alerts, undefined, purpose);

    const overCap = await loadBroker('list', {
      memberships: [membership({ tenant_role: 'manager' })],
    });
    const denied = await invoke(
      overCap.handler,
      'listAuthorizedPatients',
      pageBody({ purpose, page_size: pageSize + 1 }),
    );
    assert.equal(denied.response.status, 400, purpose);
    assert.equal(overCap.calls.auth, 0, purpose);
    assert.deepEqual(overCap.calls.patients, [], purpose);
  }
});

test('list page merges creator and exact active assignment streams in immutable patient-id order', async () => {
  const rows = [
    nonCreatorPatient('patient-a'),
    patient({ id: 'patient-b', client_request_id: 'creator-request-b' }),
    nonCreatorPatient('patient-c'),
  ];
  const assignments = [assignmentFor('patient-c'), assignmentFor('patient-a')];
  const { handler, calls } = await loadBroker('list', { patients: rows, assignments });
  const { response, json } = await invoke(
    handler,
    'listAuthorizedPatients',
    pageBody({ page_size: 2 }),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(json.patients.map((row) => row.id), ['patient-a', 'patient-b']);
  assert.deepEqual(json.page, {
    page_size: 2,
    sort: 'id_asc',
    after_id: null,
    has_more: true,
    next_cursor: pageCursor({ after_id: 'patient-b', page_size: 2 }),
  });
  const discoveryCalls = calls.assignments.filter((call) => call.sort === 'patient_id');
  const exactCalls = calls.assignments.filter((call) => call.sort === '-updated_date');
  assert.equal(discoveryCalls.length, 2);
  assert.equal(exactCalls.length, 5);
  for (const call of discoveryCalls) {
    assert.deepEqual(call.query, {
      agency_id: 'agency-a',
      user_id: 'user-1',
      user_email_normalized: 'clinician@agency.test',
      assignee_membership_id: 'membership-a',
      status: 'active',
    });
    assert.equal(call.limit, 51);
    assert.equal(call.offset, undefined);
    assert.ok(call.fields.includes('assignee_membership_version_at_enablement'));
    assert.ok(call.fields.includes('last_transition_request_key'));
    assert.equal(call.fields.includes('first_name'), false);
  }
  assert.deepEqual(
    exactCalls.map((call) => call.query.patient_id),
    ['patient-a', 'patient-c', 'patient-a', 'patient-c', 'patient-a'],
  );
});

test('assigned roster continuation applies the same patient-id keyset to both streams', async () => {
  const rows = [
    nonCreatorPatient('patient-a'),
    patient({ id: 'patient-b', client_request_id: 'creator-request-b' }),
    nonCreatorPatient('patient-c'),
  ];
  const assignments = [assignmentFor('patient-a'), assignmentFor('patient-c')];
  const { handler, calls } = await loadBroker('list', { patients: rows, assignments });
  const { response, json } = await invoke(
    handler,
    'listAuthorizedPatients',
    pageBody({ page_size: 1, cursor: pageCursor({ page_size: 1 }) }),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(json.patients.map((row) => row.id), ['patient-b']);
  assert.equal(json.page.has_more, true);
  assert.deepEqual(json.page.next_cursor, pageCursor({ after_id: 'patient-b', page_size: 1 }));
  const creatorCalls = calls.patients.filter((call) => call.sort === 'id');
  const discoveryCalls = calls.assignments.filter((call) => call.sort === 'patient_id');
  assert.equal(creatorCalls.length, 2);
  assert.equal(discoveryCalls.length, 2);
  for (const call of creatorCalls) assert.deepEqual(call.query.id, { $gt: 'patient-a' });
  for (const call of discoveryCalls) assert.deepEqual(call.query.patient_id, { $gt: 'patient-a' });
});

test('status-filtered assignment discovery advances by patient id until a complete bounded result', async () => {
  const patientIds = Array.from({ length: 52 }, (_, index) => (
    `patient-${String(index).padStart(3, '0')}`
  ));
  const patients = patientIds.map((id, index) => nonCreatorPatient(id, {
    status: index === patientIds.length - 1 ? 'active' : 'hospitalized',
  }));
  const assignments = patientIds.map((id) => assignmentFor(id));
  const { handler, calls } = await loadBroker('list', { patients, assignments });
  const { response, json } = await invoke(
    handler,
    'listAuthorizedPatients',
    pageBody({ page_size: 1, status: 'active' }),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(json.patients.map((row) => row.id), ['patient-051']);
  assert.equal(json.page.has_more, false);
  const discoveryCalls = calls.assignments.filter((call) => call.sort === 'patient_id');
  assert.equal(discoveryCalls.length, 4);
  assert.equal(discoveryCalls[0].query.patient_id, undefined);
  assert.deepEqual(discoveryCalls[1].query.patient_id, { $gt: 'patient-050' });
  assert.equal(discoveryCalls[2].query.patient_id, undefined);
  assert.deepEqual(discoveryCalls[3].query.patient_id, { $gt: 'patient-050' });
});

test('suspended, revoked, wrong-agency, and wrong-user assignments return no roster PHI', async () => {
  const target = nonCreatorPatient('patient-a');
  const deniedAssignments = [
    assignmentFor('patient-a', { status: 'suspended' }),
    assignmentFor('patient-a', { status: 'revoked' }),
    assignmentFor('patient-a', { agency_id: 'agency-b' }),
    assignmentFor('patient-a', { user_id: 'user-2' }),
  ];
  for (const deniedAssignment of deniedAssignments) {
    const { handler } = await loadBroker('list', {
      patients: [target],
      assignments: [deniedAssignment],
    });
    const { response, json } = await invoke(
      handler,
      'listAuthorizedPatients',
      pageBody(),
    );
    assert.equal(response.status, 200);
    assert.deepEqual(json.patients, []);
    assert.equal(json.page.has_more, false);
  }
});

test('malformed or duplicate active assignment discovery fails closed with no roster PHI', async () => {
  const target = nonCreatorPatient('patient-a');
  const cases = [
    [assignmentFor('patient-a', { last_transition_at: 'not-an-instant' })],
    [assignmentFor('patient-a', { assignee_membership_version_at_enablement: 3 })],
    [assignmentFor('patient-a', { source: 'mutable_email' })],
    [assignmentFor('patient-a'), assignmentFor('patient-a', { id: 'assignment-b' })],
  ];
  for (const assignments of cases) {
    const { handler } = await loadBroker('list', { patients: [target], assignments });
    const { response, json } = await invoke(
      handler,
      'listAuthorizedPatients',
      pageBody(),
    );
    assert.equal(response.status, 409);
    assert.equal(json.patients, undefined);
  }
});

test('assignment revocation during roster read fails closed before returning PHI', async () => {
  const active = assignmentFor('patient-a');
  const revoked = assignmentFor('patient-a', {
    status: 'revoked',
    version: 2,
    last_transition_at: '2026-09-03T12:30:00.000Z',
    last_transition_request_id: 'revoke-request-a',
    last_transition_request_key: 'agency-a:patient-a:user-1:revoke-request-a',
  });
  const { handler } = await loadBroker('list', {
    patients: [nonCreatorPatient('patient-a')],
    assignmentResponses: [[active], [active], [revoked]],
  });
  const { response, json } = await invoke(
    handler,
    'listAuthorizedPatients',
    pageBody(),
  );
  assert.equal(response.status, 409);
  assert.match(json.error, /authority changed/);
  assert.equal(json.patients, undefined);
});

test('active assignment version drift during roster read fails closed before returning PHI', async () => {
  const active = assignmentFor('patient-a');
  const changed = assignmentFor('patient-a', {
    version: 3,
    suspended_at: '2026-09-03T12:00:00.000Z',
    activated_at: '2026-09-03T12:30:00.000Z',
    last_transition_action: 'activate',
    last_transition_at: '2026-09-03T12:30:00.000Z',
    last_transition_request_id: 'activate-request-a',
    last_transition_request_key: 'agency-a:patient-a:user-1:activate-request-a',
  });
  const { handler } = await loadBroker('list', {
    patients: [nonCreatorPatient('patient-a')],
    assignmentResponses: [[active], [active], [changed], [changed]],
  });
  const { response, json } = await invoke(
    handler,
    'listAuthorizedPatients',
    pageBody(),
  );
  assert.equal(response.status, 409);
  assert.match(json.error, /authority changed/);
  assert.equal(json.patients, undefined);
});

test('assignment revocation after the final Patient page read blocks disclosure', async () => {
  const active = assignmentFor('patient-a');
  const revoked = assignmentFor('patient-a', {
    status: 'revoked',
    version: 2,
    last_transition_at: '2026-09-03T12:30:00.000Z',
    last_transition_request_id: 'revoke-after-final-read',
    last_transition_request_key: 'agency-a:patient-a:user-1:revoke-after-final-read',
  });
  const { handler, calls } = await loadBroker('list', {
    patients: [nonCreatorPatient('patient-a')],
    assignmentResponses: [[active], [active], [active], [active], [revoked]],
  });
  const { response, json } = await invoke(
    handler,
    'listAuthorizedPatients',
    pageBody(),
  );
  assert.equal(response.status, 409);
  assert.match(json.error, /authority changed/);
  assert.equal(json.patients, undefined);
  assert.equal(calls.securityLogs.length, 0);
  assert.equal(calls.assignments.length, 5);
});

test('terminal Patient-list authority fence catches membership revocation during assignment recheck', async () => {
  const revoked = membership({
    status: 'revoked',
    revoked_at: '2026-09-03T12:45:00.000Z',
    revocation_reason: 'Revoked during final assignment verification',
    last_transition_at: '2026-09-03T12:45:00.000Z',
    last_transition_reason: 'Revoked during final assignment verification',
    version: 3,
  });
  const fixture = await loadBroker('list', {
    patients: [nonCreatorPatient('patient-a')],
    assignments: [assignmentFor('patient-a')],
    onAssignmentFilter: ({ callNumber }) => callNumber === 5 ? [revoked] : null,
  });
  const { response, json } = await invoke(
    fixture.handler,
    'listAuthorizedPatients',
    pageBody(),
  );
  assert.equal(response.status, 403);
  assert.equal(json.patients, undefined);
  assert.equal(fixture.calls.assignments.length, 5);
  assert.equal(fixture.calls.auth, 4);
  assert.equal(fixture.calls.securityLogs.length, 0);
});

test('assignment discovery stops at its hard scan cap instead of returning a partial page', async () => {
  const assignments = Array.from({ length: 255 }, (_, index) => (
    assignmentFor(`patient-${String(index).padStart(3, '0')}`)
  ));
  const { handler, calls } = await loadBroker('list', { patients: [], assignments });
  const { response, json } = await invoke(
    handler,
    'listAuthorizedPatients',
    pageBody(),
  );
  assert.equal(response.status, 409);
  assert.match(json.error, /bounded scan/);
  assert.equal(json.patients, undefined);
  assert.equal(calls.assignments.filter((call) => call.sort === 'patient_id').length, 5);
});

test('list continuation is context-bound and applies an immutable id keyset before the limit', async () => {
  const rows = [
    patient({ id: 'patient-a', client_request_id: 'request-a' }),
    patient({ id: 'patient-b', client_request_id: 'request-b' }),
    patient({ id: 'patient-c', client_request_id: 'request-c' }),
  ];
  const { handler, calls } = await loadBroker('list', { patients: rows });
  const cursor = pageCursor({ page_size: 1 });
  const { response, json } = await invoke(
    handler,
    'listAuthorizedPatients',
    pageBody({ page_size: 1, cursor }),
  );
  assert.equal(response.status, 200);
  assert.deepEqual(json.patients.map((row) => row.id), ['patient-b']);
  assert.deepEqual(json.page, {
    page_size: 1,
    sort: 'id_asc',
    after_id: 'patient-a',
    has_more: true,
    next_cursor: pageCursor({ after_id: 'patient-b', page_size: 1 }),
  });
  assert.equal(calls.patients.length, 2);
  for (const call of calls.patients) {
    assert.deepEqual(call.query, {
      agency_id: 'agency-a',
      is_sample: false,
      is_archived: false,
      created_by_user_id: 'user-1',
      created_by_user_email_normalized: 'clinician@agency.test',
      id: { $gt: 'patient-a' },
    });
    assert.equal(call.sort, 'id');
    assert.equal(call.limit, 2);
    assert.equal(call.offset, undefined);
  }
});

test('list rejects legacy paging, malformed cursors, and changed cursor authority', async () => {
  for (const body of [
    pageBody({ offset: 25 }),
    pageBody({ sort: 'updated_desc' }),
    pageBody({ cursor: { ...pageCursor(), extra: true } }),
    pageBody({ cursor: pageCursor({ purpose: 'contact' }) }),
    pageBody({ cursor: pageCursor({ status: 'active' }) }),
    pageBody({ cursor: pageCursor({ page_size: 10 }) }),
  ]) {
    const invalid = await loadBroker('list');
    const result = await invoke(invalid.handler, 'listAuthorizedPatients', body);
    assert.equal(result.response.status, 400);
    assert.equal(invalid.calls.auth, 0);
    assert.deepEqual(invalid.calls.patients, []);
  }

  const changed = await loadBroker('list');
  const changedResult = await invoke(
    changed.handler,
    'listAuthorizedPatients',
    pageBody({ cursor: pageCursor({ membership_version: 1 }) }),
  );
  assert.equal(changedResult.response.status, 409);
  assert.match(changedResult.json.error, /continuation context changed/);
  assert.equal(changed.calls.auth, 1);
  assert.deepEqual(changed.calls.patients, []);
});

test('manager page is agency-wide, clinician contact is reviewed, and identity matching remains role-gated', async () => {
  const managerMembership = membership({ tenant_role: 'manager' });
  const otherCreator = patient({
    created_by_user_id: 'user-2',
    created_by_user_email_normalized: 'other@agency.test',
    created_by: 'other@agency.test',
    client_request_id: 'other-request',
  });
  const { handler, calls } = await loadBroker('list', {
    memberships: [managerMembership],
    patients: [otherCreator],
  });
  const result = await invoke(handler, 'listAuthorizedPatients', pageBody());
  assert.equal(result.response.status, 200);
  assert.equal(result.json.patients.length, 1);
  assert.equal(calls.patients[0].query.created_by_user_id, undefined);

  const clinicianContact = await loadBroker('list');
  const permitted = await invoke(
    clinicianContact.handler,
    'listAuthorizedPatients',
    pageBody({ purpose: 'contact', page_size: 25 }),
  );
  assert.equal(permitted.response.status, 200);

  const clinicianIdentity = await loadBroker('list');
  const denied = await invoke(
    clinicianIdentity.handler,
    'listAuthorizedPatients',
    pageBody({ purpose: 'identity_match', page_size: 25 }),
  );
  assert.equal(denied.response.status, 403);
  assert.deepEqual(clinicianIdentity.calls.patients, []);
});

test('only the configured built-in admin receives membership-free platform-owner scope', async () => {
  const owner = { ...USER, role: 'admin', email: 'owner@platform.test' };
  const otherCreator = patient({
    created_by_user_id: 'user-2',
    created_by_user_email_normalized: 'other@agency.test',
    created_by: 'other@agency.test',
    client_request_id: 'owner-read-target',
  });
  for (const kind of ['get', 'list']) {
    const authorized = await loadBroker(kind, {
      caller: owner,
      memberships: [],
      patients: [otherCreator],
      superAdminEmail: 'owner@platform.test',
    });
    const result = await invoke(
      authorized.handler,
      kind,
      kind === 'get' ? getBody() : pageBody(),
    );
    assert.equal(result.response.status, 200);
    assert.deepEqual(result.json.scope, {
      agency_id: 'agency-a',
      membership_id: null,
      membership_version: null,
      tenant_role: 'platform_owner',
    });

    const bareAdmin = await loadBroker(kind, {
      caller: owner,
      memberships: [],
      patients: [otherCreator],
      superAdminEmail: null,
    });
    const denied = await invoke(
      bareAdmin.handler,
      kind,
      kind === 'get' ? getBody() : pageBody(),
    );
    assert.equal(denied.response.status, 403);
    assert.deepEqual(bareAdmin.calls.patients, []);
  }
});

test('platform owner Patient reads reject preexisting or duplicate owner memberships', async () => {
  const owner = { ...USER, role: 'admin', email: 'owner@platform.test' };
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
        kind,
        kind === 'get' ? getBody() : pageBody(),
      );

      assert.equal(result.response.status, 409);
      assert.equal(result.json.error, 'Platform owner tenant membership must not exist');
      assert.equal(fixture.calls.memberships.length, 1);
      assert.deepEqual(fixture.calls.patients, []);
    }
  }
});

test('id batches are capped, tenant-pinned, ordered, and omit missing or foreign ids identically', async () => {
  const managerMembership = membership({ tenant_role: 'manager' });
  const sameAgency = patient({ id: 'patient-a', client_request_id: 'same-request' });
  const foreign = patient({
    id: 'patient-b',
    agency_id: 'agency-b',
    client_request_id: 'foreign-request',
  });
  const { handler, calls } = await loadBroker('list', {
    memberships: [managerMembership],
    patients: [foreign, sameAgency],
    ignoreFilters: true,
  });
  const body = {
    agency_id: 'agency-a',
    mode: 'ids',
    purpose: 'roster',
    patient_ids: ['patient-b', 'patient-a', 'patient-missing'],
  };
  const { response, json } = await invoke(handler, 'listAuthorizedPatients', body);
  assert.equal(response.status, 200);
  assert.deepEqual(json.patients.map((row) => row.id), ['patient-a']);
  assert.equal(json.missing_ids, undefined);
  assert.deepEqual(calls.patients[0].query, {
    agency_id: 'agency-a',
    is_sample: false,
    is_archived: false,
    id: { $in: ['patient-b', 'patient-a', 'patient-missing'] },
  });

  const invalid = await loadBroker('list');
  const duplicate = await invoke(invalid.handler, 'listAuthorizedPatients', {
    agency_id: 'agency-a',
    mode: 'ids',
    purpose: 'roster',
    patient_ids: ['patient-a', 'patient-a'],
  });
  assert.equal(duplicate.response.status, 400);
  assert.equal(invalid.calls.auth, 0);
  assert.deepEqual(invalid.calls.patients, []);
});

test('clinician id batches preserve request order across creator and exact assignment access', async () => {
  const assigned = nonCreatorPatient('patient-a');
  const own = patient({ id: 'patient-b', client_request_id: 'creator-request-b' });
  const unavailable = nonCreatorPatient('patient-c');
  const { handler, calls } = await loadBroker('list', {
    patients: [assigned, own, unavailable],
    assignments: [assignmentFor('patient-a')],
  });
  const { response, json } = await invoke(handler, 'listAuthorizedPatients', {
    agency_id: 'agency-a',
    mode: 'ids',
    purpose: 'roster',
    patient_ids: ['patient-c', 'patient-a', 'patient-b'],
  });
  assert.equal(response.status, 200);
  assert.deepEqual(json.patients.map((row) => row.id), ['patient-a', 'patient-b']);
  assert.equal(json.missing_ids, undefined);
  assert.equal(calls.patients.length, 2);
  assert.equal(calls.assignments.length, 5);
  assert.deepEqual(
    calls.assignments.map((call) => call.query.patient_id),
    ['patient-c', 'patient-a', 'patient-c', 'patient-a', 'patient-a'],
  );
});

test('list read fails closed when Patient authority drifts between bounded reads', async () => {
  const initial = patient();
  const changed = patient({ updated_date: '2026-09-03T12:01:00.000Z' });
  const { handler } = await loadBroker('list', {
    patientResponses: [[initial], [changed]],
  });
  const { response, json } = await invoke(handler, 'listAuthorizedPatients', pageBody());
  assert.equal(response.status, 409);
  assert.match(json.error, /authority changed/);
});