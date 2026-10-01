import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { SCHEMA } from '../../../tools-entity-schema-plan.mjs';
import { applyRecordMigrations, recordMigrationNames } from './record-migrations.mjs';

// The migration this suite owns. It is no longer the newest on this tree, so the
// ordering guard has moved on and this suite asserts only that its own file ran.
const WRITES_FORWARD = '20260920700000_contract_reference_writes.sql';

/**
 * The writes for three reference tables whose reads ship in
 * `20260920570000_contract_reference_reads.sql` (D101).
 *
 * The gate is the only decision in the port and it is D40's: all three entity
 * schemas gate `create`, `update` and `delete` on the built-in `role: admin`
 * that D14 and D22 removed, so the successor is an `agency_admin` in their own
 * agency. This suite reads that claim out of the three `.jsonc` files rather
 * than restating it, because the interesting half is where the claim comes
 * from: `TemplateLibrary.jsx` writes `library_document` with NO client-side
 * gate at all, so a port that read the gate off the screen would have found
 * none and shipped these writes open to every member of the agency.
 *
 * Three refusals here are narrowings rather than ports and each has a test:
 * `library_document.file_url` is refused because the file copy has not run
 * (D77), `document_template.is_system_template` is reserved because setting it
 * publishes a row to every agency, and `LibraryDocument.create` is absent
 * because its entity REQUIRES the locator this contract refuses.
 *
 * What this suite cannot prove is the same as its sibling's: PGlite is one
 * connection, so nothing here establishes a concurrency property, and every
 * case enters at the contract as `authenticated` rather than through a route
 * and a handler — those seams are crossed pairwise elsewhere.
 */
const repository = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const MIGRATION = '20260920700000_contract_reference_writes.sql';
const MIGRATION_PATH = `services/authority-store/supabase/record-migrations/${MIGRATION}`;
const APP = '6a9881683dc68a0bd54f1ef7';
const uid = n => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const sid = n => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ADMIN_A = 1; const CLINICIAN_A = 2; const ADMIN_B = 4;
const A = 'agency-a'; const B = 'agency-b';
let db;

before(async () => {
  db = new PGlite();
  await db.exec(await readFile(new URL('./bootstrap.sql', import.meta.url), 'utf8'));
  const dir = new URL('../supabase/migrations/', import.meta.url);
  for (const name of (await readdir(dir)).filter(file => file.endsWith('.sql')).sort()) {
    await db.exec(await readFile(new URL(name, dir), 'utf8'));
  }
  // The WHOLE record directory, in the order a deployment applies it, and the
  // half of the check this suite still holds: that what was applied is the
  // directory, so a file added beside this one cannot be silently skipped.
  //
  // The ORDERING guard has LEFT this suite again, and the round trip is still
  // the lesson rather than the bookkeeping. It belongs to whichever migration is
  // the newest PENDING one, and this branch adds one that sorts after this file,
  // so the holder is `contract-timesheet-review-approver.test.mjs`. A file takes
  // the guard by being newest and loses it by being OVERTAKEN; the helper's error
  // text names merging, which is only the commonest cause. It is never held by
  // two suites at once, because the second holder asserts a tree the first one's
  // own change makes false — which is why retiring the call here is part of the
  // same change that adds the newer migration, not a follow-up.
  //
  // Retiring it is NOT asserting nothing. The set equality below pins the two
  // lists EQUAL and implies no MEMBERSHIP, so the `includes` is the only thing
  // left that fails if this suite's own migration is renamed out from under it.
  const applied = await applyRecordMigrations(db);
  assert.deepEqual(applied, await recordMigrationNames(),
    'the record directory and what was applied to this store disagree');
  assert.ok(applied.includes(WRITES_FORWARD),
    `the record walk did not apply ${WRITES_FORWARD}`);
  await db.exec(await readFile(new URL('./fixtures.sql', import.meta.url), 'utf8'));
  await seed();
});
after(async () => db?.close());

