// Executes base44/functions/deduplicatePatients/entry.ts against an in-memory
// fake SDK and pins the merge broker's contract: who may merge, that a merge
// never spans agencies, which survivor fields a merge may write, that every
// patient-referencing record follows the survivor, that a half-done merge is
// finished by a retry without doubling anything, and that a duplicate is
// archived only after everything that referenced it has moved.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import JSON5 from 'json5';
import { transpileTs } from '../../tools-transpile-ts.mjs';
import { buildFieldMergePatch, MERGE_PATCH_FIELDS } from '../../src/components/patient/patientMergePlan.js';

const root = resolve(import.meta.dirname, '..', '..');
const entryPath = resolve(root, 'base44/functions/deduplicatePatients/entry.ts');
const SOURCE = readFileSync(entryPath, 'utf8');

function literalAfter(source, declaration) {
  const start = source.indexOf(declaration);
  assert.notEqual(start, -1, `${declaration} must exist`);
  const open = source.indexOf(declaration.endsWith('[') ? '[' : '{', start + declaration.length - 1);
  const closeChar = source[open] === '[' ? ']' : '}';
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === source[open]) depth += 1;
    if (source[index] === closeChar && (depth -= 1) === 0) {
      return new Function(`return ${source.slice(open, index + 1)};`)();
    }
  }
  throw new Error(`${declaration} is unbalanced`);
}

const PATIENT_REFERENCE_FIELDS = literalAfter(SOURCE, 'const PATIENT_REFERENCE_FIELDS = [');
const SPECIAL_PATIENT_REFERENCES = literalAfter(SOURCE, 'const SPECIAL_PATIENT_REFERENCES = {');
const RETAINED_PATIENT_REFERENCES = literalAfter(SOURCE, 'const RETAINED_PATIENT_REFERENCES = {');

const AGENCY = 'agency-a';
const OTHER_AGENCY = 'agency-b';
const T0 = '2026-09-01T12:00:00.000Z';
const T1 = '2026-09-02T12:00:00.000Z';

const OWNER = { id: 'owner-1', email: 'owner@example.test', role: 'admin', full_name: 'Owner', is_active: true };
const AGENCY_ADMIN = { id: 'admin-1', email: 'admin@agency.test', role: 'user', full_name: 'Admin', is_active: true };
const MANAGER = { id: 'manager-1', email: 'manager@agency.test', role: 'user', full_name: 'Manager', is_active: true };
const CLINICIAN = { id: 'clinician-1', email: 'clinician@agency.test', role: 'user', full_name: 'Clin', is_active: true };
const OUTSIDER = { id: 'outsider-1', email: 'outsider@agency.test', role: 'user', full_name: 'Out', is_active: true };
const OTHER_ADMIN = { id: 'other-admin-1', email: 'admin@other.test', role: 'user', full_name: 'Other', is_active: true };
const NO_MEMBERSHIP = { id: 'loner-1', email: 'loner@agency.test', role: 'user', full_name: 'Loner', is_active: true };

function membership(user, agencyId, tenantRole, overrides = {}) {
  return {
    id: `membership-${user.id}`,
    membership_key: `${agencyId}:${user.id}`,
    agency_id: agencyId,
    user_id: user.id,
    user_email_normalized: user.email.toLowerCase(),
    tenant_role: tenantRole,
    status: 'active',
    version: 1,
    created_by_user_id: 'owner-1',
    last_transition_by_user_id: 'owner-1',
    last_transition_by_email_normalized: 'owner@example.test',
    last_transition_at: T0,
    last_transition_reason: 'Initial activation',
    activated_at: T0,
    ...overrides,
  };
}

const NURSES = ['nurse-1', 'nurse-2', 'nurse-3', 'nurse-4'].map((id) => ({
  id, email: `${id}@agency.test`, role: 'user', is_active: true,
}));

function patient(id, overrides = {}) {
  return {
    id,
    agency_id: AGENCY,
    first_name: 'John',
    last_name: 'Smith',
    status: 'active',
    is_archived: false,
    is_sample: false,
    updated_date: T0,
    created_date: T0,
    ...overrides,
  };
}

function assignment(id, patientId, userId, overrides = {}) {
  const key = `${AGENCY}:${patientId}:${userId}`;
  return {
    id,
    assignment_key: key,
    agency_id: AGENCY,
    patient_id: patientId,
    user_id: userId,
    user_email_normalized: `${userId}@agency.test`,
    assignee_membership_id: `membership-${userId}`,
    assignee_membership_version_at_enablement: 1,
    status: 'active',
    source: 'patient_creator',
    created_by_user_id: 'admin-1',
    created_by_user_email_normalized: 'admin@agency.test',
    activated_at: T0,
    last_transition_by_user_id: 'admin-1',
    last_transition_by_email_normalized: 'admin@agency.test',
    last_transition_at: T0,
    last_transition_reason: 'Initial assignment',
    last_transition_action: 'grant',
    last_transition_request_id: 'request-1',
    last_transition_request_key: `${key}:request-1`,
    version: 1,
    ...overrides,
  };
}

