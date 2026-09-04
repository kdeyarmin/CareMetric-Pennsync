import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { transpileTs } from '../../tools-transpile-ts.mjs';

const brokerFiles = {
  get: new URL('../functions/getAuthorizedDocument/entry.ts', import.meta.url),
  list: new URL('../functions/listAuthorizedDocuments/entry.ts', import.meta.url),
};

const NOW = '2026-09-03T15:00:00.000Z';
const USER = {
  id: 'user-1',
  email: 'Clinician@Agency.test',
  role: 'user',
  is_active: true,
  is_verified: true,
};

const membership = (overrides = {}) => ({
  id: 'membership-a',
  membership_key: 'agency-a:user-1',
  agency_id: 'agency-a',
  user_id: 'user-1',
  user_email_normalized: 'clinician@agency.test',
  tenant_role: 'clinician',
  status: 'active',
  created_by_user_id: 'owner-1',
  activated_at: '2026-09-03T12:00:00.000Z',
  last_transition_by_user_id: 'owner-1',
  last_transition_by_email_normalized: 'owner@platform.test',
  last_transition_at: '2026-09-03T12:00:00.000Z',
  last_transition_reason: 'Approved tenant membership',
  version: 2,
  ...overrides,
});

const agency = (overrides = {}) => ({ id: 'agency-a', status: 'active', ...overrides });

const patient = (overrides = {}) => {
  const row = {
    id: 'patient-a',
    agency_id: 'agency-a',
    created_by_user_id: 'user-1',
    created_by_user_email_normalized: 'clinician@agency.test',
    created_by: 'clinician@agency.test',
    client_request_id: 'patient-request-a',
    patient_creation_key: 'agency-a:user-1:patient-request-a',
    is_sample: false,
    is_archived: false,
    status: 'active',
    updated_date: NOW,
    ...overrides,
  };
  return row;
};

const assignment = (overrides = {}) => {
  const row = {
    id: 'assignment-a',
    assignment_key: 'agency-a:patient-a:user-1',
    agency_id: 'agency-a',
    patient_id: 'patient-a',
    user_id: 'user-1',
    user_email_normalized: 'clinician@agency.test',
    assignee_membership_id: 'membership-a',
    assignee_membership_version_at_enablement: 2,
    status: 'active',
    source: 'manual',
    created_by_user_id: 'manager-1',
    created_by_user_email_normalized: 'manager@agency.test',
    activated_at: '2026-09-03T13:00:00.000Z',
    last_transition_by_user_id: 'manager-1',
    last_transition_by_email_normalized: 'manager@agency.test',
    last_transition_at: '2026-09-03T13:00:00.000Z',
    last_transition_reason: 'Assigned for direct care',
    last_transition_action: 'grant',
    last_transition_request_id: 'assignment-request-a',
    last_transition_request_key: 'agency-a:patient-a:user-1:assignment-request-a',
    version: 1,
    ...overrides,
  };
  if (row.status === 'suspended') {
    row.suspended_at ??= '2026-09-03T14:00:00.000Z';
    row.last_transition_action = 'suspend';
  }
  return row;
};

function binding(suffix = 'a', overrides = {}) {
  const clientRequestId = overrides.client_request_id ?? `document-request-${suffix}`;
  const creatorId = overrides.created_by_user_id ?? 'user-1';
  const agencyId = overrides.agency_id ?? 'agency-a';
  const bindingKey = createHash('sha256')
    .update(`${agencyId}\u0000${creatorId}\u0000${clientRequestId}`)
    .digest('hex');
  return {
    id: `binding-${suffix}`,
    binding_key: bindingKey,
    document_id: `document-${suffix}`,
    agency_id: agencyId,
    patient_id: 'patient-a',
    created_by_user_id: creatorId,
    created_by_user_email_normalized: 'clinician@agency.test',
    membership_id: 'membership-a',
    membership_version: 2,
    document_created_by_email_normalized: 'clinician@agency.test',
    file_url: `https://files.base44.app/document-${suffix}.pdf`,
    file_name: `Document-${suffix}.pdf`,
    file_type: 'application/pdf',
    file_size: 1024,
    content_sha256: createHash('sha256').update(`bytes-${suffix}`).digest('hex'),
    client_request_id: clientRequestId,
    purpose: 'patient_document',
    version: 1,
    created_at: NOW,
    last_verified_at: NOW,
    ...overrides,
  };
}