async function seed() {
  await db.exec(`
    insert into ${SCHEMA}.on_call_shift
      (source_app_id,id,agency_id,shift_date,coverage_type) values
      ('${APP}','shift-a','${A}','2026-03-15','overnight'),
      ('${APP}','shift-b','${B}','2026-03-10','overnight');
    insert into ${SCHEMA}.library_document
      (source_app_id,id,agency_id,title,file_url,is_active,created_date) values
      ('${APP}','lib-1','${A}','Wound care handout','https://base44.app/storage/lib-1.pdf',true,'2026-01-01T00:00:00Z'),
      ('${APP}','lib-2','${A}','Fall prevention','cmfile:11111111-2222-4333-8444-555555555555',true,'2026-01-02T00:00:00Z'),
      ('${APP}','lib-b','${B}','Their handout','https://base44.app/storage/lib-b.pdf',true,'2026-01-03T00:00:00Z');
    insert into ${SCHEMA}.document_template
      (source_app_id,id,agency_id,template_name,category,content,is_system_template,created_date) values
      ('${APP}','tpl-own','${A}','Our own template','consent','Hi',false,'2026-01-01T00:00:00Z'),
      ('${APP}','tpl-system','${B}','A published system template','consent','Hi',true,'2026-01-02T00:00:00Z'),
      ('${APP}','tpl-theirs','${B}','Another agency template','consent','Hi',false,'2026-01-03T00:00:00Z');
  `);
}

async function as(n, sql, params = []) {
  await db.exec('begin');
  try {
    await db.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({
      sub: uid(n), session_id: sid(n), role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600,
    })]);
    await db.exec('set local role authenticated');
    const { rows } = await db.query(sql, params);
    await db.exec('commit');
    return rows[0];
  } catch (error) { await db.exec('rollback'); throw error; }
}

const call = async (who, name, params) => {
  const holes = params.map((_, index) => `$${index + 1}`).join(',');
  const row = await as(who, `select "public"."pennsync_contract_${name}"(${holes}) as result`, params);
  return row.result;
};
const refusal = (promise, code) => assert.rejects(promise, error => {
  assert.match(String(error?.message ?? error), new RegExp(code));
  return true;
}, `expected ${code}`);

/** Every capability this file adds, so each gate is proved once per contract. */
const EVERY = Object.freeze([
  ['on_call_shift_save', agency => [agency, null, { shift_date: '2026-05-01', coverage_type: 'overnight' }]],
  ['on_call_shift_delete', agency => [agency, 'shift-a']],
  ['library_document_update', agency => [agency, 'lib-1', { title: 'x' }]],
  ['library_document_delete', agency => [agency, 'lib-1']],
  ['document_template_save', agency => [agency, null, { template_name: 'T', category: 'consent', content: 'c' }]],
  ['document_template_delete', agency => [agency, 'tpl-own']],
]);

test('the gate is an agency_admin in their own agency, on every capability', async () => {
  for (const [name, args] of EVERY) {
    // A member who is not an administrator: the agency is held, so the
    // refusal has to be the ROLE and not the tenancy.
    await refusal(call(CLINICIAN_A, name, args(A)), 'PENNSYNC_REFERENCE_FORBIDDEN');
    // An administrator of another agency, asking about this one. The refusal is
    // AGENCY_NOT_HELD rather than FORBIDDEN, because an empty answer or a role
    // refusal would both confirm the agency exists.
    await refusal(call(ADMIN_B, name, args(A)), 'PENNSYNC_REFERENCE_AGENCY_NOT_HELD');
  }
});

test('the gate the port substitutes for is the one the entity schemas declare', () => {
  // D40 applies where a capability's ONLY gate is the built-in `role: admin`.
  // Read that from the schemas rather than restating it: if one of these ever
  // declares a different condition, the substitution stops being automatic and
  // this port owes a decision instead of a test.
  for (const entity of ['OnCallShift', 'LibraryDocument', 'DocumentTemplate']) {
    const source = readFileSync(resolve(repository, `base44/entities/${entity}.jsonc`), 'utf8');
    const schema = JSON.parse(source.replace(/^\s*\/\/.*$/gmu, ''));
    for (const operation of ['create', 'update', 'delete']) {
      assert.deepEqual(schema.rls?.[operation], { user_condition: { role: 'admin' } },
        `${entity}.${operation} no longer gates on the built-in admin tier`);
    }
  }
});

