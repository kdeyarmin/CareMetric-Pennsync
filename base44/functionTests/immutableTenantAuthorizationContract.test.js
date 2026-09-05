import assert from 'node:assert/strict';
import { readFile, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import JSON5 from 'json5';
import { transpileTs } from '../../tools-transpile-ts.mjs';
import './tenantMembershipSelectionContract.cases.js';

const functionUrl = new URL('../functions/getMyTenantContext/entry.ts', import.meta.url);
const entityUrl = new URL('../entities/AgencyMembership.jsonc', import.meta.url);
const wrapperUrl = new URL('../../src/functions/getMyTenantContext.js', import.meta.url);

const defaultUser = { id: 'user-1', email: 'Member@Example.com', role: 'user' };

const membership = (overrides = {}) => {
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
    last_transition_at: '2026-09-03T12:00:00.000Z',
    last_transition_reason: 'Authorized lifecycle transition',
    version: 1,
    ...overrides,
  };
  if (
    (row.status === 'active' || row.status === 'suspended')
    && row.activated_at === undefined
  ) {
    row.activated_at = '2026-09-03T12:01:00.000Z';
  }
  if (row.status === 'revoked') {
    if (row.revoked_at === undefined) row.revoked_at = '2026-09-03T12:02:00.000Z';
    if (row.revocation_reason === undefined) row.revocation_reason = 'Revoked by test operator';
  }
  return row;
};

const agency = (overrides = {}) => ({
  id: 'agency-a',
  agency_name: 'Agency A',
  status: 'active',
  ...overrides,
});

async function loadHandler({
  user = defaultUser,
  users,
  membershipRows = [membership()],
  membershipResults,
  agencyRows = [agency()],
  agencyResult,
  superAdminEmail = '',
} = {}) {
  let source = await readFile(functionUrl, 'utf8');
  source = source.replace(
    /import\s+\{\s*createClientFromRequest\s*\}\s+from\s+'npm:[^']+';/,
    'const createClientFromRequest = globalThis.__tenantContextMakeClient;',
  );

  const temporaryModule = join(
    tmpdir(),
    `tenant_context_${Date.now()}_${Math.random().toString(36).slice(2)}.mjs`,
  );
  await writeFile(temporaryModule, transpileTs(source).outputText);

  const calls = {
    clientConstructions: 0,
    auth: 0,
    membershipFilters: [],
    agencyFilters: [],
  };
  const effectiveUsers = users || [user, user];
  const effectiveMembershipResults = membershipResults || [membershipRows, membershipRows];
  const agencyCallCounts = new Map();
  const client = {
    auth: {
      me: async () => {
        const index = Math.min(calls.auth, effectiveUsers.length - 1);
        calls.auth += 1;
        return effectiveUsers[index];
      },
    },
    asServiceRole: {
      entities: {
        AgencyMembership: {
          filter: async (...args) => {
            const index = calls.membershipFilters.length;
            calls.membershipFilters.push(args);
            return effectiveMembershipResults[
              Math.min(index, effectiveMembershipResults.length - 1)
            ];
          },
        },
        Agency: {
          filter: async (...args) => {
            calls.agencyFilters.push(args);
            const agencyId = args[0]?.id;
            const count = (agencyCallCounts.get(agencyId) || 0) + 1;
            agencyCallCounts.set(agencyId, count);
            if (agencyResult) return agencyResult({ agencyId, count, args });
            return agencyRows;
          },
        },
      },
    },
  };

  let handler;
  globalThis.__tenantContextMakeClient = () => {
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
  const response = await handler(new Request('http://local/getMyTenantContext', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }));
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('pragma'), 'no-cache');
  return { response, json: await response.json() };
}

async function invokeRaw(handler, raw) {
  const response = await handler(new Request('http://local/getMyTenantContext', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: raw,
  }));
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('pragma'), 'no-cache');
  return { response, json: await response.json() };
}

