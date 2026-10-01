// The production entry point of the staging transport: a real staff account on a
// real project, with the identity learned from the grant rather than pinned.
//
// Every assertion here is about what the PRODUCTION mode refuses, because the
// shared half is already proved by `client.test.mjs` against the staging entry
// point and a second copy of those cases would prove the same code twice.
import { strict as assert } from 'node:assert';
import test from 'node:test';
import {
  AUTHORITY_CONTRACT, createProductionAuthorityClient, PRODUCTION_METHODS, STAGING_APP_ID, validOrigin,
} from './client.mjs';

const APP_ID = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const PROJECT_REF = 'abcdefghijklmnopqrst';
const PROJECT_URL = `https://${PROJECT_REF}.supabase.co`;
const API_URL = 'https://pennsync-api.example.test';
const EMAIL = 'nurse@agency.example';
const AUTH_USER_ID = '20000000-0000-4000-8000-000000000001';
const USER_ID = '6aac58fe36c13a1c49ba7cf8';
const PASSWORD = 'correct-horse-battery';

const target = (overrides = {}) => ({
  appId: APP_ID, projectRef: PROJECT_REF, projectUrl: PROJECT_URL, publishableKey: 'sb_publishable_production_key',
  apiUrl: API_URL, email: EMAIL, ...overrides,
});

/**
 * A production project that answers like the real one: the store stamps
 * `staging`/`synthetic` true whatever the app, and the agency name is a real
 * name rather than a synthetic one.
 */
function fixture(overrides = {}) {
  const live = new Map();
  const state = {
    requests: [], user: {
      id: AUTH_USER_ID, email: EMAIL, role: 'authenticated', is_anonymous: false,
      email_confirmed_at: '2026-10-01T00:00:00Z',
    }, context: null, apiResponse: null,
    // Link tokens this fixture will honour, and the passwords it was asked to
    // write. Both are the fixture's own strings: nothing real is involved.
    links: new Set(['invite:invitetoken-aaaaaa', 'recovery:recoverytoken-bbbbbb']),
    passwords: [], password: PASSWORD, consumeLinks: true, refuseLogout: false, ...overrides,
  };
  let next = 0;
  const json = (body, status = 200) => new Response(JSON.stringify(body), {
    status, headers: { 'content-type': 'application/json' },
  });
  const common = () => ({
    contract: AUTHORITY_CONTRACT, app_id: APP_ID, auth_user_id: state.user.id, staging: true, synthetic: true,
  });
  const context = (agency = 'agency-real') => ({
    ...common(), user_id: USER_ID, user_email: EMAIL, identity_version: 2, is_platform_owner: false,
    agency_id: agency, membership_id: `membership-${agency}`, membership_key: `${agency}:${USER_ID}`,
    membership_version: 4, membership_status: 'active', tenant_role: 'clinician',
    agency: { id: agency, name: 'Keystone Home Health', status: 'active' },
  });
  state.contextValue = context;
  state.fetch = async (url, options) => {
    state.requests.push({ url, method: options.method });
    if (url.startsWith(`${API_URL}/`)) {
      if (!live.has(options.headers.Authorization?.slice(7))) return json({}, 401);
      assert.equal(options.headers.apikey, undefined, 'the publishable key must never reach the service');
      return state.apiResponse ? state.apiResponse(url, options)
        : json({ success: true, result: { ok: true }, execution: 'pennsync-api', base44ExecutionDependency: false });
    }
    if (!url.startsWith(`${PROJECT_URL}/`)) throw new Error('FIXTURE_FOREIGN_DESTINATION');
    const body = options.body ? JSON.parse(options.body) : {};
    if (url.endsWith('/verify')) {
      // A fake transport, and deliberately a STRICT one: the exchange has to name
      // this address, one of the two link kinds, and a token this fixture minted.
      // No real address and no real link is used anywhere, and nothing here sends.
      if (body.email !== EMAIL || !['invite', 'recovery'].includes(body.type)
        || !state.links.has(`${body.type}:${body.token}`)) return json({}, 401);
      if (state.consumeLinks) state.links.delete(`${body.type}:${body.token}`);
      const bearer = `production.link${++next}.token`;
      live.set(bearer, true);
      return json({ user: state.user, access_token: bearer, token_type: 'bearer' });
    }
    if (url.endsWith('/token?grant_type=password')) {
      // The CURRENT password, so a grant after a link write has to use what the
      // write set rather than what the fixture started with.
      if (body.email !== EMAIL || body.password !== state.password) return json({}, 401);
      const bearer = `production.session${++next}.token`;
      live.set(bearer, true);
      return json({ user: state.user, access_token: bearer, token_type: 'bearer' });
    }
    const bearer = options.headers.Authorization?.slice(7);
    if (!live.has(bearer)) return json({}, 401);
    if (url.endsWith('/logout?scope=local')) {
      if (state.refuseLogout) return json({}, 500);
      live.delete(bearer); return new Response(null, { status: 204 });
    }
    if (url.endsWith('/user') && options.method === 'PUT') {
      if (typeof body.password !== 'string' || body.password.length < 12) return json({}, 422);
      state.passwords.push(body.password);
      state.password = body.password;
      return json(state.user);
    }
    if (url.endsWith('/user')) return json(state.user);
    if (url.endsWith('/pennsync_staging_context')) {
      return json(state.context ?? context(body.p_agency_id));
    }
    if (url.endsWith('/pennsync_staging_memberships')) {
      return json(state.context ?? {
        ...common(), user_id: USER_ID, user_email: EMAIL, memberships: [context(), context('agency-second')],
      });
    }
    throw new Error('FIXTURE_UNSUPPORTED_OPERATION');
  };
  return state;
}

