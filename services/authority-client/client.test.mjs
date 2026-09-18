import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AUTHORITY_CONTRACT, STAGING_APP_ID, createStagingAuthorityClient } from './client.mjs';

const config = { appId: STAGING_APP_ID, projectRef: 'local-pennsync-authority', projectUrl: 'http://127.0.0.1:54321', publishableKey: 'sb_publishable_synthetic_test_key', authUserId: '10000000-0000-4000-8000-000000000001', email: 'info+pennsync-admin-a@caremetricai.com' };
const password = 'Synthetic-test-password-only';
const user = { id: config.authUserId, email: config.email, email_confirmed_at: '2026-09-17T00:00:00Z', role: 'authenticated', is_anonymous: false };
const json = value => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
const session = () => ({ user: { ...user }, access_token: 'synthetic.access.token', token_type: 'bearer' });
const envelope = () => ({ contract: AUTHORITY_CONTRACT, app_id: STAGING_APP_ID, auth_user_id: config.authUserId, staging: true, synthetic: true });
const context = () => ({ ...envelope(), user_id: '6aac58fe36c13a1c49ba7cf8', user_email: config.email, identity_version: 1, agency_id: 'agency-a', membership_id: 'admin-a', membership_key: 'agency-a:6aac58fe36c13a1c49ba7cf8', membership_version: 1, membership_status: 'active', tenant_role: 'agency_admin', is_platform_owner: false, agency: { id: 'agency-a', name: 'Synthetic A', status: 'active' } });
const patient = () => ({ id: 'patient-a', agency_id: 'agency-a', display_name: 'Synthetic A1', synthetic: true, version: 1 });
function harness(handler = () => json(context())) {
  const calls = [];
  const client = createStagingAuthorityClient(config, { fetchImpl: async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith('/token?grant_type=password')) return json(session());
    if (url.endsWith('/user')) return json(user);
    return handler(url, init);
  } });
  return { client, calls };
}

test('independent login verifies the expected user and exposes no token or password', async () => {
  const { client, calls } = harness();
  assert.deepEqual(await client.signIn(password), { id: config.authUserId, email: config.email, provider: 'supabase', app_id: STAGING_APP_ID });
  assert.deepEqual(await client.rpc('context', { p_agency_id: 'agency-a' }), context());
  assert.equal(calls.length, 3);
  for (const { url, init } of calls) {
    assert.ok(url.startsWith(config.projectUrl + '/'));
    assert.equal(init.redirect, 'error'); assert.equal(init.credentials, 'omit'); assert.equal(init.cache, 'no-store');
  }
  assert.equal(calls[1].init.headers.Authorization, 'Bearer synthetic.access.token');
  assert.equal(JSON.parse(calls[2].init.body).p_app_id, STAGING_APP_ID);
  assert.equal(JSON.stringify(client), '{}');
});

for (const patch of [
  { appId: '694ec16e72e01b60d22f7cbf' }, { email: 'owner@example.test' }, { authUserId: 'not-a-uuid' },
  { publishableKey: 'sb_secret_NOT_A_BROWSER_KEY' }, { projectUrl: 'http://localhost:54321' },
  { projectUrl: 'https://evil.example' }, { projectUrl: 'https://localhost:54321' },
  { projectRef: 'xsqobvvreaovwibxwyvv', projectUrl: 'https://xsqobvvreaovwibxwyvv.supabase.co' },
]) test(`rejects a production/shared/foreign target or credential (${Object.keys(patch).join(',')})`, () => {
  assert.throws(() => createStagingAuthorityClient({ ...config, ...patch }), /INVALID_STAGING_TARGET/);
});

test('well-formed unapproved hosted targets are rejected before credentials can leave the client', () => {
  let networkCalls = 0;
  for (const projectRef of ['abcdefghijklmnopqrst', 'xsqobvvreaovwibxwyvv', 'uppdjphagdildcgkvdsz', 'ubbtgcaosuebrlwcvihw', 'xgauehtwksmnoqhgqegm']) {
    for (const claimedApproval of [{}, { approvedProjectRef: projectRef, allowHosted: true }]) {
      assert.throws(() => createStagingAuthorityClient({ ...config, ...claimedApproval,
        projectRef, projectUrl: `https://${projectRef}.supabase.co`,
      }, { fetchImpl: async () => { networkCalls++; throw new Error('unexpected request'); } }), /INVALID_STAGING_TARGET/);
    }
  }
  assert.equal(networkCalls, 0);
});

