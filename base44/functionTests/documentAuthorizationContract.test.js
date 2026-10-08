import assert from 'node:assert/strict';
import { readFile, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { transpileTs } from '../../tools-transpile-ts.mjs';

const NOW = '2026-09-03T12:00:00.000Z';

const membership = (overrides = {}) => ({
  id: 'membership-a',
  membership_key: 'agency-a:user-a',
  agency_id: 'agency-a',
  user_id: 'user-a',
  user_email_normalized: 'member@example.com',
  tenant_role: 'clinician',
  status: 'active',
  version: 1,
  created_by_user_id: 'owner-id',
  last_transition_by_user_id: 'owner-id',
  last_transition_by_email_normalized: 'owner@example.com',
  last_transition_at: NOW,
  last_transition_reason: 'Authorized for test',
  activated_at: NOW,
  ...overrides,
});

const patient = (overrides = {}) => ({
  id: 'patient-a',
  agency_id: 'agency-a',
  created_by_user_id: 'creator-id',
  created_by_user_email_normalized: 'creator@example.com',
  created_by: 'creator@example.com',
  client_request_id: 'create-patient-a',
  patient_creation_key: 'agency-a:creator-id:create-patient-a',
  status: 'active',
  assigned_nurses: ['member@example.com', 'recipient@example.com'],
  is_sample: false,
  is_archived: false,
  first_name: 'Pat',
  last_name: 'Example',
  date_of_birth: '1950-01-01',
  medical_record_number: 'MRN-1',
  primary_diagnosis: 'Test diagnosis',
  updated_date: NOW,
  ...overrides,
});

const assignment = (overrides = {}) => ({
  id: 'assignment-a',
  assignment_key: 'agency-a:patient-a:user-a',
  agency_id: 'agency-a',
  patient_id: 'patient-a',
  user_id: 'user-a',
  user_email_normalized: 'member@example.com',
  assignee_membership_id: 'membership-a',
  assignee_membership_version_at_enablement: 1,
  status: 'active',
  source: 'manual',
  created_by_user_id: 'owner-id',
  created_by_user_email_normalized: 'owner@example.com',
  activated_at: NOW,
  suspended_at: null,
  revoked_at: null,
  revocation_reason: null,
  last_transition_by_user_id: 'owner-id',
  last_transition_by_email_normalized: 'owner@example.com',
  last_transition_at: NOW,
  last_transition_reason: 'Authorized for test',
  last_transition_action: 'grant',
  last_transition_request_id: 'grant-a',
  last_transition_request_key: 'agency-a:patient-a:user-a:grant-a',
  version: 1,
  ...overrides,
});

const document = (overrides = {}) => ({
  id: 'document-a',
  patient_id: 'patient-a',
  created_by: 'member@example.com',
  uploaded_by: 'member@example.com',
  title: 'Clinical document',
  category: 'progress_notes',
  file_url: 'https://files.base44.app/document-a.pdf',
  updated_date: NOW,
  ...overrides,
});

function rowsMatching(rows, query) {
  return rows.filter((row) =>
    Object.entries(query).every(([key, value]) => row?.[key] === value));
}

function makeDocumentClient({
  user = {
    id: 'user-a',
    email: 'Member@Example.com',
    role: 'user',
    is_active: true,
  },
  memberships = [membership()],
  agencies = [{ id: 'agency-a', agency_name: 'Agency A', status: 'active' }],
  patients = [patient()],
  assignments = [assignment()],
  documents = [document()],
  agencySettings = [],
} = {}) {
  const state = {
    memberships: memberships.map((row) => ({ ...row })),
    agencies: agencies.map((row) => ({ ...row })),
    patients: patients.map((row) => ({ ...row })),
    assignments: assignments.map((row) => ({ ...row })),
    documents: documents.map((row) => ({ ...row })),
    agencySettings: agencySettings.map((row) => ({ ...row })),
    calls: {
      memberships: [],
      agencies: [],
      patients: [],
      assignments: [],
      documents: [],
      settings: [],
      updates: [],
      llm: [],
    },
  };

  const filterEntity = (key, callKey) => ({
    filter: async (...args) => {
      state.calls[callKey].push(args);
      return rowsMatching(state[key], args[0]);
    },
  });
  const entities = {
    AgencyMembership: filterEntity('memberships', 'memberships'),
    Agency: filterEntity('agencies', 'agencies'),
    Patient: filterEntity('patients', 'patients'),
    PatientCareTeamAssignment: filterEntity('assignments', 'assignments'),
    Document: {
      ...filterEntity('documents', 'documents'),
      update: async (...args) => {
        state.calls.updates.push(args);
        return {};
      },
    },
    AgencySettings: {
      ...filterEntity('agencySettings', 'settings'),
      list: async () => state.agencySettings,
    },
  };
  const client = {
    auth: { me: async () => user },
    asServiceRole: { entities },
    integrations: {
      Core: {
        InvokeLLM: async (args) => {
          state.calls.llm.push(args);
          return {
            summary: 'Summary',
            extracted_data: {},
            suggested_category: 'progress_note',
            critical_flags: [],
            confidence_score: 90,
          };
        },
      },
    },
  };
  return { client, state };
}

async function loadHandler(functionName, client, {
  superAdminEmail = '',
} = {}) {
  let source = await readFile(
    new URL(`../functions/${functionName}/entry.ts`, import.meta.url),
    'utf8',
  );
  source = source.replace(
    /import\s+\{\s*createClientFromRequest\s*\}\s+from\s+'npm:[^']+';/,
    'const createClientFromRequest = () => globalThis.__documentAuthClient;',
  );
  const temporaryModule = join(
    tmpdir(),
    `document_auth_${functionName}_${Date.now()}_${Math.random().toString(36).slice(2)}.mjs`,
  );
  await writeFile(temporaryModule, transpileTs(source).outputText);

  let handler;
  globalThis.__documentAuthClient = client;
  globalThis.Deno = {
    serve: (candidate) => { handler = candidate; },
    env: {
      get: (name) => {
        if (name === 'SUPER_ADMIN_EMAIL') return superAdminEmail;
        return undefined;
      },
    },
  };
  try {
    await import(pathToFileURL(temporaryModule).href);
  } finally {
    await unlink(temporaryModule).catch(() => {});
  }
  assert.equal(typeof handler, 'function');
  return handler;
}

