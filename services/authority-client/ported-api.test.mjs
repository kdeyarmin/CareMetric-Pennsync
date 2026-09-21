import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  API_TARGETS, FUNCTION_TIMEOUT_MS, PORTED_FUNCTIONS, STAGING_APP_ID, createStagingAuthorityClient,
} from './client.mjs';
import { HANDLERS, HANDLER_NAMES } from '../pennsync-api/handlers.mjs';

/**
 * The caller for the ported handlers.
 *
 * Ten handlers were written into `services/pennsync-api` before anything could
 * reach one — `src/` held no reference to the service at all. This is that
 * caller, and it lives on the authority client because the access token never
 * leaves that closure: a second client handed the bearer to make the same call
 * would undo the containment keeping it private in the first place.
 *
 * So most of what is under test is what the capability REFUSES, and the two
 * properties that decide whether it is safe to have added at all: the token
 * goes to a pinned origin and nowhere else, and the publishable key — which
 * names the Supabase project — is not sent to the ported API.
 */
const config = {
  appId: STAGING_APP_ID, projectRef: 'local-pennsync-authority', projectUrl: 'http://127.0.0.1:54321',
  publishableKey: 'sb_publishable_synthetic_test_key',
  authUserId: '10000000-0000-4000-8000-000000000001', email: 'info+pennsync-admin-a@caremetricai.com',
};
const API = API_TARGETS[1];
const password = 'Synthetic-test-password-only';
const user = { id: config.authUserId, email: config.email, email_confirmed_at: '2026-09-17T00:00:00Z', role: 'authenticated', is_anonymous: false };
const json = value => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
/**
 * What the service actually answers for a JSON handler. The first version of
 * these tests used the bare handler payload, so they proved the transport while
 * missing that nothing unwrapped the envelope — a caller reading `data.policies`
 * would have found them at `data.result.policies`.
 */
const enveloped = result => json({ success: true, result, execution: 'pennsync-api', base44ExecutionDependency: false });
const pdf = () => new Response(new Uint8Array([37, 80, 68, 70]), { headers: { 'content-type': 'application/pdf' } });
const session = () => ({ user: { ...user }, access_token: 'synthetic.access.token', token_type: 'bearer' });

function harness(handler = () => enveloped({ valid: true }), patch = {}) {
  const calls = [];
  const client = createStagingAuthorityClient({ ...config, apiUrl: API, ...patch }, { fetchImpl: async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith('/token?grant_type=password')) return json(session());
    if (url.endsWith('/user')) return json(user);
    return handler(url, init);
  } });
  return { client, calls };
}
const rejects = (promise, code) => assert.rejects(promise, error => error?.code === code, `expected ${code}`);

test('the committed function map is exactly what the service serves', () => {
  // Written out rather than imported into the browser bundle — importing the
  // registry would drag ~480 lines of model prompts and three document
  // builders in for a list of ten names. Pinned here instead, where the import
  // is free, so the two cannot drift.
  assert.deepEqual(Object.keys(PORTED_FUNCTIONS).sort(), [...HANDLER_NAMES]);
  for (const name of HANDLER_NAMES) {
    assert.equal(PORTED_FUNCTIONS[name], HANDLERS[name].binary ? 'binary' : 'json',
      `${name} answers the other shape than this map claims`);
  }
});

test('a call carries the caller own bearer to the pinned API and no project key', async () => {
  const { client, calls } = harness();
  await client.signIn(password);
  assert.deepEqual(await client.callFunction('validatePatientData', 'agency-a', { patient: { first_name: 'A' } }),
    { valid: true }, 'the caller sees the handler result, not the service envelope');
  const call = calls.at(-1);
  assert.equal(call.url, `${API}/v1/functions/validatePatientData`);
  assert.equal(call.init.method, 'POST');
  assert.equal(call.init.headers.Authorization, 'Bearer synthetic.access.token');
  // The publishable key names the Supabase project, so it goes to the Supabase
  // project and nowhere else.
  assert.equal(call.init.headers.apikey, undefined);
  assert.equal(call.init.redirect, 'error');
  assert.equal(call.init.credentials, 'omit');
  assert.deepEqual(JSON.parse(call.init.body), { agency_id: 'agency-a', params: { patient: { first_name: 'A' } } });
  // Every earlier call still went to the authority project.
  for (const earlier of calls.slice(0, -1)) assert.ok(earlier.url.startsWith(config.projectUrl + '/'));
});

