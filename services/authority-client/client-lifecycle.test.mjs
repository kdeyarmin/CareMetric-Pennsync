import test from 'node:test';
import assert from 'node:assert/strict';
import { createStagingAuthorityClient, STAGING_APP_ID, AUTHORITY_CONTRACT } from './client.mjs';

const config = { appId: STAGING_APP_ID, projectRef: 'local-pennsync-authority', projectUrl: 'http://127.0.0.1:54321',
  publishableKey: 'sb_publishable_synthetic_test_key', authUserId: '10000000-0000-4000-8000-000000000001',
  email: 'info+pennsync-admin-a@caremetricai.com' };
const password = 'Synthetic-test-password-only';
const user = { id: config.authUserId, email: config.email, role: 'authenticated', is_anonymous: false,
  email_confirmed_at: '2026-09-18T00:00:00Z' };
const json = value => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const bounded = async promise => {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('Synthetic completion deadline')), 1000);
  })]); } finally { clearTimeout(timer); }
};
const gate = () => {
  const entered = deferred(), release = deferred();
  return { entered: entered.promise, release: release.resolve,
    async wait(signal, honorAbort = true) {
      entered.resolve();
      return honorAbort ? Promise.race([release.promise, new Promise((_, reject) => {
        signal.addEventListener('abort', () => reject(new DOMException('Synthetic abort', 'AbortError')), { once: true });
      })]) : release.promise;
    } };
};
const context = () => ({ contract: AUTHORITY_CONTRACT, app_id: STAGING_APP_ID, auth_user_id: config.authUserId,
  staging: true, synthetic: true, user_id: '6aac58fe36c13a1c49ba7cf8', user_email: config.email,
  identity_version: 1, is_platform_owner: false, agency_id: 'agency-a', membership_id: 'admin-a',
  membership_key: 'agency-a:6aac58fe36c13a1c49ba7cf8', membership_version: 1, membership_status: 'active',
  tenant_role: 'agency_admin', agency: { id: 'agency-a', name: 'Synthetic A', status: 'active' } });

function server({ grant, verify, cleanup, timeoutMs = 1000 } = {}) {
  const live = new Set(), logouts = [];
  const cleaned = deferred();
  let grants = 0;
  const client = createStagingAuthorityClient(config, { timeoutMs, fetchImpl: async (url, options) => {
    assert.equal(options.headers.apikey, config.publishableKey);
    assert.equal(options.credentials, 'omit'); assert.equal(options.redirect, 'error');
    const bearer = options.headers.Authorization?.slice('Bearer '.length);
    if (url.endsWith('/token?grant_type=password')) {
      const number = ++grants, token = `synthetic.session${number}.token`; live.add(token);
      if (grant) await grant(number, options.signal);
      return json({ user, access_token: token, token_type: 'bearer' });
    }
    if (url.endsWith('/user')) {
      const replacement = verify ? await verify(bearer, options.signal) : undefined;
      return replacement || json(user);
    }
    if (url.endsWith('/logout?scope=local')) {
      logouts.push(bearer);
      if (cleanup) await cleanup(bearer, options.signal);
      live.delete(bearer); cleaned.resolve(); return new Response(null, { status: 204 });
    }
    assert.equal(url, `${config.projectUrl}/rest/v1/rpc/pennsync_staging_context`);
    assert.equal(live.has(bearer), true); return json(context());
  } });
  return { client, live, logouts, firstCleanup: cleaned.promise };
}
const denied = client => assert.rejects(client.rpc('context', { p_agency_id: 'agency-a' }), error => error.code === 'AUTHENTICATION_REQUIRED');
const rejected = promise => promise.then(() => 'UNEXPECTED_SUCCESS', error => error.code);

test('logout during pending user verification revokes the received candidate once and never admits RPCs', async () => {
  const paused = gate();
  const h = server({ verify: (_, signal) => paused.wait(signal) });
  const signingIn = rejected(h.client.signIn(password)); await paused.entered;
  await denied(h.client); await h.client.signOut();
  assert.equal(await signingIn, 'STALE_AUTHORITY_SESSION'); assert.equal(h.live.size, 0);
  assert.deepEqual(h.logouts, ['synthetic.session1.token']); await denied(h.client);
});

for (const [name, verify, code] of [
  ['wrong verified user', () => json({ ...user, email: 'different@example.test' }), 'AUTHENTICATION_IDENTITY_MISMATCH'],
  ['provider denial', () => new Response('Synthetic private provider detail', { status: 403 }), 'AUTHORITY_DENIED'],
  ['network failure', () => { throw new Error('Synthetic private network detail'); }, 'AUTHORITY_NETWORK_FAILED'],
]) test(`failed sign-in cleans its known session after ${name}`, async () => {
  const h = server({ verify }); assert.equal(await rejected(h.client.signIn(password)), code);
  assert.equal(h.live.size, 0); assert.deepEqual(h.logouts, ['synthetic.session1.token']); await denied(h.client);
});