test('an on-call shift is created, updated and deleted by an agency admin', async () => {
  const created = await call(ADMIN_A, 'on_call_shift_save', [A, null, {
    shift_date: '2026-06-01', coverage_type: 'holiday', holiday_name: 'Juneteenth',
    start_label: '5pm', end_label: '8am',
    assigned_user_email: 'nurse@a.test', assigned_user_name: 'A Nurse', notes: 'covering',
  }]);
  assert.equal(created.created, true);
  assert.equal(created.shift.holiday_name, 'Juneteenth');
  assert.equal(created.shift.agency_id, A);
  // Stamped by the contract, never taken from the payload.
  assert.ok(created.shift.id);
  assert.ok(created.shift.created_by);

  const updated = await call(ADMIN_A, 'on_call_shift_save', [A, created.shift.id, {
    assigned_user_email: 'other@a.test', notes: 'swapped',
  }]);
  assert.equal(updated.created, false);
  assert.equal(updated.shift.assigned_user_email, 'other@a.test');
  // An absent key means UNCHANGED on an update, which is not the same question
  // a create asks: the holiday name the create set is still there.
  assert.equal(updated.shift.holiday_name, 'Juneteenth');

  const deleted = await call(ADMIN_A, 'on_call_shift_delete', [A, created.shift.id]);
  assert.deepEqual(deleted, { deleted: true, id: created.shift.id });
  await refusal(call(ADMIN_A, 'on_call_shift_delete', [A, created.shift.id]),
    'PENNSYNC_ON_CALL_NOT_FOUND');
});

test('another agency\'s row is NOT_FOUND rather than forbidden, on all three tables', async () => {
  // The caller holds their own agency, so the role gate passes and the
  // PREDICATE is what refuses. Naming the agency in the predicate is what makes
  // this true: `caller_agencies()` returns every agency the caller holds (D51).
  await refusal(call(ADMIN_A, 'on_call_shift_save', [A, 'shift-b', { notes: 'x' }]),
    'PENNSYNC_ON_CALL_NOT_FOUND');
  await refusal(call(ADMIN_A, 'on_call_shift_delete', [A, 'shift-b']), 'PENNSYNC_ON_CALL_NOT_FOUND');
  await refusal(call(ADMIN_A, 'library_document_update', [A, 'lib-b', { title: 'x' }]),
    'PENNSYNC_LIBRARY_NOT_FOUND');
  await refusal(call(ADMIN_A, 'library_document_delete', [A, 'lib-b']), 'PENNSYNC_LIBRARY_NOT_FOUND');
  await refusal(call(ADMIN_A, 'document_template_save', [A, 'tpl-theirs', { content: 'x' }]),
    'PENNSYNC_DOC_TEMPLATE_NOT_FOUND');
  await refusal(call(ADMIN_A, 'document_template_delete', [A, 'tpl-theirs']),
    'PENNSYNC_DOC_TEMPLATE_NOT_FOUND');
});

test('a library document is toggled and deleted, and its locator goes out RESOLVED', async () => {
  // `lib-1` holds a Base44 URL and `lib-2` an owned handle. The read beside this
  // contract resolves both through `resolve_file_locator`; a write that answered
  // with the stored column would hand back the Base44 URL the migration exists
  // to replace, and the browser would fetch it.
  const toggled = await call(ADMIN_A, 'library_document_update', [A, 'lib-1', { is_active: false }]);
  assert.equal(toggled.updated, true);
  assert.equal(toggled.document.is_active, false);
  assert.equal(toggled.document.file_url, null, 'an unmapped Base44 locator resolves to null');
  const owned = await call(ADMIN_A, 'library_document_update', [A, 'lib-2', { is_active: false }]);
  assert.equal(owned.document.file_url, 'cmfile:11111111-2222-4333-8444-555555555555');

  const deleted = await call(ADMIN_A, 'library_document_delete', [A, 'lib-2']);
  assert.deepEqual(deleted, { deleted: true, id: 'lib-2' });
});

test('library_document.file_url is refused BY NAME, and there is no create at all', async () => {
  // The narrowing, and the whole of the partial port. The entity makes
  // `file_url` required, so refusing it is what makes a create impossible --
  // emitting one that always refused would read as a capability rather than as
  // the file layer's absence. When the copy has run, all three move together.
  await refusal(call(ADMIN_A, 'library_document_update', [A, 'lib-1', {
    file_url: 'https://base44.app/storage/other.pdf',
  }]), 'PENNSYNC_LIBRARY_FIELD_UNKNOWN');
  const { rows } = await db.query(
    `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname like '%library_document%create%'`);
  assert.deepEqual(rows, [], 'a LibraryDocument create wrapper exists; the header says there is none');
  assert.equal(
    JSON.parse(readFileSync(resolve(repository, 'base44/entities/LibraryDocument.jsonc'), 'utf8')
      .replace(/^\s*\/\/.*$/gmu, '')).required.includes('file_url'), true,
    'the entity no longer requires file_url, so the reason this create is absent has changed');
});

