import assert from 'node:assert/strict';
import { readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import JSON5 from 'json5';
import { transpileTs } from '../../tools-transpile-ts.mjs';

const brokerUrl = new URL('../functions/createAuthorizedDocument/entry.ts', import.meta.url);
const bindingEntityUrl = new URL('../entities/DocumentTenantBinding.jsonc', import.meta.url);
const documentEntityUrl = new URL('../entities/Document.jsonc', import.meta.url);
const wrapperUrl = new URL('../../src/functions/createAuthorizedDocument.js', import.meta.url);
const sourceRootUrl = new URL('../../src/', import.meta.url);

const NOW = '2026-09-04T12:00:00.000Z';
const USER = {
  id: 'user-a',
  email: 'Clinician@Agency.test',
  role: 'user',
  is_active: true,
  is_verified: true,
};

const agency = (overrides = {}) => ({
  id: 'agency-a',
  agency_name: 'Agency A',
  status: 'active',
  ...overrides,
});

const membership = (overrides = {}) => ({
  id: 'membership-a',
  membership_key: 'agency-a:user-a',
  agency_id: 'agency-a',
  user_id: 'user-a',
  user_email_normalized: 'clinician@agency.test',
  tenant_role: 'clinician',
  status: 'active',
  created_by_user_id: 'owner-a',
  last_transition_by_user_id: 'owner-a',
  last_transition_by_email_normalized: 'owner@platform.test',
  last_transition_at: NOW,
  last_transition_reason: 'Approved document uploader',
  activated_at: NOW,
  version: 2,
  ...overrides,
});

const patient = (overrides = {}) => ({
  id: 'patient-a',
  agency_id: 'agency-a',
  created_by_user_id: 'user-a',
  created_by_user_email_normalized: 'clinician@agency.test',
  created_by: 'clinician@agency.test',
  client_request_id: 'patient-create-a',
  patient_creation_key: 'agency-a:user-a:patient-create-a',
  status: 'active',
  is_sample: false,
  is_archived: false,
  first_name: 'Private',
  last_name: 'Patient',
  ...overrides,
});

const assignment = (overrides = {}) => ({
  id: 'assignment-a',
  assignment_key: 'agency-a:patient-a:user-a',
  agency_id: 'agency-a',
  patient_id: 'patient-a',
  user_id: 'user-a',
  user_email_normalized: 'clinician@agency.test',
  assignee_membership_id: 'membership-a',
  assignee_membership_version_at_enablement: 2,
  status: 'active',
  source: 'manual',
  created_by_user_id: 'admin-a',
  created_by_user_email_normalized: 'admin@agency.test',
  activated_at: NOW,
  last_transition_by_user_id: 'admin-a',
  last_transition_by_email_normalized: 'admin@agency.test',
  last_transition_at: NOW,
  last_transition_reason: 'Assigned clinician',
  last_transition_action: 'grant',
  last_transition_request_id: 'assignment-request-a',
  last_transition_request_key: 'agency-a:patient-a:user-a:assignment-request-a',
  version: 1,
  ...overrides,
});

const assignedPatient = (overrides = {}) => patient({
  created_by_user_id: 'admin-a',
  created_by_user_email_normalized: 'admin@agency.test',
  created_by: 'admin@agency.test',
  client_request_id: 'patient-create-admin-a',
  patient_creation_key: 'agency-a:admin-a:patient-create-admin-a',
  ...overrides,
});

const pdfFile = (name = 'clinical-note.pdf', contents = 'exact-pdf-content') =>
  new File([`%PDF-${contents}`], name, { type: 'application/pdf' });

function matches(row, query) {
  return Object.entries(query || {}).every(([field, value]) => row?.[field] === value);
}

async function importHandler(makeClient) {
  let source = await readFile(brokerUrl, 'utf8');
  const globalName = `__documentCreateClient_${Math.random().toString(36).slice(2)}`;
  source = source.replace(
    /import\s+\{\s*createClientFromRequest\s*\}\s+from\s+'npm:[^']+';/,
    `const createClientFromRequest = globalThis.${globalName};`,
  );
  const temporaryModule = join(
    tmpdir(),
    `document_create_${Date.now()}_${Math.random().toString(36).slice(2)}.mjs`,
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

async function loadBroker({
  caller = USER,
  callers = null,
  agencies = [agency()],
  memberships = [membership()],
  patients = [patient()],
  assignments = [],
  documents = [],
  bindings = [],
  ignoreFilters = false,
  membershipResponses = null,
  agencyResponses = null,
  patientResponses = null,
  assignmentResponses = null,
  documentFilterMutation = null,
  documentCreateMutation = null,
  bindingCreateMutation = null,
  bindingCreateError = null,
  duplicateBindingOnCreate = false,
  uploadResult = { file_uri: 'private/document-a.pdf' },
  uploadError = null,
} = {}) {
  const clone = (value) => structuredClone(value);
  const state = {
    agencies: clone(agencies),
    memberships: clone(memberships),
    patients: clone(patients),
    assignments: clone(assignments),
    documents: clone(documents),
    bindings: clone(bindings),
  };
  const calls = {
    auth: 0,
    serviceRole: 0,
    agencies: [],
    memberships: [],
    patients: [],
    assignments: [],
    documentFilters: [],
    bindingFilters: [],
    documentCreates: [],
    bindingCreates: [],
    documentDeletes: [],
    uploads: [],
    events: [],
  };
  let membershipIndex = 0;
  let agencyIndex = 0;
  let patientIndex = 0;
  let assignmentIndex = 0;
  const selected = (responses, index, fallback) => (
    responses ? responses[Math.min(index, responses.length - 1)] : fallback
  );
  const filtered = (rows, query, limit) => {
    if (!Array.isArray(rows)) return rows;
    const output = ignoreFilters ? rows : rows.filter((row) => matches(row, query));
    return Number.isFinite(limit) ? output.slice(0, limit) : output;
  };

  const serviceRole = {
    entities: {
      AgencyMembership: {
        filter: async (query, sort, limit) => {
          calls.events.push('AgencyMembership.filter');
          calls.memberships.push({ query: clone(query), sort, limit });
          const rows = selected(
            membershipResponses,
            membershipIndex++,
            state.memberships,
          );
          return filtered(clone(rows), query, limit);
        },
      },
      Agency: {
        filter: async (query, sort, limit) => {
          calls.events.push('Agency.filter');
          calls.agencies.push({ query: clone(query), sort, limit });
          const rows = selected(agencyResponses, agencyIndex++, state.agencies);
          return filtered(clone(rows), query, limit);
        },
      },
      Patient: {
        filter: async (query, sort, limit) => {
          calls.events.push('Patient.filter');
          calls.patients.push({ query: clone(query), sort, limit });
          const rows = selected(patientResponses, patientIndex++, state.patients);
          return filtered(clone(rows), query, limit);
        },
      },
      PatientCareTeamAssignment: {
        filter: async (query, sort, limit, offset, fields) => {
          calls.events.push('PatientCareTeamAssignment.filter');
          calls.assignments.push({ query: clone(query), sort, limit, offset, fields });
          const rows = selected(
            assignmentResponses,
            assignmentIndex++,
            state.assignments,
          );
          return filtered(clone(rows), query, limit);
        },
      },
      Document: {
        filter: async (query, sort, limit) => {
          calls.events.push('Document.filter');
          calls.documentFilters.push({ query: clone(query), sort, limit });
          const rows = filtered(clone(state.documents), query, limit);
          return documentFilterMutation
            ? rows.map((row) => ({ ...row, ...documentFilterMutation }))
            : rows;
        },
        create: async (payload) => {
          calls.events.push('Document.create');
          calls.documentCreates.push(clone(payload));
          const row = { id: `document-${state.documents.length + 1}`, ...clone(payload) };
          if (documentCreateMutation) Object.assign(row, clone(documentCreateMutation));
          state.documents.push(row);
          return clone(row);
        },
        delete: async (id) => {
          calls.events.push('Document.delete');
          calls.documentDeletes.push(id);
          state.documents = state.documents.filter((row) => row.id !== id);
        },
      },
      DocumentTenantBinding: {
        filter: async (query, sort, limit) => {
          calls.events.push('DocumentTenantBinding.filter');
          calls.bindingFilters.push({ query: clone(query), sort, limit });
          return filtered(clone(state.bindings), query, limit);
        },
        create: async (payload) => {
          calls.events.push('DocumentTenantBinding.create');
          calls.bindingCreates.push(clone(payload));
          if (bindingCreateError) throw bindingCreateError;
          const row = { id: `binding-${state.bindings.length + 1}`, ...clone(payload) };
          if (bindingCreateMutation) Object.assign(row, clone(bindingCreateMutation));
          state.bindings.push(row);
          if (duplicateBindingOnCreate) {
            state.bindings.push({ ...clone(row), id: 'binding-concurrent' });
          }
          return clone(row);
        },
      },
    },
    integrations: {
      Core: {
        UploadPrivateFile: async ({ file }) => {
          calls.events.push('UploadPrivateFile');
          calls.uploads.push(file);
          if (uploadError) throw uploadError;
          return clone(uploadResult);
        },
      },
    },
  };
  const client = {
    auth: {
      me: async () => {
        calls.events.push('auth.me');
        const value = callers
          ? callers[Math.min(calls.auth, callers.length - 1)]
          : caller;
        calls.auth += 1;
        if (value instanceof Error) throw value;
        return clone(value);
      },
    },
    get asServiceRole() {
      calls.serviceRole += 1;
      return serviceRole;
    },
  };
  const handler = await importHandler(() => client);
  return { handler, calls, state };
}

function uploadRequest({
  file = pdfFile(),
  agencyId = 'agency-a',
  patientId = 'patient-a',
  purpose = 'patient_document',
  clientRequestId = 'request-a',
  method = 'POST',
  extra = [],
  omit = [],
  duplicate = [],
} = {}) {
  if (method !== 'POST') return new Request('http://local/createAuthorizedDocument', { method });
  const form = new FormData();
  const entries = [
    ['file', file],
    ['agency_id', agencyId],
    ['patient_id', patientId],
    ['purpose', purpose],
    ['client_request_id', clientRequestId],
  ];
  for (const [field, value] of entries) {
    if (!omit.includes(field) && value !== null && value !== undefined) form.append(field, value);
  }
  for (const [field, value] of extra) form.append(field, value);
  for (const [field, value] of duplicate) form.append(field, value);
  return new Request('http://local/createAuthorizedDocument', { method, body: form });
}

async function invoke(handler, options = {}) {
  const response = await handler(uploadRequest(options));
  return { response, json: await response.json() };
}

async function sourceFiles(directoryUrl) {
  const output = [];
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (['.js', '.jsx', '.ts', '.tsx'].includes(extname(entry.name))) output.push(path);
    }
  }
  await walk(directoryUrl.pathname);
  return output;
}