const request = (body) => {
  const raw = JSON.stringify(body);
  return {
    method: 'POST',
    headers: new Headers(),
    text: async () => raw,
  };
};

// 2026-10-08 owner decision: document AI analysis is back on. Access is
// decided by the reviewed Document read broker, asked as the caller; nothing
// here re-derives it from Patient.assigned_nurses or Document fields.
function brokerFor(fixture, {
  refuseWith = null,
  documentId = 'document-a',
  agencyId = 'agency-a',
  downloadUrl = 'https://storage.example.test/signed/document-a?sig=1',
} = {}) {
  const calls = [];
  fixture.client.functions = {
    invoke: async (name, payload) => {
      calls.push({ name, payload });
      if (refuseWith) {
        const error = new Error('refused');
        error.response = { status: refuseWith };
        throw error;
      }
      return {
        data: {
          success: true,
          purpose: payload.purpose,
          document: { id: documentId, category: 'other' },
          ...(payload.purpose === 'download'
            ? { delivery: { download_url: downloadUrl, expires_in_seconds: 60 } }
            : {}),
          scope: { agency_id: agencyId, membership_id: 'membership-a', membership_version: 1, tenant_role: 'clinician' },
        },
      };
    },
  };
  return calls;
}

test('analyzeDocument asks the Document read broker before reading, analyzing or storing', async () => {
  const source = await readFile(new URL('../functions/analyzeDocument/entry.ts', import.meta.url), 'utf8');
  const body = source.slice(source.lastIndexOf('// <<<END SHARED HELPER'));
  assert.doesNotMatch(source, /document_analysis_private_write_broker_required/);
  assert.match(body, /createClientFromRequest\(userScopedClientRequest\(req, PENNSYNC_PRODUCTION_APP_ID\)\)/);
  assert.doesNotMatch(body, /assigned_nurses|agency_name|created_by_user_email_normalized/);

  const fixture = makeDocumentClient();
  const brokerCalls = brokerFor(fixture);
  const handler = await loadHandler('analyzeDocument', fixture.client);
  const response = await handler(request({ agency_id: 'agency-a', document_id: 'document-a' }));

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  const payload = await response.json();
  assert.equal(payload.success, true);
  assert.equal(payload.analysis.summary, 'Summary');
  assert.equal(payload.analysis.suggested_category, 'progress_note');
  assert.deepEqual(brokerCalls.map((call) => call.payload.purpose), ['download', 'metadata']);
  assert.ok(brokerCalls.every((call) => call.name === 'getAuthorizedDocument'
    && call.payload.agency_id === 'agency-a' && call.payload.document_id === 'document-a'));
  assert.deepEqual(fixture.state.calls.llm[0].file_urls, ['https://storage.example.test/signed/document-a?sig=1']);
  assert.equal(fixture.state.calls.updates.length, 1);
  const [updatedId, patch] = fixture.state.calls.updates[0];
  assert.equal(updatedId, 'document-a');
  assert.deepEqual(Object.keys(patch), ['ai_analysis']);
  assert.equal(patch.ai_analysis.analyzed, true);
  // No legacy chart or membership scan runs here; the broker owns access.
  assert.deepEqual(fixture.state.calls.patients, []);
  assert.deepEqual(fixture.state.calls.memberships, []);
});

