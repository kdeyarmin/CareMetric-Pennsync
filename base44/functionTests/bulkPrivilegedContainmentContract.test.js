import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { transpileTs } from '../../tools-transpile-ts.mjs';

const FUNCTION_NAMES = [
  'processDischargeReport',
  'processPatientFileUpdate',
  'generateFollowUpPortalToken',
];

const STATICALLY_PAUSED_FUNCTIONS = new Set([
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

    assert.equal(
      response.status,
      functionName === 'processPatientFileUpdate' || STATICALLY_PAUSED_FUNCTIONS.has(functionName)
        ? 503
        : 400,
      functionName,
    );
    assert.equal(calls.bodyReads, STATICALLY_PAUSED_FUNCTIONS.has(functionName) ? 0 : 1, functionName);
    assert.equal(privilegedCallCount(calls), 0, functionName);
  }
});

test('portal-token minting rejects operator-shaped and backend-mismatched referral ids', async () => {
  const user = { email: 'owner@example.com', role: 'admin', is_active: true };

  {
    const { client, calls } = makeClient({ user });
    const handler = await loadHandler('generateFollowUpPortalToken', client, user.email);
    const { response } = await invoke(handler, calls, { referral_id: { $ne: null } });

    assert.equal(response.status, 400);
    assert.deepEqual(calls.referralFilters, []);
  }

  {
    const { client, calls } = makeClient({
      user,
      referralRows: [{ id: 'wrong-referral', created_by: user.email }],
    });
    const handler = await loadHandler('generateFollowUpPortalToken', client, user.email);
    const { response } = await invoke(handler, calls, { referral_id: 'requested-referral' });

    assert.equal(response.status, 404);
    assert.deepEqual(calls.referralFilters[0], [
      { id: 'requested-referral' },
      undefined,
      5000,
    ]);
    assert.deepEqual(calls.tokenFilters, []);
    assert.deepEqual(calls.tokenCreates, []);
  }
});

test('portal-token rotation mutates only exact active predecessors', async () => {
  const user = { email: 'owner@example.com', role: 'admin', is_active: true };
  const { client, calls } = makeClient({
    user,
    referralRows: [
      { id: 'wrong-referral' },
      { id: 'referral-1', created_by: 'someone@example.com' },
    ],
    tokenRows: [
      { id: 'wrong-referral-token', referral_id: 'referral-2', is_active: true },
      { id: 'inactive-token', referral_id: 'referral-1', is_active: false },
      { id: 'active-token', referral_id: 'referral-1', is_active: true },
      { referral_id: 'referral-1', is_active: true },
    ],
  });
  const handler = await loadHandler('generateFollowUpPortalToken', client, user.email);
  const { response, json } = await invoke(handler, calls, {
    referral_id: ' referral-1 ',
    provider_name: 'Provider One',
  });

  assert.equal(response.status, 200);
  assert.equal(json.success, true);
  assert.deepEqual(calls.tokenUpdates, [['active-token', { is_active: false }]]);
  assert.equal(calls.tokenCreates.length, 1);
  assert.equal(calls.tokenCreates[0].referral_id, 'referral-1');
  assert.match(calls.tokenCreates[0].token, /^[a-f0-9]{64}$/);
  assert.match(json.portalLink, /^https:\/\/caremetricai\.base44\.app\/followup\?token=/);
  assert.ok(!json.portalLink.endsWith(calls.tokenCreates[0].token), 'stored hash must not be the bearer token');
  assert.equal(calls.userLists, 0, 'mutable agency membership must not be consulted');
});

test('all three entries pin authorization to the shared protected-user helper', async () => {
  for (const functionName of FUNCTION_NAMES) {
    const source = await readFile(
      new URL(`../functions/${functionName}/entry.ts`, import.meta.url),
      'utf8',
    );
    const gate = source.indexOf('if (!isProtectedSuperAdmin(user))');
    const bodyRead = source.indexOf('await req.json()');

    assert.match(source, /<<<BEGIN SHARED HELPER: protectedUserAuthz/, functionName);
    assert.ok(gate !== -1 && bodyRead !== -1 && gate < bodyRead, `${functionName} must gate before body parsing`);
    assert.doesNotMatch(source, /account_type|agency_name/, functionName);
  }
});
