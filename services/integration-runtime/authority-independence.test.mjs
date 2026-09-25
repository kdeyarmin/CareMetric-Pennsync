import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { AUTHORITY_APP_PINS, AUTHORITY_CONTRACT, AUTHORITY_RPC, AUTHORITY_TARGETS,
  authorityKeyAccepted, independentAuthorize, validAuthorityKey, validAuthorityTarget } from './authority.mjs';
import { authorize, hasBase44ExecutionDependency, loadConfig, publicReadiness } from './runtime.mjs';
import { createHandler } from './app.mjs';
import { runPreflight } from './preflight.mjs';
import { BROWSER_CONTRACT } from './caller-binding.mjs';

// Invented identities, invented keys and injected transports only. No network,
// no customer record, no provider credential and no Base44 request exist here.
const revision = 'c'.repeat(40);
const KEY = 'sb_publishable_synthetic-acceptance-key';
const TARGET = 'https://xxtyweswohkvgkprimwa.supabase.co';
const AUTH_USER = '11111111-2222-4333-8444-555555555555';
// Independent mode replays this to the owned store, which admits exactly the app
// its deployment was pinned to, so every independent fixture states it outright
// AND states the one TARGET's store actually carries. This fixture paired the
// PRODUCTION id with the staging store until 2026-09-25 — stated, and wrong,
// which is the combination that reports ready and is refused by every
// authorization call. Every independent test here was modelling a deployment
// that cannot work.
const APP = AUTHORITY_APP_PINS[TARGET];
const OTHER_APP = '694ec16e72e01b60d22f7cbf';
const base = {
  SUPABASE_URL: 'https://xsqobvvreaovwibxwyvv.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'synthetic-only',
  INTEGRATIONS_ENCRYPTION_KEY: '1'.repeat(64), INTEGRATIONS_HASH_KEY: '2'.repeat(64),
  INTEGRATIONS_RELEASE: 'enabled-v1', INTEGRATIONS_ALLOWED_OPERATIONS: 'InvokeLLM,SendEmail',
  INTEGRATIONS_BROWSER_RELEASE: 'enabled-v2', INTEGRATIONS_BROWSER_OPERATIONS: 'InvokeLLM,SendEmail',
  ANTHROPIC_API_KEY: 'synthetic-only', SENDGRID_API_KEY: 'synthetic-only',
  NOTIFICATION_FROM_EMAIL: 'synthetic@example.test', RAILWAY_GIT_COMMIT_SHA: revision,
};
const independentEnv = (patch = {}) => ({ ...base, INTEGRATIONS_AUTHORITY_MODE: 'independent',
  INTEGRATIONS_APP_ID: APP,
  INTEGRATIONS_AUTHORITY_URL: TARGET, INTEGRATIONS_AUTHORITY_PUBLISHABLE_KEY: KEY, ...patch });
const independentConfig = (patch = {}) => loadConfig(independentEnv(patch));
const legacyConfig = () => loadConfig(base);

const context = (patch = {}) => ({
  contract: AUTHORITY_CONTRACT, app_id: APP, auth_user_id: AUTH_USER,
  staging: true, synthetic: true,
  user_id: 'user-a', user_email: 'synthetic@example.test', identity_version: 1,
  is_platform_owner: false, agency_id: 'agency-a', membership_id: 'member-a',
  membership_key: 'agency-a:user-a', membership_version: 1, membership_status: 'active',
  tenant_role: 'agency_admin', agency: { id: 'agency-a', name: 'Synthetic Agency A', status: 'active' },
  ...patch,
});
const request = () => new Request('https://runtime.example.test/v1/integrations', {
  method: 'POST',
  headers: { authorization: 'Bearer synthetic-native-session-token', 'content-type': 'application/json' },
  body: '{}',
});
const serve = (value, init = {}) => async () => Response.json(value, init);

test('only the two reviewed targets and a publishable key are accepted', () => {
  assert.equal(validAuthorityTarget(TARGET), true);
  assert.equal(validAuthorityTarget('http://127.0.0.1:54321'), true);
  for (const bad of ['https://xxtyweswohkvgkprimwa.supabase.co/', 'https://foreign.supabase.co',
    'http://xxtyweswohkvgkprimwa.supabase.co', 'https://base44.app', '', null]) {
    assert.equal(validAuthorityTarget(bad), false);
  }
  assert.equal(validAuthorityKey(KEY), true);
  for (const bad of ['sb_secret_synthetic-acceptance-key', 'eyJhbGciOiJIUzI1NiJ9.synthetic', 'sb_publishable_short', '', null]) {
    assert.equal(validAuthorityKey(bad), false);
  }
});

