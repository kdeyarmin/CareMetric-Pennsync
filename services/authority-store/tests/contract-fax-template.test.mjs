import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { SCHEMA } from '../../../tools-entity-schema-plan.mjs';
import { applyRecordMigrations } from './record-migrations.mjs';

/**
 * Saved fax cover pages: one person's own templates.
 *
 * Two things here are worth more than the CRUD. The ownership column is a
 * SINGLE one, because this entity's rls asks for one and carries no
 * `user_email` — so the colleague tests prove the same property as the address
 * book's by a different predicate, and a suite that copied the pair would be
 * asserting a column the table does not have.
 *
 * And the use counter is the divergence the ORIGINAL asked for in its own
 * words: "a fully correct fix needs an atomic server-side increment (a base44
 * function), which can't be added from src/". The test that matters drives two
 * increments through one stale read and checks both land, because that is
 * exactly what the browser's read-modify-write loses.
 */
const APP = '6a9881683dc68a0bd54f1ef7';
const A = 'agency-a';
const uid = n => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const sid = n => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const OWNER = 2; const COLLEAGUE = 1; const OUTSIDER = 4;
const LIST = 'select "public"."pennsync_contract_fax_template_list"($1,$2) as result';
const CREATE = 'select "public"."pennsync_contract_fax_template_create"($1,$2) as result';
const UPDATE = 'select "public"."pennsync_contract_fax_template_update"($1,$2,$3) as result';
const USE = 'select "public"."pennsync_contract_fax_template_use"($1,$2) as result';
const DELETE = 'select "public"."pennsync_contract_fax_template_delete"($1,$2) as result';
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

test('a template belongs to the person who made it, not to their agency', async () => {
  const made = await as(OWNER, CREATE, [A, { name: 'Referral cover', subject: 'Records' }]);
  assert.equal(made.template.name, 'Referral cover');
  assert.equal(made.template.created_by, 'clinician-a@example.invalid');
  assert.equal(made.template.use_count, 0);

  // The policies admit the colleague on all four operations; the contract does
  // not. Delete `created_by = v_email` and every line below fails.
  assert.deepEqual((await as(COLLEAGUE, LIST, [A, 50])).entries, []);
  await refuses(as(COLLEAGUE, UPDATE, [A, made.template.id, { subject: 'mine' }]),
    'PENNSYNC_FAX_TEMPLATE_NOT_FOUND');
  await refuses(as(COLLEAGUE, USE, [A, made.template.id]), 'PENNSYNC_FAX_TEMPLATE_NOT_FOUND');
  await refuses(as(COLLEAGUE, DELETE, [A, made.template.id]), 'PENNSYNC_FAX_TEMPLATE_NOT_FOUND');
  assert.equal((await as(OWNER, LIST, [A, 50])).entries.length, 1);
  await refuses(as(OUTSIDER, LIST, [A, 50]), 'PENNSYNC_FAX_TEMPLATE_FORBIDDEN');
});

test('the use counter increments in the database, which is what the original asked for', async () => {
  const made = await as(OWNER, CREATE, [A, { name: 'Counted' }]);
  // The browser's shape: read the row ONCE, then bump twice from that stale
  // value. Its own comment says "concurrent applies can still lose an
  // increment"; both land here because the arithmetic is the database's.
  const stale = made.template;
  assert.equal(stale.use_count, 0);
  await as(OWNER, USE, [A, stale.id]);
  const after = await as(OWNER, USE, [A, stale.id]);
  assert.equal(after.template.use_count, 2);

  // `use_count` is RESERVED on both writes, so the lost update is not
  // reachable by another route.
  await refuses(as(OWNER, CREATE, [A, { name: 'x', use_count: 9 }]),
    'PENNSYNC_FAX_TEMPLATE_FIELD_RESERVED');
  await refuses(as(OWNER, UPDATE, [A, stale.id, { use_count: 9 }]),
    'PENNSYNC_FAX_TEMPLATE_FIELD_RESERVED');

  // And using a template is not editing it: `updated_date` does not move, or a
  // template somebody applied would read as one somebody changed.
  assert.equal(after.template.updated_date, stale.updated_date);
  await as(OWNER, DELETE, [A, stale.id]);
});

test('the three document columns are refused, not quietly dropped', async () => {
  // Measured rather than assumed: nothing in `src/` writes or reads a
  // template's document, `document_url` is a storage locator (D71, D77), and a
  // caller asking for one is asking for something the product does not store.
  for (const field of ['document_url', 'document_name', 'cover_page_data']) {
    await refuses(as(OWNER, CREATE, [A, { name: 'x', [field]: 'anything' }]),
      'PENNSYNC_FAX_TEMPLATE_FIELD_UNSUPPORTED');
  }
  // And none of them is projected, so a round trip cannot carry one back.
  const made = await as(OWNER, CREATE, [A, { name: 'Projected' }]);
  for (const field of ['document_url', 'document_name', 'cover_page_data']) {
    assert.equal(Object.hasOwn(made.template, field), false, field);
  }
  await as(OWNER, DELETE, [A, made.template.id]);
});

test('a reserved field, an unknown field and an empty body are three answers', async () => {
  await refuses(as(OWNER, CREATE, [A, { name: 'x', agency_id: 'agency-b' }]),
    'PENNSYNC_FAX_TEMPLATE_FIELD_RESERVED');
  await refuses(as(OWNER, CREATE, [A, { name: 'x', subjekt: 'typo' }]),
    'PENNSYNC_FAX_TEMPLATE_FIELD_UNSUPPORTED');
  await refuses(as(OWNER, CREATE, [A, {}]), 'PENNSYNC_FAX_TEMPLATE_EMPTY');
  await refuses(as(OWNER, CREATE, [A, null]), 'PENNSYNC_FAX_TEMPLATE_INVALID');
  await refuses(as(OWNER, CREATE, [A, { description: 'no name' }]),
    'PENNSYNC_FAX_TEMPLATE_NAME_REQUIRED');
  await refuses(as(OWNER, USE, [A, '']), 'PENNSYNC_FAX_TEMPLATE_ID_REQUIRED');
  await refuses(as(OWNER, DELETE, [A, null]), 'PENNSYNC_FAX_TEMPLATE_ID_REQUIRED');
});

test('two defaults are a state this contract allows, because the original does', async () => {
  // Not a gap: the form sets the checkbox, the list renders a badge, and no
  // code reads "the" default — so collapsing them would be a behaviour change
  // dressed as a fix. Asserted so that adding the collapse later is a visible
  // decision rather than a quiet one.
  const first = await as(OWNER, CREATE, [A, { name: 'Default one', is_default: true }]);
  const second = await as(OWNER, CREATE, [A, { name: 'Default two', is_default: true }]);
  assert.equal(first.template.is_default, true);
  assert.equal(second.template.is_default, true);
  const defaults = (await as(OWNER, LIST, [A, 50])).entries.filter(row => row.is_default);
  assert.equal(defaults.length, 2);
  await as(OWNER, DELETE, [A, first.template.id]);
  await as(OWNER, DELETE, [A, second.template.id]);
});
