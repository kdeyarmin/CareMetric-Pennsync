import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, unlink, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { transpileTs } from '../../tools-transpile-ts.mjs';

const SEARCH_SOURCE = readFileSync(
  new URL('../functions/searchPDFs/entry.ts', import.meta.url),
  'utf8',
);
const RISK_SOURCE = readFileSync(
  new URL('../functions/predictiveRiskAnalysis/entry.ts', import.meta.url),
  'utf8',
);
const INDEX_SOURCE = readFileSync(
  new URL('../functions/indexPDF/entry.ts', import.meta.url),
  'utf8',
);
const INDEX_SCHEMA_SOURCE = readFileSync(
  new URL('../entities/PDFIndex.jsonc', import.meta.url),
  'utf8',
);

async function loadHandler(functionName, client, superAdminEmail = '') {
  let source = await readFile(
    new URL(`../functions/${functionName}/entry.ts`, import.meta.url),
    'utf8',
  );
  source = source.replace(
    /import\s+\{[^}]*\}\s+from\s+'npm:[^']*';?/,
    'const createClientFromRequest = globalThis.__pdfRiskMakeClient;',
  );

  const temporaryModule = join(
    tmpdir(),
    `pdf_risk_auth_${functionName}_${Date.now()}_${Math.random().toString(36).slice(2)}.mjs`,
  );
  await writeFile(temporaryModule, transpileTs(source).outputText);

  let handler;
  globalThis.__pdfRiskMakeClient = () => client;
  globalThis.Deno = {
    serve: (candidate) => { handler = candidate; },
    env: { get: (name) => (name === 'SUPER_ADMIN_EMAIL' ? superAdminEmail : undefined) },
  };
  try {
    await import(pathToFileURL(temporaryModule).href);
  } finally {
    await unlink(temporaryModule).catch(() => {});
  }
  return handler;
}

function makeSearchClient({ user, patientRows = [], pdfRows = [] }) {
  const calls = {
    patientQueries: [],
    pdfQueries: [],
    activityCreates: [],
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
        PDFIndex: {
          filter: async (...args) => {
            calls.pdfQueries.push(args);
            return pdfRows;
          },
        },
        User: {
          list: async () => {
            throw new Error('mutable user/agency membership must not authorize PDF search');
          },
        },
        UserActivity: {
          create: async (row) => {
            calls.activityCreates.push(row);
            return { id: 'activity-1', ...row };
          },
        },
      },
    },
  };
  return { client, calls };
}