test('only the independently verified hosted ref and URL pair admit modeled Auth and RPC requests', async () => {
  const target = { projectRef: 'xxtyweswohkvgkprimwa', projectUrl: 'https://xxtyweswohkvgkprimwa.supabase.co' };
  const calls = [];
  const client = createStagingAuthorityClient({ ...config, ...target }, { fetchImpl: async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith('/token?grant_type=password')) return json(session());
    if (url.endsWith('/user')) return json(user);
    if (url.endsWith('/logout?scope=local')) return new Response(null, { status: 204 });
    return json(context());
  } });
  await client.signIn(password);
  assert.deepEqual(await client.rpc('context', { p_agency_id: 'agency-a' }), context());
  await client.signOut();
  assert.deepEqual(calls.map(call => call.url), [
    '/auth/v1/token?grant_type=password', '/auth/v1/user',
    '/rest/v1/rpc/pennsync_staging_context', '/auth/v1/logout?scope=local',
  ].map(path => target.projectUrl + path));
  assert.ok(calls.every(call => call.init.redirect === 'error' && call.init.credentials === 'omit'));

  for (const patch of [
    { projectRef: config.projectRef }, { projectUrl: config.projectUrl },
    { projectRef: `${target.projectRef}x` }, { projectRef: target.projectRef.toUpperCase() },
    ...[`${target.projectUrl}/`, `${target.projectUrl}:443`, `${target.projectUrl}?approved=true`,
      `${target.projectUrl}#local`, `${target.projectUrl}/rest/v1`, `${target.projectUrl}.evil.example`,
      `https://user@${target.projectRef}.supabase.co`, `http://${target.projectRef}.supabase.co`,
      `https://${target.projectRef.toUpperCase()}.supabase.co`].map(projectUrl => ({ projectUrl })),
    { publishableKey: 'sb_secret_never_a_browser_key' }, { email: 'unapproved@example.test' },
  ]) {
    assert.throws(() => createStagingAuthorityClient({ ...config, ...target, ...patch,
      allowHosted: true, approvedProjectRef: target.projectRef,
    }, { fetchImpl: () => { throw new Error('invalid target reached transport'); } }), /INVALID_STAGING_TARGET/);
  }
});

test('no RPC before a successful identity check; no generic function escape hatch', async () => {
  const { client, calls } = harness();
  await assert.rejects(client.rpc('context', { p_agency_id: 'agency-a' }), /AUTHENTICATION_REQUIRED/);
  await assert.rejects(client.rpc('getMyTenantContext', {}), /INVALID_AUTHORITY_REQUEST/);
  await assert.rejects(client.rpc('context', { p_agency_id: 'agency-a', p_app_id: STAGING_APP_ID }), /INVALID_AUTHORITY_REQUEST/);
  assert.equal(calls.length, 0);
});

for (const patch of [{ id: '10000000-0000-4000-8000-000000000002' }, { email: 'other@example.test' }, { role: 'service_role' }, { is_anonymous: true }, { email_confirmed_at: null }, { email_confirmed_at: 'invalid' }]) {
  test(`rejects mismatched/unverified login identity (${Object.keys(patch)})`, async () => {
    const client = createStagingAuthorityClient(config, { fetchImpl: async () => json({ ...session(), user: { ...user, ...patch } }) });
    await assert.rejects(client.signIn(password), /AUTHENTICATION_IDENTITY_MISMATCH/);
    await assert.rejects(client.rpc('memberships'), /AUTHENTICATION_REQUIRED/);
  });
}

test('a different independently fetched user cannot complete sign-in', async () => {
  let calls = 0;
  const client = createStagingAuthorityClient(config, { fetchImpl: async () => json(++calls === 1 ? session() : { ...user, id: '10000000-0000-4000-8000-000000000002' }) });
  await assert.rejects(client.signIn(password), /AUTHENTICATION_IDENTITY_MISMATCH/);
});

