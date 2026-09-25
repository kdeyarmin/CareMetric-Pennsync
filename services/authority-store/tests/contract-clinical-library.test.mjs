import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { SCHEMA } from '../../../tools-entity-schema-plan.mjs';

/**
 * The clinical library, patient education and per-agency configuration:
 * fourteen contracts over seven entities the frontend reached DIRECTLY.
 *
 * There is no Base44 original to drive, so there is no parity to pin and the
 * thing worth testing is the authorization each entity's `rls` block asked for
 * and the narrowings the port takes on top. Every case below is a REFUSAL or a
 * row somebody cannot see; the happy paths are here only to prove the refusals
 * are not passing because nothing works.
 *
 * The identities come from `fixtures.sql`: 1 is `agency_admin` in agency A, 2
 * is a clinician in A assigned to `patient-a1`, 3 is a clinician in A on no
 * chart at all, and 4 is `agency_admin` in agency B.
 */
const repository = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const MIGRATION = 'services/authority-store/supabase/record-migrations/'
  + '20260920570000_contract_clinical_library.sql';
const APP = '6a9881683dc68a0bd54f1ef7';
const A = 'agency-a';
const B = 'agency-b';
const ADMIN_A = 1; const CLINICIAN_A = 2; const CLINICIAN_NO_CHART = 3; const ADMIN_B = 4;
const uid = n => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const sid = n => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const EMAIL = Object.freeze({
  1: 'admin-a@example.invalid', 2: 'clinician-a@example.invalid',
  3: 'clinician-empty@example.invalid', 4: 'admin-b@example.invalid',
});
let db;

before(async () => {
  db = new PGlite();
  await db.exec(await readFile(new URL('./bootstrap.sql', import.meta.url), 'utf8'));
  for (const directory of ['../supabase/migrations/', '../supabase/record-migrations/']) {
    const dir = new URL(directory, import.meta.url);
    for (const name of (await readdir(dir)).filter(file => file.endsWith('.sql')).sort()) {
      await db.exec(await readFile(new URL(name, dir), 'utf8'));
    }
  }
  await db.exec(await readFile(new URL('./fixtures.sql', import.meta.url), 'utf8'));
  for (const [id, name] of [[A, 'Keystone Home Health'], [B, 'Allegheny Care Partners']]) {
    await db.query(`insert into ${SCHEMA}."agency"
      ("source_app_id","id","agency_name","status") values ($1,$2,$3,'active')`, [APP, id, name]);
  }
  // Two charts in agency A. Clinician 2 is on the first and nobody is on the
  // second, which is what separates D24's narrowing from plain tenancy.
  await db.query(`insert into ${SCHEMA}."patient"
    ("source_app_id","id","agency_id","first_name") values ($1,'patient-a1',$2,'Ann'),
    ($1,'patient-a2',$2,'Bea')`, [APP, A]);
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
    await db.exec('commit');
    return rows[0].result;
  } catch (error) { await db.exec('rollback'); throw error; }
}
const call = (n, fn, args) => as(n,
  `select "public"."${fn}"(${args.map((_, i) => `$${i + 1}`).join(',')}) as result`, args);
const refusal = (promise, code) => assert.rejects(promise, error => {
  assert.match(String(error?.message ?? error), new RegExp(code));
  return true;
}, `expected ${code}`);
const ids = answer => answer.entries.map(row => row.id);

test('a pathway is read by any member and written by the agency administrator alone', async () => {
  const made = await call(ADMIN_A, 'pennsync_contract_clinical_pathway_write',
    [A, 'create', null, JSON.stringify({ pathway_name: 'CHF', is_active: true })]);
  assert.equal(made.created, true);
  assert.equal(made.row.agency_id, A);
  // The contract stamps the author; the caller never chooses it.
  assert.equal(made.row.created_by, EMAIL[ADMIN_A]);
  assert.ok(made.row.id && !Object.hasOwn(made.row, 'source_app_id'));

  // The READ is open, because two of the four call sites are a clinician's.
  assert.deepEqual(ids(await call(CLINICIAN_A,
    'pennsync_contract_clinical_pathway_list', [A, true, null])), [made.row.id]);
  // The WRITE is not. The original gave a client neither, so this is the
  // narrow half of one decision rather than a rule ported from anywhere.
  await refusal(call(CLINICIAN_A, 'pennsync_contract_clinical_pathway_write',
    [A, 'create', null, JSON.stringify({ pathway_name: 'X' })]), 'PENNSYNC_PATHWAY_FORBIDDEN');
  // Another agency's administrator is not one of ours.
  await refusal(call(ADMIN_B, 'pennsync_contract_clinical_pathway_list', [A, true, null]),
    'PENNSYNC_PATHWAY_AGENCY_NOT_HELD');
  await refusal(call(ADMIN_B, 'pennsync_contract_clinical_pathway_write',
    [A, 'create', null, JSON.stringify({ pathway_name: 'X' })]), 'PENNSYNC_PATHWAY_FORBIDDEN');

  const gone = await call(ADMIN_A, 'pennsync_contract_clinical_pathway_write',
    [A, 'delete', made.row.id, null]);
  assert.equal(gone.deleted, true);
  await refusal(call(ADMIN_A, 'pennsync_contract_clinical_pathway_write',
    [A, 'delete', made.row.id, null]), 'PENNSYNC_PATHWAY_NOT_FOUND');
});