const HEX = (char) => char.repeat(64);

function noteEntry(id, overrides = {}) {
  return {
    id,
    agency_id: AGENCY,
    patient_id: 'p-dup',
    visit_id: 'visit-dup-1',
    logical_note_key: HEX('a'),
    event_key: HEX('b'),
    payload_fingerprint: HEX('c'),
    mode: 'append',
    visit_date: '2026-08-01',
    visit_type: 'Routine',
    visit_revision_at: T0,
    note: 'Wound dressing changed.',
    clinical_notes: 'Wound dressing changed.',
    compliance_score: 90,
    actor_user_id: 'nurse-1',
    actor_email_normalized: 'nurse-1@agency.test',
    membership_id: 'membership-nurse-1',
    membership_version: 1,
    recorded_at: T0,
    ...overrides,
  };
}

function baseState() {
  const rows = {
    Agency: [
      { id: AGENCY, status: 'active', agency_name: 'Agency A' },
      { id: OTHER_AGENCY, status: 'active', agency_name: 'Agency B' },
    ],
    AgencyMembership: [
      membership(AGENCY_ADMIN, AGENCY, 'agency_admin'),
      membership(MANAGER, AGENCY, 'manager'),
      membership(CLINICIAN, AGENCY, 'clinician'),
      membership(OUTSIDER, AGENCY, 'office_staff'),
      membership(OTHER_ADMIN, OTHER_AGENCY, 'agency_admin'),
      ...NURSES.map((nurse) => membership(nurse, AGENCY, 'clinician')),
    ],
    Patient: [
      patient('p-keep', { medical_record_number: 'MRN-1', date_of_birth: '1950-01-01', allergies: '' }),
      patient('p-dup', {
        medical_record_number: 'MRN-1',
        date_of_birth: '1950-01-01',
        allergies: 'Penicillin',
        phone: '555-111-2222',
        current_medications: [{ name: 'Lasix' }],
        enhanced_notes_history: [{ entry_id: 'legacy-1', note: 'legacy' }],
        updated_date: T1,
      }),
      patient('p-dup2', { first_name: 'Jon', email: 'jon@example.test' }),
      patient('p-other', { agency_id: OTHER_AGENCY }),
      patient('p-old', { status: 'merged', is_archived: true, merged_into_id: 'p-dup' }),
    ],
    PatientCareTeamAssignment: [
      // Carried: the survivor has no row for nurse-1.
      assignment('pcta-1', 'p-dup', 'nurse-1'),
      // Already on the survivor: only the duplicate's grant is revoked.
      assignment('pcta-2', 'p-dup', 'nurse-2'),
      assignment('pcta-2-keep', 'p-keep', 'nurse-2'),
      // The survivor's deliberate revocation wins over the duplicate's grant.
      assignment('pcta-3', 'p-dup', 'nurse-3'),
      assignment('pcta-3-keep', 'p-keep', 'nurse-3', {
        status: 'revoked', version: 2, revoked_at: T1, revocation_reason: 'Off case',
        last_transition_at: T1, last_transition_reason: 'Off case', last_transition_action: 'revoke',
      }),
      // A suspended grant opens nothing and is left as it is.
      assignment('pcta-4', 'p-dup', 'nurse-4', {
        status: 'suspended', version: 2, suspended_at: T1, last_transition_at: T1,
        last_transition_action: 'suspend',
      }),
    ],
    PatientNoteHistoryEntry: [
      noteEntry('note-1'),
      noteEntry('note-2', { source_entry_id: 'entry-2', event_key: HEX('d'), payload_fingerprint: HEX('e') }),
    ],
    DocumentTenantBinding: [{ id: 'binding-1', document_id: 'doc-1', agency_id: AGENCY, patient_id: 'p-dup' }],
    Document: [{ id: 'doc-1', patient_id: 'p-dup' }],
    PatientOutcomeMetric: [{ id: 'metric-1', patient_id: 'p-dup', row_content_hash: HEX('f') }],
    SmsConsent: [{ id: 'consent-1', patient_id: 'p-dup', phone_e164: '+15551112222' }],
    UserActivity: [],
  };
  // One row for every generically re-pointed reference, so the test fails if
  // any table is skipped.
  for (const [entityName, field] of PATIENT_REFERENCE_FIELDS) {
    rows[entityName] ||= [];
    const row = { id: `${entityName}-${field}-1`, [field]: 'p-dup' };
    if (entityName === 'Referral') row.version = 3;
    if (entityName === 'IncomingFax') row.version = 2;
    rows[entityName].push(row);
  }
  return rows;
}