test('invalid parameters are rejected before network access', async () => {
  const { client, calls } = harness(); await client.signIn(password);
  for (const params of [{ p_agency_id: '' }, { p_agency_id: '$ne' }, { p_agency_id: 'agency-a', p_limit: 0 }, { p_agency_id: 'agency-a', p_limit: 101 }, { p_agency_id: 'agency-a', p_limit: '1' }, { p_agency_id: 'agency-a', p_after_id: { $ne: null } }]) {
    await assert.rejects(client.rpc('patients', params), /INVALID_AUTHORITY_REQUEST/);
  }
  assert.equal(calls.length, 2);
});

test('session invalidation discards a late successful response even if fetch ignores abort', async () => {
  let resolve;
  const { client } = harness(() => new Promise(done => { resolve = done; })); await client.signIn(password);
  const pending = client.rpc('context', { p_agency_id: 'agency-a' });
  client.invalidate(); resolve(json(context()));
  await assert.rejects(pending, /STALE_AUTHORITY_SESSION/);
  await assert.rejects(client.rpc('memberships'), /AUTHENTICATION_REQUIRED/);
});

test('logout clears local access even when the provider is unreachable', async () => {
  const { client } = harness(() => { throw new Error('secret server detail'); }); await client.signIn(password);
  await assert.rejects(client.signOut(), /^AuthorityClientError: AUTHORITY_SESSION_CLEANUP_FAILED$/);
  await assert.rejects(client.rpc('memberships'), /AUTHENTICATION_REQUIRED/);
});

test('provider messages, SQL details and credentials never escape error mapping', async () => {
  const { client } = harness(() => new Response('secret password or patient content', { status: 403 })); await client.signIn(password);
  await assert.rejects(client.rpc('memberships'), error => error.code === 'AUTHORITY_DENIED' && error.status === 403 && !JSON.stringify(error).includes('secret'));
});

for (const patch of [{ app_id: '694ec16e72e01b60d22f7cbf' }, { auth_user_id: '10000000-0000-4000-8000-000000000002' }, { staging: false }, { synthetic: false }, { is_platform_owner: true }, { agency_id: 'agency-b' }, { membership_version: '1' }, { user_id: 'other' }]) {
  test(`binds authority response to the exact actor/agency (${Object.keys(patch)})`, async () => {
    const { client } = harness(() => json({ ...context(), ...patch })); await client.signIn(password);
    await assert.rejects(client.rpc('context', { p_agency_id: 'agency-a' }), /INVALID_AUTHORITY_RESPONSE/);
  });
}

test('patient scope, cursor and duplicate checks reject a malformed roster', async () => {
  for (const patch of [{ items: [{ ...patient(), agency_id: 'agency-b' }] }, { items: [patient(), patient()] }, { next_cursor: 'unrelated' }, { context: { ...context(), user_email: 'other@example.test' } }]) {
    const { client } = harness(() => json({ ...envelope(), context: context(), items: [patient()], next_cursor: null, ...patch })); await client.signIn(password);
    await assert.rejects(client.rpc('patients', { p_agency_id: 'agency-a' }), /INVALID_AUTHORITY_RESPONSE/);
  }
});

test('bounded JSON rejects oversized and malformed bodies without reflecting content', async () => {
  for (const response of [() => json({ text: 'x'.repeat(1024 * 1024) }), () => new Response('secret malformed JSON', { headers: { 'content-type': 'application/json' } }), () => new Response('<html>secret</html>', { headers: { 'content-type': 'text/html' } })]) {
    const { client } = harness(response); await client.signIn(password);
    await assert.rejects(client.rpc('memberships'), /^AuthorityClientError: INVALID_AUTHORITY_RESPONSE$/);
  }
});

test('valid bounded roster and current membership list retain identity binding', async () => {
  const { client } = harness(url => json(url.endsWith('_memberships')
    ? { ...envelope(), user_id: context().user_id, user_email: config.email, memberships: [context()] }
    : { ...envelope(), context: context(), items: [patient()], next_cursor: 'patient-a' }));
  await client.signIn(password);
  assert.equal((await client.rpc('memberships')).memberships.length, 1);
  assert.equal((await client.rpc('patients', { p_agency_id: 'agency-a', p_limit: 1 })).items.length, 1);
});