test('DocumentTenantBinding is service-owned while direct Document mutation debt only permits the legacy uploader', async () => {
  const bindingSchema = JSON5.parse(await readFile(bindingEntityUrl, 'utf8'));
  const documentSchema = JSON5.parse(await readFile(documentEntityUrl, 'utf8'));
  assert.equal(bindingSchema.name, 'DocumentTenantBinding');
  assert.deepEqual(bindingSchema.rls, {
    create: false,
    read: false,
    update: false,
    delete: false,
  });
  for (const field of [
    'binding_key', 'document_id', 'agency_id', 'created_by_user_id',
    'created_by_user_email_normalized', 'membership_id', 'membership_version',
    'document_created_by_email_normalized', 'storage_mode', 'file_uri', 'file_name', 'file_type',
    'file_size', 'content_sha256', 'client_request_id', 'purpose', 'version',
    'created_at', 'last_verified_at',
  ]) {
    assert.ok(bindingSchema.required.includes(field), field);
  }
  assert.deepEqual(bindingSchema.properties.storage_mode.enum, ['private']);
  assert.equal(Object.hasOwn(bindingSchema.properties, 'file_url'), false);
  assert.equal(bindingSchema.properties.version.default, 2);
  assert.deepEqual(bindingSchema.properties.purpose.enum, ['patient_document', 'referral']);
  assert.notEqual(documentSchema.rls.create, false);
  assert.equal(documentSchema.rls.update, false);
  assert.equal(documentSchema.rls.delete, false);

  const wrapper = await readFile(wrapperUrl, 'utf8');
  assert.match(wrapper, /functions\.invoke\('createAuthorizedDocument', payload\)/);
  assert.doesNotMatch(
    wrapper,
    /integrations\.Core\.(?:UploadFile|UploadPrivateFile)|entities\.Document\./,
  );
  const wired = [];
  for (const path of await sourceFiles(sourceRootUrl)) {
    if (path === wrapperUrl.pathname || path.endsWith('createAuthorizedDocument.spec.js')) continue;
    const source = await readFile(path, 'utf8');
    if (/createAuthorizedDocument/.test(source)) wired.push(path);
  }
  assert.deepEqual(wired, [], `broker must remain unwired: ${wired.join(', ')}`);

  const directMutations = { create: [], update: [], delete: [] };
  for (const path of await sourceFiles(sourceRootUrl)) {
    if (/\.(?:test|spec)\.[^.]+$/.test(path)) continue;
    const source = await readFile(path, 'utf8');
    for (const operation of Object.keys(directMutations)) {
      if (new RegExp(`base44\\.entities\\.Document\\.${operation}\\s*\\(`).test(source)) {
        directMutations[operation].push(path);
      }
    }
  }
  assert.deepEqual(directMutations.update, [], 'browser Document.update must remain denied');
  assert.deepEqual(directMutations.delete, [], 'hard deletion is unavailable');
  assert.equal(directMutations.create.length, 1, 'only the pinned legacy uploader create debt may remain');
  assert.ok(
    directMutations.create[0].endsWith('/components/documents/DocumentUploader.jsx'),
    directMutations.create[0],
  );
});