test('AgencyMembership is a required service-owned authority entity', async () => {
  const source = await readFile(entityUrl, 'utf8');
  const schema = JSON5.parse(source);

  assert.equal(schema.name, 'AgencyMembership');
  assert.deepEqual(schema.rls, {
    create: false,
    read: false,
    update: false,
    delete: false,
  });
  for (const field of [
    'membership_key',
    'agency_id',
    'user_id',
    'user_email_normalized',
    'tenant_role',
    'status',
    'created_by_user_id',
    'last_transition_by_user_id',
    'last_transition_by_email_normalized',
    'last_transition_at',
    'last_transition_reason',
    'version',
  ]) {
    assert.equal(schema.required.includes(field), true, field);
  }
  assert.deepEqual(schema.properties.status.enum, [
    'pending',
    'active',
    'suspended',
    'revoked',
  ]);
});

test('client wrapper invokes only the matching tenant-context broker', async () => {
  const source = await readFile(wrapperUrl, 'utf8');
  assert.match(source, /base44\.functions\.invoke\('getMyTenantContext', payload\)/);
  assert.doesNotMatch(source, /entities\.|auth\.updateMe/);
});

test('resolver source does not authorize from mutable custom User claims', async () => {
  const source = await readFile(functionUrl, 'utf8');
  assert.match(source, /userId = exactIdentifier\(user\.id\)/);
  assert.match(source, /user\.role === 'admin'/);
  assert.match(source, /Deno\.env\.get\('SUPER_ADMIN_EMAIL'\)/);
  assert.doesNotMatch(
    source,
    /user\.(?:account_type|agency_id|agency_name|agency_role|is_active|is_approved|is_manager|manager_email|staff_role|care_scope)\b/,
  );
  assert.match(source, /console\.error\('getMyTenantContext failed'\)/);
  assert.doesNotMatch(source, /console\.error\([^)]*,\s*error\b/);
  assert.ok(
    source.indexOf("req.method !== 'POST'") < source.indexOf('createClientFromRequest(req)'),
    'method gate must run before client construction',
  );
  assert.match(source, /req\.body\?\.getReader\(\)/);
  assert.doesNotMatch(source, /req\.text\(\)|req\.json\(\)/);
  assert.match(source, /'Cache-Control': 'no-store'/);
  assert.match(source, /Tenant membership changed during request/);
  assert.match(source, /Agency changed during request/);
  assert.match(source, /Caller identity changed during request/);
});

test('an active exact membership resolves through exact Agency validation', async () => {
  const { handler, calls } = await loadHandler();
  const { response, json } = await invoke(handler);

  assert.equal(response.status, 200);
  assert.deepEqual(calls.membershipFilters, [
    [{ user_id: 'user-1' }, 'agency_id', 51],
    [{ user_id: 'user-1' }, 'agency_id', 51],
  ]);
  assert.deepEqual(calls.agencyFilters, [
    [{ id: 'agency-a' }, undefined, 2],
    [{ id: 'agency-a' }, undefined, 2],
  ]);
  assert.deepEqual(json.tenant_context, {
    user_id: 'user-1',
    user_email: 'member@example.com',
    membership_id: 'membership-a',
    membership_key: 'agency-a:user-1',
    membership_version: 1,
    agency_id: 'agency-a',
    tenant_role: 'clinician',
    membership_status: 'active',
    is_platform_owner: false,
    agency: { id: 'agency-a', name: 'Agency A', status: 'active' },
  });
});

test('custom super-admin and agency claims cannot replace an active membership', async () => {
  const { handler, calls } = await loadHandler({
    user: {
      id: 'attacker',
      email: 'attacker@example.com',
      role: 'user',
      account_type: 'super_admin',
      agency_id: 'agency-a',
      agency_name: 'Agency A',
      agency_role: 'agency_admin',
      is_active: true,
      is_approved: true,
      is_manager: true,
      staff_role: 'nurse',
    },
    membershipRows: [],
    superAdminEmail: 'owner@example.com',
  });
  const { response } = await invoke(handler, { agency_id: 'agency-a' });

  assert.equal(response.status, 403);
  assert.deepEqual(calls.agencyFilters, []);
});

test('missing immutable built-in identity fails before service-role reads', async () => {
  for (const user of [
    { email: 'member@example.com', role: 'admin', account_type: 'super_admin' },
    { id: 'user-1', role: 'admin', account_type: 'super_admin' },
    { id: ' user-1', email: 'member@example.com', role: 'admin' },
  ]) {
    const { handler, calls } = await loadHandler({
      user,
      superAdminEmail: 'member@example.com',
    });
    const { response } = await invoke(handler);

    assert.equal(response.status, 403);
    assert.deepEqual(calls.membershipFilters, []);
    assert.deepEqual(calls.agencyFilters, []);
  }
});