const client = (state, overrides) => createProductionAuthorityClient(target(overrides), { fetchImpl: state.fetch });

test('a production target is derived and shaped, never pinned, and refuses the staging environment', () => {
  assert.doesNotThrow(() => createProductionAuthorityClient(target(), { fetchImpl: fixture().fetch }));
  for (const [label, overrides] of [
    ['the staging app id', { appId: STAGING_APP_ID }],
    ['the staging project', { projectRef: 'xxtyweswohkvgkprimwa', projectUrl: 'https://xxtyweswohkvgkprimwa.supabase.co' }],
    // The pair is DERIVED, so a reference and an origin that disagree cannot be
    // configured — the property staging buys by enumerating two pairs.
    ['a mismatched project origin', { projectUrl: 'https://zzzzzzzzzzzzzzzzzzzz.supabase.co' }],
    ['a foreign project origin', { projectUrl: 'https://evil.example/abcdefghijklmnopqrst.supabase.co' }],
    ['a short app id', { appId: 'aaaa' }],
    ['a secret key', { publishableKey: 'sb_secret_forbidden' }],
    ['an unnormalised address', { email: 'Nurse@Agency.Example' }],
    ['no address', { email: '' }],
    // The bearer goes to `apiUrl`, so it has to be an origin and only an origin.
    ['an api path', { apiUrl: `${API_URL}/v1/functions/x` }],
    ['an api query', { apiUrl: `${API_URL}/?a=1` }],
    ['api credentials', { apiUrl: 'https://user:pass@pennsync-api.example.test' }],
    ['plaintext api transport', { apiUrl: 'http://pennsync-api.example.test' }],
    ['no api origin at all', { apiUrl: null }],
  ]) {
    assert.throws(() => createProductionAuthorityClient(target(overrides), { fetchImpl: fixture().fetch }),
      { code: 'INVALID_PRODUCTION_TARGET' }, label);
  }
});

