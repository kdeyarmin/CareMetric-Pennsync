import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { applyRecordMigrations, assertNewestRecordMigration, recordMigrationNames }
  from './record-migrations.mjs';

const MIGRATION_NAME = '20260920690000_contract_physician_write.sql';

/**
 * The referral directory's three writes, against the real migration.
 *
 * Every case here drives a refusal by name or reads a column back field by
 * field. The gate cases are written as a PAIR each time -- the role that may
 * and a role that may not, in the same agency -- because a contract that
 * refused everybody would satisfy half of every gate assertion on its own.
 *
 * WHICH SURFACE EACH CASE PROVES, and which it does not. Every case here
 * enters at the contract function, as `authenticated`, which is the surface the
 * refusals are DECIDED on -- not at a helper below it. Asserting that
 * `physician_write_role` refuses a clinician would pass with no contract
 * calling it at all, which is the same defect one layer down.
 *
 * But a caller does not start here. It reaches this through a route, a handler
 * whose `exactObject` allowlist can refuse first, and the contract's declared
 * params -- so a refusal proved here is reachable only if nothing above it
 * refuses or admits wrongly. Nothing in THIS file establishes that, and the
 * chain is covered pairwise rather than end to end:
 *
 *   screen -> handler allowlist   `tools-handler-allowlist.test.mjs`
 *   handler -> contract params    `record-contracts.test.mjs`
 *   contract -> store             this file
 *
 * Three pairwise crosses are not one end-to-end call, and the difference is
 * worth naming rather than glossing: they prove each seam agrees with its
 * neighbour, not that a real request traverses all three. No test in this
 * repository does the latter for a record contract, because the handler
 * reaches the store over PostgREST.
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
  // This migration is the newest PENDING one, so the ordering guard is now
  // this suite's. It was `contract-compliance-writes.test.mjs`'s until that
  // file merged, and the read half's before that: the guard travels with the
  // newest pending migration rather than accumulating, because a suite over a
  // MERGED file asserting that nothing sorts after it refuses every correct
  // tree the next change produces. Retire the call here when this merges —
  // `assertNewestRecordMigration`'s own error text says so, and it is what it
  // says to do rather than widening it with an exception list.
  //
  // The whole-directory equality comes FIRST and is the assertion with the
  // teeth: `assertNewestRecordMigration` reads only the last name, so an
  // earlier forward migration silently missing from the applied set leaves an
  // incomplete store and still satisfies the ordering guard. The suite would
  // then be exercising this contract against a store no deployment gets.
  const applied = await applyRecordMigrations(db);
  assert.deepEqual(applied, await recordMigrationNames(),
    'the record directory and what was applied to this store disagree');
  assertNewestRecordMigration(applied, MIGRATION_NAME);
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

/**
 * A field's VALUE is checked, not only its name.
 *
 * Every case here reaches a declared refusal. Without the type check each one
 * reaches something else, and the something else is the finding: an object
 * under a text column is rendered by `->>` and STORED as `{}`, a non-boolean
 * raises `invalid_text_representation`, and a bad contact method raises the
 * table's own check violation — the first is silent corruption reported as
 * success and the other two are undeclared codes the HTTP boundary cannot
 * classify.
 *
 * The enum list is READ OUT OF THE MIGRATION rather than retyped here, because
 * the contract repeats the constraint's four values and a hand-kept third copy
 * is how the two drift apart while both suites stay green.
 */
