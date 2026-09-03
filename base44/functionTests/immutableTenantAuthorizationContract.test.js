import assert from 'node:assert/strict';
import { readFile, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import JSON5 from 'json5';
import { transpileTs } from '../../tools-transpile-ts.mjs';

const functionUrl = new URL('../functions/getMyTenantContext/entry.ts', import.meta.url);
const entityUrl = new URL('../entities/AgencyMembership.jsonc', import.meta.url);
const wrapperUrl = new URL('../../src/functions/getMyTenantContext.js', import.meta.url);

const membership = (overrides = {}) => ({
  id: 'membership-a',
  membership_key: 'agency-a:user-1',
  agency_id: 'agency-a',
  user_id: 'user-1',
  user_email_normalized: 'member@example.com',
  tenant_role: 'clinician',
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
  user = { id: 'user-1', email: 'Member@Example.com', role: 'user' },
  membershipRows = [membership()],
  agencyRows = [agency()],
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
    membershipFilters: [],
    agencyFilters: [],
  };
  const client = {
    auth: { me: async () => user },
    asServiceRole: {
      entities: {
        AgencyMembership: {
          filter: async (...args) => {
            calls.membershipFilters.push(args);
            return membershipRows;
          },
        },
        Agency: {
          filter: async (...args) => {
            calls.agencyFilters.push(args);
            return agencyRows;
          },
        },
      },
    },
  };

  let handler;
  globalThis.__tenantContextMakeClient = () => client;
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
  const response = await handler({ json: async () => body });
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
});

test('an active exact membership resolves through exact Agency validation', async () => {
  const { handler, calls } = await loadHandler();
  const { response, json } = await invoke(handler);

  assert.equal(response.status, 200);
  assert.deepEqual(calls.membershipFilters, [[
    { user_id: 'user-1', status: 'active' },
    '-updated_date',
    100,
  ]]);
  assert.deepEqual(calls.agencyFilters, [[{ id: 'agency-a' }, undefined, 10]]);
  assert.deepEqual(json.tenant_context, {
    user_id: 'user-1',
    user_email: 'member@example.com',
    membership_id: 'membership-a',
    membership_key: 'agency-a:user-1',
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

test('inactive and service-filter-regression rows never authorize', async () => {
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

  assert.equal(response.status, 403);
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
  assert.deepEqual(selectedLoad.calls.agencyFilters, [[{ id: 'agency-b' }, undefined, 10]]);
});

test('unrelated, duplicate, and inactive Agency rows fail exact validation', async () => {
  const cases = [
    { rows: [agency({ id: 'agency-b' })], status: 403 },
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
  assert.deepEqual(calls.agencyFilters, [[{ id: 'agency-a' }, undefined, 10]]);
});

test('operator-shaped and malformed agency selectors are rejected before service reads', async () => {
  for (const agencyId of [{ $ne: null }, '', ' agency-a']) {
    const { handler, calls } = await loadHandler();
    const { response } = await invoke(handler, { agency_id: agencyId });

    assert.equal(response.status, 400);
    assert.deepEqual(calls.membershipFilters, []);
    assert.deepEqual(calls.agencyFilters, []);
  }
});
