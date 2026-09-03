import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { transpileTs } from '../../tools-transpile-ts.mjs';

async function loadHandler({
  user,
  patient,
  superAdminEmail = '',
  llmResult = { document_content: 'Generated chart', page_count: 1 },
  visitRows = [],
  incidentRows = [],
} = {}) {
  let source = await readFile(
    new URL('../functions/generatePatientChartPDF/entry.ts', import.meta.url),
    'utf8',
  );
  source = source.replace(
    /import\s+\{[^}]*\}\s+from\s+'npm:[^']*';?/,
    'const createClientFromRequest = globalThis.__patientChartMakeClient;',
  );

  const temporaryModule = join(
    tmpdir(),
    `patient_chart_auth_${Date.now()}_${Math.random().toString(36).slice(2)}.mjs`,
  );
  await writeFile(temporaryModule, transpileTs(source).outputText);

  const calls = {
    bodyReads: 0,
    patientReads: [],
    relatedReads: [],
    llm: [],
    serviceAuditCreates: [],
    callerAuditCreates: [],
    userLists: 0,
  };
  const filterRelated = (entity, rows) => async (...args) => {
    calls.relatedReads.push([entity, ...args]);
    return rows;
  };
  const client = {
    auth: { me: async () => user },
    entities: {
      SecurityLog: {
        create: async (...args) => {
          calls.callerAuditCreates.push(args);
          throw new Error('SecurityLog must use the service role');
        },
      },
    },
    asServiceRole: {
      entities: {
        Patient: {
          filter: async (...args) => {
            calls.patientReads.push(args);
            return patient ? [patient] : [];
          },
        },
        Visit: { filter: filterRelated('Visit', visitRows) },
        Incident: { filter: filterRelated('Incident', incidentRows) },
        User: {
          list: async () => {
            calls.userLists += 1;
            throw new Error('mutable agency membership must not authorize exports');
          },
        },
        SecurityLog: {
          create: async (row) => {
            calls.serviceAuditCreates.push(row);
            return { id: 'security-log-1', ...row };
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

  let handler;
  globalThis.__patientChartMakeClient = () => client;
  globalThis.Deno = {
    serve: (candidate) => { handler = candidate; },
    env: { get: (name) => (name === 'SUPER_ADMIN_EMAIL' ? superAdminEmail : undefined) },
  };
  try {
    await import(pathToFileURL(temporaryModule).href);
  } finally {
    await unlink(temporaryModule).catch(() => {});
  }
  return { handler, calls };
}

async function invoke(
  handler,
  calls,
  body = { patientId: 'patient-1' },
  headers = { 'x-forwarded-for': '203.0.113.8' },
) {
  const response = await handler({
    json: async () => {
      calls.bodyReads += 1;
      return body;
    },
    headers: new Headers(headers),
  });
  return { response, json: await response.json() };
}

const foreignPatient = {
  id: 'patient-1',
  created_by: 'owner@example.com',
  assigned_nurses: ['assigned@example.com'],
  first_name: 'Private',
  last_name: 'Patient',
};

test('chart export fails before body and service reads when protected caller email is absent', async () => {
  const { handler, calls } = await loadHandler({
    user: { role: 'admin', account_type: 'super_admin', agency_name: 'Any Agency' },
    patient: foreignPatient,
  });
  const { response } = await invoke(handler, calls);

  assert.equal(response.status, 403);
  assert.equal(calls.bodyReads, 0);
  assert.deepEqual(calls.patientReads, []);
  assert.deepEqual(calls.llm, []);
  assert.deepEqual(calls.serviceAuditCreates, []);
});

test('non-boolean include flags cannot inject caller data into the privileged audit log', async () => {
  for (const body of [
    { patientId: 'patient-1', includeVisits: { patient_name: 'Injected Name' } },
    { patientId: 'patient-1', includeIncidents: 'contains private data' },
  ]) {
    const { handler, calls } = await loadHandler({
      user: { email: 'owner@example.com', role: 'user' },
      patient: foreignPatient,
    });
    const { response } = await invoke(handler, calls, body);

    assert.equal(response.status, 400);
    assert.deepEqual(calls.patientReads, []);
    assert.deepEqual(calls.llm, []);
    assert.deepEqual(calls.serviceAuditCreates, []);
  }
});

test('operator-shaped patient ids are rejected before privileged reads and audit writes', async () => {
  const { handler, calls } = await loadHandler({
    user: { email: 'owner@example.com', role: 'user' },
    patient: foreignPatient,
  });
  const { response } = await invoke(handler, calls, {
    patientId: { $in: ['patient-1', 'victim-patient'] },
  });

  assert.equal(response.status, 400);
  assert.deepEqual(calls.patientReads, []);
  assert.deepEqual(calls.relatedReads, []);
  assert.deepEqual(calls.llm, []);
  assert.deepEqual(calls.serviceAuditCreates, []);
});

test('mutable admin and agency claims cannot grant cross-patient chart export', async () => {
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
      patient: foreignPatient,
      superAdminEmail: 'platform-owner@example.com',
    });
    const { response } = await invoke(handler, calls);

    assert.equal(response.status, 403);
    assert.equal(calls.patientReads.length, 1);
    assert.equal(calls.userLists, 0);
    assert.deepEqual(calls.relatedReads, []);
    assert.deepEqual(calls.llm, []);
    assert.deepEqual(calls.serviceAuditCreates, []);
  }
});

test('ordinary protected admin has no cross-patient bypass when platform owner is unconfigured', async () => {
  const { handler, calls } = await loadHandler({
    user: { email: 'admin@example.com', role: 'admin' },
    patient: foreignPatient,
    superAdminEmail: '',
  });
  const { response } = await invoke(handler, calls);

  assert.equal(response.status, 403);
  assert.deepEqual(calls.relatedReads, []);
  assert.deepEqual(calls.llm, []);
  assert.deepEqual(calls.serviceAuditCreates, []);
});

test('direct owner and assigned nurse access remain authorized', async () => {
  for (const email of ['OWNER@EXAMPLE.COM', 'Assigned@Example.com']) {
    const { handler, calls } = await loadHandler({
      user: { email, role: 'user', full_name: 'Clinician' },
      patient: foreignPatient,
    });
    const { response, json } = await invoke(handler, calls, {
      patientId: 'patient-1',
      includeVisits: false,
      includeIncidents: false,
    });

    assert.equal(response.status, 200, email);
    assert.equal(json.success, true, email);
    assert.equal(calls.llm.length, 1, email);
    assert.equal(calls.serviceAuditCreates.length, 1, email);
  }
});

test('foreign visit and incident rows never enter the generated chart prompt', async () => {
  const { handler, calls } = await loadHandler({
    user: { email: 'owner@example.com', role: 'user', full_name: 'Owner' },
    patient: foreignPatient,
    visitRows: [
      { patient_id: 'patient-1', visit_date: '2026-01-01', visit_type: 'Owned Visit' },
      { patient_id: 'other-patient', visit_date: '2099-12-31', visit_type: 'Foreign Visit Secret' },
    ],
    incidentRows: [
      { patient_id: 'patient-1', incident_date: '2026-01-02', incident_type: 'Owned Incident', severity: 'low' },
      { patient_id: 'other-patient', incident_date: '2099-12-30', incident_type: 'Foreign Incident Secret', severity: 'critical' },
    ],
  });
  const { response } = await invoke(handler, calls);

  assert.equal(response.status, 200);
  assert.equal(calls.llm.length, 1);
  assert.match(calls.llm[0].prompt, /Owned Visit|Owned Incident/);
  assert.doesNotMatch(
    calls.llm[0].prompt,
    /Foreign Visit Secret|Foreign Incident Secret|2099-12-3/,
  );
});

test('configured protected platform owner can export but audit omits patient names', async () => {
  const { handler, calls } = await loadHandler({
    user: {
      email: 'Platform-Owner@Example.com',
      role: 'admin',
      full_name: 'Platform Owner',
    },
    patient: foreignPatient,
    superAdminEmail: 'platform-owner@example.com',
  });
  const { response, json } = await invoke(
    handler,
    calls,
    { patientId: 'patient-1' },
    { 'x-forwarded-for': '203.0.113.8, Private Patient Name' },
  );

  assert.equal(response.status, 200);
  assert.equal(json.success, true);
  assert.equal(calls.serviceAuditCreates.length, 1);
  assert.deepEqual(calls.callerAuditCreates, []);
  const audit = calls.serviceAuditCreates[0];
  assert.equal(audit.action, 'export_patient_chart_pdf');
  assert.equal(audit.details.patient_id, 'patient-1');
  assert.equal(audit.ip_address, '203.0.113.8');
  assert.equal(Object.hasOwn(audit.details, 'patient_name'), false);
  assert.doesNotMatch(JSON.stringify(audit), /Private|Patient/);
});
