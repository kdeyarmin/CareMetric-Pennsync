import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { SCHEMA, readSchemas, snakeCase } from '../../../tools-entity-schema-plan.mjs';
import { RECORD_CONTRACTS } from '../../pennsync-api/record-contracts.mjs';

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

/*
 * Every column these contracts hand back, pinned.
 *
 * The house rule is that a contract projects NAMED columns rather than
 * returning a row, and these return the row: `to_jsonb(t) - 'source_app_id'`.
 * That is deliberate and it is what the originals did — a raw
 * `EducationMaterial.filter(...)` through the platform SDK returned every
 * column, so naming a subset here would be a NARROWING, hiding fields the
 * screens are entitled to and showing nothing when one goes missing.
 *
 * What the rule is protecting against is still real: a column added to one of
 * these seven tables later would be disclosed by all fourteen capabilities
 * with nobody reviewing it. So the set is pinned instead of the projection
 * narrowed, and a schema addition fails HERE — where the failure says which
 * table and which column, and asks whoever added it whether these callers may
 * see it. Regenerating the store is not enough to widen a disclosure.
 */
const PROJECTED = Object.freeze({
  clinical_pathway: [
    'id', 'created_date', 'updated_date', 'created_by',
    'pathway_name', 'condition', 'icd10_codes', 'description',
    'phases', 'typical_los', 'evidence_level', 'references',
    'is_active', 'usage_count', 'success_rate', 'trigger_conditions',
    'pdgm_clinical_group', 'priority_level', 'documentation_prompts', 'rescore_opportunities',
    'recommended_tasks', 'comorbidity_checklist', 'functional_focus_areas', 'agency_id',
  ],
  clinical_library_template: [
    'id', 'created_date', 'updated_date', 'created_by',
    'phrase', 'folder_id', 'category', 'template_type',
    'patient_id', 'patient_name', 'expanded_text', 'ai_prompt_instructions',
    'requires_patient_data', 'patient_data_fields', 'is_active', 'usage_count',
    'is_agency_wide', 'agency_id',
  ],
  clinical_library_folder: [
    'id', 'created_date', 'updated_date', 'created_by',
    'name', 'parent_folder_id', 'color', 'order',
    'is_agency_wide', 'agency_id',
  ],
  education_material: [
    'id', 'created_date', 'updated_date', 'created_by',
    'title', 'category', 'content', 'variables',
    'reading_level', 'language', 'keywords', 'is_template',
    'last_used_date', 'usage_count', 'is_published', 'version',
    'agency_id',
  ],
  patient_education_assignment: [
    'id', 'created_date', 'updated_date', 'created_by',
    'patient_id', 'material_id', 'assigned_by', 'assigned_by_name',
    'status', 'due_date', 'completion_date', 'notes',
    'priority', 'topic', 'content', 'format',
    'assigned_date', 'materials_provided', 'care_plan_id', 'comprehension_verified',
    'teach_back_notes', 'completed_date',
  ],
  custom_validation_rule: [
    'id', 'created_date', 'updated_date', 'created_by',
    'rule_name', 'entity_type', 'field_name', 'validation_type',
    'validation_value', 'error_message', 'severity', 'is_active',
    'agency_id',
  ],
  ai_configuration: [
    'id', 'created_date', 'updated_date', 'created_by',
    'user_email', 'user_name', 'compliance_priority', 'suggestion_aggressiveness',
    'custom_compliance_rules', 'custom_prompts', 'is_active', 'ai_verbosity',
    'clinical_terminology', 'enable_oasis_analysis', 'enable_auto_summarization', 'enable_compliance_checking',
    'enable_care_plan_suggestions', 'enable_task_generation', 'enable_proactive_suggestions', 'auto_enhance_on_completion',
    'preferred_note_style', 'include_assessment_details', 'include_teaching_points', 'show_confidence_scores',
    'setting_name', 'setting_category', 'value', 'description',
    'agency_id',
  ],
});

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
  // A chart in agency B, and an administrator who holds BOTH agencies. The
  // shared fixtures give every identity one membership, and one membership is
  // the case where a request naming the wrong tenant is refused by the
  // policies whatever the contract does — so a tenant-binding assertion built
  // on it passes with the binding deleted. This caller is the one that can
  // tell the two apart, and it is added here rather than in `fixtures.sql`
  // because that file is shared with every other contract suite.
  await db.query(`insert into ${SCHEMA}."patient"
    ("source_app_id","id","agency_id","first_name") values ($1,'patient-b1',$2,'Cal')`, [APP, B]);
  await db.query(`insert into pennsync_private.membership
    (app_id,id,agency_id,auth_user_id,base44_user_id,tenant_role,status)
    select app_id,'membership-1b',$1,auth_user_id,base44_user_id,'agency_admin','active'
    from pennsync_private.membership where id = 'membership-1'`, [B]);
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
// The code must end where it is asserted to end. A bare substring match is
// satisfied by any LONGER code sharing the prefix — `_FORBIDDEN` by
// `_FORBIDDEN_TO_ASSIGN` — which proves a refusal happened rather than which
// one did. None of these codes is a prefix of another today; the boundary is
// what keeps that from becoming a silent assertion when one is added.
const refusal = (promise, code) => assert.rejects(promise, error => {
  assert.match(String(error?.message ?? error), new RegExp(`${code}(?![A-Z_])`));
  return true;
}, `expected ${code}`);
const ids = answer => answer.entries.map(row => row.id);

