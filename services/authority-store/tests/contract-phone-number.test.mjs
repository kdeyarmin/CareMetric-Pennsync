import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { SCHEMA } from '../../../tools-entity-schema-plan.mjs';
import { applyRecordMigrations } from './record-migrations.mjs';

/**
 * The agency's pool of work numbers: a read, and only a read.
 *
 * The assertion that matters most here is an ABSENCE, and it is written the way
 * D39's credential suite writes its own: no function in this family writes a
 * `phone_number` row, and the test fails if one appears. The entity's three
 * write rules are `__service_role_only__`, which is the absence of a caller
 * rather than a tier D40 can find a successor for — and acquiring a number is
 * paid infrastructure besides, which is the owner's call and not a contract's.
 */
const APP = '6a9881683dc68a0bd54f1ef7';
const A = 'agency-a'; const B = 'agency-b';
const uid = n => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const sid = n => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ADMIN_A = 1; const CLINICIAN_A = 2; const ADMIN_B = 4;
const LIST = 'select "public"."pennsync_contract_phone_number_list"($1,$2) as result';
let db;

before(async () => {
  db = new PGlite();
  await db.exec(await readFile(new URL('./bootstrap.sql', import.meta.url), 'utf8'));
  const dir = new URL('../supabase/migrations/', import.meta.url);
  for (const name of (await readdir(dir)).filter(file => file.endsWith('.sql')).sort()) {
    await db.exec(await readFile(new URL(name, dir), 'utf8'));
  }
  await applyRecordMigrations(db);
  await db.exec(await readFile(new URL('./fixtures.sql', import.meta.url), 'utf8'));
  for (const [id, name] of [[A, 'Keystone Home Health'], [B, 'Allegheny Care Partners']]) {
    await db.query(`insert into ${SCHEMA}."agency"
      ("source_app_id","id","agency_name","status") values ($1,$2,$3,'active')`, [APP, id, name]);
  }
  await db.query(`insert into ${SCHEMA}."phone_number"
    ("source_app_id","id","agency_id","e164","label","status","assigned_to_email",
     "twilio_phone_number_sid","creation_claim_token","created_date")
    values
    ($1,'pn-a1',$2,'+12155550100','Nurse line 1','assigned','clinician-a@example.invalid',
      'PN1111','claim-a1', clock_timestamp()),
    ($1,'pn-a2',$2,'+12155550101','Intake','available',null,'PN2222','claim-a2',
      clock_timestamp() + interval '1 minute'),
    ($1,'pn-b1',$3,'+14125550100','B line','assigned','admin-b@example.invalid',
      'PN3333','claim-b1', clock_timestamp() + interval '1 day')`, [APP, A, B]);
});
after(async () => db?.close());

async function as(n, sql, params = []) {
  await db.exec('begin');
  try {
    await db.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({
      sub: uid(n), session_id: sid(n), role: 'authenticated',
      exp: Math.floor(Date.now() / 1000) + 3600,
    })]);
    await db.exec('set local role authenticated');
    const { rows } = await db.query(sql, params);
    await db.exec('rollback');
    return rows[0].result;
  } catch (error) { await db.exec('rollback'); throw error; }
}
const refuses = (promise, code) => assert.rejects(promise, error => {
  assert.match(error.message, new RegExp(code));
  return true;
});

test('the pool is an agency_admin\'s own, newest first', async () => {
  const answer = await as(ADMIN_A, LIST, [A, 500]);
  assert.equal(answer.success, true);
  // Agency B's number is newer than both of A's, so if the tenancy were the
  // caller's claim rather than the policy's it would be first in this list.
  assert.deepEqual(answer.entries.map(row => row.id), ['pn-a2', 'pn-a1']);
  assert.equal(answer.entries[1].assigned_to_email, 'clinician-a@example.invalid');
  assert.equal(answer.entries[1].twilio_phone_number_sid, 'PN1111');
});

test('a clinician is refused, because the original admits only the platform tier', async () => {
  // D40 replaces `role === 'admin'` with ONE role. A `manager` or a clinician
  // is not a successor, it is a new performer.
  await refuses(as(CLINICIAN_A, LIST, [A, 500]), 'PENNSYNC_PHONE_NUMBER_FORBIDDEN');
  await refuses(as(ADMIN_B, LIST, [A, 500]), 'PENNSYNC_PHONE_NUMBER_FORBIDDEN');
  // And agency B's own administrator sees agency B's number and nothing else.
  assert.deepEqual((await as(ADMIN_B, LIST, [B, 500])).entries.map(row => row.id), ['pn-b1']);
});

test('the claim token is not projected, because it is a credential', async () => {
  // Its own description: "Server-generated inventory creation owner for exact
  // lost-acknowledgement recovery." It is one of the reasons D16's ceiling
  // refuses this entity on its own account, and nothing in the panel reads it.
  const [row] = (await as(ADMIN_A, LIST, [A, 500])).entries;
  assert.equal(Object.hasOwn(row, 'creation_claim_token'), false);
  assert.equal(JSON.stringify(row).includes('claim-a'), false);
});

test('the limit is re-applied in SQL, because a bound a caller could raise is not one', async () => {
  const wide = await as(ADMIN_A, LIST, [A, 100000]);
  assert.ok(wide.entries.length <= 500);
  assert.equal((await as(ADMIN_A, LIST, [A, 1])).entries.length, 1);
  assert.equal((await as(ADMIN_A, LIST, [A, 0])).entries.length, 1, 'zero floors to one');
  assert.equal((await as(ADMIN_A, LIST, [A, null])).entries.length, 2, 'null takes the default');
});

test('NOTHING in this family writes a number, and this fails if one appears', async () => {
  // D39's shape: a capability with no performer left is recorded as an absence
  // and the absence is asserted. Do not add an assign, release or provision
  // path here until a decision records who may move a number — and buying one
  // is the owner's, not a contract's.
  const { rows } = await db.query(`select p.proname
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
    where ns.nspname in ('pennsync_records','public')
      and (p.proname like '%phone_number%' or p.proname like '%work_number%')
    order by p.proname`);
  assert.deepEqual(rows.map(row => row.proname), [
    'contract_phone_number_list',
    'pennsync_contract_phone_number_list',
    'phone_number_row',
  ]);
  // And no contract anywhere writes the table, which the function names alone
  // would not establish — a differently named contract could still insert.
  const dir = new URL('../supabase/record-migrations/', import.meta.url);
  const writes = [];
  for (const name of (await readdir(dir)).filter(file => file.endsWith('.sql')).sort()) {
    const sql = await readFile(new URL(name, dir), 'utf8');
    const body = sql.replace(/^\s*--.*$/gm, '');
    if (/(insert into|update|delete from)\s+"pennsync_records"\."phone_number"/i.test(body)) {
      writes.push(name);
    }
  }
  assert.deepEqual(writes, []);
});
