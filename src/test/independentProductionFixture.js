// Model-only transport for the production mode's component contracts. Real Auth
// acceptance is separate, and nothing here reaches a Supabase project.
import { AUTHORITY_CONTRACT } from '../../services/authority-client/client.mjs';

export const productionAppId = 'aaaaaaaaaaaaaaaaaaaaaaaa';
export const productionProjectRef = 'abcdefghijklmnopqrst';
export const productionProjectUrl = `https://${productionProjectRef}.supabase.co`;
export const productionApiUrl = 'https://pennsync-api.example.test';
export const productionEmail = 'nurse@agency.example';
export const productionPassword = 'correct-horse-battery';
/** The legacy principal the app binds to, which is what the store projects. */
export const productionUserId = '6aac58fe36c13a1c49ba7cf8';
const AUTH_USER_ID = '20000000-0000-4000-8000-000000000001';

export const productionEnv = {
  VITE_PENNSYNC_BACKEND: 'independent',
  VITE_PENNSYNC_APP_ID: productionAppId,
  VITE_PENNSYNC_PROJECT_REF: productionProjectRef,
  VITE_PENNSYNC_PROJECT_URL: productionProjectUrl,
  VITE_PENNSYNC_PUBLISHABLE_KEY: 'sb_publishable_production_test_key',
  VITE_PENNSYNC_API_URL: productionApiUrl,
};

/**
 * A device record as the browser store would hold it, injectable into an adapter.
 *
 * `email` answers whose session this is and never the credential; the token
 * reaches the client through the port, which is how the real store is shaped.
 */
export function productionDevice(email = null, token = null) {
  const state = { email, token, clears: 0, writes: [] };
  return {
    state,
    email: () => state.email,
    port: address => ({
      read: () => (state.email === address ? state.token : null),
      write: value => { state.email = address; state.token = value; state.writes.push(value); return true; },
      clear: () => { state.clears += 1; state.email = null; state.token = null; },
      // Forget only what was spent, as the real port does: a loser of a two-tab
      // race must leave the winner's rotated record alone.
      clearSpent: spent => {
        if (state.email !== address || state.token !== spent) return false;
        state.clears += 1; state.email = null; state.token = null; return true;
      },
    }),
  };
}

export function productionFixture() {
  const requests = [], live = new Map(), apiCalls = [];
  let next = 0;
  const fixture = { requests, live, apiCalls, apiResponse: null, denyContext: false, agencies: ['agency-one'],
    // Link tokens this fixture will exchange, and the passwords it was asked to
    // write. Both are the fixture's own strings; nothing real is involved, and
    // the halves that would SEND a link are not in the client at all.
    links: new Set(['invite:invitetoken-aaaaaa', 'recovery:recoverytoken-bbbbbb']), passwords: [],
    password: productionPassword,
    // Refresh tokens this project will honour, each exactly once, as GoTrue
    // rotates them.
    refreshable: new Set(), refreshed: 0 };
  const json = (body, status = 200) => new Response(JSON.stringify(body), {
    status, headers: { 'content-type': 'application/json' },
  });
  const user = {
    id: AUTH_USER_ID, email: productionEmail, role: 'authenticated', is_anonymous: false,
    email_confirmed_at: '2026-10-01T00:00:00Z',
  };
  const common = () => ({
    contract: AUTHORITY_CONTRACT, app_id: productionAppId, auth_user_id: AUTH_USER_ID,
    staging: true, synthetic: true,
  });
  const context = agency => ({
    ...common(), user_id: productionUserId, user_email: productionEmail, identity_version: 2,
    is_platform_owner: false, agency_id: agency, membership_id: `membership-${agency}`,
    membership_key: `${agency}:${productionUserId}`, membership_version: 4, membership_status: 'active',
    tenant_role: agency === 'agency-one' ? 'agency_admin' : 'clinician',
    agency: { id: agency, name: agency === 'agency-one' ? 'Keystone Home Health' : 'Riverbend Hospice', status: 'active' },
  });
  fixture.context = context;
  fixture.fetch = async (url, options) => {
    requests.push({ url, method: options.method });
    if (url.startsWith(`${productionApiUrl}/`)) {
      apiCalls.push({ url, headers: options.headers, body: options.body ? JSON.parse(options.body) : null });
      if (!live.has(options.headers.Authorization?.slice(7))) return json({}, 401);
      return fixture.apiResponse ? fixture.apiResponse(url, options)
        : json({ success: true, result: { ok: true }, execution: 'pennsync-api', base44ExecutionDependency: false });
    }
    if (!url.startsWith(`${productionProjectUrl}/`)) throw new Error('FIXTURE_FOREIGN_DESTINATION');
    const input = options.body ? JSON.parse(options.body) : {};
    if (url.endsWith('/verify')) {
      // No address and no bare token: the redemption happens here, by hash. See
      // `production-client.test.mjs`'s own handler for why that shape is the one.
      if (input.email !== undefined || input.token !== undefined
        || !['invite', 'recovery'].includes(input.type)
        || !fixture.links.delete(`${input.type}:${input.token_hash}`)) return json({}, 401);
      const bearer = `production.link${++next}.token`;
      live.set(bearer, true);
      return json({ user, access_token: bearer, token_type: 'bearer' });
    }
    if (url.endsWith('/token?grant_type=password')) {
      // The CURRENT password, so a grant after a link write has to use what the
      // write set rather than what the fixture started with.
      if (input.email !== productionEmail || input.password !== fixture.password) return json({}, 401);
      const bearer = `production.session${++next}.token`;
      const refresh = `refresh${next}`;
      live.set(bearer, refresh);
      fixture.refreshable.add(refresh);
      return json({ user, access_token: bearer, token_type: 'bearer', refresh_token: refresh });
    }
    if (url.endsWith('/token?grant_type=refresh_token')) {
      fixture.refreshed += 1;
      if (typeof input.refresh_token !== 'string'
        || !fixture.refreshable.delete(input.refresh_token)) return json({}, 401);
      const bearer = `production.resumed${++next}.token`;
      const refresh = `refresh${next}`;
      live.set(bearer, refresh);
      fixture.refreshable.add(refresh);
      return json({ user, access_token: bearer, token_type: 'bearer', refresh_token: refresh });
    }
    const bearer = options.headers.Authorization?.slice(7);
    if (!live.has(bearer)) return json({}, 401);
    if (url.endsWith('/logout?scope=local')) {
      // A local logout ends the session, so its refresh token dies with it.
      fixture.refreshable.delete(live.get(bearer));
      live.delete(bearer);
      return new Response(null, { status: 204 });
    }
    if (url.endsWith('/user') && options.method === 'PUT') {
      if (typeof input.password !== 'string' || input.password.length < 12) return json({}, 422);
      fixture.passwords.push(input.password);
      fixture.password = input.password;
      return json(user);
    }
    if (url.endsWith('/user')) return json(user);
    if (url.endsWith('/pennsync_staging_memberships')) {
      return json({ ...common(), user_id: productionUserId, user_email: productionEmail,
        memberships: fixture.agencies.map(context) });
    }
    if (url.endsWith('/pennsync_staging_context')) {
      if (fixture.denyContext || !fixture.agencies.includes(input.p_agency_id)) return json({}, 403);
      return json(context(input.p_agency_id));
    }
    throw new Error('FIXTURE_UNSUPPORTED_OPERATION');
  };
  return fixture;
}
