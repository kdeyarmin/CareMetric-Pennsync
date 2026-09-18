// Real LOCAL Auth + PostgREST acceptance. Never load bootstrap.sql or fixtures.sql here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import pg from 'pg';
import { createStagingAuthorityClient, STAGING_APP_ID as APP } from '../../authority-client/client.mjs';
import { localStatus, API, PROJECT } from './http-local-stack.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const actors = [
  ['admin-a', '6aac58fe36c13a1c49ba7cf8', 'agency-a', 'agency_admin'],
  ['clinician-a', '6aac58ff8ec706a643a7aa42', 'agency-a', 'clinician'],
  ['clinician-empty', '6aac58ffa5f6252bcf92f11f', 'agency-a', 'clinician'],
  ['admin-b', '6aac5900bf4098977893276d', 'agency-b', 'agency_admin'],
].map(([name, legacyId, agency, role]) => ({ name, legacyId, agency, role,
  email: `info+pennsync-${name}@caremetricai.com`, membership: `membership-${name}` }));
const requireTrue = (value, message) => { if (!value) throw new Error(message); };
const denied = promise => assert.rejects(promise,
  error => error.code === 'AUTHORITY_DENIED' && error.status === 403);
let attemptsOutsideLocal = 0;
let clientRequests = 0;
const nativeFetch = globalThis.fetch;

async function localFetch(url, options = {}) {
  const parsed = new URL(url);
  if (parsed.origin !== API || !/^\/(auth|rest)\/v1\//.test(parsed.pathname)
    || parsed.username || parsed.password) {
    attemptsOutsideLocal++;
    throw new Error('HTTP_DESTINATION_FORBIDDEN');
  }
  return nativeFetch(url, { ...options, redirect: 'error',
    signal: options.signal || AbortSignal.timeout(15000) });
}