test('disabled, service, and explicitly unverified callers fail before service-role reads', async () => {
  for (const user of [
    { id: 'user-1', email: 'member@example.com', role: 'user', disabled: true },
    { id: 'user-1', email: 'member@example.com', role: 'user', is_service: true },
    { id: 'user-1', email: 'member@example.com', role: 'user', is_verified: false },
  ]) {
    const { handler, calls } = await loadHandler({ user });
    const { response } = await invoke(handler);
    assert.equal(response.status, 403);
    assert.deepEqual(calls.membershipFilters, []);
    assert.deepEqual(calls.agencyFilters, []);
  }
});

test('inactive and foreign service-filter-regression rows never authorize', async () => {
  const { handler, calls } = await loadHandler({
    membershipRows: [
      membership({ status: 'revoked' }),
      membership({
        id: 'foreign',
        membership_key: 'agency-a:other-user',
        user_id: 'other-user',
        user_email_normalized: 'other@example.com',
      }),
    ],
  });
  const { response } = await invoke(handler);

  assert.equal(response.status, 409);
  assert.deepEqual(calls.agencyFilters, []);
});

test('email mismatch or noncanonical membership email fails closed', async () => {
  for (const storedEmail of ['other@example.com', 'Member@Example.com']) {
    const { handler, calls } = await loadHandler({
      membershipRows: [membership({ user_email_normalized: storedEmail })],
    });
    const { response } = await invoke(handler);

    assert.equal(response.status, 409, storedEmail);
    assert.deepEqual(calls.agencyFilters, [], storedEmail);
  }
});

test('duplicate active membership keys or agencies fail closed', async () => {
  for (const duplicate of [
    membership({ id: 'membership-b' }),
    membership({
      id: 'membership-b',
      membership_key: 'agency-a:user-1',
      agency_id: 'agency-a',
    }),
    membership({
      id: 'membership-a',
      membership_key: 'agency-b:user-1',
      agency_id: 'agency-b',
    }),
  ]) {
    const { handler, calls } = await loadHandler({
      membershipRows: [membership(), duplicate],
    });
    const { response } = await invoke(handler, { agency_id: 'agency-a' });

    assert.equal(response.status, 409);
    assert.deepEqual(calls.agencyFilters, []);
  }
});

test('inactive lifecycle duplicates cannot be hidden beside an active membership', async () => {
  for (const duplicate of [
    membership({ id: 'membership-revoked', status: 'revoked' }),
    membership({ id: 'membership-suspended', status: 'suspended' }),
    membership({ id: 'membership-pending', status: 'pending' }),
  ]) {
    const { handler, calls } = await loadHandler({
      membershipRows: [membership(), duplicate],
    });
    const { response } = await invoke(handler, { agency_id: 'agency-a' });
    assert.equal(response.status, 409);
    assert.deepEqual(calls.agencyFilters, []);
  }
});

test('all exact lifecycle rows require complete provenance, versions, and status timestamps', async () => {
  const corruptRows = [
    membership({ created_by_user_id: '' }),
    membership({ last_transition_by_user_id: '' }),
    membership({ last_transition_by_email_normalized: 'Owner@Example.com' }),
    membership({ last_transition_at: 'invalid' }),
    membership({ last_transition_reason: '' }),
    membership({ version: 0 }),
    membership({ version: 1.5 }),
    membership({ status: 'active', activated_at: 'invalid' }),
    membership({ status: 'suspended', activated_at: 'invalid' }),
    membership({ status: 'revoked', revoked_at: 'invalid' }),
    membership({ status: 'revoked', revocation_reason: '' }),
    membership({ status: 'active', revoked_at: '2026-09-03T12:02:00.000Z' }),
    membership({ status: 'active', revocation_reason: 'Polluted active row' }),
    membership({ status: 'suspended', revoked_at: '2026-09-03T12:02:00.000Z' }),
    membership({ status: 'suspended', revocation_reason: 'Polluted suspended row' }),
    membership({ status: 'unknown' }),
  ];
  for (const corrupt of corruptRows) {
    const { handler, calls } = await loadHandler({ membershipRows: [corrupt] });
    const { response } = await invoke(handler);
    assert.equal(response.status, 409);
    assert.deepEqual(calls.agencyFilters, []);
  }
});