test('validOrigin accepts an origin and refuses everything that merely contains one', () => {
  for (const value of ['https://a.example', 'https://a.example:8443', 'http://127.0.0.1:54341', 'http://localhost:5173']) {
    assert.equal(validOrigin(value), true, value);
  }
  for (const value of ['https://a.example/', 'https://a.example/x', 'https://a.example#f', 'http://a.example',
    'ftp://a.example', 'https://u@a.example', 'a.example', '']) {
    assert.equal(validOrigin(value), false, value);
  }
});

test('the identity is learned from the grant and every later answer is held to it', async () => {
  const state = fixture();
  const session = client(state);
  const identity = await session.signIn(PASSWORD);
  assert.deepEqual(identity, { id: AUTH_USER_ID, email: EMAIL, provider: 'supabase', app_id: APP_ID });
  const context = await session.rpc('context', { p_agency_id: 'agency-real' });
  assert.equal(context.agency.name, 'Keystone Home Health');
  assert.equal(context.user_id, USER_ID);
  // A real agency name is the point: the staging validator requires
  // `Synthetic ` and this one must not, or no production answer could pass.
  assert.equal(context.agency.name.startsWith('Synthetic '), false);
  const memberships = await session.rpc('memberships', {});
  assert.deepEqual(memberships.memberships.map(value => value.agency_id), ['agency-real', 'agency-second']);
  await session.signOut();
  await assert.rejects(session.rpc('memberships', {}), { code: 'AUTHENTICATION_REQUIRED' });
});

test('a grant for another person, an unconfirmed account or an anonymous role is refused', async () => {
  for (const user of [
    { email: 'someone.else@agency.example' },
    { email_confirmed_at: null },
    { is_anonymous: true },
    { role: 'anon' },
    { id: 'not-a-uuid' },
  ]) {
    const state = fixture();
    state.user = { ...state.user, ...user };
    await assert.rejects(client(state).signIn(PASSWORD), error =>
      ['AUTHENTICATION_IDENTITY_MISMATCH', 'INVALID_AUTHORITY_RESPONSE'].includes(error.code));
  }
});