test('real local Auth and PostgREST authority acceptance', { timeout: 180000 }, async t => {
  // Never skip this suite when Docker/Auth is absent: the dedicated job must fail.
  const status = await localStatus();
  const db = new pg.Client({ connectionString: status.DB_URL, connectionTimeoutMillis: 10000,
    statement_timeout: 15000 });
  const tokens = new Map(); // Signed test tokens exist only in process memory.
  const clients = new Map();
  let step = 'connect';
  try {
    await db.connect();
    step = 'fresh owned database';
    const fresh = await db.query(`select
      (select count(*)::integer from auth.users) as users,
      (select count(*)::integer from pennsync_private.identity_map) as identities,
      (select count(*)::integer from pennsync_private.agency) as agencies`);
    requireTrue(fresh.rows[0].users === 0 && fresh.rows[0].identities === 0 && fresh.rows[0].agencies === 0,
      'LOCAL_FRESH_DATABASE_REQUIRED');

    step = 'supported local Auth Admin API creates four users';
    for (const actor of actors) {
      actor.password = `LocalOnly!${randomBytes(32).toString('base64url')}`;
      const response = await localFetch(`${API}/auth/v1/admin/users`, { method: 'POST',
        headers: { apikey: status.SECRET_KEY, Authorization: `Bearer ${status.SECRET_KEY}`,
          'Content-Type': 'application/json' },
        body: JSON.stringify({ email: actor.email, password: actor.password, email_confirm: true }) });
      requireTrue(response.ok, `LOCAL_ADMIN_CREATE_HTTP_${response.status}`);
      const user = await response.json();
      requireTrue(UUID.test(user.id) && user.email === actor.email && user.email_confirmed_at
        && user.role === 'authenticated' && user.is_anonymous === false, 'LOCAL_ADMIN_IDENTITY_INVALID');
      actor.uuid = user.id;
    }
    requireTrue(new Set(actors.map(actor => actor.uuid)).size === 4, 'LOCAL_AUTH_UUIDS_NOT_DISTINCT');

    step = 'seed only independent synthetic authority tables';
    await db.query('begin');
    await db.query('select pg_advisory_xact_lock(168344,20260918)');
    for (const [id, name] of [['agency-a', 'Synthetic Agency A'], ['agency-b', 'Synthetic Agency B']]) {
      await db.query(`insert into pennsync_private.agency(app_id,id,name,status) values($1,$2,$3,'active')`, [APP, id, name]);
    }
    for (const actor of actors) {
      // Synthetic fixture provenance, never represented as hosted identity verification.
      const hash = createHash('sha256').update(`LOCAL_SYNTHETIC_AUTH_FIXTURE:${actor.email}:${actor.uuid}`).digest('hex');
      await db.query(`insert into pennsync_private.identity_map
        (app_id,auth_user_id,base44_user_id,expected_email,source_evidence_sha256,verified_at)
        values($1,$2,$3,$4,$5,clock_timestamp())`, [APP, actor.uuid, actor.legacyId, actor.email, hash]);
      await db.query(`insert into pennsync_private.membership
        (app_id,id,agency_id,auth_user_id,base44_user_id,tenant_role,status) values($1,$2,$3,$4,$5,$6,'active')`,
      [APP, actor.membership, actor.agency, actor.uuid, actor.legacyId, actor.role]);
    }
    for (const [id, agency, name] of [['patient-a1', 'agency-a', 'Synthetic Patient A1'],
      ['patient-a2', 'agency-a', 'Synthetic Patient A2'], ['patient-b1', 'agency-b', 'Synthetic Patient B1']]) {
      await db.query(`insert into pennsync_private.patient(app_id,id,agency_id,display_name) values($1,$2,$3,$4)`, [APP, id, agency, name]);
    }
    await db.query(`insert into pennsync_private.assignment
      (app_id,agency_id,patient_id,membership_id,status,changed_by)
      values($1,'agency-a','patient-a1','membership-clinician-a','active',$2)`, [APP, actors[0].uuid]);
    await db.query('commit');
    // Supported cache refresh, not a fake HTTP response or fabricated auth state.
    await db.query("notify pgrst, 'reload schema'");

    for (const actor of actors) {
      const client = createStagingAuthorityClient({ appId: APP, projectRef: PROJECT,
        projectUrl: API, publishableKey: status.PUBLISHABLE_KEY, authUserId: actor.uuid, email: actor.email },
      { fetchImpl: async (url, options) => {
        clientRequests++;
        requireTrue(options.headers.apikey === status.PUBLISHABLE_KEY, 'CLIENT_PRIVILEGED_KEY_FORBIDDEN');
        const response = await localFetch(url, options);
        if (url === `${API}/auth/v1/token?grant_type=password` && response.ok) {
          const session = await response.clone().json();
          tokens.set(actor.name, session.access_token);
        }
        return response;
      } });
      clients.set(actor.name, client);
    }
    const [admin, clinician, empty, other] = actors.map(actor => clients.get(actor.name));
    const raw = async (method, body, bearer, extraHeaders = {}) => {
      const response = await localFetch(`${API}/rest/v1/rpc/pennsync_staging_${method}`, {
        method: 'POST', headers: { apikey: status.PUBLISHABLE_KEY, 'Content-Type': 'application/json',
          ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}), ...extraHeaders },
        body: JSON.stringify({ p_app_id: APP, ...body }) });
      return { status: response.status, ok: response.ok, data: await response.json() };
    };

    await t.test('four supported password sign-ins create actual native sessions', async () => {
      for (const actor of actors) await clients.get(actor.name).signIn(actor.password);
      const sessions = await db.query(`select count(*)::integer as count from auth.sessions where user_id=any($1::uuid[])`, [actors.map(actor => actor.uuid)]);
      assert.equal(sessions.rows[0].count, 4);
      for (const actor of actors) {
        const claims = JSON.parse(Buffer.from(tokens.get(actor.name).split('.')[1], 'base64url').toString());
        requireTrue(claims.sub === actor.uuid && UUID.test(claims.session_id)
          && claims.role === 'authenticated', 'LOCAL_SIGNED_CLAIMS_INVALID');
      }
    });
    await t.test('anonymous and signature-tampered requests fail at the gateway', async () => {
      const anon = await raw('context', { p_agency_id: 'agency-a' });
      assert.equal(anon.status, 401);
      const parts = tokens.get('clinician-a').split('.');
      const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
      parts[1] = Buffer.from(JSON.stringify({ ...claims, sub: actors[0].uuid, role: 'service_role' })).toString('base64url');
      const tampered = await raw('context', { p_agency_id: 'agency-a' }, parts.join('.'));
      assert.equal(tampered.status, 401);
      requireTrue(String(tampered.data.code).startsWith('PGRST'), 'TAMPER_NOT_REJECTED_BY_GATEWAY');
    });
    await t.test('privileged server token has no authority RPC access', async () => {
      requireTrue(typeof status.SERVICE_ROLE_KEY === 'string', 'LOCAL_SERVER_TOKEN_MISSING');
      const result = await raw('context', { p_agency_id: 'agency-a' }, status.SERVICE_ROLE_KEY);
      assert.equal(result.status, 403);
    });
    await t.test('native UUIDs map to exact legacy identities and agency memberships', async () => {
      for (const actor of actors) {
        const memberships = await clients.get(actor.name).rpc('memberships');
        assert.equal(memberships.auth_user_id, actor.uuid);
        assert.equal(memberships.user_id, actor.legacyId);
        assert.equal(memberships.memberships.length, 1);
        const context = await clients.get(actor.name).rpc('context', { p_agency_id: actor.agency });
        assert.equal(context.tenant_role, actor.role);
        assert.equal(context.membership_id, actor.membership);
      }
    });
    await t.test('two agencies, assigned clinician, and empty clinician remain scoped', async () => {
      assert.deepEqual((await admin.rpc('patients', { p_agency_id: 'agency-a' })).items.map(p => p.id), ['patient-a1', 'patient-a2']);
      assert.deepEqual((await clinician.rpc('patients', { p_agency_id: 'agency-a' })).items.map(p => p.id), ['patient-a1']);
      assert.deepEqual((await empty.rpc('patients', { p_agency_id: 'agency-a' })).items, []);
      assert.deepEqual((await other.rpc('patients', { p_agency_id: 'agency-b' })).items.map(p => p.id), ['patient-b1']);
      await denied(admin.rpc('context', { p_agency_id: 'agency-b' }));
      await denied(other.rpc('patients', { p_agency_id: 'agency-a' }));
      await denied(clinician.rpc('patient', { p_agency_id: 'agency-a', p_patient_id: 'patient-a2' }));
      await denied(admin.rpc('patient', { p_agency_id: 'agency-a', p_patient_id: 'patient-b1' }));
      assert.equal((await clinician.rpc('patient', { p_agency_id: 'agency-a', p_patient_id: 'patient-a1' })).patient.id, 'patient-a1');
    });
    await t.test('bounded pagination keeps scope and rejects unknown cursors', async () => {
      const first = await admin.rpc('patients', { p_agency_id: 'agency-a', p_limit: 1 });
      assert.deepEqual(first.items.map(p => p.id), ['patient-a1']);
      assert.equal(first.next_cursor, 'patient-a1');
      const second = await admin.rpc('patients', { p_agency_id: 'agency-a', p_limit: 1, p_after_id: first.next_cursor });
      assert.deepEqual(second.items.map(p => p.id), ['patient-a2']);
      const unknown = await raw('patients', { p_agency_id: 'agency-a', p_limit: 1, p_after_id: 'unknown' }, tokens.get('admin-a'));
      assert.equal(unknown.ok, false);
      assert.equal(unknown.data.code, '22023');
    });
    await t.test('private schema and direct table endpoints are not exposed', async () => {
      for (const table of ['identity_map', 'agency', 'membership', 'patient', 'assignment', 'mutation_receipt']) {
        for (const profile of ['public', 'pennsync_private']) {
          const response = await localFetch(`${API}/rest/v1/${table}?select=*`, { headers: {
            apikey: status.PUBLISHABLE_KEY, Authorization: `Bearer ${tokens.get('admin-a')}`, 'Accept-Profile': profile } });
          assert.equal(response.status, profile === 'public' ? 404 : 406);
          await response.body?.cancel();
        }
      }
    });
    await t.test('user-editable metadata cannot create an administrator or second agency', async () => {
      const response = await localFetch(`${API}/auth/v1/user`, { method: 'PUT', headers: {
        apikey: status.PUBLISHABLE_KEY, Authorization: `Bearer ${tokens.get('clinician-a')}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: { tenant_role: 'agency_admin', agency_id: 'agency-b', is_platform_owner: true } }) });
      assert.equal(response.ok, true); await response.body?.cancel();
      assert.equal((await clinician.rpc('context', { p_agency_id: 'agency-a' })).tenant_role, 'clinician');
      await denied(clinician.rpc('context', { p_agency_id: 'agency-b' }));
    });
    const grant = { p_agency_id: 'agency-a', p_patient_id: 'patient-a2', p_target_membership_id: 'membership-clinician-empty',
      p_action: 'grant', p_expected_actor_version: 1, p_expected_target_version: 1,
      p_expected_assignment_version: 0, p_request_id: randomUUID() };
    await t.test('clinicians cannot grant assignments; administrator grant changes the empty roster', async () => {
      await denied(clinician.rpc('assignment', grant));
      const result = await admin.rpc('assignment', grant);
      assert.equal(result.assignment_status, 'active'); assert.equal(result.assignment_version, 1); assert.equal(result.replayed, false);
      assert.deepEqual((await empty.rpc('patients', { p_agency_id: 'agency-a' })).items.map(p => p.id), ['patient-a2']);
    });
    await t.test('idempotency binds payload and optimistic version conflicts fail', async () => {
      assert.equal((await admin.rpc('assignment', grant)).replayed, true);
      const mismatch = await raw('assignment', { ...grant, p_patient_id: 'patient-a1' }, tokens.get('admin-a'));
      assert.equal(mismatch.ok, false); assert.equal(mismatch.data.code, '23505');
      const stale = await raw('assignment', { ...grant, p_request_id: randomUUID() }, tokens.get('admin-a'));
      assert.equal(stale.ok, false); assert.equal(stale.data.code, '40001');
    });
    await t.test('administrator assignment revoke immediately removes patient access', async () => {
      const result = await admin.rpc('assignment', { ...grant, p_action: 'revoke', p_expected_assignment_version: 1, p_request_id: randomUUID() });
      assert.equal(result.assignment_status, 'revoked'); assert.equal(result.assignment_version, 2);
      assert.deepEqual((await empty.rpc('patients', { p_agency_id: 'agency-a' })).items, []);
      await denied(empty.rpc('patient', { p_agency_id: 'agency-a', p_patient_id: 'patient-a2' }));
    });
    await t.test('membership revoke closes existing signed sessions and assignment replay', async () => {
      await admin.rpc('assignment', { ...grant, p_expected_assignment_version: 2, p_request_id: randomUUID() });
      const revoke = { p_agency_id: 'agency-a', p_target_membership_id: 'membership-clinician-empty',
        p_expected_actor_version: 1, p_expected_target_version: 1, p_request_id: randomUUID() };
      const result = await admin.rpc('revoke_membership', revoke);
      assert.equal(result.membership_status, 'revoked'); assert.equal(result.membership_version, 2);
      assert.equal((await admin.rpc('revoke_membership', revoke)).replayed, true);
      await denied(empty.rpc('context', { p_agency_id: 'agency-a' }));
      await denied(empty.rpc('patients', { p_agency_id: 'agency-a' }));
      assert.deepEqual((await empty.rpc('memberships')).memberships, []);
      const staleGrant = await raw('assignment', grant, tokens.get('admin-a'));
      assert.equal(staleGrant.ok, false); assert.equal(staleGrant.data.code, '40001');
      const rows = await db.query(`select status,version::integer from pennsync_private.assignment where membership_id=$1`, [actors[2].membership]);
      assert.deepEqual(rows.rows, [{ status: 'revoked', version: 4 }]);
    });
    await t.test('actual Auth logout invalidates the still-unexpired signed access token', async () => {
      const oldToken = tokens.get('clinician-a');
      const claims = JSON.parse(Buffer.from(oldToken.split('.')[1], 'base64url').toString());
      requireTrue(claims.exp > Date.now() / 1000 + 30, 'TOKEN_MUST_BE_UNEXPIRED_BEFORE_LOGOUT');
      await clinician.signOut();
      await assert.rejects(clinician.rpc('context', { p_agency_id: 'agency-a' }), error => error.code === 'AUTHENTICATION_REQUIRED');
      const sessions = await db.query('select count(*)::integer as count from auth.sessions where id=$1', [claims.session_id]);
      assert.equal(sessions.rows[0].count, 0);
      const stale = await raw('context', { p_agency_id: 'agency-a' }, oldToken);
      assert.equal(stale.ok, false); assert.equal(stale.data.code, '28000');
      assert.equal(stale.data.message, 'PENNSYNC_SESSION_INACTIVE');
      await clinician.signIn(actors[1].password);
      assert.equal((await clinician.rpc('context', { p_agency_id: 'agency-a' })).tenant_role, 'clinician');
    });
    await t.test('all client HTTP traffic used only the local gateway and publishable key', () => {
      assert.equal(attemptsOutsideLocal, 0);
      requireTrue(clientRequests >= 40, 'EXPECTED_REAL_CLIENT_HTTP_REQUESTS');
    });
  } catch (error) {
    // Do not forward pg detail, Auth payloads, native fetch error causes or credentials.
    if (error?.code === 'ERR_ASSERTION') throw error;
    const code = /^LOCAL_[A-Z_0-9]+$/.test(error.message) ? error.message
      : /^[0-9A-Z]{5}$/.test(error.code || '') ? `SQLSTATE_${error.code}` : 'DETAILS_SUPPRESSED';
    throw new Error(`LOCAL_HTTP_SETUP_FAILED at ${step}: ${code}`);
  } finally {
    for (const client of clients.values()) client.invalidate();
    tokens.clear(); for (const actor of actors) { delete actor.password; }
    await db.end().catch(() => {});
  }
});
