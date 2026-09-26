import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { RECORD_MIGRATION_FILE, SCHEMA } from '../../../tools-entity-schema-plan.mjs';
import { BROKER_MIGRATION_FILE } from '../../../tools-record-brokers.mjs';
import { OPERATIONAL_MAXIMUM } from '../../../src/lib/independentEntityRoutes.js';
import { ALL_ROWS } from '../../../src/lib/queryLimits.js';

/**
 * The seven operational tables, against the real migration.
 *
 * These contracts port no Base44 function, so there is no original to drive
 * and no parity transform to pin. What there IS to prove is every refusal,
 * and that matters more here than usual for two reasons the route gate made
 * plain. Nine of these entity operations pass a payload the frontend builds at
 * run time, so the gate can only report their routes as unproved — which means
 * a write's correctness rests entirely on this file. And the two entities the
 * generic ceiling refuses by name are refused for fields a caller must not
 * reach, so a test that only checked the happy path would pass with the
 * credential digest wide open.
 *
 * So the tests below are mostly refusals, and each one is the entity's own
 * `rls` block asked in the owned store's terms.
 */
const repository = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const LOCATORS = 'services/authority-store/supabase/record-migrations/'
  + '20260920520000_file_locator_map.sql';
const OPERATIONAL = 'services/authority-store/supabase/record-migrations/'
  + '20260920580000_contract_operational_tables.sql';
const APP = '6a9881683dc68a0bd54f1ef7';
const uid = n => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const sid = n => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ADMIN_A = 1; const CLINICIAN_A = 2; const CLINICIAN_EMPTY = 3; const ADMIN_B = 4;
// A caller who holds BOTH agencies, added here because the shared fixtures
// give every identity exactly one membership. On those fixtures a
// cross-tenant assertion is proved by `caller_tenant_role(other) is null`
// rather than by the contract's own predicate, so it would pass unchanged
// with that predicate deleted. This identity is what makes those assertions
// mean what they say.
const ADMIN_BOTH = 5;
const A = 'agency-a'; const B = 'agency-b';

// The three fields `PDFTemplate`'s own schema declares required. Kept in one
// place because a create that omits any of them is now a refusal, and a
// fixture quietly gaining a field is how that refusal would stop being tested.
const TEMPLATE_FIELDS = Object.freeze({
  template_name: 'x', template_category: 'consent',
  template_file_url: 'https://base44.example/t.pdf',
});

const SETTINGS_READ = 'select "public"."pennsync_contract_agency_settings_read"($1,$2,$3,$4) as result';
const SETTINGS_SAVE = 'select "public"."pennsync_contract_agency_settings_save"($1,$2,$3) as result';
const TASK_LIST = 'select "public"."pennsync_contract_task_list"($1,$2,$3,$4,$5,$6,$7) as result';
const TASK_CREATE = 'select "public"."pennsync_contract_task_create"($1,$2) as result';
const TEMPLATE_LIST = 'select "public"."pennsync_contract_pdf_template_list"($1,$2,$3) as result';
const TEMPLATE_SAVE = 'select "public"."pennsync_contract_pdf_template_save"($1,$2,$3) as result';
const TEMPLATE_DELETE = 'select "public"."pennsync_contract_pdf_template_delete"($1,$2) as result';
const PLAN_LIST = 'select "public"."pennsync_contract_care_plan_list"($1,$2,$3,$4,$5) as result';
const PLAN_SAVE = 'select "public"."pennsync_contract_care_plan_save"($1,$2,$3,$4) as result';
const F2F_LIST = 'select "public"."pennsync_contract_face_to_face_list"($1,$2,$3) as result';
const F2F_SAVE = 'select "public"."pennsync_contract_face_to_face_save"($1,$2,$3) as result';
const DOCUMENT_LIST = 'select "public"."pennsync_contract_document_record_list"($1,$2,$3) as result';
const CONVERSION_LIST = 'select "public"."pennsync_contract_note_conversion_list"($1,$2,$3) as result';
const CONVERSION_CREATE = 'select "public"."pennsync_contract_note_conversion_create"($1,$2) as result';

let db;

before(async () => {
  db = new PGlite();
  await db.exec(await readFile(new URL('./bootstrap.sql', import.meta.url), 'utf8'));
  const dir = new URL('../supabase/migrations/', import.meta.url);
  for (const name of (await readdir(dir)).filter(file => file.endsWith('.sql')).sort()) {
    await db.exec(await readFile(new URL(name, dir), 'utf8'));
  }
  // The broker family's migration is where `grant usage on schema
  // pennsync_records to authenticated` lives, so the public wrappers are
  // unreachable without it.
  for (const file of [RECORD_MIGRATION_FILE, BROKER_MIGRATION_FILE, LOCATORS, OPERATIONAL]) {
    await db.exec(readFileSync(resolve(repository, file), 'utf8'));
  }
  await db.exec(await readFile(new URL('./fixtures.sql', import.meta.url), 'utf8'));

  // The charts of record. `patient-a1` is the one the shared fixtures put
  // `clinician-a` on; `patient-a2` is in the same agency and on nobody's team,
  // which is what makes the care-team refusals below real rather than the
  // tenant refusal wearing a different name.
  for (const [id, agency] of [['patient-a1', A], ['patient-a2', A], ['patient-b1', B]]) {
    await db.query(`insert into ${SCHEMA}."patient"
      ("source_app_id","id","agency_id","first_name","last_name","status")
      values ($1,$2,$3,'Synthetic','Chart','active')`, [APP, id, agency]);
  }
  // The dual-agency administrator, built the way the shared fixtures build the
  // other four.
  const both = '10000000-0000-4000-8000-000000000005';
  await db.query(`insert into auth.users(id,email,email_confirmed_at)
    values ($1,'admin-both@example.invalid',clock_timestamp())`, [both]);
  await db.query(`insert into auth.sessions(id,user_id,not_after)
    values ($1,$2,clock_timestamp()+interval '1 hour')`, [sid(5), both]);
  await db.query(`insert into pennsync_private.identity_map
    (app_id,auth_user_id,base44_user_id,expected_email,source_evidence_sha256,verified_at)
    values ($1,$2,'6aac00000000000000000005','admin-both@example.invalid',
      repeat('a',64),clock_timestamp())`, [APP, both]);
  for (const agency of [A, B]) {
    await db.query(`insert into pennsync_private.membership
      (app_id,id,agency_id,auth_user_id,base44_user_id,tenant_role,status)
      values ($1,$2,$3,$4,'6aac00000000000000000005','agency_admin','active')`,
    [APP, `membership-5-${agency}`, agency, both]);
  }

  for (const [id, name] of [[A, 'Keystone Home Health'], [B, 'Allegheny Care Partners']]) {
    await db.query(`insert into ${SCHEMA}."agency"
      ("source_app_id","id","agency_name","status") values ($1,$2,$3,'active')`,
    [APP, id, name]);
  }
});
after(async () => db?.close());

