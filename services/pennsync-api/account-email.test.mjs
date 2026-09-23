import test from 'node:test';
import assert from 'node:assert/strict';
import { AUTHORITY_CONTRACT } from './authority.mjs';
import { createHandler } from './app.mjs';
import { HANDLERS, HANDLER_NAMES } from './handlers.mjs';
import { loadConfig } from './runtime.mjs';

/**
 * The two account emails end to end, which for these two is the whole of them.
 *
 * D86 ports the caller gate and the pause and nothing else, so what there is to
 * prove is exactly that: the refusals are the originals' refusals, in the
 * originals' order, and the handler reaches nothing on its way to either. The
 * last part is the one worth having — a port of a capability whose only work is
 * a send is only honest if it cannot send, and `untouchable` is what says so
 * rather than a comment.
 */
const KEY = 'sb_publishable_synthetic-acceptance-key';
const TARGET = 'https://xxtyweswohkvgkprimwa.supabase.co';
const NAMES = ['sendAccountReadyEmail', 'sendWelcomeEmail'];
const env = (patch = {}) => ({
  PENNSYNC_API_RELEASE: 'enabled-v1',
  PENNSYNC_API_APP_ID: '694ec16e72e01b60d22f7cbf',
  PENNSYNC_API_FUNCTIONS: NAMES.join(','),
  PENNSYNC_API_AUTHORITY_URL: TARGET,
  PENNSYNC_API_AUTHORITY_PUBLISHABLE_KEY: KEY,
  RAILWAY_GIT_COMMIT_SHA: 'e'.repeat(40),
  ...patch,
});
const context = (tenantRole = 'agency_admin') => ({
  contract: AUTHORITY_CONTRACT, app_id: '694ec16e72e01b60d22f7cbf',
  auth_user_id: '99999999-8888-4777-8666-555555555555', staging: true, synthetic: true,
  user_id: 'user-a', user_email: 'synthetic@example.test', identity_version: 1,
  is_platform_owner: false, agency_id: 'agency-a', membership_id: 'member-a',
  membership_key: 'agency-a:user-a', membership_version: 1, membership_status: 'active',
  tenant_role: tenantRole, agency: { id: 'agency-a', name: 'Synthetic Agency A', status: 'active' },
});
const post = (name, params) =>
  new Request(`https://api.example.test/v1/functions/${name}`, {
    method: 'POST',
    headers: { authorization: 'Bearer synthetic-native-session-token', 'content-type': 'application/json' },
    body: JSON.stringify({ agency_id: 'agency-a', params }),
  });
const untouchable = (name) => () => () => { throw new Error(`${name} must not be reached`); };
const serve = (tenantRole) => createHandler(loadConfig(env()), {
  fetcher: async () => Response.json(context(tenantRole)),
  integration: untouchable('integration'), records: untouchable('records'),
  contract: untouchable('contract'), audit: untouchable('audit'),
});
const body = {
  sendAccountReadyEmail: { email: 'colleague@example.test', full_name: 'A Colleague' },
  sendWelcomeEmail: {
    email: 'colleague@example.test', full_name: 'A Colleague', temporary_password: 'not-a-real-secret',
  },
};

test('both are registered as JSON handlers that need no integration', () => {
  for (const name of NAMES) {
    assert.ok(HANDLER_NAMES.includes(name), `${name} is registered`);
    assert.notEqual(HANDLERS[name].binary, true);
    // The send is the half that is paused, so a deployment releasing these does
    // not need the integration runtime to report ready. Asserted rather than
    // assumed, because the flag is what `/readyz` reads.
    assert.notEqual(HANDLERS[name].needsIntegration, true, `${name} needs no runtime while paused`);
  }
});

test('an admin is told the channel is off, and nothing was reached on the way', async () => {
  for (const name of NAMES) {
    const response = await serve('agency_admin')(post(name, body[name]));
    assert.equal(response.status, 503, name);
    assert.deepEqual(await response.json(),
      { success: false, error: 'OUTBOUND_DELIVERY_RELEASE_PAUSED', retryable: false }, name);
  }
});

test('a caller who is not an admin is refused first, exactly as the originals refuse them', async () => {
  // Order, not just outcome. Both originals authorize BEFORE consulting the
  // outbound gate, so a paused deployment still answers a non-admin 403 rather
  // than telling them the channel is off — which would say the request would
  // have been accepted once released.
  for (const name of NAMES) {
    for (const role of ['clinician', 'manager', 'office_staff', 'social_worker', 'spiritual_care']) {
      const response = await serve(role)(post(name, body[name]));
      assert.equal(response.status, 403, `${name} as ${role}`);
      assert.equal((await response.json()).error, 'ADMIN_REQUIRED', `${name} as ${role}`);
    }
  }
});

test('an unknown parameter is refused before the caller is even considered', async () => {
  // The service's own discipline rather than the original's: an unknown key is
  // refused, never ignored. It runs first because a body this service cannot
  // account for is not a request it should reason about at all.
  for (const name of NAMES) {
    const response = await serve('agency_admin')(post(name, { ...body[name], cc: 'someone@example.test' }));
    assert.equal(response.status, 400, name);
    assert.equal((await response.json()).error, 'INVALID_PARAMS', name);
  }
  // And the two do not share a parameter list: the welcome message carries a
  // temporary password and the account-ready notice must not be handed one.
  const leaked = await serve('agency_admin')(post('sendAccountReadyEmail', body.sendWelcomeEmail));
  assert.equal(leaked.status, 400);
  assert.equal((await leaked.json()).error, 'INVALID_PARAMS');
});