test('a value of the wrong JSON type is refused before any write, by a declared code', async () => {
  const cases = [
    ['full_name', {}], ['full_name', []], ['fax_number', 7], ['specialty', true],
    ['accepts_hospice', 'maybe'], ['accepts_home_health', 1], ['is_active', 'yes'],
    ['tags', 'cardiology'], ['tags', {}],
    ['preferred_contact_method', 'carrier pigeon'], ['preferred_contact_method', 4],
  ];
  for (const [field, value] of cases) {
    const why = await refusal(() => call(ADMIN_A, CREATE,
      [A, { full_name: 'Dr V', fax_number: '555-9', [field]: value }]));
    assert.match(why, /PENNSYNC_PHYSICIAN_VALUE_INVALID/,
      `${field} = ${JSON.stringify(value)} was not refused as an invalid value`);
    // The update path shares the helper, so it must answer identically rather
    // than by a different route that happens to also refuse.
    const onUpdate = await refusal(() => call(ADMIN_A, UPDATE,
      [A, 'phys-a1', 'profile', { [field]: value }, null]));
    assert.match(onUpdate, /PENNSYNC_PHYSICIAN_VALUE_INVALID/,
      `${field} = ${JSON.stringify(value)} was accepted on update`);
  }

  // A JSON null is not a bad value: clearing a field is a legitimate edit and
  // every one of these columns is nullable. This is the half a type check
  // written from the refusals alone would get wrong.
  for (const field of ['specialty', 'accepts_hospice', 'tags', 'preferred_contact_method']) {
    const cleared = await call(ADMIN_A, UPDATE, [A, 'phys-a1', 'profile', { [field]: null }, null]);
    assert.equal(cleared.success, true, `${field} could not be cleared`);
  }

  // And the valid values still pass, so the check is not simply refusing the
  // column. A test that only drives refusals cannot tell those apart.
  const ok = await call(ADMIN_A, CREATE, [A, {
    full_name: 'Dr W', fax_number: '555-8', accepts_hospice: true,
    tags: ['cardiology', 'referring'], preferred_contact_method: 'email',
  }]);
  assert.equal(ok.success, true);
});

test('the contract\'s contact-method list is the one the table constrains', async () => {
  const sql = await readFile(new URL(`../supabase/record-migrations/${MIGRATION_NAME}`,
    import.meta.url), 'utf8');
  const store = await readFile(new URL(
    '../supabase/record-migrations/20260919170000_record_store.sql', import.meta.url), 'utf8');
  const constraint = store.match(
    /"physician_preferred_contact_method_allowed" check \([^)]*in \(([^)]*)\)/);
  assert.ok(constraint, 'the physician contact-method constraint is not where this test looks');
  const allowed = [...constraint[1].matchAll(/'([^']+)'/g)].map(m => m[1]).sort();
  const inContract = [...sql.matchAll(
    /p_fields->>v_field not in \(([^)]*)\)/g)].flatMap(m =>
    [...m[1].matchAll(/'([^']+)'/g)].map(x => x[1])).sort();
  assert.deepEqual(inContract, allowed,
    'the contract pre-checks a different set of contact methods than the table allows,\n'
    + '  so one of them refuses a value the other permits. Change both together.');
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

test("D40's gate is EACH contract's own: update and delete refuse the roles create does", async () => {
  // This case exists because the suite passed without it while the gate was
  // removed from `update` and `delete` outright. The create test above named
  // D40 and proved it at ONE entry point; the other two were assumed. A gate
  // helper called by three functions is proved by three callers or by none --
  // dropping either `perform physician_write_role` left all nine tests green,
  // and a clinician could have edited or deleted any provider in the agency.
  //
  // So the sabotage has to enter where the refusal is DECIDED. Asserting
  // `physician_write_role` refuses a clinician would pass with no contract
  // calling it at all, which is the same defect one layer down.
  const before = await rowOf('phys-a1');
  for (const who of [CLINICIAN_A, UNASSIGNED_A]) {
    for (const [what, run] of [
      ['profile', () => call(who, UPDATE, [A, 'phys-a1', 'profile', { specialty: 'x' }, null])],
      ['record_referral', () => call(who, UPDATE, [A, 'phys-a1', 'record_referral', null, null])],
      ['delete', () => call(who, DELETE, [A, 'phys-a1'])],
    ]) {
      assert.match(await refusal(run), /PENNSYNC_PHYSICIAN_WRITE_FORBIDDEN/,
        `role ${who} was admitted to ${what}`);
    }
  }
  // And the row is untouched by every one of those refusals, because a gate
  // that raises after the write would satisfy the assertions above.
  // Compared against a read taken just above rather than against the seed: an
  // earlier committing case increments this row, so a seed constant here would
  // be asserting the order the tests happen to run in.
  const still = await rowOf('phys-a1');
  assert.equal(still.referral_count, before.referral_count);
  assert.equal(still.specialty, before.specialty);
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