test('assignment receipts bind payload, expected versions, action and retry ID', async () => {
  const params = { p_agency_id: 'agency-a', p_patient_id: 'patient-a', p_target_membership_id: 'clinician-a', p_action: 'grant', p_expected_actor_version: 1, p_expected_target_version: 1, p_expected_assignment_version: 0, p_request_id: '50000000-0000-4000-8000-000000000001' };
  const result = { ...envelope(), agency_id: 'agency-a', patient_id: 'patient-a', membership_id: 'clinician-a', membership_version: 1, assignment_version: 1, assignment_status: 'active', action: 'grant_assignment', request_id: params.p_request_id, replayed: false };
  for (const patch of [null, { replayed: true }, { agency_id: 'agency-b' }, { patient_id: 'patient-b' }, { membership_id: 'other' }, { assignment_version: 2 }, { assignment_status: 'revoked' }, { request_id: '50000000-0000-4000-8000-000000000002' }, { action: 'revoke_assignment' }, { replayed: 'true' }]) {
    const { client } = harness(() => json({ ...result, ...patch })); await client.signIn(password);
    if (!patch || patch.replayed === true) assert.equal((await client.rpc('assignment', params)).assignment_version, 1);
    else await assert.rejects(client.rpc('assignment', params), /INVALID_AUTHORITY_RESPONSE/);
  }
});

test('membership revocation receipts cannot masquerade as another current version', async () => {
  const params = { p_agency_id: 'agency-a', p_target_membership_id: 'clinician-a', p_expected_actor_version: 1, p_expected_target_version: 1, p_request_id: '50000000-0000-4000-8000-000000000002' };
  const result = { ...envelope(), agency_id: 'agency-a', membership_id: 'clinician-a', membership_version: 2, membership_status: 'revoked', action: 'revoke_membership', request_id: params.p_request_id, replayed: false };
  for (const patch of [null, { membership_version: 1 }, { membership_status: 'active' }, { action: 'grant_assignment' }]) {
    const { client } = harness(() => json({ ...result, ...patch })); await client.signIn(password);
    if (!patch) assert.equal((await client.rpc('revoke_membership', params)).membership_version, 2);
    else await assert.rejects(client.rpc('revoke_membership', params), /INVALID_AUTHORITY_RESPONSE/);
  }
});

test('timeouts abort the transport without returning provider data', async () => {
  const client = createStagingAuthorityClient(config, { timeoutMs: 5, fetchImpl: async (_url, { signal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('private detail')), { once: true })) });
  await assert.rejects(client.signIn(password), /^AuthorityClientError: AUTHORITY_REQUEST_ABORTED$/);
});

test('an invalid new sign-in attempt invalidates the previous session', async () => {
  const { client } = harness(); await client.signIn(password);
  await assert.rejects(client.signIn('short'), /INVALID_STAGING_CREDENTIAL/);
  await assert.rejects(client.rpc('memberships'), /AUTHENTICATION_REQUIRED/);
});

test('rechecks the session after the transport promise resolves', async () => {
  let client;
  ({ client } = harness(() => ({
    ok: true, status: 200, headers: new Headers({ 'content-type': 'application/json' }),
    body: { getReader() {
      let read = false;
      return {
        async read() { if (read) return { done: true }; read = true; return { done: false, value: new TextEncoder().encode(JSON.stringify(context())) }; },
        async cancel() {},
        releaseLock() { queueMicrotask(() => queueMicrotask(() => client.invalidate())); },
      };
    } },
  })));
  await client.signIn(password);
  await assert.rejects(client.rpc('context', { p_agency_id: 'agency-a' }), /STALE_AUTHORITY_SESSION/);
});

