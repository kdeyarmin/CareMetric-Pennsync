// Native PostgreSQL concurrency proof; only fresh, owned, literal-loopback databases.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { randomBytes, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import pg from 'pg';
import { s4Fields } from './s4-fixture.mjs';

const raw = process.env.PENNSYNC_TEST_PG_URL;
if (!raw) throw new Error('PENNSYNC_TEST_PG_URL is required for real PostgreSQL tests');
const base = new URL(raw);
if (!['postgres:', 'postgresql:'].includes(base.protocol) || !['127.0.0.1', '[::1]'].includes(base.hostname)
  || base.pathname !== '/postgres' || base.search || base.hash) throw new Error('Only loopback PostgreSQL /postgres is allowed');
const APP = '6a9881683dc68a0bd54f1ef7';
const uid = n => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const sid = n => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const visitKeys = ['id', 'patient_id', 'visit_date', 'visit_type', 'status', 'nurse_notes', 'raw_transcription',
  'vital_signs', 'documentation_source', 'grounding_pending', 'emr_handoff_status', 'emr_handoff_history', 'updated_date'];
async function lab(run) {
  const name = `pennsync_visit_test_${process.pid}_${randomBytes(5).toString('hex')}`;
  assert.match(name, /^pennsync_visit_test_[0-9]+_[a-f0-9]{10}$/);
  const admin = new pg.Client({ connectionString: base.toString() });
  await admin.connect(); const clients = []; let owned = false;
  try {
    const roles = await admin.query("select rolname from pg_catalog.pg_roles where rolname=any($1::text[]) order by rolname", [['anon', 'authenticated', 'service_role']]);
    assert.deepEqual(roles.rows.map(row => row.rolname), ['anon', 'authenticated', 'service_role']);
    await admin.query(`create database "${name}"`); owned = true;
    const target = new URL(base); target.pathname = `/${name}`;
    const connect = async () => {
      const c = new pg.Client({ connectionString: target.toString(), statement_timeout: 10000 });
      await c.connect(); clients.push(c); return c;
    };
    const setup = await connect();
    const bootstrap = await readFile(new URL('./bootstrap.sql', import.meta.url), 'utf8');
    // Required roles pre-exist. Never issue cluster role DDL, even conditional DDL.
    const schema = bootstrap.slice(bootstrap.indexOf('create schema auth;'));
    assert.ok(schema.startsWith('create schema auth;'));
    await setup.query(schema);
    const dir = new URL('../supabase/migrations/', import.meta.url);
    for (const file of (await readdir(dir)).filter(f => f.endsWith('.sql')).sort()) await setup.query(await readFile(new URL(file, dir), 'utf8'));
    await setup.query(await readFile(new URL('./fixtures.sql', import.meta.url), 'utf8'));
    await run({ setup, connect });
  } finally {
    for (const c of clients) { try { await c.query('rollback'); } catch { /* already closed */ } await c.end(); }
    try { if (owned) await admin.query(`drop database "${name}"`); } finally { await admin.end(); }
  }
}
async function begin(c, n = 1) {
  await c.query('begin');
  await c.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: uid(n), session_id: sid(n), role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 })]);
  await c.query('set local role authenticated');
}
async function rpc(c, name, args) {
  return (await c.query(`select public.pennsync_staging_${name}(${args.map((_, i) => `$${i + 1}`).join(',')}) result`, args)).rows[0].result;
}
const read = (c, id, agency = 'agency-a') => rpc(c, 'visit_documentation', [APP, agency, id]);
async function seed(c, fields = s4Fields()) {
  await begin(c, 1);
  const result = await rpc(c, 's4_create', [APP, 'agency-a', 'patient-a1', 1, 1, randomUUID(), JSON.stringify(fields)]);
  await c.query('commit'); return result;
}
const count = async c => (await c.query('select count(*)::int n from pennsync_private.visit_disclosure_audit')).rows[0].n;
const tracked = p => p.then(value => ({ ok: true, value }), error => ({ ok: false, error }));
async function waiting(monitor, client, event = 'advisory') {
  const end = Date.now() + 3000;
  while (Date.now() < end) {
    const result = await monitor.query('select wait_event_type,wait_event from pg_stat_activity where pid=$1', [client.processID]);
    if (result.rows[0]?.wait_event_type === 'Lock' && (!event || result.rows[0].wait_event === event)) return;
    await delay(10);
  }
  assert.fail('Expected an observed PostgreSQL lock wait');
}
const revoke = c => rpc(c, 'revoke_membership', [APP, 'agency-a', 'membership-2', 1, 1, randomUUID()]);

