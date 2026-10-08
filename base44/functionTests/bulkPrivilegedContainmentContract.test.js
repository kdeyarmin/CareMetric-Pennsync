import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { transpileTs } from '../../tools-transpile-ts.mjs';

// processPatientFileUpdate left this owner-only list on 2026-10-08 (owner
// decision): it is now an agency-administrator import scoped to one agency,
// pinned by its own tests at the end of this file.
const FUNCTION_NAMES = [
  'processDischargeReport',
];

// processDischargeReport was statically paused here until the owner released
// bulk discharge on 2026-10-08. It now answers like the others: forged and
// misconfigured callers are refused before the body is read, and the agency
// administrator path is scoped to one agency (pinned below).
const STATICALLY_PAUSED_FUNCTIONS = new Set([]);

// Functions whose admitted callers also include a service-owned agency
// administrator, so their gate reads the membership-derived claims.
const AGENCY_ADMIN_FUNCTIONS = new Set([
  'processDischargeReport',
]);

function makeClient({
  user,
  referralRows = [],
  tokenRows = [],
} = {}) {
  const calls = {
    bodyReads: 0,
    patientLists: [],
    patientCreates: [],
    patientUpdates: [],
    referralFilters: [],
    tokenFilters: [],
    tokenUpdates: [],
    tokenCreates: [],
    userLists: 0,
    systemLogs: [],
    extractions: [],
  };

  const client = {
    auth: { me: async () => user },
    asServiceRole: {
      entities: {
        Patient: {
          list: async (...args) => {
            calls.patientLists.push(args);
            return [];
          },
          create: async (row) => {
            calls.patientCreates.push(row);
            return { id: 'patient-created', ...row };
          },
          update: async (...args) => {
            calls.patientUpdates.push(args);
            return {};
          },
        },
        User: {
          list: async () => {
            calls.userLists += 1;
            throw new Error('mutable agency membership must not be consulted');
          },
        },
        Referral: {
          filter: async (...args) => {
            calls.referralFilters.push(args);
            return referralRows;
          },
        },
        ProviderFollowUpToken: {
          filter: async (...args) => {
            calls.tokenFilters.push(args);
            return tokenRows;
          },
          update: async (...args) => {
            calls.tokenUpdates.push(args);
            return {};
          },
          create: async (row) => {
            calls.tokenCreates.push(row);
            return { id: 'token-created', ...row };
          },
        },
        SystemLog: {
          create: async (row) => {
            calls.systemLogs.push(row);
            return { id: 'log-created', ...row };
          },
        },
      },
      integrations: {
        Core: {
          ExtractDataFromUploadedFile: async (args) => {
            calls.extractions.push(args);
            return { status: 'success', output: { discharged_patients: [] } };
          },
        },
      },
    },
  };

  return { client, calls };
}

async function loadHandler(functionName, client, superAdminEmail = '') {
  let source = await readFile(
    new URL(`../functions/${functionName}/entry.ts`, import.meta.url),
    'utf8',
  );
  source = source.replace(
    /import\s+\{[^}]*\}\s+from\s+'npm:[^']*';?/,
    'const createClientFromRequest = globalThis.__bulkContainmentMakeClient;',
  );

  const temporaryModule = join(
    tmpdir(),
    `bulk_containment_${functionName}_${Date.now()}_${Math.random().toString(36).slice(2)}.mjs`,
  );
  await writeFile(temporaryModule, transpileTs(source).outputText);

  let handler;
  globalThis.__bulkContainmentMakeClient = () => client;
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
  return handler;
}

async function invoke(handler, calls, body) {
  const response = await handler({
    json: async () => {
      calls.bodyReads += 1;
      return body;
    },
  });
  return { response, json: await response.json() };
}

function privilegedCallCount(calls) {
  return calls.patientLists.length
    + calls.patientCreates.length
    + calls.patientUpdates.length
    + calls.referralFilters.length
    + calls.tokenFilters.length
    + calls.tokenUpdates.length
    + calls.tokenCreates.length
    + calls.userLists
    + calls.systemLogs.length
    + calls.extractions.length;
}