async function as(n, sql, params = [], commit = false) {
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
const refusal = (promise, code) => assert.rejects(promise, error => {
  assert.match(String(error?.message ?? error), new RegExp(code));
  return true;
}, `expected ${code}`);

const settingsRead = (n, args = {}, agency = A) => as(n, SETTINGS_READ,
  [agency, args.agency_code ?? null, args.office_name ?? null, args.limit ?? null]);
const settingsSave = (n, id, fields, agency = A) => as(n, SETTINGS_SAVE,
  [agency, id, JSON.stringify(fields)], true);
const taskList = (n, args = {}, agency = A) => as(n, TASK_LIST, [agency,
  args.patient_id ?? null, args.related_entity ?? null, args.related_entity_id ?? null,
  args.exclude_status ?? null, 'order' in args ? args.order : 'created_date',
  args.limit ?? null]);
const taskCreate = (n, fields, agency = A) => as(n, TASK_CREATE,
  [agency, JSON.stringify(fields)], true);
const templateList = (n, args = {}, agency = A) => as(n, TEMPLATE_LIST,
  [agency, args.parent_template_id ?? null, args.limit ?? null]);
const templateSave = (n, id, fields, agency = A) => as(n, TEMPLATE_SAVE,
  [agency, id, JSON.stringify(fields)], true);
const templateDelete = (n, id, agency = A) => as(n, TEMPLATE_DELETE, [agency, id], true);
const planList = (n, args = {}, agency = A) => as(n, PLAN_LIST,
  [agency, args.id ?? null, args.patient_id ?? null, 'order' in args ? args.order : 'created_date',
    args.limit ?? null]);
const planSave = (n, id, patient, fields, agency = A) => as(n, PLAN_SAVE,
  [agency, id, patient, JSON.stringify(fields)], true);
const f2fList = (n, args = {}, agency = A) => as(n, F2F_LIST,
  [agency, args.referral_id ?? null, args.limit ?? null]);
const f2fSave = (n, id, fields, agency = A) => as(n, F2F_SAVE,
  [agency, id, JSON.stringify(fields)], true);
const documentList = (n, args = {}, agency = A) => as(n, DOCUMENT_LIST,
  [agency, args.patient_id ?? null, args.limit ?? null]);
const conversionList = (n, args = {}, agency = A) => as(n, CONVERSION_LIST,
  [agency, args.recovery_request_id ?? null, args.limit ?? null]);
const conversionCreate = (n, fields, agency = A) => as(n, CONVERSION_CREATE,
  [agency, JSON.stringify(fields)], true);

// ---------------------------------------------------------------------------
// AgencySettings
// ---------------------------------------------------------------------------

test('the settings read is open to any member and the save is not (D40)', async () => {
  assert.deepEqual((await settingsRead(CLINICIAN_A)).entries, []);
  // `rls.read` is `true`, so widening nothing is the port. `rls.create` and
  // `rls.update` are `role === 'admin'`, so an agency_admin is the successor
  // and a clinician is refused.
  await refusal(settingsSave(CLINICIAN_A, null, { office_name: 'Keystone' }),
    'PENNSYNC_SETTINGS_FORBIDDEN');
  // An administrator of another agency holds nothing here, which is a
  // different refusal from holding the wrong role.
  await refusal(settingsSave(ADMIN_B, null, { office_name: 'Keystone' }),
    'PENNSYNC_SETTINGS_AGENCY_NOT_HELD');
  await refusal(settingsRead(ADMIN_B), 'PENNSYNC_SETTINGS_AGENCY_NOT_HELD');
});

test('the credential digest claim is refused by name and never projected', async () => {
  // The three columns that keep `AgencySettings` outside the generic family.
  // Refused BY NAME rather than filtered out (D39), because a silent filter is
  // how a caller learns nothing and a sweep loses its claim anyway.
  for (const field of ['last_credential_digest_sent_on', 'credential_digest_claimed_by',
    'credential_digest_claimed_at']) {
    await refusal(settingsSave(ADMIN_A, null, { [field]: 'x' }),
      'PENNSYNC_SETTINGS_FIELD_RESERVED');
  }
  // And an unknown key is refused rather than dropped, so a misspelled
  // `office_nmae` is a failed save and not a silently lost setting.
  await refusal(settingsSave(ADMIN_A, null, { office_nmae: 'x' }),
    'PENNSYNC_SETTINGS_FIELD_UNKNOWN');
  await refusal(settingsSave(ADMIN_A, null, {}), 'PENNSYNC_SETTINGS_FIELDS_EMPTY');

  const created = await settingsSave(ADMIN_A, null, { office_name: 'Keystone', agency_code: 'KHH' });
  assert.equal(created.created, true);
  assert.equal(created.settings.office_name, 'Keystone');
  for (const withheld of ['last_credential_digest_sent_on', 'credential_digest_claimed_by',
    'credential_digest_claimed_at', 'source_app_id']) {
    assert.equal(Object.hasOwn(created.settings, withheld), false,
      `${withheld} is not the caller's to see`);
  }
  await db.query(`delete from ${SCHEMA}."agency_settings" where "id" = $1`, [created.settings.id]);
});

test('an update patches only what it was sent, and finds only its own agency', async () => {
  const created = await settingsSave(ADMIN_A, null, { office_name: 'Keystone', agency_code: 'KHH' });
  const updated = await settingsSave(ADMIN_A, created.settings.id, { fax_receiving_enabled: true });
  assert.equal(updated.created, false);
  assert.equal(updated.settings.fax_receiving_enabled, true);
  assert.equal(updated.settings.office_name, 'Keystone', 'an absent key keeps its column');
  await refusal(settingsSave(ADMIN_A, 'no-such-row', { office_name: 'x' }),
    'PENNSYNC_SETTINGS_NOT_FOUND');
  await refusal(settingsSave(ADMIN_A, '', { office_name: 'x' }), 'PENNSYNC_SETTINGS_ID_INVALID');
  // The lookup `agencySettings.js` makes is a predicate now and not the
  // tenancy: another agency's code finds nothing rather than its settings.
  assert.deepEqual((await settingsRead(ADMIN_A, { agency_code: 'OTHER' })).entries, []);
  assert.equal((await settingsRead(ADMIN_A, { agency_code: 'KHH' })).entries.length, 1);
  await db.query(`delete from ${SCHEMA}."agency_settings" where "id" = $1`, [created.settings.id]);
});

// ---------------------------------------------------------------------------
// Task
// ---------------------------------------------------------------------------

test('a task naming a chart the caller does not open is refused by name', async () => {
  // `caller_assigned_patients` puts `clinician-a` on `patient-a1` and nobody
  // on `patient-a2`, so this is the care-team narrowing and not the tenant
  // check. The refusal is the contract's rather than the insert policy's,
  // because a bare row-level-security error is one the HTTP boundary cannot
  // classify.
  await refusal(taskCreate(CLINICIAN_A, { title: 'Call the family', patient_id: 'patient-a2' }),
    'PENNSYNC_TASK_CHART_FORBIDDEN');
  const mine = await taskCreate(CLINICIAN_A, { title: 'Call the family', patient_id: 'patient-a1' });
  assert.equal(mine.task.patient_id, 'patient-a1');
  // An agency_admin opens every chart, so the same write stands for them.
  const theirs = await taskCreate(ADMIN_A, { title: 'Order supplies', patient_id: 'patient-a2' });
  assert.equal(theirs.task.patient_id, 'patient-a2');
  await db.query(`delete from ${SCHEMA}."task" where "id" = any($1)`,
    [[mine.task.id, theirs.task.id]]);
});

test('the task sweep marker is the contract`s, and a title is required', async () => {
  await refusal(taskCreate(ADMIN_A, { title: 'x', last_notification_sent: 'now' }),
    'PENNSYNC_TASK_FIELD_RESERVED');
  await refusal(taskCreate(ADMIN_A, { title: 'x', agency_id: B }),
    'PENNSYNC_TASK_FIELD_RESERVED');
  await refusal(taskCreate(ADMIN_A, { title: 'x', urgency: 'high' }),
    'PENNSYNC_TASK_FIELD_UNKNOWN');
  await refusal(taskCreate(ADMIN_A, { description: 'no title' }), 'PENNSYNC_TASK_TITLE_REQUIRED');
  await refusal(taskCreate(ADMIN_A, { title: 'x', priority: 'urgent' }),
    'PENNSYNC_TASK_FIELD_INVALID');
});

test('the task list orders by what it was asked for and nothing else', async () => {
  await refusal(taskList(ADMIN_A, { order: 'title' }), 'PENNSYNC_TASK_ORDER_INVALID');
  await refusal(taskList(ADMIN_A, { order: null }), 'PENNSYNC_TASK_ORDER_INVALID');
  await refusal(taskList(ADMIN_A, { limit: 0 }), 'PENNSYNC_TASK_LIMIT_INVALID');
  await refusal(taskList(ADMIN_B), 'PENNSYNC_TASK_AGENCY_NOT_HELD');

  const rows = [];
  for (const [id, title, status, due] of [['t1', 'first', 'pending', '2026-03-01'],
    ['t2', 'second', 'completed', '2026-01-01']]) {
    await db.query(`insert into ${SCHEMA}."task"
      ("source_app_id","id","agency_id","title","status","due_date","created_date")
      values ($1,$2,$3,$4,$5,$6,clock_timestamp())`, [APP, id, A, title, status, due]);
    rows.push(id);
  }
  const byDue = await taskList(ADMIN_A, { order: 'due_date' });
  assert.deepEqual(byDue.entries.map(row => row.id), ['t1', 't2']);
  // `patientHistoryAnalyzer` asks for the tasks that are NOT completed, and a
  // route that dropped the operator would have answered with them included.
  const open = await taskList(ADMIN_A, { exclude_status: 'completed' });
  assert.deepEqual(open.entries.map(row => row.id), ['t1']);
  await db.query(`delete from ${SCHEMA}."task" where "id" = any($1)`, [rows]);
});

test('a clinician sees the agency`s unassigned tasks and only their own charts', async () => {
  await db.query(`insert into ${SCHEMA}."task"
    ("source_app_id","id","agency_id","title","patient_id","created_date") values
    ($1,'t-open',$2,'no chart',null,clock_timestamp()),
    ($1,'t-mine',$2,'my chart','patient-a1',clock_timestamp()),
    ($1,'t-other',$2,'not my chart','patient-a2',clock_timestamp())`, [APP, A]);
  const seen = await taskList(CLINICIAN_A);
  assert.deepEqual(seen.entries.map(row => row.id).sort(), ['t-mine', 't-open']);
  const admin = await taskList(ADMIN_A);
  assert.deepEqual(admin.entries.map(row => row.id).sort(), ['t-mine', 't-open', 't-other']);
  await db.query(`delete from ${SCHEMA}."task" where "agency_id" = $1`, [A]);
});

// ---------------------------------------------------------------------------
// PDFTemplate
// ---------------------------------------------------------------------------

test('a template locator goes out resolved and never raw (D77)', async () => {
  const created = await templateSave(ADMIN_A, null, {
    template_name: 'Consent', template_category: 'consent',
    template_file_url: 'https://base44.app/storage/legacy-consent.pdf',
  });
  // The file copy has not run, so a legacy Base44 URL resolves to null rather
  // than to itself. Returning the input would hand a caller that asked for an
  // owned handle a locator into somebody else's storage, which it would fetch.
  assert.equal(created.template.template_file_url, null);
  const owned = await templateSave(ADMIN_A, null, {
    template_name: 'Discharge', template_category: 'discharge',
    template_file_url: 'cmfile:3f2504e0-4f89-41d3-9a0c-0305e82c3301',
  });
  assert.equal(owned.template.template_file_url, 'cmfile:3f2504e0-4f89-41d3-9a0c-0305e82c3301',
    'a handle the runtime minted passes through');
  // The raw column is still stored, because the copy has to have something to
  // map from.
  const { rows } = await db.query(
    `select "template_file_url" from ${SCHEMA}."pdf_template" where "id" = $1`,
    [created.template.id]);
  assert.equal(rows[0].template_file_url, 'https://base44.app/storage/legacy-consent.pdf');
  await db.query(`delete from ${SCHEMA}."pdf_template" where "agency_id" = $1`, [A]);
});

test('only the agency administrator writes a template; any member reads one', async () => {
  const created = await templateSave(ADMIN_A, null,
    { ...TEMPLATE_FIELDS, template_name: 'Consent' });
  assert.equal((await templateList(CLINICIAN_A)).entries.length, 1);
  await refusal(templateSave(CLINICIAN_A, null, TEMPLATE_FIELDS),
    'PENNSYNC_TEMPLATE_FORBIDDEN');
  await refusal(templateSave(CLINICIAN_A, created.template.id, { version: '2' }),
    'PENNSYNC_TEMPLATE_FORBIDDEN');
  await refusal(templateDelete(CLINICIAN_A, created.template.id),
    'PENNSYNC_TEMPLATE_FORBIDDEN');
  await refusal(templateSave(ADMIN_A, null, { template_category: 'consent' }),
    'PENNSYNC_TEMPLATE_NAME_REQUIRED');
  await refusal(templateSave(ADMIN_A, null, { ...TEMPLATE_FIELDS, owner: 'me' }),
    'PENNSYNC_TEMPLATE_FIELD_UNKNOWN');
  await refusal(templateDelete(ADMIN_A, 'no-such-template'), 'PENNSYNC_TEMPLATE_NOT_FOUND');
  await refusal(templateDelete(ADMIN_A, ''), 'PENNSYNC_TEMPLATE_ID_INVALID');
  // Another agency's administrator cannot delete this one's template, which
  // is the tenant fence rather than the role gate.
  await refusal(templateDelete(ADMIN_B, created.template.id),
    'PENNSYNC_TEMPLATE_AGENCY_NOT_HELD');
  assert.equal((await templateDelete(ADMIN_A, created.template.id)).deleted, true);
  assert.equal((await templateList(ADMIN_A)).entries.length, 0);
});

// ---------------------------------------------------------------------------
// CarePlan
// ---------------------------------------------------------------------------

test('a care plan belongs to a chart, and the chart is not a field', async () => {
  await refusal(planSave(CLINICIAN_A, null, 'patient-a2', { problem: 'Falls', goal: 'None' }),
    'PENNSYNC_CARE_PLAN_CHART_FORBIDDEN');
  await refusal(planSave(CLINICIAN_A, null, null, { problem: 'Falls', goal: 'g' }),
    'PENNSYNC_CARE_PLAN_PATIENT_REQUIRED');
  const created = await planSave(CLINICIAN_A, null, 'patient-a1',
    { problem: 'Falls', goal: 'No falls in 30 days' });
  assert.equal(created.care_plan.patient_id, 'patient-a1');
  // `care_plan` has no `agency_id`: `patient_id` is the whole of its tenancy,
  // so moving it moves the row between charts and between agencies. Refused by
  // name on an update rather than quietly ignored.
  await refusal(planSave(CLINICIAN_A, created.care_plan.id, null, { patient_id: 'patient-a2' }),
    'PENNSYNC_CARE_PLAN_FIELD_RESERVED');
  const updated = await planSave(CLINICIAN_A, created.care_plan.id, null, { status: 'met' });
  assert.equal(updated.care_plan.status, 'met');
  assert.equal(updated.care_plan.problem, 'Falls');
  await db.query(`delete from ${SCHEMA}."care_plan" where "id" = $1`, [created.care_plan.id]);
});

test('a care plan on a chart the caller cannot open is not there at all', async () => {
  const mine = await planSave(ADMIN_A, null, 'patient-a1', { problem: 'Falls', goal: 'g' });
  const theirs = await planSave(ADMIN_A, null, 'patient-a2', { problem: 'Wounds', goal: 'g' });
  assert.deepEqual((await planList(CLINICIAN_A)).entries.map(row => row.id), [mine.care_plan.id]);
  assert.equal((await planList(ADMIN_A)).entries.length, 2);
  assert.equal((await planList(ADMIN_A, { id: theirs.care_plan.id })).entries.length, 1);
  // Not found rather than forbidden, for a row the caller cannot see: the two
  // are indistinguishable on purpose, so an id cannot be probed for existence.
  await refusal(planSave(CLINICIAN_A, theirs.care_plan.id, null, { status: 'met' }),
    'PENNSYNC_CARE_PLAN_NOT_FOUND');
  await refusal(planList(ADMIN_A, { order: 'problem' }), 'PENNSYNC_CARE_PLAN_ORDER_INVALID');
  await db.query(`delete from ${SCHEMA}."care_plan" where "id" = any($1)`,
    [[mine.care_plan.id, theirs.care_plan.id]]);
});

// ---------------------------------------------------------------------------
// FaceToFaceEncounter
// ---------------------------------------------------------------------------

test('the face-to-face encounter is the administrator`s on both halves', async () => {
  // Its `rls` block gates the READ on `role === 'admin'` too, which is
  // unusual and is why the read is gated here as well. D68's intake roles are
  // wider and are deliberately not adopted: matching them would be a widening
  // nobody decided.
  await refusal(f2fList(CLINICIAN_A), 'PENNSYNC_F2F_FORBIDDEN');
  await refusal(f2fSave(CLINICIAN_A, null, { referral_id: 'ref-1' }), 'PENNSYNC_F2F_FORBIDDEN');
  const created = await f2fSave(ADMIN_A, null, {
    referral_id: 'ref-1', practitioner_name: 'Dr Who', validation_status: 'needs_review',
  });
  assert.equal(created.encounter.referral_id, 'ref-1');
  const revalidated = await f2fSave(ADMIN_A, created.encounter.id, { validation_status: 'valid' });
  assert.equal(revalidated.encounter.validation_status, 'valid');
  assert.equal(revalidated.encounter.practitioner_name, 'Dr Who');
  assert.deepEqual((await f2fList(ADMIN_A, { referral_id: 'ref-2' })).entries, []);
  assert.equal((await f2fList(ADMIN_A, { referral_id: 'ref-1' })).entries.length, 1);
  await refusal(f2fSave(ADMIN_A, 'no-such-encounter', { validation_status: 'valid' }),
    'PENNSYNC_F2F_NOT_FOUND');
  await refusal(f2fSave(ADMIN_A, null, { validation_status: 'maybe' }), 'PENNSYNC_F2F_FIELD_INVALID');
  await db.query(`delete from ${SCHEMA}."face_to_face_encounter" where "agency_id" = $1`, [A]);
});

// ---------------------------------------------------------------------------
// DocumentRecord
// ---------------------------------------------------------------------------

test('a document record is the uploader`s, and tenancy is not ownership (D36)', async () => {
  for (const [id, by] of [['doc-mine', 'clinician-a@example.invalid'],
    ['doc-theirs', 'admin-a@example.invalid']]) {
    await db.query(`insert into ${SCHEMA}."document_record"
      ("source_app_id","id","agency_id","patient_id","document_name","category",
       "file_url","file_name","file_type","created_by","created_date")
      values ($1,$2,$3,'patient-a1','Consent','consent_form',
        'https://base44.app/storage/x.pdf','x.pdf','pdf',$4,clock_timestamp())`,
    [APP, id, A, by]);
  }
  // `document_record_read` puts both rows in the caller's agency and on a
  // chart they open. Neither of those is "this is my upload", so the
  // ownership rule the original states is the contract's and stays.
  const clinician = await documentList(CLINICIAN_A, { patient_id: 'patient-a1' });
  assert.deepEqual(clinician.entries.map(row => row.id), ['doc-mine']);
  // D40's widening is the only half that moves: the platform tier becomes the
  // agency's own administrator, who sees both.
  const admin = await documentList(ADMIN_A, { patient_id: 'patient-a1' });
  assert.deepEqual(admin.entries.map(row => row.id).sort(), ['doc-mine', 'doc-theirs']);
  // And the locator is resolved here for the same reason it is on a template,
  // which matters more: this is a patient's own document.
  assert.equal(admin.entries[0].file_url, null);
  await refusal(documentList(ADMIN_B), 'PENNSYNC_DOCUMENT_RECORD_AGENCY_NOT_HELD');
  await db.query(`delete from ${SCHEMA}."document_record" where "agency_id" = $1`, [A]);
});

// ---------------------------------------------------------------------------
// NoteConversion
// ---------------------------------------------------------------------------

test('the nurse on a conversion is stamped, not chosen', async () => {
  // `nurse_email` decides who may READ the row, so a writer who could set it
  // could address their own conversion to somebody else — or read one by
  // claiming to be its author.
  await refusal(conversionCreate(CLINICIAN_A, { nurse_email: 'admin-a@example.invalid' }),
    'PENNSYNC_NOTE_CONVERSION_FIELD_RESERVED');
  await refusal(conversionCreate(CLINICIAN_A, { quality: 9 }),
    'PENNSYNC_NOTE_CONVERSION_FIELD_UNKNOWN');
  const created = await conversionCreate(CLINICIAN_A, { quality_score: 88, visit_type: 'SOC' });
  assert.equal(created.conversion.nurse_email, 'clinician-a@example.invalid');
  await db.query(`delete from ${SCHEMA}."note_conversion" where "id" = $1`,
    [created.conversion.id]);
});

test('a member reads their own conversions and an administrator the agency`s', async () => {
  for (const [id, nurse] of [['nc-mine', 'clinician-a@example.invalid'],
    ['nc-theirs', 'clinician-empty@example.invalid']]) {
    await db.query(`insert into ${SCHEMA}."note_conversion"
      ("source_app_id","id","agency_id","nurse_email","created_date")
      values ($1,$2,$3,$4,clock_timestamp())`, [APP, id, A, nurse]);
  }
  assert.deepEqual((await conversionList(CLINICIAN_A)).entries.map(row => row.id), ['nc-mine']);
  assert.deepEqual((await conversionList(CLINICIAN_EMPTY)).entries.map(row => row.id),
    ['nc-theirs']);
  // The nurse performance report and the analytics dashboard ask for every
  // conversion in the agency, which is exactly what an agency_admin may have.
  assert.deepEqual((await conversionList(ADMIN_A)).entries.map(row => row.id).sort(),
    ['nc-mine', 'nc-theirs']);
  assert.deepEqual((await conversionList(ADMIN_A, { recovery_request_id: 'r-1' })).entries, []);
  await db.query(`delete from ${SCHEMA}."note_conversion" where "agency_id" = $1`, [A]);
});

// ---------------------------------------------------------------------------
// The shared halves
// ---------------------------------------------------------------------------

test('every contract in the file refuses a caller with no membership', async () => {
  // `caller_tenant_role` is asked of the roster and never of the request, so
  // an agency nobody holds is a refusal rather than an empty list — an empty
  // list would say the agency exists and has nothing in it.
  for (const [name, code, call] of [
    ['settings read', 'PENNSYNC_SETTINGS', () => settingsRead(ADMIN_A, {}, 'agency-z')],
    ['settings save', 'PENNSYNC_SETTINGS', () => settingsSave(ADMIN_A, null, { office_name: 'x' }, 'agency-z')],
    ['task list', 'PENNSYNC_TASK', () => taskList(ADMIN_A, {}, 'agency-z')],
    ['task create', 'PENNSYNC_TASK', () => taskCreate(ADMIN_A, { title: 'x' }, 'agency-z')],
    ['template list', 'PENNSYNC_TEMPLATE', () => templateList(ADMIN_A, {}, 'agency-z')],
    ['template save', 'PENNSYNC_TEMPLATE', () => templateSave(ADMIN_A, null, TEMPLATE_FIELDS, 'agency-z')],
    ['template delete', 'PENNSYNC_TEMPLATE', () => templateDelete(ADMIN_A, 'x', 'agency-z')],
    ['plan list', 'PENNSYNC_CARE_PLAN', () => planList(ADMIN_A, {}, 'agency-z')],
    ['plan save', 'PENNSYNC_CARE_PLAN', () => planSave(ADMIN_A, null, 'patient-a1', { problem: 'x', goal: 'g' }, 'agency-z')],
    ['f2f list', 'PENNSYNC_F2F', () => f2fList(ADMIN_A, {}, 'agency-z')],
    ['f2f save', 'PENNSYNC_F2F', () => f2fSave(ADMIN_A, null, { referral_id: 'x' }, 'agency-z')],
    ['document list', 'PENNSYNC_DOCUMENT_RECORD', () => documentList(ADMIN_A, {}, 'agency-z')],
    ['conversion list', 'PENNSYNC_NOTE_CONVERSION', () => conversionList(ADMIN_A, {}, 'agency-z')],
    ['conversion create', 'PENNSYNC_NOTE_CONVERSION', () => conversionCreate(ADMIN_A, { visit_type: 'x' }, 'agency-z')],
  ]) {
    await refusal(call(), `${code}_AGENCY_NOT_HELD`).catch(error => {
      throw new Error(`${name}: ${error.message}`);
    });
  }
});

test('a payload that is not an object is refused before anything is read', async () => {
  for (const [call, code] of [
    [() => as(ADMIN_A, SETTINGS_SAVE, [A, null, JSON.stringify([1])], true), 'PENNSYNC_SETTINGS_FIELDS_INVALID'],
    [() => as(ADMIN_A, TASK_CREATE, [A, JSON.stringify('x')], true), 'PENNSYNC_TASK_FIELDS_INVALID'],
    [() => as(ADMIN_A, SETTINGS_SAVE, [A, null, null], true), 'PENNSYNC_SETTINGS_FIELDS_INVALID'],
  ]) await refusal(call(), code);
});

test('a field the entity schema requires is refused by name, not left null', async () => {
  // The record store is GENERATED and its generator emits every entity column
  // NULLABLE, so the store is MORE permissive than the Base44 original: an
  // insert missing a required field succeeds and the row is junk. Nothing else
  // catches that — no policy, no check constraint — so each write contract
  // names its own required set and this is what proves it.
  await refusal(taskCreate(ADMIN_A, { status: 'pending' }),
    'PENNSYNC_TASK_TITLE_REQUIRED');
  await refusal(taskCreate(ADMIN_A, { title: '', status: 'pending' }),
    'PENNSYNC_TASK_TITLE_REQUIRED');
  for (const [absent, code] of [
    ['template_name', 'PENNSYNC_TEMPLATE_NAME_REQUIRED'],
    ['template_category', 'PENNSYNC_TEMPLATE_CATEGORY_REQUIRED'],
    ['template_file_url', 'PENNSYNC_TEMPLATE_FILE_REQUIRED'],
  ]) {
    const fields = { ...TEMPLATE_FIELDS };
    delete fields[absent];
    await refusal(templateSave(ADMIN_A, null, fields), code);
  }
  await refusal(planSave(ADMIN_A, null, 'patient-a1', { problem: 'Falls' }),
    'PENNSYNC_CARE_PLAN_GOAL_REQUIRED');
  await refusal(planSave(ADMIN_A, null, 'patient-a1', { goal: 'g' }),
    'PENNSYNC_CARE_PLAN_PROBLEM_REQUIRED');
});

test('a required field is the caller`s only where the schema made it theirs', async () => {
  // Three cases that are NOT refusals, each for its own reason, because
  // requiring more than the original did is a narrowing that hides a create
  // the product accepts.
  //
  // `Task.priority` is required AND defaulted in the Base44 schema, so a
  // caller owes nothing and the row still gets a value the enum admits.
  const task = await taskCreate(ADMIN_A, { title: 'Call the family' });
  assert.equal(task.task.priority, 'medium');
  await db.query(`delete from ${SCHEMA}."task" where "agency_id" = $1`, [A]);

  // `NoteConversion.nurse_email` is required and is STAMPED by the contract
  // from the caller, so no payload can be missing it.
  const conversion = await conversionCreate(CLINICIAN_A, { patient_id: 'patient-a1' });
  assert.equal(conversion.conversion.nurse_email, 'clinician-a@example.invalid');
  await db.query(`delete from ${SCHEMA}."note_conversion" where "agency_id" = $1`, [A]);

  // An UPDATE owes nothing the row already holds — only a value it SENDS has
  // to be a real one, or a partial patch would be impossible.
  const created = await templateSave(ADMIN_A, null, TEMPLATE_FIELDS);
  const patched = await templateSave(ADMIN_A, created.template.id, { version: '2' });
  assert.equal(patched.template.version, '2');
  assert.equal(patched.template.template_name, TEMPLATE_FIELDS.template_name);
  await refusal(templateSave(ADMIN_A, created.template.id, { template_name: '' }),
    'PENNSYNC_TEMPLATE_NAME_REQUIRED');
  await db.query(`delete from ${SCHEMA}."pdf_template" where "agency_id" = $1`, [A]);
});

test('a caller in two agencies reaches only the one the request names', async () => {
  // The predicate being proved is each contract's own `agency_id = p_agency`,
  // and it can only be proved by a caller the POLICIES would let through
  // either way. Every other cross-tenant assertion in this file is really
  // `caller_tenant_role(other) is null` — true, useful, and not this. A whole
  // repository's worth of tenancy assertions turned out to be that one: a
  // binding deleted from an already-merged contract left twelve tests green.
  //
  // So every contract in the file is here, READS and WRITES both, and each is
  // driven by the dual-agency caller rather than by a stranger. Each binding
  // was then neutralised ON ITS OWN rather than all at once, because a loop
  // that removes them together trips on the first and says nothing about the
  // rest. Ten of the twelve fail this test alone when deleted. The two that
  // do not — the settings and face-to-face UPDATE paths — hold the binding
  // TWICE, once in the row lookup and once in the emitted `update`, and
  // removing both together fails here as the others do. Defence in depth
  // rather than an unproved line, and it is written down because a single
  // deletion staying green reads exactly like a check that does not work.
  const inA = await templateSave(ADMIN_BOTH, null,
    { ...TEMPLATE_FIELDS, template_name: 'A form' }, A);
  const inB = await templateSave(ADMIN_BOTH, null,
    { ...TEMPLATE_FIELDS, template_name: 'B form' }, B);
  const taskA = await taskCreate(ADMIN_BOTH, { title: 'A task' }, A);
  await taskCreate(ADMIN_BOTH, { title: 'B task' }, B);
  const f2fA = await f2fSave(ADMIN_BOTH, null, { practitioner_name: 'Dr A' }, A);
  await f2fSave(ADMIN_BOTH, null, { practitioner_name: 'Dr B' }, B);
  const settingsA = await settingsSave(ADMIN_BOTH, null, { office_name: 'A office' }, A);
  await settingsSave(ADMIN_BOTH, null, { office_name: 'B office' }, B);
  const conversionA = await conversionCreate(ADMIN_BOTH, { visit_type: 'SOC' }, A);
  await conversionCreate(ADMIN_BOTH, { visit_type: 'ROC' }, B);
  const planA = await planSave(ADMIN_BOTH, null, 'patient-a1',
    { problem: 'Falls', goal: 'None in 30 days' }, A);
  await db.query(`insert into ${SCHEMA}."document_record"
    ("source_app_id","id","agency_id","document_name","created_by")
    values ($1,'doc-a','agency-a','A doc','admin-both@example.invalid'),
           ($1,'doc-b','agency-b','B doc','admin-both@example.invalid')`, [APP]);

  // Each READ shows the named agency's row and not the other's, although
  // `caller_agencies()` returns both and no policy separates them.
  assert.deepEqual((await templateList(ADMIN_BOTH, {}, A)).entries.map(r => r.template_name),
    ['A form']);
  assert.deepEqual((await taskList(ADMIN_BOTH, {}, B)).entries.map(r => r.title), ['B task']);
  assert.deepEqual((await f2fList(ADMIN_BOTH, {}, A)).entries.map(r => r.practitioner_name),
    ['Dr A']);
  assert.deepEqual((await settingsRead(ADMIN_BOTH, {}, B)).entries.map(r => r.office_name),
    ['B office']);
  assert.deepEqual((await conversionList(ADMIN_BOTH, {}, A)).entries.map(r => r.visit_type),
    ['SOC']);
  assert.deepEqual((await documentList(ADMIN_BOTH, {}, B)).entries.map(r => r.document_name),
    ['B doc']);
  assert.deepEqual((await planList(ADMIN_BOTH, {}, B)).entries, []);

  // And each WRITE naming the wrong agency does not find the row, rather than
  // finding it and writing it.
  await refusal(templateSave(ADMIN_BOTH, inB.template.id, { version: '2' }, A),
    'PENNSYNC_TEMPLATE_NOT_FOUND');
  await refusal(templateDelete(ADMIN_BOTH, inA.template.id, B),
    'PENNSYNC_TEMPLATE_NOT_FOUND');
  await refusal(settingsSave(ADMIN_BOTH, settingsA.settings.id, { office_name: 'x' }, B),
    'PENNSYNC_SETTINGS_NOT_FOUND');
  await refusal(f2fSave(ADMIN_BOTH, f2fA.encounter.id, { practitioner_name: 'x' }, B),
    'PENNSYNC_F2F_NOT_FOUND');
  await refusal(planSave(ADMIN_BOTH, planA.care_plan.id, null, { goal: 'Changed' }, B),
    'PENNSYNC_CARE_PLAN_NOT_FOUND');
  // A create names its chart, so the refusal is the chart's rather than the
  // row's: `care_plan` has no `agency_id` and the chart IS its tenancy.
  await refusal(planSave(ADMIN_BOTH, null, 'patient-b1',
    { problem: 'Wounds', goal: 'Healed' }, A), 'PENNSYNC_CARE_PLAN_CHART_FORBIDDEN');
  await refusal(taskCreate(ADMIN_BOTH, { title: 'x', patient_id: 'patient-b1' }, A),
    'PENNSYNC_TASK_CHART_FORBIDDEN');
  await refusal(f2fSave(ADMIN_BOTH, null, { patient_id: 'patient-b1' }, A),
    'PENNSYNC_F2F_CHART_FORBIDDEN');
  await refusal(f2fSave(ADMIN_BOTH, f2fA.encounter.id, { patient_id: 'patient-b1' }, A),
    'PENNSYNC_F2F_CHART_FORBIDDEN');
  await refusal(conversionCreate(ADMIN_BOTH, { patient_id: 'patient-b1' }, A),
    'PENNSYNC_NOTE_CONVERSION_CHART_FORBIDDEN');

  // A row a create stamped carries the agency the REQUEST named, not the
  // caller's first membership.
  assert.equal(taskA.task.agency_id, A);
  assert.equal(conversionA.conversion.agency_id, A);

  for (const table of ['pdf_template', 'task', 'face_to_face_encounter',
    'agency_settings', 'note_conversion', 'document_record']) {
    await db.query(`delete from ${SCHEMA}."${table}" where "agency_id" in ($1,$2)`, [A, B]);
  }
  await db.query(`delete from ${SCHEMA}."care_plan" where "id" = $1`, [planA.care_plan.id]);
});

test('the chart guard refuses the caller who can SEE neither agency`s proof', async () => {
  // The discriminating case, and the one a dual-agency caller cannot supply.
  // `operational_chart` resolves the chart inside a SECURITY DEFINER under
  // FORCE row-level security with the caller's own claims, and the record
  // owner holds no BYPASSRLS, so a chart in another agency is INVISIBLE to
  // the caller who most needs protecting from it.
  //
  // That is fatal to a guard written as `not exists (a row proving this chart
  // is elsewhere)`: invisible reads as absent, absent reads as fine, and the
  // guard protects the dual-agency caller while letting the single-agency one
  // through — backwards. This guard is the other shape, a POSITIVE requirement
  // that the chart be provably in `p_agency`, so an invisible row fails it for
  // the same reason. Asserted with a caller who holds ONE agency, because the
  // two shapes are indistinguishable under a caller who holds both.
  for (const call of [
    () => taskCreate(ADMIN_A, { title: 'x', patient_id: 'patient-b1' }, A),
    () => f2fSave(ADMIN_A, null, { patient_id: 'patient-b1' }, A),
    () => conversionCreate(CLINICIAN_A, { patient_id: 'patient-b1' }, A),
    () => planSave(ADMIN_A, null, 'patient-b1', { problem: 'x', goal: 'y' }, A),
  ]) await refusal(call(), 'CHART_FORBIDDEN');

  // And the proof that it is the INVISIBILITY being refused rather than the
  // tenant mismatch: a chart id that exists nowhere at all is the same answer,
  // which is what "positive requirement" means.
  await refusal(taskCreate(ADMIN_A, { title: 'x', patient_id: 'no-such-chart' }, A),
    'PENNSYNC_TASK_CHART_FORBIDDEN');
});

test('the guard narrows one create the insert policy would admit, on purpose', async () => {
  // The guard resolves the chart under the caller's own policies, so it
  // inherits `patient_read`. On a READ that would silently hide rows the
  // caller is entitled to, which is why nothing here filters a read through
  // it. On a CREATE it refuses one case the insert policy admits: an
  // `agency_admin` opens every chart in their agency, so the policy passes a
  // row naming a chart this store does not hold, and the guard refuses it
  // because an uncarried chart is invisible to everyone.
  //
  // Recorded as a decision: the row it would create is one nobody can read,
  // and a create says so rather than showing a shorter list.
  await refusal(taskCreate(ADMIN_A, { title: 'x', patient_id: 'chart-not-carried' }),
    'PENNSYNC_TASK_CHART_FORBIDDEN');

  // And the contrast that proves it is the guard rather than the policy: the
  // same administrator, same agency, on a chart the store DOES hold and
  // nobody is assigned to, succeeds.
  const allowed = await taskCreate(ADMIN_A, { title: 'x', patient_id: 'patient-a2' });
  assert.equal(allowed.task.patient_id, 'patient-a2');
  await db.query(`delete from ${SCHEMA}."task" where "agency_id" = $1`, [A]);
});

test('the required sets are the entity schemas` own, field for field', async () => {
  // Same rule as the defaults below, from the other side: the required lists
  // are transcribed, so they are read back from the source. What a CALLER owes
  // is the schema's `required` minus two things — the fields this contract
  // decides rather than the caller (one it stamps, one it takes as a parameter
  // of its own), and the fields the schema also DEFAULTS.
  //
  // THE SECOND SUBTRACTION IS DERIVED AND NOT LISTED, deliberately. A FIELD CAN
  // BE BOTH REQUIRED AND DEFAULTED — `Task.priority` is, and batch C hit the
  // same shape on `ClinicalLibraryTemplate.template_type` — and demanding one
  // of the caller refuses a create Base44 accepted, because there the default
  // is applied first and the required check never sees an absence. A hand-kept
  // list of those fields would be right today and wrong the first time a
  // schema gains one, silently and in the narrowing direction, so it is read
  // out of `properties` instead.
  const sql = readFileSync(resolve(repository, OPERATIONAL), 'utf8');
  const owed = {
    // entity: [prefix, fields the contract decides rather than the caller]
    AgencySettings: ['PENNSYNC_SETTINGS', []],
    Task: ['PENNSYNC_TASK', []],
    PDFTemplate: ['PENNSYNC_TEMPLATE', []],
    CarePlan: ['PENNSYNC_CARE_PLAN', ['patient_id']],
    FaceToFaceEncounter: ['PENNSYNC_F2F', []],
    NoteConversion: ['PENNSYNC_NOTE_CONVERSION', ['nurse_email']],
  };
  let defaulted = 0;
  for (const [entity, [prefix, decided]] of Object.entries(owed)) {
    const schema = JSON.parse(readFileSync(
      resolve(repository, `base44/entities/${entity}.jsonc`), 'utf8')
      .replace(/^\s*\/\/.*$/gm, ''));
    for (const field of decided) {
      const property = schema.properties[field];
      assert.ok(property, `${entity}.${field} is a field at all`);
    }
    const carriesDefault = field =>
      Object.hasOwn(schema.properties[field] ?? {}, 'default');
    const expected = (schema.required ?? [])
      .filter(field => !decided.includes(field) && !carriesDefault(field)).sort();
    defaulted += (schema.required ?? []).filter(carriesDefault).length;

    const call = sql.match(new RegExp(
      `operational_check_required\\(p_fields,\\s*array\\[([^\\]]*)\\],[^;]*?'${prefix}'`));
    const actual = call
      ? [...call[1].matchAll(/'([^']+)'/g)].map(match => match[1]).sort()
      : [];
    assert.deepEqual(actual, expected,
      `${entity}: the caller is owed a different set than its schema requires`);
  }
  // Without one of these seven declaring a field both required and defaulted,
  // the derivation above is inert and would pass with it deleted. `Task` is the
  // case, and if it ever stops being one this says so rather than going quiet.
  assert.ok(defaulted > 0,
    'no required field carries a default, so the subtraction proves nothing');
});

test('the defaults are the entity schemas` own, field for field', async () => {
  // These objects are transcribed, which is the thing D12 settled against, so
  // they are checked against the source rather than trusted. Each contract's
  // default object must be exactly the defaults of its OWN writable set —
  // neither a value invented here nor one the schema declares and this drops.
  const sql = readFileSync(resolve(repository, OPERATIONAL), 'utf8');
  const entities = { settings: 'AgencySettings', task: 'Task', template: 'PDFTemplate',
    care_plan: 'CarePlan', f2f: 'FaceToFaceEncounter', note_conversion: 'NoteConversion' };
  for (const [prefix, entity] of Object.entries(entities)) {
    const writable = sql.match(
      new RegExp(`${prefix}_writable\\(\\) returns text\\[\\][\\s\\S]*?\\$writable\\$;`));
    assert.ok(writable, `${prefix} declares a writable set`);
    const fields = [...writable[0].matchAll(/'([a-z0-9_]+)'/g)].map(match => match[1]);

    const declared = sql.match(
      new RegExp(`${prefix}_defaults\\(\\) returns jsonb[\\s\\S]*?\\$defaults\\$;`));
    assert.ok(declared, `${prefix} declares a defaults object`);
    const literal = [...declared[0].matchAll(/'([^']*)'/g)].map(match => match[1]).join('');
    const actual = JSON.parse(literal);

    const schema = JSON.parse(readFileSync(
      resolve(repository, `base44/entities/${entity}.jsonc`), 'utf8')
      .replace(/^\s*\/\/.*$/gm, ''));
    const expected = {};
    for (const field of fields) {
      const property = schema.properties[field];
      if (property && property.default !== undefined) expected[field] = property.default;
    }
    assert.deepEqual(actual, expected, `${entity}: the defaults are not the schema's`);
  }
});

test('a create takes the schema default and an update takes nothing', async () => {
  // The generated store emits no column default at all, so without this a
  // template created here would have a null `is_active` and every screen that
  // filters on it would stop seeing it — no refusal, no error, just a row the
  // product cannot find.
  const created = await templateSave(ADMIN_A, null, TEMPLATE_FIELDS);
  assert.equal(created.template.is_active, true);
  assert.equal(created.template.version, '1.0');
  assert.equal(created.template.usage_count, 0);

  // The caller's own value wins over the default, including a falsy one.
  const explicit = await templateSave(ADMIN_A, null,
    { ...TEMPLATE_FIELDS, template_name: 'Retired', is_active: false, version: '7' });
  assert.equal(explicit.template.is_active, false);
  assert.equal(explicit.template.version, '7');

  // An UPDATE that omits a defaulted field leaves it alone rather than
  // resetting it to the default, which is what merging defaults on both halves
  // would do.
  const patched = await templateSave(ADMIN_A, explicit.template.id, { description: 'x' });
  assert.equal(patched.template.is_active, false);
  assert.equal(patched.template.version, '7');

  const task = await taskCreate(ADMIN_A, { title: 'Call the family' });
  assert.equal(task.task.priority, 'medium');
  assert.equal(task.task.status, 'pending');
  assert.equal(task.task.is_recurring, false);

  await db.query(`delete from ${SCHEMA}."pdf_template" where "agency_id" = $1`, [A]);
  await db.query(`delete from ${SCHEMA}."task" where "agency_id" = $1`, [A]);
});

test('a writable column that names a person grants that person nothing', async () => {
  // `created_by` is not the only column that names somebody. Two of these
  // seven have another — `task.assigned_to`, which any member may set, and
  // `agency_settings.agency_manager_email`, which an `agency_admin` may — and
  // both stay writable because both are the CONTENT of the row rather than a
  // claim about who the caller is. That reading is only safe while nothing
  // reads them for authorization, which is what this checks: the moment a
  // policy or a contract asks either one, setting it becomes a way to grant
  // yourself something and it has to move to the reserved set.
  const store = readFileSync(resolve(repository, RECORD_MIGRATION_FILE), 'utf8');
  const policies = store.split('\n').filter(line => line.startsWith('create policy'));
  for (const column of ['assigned_to', 'agency_manager_email']) {
    assert.deepEqual(policies.filter(line => line.includes(`"${column}"`)), [],
      `a policy reads ${column} — it is authority now, so reserve it`);
  }
  const sql = readFileSync(resolve(repository, OPERATIONAL), 'utf8');
  // Named in the writable sets and in this file's own prose, and nowhere else:
  // no contract here branches on either value.
  for (const column of ['assigned_to', 'agency_manager_email']) {
    const code = sql.split('\n')
      .filter(line => !line.trimStart().startsWith('--') && line.includes(column))
      .filter(line => !/^\s*'/.test(line) && !line.includes(`'${column}'`));
    assert.deepEqual(code, [], `${column} is read by a contract in this file`);
  }
});

test('every declared refusal code is one this file has raised or named', async () => {
  // The registry's codes are what the service will translate into a 409 rather
  // than a 503, so a code the contract cannot raise is a code that turns a
  // real outage into a clean refusal. Read from the migration itself.
  const { RECORD_CONTRACTS } = await import('../../pennsync-api/record-contracts.mjs');
  const sql = readFileSync(resolve(repository, OPERATIONAL), 'utf8');
  // `operational_check_required` composes `<prefix>_<code>_REQUIRED` from two
  // parallel arrays, so neither half is a literal in the file. Re-derive the
  // set it can raise by pairing them, rather than loosening the search: a
  // required code no call site passes still has to fail here.
  const required = new Set();
  for (const call of sql.matchAll(
    /operational_check_required\(p_fields,\s*array\[([^\]]*)\],\s*array\[([^\]]*)\],\s*'([A-Z0-9_]+)'/g)) {
    const fields = [...call[1].matchAll(/'([^']+)'/g)].map(m => m[1]);
    const codes = [...call[2].matchAll(/'([^']+)'/g)].map(m => m[1]);
    assert.equal(fields.length, codes.length,
      'a required call pairs one code with each field');
    for (const code of codes) required.add(`${call[3]}_${code}_REQUIRED`);
  }
  assert.ok(required.size > 0, 'the required-field helper is called at all');

  // `operational_chart` composes `<prefix>_CHART_FORBIDDEN` the same way.
  const chart = new Set([...sql.matchAll(
    /operational_chart\([^;]*?'([A-Z0-9_]+)'\)/g)].map(call => `${call[1]}_CHART_FORBIDDEN`));
  assert.ok(chart.size > 0, 'the chart helper is called at all');
  for (const code of chart) required.add(code);

  const names = ['getAgencySettings', 'saveAgencySettings', 'listAgencyTasks',
    'createAgencyTask', 'listPdfTemplates', 'savePdfTemplate', 'deletePdfTemplate',
    'listCarePlans', 'saveCarePlan', 'listFaceToFaceEncounters',
    'saveFaceToFaceEncounter', 'listPatientDocumentRecords', 'listNoteConversions',
    'createNoteConversion'];
  for (const name of names) {
    const entry = RECORD_CONTRACTS[name];
    assert.ok(entry, `${name} is declared`);
    for (const code of entry.codes) {
      // `_AGENCY_NOT_HELD`, `_LIMIT_INVALID` and the field codes are raised
      // through the shared helpers, which build them from a prefix, so the
      // literal to look for is the prefix the contract passes.
      const [, prefix] = code.match(/^(PENNSYNC_[A-Z0-9_]+?)_(?:AGENCY_NOT_HELD|LIMIT_INVALID|FIELDS_INVALID|FIELDS_EMPTY|FIELD_UNKNOWN|FIELD_RESERVED)$/) ?? [];
      const needle = prefix ? `'${prefix}'` : `'${code}'`;
      assert.ok(sql.includes(needle) || required.has(code),
        `${name}: ${code} is raised by the migration`);
    }
  }
});

test('the page ceiling is one number, not three copies of one', () => {
  // `OPERATIONAL_MAXIMUM` is what the routes prove a page against, `least(…,
  // 5000)` is what the contracts actually clamp to, and `ALL_ROWS` is what the
  // screens asking for everything pass. The first was chosen by reading the
  // other two, and a hand reading nothing guards is a comment with extra
  // steps: raise the contract's clamp without the route's constant and every
  // screen over 5,000 rows starts rendering a truncated list as the whole set,
  // with the route still looking fine.
  const sql = readFileSync(resolve(repository, OPERATIONAL), 'utf8');
  const clamps = [...sql.matchAll(/pg_catalog\.least\(p_limit, (\d+)\)/g)].map(m => Number(m[1]));
  assert.equal(clamps.length, 1, 'one clamp, in the shared helper');
  assert.equal(clamps[0], OPERATIONAL_MAXIMUM);
  assert.equal(ALL_ROWS, OPERATIONAL_MAXIMUM,
    'the ceiling was chosen to be what a screen asking for everything passes');
});

/**
 * Every column a writable or reserved set names is a real column of its table.
 *
 * These sets are the only thing standing between a caller's payload and the
 * row, and both halves fail QUIETLY when a name is wrong: a writable column
 * that does not exist can never be sent, and a reserved one that does not
 * exist refuses a field nobody has. Neither shows up in a refusal suite, which
 * only ever sends names somebody chose on purpose.
 *
 * It also pins the property the `patient_id` asymmetry rests on: `care_plan`
 * reserves it on update because that table has no `agency_id` and the chart IS
 * its tenancy, while `face_to_face_encounter` permits the move because it
 * carries one. Read out of the generated store, so a regeneration that drops
 * either column says so here.
 */
test('every writable and reserved column is one the generated table has', () => {
  const store = readFileSync(resolve(repository, RECORD_MIGRATION_FILE), 'utf8');
  const sql = readFileSync(resolve(repository, OPERATIONAL), 'utf8');
  const tables = { settings: 'agency_settings', task: 'task', template: 'pdf_template',
    care_plan: 'care_plan', f2f: 'face_to_face_encounter',
    note_conversion: 'note_conversion', document_record: 'document_record' };
  let checked = 0;
  for (const [prefix, table] of Object.entries(tables)) {
    const created = store.match(new RegExp(
      `create table "pennsync_records"\\."${table}" \\(([\\s\\S]*?)\\n\\);`));
    assert.ok(created, `${table} is not a table in the generated store`);
    const columns = new Set([...created[1].matchAll(/^\s{2}"([a-z0-9_]+)"/gm)]
      .map(match => match[1]));
    for (const kind of ['writable', 'reserved']) {
      const declared = sql.match(new RegExp(
        `${prefix}_${kind}\\(\\) returns text\\[\\][\\s\\S]*?\\$${kind}\\$;`));
      if (!declared) continue;
      const named = [...declared[0].matchAll(/'([a-z0-9_]+)'/g)].map(match => match[1]);
      checked += named.length;
      assert.deepEqual(named.filter(column => !columns.has(column)), [],
        `${prefix}_${kind} names a column ${table} does not have`);
    }
  }
  assert.ok(checked > 100, `only ${checked} columns checked — the sets were not read`);

  // The asymmetry itself, so it cannot be tidied into agreement by a reader
  // who has not looked at the two tables.
  const chartTenanted = store.match(
    /create table "pennsync_records"\."care_plan" \(([\s\S]*?)\n\);/)[1];
  const columnTenanted = store.match(
    /create table "pennsync_records"\."face_to_face_encounter" \(([\s\S]*?)\n\);/)[1];
  assert.ok(!/^\s{2}"agency_id"/m.test(chartTenanted),
    'care_plan has an agency_id now — its patient_id need not be reserved');
  assert.ok(/^\s{2}"agency_id" text not null/m.test(columnTenanted),
    'face_to_face_encounter lost its agency_id — its patient_id is now tenancy');
});