test('a field outside the table is refused rather than filtered, and so is a reserved one', async () => {
  // D39's rule. A silent filter is what keeps a misspelled column from ever
  // being noticed, and the reserved set is what stops a payload choosing its
  // own tenant, id or author.
  await refusal(call(ADMIN_A, 'pennsync_contract_clinical_pathway_write',
    [A, 'create', null, JSON.stringify({ pathway_nmae: 'typo' })]),
  'PENNSYNC_PATHWAY_FIELD_UNKNOWN');
  for (const reserved of ['agency_id', 'id', 'source_app_id', 'created_date', 'updated_date']) {
    await refusal(call(ADMIN_A, 'pennsync_contract_clinical_pathway_write',
      [A, 'create', null, JSON.stringify({ [reserved]: B })]),
    'PENNSYNC_PATHWAY_FIELD_RESERVED');
  }
  // `created_by` is the one reserved column a payload may name, and only as
  // self-assertion: four call sites send the caller's own address.
  await refusal(call(ADMIN_A, 'pennsync_contract_clinical_pathway_write',
    [A, 'create', null, JSON.stringify({ pathway_name: 'Y', created_by: EMAIL[ADMIN_B] })]),
  'PENNSYNC_PATHWAY_CREATED_BY_FORBIDDEN');
  const own = await call(ADMIN_A, 'pennsync_contract_clinical_pathway_write',
    [A, 'create', null, JSON.stringify({ pathway_name: 'Y', created_by: EMAIL[ADMIN_A] })]);
  assert.equal(own.row.created_by, EMAIL[ADMIN_A]);
  await refusal(call(ADMIN_A, 'pennsync_contract_clinical_pathway_write',
    [A, 'update', own.row.id, JSON.stringify({})]), 'PENNSYNC_PATHWAY_FIELDS_EMPTY');
  await refusal(call(ADMIN_A, 'pennsync_contract_clinical_pathway_write',
    [A, 'update', own.row.id, null]), 'PENNSYNC_PATHWAY_FIELDS_INVALID');
  await refusal(call(ADMIN_A, 'pennsync_contract_clinical_pathway_write',
    [A, 'upsert', own.row.id, JSON.stringify({ pathway_name: 'Z' })]),
  'PENNSYNC_PATHWAY_ACTION_INVALID');
  await refusal(call(ADMIN_A, 'pennsync_contract_clinical_pathway_write',
    [A, 'update', 'no such id!', JSON.stringify({ pathway_name: 'Z' })]),
  'PENNSYNC_PATHWAY_ID_INVALID');
});

