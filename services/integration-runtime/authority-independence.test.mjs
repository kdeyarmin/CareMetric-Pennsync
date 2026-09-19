import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { AUTHORITY_CONTRACT, AUTHORITY_RPC, independentAuthorize, validAuthorityKey, validAuthorityTarget } from './authority.mjs';
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
const base = {
  SUPABASE_URL: 'https://xsqobvvreaovwibxwyvv.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'synthetic-only',
  INTEGRATIONS_ENCRYPTION_KEY: '1'.repeat(64), INTEGRATIONS_HASH_KEY: '2'.repeat(64),
  INTEGRATIONS_RELEASE: 'enabled-v1', INTEGRATIONS_ALLOWED_OPERATIONS: 'InvokeLLM,SendEmail',
  INTEGRATIONS_BROWSER_RELEASE: 'enabled-v2', INTEGRATIONS_BROWSER_OPERATIONS: 'InvokeLLM,SendEmail',
  ANTHROPIC_API_KEY: 'synthetic-only', SENDGRID_API_KEY: 'synthetic-only',
  NOTIFICATION_FROM_EMAIL: 'synthetic@example.test', RAILWAY_GIT_COMMIT_SHA: revision,
};
const independentEnv = (patch = {}) => ({ ...base, INTEGRATIONS_AUTHORITY_MODE: 'independent',
  INTEGRATIONS_AUTHORITY_URL: TARGET, INTEGRATIONS_AUTHORITY_PUBLISHABLE_KEY: KEY, ...patch });
const independentConfig = (patch = {}) => loadConfig(independentEnv(patch));
const legacyConfig = () => loadConfig(base);

const context = (patch = {}) => ({
  contract: AUTHORITY_CONTRACT, app_id: '694ec16e72e01b60d22f7cbf', auth_user_id: AUTH_USER,
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
  assert.deepEqual(JSON.parse(seen.options.body), { p_app_id: '694ec16e72e01b60d22f7cbf', p_agency_id: 'agency-a' });
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
  app: { app_id: '6a9881683dc68a0bd54f1ef7' },
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
      return Response.json({ message: 'permission denied' }, { status: 401 });
    }
    return Response.json({}, { status: 503 });
  });
  assert.equal(denied.checks.authority.valid, true);
  assert.equal(denied.checks.authority.anonymousDenied, true);
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
