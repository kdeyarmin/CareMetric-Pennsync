import assert from 'node:assert/strict';
import { readFile, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { transpileTs } from '../../tools-transpile-ts.mjs';

// Imported by immutableTenantAuthorizationContract.test.js so this contract is
// exercised by the existing security-test registry without a package change.
const functionUrl = new URL('../functions/listMyTenantMemberships/entry.ts', import.meta.url);
const wrapperUrl = new URL('../../src/functions/listMyTenantMemberships.js', import.meta.url);

const defaultUser = {
  id: 'user-1',
  email: 'Member@Example.com',
  role: 'user',
};

function membership(overrides = {}) {
  const row = {
    id: 'membership-a',
    membership_key: 'agency-a:user-1',
    agency_id: 'agency-a',
    user_id: 'user-1',
    user_email_normalized: 'member@example.com',
    tenant_role: 'clinician',
    status: 'active',
    created_by_user_id: 'owner-1',
    last_transition_by_user_id: 'owner-1',
    last_transition_by_email_normalized: 'owner@example.com',
    last_transition_at: '2026-09-04T12:00:00.000Z',
    last_transition_reason: 'Authorized lifecycle transition',
    version: 1,
    ...overrides,
  };
  if (
    (row.status === 'active' || row.status === 'suspended')
    && row.activated_at === undefined
  ) {
    row.activated_at = '2026-09-04T12:01:00.000Z';
  }
  if (row.status === 'revoked') {
    if (row.revoked_at === undefined) row.revoked_at = '2026-09-04T12:02:00.000Z';
    if (row.revocation_reason === undefined) row.revocation_reason = 'Revoked by owner';
  }
  return row;
}

function agency(overrides = {}) {
  return {
    id: 'agency-a',
    agency_name: 'Agency A',
    status: 'active',
    agency_code: 'PRIVATE-CODE',
    admin_email: 'private@example.com',
    ...overrides,
  };
}

async function loadBroker({
  users = [defaultUser, defaultUser],
  membershipResults = [[membership()], [membership()]],
  agencyResult,
  superAdminEmail = '',
} = {}) {
  let source = await readFile(functionUrl, 'utf8');
  source = source.replace(
    /import\s+\{\s*createClientFromRequest\s*\}\s+from\s+'npm:[^']+';/,
    'const createClientFromRequest = globalThis.__tenantMembershipListMakeClient;',
  );
  const temporaryModule = join(
    tmpdir(),
    `tenant_membership_list_${Date.now()}_${Math.random().toString(36).slice(2)}.mjs`,
  );
  await writeFile(temporaryModule, transpileTs(source).outputText);

  const calls = {
    clientConstructions: 0,
    auth: 0,
    membershipFilters: [],
    agencyFilters: [],
  };
  const agencyCallCounts = new Map();
  const client = {
    auth: {
      me: async () => {
        const index = Math.min(calls.auth, users.length - 1);
        calls.auth += 1;
        return users[index];
      },
    },
    asServiceRole: {
      entities: {
        AgencyMembership: {
          filter: async (...args) => {
            const index = calls.membershipFilters.length;
            calls.membershipFilters.push(args);
            return membershipResults[Math.min(index, membershipResults.length - 1)];
          },
        },
        Agency: {
          filter: async (...args) => {
            calls.agencyFilters.push(args);
            const agencyId = args[0]?.id;
            const count = (agencyCallCounts.get(agencyId) || 0) + 1;
            agencyCallCounts.set(agencyId, count);
            if (agencyResult) return agencyResult({ agencyId, count, args });
            return [agency({
              id: agencyId,
              agency_name: agencyId === 'agency-b' ? 'Agency B' : 'Agency A',
            })];
          },
        },
      },
    },
  };

  let handler;
  globalThis.__tenantMembershipListMakeClient = () => {
    calls.clientConstructions += 1;
    return client;
  };
  globalThis.Deno = {
    serve: (candidate) => { handler = candidate; },
    env: {
      get: (name) => (name === 'SUPER_ADMIN_EMAIL' ? superAdminEmail : undefined),
    },
  };
  try {
    await import(pathToFileURL(temporaryModule).href);
  } finally {
    await unlink(temporaryModule).catch(() => {});
  }
  assert.equal(typeof handler, 'function');
  return { handler, calls };
}

