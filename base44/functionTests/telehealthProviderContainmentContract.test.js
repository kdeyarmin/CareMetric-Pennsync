import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import JSON5 from 'json5';
import { transpileTs } from '../../tools-transpile-ts.mjs';

// Telehealth was released by the owner on 2026-10-08 ("approve everything").
// These tests pin what makes the released flow safe rather than the pause:
// TelehealthSession stays closed to every client operation, so the session
// broker is its only writer; the broker scopes every action to the caller's
// exact agency membership and never hands the stored join-token hash to the
// browser; and the token broker authorizes by stored identity or the
// session's own hashed join token.

const entryUrl = new URL('../functions/createTelehealthToken/entry.ts', import.meta.url);
const brokerUrl = new URL('../functions/manageTelehealthSession/entry.ts', import.meta.url);

async function loadBroker(client, env = {}) {
  let source = await readFile(brokerUrl, 'utf8');
  source = source.replace(
    /import\s+\{\s*createClientFromRequest\s*\}\s+from\s+'npm:[^']+';/,
    'const createClientFromRequest = () => globalThis.__telehealthClient;',
  );
  const moduleFile = join(tmpdir(), `telehealth_broker_${Date.now()}_${Math.random().toString(36).slice(2)}.mjs`);
  await writeFile(moduleFile, transpileTs(source).outputText);
  let handler;
  globalThis.__telehealthClient = client;
  globalThis.Deno = { env: { get: (name) => env[name] }, serve: (candidate) => { handler = candidate; } };
  try {
    await import(pathToFileURL(moduleFile).href);
  } finally {
    await unlink(moduleFile).catch(() => {});
  }
  return handler;
}

function post(body) {
  return new Request('https://example.test/function', {
    method: 'POST',
    headers: { 'content-type': 'application/json', Authorization: 'Bearer synthetic' },
    body: JSON.stringify(body),
  });
}

function matches(row, query) {
  return Object.entries(query).every(([key, value]) => row[key] === value);
}

function fixture(caller) {
  const state = {
    memberships: [
      { agency_id: 'agency-1', user_id: 'nurse-1', status: 'active', tenant_role: 'clinician' },
      { agency_id: 'agency-1', user_id: 'nurse-2', status: 'active', tenant_role: 'clinician' },
      { agency_id: 'agency-1', user_id: 'lead-1', status: 'active', tenant_role: 'agency_admin' },
    ],
    patients: [
      { id: 'patient-1', agency_id: 'agency-1', first_name: 'Ada', last_name: 'Lovelace', created_by_user_id: 'someone-else' },
    ],
    seats: [
      { agency_id: 'agency-1', patient_id: 'patient-1', user_id: 'nurse-1', status: 'active' },
    ],
    sessions: [
      { id: 's-1', agency_id: 'agency-1', host_user_id: 'nurse-1', room_name: 'th-a', join_token_hash: 'h1', status: 'scheduled' },
      { id: 's-2', agency_id: 'agency-1', host_user_id: 'nurse-2', room_name: 'th-b', join_token_hash: 'h2', status: 'scheduled' },
      { id: 's-3', agency_id: 'agency-2', host_user_id: 'nurse-1', room_name: 'th-c', join_token_hash: 'h3', status: 'scheduled' },
    ],
  };
  const table = (rows) => ({
    filter: async (query, _sort, limit) => rows.filter((row) => matches(row, query)).slice(0, limit ?? 50),
    create: async (data) => { const row = { id: `s-${rows.length + 1}`, ...data }; rows.push(row); return row; },
    update: async (id, patch) => { const row = rows.find((r) => r.id === id); Object.assign(row, patch); return row; },
  });
  return {
    state,
    client: {
      auth: { me: async () => caller },
      asServiceRole: {
        entities: {
          AgencyMembership: table(state.memberships),
          Patient: table(state.patients),
          PatientCareTeamAssignment: table(state.seats),
          TelehealthSession: table(state.sessions),
        },
      },
    },
  };
}

const nurse = { id: 'nurse-1', email: 'nurse1@agency.test', full_name: 'Nurse One', role: 'user', is_active: true };
const lead = { id: 'lead-1', email: 'lead@agency.test', full_name: 'Lead', role: 'user', is_active: true };