function matches(row, query) {
  return Object.entries(query || {}).every(([key, expected]) => {
    if (expected && typeof expected === 'object' && !Array.isArray(expected) && Object.hasOwn(expected, '$exists')) {
      return Object.hasOwn(row, key) === expected.$exists;
    }
    return row?.[key] === expected;
  });
}

async function loadHandler({
  caller = OWNER,
  state = baseState(),
  failWrite = null,
  paused = false,
} = {}) {
  let source = SOURCE.replace(
    /import\s+\{\s*createClientFromRequest\s*\}\s+from\s+'npm:[^']+';/,
    'const createClientFromRequest = globalThis.__patientMergeMakeClient;',
  );
  if (paused) {
    source = source.replace(
      'const PATIENT_DEDUPLICATION_PAUSED = false;',
      'const PATIENT_DEDUPLICATION_PAUSED = true;',
    );
  }
  const temporaryModule = join(
    tmpdir(),
    `patient_merge_${Date.now()}_${Math.random().toString(36).slice(2)}.mjs`,
  );
  await writeFile(temporaryModule, transpileTs(source).outputText);

  const users = [OWNER, AGENCY_ADMIN, MANAGER, CLINICIAN, OUTSIDER, OTHER_ADMIN, NO_MEMBERSHIP, ...NURSES];
  state.User ||= users.map((row) => ({ ...row }));
  const calls = { clients: 0, writes: [], reads: [] };
  let created = 0;

  const maybeFail = (entity, op, target, payload) => {
    if (failWrite && failWrite(entity, op, target, payload)) throw new Error('injected write failure');
  };
  const api = (entity) => ({
    filter: async (query, sort, limit) => {
      calls.reads.push({ entity, query: { ...(query || {}) } });
      const rows = (state[entity] || []).filter((row) => matches(row, query));
      return (Number.isFinite(limit) ? rows.slice(0, limit) : rows).map((row) => structuredClone(row));
    },
    list: async (sort, limit) => {
      calls.reads.push({ entity, list: true });
      const rows = state[entity] || [];
      return (Number.isFinite(limit) ? rows.slice(0, limit) : rows).map((row) => structuredClone(row));
    },
    update: async (id, patch) => {
      maybeFail(entity, 'update', id, patch);
      const row = (state[entity] || []).find((candidate) => candidate.id === id);
      if (!row) throw new Error('not found');
      Object.assign(row, structuredClone(patch), { updated_date: T1 });
      calls.writes.push({ entity, op: 'update', id, patch: structuredClone(patch) });
      return structuredClone(row);
    },
    updateMany: async (query, operations) => {
      maybeFail(entity, 'updateMany', query, operations);
      const targets = (state[entity] || []).filter((row) => matches(row, query));
      for (const row of targets) {
        Object.assign(row, structuredClone(operations.$set || {}));
        for (const [field, amount] of Object.entries(operations.$inc || {})) row[field] += amount;
        row.updated_date = T1;
      }
      calls.writes.push({
        entity, op: 'updateMany', query: structuredClone(query), operations: structuredClone(operations),
        updated: targets.length,
      });
      return { success: true, updated: targets.length, has_more: false };
    },
    create: async (payload) => {
      maybeFail(entity, 'create', null, payload);
      created += 1;
      const row = { id: `${entity}-created-${created}`, ...structuredClone(payload), created_date: T1 };
      state[entity] ||= [];
      state[entity].push(row);
      calls.writes.push({ entity, op: 'create', id: row.id, payload: structuredClone(payload) });
      return structuredClone(row);
    },
  });
  const entities = new Proxy({}, { get: (_, entity) => api(String(entity)) });
  const client = {
    auth: { me: async () => (caller instanceof Error ? Promise.reject(caller) : caller) },
    asServiceRole: { entities },
  };

  let handler;
  globalThis.__patientMergeMakeClient = () => {
    calls.clients += 1;
    return client;
  };
  globalThis.Deno = {
    serve: (candidate) => { handler = candidate; },
    env: { get: (name) => (name === 'SUPER_ADMIN_EMAIL' ? 'owner@example.test' : undefined) },
  };
  try {
    await import(pathToFileURL(temporaryModule).href);
  } finally {
    await unlink(temporaryModule).catch(() => {});
  }
  assert.equal(typeof handler, 'function');
  return { handler, state, calls };
}