test('analyzeDocument refuses with one answer whenever the broker does, before any read or model call', async () => {
  for (const status of [400, 403, 404, 409]) {
    const fixture = makeDocumentClient();
    brokerFor(fixture, { refuseWith: status });
    const handler = await loadHandler('analyzeDocument', fixture.client);
    const response = await handler(request({ agency_id: 'agency-a', document_id: 'document-a' }));
    assert.equal(response.status, 403, `broker ${status}`);
    assert.deepEqual(await response.json(), { error: 'Document is unavailable' });
    assert.deepEqual(fixture.state.calls.documents, []);
    assert.deepEqual(fixture.state.calls.llm, []);
    assert.deepEqual(fixture.state.calls.updates, []);
  }
});

test('analyzeDocument refuses a broker answer about another document or agency', async () => {
  for (const options of [{ documentId: 'document-b' }, { agencyId: 'agency-b' }]) {
    const fixture = makeDocumentClient();
    brokerFor(fixture, options);
    const handler = await loadHandler('analyzeDocument', fixture.client);
    const response = await handler(request({ agency_id: 'agency-a', document_id: 'document-a' }));
    assert.equal(response.status, 403);
    assert.deepEqual(fixture.state.calls.llm, []);
    assert.deepEqual(fixture.state.calls.updates, []);
  }
});

test('analyzeDocument returns a stored analysis under the metadata purpose without calling the model', async () => {
  const fixture = makeDocumentClient({
    documents: [document({
      ai_analysis: {
        analyzed: true,
        summary: 'Stored summary',
        critical_flags: [{ severity: 'HIGH', finding: 'Potassium 6.1', details: 'Repeat lab' }],
        suggested_category: 'lab_results',
        confidence_score: 140,
        analyzed_date: NOW,
      },
    })],
  });
  const brokerCalls = brokerFor(fixture);
  const handler = await loadHandler('analyzeDocument', fixture.client);
  const response = await handler(request({ agency_id: 'agency-a', document_id: 'document-a', action: 'get' }));
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.analysis.summary, 'Stored summary');
  assert.equal(payload.analysis.confidence_score, 100);
  assert.equal(payload.analysis.critical_flags[0].severity, 'high');
  assert.equal(payload.analysis.analyzed_date, NOW);
  assert.deepEqual(brokerCalls.map((call) => call.payload.purpose), ['metadata']);
  assert.deepEqual(fixture.state.calls.llm, []);
  assert.deepEqual(fixture.state.calls.updates, []);
});