test('bulk and bearer-link handlers reject forged mutable privilege before body or service reads', async () => {
  const callers = [
    {
      email: 'platform-owner@example.com',
      role: 'user',
      account_type: 'super_admin',
      agency_name: 'Victim Agency',
      is_active: true,
    },
    {
      email: 'attacker@example.com',
      role: 'admin',
      account_type: 'super_admin',
      agency_name: 'Victim Agency',
      is_active: true,
    },
  ];

  for (const functionName of FUNCTION_NAMES) {
    for (const user of callers) {
      const { client, calls } = makeClient({ user });
      const handler = await loadHandler(functionName, client, 'platform-owner@example.com');
      const { response } = await invoke(handler, calls, {
        file_url: 'https://base44.app/private.csv',
        file_content: 'private CSV',
        referral_id: 'referral-1',
      });

      assert.equal(
        response.status,
        STATICALLY_PAUSED_FUNCTIONS.has(functionName) ? 503 : 403,
        `${functionName}: ${user.email}/${user.role}`,
      );
      assert.equal(calls.bodyReads, 0, `${functionName} must authorize before parsing input`);
      assert.equal(privilegedCallCount(calls), 0, `${functionName} must not touch service resources`);
    }
  }
});

test('missing platform-owner configuration and deactivated sessions fail closed before input', async () => {
  const callers = [
    {
      user: { email: 'platform-owner@example.com', role: 'admin', is_active: true },
      configuredEmail: '',
    },
    {
      user: { email: 'platform-owner@example.com', role: 'admin', is_active: false },
      configuredEmail: 'platform-owner@example.com',
    },
  ];

  for (const functionName of FUNCTION_NAMES) {
    for (const { user, configuredEmail } of callers) {
      const { client, calls } = makeClient({ user });
      const handler = await loadHandler(functionName, client, configuredEmail);
      const { response } = await invoke(handler, calls, { referral_id: 'referral-1' });

      assert.equal(
        response.status,
        STATICALLY_PAUSED_FUNCTIONS.has(functionName) ? 503 : 403,
        functionName,
      );
      assert.equal(calls.bodyReads, 0, functionName);
      assert.equal(privilegedCallCount(calls), 0, functionName);
    }
  }
});

test('the configured protected admin reaches each handler safe input boundary', async () => {
  const user = { email: 'Platform-Owner@Example.com', role: 'admin', is_active: true };

  for (const functionName of FUNCTION_NAMES) {
    const { client, calls } = makeClient({ user });
    const handler = await loadHandler(functionName, client, 'platform-owner@example.com');
    const { response } = await invoke(handler, calls, {});

    assert.equal(response.status, STATICALLY_PAUSED_FUNCTIONS.has(functionName) ? 503 : 400, functionName);
    assert.equal(calls.bodyReads, STATICALLY_PAUSED_FUNCTIONS.has(functionName) ? 0 : 1, functionName);
    assert.equal(privilegedCallCount(calls), 0, functionName);
  }
});