test('a pathway is read by any member and written by the agency administrator alone', async () => {
  const made = await call(ADMIN_A, 'pennsync_contract_clinical_pathway_write',
    [A, 'create', null, JSON.stringify({ pathway_name: 'CHF', condition: 'heart failure', is_active: true })]);
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
    [A, 'create', null, JSON.stringify({ pathway_name: 'X', condition: 'c' })]), 'PENNSYNC_PATHWAY_FORBIDDEN');
  // Another agency's administrator is not one of ours.
  await refusal(call(ADMIN_B, 'pennsync_contract_clinical_pathway_list', [A, true, null]),
    'PENNSYNC_PATHWAY_AGENCY_NOT_HELD');
  await refusal(call(ADMIN_B, 'pennsync_contract_clinical_pathway_write',
    [A, 'create', null, JSON.stringify({ pathway_name: 'X', condition: 'c' })]), 'PENNSYNC_PATHWAY_FORBIDDEN');

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
    [A, 'create', null, JSON.stringify({ pathway_nmae: 'typo', condition: 'c' })]),
  'PENNSYNC_PATHWAY_FIELD_UNKNOWN');
  for (const reserved of ['agency_id', 'id', 'source_app_id', 'created_date', 'updated_date']) {
    await refusal(call(ADMIN_A, 'pennsync_contract_clinical_pathway_write',
      [A, 'create', null, JSON.stringify({ [reserved]: B })]),
    'PENNSYNC_PATHWAY_FIELD_RESERVED');
  }
  // `created_by` is the one reserved column a payload may name, and only as
  // self-assertion: four call sites send the caller's own address.
  await refusal(call(ADMIN_A, 'pennsync_contract_clinical_pathway_write',
    [A, 'create', null, JSON.stringify({ pathway_name: 'Y', condition: 'c', created_by: EMAIL[ADMIN_B] })]),
  'PENNSYNC_PATHWAY_CREATED_BY_FORBIDDEN');
  const own = await call(ADMIN_A, 'pennsync_contract_clinical_pathway_write',
    [A, 'create', null, JSON.stringify({ pathway_name: 'Y', condition: 'c', created_by: EMAIL[ADMIN_A] })]);
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
    [A, 'create', null, JSON.stringify({ phrase: 'wound care', category: 'assessment', template_type: 'generic', is_active: true })]);
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
    [A, 'create', null, JSON.stringify({ phrase: 'shared', category: 'assessment', template_type: 'generic', is_agency_wide: true })]);
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
    [A, 'create', null, JSON.stringify({ phrase: 'chart bound', category: 'assessment', template_type: 'generic', patient_id: 'patient-a1' })]);
  assert.equal(bound.row.patient_id, 'patient-a1');
  await refusal(call(CLINICIAN_A, 'pennsync_contract_clinical_library_template_write',
    [A, 'update', bound.row.id, JSON.stringify({ patient_id: 'patient-a2' })]),
  'PENNSYNC_LIBRARY_TEMPLATE_FIELD_RESERVED');
  // And a chart the caller does not open cannot be chosen either. The policy
  // is what refuses it; the contract's job is that the refusal arrives as a
  // code the HTTP boundary can classify rather than as `new row violates row
  // level security policy` (D33's rule about the raw duplicate-key error).
  await refusal(call(CLINICIAN_A, 'pennsync_contract_clinical_library_template_write',
    [A, 'create', null, JSON.stringify({ phrase: 'other chart', category: 'assessment', template_type: 'generic', patient_id: 'patient-a2' })]),
  'PENNSYNC_LIBRARY_TEMPLATE_NOT_FOUND');
});

