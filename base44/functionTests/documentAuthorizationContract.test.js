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

test('analyzeDocument is a static fail-closed boundary until an authorized write broker exists', async () => {
  const fixture = makeDocumentClient();
  const handler = await loadHandler('analyzeDocument', fixture.client);
  let bodyReads = 0;
  const response = await handler({ json: async () => { bodyReads += 1; return {}; } });

  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    error: 'Document analysis is temporarily unavailable',
    code: 'document_analysis_private_write_broker_required',
  });
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal(bodyReads, 0);
  assert.deepEqual(fixture.state.calls.documents, []);
  assert.deepEqual(fixture.state.calls.patients, []);
  assert.deepEqual(fixture.state.calls.memberships, []);
  assert.deepEqual(fixture.state.calls.agencies, []);
  assert.deepEqual(fixture.state.calls.llm, []);
  assert.deepEqual(fixture.state.calls.updates, []);
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