test('authorized patient upload orders authority, private upload, metadata create, binding, and readbacks', async () => {
  const runtime = await loadBroker();
  const file = pdfFile();
  const { response, json } = await invoke(runtime.handler, { file });

  assert.equal(response.status, 200);
  assert.equal(json.success, true);
  assert.equal(json.created, true);
  assert.deepEqual(Object.keys(json).sort(), ['binding', 'created', 'document', 'scope', 'success']);
  assert.deepEqual(Object.keys(json.document).sort(), [
    'category', 'file_name', 'file_size', 'file_type', 'id', 'patient_id',
  ]);
  assert.equal(JSON.stringify(json).includes('file_uri'), false);
  assert.equal(JSON.stringify(json).includes('private/document-a.pdf'), false);
  assert.deepEqual(Object.keys(json.binding).sort(), ['client_request_id', 'id', 'version']);
  assert.equal(runtime.calls.uploads.length, 1);
  assert.ok(runtime.calls.uploads[0] instanceof File);
  assert.equal(runtime.calls.uploads[0].name, file.name);
  assert.equal(runtime.calls.uploads[0].type, file.type);
  assert.equal(runtime.calls.uploads[0].size, file.size);
  assert.deepEqual(
    new Uint8Array(await runtime.calls.uploads[0].arrayBuffer()),
    new Uint8Array(await file.arrayBuffer()),
  );
  assert.equal(runtime.calls.documentCreates.length, 1);
  assert.equal(runtime.calls.bindingCreates.length, 1);
  assert.ok(runtime.calls.events.indexOf('AgencyMembership.filter') < runtime.calls.events.indexOf('UploadPrivateFile'));
  assert.ok(runtime.calls.events.indexOf('UploadPrivateFile') < runtime.calls.events.indexOf('Document.create'));
  assert.ok(runtime.calls.events.indexOf('Document.create') < runtime.calls.events.indexOf('DocumentTenantBinding.create'));
  assert.ok(runtime.calls.memberships.length >= 4, 'authority must be rechecked around irreversible work');
  assert.ok(runtime.calls.patients.length >= 4);

  const document = runtime.calls.documentCreates[0];
  assert.deepEqual(document, {
    title: 'clinical-note.pdf',
    file_name: 'clinical-note.pdf',
    file_size: file.size,
    file_type: 'application/pdf',
    category: 'other',
    patient_id: 'patient-a',
    tags: ['patient_document'],
    document_date: document.document_date,
    uploaded_by: 'clinician@agency.test',
    created_by: 'clinician@agency.test',
    is_sensitive: true,
  });
  assert.equal(Object.hasOwn(document, 'file_url'), false);
  assert.equal(Object.hasOwn(document, 'file_uri'), false);
  assert.match(document.document_date, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(Object.hasOwn(document, 'agency_id'), false);

  const binding = runtime.calls.bindingCreates[0];
  assert.equal(binding.agency_id, 'agency-a');
  assert.equal(binding.patient_id, 'patient-a');
  assert.equal(binding.created_by_user_id, 'user-a');
  assert.equal(binding.created_by_user_email_normalized, 'clinician@agency.test');
  assert.equal(binding.membership_id, 'membership-a');
  assert.equal(binding.membership_version, 2);
  assert.equal(binding.document_created_by_email_normalized, 'clinician@agency.test');
  assert.equal(binding.storage_mode, 'private');
  assert.equal(binding.file_uri, 'private/document-a.pdf');
  assert.match(binding.binding_key, /^[a-f0-9]{64}$/);
  assert.match(binding.content_sha256, /^[a-f0-9]{64}$/);
  assert.equal(binding.version, 2);
  assert.equal(json.scope.agency_id, 'agency-a');
  assert.equal(json.scope.membership_version, 2);
});

test('referral purpose supports an exact agency binding without a forged Patient link', async () => {
  const runtime = await loadBroker({ memberships: [membership({ tenant_role: 'manager' })] });
  const { response, json } = await invoke(runtime.handler, {
    file: pdfFile('referral.pdf'),
    patientId: null,
    purpose: 'referral',
  });
  assert.equal(response.status, 200);
  assert.equal(runtime.calls.patients.length, 0);
  assert.equal(runtime.calls.documentCreates[0].category, 'referral');
  assert.equal(Object.hasOwn(runtime.calls.documentCreates[0], 'patient_id'), false);
  assert.equal(Object.hasOwn(runtime.calls.bindingCreates[0], 'patient_id'), false);
  assert.equal(json.document.patient_id, null);
  assert.equal(json.scope.patient_id, null);
});

test('method and authentication failures occur before multipart parsing or service-role access', async () => {
  const getRuntime = await loadBroker();
  const get = await invoke(getRuntime.handler, { method: 'GET' });
  assert.equal(get.response.status, 405);
  assert.equal(get.response.headers.get('allow'), 'POST');
  assert.equal(getRuntime.calls.auth, 0);
  assert.equal(getRuntime.calls.serviceRole, 0);

  for (const scenario of [
    { caller: new Error('login required'), status: 401 },
    { caller: null, status: 401 },
    { caller: { ...USER, is_active: false }, status: 403 },
    { caller: { ...USER, disabled: true }, status: 403 },
    { caller: { ...USER, is_service: true }, status: 403 },
    { caller: { ...USER, is_verified: false }, status: 403 },
    { caller: { ...USER, id: { $ne: null } }, status: 403 },
  ]) {
    const runtime = await loadBroker({ caller: scenario.caller });
    const result = await invoke(runtime.handler);
    assert.equal(result.response.status, scenario.status);
    assert.equal(runtime.calls.serviceRole, 0);
    assert.equal(runtime.calls.uploads.length, 0);
  }
});

test('only exact finite multipart File input reaches authority checks', async () => {
  const invalidRequests = [
    { extra: [['file_url', 'https://attacker.test/a.pdf']] },
    { extra: [['created_by', 'attacker@example.test']] },
    { extra: [['uploaded_by', 'attacker@example.test']] },
    { extra: [['agency_name', 'Forged Agency']] },
    { duplicate: [['agency_id', 'agency-b']] },
    { duplicate: [['file', pdfFile('second.pdf')]] },
    { file: pdfFile('../escape.pdf') },
    { file: new File(['x'], 'note.exe', { type: 'application/pdf' }) },
    { file: new File(['x'], 'note.pdf', { type: 'text/plain' }) },
    { file: new File([], 'empty.pdf', { type: 'application/pdf' }) },
    { agencyId: '$agency' },
    { patientId: '$patient' },
    { purpose: 'all_documents' },
    { purpose: 'patient_document', patientId: null },
    { clientRequestId: ' request-a ' },
  ];
  for (const options of invalidRequests) {
    const runtime = await loadBroker();
    const result = await invoke(runtime.handler, options);
    assert.ok([400, 413].includes(result.response.status), JSON.stringify(options));
    assert.equal(runtime.calls.serviceRole, 0, JSON.stringify(options));
    assert.equal(runtime.calls.uploads.length, 0, JSON.stringify(options));
  }

  const runtime = await loadBroker();
  const raw = new Request('http://local/createAuthorizedDocument', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  const response = await runtime.handler(raw);
  assert.equal(response.status, 415);
  assert.equal(runtime.calls.serviceRole, 0);

  const pngBytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]);
  const pngRuntime = await loadBroker();
  const png = await invoke(pngRuntime.handler, {
    file: new File([pngBytes], 'scan.png', { type: 'image/png' }),
  });
  assert.equal(png.response.status, 200);

  const jpegRuntime = await loadBroker();
  const jpeg = await invoke(jpegRuntime.handler, {
    file: new File([Uint8Array.from([0xff, 0xd8, 0xff, 0xe0])], 'scan.jpg', {
      type: 'image/jpeg',
    }),
  });
  assert.equal(jpeg.response.status, 200);

  const disguisedRuntime = await loadBroker();
  const disguised = await invoke(disguisedRuntime.handler, {
    file: new File(['<script>'], 'active.pdf', { type: 'application/pdf' }),
  });
  assert.equal(disguised.response.status, 400);
  assert.equal(disguisedRuntime.calls.uploads.length, 0);
  assert.equal(disguisedRuntime.calls.documentCreates.length, 0);
});

