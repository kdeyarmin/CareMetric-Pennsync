// Called only after the owned real Auth suite has provisioned its four actors.
// Delays genuine local responses; never fabricates JWTs, users or auth rows.
import { createStagingAuthorityClient, STAGING_APP_ID as APP } from '../../authority-client/client.mjs';
import { API, PROJECT } from './http-local-stack.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const check = (condition, code) => { if (!condition) throw new Error(`LOCAL_LOGIN_${code}`); };
const resultCode = promise => promise.then(() => 'UNEXPECTED_SUCCESS', error => error?.code);
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
async function bounded(promise) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('LOCAL_LOGIN_GATE_TIMEOUT')), 15000);
    })]);
  } finally { clearTimeout(timer); }
}

export async function verifyLoginLifecycle({ db, status, actor, localFetch, raw, originalClient }) {
  let phase = 'preflight';
  const nativeIds = async () => (await db.query('select id::text from auth.sessions order by id')).rows.map(row => row.id);
  const baseline = await nativeIds();
  const idFrom = bearer => {
    const claims = JSON.parse(Buffer.from(bearer.split('.')[1], 'base64url').toString());
    check(claims.sub === actor.uuid && UUID.test(claims.session_id) && claims.role === 'authenticated'
      && claims.exp > Date.now() / 1000 + 30, 'SIGNED_SESSION_INVALID');
    return claims.session_id;
  };
  const count = async bearer => (await db.query(
    'select count(*)::integer as count from auth.sessions where id=$1 and user_id=$2',
    [idFrom(bearer), actor.uuid])).rows[0].count;
  const proveGone = async bearer => {
    check(await count(bearer) === 0, 'OLD_NATIVE_SESSION_SURVIVED');
    const old = await raw('context', { p_agency_id: actor.agency }, bearer);
    check(old.status === 403 && old.data.code === '28000'
      && old.data.message === 'PENNSYNC_SESSION_INACTIVE', 'OLD_SIGNED_TOKEN_AUTHORIZED');
  };
  const contextWorks = async client => {
    const context = await client.rpc('context', { p_agency_id: actor.agency });
    check(context.auth_user_id === actor.uuid && context.user_id === actor.legacyId
      && context.agency_id === actor.agency && context.membership_id === actor.membership,
    'CURRENT_CONTEXT_INVALID');
  };
  try {
    check(actor.name === 'admin-b' && baseline.length === 4, 'OWNED_FIXTURE_REQUIRED');
    await contextWorks(originalClient);
    for (const mode of ['cancel-verification', 'replace-verification', 'late-grant']) {
      phase = mode;
      const entered = deferred(), release = deferred(), oldCleanup = deferred();
      const observed = [];
      const attempts = [];
      let held = false;
      const client = createStagingAuthorityClient({ appId: APP, projectRef: PROJECT, projectUrl: API,
        publishableKey: status.PUBLISHABLE_KEY, authUserId: actor.uuid, email: actor.email }, {
        timeoutMs: 5000,
        fetchImpl: async (url, options) => {
          check(options.headers.apikey === status.PUBLISHABLE_KEY, 'CLIENT_KEY_INVALID');
          check(options.credentials === 'omit' && options.redirect === 'error', 'CLIENT_TRANSPORT_INVALID');
          // Deliberately allow the genuine response to arrive despite a client
          // abort. This models the response/cancellation race, not fake Auth.
          const response = await localFetch(url, { ...options, signal: AbortSignal.timeout(10000) });
          if (url === `${API}/auth/v1/logout?scope=local` && response.ok
            && options.headers.Authorization === `Bearer ${observed[0]}`) oldCleanup.resolve();
          const isGrant = url === `${API}/auth/v1/token?grant_type=password`;
          const isUser = url === `${API}/auth/v1/user`;
          if (isGrant && response.ok) {
            const grant = await response.clone().json();
            check(grant.user.id === actor.uuid && grant.user.email === actor.email
              && grant.token_type === 'bearer' && typeof grant.access_token === 'string', 'REAL_GRANT_INVALID');
            idFrom(grant.access_token);
            observed.push(grant.access_token);
          }
          const shouldHold = !held && (mode === 'late-grant' ? isGrant : isUser);
          if (shouldHold) {
            held = true;
            check(response.ok && observed.length === 1, 'RESPONSE_NOT_SUCCESSFUL');
            if (isUser) {
              const user = await response.clone().json();
              check(user.id === actor.uuid && user.email === actor.email, 'REAL_USER_INVALID');
            }
            entered.resolve();
            await bounded(release.promise);
          }
          return response;
        },
      });
      try {
        const first = resultCode(client.signIn(actor.password)); attempts.push(first);
        await bounded(entered.promise);
        check(observed.length === 1 && await count(observed[0]) === 1, 'PENDING_NATIVE_SESSION_MISSING');
        if (mode === 'cancel-verification' || mode === 'late-grant') {
          await client.signOut();
          check(await resultCode(client.rpc('context', { p_agency_id: actor.agency })) === 'AUTHENTICATION_REQUIRED',
            'LOCAL_ACCESS_NOT_CLEARED');
        }
        if (mode !== 'cancel-verification') {
          await client.signIn(actor.password);
          check(observed.length === 2 && await count(observed[1]) === 1, 'REPLACEMENT_SESSION_MISSING');
          await contextWorks(client);
        }
        release.resolve();
        check(await bounded(first) === 'STALE_AUTHORITY_SESSION', 'STALE_LOGIN_NOT_REJECTED');
        // The canceled public login may have settled before its late grant
        // arrived. Wait for the actual exact-token logout response, not a delay.
        await bounded(oldCleanup.promise);
        await proveGone(observed[0]);
        if (mode !== 'cancel-verification') {
          check(await count(observed[1]) === 1, 'REPLACEMENT_SESSION_REVOKED');
          await contextWorks(client);
          const current = await raw('context', { p_agency_id: actor.agency }, observed[1]);
          check(current.status === 200 && current.data.auth_user_id === actor.uuid, 'REPLACEMENT_TOKEN_REJECTED');
        }
        await contextWorks(originalClient);
        const ids = await nativeIds();
        check(ids.length === baseline.length + (mode === 'cancel-verification' ? 0 : 1)
          && baseline.every(id => ids.includes(id)), 'UNRELATED_NATIVE_SESSIONS_CHANGED');
      } finally {
        release.resolve();
        await bounded(Promise.allSettled(attempts));
        await client.signOut();
        // Failure cleanup is limited to native sessions whose genuine grants
        // this case received. Never guess IDs, use admin logout, or write Auth.
        for (const bearer of observed) if (await count(bearer) === 1) {
          const response = await localFetch(`${API}/auth/v1/logout?scope=local`, { method: 'POST',
            headers: { apikey: status.PUBLISHABLE_KEY, Authorization: `Bearer ${bearer}` } });
          check(response.ok, 'FAILURE_CLEANUP_FAILED');
          await response.body?.cancel();
        }
      }
      check(JSON.stringify(await nativeIds()) === JSON.stringify(baseline), 'NATIVE_BASELINE_NOT_RESTORED');
      await contextWorks(originalClient);
    }
  } catch {
    // Phase names are fixed literals. Never forward assertions, Auth payloads,
    // SQL errors, tokens, credentials or response bodies into the test reporter.
    throw new Error(`LOCAL_LOGIN_LIFECYCLE_FAILED_${phase.replaceAll('-', '_').toUpperCase()}`);
  }
}