test('verification timeout cleans the known candidate through an independent bounded request', async () => {
  const paused = gate(); const h = server({ verify: (_, signal) => paused.wait(signal), timeoutMs: 20 });
  const started = performance.now();
  assert.equal(await rejected(h.client.signIn(password)), 'AUTHORITY_REQUEST_ABORTED');
  assert.ok(performance.now() - started < 1000); assert.equal(h.live.size, 0); await denied(h.client);
});

test('replacing pending verification cannot let the stale attempt revoke the newer session', async () => {
  const paused = gate();
  const h = server({ verify: (bearer, signal) => bearer.includes('session1') ? paused.wait(signal, false) : undefined });
  const first = rejected(h.client.signIn(password)); await paused.entered;
  await h.client.signIn(password); paused.release(); assert.equal(await first, 'STALE_AUTHORITY_SESSION');
  assert.deepEqual([...h.live], ['synthetic.session2.token']); assert.deepEqual(h.logouts, ['synthetic.session1.token']);
  assert.equal((await h.client.rpc('context', { p_agency_id: 'agency-a' })).user_email, config.email);
  await h.client.signOut(); assert.equal(h.live.size, 0);
});

test('late received canceled grant cleans only its own session after a newer login succeeds', async () => {
  const paused = gate(); const h = server({ grant: (number, signal) => number === 1 ? paused.wait(signal, false) : undefined });
  const first = rejected(h.client.signIn(password)); await paused.entered;
  await h.client.signOut(); await h.client.signIn(password);
  paused.release(); assert.equal(await first, 'STALE_AUTHORITY_SESSION');
  await bounded(h.firstCleanup);
  assert.deepEqual([...h.live], ['synthetic.session2.token']); assert.deepEqual(h.logouts, ['synthetic.session1.token']);
  await h.client.rpc('context', { p_agency_id: 'agency-a' }); await h.client.signOut(); assert.equal(h.live.size, 0);
});

test('replacement of an established login revokes the old local session first', async () => {
  const h = server(); await h.client.signIn(password); await h.client.signIn(password);
  assert.deepEqual([...h.live], ['synthetic.session2.token']); assert.deepEqual(h.logouts, ['synthetic.session1.token']);
  await h.client.signOut(); assert.equal(h.live.size, 0);
});

test('cleanup failure stays fixed-code and retryable while local access remains denied', async () => {
  let failCleanup = true;
  const h = server({ cleanup: () => { if (failCleanup) throw new Error('Synthetic private cleanup detail'); } });
  await h.client.signIn(password); h.live.add('unrelated-native-session');
  assert.equal(await rejected(h.client.signOut()), 'AUTHORITY_SESSION_CLEANUP_FAILED'); await denied(h.client);
  assert.equal(h.live.size, 2);
  failCleanup = false; await h.client.signOut();
  assert.deepEqual([...h.live], ['unrelated-native-session']);
  assert.deepEqual(h.logouts, ['synthetic.session1.token', 'synthetic.session1.token']);
});

test('a never-received aborted grant remains an explicit provider-reconciliation limitation', async () => {
  const paused = gate(); const h = server({ grant: (_, signal) => paused.wait(signal) });
  const first = rejected(h.client.signIn(password)); await paused.entered; await h.client.signOut();
  assert.equal(await first, 'STALE_AUTHORITY_SESSION'); await denied(h.client);
  // Modeled server created a session but did not deliver its token. The client
  // has no supported exact-session credential; it must not guess or log out all.
  assert.equal(h.live.size, 1); assert.deepEqual(h.logouts, []);
});

test('cleanup deadline bounds a provider that ignores abort and permits an exact-session retry', async () => {
  let stalled = true;
  const h = server({ timeoutMs: 20, cleanup: () => stalled ? new Promise(() => {}) : undefined });
  await h.client.signIn(password);
  const started = performance.now();
  assert.equal(await rejected(h.client.signOut()), 'AUTHORITY_SESSION_CLEANUP_FAILED');
  assert.ok(performance.now() - started < 1000); await denied(h.client);
  stalled = false; await h.client.signOut();
  assert.equal(h.live.size, 0);
  assert.deepEqual(h.logouts, ['synthetic.session1.token', 'synthetic.session1.token']);
});

test('an unreadable grant body has a bounded read deadline without inferring a session token', async () => {
  let canceled = false, requests = 0;
  const cancellation = deferred();
  const client = createStagingAuthorityClient(config, { timeoutMs: 20, fetchImpl: async () => {
    requests++;
    return new Response(new ReadableStream({
      pull: () => new Promise(() => {}),
      cancel: () => { canceled = true; cancellation.resolve(); return new Promise(() => {}); },
    }), { headers: { 'content-type': 'application/json' } });
  } });
  const started = performance.now();
  assert.equal(await rejected(client.signIn(password)), 'AUTHORITY_REQUEST_ABORTED');
  assert.ok(performance.now() - started < 1000);
  await bounded(cancellation.promise); assert.equal(canceled, true);
  await client.signOut(); assert.equal(requests, 1); await denied(client);
});