function document(suffix = 'a', overrides = {}) {
  return {
    id: `document-${suffix}`,
    title: `Document-${suffix}.pdf`,
    description: `Document ${suffix}`,
    file_url: `https://files.base44.app/document-${suffix}.pdf`,
    file_name: `Document-${suffix}.pdf`,
    file_size: 1024,
    file_type: 'application/pdf',
    category: 'other',
    patient_id: 'patient-a',
    tags: ['patient_document'],
    document_date: '2026-09-03',
    uploaded_by: 'clinician@agency.test',
    created_by: 'clinician@agency.test',
    is_sensitive: true,
    expiration_date: null,
    clinician_signed: false,
    clinician_signed_date: null,
    clinician_name: null,
    patient_signed: false,
    patient_signed_date: null,
    patient_name: null,
    is_signed: false,
    is_locked: false,
    updated_date: NOW,
    ...overrides,
  };
}

function matches(row, query) {
  return Object.entries(query || {}).every(([field, expected]) => {
    if (expected && typeof expected === 'object' && !Array.isArray(expected)) {
      if (Array.isArray(expected.$in)) return expected.$in.includes(row?.[field]);
      if (typeof expected.$gt === 'string') return row?.[field] > expected.$gt;
      return false;
    }
    return row?.[field] === expected;
  });
}

function filterRows(rows, query, sort, limit, { ignoreFilters = false, ignoreLimit = false } = {}) {
  if (!Array.isArray(rows)) return rows;
  const selected = ignoreFilters ? [...rows] : rows.filter((row) => matches(row, query));
  const ordered = sort === 'document_id'
    ? selected.sort((left, right) => left.document_id.localeCompare(right.document_id))
    : selected;
  return ignoreLimit ? ordered : ordered.slice(0, limit);
}

async function importHandler(kind, makeClient, superAdminEmail = null) {
  let source = await readFile(brokerFiles[kind], 'utf8');
  const globalName = `__documentReadClient_${kind}_${Math.random().toString(36).slice(2)}`;
  source = source.replace(
    /import\s+\{\s*createClientFromRequest\s*\}\s+from\s+'npm:[^']+';/,
    `const createClientFromRequest = globalThis.${globalName};`,
  );
  const temporaryModule = join(
    tmpdir(),
    `document_read_${kind}_${Date.now()}_${Math.random().toString(36).slice(2)}.mjs`,
  );
  await writeFile(temporaryModule, transpileTs(source).outputText);
  let handler;
  globalThis[globalName] = makeClient;
  globalThis.Deno = {
    serve: (candidate) => { handler = candidate; },
    env: { get: (name) => name === 'SUPER_ADMIN_EMAIL' ? superAdminEmail : null },
  };
  try {
    await import(pathToFileURL(temporaryModule).href);
  } finally {
    await unlink(temporaryModule).catch(() => {});
    delete globalThis[globalName];
  }
  assert.equal(typeof handler, 'function');
  return handler;
}

async function loadBroker(kind, {
  caller = USER,
  callers = null,
  memberships = [membership()],
  agencies = [agency()],
  patients = [patient()],
  assignments = [],
  bindings = [binding()],
  documents = [document()],
  responses = {},
  ignoreFilters = [],
  ignoreLimit = [],
  superAdminEmail = null,
} = {}) {
  const clone = (value) => structuredClone(value);
  const calls = {
    auth: 0,
    memberships: [],
    agencies: [],
    patients: [],
    assignments: [],
    bindings: [],
    documents: [],
  };
  const indices = Object.fromEntries(Object.keys(calls).map((name) => [name, 0]));
  const datasets = { memberships, agencies, patients, assignments, bindings, documents };
  const entity = (name) => ({
    filter: async (query, sort, limit, offset, fields) => {
      calls[name].push({ query: clone(query), sort, limit, offset, fields: clone(fields) });
      const sequence = responses[name];
      const index = indices[name]++;
      const source = sequence
        ? sequence[Math.min(index, sequence.length - 1)]
        : datasets[name];
      return filterRows(clone(source), query, sort, limit, {
        ignoreFilters: ignoreFilters.includes(name),
        ignoreLimit: ignoreLimit.includes(name),
      });
    },
  });
  const serviceRole = {
    entities: {
      AgencyMembership: entity('memberships'),
      Agency: entity('agencies'),
      Patient: entity('patients'),
      PatientCareTeamAssignment: entity('assignments'),
      DocumentTenantBinding: entity('bindings'),
      Document: entity('documents'),
    },
  };
  const client = {
    auth: {
      me: async () => {
        const value = callers
          ? callers[Math.min(calls.auth, callers.length - 1)]
          : caller;
        calls.auth += 1;
        if (value instanceof Error) throw value;
        return clone(value);
      },
    },
    asServiceRole: serviceRole,
  };
  return {
    handler: await importHandler(kind, () => client, superAdminEmail),
    calls,
  };
}

