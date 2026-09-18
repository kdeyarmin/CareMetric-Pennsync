// Real LOCAL Auth + PostgREST acceptance. Never load bootstrap.sql or fixtures.sql here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import pg from 'pg';
import { createStagingAuthorityClient, STAGING_APP_ID as APP } from '../../authority-client/client.mjs';
import { localStatus, API, PROJECT } from './http-local-stack.mjs';
import { s4Fields, s4Tables } from './s4-fixture.mjs';
import { s3Fields, s3Tables } from './s3-fixture.mjs';
import { verifyLoginLifecycle } from './http-login-lifecycle.mjs';

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

async function localMailCount() {
  // Read only the fixed local sink's aggregate count, never email contents.
  const response = await nativeFetch('http://127.0.0.1:54324/api/v1/info', {
    redirect: 'error', signal: AbortSignal.timeout(15000) });
  requireTrue(response.ok, 'LOCAL_MAIL_SINK_UNAVAILABLE');
  const info = await response.json();
  requireTrue(Number.isSafeInteger(info.Messages) && info.Messages >= 0, 'LOCAL_MAIL_COUNT_INVALID');
  return info.Messages;
}

test('real local Auth and PostgREST authority acceptance', { timeout: 180000 }, async t => {
  // Never skip this suite when Docker/Auth is absent: the dedicated job must fail.
  const status = await localStatus();
  const db = new pg.Client({ connectionString: status.DB_URL, connectionTimeoutMillis: 10000,
    statement_timeout: 15000 });
  const tokens = new Map(); // Signed test tokens exist only in process memory.
  const clients = new Map();
  let step = 'connect';
  const scenario = async (name, run) => {
    step = name;
    let completed = false;
    await t.test(name, async () => { await run(); completed = true; });
    // node:test reports subtest failures without rejecting t.test(). Stop this
    // dependent sequence explicitly; never manufacture downstream token errors.
    if (!completed) throw new Error('LOCAL_HTTP_SCENARIO_PREREQUISITE_FAILED');
  };
  try {
    await db.connect();
    step = 'fresh owned database';
    const fresh = await db.query(`select
      (select count(*)::integer from auth.users) as users,
      (select count(*)::integer from pennsync_private.identity_map) as identities,
      (select count(*)::integer from pennsync_private.agency) as agencies`);
    requireTrue(fresh.rows[0].users === 0 && fresh.rows[0].identities === 0 && fresh.rows[0].agencies === 0,
      'LOCAL_FRESH_DATABASE_REQUIRED');

    step = 'verified migration function owners';
    const owners = await db.query(`select count(*)::integer as functions,
      bool_and(r.rolsuper or r.rolbypassrls) as trusted_owners
      from pg_catalog.pg_proc p
      join pg_catalog.pg_namespace n on n.oid=p.pronamespace
      join pg_catalog.pg_roles r on r.oid=p.proowner
      where n.nspname='pennsync_private' and p.prosecdef`);
    requireTrue(owners.rows[0].functions > 0 && owners.rows[0].trusted_owners === true,
      'LOCAL_AUTHORITY_DEFINER_OWNER_INVALID');

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
    const s4Requests = new Map();
    const s3Requests = new Map();
    const s3Snapshot = () => db.query(`select ${s3Tables.map(name=>`(select count(*)::integer from pennsync_private.${name}) ${name}`).join(',')}`);
    const s4Snapshot = () => db.query(`select ${s4Tables.map(name=>`(select count(*)::integer from pennsync_private.${name}) ${name}`).join(',')}`);
    const s4Save = async (actor, patient) => {
      const body = { p_agency_id: actor.agency, p_patient_id: patient, p_expected_actor_version: 1,
        p_expected_patient_version: 1, p_request_id: randomUUID(), p_fields: s4Fields() };
      const result = await raw('s4_create', body, tokens.get(actor.name));
      assert.equal(result.status, 200);
      assert.equal(result.data.contract, 'cm.pennsync.s4-create.staging.v1');
      assert.equal(result.data.context.auth_user_id, actor.uuid);
      assert.equal(result.data.context.user_id, actor.legacyId);
      assert.equal(result.data.replayed, false);
      const readBody = { ...body }; delete readBody.p_fields;
      const expected = { ...result.data, replayed: true };
      assert.deepEqual((await raw('s4_create', body, tokens.get(actor.name))).data, expected);
      assert.deepEqual((await raw('s4_read', readBody, tokens.get(actor.name))).data, expected);
      const artifacts = result.data.artifacts;
      assert.equal(Object.keys(artifacts).length, 4);
      for (const record of Object.values(artifacts)) {
        assert.equal(record.agency_id, actor.agency); assert.equal(record.patient_id, patient);
        requireTrue(UUID.test(record.id), 'LOCAL_S4_ARTIFACT_ID_INVALID');
      }
      assert.equal(artifacts.visit.nurse_notes, body.p_fields.nurse_notes);
      assert.deepEqual(artifacts.visit.vital_signs, { heart_rate: 72 });
      assert.equal(artifacts.note_history.note, body.p_fields.nurse_notes);
      assert.equal(artifacts.note_conversion.enhanced_len, body.p_fields.nurse_notes.length);
      assert.equal(artifacts.compliance_audit.status, 'passed');
      assert.deepEqual(artifacts.compliance_audit.rule_versions, []);
      s4Requests.set(actor.name, { body, readBody, expected });
    };
    const s4Denied = async (actor, code, bearer=tokens.get(actor.name)) => {
      const { body, readBody } = s4Requests.get(actor.name);
      for (const [method, input] of [['s4_create', body], ['s4_create', { ...body, p_request_id: randomUUID() }], ['s4_read', readBody]]) {
        const result = await raw(method, input, bearer);
        assert.equal(result.status, 403); assert.equal(result.data.code, code);
      }
    };

    await scenario('public signup stays disabled and creates no account or email', async () => {
      assert.equal(await localMailCount(), 0);
      const response = await localFetch(`${API}/auth/v1/signup`, { method: 'POST', headers: {
        apikey: status.PUBLISHABLE_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'blocked-signup@example.invalid', password: `LocalOnly!${randomBytes(32).toString('base64url')}` }) });
      assert.equal(response.status, 422);
      const body = await response.json();
      requireTrue(body.error_code === 'signup_disabled', 'PUBLIC_SIGNUP_NOT_DISABLED');
      const users = await db.query('select count(*)::integer as count from auth.users');
      assert.equal(users.rows[0].count, 4);
      assert.equal(await localMailCount(), 0);
    });
    await scenario('four supported password sign-ins create actual native sessions', async () => {
      for (const actor of actors) await clients.get(actor.name).signIn(actor.password);
      const sessions = await db.query(`select count(*)::integer as count from auth.sessions where user_id=any($1::uuid[])`, [actors.map(actor => actor.uuid)]);
      assert.equal(sessions.rows[0].count, 4);
      for (const actor of actors) {
        const claims = JSON.parse(Buffer.from(tokens.get(actor.name).split('.')[1], 'base64url').toString());
        requireTrue(claims.sub === actor.uuid && UUID.test(claims.session_id)
          && claims.role === 'authenticated', 'LOCAL_SIGNED_CLAIMS_INVALID');
      }
    });
    await scenario('anonymous and signature-tampered requests fail at the gateway', async () => {
      const anon = await raw('context', { p_agency_id: 'agency-a' });
      assert.equal(anon.status, 401);
      const parts = tokens.get('clinician-a').split('.');
      const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
      parts[1] = Buffer.from(JSON.stringify({ ...claims, sub: actors[0].uuid, role: 'service_role' })).toString('base64url');
      const tampered = await raw('context', { p_agency_id: 'agency-a' }, parts.join('.'));
      assert.equal(tampered.status, 401);
      requireTrue(String(tampered.data.code).startsWith('PGRST'), 'TAMPER_NOT_REJECTED_BY_GATEWAY');
    });
    await scenario('privileged server token has no authority RPC access', async () => {
      requireTrue(typeof status.SERVICE_ROLE_KEY === 'string', 'LOCAL_SERVER_TOKEN_MISSING');
      const result = await raw('context', { p_agency_id: 'agency-a' }, status.SERVICE_ROLE_KEY);
      assert.equal(result.status, 403);
    });
    await scenario('native UUIDs map to exact legacy identities and agency memberships', async () => {
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
    await scenario('two agencies, assigned clinician, and empty clinician remain scoped', async () => {
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
    await scenario('bounded pagination keeps scope and rejects unknown cursors', async () => {
      const first = await admin.rpc('patients', { p_agency_id: 'agency-a', p_limit: 1 });
      assert.deepEqual(first.items.map(p => p.id), ['patient-a1']);
      assert.equal(first.next_cursor, 'patient-a1');
      const second = await admin.rpc('patients', { p_agency_id: 'agency-a', p_limit: 1, p_after_id: first.next_cursor });
      assert.deepEqual(second.items.map(p => p.id), ['patient-a2']);
      const unknown = await raw('patients', { p_agency_id: 'agency-a', p_limit: 1, p_after_id: 'unknown' }, tokens.get('admin-a'));
      assert.equal(unknown.ok, false);
      assert.equal(unknown.data.code, '22023');
    });
    await scenario('private schema and direct table endpoints are not exposed', async () => {
      for (const table of ['identity_map', 'agency', 'membership', 'patient', 'assignment', 'mutation_receipt', ...s4Tables, ...s3Tables]) {
        for (const profile of ['public', 'pennsync_private']) {
          const response = await localFetch(`${API}/rest/v1/${table}?select=*`, { headers: {
            apikey: status.PUBLISHABLE_KEY, Authorization: `Bearer ${tokens.get('admin-a')}`, 'Accept-Profile': profile } });
          assert.equal(response.status, profile === 'public' ? 404 : 406);
          await response.body?.cancel();
        }
      }
    });
    await scenario('user-editable metadata cannot create an administrator or second agency', async () => {
      const response = await localFetch(`${API}/auth/v1/user`, { method: 'PUT', headers: {
        apikey: status.PUBLISHABLE_KEY, Authorization: `Bearer ${tokens.get('clinician-a')}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: { tenant_role: 'agency_admin', agency_id: 'agency-b', is_platform_owner: true } }) });
      assert.equal(response.ok, true); await response.body?.cancel();
      assert.equal((await clinician.rpc('context', { p_agency_id: 'agency-a' })).tenant_role, 'clinician');
      await denied(clinician.rpc('context', { p_agency_id: 'agency-b' }));
    });
    await scenario('synthetic S4-create subset atomically saves and reconciles exact artifacts through real Auth HTTP', async () => {
      await s4Save(actors[0], 'patient-a1'); await s4Save(actors[1], 'patient-a1'); await s4Save(actors[3], 'patient-b1');
      assert.deepEqual(Object.values((await s4Snapshot()).rows[0]), [3,3,3,3,3]);
      const { body } = s4Requests.get('clinician-a');
      const conflict = await raw('s4_create', { ...body, p_fields: s4Fields({ nurse_notes: 'Changed synthetic note' }) }, tokens.get('clinician-a'));
      assert.equal(conflict.status, 409); assert.equal(conflict.data.code, 'PT409');
      assert.equal(conflict.data.message, 'PENNSYNC_S4_IDEMPOTENCY_CONFLICT');
      const unsupported = await raw('s4_create', { ...body, p_request_id: randomUUID(), p_fields: s4Fields({ chart_findings: [{ severity: 'critical' }] }) }, tokens.get('clinician-a'));
      assert.equal(unsupported.status, 400); assert.equal(unsupported.data.code, '22023');
      for (const [actor, patient] of [[actors[0],'patient-b1'],[actors[1],'patient-a2'],[actors[1],'patient-b1'],[actors[2],'patient-a1'],[actors[2],'patient-a2'],[actors[2],'patient-b1'],[actors[3],'patient-a1']]) {
        for (const requestId of [body.p_request_id, randomUUID()]) {
          const input = { ...body, p_agency_id: actor.agency, p_patient_id: patient, p_request_id: requestId };
          const deniedSave = await raw('s4_create', input, tokens.get(actor.name));
          assert.equal(deniedSave.status, 403); assert.equal(deniedSave.data.code, '42501');
          delete input.p_fields;
          const deniedRead = await raw('s4_read', input, tokens.get(actor.name));
          assert.equal(deniedRead.status, 403); assert.equal(deniedRead.data.code, '42501');
        }
      }
      assert.deepEqual(Object.values((await s4Snapshot()).rows[0]), [3,3,3,3,3]);
    });
    await scenario('synthetic S3 manual referrals create and confirm exact existing-patient state through real Auth HTTP', async () => {
      for (const actor of [actors[0],actors[3]]) {
        const scope = { p_agency_id: actor.agency, p_patient_id: actor.name==='admin-a'?'patient-a1':'patient-b1',
          p_expected_actor_version: 1, p_expected_patient_version: 1 };
        const createBody = { ...scope, p_request_id: randomUUID(), p_fields: s3Fields() };
        const created = await raw('s3_create',createBody,tokens.get(actor.name));
        assert.equal(created.status,200); assert.equal(created.data.contract,'cm.pennsync.s3-referral.staging.v1');
        assert.equal(created.data.context.auth_user_id,actor.uuid); assert.equal(created.data.referral.version,1);
        assert.equal(created.data.referral.created_by_user_id,actor.legacyId);
        assert.equal(created.data.referral.patient_id,scope.p_patient_id);
        assert.equal(created.data.referral.agency_id,scope.p_agency_id);
        assert.deepEqual((await raw('s3_create',createBody,tokens.get(actor.name))).data,{...created.data,replayed:true});
        const readBody = { ...scope, p_referral_id: created.data.referral.id };
        assert.deepEqual((await raw('s3_read',readBody,tokens.get(actor.name))).data.referral,created.data.referral);
        const confirmBody = { ...readBody,p_expected_referral_version:1,p_request_id:randomUUID() };
        const confirmed = await raw('s3_confirm',confirmBody,tokens.get(actor.name));
        assert.equal(confirmed.status,200); assert.equal(confirmed.data.referral.version,2);
        const before = { ...created.data.referral }, after = { ...confirmed.data.referral };
        delete before.updated_date; delete after.updated_date;
        assert.deepEqual(after,{...before,version:2,status:'ready_for_admission',requires_manual_review:false,manually_confirmed:true});
        const expected={...confirmed.data,replayed:true};
        assert.deepEqual((await raw('s3_confirm',confirmBody,tokens.get(actor.name))).data,expected);
        assert.deepEqual((await raw('s3_read',readBody,tokens.get(actor.name))).data.referral,confirmed.data.referral);
        const staleCreate=await raw('s3_create',createBody,tokens.get(actor.name));
        assert.equal(staleCreate.status,409); assert.equal(staleCreate.data.code,'PT409');
        assert.equal(staleCreate.data.message,'PENNSYNC_S3_REPLAY_STATE_CHANGED');
        const duplicateConfirm=await raw('s3_confirm',{...confirmBody,p_request_id:randomUUID()},tokens.get(actor.name));
        assert.equal(duplicateConfirm.status,409); assert.equal(duplicateConfirm.data.code,'PT409');
        s3Requests.set(actor.name,{createBody,confirmBody,readBody,expected});
      }
      const {createBody,confirmBody,readBody}=s3Requests.get('admin-a');
      for (const [actor,patient] of [[actors[1],'patient-a1'],[actors[2],'patient-a1'],[actors[0],'patient-b1'],[actors[3],'patient-a1']]) {
        for (const [method,input] of [['s3_create',createBody],['s3_confirm',confirmBody],['s3_read',readBody]]) {
          const result=await raw(method,{...input,p_agency_id:actor.agency,p_patient_id:patient},tokens.get(actor.name));
          assert.equal(result.status,403); assert.equal(result.data.code,'42501');
        }
      }
      const unsupported=await raw('s3_create',{...createBody,p_request_id:randomUUID(),p_fields:s3Fields({extracted_data:{}})},tokens.get('admin-a'));
      assert.equal(unsupported.status,400); assert.equal(unsupported.data.code,'22023');
      assert.deepEqual(Object.values((await s3Snapshot()).rows[0]),[2,4]);
      const oldToken=tokens.get('admin-a');
      const claims=JSON.parse(Buffer.from(oldToken.split('.')[1],'base64url').toString());
      requireTrue(claims.exp>Date.now()/1000+30,'TOKEN_MUST_BE_UNEXPIRED_BEFORE_LOGOUT');
      await admin.signOut();
      assert.equal((await db.query('select count(*)::integer as count from auth.sessions where id=$1',[claims.session_id])).rows[0].count,0);
      for (const [method,input] of [['s3_create',createBody],['s3_create',{...createBody,p_request_id:randomUUID()}],['s3_confirm',confirmBody],['s3_read',readBody]]) {
        const result=await raw(method,input,oldToken); assert.equal(result.status,403); assert.equal(result.data.code,'28000');
      }
      await admin.signIn(actors[0].password);
      assert.deepEqual((await raw('s3_confirm',confirmBody,tokens.get('admin-a'))).data,s3Requests.get('admin-a').expected);
    });
    const grant = { p_agency_id: 'agency-a', p_patient_id: 'patient-a2', p_target_membership_id: 'membership-clinician-empty',
      p_action: 'grant', p_expected_actor_version: 1, p_expected_target_version: 1,
      p_expected_assignment_version: 0, p_request_id: randomUUID() };
    await scenario('clinicians cannot grant assignments; administrator grant changes the empty roster', async () => {
      await denied(clinician.rpc('assignment', grant));
      const result = await admin.rpc('assignment', grant);
      assert.equal(result.assignment_status, 'active'); assert.equal(result.assignment_version, 1); assert.equal(result.replayed, false);
      assert.deepEqual((await empty.rpc('patients', { p_agency_id: 'agency-a' })).items.map(p => p.id), ['patient-a2']);
      await s4Save(actors[2], 'patient-a2');
    });
    await scenario('idempotency binds payload and optimistic version conflicts fail', async () => {
      const snapshot = () => db.query(`select
        (select count(*)::integer from pennsync_private.mutation_receipt) as receipts,
        (select count(*)::integer from pennsync_private.assignment where membership_id='membership-clinician-empty') as assignments,
        (select version::integer from pennsync_private.assignment where membership_id='membership-clinician-empty' and patient_id='patient-a2') as version`);
      assert.deepEqual((await snapshot()).rows, [{ receipts: 1, assignments: 1, version: 1 }]);
      assert.equal((await admin.rpc('assignment', grant)).replayed, true);
      const mismatch = await raw('assignment', { ...grant, p_patient_id: 'patient-a1' }, tokens.get('admin-a'));
      assert.equal(mismatch.status, 409); assert.equal(mismatch.data.code, '23505');
      const started = performance.now();
      const stale = await raw('assignment', { ...grant, p_request_id: randomUUID() }, tokens.get('admin-a'));
      assert.equal(stale.status, 409); assert.equal(stale.data.code, 'PT409');
      assert.equal(stale.data.message, 'PENNSYNC_ASSIGNMENT_VERSION_CHANGED');
      requireTrue(performance.now() - started < 5000, 'BUSINESS_CONFLICT_MUST_RETURN_WITHOUT_RETRY');
      assert.deepEqual((await snapshot()).rows, [{ receipts: 1, assignments: 1, version: 1 }]);
    });
    await scenario('administrator assignment revoke immediately removes patient access', async () => {
      const result = await admin.rpc('assignment', { ...grant, p_action: 'revoke', p_expected_assignment_version: 1, p_request_id: randomUUID() });
      assert.equal(result.assignment_status, 'revoked'); assert.equal(result.assignment_version, 2);
      assert.deepEqual((await empty.rpc('patients', { p_agency_id: 'agency-a' })).items, []);
      await denied(empty.rpc('patient', { p_agency_id: 'agency-a', p_patient_id: 'patient-a2' }));
      await s4Denied(actors[2], '42501');
    });
    await scenario('membership revoke closes existing signed sessions and assignment replay', async () => {
      await admin.rpc('assignment', { ...grant, p_expected_assignment_version: 2, p_request_id: randomUUID() });
      const revoke = { p_agency_id: 'agency-a', p_target_membership_id: 'membership-clinician-empty',
        p_expected_actor_version: 1, p_expected_target_version: 1, p_request_id: randomUUID() };
      const result = await admin.rpc('revoke_membership', revoke);
      assert.equal(result.membership_status, 'revoked'); assert.equal(result.membership_version, 2);
      assert.equal((await admin.rpc('revoke_membership', revoke)).replayed, true);
      await denied(empty.rpc('context', { p_agency_id: 'agency-a' }));
      await denied(empty.rpc('patients', { p_agency_id: 'agency-a' }));
      assert.deepEqual((await empty.rpc('memberships')).memberships, []);
      await s4Denied(actors[2], '42501');
      const started = performance.now();
      const staleGrant = await raw('assignment', grant, tokens.get('admin-a'));
      assert.equal(staleGrant.status, 409); assert.equal(staleGrant.data.code, 'PT409');
      assert.equal(staleGrant.data.message, 'PENNSYNC_REPLAY_STATE_CHANGED');
      requireTrue(performance.now() - started < 5000, 'STALE_REPLAY_MUST_RETURN_WITHOUT_RETRY');
      const rows = await db.query(`select status,version::integer from pennsync_private.assignment where membership_id=$1`, [actors[2].membership]);
      assert.deepEqual(rows.rows, [{ status: 'revoked', version: 4 }]);
    });
    await scenario('actual Auth logout invalidates the still-unexpired signed access token', async () => {
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
      await s4Denied(actors[1], '28000', oldToken);
      await clinician.signIn(actors[1].password);
      assert.equal((await clinician.rpc('context', { p_agency_id: 'agency-a' })).tenant_role, 'clinician');
      const { readBody, expected } = s4Requests.get('clinician-a');
      assert.deepEqual((await raw('s4_read', readBody, tokens.get('clinician-a'))).data, expected);
    });
    await scenario('trusted membership revocation closes S3 confirmation replay and read over HTTP', async () => {
      // Existing public revocation only targets clinicians. This models trusted
      // control-plane maintenance, using the required lock, not a new admin API.
      const baseline=await db.query('select status,version::integer,revoked_at,revoked_by from pennsync_private.membership where app_id=$1 and id=$2 and auth_user_id=$3',[APP,actors[3].membership,actors[3].uuid]);
      assert.deepEqual(baseline.rows,[{status:'active',version:1,revoked_at:null,revoked_by:null}]);
      try {
        await db.query('begin'); await db.query('select pg_advisory_xact_lock(168344,20260918)');
        const changed=await db.query("update pennsync_private.membership set status='revoked',version=version+1,revoked_at=clock_timestamp(),revoked_by=$1 where app_id=$2 and id=$3 and auth_user_id=$4 and status='active' and version=1",[actors[0].uuid,APP,actors[3].membership,actors[3].uuid]);
        assert.equal(changed.rowCount,1); await db.query('commit');
        const {createBody,confirmBody,readBody}=s3Requests.get('admin-b');
        for (const [method,input] of [['s3_create',createBody],['s3_create',{...createBody,p_request_id:randomUUID()}],['s3_confirm',confirmBody],['s3_read',readBody]]) {
          const result=await raw(method,input,tokens.get('admin-b')); assert.equal(result.status,403); assert.equal(result.data.code,'42501');
        }
      } finally {
        // Restore only this owned synthetic fixture, including on assertion
        // failure, so later independent private-file tests retain their baseline.
        await db.query('rollback'); await db.query('begin'); await db.query('select pg_advisory_xact_lock(168344,20260918)');
        await db.query("update pennsync_private.membership set status='active',version=1,revoked_at=null,revoked_by=null where app_id=$1 and id=$2 and auth_user_id=$3 and status='revoked' and version=2 and revoked_by=$4",[APP,actors[3].membership,actors[3].uuid,actors[0].uuid]);
        const restored=await db.query('select status,version::integer,revoked_at,revoked_by from pennsync_private.membership where app_id=$1 and id=$2 and auth_user_id=$3',[APP,actors[3].membership,actors[3].uuid]);
        assert.deepEqual(restored.rows,baseline.rows); await db.query('commit');
      }
      assert.equal((await other.rpc('context',{p_agency_id:'agency-b'})).membership_version,1);
    });
    await scenario('interrupted real password logins revoke only their known native session', async () => {
      await verifyLoginLifecycle({ db, status, actor: actors[3], localFetch, raw, originalClient: other });
    });
    await scenario('all client HTTP traffic used only the local gateway and publishable key', async () => {
      assert.equal(attemptsOutsideLocal, 0);
      requireTrue(clientRequests >= 40, 'EXPECTED_REAL_CLIENT_HTTP_REQUESTS');
      assert.equal(await localMailCount(), 0);
      assert.deepEqual(Object.values((await s4Snapshot()).rows[0]), [4,4,4,4,4]);
      assert.deepEqual(Object.values((await s3Snapshot()).rows[0]), [2,4]);
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