test('the confirmation read is a check: a /user answer that disagrees with the grant is refused', async () => {
  const state = fixture();
  let served = 0;
  const upstream = state.fetch;
  state.fetch = async (url, options) => {
    if (url.endsWith('/user') && ++served === 1) {
      // A second person, delivered where the confirmation is read. Binding the
      // identity from the grant first is what makes this a refusal rather than
      // a rebinding.
      return new Response(JSON.stringify({ ...state.user, id: '30000000-0000-4000-8000-000000000009' }),
        { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return upstream(url, options);
  };
  const session = client(state);
  await assert.rejects(session.signIn(PASSWORD), { code: 'AUTHENTICATION_IDENTITY_MISMATCH' });
  // A failed attempt leaves no identity behind for the next one to be measured against.
  await session.signIn(PASSWORD);
  assert.equal((await session.rpc('context', { p_agency_id: 'agency-real' })).auth_user_id, AUTH_USER_ID);
});

test('an authority answer about another app, another subject or an incomplete membership is refused', async () => {
  const base = fixture().contextValue();
  for (const [label, overrides] of [
    ['another app', { app_id: STAGING_APP_ID }],
    ['another native identity', { auth_user_id: '40000000-0000-4000-8000-000000000002' }],
    ['another address', { user_email: 'other@agency.example' }],
    ['a contract rename', { contract: 'cm.pennsync.authority.production.v2' }],
    ['a membership key naming a different subject', { membership_key: 'agency-real:ffffffffffffffffffffffff' }],
    ['a suspended membership', { membership_status: 'suspended' }],
    ['an unknown role', { tenant_role: 'super_admin' }],
    ['a platform owner claim', { is_platform_owner: true }],
    ['a closed agency', { agency: { id: 'agency-real', name: 'Keystone Home Health', status: 'closed' } }],
    ['a nameless agency', { agency: { id: 'agency-real', name: '', status: 'active' } }],
    ['an agency that is not the one asked for', { agency_id: 'agency-other' }],
  ]) {
    const state = fixture();
    state.context = { ...base, ...overrides };
    const session = client(state);
    await session.signIn(PASSWORD);
    await assert.rejects(session.rpc('context', { p_agency_id: 'agency-real' }),
      { code: 'INVALID_AUTHORITY_RESPONSE' }, label);
  }
});

test('a membership list carrying a row for somebody else is refused', async () => {
  const state = fixture();
  const mine = state.contextValue();
  state.context = {
    contract: AUTHORITY_CONTRACT, app_id: APP_ID, auth_user_id: AUTH_USER_ID, staging: true, synthetic: true,
    user_id: USER_ID, user_email: EMAIL,
    memberships: [mine, { ...state.contextValue('agency-second'), user_id: 'ffffffffffffffffffffffff',
      membership_key: 'agency-second:ffffffffffffffffffffffff' }],
  };
  const session = client(state);
  await session.signIn(PASSWORD);
  await assert.rejects(session.rpc('memberships', {}), { code: 'INVALID_AUTHORITY_RESPONSE' });
});

test('only the two authority methods are reachable, and a ported handler still needs a tenant', async () => {
  const state = fixture();
  const session = client(state);
  await session.signIn(PASSWORD);
  assert.deepEqual([...PRODUCTION_METHODS], ['context', 'memberships']);
  for (const method of ['patients', 'patient_context', 'visits_schedule', 'assignment', 's3_create', 'nope']) {
    await assert.rejects(session.rpc(method, {}), { code: 'INVALID_AUTHORITY_REQUEST' }, method);
  }
  await assert.rejects(session.rpc('context', {}), { code: 'INVALID_AUTHORITY_REQUEST' });
  await assert.rejects(session.rpc('memberships', { p_agency_id: 'agency-real' }), { code: 'INVALID_AUTHORITY_REQUEST' });
  assert.deepEqual(await session.callFunction('getAgencySettings', 'agency-real', {}), { ok: true });
  await assert.rejects(session.callFunction('getAgencySettings', '', {}), { code: 'PENNSYNC_API_AGENCY_REQUIRED' });
  await assert.rejects(session.callFunction('notPorted', 'agency-real', {}), { code: 'PENNSYNC_API_FUNCTION_UNKNOWN' });
});

test('a short credential never reaches the project', async () => {
  const state = fixture();
  await assert.rejects(client(state).signIn('short'), { code: 'INVALID_PRODUCTION_CREDENTIAL' });
  assert.deepEqual(state.requests, []);
});

test('a link sets the password and never becomes a session', async () => {
  const state = fixture();
  const api = client(state);
  const identity = await api.setPasswordFromLink('invite', 'invitetoken-aaaaaa', 'a-new-long-password');
  assert.deepEqual(identity, { id: AUTH_USER_ID, email: EMAIL, provider: 'supabase', app_id: APP_ID });
  assert.deepEqual(state.passwords, ['a-new-long-password']);
  // The write is a PUT on the user, not a second grant, and the exchange named
  // this address. Both are asserted from the requests the transport actually saw.
  assert.deepEqual(state.requests.map(entry => `${entry.method} ${entry.url.slice(PROJECT_URL.length)}`), [
    'POST /auth/v1/verify', 'PUT /auth/v1/user', 'POST /auth/v1/logout?scope=local',
  ]);
  // THE PROPERTY THIS METHOD EXISTS FOR: the grant that came out of a mailbox was
  // revoked, and no RPC can be made on it. A caller signs in afterwards with the
  // password it just set, which is the only path that produces a session.
  await assert.rejects(api.rpc('context', { p_agency_id: 'agency-real' }), { code: 'AUTHENTICATION_REQUIRED' });
  await assert.doesNotReject(api.signIn('a-new-long-password').then(() => api.rpc('context', { p_agency_id: 'agency-real' })));
});

test('a recovery link works the same way, and a consumed link cannot be replayed', async () => {
  const state = fixture();
  const api = client(state);
  await api.setPasswordFromLink('recovery', 'recoverytoken-bbbbbb', 'another-long-password');
  assert.deepEqual(state.passwords, ['another-long-password']);
  // The fixture consumes the token, as GoTrue does, so the second attempt is the
  // real replay case rather than a simulated one.
  await assert.rejects(api.setPasswordFromLink('recovery', 'recoverytoken-bbbbbb', 'third-long-password'),
    { code: 'AUTHENTICATION_FAILED' });
  assert.deepEqual(state.passwords, ['another-long-password']);
});

test('a link this client will not exchange never leaves the browser', async () => {
  const state = fixture();
  const api = client(state);
  for (const [label, args] of [
    // The absent GoTrue types, each of which would be a way to get a session
    // with no password, or to move the address the target is built around.
    ['a magic link', ['magiclink', 'invitetoken-aaaaaa', 'a-new-long-password']],
    ['a signup link', ['signup', 'invitetoken-aaaaaa', 'a-new-long-password']],
    ['an email change', ['email_change', 'invitetoken-aaaaaa', 'a-new-long-password']],
    ['no type at all', [undefined, 'invitetoken-aaaaaa', 'a-new-long-password']],
    ['a token with a space', ['invite', 'invite token', 'a-new-long-password']],
    ['a token carrying a path', ['invite', '../../etc/passwd', 'a-new-long-password']],
    ['a token too short to be one', ['invite', 'abc', 'a-new-long-password']],
    ['a token over the bound', ['invite', 'a'.repeat(513), 'a-new-long-password']],
    ['no token', ['invite', null, 'a-new-long-password']],
  ]) {
    await assert.rejects(api.setPasswordFromLink(...args), { code: 'INVALID_PRODUCTION_LINK' }, label);
  }
  // The same bounds as a sign-in, and the same code: this is the same credential
  // being written rather than a second kind of secret.
  for (const password of ['short', '', null, 'a'.repeat(513)]) {
    await assert.rejects(api.setPasswordFromLink('invite', 'invitetoken-aaaaaa', password),
      { code: 'INVALID_PRODUCTION_CREDENTIAL' });
  }
  assert.deepEqual(state.requests, []);
  assert.deepEqual(state.passwords, []);
});

test('a link session whose revocation fails is reported rather than left quiet', async () => {
  const state = fixture({ refuseLogout: true });
  const api = client(state);
  // A cleanup failure on the success path means a session minted from a mailbox
  // is still live, so it is raised rather than swallowed by the return -- and the
  // password was still written, which is why the code says cleanup and not write.
  await assert.rejects(api.setPasswordFromLink('invite', 'invitetoken-aaaaaa', 'a-new-long-password'),
    { code: 'AUTHORITY_SESSION_CLEANUP_FAILED' });
  assert.deepEqual(state.passwords, ['a-new-long-password']);
});

test('a staging client has no link exchange at all', async () => {
  const { createStagingAuthorityClient } = await import('./client.mjs');
  const state = fixture();
  // The staging target's own reviewed values: a synthetic actor's address and one
  // of the two approved reference/origin pairs. Nothing real appears here either.
  const staging = createStagingAuthorityClient({
    appId: STAGING_APP_ID, projectRef: 'local-pennsync-authority', projectUrl: 'http://127.0.0.1:54321',
    publishableKey: 'sb_publishable_synthetic_test_key',
    email: 'info+pennsync-admin-a@caremetricai.com', authUserId: '10000000-0000-4000-8000-000000000001',
  }, { fetchImpl: state.fetch });
  // Staging's four actors are fixed and their credentials are build
  // configuration, so there is no invitation to accept and nothing to set.
  await assert.rejects(staging.setPasswordFromLink('invite', 'invitetoken-aaaaaa', 'a-new-long-password'),
    { code: 'STAGING_OPERATION_UNAVAILABLE' });
  assert.deepEqual(state.requests, []);
});