test('analyzeDocument stores nothing when the model answer is unusable, and rejects bad input', async () => {
  const fixture = makeDocumentClient();
  brokerFor(fixture);
  fixture.client.integrations.Core.InvokeLLM = async (args) => {
    fixture.state.calls.llm.push(args);
    return { summary: '' };
  };
  const handler = await loadHandler('analyzeDocument', fixture.client);
  const response = await handler(request({ agency_id: 'agency-a', document_id: 'document-a' }));
  assert.equal(response.status, 502);
  assert.deepEqual(fixture.state.calls.updates, []);

  assert.equal((await handler(request({ agency_id: 'agency-a', document_id: 'document-a', extra: 1 }))).status, 400);
  assert.equal((await handler(request({ agency_id: 'agency-a', document_id: 'document-a', action: 'delete' }))).status, 400);
  assert.equal((await handler(request({ document_id: 'document-a' }))).status, 400);
  const methodDenied = await handler({ method: 'GET', headers: new Headers(), text: async () => '' });
  assert.equal(methodDenied.status, 405);
});

test('generateFaxCoverPage rejects every legacy Document identifier before reads or AI', async () => {
  const fixture = makeDocumentClient();
  const handler = await loadHandler('generateFaxCoverPage', fixture.client);
  let networkCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    networkCalls += 1;
    throw new Error('must not call network');
  };
  try {
    const response = await handler(request({
      patient_id: 'patient-a',
      document_id: 'document-a',
      recipient_number: '+17245550101',
    }));
    assert.equal(response.status, 400);
    assert.equal(networkCalls, 0);
    assert.deepEqual(fixture.state.calls.documents, []);
    assert.deepEqual(fixture.state.calls.patients, []);
    assert.deepEqual(fixture.state.calls.memberships, []);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('generateFaxCoverPage rejects non-POST and oversized bodies before reading them', async () => {
  let authReads = 0;
  const client = {
    get auth() {
      authReads += 1;
      throw new Error('method rejection must precede authentication');
    },
  };
  const handler = await loadHandler('generateFaxCoverPage', client);
  let bodyReads = 0;
  const methodResponse = await handler({
    method: 'GET',
    get headers() { throw new Error('method rejection must precede headers'); },
    text: async () => { bodyReads += 1; return '{}'; },
  });

  assert.equal(methodResponse.status, 405);
  assert.equal(methodResponse.headers.get('Allow'), 'POST');
  assert.equal(methodResponse.headers.get('Cache-Control'), 'no-store');
  assert.equal(methodResponse.headers.get('Pragma'), 'no-cache');
  assert.equal(authReads, 0);
  assert.equal(bodyReads, 0);

  const fixture = makeDocumentClient();
  const oversizedHandler = await loadHandler('generateFaxCoverPage', fixture.client);
  const oversizedResponse = await oversizedHandler({
    method: 'POST',
    headers: new Headers({ 'content-length': '100001' }),
    text: async () => { bodyReads += 1; return '{}'; },
  });
  assert.equal(oversizedResponse.status, 413);
  assert.equal(oversizedResponse.headers.get('Cache-Control'), 'no-store');
  assert.equal(oversizedResponse.headers.get('Pragma'), 'no-cache');
  assert.equal(bodyReads, 0);
  assert.deepEqual(fixture.state.calls.patients, []);
  assert.deepEqual(fixture.state.calls.memberships, []);

  const rawOversizedResponse = await oversizedHandler({
    method: 'POST',
    headers: new Headers(),
    text: async () => { bodyReads += 1; return 'x'.repeat(100_001); },
  });
  assert.equal(rawOversizedResponse.status, 413);
  assert.equal(rawOversizedResponse.headers.get('Cache-Control'), 'no-store');
  assert.equal(rawOversizedResponse.headers.get('Pragma'), 'no-cache');
  assert.equal(bodyReads, 1);
  assert.deepEqual(fixture.state.calls.patients, []);
  assert.deepEqual(fixture.state.calls.memberships, []);
});

test('generateFaxCoverPage rejects operator identifiers and mutable tenant claims before reads', async () => {
  const fixture = makeDocumentClient();
  const handler = await loadHandler('generateFaxCoverPage', fixture.client);
  for (const body of [
    { document_id: { $ne: null } },
    { patient_id: ' patient-a' },
    { patient_id: 'patient-a', agency_id: 'agency-a' },
  ]) {
    const response = await handler(request(body));
    assert.equal(response.status, 400);
  }
  assert.deepEqual(fixture.state.calls.documents, []);
  assert.deepEqual(fixture.state.calls.patients, []);
  assert.deepEqual(fixture.state.calls.memberships, []);
});

test('generateFaxCoverPage bounds every presentation field before protected reads', async () => {
  const invalidBodies = [
    { recipient_number: '1'.repeat(65) },
    { recipient_name: 'N'.repeat(201) },
    { recipient_organization: 'O'.repeat(301) },
    { sender_name: 'S'.repeat(201) },
    { sender_number: '1'.repeat(65) },
    { subject: 'S'.repeat(301) },
    { notes: 'N'.repeat(5_001) },
    { urgency: 'immediate' },
    { page_count: '1' },
    { page_count: -1 },
    { page_count: 10_001 },
  ];

  for (const body of invalidBodies) {
    const fixture = makeDocumentClient();
    const handler = await loadHandler('generateFaxCoverPage', fixture.client);
    const response = await handler(request(body));
    assert.equal(response.status, 400);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.equal(response.headers.get('Pragma'), 'no-cache');
    assert.deepEqual(fixture.state.calls.patients, []);
    assert.deepEqual(fixture.state.calls.memberships, []);
    assert.deepEqual(fixture.state.calls.assignments, []);
  }
});

test('generateFaxCoverPage derives tenant only from exact immutable authority and formats locally', async () => {
  const fixture = makeDocumentClient({
    user: {
      id: 'user-a',
      email: 'member@example.com',
      role: 'user',
      agency_name: 'Forged Agency',
      is_active: true,
    },
  });
  const handler = await loadHandler('generateFaxCoverPage', fixture.client);
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    throw new Error('fax-cover formatting must not call a provider');
  };
  try {
    const response = await handler(request({
      patient_id: 'patient-a',
      recipient_number: '+17245550101',
      recipient_name: 'Recipient',
      recipient_organization: 'Receiving Practice',
      sender_name: 'Member',
      notes: 'Please review the attachment.',
      page_count: 1,
    }));
    const json = await response.json();
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.equal(response.headers.get('Pragma'), 'no-cache');
    assert.equal(json.success, true);
    assert.equal(fetchCalls, 0);
    assert.deepEqual(fixture.state.calls.settings, []);
    assert.deepEqual(fixture.state.calls.assignments[0][0], {
      assignment_key: 'agency-a:patient-a:user-a',
      agency_id: 'agency-a',
      patient_id: 'patient-a',
      user_id: 'user-a',
    });
    assert.deepEqual(Object.keys(json.cover_page_data).sort(), [
      'confidentiality_notice', 'date', 'document_title', 'from_fax', 'from_name',
      'notes', 'patient_diagnosis', 'patient_dob', 'patient_mrn', 'patient_name',
      'subject', 'time', 'to_fax', 'to_name', 'to_organization', 'total_pages',
      'urgency',
    ].sort());
    assert.equal(json.cover_page_data.from_name, 'Member');
    assert.equal(json.cover_page_data.from_fax, 'See letterhead');
    assert.equal(json.cover_page_data.to_name, 'Recipient');
    assert.equal(json.cover_page_data.to_organization, 'Receiving Practice');
    assert.equal(json.cover_page_data.to_fax, '+17245550101');
    assert.equal(json.cover_page_data.subject, 'RE: Patient Pat Example');
    assert.equal(json.cover_page_data.urgency, 'routine');
    assert.equal(json.cover_page_data.total_pages, 2);
    assert.equal(json.cover_page_data.patient_name, 'Pat Example');
    assert.equal(json.cover_page_data.patient_dob, '1950-01-01');
    assert.equal(json.cover_page_data.patient_mrn, 'MRN-1');
    assert.equal(json.cover_page_data.patient_diagnosis, 'Test diagnosis');
    assert.equal(json.cover_page_data.document_title, 'See attached');
    assert.equal(json.cover_page_data.notes, 'Please review the attachment.');
    assert.equal(
      json.cover_page_data.confidentiality_notice,
      'CONFIDENTIALITY NOTICE: This fax transmission contains confidential health information protected by HIPAA. If you have received this fax in error, please notify the sender immediately and destroy all copies.',
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('generateFaxCoverPage ignores mutable assigned_nurses without canonical assignment authority', async () => {
  const fixture = makeDocumentClient({
    patients: [patient({ assigned_nurses: ['member@example.com'] })],
    assignments: [],
  });
  const handler = await loadHandler('generateFaxCoverPage', fixture.client);
  const response = await handler(request({ patient_id: 'patient-a' }));

  assert.equal(response.status, 403);
  assert.equal((await response.json()).error, 'Patient is unavailable');
  assert.equal(fixture.state.calls.assignments.length, 1);
});

test('generateFaxCoverPage rejects assignment not bound to the current membership version', async () => {
  const fixture = makeDocumentClient({
    memberships: [membership({ version: 2 })],
    assignments: [assignment({ assignee_membership_version_at_enablement: 1 })],
  });
  const handler = await loadHandler('generateFaxCoverPage', fixture.client);
  const response = await handler(request({ patient_id: 'patient-a' }));

  assert.equal(response.status, 409);
  assert.equal((await response.json()).error, 'Care-team assignment integrity check failed');
});

test('generateFaxCoverPage fails closed on incoherent assignment lifecycle provenance', async () => {
  const incoherentRows = [
    assignment({ source: 'browser_claim' }),
    assignment({ last_transition_action: 'activate', version: 2 }),
    assignment({
      last_transition_action: 'activate',
      version: 4,
      suspended_at: '2026-09-02T12:00:00.000Z',
    }),
    assignment({
      status: 'suspended',
      last_transition_action: 'suspend',
      version: 3,
      suspended_at: NOW,
    }),
    assignment({ last_transition_request_key: 'forged:key' }),
    assignment({ last_transition_at: 'not-a-date' }),
  ];

  for (const row of incoherentRows) {
    const fixture = makeDocumentClient({ assignments: [row] });
    const handler = await loadHandler('generateFaxCoverPage', fixture.client);
    const response = await handler(request({ patient_id: 'patient-a' }));
    assert.equal(response.status, 409);
    assert.equal((await response.json()).error, 'Care-team assignment integrity check failed');
  }
});

test('sendMessage pauses before parsing legacy Document relations or accessing a client', async () => {
  let serviceRoleTouched = false;
  const client = {
    get auth() {
      throw new Error('Paused messaging must not access auth');
    },
  };
  Object.defineProperty(client, 'asServiceRole', {
    get() {
      serviceRoleTouched = true;
      throw new Error('Document rejection must happen first');
    },
  });
  const handler = await loadHandler('sendMessage', client);
  const response = await handler(new Proxy({}, {
    get(_target, property) {
      throw new Error(`Paused messaging touched request.${String(property)}`);
    },
  }));

  assert.equal(response.status, 503);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.deepEqual(await response.json(), {
    error: 'Secure messaging is temporarily unavailable',
    code: 'secure_message_tenant_broker_required',
  });
  assert.equal(serviceRoleTouched, false);
});
