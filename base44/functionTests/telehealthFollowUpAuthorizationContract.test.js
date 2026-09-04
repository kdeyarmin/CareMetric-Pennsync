import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { transpileTs } from '../../tools-transpile-ts.mjs';

const originalFetch = globalThis.fetch;

after(() => {
  globalThis.fetch = originalFetch;
  delete globalThis.__clinicalBoundaryMakeClient;
  delete globalThis.Deno;
});

async function loadHandler(functionName, { client, superAdminEmail = '', fetchImpl } = {}) {
  let source = await readFile(
    new URL(`../functions/${functionName}/entry.ts`, import.meta.url),
    'utf8',
  );
  // A dedicated containment contract proves the shipped literal 503 gate.
  // Exercise the dormant authorization implementation only in this temporary
  // module so it stays hardened for a future reviewed migration.
  if (functionName === 'createTelehealthToken') {
    source = source.replace(
      'const TELEHEALTH_PROVIDER_MIGRATION_PAUSED = true;',
      'const TELEHEALTH_PROVIDER_MIGRATION_PAUSED = false;',
    );
  }
  source = source.replace(
    /import\s+\{[^}]*\}\s+from\s+'npm:[^']*';?/,
    'const createClientFromRequest = globalThis.__clinicalBoundaryMakeClient;',
  );

  const temporaryModule = join(
    tmpdir(),
    `clinical_boundary_${functionName}_${Date.now()}_${Math.random().toString(36).slice(2)}.mjs`,
  );
  await writeFile(temporaryModule, transpileTs(source).outputText);

  let handler;
  globalThis.__clinicalBoundaryMakeClient = () => client;
  globalThis.Deno = {
    serve: (candidate) => { handler = candidate; },
    env: { get: (name) => (name === 'SUPER_ADMIN_EMAIL' ? superAdminEmail : undefined) },
  };
  globalThis.fetch = fetchImpl || (async (url) => {
    throw new Error(`Unexpected external fetch: ${url}`);
  });
  try {
    await import(pathToFileURL(temporaryModule).href);
  } finally {
    await unlink(temporaryModule).catch(() => {});
  }
  return handler;
}

function telehealthClient({ user, sessionRows }) {
  const calls = { sessionFilters: [], secretFilters: [] };
  return {
    calls,
    client: {
      auth: { me: async () => user },
      asServiceRole: {
        entities: {
          TelehealthSession: {
            filter: async (...args) => {
              calls.sessionFilters.push(args);
              return sessionRows;
            },
          },
          IntegrationSecret: {
            filter: async (...args) => {
              calls.secretFilters.push(args);
              return [{ provider: 'telnyx', api_key: 'KEY-test', is_active: true }];
            },
          },
          User: {
            filter: async () => {
              throw new Error('mutable agency membership must not authorize telehealth access');
            },
          },
        },
      },
    },
  };
}

function successfulTelnyxFetch(roomName, calls) {
  return async (url) => {
    const value = String(url);
    calls.push(value);
    if (value.includes('/v2/rooms?')) {
      return Response.json({ data: [{ id: 'telnyx-room-1', unique_name: roomName }] });
    }
    if (value.includes('/actions/generate_join_client_token')) {
      return Response.json({ data: { token: 'JOIN-token', refresh_token: 'REFRESH-token' } });
    }
    throw new Error(`Unexpected Telnyx request: ${value}`);
  };
}