test('configuration refuses an unknown mode, foreign target, secret key or incomplete independence', () => {
  for (const patch of [{ INTEGRATIONS_AUTHORITY_MODE: 'supabase' }, { INTEGRATIONS_AUTHORITY_URL: 'https://foreign.supabase.co' },
    { INTEGRATIONS_AUTHORITY_PUBLISHABLE_KEY: 'sb_secret_synthetic-acceptance-key' },
    { INTEGRATIONS_AUTHORITY_URL: '' }, { INTEGRATIONS_AUTHORITY_PUBLISHABLE_KEY: '' }]) {
    assert.throws(() => loadConfig(independentEnv(patch)));
  }
  // The retained path stays the default and needs no new configuration.
  const legacy = legacyConfig();
  assert.equal(legacy.authorityMode, 'base44');
  assert.equal(legacy.authorityConfigured, false);
  assert.equal(legacy.configured, true);
});

test('independent mode refuses an app binding the operator did not choose', () => {
  // The store's pin defaults to STAGING; this service's app id defaults to
  // PRODUCTION. Defaulting both is the one combination that reports ready and is
  // refused by every authorization call, so independence must not inherit it.
  const { INTEGRATIONS_APP_ID: _omitted, ...withoutApp } = independentEnv();
  assert.throws(() => loadConfig(withoutApp), /IMPLICIT_APP_BINDING/);
  assert.throws(() => loadConfig(independentEnv({ INTEGRATIONS_APP_ID: '' })), /IMPLICIT_APP_BINDING/);

  // Stating it is NOT all that is asked. The target's store carries one pin and
  // the other reviewed app fails identically to a defaulted one, so it is
  // refused at startup rather than at every call.
  assert.equal(loadConfig(independentEnv({ INTEGRATIONS_APP_ID: APP })).appId, APP);
  assert.notEqual(OTHER_APP, APP);
  assert.throws(() => loadConfig(independentEnv({ INTEGRATIONS_APP_ID: OTHER_APP })), /APP_BINDING_MISMATCH/);

  // A local stack is built from whichever migrations a developer applied, so
  // its pin is declared unconstrained and BOTH reviewed apps are admitted there.
  assert.equal(AUTHORITY_APP_PINS['http://127.0.0.1:54321'], null);
  for (const app of [APP, OTHER_APP]) {
    assert.equal(loadConfig(independentEnv({
      INTEGRATIONS_AUTHORITY_URL: 'http://127.0.0.1:54321', INTEGRATIONS_APP_ID: app })).appId, app);
  }
  // Stating an unknown one still fails on the older, narrower check.
  assert.throws(() => loadConfig(independentEnv({ INTEGRATIONS_APP_ID: '68ee80d98929370f9e8f2932' })), /INVALID_APP_BINDING/);

  // The retained Base44 path is untouched: it never reaches the owned store, so
  // its long-standing default is still correct and must keep working unset.
  assert.equal(legacyConfig().appId, '694ec16e72e01b60d22f7cbf');
});

test('readiness derives the disclosed dependency from the selected authority', () => {
  const legacy = publicReadiness(legacyConfig());
  assert.equal(legacy.base44ExecutionDependency, true);
  assert.equal(legacy.authorityMode, 'base44');
  const independent = publicReadiness(independentConfig());
  assert.equal(independent.base44ExecutionDependency, false);
  assert.equal(independent.authorityMode, 'independent');
  // Independence is never presented as cutover evidence.
  assert.equal(independent.trafficCutoverVerified, false);
  assert.equal(hasBase44ExecutionDependency(independentConfig()), false);
  assert.equal(hasBase44ExecutionDependency(legacyConfig()), true);
});

test('authority is read from the owned store with the caller token and publishable key only', async () => {
  let seen = null;
  const actor = await authorize(independentConfig(), request(), 'agency-a', async (url, options) => {
    seen = { url, options }; return Response.json(context());
  });
  assert.equal(seen.url, `${TARGET}/rest/v1/rpc/${AUTHORITY_RPC}`);
  assert.equal(seen.url.includes('base44'), false);
  assert.deepEqual(JSON.parse(seen.options.body), { p_app_id: APP, p_agency_id: 'agency-a' });
  assert.equal(seen.options.redirect, 'error');
  assert.equal(seen.options.headers.apikey, KEY);
  assert.equal(seen.options.headers.Authorization, 'Bearer synthetic-native-session-token');
  assert.deepEqual(Object.keys(seen.options.headers).sort(), ['Accept', 'Authorization', 'Content-Type', 'apikey']);
  // No service-role or provider credential is ever presented to the store.
  assert.equal(JSON.stringify(seen.options.headers).includes('service_role'), false);
  assert.deepEqual(actor.binding, { user_id: 'user-a', agency_id: 'agency-a', membership_id: 'member-a',
    membership_version: 1, tenant_role: 'agency_admin', is_platform_owner: false });
  assert.equal(actor.canEmail, true);
});