test('the chart a write names is resolved in the agency the request names', async () => {
  // The hole this closes: D24 asks whether the caller opens every chart in an
  // agency, or is assigned this one in that agency. NEITHER half asks which
  // agency the chart is actually in, and the insert policy asks the first
  // question of the ROW's `agency_id`. So a template could be filed in agency
  // A naming agency B's chart — landing in A, tenanted to A, carrying a
  // `patient_id` that is a fact about B.
  const crossed = fields => JSON.stringify({
    phrase: 'crossed', category: 'assessment', patient_id: fields,
  });
  // The PRECONDITION, asserted rather than arranged. `_NOT_FOUND` is raised
  // both for a chart that is real and elsewhere and for a chart that is not
  // real at all, so a refusal test that never shows the chart EXISTS would
  // pass unchanged if the fixture lost it — measuring absence while claiming
  // to measure tenancy. ADMIN_A holds both agencies, so it can write each
  // chart in the agency that actually holds it. The rows are removed again so
  // the suite's shared state is what the later tests expect.
  for (const [agency, chart] of [[B, 'patient-b1'], [A, 'patient-a1']]) {
    const held = await call(ADMIN_A, 'pennsync_contract_clinical_library_template_write',
      [agency, 'create', null, crossed(chart)]);
    assert.equal(held.row.patient_id, chart);
    await db.query(`delete from ${SCHEMA}."clinical_library_template" where id = $1`,
      [held.row.id]);
  }

  // ADMIN_A holds BOTH agencies; ADMIN_B holds only B. Both are refused, and
  // both cases matter: a guard written the other way round — `not exists`, so
  // the foreign chart has to be VISIBLE to prove the row foreign — passes the
  // one-agency case and refuses nothing, because the record owner holds no
  // BYPASSRLS and the chart it would need to see is exactly the one the
  // caller cannot. This check asks the opposite question, so an invisible
  // chart is an absent chart and the write fails CLOSED either way.
  await refusal(call(ADMIN_A, 'pennsync_contract_clinical_library_template_write',
    [A, 'create', null, crossed('patient-b1')]), 'PENNSYNC_LIBRARY_TEMPLATE_NOT_FOUND');
  await refusal(call(ADMIN_B, 'pennsync_contract_clinical_library_template_write',
    [B, 'create', null, crossed('patient-a1')]), 'PENNSYNC_LIBRARY_TEMPLATE_NOT_FOUND');

  // The other direction, because a guard that refuses too much is the same
  // class of defect read from the other side. Two cases, both RECORDED
  // narrowings rather than side effects.
  //
  // A chart this store does not hold. The insert policy admits it today for
  // anybody who opens every chart — `patient_id in caller_assigned_patients`
  // is the only half that looks the id up, and the `caller_opens_every_chart`
  // half never does — so an administrator could file a template against an id
  // naming nothing, and the row would read as chart-bound while pointing at
  // no chart. That is now refused.
  await refusal(call(ADMIN_A, 'pennsync_contract_clinical_library_template_write',
    [A, 'create', null, crossed('no-such-chart')]), 'PENNSYNC_LIBRARY_TEMPLATE_NOT_FOUND');
  // A chart in the caller's OWN agency that they are not assigned to was
  // already refused, by the policy, as `_FORBIDDEN`. It is still refused, and
  // what changed is only the code: `_NOT_FOUND`, which is the answer D24 asks
  // for, since an id must not be testable for existence by somebody who does
  // not open the chart. The refusal is not new; its name is.
  await refusal(call(CLINICIAN_A, 'pennsync_contract_clinical_library_template_write',
    [A, 'create', null, crossed('patient-a2')]), 'PENNSYNC_LIBRARY_TEMPLATE_NOT_FOUND');

  // And the measurement that says the guard is what refuses them. With the
  // check replaced by a no-op the SAME two creates succeed, so the policies
  // catch neither — which is the thing a reading of the predicate cannot
  // tell you and the reason this is a contract's job rather than a policy's.
  const real = (await db.query(`select pg_catalog.pg_get_functiondef(
    to_regprocedure('${SCHEMA}.library_chart(text,text,text)')) as def`)).rows[0].def;
  await db.exec(`create or replace function ${SCHEMA}.library_chart(
    p_agency text, p_patient_id text, p_code text)
    returns void language plpgsql security definer set search_path = '' as $noop$
    begin return; end $noop$;`);
  try {
    for (const [who, agency, chart] of [[ADMIN_A, A, 'patient-b1'], [ADMIN_B, B, 'patient-a1']]) {
      const landed = await call(who, 'pennsync_contract_clinical_library_template_write',
        [agency, 'create', null, crossed(chart)]);
      assert.equal(landed.row.agency_id, agency);
      assert.equal(landed.row.patient_id, chart);
      await db.query(`delete from ${SCHEMA}."clinical_library_template" where id = $1`,
        [landed.row.id]);
    }
  } finally { await db.exec(real); }
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
  // A colleague's PRIVATE folder is not on the list, which is the half a
  // reading of the tenancy alone would miss: `clinical_library_folder_read`
  // is agency-wide, so without the contract's own predicate the folder's name
  // and structure would reach everybody in the agency. Asserted here rather
  // than inferred from the template test, because the two contracts carry
  // that predicate separately and either could lose it alone.
  const mine = await call(CLINICIAN_A, 'pennsync_contract_clinical_library_folder_write',
    [A, 'create', null, JSON.stringify({ name: 'Private', order: 3 })]);
  assert.equal(ids(await call(CLINICIAN_NO_CHART,
    'pennsync_contract_clinical_library_folder_list', [A, null])).includes(mine.row.id), false);
  // The author sees it, and so does the agency's administrator.
  assert.equal(ids(await call(CLINICIAN_A,
    'pennsync_contract_clinical_library_folder_list', [A, null])).includes(mine.row.id), true);
  assert.equal(ids(await call(ADMIN_A,
    'pennsync_contract_clinical_library_folder_list', [A, null])).includes(mine.row.id), true);
});

