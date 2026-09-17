import test from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { setTimeout as delay } from 'node:timers/promises';
import { readFileSync } from 'node:fs';
import {
  EXTERNAL_INTEGRATION_APP, EXTERNAL_INTEGRATION_ORIGIN, ExternalIntegrationError,
  createExternalIntegrationTransport, normalizeExternalIntegrationParams,
  privateIntegrationFileId, readExternalIntegrationConfig, routeExternalCoreOperations,
} from './externalIntegrationTransport.js';
import { BROWSER_CONTRACT } from '../../services/integration-runtime/caller-binding.mjs';

// Fixed synthetic fixtures. Every request is injected; these tests use no network.
const revision = 'a'.repeat(40);
const requestId = '11111111-1111-4111-1111-111111111111';
const fileId = '22222222-2222-4222-8222-222222222222';
const fileUri = `cmfile:${fileId}`;
const context = () => ({ user_id: 'user-a', agency_id: 'agency-a', membership_id: 'member-a',
  membership_version: 1, tenant_role: 'clinician', is_platform_owner: false });
const config = (operations = ['InvokeLLM']) => readExternalIntegrationConfig({
  VITE_EXTERNAL_INTEGRATIONS: 'enabled-v2', VITE_EXTERNAL_INTEGRATION_ORIGIN: EXTERNAL_INTEGRATION_ORIGIN,
  VITE_EXTERNAL_INTEGRATION_OPERATIONS: operations.join(','), VITE_EXTERNAL_INTEGRATION_REVISION: revision,
}, EXTERNAL_INTEGRATION_APP);
const envelope = (body, result = 'synthetic result') => ({ success: true, result, execution: 'external',
  base44ExecutionDependency: true, contract: BROWSER_CONTRACT, app_id: EXTERNAL_INTEGRATION_APP,
  revision, request_id: body.request_id, operation: body.operation });
function response(value, { status = 200, url = `${EXTERNAL_INTEGRATION_ORIGIN}/v2/integrations`, headers = {}, redirected = false, raw } = {}) {
  const result = new Response(raw ?? JSON.stringify(value), { status, headers: { 'content-type': 'application/json', ...headers } });
  Object.defineProperties(result, { url: { value: url }, redirected: { value: redirected } });
  return result;
}
function harness({ operations = ['InvokeLLM'], fetcher, timeoutMs = 2000 } = {}) {
  const controller = new AbortController(); const lease = Object.freeze({});
  let current = true, clock = 100000;
  const session = { token: 'synthetic-user-session-token', context: context() };
  const calls = [];
  const dependencies = {
    fetcher: async (url, options) => {
      const body = JSON.parse(options.body); calls.push({ url, options, body });
      return fetcher ? fetcher(url, options, body) : response(envelope(body));
    },
    getSession: () => session, captureLease: () => lease,
    assertLeaseCurrent: actual => { if (!current || actual !== lease) throw Object.assign(new Error('stale realm'), { code: 'STALE_REALM' }); },
    getLeaseSignal: () => controller.signal, randomId: () => requestId, now: () => clock, timeoutMs,
  };
  return { transport: createExternalIntegrationTransport(config(operations), dependencies), dependencies, session, calls,
    advance: ms => { clock += ms; }, revoke: () => { current = false; controller.abort(); } };
}
const rejected = (code, uncertain) => error => error instanceof ExternalIntegrationError && error.code === `EXTERNAL_${code}`
  && error.retryable === false && (uncertain === undefined || error.operationMayHaveExecuted === uncertain);