test('a receipt cannot cross between the retained and independent authorities', async () => {
  const independent = await independentAuthorize(independentConfig(), request(), 'agency-a', serve(context()));
  const legacy = await authorize(legacyConfig(), request(), 'agency-a', serve({ tenant_context: {
    user_id: 'user-a', user_email: 'synthetic@example.test', agency_id: 'agency-a',
    agency: { id: 'agency-a', status: 'active' }, membership_id: 'member-a', membership_key: 'agency-a:user-a',
    membership_version: 1, membership_status: 'active', tenant_role: 'agency_admin', is_platform_owner: false,
  } }));
  assert.notEqual(independent.subject, legacy.subject);
  assert.notEqual(independent.snapshot, legacy.snapshot);
});

for (const [name, patch] of Object.entries({
  contract: { contract: 'cm.pennsync.authority.v2' },
  // Derived from APP rather than typed: hard-coding the other id made this
  // patch stop drifting the moment APP changed, which is how it went vacuous.
  app: { app_id: OTHER_APP },
  nativeIdentity: { auth_user_id: 'not-a-uuid' },
  staging: { staging: false },
  synthetic: { synthetic: false },
  claimedOwner: { is_platform_owner: true },
  foreignAgency: { agency_id: 'agency-b' },
  forgedMembershipKey: { membership_key: 'agency-a:someone-else' },
  revokedMembership: { membership_status: 'revoked' },
  zeroMembershipVersion: { membership_version: 0 },
  forgedRole: { tenant_role: 'platform_owner' },
  suspendedAgency: { agency: { id: 'agency-a', name: 'Synthetic Agency A', status: 'suspended' } },
  mismatchedAgencyRecord: { agency: { id: 'agency-b', name: 'Synthetic Agency B', status: 'active' } },
  mixedCaseEmail: { user_email: 'Synthetic@example.test' },
  missingIdentityVersion: { identity_version: null },
})) {
  test(`independent context with drifted ${name} is denied`, async () => {
    await assert.rejects(
      () => independentAuthorize(independentConfig(), request(), 'agency-a', serve(context(patch))),
      error => error.status === 403 && error.code === 'TENANT_AUTHORITY_INVALID',
    );
  });
}

test('an extra or missing context field is denied rather than ignored', async () => {
  const extra = { ...context(), granted: true };
  await assert.rejects(() => independentAuthorize(independentConfig(), request(), 'agency-a', serve(extra)), error => error.status === 403);
  const missing = context(); delete missing.membership_key;
  await assert.rejects(() => independentAuthorize(independentConfig(), request(), 'agency-a', serve(missing)), error => error.status === 403);
});

test('no global or owner scope can be obtained through the owned store', async () => {
  for (const agency of [null, undefined, '', ['agency-a'], {}]) {
    await assert.rejects(
      () => independentAuthorize(independentConfig(), request(), agency, serve(context())),
      error => [400, 403].includes(error.status) && error.code === 'AGENCY_REQUIRED',
    );
  }
});

test('missing or malformed credentials fail before the store is contacted', async () => {
  let calls = 0;
  const fetcher = async () => { calls++; return Response.json(context()); };
  const anonymous = new Request('https://runtime.example.test/v1/integrations', { method: 'POST', body: '{}' });
  await assert.rejects(() => independentAuthorize(independentConfig(), anonymous, 'agency-a', fetcher), error => error.status === 401);
  const malformed = new Request('https://runtime.example.test/v1/integrations', { method: 'POST', headers: { authorization: 'Basic abc' }, body: '{}' });
  await assert.rejects(() => independentAuthorize(independentConfig(), malformed, 'agency-a', fetcher), error => error.status === 401);
  assert.equal(calls, 0);
});