async function invoke(handler, body = {}) {
  const request = new Request('http://local/listMyTenantMemberships', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const response = await handler(request);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('pragma'), 'no-cache');
  return { response, json: await response.json() };
}

async function invokeRaw(handler, raw) {
  const request = new Request('http://local/listMyTenantMemberships', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: raw,
  });
  const response = await handler(request);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('pragma'), 'no-cache');
  return { response, json: await response.json() };
}

async function loadWrapper(initialResult) {
  let currentResult = initialResult;
  const calls = [];
  const client = {
    listMyTenantMemberships: async (...args) => {
      calls.push(args);
      return currentResult;
    },
  };
  let source = await readFile(wrapperUrl, 'utf8');
  source = source.replace(
    /import\s+\{\s*tenantAuthorityClient\s*\}\s+from\s+'@\/api\/base44Client';/,
    'const tenantAuthorityClient = globalThis.__tenantMembershipListWrapperClient;',
  );
  const temporaryModule = join(
    tmpdir(),
    `tenant_membership_wrapper_${Date.now()}_${Math.random().toString(36).slice(2)}.mjs`,
  );
  await writeFile(temporaryModule, source);
  globalThis.__tenantMembershipListWrapperClient = client;
  let imported;
  try {
    imported = await import(pathToFileURL(temporaryModule).href);
  } finally {
    await unlink(temporaryModule).catch(() => {});
  }
  return {
    list: imported.listMyTenantMemberships,
    calls,
    setResult: (value) => { currentResult = value; },
  };
}

function publicOption(overrides = {}) {
  const base = {
    membership_id: 'membership-a',
    membership_key: 'agency-a:user-1',
    membership_version: 1,
    agency_id: 'agency-a',
    tenant_role: 'clinician',
    membership_status: 'active',
    agency: { id: 'agency-a', name: 'Agency A', status: 'active' },
  };
  return {
    ...base,
    ...overrides,
    agency: { ...base.agency, ...(overrides.agency || {}) },
  };
}

function publicResult(overrides = {}) {
  return {
    subject: {
      user_id: 'user-1',
      user_email: 'member@example.com',
      is_platform_owner: false,
    },
    memberships: [publicOption()],
    ...overrides,
  };
}