async function invoke(handler, path, body, method = 'POST') {
  const request = new Request(`http://local/${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    ...(method === 'GET' ? {} : { body: JSON.stringify(body) }),
  });
  const response = await handler(request);
  return { response, json: await response.json() };
}

const getBody = (overrides = {}) => ({
  agency_id: 'agency-a',
  document_id: 'document-a',
  purpose: 'metadata',
  ...overrides,
});

const listBody = (overrides = {}) => ({
  agency_id: 'agency-a',
  purpose: 'library',
  patient_id: 'patient-a',
  binding_purpose: null,
  sort: 'document_id_asc',
  page_size: 10,
  cursor: null,
  ...overrides,
});

test('Document read brokers are unwired, projection-bounded, and mutation-free', async () => {
  const [getSource, listSource] = await Promise.all(
    Object.values(brokerFiles).map((url) => readFile(url, 'utf8')),
  );
  for (const source of [getSource, listSource]) {
    assert.match(source, /DocumentTenantBinding\.filter/);
    assert.match(source, /AgencyMembership\.filter/);
    assert.match(source, /PatientCareTeamAssignment\.filter/);
    assert.match(source, /asServiceRole\.entities/);
    assert.doesNotMatch(source, /\.entities\.(?:Document|DocumentTenantBinding)\.(?:create|update|delete)\s*\(/);
    assert.doesNotMatch(source, /Document\.list\s*\(/);
    assert.match(source, /changed during request/);
  }
  const exactPolicy = getSource.match(
    /<<<BEGIN AUTHORIZED DOCUMENT EXACT PURPOSE POLICY>>>([\s\S]*?)<<<END AUTHORIZED DOCUMENT EXACT PURPOSE POLICY>>>/,
  )?.[1];
  assert.ok(exactPolicy);
  assert.match(exactPolicy, /metadata:[\s\S]*signature_review:/);
  assert.doesNotMatch(exactPolicy, /\bdownload\b|\bfile_url\b/);
  assert.match(listSource, /library:[\s\S]*signature_queue:/);
  assert.match(listSource, /MAX_SCAN_CAP = 50/);
  assert.match(listSource, /patient_id is required for this tenant role/);

  const srcRoot = new URL('../../src/', import.meta.url);
  async function walk(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
      if (entry.name === 'functions') continue;
      const child = join(directory.pathname, entry.name);
      if (entry.isDirectory()) files.push(...await walk(pathToFileURL(`${child}/`)));
      else if (/\.[cm]?[jt]sx?$/.test(entry.name)) files.push(child);
    }
    return files;
  }
  const uiSources = await Promise.all((await walk(srcRoot)).map((file) => readFile(file, 'utf8')));
  assert.equal(uiSources.some((source) => /getAuthorizedDocument|listAuthorizedDocuments/.test(source)), false);
});

test('exact read validates binding, historical membership, Patient, Document, and a narrow projection at disclosure', async () => {
  const fixture = await loadBroker('get');
  const { response, json } = await invoke(fixture.handler, 'getAuthorizedDocument', getBody());
  assert.equal(response.status, 200);
  assert.equal(json.success, true);
  assert.deepEqual(Object.keys(json.document), [
    'id', 'title', 'description', 'file_name', 'file_size', 'file_type', 'category',
    'patient_id', 'tags', 'document_date', 'is_sensitive', 'expiration_date',
    'is_signed', 'is_locked', 'updated_date',
  ]);
  assert.equal(Object.hasOwn(json.document, 'file_url'), false);
  assert.equal(fixture.calls.bindings.length, 3);
  assert.equal(fixture.calls.documents.length, 3);
  assert.equal(fixture.calls.patients.length, 3);
  assert.equal(fixture.calls.memberships.length, 6);
  assert.deepEqual(fixture.calls.bindings[0].query, {
    agency_id: 'agency-a', document_id: 'document-a',
  });
  assert.deepEqual(fixture.calls.documents[0].query, { id: 'document-a' });
});

test('exact read accepts an active care-team assignment but conceals an unassigned Patient', async () => {
  const foreignPatient = patient({
    created_by_user_id: 'user-2',
    created_by_user_email_normalized: 'other@agency.test',
    created_by: 'other@agency.test',
    client_request_id: 'patient-request-b',
    patient_creation_key: 'agency-a:user-2:patient-request-b',
  });
  let fixture = await loadBroker('get', {
    patients: [foreignPatient],
    assignments: [assignment()],
  });
  let result = await invoke(fixture.handler, 'getAuthorizedDocument', getBody());
  assert.equal(result.response.status, 200);
  assert.equal(Object.hasOwn(result.json.document, 'file_url'), false);
  assert.equal(fixture.calls.assignments.length, 3);

  fixture = await loadBroker('get', { patients: [foreignPatient] });
  result = await invoke(fixture.handler, 'getAuthorizedDocument', getBody());
  assert.equal(result.response.status, 404);
  assert.deepEqual(result.json, { error: 'Document unavailable' });
});

test('exact read has no public-URL purpose and rejects stale assignment enablement versions', async () => {
  let fixture = await loadBroker('get');
  let result = await invoke(
    fixture.handler,
    'getAuthorizedDocument',
    getBody({ purpose: 'download' }),
  );
  assert.equal(result.response.status, 400);
  assert.equal(fixture.calls.bindings.length, 0);

  const foreignPatient = patient({
    created_by_user_id: 'user-2',
    created_by_user_email_normalized: 'other@agency.test',
    created_by: 'other@agency.test',
    client_request_id: 'patient-request-b',
    patient_creation_key: 'agency-a:user-2:patient-request-b',
  });
  fixture = await loadBroker('get', {
    patients: [foreignPatient],
    assignments: [assignment({ assignee_membership_version_at_enablement: 1 })],
  });
  result = await invoke(fixture.handler, 'getAuthorizedDocument', getBody());
  assert.equal(result.response.status, 409);
  assert.equal(Object.hasOwn(result.json, 'document'), false);

  for (const purpose of ['metadata', 'signature_review']) {
    fixture = await loadBroker('get');
    result = await invoke(
      fixture.handler,
      'getAuthorizedDocument',
      getBody({ purpose }),
    );
    assert.equal(result.response.status, 200);
    assert.equal(Object.hasOwn(result.json.document, 'file_url'), false);
  }
});

test('exact read rejects operator input, unsupported roles, wrong-scope rows, duplicates, and scan saturation', async () => {
  let fixture = await loadBroker('get');
  for (const body of [
    getBody({ document_id: { $ne: null } }),
    getBody({ document_id: ' document-a' }),
    { ...getBody(), fields: ['file_url'] },
  ]) {
    const { response } = await invoke(fixture.handler, 'getAuthorizedDocument', body);
    assert.equal(response.status, 400);
  }
  assert.equal(fixture.calls.bindings.length, 0);

  fixture = await loadBroker('get', {
    memberships: [membership({ tenant_role: 'office_staff' })],
  });
  assert.equal((await invoke(fixture.handler, 'getAuthorizedDocument', getBody())).response.status, 403);

  fixture = await loadBroker('get', {
    bindings: [binding('x', { agency_id: 'agency-b', document_id: 'document-a' })],
    ignoreFilters: ['bindings'],
  });
  assert.equal((await invoke(fixture.handler, 'getAuthorizedDocument', getBody())).response.status, 409);

  fixture = await loadBroker('get', { bindings: [binding(), binding('b', { document_id: 'document-a' })] });
  assert.equal((await invoke(fixture.handler, 'getAuthorizedDocument', getBody())).response.status, 409);

  fixture = await loadBroker('get', {
    bindings: Array.from({ length: 10 }, (_, index) => binding(String(index), {
      document_id: 'document-a',
    })),
  });
  assert.equal((await invoke(fixture.handler, 'getAuthorizedDocument', getBody())).response.status, 409);
});

test('exact read fails closed on binding hash, membership, Document, or authority preimage drift', async () => {
  let fixture = await loadBroker('get', {
    bindings: [binding('a', { binding_key: '0'.repeat(64) })],
  });
  assert.equal((await invoke(fixture.handler, 'getAuthorizedDocument', getBody())).response.status, 409);

  fixture = await loadBroker('get', {
    bindings: [binding('a', { file_name: 'Document-a.txt' })],
  });
  assert.equal((await invoke(fixture.handler, 'getAuthorizedDocument', getBody())).response.status, 409);

  fixture = await loadBroker('get', {
    bindings: [binding('a', { membership_version: 3 })],
  });
  assert.equal((await invoke(fixture.handler, 'getAuthorizedDocument', getBody())).response.status, 409);

  fixture = await loadBroker('get', {
    documents: [document('a', { file_url: 'https://files.base44.app/replaced.pdf' })],
  });
  assert.equal((await invoke(fixture.handler, 'getAuthorizedDocument', getBody())).response.status, 409);

  fixture = await loadBroker('get', {
    responses: {
      documents: [[document()], [document('a', { is_locked: true })]],
    },
  });
  assert.equal((await invoke(fixture.handler, 'getAuthorizedDocument', getBody())).response.status, 409);
});

test('exact read rechecks authority, binding, Document, Patient, and assignment at disclosure time', async () => {
  let fixture = await loadBroker('get', {
    callers: [USER, USER, { ...USER, is_active: false }],
  });
  let result = await invoke(fixture.handler, 'getAuthorizedDocument', getBody());
  assert.equal(result.response.status, 403);
  assert.equal(Object.hasOwn(result.json, 'document'), false);

  fixture = await loadBroker('get', {
    responses: {
      bindings: [
        [binding()],
        [binding()],
        [binding('a', { last_verified_at: '2026-09-03T16:00:00.000Z' })],
      ],
    },
  });
  result = await invoke(fixture.handler, 'getAuthorizedDocument', getBody());
  assert.equal(result.response.status, 409);
  assert.equal(fixture.calls.bindings.length, 3);

  fixture = await loadBroker('get', {
    responses: {
      documents: [[document()], [document()], [document('a', { is_locked: true })]],
    },
  });
  result = await invoke(fixture.handler, 'getAuthorizedDocument', getBody());
  assert.equal(result.response.status, 409);
  assert.equal(fixture.calls.documents.length, 3);

  fixture = await loadBroker('get', {
    responses: {
      patients: [
        [patient()],
        [patient()],
        [patient({ updated_date: '2026-09-03T16:00:00.000Z' })],
      ],
    },
  });
  result = await invoke(fixture.handler, 'getAuthorizedDocument', getBody());
  assert.equal(result.response.status, 409);
  assert.equal(fixture.calls.patients.length, 3);

  const foreignPatient = patient({
    created_by_user_id: 'user-2',
    created_by_user_email_normalized: 'other@agency.test',
    created_by: 'other@agency.test',
    client_request_id: 'patient-request-b',
    patient_creation_key: 'agency-a:user-2:patient-request-b',
  });
  fixture = await loadBroker('get', {
    patients: [foreignPatient],
    responses: {
      assignments: [
        [assignment()],
        [assignment()],
        [assignment({ version: 2 })],
      ],
    },
  });
  result = await invoke(fixture.handler, 'getAuthorizedDocument', getBody());
  assert.equal(result.response.status, 409);
  assert.equal(fixture.calls.assignments.length, 3);

  fixture = await loadBroker('get', {
    patients: [foreignPatient],
    responses: {
      assignments: [
        [assignment()],
        [assignment()],
        [assignment({ status: 'suspended' })],
      ],
    },
  });
  result = await invoke(fixture.handler, 'getAuthorizedDocument', getBody());
  assert.equal(result.response.status, 404);
  assert.equal(Object.hasOwn(result.json, 'document'), false);
});

test('protected platform owner is exact-email gated and can read without a tenant membership', async () => {
  const owner = {
    id: 'owner-user', email: 'owner@platform.test', role: 'admin', is_active: true, is_verified: true,
  };
  let fixture = await loadBroker('get', {
    caller: owner,
    memberships: [membership()],
    superAdminEmail: 'owner@platform.test',
  });
  let result = await invoke(fixture.handler, 'getAuthorizedDocument', getBody());
  assert.equal(result.response.status, 200);
  assert.deepEqual(result.json.scope, {
    agency_id: 'agency-a', membership_id: null, membership_version: null, tenant_role: 'platform_owner',
  });
  assert.equal(
    fixture.calls.memberships.filter((call) => call.query.user_id === 'owner-user').length,
    3,
  );
  assert.equal(
    fixture.calls.memberships.filter((call) => call.query.id === 'membership-a').length,
    3,
  );

  fixture = await loadBroker('get', { caller: owner, superAdminEmail: 'different@platform.test' });
  result = await invoke(fixture.handler, 'getAuthorizedDocument', getBody());
  assert.equal(result.response.status, 403);

  fixture = await loadBroker('get', { caller: { ...USER, role: 'admin' } });
  result = await invoke(fixture.handler, 'getAuthorizedDocument', getBody());
  assert.equal(result.response.status, 403);
  assert.equal(fixture.calls.memberships.length, 0);
});

test('list preserves exact membership-free platform-owner isolation', async () => {
  const owner = {
    id: 'owner-user', email: 'owner@platform.test', role: 'admin', is_active: true, is_verified: true,
  };
  let fixture = await loadBroker('list', {
    caller: owner,
    memberships: [membership()],
    superAdminEmail: 'owner@platform.test',
  });
  let result = await invoke(fixture.handler, 'listAuthorizedDocuments', listBody());
  assert.equal(result.response.status, 200);
  assert.deepEqual(result.json.scope, {
    agency_id: 'agency-a',
    patient_id: 'patient-a',
    membership_id: null,
    membership_version: null,
    tenant_role: 'platform_owner',
  });
  assert.equal(
    fixture.calls.memberships.filter((call) => call.query.user_id === 'owner-user').length,
    3,
  );
  assert.equal(
    fixture.calls.memberships.filter((call) => call.query.id?.$in?.[0] === 'membership-a').length,
    3,
  );

  fixture = await loadBroker('list', {
    caller: owner,
    memberships: [membership()],
    superAdminEmail: 'different@platform.test',
  });
  result = await invoke(fixture.handler, 'listAuthorizedDocuments', listBody());
  assert.equal(result.response.status, 403);
  assert.equal(fixture.calls.memberships.length, 0);
});

test('platform owner Document reads reject preexisting or duplicate owner memberships', async () => {
  const owner = {
    id: 'owner-user', email: 'owner@platform.test', role: 'admin', is_active: true, is_verified: true,
  };
  const ownerMembership = membership({
    id: 'membership-owner',
    membership_key: 'agency-a:owner-user',
    user_id: 'owner-user',
    user_email_normalized: 'owner@platform.test',
    tenant_role: 'manager',
  });
  for (const kind of ['get', 'list']) {
    for (const memberships of [
      [membership(), ownerMembership],
      [
        membership(),
        ownerMembership,
        { ...ownerMembership, id: 'membership-owner-duplicate' },
      ],
    ]) {
      const fixture = await loadBroker(kind, {
        caller: owner,
        memberships,
        superAdminEmail: 'owner@platform.test',
      });
      const result = await invoke(
        fixture.handler,
        kind === 'get' ? 'getAuthorizedDocument' : 'listAuthorizedDocuments',
        kind === 'get' ? getBody() : listBody(),
      );

      assert.equal(result.response.status, 409);
      assert.equal(result.json.error, 'Platform owner tenant membership must not exist');
      assert.equal(fixture.calls.memberships.length, 1);
      assert.deepEqual(fixture.calls.bindings, []);
      assert.deepEqual(fixture.calls.documents, []);
    }
  }
});

test('non-agency-wide list requires and re-proves one exact Patient scope', async () => {
  let fixture = await loadBroker('list');
  let result = await invoke(fixture.handler, 'listAuthorizedDocuments', listBody({ patient_id: null }));
  assert.equal(result.response.status, 403);
  assert.equal(fixture.calls.bindings.length, 0);

  const foreignPatient = patient({
    created_by_user_id: 'user-2',
    created_by_user_email_normalized: 'other@agency.test',
    created_by: 'other@agency.test',
    client_request_id: 'patient-request-b',
    patient_creation_key: 'agency-a:user-2:patient-request-b',
  });
  fixture = await loadBroker('list', { patients: [foreignPatient], assignments: [assignment()] });
  result = await invoke(fixture.handler, 'listAuthorizedDocuments', listBody());
  assert.equal(result.response.status, 200);
  assert.equal(fixture.calls.assignments.length, 3);
  assert.equal(fixture.calls.bindings[0].query.patient_id, 'patient-a');

  fixture = await loadBroker('list', {
    patients: [foreignPatient],
    assignments: [assignment({ assignee_membership_version_at_enablement: 1 })],
  });
  result = await invoke(fixture.handler, 'listAuthorizedDocuments', listBody());
  assert.equal(result.response.status, 409);
  assert.equal(fixture.calls.bindings.length, 0);

  fixture = await loadBroker('list', { patients: [foreignPatient] });
  result = await invoke(fixture.handler, 'listAuthorizedDocuments', listBody());
  assert.equal(result.response.status, 404);
  assert.equal(fixture.calls.bindings.length, 0);

  fixture = await loadBroker('list', {
    patients: [foreignPatient],
    assignments: [assignment({ user_email_normalized: 'different@agency.test' })],
  });
  result = await invoke(fixture.handler, 'listAuthorizedDocuments', listBody());
  assert.equal(result.response.status, 409);
  assert.equal(fixture.calls.bindings.length, 0);
});

test('list is bounded, ordered, keyset-paginated, and projects no file URL', async () => {
  const bindings = ['a', 'b', 'c'].map((suffix) => binding(suffix));
  const documents = ['a', 'b', 'c'].map((suffix) => document(suffix));
  const fixture = await loadBroker('list', { bindings, documents });
  let result = await invoke(fixture.handler, 'listAuthorizedDocuments', listBody({ page_size: 2 }));
  assert.equal(result.response.status, 200);
  assert.deepEqual(result.json.documents.map((row) => row.id), ['document-a', 'document-b']);
  assert.equal(result.json.documents.some((row) => Object.hasOwn(row, 'file_url')), false);
  assert.deepEqual(result.json.page, {
    page_size: 2,
    sort: 'document_id_asc',
    after_document_id: null,
    scanned_count: 2,
    returned_count: 2,
    has_more: true,
    next_cursor: result.json.page.next_cursor,
  });
  assert.equal(result.json.page.next_cursor.after_document_id, 'document-b');
  assert.equal(fixture.calls.bindings[0].limit, 11);

  result = await invoke(fixture.handler, 'listAuthorizedDocuments', listBody({
    page_size: 2,
    cursor: result.json.page.next_cursor,
  }));
  assert.equal(result.response.status, 200);
  assert.deepEqual(result.json.documents.map((row) => row.id), ['document-c']);
  assert.equal(result.json.page.has_more, false);
  assert.deepEqual(fixture.calls.bindings[3].query.document_id, { $gt: 'document-b' });

  for (const purpose of ['library', 'signature_queue']) {
    const purposeFixture = await loadBroker('list');
    const purposeResult = await invoke(
      purposeFixture.handler,
      'listAuthorizedDocuments',
      listBody({ purpose }),
    );
    assert.equal(purposeResult.response.status, 200);
    assert.equal(
      purposeResult.json.documents.some((row) => Object.hasOwn(row, 'file_url')),
      false,
    );
  }
});

test('list rejects cursor tampering, wrong-scope returns, duplicate ordering, and scan-cap overflow', async () => {
  let fixture = await loadBroker('list');
  let result = await invoke(fixture.handler, 'listAuthorizedDocuments', listBody({
    cursor: { after_document_id: 'document-a' },
  }));
  assert.equal(result.response.status, 400);
  assert.equal(fixture.calls.bindings.length, 0);

  fixture = await loadBroker('list', {
    bindings: [binding('x', { agency_id: 'agency-b' })],
    ignoreFilters: ['bindings'],
  });
  result = await invoke(fixture.handler, 'listAuthorizedDocuments', listBody());
  assert.equal(result.response.status, 409);

  fixture = await loadBroker('list', {
    bindings: [binding('a'), binding('b', { document_id: 'document-a' })],
    documents: [document('a')],
  });
  result = await invoke(fixture.handler, 'listAuthorizedDocuments', listBody());
  assert.equal(result.response.status, 409);

  fixture = await loadBroker('list', {
    bindings: [binding('a'), binding('b', { id: 'binding-a' })],
    documents: [document('a'), document('b')],
  });
  result = await invoke(fixture.handler, 'listAuthorizedDocuments', listBody());
  assert.equal(result.response.status, 409);

  const overflowBindings = Array.from({ length: 52 }, (_, index) => {
    const suffix = String(index).padStart(2, '0');
    return binding(suffix);
  });
  fixture = await loadBroker('list', {
    bindings: overflowBindings,
    documents: overflowBindings.map((row) => document(row.document_id.slice('document-'.length))),
    ignoreLimit: ['bindings'],
  });
  result = await invoke(fixture.handler, 'listAuthorizedDocuments', listBody());
  assert.equal(result.response.status, 409);
  assert.match(result.json.error, /scan cap/);
  assert.equal(fixture.calls.documents.length, 0);
});

test('list rejects binding, Document, Patient, and recheck drift instead of returning partial PHI', async () => {
  let fixture = await loadBroker('list', {
    bindings: [binding('a', { binding_key: 'f'.repeat(64) })],
  });
  assert.equal((await invoke(fixture.handler, 'listAuthorizedDocuments', listBody())).response.status, 409);

  fixture = await loadBroker('list', {
    responses: { documents: [[document()], [document('a', { is_locked: true })]] },
  });
  assert.equal((await invoke(fixture.handler, 'listAuthorizedDocuments', listBody())).response.status, 409);

  fixture = await loadBroker('list', { patients: [] });
  assert.equal((await invoke(fixture.handler, 'listAuthorizedDocuments', listBody())).response.status, 404);

  fixture = await loadBroker('list', {
    responses: {
      patients: [
        [patient()],
        [patient()],
        [patient({ updated_date: '2026-09-03T16:00:00.000Z' })],
      ],
    },
  });
  assert.equal((await invoke(fixture.handler, 'listAuthorizedDocuments', listBody())).response.status, 409);
});

test('list rechecks authority, binding, Document, Patient, and assignment at disclosure time', async () => {
  let fixture = await loadBroker('list', {
    callers: [USER, USER, { ...USER, is_active: false }],
  });
  let result = await invoke(fixture.handler, 'listAuthorizedDocuments', listBody());
  assert.equal(result.response.status, 403);
  assert.equal(Object.hasOwn(result.json, 'documents'), false);

  fixture = await loadBroker('list', {
    responses: {
      bindings: [
        [binding()],
        [binding()],
        [binding('a', { last_verified_at: '2026-09-03T16:00:00.000Z' })],
      ],
    },
  });
  result = await invoke(fixture.handler, 'listAuthorizedDocuments', listBody());
  assert.equal(result.response.status, 409);
  assert.equal(fixture.calls.bindings.length, 3);

  fixture = await loadBroker('list', {
    responses: {
      documents: [[document()], [document()], [document('a', { is_locked: true })]],
    },
  });
  result = await invoke(fixture.handler, 'listAuthorizedDocuments', listBody());
  assert.equal(result.response.status, 409);
  assert.equal(fixture.calls.documents.length, 3);

  const changedPatient = patient({ updated_date: '2026-09-03T16:00:00.000Z' });
  fixture = await loadBroker('list', {
    responses: {
      patients: [
        [patient()], [patient()], [patient()], [patient()],
        [changedPatient], [changedPatient],
      ],
    },
  });
  result = await invoke(fixture.handler, 'listAuthorizedDocuments', listBody());
  assert.equal(result.response.status, 409);
  assert.equal(fixture.calls.patients.length, 6);

  const foreignPatient = patient({
    created_by_user_id: 'user-2',
    created_by_user_email_normalized: 'other@agency.test',
    created_by: 'other@agency.test',
    client_request_id: 'patient-request-b',
    patient_creation_key: 'agency-a:user-2:patient-request-b',
  });
  fixture = await loadBroker('list', {
    patients: [foreignPatient],
    responses: {
      assignments: [
        [assignment()],
        [assignment()],
        [assignment({ version: 2 })],
      ],
    },
  });
  result = await invoke(fixture.handler, 'listAuthorizedDocuments', listBody());
  assert.equal(result.response.status, 409);
  assert.equal(fixture.calls.assignments.length, 3);

  fixture = await loadBroker('list', {
    patients: [foreignPatient],
    responses: {
      assignments: [
        [assignment()],
        [assignment()],
        [assignment({ status: 'suspended' })],
      ],
    },
  });
  result = await invoke(fixture.handler, 'listAuthorizedDocuments', listBody());
  assert.equal(result.response.status, 404);
  assert.equal(Object.hasOwn(result.json, 'documents'), false);
});

test('brokers reject non-POST and never echo provider error details', async () => {
  let fixture = await loadBroker('get');
  assert.equal((await invoke(fixture.handler, 'getAuthorizedDocument', {}, 'GET')).response.status, 405);
  fixture = await loadBroker('list', {
    responses: { bindings: [new Error('secret patient filename')] },
  });
  const result = await invoke(fixture.handler, 'listAuthorizedDocuments', listBody());
  assert.equal(result.response.status, 500);
  assert.deepEqual(result.json, { error: 'Internal server error' });
});
