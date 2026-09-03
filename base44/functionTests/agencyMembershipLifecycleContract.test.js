import assert from 'node:assert/strict';
import { readFile, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import JSON5 from 'json5';
import { transpileTs } from '../../tools-transpile-ts.mjs';

const functionUrl = new URL('../functions/manageAgencyMembership/entry.ts', import.meta.url);
const entityUrl = new URL('../entities/AgencyMembership.jsonc', import.meta.url);
const wrapperUrl = new URL('../../src/functions/manageAgencyMembership.js', import.meta.url);

const OWNER = { id: 'owner-1', email: 'Owner@Example.test', role: 'admin', is_active: true };
const TARGET = { id: 'target-1', email: 'Target@Example.test', role: 'user', is_active: true };
const ADMIN = { id: 'admin-1', email: 'Admin@Agency.test', role: 'user', is_active: true };

const membership = (overrides = {}) => {
  const row = {
    id: 'membership-target',
    membership_key: 'agency-a:target-1',
    agency_id: 'agency-a',
    user_id: 'target-1',
    user_email_normalized: 'target@example.test',
    tenant_role: 'clinician',
    status: 'pending',
    created_by_user_id: 'owner-1',
    last_transition_by_user_id: 'owner-1',
    last_transition_by_email_normalized: 'owner@example.test',
    last_transition_at: '2026-09-03T12:00:00.000Z',
    last_transition_reason: 'Initial provision',
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

const adminMembership = (overrides = {}) => membership({
  id: 'membership-admin',
  membership_key: 'agency-a:admin-1',
  user_id: 'admin-1',
  user_email_normalized: 'admin@agency.test',
  tenant_role: 'agency_admin',
  status: 'active',
  ...overrides,
});

const agency = (overrides = {}) => ({
  id: 'agency-a',
  agency_name: 'Agency A',
  status: 'active',
  ...overrides,
});

async function loadHandler({
  caller = OWNER,
  users = [TARGET, ADMIN, OWNER],
  agencies = [agency()],
  memberships = [],
  superAdminEmail = 'owner@example.test',
  ignoreFilters = false,
  nonArrayEntity = null,
  createDuplicate = false,
  createdByMutation = null,
  revokeAuthorityOnRecheck = false,
  updateNoop = false,
} = {}) {
  let source = await readFile(functionUrl, 'utf8');
  source = source.replace(
    /import\s+\{\s*createClientFromRequest\s*\}\s+from\s+'npm:[^']+';/,
    'const createClientFromRequest = globalThis.__membershipLifecycleMakeClient;',
  );
  const temporaryModule = join(
    tmpdir(),
    `membership_lifecycle_${Date.now()}_${Math.random().toString(36).slice(2)}.mjs`,
  );
  await writeFile(temporaryModule, transpileTs(source).outputText);

  const state = {
    users: users.map((row) => ({ ...row })),
    agencies: agencies.map((row) => ({ ...row })),
    memberships: memberships.map((row) => ({ ...row })),
  };
  const calls = { filters: [], creates: [], updates: [] };
  let authorityReads = 0;
  const filtered = (entity, rows, query, limit) => {
    calls.filters.push({ entity, query: { ...(query || {}) }, limit });
    if (nonArrayEntity === entity) return null;
    const result = ignoreFilters
      ? rows
      : rows.filter((row) => Object.entries(query || {}).every(([key, value]) => row?.[key] === value));
    return Number.isFinite(limit) ? result.slice(0, limit) : result;
  };
  const client = {
    auth: {
      me: async () => {
        if (caller instanceof Error) throw caller;
        return caller;
      },
    },
    asServiceRole: {
      entities: {
        User: {
          filter: async (query, sort, limit) => filtered('User', state.users, query, limit),
        },
        Agency: {
          filter: async (query, sort, limit) => filtered('Agency', state.agencies, query, limit),
        },
        AgencyMembership: {
          filter: async (query, sort, limit) => {
            if (
              revokeAuthorityOnRecheck
              && query?.agency_id === 'agency-a'
              && query?.user_id === 'admin-1'
            ) {
              authorityReads += 1;
              if (authorityReads === 2) {
                const index = state.memberships.findIndex((row) => row.user_id === 'admin-1');
                if (index !== -1) {
                  const previous = state.memberships[index];
                  state.memberships[index] = membership({
                    ...previous,
                    status: 'revoked',
                    version: previous.version + 1,
                    revoked_at: '2026-09-03T12:10:00.000Z',
                    revocation_reason: 'Concurrent authority revocation',
                    last_transition_at: '2026-09-03T12:10:00.000Z',
                    last_transition_reason: 'Concurrent authority revocation',
                  });
                }
              }
            }
            return filtered('AgencyMembership', state.memberships, query, limit);
          },
          create: async (payload) => {
            calls.creates.push({ ...payload });
            const row = {
              id: `membership-${state.memberships.length + 1}`,
              ...payload,
              ...(createdByMutation ? { created_by_user_id: createdByMutation } : {}),
            };
            state.memberships.push(row);
            if (createDuplicate) {
              state.memberships.push({ ...row, id: `${row.id}-duplicate` });
            }
            return row;
          },
          update: async (id, payload) => {
            calls.updates.push({ id, payload: { ...payload } });
            const index = state.memberships.findIndex((row) => row.id === id);
            if (!updateNoop && index !== -1) {
              state.memberships[index] = { ...state.memberships[index], ...payload };
            }
            return index === -1 ? { id, ...payload } : state.memberships[index];
          },
        },
      },
    },
  };

  let handler;
  globalThis.__membershipLifecycleMakeClient = () => client;
  globalThis.Deno = {
    serve: (candidate) => { handler = candidate; },
    env: { get: (name) => (name === 'SUPER_ADMIN_EMAIL' ? superAdminEmail : undefined) },
  };
  try {
    await import(pathToFileURL(temporaryModule).href);
  } finally {
    await unlink(temporaryModule).catch(() => {});
    delete globalThis.__membershipLifecycleMakeClient;
  }
  assert.equal(typeof handler, 'function');
  return { handler, state, calls };
}

const provisionBody = (overrides = {}) => ({
  action: 'provision',
  agency_id: 'agency-a',
  target_user_id: 'target-1',
  target_user_email: 'target@example.test',
  tenant_role: 'clinician',
  reason: 'Initial provision',
  ...overrides,
});

const transitionBody = (action, expectedVersion, overrides = {}) => ({
  action,
  agency_id: 'agency-a',
  target_user_id: 'target-1',
  target_user_email: 'target@example.test',
  expected_version: expectedVersion,
  reason: `${action} requested`,
  ...overrides,
});

const inspectBody = (overrides = {}) => ({
  action: 'inspect',
  agency_id: 'agency-a',
  target_user_id: 'target-1',
  target_user_email: 'target@example.test',
  ...overrides,
});

async function invoke(handler, body = provisionBody(), { invalidJson = false, method = 'POST' } = {}) {
  const request = new Request('http://local/manageAgencyMembership', {
    method,
    headers: { 'content-type': 'application/json' },
    body: invalidJson ? '{' : JSON.stringify(body),
  });
  const response = await handler(request);
  return { response, json: await response.json() };
}

test('AgencyMembership is service-owned and requires lifecycle provenance', async () => {
  const schema = JSON5.parse(await readFile(entityUrl, 'utf8'));
  assert.deepEqual(schema.rls, { create: false, read: false, update: false, delete: false });
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
});

test('client wrapper invokes only the lifecycle broker', async () => {
  const source = await readFile(wrapperUrl, 'utf8');
  assert.match(source, /base44\.functions\.invoke\('manageAgencyMembership', payload\)/);
  assert.doesNotMatch(source, /entities\.|auth\.updateMe/);
});

test('anonymous, deactivated, and malformed requests fail before privileged reads', async () => {
  for (const [caller, body, options, expectedStatus] of [
    [new Error('login required'), provisionBody(), {}, 401],
    [{ ...OWNER, is_active: false }, provisionBody(), {}, 403],
    [{ ...OWNER, disabled: true }, provisionBody(), {}, 403],
    [{ ...OWNER, is_service: true }, provisionBody(), {}, 403],
    [{ ...OWNER, is_verified: false }, provisionBody(), {}, 403],
    [OWNER, provisionBody(), { invalidJson: true }, 400],
    [OWNER, { ...provisionBody(), agency_id: { $ne: null } }, {}, 400],
    [OWNER, { ...provisionBody(), target_user_id: ' target-1' }, {}, 400],
    [OWNER, { ...provisionBody(), reason: '' }, {}, 400],
    [OWNER, { ...provisionBody(), status: 'active' }, {}, 400],
    [OWNER, provisionBody(), { method: 'PUT' }, 405],
  ]) {
    const { handler, calls } = await loadHandler({ caller });
    const { response } = await invoke(handler, body, options);
    assert.equal(response.status, expectedStatus);
    assert.equal(calls.filters.length, 0);
    assert.equal(calls.creates.length, 0);
    assert.equal(calls.updates.length, 0);
  }
});

test('the exact protected owner can bootstrap a pending membership with narrow output', async () => {
  const { handler, calls, state } = await loadHandler();
  const { response, json } = await invoke(handler, provisionBody({
    target_user_email: ' TARGET@example.test ',
  }));

  assert.equal(response.status, 201);
  assert.equal(json.success, true);
  assert.equal(json.idempotent, false);
  assert.equal(calls.creates.length, 1);
  assert.deepEqual(calls.creates[0], {
    membership_key: 'agency-a:target-1',
    agency_id: 'agency-a',
    user_id: 'target-1',
    user_email_normalized: 'target@example.test',
    tenant_role: 'clinician',
    status: 'pending',
    created_by_user_id: 'owner-1',
    version: 1,
    last_transition_by_user_id: 'owner-1',
    last_transition_by_email_normalized: 'owner@example.test',
    last_transition_at: json.membership.last_transition_at,
    last_transition_reason: 'Initial provision',
  });
  assert.equal(state.memberships.length, 1);
  assert.deepEqual(Object.keys(json.membership).sort(), [
    'activated_at',
    'agency_id',
    'id',
    'last_transition_at',
    'revoked_at',
    'status',
    'tenant_role',
    'user_email_normalized',
    'user_id',
    'version',
  ]);
  assert.equal(json.membership.last_transition_reason, undefined);
  assert.equal(json.membership.last_transition_by_user_id, undefined);
});

test('owner provisioning is idempotent only for the exact pending identity and role', async () => {
  const initial = membership();
  const exact = await loadHandler({ memberships: [initial] });
  const replay = await invoke(exact.handler);
  assert.equal(replay.response.status, 200);
  assert.equal(replay.json.idempotent, true);
  assert.equal(exact.calls.creates.length, 0);

  for (const current of [
    membership({ tenant_role: 'manager' }),
    membership({ status: 'active' }),
    membership({ user_email_normalized: 'old@example.test' }),
  ]) {
    const { handler, calls } = await loadHandler({ memberships: [current] });
    const { response } = await invoke(handler);
    assert.equal(response.status, 409);
    assert.equal(calls.creates.length, 0);
  }
});

test('an authorized caller can inspect one exact membership without exposing audit reasons', async () => {
  const { handler, calls } = await loadHandler({ memberships: [membership()] });
  const { response, json } = await invoke(handler, inspectBody());
  assert.equal(response.status, 200);
  assert.equal(json.action, 'inspect');
  assert.equal(json.idempotent, true);
  assert.equal(json.membership.id, 'membership-target');
  assert.equal(json.membership.version, 1);
  assert.equal(json.membership.last_transition_reason, undefined);
  assert.equal(calls.creates.length, 0);
  assert.equal(calls.updates.length, 0);

  const missing = await loadHandler();
  const missingResult = await invoke(missing.handler, inspectBody());
  assert.equal(missingResult.response.status, 404);

  for (const body of [
    inspectBody({ reason: 'not accepted' }),
    inspectBody({ expected_version: 1 }),
    inspectBody({ tenant_role: 'clinician' }),
  ]) {
    const invalid = await loadHandler({ memberships: [membership()] });
    const invalidResult = await invoke(invalid.handler, body);
    assert.equal(invalidResult.response.status, 400);
    assert.equal(invalid.calls.filters.length, 0);
  }
});

test('custom owner claims cannot bootstrap without an immutable agency-admin membership', async () => {
  const caller = {
    id: 'attacker',
    email: 'attacker@example.test',
    role: 'user',
    account_type: 'super_admin',
    agency_id: 'agency-a',
    agency_name: 'Agency A',
    is_active: true,
  };
  const { handler, calls } = await loadHandler({ caller });
  const { response } = await invoke(handler);
  assert.equal(response.status, 403);
  assert.equal(calls.creates.length, 0);
  assert.equal(calls.filters.some(({ entity }) => entity === 'User'), false);
});

test('a bare built-in admin is not the protected owner when the configured identity is absent or different', async () => {
  for (const superAdminEmail of ['', 'different@example.test']) {
    const { handler, calls } = await loadHandler({ superAdminEmail });
    const { response } = await invoke(handler);
    assert.equal(response.status, 403);
    assert.equal(calls.creates.length, 0);
    assert.equal(calls.filters.some(({ entity }) => entity === 'User'), false);
  }
});

test('only an exact active agency_admin membership authorizes a tenant-scoped caller', async () => {
  for (const authority of [
    null,
    adminMembership({ status: 'suspended' }),
    adminMembership({ tenant_role: 'manager' }),
    adminMembership({ user_email_normalized: 'other@example.test' }),
  ]) {
    const memberships = authority ? [authority] : [];
    const { handler, calls } = await loadHandler({ caller: ADMIN, memberships });
    const { response } = await invoke(handler);
    assert.equal(response.status, authority?.user_email_normalized === 'other@example.test' ? 403 : 403);
    assert.equal(calls.creates.length, 0);
    assert.equal(calls.filters.some(({ entity }) => entity === 'User'), false);
  }

  const authorized = await loadHandler({ caller: ADMIN, memberships: [adminMembership()] });
  const result = await invoke(authorized.handler);
  assert.equal(result.response.status, 403);
  assert.equal(authorized.calls.creates.length, 0);
  assert.equal(authorized.calls.filters.some(({ entity }) => entity === 'User'), false);

  const existing = await loadHandler({
    caller: ADMIN,
    memberships: [adminMembership(), membership()],
  });
  const activated = await invoke(existing.handler, transitionBody('activate', 1));
  assert.equal(activated.response.status, 200);
  assert.equal(activated.json.membership.status, 'active');
  assert.equal(existing.calls.creates.length, 0);
  assert.equal(existing.calls.updates.length, 1);
});

test('tenant authorization cannot cross agencies and duplicate authority fails closed', async () => {
  const agencyBOnly = adminMembership({
    id: 'membership-admin-b',
    membership_key: 'agency-b:admin-1',
    agency_id: 'agency-b',
  });
  const crossAgency = await loadHandler({
    caller: ADMIN,
    agencies: [agency(), agency({ id: 'agency-b', agency_name: 'Agency B' })],
    memberships: [agencyBOnly],
  });
  const denied = await invoke(crossAgency.handler);
  assert.equal(denied.response.status, 403);
  assert.equal(crossAgency.calls.creates.length, 0);

  const duplicateAuthority = await loadHandler({
    caller: ADMIN,
    memberships: [adminMembership(), adminMembership({ id: 'membership-admin-duplicate' })],
  });
  const ambiguous = await invoke(duplicateAuthority.handler);
  assert.equal(ambiguous.response.status, 409);
  assert.equal(duplicateAuthority.calls.creates.length, 0);
});

test('a concurrent agency-admin revocation blocks the target mutation on authority recheck', async () => {
  const runtime = await loadHandler({
    caller: ADMIN,
    memberships: [adminMembership(), membership()],
    revokeAuthorityOnRecheck: true,
  });
  const result = await invoke(runtime.handler, transitionBody('activate', 1));
  assert.equal(result.response.status, 403);
  assert.equal(runtime.calls.updates.length, 0);
  assert.equal(runtime.state.memberships.find((row) => row.user_id === 'admin-1').status, 'revoked');
  assert.equal(runtime.state.memberships.find((row) => row.user_id === 'target-1').status, 'pending');
});

test('tenant administrators cannot manage themselves, the owner, or agency-admin roles', async () => {
  const baseMemberships = [adminMembership()];
  const cases = [
    provisionBody({
      target_user_id: 'admin-1',
      target_user_email: 'admin@agency.test',
      tenant_role: 'manager',
    }),
    provisionBody({
      target_user_id: 'owner-1',
      target_user_email: 'owner@example.test',
      tenant_role: 'manager',
    }),
    provisionBody({ tenant_role: 'agency_admin' }),
  ];
  for (const body of cases) {
    const { handler, calls } = await loadHandler({ caller: ADMIN, memberships: baseMemberships });
    const { response } = await invoke(handler, body);
    assert.equal(response.status, 403);
    assert.equal(calls.creates.length, 0);
    assert.equal(calls.updates.length, 0);
  }

  const targetAdmin = membership({ tenant_role: 'agency_admin', status: 'active' });
  const { handler, calls } = await loadHandler({
    caller: ADMIN,
    memberships: [adminMembership(), targetAdmin],
  });
  const { response } = await invoke(handler, transitionBody('suspend', 1));
  assert.equal(response.status, 403);
  assert.equal(calls.updates.length, 0);
});

test('exact User, Agency, and membership identity are rechecked after service-role filters', async () => {
  const foreignUser = { id: 'foreign-user', email: 'target@example.test', is_active: true };
  const foreignAgency = agency({ id: 'foreign-agency' });
  const foreignMembership = membership({
    id: 'foreign-membership',
    membership_key: 'agency-b:target-1',
    agency_id: 'agency-b',
  });
  const { handler, calls } = await loadHandler({
    users: [foreignUser, TARGET, OWNER],
    agencies: [foreignAgency, agency()],
    memberships: [foreignMembership],
    ignoreFilters: true,
  });
  const { response } = await invoke(handler);
  assert.equal(response.status, 201);
  assert.equal(calls.creates.length, 1);
  assert.equal(calls.creates[0].agency_id, 'agency-a');
  assert.equal(calls.creates[0].user_id, 'target-1');
});

test('missing, mismatched, and duplicate exact User or Agency rows fail closed', async () => {
  const cases = [
    { users: [ADMIN, OWNER], expectedStatus: 404 },
    {
      users: [{ ...TARGET, email: 'different@example.test' }, ADMIN, OWNER],
      expectedStatus: 409,
    },
    { users: [TARGET, { ...TARGET }, ADMIN, OWNER], expectedStatus: 409 },
    { agencies: [], expectedStatus: 404 },
    { agencies: [agency(), agency({ agency_name: 'Duplicate Agency A' })], expectedStatus: 409 },
    { agencies: [agency({ status: 'unknown' })], expectedStatus: 409 },
  ];
  for (const { expectedStatus, ...options } of cases) {
    const { handler, calls } = await loadHandler(options);
    const { response } = await invoke(handler);
    assert.equal(response.status, expectedStatus);
    assert.equal(calls.creates.length, 0);
    assert.equal(calls.updates.length, 0);
  }
});

test('duplicate, corrupt, capped, and non-array provider results fail closed', async () => {
  const corruptCases = [
    [membership(), membership({ id: 'duplicate' })],
    [membership({ membership_key: 'forged' })],
    [membership({ version: 1.5 })],
    [membership({ status: 'active', activated_at: 'invalid' })],
    [membership({ status: 'suspended', activated_at: 'invalid' })],
    [membership({ status: 'revoked', revoked_at: 'invalid' })],
    [membership({ status: 'revoked', revocation_reason: '' })],
    Array.from({ length: 100 }, (_, index) => membership({ id: `m-${index}` })),
  ];
  for (const memberships of corruptCases) {
    const { handler, calls } = await loadHandler({ memberships });
    const { response } = await invoke(handler);
    assert.equal(response.status, 409);
    assert.equal(calls.creates.length, 0);
  }

  const originalError = console.error;
  console.error = () => {};
  try {
    for (const nonArrayEntity of ['Agency', 'User', 'AgencyMembership']) {
      const options = nonArrayEntity === 'AgencyMembership'
        ? { nonArrayEntity, memberships: [] }
        : { nonArrayEntity };
      const { handler, calls } = await loadHandler(options);
      const { response } = await invoke(handler);
      assert.equal(response.status, 500);
      assert.equal(calls.creates.length, 0);
    }
  } finally {
    console.error = originalError;
  }
});

test('activation, suspension, reactivation, role change, and revocation preserve one versioned row', async () => {
  const runtime = await loadHandler({ memberships: [membership()] });

  const activated = await invoke(runtime.handler, transitionBody('activate', 1));
  assert.equal(activated.response.status, 200);
  assert.equal(activated.json.membership.status, 'active');
  assert.equal(activated.json.membership.version, 2);
  assert.ok(activated.json.membership.activated_at);

  const suspended = await invoke(runtime.handler, transitionBody('suspend', 2));
  assert.equal(suspended.response.status, 200);
  assert.equal(suspended.json.membership.status, 'suspended');
  assert.equal(suspended.json.membership.version, 3);

  const reactivated = await invoke(runtime.handler, transitionBody('activate', 3));
  assert.equal(reactivated.response.status, 200);
  assert.equal(reactivated.json.membership.status, 'active');
  assert.equal(reactivated.json.membership.version, 4);

  const changed = await invoke(runtime.handler, transitionBody('change_role', 4, {
    tenant_role: 'manager',
  }));
  assert.equal(changed.response.status, 200);
  assert.equal(changed.json.membership.tenant_role, 'manager');
  assert.equal(changed.json.membership.version, 5);

  const revoked = await invoke(runtime.handler, transitionBody('revoke', 5));
  assert.equal(revoked.response.status, 200);
  assert.equal(revoked.json.membership.status, 'revoked');
  assert.equal(revoked.json.membership.version, 6);
  assert.ok(revoked.json.membership.revoked_at);
  assert.equal(runtime.state.memberships.length, 1);
  assert.equal(runtime.calls.updates.length, 5);

  for (const body of [
    transitionBody('activate', 6),
    transitionBody('change_role', 6, { tenant_role: 'clinician' }),
  ]) {
    const result = await invoke(runtime.handler, body);
    assert.equal(result.response.status, 409);
  }
});

test('exact completed transitions are idempotent and stale versions block real changes', async () => {
  for (const [row, body] of [
    [membership({ status: 'active', version: 2 }), transitionBody('activate', 1)],
    [membership({ status: 'suspended', version: 3 }), transitionBody('suspend', 2)],
    [membership({ status: 'revoked', version: 4 }), transitionBody('revoke', 3)],
    [membership({ tenant_role: 'manager', version: 2 }), transitionBody('change_role', 1, { tenant_role: 'manager' })],
  ]) {
    const { handler, calls } = await loadHandler({ memberships: [row] });
    const result = await invoke(handler, body);
    assert.equal(result.response.status, 200);
    assert.equal(result.json.idempotent, true);
    assert.equal(calls.updates.length, 0);
  }

  const { handler, calls } = await loadHandler({ memberships: [membership()] });
  const stale = await invoke(handler, transitionBody('activate', 99));
  assert.equal(stale.response.status, 409);
  assert.equal(calls.updates.length, 0);

  const exhausted = await loadHandler({
    memberships: [membership({ version: Number.MAX_SAFE_INTEGER })],
  });
  const exhaustedResult = await invoke(
    exhausted.handler,
    transitionBody('activate', Number.MAX_SAFE_INTEGER),
  );
  assert.equal(exhaustedResult.response.status, 409);
  assert.equal(exhausted.calls.updates.length, 0);

  const exhaustedIdempotent = await loadHandler({
    memberships: [membership({ status: 'active', version: Number.MAX_SAFE_INTEGER })],
  });
  const exhaustedReplay = await invoke(
    exhaustedIdempotent.handler,
    transitionBody('activate', Number.MAX_SAFE_INTEGER - 1),
  );
  assert.equal(exhaustedReplay.response.status, 200);
  assert.equal(exhaustedReplay.json.idempotent, true);
  assert.equal(exhaustedIdempotent.calls.updates.length, 0);
});

test('inactive agencies and deactivated targets block enabling but allow restrictive transitions', async () => {
  for (const options of [
    { agencies: [agency({ status: 'suspended' })], memberships: [] },
    { users: [{ ...TARGET, is_active: false }, ADMIN, OWNER], memberships: [] },
    { users: [{ ...TARGET, role: 'admin' }, ADMIN, OWNER], memberships: [] },
    { users: [{ ...TARGET, role: 'service' }, ADMIN, OWNER], memberships: [] },
  ]) {
    const { handler, calls } = await loadHandler(options);
    const { response } = await invoke(handler);
    assert.equal(response.status, 409);
    assert.equal(calls.creates.length, 0);
  }

  const restrictive = await loadHandler({
    users: [{ ...TARGET, email: 'NewTarget@example.test', is_active: false }, ADMIN, OWNER],
    agencies: [agency({ status: 'cancelled' })],
    memberships: [membership({ status: 'active', user_email_normalized: 'old@example.test' })],
  });
  const revoked = await invoke(restrictive.handler, transitionBody('revoke', 1, {
    target_user_email: 'newtarget@example.test',
  }));
  assert.equal(revoked.response.status, 200);
  assert.equal(revoked.json.membership.status, 'revoked');
  assert.equal(revoked.json.membership.user_email_normalized, 'newtarget@example.test');

  const privilegedTarget = await loadHandler({
    caller: ADMIN,
    users: [{ ...TARGET, role: 'admin' }, ADMIN, OWNER],
    memberships: [adminMembership(), membership({ status: 'active' })],
  });
  const privilegedRevoked = await invoke(
    privilegedTarget.handler,
    transitionBody('revoke', 1),
  );
  assert.equal(privilegedRevoked.response.status, 200);
  assert.equal(privilegedRevoked.json.membership.status, 'revoked');
});

test('email mismatch blocks privilege-enabling transitions and restrictive transitions can reconcile it', async () => {
  const activating = await loadHandler({
    users: [{ ...TARGET, email: 'newtarget@example.test' }, ADMIN, OWNER],
    memberships: [membership({ user_email_normalized: 'old@example.test' })],
  });
  const denied = await invoke(activating.handler, transitionBody('activate', 1, {
    target_user_email: 'newtarget@example.test',
  }));
  assert.equal(denied.response.status, 409);
  assert.equal(activating.calls.updates.length, 0);

  const suspending = await loadHandler({
    users: [{ ...TARGET, email: 'newtarget@example.test' }, ADMIN, OWNER],
    memberships: [membership({ status: 'active', user_email_normalized: 'old@example.test' })],
  });
  const reconciled = await invoke(suspending.handler, transitionBody('suspend', 1, {
    target_user_email: 'newtarget@example.test',
  }));
  assert.equal(reconciled.response.status, 200);
  assert.equal(reconciled.json.membership.status, 'suspended');
  assert.equal(reconciled.json.membership.user_email_normalized, 'newtarget@example.test');
});

test('post-create duplicates and non-committing updates cannot return false success', async () => {
  const duplicate = await loadHandler({ createDuplicate: true });
  const duplicateResult = await invoke(duplicate.handler);
  assert.equal(duplicateResult.response.status, 409);
  assert.equal(duplicate.calls.creates.length, 1);

  const changedCreator = await loadHandler({ createdByMutation: 'unexpected-actor' });
  const changedCreatorResult = await invoke(changedCreator.handler);
  assert.equal(changedCreatorResult.response.status, 409);
  assert.equal(changedCreator.calls.creates.length, 1);

  const noop = await loadHandler({ memberships: [membership()], updateNoop: true });
  const noopResult = await invoke(noop.handler, transitionBody('activate', 1));
  assert.equal(noopResult.response.status, 409);
  assert.equal(noop.calls.updates.length, 1);
  assert.equal(noop.state.memberships[0].status, 'pending');
});
