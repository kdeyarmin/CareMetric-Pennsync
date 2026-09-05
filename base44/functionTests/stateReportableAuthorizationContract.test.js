import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, unlink, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { transpileTs } from '../../tools-transpile-ts.mjs';

const SOURCE = readFileSync(
  new URL('../functions/submitStateReportableIncident/entry.ts', import.meta.url),
  'utf8',
);

class PdfStub {
  internal = {
    pageSize: {
      getWidth: () => 216,
      getHeight: () => 279,
    },
  };

  setFont() {}
  setFontSize() {}
  setTextColor() {}
  text() {}
  setDrawColor() {}
  setLineWidth() {}
  line() {}
  addPage() {}
  splitTextToSize() { return []; }
  output() { return new ArrayBuffer(0); }
}

async function loadHandler({
  user,
  patientRows = [],
  userRows = [],
  superAdminEmail = '',
  incidentId = 'incident-1',
} = {}) {
  let source = await readFile(
    new URL('../functions/submitStateReportableIncident/entry.ts', import.meta.url),
    'utf8',
  );
  source = source.replace(
    /import\s+\{\s*createClientFromRequest\s*\}\s+from\s+'npm:[^']+';/,
    'const createClientFromRequest = globalThis.__stateReportMakeClient;',
  );
  source = source.replace(
    /import\s+\{\s*jsPDF\s*\}\s+from\s+'npm:[^']+';/,
    'const jsPDF = globalThis.__stateReportPdf;',
  );

  const temporaryModule = join(
    tmpdir(),
    `state_report_auth_${Date.now()}_${Math.random().toString(36).slice(2)}.mjs`,
  );
  await writeFile(temporaryModule, transpileTs(source).outputText);

  const calls = {
    bodyReads: 0,
    patientQueries: [],
    userLists: [],
    incidentCreates: [],
    incidentUpdates: [],
    documentBrokerInvokes: [],
    notificationCreates: [],
    emails: [],
    llm: [],
  };
  const client = {
    auth: { me: async () => user },
    asServiceRole: {
      entities: {
        Patient: {
          filter: async (...args) => {
            calls.patientQueries.push(args);
            return patientRows;
          },
        },
        User: {
          list: async (...args) => {
            calls.userLists.push(args);
            return userRows;
          },
        },
        Incident: {
          create: async (row) => {
            calls.incidentCreates.push(row);
            return { ...row, id: incidentId };
          },
          update: async (...args) => {
            calls.incidentUpdates.push(args);
            return {};
          },
        },
        Notification: {
          create: async (row) => {
            calls.notificationCreates.push(row);
            return { ...row, id: `notification-${calls.notificationCreates.length}` };
          },
        },
      },
      integrations: {
        Core: {
          SendEmail: async (args) => {
            calls.emails.push(args);
            return { success: true };
          },
          InvokeLLM: async (args) => {
            calls.llm.push(args);
            throw new Error('submitStateReportableIncident must not invoke an LLM');
          },
        },
      },
    },
    functions: {
      invoke: async (name, payload) => {
        calls.documentBrokerInvokes.push({ name, payload });
        return { data: { success: true, document: { id: 'document-1' } } };
      },
    },
  };

  let handler;
  globalThis.__stateReportMakeClient = () => client;
  globalThis.__stateReportPdf = PdfStub;
  globalThis.Deno = {
    serve: (candidate) => { handler = candidate; },
    env: { get: (name) => (name === 'SUPER_ADMIN_EMAIL' ? superAdminEmail : undefined) },
  };
  try {
    await import(pathToFileURL(temporaryModule).href);
  } finally {
    await unlink(temporaryModule).catch(() => {});
  }
  assert.equal(typeof handler, 'function');
  return { handler, calls };
}

const validPayload = (extra = {}) => ({
  patient_id: 'patient-1',
  patient_name: 'Caller Supplied Name',
  event_type: 'Patient Neglect',
  event_type_id: 'NE',
  event_date: '2026-09-02',
  factual_description: 'Observed condition and provided immediate care.',
  followup_action: 'Notified the clinical supervisor.',
  ...extra,
});

