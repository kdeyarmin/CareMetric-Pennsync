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
  // Refresh tokens the project will honour, each exactly ONCE, as GoTrue rotates
  // them. `refreshed` counts exchanges so a test can tell a resume that reached
  // the provider from one that answered out of nothing.
  const refreshable = new Set();
  const state = {
    requests: [], user: {
      id: AUTH_USER_ID, email: EMAIL, role: 'authenticated', is_anonymous: false,
      email_confirmed_at: '2026-10-01T00:00:00Z',
    }, context: null, apiResponse: null, refreshed: 0, live, refreshable, ...overrides,
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
    if (url.endsWith('/token?grant_type=password')) {
      if (body.email !== EMAIL || body.password !== PASSWORD) return json({}, 401);
      const bearer = `production.session${++next}.token`;
      const refresh = `refresh${next}`;
      live.set(bearer, refresh);
      refreshable.add(refresh);
      return json({ user: state.user, access_token: bearer, token_type: 'bearer', refresh_token: refresh });
    }
    if (url.endsWith('/token?grant_type=refresh_token')) {
      state.refreshed += 1;
      // Single use and rotating, which is the whole reason this is the value kept
      // on the device rather than a bearer.
      if (typeof body.refresh_token !== 'string' || !refreshable.delete(body.refresh_token)) return json({}, 401);
      assert.equal(body.email, undefined, 'a refresh names nobody; the token is the claim');
      const bearer = `production.resumed${++next}.token`;
      const refresh = `refresh${next}`;
      live.set(bearer, refresh);
      refreshable.add(refresh);
      return json({ user: state.refreshUser ?? state.user, access_token: bearer, token_type: 'bearer',
        refresh_token: refresh });
    }
    const bearer = options.headers.Authorization?.slice(7);
    if (!live.has(bearer)) return json({}, 401);
    if (url.endsWith('/logout?scope=local')) {
      // A local logout ends the SESSION, so the refresh token minted with that
      // access token dies with it — which is what makes revoking on sign-out the
      // thing that stops a copied device record from being replayed.
      refreshable.delete(live.get(bearer));
      live.delete(bearer);
      return new Response(null, { status: 204 });
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

/**
 * A device record, as the browser store would hold it, and nothing more.
 *
 * `writes` records every value the client asked to keep, so a test can assert
 * that what survives is the ROTATED token rather than the one just spent.
 */
function deviceStore(initial = null) {
  const port = {
    value: initial, writes: [], clears: 0,
    read: () => port.value,
    write: value => { port.writes.push(value); port.value = value; return true; },
    clear: () => { port.clears += 1; port.value = null; },
  };
  return port;
}
/** How many grants the project still honours. */
const live = state => state.live.size;
const resumable = (state, store, overrides) =>
  createProductionAuthorityClient(target(overrides), { fetchImpl: state.fetch, sessionStore: store });

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

test('a reload takes up the session this device holds, and the record ROTATES', async () => {
  // The property this whole facility exists for. The Base44 path survives a reload
  // because its access token is in `localStorage`; here nothing but a single-use
  // refresh token is kept, and the access token never leaves the closure.
  const state = fixture();
  const store = deviceStore();
  const first = resumable(state, store);
  await first.signIn(PASSWORD);
  assert.deepEqual(store.writes, ['refresh1'], 'signing in keeps exactly the grant`s refresh token');

  // A reload is a NEW client over the same device record: nothing in memory
  // survives, which is what makes this a reload rather than a second call.
  const reloaded = resumable(state, store);
  const identity = await reloaded.resume();
  assert.equal(identity.email, EMAIL);
  assert.equal(identity.id, AUTH_USER_ID);
  assert.equal(state.refreshed, 1);
  assert.equal(store.writes.length, 2);
  assert.equal(typeof store.value, 'string');
  assert.notEqual(store.value, 'refresh1', 'the record holds the rotated token, not the spent one');
  assert.equal(store.clears, 0);
  // And the resumed session is a real one: it authorizes a call.
  const context = await reloaded.rpc('context', { p_agency_id: 'agency-real' });
  assert.equal(context.agency_id, 'agency-real');
});

test('a signed-out session cannot be taken up again, by this device or anybody', async () => {
  // THE SABOTAGE CASE. Three things have to hold at once, and only the first two
  // are about this client: the record is gone, the provider has revoked the grant,
  // and a client handed the old value back cannot use it.
  const state = fixture();
  const store = deviceStore();
  const client1 = resumable(state, store);
  await client1.signIn(PASSWORD);
  const kept = store.value;
  assert.equal(typeof kept, 'string');

  await client1.signOut();
  assert.equal(store.value, null, 'signing out leaves no record on the device');
  assert.equal(live(state), 0, 'and no grant live at the provider');

  // Nothing to resume from, and no request made: an empty device is not an
  // authentication failure.
  const before = state.requests.length;
  assert.equal(await resumable(state, store).resume(), null);
  assert.equal(state.requests.length, before);

  // And the value that WAS kept is refused if somebody kept a copy of it. This is
  // the assertion that fails if `signOut` stops revoking: the record check alone
  // would pass against a provider that still honours the token.
  const stolen = deviceStore(kept);
  await assert.rejects(resumable(state, stolen).resume(), { code: 'AUTHENTICATION_FAILED' });
  assert.equal(stolen.value, null, 'a refused token is removed rather than retried forever');
});

test('closing the realm keeps the device able to resume; only signing out forgets', async () => {
  // The app closes a READY realm by itself — after five minutes, on returning to a
  // hidden tab, on a back-forward restore. If those forgot the device, a reload
  // would ask for a password and this facility would buy nothing.
  const state = fixture();
  const store = deviceStore();
  const client1 = resumable(state, store);
  await client1.signIn(PASSWORD);
  const before = live(state);
  const requests = state.requests.length;
  await client1.signOut({ forget: false });
  // Nothing is revoked, and nothing is even SENT: a local logout would end the
  // session, and this session's refresh token would die with it, so the device
  // record would be dead on arrival. What ends is the use of the access token,
  // which goes with the document.
  assert.equal(state.requests.length, requests);
  assert.equal(live(state), before, 'the session stays live at the provider');
  assert.equal(store.clears, 0);
  assert.equal(typeof store.value, 'string');
  // The access token is unusable through this client even though the session lives.
  await assert.rejects(client1.rpc('context', { p_agency_id: 'agency-real' }),
    { code: 'AUTHENTICATION_REQUIRED' });
  const resumed = await resumable(state, store).resume();
  assert.equal(resumed.email, EMAIL);
});

test('a resume on the SAME client takes up the session it closed rather than destroying it', async () => {
  // A reviewer measured this one: the client resumed, and ended with no live
  // session and a logout sent. `invalidate()` stops the old bearer being USED and
  // deliberately does not empty `knownSessions`, so the bearer from before the
  // close was still named — and revoking it ends the SESSION, which takes the
  // refresh token on the device with it. The exchange then answered 401 and the
  // record was cleared on the way out, so a reload in the same document signed the
  // person out instead of resuming them.
  //
  // The fix drops the names rather than revoking them. Note what makes this
  // testable at all: the fixture retires a session's refresh token with the
  // session, as GoTrue does. A fixture treating each access token as independently
  // live would pass either way.
  const state = fixture();
  const store = deviceStore();
  const client1 = resumable(state, store);
  await client1.signIn(PASSWORD);
  await client1.signOut({ forget: false });
  const logouts = state.requests.filter(({ url }) => url.endsWith('/logout?scope=local')).length;
  const identity = await client1.resume();
  assert.equal(identity.email, EMAIL);
  assert.equal(state.refreshed, 1);
  assert.equal(state.requests.filter(({ url }) => url.endsWith('/logout?scope=local')).length, logouts,
    'nothing was revoked on the way in');
  assert.equal(store.clears, 0);
  // And the client it resumed into works, which is what the person would notice.
  assert.equal((await client1.rpc('context', { p_agency_id: 'agency-real' })).agency_id, 'agency-real');
  // Signing out from here still revokes what it resumed, which is the property the
  // dropped names must not have cost. It is counted as a DIFFERENCE rather than
  // against zero: the pre-close bearer was deliberately left live and this client
  // no longer names it, and in the real provider a rotation stays inside one
  // session, so the fixture's two entries are one session there.
  const before = live(state);
  await client1.signOut();
  assert.equal(live(state), before - 1, 'the resumed session is the one that ends');
  assert.equal(store.value, null);
});

test('a losing resume forgets only the token it spent, so the winner stays signed in', async () => {
  // Two tabs booting over one record. Both read it, one exchanges it and writes the
  // rotated token, the other is refused — and an unconditional clear in the loser
  // deletes a record the provider still honours, so the person is signed in and the
  // next boot asks for a password anyway.
  //
  // The browser store supplies `clearSpent`; this proves the CLIENT asks for it.
  // The two are SEQUENCED rather than raced: the loser's port answers with the
  // value it read BEFORE the winner rotated, which is what a second tab holds. Run
  // concurrently, whether the loser's clean-up lands before or after the winner's
  // write is the fixture's scheduling, and the interleaving the defect lives in is
  // the one that cannot be chosen.
  const state = fixture();
  const store = deviceStore();
  await resumable(state, store).signIn(PASSWORD);
  const spent = store.value;
  const winner = await resumable(state, store).resume();
  assert.equal(winner.email, EMAIL);
  const rotated = store.value;
  assert.notEqual(rotated, spent);

  let spentWith = null;
  const stale = {
    ...store,
    read: () => spent,
    clearSpent: value => {
      spentWith = value;
      if (store.value !== value) return false;
      store.clear();
      return true;
    },
  };
  await assert.rejects(resumable(state, stale).resume(), { code: 'AUTHENTICATION_FAILED' });
  assert.equal(spentWith, spent, 'the loser offered the token IT spent');
  assert.equal(store.clears, 0, 'and the winner`s record survived');
  assert.equal(store.value, rotated);
  assert.equal((await resumable(state, store).resume()).email, EMAIL);
});

test('a refreshed grant about somebody else is refused and forgotten, and its token is not used', async () => {
  // The rule this encodes is `client-lifecycle.test.mjs`'s, which refuses to treat
  // a contradicted grant's token "as a cleanup credential": the client rejects the
  // answer and sends nothing out of it. I had this backwards first and tracked the
  // token by shape so it could be revoked, which made the ONE untrusted string in
  // the exchange into something the client transmits.
  const state = fixture();
  const store = deviceStore();
  const client1 = resumable(state, store);
  await client1.signIn(PASSWORD);
  const after = state.requests.length;
  // A different ADDRESS, which is what the device record pins. An id this client
  // has never seen is learned from the grant exactly as `signIn` learns it, so a
  // test that changed the id instead would be refused one step later, by the
  // `/user` read, and would prove nothing about this.
  state.refreshUser = { ...state.user, email: 'someone.else@agency.example' };
  await assert.rejects(resumable(state, store).resume(), { code: 'AUTHENTICATION_IDENTITY_MISMATCH' });
  assert.deepEqual(state.requests.slice(after).map(({ url }) => url.replace(PROJECT_URL, '')),
    ['/auth/v1/token?grant_type=refresh_token'], 'nothing is sent carrying the refused answer');
  assert.equal(store.value, null, 'and the record that produced it is removed');
});

test('a transport failure keeps the record, because an offline boot is not a sign-out', async () => {
  // Clearing here would sign out every person whose app booted against a service
  // that was briefly unreachable. A token that really did die is refused on the
  // next boot and cleared then.
  const state = fixture();
  const store = deviceStore();
  await resumable(state, store).signIn(PASSWORD);
  const kept = store.value;
  const offline = { ...state, fetch: async () => { throw new TypeError('offline'); } };
  await assert.rejects(resumable(offline, store).resume(), { code: 'AUTHORITY_NETWORK_FAILED' });
  assert.equal(store.value, kept, 'the device still holds what it held');
  assert.equal(store.clears, 0);
});

test('a device record that is not a credential reaches no provider', async () => {
  const state = fixture();
  for (const value of ['', 'short', 'has space', 'a'.repeat(513), 42, {}, []]) {
    const store = deviceStore(value);
    assert.equal(await resumable(state, store).resume(), null, JSON.stringify(value));
    assert.equal(store.value, null, 'and it is removed rather than left to rot');
  }
  assert.equal(state.requests.length, 0);
});