test('selector source is service-owned, finite, read-only, and ignores mutable User claims', async () => {
  const source = await readFile(functionUrl, 'utf8');
  const wrapper = await readFile(wrapperUrl, 'utf8');

  assert.match(source, /base44\.asServiceRole\.entities/);
  assert.match(source, /AgencyMembership\.filter/);
  assert.match(source, /Agency\.filter/);
  assert.match(source, /MEMBERSHIP_QUERY_LIMIT = 51/);
  assert.match(source, /MAX_ACTIVE_MEMBERSHIPS = 25/);
  assert.match(source, /MAX_BODY_BYTES = 1_000/);
  assert.match(source, /req\.body\?\.getReader\(\)/);
  assert.doesNotMatch(source, /req\.text\(\)|req\.json\(\)/);
  assert.match(source, /Tenant membership list changed during request/);
  assert.match(source, /Caller identity changed during request/);
  assert.ok(
    source.indexOf("req.method !== 'POST'") < source.indexOf('createClientFromRequest(req)'),
    'method gate must run before client construction',
  );
  assert.doesNotMatch(source, /\.create\(|\.update\(|\.delete\(/);
  assert.doesNotMatch(
    source,
    /user\.(?:account_type|agency_id|agency_name|agency_role|tenant_role|is_approved|is_manager|manager_email|staff_role|care_scope)\b/,
  );
  assert.match(source, /console\.error\('listMyTenantMemberships failed'\)/);
  assert.doesNotMatch(source, /console\.error\([^)]*,\s*error\b/);
  assert.match(wrapper, /tenantAuthorityClient\.listMyTenantMemberships\(\)/);
  assert.doesNotMatch(wrapper, /\.entities\.|auth\.updateMe/);
});

test('two exact active memberships return deterministic minimal selector options', async () => {
  const a = membership();
  const b = membership({
    id: 'membership-b',
    membership_key: 'agency-b:user-1',
    agency_id: 'agency-b',
    tenant_role: 'manager',
    version: 3,
  });
  const { handler, calls } = await loadBroker({
    membershipResults: [[b, a], [a, b]],
  });
  const { response, json } = await invoke(handler);

  assert.equal(response.status, 200);
  assert.deepEqual(calls.membershipFilters, [
    [{ user_id: 'user-1' }, 'agency_id', 51],
    [{ user_id: 'user-1' }, 'agency_id', 51],
  ]);
  assert.deepEqual(json, {
    subject: {
      user_id: 'user-1',
      user_email: 'member@example.com',
      is_platform_owner: false,
    },
    memberships: [
      {
        membership_id: 'membership-a',
        membership_key: 'agency-a:user-1',
        membership_version: 1,
        agency_id: 'agency-a',
        tenant_role: 'clinician',
        membership_status: 'active',
        agency: { id: 'agency-a', name: 'Agency A', status: 'active' },
      },
      {
        membership_id: 'membership-b',
        membership_key: 'agency-b:user-1',
        membership_version: 3,
        agency_id: 'agency-b',
        tenant_role: 'manager',
        membership_status: 'active',
        agency: { id: 'agency-b', name: 'Agency B', status: 'active' },
      },
    ],
  });
  assert.equal(calls.agencyFilters.length, 4);
  for (const call of calls.agencyFilters) {
    assert.equal(call[1], undefined);
    assert.equal(call[2], 2);
  }
  assert.deepEqual(Object.keys(json.memberships[0].agency), ['id', 'name', 'status']);
});

test('selector ordering uses exact agency_id even when one id prefixes another', async () => {
  const short = membership({
    id: 'membership-short',
    membership_key: 'a:user-1',
    agency_id: 'a',
  });
  const prefixed = membership({
    id: 'membership-prefixed',
    membership_key: 'a::user-1',
    agency_id: 'a:',
  });
  const loaded = await loadBroker({
    membershipResults: [[prefixed, short], [short, prefixed]],
    agencyResult: ({ agencyId }) => [agency({
      id: agencyId,
      agency_name: agencyId === 'a' ? 'Short Agency' : 'Prefixed Agency',
    })],
  });
  const result = await invoke(loaded.handler);

  assert.equal(result.response.status, 200);
  assert.deepEqual(
    result.json.memberships.map((option) => option.agency_id),
    ['a', 'a:'],
  );
});

test('inactive memberships are validated but never returned as selector options', async () => {
  const pending = membership({ status: 'pending', activated_at: undefined });
  const revoked = membership({
    id: 'membership-b',
    membership_key: 'agency-b:user-1',
    agency_id: 'agency-b',
    status: 'revoked',
  });
  const { handler, calls } = await loadBroker({
    membershipResults: [[pending, revoked], [revoked, pending]],
  });
  const { response, json } = await invoke(handler);

  assert.equal(response.status, 200);
  assert.deepEqual(json.memberships, []);
  assert.equal(json.subject.is_platform_owner, false);
  assert.deepEqual(calls.agencyFilters, []);
});

test('the exact protected owner stays membership-free and cannot infer a tenant', async () => {
  const owner = { id: 'owner-1', email: ' Owner@Example.com ', role: 'admin' };
  const { handler, calls } = await loadBroker({
    users: [owner, owner],
    membershipResults: [[], []],
    superAdminEmail: 'owner@example.com',
  });
  const { response, json } = await invoke(handler);

  assert.equal(response.status, 200);
  assert.deepEqual(json, {
    subject: {
      user_id: 'owner-1',
      user_email: 'owner@example.com',
      is_platform_owner: true,
    },
    memberships: [],
  });
  assert.deepEqual(calls.agencyFilters, []);

  const ownerMembership = membership({
    id: 'owner-membership',
    membership_key: 'agency-a:owner-1',
    user_id: 'owner-1',
    user_email_normalized: 'owner@example.com',
  });
  const polluted = await loadBroker({
    users: [owner, owner],
    membershipResults: [[ownerMembership], [ownerMembership]],
    superAdminEmail: 'owner@example.com',
  });
  const pollutedResult = await invoke(polluted.handler);
  assert.equal(pollutedResult.response.status, 409);
  assert.equal(pollutedResult.json.error, 'Platform owner tenant membership must not exist');
  assert.deepEqual(polluted.calls.agencyFilters, []);
});

test('mutable custom User claims neither grant owner status nor alter exact membership authority', async () => {
  const user = {
    ...defaultUser,
    account_type: 'super_admin',
    agency_id: 'forged-agency',
    agency_name: 'Forged Agency',
    agency_role: 'agency_admin',
    tenant_role: 'agency_admin',
    is_approved: true,
    is_manager: true,
    staff_role: 'administrator',
  };
  const { handler } = await loadBroker({
    users: [user, user],
    superAdminEmail: 'member@example.com',
  });
  const { response, json } = await invoke(handler);
  assert.equal(response.status, 200);
  assert.equal(json.subject.is_platform_owner, false);
  assert.equal(json.memberships[0].tenant_role, 'clinician');
  assert.equal(Object.hasOwn(json.subject, 'account_type'), false);
});

test('authentication, account state, and exact built-in identity fail before service reads', async () => {
  const cases = [
    { user: null, status: 401 },
    { user: { ...defaultUser, is_active: false }, status: 403 },
    { user: { ...defaultUser, disabled: true }, status: 403 },
    { user: { ...defaultUser, is_service: true }, status: 403 },
    { user: { ...defaultUser, is_verified: false }, status: 403 },
    { user: { email: 'member@example.com', role: 'user' }, status: 403 },
    { user: { id: ' user-1', email: 'member@example.com', role: 'user' }, status: 403 },
    { user: { id: 'user-1', email: 'not-an-email', role: 'user' }, status: 403 },
  ];
  for (const { user, status } of cases) {
    const loaded = await loadBroker({ users: [user] });
    const result = await invoke(loaded.handler);
    assert.equal(result.response.status, status);
    assert.deepEqual(loaded.calls.membershipFilters, []);
    assert.deepEqual(loaded.calls.agencyFilters, []);
  }
});

test('only an empty object request is accepted and parsing happens before service reads', async () => {
  const invalidBodies = [null, [], 'text', { agency_id: 'agency-a' }, { limit: 1 }];
  for (const body of invalidBodies) {
    const loaded = await loadBroker();
    const result = await invoke(loaded.handler, body);
    assert.equal(result.response.status, 400);
    assert.deepEqual(loaded.calls.membershipFilters, []);
  }
  const loaded = await loadBroker();
  const result = await invokeRaw(loaded.handler, '{invalid');
  assert.equal(result.response.status, 400);
  assert.deepEqual(loaded.calls.membershipFilters, []);

  const oversized = await loadBroker();
  const oversizedResult = await invokeRaw(oversized.handler, ' '.repeat(1_001));
  assert.equal(oversizedResult.response.status, 413);
  assert.deepEqual(oversized.calls.membershipFilters, []);
});

test('POST is gated before client construction and an empty body is parsed only after auth', async () => {
  const methodLoaded = await loadBroker();
  const methodResponse = await methodLoaded.handler(new Request(
    'http://local/listMyTenantMemberships',
    { method: 'GET' },
  ));
  assert.equal(methodResponse.status, 405);
  assert.equal(methodResponse.headers.get('allow'), 'POST');
  assert.equal(methodResponse.headers.get('cache-control'), 'no-store');
  assert.equal(methodResponse.headers.get('pragma'), 'no-cache');
  assert.deepEqual(await methodResponse.json(), { error: 'Method not allowed' });
  assert.equal(methodLoaded.calls.clientConstructions, 0);
  assert.equal(methodLoaded.calls.auth, 0);

  const authenticated = await loadBroker();
  const authenticatedEmpty = await authenticated.handler(new Request(
    'http://local/listMyTenantMemberships',
    { method: 'POST' },
  ));
  assert.equal(authenticatedEmpty.status, 400);
  assert.equal(authenticatedEmpty.headers.get('cache-control'), 'no-store');
  assert.equal(authenticated.calls.clientConstructions, 1);
  assert.equal(authenticated.calls.auth, 1);
  assert.deepEqual(authenticated.calls.membershipFilters, []);

  const unauthenticated = await loadBroker({ users: [null] });
  const unauthenticatedEmpty = await unauthenticated.handler(new Request(
    'http://local/listMyTenantMemberships',
    { method: 'POST' },
  ));
  assert.equal(unauthenticatedEmpty.status, 401);
  assert.equal(unauthenticatedEmpty.headers.get('cache-control'), 'no-store');
  assert.equal(unauthenticated.calls.clientConstructions, 1);
  assert.equal(unauthenticated.calls.auth, 1);
  assert.deepEqual(unauthenticated.calls.membershipFilters, []);
});

test('a chunked request without Content-Length is cancelled as soon as it exceeds the cap', async () => {
  let pulls = 0;
  let cancelled = false;
  const stream = new ReadableStream({
    pull(controller) {
      pulls += 1;
      controller.enqueue(new Uint8Array(600).fill(0x20));
    },
    cancel() {
      cancelled = true;
    },
  });
  const request = new Request('http://local/listMyTenantMemberships', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: stream,
    duplex: 'half',
  });
  assert.equal(request.headers.get('content-length'), null);

  const loaded = await loadBroker();
  const response = await loaded.handler(request);
  assert.equal(response.status, 413);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(cancelled, true);
  assert.ok(pulls <= 3, `stream should stop promptly, observed ${pulls} pulls`);
  assert.deepEqual(loaded.calls.membershipFilters, []);
});

test('malformed lifecycle and provenance rows fail closed before Agency reads', async (t) => {
  const corruptRows = [
    ['missing id', membership({ id: undefined })],
    ['operator-shaped id', membership({ id: '$ne' })],
    ['whitespace agency', membership({ agency_id: ' agency-a' })],
    ['wrong canonical key', membership({ membership_key: 'agency-a:other-user' })],
    ['email mismatch', membership({ user_email_normalized: 'other@example.com' })],
    ['noncanonical email', membership({ user_email_normalized: 'Member@Example.com' })],
    ['unknown role', membership({ tenant_role: 'platform_owner' })],
    ['unknown status', membership({ status: 'deleted' })],
    ['fractional version', membership({ version: 1.5 })],
    ['zero version', membership({ version: 0 })],
    ['invalid invitation', membership({ invitation_id: ' invitation-1' })],
    ['missing creator', membership({ created_by_user_id: '' })],
    ['missing transition actor', membership({ last_transition_by_user_id: '' })],
    ['noncanonical transition email', membership({
      last_transition_by_email_normalized: 'Owner@Example.com',
    })],
    ['noncanonical transition instant', membership({
      last_transition_at: '2026-09-04T08:00:00-04:00',
    })],
    ['whitespace transition reason', membership({
      last_transition_reason: ' transition ',
    })],
    ['missing active timestamp', membership({ activated_at: null })],
    ['pending row with activation timestamp', membership({
      status: 'pending',
      activated_at: '2026-09-04T12:01:00.000Z',
    })],
    ['revoked row without timestamp', membership({ status: 'revoked', revoked_at: null })],
    ['revoked row without reason', membership({ status: 'revoked', revocation_reason: '' })],
    ['revoked row with invalid activation timestamp', membership({
      status: 'revoked',
      activated_at: 'invalid',
    })],
    ['active row with revoked timestamp', membership({
      revoked_at: '2026-09-04T12:02:00.000Z',
    })],
    ['active row with revocation reason', membership({ revocation_reason: 'Polluted' })],
  ];

  for (const [label, row] of corruptRows) {
    await t.test(label, async () => {
      const loaded = await loadBroker({ membershipResults: [[row], [row]] });
      const result = await invoke(loaded.handler);
      assert.equal(result.response.status, 409);
      assert.deepEqual(loaded.calls.agencyFilters, []);
    });
  }
});

test('cross-user, duplicate, and overflow membership results are rejected', async () => {
  const foreign = membership({
    id: 'foreign-membership',
    membership_key: 'agency-z:user-z',
    agency_id: 'agency-z',
    user_id: 'user-z',
    user_email_normalized: 'user-z@example.com',
  });
  const duplicateId = membership({
    id: 'membership-a',
    membership_key: 'agency-b:user-1',
    agency_id: 'agency-b',
  });
  const inactiveDuplicateAgency = membership({
    id: 'membership-revoked',
    status: 'revoked',
  });
  const cases = [
    [membership(), foreign],
    [membership(), duplicateId],
    [membership(), inactiveDuplicateAgency],
    Array.from({ length: 51 }, (_, index) => membership({
      id: `membership-${index}`,
      membership_key: `agency-${index}:user-1`,
      agency_id: `agency-${index}`,
      status: 'pending',
      activated_at: undefined,
    })),
    Array.from({ length: 26 }, (_, index) => membership({
      id: `membership-${index}`,
      membership_key: `agency-${String(index).padStart(2, '0')}:user-1`,
      agency_id: `agency-${String(index).padStart(2, '0')}`,
    })),
  ];
  for (const rows of cases) {
    const loaded = await loadBroker({ membershipResults: [rows, rows] });
    const result = await invoke(loaded.handler);
    assert.equal(result.response.status, 409);
    assert.deepEqual(loaded.calls.agencyFilters, []);
  }
});

test('non-array provider results and unsafe Agency rows never produce a partial list', async () => {
  const originalError = console.error;
  console.error = () => {};
  try {
    const nonArrayMembership = await loadBroker({ membershipResults: [null] });
    const membershipResult = await invoke(nonArrayMembership.handler);
    assert.equal(membershipResult.response.status, 500);
    assert.deepEqual(membershipResult.json, { error: 'Internal server error' });

    const agencyCases = [
      { result: [], status: 403 },
      { result: [agency({ id: 'agency-z' })], status: 409 },
      { result: [agency(), agency()], status: 409 },
      { result: [agency({ agency_name: ' Agency A ' })], status: 409 },
      { result: [agency({ agency_name: 'Agency\nA' })], status: 409 },
      { result: [agency({ agency_name: 'Agency\u202eA' })], status: 409 },
      { result: [agency({ status: 'suspended' })], status: 403 },
      { result: null, status: 500 },
    ];
    for (const entry of agencyCases) {
      const loaded = await loadBroker({ agencyResult: () => entry.result });
      const result = await invoke(loaded.handler);
      assert.equal(result.response.status, entry.status);
      assert.equal(Object.hasOwn(result.json, 'memberships'), false);
    }
  } finally {
    console.error = originalError;
  }
});

test('membership, Agency, and caller drift are rejected before returning selector options', async () => {
  const membershipDrift = await loadBroker({
    membershipResults: [[membership()], [membership({ version: 2 })]],
  });
  const membershipResult = await invoke(membershipDrift.handler);
  assert.equal(membershipResult.response.status, 409);
  assert.equal(membershipResult.json.error, 'Tenant membership list changed during request');

  const agencyDrift = await loadBroker({
    agencyResult: ({ count }) => [agency({
      agency_name: count === 1 ? 'Agency A' : 'Agency A Renamed',
    })],
  });
  const agencyResult = await invoke(agencyDrift.handler);
  assert.equal(agencyResult.response.status, 409);
  assert.equal(agencyResult.json.error, 'Agency list changed during request');

  for (const changedUser of [
    { ...defaultUser, email: 'changed@example.com' },
    { ...defaultUser, is_active: false },
  ]) {
    const callerDrift = await loadBroker({ users: [defaultUser, changedUser] });
    const callerResult = await invoke(callerDrift.handler);
    assert.equal(callerResult.response.status, 409);
    assert.equal(callerResult.json.error, 'Caller identity changed during request');
  }
});

test('the frontend wrapper accepts only the exact bounded broker envelope and clones it', async () => {
  const original = publicResult();
  const loaded = await loadWrapper({ data: original });
  const result = await loaded.list();

  assert.deepEqual(loaded.calls, [[]]);
  assert.deepEqual(result, original);
  assert.notEqual(result, original);
  assert.notEqual(result.subject, original.subject);
  assert.notEqual(result.memberships, original.memberships);
  assert.notEqual(result.memberships[0], original.memberships[0]);
  assert.notEqual(result.memberships[0].agency, original.memberships[0].agency);

  loaded.setResult({
    subject: {
      user_id: 'owner-1',
      user_email: 'owner@example.com',
      is_platform_owner: true,
    },
    memberships: [],
  });
  const owner = await loaded.list();
  assert.equal(owner.subject.is_platform_owner, true);
  assert.deepEqual(owner.memberships, []);
});

test('the frontend wrapper rejects cross-user, duplicate, malformed, overflow, and drifted rows', async () => {
  const loaded = await loadWrapper(publicResult());
  const optionB = publicOption({
    membership_id: 'membership-b',
    membership_key: 'agency-b:user-1',
    agency_id: 'agency-b',
    agency: { id: 'agency-b', name: 'Agency B', status: 'trial' },
  });
  const invalidResults = [
    { ...publicResult(), extra: true },
    publicResult({ subject: { ...publicResult().subject, account_type: 'super_admin' } }),
    publicResult({ subject: { ...publicResult().subject, user_email: 'Member@Example.com' } }),
    publicResult({
      subject: { ...publicResult().subject, is_platform_owner: true },
    }),
    publicResult({ memberships: null }),
    publicResult({ memberships: Array.from({ length: 26 }, (_, index) => publicOption({
      membership_id: `membership-${index}`,
      membership_key: `agency-${String(index).padStart(2, '0')}:user-1`,
      agency_id: `agency-${String(index).padStart(2, '0')}`,
      agency: {
        id: `agency-${String(index).padStart(2, '0')}`,
        name: `Agency ${index}`,
      },
    })) }),
    publicResult({ memberships: [publicOption({ user_id: 'user-1' })] }),
    publicResult({ memberships: [publicOption({ membership_id: '$ne' })] }),
    publicResult({ memberships: [publicOption({ membership_key: 'agency-a:user-z' })] }),
    publicResult({ memberships: [publicOption({ membership_version: 0 })] }),
    publicResult({ memberships: [publicOption({ tenant_role: 'platform_owner' })] }),
    publicResult({ memberships: [publicOption({ membership_status: 'suspended' })] }),
    publicResult({ memberships: [publicOption({ agency: { id: 'agency-z' } })] }),
    publicResult({ memberships: [publicOption({ agency: { name: ' Agency A ' } })] }),
    publicResult({ memberships: [publicOption({ agency: { name: 'Agency\nA' } })] }),
    publicResult({ memberships: [publicOption({ agency: { name: 'Agency\u2066A' } })] }),
    publicResult({ memberships: [publicOption({ agency: { status: 'suspended' } })] }),
    publicResult({ memberships: [publicOption({
      agency: { contact_email: 'private@example.com' },
    })] }),
    publicResult({ memberships: [publicOption(), publicOption()] }),
    publicResult({ memberships: [optionB, publicOption()] }),
  ];

  for (const invalid of invalidResults) {
    loaded.setResult(invalid);
    await assert.rejects(
      () => loaded.list(),
      /Tenant membership list failed integrity validation/,
    );
  }
});
