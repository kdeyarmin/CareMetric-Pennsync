import assert from 'node:assert/strict';
import { readFile, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { transpileTs } from '../../tools-transpile-ts.mjs';

const FUNCTIONS_ROOT = new URL('../functions/', import.meta.url);
const RELEASE_ENV = 'OUTBOUND_DELIVERY_RELEASE';
const RELEASE_VALUE = 'enabled-v1';

async function readEntry(name) {
  return readFile(new URL(`${name}/entry.ts`, FUNCTIONS_ROOT), 'utf8');
}

const PLACEMENT_CASES = [
  ['sendWelcomeEmail', "if (!user || !isAdminLike(user))", 'const body = await req.json()'],
  ['sendAccountReadyEmail', "if (!user || (user.role !== 'admin'", 'await base44.asServiceRole.integrations.Core.SendEmail'],
  ['sendTrainingCertificateEmail', 'if (!ownsCert && isAgencyScopedAdmin)', 'const allUsers = await'],
  ['sendFaxStatusNotification', '|| !isProtectedSuperAdmin(user))', 'const { data } = await req.json()'],
  ['sendSms', 'if (patient_id) {', 'const clientMessageId = crypto.randomUUID()'],
  ['sendTestSms', "if (scopedConsent.effectiveStatus !== 'opted_in')", 'const telnyxUrl ='],
  ['sendFax', 'if (!fromNumber) {', 'const recentCutoff ='],
  ['sendAuthorizedReferralFax', 'if (!destination.allowed)', 'if (retrySource) {'],
  ['startMaskedCall', 'if (!destAllowed.allowed)', 'const callLog = await'],
];

test('assigned user endpoints gate after authorization and before writes or delivery', async () => {
  for (const [name, authorizationAnchor, effectAnchor] of PLACEMENT_CASES) {
    const source = await readEntry(name);
    const handler = source.slice(source.indexOf('Deno.serve'));
    const authorization = handler.indexOf(authorizationAnchor);
    const gate = handler.indexOf('if (!outboundDeliveryReleased())');
    const effect = handler.indexOf(effectAnchor);

    assert.notEqual(authorization, -1, `${name}: authorization anchor exists`);
    assert.notEqual(gate, -1, `${name}: release gate exists`);
    assert.notEqual(effect, -1, `${name}: effect boundary exists`);
    assert.ok(authorization < gate, `${name}: authorization runs before the release gate`);
    assert.ok(gate < effect, `${name}: release gate runs before the write/provider boundary`);
    assert.equal(
      (source.match(/<<<BEGIN SHARED HELPER: outboundDeliveryGate/g) || []).length,
      1,
      `${name}: canonical helper is embedded once`,
    );
  }
});

test('sendBatchFax preserves user authorization and internal capability ordering', async () => {
  const source = await readEntry('sendBatchFax');
  assert.equal(
    (source.match(/<<<BEGIN SHARED HELPER: outboundDeliveryGate/g) || []).length,
    1,
  );
  assert.equal(
    (source.match(/!(?:faxWorkflowDeliveryReleased|outboundDeliveryReleased)\(\)/g) || []).length,
    3,
    'schedule, interactive-send, and internal delivery paths are independently gated',
  );

  const schedule = source.slice(
    source.indexOf('async function createSchedule'),
    source.indexOf('async function loadScheduledAuthority'),
  );
  assert.ok(schedule.indexOf('loadInteractiveAuthority') < schedule.indexOf('!faxWorkflowDeliveryReleased()'));
  assert.ok(schedule.indexOf('!faxWorkflowDeliveryReleased()') < schedule.indexOf('loadAgencyConfiguration'));

  const interactive = source.slice(
    source.indexOf('async function sendInteractive'),
    source.indexOf('Deno.serve'),
  );
  assert.ok(interactive.indexOf('loadInteractiveAuthority') < interactive.indexOf('!outboundDeliveryReleased()'));
  assert.ok(interactive.indexOf('!outboundDeliveryReleased()') < interactive.indexOf('submitOneFax'));

  const handler = source.slice(source.indexOf('Deno.serve'));
  const capability = handler.indexOf('input = await parseBatchRequest(req)');
  const internalGate = handler.indexOf("input.action === 'dispatch_scheduled'");
  const sdk = handler.indexOf('const base44 = createClientFromRequest(req)');
  assert.ok(capability < internalGate, 'the signed internal request is verified before the gate');
  assert.ok(internalGate < sdk, 'internal delivery is gated before SDK construction or claims');
  assert.match(handler, /if \(result instanceof Response\) return result;/);
});

async function invokeEmailFunction(name, envValue, user) {
  let source = await readEntry(name);
  source = source.replace(
    /import\s+\{[^}]*\}\s+from\s+'npm:[^']*';?/,
    'const createClientFromRequest = globalThis.__deliveryGateCreateClient;',
  );
  const target = join(
    tmpdir(),
    `delivery_gate_${name}_${Date.now()}_${Math.random().toString(36).slice(2)}.mjs`,
  );
  const calls = [];
  const sendEmail = async (payload) => {
    calls.push(structuredClone(payload));
    return { id: 'email-1' };
  };
  const client = {
    auth: { me: async () => user },
    integrations: { Core: { SendEmail: sendEmail } },
    asServiceRole: { integrations: { Core: { SendEmail: sendEmail } } },
  };
  const previousDeno = globalThis.Deno;
  const previousFactory = globalThis.__deliveryGateCreateClient;
  let handler;
  try {
    await writeFile(target, transpileTs(source).outputText);
    globalThis.__deliveryGateCreateClient = () => client;
    globalThis.Deno = {
      serve: (candidate) => { handler = candidate; },
      env: { get: (key) => key === RELEASE_ENV ? envValue : undefined },
    };
    await import(`${pathToFileURL(target).href}?case=${Math.random()}`);
    assert.equal(typeof handler, 'function');
    const body = name === 'sendWelcomeEmail'
      ? { email: 'new.user@example.test', full_name: 'New User', temporary_password: 'temporary-only' }
      : { email: 'ready.user@example.test', full_name: 'Ready User' };
    const response = await handler(new Request(`https://functions.base44.app/${name}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }));
    return { response, calls };
  } finally {
    await unlink(target).catch(() => {});
    globalThis.Deno = previousDeno;
    globalThis.__deliveryGateCreateClient = previousFactory;
  }
}

const admin = {
  id: 'admin-1',
  email: 'admin@example.test',
  role: 'admin',
  account_type: 'super_admin',
  is_active: true,
};

test('unset or inexact release values make representative email providers unreachable', async () => {
  for (const name of ['sendWelcomeEmail', 'sendAccountReadyEmail']) {
    for (const value of [undefined, '', ' enabled-v1', 'enabled-v1 ', 'ENABLED-V1']) {
      const { response, calls } = await invokeEmailFunction(name, value, admin);
      assert.equal(response.status, 503, `${name}: ${JSON.stringify(value)} stays paused`);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.deepEqual(await response.json(), {
        error: 'Outbound delivery is disabled in this environment.',
        code: 'OUTBOUND_DELIVERY_RELEASE_PAUSED',
        channel: 'email',
        retryable: false,
      });
      assert.equal(calls.length, 0, `${name}: paused invocation made no provider call`);
    }
  }
});

test('only exact enabled-v1 reaches representative existing mocked email paths', async () => {
  for (const name of ['sendWelcomeEmail', 'sendAccountReadyEmail']) {
    const { response, calls } = await invokeEmailFunction(name, RELEASE_VALUE, admin);
    assert.equal(response.status, 200, name);
    assert.equal(calls.length, 1, `${name}: exact release reaches SendEmail once`);
  }
});

test('authentication failures retain their existing status ahead of the release gate', async () => {
  for (const name of ['sendWelcomeEmail', 'sendAccountReadyEmail']) {
    const { response, calls } = await invokeEmailFunction(name, undefined, null);
    assert.equal(response.status, 403, name);
    assert.equal(calls.length, 0, name);
  }
});