async function invoke(handler, calls, body = validPayload()) {
  const response = await handler({
    json: async () => {
      calls.bodyReads += 1;
      return body;
    },
  });
  return { response, json: await response.json() };
}

function writeCount(calls) {
  return calls.incidentCreates.length
    + calls.incidentUpdates.length
    + calls.documentBrokerInvokes.length
    + calls.notificationCreates.length
    + calls.emails.length
    + calls.llm.length;
}

const patient = {
  id: 'patient-1',
  agency_id: 'agency-a',
  created_by: 'owner@example.com',
  assigned_nurses: ['assigned@example.com', 'direct-admin@example.com'],
  first_name: 'Private',
  last_name: 'Patient',
};

test('state-report authorization uses the configured protected identity, not mutable claims', () => {
  assert.match(SOURCE, /<<<BEGIN SHARED HELPER: protectedUserAuthz/);
  assert.match(SOURCE, /Deno\.env\.get\('SUPER_ADMIN_EMAIL'\)/);
  assert.match(SOURCE, /user\.role === 'admin'/);
  assert.doesNotMatch(SOURCE, /user\.(?:account_type|agency_name|agency_id)\b/);
});

test('missing caller email fails before parsing input or touching service resources', async () => {
  const { handler, calls } = await loadHandler({
    user: { role: 'admin', account_type: 'super_admin', agency_name: 'Victim Agency' },
    patientRows: [patient],
    superAdminEmail: 'platform-owner@example.com',
  });
  const { response } = await invoke(handler, calls);

  assert.equal(response.status, 403);
  assert.equal(calls.bodyReads, 0);
  assert.deepEqual(calls.patientQueries, []);
  assert.deepEqual(calls.userLists, []);
  assert.equal(writeCount(calls), 0);
});

test('operator-shaped identifiers are rejected before privileged reads and writes', async () => {
  for (const body of [
    validPayload({ patient_id: { $in: ['patient-1', 'foreign-patient'] } }),
    validPayload({ event_type_id: { $ne: null } }),
  ]) {
    const { handler, calls } = await loadHandler({
      user: { email: 'owner@example.com', role: 'user' },
      patientRows: [patient],
    });
    const { response } = await invoke(handler, calls, body);

    assert.equal(response.status, 400);
    assert.deepEqual(calls.patientQueries, []);
    assert.deepEqual(calls.userLists, []);
    assert.equal(writeCount(calls), 0);
  }
});

test('a mismatched Patient row cannot authorize any downstream side effect', async () => {
  const { handler, calls } = await loadHandler({
    user: { email: 'owner@example.com', role: 'user' },
    patientRows: [{ ...patient, id: 'foreign-patient' }],
  });
  const { response } = await invoke(handler, calls);

  assert.equal(response.status, 404);
  assert.deepEqual(calls.patientQueries[0], [{ id: 'patient-1' }, '', 1]);
  assert.deepEqual(calls.userLists, []);
  assert.equal(writeCount(calls), 0);
});

test('mutable admin and agency claims cannot authorize a foreign-patient submission', async () => {
  const callers = [
    {
      email: 'attacker@example.com',
      role: 'user',
      account_type: 'super_admin',
      agency_name: 'Victim Agency',
    },
    {
      email: 'attacker@example.com',
      role: 'admin',
      account_type: 'agency_admin',
      agency_name: 'Victim Agency',
    },
    {
      email: 'platform-owner@example.com',
      role: 'user',
      account_type: 'super_admin',
      agency_name: 'Victim Agency',
    },
  ];

  for (const user of callers) {
    const { handler, calls } = await loadHandler({
      user,
      patientRows: [patient],
      superAdminEmail: 'platform-owner@example.com',
    });
    const { response } = await invoke(handler, calls);

    assert.equal(response.status, 403, `${user.email}/${user.role}`);
    assert.equal(calls.patientQueries.length, 1);
    assert.deepEqual(calls.userLists, []);
    assert.equal(writeCount(calls), 0);
  }
});

