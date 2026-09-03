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
  documents = [document()],
  agencySettings = [],
} = {}) {
  const state = {
    memberships: memberships.map((row) => ({ ...row })),
    agencies: agencies.map((row) => ({ ...row })),
    patients: patients.map((row) => ({ ...row })),
    documents: documents.map((row) => ({ ...row })),
    agencySettings: agencySettings.map((row) => ({ ...row })),
    calls: {
      memberships: [],
      agencies: [],
      patients: [],
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
  anthropicKey = 'test-anthropic-key',
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
        if (name === 'ANTHROPIC_API_KEY') return anthropicKey;
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

const request = (body) => ({ json: async () => body });

test('analyzeDocument rejects non-exact identifiers and extra fields before entity access', async () => {
  const fixture = makeDocumentClient();
  const handler = await loadHandler('analyzeDocument', fixture.client);
  for (const body of [
    { document_id: { $ne: null } },
    { document_id: ' document-a' },
    { document_id: 'document-a', agency_id: 'agency-a' },
  ]) {
    const response = await handler(request(body));
    assert.equal(response.status, 400);
  }
  assert.deepEqual(fixture.state.calls.documents, []);
  assert.deepEqual(fixture.state.calls.memberships, []);
  assert.deepEqual(fixture.state.calls.llm, []);
  assert.deepEqual(fixture.state.calls.updates, []);
});

test('analyzeDocument exact-loads Document, Patient, membership and Agency before its write', async () => {
  const fixture = makeDocumentClient();
  const handler = await loadHandler('analyzeDocument', fixture.client);
  const response = await handler(request({ document_id: 'document-a' }));

  assert.equal(response.status, 200);
  assert.equal(fixture.state.calls.llm.length, 1);
  assert.equal(fixture.state.calls.documents.length, 2, 'authority must be re-proved after AI');
  assert.equal(fixture.state.calls.patients.length, 2);
  assert.equal(fixture.state.calls.memberships.length, 2);
  assert.equal(fixture.state.calls.agencies.length, 2);
  assert.deepEqual(fixture.state.calls.updates[0][0], 'document-a');
  assert.equal(fixture.state.calls.updates[0][1].ai_analysis.analyzed, true);
  assert.deepEqual(fixture.state.calls.documents[0], [
    { id: 'document-a' },
    undefined,
    10,
  ]);
});

test('analyzeDocument rejects wrong-row filter regressions and tenant changes without writing', async () => {
  const fixture = makeDocumentClient({
    documents: [document({ id: 'wrong-document' })],
  });
  const handler = await loadHandler('analyzeDocument', fixture.client);
  let response = await handler(request({ document_id: 'document-a' }));
  assert.equal(response.status, 404);
  assert.deepEqual(fixture.state.calls.llm, []);
  assert.deepEqual(fixture.state.calls.updates, []);

  const crossTenant = makeDocumentClient({
    patients: [patient({ agency_id: 'agency-b' })],
  });
  const crossHandler = await loadHandler('analyzeDocument', crossTenant.client);
  response = await crossHandler(request({ document_id: 'document-a' }));
  assert.equal(response.status, 403);
  assert.deepEqual(crossTenant.state.calls.llm, []);
  assert.deepEqual(crossTenant.state.calls.updates, []);

  const relinkedForeignDocument = makeDocumentClient({
    documents: [document({ created_by: 'other@example.com' })],
  });
  const relinkedHandler = await loadHandler('analyzeDocument', relinkedForeignDocument.client);
  response = await relinkedHandler(request({ document_id: 'document-a' }));
  assert.equal(response.status, 403);
  assert.deepEqual(relinkedForeignDocument.state.calls.llm, []);
  assert.deepEqual(relinkedForeignDocument.state.calls.updates, []);
});

test('analyzeDocument detects authority drift after the slow AI call', async () => {
  const fixture = makeDocumentClient();
  let reads = 0;
  fixture.client.asServiceRole.entities.Document.filter = async (...args) => {
    fixture.state.calls.documents.push(args);
    reads += 1;
    return [document(reads === 1 ? {} : { file_url: 'https://files.base44.app/replaced.pdf' })];
  };
  const handler = await loadHandler('analyzeDocument', fixture.client);
  const response = await handler(request({ document_id: 'document-a' }));

  assert.equal(response.status, 409);
  assert.equal(fixture.state.calls.llm.length, 1);
  assert.deepEqual(fixture.state.calls.updates, []);
});

test('generateFaxCoverPage rejects an orphan Document paired with an unrelated patient', async () => {
  const fixture = makeDocumentClient({
    documents: [document({ patient_id: null, created_by: 'member@example.com' })],
  });
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
    assert.equal(response.status, 409);
    assert.equal(networkCalls, 0);
    assert.deepEqual(fixture.state.calls.memberships, []);
  } finally {
    globalThis.fetch = originalFetch;
  }
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

test('generateFaxCoverPage derives tenant only from exact immutable authority', async () => {
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
  const fetchCalls = [];
  globalThis.fetch = async (...args) => {
    fetchCalls.push(args);
    return new Response(JSON.stringify({
      content: [{ text: JSON.stringify({ from_name: 'Member', from_fax: '+17245550199' }) }],
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const response = await handler(request({
      patient_id: 'patient-a',
      document_id: 'document-a',
      recipient_number: '+17245550101',
      recipient_name: 'Recipient',
      page_count: 1,
    }));
    const json = await response.json();
    assert.equal(response.status, 200);
    assert.equal(json.success, true);
    assert.equal(fetchCalls.length, 1);
    assert.deepEqual(fixture.state.calls.settings, []);
    assert.match(
      JSON.parse(fetchCalls[0][1].body).messages[0].content,
      /Sender Fax: See letterhead/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

function makeMessageClient({ documents, patients = [patient()], users } = {}) {
  const state = { creates: [] };
  const rows = {
    User: users || [{ email: 'recipient@example.com', is_active: true }],
    Patient: patients,
    Referral: [],
    Document: documents || [],
    Message: [],
  };
  const entities = Object.fromEntries(
    Object.entries(rows).map(([name, values]) => [
      name,
      {
        filter: async (query) => rowsMatching(values, query),
        ...(name === 'Message' ? {
          create: async (record) => {
            state.creates.push(record);
            return { id: 'message-1', ...record };
          },
        } : {}),
      },
    ]),
  );
  return {
    client: {
      auth: {
        me: async () => ({
          email: 'member@example.com',
          full_name: 'Member',
          role: 'user',
          is_active: true,
        }),
      },
      asServiceRole: { entities },
    },
    state,
  };
}

test('sendMessage does not use an authorized patient to authorize an orphan Document', async () => {
  const fixture = makeMessageClient({
    documents: [document({
      patient_id: null,
      created_by: 'other@example.com',
      // Legacy client-writable uploaded_by must not become authority.
      uploaded_by: 'member@example.com',
    })],
  });
  const handler = await loadHandler('sendMessage', fixture.client);
  const response = await handler(request({
    recipients: ['recipient@example.com'],
    patient_id: 'patient-a',
    document_id: 'document-a',
    message_text: 'Must not attach an orphan record to a chart',
  }));

  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), {
    error: 'Document is not linked to the requested patient',
  });
  assert.deepEqual(fixture.state.creates, []);
});

test('sendMessage preserves the exact authorized Document-to-Patient path', async () => {
  const fixture = makeMessageClient({
    documents: [document()],
  });
  const handler = await loadHandler('sendMessage', fixture.client);
  const response = await handler(request({
    recipients: ['recipient@example.com'],
    patient_id: 'patient-a',
    document_id: 'document-a',
    message_text: 'Authorized linked record',
    attachments: ['https://files.base44.app/document-a.pdf'],
  }));

  assert.equal(response.status, 200);
  assert.equal(fixture.state.creates.length, 1);
  assert.equal(fixture.state.creates[0].patient_id, 'patient-a');
  assert.deepEqual(fixture.state.creates[0].attachments, [
    'https://files.base44.app/document-a.pdf',
  ]);
});

test('sendMessage rejects malformed stored Document patient linkage', async () => {
  const fixture = makeMessageClient({
    documents: [document({ patient_id: { $ne: null }, created_by: 'member@example.com' })],
  });
  const handler = await loadHandler('sendMessage', fixture.client);
  const response = await handler(request({
    recipients: ['recipient@example.com'],
    document_id: 'document-a',
    message_text: 'Malformed linkage',
  }));

  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), { error: 'Document patient linkage is invalid' });
  assert.deepEqual(fixture.state.creates, []);
});