test('store rejection, failure, redirect and transport errors are distinguished without leaking detail', async () => {
  for (const status of [401, 403]) {
    await assert.rejects(
      () => independentAuthorize(independentConfig(), request(), 'agency-a', serve({}, { status })),
      error => error.status === status && error.code === 'AUTHENTICATION_REJECTED',
    );
  }
  for (const status of [400, 409, 500, 503]) {
    await assert.rejects(
      () => independentAuthorize(independentConfig(), request(), 'agency-a', serve({}, { status })),
      error => error.status === 503 && error.code === 'AUTHORITY_UNAVAILABLE',
    );
  }
  await assert.rejects(
    () => independentAuthorize(independentConfig(), request(), 'agency-a', async () => { throw new Error('synthetic secret transport text'); }),
    error => error.status === 503 && error.code === 'AUTHORITY_UNAVAILABLE' && !String(error.message).includes('secret'),
  );
});

test('only administrators and managers keep the email role under independent authority', async () => {
  for (const [role, allowed] of Object.entries({ agency_admin: true, manager: true, clinician: false,
    office_staff: false, social_worker: false, spiritual_care: false })) {
    const actor = await independentAuthorize(independentConfig(), request(), 'agency-a', serve(context({ tenant_role: role })));
    assert.equal(actor.canEmail, allowed);
  }
});