test('a library template belongs to its author, because the policies are agency-wide', async () => {
  // D36 and D45: tenancy is not ownership. `clinical_library_template`'s
  // policies put a row in the caller's agency and say nothing about whose it
  // is, and the entity's own `rls` block is `is_agency_wide OR created_by =
  // {{user.email}}`. Trusting the policies would let anybody in the agency
  // rewrite anybody else's phrases.
  const mine = await call(CLINICIAN_A, 'pennsync_contract_clinical_library_template_write',
    [A, 'create', null, JSON.stringify({ phrase: 'wound care', is_active: true })]);
  assert.equal(mine.row.created_by, EMAIL[CLINICIAN_A]);
  assert.deepEqual(ids(await call(CLINICIAN_A,
    'pennsync_contract_clinical_library_template_list', [A, null, null])), [mine.row.id]);
  // A colleague in the same agency sees nothing and may change nothing.
  assert.deepEqual(ids(await call(CLINICIAN_NO_CHART,
    'pennsync_contract_clinical_library_template_list', [A, null, null])), []);
  await refusal(call(CLINICIAN_NO_CHART, 'pennsync_contract_clinical_library_template_write',
    [A, 'update', mine.row.id, JSON.stringify({ phrase: 'hijacked' })]),
  'PENNSYNC_LIBRARY_TEMPLATE_FORBIDDEN');
  // D40's administrator succeeds the `role: 'admin'` branch of the same block.
  const edited = await call(ADMIN_A, 'pennsync_contract_clinical_library_template_write',
    [A, 'update', mine.row.id, JSON.stringify({ phrase: 'edited' })]);
  assert.equal(edited.row.phrase, 'edited');
  assert.deepEqual(ids(await call(ADMIN_A,
    'pennsync_contract_clinical_library_template_list', [A, null, null])), [mine.row.id]);
  // An agency-wide template is everybody's to read and still not theirs to edit.
  const shared = await call(CLINICIAN_A, 'pennsync_contract_clinical_library_template_write',
    [A, 'create', null, JSON.stringify({ phrase: 'shared', is_agency_wide: true })]);
  assert.ok(ids(await call(CLINICIAN_NO_CHART,
    'pennsync_contract_clinical_library_template_list', [A, null, null]))
    .includes(shared.row.id));
  await refusal(call(CLINICIAN_NO_CHART, 'pennsync_contract_clinical_library_template_write',
    [A, 'delete', shared.row.id, null]), 'PENNSYNC_LIBRARY_TEMPLATE_FORBIDDEN');
  // A row in another agency is NOT FOUND, never FORBIDDEN: an id must not be
  // testable for existence across a tenant boundary.
  await refusal(call(ADMIN_B, 'pennsync_contract_clinical_library_template_write',
    [B, 'update', mine.row.id, JSON.stringify({ phrase: 'x' })]),
  'PENNSYNC_LIBRARY_TEMPLATE_NOT_FOUND');
});

test('the chart a row names may be chosen and never moved', async () => {
  // `patient_id` is the only column on either table that decides who may see
  // the row, so an update that moved it would hand a row to a different care
  // team with nothing else about it changed.
  const bound = await call(CLINICIAN_A, 'pennsync_contract_clinical_library_template_write',
    [A, 'create', null, JSON.stringify({ phrase: 'chart bound', patient_id: 'patient-a1' })]);
  assert.equal(bound.row.patient_id, 'patient-a1');
  await refusal(call(CLINICIAN_A, 'pennsync_contract_clinical_library_template_write',
    [A, 'update', bound.row.id, JSON.stringify({ patient_id: 'patient-a2' })]),
  'PENNSYNC_LIBRARY_TEMPLATE_FIELD_RESERVED');
  // And a chart the caller does not open cannot be chosen either. The policy
  // is what refuses it; the contract's job is that the refusal arrives as a
  // code the HTTP boundary can classify rather than as `new row violates row
  // level security policy` (D33's rule about the raw duplicate-key error).
  await refusal(call(CLINICIAN_A, 'pennsync_contract_clinical_library_template_write',
    [A, 'create', null, JSON.stringify({ phrase: 'other chart', patient_id: 'patient-a2' })]),
  'PENNSYNC_LIBRARY_TEMPLATE_FORBIDDEN');
});

test('a folder follows the template rule, and its own display order', async () => {
  const first = await call(CLINICIAN_A, 'pennsync_contract_clinical_library_folder_write',
    [A, 'create', null, JSON.stringify({ name: 'Second', order: 2, is_agency_wide: true })]);
  const second = await call(CLINICIAN_A, 'pennsync_contract_clinical_library_folder_write',
    [A, 'create', null, JSON.stringify({ name: 'First', order: 1, is_agency_wide: true })]);
  // `order` ascending is what `ClinicalLibraryManager` asks for, and it is the
  // only ordering this contract offers.
  assert.deepEqual(ids(await call(CLINICIAN_A,
    'pennsync_contract_clinical_library_folder_list', [A, null])),
  [second.row.id, first.row.id]);
  await refusal(call(CLINICIAN_NO_CHART, 'pennsync_contract_clinical_library_folder_write',
    [A, 'update', first.row.id, JSON.stringify({ name: 'x' })]),
  'PENNSYNC_LIBRARY_FOLDER_FORBIDDEN');
});

