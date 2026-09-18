import assert from 'node:assert/strict';
import test from 'node:test';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { applyVerifiedPatientArchive } from './tools-pennsync-archive-import.mjs';
import { IMPORT_APP as APP, importActors, importId, importSha, syntheticImportArchive } from './tools-pennsync-archive-import-fixture.mjs';

const require = createRequire(new URL('./services/authority-store/package.json', import.meta.url));
const { Client } = require('pg');
const raw = process.env.PENNSYNC_TEST_PG_URL;
if (!raw || !/^postgresql:\/\/postgres@127\.0\.0\.1:(54339|5432)\/postgres$/.test(raw)) {
  throw new Error('Only the explicit literal loopback PostgreSQL import lab is allowed');
}
const migrations = new URL('./services/authority-store/supabase/migrations/', import.meta.url);

async function lab(t) {
  const name = `pennsync_import_${randomBytes(16).toString('hex')}`;
  const ownerKey = randomBytes(32); const key = randomBytes(32);
  const admin = new Client({ connectionString: raw }); let db, root, created = false;
  t.after(async () => {
    await db?.end();
    try { if (created) await admin.query(`drop database "${name}"`); } finally { await admin.end(); }
    if (root) {
      assert.equal(dirname(resolve(root)), resolve(tmpdir())); assert.ok(basename(root).startsWith('pennsync-import-native-'));
      await rm(root, { recursive: true, force: true });
    }
    ownerKey.fill(0); key.fill(0);
  });
  await admin.connect();
  const roles = (await admin.query("select count(*)::integer n from pg_roles where rolname in ('anon','authenticated','service_role')")).rows[0].n;
  assert.equal(roles, 3, 'Existing lab roles required; this harness never creates cluster roles');
  await admin.query(`create database "${name}"`); created = true;
  root = await mkdtemp(join(tmpdir(), 'pennsync-import-native-'));
  await admin.query(`comment on database "${name}" is 'PENNSYNC_IMPORT_TARGET_V1:${importSha(ownerKey)}'`);
  const targetUrl = new URL(raw); targetUrl.pathname = `/${name}`; const url = targetUrl.toString();
  db = new Client({ connectionString: url }); await db.connect();
  await db.query(await readFile(new URL('./services/authority-store/tests/bootstrap.sql', import.meta.url), 'utf8'));
  for (const file of (await readdir(migrations)).filter(f => f.endsWith('.sql')).sort()) await db.query(await readFile(new URL(file, migrations), 'utf8'));
  for (const a of importActors) {
    await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,clock_timestamp())', [a.uuid, a.email]);
    await db.query('insert into auth.sessions(id,user_id,not_after) values($1,$2,clock_timestamp()+interval \'1 hour\')',
      [a.uuid.replace('10000000', '20000000'), a.uuid]);
    await db.query(`insert into pennsync_private.identity_map
      (app_id,auth_user_id,base44_user_id,expected_email,source_evidence_sha256,verified_at) values($1,$2,$3,$4,$5,clock_timestamp())`,
    [APP, a.uuid, a.id, a.email, importSha('LOCAL_AUTH_STUB_PROVENANCE_ONLY')]);
  }
  for (const [id, label, status] of [['agency-a', 'A', 'active'], ['agency-b', 'B', 'trial']]) await db.query(
    'insert into pennsync_private.agency(app_id,id,name,status) values($1,$2,$3,$4)', [APP, id, `Synthetic Agency ${label}`, status]);
  for (const a of importActors) await db.query(`insert into pennsync_private.membership
    (app_id,id,agency_id,auth_user_id,base44_user_id,tenant_role,status) values($1,$2,$3,$4,$5,$6,'active')`,
  [APP, `membership-${a.name}`, a.agency, a.uuid, a.id, a.role]);
  let number = 0;
  const archive = async alter => syntheticImportArchive({ archiveDir: join(root, `archive-${number++}`), key, alter });
  const f = await archive();
  const options = { ...f, ownerKey, target: { kind: 'native', url } };
  const run = overrides => applyVerifiedPatientArchive({ ...options, ...overrides });
  const counts = async () => (await db.query(`select
    (select count(*)::int from pennsync_private.patient) patients,
    (select count(*)::int from pennsync_private.archive_patient_import_receipt) receipts`)).rows[0];
  const rpc = async (actor, agency, patient) => {
    const a = importActors[actor];
    await db.query('begin');
    try {
      await db.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: a.uuid,
        session_id: a.uuid.replace('10000000', '20000000'), role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 })]);
      await db.query('set local role authenticated');
      const result = patient ? await db.query('select public.pennsync_staging_patient($1,$2,$3) result', [APP, agency, patient])
        : await db.query('select public.pennsync_staging_patients($1,$2,100,null) result', [APP, agency]);
      return result.rows[0].result;
    } finally { await db.query('rollback'); }
  };
  return { db, admin, name, options, run, counts, rpc, archive };
}