test('a capped all-status membership scan fails closed', async () => {
  const rows = Array.from({ length: 100 }, (_, index) => membership({
    id: `membership-${index}`,
    membership_key: `agency-${index}:user-1`,
    agency_id: `agency-${index}`,
  }));
  const { handler, calls } = await loadHandler({ membershipRows: rows });
  const { response } = await invoke(handler);
  assert.equal(response.status, 409);
  assert.deepEqual(calls.agencyFilters, []);
});

test('non-array membership and Agency provider results fail closed', async () => {
  const originalError = console.error;
  console.error = () => {};
  try {
    const membershipLoad = await loadHandler({ membershipRows: null });
    const membershipResult = await invoke(membershipLoad.handler);
    assert.equal(membershipResult.response.status, 500);
    assert.deepEqual(membershipLoad.calls.agencyFilters, []);

    const agencyLoad = await loadHandler({ agencyRows: null });
    const agencyResult = await invoke(agencyLoad.handler);
    assert.equal(agencyResult.response.status, 500);
  } finally {
    console.error = originalError;
  }
});

test('a canonical key mismatch fails closed before Agency lookup', async () => {
  const { handler, calls } = await loadHandler({
    membershipRows: [membership({ membership_key: 'forged-key' })],
  });
  const { response } = await invoke(handler);

  assert.equal(response.status, 409);
  assert.deepEqual(calls.agencyFilters, []);
});

test('multiple memberships require an explicit exact agency selection', async () => {
  const second = membership({
    id: 'membership-b',
    membership_key: 'agency-b:user-1',
    agency_id: 'agency-b',
    tenant_role: 'manager',
  });

  const firstLoad = await loadHandler({ membershipRows: [membership(), second] });
  const missing = await invoke(firstLoad.handler);
  assert.equal(missing.response.status, 409);
  assert.deepEqual(firstLoad.calls.agencyFilters, []);

  const selectedLoad = await loadHandler({
    membershipRows: [membership(), second],
    agencyRows: [agency({ id: 'agency-b', agency_name: 'Agency B', status: 'trial' })],
  });
  const selected = await invoke(selectedLoad.handler, { agency_id: 'agency-b' });
  assert.equal(selected.response.status, 200);
  assert.equal(selected.json.tenant_context.agency_id, 'agency-b');
  assert.equal(selected.json.tenant_context.tenant_role, 'manager');
  assert.deepEqual(selectedLoad.calls.agencyFilters, [
    [{ id: 'agency-b' }, undefined, 2],
    [{ id: 'agency-b' }, undefined, 2],
  ]);
});

test('unrelated, duplicate, and inactive Agency rows fail exact validation', async () => {
  const cases = [
    { rows: [agency({ id: 'agency-b' })], status: 409 },
    { rows: [agency(), agency()], status: 409 },
    { rows: [agency({ status: 'suspended' })], status: 403 },
  ];

  for (const { rows, status } of cases) {
    const { handler } = await loadHandler({ agencyRows: rows });
    const { response } = await invoke(handler);
    assert.equal(response.status, status);
  }
});

test('only the exact configured built-in admin may obtain membership-free owner context', async () => {
  const impostors = [
    { id: 'owner', email: 'owner@example.com', role: 'user', account_type: 'super_admin' },
    { id: 'owner', email: 'other@example.com', role: 'admin', account_type: 'super_admin' },
  ];

  for (const user of impostors) {
    const { handler } = await loadHandler({
      user,
      membershipRows: [],
      superAdminEmail: 'owner@example.com',
    });
    const { response } = await invoke(handler);
    assert.equal(response.status, 403);
  }

  const { handler, calls } = await loadHandler({
    user: { id: 'owner', email: ' Owner@Example.com ', role: 'admin' },
    membershipRows: [],
    superAdminEmail: 'owner@example.com',
  });
  const { response, json } = await invoke(handler);
  assert.equal(response.status, 200);
  assert.deepEqual(calls.agencyFilters, []);
  assert.deepEqual(json.tenant_context, {
    user_id: 'owner',
    user_email: 'owner@example.com',
    membership_id: null,
    membership_key: null,
    membership_version: null,
    agency_id: null,
    tenant_role: 'platform_owner',
    membership_status: null,
    is_platform_owner: true,
    agency: null,
  });
});