test('an unpublished education material is the administrator\'s alone', async () => {
  // `rls.read` is `is_published OR role admin`, so the read splits and every
  // write is D40's `agency_admin`.
  const published = await call(ADMIN_A, 'pennsync_contract_education_material_write',
    [A, 'create', null, JSON.stringify({ title: 'Wound care', is_published: true })]);
  const draft = await call(ADMIN_A, 'pennsync_contract_education_material_write',
    [A, 'create', null, JSON.stringify({ title: 'Draft', is_published: false })]);
  assert.deepEqual(ids(await call(CLINICIAN_A,
    'pennsync_contract_education_material_list', [A, false, null])), [published.row.id]);
  const seen = ids(await call(ADMIN_A, 'pennsync_contract_education_material_list', [A, false, null]));
  assert.ok(seen.includes(draft.row.id) && seen.includes(published.row.id));
  // `published_only` is what the two `filter({ is_published: true })` call
  // sites mean, and it narrows the administrator's view too.
  assert.deepEqual(ids(await call(ADMIN_A,
    'pennsync_contract_education_material_list', [A, true, null])), [published.row.id]);
  // `PersonalizedMaterialSender` bumps `usage_count` after a send and its own
  // comment says a clinician's bump is denied and must not fail the send. That
  // behaviour is preserved rather than fixed.
  await refusal(call(CLINICIAN_A, 'pennsync_contract_education_material_write',
    [A, 'update', published.row.id, JSON.stringify({ usage_count: 1 })]),
  'PENNSYNC_EDUCATION_MATERIAL_FORBIDDEN');
});

test('a patient education assignment is the chart\'s, and the chart alone decides', async () => {
  // The table has NO `agency_id`: every policy on it reaches the `patient` row
  // it names. So there is no role gate here at all — adding one could only
  // subtract members of the care team the capability exists for — and a row
  // naming no patient is invisible to everyone, this contract included.
  const filed = await call(CLINICIAN_A, 'pennsync_contract_patient_education_write',
    [A, 'create', null, JSON.stringify({
      patient_id: 'patient-a1', status: 'assigned', assigned_date: '2026-09-25',
    })]);
  assert.equal(filed.row.patient_id, 'patient-a1');
  assert.deepEqual(ids(await call(CLINICIAN_A,
    'pennsync_contract_patient_education_list', [A, 'patient-a1', null])), [filed.row.id]);
  // A colleague in the same agency who is on no chart sees nothing and files
  // nothing. `office_staff` open no chart either, which is why this contract
  // does not need to name them.
  assert.deepEqual(ids(await call(CLINICIAN_NO_CHART,
    'pennsync_contract_patient_education_list', [A, 'patient-a1', null])), []);
  await refusal(call(CLINICIAN_NO_CHART, 'pennsync_contract_patient_education_write',
    [A, 'create', null, JSON.stringify({ patient_id: 'patient-a1', status: 'assigned' })]),
  'PENNSYNC_PATIENT_EDUCATION_FORBIDDEN');
  // An assignment is dismissed by moving its status, which is what the enum's
  // `dismissed` is for. `delete` is refused by name: no call site performs one
  // and a record of what a patient was taught is not a row a screen removes.
  const dismissed = await call(CLINICIAN_A, 'pennsync_contract_patient_education_write',
    [A, 'update', filed.row.id, JSON.stringify({ status: 'dismissed' })]);
  assert.equal(dismissed.row.status, 'dismissed');
  await refusal(call(CLINICIAN_A, 'pennsync_contract_patient_education_write',
    [A, 'delete', filed.row.id, null]), 'PENNSYNC_PATIENT_EDUCATION_ACTION_INVALID');
  // The chart must be named on a create and cannot move afterwards.
  await refusal(call(CLINICIAN_A, 'pennsync_contract_patient_education_write',
    [A, 'create', null, JSON.stringify({ status: 'assigned' })]),
  'PENNSYNC_PATIENT_EDUCATION_SUBJECT_INVALID');
  await refusal(call(CLINICIAN_A, 'pennsync_contract_patient_education_write',
    [A, 'update', filed.row.id, JSON.stringify({ patient_id: 'patient-a2' })]),
  'PENNSYNC_PATIENT_EDUCATION_FIELD_RESERVED');
  await refusal(call(CLINICIAN_A, 'pennsync_contract_patient_education_list', [A, null, null]),
    'PENNSYNC_PATIENT_EDUCATION_SUBJECT_INVALID');
});