test('native import creates actual roster-readable patient rows; exact replay and rollback preserve authority', async t => {
  const f = await lab(t);
  assert.equal((await f.rpc(0, 'agency-a')).items.length, 0);
  assert.equal((await f.run()).status, 'imported');
  const a = (await f.rpc(0, 'agency-a')).items;
  assert.deepEqual(a, [{ id: importId(20), agency_id: 'agency-a', display_name: 'Synthetic Imported A', synthetic: true, version: 1 }]);
  assert.equal((await f.rpc(3, 'agency-b')).items[0].id, importId(21));
  assert.equal((await f.rpc(1, 'agency-a')).items.length, 0);
  assert.equal((await f.rpc(2, 'agency-a')).items.length, 0);
  await assert.rejects(f.rpc(0, 'agency-b'), /PENNSYNC_TENANT_DENIED/);
  await assert.rejects(f.rpc(3, 'agency-b', importId(20)), /PENNSYNC_PATIENT_DENIED/);
  assert.equal((await f.run()).status, 'reconciled');
  assert.equal((await f.run({ action: 'reconcile' })).replayed, true);
  assert.deepEqual(await f.counts(), { patients: 2, receipts: 1 });
  assert.equal((await f.run({ action: 'rollback' })).status, 'rolled_back');
  assert.equal((await f.rpc(0, 'agency-a')).items.length, 0);
  assert.equal((await f.run({ action: 'rollback' })).replayed, true);
  assert.equal((await f.run({ action: 'reconcile' })).status, 'rolled_back');
  await assert.rejects(f.run(), { code: 'IMPORT_ROLLED_BACK' });
  assert.deepEqual(await f.counts(), { patients: 0, receipts: 1 });
});

test('concurrent exact imports commit one batch and reconcile the other', async t => {
  const f = await lab(t); const results = await Promise.all([f.run(), f.run()]);
  assert.deepEqual(results.map(r => r.status).sort(), ['imported', 'reconciled']);
  assert.deepEqual(await f.counts(), { patients: 2, receipts: 1 });
});

test('second-row interruption leaves no patient or receipt', async t => {
  const f = await lab(t); const query = Client.prototype.query; let inserts = 0;
  Client.prototype.query = async function (text, ...args) {
    if (this.connectionParameters.application_name === 'pennsync-archive-patient-import'
      && /^insert into pennsync_private.patient\b/.test(text) && ++inserts === 2) throw new Error('synthetic raw failure must not escape');
    return query.call(this, text, ...args);
  };
  try { await assert.rejects(f.run(), { code: 'IMPORT_FAILED_DETAILS_REDACTED' }); }
  finally { Client.prototype.query = query; }
  assert.equal(inserts, 2); assert.deepEqual(await f.counts(), { patients: 0, receipts: 0 });
});

test('lost commit acknowledgement is unknown, then explicit reconciliation finds one durable batch', async t => {
  const f = await lab(t); const query = Client.prototype.query; let commits = 0;
  Client.prototype.query = async function (text, ...args) {
    const result = await query.call(this, text, ...args);
    if (this.connectionParameters.application_name === 'pennsync-archive-patient-import' && text === 'commit') {
      commits++; throw new Error('synthetic lost acknowledgement');
    }
    return result;
  };
  try { await assert.rejects(f.run(), { code: 'IMPORT_COMMIT_OUTCOME_UNKNOWN' }); }
  finally { Client.prototype.query = query; }
  assert.equal(commits, 1); assert.deepEqual(await f.counts(), { patients: 2, receipts: 1 });
  assert.equal((await f.run({ action: 'reconcile' })).status, 'reconciled');
});

test('lost rollback acknowledgement reconciles the retained terminal tombstone', async t => {
  const f = await lab(t); await f.run(); const query = Client.prototype.query;
  Client.prototype.query = async function (text, ...args) {
    const result = await query.call(this, text, ...args);
    if (this.connectionParameters.application_name === 'pennsync-archive-patient-import' && text === 'commit') throw new Error('lost acknowledgement');
    return result;
  };
  try { await assert.rejects(f.run({ action: 'rollback' }), { code: 'IMPORT_COMMIT_OUTCOME_UNKNOWN' }); }
  finally { Client.prototype.query = query; }
  assert.deepEqual(await f.counts(), { patients: 0, receipts: 1 });
  assert.equal((await f.run({ action: 'reconcile' })).status, 'rolled_back');
});

test('receipt write interruption rolls back every already-inserted patient', async t => {
  const f = await lab(t); const query = Client.prototype.query; let interrupted = false;
  Client.prototype.query = async function (text, ...args) {
    if (this.connectionParameters.application_name === 'pennsync-archive-patient-import'
      && /^insert into pennsync_private.archive_patient_import_receipt\b/.test(text)) {
      interrupted = true; throw new Error('receipt interruption');
    }
    return query.call(this, text, ...args);
  };
  try { await assert.rejects(f.run(), { code: 'IMPORT_FAILED_DETAILS_REDACTED' }); }
  finally { Client.prototype.query = query; }
  assert.equal(interrupted, true); assert.deepEqual(await f.counts(), { patients: 0, receipts: 0 });
});