function makeRiskClient({
  user,
  patient,
  patientRowsByCall,
  visitRows = [],
  incidentRows = [],
  alertRows = [],
  llmResult = {
    risk_scores: {},
    high_risk_alerts: [],
    overall_risk_level: 'low',
    summary: 'No high risk finding.',
  },
}) {
  let currentPatient = patient ? { ...patient } : null;
  let patientReadIndex = 0;
  const calls = {
    patientQueries: [],
    patientUpdates: [],
    visitQueries: [],
    incidentQueries: [],
    alertQueries: [],
    alertCreates: [],
    llm: [],
  };
  const client = {
    auth: { me: async () => user },
    asServiceRole: {
      entities: {
        Patient: {
          filter: async (...args) => {
            calls.patientQueries.push(args);
            const configuredRows = patientRowsByCall?.[patientReadIndex];
            patientReadIndex += 1;
            return configuredRows ?? (currentPatient ? [currentPatient] : []);
          },
          update: async (id, patch) => {
            calls.patientUpdates.push([id, patch]);
            if (currentPatient?.id === id) currentPatient = { ...currentPatient, ...patch };
            return currentPatient;
          },
        },
        Visit: {
          filter: async (...args) => {
            calls.visitQueries.push(args);
            return visitRows;
          },
        },
        Incident: {
          filter: async (...args) => {
            calls.incidentQueries.push(args);
            return incidentRows;
          },
        },
        PatientAlert: {
          filter: async (...args) => {
            calls.alertQueries.push(args);
            return alertRows;
          },
          create: async (row) => {
            calls.alertCreates.push(row);
            return { id: `alert-${calls.alertCreates.length}`, ...row };
          },
        },
        User: {
          list: async () => {
            throw new Error('mutable user/agency membership must not authorize risk analysis');
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

async function invoke(handler, body, bodyReads = { count: 0 }) {
  const response = await handler({
    json: async () => {
      bodyReads.count += 1;
      return body;
    },
  });
  return { response, json: await response.json(), bodyReads };
}

const patient = {
  id: 'patient-1',
  created_by: 'owner@example.com',
  assigned_nurses: ['assigned@example.com'],
  first_name: 'Private',
  last_name: 'Patient',
};

test('PDF search uses only protected role plus configured email for cross-owner access', () => {
  assert.doesNotMatch(
    SEARCH_SOURCE,
    /user\??\.(?:account_type|agency_name|agency_id)\b/,
    'searchPDFs must not authorize from self-mutable account or agency claims',
  );
  assert.match(SEARCH_SOURCE, /Deno\.env\.get\('SUPER_ADMIN_EMAIL'\)/);
  assert.match(SEARCH_SOURCE, /user\.role === 'admin'/);
});

test('PDF indexing is broker-only, owner-stamped, and does not trust mutable profile claims', () => {
  assert.doesNotMatch(
    INDEX_SOURCE,
    /user\??\.(?:account_type|agency_name|agency_id)\b/,
    'indexPDF must not authorize from self-mutable account or agency claims',
  );
  assert.match(INDEX_SOURCE, /Deno\.env\.get\('SUPER_ADMIN_EMAIL'\)/);
  assert.match(INDEX_SOURCE, /user\.role === 'admin'/);
  assert.match(INDEX_SOURCE, /typeof patient_id !== 'string'/);
  assert.match(INDEX_SOURCE, /String\(row\?\.id \|\| ''\)\.trim\(\) === scopedPatientId/);
  assert.match(INDEX_SOURCE, /String\(row\.pdf_url \|\| ''\)\.trim\(\) !== scopedPdfUrl/);
  assert.match(INDEX_SOURCE, /created_by: callerEmail/);
  assert.match(INDEX_SCHEMA_SOURCE, /"read"\s*:\s*\{\s*"created_by"\s*:\s*"\{\{user\.email\}\}"\s*\}/);
  for (const operation of ['create', 'update', 'delete']) {
    assert.match(INDEX_SCHEMA_SOURCE, new RegExp(`"${operation}"\\s*:\\s*false`));
  }
});

test('missing caller email fails before request parsing or privileged reads', async () => {
  {
    const { client, calls } = makeSearchClient({
      user: { role: 'admin', account_type: 'super_admin', agency_name: 'Victim' },
      patientRows: [patient],
    });
    const handler = await loadHandler('searchPDFs', client, 'owner@example.com');
    const bodyReads = { count: 0 };
    const { response } = await invoke(handler, { query: 'needle' }, bodyReads);
    assert.equal(response.status, 403);
    assert.equal(bodyReads.count, 0);
    assert.deepEqual(calls.patientQueries, []);
    assert.deepEqual(calls.pdfQueries, []);
  }

});

test('operator-shaped patient ids are rejected before service-role reads', async () => {
  const attack = { $in: ['patient-1', 'patient-2'] };

  const search = makeSearchClient({ user: { email: 'owner@example.com', role: 'user' } });
  const searchHandler = await loadHandler('searchPDFs', search.client);
  const searchResult = await invoke(searchHandler, { query: 'needle', patient_id: attack });
  assert.equal(searchResult.response.status, 400);
  assert.deepEqual(search.calls.patientQueries, []);
  assert.deepEqual(search.calls.pdfQueries, []);

});

test('patient-scoped PDF search preserves owner/assigned access and drops mismatched rows', async () => {
  for (const email of ['OWNER@EXAMPLE.COM', 'Assigned@Example.com']) {
    const { client, calls } = makeSearchClient({
      user: { email, role: 'user', full_name: 'Clinician' },
      patientRows: [patient],
      pdfRows: [
        {
          id: 'allowed-index',
          patient_id: 'patient-1',
          created_by: 'different-indexer@example.com',
          extracted_text: 'Needle in authorized patient content',
          page_contents: [],
        },
        {
          id: 'foreign-index',
          patient_id: 'patient-2',
          created_by: 'owner@example.com',
          extracted_text: 'Needle in FOREIGN PDF PHI',
          page_contents: [],
        },
      ],
    });
    const handler = await loadHandler('searchPDFs', client);
    const { response, json } = await invoke(handler, {
      query: 'needle',
      patient_id: 'patient-1',
    });

    assert.equal(response.status, 200, email);
    assert.deepEqual(calls.patientQueries[0], [{ id: 'patient-1' }, '', 1], email);
    assert.deepEqual(calls.pdfQueries[0], [{ patient_id: 'patient-1' }, '-created_date', 100], email);
    assert.deepEqual(json.results.map((row) => row.id), ['allowed-index'], email);
    assert.doesNotMatch(JSON.stringify(json), /FOREIGN PDF PHI/, email);
  }
});

test('unscoped PDF search is immutable-creator-only and re-filters backend results', async () => {
  const { client, calls } = makeSearchClient({
    user: {
      email: 'Caller@Example.com',
      role: 'admin',
      account_type: 'agency_admin',
      agency_name: 'Victim Agency',
    },
    pdfRows: [
      {
        id: 'mine',
        created_by: 'caller@example.com',
        patient_id: 'patient-1',
        extracted_text: 'Needle in owned index',
        page_contents: [],
      },
      {
        id: 'foreign',
        created_by: 'other@example.com',
        patient_id: 'patient-1',
        extracted_text: 'Needle in FOREIGN UNBOUND PHI',
        page_contents: [],
      },
      {
        id: 'ownerless',
        patient_id: 'patient-1',
        extracted_text: 'Needle in OWNERLESS LEGACY PHI',
        page_contents: [],
      },
    ],
  });
  const handler = await loadHandler('searchPDFs', client);
  const { response, json } = await invoke(handler, { query: 'needle' });

  assert.equal(response.status, 200);
  assert.deepEqual(calls.patientQueries, []);
  assert.deepEqual(calls.pdfQueries[0], [{ created_by: 'caller@example.com' }, '-created_date', 100]);
  assert.deepEqual(json.results.map((row) => row.id), ['mine']);
  assert.doesNotMatch(JSON.stringify(json), /FOREIGN UNBOUND PHI|OWNERLESS LEGACY PHI/);
});

test('mutable claims cannot grant cross-patient PDF access', async () => {
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
      agency_id: 'victim-agency',
    },
    {
      email: 'platform-owner@example.com',
      role: 'user',
      account_type: 'super_admin',
      agency_name: 'Victim Agency',
    },
  ];

  for (const user of callers) {
    const search = makeSearchClient({ user, patientRows: [patient] });
    const searchHandler = await loadHandler(
      'searchPDFs',
      search.client,
      'platform-owner@example.com',
    );
    const searchResult = await invoke(searchHandler, {
      query: 'needle',
      patient_id: 'patient-1',
    });
    assert.equal(searchResult.response.status, 403, user.email);
    assert.deepEqual(search.calls.pdfQueries, [], user.email);

  }
});

test('risk analysis is contained before request, service-role, PHI, or AI activity', async () => {
  const { client, calls } = makeRiskClient({
    user: { email: 'Assigned@Example.com', role: 'user' },
    patient,
    visitRows: [
      {
        patient_id: 'patient-1',
        visit_date: '2026-08-01',
        visit_type: 'Owned Visit',
        nurse_notes: 'Authorized clinical note',
      },
      {
        patient_id: 'patient-2',
        visit_date: '2099-01-01',
        visit_type: 'Foreign Visit',
        nurse_notes: 'FOREIGN VISIT SECRET',
      },
    ],
    incidentRows: [
      {
        patient_id: 'patient-1',
        incident_date: '2026-08-02',
        incident_type: 'Owned Incident',
        severity: 'low',
        report: 'Authorized incident report',
      },
      {
        patient_id: 'patient-2',
        incident_date: '2099-01-02',
        incident_type: 'Foreign Incident',
        severity: 'critical',
        report: 'FOREIGN INCIDENT SECRET',
      },
    ],
    // If this foreign alert entered the duplicate check, it would suppress the
    // authorized patient's new fall-risk alert.
    alertRows: [
      {
        id: 'foreign-alert',
        patient_id: 'patient-2',
        status: 'active',
        alert_type: 'fall_risk',
      },
      {
        id: 'inactive-own-alert',
        patient_id: 'patient-1',
        status: 'resolved',
        alert_type: 'fall_risk',
      },
    ],
    llmResult: {
      risk_scores: { fall_risk: 82 },
      high_risk_alerts: [{
        alert_type: 'fall_risk',
        severity: 'high',
        risk_score: 82,
        title: 'Fall risk',
        message: 'Intervene',
        contributing_factors: ['gait'],
        recommended_actions: ['review'],
      }],
      overall_risk_level: 'high',
      summary: 'High fall risk.',
    },
  });
  const handler = await loadHandler('predictiveRiskAnalysis', client);
  const bodyReads = { count: 0 };
  const { response, json } = await invoke(handler, { patient_id: 'patient-1' }, bodyReads);

  assert.equal(response.status, 503);
  assert.deepEqual(json, {
    error: 'Legacy Patient service-role writer is temporarily unavailable',
    code: 'legacy_patient_service_writer_paused',
    reason: 'immutable_tenant_authorization_and_atomic_write_broker_required',
    endpoint: 'predictiveRiskAnalysis',
  });
  assert.equal(bodyReads.count, 0);
  assert.deepEqual(calls.patientQueries, []);
  assert.deepEqual(calls.patientUpdates, []);
  assert.deepEqual(calls.visitQueries, []);
  assert.deepEqual(calls.incidentQueries, []);
  assert.deepEqual(calls.alertQueries, []);
  assert.deepEqual(calls.alertCreates, []);
  assert.deepEqual(calls.llm, []);
  assert.match(RISK_SOURCE, /last-write-wins/);
  assert.match(RISK_SOURCE, /datastore-enforced unique idempotency key/);
});

test('mismatched patient rows fail closed before downstream PHI reads', async () => {
  const wrongPatient = {
    ...patient,
    id: 'patient-2',
    created_by: 'owner@example.com',
  };

  const search = makeSearchClient({
    user: { email: 'owner@example.com', role: 'user' },
    patientRows: [wrongPatient],
  });
  const searchHandler = await loadHandler('searchPDFs', search.client);
  const searchResult = await invoke(searchHandler, {
    query: 'needle',
    patient_id: 'patient-1',
  });
  assert.equal(searchResult.response.status, 404);
  assert.deepEqual(search.calls.pdfQueries, []);

});

test('configured protected superadmin is the sole cross-owner PDF bypass', async () => {
  const superadmin = { email: 'Platform-Owner@Example.com', role: 'admin' };

  const search = makeSearchClient({
    user: superadmin,
    pdfRows: [{
      id: 'foreign-index',
      created_by: 'other@example.com',
      extracted_text: 'Needle in authorized break-glass result',
      page_contents: [],
    }],
  });
  const searchHandler = await loadHandler(
    'searchPDFs',
    search.client,
    'platform-owner@example.com',
  );
  const searchResult = await invoke(searchHandler, { query: 'needle' });
  assert.equal(searchResult.response.status, 200);
  assert.deepEqual(search.calls.pdfQueries[0], [{}, '-created_date', 100]);
  assert.deepEqual(searchResult.json.results.map((row) => row.id), ['foreign-index']);

});