test('membership-free owner agency selection is still exact and status validated', async () => {
  const { handler, calls } = await loadHandler({
    user: { id: 'owner', email: 'owner@example.com', role: 'admin' },
    membershipRows: [],
    agencyRows: [agency({ status: 'trial' })],
    superAdminEmail: 'owner@example.com',
  });
  const { response, json } = await invoke(handler, { agency_id: 'agency-a' });

  assert.equal(response.status, 200);
  assert.equal(json.tenant_context.tenant_role, 'platform_owner');
  assert.equal(json.tenant_context.agency_id, 'agency-a');
  assert.deepEqual(calls.agencyFilters, [
    [{ id: 'agency-a' }, undefined, 2],
    [{ id: 'agency-a' }, undefined, 2],
  ]);
});

test('a protected owner fails closed when any tenant membership row exists', async () => {
  const ownerMembership = membership({
    id: 'membership-owner',
    membership_key: 'agency-a:owner',
    user_id: 'owner',
    user_email_normalized: 'owner@example.com',
  });

  for (const membershipRows of [
    [ownerMembership],
    [ownerMembership, { ...ownerMembership, id: 'membership-owner-duplicate' }],
  ]) {
    const { handler, calls } = await loadHandler({
      user: { id: 'owner', email: 'owner@example.com', role: 'admin' },
      membershipRows,
      superAdminEmail: 'owner@example.com',
    });
    const { response, json } = await invoke(handler, { agency_id: 'agency-a' });

    assert.equal(response.status, 409);
    assert.match(json.error, /Platform owner tenant membership must not exist|ambiguous/);
    assert.deepEqual(calls.agencyFilters, []);
  }
});

test('operator-shaped and malformed agency selectors are rejected before service reads', async () => {
  for (const agencyId of [{ $ne: null }, '', ' agency-a', '$ne', null]) {
    const { handler, calls } = await loadHandler();
    const { response } = await invoke(handler, { agency_id: agencyId });

    assert.equal(response.status, 400);
    assert.deepEqual(calls.membershipFilters, []);
    assert.deepEqual(calls.agencyFilters, []);
  }
});

test('POST is required before client construction and body parsing follows authentication', async () => {
  const methodLoaded = await loadHandler();
  const methodResponse = await methodLoaded.handler(new Request(
    'http://local/getMyTenantContext',
    { method: 'GET' },
  ));
  assert.equal(methodResponse.status, 405);
  assert.equal(methodResponse.headers.get('allow'), 'POST');
  assert.equal(methodResponse.headers.get('cache-control'), 'no-store');
  assert.equal(methodResponse.headers.get('pragma'), 'no-cache');
  assert.equal(methodLoaded.calls.clientConstructions, 0);
  assert.equal(methodLoaded.calls.auth, 0);

  const authenticated = await loadHandler();
  const emptyResponse = await authenticated.handler(new Request(
    'http://local/getMyTenantContext',
    { method: 'POST' },
  ));
  assert.equal(emptyResponse.status, 400);
  assert.equal(emptyResponse.headers.get('cache-control'), 'no-store');
  assert.equal(authenticated.calls.auth, 1);
  assert.deepEqual(authenticated.calls.membershipFilters, []);

  const unauthenticated = await loadHandler({ user: null });
  const unauthenticatedResponse = await unauthenticated.handler(new Request(
    'http://local/getMyTenantContext',
    { method: 'POST' },
  ));
  assert.equal(unauthenticatedResponse.status, 401);
  assert.equal(unauthenticatedResponse.headers.get('cache-control'), 'no-store');
  assert.equal(unauthenticated.calls.auth, 1);
});

test('chunked bodies without Content-Length are cancelled at the byte cap', async () => {
  let pulls = 0;
  let cancelled = false;
  const stream = new ReadableStream({
    pull(controller) {
      pulls += 1;
      controller.enqueue(new Uint8Array(1_100).fill(0x20));
    },
    cancel() {
      cancelled = true;
    },
  });
  const request = new Request('http://local/getMyTenantContext', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: stream,
    duplex: 'half',
  });
  assert.equal(request.headers.get('content-length'), null);
  const loaded = await loadHandler();
  const response = await loaded.handler(request);
  assert.equal(response.status, 413);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(cancelled, true);
  assert.ok(pulls <= 3, `stream should stop promptly, observed ${pulls} pulls`);
  assert.deepEqual(loaded.calls.membershipFilters, []);
});