async function invoke(handler, body, { method = 'POST' } = {}) {
  const response = await handler(new Request('http://local/deduplicatePatients', {
    method,
    headers: { 'content-type': 'application/json' },
    ...(method === 'GET' ? {} : { body: JSON.stringify(body ?? {}) }),
  }));
  return { status: response.status, json: await response.json() };
}

const mergeBody = (overrides = {}) => ({
  action: 'merge', keep_id: 'p-keep', duplicate_ids: ['p-dup'], ...overrides,
});

const row = (state, entity, id) => state[entity].find((candidate) => candidate.id === id);

// ---------------------------------------------------------------------------

test('the broker is live: no pause flag refuses callers', async () => {
  assert.match(SOURCE, /const PATIENT_DEDUPLICATION_PAUSED = false;/);
  const { handler, calls } = await loadHandler({ paused: true });
  const paused = await invoke(handler, mergeBody());
  assert.equal(paused.status, 503, 'the kill switch still refuses before any client exists');
  assert.equal(calls.clients, 0);
});

test('authorization: only the platform tier and an agency admin or manager may merge', async () => {
  const cases = [
    [null, 401],
    [CLINICIAN, 403],
    [OUTSIDER, 403],
    [NO_MEMBERSHIP, 403],
    [{ ...AGENCY_ADMIN, is_active: false }, 403],
    // Self-asserted privilege on the mutable profile grants nothing.
    [{ ...NO_MEMBERSHIP, account_type: 'agency_admin', agency_id: AGENCY, is_manager: true }, 403],
  ];
  for (const [caller, status] of cases) {
    const { handler, calls, state } = await loadHandler({ caller });
    const before = structuredClone(state.Patient);
    const result = await invoke(handler, mergeBody());
    assert.equal(result.status, status, `${caller?.id ?? 'anonymous'} must be refused with ${status}`);
    assert.deepEqual(calls.writes, [], 'a refused caller writes nothing');
    assert.deepEqual(state.Patient, before);
  }
  for (const caller of [OWNER, AGENCY_ADMIN, MANAGER]) {
    const { handler } = await loadHandler({ caller });
    const result = await invoke(handler, mergeBody());
    assert.equal(result.status, 200, `${caller.id} may merge`);
    assert.equal(result.json.complete, true);
  }
});

test('a merge never spans agencies, and another agency cannot probe ids', async () => {
  {
    const { handler, calls } = await loadHandler({ caller: OWNER });
    const result = await invoke(handler, mergeBody({ duplicate_ids: ['p-other'] }));
    assert.equal(result.status, 409);
    assert.match(result.json.error, /same agency/);
    assert.deepEqual(calls.writes, []);
  }
  {
    // An agency admin of agency-b cannot see agency-a charts at all: the answer
    // is the same 404 a missing id gets.
    const { handler, calls } = await loadHandler({ caller: OTHER_ADMIN });
    const visible = await invoke(handler, mergeBody({ keep_id: 'p-other', duplicate_ids: ['p-dup'] }));
    const missing = await invoke(handler, mergeBody({ keep_id: 'p-other', duplicate_ids: ['p-nope'] }));
    assert.equal(visible.status, 404);
    assert.deepEqual(visible.json, missing.json);
    assert.deepEqual(calls.writes, []);
  }
  {
    // The caller's stated agency must match the patients'.
    const { handler, calls } = await loadHandler({ caller: OWNER });
    const result = await invoke(handler, mergeBody({ agency_id: OTHER_AGENCY }));
    assert.equal(result.status, 409);
    assert.deepEqual(calls.writes, []);
  }
});

test('malformed and unsafe merges are refused before any write', async () => {
  const refusals = [
    [mergeBody({ duplicate_ids: ['p-keep'] }), 400],
    [mergeBody({ duplicate_ids: [] }), 400],
    [mergeBody({ duplicate_ids: ['p-dup', 'p-dup'] }), 400],
    [mergeBody({ keep_id: '$ne' }), 400],
    [mergeBody({ surprise: true }), 400],
    [mergeBody({ keep_id: 'p-old', duplicate_ids: ['p-dup'] }), 409],
    [{ action: 'nope' }, 400],
  ];
  for (const [body, status] of refusals) {
    const { handler, calls } = await loadHandler();
    const result = await invoke(handler, body);
    assert.equal(result.status, status, JSON.stringify(body));
    assert.deepEqual(calls.writes, []);
  }
  // A duplicate already merged into a different chart is not re-homed.
  const state = baseState();
  state.Patient.push(patient('p-gone', { status: 'merged', is_archived: true, merged_into_id: 'p-dup2' }));
  const { handler, calls } = await loadHandler({ state });
  const result = await invoke(handler, mergeBody({ duplicate_ids: ['p-gone'] }));
  assert.equal(result.status, 409);
  assert.deepEqual(calls.writes, []);
});