test('current admin and assigned clinician read another author exact 13-field documentation with private audit', () => lab(async ({ setup, connect }) => {
  const c = await connect(), saved = await seed(c), id = saved.artifacts.visit.id;
  const assignment = (await setup.query('select id,version from pennsync_private.assignment')).rows[0];
  for (const n of [1, 2]) {
    await begin(c, n); const result = await read(c, id); await c.query('commit');
    assert.equal(result.auth_user_id, uid(n)); assert.equal(result.purpose, 'documentation');
    assert.equal(result.contract, 'cm.pennsync.authority.staging.v1');
    assert.equal(result.staging, true); assert.equal(result.synthetic, true);
    assert.deepEqual(Object.keys(result.visit).sort(), [...visitKeys].sort());
    assert.deepEqual(result.visit, Object.fromEntries(visitKeys.map(key => [key, saved.artifacts.visit[key]])));
    assert.deepEqual(result.scope, { agency_id: 'agency-a', membership_id: `membership-${n}`, membership_version: 1,
      tenant_role: n === 1 ? 'agency_admin' : 'clinician', patient_id: 'patient-a1',
      access_basis: n === 1 ? 'agency_wide' : 'care_team_assignment', assignment_id: n === 1 ? null : assignment.id,
      assignment_version: n === 1 ? null : Number(assignment.version) });
  }
  assert.equal(await count(setup), 2);
  const audit = (await setup.query('select * from pennsync_private.visit_disclosure_audit order by created_at')).rows;
  assert.deepEqual(audit.map(row => row.actor_id), [uid(1), uid(2)]);
  assert.equal(audit[1].assignment_id, assignment.id);
  assert.ok(audit.every(row => row.visit_id === id && row.purpose === 'documentation'));
  assert.equal(JSON.stringify(audit).includes(saved.artifacts.visit.nurse_notes), false);
  await begin(c, 2);
  await assert.rejects(() => rpc(c, 's4_read', [APP, 'agency-a', 'patient-a1', 1, 1, saved.request_id]), /RECEIPT_DENIED/);
  await c.query('rollback');
}));

test('foreign agency, unassigned clinician, absent visit and unsupported current role produce no disclosure audit', () => lab(async ({ setup, connect }) => {
  const c = await connect(), saved = await seed(c), id = saved.artifacts.visit.id;
  for (const [n, visit, agency] of [[3, id, 'agency-a'], [4, id, 'agency-b'], [2, randomUUID(), 'agency-a'], [2, id, 'agency-b']]) {
    await begin(c, n); await assert.rejects(() => read(c, visit, agency), /DENIED/); await c.query('rollback');
  }
  await setup.query("update pennsync_private.membership set tenant_role='manager',version=2 where id='membership-1'");
  await begin(c); await assert.rejects(() => read(c, id), /VISIT_DENIED/); await c.query('rollback');
  assert.equal(await count(setup), 0);
}));

test('current membership and patient versions supersede creator receipt revisions without widening access', () => lab(async ({ setup, connect }) => {
  const c = await connect(), saved = await seed(c);
  await setup.query("update pennsync_private.membership set version=2 where id='membership-1'; update pennsync_private.patient set version=2 where id='patient-a1'");
  await begin(c); const result = await read(c, saved.artifacts.visit.id); await c.query('commit');
  assert.equal(result.scope.membership_version, 2);
  await begin(c); await assert.rejects(() => rpc(c, 's4_read', [APP, 'agency-a', 'patient-a1', 1, 1, saved.request_id]), /ACTOR_VERSION_CHANGED/);
  await c.query('rollback'); assert.equal(await count(setup), 1);
}));