test('a document answers with its bytes, as its Base44 original did', async () => {
  const { client, calls } = harness(() => pdf());
  await client.signIn(password);
  const bytes = await client.callFunction('generateUserManual', 'agency-a');
  assert.ok(bytes instanceof Uint8Array);
  assert.deepEqual([...bytes], [37, 80, 68, 70]);
  assert.equal(calls.at(-1).init.headers.Accept, 'application/pdf');
  // A JSON handler still asks for JSON, so the shape is per handler rather
  // than a property of the transport.
  const plain = harness();
  await plain.client.signIn(password);
  await plain.client.callFunction('validatePatientData', 'agency-a', {});
  assert.equal(plain.calls.at(-1).init.headers.Accept, 'application/json');
});

test('a name the service does not serve never becomes a request', async () => {
  const { client, calls } = harness(() => assert.fail('the API must not have been called'));
  await client.signIn(password);
  const before = calls.length;
  // `offboardUser` reads an entity that is going away and is the example of a
  // name the service will not serve for a long time; `getDashboardData` used
  // to stand here and is served now (D72).
  for (const name of ['offboardUser', 'transcribeAndGenerateSOAPNote', 'context', '',
    'validatePatientData ', '../../etc/passwd', 'toString', 'constructor', null, 42]) {
    await rejects(client.callFunction(name, 'agency-a'), 'PENNSYNC_API_FUNCTION_UNKNOWN');
  }
  assert.equal(calls.length, before, 'nothing may reach the network');
});

test('the agency is required and never defaulted', async () => {
  // The Base44 originals accepted any authenticated caller; the ported service
  // requires a current agency membership. Defaulting it would pick a tenant on
  // the caller's behalf, so an unreviewed call site is refused instead.
  const { client } = harness(() => assert.fail('the API must not have been called'));
  await client.signIn(password);
  for (const agency of [undefined, null, '', 'has spaces', 'a'.repeat(129), 42, {}]) {
    await rejects(client.callFunction('validatePatientData', agency, {}), 'PENNSYNC_API_AGENCY_REQUIRED');
  }
  for (const params of ['a string', 42, []]) {
    await rejects(client.callFunction('validatePatientData', 'agency-a', params), 'INVALID_AUTHORITY_REQUEST');
  }
});

test('an origin that is not ours is refused at construction', () => {
  for (const apiUrl of ['https://pennsync-api-production.up.railway.app.evil.test', 'http://127.0.0.1:54342',
    'https://example.test', 'http://pennsync-api-production.up.railway.app', '', 0, {}]) {
    assert.throws(() => createStagingAuthorityClient({ ...config, apiUrl }), /INVALID_STAGING_TARGET/,
      `${apiUrl} should not be accepted`);
  }
  // Absent is allowed and means the caller is simply not configured; it must
  // not silently fall back to the authority project's own origin.
  for (const apiUrl of [undefined, null]) {
    assert.ok(createStagingAuthorityClient({ ...config, apiUrl }));
  }
});

test('an unconfigured or signed-out caller reaches nothing', async () => {
  const unconfigured = harness(() => assert.fail('the API must not have been called'), { apiUrl: null });
  await unconfigured.client.signIn(password);
  await rejects(unconfigured.client.callFunction('validatePatientData', 'agency-a'), 'PENNSYNC_API_NOT_CONFIGURED');

  const fresh = harness(() => assert.fail('the API must not have been called'));
  await rejects(fresh.client.callFunction('validatePatientData', 'agency-a'), 'AUTHENTICATION_REQUIRED');

  const after = harness();
  await after.client.signIn(password);
  await after.client.signOut();
  await rejects(after.client.callFunction('validatePatientData', 'agency-a'), 'AUTHENTICATION_REQUIRED');
});

