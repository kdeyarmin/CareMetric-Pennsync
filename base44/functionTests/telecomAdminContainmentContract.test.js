import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..', '..');
const readEntry = (name) => readFileSync(
  resolve(root, `base44/functions/${name}/entry.ts`),
  'utf8',
);

const FUNCTION_NAMES = [
  'autoAssignWorkNumbers',
  'sendFaxStatusNotification',
];

function loadHandler(name, { user, superAdminEmail }) {
  const source = readEntry(name).replace(
    /^import\s+\{\s*createClientFromRequest\s*\}\s+from\s+['"][^'"]+['"];?\s*/m,
    '',
  );

  let handler;
  let serviceReads = 0;
  const serviceRole = new Proxy({}, {
    get() {
      serviceReads += 1;
      throw new Error('service role should not be reached');
    },
  });
  const client = {
    auth: { me: async () => user },
    asServiceRole: serviceRole,
  };
  const Deno = {
    env: {
      get: (key) => (key === 'SUPER_ADMIN_EMAIL' ? superAdminEmail : undefined),
    },
    serve: (candidate) => { handler = candidate; },
  };

  const evaluate = new Function(
    'createClientFromRequest',
    'Deno',
    'Response',
    'console',
    'fetch',
    'crypto',
    source,
  );
  const quietConsole = { ...console, error: () => {} };
  evaluate(() => client, Deno, Response, quietConsole, globalThis.fetch, globalThis.crypto);
  assert.equal(typeof handler, 'function', `${name} must register a handler`);

  return {
    handler,
    serviceReadCount: () => serviceReads,
  };
}

function guardedRequest(body) {
  let bodyReads = 0;
  return {
    request: {
      json: async () => {
        bodyReads += 1;
        return body;
      },
    },
    bodyReadCount: () => bodyReads,
  };
}

test('telecom administration handlers pin privilege to the generated protected-owner helper', () => {
  for (const name of FUNCTION_NAMES) {
    const source = readEntry(name);
    assert.match(source, /<<<BEGIN SHARED HELPER: protectedUserAuthz/, name);
    assert.match(source, /user\.role === 'admin'/, name);
    assert.match(source, /Deno\.env\.get\('SUPER_ADMIN_EMAIL'\)/, name);
    assert.match(source, /normalizeProtectedEmail\(user\.email\) === configuredEmail/, name);

    const handler = source.slice(source.indexOf('Deno.serve'));
    const gate = handler.indexOf('!isProtectedSuperAdmin(user)');
    const bodyRead = handler.indexOf('await req.json');
    const serviceRead = handler.indexOf('base44.asServiceRole');
    assert.notEqual(gate, -1, `${name} must require the protected owner`);
    assert.notEqual(bodyRead, -1, `${name} must parse a request body`);
    assert.notEqual(serviceRead, -1, `${name} must contain a service-role operation`);
    assert.ok(gate < bodyRead, `${name} must authorize before parsing the payload`);
    assert.ok(gate < serviceRead, `${name} must authorize before service-role data access`);
    assert.match(
      handler.slice(0, bodyRead),
      /user\.disabled === true[\s\S]*user\.is_service === true[\s\S]*user\.is_verified === false[\s\S]*!isProtectedSuperAdmin\(user\)/,
      `${name} must reject disabled, service, and explicitly unverified owner accounts`,
    );
  }
});

test('custom account and agency claims cannot authorize either handler', async () => {
  const rejectedUsers = [
    { role: 'user', email: 'owner@example.test', account_type: 'super_admin', agency_name: 'Agency A' },
    { role: 'admin', email: 'attacker@example.test', account_type: 'super_admin', agency_name: 'Agency A' },
    { role: 'admin', email: 'owner@example.test', disabled: true },
    { role: 'admin', email: 'owner@example.test', is_service: true },
    { role: 'admin', email: 'owner@example.test', is_verified: false },
    { role: 'admin', email: 'owner@example.test', is_active: false },
  ];

  for (const name of FUNCTION_NAMES) {
    for (const user of rejectedUsers) {
      const runtime = loadHandler(name, {
        user,
        superAdminEmail: 'owner@example.test',
      });
      const req = guardedRequest({ data: { id: 'fax-1' } });
      const response = await runtime.handler(req.request);
      assert.equal(response.status, 403, `${name} must reject ${JSON.stringify(user)}`);
      assert.equal(req.bodyReadCount(), 0, `${name} must reject before reading the body`);
      assert.equal(runtime.serviceReadCount(), 0, `${name} must reject before service-role access`);
    }
  }
});

test('missing owner configuration fails closed and the exact active owner reaches validation', async () => {
  for (const name of FUNCTION_NAMES) {
    const missingConfig = loadHandler(name, {
      user: { role: 'admin', email: 'owner@example.test' },
      superAdminEmail: undefined,
    });
    const blockedReq = guardedRequest({});
    const blocked = await missingConfig.handler(blockedReq.request);
    assert.equal(blocked.status, 403, `${name} must fail closed without SUPER_ADMIN_EMAIL`);
    assert.equal(blockedReq.bodyReadCount(), 0);
    assert.equal(missingConfig.serviceReadCount(), 0);

    const exactOwner = loadHandler(name, {
      user: {
        role: 'admin',
        email: ' Owner@Example.Test ',
        is_active: true,
        disabled: false,
        is_service: false,
        is_verified: true,
      },
      superAdminEmail: 'owner@example.test',
    });
    const admittedReq = guardedRequest(name === 'sendFaxStatusNotification'
      ? { data: {} }
      : { emails: [] });
    await exactOwner.handler(admittedReq.request);
    assert.equal(admittedReq.bodyReadCount(), 1, `${name} must admit the configured active owner`);
  }
});

test('fax notification no longer has mutable account or agency authorization branches', () => {
  const source = readEntry('sendFaxStatusNotification');
  const handler = source.slice(source.indexOf('Deno.serve'));
  const authorizationPrefix = handler.slice(0, handler.indexOf("const status = String(fax.status || '').toLowerCase();"));

  assert.doesNotMatch(authorizationPrefix, /account_type|isAgencyScopedAdmin|isPlatformAdmin/);
  assert.doesNotMatch(authorizationPrefix, /entities\.User\s*\n?\s*\.filter/);
});

test('bulk work-number assignment no longer branches on mutable account type', () => {
  const source = readEntry('autoAssignWorkNumbers');
  const handler = source.slice(source.indexOf('Deno.serve'));
  assert.doesNotMatch(handler, /user\??\.account_type|user\[['"]account_type['"]\]/);
});