test('a create supplies what the entity schema requires, or it is refused by name', async () => {
  // The generated store leaves every entity column nullable, so nothing below
  // this contract refuses a row the Base44 schema would not have accepted.
  // One case per entity that declares required fields, because the list is
  // passed in per call site and a wrong one is invisible from any other test.
  const missing = [
    ['pennsync_contract_clinical_pathway_write', 'PENNSYNC_PATHWAY',
      { condition: 'heart failure' }],
    ['pennsync_contract_clinical_library_template_write', 'PENNSYNC_LIBRARY_TEMPLATE',
      { phrase: 'no category', template_type: 'generic' }],
    ['pennsync_contract_clinical_library_folder_write', 'PENNSYNC_LIBRARY_FOLDER',
      { order: 1 }],
    ['pennsync_contract_education_material_write', 'PENNSYNC_EDUCATION_MATERIAL',
      { title: 'No content', category: 'wound_care' }],
    ['pennsync_contract_validation_rule_write', 'PENNSYNC_VALIDATION_RULE',
      { rule_name: 'x', entity_type: 'patient', validation_type: 'required' }],
  ];
  for (const [fn, code, fields] of missing) {
    await refusal(call(ADMIN_A, fn, [A, 'create', null, JSON.stringify(fields)]),
      `${code}_FIELD_REQUIRED`);
  }
  // `patient_education_assignment` declares `assigned_by` required and the
  // contract STAMPS it, so the requirement can never fail from outside —
  // which is the point of checking the merged payload rather than the
  // caller's. The refusal that does exist there is the attribution one.
  await refusal(call(CLINICIAN_A, 'pennsync_contract_patient_education_write',
    [A, 'create', null, JSON.stringify({
      patient_id: 'patient-a1', assigned_by: EMAIL[ADMIN_A], status: 'assigned' })]),
  'PENNSYNC_PATIENT_EDUCATION_ASSIGNED_BY_FORBIDDEN');
  // A json null is the same empty column as an omitted key, so it is refused
  // the same way rather than inserted.
  await refusal(call(ADMIN_A, 'pennsync_contract_clinical_pathway_write',
    [A, 'create', null, JSON.stringify({ pathway_name: null, condition: 'c' })]),
  'PENNSYNC_PATHWAY_FIELD_REQUIRED');
  // An UPDATE names only what it changes, so the requirement is a create's.
  const row = await call(ADMIN_A, 'pennsync_contract_clinical_pathway_write',
    [A, 'create', null, JSON.stringify({ pathway_name: 'CHF', condition: 'heart failure' })]);
  const edited = await call(ADMIN_A, 'pennsync_contract_clinical_pathway_write',
    [A, 'update', row.row.id, JSON.stringify({ description: 'revised' })]);
  assert.equal(edited.row.description, 'revised');
  // `ai_configuration` is the one divergence and it is asserted where its own
  // row is accounted for: the agency save below creates a row with no
  // `user_email`, which is what an agency-wide setting IS, so the schema's own
  // requirement holds on the personal scope only. Creating a second one here
  // would change what that test lists.
});