test('File.size caps a multipart request even when Content-Length is absent', async () => {
  const runtime = await loadBroker();
  const file = new File(
    [new Uint8Array((25 * 1024 * 1024) + 1)],
    'oversize.pdf',
    { type: 'application/pdf' },
  );
  const request = uploadRequest({ file });
  assert.equal(request.headers.get('content-length'), null);
  const response = await runtime.handler(request);
  assert.equal(response.status, 413);
  assert.equal(runtime.calls.serviceRole, 0);
  assert.equal(runtime.calls.uploads.length, 0);
});

test('membership roles, lifecycle integrity, Agency state, and immutable Patient provenance fail closed', async () => {
  for (const role of ['agency_admin', 'manager', 'clinician']) {
    const runtime = await loadBroker({ memberships: [membership({ tenant_role: role })] });
    assert.equal((await invoke(runtime.handler)).response.status, 200, role);
  }
  for (const role of ['office_staff', 'social_worker', 'spiritual_care']) {
    const runtime = await loadBroker({ memberships: [membership({ tenant_role: role })] });
    assert.equal((await invoke(runtime.handler)).response.status, 403, role);
    assert.equal(runtime.calls.uploads.length, 0);
  }

  const corruptions = [
    { memberships: [] },
    { memberships: [membership(), membership({ id: 'duplicate' })] },
    { memberships: [membership({ status: 'suspended' })] },
    { memberships: [membership({ membership_key: 'agency-a:attacker' })] },
    { agencies: [agency({ status: 'suspended' })] },
    { patients: [patient({ agency_id: 'agency-b' })], ignoreFilters: true },
    { patients: [patient({ patient_creation_key: 'forged' })] },
    { patients: [patient({ is_archived: true })], ignoreFilters: true },
    {
      patients: [patient({
        created_by_user_id: 'user-b',
        created_by_user_email_normalized: 'other@agency.test',
        created_by: 'other@agency.test',
        client_request_id: 'patient-create-b',
        patient_creation_key: 'agency-a:user-b:patient-create-b',
      })],
    },
  ];
  for (const options of corruptions) {
    const runtime = await loadBroker(options);
    const result = await invoke(runtime.handler);
    assert.ok([403, 404, 409].includes(result.response.status));
    assert.equal(runtime.calls.uploads.length, 0);
    assert.equal(runtime.calls.documentCreates.length, 0);
  }
});

