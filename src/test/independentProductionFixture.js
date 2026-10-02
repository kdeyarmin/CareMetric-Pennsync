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

export function productionFixture() {
  const requests = [], live = new Map(), apiCalls = [];
  let next = 0;
  const fixture = { requests, live, apiCalls, apiResponse: null, denyContext: false, agencies: ['agency-one'] };
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
    if (url.endsWith('/token?grant_type=password')) {
      if (input.email !== productionEmail || input.password !== productionPassword) return json({}, 401);
      const bearer = `production.session${++next}.token`;
      live.set(bearer, true);
      return json({ user, access_token: bearer, token_type: 'bearer' });
    }
    const bearer = options.headers.Authorization?.slice(7);
    if (!live.has(bearer)) return json({}, 401);
    if (url.endsWith('/logout?scope=local')) { live.delete(bearer); return new Response(null, { status: 204 }); }
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