test('request keys and optimistic membership identity are structurally exact', async () => {
  const invalidBodies = [
    { extra: true },
    { agency_id: 'agency-a', expected_membership_id: 'membership-a' },
    { agency_id: 'agency-a', expected_membership_version: 1 },
    { expected_membership_id: 'membership-a', expected_membership_version: 1 },
    {
      agency_id: 'agency-a',
      expected_membership_id: '$ne',
      expected_membership_version: 1,
    },
    {
      agency_id: 'agency-a',
      expected_membership_id: 'membership-a',
      expected_membership_version: 0,
    },
    {
      agency_id: 'agency-a',
      expected_membership_id: 'membership-a',
      expected_membership_version: 1.5,
    },
  ];
  for (const body of invalidBodies) {
    const loaded = await loadHandler();
    const result = await invoke(loaded.handler, body);
    assert.equal(result.response.status, 400);
    assert.deepEqual(loaded.calls.membershipFilters, []);
  }
  const invalidJson = await loadHandler();
  const invalidJsonResult = await invokeRaw(invalidJson.handler, '{invalid');
  assert.equal(invalidJsonResult.response.status, 400);
  assert.deepEqual(invalidJson.calls.membershipFilters, []);
});

test('an explicit selector choice is bound to the exact membership id and version', async () => {
  const selected = await loadHandler();
  const selectedResult = await invoke(selected.handler, {
    agency_id: 'agency-a',
    expected_membership_id: 'membership-a',
    expected_membership_version: 1,
  });
  assert.equal(selectedResult.response.status, 200);
  assert.equal(selectedResult.json.tenant_context.membership_id, 'membership-a');
  assert.equal(selectedResult.json.tenant_context.membership_version, 1);

  for (const expectation of [
    { expected_membership_id: 'membership-z', expected_membership_version: 1 },
    { expected_membership_id: 'membership-a', expected_membership_version: 2 },
  ]) {
    const stale = await loadHandler();
    const staleResult = await invoke(stale.handler, {
      agency_id: 'agency-a',
      ...expectation,
    });
    assert.equal(staleResult.response.status, 409);
    assert.equal(
      staleResult.json.error,
      'Selected tenant membership changed; refresh choices',
    );
    assert.deepEqual(stale.calls.agencyFilters, []);
  }
});

test('membership, Agency, and caller snapshots must remain stable through response', async () => {
  const membershipDrift = await loadHandler({
    membershipResults: [[membership()], [membership({ version: 2 })]],
  });
  const membershipResult = await invoke(membershipDrift.handler);
  assert.equal(membershipResult.response.status, 409);
  assert.equal(membershipResult.json.error, 'Tenant membership changed during request');

  const agencyDrift = await loadHandler({
    agencyResult: ({ count }) => [agency({
      agency_name: count === 1 ? 'Agency A' : 'Agency A Renamed',
    })],
  });
  const agencyResult = await invoke(agencyDrift.handler);
  assert.equal(agencyResult.response.status, 409);
  assert.equal(agencyResult.json.error, 'Agency changed during request');

  const changedUser = { ...defaultUser, role: 'admin' };
  const callerDrift = await loadHandler({ users: [defaultUser, changedUser] });
  const callerResult = await invoke(callerDrift.handler);
  assert.equal(callerResult.response.status, 409);
  assert.equal(callerResult.json.error, 'Caller identity changed during request');
});

test('Agency labels reject whitespace, control, bidi, and overflow text', async () => {
  const names = [
    '',
    ' Agency A ',
    'Agency\nA',
    'Agency\u202eA',
    'A'.repeat(201),
  ];
  for (const agencyName of names) {
    const loaded = await loadHandler({
      agencyRows: [agency({ agency_name: agencyName })],
    });
    const result = await invoke(loaded.handler);
    assert.equal(result.response.status, 409);
    assert.equal(Object.hasOwn(result.json, 'tenant_context'), false);
  }
});