test('is_system_template is reserved, and a system template is out of reach entirely', async () => {
  // Reserved rather than merely ungated: the table's own insert, update and
  // delete policies refuse a true, and its READ admits such a row to every
  // agency. So setting it publishes your template to the whole deployment.
  await refusal(call(ADMIN_A, 'document_template_save', [A, null, {
    template_name: 'T', category: 'consent', content: 'c', is_system_template: true,
  }]), 'PENNSYNC_DOC_TEMPLATE_FIELD_RESERVED');
  await refusal(call(ADMIN_A, 'document_template_save', [A, 'tpl-own', { is_system_template: true }]),
    'PENNSYNC_DOC_TEMPLATE_FIELD_RESERVED');
  // `tpl-system` belongs to agency B, and an administrator of A can READ it --
  // the read policy admits a system template to everyone. So a contract that
  // filtered on tenancy alone would find it. Asking for it as B's OWN admin is
  // the sharper case: the tenancy is right and the row is still out of reach.
  await refusal(call(ADMIN_B, 'document_template_save', [B, 'tpl-system', { content: 'x' }]),
    'PENNSYNC_DOC_TEMPLATE_NOT_FOUND');
  await refusal(call(ADMIN_B, 'document_template_delete', [B, 'tpl-system']),
    'PENNSYNC_DOC_TEMPLATE_NOT_FOUND');
});

test('a created template carries the entity schema\'s own defaults', async () => {
  // The record store is GENERATED and emits no column default, so a create
  // through a contract writes null where Base44 wrote false, 0 or true. These
  // are read out of the entity schema rather than typed here (D12).
  const schema = JSON.parse(
    readFileSync(resolve(repository, 'base44/entities/DocumentTemplate.jsonc'), 'utf8')
      .replace(/^\s*\/\/.*$/gmu, ''));
  const created = await call(ADMIN_A, 'document_template_save', [A, null, {
    template_name: 'Defaults', category: 'consent', content: 'body',
  }]);
  assert.equal(created.created, true);
  for (const [field, property] of Object.entries(schema.properties)) {
    if (!('default' in property) || field === 'is_system_template') continue;
    assert.equal(created.template[field], property.default,
      `${field} did not take the default its entity schema declares`);
  }
  // Written by the contract and not inherited: a null here would read to the
  // insert policy as a row it admits by accident.
  assert.equal(created.template.is_system_template, false);
  // The caller's value always wins over a default.
  const chosen = await call(ADMIN_A, 'document_template_save', [A, null, {
    template_name: 'Chosen', category: 'consent', content: 'body', auto_suggest_materials: false,
  }]);
  assert.equal(chosen.template.auto_suggest_materials, false);
});

test('a value of the wrong type is refused before any write', async () => {
  // The name check answers about KEYS only. Without the populate-record catch a
  // string where the date belongs reaches the insert as an error the HTTP
  // boundary cannot classify.
  await refusal(call(ADMIN_A, 'on_call_shift_save', [A, null, {
    shift_date: 'the fifteenth', coverage_type: 'overnight',
  }]), 'PENNSYNC_ON_CALL_FIELD_INVALID');
  await refusal(call(ADMIN_A, 'library_document_update', [A, 'lib-1', { is_active: 'yes please' }]),
    'PENNSYNC_LIBRARY_FIELD_INVALID');
  // And a value the COLUMN constrains, which the type check cannot see.
  await refusal(call(ADMIN_A, 'on_call_shift_save', [A, null, {
    shift_date: '2026-06-02', coverage_type: 'whenever',
  }]), 'PENNSYNC_ON_CALL_FIELD_INVALID');
  await refusal(call(ADMIN_A, 'document_template_save', [A, null, {
    template_name: 'T', category: 'not a category', content: 'c',
  }]), 'PENNSYNC_DOC_TEMPLATE_FIELD_INVALID');
  // Nothing was written by any of the four.
  const { rows } = await db.query(
    `select count(*)::int as n from ${SCHEMA}.on_call_shift where shift_date = '2026-06-02'`);
  assert.equal(rows[0].n, 0);
});