test('the session broker scopes every action to the caller\'s exact agency membership', async () => {
  const { client } = fixture(nurse);
  const handler = await loadBroker(client);

  const mine = await (await handler(post({ action: 'list', agency_id: 'agency-1' }))).json();
  assert.deepEqual(mine.sessions.map((s) => s.id), ['s-1'], 'a clinician lists only their own sessions');
  assert.ok(mine.sessions.every((s) => !('join_token_hash' in s)), 'the stored hash never leaves the server');
  assert.equal(mine.sessions[0].has_join_link, true);

  const all = await (await handler(post({ action: 'list', agency_id: 'agency-1', all: true }))).json();
  assert.deepEqual(all.sessions.map((s) => s.id), ['s-1'], '`all` is not a clinician\'s to ask for');

  assert.equal((await handler(post({ action: 'list', agency_id: 'agency-9' }))).status, 403, 'no membership, no answer');
  assert.equal((await handler(post({ action: 'list' }))).status, 400);
  assert.equal((await handler(post({ action: 'get', agency_id: 'agency-1', session_id: 's-2' }))).status, 404,
    'another clinician\'s session is not found');
  assert.equal((await handler(post({ action: 'get', agency_id: 'agency-1', session_id: 's-3' }))).status, 404,
    'a session in another agency is not found');
});

test('an agency administrator sees the agency, and only that agency', async () => {
  const { client } = fixture(lead);
  const handler = await loadBroker(client);
  const all = await (await handler(post({ action: 'list', agency_id: 'agency-1', all: true }))).json();
  assert.deepEqual(all.sessions.map((s) => s.id).sort(), ['s-1', 's-2']);
  assert.equal((await handler(post({ action: 'get', agency_id: 'agency-1', session_id: 's-3' }))).status, 404);
});

test('create stamps agency and host server-side and refuses a chart the caller cannot open', async () => {
  const { client, state } = fixture(nurse);
  const handler = await loadBroker(client);
  const response = await handler(post({
    action: 'create', agency_id: 'agency-1', patient_id: 'patient-1', patient_name: 'Spoofed Name',
    host_user_id: 'lead-1', room_name: 'chosen-by-browser', visit_type: 'medication_review',
  }));
  assert.equal(response.status, 200);
  const body = await response.json();
  const created = state.sessions.at(-1);
  assert.equal(created.agency_id, 'agency-1');
  assert.equal(created.host_user_id, 'nurse-1', 'the host is the caller, never a body field');
  assert.match(created.room_name, /^th-[0-9a-f]{24}$/, 'the room name is minted, never a body field');
  assert.equal(created.patient_name, 'Ada Lovelace', 'the name comes from the chart, not the body');
  assert.match(created.join_token_hash, /^[0-9a-f]{64}$/);
  assert.match(body.join_token, /^[0-9a-f]{64}$/);
  assert.ok(!('join_token_hash' in body.session));

  state.seats[0].status = 'revoked';
  const refused = await handler(post({ action: 'create', agency_id: 'agency-1', patient_id: 'patient-1', patient_name: 'x' }));
  assert.equal(refused.status, 403, 'a revoked care-team seat closes the chart');
});

test('createTelehealthToken authorizes by stored identity or the session\'s hashed join token', async () => {
  const source = await readFile(entryUrl, 'utf8');
  assert.match(source, /const TELEHEALTH_PROVIDER_MIGRATION_PAUSED = false;/);
  const handler = source.slice(source.indexOf('Deno.serve'));
  assert.match(handler, /isValidGuestToken\(session, join_token\)/);
  assert.match(handler, /session\.host_user_id === user\.id/);
  assert.match(handler, /GUEST_JOIN_WINDOW_MS/);
  assert.match(handler, /row\?\.room_name === scopedRoomName/, 'the room is the session row\'s own, matched exactly');
  assert.doesNotMatch(handler, /full_name\s*===|participants\.includes\(user\.full_name/);
});

test('TelehealthSession is inaccessible through direct SDK operations', async () => {
  const schema = JSON5.parse(await readFile(
    new URL('../entities/TelehealthSession.jsonc', import.meta.url),
    'utf8',
  ));

  assert.equal(schema.name, 'TelehealthSession');
  assert.deepEqual(schema.rls, {
    read: false,
    create: false,
    update: false,
    delete: false,
  });
  assert.ok(schema.properties.agency_id && schema.properties.host_user_id);
});