test('assigned clinician upload requires one exact active assignment bound to current membership', async () => {
  const authorized = await loadBroker({
    patients: [assignedPatient()],
    assignments: [assignment()],
  });
  const accepted = await invoke(authorized.handler);
  assert.equal(accepted.response.status, 200);
  assert.ok(
    authorized.calls.assignments.length >= 4,
    'assignment authority must be rechecked around irreversible work',
  );
  for (const call of authorized.calls.assignments) {
    assert.deepEqual(call.query, {
      assignment_key: 'agency-a:patient-a:user-a',
      agency_id: 'agency-a',
      patient_id: 'patient-a',
      user_id: 'user-a',
    });
    assert.equal(call.sort, '-updated_date');
    assert.equal(call.limit, 10);
    assert.ok(call.fields.includes('assignee_membership_version_at_enablement'));
    assert.ok(call.fields.includes('last_transition_request_key'));
  }
  assert.ok(
    authorized.calls.events.indexOf('PatientCareTeamAssignment.filter')
      < authorized.calls.events.indexOf('UploadPrivateFile'),
  );

  const failures = [
    { assignments: [], expected: 404 },
    {
      assignments: [assignment({
        status: 'suspended',
        suspended_at: NOW,
        last_transition_action: 'suspend',
      })],
      expected: 404,
    },
    { assignments: [assignment(), assignment({ id: 'assignment-duplicate' })], expected: 409 },
    {
      assignments: [assignment({ assignee_membership_id: 'membership-old' })],
      expected: 409,
    },
    {
      assignments: [assignment({ assignee_membership_version_at_enablement: 1 })],
      expected: 409,
    },
    {
      assignments: [assignment({ user_email_normalized: 'other@agency.test' })],
      expected: 409,
    },
    {
      assignments: [assignment({ assignment_key: 'agency-b:patient-a:user-a' })],
      ignoreFilters: true,
      expected: 409,
    },
    {
      assignments: [assignment({ agency_id: 'agency-b' })],
      ignoreFilters: true,
      expected: 409,
    },
    {
      assignments: [assignment({ patient_id: 'patient-b' })],
      ignoreFilters: true,
      expected: 409,
    },
    {
      assignments: [assignment({ user_id: 'user-b' })],
      ignoreFilters: true,
      expected: 409,
    },
    {
      assignments: [assignment({ last_transition_request_key: 'forged' })],
      expected: 409,
    },
  ];
  for (const scenario of failures) {
    const runtime = await loadBroker({
      patients: [assignedPatient()],
      assignments: scenario.assignments,
      ignoreFilters: scenario.ignoreFilters,
    });
    const result = await invoke(runtime.handler);
    assert.equal(result.response.status, scenario.expected, JSON.stringify(scenario.assignments));
    assert.equal(runtime.calls.uploads.length, 0);
    assert.equal(runtime.calls.documentCreates.length, 0);
    assert.equal(runtime.calls.bindingCreates.length, 0);
  }
});

