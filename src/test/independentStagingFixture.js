// Model-only transport for component contracts; real Auth acceptance is separate.
import { AUTHORITY_CONTRACT, STAGING_APP_ID } from '../../services/authority-client/client.mjs';
export const stagingEmails = ['admin-a', 'clinician-a', 'clinician-empty', 'admin-b'].map(name => `info+pennsync-${name}@caremetricai.com`);
const legacy = ['6aac58fe36c13a1c49ba7cf8', '6aac58ff8ec706a643a7aa42', '6aac58ffa5f6252bcf92f11f', '6aac5900bf4098977893276d'];
export const stagingEnv = {
  VITE_PENNSYNC_BACKEND: 'independent-staging',
  VITE_PENNSYNC_STAGING_PROJECT_REF: 'local-pennsync-authority',
  VITE_PENNSYNC_STAGING_PROJECT_URL: 'http://127.0.0.1:54321',
  VITE_PENNSYNC_STAGING_PUBLISHABLE_KEY: 'sb_publishable_synthetic_test_key',
  VITE_PENNSYNC_STAGING_ACTORS: JSON.stringify(Object.fromEntries(stagingEmails.map((email, index) => [email, `10000000-0000-4000-8000-00000000000${index + 1}`]))),
};
/** The ported API's origin, added per test rather than by default. */
export const stagingApiUrl = 'http://127.0.0.1:54341';
export function stagingFixture() {
  const requests = [], live = new Map();
  let next = 0;
  const fixture = { requests, live, apiCalls: [], apiResponse: null, holdPatient: null, beforeReturn: null, denyContext: false };
  const response = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  fixture.fetch = async (url, options) => {
    requests.push({ url, method: options.method });
    // The ported API is a second origin and nothing else is. A bearer still
    // has to be a live one, so an unauthenticated call cannot reach a handler
    // here any more than it could reach the store.
    if (url.startsWith(`${stagingApiUrl}/`)) {
      fixture.apiCalls.push({ url, headers: options.headers, body: options.body ? JSON.parse(options.body) : null });
      if (!live.has(options.headers.Authorization?.slice(7))) return response({}, 401);
      // The envelope the service actually sends. A bare handler payload here
      // let the adapter's tests pass while nothing unwrapped it.
      return fixture.apiResponse ? fixture.apiResponse(url)
        : response({ success: true, result: { valid: true }, execution: 'pennsync-api', base44ExecutionDependency: false });
    }
    if (!url.startsWith('http://127.0.0.1:54321/')) throw new Error('FIXTURE_FOREIGN_DESTINATION');
    const input = options.body ? JSON.parse(options.body) : {};
    if (url.endsWith('/token?grant_type=password')) {
      const index = stagingEmails.indexOf(input.email);
      if (index < 0 || input.password !== 'Synthetic-accepted-password') return response({}, 401);
      const bearer = `synthetic.session${++next}.token`; live.set(bearer, index);
      return response({ user: nativeUser(index), access_token: bearer, token_type: 'bearer' });
    }
    const bearer = options.headers.Authorization?.slice(7), index = live.get(bearer);
    if (index === undefined) return response({}, 401);
    if (url.endsWith('/logout?scope=local')) { live.delete(bearer); return new Response(null, { status: 204 }); }
    if (url.endsWith('/user')) return response(nativeUser(index));
    const agency = index === 3 ? 'agency-b' : 'agency-a';
    const common = { contract: AUTHORITY_CONTRACT, app_id: STAGING_APP_ID, auth_user_id: nativeUser(index).id, staging: true, synthetic: true };
    const context = { ...common, user_id: legacy[index], user_email: stagingEmails[index], identity_version: 1,
      is_platform_owner: false, agency_id: agency, membership_id: `membership-${index}`,
      membership_key: `${agency}:${legacy[index]}`, membership_version: 1, membership_status: 'active',
      tenant_role: index === 0 || index === 3 ? 'agency_admin' : 'clinician',
      agency: { id: agency, name: `Synthetic Agency ${index === 3 ? 'B' : 'A'}`, status: 'active' } };
    if (url.endsWith('/pennsync_staging_memberships')) return response({ ...common, user_id: legacy[index], user_email: stagingEmails[index], memberships: [context] });
    if (fixture.denyContext || input.p_agency_id !== agency) return response({}, 403);
    if (url.endsWith('/pennsync_staging_context')) return response(context);
    if (url.endsWith('/pennsync_staging_patients')) {
      const result = response({ ...common, context, items: index === 2 ? [] : [{ id: `patient-${index}`, agency_id: agency,
        display_name: `Synthetic Patient ${index === 3 ? 'B' : 'A'}1`, version: 1, synthetic: true }], next_cursor: null });
      if (fixture.holdPatient) await fixture.holdPatient();
      if (fixture.beforeReturn) fixture.beforeReturn();
      return result;
    }
    throw new Error('FIXTURE_UNSUPPORTED_OPERATION');
  };
  function nativeUser(index) {
    return { id: JSON.parse(stagingEnv.VITE_PENNSYNC_STAGING_ACTORS)[stagingEmails[index]], email: stagingEmails[index],
      role: 'authenticated', is_anonymous: false, email_confirmed_at: '2026-09-18T00:00:00Z' };
  }
  return fixture;
}