test('an unknown key is refused by name rather than dropped, and an empty payload refuses', async () => {
  // D39: a misspelled column fails loudly instead of disappearing.
  await refusal(call(ADMIN_A, 'on_call_shift_save', [A, 'shift-a', { note: 'singular' }]),
    'PENNSYNC_ON_CALL_FIELD_UNKNOWN');
  await refusal(call(ADMIN_A, 'document_template_save', [A, 'tpl-own', { templatename: 'x' }]),
    'PENNSYNC_DOC_TEMPLATE_FIELD_UNKNOWN');
  await refusal(call(ADMIN_A, 'on_call_shift_save', [A, 'shift-a', {}]), 'PENNSYNC_ON_CALL_FIELDS_EMPTY');
  // And the columns the contract decides, on every one of the three.
  await refusal(call(ADMIN_A, 'on_call_shift_save', [A, 'shift-a', { agency_id: B }]),
    'PENNSYNC_ON_CALL_FIELD_RESERVED');
  await refusal(call(ADMIN_A, 'library_document_update', [A, 'lib-1', { created_by: 'x@y.test' }]),
    'PENNSYNC_LIBRARY_FIELD_RESERVED');
  await refusal(call(ADMIN_A, 'document_template_save', [A, 'tpl-own', { id: 'other' }]),
    'PENNSYNC_DOC_TEMPLATE_FIELD_RESERVED');
});

test('a create missing a required field refuses, and an update of one does not', async () => {
  await refusal(call(ADMIN_A, 'on_call_shift_save', [A, null, { notes: 'no date' }]),
    'PENNSYNC_ON_CALL_(DATE|COVERAGE)_REQUIRED');
  await refusal(call(ADMIN_A, 'document_template_save', [A, null, { template_name: 'T' }]),
    'PENNSYNC_DOC_TEMPLATE_(CATEGORY|CONTENT)_REQUIRED');
  // An update names only what changes: requiring the whole set would make the
  // screens' partial edits impossible.
  const updated = await call(ADMIN_A, 'document_template_save', [A, 'tpl-own', { content: 'new body' }]);
  assert.equal(updated.template.content, 'new body');
  assert.equal(updated.template.template_name, 'Our own template');
});

test('an empty or null id is this contract\'s refusal and not a lookup miss', async () => {
  // Driven because the code-coverage test below found all three of these raised
  // and driven by nothing -- which is what it is for. An empty string is the
  // shape a form sends when its hidden id never got set, and it must not read
  // as "create" (the saves take null for that) nor fall through to a NOT_FOUND
  // that would have the screen report a row somebody else deleted.
  await refusal(call(ADMIN_A, 'on_call_shift_save', [A, '', { notes: 'x' }]),
    'PENNSYNC_ON_CALL_ID_INVALID');
  await refusal(call(ADMIN_A, 'on_call_shift_delete', [A, '']), 'PENNSYNC_ON_CALL_ID_INVALID');
  await refusal(call(ADMIN_A, 'on_call_shift_delete', [A, null]), 'PENNSYNC_ON_CALL_ID_INVALID');
  await refusal(call(ADMIN_A, 'library_document_update', [A, '', { title: 'x' }]),
    'PENNSYNC_LIBRARY_ID_INVALID');
  await refusal(call(ADMIN_A, 'library_document_update', [A, null, { title: 'x' }]),
    'PENNSYNC_LIBRARY_ID_INVALID');
  await refusal(call(ADMIN_A, 'library_document_delete', [A, '']), 'PENNSYNC_LIBRARY_ID_INVALID');
  await refusal(call(ADMIN_A, 'document_template_save', [A, '', { content: 'x' }]),
    'PENNSYNC_DOC_TEMPLATE_ID_INVALID');
  await refusal(call(ADMIN_A, 'document_template_delete', [A, '']),
    'PENNSYNC_DOC_TEMPLATE_ID_INVALID');
});