test('an unpublished education material is the administrator\'s alone', async () => {
  // `rls.read` is `is_published OR role admin`, so the read splits and every
  // write is D40's `agency_admin`.
  const published = await call(ADMIN_A, 'pennsync_contract_education_material_write',
    [A, 'create', null, JSON.stringify({ title: 'Wound care', category: 'wound_care', content: 'c', is_published: true })]);
  const draft = await call(ADMIN_A, 'pennsync_contract_education_material_write',
    [A, 'create', null, JSON.stringify({ title: 'Draft', category: 'wound_care', content: 'c', is_published: false })]);
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
      patient_id: 'patient-a1', assigned_by: EMAIL[CLINICIAN_A],
      status: 'assigned', assigned_date: '2026-09-25',
    })]);
  assert.equal(filed.row.patient_id, 'patient-a1');
  assert.deepEqual(ids(await call(CLINICIAN_A,
    'pennsync_contract_patient_education_list', [A, 'patient-a1', null])), [filed.row.id]);
  // A colleague in the same agency who is on no chart sees nothing and files
  // nothing. `office_staff` open no chart either, which is why this contract
  // does not need to name them.
  assert.deepEqual(ids(await call(CLINICIAN_NO_CHART,
    'pennsync_contract_patient_education_list', [A, 'patient-a1', null])), []);
  // NOT_FOUND rather than FORBIDDEN, and deliberately: under D24 a chart this
  // caller does not open is invisible to them, so an answer distinguishing
  // "exists but is not yours" would make a patient id testable by anybody in
  // the agency. `library_owned_row` takes the same line.
  await refusal(call(CLINICIAN_NO_CHART, 'pennsync_contract_patient_education_write',
    [A, 'create', null, JSON.stringify({ patient_id: 'patient-a1', status: 'assigned' })]),
  'PENNSYNC_PATIENT_EDUCATION_NOT_FOUND');
  // **The envelope's agency binds the write, not just the policies.** This
  // row carries no `agency_id` — its tenancy is the chart — so `library_write`
  // has no tenancy column to compare and the policies then admit every agency
  // the caller holds. ADMIN_A holds agency B as well, so a request whose
  // envelope names B would reach this agency-A row with nothing refusing it.
  // Both directions, because each is a separate predicate in the contract.
  await refusal(call(ADMIN_A, 'pennsync_contract_patient_education_write',
    [B, 'update', filed.row.id, JSON.stringify({ status: 'completed' })]),
  'PENNSYNC_PATIENT_EDUCATION_NOT_FOUND');
  await refusal(call(ADMIN_A, 'pennsync_contract_patient_education_write',
    [B, 'create', null, JSON.stringify({ patient_id: 'patient-a1', status: 'assigned' })]),
  'PENNSYNC_PATIENT_EDUCATION_NOT_FOUND');
  // And the same caller naming the agency the chart really is in is served,
  // so the refusal above is the tenant binding and not a broken path.
  const crossed = await call(ADMIN_A, 'pennsync_contract_patient_education_write',
    [A, 'update', filed.row.id, JSON.stringify({ status: 'completed' })]);
  assert.equal(crossed.row.status, 'completed');
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
    [A, 'create', null, JSON.stringify({ status: 'assigned', assigned_by: EMAIL[CLINICIAN_A] })]),
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
      rule_name: 'MRN required', entity_type: 'patient', field_name: 'medical_record_number',
      validation_type: 'required',
    })]);
  assert.deepEqual(ids(await call(ADMIN_A, 'pennsync_contract_validation_rule_list', [A, null])),
    [rule.row.id]);
  await refusal(call(CLINICIAN_A, 'pennsync_contract_validation_rule_list', [A, null]),
    'PENNSYNC_VALIDATION_RULE_FORBIDDEN');
  await refusal(call(CLINICIAN_A, 'pennsync_contract_validation_rule_write',
    [A, 'create', null, JSON.stringify({ rule_name: 'x', entity_type: 'referral', field_name: 'f', validation_type: 'required' })]),
  'PENNSYNC_VALIDATION_RULE_FORBIDDEN');
  // The table's own enum still decides what a value may be, and the refusal
  // is the contract's own code rather than the raw constraint name. Left raw
  // it reaches the HTTP boundary undeclared, which reports a caller's typo as
  // a 503 record-store outage.
  await refusal(call(ADMIN_A, 'pennsync_contract_validation_rule_write',
    [A, 'create', null, JSON.stringify({ rule_name: 'x', entity_type: 'referral', field_name: 'f', validation_type: 'required' })]),
  'PENNSYNC_VALIDATION_RULE_FIELD_VALUE_INVALID');
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