test('field_patch is limited to the fill-empty allowlist and never overwrites', async () => {
  for (const field of [
    'id', 'agency_id', 'created_by_user_id', 'created_by_user_email_normalized', 'created_by',
    'patient_creation_key', 'client_request_id', 'is_archived', 'status', 'merged_into_id',
    'assigned_nurses', 'enhanced_notes_history', 'is_sample', 'validation_overrides', 'clinical_notes',
  ]) {
    const { handler, calls } = await loadHandler();
    const result = await invoke(handler, mergeBody({ field_patch: { [field]: 'x' } }));
    assert.equal(result.status, 400, `${field} must be refused`);
    assert.deepEqual(calls.writes, []);
  }
  for (const [field, value] of [['allergies', { text: 'x' }], ['wounds', 'not-an-array'], ['insurance_primary', []]]) {
    const { handler } = await loadHandler();
    const result = await invoke(handler, mergeBody({ field_patch: { [field]: value } }));
    assert.equal(result.status, 400, `${field} must be type-checked`);
  }

  // The frontend's allowlist is the broker's allowlist.
  assert.deepEqual(
    [...MERGE_PATCH_FIELDS].sort(),
    [...literalAfter(SOURCE, 'const FILL_EMPTY_PATIENT_FIELDS = ['),
      ...literalAfter(SOURCE, 'const UNION_ARRAY_PATIENT_FIELDS = [')].sort(),
  );

  const state = baseState();
  const { handler, calls } = await loadHandler({ state });
  const result = await invoke(handler, mergeBody({
    field_patch: { medical_record_number: 'MRN-OVERWRITE', physician_name: 'Dr. Who' },
  }));
  assert.equal(result.status, 200);
  const keep = row(state, 'Patient', 'p-keep');
  assert.equal(keep.medical_record_number, 'MRN-1', 'a populated survivor field is never overwritten');
  assert.equal(keep.physician_name, 'Dr. Who', 'an empty survivor field is filled from the patch');
  assert.equal(keep.allergies, 'Penicillin', 'and from the duplicate');
  assert.deepEqual(keep.current_medications, [{ name: 'Lasix' }]);
  assert.equal(keep.enhanced_notes_history, undefined, 'the read-only legacy notes array is never written');

  // Parity with the frontend planner over the same full records.
  const first = calls.writes[0];
  assert.equal(first.entity, 'Patient');
  assert.equal(first.op, 'updateMany', 'the survivor write is conditional on its observed revision');
  assert.deepEqual(first.query, { id: 'p-keep', updated_date: T0 });
  const expected = buildFieldMergePatch(baseState().Patient[0], baseState().Patient[1]);
  assert.deepEqual(
    first.operations.$set,
    { ...expected, ...buildFieldMergePatch({ ...baseState().Patient[0], ...expected }, { physician_name: 'Dr. Who' }) },
  );
});