test('exact existing unreceipted patient is never adopted or removed', async t => {
  const f = await lab(t);
  await f.db.query(`insert into pennsync_private.patient(app_id,id,agency_id,display_name) values($1,$2,'agency-a','Synthetic Imported A')`, [APP, importId(20)]);
  for (const action of ['import', 'reconcile', 'rollback']) await assert.rejects(f.run({ action }), { code: 'IMPORT_UNOWNED_PATIENT' });
  assert.deepEqual(await f.counts(), { patients: 1, receipts: 0 });
});

test('changed source bytes or explicit mapping never overwrite prior import', async t => {
  const f = await lab(t); await f.run();
  const changed = await f.archive(x => { x.source.Patient[0].last_name = 'Changed A'; });
  await assert.rejects(f.run(changed), { code: 'IMPORT_UNOWNED_PATIENT' });
  const mapped = await f.archive(x => { x.identities[0].target_subject = '90000000-0000-4000-8000-000000000001'; });
  await assert.rejects(f.run(mapped), { code: 'IMPORT_IDENTITY_MISMATCH' });
  assert.equal((await f.rpc(0, 'agency-a')).items[0].display_name, 'Synthetic Imported A');
});

test('patient drift prevents replay and rollback; dependent clinical assignment prevents deletion', async t => {
  const f = await lab(t); await f.run();
  await f.db.query('update pennsync_private.patient set version=2 where id=$1', [importId(20)]);
  for (const action of ['import', 'reconcile', 'rollback']) await assert.rejects(f.run({ action }), { code: 'IMPORT_TARGET_DRIFT' });
  await f.db.query('update pennsync_private.patient set version=1 where id=$1', [importId(20)]);
  await f.db.query(`insert into pennsync_private.assignment(app_id,agency_id,patient_id,membership_id,status,changed_by)
    values($1,'agency-a',$2,'membership-clinician-a','active',$3)`, [APP, importId(20), importActors[0].uuid]);
  await assert.rejects(f.run({ action: 'rollback' }), { code: 'IMPORT_FAILED_DETAILS_REDACTED' });
  assert.deepEqual(await f.counts(), { patients: 2, receipts: 1 });
  assert.equal((await f.db.query('select state from pennsync_private.archive_patient_import_receipt')).rows[0].state, 'applied');
});

test('native identity and agency authority are current prerequisites, never manufactured', async t => {
  const f = await lab(t);
  await f.db.query("update auth.users set banned_until=clock_timestamp()+interval '1 day' where id=$1", [importActors[0].uuid]);
  await assert.rejects(f.run(), { code: 'IMPORT_IDENTITY_MISMATCH' });
  await f.db.query('update auth.users set banned_until=null where id=$1', [importActors[0].uuid]);
  await f.db.query("update pennsync_private.agency set status='suspended' where id='agency-a'");
  await assert.rejects(f.run(), { code: 'IMPORT_AGENCY_MISMATCH' });
  assert.deepEqual(await f.counts(), { patients: 0, receipts: 0 });
  assert.equal((await f.db.query('select count(*)::integer n from auth.users')).rows[0].n, 4);
});

test('wrong database ownership, unsafe receipt grants and conflicting receipt all refuse', async t => {
  const f = await lab(t);
  await assert.rejects(f.run({ ownerKey: randomBytes(32) }), { code: 'IMPORT_TARGET_UNOWNED' });
  await f.db.query('grant select on pennsync_private.archive_patient_import_receipt to authenticated');
  await assert.rejects(f.run(), { code: 'IMPORT_SCHEMA_UNSAFE' });
  await f.db.query('revoke select on pennsync_private.archive_patient_import_receipt from authenticated');
  await f.db.query('grant select(plan_sha256) on pennsync_private.archive_patient_import_receipt to service_role');
  await assert.rejects(f.run(), { code: 'IMPORT_SCHEMA_UNSAFE' });
  await f.db.query('revoke select(plan_sha256) on pennsync_private.archive_patient_import_receipt from service_role');
  await f.run();
  await f.db.query("update pennsync_private.archive_patient_import_receipt set owner_sha256=repeat('f',64)");
  await assert.rejects(f.run(), { code: 'IMPORT_RECEIPT_CONFLICT' });
  assert.deepEqual(await f.counts(), { patients: 2, receipts: 1 });
});

test('receipt cannot be read by browser or service roles; FORCE RLS blocks even an accidental browser grant', async t => {
  const f = await lab(t); await f.run();
  for (const role of ['anon', 'authenticated', 'service_role']) {
    await f.db.query('begin'); await f.db.query(`set local role ${role}`);
    await assert.rejects(f.db.query('select * from pennsync_private.archive_patient_import_receipt'), { code: '42501' });
    await f.db.query('rollback');
  }
  await f.db.query('grant select on pennsync_private.archive_patient_import_receipt to authenticated');
  await f.db.query('begin'); await f.db.query('set local role authenticated');
  assert.equal((await f.db.query('select * from pennsync_private.archive_patient_import_receipt')).rows.length, 0);
  await f.db.query('rollback');
});