/*
 * The seven entities, by the name each one's table carries. Used by the
 * defaults check below, which re-derives what the contracts stamp from the
 * schemas rather than reading the migration's own list back to itself.
 */
const ENTITY_TABLE = Object.freeze({
  ClinicalPathway: 'clinical_pathway',
  ClinicalLibraryTemplate: 'clinical_library_template',
  ClinicalLibraryFolder: 'clinical_library_folder',
  EducationMaterial: 'education_material',
  PatientEducationAssignment: 'patient_education_assignment',
  CustomValidationRule: 'custom_validation_rule',
  AIConfiguration: 'ai_configuration',
});

test('a create is given what the entity schema defaults, field for field', async () => {
  // D30's generator emits every column nullable and NO column default, which
  // is deliberate: a legacy row predating a requirement has to be able to
  // migrate. A default fires only where a column is OMITTED, so that costs
  // the import path nothing — and costs a CREATE everything. Base44 wrote
  // `is_active: true` and this store wrote null, so the row existed and every
  // screen filtering on it could not see it.
  //
  // Derived from the entity schemas, not typed here: the migration's own list
  // is checked against them below, and these cases check the contracts pass
  // it to the write.
  const declared = table => {
    const [, schema] = readSchemas(repository)
      .find(([name]) => ENTITY_TABLE[name] === table);
    return Object.fromEntries(Object.entries(schema.properties || {})
      .filter(([, definition]) => definition && Object.hasOwn(definition, 'default'))
      .map(([property, definition]) => [snakeCase(property), definition.default]));
  };

  const pathway = await call(ADMIN_A, 'pennsync_contract_clinical_pathway_write',
    [A, 'create', null, JSON.stringify({ pathway_name: 'Defaulted', condition: 'copd' })]);
  for (const [column, value] of Object.entries(declared('clinical_pathway'))) {
    assert.equal(pathway.row[column], value, column);
  }
  // A value the caller SENT is not replaced, and a json `null` is a value:
  // clearing a field is a thing a caller may mean, and Base44's default fires
  // on an absent key only.
  const chosen = await call(ADMIN_A, 'pennsync_contract_clinical_pathway_write',
    [A, 'create', null, JSON.stringify({
      pathway_name: 'Chosen', condition: 'copd', is_active: false, usage_count: null })]);
  assert.equal(chosen.row.is_active, false);
  assert.equal(chosen.row.usage_count, null);

  // `template_type` is the case that makes the ORDER load-bearing: it is in
  // `ClinicalLibraryTemplate`'s `required` array AND carries a default. Base44
  // accepts a create that omits it, so the required check that shipped with
  // these contracts was a NARROWING for that one field until the defaults
  // were applied BEFORE it rather than after.
  const template = await call(CLINICIAN_A, 'pennsync_contract_clinical_library_template_write',
    [A, 'create', null, JSON.stringify({ phrase: 'no type', category: 'assessment' })]);
  assert.equal(template.row.template_type, 'generic');
  for (const [column, value] of Object.entries(declared('clinical_library_template'))) {
    assert.equal(template.row[column], value, column);
  }

  const material = await call(ADMIN_A, 'pennsync_contract_education_material_write',
    [A, 'create', null, JSON.stringify({
      title: 'Defaulted', category: 'medication_management', content: 'text' })]);
  for (const [column, value] of Object.entries(declared('education_material'))) {
    assert.equal(material.row[column], value, column);
  }
  const rule = await call(ADMIN_A, 'pennsync_contract_validation_rule_write',
    [A, 'create', null, JSON.stringify({
      rule_name: 'Defaulted', entity_type: 'patient',
      field_name: 'first_name', validation_type: 'required' })]);
  for (const [column, value] of Object.entries(declared('custom_validation_rule'))) {
    assert.equal(rule.row[column], value, column);
  }
  const folder = await call(CLINICIAN_A, 'pennsync_contract_clinical_library_folder_write',
    [A, 'create', null, JSON.stringify({ name: 'Defaulted' })]);
  for (const [column, value] of Object.entries(declared('clinical_library_folder'))) {
    assert.equal(folder.row[column], value, column);
  }
  const taught = await call(CLINICIAN_A, 'pennsync_contract_patient_education_write',
    [A, 'create', null, JSON.stringify({ patient_id: 'patient-a1' })]);
  for (const [column, value] of Object.entries(declared('patient_education_assignment'))) {
    assert.equal(taught.row[column], value, column);
  }
  const config = await call(CLINICIAN_NO_CHART, 'pennsync_contract_ai_configuration_save',
    [A, 'mine', null, JSON.stringify({})]);
  for (const [column, value] of Object.entries(declared('ai_configuration'))) {
    assert.equal(config.row[column], value, column);
  }
});