test('assignment identity and scope are immutable while normal revoke and regrant preserve identity', () => lab(async ({ setup, connect }) => {
  const c = await connect(), saved = await seed(c);
  const original = (await setup.query('select id from pennsync_private.assignment')).rows[0].id;
  for (const statement of ["id=gen_random_uuid()", "app_id='694ec16e72e01b60d22f7cbf'", "agency_id='agency-b'", "patient_id='patient-a2'", "membership_id='membership-3'"]) {
    await assert.rejects(() => setup.query(`update pennsync_private.assignment set ${statement}`));
  }
  await assert.rejects(() => setup.query('delete from pennsync_private.assignment'), /PROVENANCE_IMMUTABLE/);
  for (const [action, version] of [['revoke', 1], ['grant', 2]]) {
    await begin(c); await rpc(c, 'assignment', [APP, 'agency-a', 'patient-a1', 'membership-2', action, 1, 1, version, randomUUID()]); await c.query('commit');
  }
  await begin(c, 2); const result = await read(c, saved.artifacts.visit.id); await c.query('commit');
  assert.equal(result.scope.assignment_id, original); assert.equal(result.scope.assignment_version, 3);
}));

test('audit insertion failure is sanitized and returns no document or audit row', () => lab(async ({ setup, connect }) => {
  const c = await connect(), saved = await seed(c);
  await setup.query("create function pennsync_private.inject_disclosure_failure() returns trigger language plpgsql as $$ begin raise exception 'synthetic sensitive diagnostic'; end $$; create trigger injected before insert on pennsync_private.visit_disclosure_audit for each row execute function pennsync_private.inject_disclosure_failure()");
  await begin(c, 2); await assert.rejects(() => read(c, saved.artifacts.visit.id), error => {
    assert.equal(error.code, 'PT503'); assert.equal(error.message, 'PENNSYNC_VISIT_AUDIT_UNAVAILABLE');
    assert.equal(error.detail, undefined); return true;
  }); await c.query('rollback'); assert.equal(await count(setup), 0);
}));

test('creator artifact hash mismatch withholds content and produces no disclosure audit', () => lab(async ({ setup, connect }) => {
  const c = await connect(), saved = await seed(c);
  await setup.query("alter table pennsync_private.s4_note_history disable trigger immutable; update pennsync_private.s4_note_history set data=jsonb_set(data,'{note}','\"Altered synthetic note\"')");
  await begin(c, 2); await assert.rejects(() => read(c, saved.artifacts.visit.id), /ARTIFACTS_CHANGED/); await c.query('rollback');
  assert.equal(await count(setup), 0);
}));

test('valid Unicode documentation larger than 1 MiB preserves exact bytes under the 2500000-byte cap', () => lab(async ({ setup, connect }) => {
  const c = await connect(), note = '漢'.repeat(230000), raw = '語'.repeat(230000);
  const saved = await seed(c, s4Fields({ nurse_notes: note, raw_transcription: raw }));
  await begin(c, 2); const result = await read(c, saved.artifacts.visit.id); await c.query('commit');
  assert.equal(result.visit.nurse_notes, note); assert.equal(result.visit.raw_transcription, raw);
  const size = Buffer.byteLength(JSON.stringify(result)); assert.ok(size > 1048576 && size < 2500000);
  assert.equal(await count(setup), 1);
}));

test('audit table and internal helpers deny browser/service access and accidental grants still enforce RLS', () => lab(async ({ setup, connect }) => {
  const c = await connect(), saved = await seed(c); await begin(c); await read(c, saved.artifacts.visit.id); await c.query('commit');
  for (const role of ['anon', 'authenticated', 'service_role']) {
    await c.query('begin'); await c.query(`set local role ${role}`);
    await assert.rejects(() => c.query('select * from pennsync_private.visit_disclosure_audit'), /permission denied/); await c.query('rollback');
    for (const helper of ['assignment_provenance_immutable', 'visit_disclosure_immutable']) {
      assert.equal((await setup.query('select has_function_privilege($1,$2,$3) allowed', [role, `pennsync_private.${helper}()`, 'EXECUTE'])).rows[0].allowed, false);
    }
  }
  await setup.query('grant select,insert,update,delete on pennsync_private.visit_disclosure_audit to authenticated');
  await begin(c); assert.deepEqual((await c.query('select * from pennsync_private.visit_disclosure_audit')).rows, []); await c.query('rollback');
  await assert.rejects(() => setup.query("update pennsync_private.visit_disclosure_audit set purpose='documentation'"), /DISCLOSURE_IMMUTABLE/);
  await assert.rejects(() => setup.query('delete from pennsync_private.visit_disclosure_audit'), /DISCLOSURE_IMMUTABLE/);
}));