test('every patient-referencing record follows the survivor', async () => {
  const state = baseState();
  const { handler, calls } = await loadHandler({ caller: AGENCY_ADMIN, state });
  const result = await invoke(handler, mergeBody({ agency_id: AGENCY }));
  assert.equal(result.status, 200);
  assert.equal(result.json.complete, true);
  assert.deepEqual(result.json.merged_ids, ['p-dup']);
  assert.deepEqual(result.json.incomplete, []);

  for (const [entityName, field] of PATIENT_REFERENCE_FIELDS) {
    const moved = row(state, entityName, `${entityName}-${field}-1`);
    assert.equal(moved[field], 'p-keep', `${entityName}.${field} must be re-pointed`);
  }
  // Versioned rows bump their revision in the same conditional write.
  assert.equal(row(state, 'Referral', 'Referral-patient_id-1').version, 4);
  assert.equal(row(state, 'IncomingFax', 'IncomingFax-suggested_patient_id-1').version, 3);
  // A document and its binding move together, so the integrity check holds.
  assert.equal(row(state, 'Document', 'doc-1').patient_id, 'p-keep');
  assert.equal(row(state, 'DocumentTenantBinding', 'binding-1').patient_id, 'p-keep');
  // Older merges into the duplicate now resolve to the survivor.
  assert.equal(row(state, 'Patient', 'p-old').merged_into_id, 'p-keep');
  // Retained references are untouched, by name.
  assert.equal(row(state, 'PatientOutcomeMetric', 'metric-1').patient_id, 'p-dup');
  assert.equal(row(state, 'SmsConsent', 'consent-1').patient_id, 'p-dup');
  assert.deepEqual(result.json.retained_on_duplicate, Object.keys(RETAINED_PATIENT_REFERENCES));

  // Care team: create on the survivor, then revoke the duplicate's grant.
  const grants = state.PatientCareTeamAssignment;
  const survivorNurse1 = grants.filter((g) => g.patient_id === 'p-keep' && g.user_id === 'nurse-1');
  assert.equal(survivorNurse1.length, 1);
  assert.deepEqual(
    {
      assignment_key: survivorNurse1[0].assignment_key,
      status: survivorNurse1[0].status,
      version: survivorNurse1[0].version,
      source: survivorNurse1[0].source,
      assignee_membership_id: survivorNurse1[0].assignee_membership_id,
      last_transition_action: survivorNurse1[0].last_transition_action,
      created_by_user_id: survivorNurse1[0].created_by_user_id,
      activated: survivorNurse1[0].activated_at === survivorNurse1[0].last_transition_at,
      request_key_ok: survivorNurse1[0].last_transition_request_key
        === `${survivorNurse1[0].assignment_key}:${survivorNurse1[0].last_transition_request_id}`,
    },
    {
      assignment_key: `${AGENCY}:p-keep:nurse-1`,
      status: 'active',
      version: 1,
      source: 'patient_creator',
      assignee_membership_id: 'membership-nurse-1',
      last_transition_action: 'grant',
      created_by_user_id: 'admin-1',
      activated: true,
      request_key_ok: true,
    },
  );
  for (const id of ['pcta-1', 'pcta-2']) {
    const revoked = row(state, 'PatientCareTeamAssignment', id);
    assert.equal(revoked.status, 'revoked', `${id} is revoked once the survivor holds the grant`);
    assert.equal(revoked.version, 2);
    assert.equal(revoked.revoked_at, revoked.last_transition_at);
    assert.equal(revoked.revocation_reason, revoked.last_transition_reason);
    assert.equal(revoked.patient_id, 'p-dup', 'an assignment row is never re-pointed');
  }
  assert.equal(grants.filter((g) => g.patient_id === 'p-keep' && g.user_id === 'nurse-2').length, 1,
    'no second active grant for a user the survivor already has');
  assert.equal(row(state, 'PatientCareTeamAssignment', 'pcta-3').status, 'active',
    'a survivor revocation wins; the duplicate grant stays on the archived chart');
  assert.equal(grants.filter((g) => g.patient_id === 'p-keep' && g.user_id === 'nurse-3').length, 1);
  assert.equal(row(state, 'PatientCareTeamAssignment', 'pcta-4').status, 'suspended');
  assert.equal(grants.filter((g) => g.patient_id === 'p-keep' && g.user_id === 'nurse-4').length, 0);
  assert.deepEqual(result.json.care_team, {
    granted_on_survivor: 1, already_on_survivor: 1, revoked_on_duplicate: 2, conflicts: 1,
  });

  // Note history: immutable originals stay; survivor copies are keyed exactly
  // as appendPatientNoteHistory keys a revision for that patient.
  const sha = async (value) => Buffer.from(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)),
  ).toString('hex');
  const originals = state.PatientNoteHistoryEntry.filter((n) => n.patient_id === 'p-dup');
  assert.equal(originals.length, 2);
  assert.equal(originals[0].event_key, HEX('b'), 'originals are never rewritten');
  const copies = state.PatientNoteHistoryEntry.filter((n) => n.patient_id === 'p-keep');
  assert.equal(copies.length, 2);
  const logical = await sha(JSON.stringify([AGENCY, 'p-keep', 'visit-dup-1']));
  for (const copy of copies) {
    const original = originals.find((n) => n.payload_fingerprint === copy.payload_fingerprint);
    const scope = original.source_entry_id || original.payload_fingerprint;
    assert.equal(copy.logical_note_key, logical);
    assert.equal(copy.event_key, await sha(JSON.stringify([AGENCY, 'p-keep', 'visit-dup-1', scope])));
    for (const field of ['note', 'clinical_notes', 'actor_user_id', 'membership_id', 'recorded_at', 'visit_revision_at']) {
      assert.equal(copy[field], original[field], `${field} is carried exactly`);
    }
  }

  // The duplicate is archived and points at the survivor.
  const dup = row(state, 'Patient', 'p-dup');
  assert.deepEqual(
    { status: dup.status, is_archived: dup.is_archived, merged_into_id: dup.merged_into_id, merged_by: dup.merged_by },
    { status: 'merged', is_archived: true, merged_into_id: 'p-keep', merged_by: 'admin@agency.test' },
  );

  // Archive is the LAST write touching the duplicate, and the survivor is first.
  const patientWrites = calls.writes.filter((w) => w.entity !== 'UserActivity');
  assert.equal(patientWrites[0].entity, 'Patient');
  assert.equal(patientWrites[0].query?.id, 'p-keep');
  const archiveIndex = patientWrites.findIndex((w) => w.entity === 'Patient' && w.id === 'p-dup');
  assert.equal(archiveIndex, patientWrites.length - 1, 'nothing is written after the duplicate is archived');

  // The audit entry carries opaque ids only.
  assert.equal(state.UserActivity.length, 1);
  const audit = state.UserActivity[0];
  assert.equal(audit.action, 'patients_deduplicated');
  assert.equal(audit.status, 'success');
  assert.deepEqual(audit.details.groups, [{ kept_id: 'p-keep', removed_ids: ['p-dup'], incomplete_ids: [] }]);
  assert.doesNotMatch(JSON.stringify(audit), /MRN-1|Smith|Penicillin|1950/);
});