test('the defaults the migration stamps are the ones the entity schemas declare', async () => {
  // The list in `library_default_values` is hand-written, because there is
  // nothing in SQL to generate it from. So it gets a standing check rather
  // than a comment: every table, every field, both directions, read out of
  // the schemas. A property gaining a default upstream fails HERE, which is
  // the only place that can notice.
  for (const [entity, table] of Object.entries(ENTITY_TABLE)) {
    const [, schema] = readSchemas(repository).find(([name]) => name === entity);
    const expected = Object.fromEntries(Object.entries(schema.properties || {})
      .filter(([, definition]) => definition && Object.hasOwn(definition, 'default'))
      .map(([property, definition]) => [snakeCase(property), definition.default]));
    const { rows } = await db.query(
      `select ${SCHEMA}.library_default_values($1) as declared`, [table]);
    assert.deepEqual(rows[0].declared, expected, table);
  }
  // A table nobody declared is a refusal rather than a row of nulls, so a
  // contract added over an eighth entity cannot quietly stamp nothing.
  await assert.rejects(db.query(
    `select ${SCHEMA}.library_defaults('create', '{}'::jsonb, 'visit') as filled`),
  /PENNSYNC_LIBRARY_DEFAULTS_UNDECLARED/);
});

test('every refusal these contracts can raise is a code the service declares', async () => {
  // An undeclared message reaches the HTTP boundary as a 503 CONTRACT_REFUSED
  // — a caller's typo reported as a record-store outage — which is the whole
  // reason `library_write` translates a check violation in the first place.
  // The declaration drifted from the SQL twice while nothing measured it:
  // `_FIELD_VALUE_INVALID` reached no capability at all, `_FIELD_REQUIRED`
  // missed the AI configuration save, and `_ASSIGNED_BY_FORBIDDEN` missed the
  // one capability that can raise it. So this reads the refusals out of the
  // migrations and follows the calls, rather than pinning a list beside a
  // list.
  const sql = (await Promise.all([
    '20260920570000_contract_clinical_library.sql',
    '20260920580000_contract_library_chart_defaults.sql',
  ].map(file => readFile(new URL(`../supabase/record-migrations/${file}`,
    import.meta.url), 'utf8')))).join('\n');
  // Each function's body, last definition winning, so a `create or replace`
  // in the later migration is the one measured.
  const bodies = new Map();
  for (const match of sql.matchAll(
    /create (?:or replace )?function "pennsync_records"\.(\w+)\([\s\S]*?\$(\w+)\$([\s\S]*?)\$\2\$;/g)) {
    bodies.set(match[1], match[3]);
  }
  assert.ok(bodies.has('library_write') && bodies.size > 20);

  const reach = (name, prefix, seen = new Set()) => {
    if (seen.has(name)) return new Set();
    seen.add(name);
    const body = bodies.get(name) ?? '';
    const codes = new Set([
      ...[...body.matchAll(/p_code \|\| '(_[A-Z_]+)'/g)].map(m => `${prefix}${m[1]}`),
      ...[...body.matchAll(/message\s*=\s*'(PENNSYNC_[A-Z_]+)'/g)].map(m => m[1]),
    ]);
    for (const called of body.matchAll(/"pennsync_records"\.(\w+)\(/g)) {
      for (const code of reach(called[1], prefix, seen)) codes.add(code);
    }
    return codes;
  };

  // Every capability at once, so a failure names all of them rather than
  // whichever the loop reached first.
  const undeclared = {};
  let measured = 0;
  for (const [capability, contract] of Object.entries(RECORD_CONTRACTS)) {
    const fn = contract.rpc?.replace(/^pennsync_contract_/, 'contract_');
    if (!fn || !bodies.has(fn)) continue;
    measured += 1;
    // The prefix is the capability's own, taken from what it already declares
    // rather than guessed from the table name.
    const prefix = contract.codes[0].replace(/_(NOT_HELD|FORBIDDEN|INVALID)$/, '')
      .replace(/_AGENCY$/, '').replace(/_SCOPE$/, '');
    const declared = new Set(contract.codes);
    const missing = [...reach(fn, prefix)]
      .filter(code => code.startsWith(prefix) && !declared.has(code)).sort();
    if (missing.length) undeclared[capability] = missing;
  }
  assert.equal(measured, 14);
  assert.deepEqual(undeclared, {});
});

test('a write names its own writable fields, and does not inherit the read\'s', async () => {
  // A read's projection can become an INPUT to the write beside it: where a
  // write checks the payload against an exact key set taken from the read,
  // widening the read by one column fails every save, with both suites green
  // and neither contract wrong on its own. Asserted here because these
  // fourteen pair reads with writes over the same rows, and the answer is
  // that they are NOT coupled that way — `library_fields` checks each key
  // against the table's own columns and a fixed reserved list, so a column
  // added to a table reaches the read (where `PROJECTED` makes it a
  // disclosure decision) and is accepted by the write without either one
  // consulting the other.
  //
  // What IS true, and is the shape a screen hits: these reads project the
  // WHOLE row, so a screen that spreads a read row into a save sends the
  // reserved columns back and is refused by name. That is screen work, and
  // the refusal is deliberate — `created_by` and `agency_id` are the
  // contract's to decide, not a caller's to echo.
  const made = await call(CLINICIAN_A, 'pennsync_contract_clinical_library_template_write',
    [A, 'create', null, JSON.stringify({ phrase: 'round trip', category: 'assessment' })]);
  const read = (await call(CLINICIAN_A, 'pennsync_contract_clinical_library_template_list',
    [A, null, null])).entries.find(row => row.id === made.row.id);
  assert.ok(read, 'the row the write created is not on the read');
  await refusal(call(CLINICIAN_A, 'pennsync_contract_clinical_library_template_write',
    [A, 'update', made.row.id, JSON.stringify({ ...read, phrase: 'edited' })]),
  'PENNSYNC_LIBRARY_TEMPLATE_FIELD_RESERVED');

  // The same payload with the contract's own columns dropped is served, so
  // the refusal above is about those columns and not about the round trip.
  // `patient_id` goes with them, and that is the detail a screen author will
  // trip on: this contract's reserved set is WIDER on an update than on a
  // create, because the chart a template names is chosen when it is written
  // and never moved. So the set a save may send is not the set a create may
  // send, and neither is the set the read projects.
  const CONTRACT_OWNED = ['id', 'created_date', 'updated_date', 'created_by',
    'agency_id', 'patient_id'];
  const writable = Object.fromEntries(Object.entries(read)
    .filter(([column]) => !CONTRACT_OWNED.includes(column)));
  const saved = await call(CLINICIAN_A, 'pennsync_contract_clinical_library_template_write',
    [A, 'update', made.row.id, JSON.stringify({ ...writable, phrase: 'edited' })]);
  assert.equal(saved.row.phrase, 'edited');
  // And the column the read gained is not one the write had to be told about:
  // every key above reached `library_fields` and was accepted on its own.
  assert.equal(saved.row.created_by, EMAIL[CLINICIAN_A]);
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

test('a column added to one of these tables is a disclosure decision, not a migration', async () => {
  for (const [table, expected] of Object.entries(PROJECTED)) {
    const { rows } = await db.query(
      `select column_name from information_schema.columns
       where table_schema = $1 and table_name = $2 and column_name <> 'source_app_id'
       order by ordinal_position`, [SCHEMA.replace(/"/g, ''), table]);
    assert.deepEqual(rows.map(row => row.column_name), expected,
      `${table}'s columns moved: these contracts return the whole row, so this is a change `
      + 'to what fourteen capabilities disclose. Review it, then update PROJECTED.');
  }
  // And the pin is over what the contracts actually hand back, not a list
  // beside them: every read subtracts `source_app_id` and nothing else.
  const source = readFileSync(resolve(repository, MIGRATION), 'utf8');
  const projections = [...source.matchAll(/pg_catalog\.to_jsonb\(t\)\s*-\s*'([a-z_]+)'/g)]
    .map(match => match[1]);
  assert.ok(projections.length >= 7, 'the reads no longer project through to_jsonb');
  assert.deepEqual([...new Set(projections)], ['source_app_id']);
});
