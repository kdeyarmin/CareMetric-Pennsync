import assert from 'node:assert/strict';
import { readFile, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { transpileTs } from '../../tools-transpile-ts.mjs';

// Released by the owner on 2026-10-08 ("turn everything on"):
// calculateDataQualityScores and enforceDataCompleteness were legacy Patient
// service-role writers scoped by editable agency_name. These tests pin how
// they are safe now: authority from service-owned membership rows (or the
// scheduler secret / built-in admin for the per-agency scheduled run), every
// read filtered by one agency_id, Patient writes only through a
// compare-and-swap on that agency and updated_date, and a Visit's clinician
// compliance score never overwritten.

const AT = '2026-09-01T12:00:00.000Z';
const SECRET = 'synthetic-internal-secret-0123456789abcdef';
const agencies = [
  { id: 'agency-1', status: 'active', agency_name: 'Agency One' },
  { id: 'agency-2', status: 'trial', agency_name: 'Agency Two' },
  { id: 'agency-3', status: 'suspended', agency_name: 'Agency Three' },
];

function membership(user, agencyId, tenantRole, status = 'active') {
  return {
    id: `membership-${user.id}-${agencyId}`,
    membership_key: `${agencyId}:${user.id}`,
    agency_id: agencyId,
    user_id: user.id,
    user_email_normalized: user.email,
    tenant_role: tenantRole,
    status,
    version: 1,
    created_by_user_id: 'user-owner',
    last_transition_by_user_id: 'user-owner',
    last_transition_by_email_normalized: 'owner@example.com',
    last_transition_at: AT,
    last_transition_reason: 'Synthetic membership',
    activated_at: AT,
    revoked_at: null,
    revocation_reason: null,
  };
}

const manager = { id: 'user-manager', email: 'manager@example.com', role: 'user', is_active: true };
const clinician = { id: 'user-clinician', email: 'clinician@example.com', role: 'user', is_active: true };
const outsideManager = { id: 'user-other', email: 'other@example.com', role: 'user', is_active: true };

function tables() {
  return {
    Agency: agencies,
    AgencyMembership: [
      membership(manager, 'agency-1', 'manager'),
      membership(clinician, 'agency-1', 'clinician'),
      membership(outsideManager, 'agency-2', 'manager'),
    ],
    User: [
      { id: manager.id, email: manager.email, phone: '555', care_scope: 'home_health', credential_type: 'RN', license_number: 'L1', profile_completeness_score: 100 },
      { id: clinician.id, email: clinician.email, phone: '' },
      { id: outsideManager.id, email: outsideManager.email },
    ],
    Patient: [
      { id: 'patient-1', agency_id: 'agency-1', status: 'active', first_name: 'A', updated_date: AT },
      {
        id: 'patient-2', agency_id: 'agency-1', status: 'active', updated_date: AT,
        first_name: 'B', last_name: 'C', date_of_birth: '1940-01-01', phone: '1', address: 'x',
        emergency_contact_name: 'E', emergency_contact_phone: '2', physician_name: 'Dr', primary_diagnosis: 'HF',
        data_completeness_score: 100, missing_critical_fields: [],
      },
      { id: 'patient-9', agency_id: 'agency-2', status: 'active', first_name: 'Z', updated_date: AT },
    ],
    Visit: [
      { id: 'visit-1', agency_id: 'agency-1', status: 'completed', nurse_notes: 'short', compliance_score: 92 },
      { id: 'visit-9', agency_id: 'agency-2', status: 'completed', nurse_notes: 'short' },
    ],
  };
}

async function load(name, { user, headers = {}, data = tables(), onCas = null } = {}) {
  let source = await readFile(new URL(`../functions/${name}/entry.ts`, import.meta.url), 'utf8');
  source = source.replace(
    /import\s+\{\s*createClientFromRequest\s*\}\s+from\s+'npm:[^']+';?/,
    'const createClientFromRequest = globalThis.__dataQualityClient;',
  );
  const temporary = join(tmpdir(), `data_quality_${name}_${Date.now()}_${Math.random().toString(36).slice(2)}.mjs`);
  await writeFile(temporary, transpileTs(source).outputText);
  const state = { data: structuredClone(data), reads: [], casWrites: [], updates: [], bodyReads: 0 };
  const matches = (row, query) => Object.entries(query || {}).every(([key, value]) => {
    if (value && typeof value === 'object' && Array.isArray(value.$in)) return value.$in.includes(row?.[key]);
    return row?.[key] === value;
  });
  const entity = (table) => ({
    filter: async (query, _sort, limit) => {
      state.reads.push({ table, query });
      const found = (state.data[table] || []).filter((row) => matches(row, query));
      return structuredClone(Number.isFinite(limit) ? found.slice(0, limit) : found);
    },
    updateMany: async (query, operation) => {
      if (onCas) onCas(state, table, query);
      state.casWrites.push({ table, query: structuredClone(query), set: structuredClone(operation.$set) });
      const found = (state.data[table] || []).filter((row) => matches(row, query));
      for (const row of found) Object.assign(row, operation.$set, { updated_date: new Date().toISOString() });
      return { success: true, updated: found.length, has_more: false };
    },
    update: async (id, patch) => {
      state.updates.push({ table, id, patch: structuredClone(patch) });
      if (table === 'Patient' || table === 'Visit') throw new Error(`${table}.update must not be called`);
      const row = (state.data[table] || []).find((candidate) => candidate.id === id);
      Object.assign(row, patch);
      return row;
    },
  });
  const entities = new Proxy({}, { get: (_target, table) => entity(String(table)) });
  let handler;
  globalThis.__dataQualityClient = () => ({ auth: { me: async () => user }, asServiceRole: { entities } });
  globalThis.Deno = {
    env: { get: (key) => (key === 'INTERNAL_FN_SECRET' ? SECRET : undefined) },
    serve: (candidate) => { handler = candidate; },
  };
  try {
    await import(`${pathToFileURL(temporary).href}?v=${Math.random()}`);
  } finally {
    await unlink(temporary).catch(() => {});
  }
  return {
    state,
    call: async (body = {}) => {
      const request = new Request(`http://local/${name}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify(body),
      });
      const text = request.text.bind(request);
      request.text = async () => { state.bodyReads += 1; return text(); };
      const response = await handler(request);
      return { status: response.status, json: await response.json() };
    },
  };
}

test('scoring refuses anonymous callers without the scheduler secret, clinicians and forged profiles before any read', async () => {
  for (const user of [
    null,
    clinician,
    { ...clinician, account_type: 'agency_admin', is_manager: true, agency_id: 'agency-1' },
  ]) {
    const fn = await load('calculateDataQualityScores', { user });
    const result = await fn.call({});
    assert.ok([401, 403].includes(result.status), `${JSON.stringify(user)} -> ${result.status}`);
    assert.equal(fn.state.bodyReads, 0);
    assert.deepEqual(fn.state.reads.filter((read) => read.table !== 'AgencyMembership' && read.table !== 'Agency'), []);
  }
});

test('a manager scores only their own agency, through a compare-and-swap, and never touches visit compliance', async () => {
  const fn = await load('calculateDataQualityScores', { user: manager });
  let result = await fn.call({});
  assert.equal(result.status, 200, JSON.stringify(result.json));
  assert.deepEqual(result.json.agencies.map((agency) => agency.agency_id), ['agency-1']);
  const scoped = fn.state.reads.filter((read) => ['Patient', 'Visit'].includes(read.table));
  assert.ok(scoped.every((read) => read.query.agency_id === 'agency-1'), JSON.stringify(scoped));
  // Only the incomplete chart changed, and only through the agency + updated_date CAS.
  assert.deepEqual(fn.state.casWrites.map((write) => write.query), [
    { id: 'patient-1', agency_id: 'agency-1', updated_date: AT },
  ]);
  assert.equal(fn.state.casWrites[0].set.data_completeness_score, 11);
  assert.equal(fn.state.updates.filter((update) => update.table !== 'User').length, 0);
  assert.equal(fn.state.data.Visit[0].compliance_score, 92, 'the clinician compliance score is untouched');
  assert.equal(result.json.agencies[0].visits_with_documentation_gaps, 1);
  // Only members of the agency get a profile score, and only when it changed.
  assert.deepEqual(fn.state.updates.map((update) => update.id), [clinician.id]);

  result = await fn.call({ agency_id: 'agency-2' });
  assert.equal(result.status, 403, 'a manager cannot name another agency');
});

test('the scheduled run processes each enabled agency separately and skips a suspended one', async () => {
  const fn = await load('calculateDataQualityScores', { user: null, headers: { 'x-internal-secret': SECRET } });
  const result = await fn.call({});
  assert.equal(result.status, 200, JSON.stringify(result.json));
  assert.deepEqual(result.json.agencies.map((agency) => agency.agency_id).sort(), ['agency-1', 'agency-2']);
  const patientReads = fn.state.reads.filter((read) => read.table === 'Patient');
  assert.deepEqual(patientReads.map((read) => read.query.agency_id).sort(), ['agency-1', 'agency-2']);
  assert.ok(fn.state.casWrites.every((write) => ['agency-1', 'agency-2'].includes(write.query.agency_id)));
});

test('a concurrent chart edit wins over the scorer', async () => {
  // The chart changes between the scorer's read and its write: the CAS on
  // updated_date matches nothing, the edit stands, and the run reports it.
  const fn = await load('calculateDataQualityScores', {
    user: manager,
    onCas: (state, table, query) => {
      const row = state.data[table].find((candidate) => candidate.id === query.id);
      row.updated_date = '2026-09-02T00:00:00.000Z';
      row.first_name = 'Edited';
    },
  });
  const result = await fn.call({});
  assert.equal(result.status, 200);
  assert.equal(result.json.agencies[0].patient_conflicts, 1);
  assert.equal(fn.state.data.Patient[0].first_name, 'Edited');
  assert.equal(fn.state.data.Patient[0].data_completeness_score, undefined);
});

test('enforceDataCompleteness scores one record inside the caller\'s agency only', async () => {
  let fn = await load('enforceDataCompleteness', { user: clinician });
  let result = await fn.call({ entity_type: 'Patient', entity_id: 'patient-1' });
  assert.equal(result.status, 403);
  assert.equal(fn.state.bodyReads, 0);

  fn = await load('enforceDataCompleteness', { user: manager });
  result = await fn.call({ entity_type: 'Patient', entity_id: 'patient-9' });
  assert.equal(result.status, 404, 'another agency\'s chart');
  assert.deepEqual(fn.state.casWrites, []);

  result = await fn.call({ entity_type: 'Patient', entity_id: 'patient-1' });
  assert.equal(result.status, 200);
  assert.equal(result.json.updated, true);
  assert.deepEqual(fn.state.casWrites[0].query, { id: 'patient-1', agency_id: 'agency-1', updated_date: AT });

  result = await fn.call({ entity_type: 'User', entity_id: outsideManager.id });
  assert.equal(result.status, 404, 'a user who is not a member of the agency');
  result = await fn.call({ entity_type: 'User', entity_id: clinician.id });
  assert.equal(result.status, 200);
  assert.equal(result.json.completeness_score, 0);

  result = await fn.call({ entity_type: 'Visit', entity_id: 'visit-1' });
  assert.equal(result.status, 200);
  assert.equal(result.json.updated, false);
  assert.equal(fn.state.data.Visit[0].compliance_score, 92);
  result = await fn.call({ entity_type: 'Visit', entity_id: 'visit-9' });
  assert.equal(result.status, 404);
  assert.deepEqual(fn.state.updates.filter((update) => update.table !== 'User'), []);
});