test('a call in flight when the session ends does not deliver its answer', async () => {
  // The same fence `rpc` runs behind. Without it a handler's answer could be
  // handed to a caller whose session was already revoked.
  let release;
  const held = new Promise(resolve => { release = resolve; });
  const { client } = harness(async () => { await held; return json({ valid: true }); });
  await client.signIn(password);
  const inflight = client.callFunction('validatePatientData', 'agency-a');
  const settled = assert.rejects(inflight, error =>
    ['STALE_AUTHORITY_SESSION', 'AUTHORITY_REQUEST_ABORTED'].includes(error?.code));
  client.invalidate();
  release(json({ valid: true }));
  await settled;
});

test('a JSON answer that is not the service envelope is refused', async () => {
  // Including the bare handler payload these tests used to send themselves.
  for (const body of [{ valid: true }, { policies: [] }, { success: false, error: 'NOPE' },
    { success: true }, { result: { valid: true } }, [1, 2], 'a string', null]) {
    const { client } = harness(() => json(body));
    await client.signIn(password);
    await rejects(client.callFunction('validatePatientData', 'agency-a'), 'PENNSYNC_API_RESPONSE_INVALID');
  }
  // A document is bytes and carries no envelope, so it is not held to one.
  const { client } = harness(() => pdf());
  await client.signIn(password);
  assert.ok((await client.callFunction('generateUserManual', 'agency-a')) instanceof Uint8Array);
});

test('the service answering something other than it promised is refused', async () => {
  for (const [name, response] of [
    ['validatePatientData', () => pdf()],
    ['generateUserManual', () => enveloped({ valid: true })],
    ['validatePatientData', () => new Response('not json', { headers: { 'content-type': 'application/json' } })],
    ['validatePatientData', () => new Response('{}', { headers: { 'content-type': 'text/html' } })],
  ]) {
    const { client } = harness(response);
    await client.signIn(password);
    await rejects(client.callFunction(name, 'agency-a'), 'INVALID_AUTHORITY_RESPONSE');
  }
  // The service's own refusals keep their status meaning rather than becoming
  // a network failure.
  for (const [status, code] of [[401, 'AUTHENTICATION_FAILED'], [403, 'AUTHORITY_DENIED'],
    [409, 'AUTHORITY_REQUEST_FAILED'], [503, 'AUTHORITY_REQUEST_FAILED']]) {
    const { client } = harness(() => new Response('{}', { status, headers: { 'content-type': 'application/json' } }));
    await client.signIn(password);
    await rejects(client.callFunction('validatePatientData', 'agency-a'), code);
  }
});

test('a ported handler gets longer than an authority RPC, because it is not one', async () => {
  // The integration runtime allows 30s for a model call. Inheriting the 15s
  // RPC deadline aborted the browser while both backend services were still
  // working — and the larger referral prompts and the user guide are exactly
  // the calls that take that long.
  assert.ok(FUNCTION_TIMEOUT_MS > 30000,
    'the client deadline must exceed the integration runtime it waits on');

  const { client, calls } = harness();
  await client.signIn(password);
  await client.callFunction('validatePatientData', 'agency-a', {});
  // The signal is the client's own, so what is asserted is that the call was
  // made with a live one rather than an already-aborted short deadline.
  const { init } = calls.at(-1);
  assert.ok(init.signal && init.signal.aborted === false);
});

test('the capability exposes no token and adds no new surface', async () => {
  const { client } = harness();
  await client.signIn(password);
  assert.deepEqual(Object.keys(client).sort(),
    ['callFunction', 'invalidate', 'rpc', 'signIn', 'signOut']);
  assert.ok(!JSON.stringify(Object.getOwnPropertyDescriptors(client)).includes('synthetic.access.token'));
  assert.ok(Object.isFrozen(client));
});
