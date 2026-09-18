import { randomBytes, createHash } from 'node:crypto';
import { STAGING_APP_ID as APP } from '../client.mjs';
import { API, PROJECT } from '../../authority-store/tests/http-local-stack.mjs';

const fail = code => { throw new Error(code); };
export async function localRequest(path, key, body, bearer = key, method = 'POST') {
  if (!/^\/(auth|rest)\/v1\//.test(path) || path.includes('://')) fail('BROWSER_NODE_DESTINATION_FORBIDDEN');
  return fetch(API + path, { method, redirect: 'error', signal: AbortSignal.timeout(15000),
    headers: { apikey: key, Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
export async function provision(db, status) {
  const fresh = (await db.query(`select (select count(*)::int from auth.users) users,
    (select count(*)::int from pennsync_private.identity_map) identities,
    (select count(*)::int from pennsync_private.agency) agencies`)).rows[0];
  if (Object.values(fresh).some(value => value !== 0)) fail('BROWSER_FRESH_OWNED_STACK_REQUIRED');
  const actors = [
    ['admin-a', '6aac58fe36c13a1c49ba7cf8', 'agency-a', 'agency_admin'],
    ['clinician-a', '6aac58ff8ec706a643a7aa42', 'agency-a', 'clinician'],
    ['clinician-empty', '6aac58ffa5f6252bcf92f11f', 'agency-a', 'clinician'],
    ['admin-b', '6aac5900bf4098977893276d', 'agency-b', 'agency_admin'],
  ].map(([name, legacyId, agency, role]) => ({ name, legacyId, agency, role,
    email: `info+pennsync-${name}@caremetricai.com`, password: `LocalOnly!${randomBytes(32).toString('base64url')}` }));
  for (const actor of actors) {
    const response = await localRequest('/auth/v1/admin/users', status.SECRET_KEY,
      { email: actor.email, password: actor.password, email_confirm: true });
    if (!response.ok) fail('BROWSER_LOCAL_ADMIN_CREATE_FAILED');
    const user = await response.json();
    if (!/^[0-9a-f-]{36}$/.test(user.id) || user.email !== actor.email || !user.email_confirmed_at
      || user.role !== 'authenticated' || user.is_anonymous !== false) fail('BROWSER_LOCAL_IDENTITY_INVALID');
    actor.uuid = user.id;
  }
  if (new Set(actors.map(actor => actor.uuid)).size !== 4) fail('BROWSER_LOCAL_IDENTITIES_NOT_DISTINCT');
  await db.query('begin');
  try {
    await db.query('select pg_advisory_xact_lock(168344,20260918)');
    for (const [id, name] of [['agency-a', 'Synthetic Agency A'], ['agency-b', 'Synthetic Agency B']]) {
      await db.query("insert into pennsync_private.agency(app_id,id,name,status) values($1,$2,$3,'active')", [APP, id, name]);
    }
    for (const actor of actors) {
      const hash = createHash('sha256').update(`LOCAL_BROWSER_FIXTURE:${actor.email}:${actor.uuid}`).digest('hex');
      await db.query(`insert into pennsync_private.identity_map
        (app_id,auth_user_id,base44_user_id,expected_email,source_evidence_sha256,verified_at)
        values($1,$2,$3,$4,$5,clock_timestamp())`, [APP, actor.uuid, actor.legacyId, actor.email, hash]);
      await db.query(`insert into pennsync_private.membership(app_id,id,agency_id,auth_user_id,base44_user_id,tenant_role,status)
        values($1,$2,$3,$4,$5,$6,'active')`, [APP, `membership-${actor.name}`, actor.agency, actor.uuid, actor.legacyId, actor.role]);
    }
    for (const [id, agency, name] of [['patient-a1', 'agency-a', 'Synthetic Patient A1'],
      ['patient-a2', 'agency-a', 'Synthetic Patient A2'], ['patient-b1', 'agency-b', 'Synthetic Patient B1']]) {
      await db.query('insert into pennsync_private.patient(app_id,id,agency_id,display_name) values($1,$2,$3,$4)', [APP, id, agency, name]);
    }
    await db.query(`insert into pennsync_private.assignment(app_id,agency_id,patient_id,membership_id,status,changed_by)
      values($1,'agency-a','patient-a1','membership-clinician-a','active',$2)`, [APP, actors[0].uuid]);
    await db.query('commit');
  } catch (error) { await db.query('rollback'); throw error; }
  await db.query("notify pgrst, 'reload schema'");
  const configuration = { target: { appId: APP, projectRef: PROJECT, projectUrl: API, publishableKey: status.PUBLISHABLE_KEY },
    actors: actors.map(({ name, agency, uuid, email }) => ({ name, agency, uuid, email })) };
  return { actors, configuration };
}