test('a half-done merge leaves the duplicate active and a retry finishes it without doubling', async () => {
  const state = baseState();
  let visitFailures = 1;
  let careTeamCreateFailures = 1;
  const failWrite = (entity, op) => {
    if (entity === 'Visit' && op === 'update' && visitFailures > 0) {
      visitFailures -= 1;
      return true;
    }
    if (entity === 'PatientCareTeamAssignment' && op === 'create' && careTeamCreateFailures > 0) {
      careTeamCreateFailures -= 1;
      return true;
    }
    return false;
  };
  const first = await loadHandler({ state, failWrite });
  const partial = await invoke(first.handler, mergeBody());
  assert.equal(partial.status, 207);
  assert.equal(partial.json.complete, false);
  assert.deepEqual(partial.json.merged_ids, []);
  assert.equal(partial.json.incomplete[0].duplicate_id, 'p-dup');
  assert.deepEqual(Object.keys(partial.json.incomplete[0].failed).sort(),
    ['PatientCareTeamAssignment.patient_id', 'Visit.patient_id']);
  const dupAfterPartial = row(state, 'Patient', 'p-dup');
  assert.equal(dupAfterPartial.status, 'active', 'an unfinished duplicate is never archived');
  assert.equal(dupAfterPartial.is_archived, false);
  assert.equal(row(state, 'Visit', 'Visit-patient_id-1').patient_id, 'p-dup');
  assert.equal(row(state, 'CarePlan', 'CarePlan-patient_id-1').patient_id, 'p-keep');
  assert.equal(row(state, 'PatientCareTeamAssignment', 'pcta-1').status, 'active',
    'the duplicate grant is not revoked until the survivor holds one');
  assert.equal(state.UserActivity[0].status, 'partial');
  assert.deepEqual(state.UserActivity[0].details.groups[0].incomplete_ids, ['p-dup']);

  // Retry with the same request: no injected failures remain.
  const second = await loadHandler({ state });
  const finished = await invoke(second.handler, mergeBody());
  assert.equal(finished.status, 200);
  assert.equal(finished.json.complete, true);
  assert.deepEqual(finished.json.merged_ids, ['p-dup']);
  assert.equal(row(state, 'Visit', 'Visit-patient_id-1').patient_id, 'p-keep');
  assert.equal(row(state, 'Patient', 'p-dup').status, 'merged');

  // Nothing was doubled by running twice.
  const survivorGrants = state.PatientCareTeamAssignment.filter((g) => g.patient_id === 'p-keep' && g.status === 'active');
  assert.deepEqual(survivorGrants.map((g) => g.user_id).sort(), ['nurse-1', 'nurse-2']);
  assert.equal(state.PatientNoteHistoryEntry.filter((n) => n.patient_id === 'p-keep').length, 2);
  assert.equal(finished.json.note_history.already_on_survivor, 2);
  assert.equal(finished.json.fields_merged.length, 0, 'the survivor was already filled on the first run');

  // Running a completed merge again is a harmless sweep.
  const third = await loadHandler({ state });
  const again = await invoke(third.handler, mergeBody());
  assert.equal(again.status, 200);
  assert.deepEqual(again.json.merged_ids, ['p-dup']);
  assert.deepEqual(again.json.reassigned, {});
  assert.equal(state.PatientNoteHistoryEntry.filter((n) => n.patient_id === 'p-keep').length, 2);
});

test('a lost survivor race reloads instead of overwriting a concurrent edit', async () => {
  const state = baseState();
  let raced = false;
  const failWrite = (entity, op, target) => {
    if (entity === 'Patient' && op === 'updateMany' && target?.id === 'p-keep' && !raced) {
      raced = true;
      // Somebody fills allergies between our read and our conditional write.
      const keep = state.Patient.find((p) => p.id === 'p-keep');
      keep.allergies = 'Sulfa';
      keep.updated_date = T1;
    }
    return false;
  };
  const { handler } = await loadHandler({ state, failWrite });
  const result = await invoke(handler, mergeBody());
  assert.equal(result.status, 200);
  assert.equal(row(state, 'Patient', 'p-keep').allergies, 'Sulfa', 'the concurrent edit survives');
  assert.equal(row(state, 'Patient', 'p-keep').phone, '555-111-2222');
});