test('assigned-clinician authority drift after private upload prevents metadata creation', async () => {
  const changedAssignment = assignment({
    version: 2,
    last_transition_action: 'activate',
    last_transition_request_id: 'assignment-request-b',
    last_transition_request_key: 'agency-a:patient-a:user-a:assignment-request-b',
    last_transition_reason: 'Reactivated assignment',
  });
  const runtime = await loadBroker({
    patients: [assignedPatient()],
    assignments: [assignment()],
    assignmentResponses: [
      [assignment()],
      [assignment()],
      [changedAssignment],
    ],
  });
  const { response, json } = await invoke(runtime.handler);
  assert.equal(response.status, 409);
  assert.match(json.error, /authority changed/);
  assert.equal(runtime.calls.uploads.length, 1);
  assert.equal(runtime.calls.documentCreates.length, 0);
  assert.equal(runtime.calls.bindingCreates.length, 0);
});

test('authority drift after UploadPrivateFile prevents Document and binding creation', async () => {
  const runtime = await loadBroker({
    membershipResponses: [
      [membership()],
      [membership()],
      [membership({ tenant_role: 'manager', version: 3 })],
    ],
  });
  const { response, json } = await invoke(runtime.handler);
  assert.equal(response.status, 409);
  assert.match(json.error, /authority changed/);
  assert.equal(runtime.calls.uploads.length, 1);
  assert.equal(runtime.calls.documentCreates.length, 0);
  assert.equal(runtime.calls.bindingCreates.length, 0);
});