test('active bulk entries pin authorization to the shared protected-user helper', async () => {
  for (const functionName of FUNCTION_NAMES.filter((name) => !STATICALLY_PAUSED_FUNCTIONS.has(name))) {
    const source = await readFile(
      new URL(`../functions/${functionName}/entry.ts`, import.meta.url),
      'utf8',
    );
    const handler = source.slice(source.indexOf('Deno.serve('));
    const bodyRead = handler.indexOf('await req.json()');
    assert.match(source, /<<<BEGIN SHARED HELPER: protectedUserAuthz/, functionName);

    if (AGENCY_ADMIN_FUNCTIONS.has(functionName)) {
      // The agency administrator's role comes from withTrustedClaims, which
      // rebuilds account_type from the service-owned membership for a role
      // 'user' profile and leaves a built-in admin's self-editable fields alone
      // — so the gate also requires role 'user' for that branch.
      const gate = handler.indexOf("if (!isProtectedSuperAdmin(user) && !isServiceOwnedAgencyAdmin)");
      assert.match(source, /<<<BEGIN SHARED HELPER: trustedCallerClaims/, functionName);
      assert.match(handler, /withTrustedClaims\(base44, await base44\.auth\.me\(\)/, functionName);
      assert.match(handler, /const isServiceOwnedAgencyAdmin = user\.role === 'user' && user\.account_type === 'agency_admin';/);
      assert.ok(gate !== -1 && bodyRead !== -1 && gate < bodyRead, `${functionName} must gate before body parsing`);
      assert.doesNotMatch(handler, /agency_name/, `${functionName} never scopes by the self-editable agency_name`);
      continue;
    }

    const gate = source.indexOf('if (!isProtectedSuperAdmin(user))');
    const sourceBodyRead = source.indexOf('await req.json()');
    assert.ok(gate !== -1 && sourceBodyRead !== -1 && gate < sourceBodyRead, `${functionName} must gate before body parsing`);
    assert.doesNotMatch(source, /account_type|agency_name/, functionName);
  }
});

function dischargeClient({ user, memberships = [], agencies = [], patients = [], extracted = [] }) {
  const calls = { patientFilters: [], patientUpdates: [], patientLists: 0, signed: [], extractions: [], systemLogs: [] };
  const client = {
    auth: { me: async () => user },
    asServiceRole: {
      entities: {
        AgencyMembership: { filter: async () => memberships },
        Agency: { filter: async (query) => agencies.filter((row) => row.id === query.id) },
        Patient: {
          list: async () => { calls.patientLists += 1; return patients; },
          filter: async (...args) => { calls.patientFilters.push(args); return patients.filter((row) => row.agency_id === args[0].agency_id); },
          update: async (...args) => { calls.patientUpdates.push(args); return {}; },
        },
        SystemLog: { create: async (row) => { calls.systemLogs.push(row); return row; } },
      },
      integrations: {
        Core: {
          CreateFileSignedUrl: async (args) => { calls.signed.push(args); return { signed_url: 'https://files.example.test/signed' }; },
          ExtractDataFromUploadedFile: async (args) => {
            calls.extractions.push(args);
            return { status: 'success', output: { discharged_patients: extracted } };
          },
        },
      },
    },
  };
  return { client, calls };
}

const AGENCY_ADMIN = {
  id: 'admin-user', email: 'admin@agency-a.test', role: 'user', account_type: 'user', is_active: true,
};
const AGENCY_ADMIN_MEMBERSHIP = {
  id: 'membership-a', agency_id: 'agency-a', user_id: 'admin-user', membership_key: 'agency-a:admin-user',
  user_email_normalized: 'admin@agency-a.test', tenant_role: 'agency_admin', status: 'active', version: 1,
  created_by_user_id: 'owner', last_transition_by_user_id: 'owner',
  last_transition_by_email_normalized: 'owner@example.test', last_transition_at: '2026-09-01T00:00:00.000Z',
  last_transition_reason: 'Activated', activated_at: '2026-09-01T00:00:00.000Z',
  revoked_at: null, revocation_reason: null,
};
const AGENCIES = [
  { id: 'agency-a', agency_name: 'Agency A', status: 'active' },
  { id: 'agency-b', agency_name: 'Agency B', status: 'active' },
];
const PATIENTS = [
  { id: 'pa', agency_id: 'agency-a', first_name: 'Ada', last_name: 'Lovelace', medical_record_number: 'M1', status: 'active' },
  { id: 'pb', agency_id: 'agency-b', first_name: 'Ada', last_name: 'Lovelace', medical_record_number: 'M1', status: 'active' },
];

test('an agency administrator discharges only inside their own membership agency', async () => {
  const { client, calls } = dischargeClient({
    user: AGENCY_ADMIN, memberships: [AGENCY_ADMIN_MEMBERSHIP], agencies: AGENCIES, patients: PATIENTS,
    extracted: [{ first_name: 'Ada', last_name: 'Lovelace', medical_record_number: 'M1' }],
  });
  const handler = await loadHandler('processDischargeReport', client, 'owner@example.test');

  const crossTenant = await invoke(handler, { bodyReads: 0 }, { file_uri: 'private/report.pdf', agency_id: 'agency-b' });
  assert.equal(crossTenant.response.status, 403, 'naming another agency is refused');
  assert.equal(calls.extractions.length, 0);

  const publicUrl = await invoke(handler, { bodyReads: 0 }, { file_url: 'https://base44.app/report.pdf' });
  assert.equal(publicUrl.response.status, 400, 'a public file_url is not accepted');

  const { response, json } = await invoke(handler, { bodyReads: 0 }, { file_uri: 'private/report.pdf' });
  assert.equal(response.status, 200);
  assert.equal(calls.patientLists, 0, 'never reads every patient in the deployment');
  assert.deepEqual(calls.patientFilters.map((args) => args[0]), [{ agency_id: 'agency-a' }]);
  assert.deepEqual(calls.patientUpdates.map(([id]) => id), ['pa'], 'the same-named chart in agency B is untouched');
  assert.equal(json.files_closed, 1);
  assert.equal(calls.signed[0].file_uri, 'private/report.pdf');
  assert.equal(calls.extractions[0].file_url, 'https://files.example.test/signed');
  const logged = JSON.stringify(calls.systemLogs);
  assert.doesNotMatch(logged, /Lovelace|M1|private\/report/, 'the operational log carries counts, not PHI');
});

test('a claimed agency_admin without a service-owned membership is refused before the body', async () => {
  const { client, calls } = dischargeClient({
    user: { ...AGENCY_ADMIN, account_type: 'agency_admin', agency_id: 'agency-a' },
    memberships: [], agencies: AGENCIES, patients: PATIENTS,
  });
  const handler = await loadHandler('processDischargeReport', client, 'owner@example.test');
  const bodyCalls = { bodyReads: 0 };
  const { response } = await invoke(handler, bodyCalls, { file_uri: 'private/report.pdf' });
  assert.equal(response.status, 403);
  assert.equal(bodyCalls.bodyReads, 0);
  assert.equal(calls.patientFilters.length + calls.patientUpdates.length + calls.extractions.length, 0);
});

test('the platform owner must name an existing agency and is scoped to it', async () => {
  const owner = { id: 'owner', email: 'owner@example.test', role: 'admin', is_active: true };
  const { client, calls } = dischargeClient({
    user: owner, agencies: AGENCIES, patients: PATIENTS,
    extracted: [{ first_name: 'Ada', last_name: 'Lovelace', medical_record_number: 'M1' }],
  });
  const handler = await loadHandler('processDischargeReport', client, 'owner@example.test');
  assert.equal((await invoke(handler, { bodyReads: 0 }, { file_uri: 'private/r.pdf' })).response.status, 400);
  assert.equal((await invoke(handler, { bodyReads: 0 }, { file_uri: 'private/r.pdf', agency_id: 'agency-z' })).response.status, 404);
  assert.equal(calls.extractions.length, 0);
  const { response } = await invoke(handler, { bodyReads: 0 }, { file_uri: 'private/r.pdf', agency_id: 'agency-b' });
  assert.equal(response.status, 200);
  assert.deepEqual(calls.patientUpdates.map(([id]) => id), ['pb']);
});

// ---------------------------------------------------------------------------
// processPatientFileUpdate — agency roster import (owner decision, 2026-10-08)
// ---------------------------------------------------------------------------

const IMPORT_NOW = '2026-10-01T00:00:00.000Z';
const importMembership = (overrides = {}) => ({
  id: 'membership-admin',
  membership_key: 'agency-a:admin-1',
  agency_id: 'agency-a',
  user_id: 'admin-1',
  user_email_normalized: 'admin@agency.test',
  tenant_role: 'agency_admin',
  status: 'active',
  version: 1,
  created_by_user_id: 'owner-1',
  last_transition_by_user_id: 'owner-1',
  last_transition_by_email_normalized: 'owner@agency.test',
  last_transition_at: IMPORT_NOW,
  last_transition_reason: 'Membership setup',
  activated_at: IMPORT_NOW,
  ...overrides,
});
const IMPORT_ADMIN = { id: 'admin-1', email: 'Admin@Agency.test', role: 'user', is_active: true };

function makeImportClient({
  user = IMPORT_ADMIN,
  memberships = [importMembership()],
  patients = [],
  invokeFails = false,
} = {}) {
  const calls = { bodyReads: 0, patientLists: 0, patientCreates: [], patientUpdates: [], invokes: [] };
  const matches = (row, query) => Object.entries(query || {}).every(([key, value]) => row?.[key] === value);
  const client = {
    auth: { me: async () => user },
    functions: {
      invoke: async (name, payload) => {
        calls.invokes.push({ name, payload });
        if (invokeFails) {
          const error = new Error('refused');
          error.response = { status: 403, data: { error: 'Tenant role cannot create patients' } };
          throw error;
        }
        return { data: { success: true, patient: { id: `created-${calls.invokes.length}` } } };
      },
    },
    asServiceRole: {
      entities: {
        AgencyMembership: { filter: async (query) => memberships.filter((row) => matches(row, query)) },
        Agency: { filter: async (query) => [{ id: 'agency-a', agency_name: 'Agency A', status: 'active' }].filter((row) => matches(row, query)) },
        Patient: {
          list: async (_sort, limit, skip = 0) => {
            calls.patientLists += 1;
            return patients.slice(skip, skip + limit).map((row) => ({ ...row }));
          },
          filter: async (query) => patients.filter((row) => matches(row, query)).map((row) => ({ ...row })),
          create: async (row) => {
            calls.patientCreates.push(row);
            return { id: 'service-created', ...row };
          },
          update: async (...args) => {
            calls.patientUpdates.push(args);
            return {};
          },
        },
      },
    },
  };
  return { client, calls };
}

async function invokeImport(handler, calls, body, method = 'POST') {
  const response = await handler({
    method,
    headers: new Headers(),
    json: async () => {
      calls.bodyReads += 1;
      return body;
    },
  });
  return { response, json: await response.json() };
}

const CENSUS = [
  'first_name,last_name,mrn,dob,status',
  'Ada,Lovelace,MRN-1,1950-01-01,active',
  'Grace,Hopper,MRN-2,1940-02-02,active',
  'Alan,Turing,MRN-3,1930-03-03,active',
  'Edsger,Dijkstra,MRN-4,1935-04-04,active',
].join('\n');
const IMPORT_PATIENTS = [
  // Already in this agency: matched, never re-created.
  { id: 'p-a1', agency_id: 'agency-a', first_name: 'Ada', last_name: 'Lovelace', medical_record_number: 'MRN-1', date_of_birth: '1950-01-01', status: 'active', is_archived: false },
  // Another agency's chart with the same MRN is never a match target.
  { id: 'p-b2', agency_id: 'agency-b', first_name: 'Grace', last_name: 'Hopper', medical_record_number: 'MRN-2', date_of_birth: '1940-02-02', status: 'active', is_archived: false },
  // A legacy chart with no agency is reported, never duplicated or touched.
  { id: 'p-x3', agency_id: '', first_name: 'Alan', last_name: 'Turing', medical_record_number: 'MRN-3', date_of_birth: '1930-03-03', status: 'active', is_archived: false },
];

test('roster import refuses forged, non-admin and membership-less callers before reading input', async () => {
  for (const { user, memberships } of [
    { user: { ...IMPORT_ADMIN, account_type: 'agency_admin', agency_name: 'Agency A' }, memberships: [] },
    { user: IMPORT_ADMIN, memberships: [importMembership({ tenant_role: 'clinician' })] },
    { user: { id: 'owner-1', email: 'owner@agency.test', role: 'admin', is_active: true }, memberships: [] },
    { user: { ...IMPORT_ADMIN, is_active: false }, memberships: [importMembership()] },
  ]) {
    const { client, calls } = makeImportClient({ user, memberships, patients: IMPORT_PATIENTS });
    const handler = await loadHandler('processPatientFileUpdate', client);
    const { response } = await invokeImport(handler, calls, { file_content: CENSUS, dry_run: true });
    assert.equal(response.status, 403);
    assert.equal(calls.bodyReads, 0);
    assert.equal(calls.patientLists, 0);
    assert.equal(calls.invokes.length, 0);
  }
});

test('roster import preview stays inside the caller agency and writes nothing', async () => {
  const { client, calls } = makeImportClient({ patients: IMPORT_PATIENTS });
  const handler = await loadHandler('processPatientFileUpdate', client);
  const { response, json } = await invokeImport(handler, calls, { file_content: CENSUS, dry_run: true });
  assert.equal(response.status, 200);
  assert.equal(json.results.agency_id, 'agency-a');
  assert.equal(json.results.agency_name, 'Agency A');
  const actions = Object.fromEntries(json.results.plan.map((row) => [row.row, row.action]));
  assert.deepEqual(actions, { 2: 'matched', 3: 'create', 4: 'needs_review', 5: 'create' });
  assert.doesNotMatch(JSON.stringify(json), /p-b2/);
  assert.equal(calls.invokes.length, 0);
  assert.equal(calls.patientCreates.length, 0);
  assert.equal(calls.patientUpdates.length, 0);
});

test('roster import commit must name the previewed agency and refuses stored file links', async () => {
  for (const body of [
    { file_content: CENSUS, dry_run: false },
    { file_content: CENSUS, dry_run: false, agency_id: 'agency-b' },
  ]) {
    const { client, calls } = makeImportClient({ patients: IMPORT_PATIENTS });
    const handler = await loadHandler('processPatientFileUpdate', client);
    const { response } = await invokeImport(handler, calls, body);
    assert.equal(response.status, 409);
    assert.equal(calls.patientLists, 0);
    assert.equal(calls.invokes.length, 0);
  }
  const { client, calls } = makeImportClient();
  const handler = await loadHandler('processPatientFileUpdate', client);
  const { response } = await invokeImport(handler, calls, { file_url: 'https://base44.app/census.csv', dry_run: true });
  assert.equal(response.status, 400);
  assert.equal(calls.patientLists, 0);
  assert.equal((await invokeImport(handler, calls, {}, 'GET')).response.status, 405);
});

test('roster import commit creates charts through createAuthorizedPatient as the caller', async () => {
  const { client, calls } = makeImportClient({ patients: IMPORT_PATIENTS });
  const handler = await loadHandler('processPatientFileUpdate', client);
  const { response, json } = await invokeImport(handler, calls, {
    file_content: CENSUS, dry_run: false, agency_id: 'agency-a',
  });
  assert.equal(response.status, 200);
  assert.equal(json.results.created, 2);
  assert.equal(calls.patientCreates.length, 0, 'no chart is created with service-role authority');
  assert.deepEqual(calls.invokes.map((call) => call.name), ['createAuthorizedPatient', 'createAuthorizedPatient']);
  for (const { payload } of calls.invokes) {
    assert.equal(payload.agency_id, 'agency-a');
    assert.match(payload.client_request_id, /^roster-import-[0-9a-f]{64}$/);
    assert.equal(payload.assigned_nurses, undefined);
    assert.equal(payload.created_by, undefined);
  }
  assert.deepEqual(calls.invokes.map((call) => call.payload.medical_record_number), ['MRN-2', 'MRN-4']);

  // The request id is derived from the agency and the row, so a retry repeats it.
  const again = makeImportClient({ patients: IMPORT_PATIENTS });
  const handlerAgain = await loadHandler('processPatientFileUpdate', again.client);
  await invokeImport(handlerAgain, again.calls, { file_content: CENSUS, dry_run: false, agency_id: 'agency-a' });
  assert.deepEqual(
    again.calls.invokes.map((call) => call.payload.client_request_id),
    calls.invokes.map((call) => call.payload.client_request_id),
  );
});

test('roster import reports a refused creation per row instead of failing the import', async () => {
  const { client, calls } = makeImportClient({ patients: IMPORT_PATIENTS, invokeFails: true });
  const handler = await loadHandler('processPatientFileUpdate', client);
  const { response, json } = await invokeImport(handler, calls, {
    file_content: CENSUS, dry_run: false, agency_id: 'agency-a',
  });
  assert.equal(response.status, 200);
  assert.equal(json.results.created, 0);
  assert.ok(json.results.errors.some((entry) => entry.error === 'Tenant role cannot create patients'));
});

test('roster import discharges only charts recorded in the caller agency', async () => {
  const report = [
    'first_name,last_name,mrn,dob,status,discharge_date',
    'Ada,Lovelace,MRN-1,1950-01-01,discharged,2026-09-30',
    'Grace,Hopper,MRN-2,1940-02-02,discharged,2026-09-30',
  ].join('\n');
  const { client, calls } = makeImportClient({ patients: IMPORT_PATIENTS });
  const handler = await loadHandler('processPatientFileUpdate', client);
  const { response, json } = await invokeImport(handler, calls, {
    file_content: report, report_type: 'discharge_report', dry_run: false, agency_id: 'agency-a',
  });
  assert.equal(response.status, 200);
  assert.equal(json.results.discharged, 1);
  assert.deepEqual(calls.patientUpdates, [[
    'p-a1', { status: 'discharged', is_archived: true, discharge_date: '2026-09-30' },
  ]]);
  // The other agency's MRN-2 chart is not a match, so that row is an error.
  assert.ok(json.results.errors.some((entry) => entry.row === 3));
});

test('roster import authorizes from the service-owned membership before parsing input', async () => {
  const source = await readFile(new URL('../functions/processPatientFileUpdate/entry.ts', import.meta.url), 'utf8');
  const handlerBody = source.slice(source.indexOf('Deno.serve('));
  const gate = handlerBody.indexOf('await loadTrustedTenantClaim(base44, user.id, normalizeClaimEmail(user.email))');
  const bodyRead = handlerBody.indexOf('await req.json()');
  assert.match(source, /<<<BEGIN SHARED HELPER: trustedCallerClaims/);
  assert.ok(gate !== -1 && bodyRead !== -1 && gate < bodyRead, 'must gate before body parsing');
  assert.doesNotMatch(handlerBody, /account_type|agency_name\b(?!:)|assigned_nurses|\bfetch\(/);
  assert.doesNotMatch(handlerBody, /asServiceRole\.entities\.Patient\.create/);
});