test('scans are previews scoped to the caller agency; confirm merges through the same core', async () => {
  const state = baseState();
  state.Patient.push(patient('p-x1', { agency_id: OTHER_AGENCY, medical_record_number: 'MRN-9' }));
  state.Patient.push(patient('p-x2', { agency_id: OTHER_AGENCY, medical_record_number: 'MRN-9' }));
  {
    const { handler, calls } = await loadHandler({ caller: MANAGER, state });
    const preview = await invoke(handler, { action: 'scan' });
    assert.equal(preview.status, 200);
    assert.equal(preview.json.dry_run, true);
    assert.deepEqual(calls.writes, [], 'a preview changes nothing');
    assert.ok(calls.reads.some((r) => r.entity === 'Patient' && r.query?.agency_id === AGENCY));
    assert.ok(!calls.reads.some((r) => r.entity === 'Patient' && r.list), 'an agency caller never lists every tenant');
    const ids = preview.json.details.flatMap((d) => [d.kept.id, ...d.removed.map((r) => r.id)]);
    assert.ok(ids.includes('p-dup'));
    assert.ok(!ids.includes('p-x1') && !ids.includes('p-x2'));
  }
  {
    // The platform tier scans every agency but never groups across one.
    const { handler } = await loadHandler({ caller: OWNER, state: structuredClone(state) });
    const preview = await invoke(handler, {});
    for (const detail of preview.json.details) {
      const members = [detail.kept.id, ...detail.removed.map((r) => r.id)];
      const agencies = new Set(members.map((id) => state.Patient.find((p) => p.id === id).agency_id));
      assert.equal(agencies.size, 1);
    }
  }
  {
    const confirmState = structuredClone(state);
    const { handler } = await loadHandler({ caller: AGENCY_ADMIN, state: confirmState });
    const applied = await invoke(handler, { confirm: true });
    assert.equal(applied.status, 200);
    assert.equal(applied.json.dry_run, false);
    assert.ok(applied.json.patients_removed >= 1);
    const archived = confirmState.Patient.filter((p) => p.status === 'merged' && p.id !== 'p-old');
    assert.ok(archived.every((p) => p.agency_id === AGENCY));
    assert.equal(confirmState.UserActivity[0].details.mode, 'confirm');
  }
  {
    const { handler } = await loadHandler();
    const unknown = await invoke(handler, { confirm: true, extra: 1 });
    assert.equal(unknown.status, 400);
  }
});

test('every entity field that references a patient is classified', () => {
  const classified = new Set([
    ...PATIENT_REFERENCE_FIELDS.map(([entity, field]) => `${entity}.${field}`),
    ...Object.keys(SPECIAL_PATIENT_REFERENCES),
    ...Object.keys(RETAINED_PATIENT_REFERENCES),
  ]);
  const found = [];
  const walk = (entity, properties, prefix) => {
    for (const [name, spec] of Object.entries(properties || {})) {
      const path = prefix ? `${prefix}.${name}` : name;
      const description = String(spec?.description || '');
      const named = /patient/i.test(name) && /_ids?$/.test(name);
      const described = /\bPatient (?:entity )?id\b|\bReference to Patient\b|\bpatient IDs\b|\bsurviving Patient id\b|\bpatient identifiers\b/i
        .test(description);
      if (named || described) found.push(`${entity}.${path}`);
      if (spec?.properties) walk(entity, spec.properties, path);
      if (spec?.items?.properties) walk(entity, spec.items.properties, path);
    }
  };
  const directory = resolve(root, 'base44/entities');
  for (const file of readdirSync(directory).filter((name) => name.endsWith('.jsonc'))) {
    const schema = JSON5.parse(readFileSync(join(directory, file), 'utf8'));
    walk(file.replace(/\.jsonc$/, ''), schema.properties, '');
  }
  const unclassified = found.filter((path) => !classified.has(path));
  assert.deepEqual(unclassified, [], `classify every patient reference in deduplicatePatients:\n${unclassified.join('\n')}`);
  // And nothing is classified that no schema carries.
  const stale = [...classified].filter((path) => !found.includes(path));
  assert.deepEqual(stale, [], `stale patient reference classifications:\n${stale.join('\n')}`);
  // Every retained reference says why.
  for (const [path, reason] of Object.entries(RETAINED_PATIENT_REFERENCES)) {
    assert.ok(reason.length >= 40, `${path} needs a reason`);
  }
});