test('binding creation or verification failure compensates only the request-created Document', async () => {
  const createFailure = await loadBroker({ bindingCreateError: new Error('binding unavailable') });
  const failed = await invoke(createFailure.handler);
  assert.equal(failed.response.status, 500);
  assert.deepEqual(createFailure.calls.documentDeletes, ['document-1']);
  assert.equal(createFailure.state.documents.length, 0);

  const verificationFailure = await loadBroker({
    bindingCreateMutation: { file_uri: 'private/replaced.pdf' },
  });
  const mismatched = await invoke(verificationFailure.handler);
  assert.equal(mismatched.response.status, 409);
  assert.deepEqual(verificationFailure.calls.documentDeletes, ['document-1']);
  assert.equal(verificationFailure.state.documents.length, 0);
  assert.equal(verificationFailure.state.bindings.length, 1, 'immutable evidence is not deleted');

  const duplicate = await loadBroker({ duplicateBindingOnCreate: true });
  const concurrent = await invoke(duplicate.handler);
  assert.equal(concurrent.response.status, 409);
  assert.deepEqual(duplicate.calls.documentDeletes, ['document-1']);
  assert.equal(duplicate.state.documents.length, 0);
});

test('scoped idempotent replay returns the exact binding without a second upload or create', async () => {
  const runtime = await loadBroker();
  const first = await invoke(runtime.handler);
  assert.equal(first.response.status, 200);
  assert.equal(first.json.created, true);
  const second = await invoke(runtime.handler);
  assert.equal(second.response.status, 200);
  assert.equal(second.json.created, false);
  assert.equal(second.json.document.id, first.json.document.id);
  assert.equal(runtime.calls.uploads.length, 1);
  assert.equal(runtime.calls.documentCreates.length, 1);
  assert.equal(runtime.calls.bindingCreates.length, 1);

  const conflict = await invoke(runtime.handler, {
    file: pdfFile('clinical-note.pdf', 'different-content-same-name'),
  });
  assert.equal(conflict.response.status, 409);
  assert.match(conflict.json.error, /conflicts/);
  assert.equal(runtime.calls.uploads.length, 1, 'conflicting replay is rejected before upload');
  assert.equal(runtime.calls.documentCreates.length, 1);
});

