import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { applyRecordMigrations } from './record-migrations.mjs';

/**
 * The referral directory's three writes, against the real migration.
 *
 * Every case here drives a refusal by name or reads a column back field by
 * field. The gate cases are written as a PAIR each time -- the role that may
 * and a role that may not, in the same agency -- because a contract that
 * refused everybody would satisfy half of every gate assertion on its own.
 *
 * The increment is the case worth reading. PGlite is ONE connection and cannot
 * interleave two callers, so this suite CANNOT prove the concurrency property
 * D78 is about; what it proves is the weaker thing that is actually the port's
 * claim -- that the new count is read from the ROW rather than supplied by the
 * caller. Two increments with no count sent must reach 2. That is falsifiable
 * (a contract taking the caller's number could not do it) and it is honest
 * about what a single-connection harness can see.
 */
const APP = '6a9881683dc68a0bd54f1ef7';
const uid = n => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const sid = n => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ADMIN_A = 1; const CLINICIAN_A = 2; const UNASSIGNED_A = 3; const ADMIN_B = 4;
const A = 'agency-a'; const B = 'agency-b';
let db;

const as = async (who) => {
  await db.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({
    sub: uid(who), session_id: sid(who), role: 'authenticated',
    exp: Math.floor(Date.now() / 1000) + 3600,
  })]);
  await db.exec('set local role authenticated');
};

/** Runs one contract call in its own transaction and rolls it back. */
const call = async (who, sql, args) => {
  await db.exec('begin');
  try {
    await as(who);
    const { rows } = await db.query(sql, args);
    return rows[0].answer;
  } finally { await db.exec('rollback'); }
};

/** Like `call`, but KEEPS the write, for cases that read it back. */
const commit = async (who, sql, args) => {
  await db.exec('begin');
  try {
    await as(who);
    const { rows } = await db.query(sql, args);
    await db.exec('commit');
    return rows[0].answer;
  } catch (error) { await db.exec('rollback'); throw error; }
};

const CREATE = 'select pennsync_records.contract_physician_create($1,$2) as answer';
const UPDATE = 'select pennsync_records.contract_physician_update($1,$2,$3,$4,$5) as answer';
const DELETE = 'select pennsync_records.contract_physician_delete($1,$2) as answer';

const refusal = async (fn) => {
  try { await fn(); return null; } catch (error) { return error.message; }
};

const rowOf = async (id) => {
  const { rows } = await db.query(
    'select * from pennsync_records.physician where id = $1', [id]);
  return rows[0];
};

before(async () => {
  db = new PGlite();
  await db.exec(await readFile(new URL('./bootstrap.sql', import.meta.url), 'utf8'));
  const dir = new URL('../supabase/migrations/', import.meta.url);
  for (const name of (await readdir(dir)).filter(f => f.endsWith('.sql')).sort()) {
    await db.exec(await readFile(new URL(name, dir), 'utf8'));
  }
  await applyRecordMigrations(db);
  await db.exec(await readFile(new URL('./fixtures.sql', import.meta.url), 'utf8'));
  await db.exec(`
    insert into pennsync_records.physician
      (source_app_id, id, agency_id, full_name, fax_number, referral_count, is_active)
    values ('${APP}','phys-a1','${A}','Dr Ada Byron','555-0001', 3, true),
           ('${APP}','phys-a2','${A}','Dr Grace Hopper','555-0002', null, true),
           ('${APP}','phys-b1','${B}','Dr Katherine Johnson','555-0003', 0, true);
  `);
});

after(async () => { await db?.close(); });

test('D40: an agency_admin creates, and the roles the original never admitted cannot', async () => {
  const made = await call(ADMIN_A, CREATE, [A, { full_name: 'Dr New', fax_number: '555-9' }]);
  assert.equal(made.success, true);
  assert.equal(typeof made.id, 'string');

  for (const who of [CLINICIAN_A, UNASSIGNED_A]) {
    const why = await refusal(() =>
      call(who, CREATE, [A, { full_name: 'Dr No', fax_number: '555-0' }]));
    assert.match(why, /PENNSYNC_PHYSICIAN_WRITE_FORBIDDEN/, `role ${who} was admitted`);
  }
  // An agency_admin of ANOTHER agency is refused on this one: the gate asks
  // about the agency in the envelope, not about the caller's own tenancy.
  const cross = await refusal(() =>
    call(ADMIN_B, CREATE, [A, { full_name: 'Dr No', fax_number: '555-0' }]));
  assert.match(cross, /PENNSYNC_PHYSICIAN_WRITE_FORBIDDEN/);
});

test('an unknown field is REFUSED by name, not filtered away (D39)', async () => {
  const why = await refusal(() => call(ADMIN_A, CREATE,
    [A, { full_name: 'Dr X', fax_number: '555-1', expiration_date: '2027-01-01' }]));
  assert.match(why, /PENNSYNC_PHYSICIAN_FIELD_UNSUPPORTED/);

  // The fields the contract decides, not the caller, are refused the same way
  // rather than silently ignored -- the point of the rule is that a misspelled
  // field and a forbidden one both say so.
  for (const field of ['id', 'agency_id', 'created_by', 'referral_count', 'last_referral_date']) {
    const refused = await refusal(() => call(ADMIN_A, CREATE,
      [A, { full_name: 'Dr X', fax_number: '555-1', [field]: 'whatever' }]));
    assert.match(refused, /PENNSYNC_PHYSICIAN_FIELD_UNSUPPORTED/, `${field} was accepted`);
  }
});