async function invoke(handler, body, path = 'function') {
  const response = await handler(new Request(`https://app.test/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }));
  return { response, json: await response.json() };
}

test('telehealth rejects operator-shaped room names and mismatched service-role rows', async () => {
  {
    const { client, calls } = telehealthClient({
      user: { email: 'host@example.com', role: 'user' },
      sessionRows: [],
    });
    const handler = await loadHandler('createTelehealthToken', { client });
    const { response } = await invoke(handler, { room_name: { $ne: null } }, 'createTelehealthToken');

    assert.equal(response.status, 400);
    assert.deepEqual(calls.sessionFilters, []);
    assert.deepEqual(calls.secretFilters, []);
  }

  {
    const { client, calls } = telehealthClient({
      user: { role: 'admin', account_type: 'super_admin' },
      sessionRows: [{ room_name: 'requested-room', host_email: 'host@example.com', status: 'active' }],
    });
    const handler = await loadHandler('createTelehealthToken', { client });
    const { response } = await invoke(handler, { room_name: 'requested-room' }, 'createTelehealthToken');

    assert.equal(response.status, 403);
    assert.deepEqual(calls.sessionFilters, []);
    assert.deepEqual(calls.secretFilters, []);
  }

  {
    const { client, calls } = telehealthClient({
      user: { email: 'host@example.com', role: 'user' },
      sessionRows: [{ room_name: 'another-room', host_email: 'host@example.com', status: 'active' }],
    });
    const handler = await loadHandler('createTelehealthToken', { client });
    const { response } = await invoke(handler, { room_name: 'requested-room' }, 'createTelehealthToken');

    assert.equal(response.status, 404);
    assert.deepEqual(calls.sessionFilters[0], [{ room_name: 'requested-room' }, '-created_date', 1]);
    assert.deepEqual(calls.secretFilters, []);
  }
});

test('telehealth trusts only exact staff identity or the configured protected platform owner', async () => {
  const session = {
    room_name: 'room-1',
    host_email: 'host@example.com',
    participant_list: ['participant@example.com', 'Patient Display Name'],
    status: 'active',
  };
  const deniedCallers = [
    { email: 'attacker@example.com', role: 'user', account_type: 'super_admin', agency_name: 'Victim' },
    { email: 'attacker@example.com', role: 'admin', account_type: 'super_admin', agency_name: '' },
    { email: 'platform-owner@example.com', role: 'user', account_type: 'super_admin' },
  ];

  for (const user of deniedCallers) {
    const { client, calls } = telehealthClient({ user, sessionRows: [session] });
    const handler = await loadHandler('createTelehealthToken', {
      client,
      superAdminEmail: 'platform-owner@example.com',
    });
    const { response } = await invoke(handler, { room_name: 'room-1' }, 'createTelehealthToken');

    assert.equal(response.status, 403, user.email);
    assert.deepEqual(calls.secretFilters, [], user.email);
  }

  for (const user of [
    { email: 'PARTICIPANT@EXAMPLE.COM', role: 'user' },
    { email: 'Platform-Owner@Example.com', role: 'admin' },
  ]) {
    const { client } = telehealthClient({ user, sessionRows: [session] });
    const fetchCalls = [];
    const handler = await loadHandler('createTelehealthToken', {
      client,
      superAdminEmail: 'platform-owner@example.com',
      fetchImpl: successfulTelnyxFetch('room-1', fetchCalls),
    });
    const { response, json } = await invoke(handler, { room_name: 'room-1' }, 'createTelehealthToken');

    assert.equal(response.status, 200, user.email);
    assert.equal(json.token, 'JOIN-token', user.email);
    assert.equal(json.room_name, 'room-1', user.email);
    assert.equal(fetchCalls.length, 2, user.email);
  }
});

test('telehealth refuses completed sessions and sessions carrying an end marker', async () => {
  for (const session of [
    { room_name: 'closed-room', host_email: 'host@example.com', status: 'completed' },
    {
      room_name: 'closed-room',
      host_email: 'host@example.com',
      status: 'active',
      ended_at: '2026-09-02T12:00:00.000Z',
    },
  ]) {
    const { client, calls } = telehealthClient({
      user: { email: 'host@example.com', role: 'user', is_active: true },
      sessionRows: [session],
    });
    const handler = await loadHandler('createTelehealthToken', { client });
    const { response } = await invoke(handler, { room_name: 'closed-room' }, 'createTelehealthToken');

    assert.equal(response.status, 403);
    assert.deepEqual(calls.secretFilters, []);
  }
});

function followUpClient({
  user,
  patientRows = [],
  visitFilter,
  existingTaskRows = [],
  llmResult = { tasks: [] },
} = {}) {
  const calls = {
    patientFilters: [],
    visitFilters: [],
    visitUpdates: [],
    taskFilters: [],
    taskCreates: [],
    llm: [],
  };
  const client = {
    auth: { me: async () => user },
    asServiceRole: {
      entities: {
        Patient: {
          filter: async (...args) => {
            calls.patientFilters.push(args);
            return patientRows;
          },
        },
        Visit: {
          filter: async (...args) => {
            calls.visitFilters.push(args);
            return visitFilter ? visitFilter(args, calls) : [];
          },
          update: async (...args) => {
            calls.visitUpdates.push(args);
            return { id: args[0], ...args[1] };
          },
        },
        Task: {
          filter: async (...args) => {
            calls.taskFilters.push(args);
            return existingTaskRows;
          },
          create: async (row) => {
            calls.taskCreates.push(row);
            return { id: `task-${calls.taskCreates.length}`, ...row };
          },
        },
        User: {
          list: async () => {
            throw new Error('mutable agency membership must not authorize follow-up tasks');
          },
        },
      },
    },
    integrations: {
      Core: {
        InvokeLLM: async (args) => {
          calls.llm.push(args);
          return llmResult;
        },
      },
    },
  };
  return { client, calls };
}

const foreignPatient = {
  id: 'patient-1',
  created_by: 'owner@example.com',
  assigned_nurses: ['assigned@example.com'],
  first_name: 'Private',
  last_name: 'Patient',
};

const followUpBody = { noteText: 'Call the physician tomorrow.', patientId: 'patient-1' };

test('follow-up generation requires an exact patient id and ignores mismatched service rows', async () => {
  {
    const { client, calls } = followUpClient({
      user: { email: 'owner@example.com', role: 'user' },
      patientRows: [foreignPatient],
    });
    const handler = await loadHandler('generateFollowUpTasks', { client });
    const { response } = await invoke(handler, {
      noteText: 'Call the physician.',
      patientId: { $in: ['patient-1', 'patient-2'] },
    }, 'generateFollowUpTasks');

    assert.equal(response.status, 400);
    assert.deepEqual(calls.patientFilters, []);
    assert.deepEqual(calls.llm, []);
  }

  {
    const { client, calls } = followUpClient({
      user: { email: 'owner@example.com', role: 'user' },
      patientRows: [{ ...foreignPatient, id: 'different-patient' }],
    });
    const handler = await loadHandler('generateFollowUpTasks', { client });
    const { response } = await invoke(handler, followUpBody, 'generateFollowUpTasks');

    assert.equal(response.status, 404);
    assert.deepEqual(calls.patientFilters[0], [{ id: 'patient-1' }, '', 1]);
    assert.deepEqual(calls.llm, []);
  }
});

test('follow-up generation rejects mutable privilege claims and preserves direct access paths', async () => {
  const deniedCallers = [
    { email: 'attacker@example.com', role: 'user', account_type: 'super_admin', agency_name: 'Victim' },
    { email: 'attacker@example.com', role: 'admin', account_type: 'agency_admin', agency_name: 'Victim' },
    { email: 'platform-owner@example.com', role: 'user', account_type: 'super_admin' },
  ];

  for (const user of deniedCallers) {
    const { client, calls } = followUpClient({ user, patientRows: [foreignPatient] });
    const handler = await loadHandler('generateFollowUpTasks', {
      client,
      superAdminEmail: 'platform-owner@example.com',
    });
    const { response } = await invoke(handler, followUpBody, 'generateFollowUpTasks');

    assert.equal(response.status, 403, user.email);
    assert.deepEqual(calls.llm, [], user.email);
    assert.deepEqual(calls.taskCreates, [], user.email);
  }

  for (const user of [
    { email: 'OWNER@EXAMPLE.COM', role: 'user' },
    { email: 'Assigned@Example.com', role: 'user' },
    { email: 'Platform-Owner@Example.com', role: 'admin' },
  ]) {
    const { client, calls } = followUpClient({
      user,
      patientRows: [foreignPatient],
      llmResult: {
        tasks: [{ title: 'Call physician', type: 'call', due_timeframe: '24_hours' }],
      },
    });
    const handler = await loadHandler('generateFollowUpTasks', {
      client,
      superAdminEmail: 'platform-owner@example.com',
    });
    const { response, json } = await invoke(handler, followUpBody, 'generateFollowUpTasks');

    assert.equal(response.status, 200, user.email);
    assert.equal(json.tasks_created, 1, user.email);
    assert.equal(calls.taskCreates[0].patient_id, 'patient-1', user.email);
    assert.equal(calls.taskCreates[0].assigned_to, user.email.toLowerCase(), user.email);
  }
});

test('follow-up generation rechecks visit relationships and filters false duplicate rows', async () => {
  {
    const { client, calls } = followUpClient({
      user: { email: 'owner@example.com', role: 'user' },
      patientRows: [foreignPatient],
      visitFilter: () => [{ id: 'visit-1', patient_id: 'different-patient' }],
    });
    const handler = await loadHandler('generateFollowUpTasks', { client });
    const { response } = await invoke(handler, {
      ...followUpBody,
      visitId: 'visit-1',
    }, 'generateFollowUpTasks');

    assert.equal(response.status, 404);
    assert.deepEqual(calls.visitUpdates, []);
    assert.deepEqual(calls.llm, []);
  }

  {
    let visitRead = 0;
    const { client, calls } = followUpClient({
      user: { email: 'owner@example.com', role: 'user' },
      patientRows: [foreignPatient],
      visitFilter: (_args, currentCalls) => {
        visitRead += 1;
        if (visitRead === 1) return [{ id: 'visit-1', patient_id: 'patient-1' }];
        const claim = currentCalls.visitUpdates[0][1].followup_tasks_claimed_by;
        return [{
          id: 'visit-1',
          patient_id: 'patient-1',
          followup_tasks_claimed_by: claim,
        }];
      },
      // Simulate a backend filter regression: this unrelated row must not make
      // the requested visit look already processed.
      existingTaskRows: [{ related_visit_id: 'another-visit', source: 'ai_generated' }],
      llmResult: {
        tasks: [{ title: 'Schedule follow-up', type: 'schedule', due_timeframe: 'this_week' }],
      },
    });
    const handler = await loadHandler('generateFollowUpTasks', { client });
    const { response, json } = await invoke(handler, {
      ...followUpBody,
      visitId: 'visit-1',
    }, 'generateFollowUpTasks');

    assert.equal(response.status, 200);
    assert.equal(json.tasks_created, 1);
    assert.deepEqual(calls.visitUpdates[0].slice(0, 1), ['visit-1']);
    assert.deepEqual(calls.taskFilters[0], [
      { related_visit_id: 'visit-1', source: 'ai_generated' },
      undefined,
      1,
    ]);
    assert.equal(calls.taskCreates[0].patient_id, 'patient-1');
    assert.equal(calls.taskCreates[0].related_visit_id, 'visit-1');
  }
});
