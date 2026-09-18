import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { runtimeRpcSignatures, waitForRuntimeSchema } from './http-schema-ready.mjs';

const config = { api: 'http://127.0.0.1:54321', publishableKey: 'sb_publishable_synthetic_readiness_key', timeoutMs: 1000, pollMs: 1 };
const json = (body, status) => Response.json(body, { status });
const denied = url => json({ code: '42501', message: `permission denied for function ${url.pathname.split('/').at(-1)}` }, 401);
const missing = () => json({ code: 'PGRST202', message: 'synthetic missing cache entry' }, 404);
const rejectCode = code => error => {
  assert.equal(error.message, `LOCAL_RUNTIME_SCHEMA_${code}`);
  assert.equal(error.cause, undefined);
  return true;
};

test('a ready reserve cannot mask missing later functions; every probe is anonymous GET', async () => {
  const seen = new Map();
  await waitForRuntimeSchema({ ...config, fetchImpl: async (url, options) => {
    assert.equal(url.origin, config.api);
    assert.equal(options.method, 'GET');
    assert.equal(options.body, undefined);
    assert.equal(options.redirect, 'error');
    assert.deepEqual(options.headers, { apikey: config.publishableKey, Accept: 'application/json', 'Accept-Profile': 'public' });
    const name = url.pathname.split('/').at(-1);
    const contract = runtimeRpcSignatures.find(signature => signature.name === name);
    assert.ok(contract);
    assert.deepEqual([...url.searchParams.keys()], contract.args.map(arg => arg.name));
    for (const arg of contract.args) assert.equal(url.searchParams.get(arg.name), arg.value);
    seen.set(name, (seen.get(name) || 0) + 1);
    if (name.endsWith('expire_results') && seen.get(name) < 3) return missing();
    if (name.endsWith('file_record') && seen.get(name) < 2) return missing();
    return denied(url);
  } });
  assert.deepEqual(Object.fromEntries(seen), {
    cm_integration_reserve: 1, cm_integration_finish: 1, cm_integration_file_record: 2,
    cm_integration_file_get: 1, cm_integration_expire_results: 3,
  });
});

test('permanently missing expire-results never completes readiness', { timeout: 2000 }, async () => {
  const seen = new Set();
  await assert.rejects(waitForRuntimeSchema({ ...config, timeoutMs: 40, fetchImpl: async url => {
    seen.add(url.pathname);
    return url.pathname.endsWith('expire_results') ? missing() : denied(url);
  } }), rejectCode('NOT_READY'));
  assert.equal(seen.size, 5);
});

for (const [name, response] of [
  ['unexpected successful function execution', () => json(true, 200)],
  ['gateway CORS success', () => new Response(null, { status: 204 })],
  ['authentication error', () => json({ code: 'PGRST301' }, 401)],
  ['unrelated SQL permission error', () => json({ code: '42501', message: 'permission denied for table unrelated' }, 401)],
  ['forbidden with wrong status', () => json({ code: '42501', message: 'permission denied for function cm_integration_reserve' }, 403)],
  ['non-cache not found', () => json({ code: 'PGRST205' }, 404)],
  ['redirect', () => new Response(null, { status: 307, headers: { location: 'https://example.invalid/' } })],
]) {
  test(`${name} fails without retry or later requests`, async () => {
    let count = 0;
    await assert.rejects(waitForRuntimeSchema({ ...config, fetchImpl: async () => { count++; return response(); } }), rejectCode('UNEXPECTED_RESPONSE'));
    assert.equal(count, 1);
  });
}

for (const [name, response] of [
  ['malformed JSON', () => new Response('synthetic-sensitive-content', { status: 401, headers: { 'content-type': 'application/json' } })],
  ['wrong content type', () => new Response('synthetic-sensitive-content', { status: 401 })],
  ['oversized body', () => json({ code: '42501', message: 'x'.repeat(17000) }, 401)],
  ['invalid UTF-8', () => new Response(new Uint8Array([255]), { status: 401, headers: { 'content-type': 'application/json' } })],
]) {
  test(`${name} is bounded and sanitized`, async () => {
    let count = 0;
    await assert.rejects(waitForRuntimeSchema({ ...config, fetchImpl: async () => { count++; return response(); } }), rejectCode('INVALID_RESPONSE'));
    assert.equal(count, 1);
  });
}

test('network errors are sanitized and never retried', async () => {
  let count = 0;
  await assert.rejects(waitForRuntimeSchema({ ...config, fetchImpl: async () => {
    count++; throw new Error(`untrusted transport output ${config.publishableKey}`);
  } }), rejectCode('PROBE_FAILED'));
  assert.equal(count, 1);
});

test('rejects hosted, hostname, credential-bearing and malformed configuration before fetch', async () => {
  let count = 0;
  for (const override of [
    { api: 'http://localhost:54321' }, { api: 'https://example.supabase.co' },
    { api: 'http://user:password@127.0.0.1:54321' }, { api: `${config.api}/` },
    { publishableKey: 'sb_secret_synthetic_wrong_role' }, { publishableKey: '' },
    { timeoutMs: 0 }, { timeoutMs: 20001 }, { pollMs: 0 }, { pollMs: 1001 },
  ]) {
    await assert.rejects(waitForRuntimeSchema({ ...config, ...override, fetchImpl: async () => { count++; } }), rejectCode('INVALID_CONFIG'));
  }
  assert.equal(count, 0);
});

test('deadline settles even when fetch ignores abort; its late response cannot continue polling', { timeout: 2000 }, async () => {
  let release; let count = 0; let signal; let cancelled = 0;
  const promise = waitForRuntimeSchema({ ...config, timeoutMs: 30, fetchImpl: async (_url, options) => {
    count++; signal = options.signal;
    return new Promise(resolve => { release = resolve; });
  } });
  await assert.rejects(promise, rejectCode('NOT_READY'));
  assert.equal(signal.aborted, true);
  release(new Response(new ReadableStream({ cancel() { cancelled++; return new Promise(() => {}); } }), { status: 401 }));
  await delay(5);
  assert.equal(count, 1);
  assert.equal(cancelled, 1);
});

test('deadline settles on stalled body even when its cancellation never settles', { timeout: 2000 }, async () => {
  let count = 0; let cancelled = 0;
  await assert.rejects(waitForRuntimeSchema({ ...config, timeoutMs: 30, fetchImpl: async () => {
    count++;
    return new Response(new ReadableStream({ cancel() { cancelled++; return new Promise(() => {}); } }),
      { status: 401, headers: { 'content-type': 'application/json' } });
  } }), rejectCode('NOT_READY'));
  assert.equal(count, 1);
  assert.equal(cancelled, 1);
});

test('unexpected response cancellation cannot delay a permanent failure', { timeout: 2000 }, async () => {
  let cancelled = 0;
  await assert.rejects(waitForRuntimeSchema({ ...config, fetchImpl: async () =>
    new Response(new ReadableStream({ cancel() { cancelled++; return new Promise(() => {}); } }), { status: 200 }),
  }), rejectCode('UNEXPECTED_RESPONSE'));
  assert.equal(cancelled, 1);
});
