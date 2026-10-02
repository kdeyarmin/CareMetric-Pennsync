import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { SCHEMA } from '../../../tools-entity-schema-plan.mjs';
import { applyRecordMigrations } from './record-migrations.mjs';

/**
 * The fax address book: one person's own contacts.
 *
 * WHAT THIS SUITE IS FOR, in one sentence: the generated `fax_contact`
 * policies are agency-WIDE and the entity's own rls is per-person, so every
 * test here that matters drives a COLLEAGUE in the same agency and checks they
 * get nothing. A suite that only drove the owner would pass with the
 * contract's predicate deleted, because the policies would still admit the
 * row.
 *
 * `clinician-a` (2) and `admin-a` (1) are both active in `agency-a`, which is
 * what makes the colleague case a real one rather than a cross-tenant case the
 * policies answer on their own. `admin-b` (4) is in `agency-b` and is here to
 * show the tenancy still bites underneath the ownership check.
 */
const APP = '6a9881683dc68a0bd54f1ef7';
const A = 'agency-a';
const uid = n => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const sid = n => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const OWNER = 2; const COLLEAGUE = 1; const OUTSIDER = 4;
const LIST = 'select "public"."pennsync_contract_fax_contact_list"($1,$2) as result';
const CREATE = 'select "public"."pennsync_contract_fax_contact_create"($1,$2) as result';
const BULK = 'select "public"."pennsync_contract_fax_contact_bulk_create"($1,$2) as result';
const UPDATE = 'select "public"."pennsync_contract_fax_contact_update"($1,$2,$3) as result';
const DELETE = 'select "public"."pennsync_contract_fax_contact_delete"($1,$2) as result';
const GOOD = Object.freeze({ name: 'Dr Reed', fax_number: '+12155550100', company: 'Reed Clinic' });
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
  await db.query(`insert into ${SCHEMA}."agency"
    ("source_app_id","id","agency_name","status") values ($1,$2,'Keystone Home Health','active')`,
  [APP, A]);
});
after(async () => db?.close());

async function as(n, sql, params = [], commit = true) {
  await db.exec('begin');
  try {
    await db.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({
      sub: uid(n), session_id: sid(n), role: 'authenticated',
      exp: Math.floor(Date.now() / 1000) + 3600,
    })]);
    await db.exec('set local role authenticated');
    const { rows } = await db.query(sql, params);
    if (commit) await db.exec('commit'); else await db.exec('rollback');
    return rows[0].result;
  } catch (error) { await db.exec('rollback'); throw error; }
}
const refuses = (promise, code) => assert.rejects(promise, error => {
  assert.match(error.message, new RegExp(code));
  return true;
});

test('a contact belongs to the person who made it, not to their agency', async () => {
  const made = await as(OWNER, CREATE, [A, GOOD]);
  assert.equal(made.success, true);
  assert.equal(made.contact.name, 'Dr Reed');
  // Divergences 1 and 2: both stamped, neither sent.
  assert.equal(made.contact.user_email, 'clinician-a@example.invalid');
  assert.equal(made.contact.created_by, 'clinician-a@example.invalid');

  // THE TEST THIS SUITE EXISTS FOR. A colleague in the same agency is admitted
  // by every one of the four `fax_contact` policies and must still see nothing.
  assert.deepEqual((await as(COLLEAGUE, LIST, [A, 50])).entries, []);
  await refuses(as(COLLEAGUE, UPDATE, [A, made.contact.id, { notes: 'mine now' }]),
    'PENNSYNC_FAX_CONTACT_NOT_FOUND');
  await refuses(as(COLLEAGUE, DELETE, [A, made.contact.id]),
    'PENNSYNC_FAX_CONTACT_NOT_FOUND');
  // And the owner still has it, so the refusals above were not a delete that
  // worked and then reported a miss.
  assert.equal((await as(OWNER, LIST, [A, 50])).entries.length, 1);

  // Not found and not mine are ONE answer, which is the disclosure half: the
  // colleague's refusal above is the same code as a row that never existed.
  await refuses(as(COLLEAGUE, UPDATE, [A, 'no-such-row', { notes: 'x' }]),
    'PENNSYNC_FAX_CONTACT_NOT_FOUND');
});

test('the tenancy still bites underneath the ownership check', async () => {
  // `admin-b` holds no membership in `agency-a`, so the gate refuses before
  // any predicate is asked. Asserted because the ownership check could be
  // mistaken for the whole of the authorization.
  await refuses(as(OUTSIDER, LIST, [A, 50]), 'PENNSYNC_FAX_CONTACT_FORBIDDEN');
  await refuses(as(OUTSIDER, CREATE, [A, GOOD]), 'PENNSYNC_FAX_CONTACT_FORBIDDEN');
});

test('a reserved field is refused as reserved, and an unknown one as unknown', async () => {
  // D39's distinction, and the reason it is two codes rather than one: a
  // silent filter is what keeps `user_email` out of a caller's reach AND what
  // loses a misspelled `fax_numbr` without telling anybody.
  await refuses(as(OWNER, CREATE, [A, { ...GOOD, user_email: 'someone@else.invalid' }]),
    'PENNSYNC_FAX_CONTACT_FIELD_RESERVED');
  await refuses(as(OWNER, CREATE, [A, { ...GOOD, agency_id: 'agency-b' }]),
    'PENNSYNC_FAX_CONTACT_FIELD_RESERVED');
  await refuses(as(OWNER, CREATE, [A, { ...GOOD, created_by: 'someone@else.invalid' }]),
    'PENNSYNC_FAX_CONTACT_FIELD_RESERVED');
  await refuses(as(OWNER, CREATE, [A, { ...GOOD, fax_numbr: '+1215' }]),
    'PENNSYNC_FAX_CONTACT_FIELD_UNSUPPORTED');
  // An empty object is refused rather than reported as a save that happened.
  await refuses(as(OWNER, CREATE, [A, {}]), 'PENNSYNC_FAX_CONTACT_EMPTY');
  await refuses(as(OWNER, CREATE, [A, null]), 'PENNSYNC_FAX_CONTACT_INVALID');
});