test('every wrapper is closed to anon and service_role and open to authenticated', async () => {
  // PostgreSQL grants EXECUTE to PUBLIC on every new function, and a wrapper is
  // `security invoker`, so the grant on IT is what decides reach. This exact
  // omission shipped on the migration before this one.
  const { rows } = await db.query(`
    select p.proname,
      has_function_privilege('anon', p.oid, 'execute') as anon,
      has_function_privilege('service_role', p.oid, 'execute') as service,
      has_function_privilege('authenticated', p.oid, 'execute') as auth
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = any($1)`,
  [EVERY.map(([name]) => `pennsync_contract_${name}`)]);
  assert.equal(rows.length, EVERY.length, 'a wrapper this suite names does not exist');
  for (const row of rows) {
    assert.equal(row.anon, false, `${row.proname} is executable by anon`);
    assert.equal(row.service, false, `${row.proname} is executable by service_role`);
    assert.equal(row.auth, true, `${row.proname} is not executable by authenticated`);
  }
});

test('the projections name every column, and a new one does not leak into an answer', async () => {
  // D64, bitten on the SHAPE of the mistake rather than on a list of columns:
  // `to_jsonb(row)` would carry the next column the product adds.
  await db.exec(`alter table ${SCHEMA}.on_call_shift add column probe_secret text`);
  await db.exec(`alter table ${SCHEMA}.library_document add column probe_secret text`);
  await db.exec(`alter table ${SCHEMA}.document_template add column probe_secret text`);
  try {
    await db.exec(`update ${SCHEMA}.on_call_shift set probe_secret = 'leaked' where id = 'shift-a'`);
    const shift = await call(ADMIN_A, 'on_call_shift_save', [A, 'shift-a', { notes: 'x' }]);
    assert.equal('probe_secret' in shift.shift, false);
    const document = await call(ADMIN_A, 'library_document_update', [A, 'lib-1', { title: 'y' }]);
    assert.equal('probe_secret' in document.document, false);
    const template = await call(ADMIN_A, 'document_template_save', [A, 'tpl-own', { content: 'z' }]);
    assert.equal('probe_secret' in template.template, false);
    // And the new column is not writable either, which is the other half: an
    // allowlist that grew with the table would have been no allowlist.
    await refusal(call(ADMIN_A, 'on_call_shift_save', [A, 'shift-a', { probe_secret: 'x' }]),
      'PENNSYNC_ON_CALL_FIELD_UNKNOWN');
  } finally {
    await db.exec(`alter table ${SCHEMA}.on_call_shift drop column probe_secret`);
    await db.exec(`alter table ${SCHEMA}.library_document drop column probe_secret`);
    await db.exec(`alter table ${SCHEMA}.document_template drop column probe_secret`);
  }
});

test('every refusal code the migration raises is one this suite has driven', () => {
  // The population is what the file RAISES -- `message='CODE'` -- and not every
  // PENNSYNC_ token in it. A first version matched the token, which swept up the
  // three PREFIX literals the shared field checker composes its codes from
  // (`'PENNSYNC_ON_CALL'` is passed as an argument and raised by nothing), and
  // reported them as codes nothing raises. Bind the matcher to the claim.
  const sql = readFileSync(resolve(repository, MIGRATION_PATH), 'utf8');
  const raised = new Set([...sql.matchAll(/message='(PENNSYNC_[A-Z_]+)'/gu)].map(m => m[1]));
  // The store-shape guards refuse before any contract exists, so they are not
  // this suite's to drive; everything else is a refusal a caller can provoke.
  const guards = new Set([
    'PENNSYNC_REFERENCE_WRITES_REQUIRE_RECORD_STORE',
    'PENNSYNC_RECORD_OWNER_MUST_NOT_BYPASS_RLS',
    'PENNSYNC_RECORD_OWNER_NOT_ASSUMABLE',
  ]);
  const driven = new Set([...readFileSync(
    fileURLToPath(import.meta.url), 'utf8').matchAll(/'(PENNSYNC_[A-Z_]+)[^']*'/gu)].map(m => m[1]));
  for (const code of raised) {
    if (guards.has(code)) continue;
    assert.equal(driven.has(code), true, `${code} is raised by the migration and driven by no test here`);
  }
  // The other half: the three prefixes the shared checker composes FIELD_UNKNOWN,
  // FIELD_RESERVED and FIELDS_EMPTY from are passed, so those codes exist at all.
  for (const prefix of ['PENNSYNC_ON_CALL', 'PENNSYNC_LIBRARY', 'PENNSYNC_DOC_TEMPLATE']) {
    assert.equal(sql.includes(`'${prefix}');`) || sql.includes(`'${prefix}', p_id is null);`), true,
      `${prefix} is not passed to the shared field checker`);
  }
});