test('default-off routing preserves the identical SDK and performs no session or provider work', () => {
  const sdk = { integrations: { Core: {} } };
  for (const mode of [undefined, '', 'disabled']) {
    const disabled = readExternalIntegrationConfig({ VITE_EXTERNAL_INTEGRATIONS: mode }, 'staging');
    assert.strictEqual(routeExternalCoreOperations(sdk, disabled, { getSession: () => assert.fail('read') }), sdk);
    assert.throws(() => createExternalIntegrationTransport(disabled).prepare('InvokeLLM', {}), rejected('NOT_RELEASED'));
  }
});
test('build-owned configuration requires exact reviewed host, app, operation and deployed revision', () => {
  const env = { VITE_EXTERNAL_INTEGRATIONS: 'enabled-v2', VITE_EXTERNAL_INTEGRATION_ORIGIN: EXTERNAL_INTEGRATION_ORIGIN,
    VITE_EXTERNAL_INTEGRATION_OPERATIONS: 'InvokeLLM', VITE_EXTERNAL_INTEGRATION_REVISION: revision };
  for (const patch of [{ VITE_EXTERNAL_INTEGRATIONS: 'true' }, { VITE_EXTERNAL_INTEGRATION_ORIGIN: 'https://foreign.example.test' },
    { VITE_EXTERNAL_INTEGRATION_OPERATIONS: 'InvokeLLM,InvokeLLM' }, { VITE_EXTERNAL_INTEGRATION_OPERATIONS: 'GenerateImage' },
    { VITE_EXTERNAL_INTEGRATION_OPERATIONS: '' }, { VITE_EXTERNAL_INTEGRATION_REVISION: 'main' }]) {
    assert.throws(() => readExternalIntegrationConfig({ ...env, ...patch }, EXTERNAL_INTEGRATION_APP), rejected('CONFIGURATION'));
  }
  assert.throws(() => readExternalIntegrationConfig(env, 'another-app'), rejected('CONFIGURATION'));
  assert.throws(() => routeExternalCoreOperations({}, config(['UploadFile']), {}), rejected('CONFIGURATION'));
  assert.ok(Object.isFrozen(config().operations));
});
test('one prepared request coalesces simultaneous calls and reuses a completed result without another charge', async () => {
  let finish; const h = harness({ fetcher: (_url, _options, body) => new Promise(resolve => { finish = () => resolve(response(envelope(body))); }) });
  const operation = h.transport.prepare('InvokeLLM', { prompt: 'synthetic' });
  const first = operation.execute(); const second = operation.execute(); assert.strictEqual(first, second);
  await delay(0); finish(); assert.equal(await first, 'synthetic result'); assert.equal(await operation.execute(), 'synthetic result');
  assert.equal(h.calls.length, 1); assert.equal(operation.requestId, requestId);
  const { url, options, body } = h.calls[0];
  assert.equal(url, `${EXTERNAL_INTEGRATION_ORIGIN}/v2/integrations`);
  for (const [key, expected] of Object.entries({ credentials: 'omit', redirect: 'error', cache: 'no-store', referrerPolicy: 'no-referrer' })) assert.equal(options[key], expected);
  assert.deepEqual(body.binding, context()); assert.equal(body.agency_id, 'agency-a'); assert.equal(body.contract, BROWSER_CONTRACT); assert.equal(body.revision, revision);
});
test('mutation after preparation cannot change the request bytes or nested schema', async () => {
  const h = harness({ fetcher: (_url, _options, body) => response(envelope(body, { count: 1 })) });
  const input = { prompt: 'original', response_json_schema: { type: 'object', properties: { count: { type: 'integer' } }, required: ['count'], additionalProperties: false } };
  const operation = h.transport.prepare('InvokeLLM', input); input.prompt = 'changed'; input.response_json_schema.properties.count.type = 'string';
  assert.deepEqual(await operation.execute(), { count: 1 });
  assert.equal(h.calls[0].body.params.prompt, 'original'); assert.equal(h.calls[0].body.params.response_json_schema.properties.count.type, 'integer');
});
for (const [name, patch] of Object.entries({ emptyModel: { model: '' }, nullModel: { model: null }, falseSchema: { response_json_schema: false },
  undefinedSchema: { response_json_schema: undefined }, foreignModel: { model: 'different-model' }, search: { add_context_from_internet: true },
  nullSearch: { add_context_from_internet: null }, legacyFile: { file_urls: ['https://legacy.example.test/private.pdf'] },
  duplicateFileKeys: { file_urls: [], file_uris: [] }, unknownField: { provider: 'other' } })) {
  test(`unsupported ${name} is rejected before dispatch rather than silently changing provider semantics`, () => {
    const h = harness(); assert.throws(() => h.transport.prepare('InvokeLLM', { prompt: 'synthetic', ...patch }), rejected('INVALID_INPUT'));
    assert.equal(h.calls.length, 0);
  });
}
test('explicit reconciliation after a transport failure retains exactly the same request ID and bytes', async () => {
  let attempts = 0; const h = harness({ fetcher: (_url, _options, body) => {
    if (++attempts === 1) throw new Error('DO_NOT_LEAK_TOKEN_OR_PROVIDER_TEXT');
    return response(envelope(body));
  } });
  const operation = h.transport.prepare('InvokeLLM', { prompt: 'synthetic' });
  await assert.rejects(operation.execute(), error => rejected('UNCERTAIN', true)(error) && error.requestId === requestId
    && !error.message.includes('DO_NOT_LEAK'));
  assert.equal(h.calls.length, 1); assert.equal(await operation.execute(), 'synthetic result');
  assert.equal(h.calls[0].options.body, h.calls[1].options.body);
});
for (const [status, code] of [[401, 'ACCESS_DENIED'], [403, 'ACCESS_DENIED'], [409, 'RECONCILIATION'], [429, 'LIMIT'], [500, 'UNCERTAIN']]) {
  test(`HTTP ${status} is a closed nonretryable error and never a second SDK invocation`, async () => {
    const h = harness({ fetcher: () => response({ error: 'SECRET PROVIDER DETAILS' }, { status }) });
    let native = 0; const sdk = { integrations: { Core: { InvokeLLM: () => { native++; } } } };
    const routed = routeExternalCoreOperations(sdk, config(), h.dependencies);
    await assert.rejects(routed.integrations.Core.InvokeLLM({ prompt: 'test' }), error => rejected(code, true)(error)
      && !error.message.includes('SECRET'));
    assert.equal(native, 0); assert.equal(h.calls.length, 1);
  });
}
for (const field of ['user_id', 'agency_id', 'membership_id', 'membership_version', 'tenant_role', 'is_platform_owner']) {
  test(`a changed ${field} cannot dispatch or disclose a cached result`, async () => {
    const h = harness(); const operation = h.transport.prepare('InvokeLLM', { prompt: 'test' });
    await operation.execute(); h.session.context[field] = field === 'membership_version' ? 2 : field === 'is_platform_owner' ? true : 'changed';
    assert.throws(() => operation.execute(), rejected('AUTHORITY')); assert.equal(h.calls.length, 1);
  });
}
test('token changes and realm revocation invalidate in-flight responses and completed receipts', async () => {
  const h = harness({ fetcher: (_url, _options, body) => { h.session.token = 'another-valid-synthetic-token'; return response(envelope(body)); } });
  await assert.rejects(h.transport.prepare('InvokeLLM', { prompt: 'test' }).execute(), rejected('AUTHORITY'));
  const other = harness(); const operation = other.transport.prepare('InvokeLLM', { prompt: 'test' }); await operation.execute();
  other.revoke(); assert.throws(() => operation.execute(), error => error.code === 'STALE_REALM');
});
test('timeouts abort the transport without claiming provider cancellation or automatically retrying', async () => {
  const h = harness({ timeoutMs: 5, fetcher: (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(new Error('timeout detail')), { once: true });
  }) });
  await assert.rejects(h.transport.prepare('InvokeLLM', { prompt: 'test' }).execute(), rejected('UNCERTAIN', true)); assert.equal(h.calls.length, 1);
});
test('a realm closure aborts the current fetch and withholds the result', async () => {
  const h = harness({ fetcher: (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
  }) });
  const result = h.transport.prepare('InvokeLLM', { prompt: 'test' }).execute(); await delay(0); h.revoke();
  await assert.rejects(result, error => error.code === 'STALE_REALM'); assert.equal(h.calls.length, 1);
});
for (const [name, patch] of Object.entries({ oldContract: { contract: 'cm.integrations.v1' }, wrongApp: { app_id: 'foreign' },
  wrongRevision: { revision: 'b'.repeat(40) }, missingRevision: { revision: undefined }, wrongExecution: { execution: 'base44' },
  unprovenDependency: { base44ExecutionDependency: undefined }, wrongRequest: { request_id: fileId }, wrongOperation: { operation: 'SendEmail' } })) {
  test(`the ${name} response cannot masquerade as the reviewed operation`, async () => {
    const h = harness({ fetcher: (_url, _options, body) => response({ ...envelope(body), ...patch }) });
    await assert.rejects(h.transport.prepare('InvokeLLM', { prompt: 'test' }).execute(), rejected('INVALID_RESULT', true));
  });
}
for (const [name, options] of Object.entries({ redirected: { redirected: true }, foreignUrl: { url: 'https://foreign.example.test' },
  html: { headers: { 'content-type': 'text/html' } }, oversized: { headers: { 'content-length': '2097153' } },
  invalidJson: { raw: '{bad' }, invalidUtf8: { raw: new Uint8Array([0xff, 0xfe]) } })) {
  test(`malformed ${name} response is rejected without provider details`, async () => {
    const h = harness({ fetcher: (_url, _options, body) => response(envelope(body), options) });
    await assert.rejects(h.transport.prepare('InvokeLLM', { prompt: 'test' }).execute(), rejected('INVALID_RESULT', true));
  });
}
test('actual streaming size is bounded independently of declared Content-Length', async () => {
  const h = harness({ fetcher: () => response(null, { raw: 'x'.repeat(2097153) }) });
  await assert.rejects(h.transport.prepare('InvokeLLM', { prompt: 'test' }).execute(), rejected('INVALID_RESULT', true));
});
test('structured and extraction results must satisfy the requested schema', async () => {
  const schema = { type: 'object', properties: { n: { type: 'integer' } }, required: ['n'], additionalProperties: false };
  for (const operation of ['InvokeLLM', 'ExtractDataFromUploadedFile']) {
    const params = operation === 'InvokeLLM' ? { prompt: 'test', response_json_schema: schema } : { file_url: fileUri, json_schema: schema };
    const h = harness({ operations: [operation], fetcher: (_url, _options, body) => response(envelope(body,
      operation === 'InvokeLLM' ? { n: 'not a number' } : { status: 'success', output: { n: 'bad' } })) });
    await assert.rejects(h.transport.prepare(operation, params).execute(), rejected('INVALID_RESULT', true));
  }
});
test('private uploads preserve bytes without inventing a permanent file_url', async () => {
  const bytes = new Uint8Array(50000).fill(97); const file = new Blob([bytes], { type: 'text/plain' });
  const h = harness({ operations: ['UploadPrivateFile'], fetcher: (_url, _options, body) => {
    assert.deepEqual(new Uint8Array(Buffer.from(body.params.base64, 'base64')), bytes);
    assert.equal(body.params.content_type, file.type);
    return response(envelope(body, { file_uri: fileUri, private: true, size_bytes: bytes.length }));
  } });
  const result = await h.transport.prepare('UploadPrivateFile', { file }).execute();
  assert.equal(result.file_uri, fileUri); assert.equal(result.file_url, undefined);
  assert.equal(privateIntegrationFileId(fileUri), fileId); assert.equal(privateIntegrationFileId(`https://example.test/${fileId}`), null);
});
for (const [name, result] of Object.entries({ publicUrl: { file_uri: fileUri, private: true, size_bytes: 1, file_url: 'https://public.example.test' },
  publicFlag: { file_uri: fileUri, private: false, size_bytes: 1 }, wrongSize: { file_uri: fileUri, private: true, size_bytes: 2 } })) {
  test(`an upload ${name} cannot be reported as the expected private file`, async () => {
    const h = harness({ operations: ['UploadPrivateFile'], fetcher: (_url, _options, body) => response(envelope(body, result)) });
    await assert.rejects(h.transport.prepare('UploadPrivateFile', { file: new Blob(['a'], { type: 'text/plain' }) }).execute(), rejected('INVALID_RESULT', true));
  });
}
test('private-file input aliases are translated only for valid private handles', () => {
  assert.deepEqual(normalizeExternalIntegrationParams('InvokeLLM', { prompt: 'x', file_urls: [fileUri] }), { prompt: 'x', file_uris: [fileUri] });
  assert.deepEqual(normalizeExternalIntegrationParams('ExtractDataFromUploadedFile', { file_url: fileUri, json_schema: { type: 'string' } }),
    { file_uri: fileUri, json_schema: { type: 'string' } });
});
const signedUrl = `https://xsqobvvreaovwibxwyvv.supabase.co/storage/v1/object/sign/pennsync-external-integrations/${EXTERNAL_INTEGRATION_APP}/${'b'.repeat(64)}/${fileId}?token=synthetic-signature`;
test('cached signed links expire without changing the durable file handle', async () => {
  const h = harness({ operations: ['CreateFileSignedUrl'], fetcher: (_url, _options, body) => response(envelope(body,
    { signed_url: signedUrl, expires_in: 60, expires_at_ms: 160000 })) });
  const prepared = h.transport.prepare('CreateFileSignedUrl', { file_uri: fileUri });
  assert.equal((await prepared.execute()).signed_url, signedUrl); h.advance(60000);
  assert.throws(() => prepared.execute(), rejected('EXPIRED_LINK')); assert.equal(h.calls.length, 1);
});
for (const [name, url] of Object.entries({ host: signedUrl.replace('xsqobvvreaovwibxwyvv', 'another-project'),
  object: signedUrl.replace(fileId, requestId), token: signedUrl + '&token=duplicate', query: signedUrl + '&other=1', fragment: signedUrl + '#fragment' })) {
  test(`signed-link ${name} drift is rejected`, async () => {
    const h = harness({ operations: ['CreateFileSignedUrl'], fetcher: (_url, _options, body) => response(envelope(body,
      { signed_url: url, expires_in: 60, expires_at_ms: 160000 })) });
    await assert.rejects(h.transport.prepare('CreateFileSignedUrl', { file_uri: fileUri }).execute(), rejected('INVALID_RESULT', true));
  });
}
test('mail success means accepted and not a delivery claim', async () => {
  const params = { to: 'synthetic@example.test', subject: 'test', body: 'test' };
  for (const delivered of [true, false]) {
    const h = harness({ operations: ['SendEmail'], fetcher: (_url, _options, body) => response(envelope(body, { accepted: true, delivered, provider: 'sendgrid' })) });
    if (delivered) await assert.rejects(h.transport.prepare('SendEmail', params).execute(), rejected('INVALID_RESULT', true));
    else assert.equal((await h.transport.prepare('SendEmail', params).execute()).delivered, false);
  }
});
test('unselected SDK methods and descriptor access use the same selected route without raw fallback', async () => {
  const h = harness(); let native = 0;
  const sdk = { auth: { me() { return 'native auth'; } }, integrations: { Core: {
    InvokeLLM: () => { native++; return 'wrong'; }, UploadFile: () => 'legacy public link',
  } } };
  const routed = routeExternalCoreOperations(sdk, config(), h.dependencies);
  const integrations = Object.getOwnPropertyDescriptor(routed, 'integrations').value;
  const core = Object.getOwnPropertyDescriptor(integrations, 'Core').value;
  assert.equal(await Object.getOwnPropertyDescriptor(core, 'InvokeLLM').value({ prompt: 'test' }), 'synthetic result');
  assert.equal(routed.integrations.Core.UploadFile(), 'legacy public link'); assert.equal(routed.auth.me(), 'native auth'); assert.equal(native, 0);
  assert.equal(Reflect.set(core, 'InvokeLLM', () => 'bad'), false); assert.equal(Reflect.preventExtensions(core), false);
});
test('shared browser contracts import neither Node primitives nor provider credentials', () => {
  for (const file of ['contracts.mjs', 'caller-binding.mjs']) {
    const source = readFileSync(new URL(`../../services/integration-runtime/${file}`, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /from\s*['"]node:|process\.env|ANTHROPIC_API_KEY|SUPABASE_SERVICE_ROLE_KEY|fetch\(/);
  }
});

test('UUID case variants identify one canonical private object in every browser input contract', () => {
  const id = 'abcdefab-cdef-4abc-8def-abcdefabcdef';
  const variant = `CMFILE:${id.toUpperCase()}`;
  assert.equal(privateIntegrationFileId(variant), id);
  assert.deepEqual(normalizeExternalIntegrationParams('InvokeLLM', { prompt: 'x', file_urls: [variant] }), { prompt: 'x', file_uris: [`cmfile:${id}`] });
  assert.deepEqual(normalizeExternalIntegrationParams('CreateFileSignedUrl', { file_uri: variant }), { file_uri: `cmfile:${id}` });
  assert.deepEqual(normalizeExternalIntegrationParams('ExtractDataFromUploadedFile', { file_url: variant, json_schema: { type: 'string' } }),
    { file_uri: `cmfile:${id}`, json_schema: { type: 'string' } });
});

test('bounded byte encoder preserves padding and chunk boundaries without browser btoa', async () => {
  const original = globalThis.btoa;
  globalThis.btoa = undefined;
  try {
    for (const size of [1, 2, 3, 4, 5, 0x5fff, 0x6000, 0x6001, 0x6002, 0xc000, 8 * 1024 * 1024]) {
      const bytes = Uint8Array.from({ length: size }, (_value, i) => (i * 17 + 29) % 256);
      const h = harness({ operations: ['UploadPrivateFile'], fetcher: (_url, _options, body) => {
        assert.equal(body.params.base64, Buffer.from(bytes).toString('base64'), `byte-exact encoding of ${size} bytes`);
        return response(envelope(body, { file_uri: fileUri, private: true, size_bytes: size }));
      } });
      await h.transport.prepare('UploadPrivateFile', { file: new Blob([bytes], { type: 'text/plain' }) }).execute();
      assert.equal(h.calls.length, 1);
    }
  } finally { globalThis.btoa = original; }
});

test('integrity-level mutations are rejected atomically and do not poison the virtual SDK facade', async () => {
  const h = harness();
  const sdk = { integrations: { Core: { InvokeLLM() { assert.fail('native fallback'); } } } };
  const facade = routeExternalCoreOperations(sdk, config(), h.dependencies);
  for (const target of [facade, facade.integrations, facade.integrations.Core]) {
    for (const operation of [Object.freeze, Object.seal, Object.preventExtensions]) {
      assert.throws(() => operation(target), TypeError);
      assert.equal(Object.isExtensible(target), true);
      assert.ok(Reflect.ownKeys(target).length > 0);
    }
  }
  assert.equal(await facade.integrations.Core.InvokeLLM({ prompt: 'synthetic' }), 'synthetic result');
  assert.equal(h.calls.length, 1);
});