test('exact readback drift is compensated and runtime logs never receive PHI-bearing details', async () => {
  const runtime = await loadBroker({
    documentFilterMutation: { uploaded_by: 'other@agency.test' },
  });
  const response = await invoke(runtime.handler);
  assert.equal(response.response.status, 500);
  assert.deepEqual(runtime.calls.documentDeletes, ['document-1']);

  const logged = [];
  const original = console.error;
  console.error = (...args) => logged.push(args);
  try {
    const failedRuntime = await loadBroker({ uploadError: new Error('patient-a clinical-note.pdf') });
    const failed = await invoke(failedRuntime.handler);
    assert.equal(failed.response.status, 500);
  } finally {
    console.error = original;
  }
  assert.deepEqual(logged, [['createAuthorizedDocument failed']]);

  const source = await readFile(brokerUrl, 'utf8');
  assert.doesNotMatch(source, /console\.(?:log|warn)\s*\(/);
  assert.doesNotMatch(source, /console\.error\([^)]*,/);
  assert.match(source, /UploadPrivateFile\(\{\s*file: input\.file,?\s*\}\)/);
  assert.doesNotMatch(source, /\.UploadFile\s*\(/);
  assert.doesNotMatch(source, /req\.json\s*\(/);
  assert.doesNotMatch(source, /DocumentTenantBinding\.delete|DocumentTenantBinding\.update/);
});

test('invalid private upload pointers fail closed before metadata creation and are never logged', async () => {
  for (const fileUri of [
    'https://files.base44.app/public.pdf',
    ' private/document-a.pdf',
    'private/document-a.pdf\n',
    'public/document-a.pdf',
  ]) {
    const logged = [];
    const original = console.error;
    console.error = (...args) => logged.push(args);
    try {
      const runtime = await loadBroker({ uploadResult: { file_uri: fileUri } });
      const { response, json } = await invoke(runtime.handler);
      assert.equal(response.status, 500, fileUri);
      assert.deepEqual(json, { error: 'Internal server error' });
      assert.equal(runtime.calls.uploads.length, 1);
      assert.equal(runtime.calls.documentCreates.length, 0);
      assert.equal(runtime.calls.bindingCreates.length, 0);
    } finally {
      console.error = original;
    }
    assert.deepEqual(logged, [['createAuthorizedDocument failed']]);
  }
});