test('a validation rule is the agency administrator\'s to read as well as to write', async () => {
  // The only entity whose `rls` block is `role admin` on all four operations,
  // so D40 answers the whole of it — including the read.
  const rule = await call(ADMIN_A, 'pennsync_contract_validation_rule_write',
    [A, 'create', null, JSON.stringify({
      rule_name: 'MRN required', entity_type: 'patient', validation_type: 'required',
    })]);
  assert.deepEqual(ids(await call(ADMIN_A, 'pennsync_contract_validation_rule_list', [A, null])),
    [rule.row.id]);
  await refusal(call(CLINICIAN_A, 'pennsync_contract_validation_rule_list', [A, null]),
    'PENNSYNC_VALIDATION_RULE_FORBIDDEN');
  await refusal(call(CLINICIAN_A, 'pennsync_contract_validation_rule_write',
    [A, 'create', null, JSON.stringify({ rule_name: 'x' })]),
  'PENNSYNC_VALIDATION_RULE_FORBIDDEN');
  // The table's own enum still decides what a value may be.
  await refusal(call(ADMIN_A, 'pennsync_contract_validation_rule_write',
    [A, 'create', null, JSON.stringify({ rule_name: 'x', entity_type: 'referral' })]),
  'custom_validation_rule_entity_type_allowed');
});

test('one AI configuration table, two jobs, and neither save reaches the other\'s row', async () => {
  // `rls` is `data.user_email == {{user.email}} OR role admin`, and the two
  // screens over it mean different things by a row: `UserSettings` writes one
  // person's preferences keyed by `user_email`, `AIConfigurationManager`
  // writes the agency's settings with no `user_email` at all. `scope` is that
  // split made explicit.
  const mine = await call(CLINICIAN_A, 'pennsync_contract_ai_configuration_save',
    [A, 'mine', null, JSON.stringify({
      compliance_priority: 'medicare', user_email: EMAIL[CLINICIAN_A],
    })]);
  // The contract stamps the owner. Naming yourself is accepted and dropped,
  // which is what the screen sends on every save; naming anybody else is not.
  assert.equal(mine.row.user_email, EMAIL[CLINICIAN_A]);
  await refusal(call(CLINICIAN_A, 'pennsync_contract_ai_configuration_save',
    [A, 'mine', null, JSON.stringify({ user_email: EMAIL[ADMIN_A] })]),
  'PENNSYNC_AI_CONFIG_OWNER_FORBIDDEN');
  assert.deepEqual(ids(await call(CLINICIAN_A,
    'pennsync_contract_ai_configuration_read', [A, 'mine', null])), [mine.row.id]);
  // `ai_configuration`'s policies are agency-WIDE, so the ownership predicate
  // has to be the contract's own — D45's rule. A colleague sees nothing.
  assert.deepEqual(ids(await call(CLINICIAN_NO_CHART,
    'pennsync_contract_ai_configuration_read', [A, 'mine', null])), []);
  await refusal(call(CLINICIAN_NO_CHART, 'pennsync_contract_ai_configuration_save',
    [A, 'mine', mine.row.id, JSON.stringify({ compliance_priority: 'state' })]),
  'PENNSYNC_AI_CONFIG_OWNER_FORBIDDEN');

  // The agency scope is D40's administrator succeeding the platform tier.
  await refusal(call(CLINICIAN_A, 'pennsync_contract_ai_configuration_read', [A, 'agency', null]),
    'PENNSYNC_AI_CONFIG_FORBIDDEN');
  const setting = await call(ADMIN_A, 'pennsync_contract_ai_configuration_save',
    [A, 'agency', null, JSON.stringify({ setting_name: 'tone', description: 'house voice' })]);
  assert.equal(setting.row.user_email, null);
  // **The narrowing, and the point of the whole split.** D44's rule is to read
  // what the platform tier was structurally preventing: the owner it admitted
  // was remote from the agency, and an `agency_admin` is the colleague sitting
  // next to the person whose preferences these are. So the agency scope shows
  // the settings and NOT a nurse's own row, which no screen asks for.
  assert.deepEqual(ids(await call(ADMIN_A,
    'pennsync_contract_ai_configuration_read', [A, 'agency', null])), [setting.row.id]);
  // And the scopes cannot cross: neither save reaches the other's row.
  await refusal(call(ADMIN_A, 'pennsync_contract_ai_configuration_save',
    [A, 'mine', setting.row.id, JSON.stringify({ compliance_priority: 'state' })]),
  'PENNSYNC_AI_CONFIG_OWNER_FORBIDDEN');
  await refusal(call(ADMIN_A, 'pennsync_contract_ai_configuration_save',
    [A, 'agency', mine.row.id, JSON.stringify({ setting_name: 'x' })]),
  'PENNSYNC_AI_CONFIG_OWNER_FORBIDDEN');
  await refusal(call(ADMIN_A, 'pennsync_contract_ai_configuration_read', [A, 'everyone', null]),
    'PENNSYNC_AI_CONFIG_SCOPE_INVALID');
  // `user_email` is the ownership column, so an agency save may not set it at
  // all — not even to the caller's own address.
  await refusal(call(ADMIN_A, 'pennsync_contract_ai_configuration_save',
    [A, 'agency', null, JSON.stringify({ user_email: EMAIL[ADMIN_A] })]),
  'PENNSYNC_AI_CONFIG_OWNER_FORBIDDEN');
});