test('a released independent deployment completes work without any Base44 request', async () => {
  const rows = new Map();
  let providerCalls = 0;
  const destinations = [];
  const store = {
    async reserve(body) {
      const key = `${body.p_subject}:${body.p_operation}:${body.p_request_id}`;
      const old = rows.get(key);
      if (old) return { id: old.id, outcome: old.hash === body.p_payload_hash ? old.state : 'conflict', result: old.result };
      const row = { id: randomUUID(), claim: body.p_claim, hash: body.p_payload_hash, state: 'pending', result: null };
      rows.set(key, row); return { id: row.id, outcome: 'owned' };
    },
    async finish(body) {
      const row = [...rows.values()].find(value => value.id === body.p_id);
      if (!row || row.claim !== body.p_claim || row.state !== 'pending') return false;
      row.state = body.p_state; row.result = body.p_result; return true;
    },
  };
  const fetcher = async (url) => { destinations.push(String(url)); return Response.json(context()); };
  const provider = async () => { providerCalls++; return 'invented answer'; };
  const handler = createHandler(independentConfig(), { store, provider, fetcher });
  const body = {
    contract: BROWSER_CONTRACT, revision, agency_id: 'agency-a',
    binding: { user_id: 'user-a', agency_id: 'agency-a', membership_id: 'member-a',
      membership_version: 1, tenant_role: 'agency_admin', is_platform_owner: false },
    request_id: '22222222-2222-4222-8222-222222222222',
    operation: 'InvokeLLM', params: { prompt: 'invented acceptance input' },
  };
  const response = await handler(new Request('https://runtime.example.test/v2/integrations', {
    method: 'POST',
    headers: { authorization: 'Bearer synthetic-native-session-token', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }));
  const value = await response.json();
  assert.equal(response.status, 200);
  assert.equal(value.success, true);
  assert.equal(value.base44ExecutionDependency, false);
  assert.equal(providerCalls, 1);
  assert.ok(destinations.length >= 1);
  assert.equal(destinations.every(url => url.startsWith(`${TARGET}/rest/v1/rpc/`)), true);
  assert.equal(destinations.some(url => url.includes('base44')), false);
});

test('preflight proves the fixed RPC refuses the publishable key alone', async () => {
  const denied = await runPreflight(independentConfig(), async (url, options) => {
    if (String(url).includes(`/rpc/${AUTHORITY_RPC}`)) {
      assert.equal(options.headers.Authorization, undefined);
      // The real cluster's body, not an invented one. The invented
      // `{ message: 'permission denied' }` this fixture used to send is what a
      // REVOKED key gets from the gateway, so the test was asserting the pass
      // on the one response that must fail.
      return Response.json({ code: '42501', details: null, hint: null,
        message: 'permission denied for function pennsync_staging_context' }, { status: 401 });
    }
    return Response.json({}, { status: 503 });
  });
  assert.equal(denied.checks.authority.valid, true);
  assert.equal(denied.checks.authority.anonymousDenied, true);
  assert.equal(denied.checks.authority.keyAccepted, true);
  assert.equal(denied.checks.authority.required, true);
  assert.equal(denied.base44FunctionCalls, 0);
  const accepted = await runPreflight(independentConfig(), async (url) =>
    (String(url).includes(`/rpc/${AUTHORITY_RPC}`) ? Response.json(context()) : Response.json({}, { status: 503 })));
  assert.equal(accepted.checks.authority.valid, false);
  assert.equal(accepted.passed, false);
  const legacy = await runPreflight(legacyConfig(), async () => Response.json({}, { status: 503 }));
  assert.equal(legacy.checks.authority.required, false);
  assert.equal(legacy.checks.authority.notApplicable, true);
});

test('every reviewed target declares the pin its store carries', () => {
  // The two lists must agree in BOTH directions. This assertion is what
  // actually prevents an unpinned target: `loadConfig`'s
  // UNPINNED_AUTHORITY_TARGET is unreachable while it holds, because
  // `validAuthorityTarget` refuses anything outside AUTHORITY_TARGETS first.
  // Kept as the belt to this test's braces, and said plainly rather than left
  // to read like a live guard.
  for (const target of AUTHORITY_TARGETS) assert.equal(Object.hasOwn(AUTHORITY_APP_PINS, target), true);
  assert.deepEqual(Object.keys(AUTHORITY_APP_PINS).sort(), [...AUTHORITY_TARGETS].sort());
  // A declared pin is either one of the two reviewed apps or an explicit null.
  for (const pin of Object.values(AUTHORITY_APP_PINS)) {
    assert.equal(pin === null || ['694ec16e72e01b60d22f7cbf', '6a9881683dc68a0bd54f1ef7'].includes(pin), true);
  }
});

test('a revoked authority key is told apart from a live one by the body, not the status', () => {
  // Both bodies are verbatim from the real cluster on 2026-09-25, both under a
  // 401. The status is identical, which is why the old check passed on the
  // revoked key: the SQLSTATE is the only thing that says the request reached
  // the database at all.
  const liveKeyRefusal = { code: '42501', details: null, hint: null,
    message: 'permission denied for function pennsync_staging_context' };
  const revokedKeyRefusal = { message: 'Invalid API key', hint: 'Double check your API key.' };
  const noKeyAtAll = { message: 'No API key found in request',
    hint: 'No `apikey` request header or url param was found.' };
  assert.equal(authorityKeyAccepted(liveKeyRefusal), true);
  assert.equal(authorityKeyAccepted(revokedKeyRefusal), false);
  assert.equal(authorityKeyAccepted(noKeyAtAll), false);
  // Nothing that is not a SQLSTATE-shaped code counts, including a forged one.
  for (const body of [null, undefined, 'permission denied', [{ code: '42501' }], {},
    { code: 42501 }, { code: '4250' }, { code: '42501 ' }, { code: 'invalid api key' }]) {
    assert.equal(authorityKeyAccepted(body), false);
  }
});

test('preflight fails on a revoked publishable key that is refused like a live one', async () => {
  const refuse = body => async (url) => (String(url).includes(`/rpc/${AUTHORITY_RPC}`)
    ? Response.json(body, { status: 401 })
    : Response.json({}, { status: 503 }));

  const revoked = await runPreflight(independentConfig(),
    refuse({ message: 'Invalid API key', hint: 'Double check your API key.' }));
  assert.equal(revoked.checks.authority.status, 401);
  assert.equal(revoked.checks.authority.anonymousDenied, true, 'the caller was still denied');
  assert.equal(revoked.checks.authority.keyAccepted, false, 'but the key never reached the database');
  assert.equal(revoked.checks.authority.valid, false);
  assert.equal(revoked.passed, false);

  // The same request with a live key: identical status, different verdict.
  const live = await runPreflight(independentConfig(),
    refuse({ code: '42501', details: null, hint: null, message: 'permission denied for function x' }));
  assert.equal(live.checks.authority.status, revoked.checks.authority.status);
  assert.equal(live.checks.authority.valid, true);

  // A body that is not JSON at all must fail closed rather than throw.
  const garbage = await runPreflight(independentConfig(), async (url) =>
    (String(url).includes(`/rpc/${AUTHORITY_RPC}`)
      ? new Response('<html>gateway</html>', { status: 401, headers: { 'content-type': 'text/html' } })
      : Response.json({}, { status: 503 })));
  assert.equal(garbage.checks.authority.keyAccepted, false);
  assert.equal(garbage.checks.authority.valid, false);
});

test('readiness publishes the app binding so a wrong one is visible from outside', () => {
  const independent = publicReadiness(independentConfig());
  assert.equal(independent.appId, APP);
  assert.equal(independent.appStated, true);
  // The retained path defaults and says so, which is correct there: it never
  // reaches the owned store, so the id is a label rather than a key.
  const legacy = publicReadiness(legacyConfig());
  assert.equal(legacy.appId, '694ec16e72e01b60d22f7cbf');
  assert.equal(legacy.appStated, false);
  // Publishing the binding does not make it a readiness input: `ready` stays a
  // set of shape questions, and that is exactly why the pair has to be readable.
  assert.equal(independent.ready, true);
});