test('a grant delivered after its timeout is cleaned and never becomes the active session', async () => {
  const h = server({ timeoutMs: 20, grant: () => new Promise(resolve => setTimeout(resolve, 40)) });
  assert.equal(await rejected(h.client.signIn(password)), 'AUTHORITY_REQUEST_ABORTED');
  await bounded(h.firstCleanup);
  assert.equal(h.live.size, 0); assert.deepEqual(h.logouts, ['synthetic.session1.token']); await denied(h.client);
});

test('wrong-identity grant data is rejected without treating its token as a cleanup credential', async () => {
  const requests = [];
  const client = createStagingAuthorityClient(config, { fetchImpl: async url => {
    requests.push(url);
    return json({ user: { ...user, id: '20000000-0000-4000-8000-000000000001' },
      access_token: 'untrusted.wrongidentity.token', token_type: 'bearer' });
  } });
  assert.equal(await rejected(client.signIn(password)), 'AUTHENTICATION_IDENTITY_MISMATCH');
  await client.signOut(); assert.deepEqual(requests, [`${config.projectUrl}/auth/v1/token?grant_type=password`]);
  await denied(client);
});

for (const [name, verify, code] of [
  ['fetch ignores abort', () => new Promise(() => {}), 'AUTHORITY_REQUEST_ABORTED'],
  ['JSON pull and cancellation ignore abort', () => new Response(new ReadableStream({
    pull: () => new Promise(() => {}), cancel: () => new Promise(() => {}),
  }), { headers: { 'content-type': 'application/json' } }), 'AUTHORITY_REQUEST_ABORTED'],
  ['error body cancellation never settles', () => new Response(new ReadableStream({
    cancel: () => new Promise(() => {}),
  }), { status: 403 }), 'AUTHORITY_DENIED'],
]) test(`known candidate cleanup completes when current-user ${name}`, async () => {
  const h = server({ verify, timeoutMs: 20 });
  const started = performance.now();
  assert.equal(await rejected(h.client.signIn(password)), code);
  assert.ok(performance.now() - started < 1000);
  assert.equal(h.live.size, 0); assert.deepEqual(h.logouts, ['synthetic.session1.token']);
  await denied(h.client);
});

test('late background cleanup failure retains only known credentials for retry without revoking the new session', async () => {
  const paused = gate(), failed = deferred();
  let failOld = true;
  const h = server({
    grant: (number, signal) => number === 1 ? paused.wait(signal, false) : undefined,
    cleanup: bearer => {
      if (bearer === 'synthetic.session1.token' && failOld) {
        failed.resolve(); throw new Error('Synthetic private cleanup failure');
      }
    },
  });
  const first = rejected(h.client.signIn(password)); await paused.entered;
  await h.client.signOut(); assert.equal(await first, 'STALE_AUTHORITY_SESSION');
  await h.client.signIn(password); paused.release(); await bounded(failed.promise);
  await h.client.rpc('context', { p_agency_id: 'agency-a' });
  assert.deepEqual(h.logouts, ['synthetic.session1.token']); assert.equal(h.live.size, 2);
  failOld = false; await h.client.signOut();
  assert.equal(h.live.size, 0); await denied(h.client);
});

for (const [name, response] of [
  ['401 grant error', () => new Response(JSON.stringify({ access_token: 'untrusted.error.token' }), {
    status: 401, headers: { 'content-type': 'application/json' },
  })],
  ['malformed grant JSON', () => new Response('{"access_token":"untrusted.malformed.token",', {
    headers: { 'content-type': 'application/json' },
  })],
]) test(`a late ${name} cannot replace the already-settled timeout error`, async () => {
  const released = deferred(), delivered = deferred();
  let responseDelivered = false;
  const requests = [];
  const client = createStagingAuthorityClient(config, { timeoutMs: 20, fetchImpl: async url => {
    requests.push(url);
    await released.promise; // Deliberately ignore cancellation until after the public deadline.
    responseDelivered = true; delivered.resolve(); return response();
  } });
  const signIn = rejected(client.signIn(password));
  assert.equal(await bounded(signIn), 'AUTHORITY_REQUEST_ABORTED');
  assert.equal(responseDelivered, false); await denied(client);
  released.resolve(); await bounded(delivered.promise);
  // Drain the late response's actual validation/cancellation continuation; no
  // timer sleep or fabricated successful grant is needed to establish ordering.
  await new Promise(setImmediate);
  assert.equal(await signIn, 'AUTHORITY_REQUEST_ABORTED');
  await client.signOut(); await denied(client);
  assert.deepEqual(requests, [`${config.projectUrl}/auth/v1/token?grant_type=password`]);
});