test('the schema\'s required pair is required as keys, and an empty fax still saves', async () => {
  for (const fields of [{ fax_number: '555-2' }, { full_name: 'Dr Y' }]) {
    const why = await refusal(() => call(ADMIN_A, CREATE, [A, fields]));
    assert.match(why, /PENNSYNC_PHYSICIAN_REQUIRED_MISSING/);
  }
  // The form validates only the name and submits `fax_number: ''`. Refusing
  // that would break a save that works today, so it is admitted on purpose.
  const made = await call(ADMIN_A, CREATE, [A, { full_name: 'Dr Y', fax_number: '' }]);
  assert.equal(made.success, true);
});

test('a profile update writes the keys supplied and leaves every other column alone', async () => {
  const before = await rowOf('phys-a1');
  await commit(ADMIN_A, UPDATE, [A, 'phys-a1', 'profile', { specialty: 'Cardiology' }, null]);
  const after = await rowOf('phys-a1');
  assert.equal(after.specialty, 'Cardiology');
  // The columns the caller did not name are untouched, INCLUDING the two the
  // contract reserves -- a SET list built from a column list rather than from
  // the supplied keys is what would null these.
  assert.equal(after.full_name, before.full_name);
  assert.equal(after.fax_number, before.fax_number);
  assert.equal(after.referral_count, before.referral_count);
  assert.equal(after.is_active, before.is_active);
  assert.notEqual(after.updated_date, null);
});

test('an empty profile patch and an unknown action are both refused', async () => {
  const empty = await refusal(() => call(ADMIN_A, UPDATE, [A, 'phys-a1', 'profile', {}, null]));
  assert.match(empty, /PENNSYNC_PHYSICIAN_WRITE_EMPTY/);
  for (const action of ['increment', '', 'PROFILE', 'constructor']) {
    const why = await refusal(() => call(ADMIN_A, UPDATE, [A, 'phys-a1', action, {}, null]));
    assert.match(why, /PENNSYNC_PHYSICIAN_ACTION_UNKNOWN/, `action ${action} was accepted`);
  }
});

test('record_referral counts in SQL: the caller sends no number and two calls reach two', async () => {
  const first = await commit(ADMIN_A, UPDATE, [A, 'phys-a1', 'record_referral', null, '2026-09-29']);
  assert.equal(first.referral_count, 4, 'the seeded 3 plus one');
  const second = await commit(ADMIN_A, UPDATE, [A, 'phys-a1', 'record_referral', null, '2026-09-30']);
  assert.equal(second.referral_count, 5);
  const row = await rowOf('phys-a1');
  assert.equal(Number(row.referral_count), 5);
  // The DATE is the caller's, deliberately: the original sends the operator's
  // local date and substituting `current_date` would move a late-evening
  // referral to the next day.
  assert.equal(row.last_referral_date.toISOString().slice(0, 10), '2026-09-30');
});

test('record_referral starts a null count at one rather than leaving it null', async () => {
  const answer = await commit(ADMIN_A, UPDATE, [A, 'phys-a2', 'record_referral', null, null]);
  assert.equal(answer.referral_count, 1);
  // A null date sent with the increment leaves the stored one alone rather than
  // clearing it.
  const row = await rowOf('phys-a2');
  assert.equal(row.last_referral_date, null);
});

test('a delete removes the row, and another agency\'s row is not reachable by either write', async () => {
  const gone = await commit(ADMIN_A, DELETE, [A, 'phys-a2']);
  assert.equal(gone.deleted, true);
  assert.equal(await rowOf('phys-a2'), undefined);

  // Deleting it again is NOT_FOUND rather than a silent success.
  const twice = await refusal(() => call(ADMIN_A, DELETE, [A, 'phys-a2']));
  assert.match(twice, /PENNSYNC_PHYSICIAN_NOT_FOUND/);

  // Agency B's provider is invisible to agency A's admin through every write,
  // and the refusal does not distinguish "not yours" from "not there".
  for (const fn of [
    () => call(ADMIN_A, DELETE, [A, 'phys-b1']),
    () => call(ADMIN_A, UPDATE, [A, 'phys-b1', 'profile', { specialty: 'x' }, null]),
    () => call(ADMIN_A, UPDATE, [A, 'phys-b1', 'record_referral', null, null]),
  ]) {
    assert.match(await refusal(fn), /PENNSYNC_PHYSICIAN_NOT_FOUND/);
  }
  assert.notEqual(await rowOf('phys-b1'), undefined, 'agency B\'s row survived');
});

test('the writable field list is one list, so create and update cannot drift', async () => {
  const { rows } = await db.query('select pennsync_records.physician_writable_fields() as f');
  const fields = rows[0].f;
  // Read from the SQL rather than retyped: the assertion is that the two
  // contracts share it, and the list's own membership is the migration's.
  assert.ok(fields.includes('full_name') && fields.includes('is_active'));
  for (const reserved of ['id', 'agency_id', 'created_by', 'created_date',
    'updated_date', 'referral_count', 'last_referral_date', 'source_app_id']) {
    assert.ok(!fields.includes(reserved), `${reserved} is caller-writable`);
  }
});