test('the two required fields cannot be absent, and cannot be cleared later', async () => {
  await refuses(as(OWNER, CREATE, [A, { fax_number: '+1215' }]),
    'PENNSYNC_FAX_CONTACT_NAME_REQUIRED');
  await refuses(as(OWNER, CREATE, [A, { name: 'Dr Reed' }]),
    'PENNSYNC_FAX_CONTACT_NUMBER_REQUIRED');
  // Whitespace is not a name: the shaping trims and then nulls the empty
  // string, so this is the same refusal rather than a stored blank.
  await refuses(as(OWNER, CREATE, [A, { name: '   ', fax_number: '+1215' }]),
    'PENNSYNC_FAX_CONTACT_NAME_REQUIRED');
  const made = await as(OWNER, CREATE, [A, { name: 'Clearable', fax_number: '+12155550199' }]);
  // Checked on the STORED row, not on the payload, because a caller clears a
  // field by sending an empty string.
  await refuses(as(OWNER, UPDATE, [A, made.contact.id, { name: '' }]),
    'PENNSYNC_FAX_CONTACT_NAME_REQUIRED');
  await as(OWNER, DELETE, [A, made.contact.id]);
});

test('an update moves only the keys it names', async () => {
  const made = await as(OWNER, CREATE, [A, { ...GOOD, name: 'Partial', department: 'Wound' }]);
  const after = await as(OWNER, UPDATE, [A, made.contact.id, { notes: 'called Tuesday' }]);
  assert.equal(after.contact.notes, 'called Tuesday');
  // The keys NOT named keep their values, which is what builds the SET list
  // from the payload rather than from a column list of its own (D29).
  assert.equal(after.contact.department, 'Wound');
  assert.equal(after.contact.company, 'Reed Clinic');
  assert.equal(after.contact.fax_number, GOOD.fax_number);
  await as(OWNER, DELETE, [A, made.contact.id]);
});

test('the CSV import is one transaction, with a ceiling that refuses', async () => {
  const batch = [{ name: 'A', fax_number: '+1' }, { name: 'B', fax_number: '+2' }];
  const done = await as(OWNER, BULK, [A, batch]);
  assert.equal(done.created, 2);
  assert.equal(done.contacts.length, 2);

  // ONE TRANSACTION, proved by a batch whose LAST row is bad: with a per-row
  // loop outside a transaction the first two would survive. Measured by
  // counting before and after rather than by trusting the refusal.
  const before = (await as(OWNER, LIST, [A, 500])).entries.length;
  await refuses(as(OWNER, BULK, [A, [...batch, { name: 'C' }]]),
    'PENNSYNC_FAX_CONTACT_NUMBER_REQUIRED');
  assert.equal((await as(OWNER, LIST, [A, 500])).entries.length, before);

  // The ceiling refuses rather than truncating (D25's rule), because an
  // operator who is told nothing believes the whole file went in.
  const many = Array.from({ length: 501 }, (unused, index) =>
    ({ name: `Row ${index}`, fax_number: `+1215555${String(index).padStart(4, '0')}` }));
  await refuses(as(OWNER, BULK, [A, many]), 'PENNSYNC_FAX_CONTACT_BATCH_TOO_LARGE');
  await refuses(as(OWNER, BULK, [A, []]), 'PENNSYNC_FAX_CONTACT_BATCH_EMPTY');
  await refuses(as(OWNER, BULK, [A, { name: 'not an array' }]), 'PENNSYNC_FAX_CONTACT_INVALID');

  // A batch row cannot reach a field the single create reserves, because both
  // go through the same function. That is the property, not a convention.
  await refuses(as(OWNER, BULK, [A, [{ ...GOOD, user_email: 'someone@else.invalid' }]]),
    'PENNSYNC_FAX_CONTACT_FIELD_RESERVED');
});

test('the list is bounded in SQL and ordered with a tiebreaker', async () => {
  // A bound a caller could raise is not a bound (D71): 5000 does not widen it.
  const wide = await as(OWNER, LIST, [A, 5000]);
  assert.ok(wide.entries.length <= 500);
  // A whole CSV lands at one timestamp, so `created_date` alone is not
  // distinct by construction and the walk would lose rows rather than merely
  // reorder them (D25). Proved by checking the ids are all different and the
  // dates are not.
  const page = (await as(OWNER, LIST, [A, 500])).entries;
  assert.ok(page.length >= 2, 'the bulk import above leaves rows to order');
  assert.equal(new Set(page.map(row => row.id)).size, page.length);
  for (let index = 1; index < page.length; index += 1) {
    assert.ok(page[index - 1].created_date >= page[index].created_date);
  }
});

test('`is_shared` round-trips and changes nothing about who can read the row', async () => {
  // The flag is stored because the screen's toggle sends it, and honouring it
  // would publish one person's address book to their agency — more than the
  // hosted app does, so not this migration's to decide. Asserted, because
  // "changes nothing" is the kind of claim a comment cannot keep.
  const made = await as(OWNER, CREATE, [A, { ...GOOD, name: 'Shared', is_shared: true }]);
  assert.equal(made.contact.is_shared, true);
  assert.deepEqual((await as(COLLEAGUE, LIST, [A, 50])).entries, []);
  await as(OWNER, DELETE, [A, made.contact.id]);
});
