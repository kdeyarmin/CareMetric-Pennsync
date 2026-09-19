import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BROKERED_OPERATIONS, INTEGRATION_PATH, INTEGRATION_TARGETS,
  integrationCapability, validIntegrationTarget,
} from './integrations.mjs';

/**
 * The service's path to the brokered Core integrations.
 *
 * What is under test is mostly what the capability REFUSES. A handler that can
 * reach the runtime can reach a paid provider with the caller's authority, so
 * every boundary here is a denial: an operation nobody released, a target that
 * is not ours, a missing credential, and a runtime failure whose words must not
 * come back through the service.
 */
const TARGET = 'http://127.0.0.1:54331';
const BEARER = 'Bearer synthetic.caller.token';
const config = () => ({ integrationsUrl: TARGET, integrationsConfigured: true });
const request = (authorization = BEARER) =>
  new Request('https://api.example/v1/functions/probe', { headers: authorization ? { authorization } : {} });
const capability = (overrides = {}, fetcher) => integrationCapability(
  { config: { ...config(), ...overrides.config }, req: overrides.req ?? request(), agencyId: overrides.agencyId ?? 'agency-a' },
  fetcher);
const ok = result => () => new Response(JSON.stringify({ success: true, result }),
  { status: 200, headers: { 'content-type': 'application/json' } });
const rejects = (promise, code) => assert.rejects(promise, error => error?.code === code, `expected ${code}`);

test('a brokered call carries the caller own bearer and the runtime server route', async () => {
  let seen = null;
  const fetcher = async (url, init) => { seen = { url, init }; return ok({ answer: 'yes' })(); };
  const result = await capability({}, fetcher)('InvokeLLM', { prompt: 'hello' });
  assert.deepEqual(result, { answer: 'yes' });
  assert.equal(seen.url, `${TARGET}${INTEGRATION_PATH}`);
  assert.equal(seen.init.method, 'POST');
  assert.equal(seen.init.headers.Authorization, BEARER, 'the caller own authority, never the service own');
  assert.equal(seen.init.redirect, 'error');
  const body = JSON.parse(seen.init.body);
  assert.deepEqual(Object.keys(body).sort(), ['agency_id', 'operation', 'params', 'request_id']);
  assert.equal(body.agency_id, 'agency-a');
  assert.equal(body.operation, 'InvokeLLM');
  assert.deepEqual(body.params, { prompt: 'hello' });
  assert.match(body.request_id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
});

test('each call is new work rather than a replay of the last one', async () => {
  const ids = [];
  const fetcher = async (_url, init) => { ids.push(JSON.parse(init.body).request_id); return ok(null)(); };
  const integration = capability({}, fetcher);
  await integration('InvokeLLM', { prompt: 'a' });
  await integration('InvokeLLM', { prompt: 'a' });
  // The runtime treats request_id as an idempotency key and the Base44
  // originals had none: a repeated call was repeated work, not a cached answer.
  assert.equal(new Set(ids).size, 2);
});

test('an operation no port uses is refused before the network', async () => {
  const never = () => assert.fail('no request may be made');
  await rejects(capability({}, never)('SendEmail', {}), 'INTEGRATION_OPERATION_NOT_BROKERED');
  await rejects(capability({}, never)('UploadPrivateFile', {}), 'INTEGRATION_OPERATION_NOT_BROKERED');
  assert.deepEqual([...BROKERED_OPERATIONS], ['InvokeLLM', 'ExtractDataFromUploadedFile']);
});

test('an unconfigured deployment and a caller with no bearer both refuse before the network', async () => {
  const never = () => assert.fail('no request may be made');
  await rejects(capability({ config: { integrationsUrl: '', integrationsConfigured: false } }, never)('InvokeLLM', {}),
    'INTEGRATIONS_NOT_CONFIGURED');
  await rejects(capability({ req: request(null) }, never)('InvokeLLM', {}), 'AUTHORIZATION_REQUIRED');
  await rejects(capability({ req: request('Basic abc') }, never)('InvokeLLM', {}), 'AUTHORIZATION_REQUIRED');
  await rejects(capability({}, never)('InvokeLLM', 'not-an-object'), 'INTEGRATION_PARAMS_REQUIRED');
});

test('only our own origins are reachable', () => {
  assert.equal(validIntegrationTarget('https://pennsync-integrations-production.up.railway.app'), true);
  assert.equal(validIntegrationTarget(TARGET), true);
  // An operator-supplied host would receive the caller's bearer.
  assert.equal(validIntegrationTarget('https://pennsync-integrations-production.up.railway.app.evil.test'), false);
  assert.equal(validIntegrationTarget('http://pennsync-integrations-production.up.railway.app'), false);
  assert.equal(validIntegrationTarget('https://pennsync-integrations-production.up.railway.app/v1'), false);
  assert.equal(validIntegrationTarget(''), false);
  assert.equal(validIntegrationTarget(null), false);
  assert.equal(INTEGRATION_TARGETS.length, 2);
});

test('nothing the runtime says comes back through the service', async () => {
  const leak = 'sk-provider-secret-and-an-upstream-stack';
  for (const [status, payload] of [
    [503, { success: false, error: leak, retryable: false }],
    [500, { success: false, error: 'INTEGRATION_UNAVAILABLE', detail: leak }],
    [200, { success: false, error: leak }],
  ]) {
    const fetcher = async () => new Response(JSON.stringify(payload),
      { status, headers: { 'content-type': 'application/json' } });
    await assert.rejects(capability({}, fetcher)('InvokeLLM', { prompt: 'x' }), error => {
      assert.equal(error.code, 'INTEGRATION_REFUSED');
      assert.equal(JSON.stringify(error.code).includes('sk-provider'), false);
      return true;
    });
  }
});

test('an unreachable or unreadable runtime is a refusal, not a crash', async () => {
  await rejects(capability({}, async () => { throw new Error('ECONNREFUSED 127.0.0.1:54331'); })('InvokeLLM', { prompt: 'x' }),
    'INTEGRATION_UNREACHABLE');
  await rejects(capability({}, async () => new Response('<html>gateway</html>',
    { status: 200, headers: { 'content-type': 'text/html' } }))('InvokeLLM', { prompt: 'x' }), 'INTEGRATION_UNREADABLE');
});

test('a released-but-unreleased operation from the runtime keeps its meaning', async () => {
  // The runtime answers 409 when an operation is not released there. That is a
  // different thing from a provider failure, and a caller can act on it.
  const fetcher = async () => new Response(JSON.stringify({ success: false, error: 'OPERATION_NOT_RELEASED' }),
    { status: 409, headers: { 'content-type': 'application/json' } });
  await assert.rejects(capability({}, fetcher)('InvokeLLM', { prompt: 'x' }), error => {
    assert.equal(error.status, 409);
    assert.equal(error.code, 'INTEGRATION_REFUSED');
    return true;
  });
});
