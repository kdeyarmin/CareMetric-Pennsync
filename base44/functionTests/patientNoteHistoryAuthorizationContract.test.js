import assert from 'node:assert/strict';
import { readFile, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import JSON5 from 'json5';
import { transpileTs } from '../../tools-transpile-ts.mjs';

const writerUrl = new URL('../functions/appendPatientNoteHistory/entry.ts', import.meta.url);
const readerUrl = new URL('../functions/getAuthorizedPatientNoteHistory/entry.ts', import.meta.url);
const entityUrl = new URL('../entities/PatientNoteHistoryEntry.jsonc', import.meta.url);

const USER = {
  id: 'user-1',
  email: 'Clinician@Agency.test',
  is_active: true,
  is_verified: true,
};

const patient = (overrides = {}) => ({
  id: 'patient-1',
  agency_id: 'agency-1',
  status: 'active',
  created_by: 'clinician@agency.test',
  assigned_nurses: ['clinician@agency.test'],
  is_archived: false,
  is_sample: false,
  ...overrides,
});

const agency = (overrides = {}) => ({ id: 'agency-1', status: 'active', ...overrides });

const membership = (overrides = {}) => ({
  id: 'membership-1',
  membership_key: 'agency-1:user-1',
  agency_id: 'agency-1',
  user_id: 'user-1',
  user_email_normalized: 'clinician@agency.test',
  tenant_role: 'clinician',
  status: 'active',
  created_by_user_id: 'owner-1',
  last_transition_by_user_id: 'owner-1',
  last_transition_by_email_normalized: 'owner@platform.test',
  last_transition_at: '2026-09-03T12:00:00.000Z',
  last_transition_reason: 'Approved clinical access',
  activated_at: '2026-09-03T12:00:00.000Z',
  version: 3,
  ...overrides,
});

const visit = (overrides = {}) => ({
  id: 'visit-1',
  patient_id: 'patient-1',
  agency_id: 'agency-1',
  status: 'completed',
  visit_date: '2026-09-03',
  visit_type: 'routine_visit',
  nurse_notes: 'Current clinical note',
  compliance_score: 98,
  updated_date: '2026-09-03T12:00:00.000Z',
  ...overrides,
});

const validBody = (overrides = {}) => ({
  patient_id: 'patient-1',
  mode: 'append',
  clinical_notes: 'Current clinical note',
  entry: {
    entry_id: 'request-1',
    visit_id: 'visit-1',
    date: '2026-09-03',
    visit_type: 'routine_visit',
    note: 'Current clinical note',
    compliance_score: 98,
  },
  ...overrides,
});

async function importHandler(url, globalName, makeClient) {
  let source = await readFile(url, 'utf8');
  source = source.replace(
    /import\s+\{\s*createClientFromRequest\s*\}\s+from\s+'npm:[^']+';/,
    `const createClientFromRequest = globalThis.${globalName};`,
  );
  const temporaryModule = join(
    tmpdir(),
    `patient_note_history_${Date.now()}_${Math.random().toString(36).slice(2)}.mjs`,
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

function filtered(rows, query, limit, skip = 0) {
  const matches = rows.filter((row) => Object.entries(query || {})
    .every(([key, value]) => row?.[key] === value));
  return matches.slice(skip, Number.isFinite(limit) ? skip + limit : undefined);
}

async function loadWriter({
  caller = USER,
  patients = [patient()],
  agencies = [agency()],
  memberships = [membership()],
  visits = [visit()],
  events = [],
  mutateAfterCreate = null,
} = {}) {
  const state = {
    patients: structuredClone(patients),
    agencies: structuredClone(agencies),
    memberships: structuredClone(memberships),
    visits: structuredClone(visits),
    events: structuredClone(events),
  };
  const calls = { creates: [], updates: 0, deletes: 0, filters: [] };
  const makeEntity = (name, rows) => ({
    filter: async (query, sort, limit, skip) => {
      calls.filters.push({ name, query, sort, limit, skip });
      const result = filtered(rows, query, limit, skip);
      return sort === '-created_date' ? result.reverse() : result;
    },
  });
  const entities = {
    Patient: makeEntity('Patient', state.patients),
    Agency: makeEntity('Agency', state.agencies),
    AgencyMembership: makeEntity('AgencyMembership', state.memberships),
    Visit: makeEntity('Visit', state.visits),
    PatientNoteHistoryEntry: {
      ...makeEntity('PatientNoteHistoryEntry', state.events),
      create: async (payload) => {
        const row = {
          ...structuredClone(payload),
          id: `event-${state.events.length + 1}`,
          created_date: `2026-09-03T12:00:0${state.events.length}.000Z`,
        };
        state.events.push(row);
        calls.creates.push(structuredClone(payload));
        if (mutateAfterCreate) mutateAfterCreate(state);
        return row;
      },
      update: async () => { calls.updates += 1; },
      delete: async () => { calls.deletes += 1; },
    },
  };
  const client = {
    auth: { me: async () => (caller instanceof Error ? Promise.reject(caller) : caller) },
    asServiceRole: { entities },
  };
  const handler = await importHandler(
    writerUrl,
    '__patientNoteWriterClient',
    () => client,
  );
  return { handler, state, calls };
}

async function loadReader({
  caller = USER,
  patients = [patient()],
  agencies = [agency()],
  memberships = [membership()],
  events = [],
} = {}) {
  const calls = { filters: [] };
  const makeEntity = (name, rows) => ({
    filter: async (query, sort, limit, skip = 0) => {
      calls.filters.push({ name, query, sort, limit, skip });
      let result = filtered(rows, query, undefined, 0);
      if (sort === '-created_date') result = result.slice().reverse();
      return result.slice(skip, skip + limit);
    },
  });
  const entities = {
    Patient: makeEntity('Patient', patients),
    Agency: makeEntity('Agency', agencies),
    AgencyMembership: makeEntity('AgencyMembership', memberships),
    PatientNoteHistoryEntry: makeEntity('PatientNoteHistoryEntry', events),
  };
  const client = {
    auth: { me: async () => (caller instanceof Error ? Promise.reject(caller) : caller) },
    asServiceRole: { entities },
  };
  const handler = await importHandler(
    readerUrl,
    '__patientNoteReaderClient',
    () => client,
  );
  return { handler, calls };
}

async function invoke(handler, body, { method = 'POST', invalidJson = false } = {}) {
  const response = await handler(new Request('http://local/patient-note-history', {
    method,
    headers: { 'content-type': 'application/json' },
    ...(method === 'GET' || method === 'HEAD'
      ? {}
      : { body: invalidJson ? '{' : JSON.stringify(body) }),
  }));
  return { response, json: await response.json() };
}

test('append-only entity is service-only and both functions transpile', async () => {
  const schema = JSON5.parse(await readFile(entityUrl, 'utf8'));
  assert.deepEqual(schema.rls, { create: false, read: false, update: false, delete: false });
  for (const url of [writerUrl, readerUrl]) {
    const source = await readFile(url, 'utf8');
    assert.ok(transpileTs(source).outputText.length > 0);
    assert.doesNotMatch(source, /\.Patient\.update\s*\(/);
    assert.doesNotMatch(source, /PatientNoteHistoryEntry\.(?:update|delete)\s*\(/);
  }
  const writer = await readFile(writerUrl, 'utf8');
  assert.match(writer, /PatientNoteHistoryEntry\.create\s*\(/);
  assert.doesNotMatch(writer, /PATIENT NOTE HISTORY HARD PAUSE/);
});

test('writer rejects method, authentication, and malformed input before any create', async () => {
  const loaded = await loadWriter();
  assert.equal((await invoke(loaded.handler, null, { method: 'GET' })).response.status, 405);
  assert.equal((await invoke(loaded.handler, {}, { invalidJson: true })).response.status, 400);

  for (const caller of [null, new Error('expired'), { ...USER, is_active: false }, { ...USER, is_service: true }]) {
    const denied = await loadWriter({ caller });
    const result = await invoke(denied.handler, validBody());
    assert.ok([401, 403].includes(result.response.status));
    assert.equal(denied.calls.creates.length, 0);
  }
});

test('writer strictly rejects identity, metadata, and clinical-note smuggling', async () => {
  const cases = [
    validBody({ agency_id: 'agency-2' }),
    validBody({ patient_id: '$patient-1' }),
    validBody({ mode: 'replace' }),
    validBody({ clinical_notes: 'Different text' }),
    validBody({ entry: { ...validBody().entry, visit_id: '$visit-1' } }),
    validBody({ entry: { ...validBody().entry, created_by: 'attacker@test' } }),
    validBody({ entry: { ...validBody().entry, date: '2026-02-30' } }),
    validBody({ entry: { ...validBody().entry, note: '   ' } }),
    validBody({ entry: { ...validBody().entry, compliance_score: 101 } }),
  ];
  for (const body of cases) {
    const loaded = await loadWriter();
    const result = await invoke(loaded.handler, body);
    assert.ok([400, 413].includes(result.response.status), JSON.stringify(result.json));
    assert.equal(loaded.calls.creates.length, 0);
  }
});

test('writer enforces exact tenant, patient, Visit, membership, role, and care-team authority', async () => {
  const cases = [
    { memberships: [membership({ status: 'revoked', revoked_at: '2026-09-03T13:00:00Z', revocation_reason: 'Offboarded' })] },
    { memberships: [membership(), membership({ id: 'membership-2' })] },
    { memberships: [membership({ tenant_role: 'office_staff' })] },
    { patients: [patient({ created_by: 'other@agency.test', assigned_nurses: [] })] },
    { patients: [patient({ agency_id: 'agency-2' })] },
    { visits: [visit({ patient_id: 'patient-2' })] },
    { visits: [visit({ agency_id: 'agency-2' })] },
    { visits: [visit({ status: 'scheduled' })] },
    { visits: [visit({ visit_date: '2026-09-02' })] },
    { visits: [visit({ visit_type: 'skilled_nursing' })] },
    { visits: [visit({ nurse_notes: 'Different stored note' })] },
    { visits: [visit({ compliance_score: 50 })] },
    { agencies: [agency({ status: 'disabled' })] },
  ];
  for (const options of cases) {
    const loaded = await loadWriter(options);
    const result = await invoke(loaded.handler, validBody());
    assert.ok([403, 409].includes(result.response.status), JSON.stringify(result.json));
    assert.equal(loaded.calls.creates.length, 0);
  }
});

test('writer creates an immutable tenant-stamped event and exact replay is idempotent', async () => {
  const loaded = await loadWriter();
  const first = await invoke(loaded.handler, validBody());
  assert.equal(first.response.status, 200);
  assert.equal(first.json.created, true);
  assert.equal(loaded.calls.creates.length, 1);
  assert.equal(loaded.calls.updates, 0);
  assert.equal(loaded.calls.deletes, 0);
  assert.match(loaded.state.events[0].event_key, /^[a-f0-9]{64}$/);
  assert.match(loaded.state.events[0].logical_note_key, /^[a-f0-9]{64}$/);
  assert.equal(loaded.state.events[0].agency_id, 'agency-1');
  assert.equal(loaded.state.events[0].actor_user_id, 'user-1');
  assert.equal(loaded.state.events[0].actor_email_normalized, 'clinician@agency.test');
  assert.equal(loaded.state.events[0].membership_version, 3);
  assert.equal(loaded.state.events[0].visit_revision_at, '2026-09-03T12:00:00.000Z');

  const replay = await invoke(loaded.handler, validBody());
  assert.equal(replay.response.status, 200);
  assert.equal(replay.json.created, false);
  assert.equal(loaded.calls.creates.length, 1);
});

test('writer derives immutable Visit metadata when an update request omits it', async () => {
  const loaded = await loadWriter();
  const body = validBody({
    mode: 'update',
    entry: {
      entry_id: 'request-update-1',
      visit_id: 'visit-1',
      note: 'Current clinical note',
      compliance_score: 98,
    },
  });
  const result = await invoke(loaded.handler, body);
  assert.equal(result.response.status, 200);
  assert.equal(loaded.state.events[0].visit_date, '2026-09-03');
  assert.equal(loaded.state.events[0].visit_type, 'routine_visit');
});

test('same caller retry id cannot be reused for different note content', async () => {
  const loaded = await loadWriter();
  assert.equal((await invoke(loaded.handler, validBody())).response.status, 200);
  const conflictBody = validBody({
    clinical_notes: 'Conflicting clinical note',
    entry: { ...validBody().entry, note: 'Conflicting clinical note' },
  });
  loaded.state.visits[0].nurse_notes = 'Conflicting clinical note';
  const conflict = await invoke(loaded.handler, conflictBody);
  assert.equal(conflict.response.status, 409);
  assert.match(conflict.json.error, /conflicts/);
  assert.equal(loaded.calls.creates.length, 1);
});

test('post-commit authority transition is reported and the immutable audit event remains', async () => {
  const loaded = await loadWriter({
    mutateAfterCreate: (state) => {
      state.memberships[0] = {
        ...state.memberships[0],
        status: 'suspended',
        last_transition_at: '2026-09-03T13:00:00Z',
        last_transition_reason: 'Emergency access suspension',
      };
    },
  });
  const result = await invoke(loaded.handler, validBody());
  assert.equal(result.response.status, 409);
  assert.equal(result.json.code, 'PATIENT_NOTE_COMMITTED_AUTHORITY_CHANGED');
  assert.equal(loaded.state.events.length, 1);
  assert.equal(loaded.calls.updates, 0);
  assert.equal(loaded.calls.deletes, 0);
});

function storedEvent(overrides = {}) {
  return {
    id: 'event-1',
    created_date: '2026-09-03T12:00:00Z',
    agency_id: 'agency-1',
    patient_id: 'patient-1',
    visit_id: 'visit-1',
    logical_note_key: 'a'.repeat(64),
    event_key: 'b'.repeat(64),
    payload_fingerprint: 'c'.repeat(64),
    source_entry_id: 'request-1',
    mode: 'append',
    visit_date: '2026-09-03',
    visit_type: 'routine_visit',
    note: 'Initial note',
    clinical_notes: 'Initial note',
    compliance_score: 91,
    actor_user_id: 'user-1',
    actor_email_normalized: 'clinician@agency.test',
    membership_id: 'membership-1',
    membership_version: 3,
    visit_revision_at: '2026-09-03T12:00:00Z',
    recorded_at: '2026-09-03T12:00:00Z',
    ...overrides,
  };
}

test('reader is authenticated, tenant-authorized, bounded, and returns no direct entity surface', async () => {
  const denied = await loadReader({ caller: null });
  assert.equal((await invoke(denied.handler, { patient_id: 'patient-1' })).response.status, 401);

  const office = await loadReader({ memberships: [membership({ tenant_role: 'office_staff' })] });
  assert.equal((await invoke(office.handler, { patient_id: 'patient-1' })).response.status, 403);

  const loaded = await loadReader({ events: [storedEvent()] });
  const result = await invoke(loaded.handler, {
    patient_id: 'patient-1', event_limit: 50, offset: 0,
  });
  assert.equal(result.response.status, 200);
  assert.deepEqual(result.json.entries.map((entry) => entry.note), ['Initial note']);
  assert.equal(result.json.latest_clinical_notes, 'Initial note');
  assert.equal(result.json.entries[0].actor_user_id, undefined);
  const historyQuery = loaded.calls.filters.find((call) => call.name === 'PatientNoteHistoryEntry');
  assert.deepEqual(historyQuery.query, { patient_id: 'patient-1', agency_id: 'agency-1' });
  assert.equal(historyQuery.limit, 50);
});

test('reader collapses duplicate events and newest Visit revisions deterministically', async () => {
  const initial = storedEvent();
  const duplicate = {
    ...initial,
    id: 'event-duplicate',
    // This idempotent duplicate physically committed after the newer revision.
    // Its older Visit revision must keep it from regressing the projection.
    created_date: '2026-09-03T14:00:00Z',
    recorded_at: '2026-09-03T14:00:00Z',
  };
  const revised = storedEvent({
    id: 'event-2',
    created_date: '2026-09-03T13:00:00Z',
    event_key: 'd'.repeat(64),
    payload_fingerprint: 'e'.repeat(64),
    source_entry_id: 'request-2',
    mode: 'update',
    note: 'Revised note',
    clinical_notes: 'Revised note',
    visit_revision_at: '2026-09-03T13:00:00Z',
    recorded_at: '2026-09-03T13:00:00Z',
  });
  const loaded = await loadReader({ events: [initial, revised, duplicate] });
  const result = await invoke(loaded.handler, { patient_id: 'patient-1' });
  assert.equal(result.response.status, 200);
  assert.deepEqual(result.json.entries.map((entry) => entry.note), ['Revised note']);
});

test('reader fails closed on corrupt or cross-tenant event rows', async () => {
  for (const event of [
    storedEvent({ actor_email_normalized: 'not-an-email' }),
    storedEvent({ logical_note_key: '' }),
  ]) {
    const loaded = await loadReader({ events: [event] });
    const result = await invoke(loaded.handler, { patient_id: 'patient-1' });
    assert.equal(result.response.status, 409);
  }
  const otherTenant = await loadReader({
    events: [storedEvent({ agency_id: 'agency-2' })],
  });
  const result = await invoke(otherTenant.handler, { patient_id: 'patient-1' });
  assert.equal(result.response.status, 200);
  assert.deepEqual(result.json.entries, []);
});