test('a page says whether it is the whole set, which is what lets ALL_ROWS be served', async () => {
  // Every screen here passes `ALL_ROWS` (5,000) or a page size, and every
  // contract clamps at 1,000. A route can serve those call sites only because
  // the contract MEASURES completeness rather than leaving it to be inferred
  // from the page's length — so this is the property the seam rests on.
  const answer = await call(ADMIN_A, 'pennsync_contract_validation_rule_list', [A, 5000]);
  assert.equal(answer.complete, true);
  const rows = answer.entries.length;
  const page = await call(ADMIN_A, 'pennsync_contract_validation_rule_list', [A, 1]);
  assert.equal(page.entries.length, 1);
  assert.equal(page.complete, rows <= 1, 'a short page claimed to be the whole set');
  // A limit of zero or below is not a request for nothing; the contract floors
  // it at one, as the roster does.
  assert.equal((await call(ADMIN_A, 'pennsync_contract_validation_rule_list', [A, 0]))
    .entries.length, 1);
});

test('the shared mechanics hold no authorization and no caller can reach them', async () => {
  // `library_write`, `library_list`'s helpers and `library_owned_row` take a
  // TABLE NAME, which is the broker family's shape and the shape D16 keeps
  // away from these entities. What makes that safe is not the comment: it is
  // that they have no `public` wrapper and are granted to the record owner
  // alone, so the only thing that can name a table is one of the fourteen
  // contracts, with a literal.
  const { rows } = await db.query(`
    select p.proname as name,
      has_function_privilege('authenticated', p.oid, 'execute') as authenticated
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public','pennsync_records') and p.proname like 'library%'
    order by 1`);
  assert.ok(rows.length >= 8, 'the mechanics were renamed; re-point this test');
  for (const row of rows) {
    assert.equal(row.authenticated, false, `${row.name} is reachable by a signed-in caller`);
  }
  // And each named contract reaches exactly the table it is for. Read from the
  // migration's own text, because a wrapper handed the wrong literal would be
  // a cross-entity disclosure that every test above still passes.
  const source = readFileSync(resolve(repository, MIGRATION), 'utf8');
  const expected = Object.freeze({
    contract_clinical_pathway_write: 'clinical_pathway',
    contract_clinical_library_template_write: 'clinical_library_template',
    contract_clinical_library_folder_write: 'clinical_library_folder',
    contract_education_material_write: 'education_material',
    contract_patient_education_write: 'patient_education_assignment',
    contract_validation_rule_write: 'custom_validation_rule',
    contract_ai_configuration_save: 'ai_configuration',
  });
  for (const [fn, table] of Object.entries(expected)) {
    const start = source.indexOf(`create function "pennsync_records".${fn}(`);
    assert.ok(start > 0, `${fn} is not in the migration`);
    const body = source.slice(start, source.indexOf('\nend $contract$;', start));
    const named = [...body.matchAll(/library_(?:write|owned_row)\('([a-z_]+)'/g)]
      .map(match => match[1]);
    assert.ok(named.length > 0, `${fn} names no table`);
    assert.deepEqual([...new Set(named)], [table], `${fn} reaches another entity's table`);
  }
});