test('requires an explicit cursor even for an empty roster and rejects extra record fields', async () => {
  const cases = [
    { ...envelope(), context: context(), items: [] },
    { ...envelope(), context: context(), items: [], next_cursor: null, unexpected_record: { id: 'foreign' } },
    { ...envelope(), context: { ...context(), unexpected_record: 'foreign' }, items: [], next_cursor: null },
    { ...envelope(), context: { ...context(), agency: { ...context().agency, unexpected_record: 'foreign' } }, items: [], next_cursor: null },
    { ...envelope(), context: context(), items: [{ ...patient(), unexpected_record: 'foreign' }], next_cursor: null },
  ];
  for (const result of cases) {
    const { client } = harness(() => json(result)); await client.signIn(password);
    await assert.rejects(client.rpc('patients', { p_agency_id: 'agency-a' }), /INVALID_AUTHORITY_RESPONSE/);
  }
});

test('late successful fetch and stream responses cannot ignore the timeout', async () => {
  for (const delayedStream of [false, true]) {
    const client = createStagingAuthorityClient(config, { timeoutMs: 5, fetchImpl: async url => {
      if (url.endsWith('/token?grant_type=password')) return json(session());
      if (url.endsWith('/user')) return json(user);
      if (!delayedStream) { await new Promise(resolve => setTimeout(resolve, 20)); return json(context()); }
      return new Response(new ReadableStream({ async start(controller) {
        await new Promise(resolve => setTimeout(resolve, 20));
        controller.enqueue(new TextEncoder().encode(JSON.stringify(context()))); controller.close();
      } }), { headers: { 'content-type': 'application/json' } });
    } });
    await client.signIn(password);
    await assert.rejects(client.rpc('context', { p_agency_id: 'agency-a' }), /AUTHORITY_REQUEST_ABORTED/);
  }
});

for (const role of ['agency_admin','manager','office_staff']) test(`referral selection admits checked ${role} scope`, async()=>{
  const selected={...envelope(),context:{...context(),tenant_role:role},patient:patient()};
  const listed={...envelope(),context:selected.context,items:[patient()],next_cursor:null};
  const {client}=harness(url=>json(url.endsWith('_referral_patients')?listed:selected));
  await client.signIn(password);
  assert.deepEqual(await client.rpc('referral_patient',{p_agency_id:'agency-a',p_patient_id:'patient-a'}),selected);
  assert.deepEqual(await client.rpc('referral_patients',{p_agency_id:'agency-a',p_limit:1,p_after_id:null}),listed);
});
for(const patch of [{p_limit:0},{p_limit:101},{p_limit:1.5},{p_after_id:'bad id'},{p_agency_id:'bad id'},{extra:true}]) test(`referral roster rejects malformed parameters ${JSON.stringify(patch)}`,async()=>{
 const {client,calls}=harness();await client.signIn(password);const before=calls.length;
 await assert.rejects(client.rpc('referral_patients',{p_agency_id:'agency-a',p_limit:1,p_after_id:null,...patch}),/INVALID_AUTHORITY_REQUEST/);
 assert.equal(calls.length,before);
});
for(const mutation of [
 r=>{r.context.tenant_role='clinician';},r=>{r.context.agency_id='agency-b';},
 r=>{r.items[0].agency_id='agency-b';},r=>{r.items[0].secret='extra';},
 r=>{r.items.push(patient());},r=>{r.next_cursor='foreign';},r=>{delete r.next_cursor;},
]) test('referral roster withholds malformed or foreign response',async()=>{
 const result={...envelope(),context:context(),items:[patient()],next_cursor:null};mutation(result);
 const {client}=harness(()=>json(result));await client.signIn(password);
 await assert.rejects(client.rpc('referral_patients',{p_agency_id:'agency-a',p_limit:2,p_after_id:null}),/INVALID_AUTHORITY_RESPONSE/);
});
test('referral roster requires explicit paging parameters',async()=>{
 const {client,calls}=harness();await client.signIn(password);const before=calls.length;
 for(const params of [{p_agency_id:'agency-a'},{p_agency_id:'agency-a',p_limit:1},{p_agency_id:'agency-a',p_after_id:null}]) await assert.rejects(client.rpc('referral_patients',params),/INVALID_AUTHORITY_REQUEST/);
 assert.equal(calls.length,before);
});