test('server response cap rejects an oversized privileged-corruption fixture before audit insertion', () => lab(async ({ setup, connect }) => {
  const c = await connect(), saved = await seed(c);
  // No legal S4 creation can reach this size. Deliberately violate its storage
  // guard only inside this disposable database to exercise read defense in depth.
  await setup.query(`alter table pennsync_private.s4_visit disable trigger immutable;
    alter table pennsync_private.s4_visit drop constraint s4_visit_data_check;
    alter table pennsync_private.s4_create_receipt disable trigger immutable;
    update pennsync_private.s4_visit set data=jsonb_set(data,'{nurse_notes}',to_jsonb(repeat('x',2500000)))`);
  await setup.query(`update pennsync_private.s4_create_receipt r set artifacts_sha256=encode(sha256(convert_to(
    jsonb_build_object('visit',v.data,'note_history',h.data,'note_conversion',n.data,'compliance_audit',a.data)::text,'UTF8')),'hex')
    from pennsync_private.s4_visit v,pennsync_private.s4_note_history h,pennsync_private.s4_note_conversion n,pennsync_private.s4_compliance_audit a
    where r.visit_id=v.id and r.history_id=h.id and r.conversion_id=n.id and r.audit_id=a.id`);
  await begin(c, 2); await assert.rejects(() => read(c, saved.artifacts.visit.id), error => {
    assert.equal(error.code, '22023'); assert.equal(error.message, 'PENNSYNC_VISIT_RESPONSE_LIMIT');
    assert.equal(error.detail, undefined); return true;
  }); await c.query('rollback'); assert.equal(await count(setup), 0);
}));

for (const readFirst of [false, true]) test(`membership revoke/read lock ordering: ${readFirst ? 'read commits first' : 'revocation commits first'}`, () => lab(async ({ setup, connect }) => {
  const reader = await connect(), revoker = await connect(), saved = await seed(reader);
  await begin(reader, 2); await begin(revoker);
  if (readFirst) {
    await read(reader, saved.artifacts.visit.id); const pending = tracked(revoke(revoker));
    await waiting(setup, revoker); await reader.query('commit'); assert.equal((await pending).ok, true); await revoker.query('commit');
  } else {
    await revoke(revoker); const pending = tracked(read(reader, saved.artifacts.visit.id));
    await waiting(setup, reader); await revoker.query('commit'); const outcome = await pending;
    assert.equal(outcome.ok, false); assert.match(outcome.error.message, /TENANT_DENIED/); await reader.query('rollback');
  }
  await begin(reader, 2); await assert.rejects(() => read(reader, saved.artifacts.visit.id), /TENANT_DENIED/); await reader.query('rollback');
  assert.equal(await count(setup), readFirst ? 1 : 0);
}));

for (const [name, sql, denied] of [
  ['native logout', `delete from auth.sessions where id='${sid(2)}'`, /SESSION_INACTIVE/],
  ['patient deactivation', "update pennsync_private.patient set status='inactive',version=version+1 where id='patient-a1'", /VISIT_DENIED/],
  ['assignment revocation', "update pennsync_private.assignment set status='revoked',version=version+1 where membership_id='membership-2'", /VISIT_DENIED/],
]) for (const readFirst of [false, true]) test(`${name} row lock ordering: ${readFirst ? 'read commits first' : 'revocation commits first'}`, () => lab(async ({ setup, connect }) => {
  const reader = await connect(), writer = await connect(), saved = await seed(reader);
  await begin(reader, 2); await writer.query('begin');
  if (readFirst) {
    await read(reader, saved.artifacts.visit.id); const pending = tracked(writer.query(sql));
    await waiting(setup, writer, null); await reader.query('commit'); assert.equal((await pending).ok, true); await writer.query('commit');
  } else {
    await writer.query(sql); const pending = tracked(read(reader, saved.artifacts.visit.id));
    await waiting(setup, reader, null); await writer.query('commit'); const outcome = await pending;
    assert.equal(outcome.ok, false); assert.match(outcome.error.message, denied); await reader.query('rollback');
  }
  await begin(reader, 2); await assert.rejects(() => read(reader, saved.artifacts.visit.id), denied); await reader.query('rollback');
  assert.equal(await count(setup), readFirst ? 1 : 0);
}));

test('read-only transactions cannot return unaudited documentation', () => lab(async ({ setup, connect }) => {
  const c = await connect(), saved = await seed(c);
  await begin(c, 2); await c.query('set transaction read only');
  await assert.rejects(() => read(c, saved.artifacts.visit.id), error => error.code === '25006' || error.code === 'PT503');
  await c.query('rollback'); assert.equal(await count(setup), 0);
}));