test('an explicitly assigned clinician can submit and unrelated user rows are not notified', async () => {
  const { handler, calls } = await loadHandler({
    user: {
      email: 'Assigned@Example.com',
      role: 'user',
      full_name: 'Assigned Clinician',
    },
    patientRows: [{ id: 'wrong-patient' }, patient],
    superAdminEmail: 'platform-owner@example.com',
    userRows: [
      { email: 'Direct-Admin@Example.com', role: 'admin' },
      {
        email: 'foreign-admin@example.com',
        role: 'admin',
        account_type: 'agency_admin',
        agency_name: 'Victim Agency',
      },
      {
        email: 'forged-super@example.com',
        role: 'user',
        account_type: 'super_admin',
      },
      { email: 'Platform-Owner@Example.com', role: 'admin' },
      { email: 'direct-admin@example.com', role: 'admin' },
    ],
  });
  const { response, json } = await invoke(
    handler,
    calls,
    validPayload({ patient_id: ' patient-1 ', patient_name: 'Spoofed Patient' }),
  );

  assert.equal(response.status, 200);
  assert.equal(json.success, true);
  assert.equal(json.admin_count, 2);
  assert.equal(calls.incidentCreates.length, 1);
  assert.equal(calls.incidentCreates[0].patient_id, 'patient-1');
  assert.equal(calls.incidentCreates[0].patient_name, 'Private Patient');
  assert.equal(calls.incidentCreates[0].created_by, 'assigned@example.com');
  assert.equal(calls.documentBrokerInvokes.length, 1);
  assert.equal(calls.documentBrokerInvokes[0].name, 'createAuthorizedDocument');
  assert.equal(calls.documentBrokerInvokes[0].payload.agency_id, 'agency-a');
  assert.equal(calls.documentBrokerInvokes[0].payload.patient_id, 'patient-1');
  assert.equal(calls.documentBrokerInvokes[0].payload.purpose, 'patient_document');
  assert.equal(calls.documentBrokerInvokes[0].payload.client_request_id, 'incident-1');
  assert.ok(calls.documentBrokerInvokes[0].payload.file instanceof File);
  assert.deepEqual(
    calls.notificationCreates.map((row) => row.user_email).sort(),
    ['direct-admin@example.com', 'platform-owner@example.com'],
  );
  assert.deepEqual(
    calls.emails.map((row) => row.to).sort(),
    ['direct-admin@example.com', 'platform-owner@example.com'],
  );
  assert.doesNotMatch(
    JSON.stringify([...calls.notificationCreates, ...calls.emails]),
    /foreign-admin|forged-super|Spoofed Patient/,
  );
  assert.deepEqual(calls.llm, []);
});

test('the configured protected admin can submit for a foreign patient', async () => {
  const { handler, calls } = await loadHandler({
    user: {
      email: 'Platform-Owner@Example.com',
      role: 'admin',
      full_name: 'Platform Owner',
    },
    patientRows: [patient],
    userRows: [{ email: 'platform-owner@example.com', role: 'admin' }],
    superAdminEmail: 'platform-owner@example.com',
  });
  const { response, json } = await invoke(handler, calls);

  assert.equal(response.status, 200);
  assert.equal(json.success, true);
  assert.equal(calls.incidentCreates.length, 1);
  assert.deepEqual(calls.emails.map((row) => row.to), ['platform-owner@example.com']);
});

test('a non-scalar incident id stops related file, notification, and email writes', async () => {
  const { handler, calls } = await loadHandler({
    user: { email: 'owner@example.com', role: 'user' },
    patientRows: [patient],
    userRows: [{ email: 'direct-admin@example.com', role: 'admin' }],
    incidentId: { $ne: null },
  });
  const { response } = await invoke(handler, calls);

  assert.equal(response.status, 500);
  assert.equal(calls.incidentCreates.length, 1);
  assert.deepEqual(calls.incidentUpdates, []);
  assert.deepEqual(calls.userLists, []);
  assert.deepEqual(calls.documentBrokerInvokes, []);
  assert.deepEqual(calls.notificationCreates, []);
  assert.deepEqual(calls.emails, []);
});
